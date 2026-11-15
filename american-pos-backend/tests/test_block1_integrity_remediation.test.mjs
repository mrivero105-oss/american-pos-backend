import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const models = require('../database/models');
const AccountingEngineService = require('../services/AccountingEngineService');
const ExpenseService = require('../services/ExpenseService');
const SaleService = require('../services/SaleService');
const RefundService = require('../services/RefundService');
const CashService = require('../services/CashService');
const FiscalService = require('../services/FiscalService');
const ProductService = require('../services/ProductService');
const ReportService = require('../services/ReportService');
const OwnerNotificationService = require('../services/OwnerNotificationService');
const { processSalesAnalysis } = require('../utils/salesAnalytics');
const precision = require('../utils/VortexMathEngine');

after(async () => {
    try {
        await models.sequelize.close();
    } catch (_) {}
});

function mockSequentialTransaction(txObj) {
    return async (arg1, arg2) => {
        const fn = typeof arg1 === 'function' ? arg1 : (typeof arg2 === 'function' ? arg2 : null);
        if (fn) {
            try {
                const res = await fn(txObj);
                await txObj.commit();
                return res;
            } catch (err) {
                await txObj.rollback();
                throw err;
            }
        }
        return txObj;
    };
}

test('Bloque 1A — ExpenseService propaga error contable y hace rollback si AccountingEngineService falla', async () => {
    const origTx = models.sequelize.transaction;
    const origExpenseCreate = models.Expense.create;
    const origGenExpenseEntry = AccountingEngineService.generateExpenseEntry;
    const origAuditCreate = models.AuditLog.create;

    let committed = false;
    let rolledBack = false;
    const fakeTx = {
        LOCK: { UPDATE: 'UPDATE' },
        commit: async () => { committed = true; },
        rollback: async () => { rolledBack = true; }
    };

    try {
        models.sequelize.transaction = mockSequentialTransaction(fakeTx);
        models.Expense.create = async (payload) => ({ ...payload, toJSON: () => payload });
        models.AuditLog.create = async () => ({});
        AccountingEngineService.generateExpenseEntry = async () => {
            throw new Error('FALLO_CONTABLE_SIMULADO');
        };

        await assert.rejects(
            () => ExpenseService.createExpense(
                { id: 'u-1', companyId: 'default' },
                { amount: 25, description: 'Compra papelería', paymentMethod: 'cash', deductFromCash: false }
            ),
            /FALLO_CONTABLE_SIMULADO/
        );
        assert.equal(rolledBack, true, 'Debe ejecutar rollback si falla el asiento contable');
        assert.equal(committed, false, 'No debe hacer commit sin asiento contable válido');
    } finally {
        models.sequelize.transaction = origTx;
        models.Expense.create = origExpenseCreate;
        AccountingEngineService.generateExpenseEntry = origGenExpenseEntry;
        models.AuditLog.create = origAuditCreate;
    }
});

test('Bloque 1B — SaleService recalcula IVA en servidor y normaliza pagos antes de calcular IGTF (y revierte en fallo contable)', async () => {
    const origTx = models.sequelize.transaction;
    const origQuery = models.sequelize.query;
    const origBranchFindOne = models.Branch.findOne;
    const origSaleFindByPk = models.Sale.findByPk;
    const origSaleFindOne = models.Sale.findOne;
    const origSaleCreate = models.Sale.create;
    const origSaleItemCreate = models.SaleItem.create;
    const origProductFindAll = models.Product.findAll;
    const origProductFindByPk = models.Product.findByPk;
    const origProductFindOne = models.Product.findOne;
    const origPresFindAll = models.ProductPresentation.findAll;
    const origLotFindAll = models.ProductLot.findAll;
    const origBranchStockFindOne = models.BranchStock.findOne;
    const origBranchStockCreate = models.BranchStock.create;
    const origStockMovCreate = models.StockMovement.create;
    const origCashShiftFindOne = models.CashShift.findOne;
    const origAuditCreate = models.AuditLog.create;
    const origAlertCreate = models.Alert.create;
    const origGetSettings = SaleService._getSettings;
    const origGenSaleEntry = AccountingEngineService.generateSaleEntry;
    const origBomFindOne = models.BillOfMaterials.findOne;

    let committed = false;
    let rolledBack = false;
    let capturedSalePayload = null;
    let capturedAccountingTx = null;

    const fakeTx = {
        id: 'tx-mock-1b',
        LOCK: { UPDATE: 'UPDATE' },
        afterCommit: () => {},
        commit: async () => { committed = true; },
        rollback: async () => { rolledBack = true; }
    };

    try {
        // 1. Verificar normalización directa cuando cliente envía solo id/paymentMethod y monto tendered
        const norm = SaleService._normalizePayments(
            { paymentMethod: 'cash', amountTenderedUsd: 119.48, amountTenderedVes: 0 },
            116.00,
            50,
            {}
        );
        assert.equal(norm.length, 1);
        assert.equal(norm[0].method, 'cash');
        assert.equal(norm[0].currency, 'USD');
        assert.equal(norm[0].amount, 119.48);

        models.sequelize.transaction = mockSequentialTransaction(fakeTx);
        models.sequelize.query = async () => ([{ currentNumber: 1 }]);
        models.Branch.findOne = async () => ({ id: 'branch-1', companyId: 'default', isMain: true });
        models.Sale.findByPk = async () => null;
        models.Sale.findOne = async () => (capturedSalePayload ? { ...capturedSalePayload, setDataValue: () => {} } : null);
        models.CashShift.findOne = async () => ({ id: 'shift-1', registerId: '1', status: 'open', allowedCategories: [] });
        models.ProductPresentation.findAll = async () => ([]);
        models.ProductLot.findAll = async () => ([]);
        models.BillOfMaterials.findOne = async () => null;
        models.Alert.create = async () => ({ id: 'al-1b', update: async () => ({}) });
        const prodRecord = {
            id: 'prod-iva-100',
            name: 'Producto Gravable $116',
            price: 116.00,
            cost: 50.00,
            taxStatus: 'gravable',
            stockQuantity: 20,
            stock: 20,
            category: 'General',
            allowNegative: false,
            isPublished: true,
            update: async () => ({}),
            decrement: async () => ({}),
            reload: async () => prodRecord
        };
        models.Product.findAll = async () => ([prodRecord]);
        models.Product.findByPk = async () => prodRecord;
        models.Product.findOne = async () => prodRecord;
        models.BranchStock.findOne = async () => ({
            id: 'bs-1',
            quantity: 20,
            update: async () => ({}),
            decrement: async () => ({})
        });
        models.BranchStock.create = async (p) => p;
        models.StockMovement.create = async (p) => p;
        models.AuditLog.create = async () => ({});
        models.Sale.create = async (payload) => {
            capturedSalePayload = payload;
            return {
                ...payload,
                update: async (patch) => {
                    Object.assign(capturedSalePayload, patch);
                    return capturedSalePayload;
                },
                toJSON: () => ({ ...capturedSalePayload })
            };
        };
        models.SaleItem.create = async (payload) => payload;
        SaleService._getSettings = async () => ({
            exchangeRate: 50,
            igtfEnabled: true,
            igtfRate: 3,
            ivaEnabled: true,
            ivaRate: 16
        });

        AccountingEngineService.generateSaleEntry = async (_sale, _cid, t) => {
            capturedAccountingTx = t;
            return { id: 'je-sale-1' };
        };

        const adminUser = { id: 'admin-1', role: 'admin', companyId: 'default', permissions: {} };

        // Cliente envía tax: 0 intentando omitir IVA y sin paymentMethods explícito (solo amountTenderedUsd)
        await SaleService.processSale(adminUser, {
            clientTransactionId: 'TX-ZERO-TRUST-IVA-IGTF-1',
            items: [{ id: 'prod-iva-100', productId: 'prod-iva-100', name: 'Producto Gravable $116', price: 116, quantity: 1 }],
            subtotal: 116.00,
            tax: 0,
            total: 119.48,
            paymentMethod: 'cash',
            amountTenderedUsd: 119.48
        });

        assert.equal(capturedSalePayload.tax, 16.00, 'Servidor debe recalcular IVA 16% incluido sobre PVP gravable ($116 -> $16)');
        assert.equal(capturedSalePayload.igtfAmount, 3.48, 'Servidor debe normalizar pagos y calcular IGTF 3% sobre $116');
        assert.equal(capturedSalePayload.total, 119.48);
        assert.equal(capturedAccountingTx, fakeTx, 'AccountingEngineService.generateSaleEntry debe recibir la transacción activa');
        assert.equal(committed, true);

        // Si falla contabilidad dentro de processSale debe ejecutar rollback
        committed = false;
        rolledBack = false;
        AccountingEngineService.generateSaleEntry = async () => {
            throw new Error('FALLO_ASIENTO_VENTA');
        };
        await assert.rejects(
            () => SaleService.processSale(adminUser, {
                clientTransactionId: 'TX-ZERO-TRUST-ROLLBACK-2',
                items: [{ id: 'prod-iva-100', productId: 'prod-iva-100', name: 'Producto Gravable $116', price: 116, quantity: 1 }],
                subtotal: 116.00,
                tax: 0,
                total: 119.48,
                paymentMethod: 'cash',
                amountTenderedUsd: 119.48
            }),
            /FALLO_ASIENTO_VENTA/
        );
        assert.equal(rolledBack, true);
        assert.equal(committed, false);
    } finally {
        models.sequelize.transaction = origTx;
        models.sequelize.query = origQuery;
        models.Branch.findOne = origBranchFindOne;
        models.Sale.findByPk = origSaleFindByPk;
        models.Sale.findOne = origSaleFindOne;
        models.Sale.create = origSaleCreate;
        models.SaleItem.create = origSaleItemCreate;
        models.Product.findAll = origProductFindAll;
        models.Product.findByPk = origProductFindByPk;
        models.Product.findOne = origProductFindOne;
        models.ProductPresentation.findAll = origPresFindAll;
        models.ProductLot.findAll = origLotFindAll;
        models.BranchStock.findOne = origBranchStockFindOne;
        models.BranchStock.create = origBranchStockCreate;
        models.StockMovement.create = origStockMovCreate;
        models.CashShift.findOne = origCashShiftFindOne;
        models.AuditLog.create = origAuditCreate;
        models.Alert.create = origAlertCreate;
        SaleService._getSettings = origGetSettings;
        AccountingEngineService.generateSaleEntry = origGenSaleEntry;
        models.BillOfMaterials.findOne = origBomFindOne;
    }
});

test('Bloque 1C — RefundService prorratea descuentos, separa pago_movil VES vs fiado/cash y CashService.getShiftStats no contamina Cash USD', async () => {
    const origTx = models.sequelize.transaction;
    const origBranchFindOne = models.Branch.findOne;
    const origSaleFindOne = models.Sale.findOne;
    const origSaleFindAll = models.Sale.findAll;
    const origSaleItemFindAll = models.SaleItem.findAll;
    const origRefundFindAll = models.Refund.findAll;
    const origRefundCreate = models.Refund.create;
    const origProductFindOne = models.Product.findOne;
    const origBranchStockFindOrCreate = models.BranchStock.findOrCreate;
    const origStockMovCreate = models.StockMovement.create;
    const origCashShiftFindOne = models.CashShift.findOne;
    const origCashMovFindAll = models.CashMovement.findAll;
    const origCashMovCreate = models.CashMovement.create;
    const origCashMovDestroy = models.CashMovement.destroy;
    const origCustomerFindOne = models.Customer.findOne;
    const origCreditHistCreate = models.CreditHistory.create;
    const origAuditCreate = models.AuditLog.create;
    const origCreateCnInTx = FiscalService.createCreditNoteInTransaction;
    const origGenRefundEntry = AccountingEngineService.generateRefundEntry;
    const origNotify = OwnerNotificationService.notifySecurityAlert;

    let capturedRefundPayload = null;
    const capturedMovements = [];
    let customerBalanceState = 30.00;
    let ncTx = null;
    let accTx = null;
    let activeSaleItems = [];

    const fakeTx = {
        id: 'tx-mock-1c',
        LOCK: { UPDATE: 'UPDATE' },
        afterCommit: () => {},
        commit: async () => {},
        rollback: async () => {}
    };

    try {
        models.sequelize.transaction = mockSequentialTransaction(fakeTx);
        models.Branch.findOne = async () => ({ id: 'branch-1', companyId: 'default', isMain: true });
        models.SaleItem.findAll = async () => activeSaleItems;
        models.AuditLog.create = async () => ({});
        OwnerNotificationService.notifySecurityAlert = () => {};
        models.BranchStock.findOrCreate = async () => ([{ quantity: 5, update: async () => ({}), increment: async () => ({}) }, false]);
        models.StockMovement.create = async () => ({});
        models.CashShift.findOne = async () => ({
            id: 'shift-ref-1',
            userId: 'admin-1',
            companyId: 'default',
            registerId: '1',
            status: 'open',
            initialAmount: 0,
            initialBreakdown: { cash: 0, pago_movil: 0 }
        });
        models.CashMovement.findAll = async () => ([]);
        models.CashMovement.destroy = async () => 0;
        models.CashMovement.create = async (m) => {
            capturedMovements.push(m);
            return m;
        };
        FiscalService.createCreditNoteInTransaction = async (_cid, _uid, _data, t) => {
            ncTx = t;
            return { id: 'cn-1', creditNoteNumber: 'NC-00001' };
        };
        AccountingEngineService.generateRefundEntry = async (_rf, _sale, _cid, t) => {
            accTx = t;
            return { id: 'je-ref-1' };
        };

        // Escenario 1: Venta con descuento (subtotal $100, discount $10, total $90) pagada con Pago Móvil VES (tasa 100 -> Bs 9000)
        models.Product.findOne = async () => ({
            id: 'p-1',
            name: 'Producto $50',
            category: 'General',
            cost: 25,
            stockQuantity: 10,
            stock: 10,
            update: async () => ({})
        });
        activeSaleItems = [
            { id: 'si-1', productId: 'p-1', name: 'Producto $50', price: 50, cost: 25, quantity: 2, subtotal: 100 }
        ];
        models.Sale.findOne = async () => ({
            id: 'sale-disc-pm',
            companyId: 'default',
            branchId: 'branch-1',
            subtotal: 100,
            discount: 10,
            promoDiscount: 0,
            tax: 0,
            igtfAmount: 0,
            total: 90,
            exchangeRate: 100,
            paymentMethod: 'pago_movil',
            paymentMethods: [{ method: 'pago_movil', currency: 'VES', amount: 9000, convertedAmountUsd: 90 }],
            SaleItems: activeSaleItems,
            update: async () => ({})
        });
        models.Refund.findAll = async () => ([]);
        models.Refund.create = async (payload) => {
            capturedRefundPayload = payload;
            return { ...payload, toJSON: () => payload };
        };

        await RefundService.processRefund(
            { id: 'admin-1', role: 'admin', companyId: 'default', name: 'Admin' },
            { saleId: 'sale-disc-pm', items: [{ productId: 'p-1', quantity: 1 }], reason: 'Parcial Pago Movil' }
        );

        // Con 50% devuelto de un total post-descuento de $90 -> debe devolver $45.00 en Pago Móvil Bs (4500 Bs) y NO $50
        assert.equal(capturedRefundPayload.amount, 45.00, 'Debe prorratear el descuento de la factura ($50 - 10% = $45)');
        assert.equal(capturedRefundPayload.paymentMethods[0].method, 'pago_movil');
        assert.equal(capturedRefundPayload.paymentMethods[0].currency, 'VES');
        assert.equal(capturedRefundPayload.paymentMethods[0].amount, 4500);
        assert.equal(ncTx, fakeTx);
        assert.equal(accTx, fakeTx);
        assert.equal(capturedMovements[0].paymentMethodId, 'pago_movil');
        assert.equal(capturedMovements[0].currency, 'VES');
        assert.equal(capturedMovements[0].amount, 4500);

        // Verificar getShiftStats sobre esa venta y devolución: Cash USD NO debe quedar en -45
        models.Sale.findAll = async () => ([
            {
                id: 'sale-disc-pm',
                total: 90,
                subtotal: 100,
                tax: 0,
                igtfAmount: 0,
                exchangeRate: 100,
                status: 'partially_refunded',
                paymentMethod: 'pago_movil',
                paymentMethods: [{ method: 'pago_movil', currency: 'VES', amount: 9000, convertedAmountUsd: 90 }],
                SaleItems: []
            }
        ]);
        models.Refund.findAll = async () => ([
            {
                id: 'rf-1',
                saleId: 'sale-disc-pm',
                userId: 'admin-1',
                amount: 45,
                paymentMethods: [{ method: 'pago_movil', currency: 'VES', amount: 4500, convertedAmountUsd: 45 }],
                Sale: {
                    id: 'sale-disc-pm',
                    registerId: '1',
                    branchId: 'branch-1',
                    userId: 'admin-1',
                    paymentMethod: 'pago_movil',
                    paymentMethods: [{ method: 'pago_movil', currency: 'VES', amount: 9000, convertedAmountUsd: 90 }],
                    exchangeRate: 100
                }
            }
        ]);

        const shiftStats = await CashService.getShiftStats('admin-1', new Date(Date.now() - 3600000).toISOString(), 'default', '1', null, null, 'shift-ref-1');
        assert.equal(shiftStats.cashSalesTotal, 0, 'Devolución por Pago Móvil no debe restar Cash USD físico');
        assert.equal(shiftStats.paymentBreakdownNative?.cash || 0, 0, 'Cash USD nativo debe permanecer en 0');
        assert.equal(shiftStats.paymentBreakdownNative?.pago_movil, 4500, 'Pago Móvil VES neto debe ser Bs 9000 - Bs 4500 = Bs 4500');
        assert.equal(shiftStats.totalSalesAmount, 45, 'Total USD neto debe ser $90 - $45 = $45');

        // Escenario 2: Devolución mixta Fiado ($30) + Efectivo ($70)
        activeSaleItems = [
            { id: 'si-2', productId: 'p-1', name: 'Producto $50', price: 50, cost: 25, quantity: 2, subtotal: 100 }
        ];
        models.Sale.findOne = async () => ({
            id: 'sale-mix-fiado',
            companyId: 'default',
            branchId: 'branch-1',
            customerId: 'cust-1',
            subtotal: 100,
            discount: 0,
            promoDiscount: 0,
            tax: 0,
            igtfAmount: 0,
            total: 100,
            exchangeRate: 100,
            paymentMethod: 'mixed',
            paymentMethods: [
                { method: 'fiado', currency: 'USD', amount: 30 },
                { method: 'cash', currency: 'USD', amount: 70 }
            ],
            SaleItems: activeSaleItems,
            update: async () => ({})
        });
        models.Refund.findAll = async () => ([]);
        models.Customer.findOne = async () => ({
            id: 'cust-1',
            creditBalance: customerBalanceState,
            loyaltyPoints: 0,
            update: async (patch) => {
                if (patch.creditBalance !== undefined) customerBalanceState = patch.creditBalance;
            }
        });
        models.CreditHistory.create = async () => ({});

        await RefundService.processRefund(
            { id: 'admin-1', role: 'admin', companyId: 'default', name: 'Admin' },
            { saleId: 'sale-mix-fiado', items: [{ productId: 'p-1', quantity: 2 }], reason: 'Devolución total mixta' }
        );

        assert.equal(customerBalanceState, 0, 'Debe abonar los $30 del fiado pendiente al cliente primero');
        const fiadoMethod = capturedRefundPayload.paymentMethods.find(m => m.method === 'fiado');
        const cashMethod = capturedRefundPayload.paymentMethods.find(m => m.method === 'cash');
        assert.equal(fiadoMethod?.amount, 30);
        assert.equal(cashMethod?.amount, 70, 'El excedente ($70) después de saldar el fiado debe salir por caja/efectivo');
    } finally {
        models.sequelize.transaction = origTx;
        models.Branch.findOne = origBranchFindOne;
        models.Sale.findOne = origSaleFindOne;
        models.Sale.findAll = origSaleFindAll;
        models.SaleItem.findAll = origSaleItemFindAll;
        models.Refund.findAll = origRefundFindAll;
        models.Refund.create = origRefundCreate;
        models.Product.findOne = origProductFindOne;
        models.BranchStock.findOrCreate = origBranchStockFindOrCreate;
        models.StockMovement.create = origStockMovCreate;
        models.CashShift.findOne = origCashShiftFindOne;
        models.CashMovement.findAll = origCashMovFindAll;
        models.CashMovement.destroy = origCashMovDestroy;
        models.CashMovement.create = origCashMovCreate;
        models.Customer.findOne = origCustomerFindOne;
        models.CreditHistory.create = origCreditHistCreate;
        models.AuditLog.create = origAuditCreate;
        FiscalService.createCreditNoteInTransaction = origCreateCnInTx;
        AccountingEngineService.generateRefundEntry = origGenRefundEntry;
        OwnerNotificationService.notifySecurityAlert = origNotify;
    }
});

test('Bloque 1D — CashService.closeShiftBlind detecta descuadre digital en Zelle y exige supervisor aunque efectivo cuadre', async () => {
    const origTx = models.sequelize.transaction;
    const origShiftFindOne = models.CashShift.findOne;
    const origMovFindAll = models.CashMovement.findAll;
    const origMovCreate = models.CashMovement.create;
    const origDeclCreate = models.CashDeclaration.create;
    const origAlertCreate = models.Alert.create;
    const origApprovalFindOne = models.SupervisorApproval.findOne;
    const origApprovalUpdate = models.SupervisorApproval.update;
    const origGetStats = CashService.getShiftStats;
    const origGetProdSum = CashService.getShiftProductsSummary;
    const origAudit = CashService._logAudit;
    const origNotifyZ = OwnerNotificationService.notifyCashCloseZ;

    let capturedDecl = null;
    const fakeTx = { id: 'tx-mock-1d', LOCK: { UPDATE: 'UPDATE' }, afterCommit: () => {}, commit: async () => {}, rollback: async () => {} };

    try {
        models.sequelize.transaction = mockSequentialTransaction(fakeTx);
        models.Alert.create = async () => ({ id: 'al-1d', update: async () => ({}) });
        models.CashShift.findOne = async () => ({
            id: 'shift-blind-1',
            userId: 'cashier-1',
            userName: 'Cajero Test',
            companyId: 'default',
            registerId: '1',
            status: 'open',
            initialAmount: 0,
            initialBreakdown: {},
            openedAt: new Date(Date.now() - 3600000).toISOString(),
            update: async () => ({})
        });
        models.CashMovement.findAll = async () => ([]);
        models.CashMovement.create = async (m) => m;
        models.CashDeclaration.create = async (d) => {
            capturedDecl = d;
            return d;
        };
        CashService.getShiftStats = async () => ({
            totalSalesAmount: 50,
            cashSalesTotal: 0,
            salesCount: 1,
            paymentBreakdownNative: { zelle: 50 }
        });
        CashService.getShiftProductsSummary = async () => ([]);
        CashService._logAudit = async () => {};
        OwnerNotificationService.notifyCashCloseZ = () => {};

        // 1. Cajero declara Cash USD = 0 (cuadrado) pero Zelle = $10 cuando esperado Zelle = $50 -> diffZelle = -40 -> debe bloquear
        await assert.rejects(
            () => CashService.closeShiftBlind(
                { id: 'cashier-1', role: 'cajero', companyId: 'default', name: 'Cajero' },
                { shiftId: 'shift-blind-1', declaration: { usd: {}, zelle: 10, card: 0, mobile: 0, ves: 0 } }
            ),
            (err) => err.code === 'SUPERVISOR_AUTH_REQUIRED' && Math.abs(err.differences?.zelle + 40) < 0.01
        );

        // 2. Con autorización de supervisor válida sí procesa y registra [AUDIT: Zelle:-40.00...] + status 'mismatch'
        models.SupervisorApproval.findOne = async () => ({
            id: 'sup-app-cash-1',
            actionType: 'CASH_CLOSE_OVERRIDE',
            approvedBy: 'sup-1',
            used: false,
            metadata: { approverName: 'Supervisor Uno' }
        });
        models.SupervisorApproval.update = async () => ([1]);

        const res = await CashService.closeShiftBlind(
            { id: 'cashier-1', role: 'cajero', companyId: 'default', name: 'Cajero' },
            {
                shiftId: 'shift-blind-1',
                supervisorApprovalId: 'sup-app-cash-1',
                declaration: { usd: {}, zelle: 10, card: 0, mobile: 0, ves: 0 },
                notes: 'Faltante transferencia Zelle'
            }
        );

        assert.equal(res.status, 'mismatch');
        assert.ok(capturedDecl.notes.includes('[AUDIT: Zelle:-40.00|Card:0.00|MobileBs:0.00]'), 'CashDeclaration debe persistir rastro de descuadre digital');
    } finally {
        models.sequelize.transaction = origTx;
        models.CashShift.findOne = origShiftFindOne;
        models.CashMovement.findAll = origMovFindAll;
        models.CashMovement.create = origMovCreate;
        models.CashDeclaration.create = origDeclCreate;
        models.Alert.create = origAlertCreate;
        models.SupervisorApproval.findOne = origApprovalFindOne;
        models.SupervisorApproval.update = origApprovalUpdate;
        CashService.getShiftStats = origGetStats;
        CashService.getShiftProductsSummary = origGetProdSum;
        CashService._logAudit = origAudit;
        OwnerNotificationService.notifyCashCloseZ = origNotifyZ;
    }
});

test('Bloque 1E — ProductService.applySupplierMapping protege margin=0 accidental y bulkPriceAdjustment usa Markup sobre Costo', async () => {
    const origTx = models.sequelize.transaction;
    const origBranchFindOne = models.Branch.findOne;
    const origProdFindOne = models.Product.findOne;
    const origProdCreate = models.Product.create;
    const origProdFindAll = models.Product.findAll;
    const origBranchStockFindOrCreate = models.BranchStock.findOrCreate;
    const origStockMovCreate = models.StockMovement.create;
    const origMapFindOne = models.SupplierProductMapping.findOne;
    const origMapCreate = models.SupplierProductMapping.create;
    const origAuditCreate = models.AuditLog.create;

    const fakeTx = { LOCK: { UPDATE: 'UPDATE' }, commit: async () => {}, rollback: async () => {} };
    let createdProduct = null;

    try {
        models.sequelize.transaction = mockSequentialTransaction(fakeTx);
        models.Branch.findOne = async () => ({ id: 'branch-main', companyId: 'default' });
        models.Product.findOne = async () => null;
        models.Product.create = async (p) => {
            createdProduct = p;
            return p;
        };
        models.BranchStock.findOrCreate = async () => ([{ quantity: 0, update: async () => ({}) }, true]);
        models.StockMovement.create = async (m) => m;
        models.SupplierProductMapping.findOne = async () => null;
        models.SupplierProductMapping.create = async (m) => m;
        models.AuditLog.create = async () => ({});

        // 1. margin = 0 sin allowZeroMargin en nuevo producto NO debe poner PVP = costo ($10), sino aplicar 30% ($13)
        await ProductService.applySupplierMapping(
            { id: 'u-1', companyId: 'default' },
            [{ externalName: 'Harina Maíz', price: 10, quantity: 1, margin: 0, isNew: true }]
        );
        assert.equal(createdProduct.price, 13.00, 'margin=0 accidental no debe generar PVP igual al costo');
        assert.equal(createdProduct.margin, 30);

        // 2. margin = 0 con allowZeroMargin = true explícito sí permite PVP = costo
        await ProductService.applySupplierMapping(
            { id: 'u-1', companyId: 'default' },
            [{ externalName: 'Producto Promo 0%', price: 10, quantity: 1, margin: 0, allowZeroMargin: true, isNew: true }]
        );
        assert.equal(createdProduct.price, 10.00);
        assert.equal(createdProduct.margin, 0);

        // 3. margin negativo bloqueado
        await assert.rejects(
            () => ProductService.applySupplierMapping(
                { id: 'u-1', companyId: 'default' },
                [{ externalName: 'Producto Negativo', price: 10, quantity: 1, margin: -10, isNew: true }]
            ),
            /negativo/i
        );

        // 4. bulkPriceAdjustment con adjustmentType = 'margin' y target = 'category' aplica Markup ((cost) * 1.40)
        let capturedWhere = null;
        let bulkPatch = null;
        models.Product.findAll = async ({ where }) => {
            capturedWhere = where;
            return [{
                id: 'p-bebida-1',
                cost: 5.00,
                price: 6.00,
                margin: 20,
                update: async (patch) => {
                    bulkPatch = patch;
                    return patch;
                }
            }];
        };

        const count = await ProductService.bulkPriceAdjustment(
            { id: 'u-1', companyId: 'default' },
            { target: 'category', category: 'Bebidas', adjustmentType: 'margin', direction: 'increase', value: 40 }
        );

        assert.equal(count, 1);
        assert.equal(capturedWhere.category, 'Bebidas');
        assert.equal(bulkPatch.price, 7.00, 'Con costo $5 y markup 40%, precio debe ser $7.00');
        assert.equal(bulkPatch.margin, 40);
    } finally {
        models.sequelize.transaction = origTx;
        models.Branch.findOne = origBranchFindOne;
        models.Product.findOne = origProdFindOne;
        models.Product.create = origProdCreate;
        models.Product.findAll = origProdFindAll;
        models.BranchStock.findOrCreate = origBranchStockFindOrCreate;
        models.StockMovement.create = origStockMovCreate;
        models.SupplierProductMapping.findOne = origMapFindOne;
        models.SupplierProductMapping.create = origMapCreate;
        models.AuditLog.create = origAuditCreate;
    }
});

test('Bloque 1F — salesAnalytics y ReportService estandarizan Markup sobre Costo y descuentan descuentos globales', async () => {
    // 1. Validar processSalesAnalysis con descuento global y métodos de pago mixtos
    const analysis = processSalesAnalysis(
        [
            {
                id: 's-1',
                date: '2026-11-10T10:00:00.000Z',
                subtotal: 20,
                discount: 5,
                promoDiscount: 0,
                igtfAmount: 0,
                total: 15,
                exchangeRate: 100,
                paymentMethod: 'mixed',
                paymentMethods: [
                    { method: 'cash', currency: 'USD', amount: 10 },
                    { method: 'pago_movil', currency: 'VES', amount: 500 }
                ],
                SaleItems: [
                    { id: 'si-1', productId: 'p-1', name: 'Café Molido', category: 'Víveres', quantity: 1, price: 20, cost: 10 }
                ]
            }
        ],
        [],
        '2026-11-10T00:00:00.000Z'
    );

    assert.equal(analysis.summary.totalSales, 15, 'Debe descontar el descuento de $5 al ingreso bruto de $20');
    assert.equal(analysis.summary.grossProfit, 5, 'Utilidad neta debe ser $15 - $10 costo = $5');
    // Markup sobre Costo = (5 / 10) * 100 = 50% (antes daba 33.33% sobre venta)
    assert.equal(precision.round(analysis.summary.margin, 2), 50, 'El margen debe calcularse como Markup sobre Costo ((Utilidad/Costo)*100)');
    const cashPm = analysis.paymentMethods.find(p => p.method === 'cash');
    const pagoMovilPm = analysis.paymentMethods.find(p => p.method === 'pago_movil');
    const othersPm = analysis.paymentMethods.find(p => p.method === 'Otros');
    assert.equal(cashPm?.total, 10);
    assert.equal(pagoMovilPm?.total, 5);
    assert.equal(othersPm, undefined, 'No debe colapsar métodos mixtos en "Otros"');

    // 2. Validar ReportService.getCategoryInventoryValuation sin costo ficticio 70% y con Markup sobre Costo
    const origProductFindAll = models.Product.findAll;
    try {
        models.Product.findAll = async () => ([
            { category: 'Lácteos', valueAtCost: 100, valueAtPrice: 150, items: 5 },
            { category: 'SinCosto', valueAtCost: 0, valueAtPrice: 40, items: 1 }
        ]);
        const valuation = await ReportService.getCategoryInventoryValuation('default');
        assert.equal(valuation.summary.totalValueAtCost, 100);
        assert.equal(valuation.summary.totalValueAtPrice, 190);
        assert.equal(valuation.summary.potentialProfit, 90);
        // Markup = (190 - 100) / 100 * 100 = 90%
        assert.equal(valuation.summary.margin, 90, 'Valuación por categoría debe usar Markup sobre Costo');
    } finally {
        models.Product.findAll = origProductFindAll;
    }
});
