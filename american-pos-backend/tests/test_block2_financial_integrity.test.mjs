import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const models = require('../database/models');
const AccountingEngineService = require('../services/AccountingEngineService');
const SaleService = require('../services/SaleService');
const CashService = require('../services/CashService');
const RefundService = require('../services/RefundService');
const FiscalService = require('../services/FiscalService');
const OwnerNotificationService = require('../services/OwnerNotificationService');

after(async () => {
    try {
        await models.sequelize.close();
    } catch (_) {}
});

test('Bloque 2A — AccountingEngineService.generateSaleEntry cuadra Debe y Haber con IVA incluido, promoDiscount, IGTF y pago mixto sin crédito fantasma', async () => {
    const origFindAccount = AccountingEngineService.findAccountByCode;
    const origCreateEntry = AccountingEngineService.createEntry;

    let capturedEntryPayload = null;
    const mockAccounts = {
        '1.1.1.01.001': { id: 'acc-caja', code: '1.1.1.01.001', nature: 'DEBIT' },
        '1.1.1.02.001': { id: 'acc-banco', code: '1.1.1.02.001', nature: 'DEBIT' },
        '1.1.2.01.001': { id: 'acc-cxc', code: '1.1.2.01.001', nature: 'DEBIT' },
        '4.1.1.01.001': { id: 'acc-ventas', code: '4.1.1.01.001', nature: 'CREDIT' },
        '2.1.2.01.001': { id: 'acc-iva', code: '2.1.2.01.001', nature: 'CREDIT' },
        '2.1.2.04.001': { id: 'acc-igtf', code: '2.1.2.04.001', nature: 'CREDIT' },
        '4.1.2.01.001': { id: 'acc-desc', code: '4.1.2.01.001', nature: 'DEBIT' },
        '5.1.1.01.001': { id: 'acc-cmv', code: '5.1.1.01.001', nature: 'DEBIT' },
        '1.1.3.01.001': { id: 'acc-inv', code: '1.1.3.01.001', nature: 'DEBIT' }
    };

    try {
        AccountingEngineService.findAccountByCode = async (code) => mockAccounts[code] || null;
        AccountingEngineService.createEntry = async (payload) => {
            capturedEntryPayload = payload;
            const sumDebit = payload.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
            const sumCredit = payload.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
            const diff = Math.abs(sumDebit - sumCredit);
            assert.ok(diff <= 0.005, `El asiento debe cuadrar al centavo: Debe=${sumDebit} vs Haber=${sumCredit}`);
            return { id: 'je-test-1', entryNumber: 'AS-2026-00001', totalDebit: sumDebit, totalCredit: sumCredit };
        };

        // Caso: subtotal $100 (con IVA $13.79 incluido), descuento manual $5, promoDiscount $5, IGTF $1.35 -> total = 100 - 10 + 1.35 = $91.35
        // Pago mixto en efectivo ($45.00 USD) y punto de venta (Bs equivalentes a $46.36 USD con residuo de redondeo)
        const fakeTx = { id: 'tx-mock' };
        const entry = await AccountingEngineService.generateSaleEntry({
            id: 'SALE-TEST-001',
            invoiceNumber: '000123',
            subtotal: 100.00,
            tax: 13.79,
            discount: 5.00,
            promoDiscount: 5.00,
            igtfAmount: 1.35,
            total: 91.35,
            exchangeRate: 50,
            paymentStatus: 'paid',
            paymentMethods: [
                { method: 'cash_usd', currency: 'USD', amount: 45.00 },
                { method: 'punto_venta_bs', currency: 'VES', amount: 2318.00 } // 46.36 USD -> suma 91.36 (> 91.35 por $0.01)
            ],
            SaleItems: [
                { cost: 20, quantity: 2 }
            ]
        }, 'default', fakeTx);

        assert.ok(entry, 'generateSaleEntry debe retornar el asiento creado');
        assert.equal(capturedEntryPayload.transaction, fakeTx, 'Debe propagar la transacción recibida a createEntry');

        // Verificar que no se haya creado línea en CxC cuando no hubo fiado
        const cxcLine = capturedEntryPayload.lines.find(l => l.accountId === 'acc-cxc');
        assert.equal(cxcLine, undefined, 'No debe imputar centavos a CxC cuando la venta fue de contado');

        // Verificar descuento total ($5 manual + $5 promo = $10)
        const descLine = capturedEntryPayload.lines.find(l => l.accountId === 'acc-desc');
        assert.ok(descLine, 'Debe registrar línea de descuentos concedidos');
        assert.equal(descLine.debit, 10.00);

        // Verificar que el ingreso bruto sea neto de IVA ($13.79) e IGTF ($1.35): 91.35 + 10.00 - 13.79 - 1.35 = 86.21
        const ventasLine = capturedEntryPayload.lines.find(l => l.accountId === 'acc-ventas');
        assert.equal(ventasLine.credit, 86.21);
    } finally {
        AccountingEngineService.findAccountByCode = origFindAccount;
        AccountingEngineService.createEntry = origCreateEntry;
    }
});

test('Bloque 2B — SaleService.processSale bloquea price: 0 sin permiso, evita doble conteo de fiado y rechaza descuento > subtotal', async () => {
    const origSaleFindByPk = models.Sale.findByPk;
    const origCashShiftFindOne = models.CashShift.findOne;
    const origFindAllProducts = models.Product.findAll;
    const origFindAllPresentations = models.ProductPresentation.findAll;
    const origGetSettings = SaleService._getSettings;

    try {
        models.Sale.findByPk = async () => null;
        models.CashShift.findOne = async () => ({ id: 'shift-open-1', registerId: '1', status: 'open', allowedCategories: [] });
        models.ProductPresentation.findAll = async () => ([]);
        models.Product.findAll = async () => ([
            {
                id: 'prod-100',
                name: 'Producto Oficial $100',
                price: 100.00,
                cost: 50.00,
                category: 'General',
                isPublished: true
            }
        ]);
        SaleService._getSettings = async () => ({
            exchangeRate: 50,
            igtfEnabled: false,
            igtfRate: 3
        });

        const cashierWithoutPerms = {
            id: 'cashier-1',
            role: 'cajero',
            companyId: 'default',
            permissions: { canModifyPrices: false, canApplyDiscounts: false }
        };

        // 1. Intento de enviar price: 0 sin permiso
        await assert.rejects(
            () => SaleService.processSale(cashierWithoutPerms, {
                clientTransactionId: 'TX-ZERO-PRICE',
                items: [{ id: 'prod-100', productId: 'prod-100', name: 'Producto Oficial $100', price: 0, quantity: 1 }],
                total: 0,
                subtotal: 0,
                paymentMethods: [{ method: 'cash_usd', amount: 0, currency: 'USD' }]
            }),
            /INTEGRITY_ERROR: No tienes permiso para modificar el precio/
        );

        // 2. Intento de pagar $50 en fiado para una venta de $100 (antes pasaba por doble conteo de creditTotal)
        await assert.rejects(
            () => SaleService.processSale(cashierWithoutPerms, {
                clientTransactionId: 'TX-HALF-FIADO',
                customerId: 'cust-1',
                customerName: 'Cliente Crédito',
                items: [{ id: 'prod-100', productId: 'prod-100', name: 'Producto Oficial $100', price: 100, quantity: 1 }],
                total: 100,
                subtotal: 100,
                paymentMethods: [{ method: 'fiado', amount: 50, currency: 'USD' }]
            }),
            /FRAUDE_PAGO_INSUFICIENTE/
        );

        // 3. Intento de enviar descuento total mayor al subtotal
        const adminUser = { id: 'admin-1', role: 'superadmin', companyId: 'default', permissions: {} };
        await assert.rejects(
            () => SaleService.processSale(adminUser, {
                clientTransactionId: 'TX-EXCESS-DISCOUNT',
                items: [{ id: 'prod-100', productId: 'prod-100', name: 'Producto Oficial $100', price: 100, quantity: 1 }],
                discount: 60,
                promoDiscount: 50,
                total: 0,
                subtotal: 100,
                paymentMethods: [{ method: 'cash_usd', amount: 0, currency: 'USD' }]
            }),
            /El descuento total .* no puede superar el subtotal/
        );
    } finally {
        models.Sale.findByPk = origSaleFindByPk;
        models.CashShift.findOne = origCashShiftFindOne;
        models.Product.findAll = origFindAllProducts;
        models.ProductPresentation.findAll = origFindAllPresentations;
        SaleService._getSettings = origGetSettings;
    }
});

test('Bloque 2C — CashService.getCurrentShift no duplica la resta de devoluciones (Refund + CashMovement REFUND)', async () => {
    const origShiftFindOne = models.CashShift.findOne;
    const origSaleFindAll = models.Sale.findAll;
    const origRefundFindAll = models.Refund.findAll;

    try {
        const openedAtIso = new Date(Date.now() - 3600_000).toISOString();
        const fakeShift = {
            id: 'shift-1',
            userId: 'u-1',
            registerId: 'reg-1',
            companyId: 'default',
            status: 'open',
            openedAt: openedAtIso,
            initialAmount: 50,
            initialBreakdown: { cash: 50 },
            CashMovements: [
                {
                    id: 'mov-ref-1',
                    shiftId: 'shift-1',
                    type: 'out',
                    category: 'REFUND',
                    amount: 20,
                    currency: 'USD',
                    paymentMethodId: 'cash',
                    reason: 'Devolución Venta #sale-1'
                }
            ],
            changed: () => {},
            save: async () => {},
            toJSON() {
                return { ...this };
            }
        };

        models.CashShift.findOne = async () => fakeShift;
        models.Sale.findAll = async () => ([
            {
                id: 'sale-1',
                total: 100,
                exchangeRate: 50,
                paymentMethod: 'cash',
                paymentMethods: [{ method: 'cash', amount: 100, currency: 'USD' }]
            }
        ]);
        // Devolución de $20 registrada en Refund y también en CashMovements con category: 'REFUND'
        models.Refund.findAll = async () => ([
            {
                id: 'ref-1',
                saleId: 'sale-1',
                amount: 20,
                userId: 'u-1',
                status: 'completed',
                createdAt: new Date().toISOString(),
                Sale: { id: 'sale-1', registerId: 'reg-1', userId: 'u-1' },
                paymentMethods: [{ method: 'cash', amount: 20, currency: 'USD' }]
            }
        ]);

        const shiftSummary = await CashService.getCurrentShift('u-1', 'default', 'reg-1');

        // Apertura ($50) + Venta ($100) - Devolución única ($20) = $130 (antes daba $110 por doble deducción)
        assert.equal(shiftSummary.expectedBreakdown.cash, 130, 'El efectivo USD esperado debe descontar la devolución una sola vez ($130)');
    } finally {
        models.CashShift.findOne = origShiftFindOne;
        models.Sale.findAll = origSaleFindAll;
        models.Refund.findAll = origRefundFindAll;
    }
});

test('Bloque 2D — RefundService.processRefund usa el precio autoritativo de SaleItem y registra date en StockMovement', async () => {
    const origBranchFindOne = models.Branch.findOne;
    const origTransaction = models.sequelize.transaction;
    const origSaleFindOne = models.Sale.findOne;
    const origSaleItemFindAll = models.SaleItem.findAll;
    const origRefundFindAll = models.Refund.findAll;
    const origRefundCreate = models.Refund.create;
    const origProductFindOne = models.Product.findOne;
    const origBranchStockFindOrCreate = models.BranchStock.findOrCreate;
    const origStockMovementCreate = models.StockMovement.create;
    const origCashMovementDestroy = models.CashMovement.destroy;
    const origCashShiftFindOne = models.CashShift.findOne;
    const origAuditLogCreate = models.AuditLog.create;
    const origNotifySecurityAlert = OwnerNotificationService.notifySecurityAlert;
    const origCreateCreditNoteInTx = FiscalService.createCreditNoteInTransaction;
    const origGenerateRefundEntry = AccountingEngineService.generateRefundEntry;

    let createdRefundPayload = null;
    let createdMovementPayload = null;
    let creditNotePayload = null;
    let refundEntryPayload = null;

    try {
        models.Branch.findOne = async () => ({ id: 'branch-main', companyId: 'default', isMain: true });
        models.sequelize.transaction = async () => ({
            LOCK: { UPDATE: 'UPDATE' },
            commit: async () => {},
            rollback: async () => {}
        });
        models.Sale.findOne = async () => ({
            id: 'sale-orig-10',
            invoiceNumber: 'FAC-0010',
            total: 10,
            subtotal: 10,
            exchangeRate: 50,
            status: 'completed',
            update: async () => {}
        });
        models.SaleItem.findAll = async () => ([
            { id: 'si-1', productId: 'prod-10', name: 'Prod $10', price: 10, subtotal: 10, quantity: 1 }
        ]);
        models.Refund.findAll = async () => ([]);
        models.Refund.create = async (payload) => {
            createdRefundPayload = payload;
            return { id: payload.id, ...payload };
        };
        models.Product.findOne = async () => ({
            id: 'prod-10',
            name: 'Prod $10',
            category: 'General',
            stockQuantity: '5',
            stock: '5',
            status: 'active',
            update: async () => {}
        });
        models.BranchStock.findOrCreate = async () => ([{ increment: async () => {} }, false]);
        models.StockMovement.create = async (payload) => {
            createdMovementPayload = payload;
            return payload;
        };
        models.CashMovement.destroy = async () => 0;
        models.CashShift.findOne = async () => null;
        models.AuditLog.create = async () => ({});
        OwnerNotificationService.notifySecurityAlert = async () => {};
        FiscalService.createCreditNoteInTransaction = async (_cid, _uid, payload) => {
            creditNotePayload = payload;
            return { id: 'nc-test-1', creditNoteNumber: 'NC-000001', ...payload };
        };
        AccountingEngineService.generateRefundEntry = async (refundArg) => {
            refundEntryPayload = refundArg;
            return { id: 'je-ref-1', entryNumber: 'AS-2026-00002' };
        };

        const adminReqUser = {
            id: 'admin-1',
            role: 'superadmin',
            companyId: 'default',
            activeBranchId: 'branch-main',
            permissions: { canVoidSales: true }
        };

        // El cliente envía maliciosamente price: 999 para un producto que se vendió en $10
        await RefundService.processRefund(adminReqUser, {
            saleId: 'sale-orig-10',
            reason: 'Prueba devolución segura',
            items: [{ id: 'si-1', productId: 'prod-10', name: 'Prod $10', price: 999, quantity: 1 }],
            paymentMethods: [{ method: 'cash_usd', amount: 10, currency: 'USD' }]
        });

        assert.ok(createdRefundPayload, 'Debe haber creado el registro Refund');
        assert.equal(createdRefundPayload.amount, 10, 'El monto reembolsado debe ser $10 (precio original), ignorando los $999 del cliente');
        assert.ok(createdMovementPayload?.date, 'StockMovement debe incluir la columna obligatoria date');
        assert.equal(creditNotePayload?.totalAmount, 10, 'Debe emitir Nota de Crédito por $10 dentro de la transacción');
        assert.equal(refundEntryPayload?.amount, 10, 'Debe generar asiento contable síncrono de devolución por $10');
    } finally {
        models.Branch.findOne = origBranchFindOne;
        models.sequelize.transaction = origTransaction;
        models.Sale.findOne = origSaleFindOne;
        models.SaleItem.findAll = origSaleItemFindAll;
        models.Refund.findAll = origRefundFindAll;
        models.Refund.create = origRefundCreate;
        models.Product.findOne = origProductFindOne;
        models.BranchStock.findOrCreate = origBranchStockFindOrCreate;
        models.StockMovement.create = origStockMovementCreate;
        models.CashMovement.destroy = origCashMovementDestroy;
        models.CashShift.findOne = origCashShiftFindOne;
        models.AuditLog.create = origAuditLogCreate;
        OwnerNotificationService.notifySecurityAlert = origNotifySecurityAlert;
        FiscalService.createCreditNoteInTransaction = origCreateCreditNoteInTx;
        AccountingEngineService.generateRefundEntry = origGenerateRefundEntry;
    }
});

test('Bloque 2E — FiscalService.getSalesBook convierte ventas en USD sin campo currency a VES y separa base imponible neta del IVA', async () => {
    const origFiscalFindAll = models.FiscalBookRecord.findAll;
    const origSaleFindAll = models.Sale.findAll;
    const origCreditNoteFindAll = models.CreditNote.findAll;

    try {
        models.FiscalBookRecord.findAll = async () => ([]);
        models.CreditNote.findAll = async () => ([]);
        // Venta en USD (como se guarda en la tabla Sales, donde sale.currency es undefined)
        // Subtotal $116 (incluye $16 de IVA), tasa 50 Bs/USD -> Total Bs = 5800, IVA Bs = 800, Base Imponible Bs = 5000
        models.Sale.findAll = async () => ([
            {
                id: 'sale-fiscal-1',
                date: '2026-11-10T12:00:00.000Z',
                total: 116,
                subtotal: 116,
                tax: 16,
                igtfAmount: 0,
                exchangeRate: 50,
                customerRif: 'V-12345678',
                customerName: 'Cliente Fiscal'
            }
        ]);

        const book = await FiscalService.getSalesBook('default', 2026, 11);
        assert.equal(book.records.length, 1);
        const row = book.records[0];
        assert.equal(row.totalAmount, 5800, 'Total en Libro de Ventas debe convertirse a VES (116 * 50 = 5800)');
        assert.equal(row.taxAmount, 800, 'Débito Fiscal en Libro de Ventas debe convertirse a VES (16 * 50 = 800)');
        assert.equal(row.taxableBase, 5000, 'Base imponible neta debe ser subtotalVes - taxVes (5800 - 800 = 5000)');
    } finally {
        models.FiscalBookRecord.findAll = origFiscalFindAll;
        models.Sale.findAll = origSaleFindAll;
        models.CreditNote.findAll = origCreditNoteFindAll;
    }
});
