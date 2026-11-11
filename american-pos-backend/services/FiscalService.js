const { Op } = require('sequelize');
const { 
    Sale, SaleItem, Customer, Product, StockMovement, 
    CreditHistory, PurchaseOrder, Expense, FiscalBookRecord, 
    TaxRetention, CreditNote, FiscalSequence 
} = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');

class FiscalService {

    /**
     * Get or Auto-Sync Sales Book for a given Month and Year
     */
    async getSalesBook(companyId, periodYear, periodMonth) {
        const year = parseInt(periodYear);
        const month = parseInt(periodMonth);

        // Format start and end date for month (e.g. 2026-09-01 to 2026-09-30)
        const padMonth = month.toString().padStart(2, '0');
        const startDate = `${year}-${padMonth}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${padMonth}-${lastDay.toString().padStart(2, '0')}`;

        // 1. Fetch any manual or existing FiscalBookRecord entries
        const existingRecords = await FiscalBookRecord.findAll({
            where: {
                companyId,
                bookType: 'VENTAS',
                periodYear: year,
                periodMonth: month
            },
            order: [['recordDate', 'ASC'], ['documentNumber', 'ASC']]
        });

        // 2. Also fetch Sales in period that might not yet be in FiscalBookRecord
        const sales = await Sale.findAll({
            where: {
                companyId,
                status: { [Op.ne]: 'cancelled' },
                [Op.or]: [
                    { date: { [Op.between]: [startDate, endDate] } },
                    { timestamp: { [Op.between]: [startDate, `${endDate}T23:59:59`] } }
                ]
            },
            order: [['date', 'ASC']]
        });

        // 3. Fetch Credit Notes in period
        const creditNotes = await CreditNote.findAll({
            where: {
                companyId,
                status: 'APLICADA',
                date: { [Op.between]: [startDate, endDate] }
            },
            order: [['date', 'ASC']]
        });

        // Combine and map into SENIAT standardized tabular format
        const existingSaleIds = new Set(existingRecords.filter(r => r.saleId).map(r => r.saleId));
        const existingNcIds = new Set(existingRecords.filter(r => r.creditNoteId).map(r => r.creditNoteId));

        const rows = [...existingRecords.map(r => r.toJSON())];

        // Merge sales not yet in FiscalBookRecord
        for (const sale of sales) {
            if (existingSaleIds.has(sale.id)) continue;

            const rate = Number(sale.exchangeRate) || 1.0;
            const totalVes = Number(sale.total) * (sale.currency === 'USD' ? rate : 1.0);
            const subtotalVes = Number(sale.subtotal || sale.total) * (sale.currency === 'USD' ? rate : 1.0);
            const taxVes = Number(sale.tax || 0) * (sale.currency === 'USD' ? rate : 1.0);
            const igtfVes = Number(sale.igtfAmount || 0) * (sale.currency === 'USD' ? rate : 1.0);
            const isExempt = taxVes === 0;

            rows.push({
                id: `sale-${sale.id}`,
                companyId,
                bookType: 'VENTAS',
                recordDate: (sale.date || sale.timestamp || startDate).split('T')[0],
                documentType: 'FACTURA',
                documentNumber: sale.id.length > 8 ? sale.id.slice(-8).toUpperCase() : sale.id,
                controlNumber: `00-${sale.id.slice(-6).toUpperCase()}`,
                entityRif: sale.customerRif || 'V-00000000',
                entityName: sale.customerName || 'Consumidor Final',
                affectedInvoiceNumber: '',
                totalAmount: totalVes,
                exemptAmount: isExempt ? totalVes : 0,
                taxableBase: isExempt ? 0 : subtotalVes,
                taxRate: isExempt ? 0 : 16.00,
                taxAmount: taxVes,
                retainedIvaAmount: 0,
                igtfAmount: igtfVes,
                currency: 'VES',
                exchangeRate: rate,
                periodYear: year,
                periodMonth: month,
                saleId: sale.id
            });
        }

        // Merge credit notes
        for (const nc of creditNotes) {
            if (existingNcIds.has(nc.id)) continue;

            const rate = Number(nc.exchangeRate) || 1.0;
            const totalVes = -Math.abs(Number(nc.totalAmount) * (nc.currency === 'USD' ? rate : 1.0));
            const subtotalVes = -Math.abs(Number(nc.subtotal || nc.totalAmount) * (nc.currency === 'USD' ? rate : 1.0));
            const taxVes = -Math.abs(Number(nc.taxAmount || 0) * (nc.currency === 'USD' ? rate : 1.0));

            rows.push({
                id: `nc-${nc.id}`,
                companyId,
                bookType: 'VENTAS',
                recordDate: nc.date,
                documentType: 'NOTA_CREDITO',
                documentNumber: nc.creditNoteNumber,
                controlNumber: nc.controlNumber || `NC-${nc.id.slice(-6)}`,
                entityRif: nc.customerRif || 'V-00000000',
                entityName: nc.customerName || 'Cliente',
                affectedInvoiceNumber: nc.affectedInvoiceNumber || 'S/F',
                totalAmount: totalVes,
                exemptAmount: 0,
                taxableBase: subtotalVes,
                taxRate: 16.00,
                taxAmount: taxVes,
                retainedIvaAmount: 0,
                igtfAmount: 0,
                currency: 'VES',
                exchangeRate: rate,
                periodYear: year,
                periodMonth: month,
                creditNoteId: nc.id
            });
        }

        // Sort chronologically
        rows.sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate));

        // Calculate Totals
        const totals = rows.reduce((acc, r) => {
            acc.totalVentas += Number(r.totalAmount) || 0;
            acc.totalExento += Number(r.exemptAmount) || 0;
            acc.totalBaseImponible += Number(r.taxableBase) || 0;
            acc.totalDebitoFiscal += Number(r.taxAmount) || 0;
            acc.totalIgtf += Number(r.igtfAmount) || 0;
            acc.totalIvaRetenido += Number(r.retainedIvaAmount) || 0;
            return acc;
        }, {
            totalVentas: 0,
            totalExento: 0,
            totalBaseImponible: 0,
            totalDebitoFiscal: 0,
            totalIgtf: 0,
            totalIvaRetenido: 0
        });

        return {
            periodYear: year,
            periodMonth: month,
            records: rows,
            totals,
            count: rows.length
        };
    }

    /**
     * Get or Auto-Sync Purchases Book for a given Month and Year
     */
    async getPurchasesBook(companyId, periodYear, periodMonth) {
        const year = parseInt(periodYear);
        const month = parseInt(periodMonth);

        const padMonth = month.toString().padStart(2, '0');
        const startDate = `${year}-${padMonth}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${padMonth}-${lastDay.toString().padStart(2, '0')}`;

        // 1. Existing manual fiscal records for purchases
        const existingRecords = await FiscalBookRecord.findAll({
            where: {
                companyId,
                bookType: 'COMPRAS',
                periodYear: year,
                periodMonth: month
            },
            order: [['recordDate', 'ASC']]
        });

        // 2. Fetch completed Purchase Orders in period
        const purchases = await PurchaseOrder.findAll({
            where: {
                companyId,
                status: { [Op.in]: ['received', 'completed', 'paid'] },
                date: { [Op.between]: [startDate, endDate] }
            },
            order: [['date', 'ASC']]
        });

        // 3. Fetch operational Expenses in period
        const expenses = await Expense.findAll({
            where: {
                companyId,
                date: { [Op.between]: [startDate, endDate] }
            },
            order: [['date', 'ASC']]
        });

        const existingPoIds = new Set(existingRecords.filter(r => r.purchaseOrderId).map(r => r.purchaseOrderId));
        const rows = [...existingRecords.map(r => r.toJSON())];

        // Merge purchase orders
        for (const po of purchases) {
            if (existingPoIds.has(po.id)) continue;

            const rate = Number(po.exchangeRate) || 1.0;
            const totalVes = Number(po.totalVes) || (Number(po.total) * rate);
            const baseImponible = totalVes / 1.16; // Standard 16% estimation if not broken down
            const taxVes = totalVes - baseImponible;

            rows.push({
                id: `po-${po.id}`,
                companyId,
                bookType: 'COMPRAS',
                recordDate: po.date,
                documentType: 'FACTURA',
                documentNumber: po.referenceNumber || `OC-${po.id.slice(-6)}`,
                controlNumber: `00-${po.id.slice(-6)}`,
                entityRif: 'J-00000000-0',
                entityName: `Proveedor Orden #${po.id.slice(-4)}`,
                affectedInvoiceNumber: '',
                totalAmount: totalVes,
                exemptAmount: 0,
                taxableBase: baseImponible,
                taxRate: 16.00,
                taxAmount: taxVes,
                retainedIvaAmount: taxVes * 0.75, // 75% retention default
                igtfAmount: 0,
                currency: 'VES',
                exchangeRate: rate,
                periodYear: year,
                periodMonth: month,
                purchaseOrderId: po.id
            });
        }

        // Sort chronologically
        rows.sort((a, b) => new Date(a.recordDate) - new Date(b.recordDate));

        const totals = rows.reduce((acc, r) => {
            acc.totalCompras += Number(r.totalAmount) || 0;
            acc.totalExento += Number(r.exemptAmount) || 0;
            acc.totalBaseImponible += Number(r.taxableBase) || 0;
            acc.totalCreditoFiscal += Number(r.taxAmount) || 0;
            acc.totalIvaRetenido += Number(r.retainedIvaAmount) || 0;
            return acc;
        }, {
            totalCompras: 0,
            totalExento: 0,
            totalBaseImponible: 0,
            totalCreditoFiscal: 0,
            totalIvaRetenido: 0
        });

        return {
            periodYear: year,
            periodMonth: month,
            records: rows,
            totals,
            count: rows.length
        };
    }

    /**
     * Get Net Tax Summary (Débito Fiscal vs Crédito Fiscal vs IGTF)
     */
    async getTaxSummary(companyId, periodYear, periodMonth) {
        const salesData = await this.getSalesBook(companyId, periodYear, periodMonth);
        const purchasesData = await this.getPurchasesBook(companyId, periodYear, periodMonth);

        const debitoFiscal = salesData.totals.totalDebitoFiscal;
        const creditoFiscal = purchasesData.totals.totalCreditoFiscal;
        const balanceIva = debitoFiscal - creditoFiscal; // Positivo = Por pagar, Negativo = Saldo a favor

        const igtfPorEnterar = salesData.totals.totalIgtf;
        const retencionesIvaRecibidas = salesData.totals.totalIvaRetenido;
        const retencionesIvaEfectuadas = purchasesData.totals.totalIvaRetenido;

        return {
            periodYear: parseInt(periodYear),
            periodMonth: parseInt(periodMonth),
            debitoFiscal,
            creditoFiscal,
            balanceIva,
            impuestoPorPagarIva: balanceIva > 0 ? balanceIva : 0,
            saldoAFavorIva: balanceIva < 0 ? Math.abs(balanceIva) : 0,
            igtfPorEnterar,
            retencionesIvaRecibidas,
            retencionesIvaEfectuadas,
            ventasTotales: salesData.totals.totalVentas,
            comprasTotales: purchasesData.totals.totalCompras
        };
    }

    /**
     * Issue a Credit Note and process inventory & accounting effects
     */
    async issueCreditNote(companyId, userId, data) {
        const {
            saleId,
            affectedInvoiceNumber,
            customerId,
            customerName,
            customerRif,
            subtotal,
            taxAmount,
            exemptAmount = 0,
            totalAmount,
            currency = 'VES',
            exchangeRate = 1.0,
            reason = 'DEVOLUCION_MERCANCIA',
            reenterStock = true,
            items = [],
            date,
            notes = ''
        } = data;

        const creditNoteId = generateRobustId();
        const txDate = date || new Date().toISOString().split('T')[0];

        const branchId = data.branchId || null;

        return await sequelize.transaction(async (t) => {
            // 1. Obtener o inicializar la fila de secuencia fiscal con bloqueo pesimista (FOR UPDATE)
            let seq = await FiscalSequence.findOne({
                where: {
                    companyId,
                    branchId: branchId || null,
                    documentType: 'CREDIT_NOTE'
                },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (!seq) {
                // Si la tabla no tiene secuencia aún, calcular base inicial según registros previos
                const existingCount = await CreditNote.count({ where: { companyId }, transaction: t });
                seq = await FiscalSequence.create({
                    id: generateRobustId(),
                    companyId,
                    branchId: branchId || null,
                    documentType: 'CREDIT_NOTE',
                    prefix: 'NC-',
                    lastNumber: existingCount,
                    lastControlNumber: existingCount
                }, { transaction: t });
            }

            // 2. Incrementar de manera atómica y formatear correlativos
            const nextNumber = Number(seq.lastNumber) + 1;
            const nextControl = Number(seq.lastControlNumber) + 1;

            const ncNumber = `${seq.prefix || 'NC-'}${String(nextNumber).padStart(6, '0')}`;
            const controlNumber = `00-${String(nextControl).padStart(6, '0')}`;

            // 3. Actualizar la secuencia dentro de la transacción
            await seq.update({
                lastNumber: nextNumber,
                lastControlNumber: nextControl
            }, { transaction: t });

            // 4. Create CreditNote Record asegurando consecutividad
            const creditNote = await CreditNote.create({
                id: creditNoteId,
                companyId,
                creditNoteNumber: ncNumber,
                controlNumber,
                saleId: saleId || null,
                affectedInvoiceNumber: affectedInvoiceNumber || 'S/F',
                customerId: customerId || null,
                customerName: customerName || 'Cliente',
                customerRif: customerRif || 'V-00000000',
                subtotal: Number(subtotal) || 0,
                taxAmount: Number(taxAmount) || 0,
                exemptAmount: Number(exemptAmount) || 0,
                totalAmount: Number(totalAmount) || 0,
                currency,
                exchangeRate: Number(exchangeRate) || 1.0,
                reason,
                reenterStock,
                items,
                status: 'APLICADA',
                date: txDate,
                userId,
                notes
            }, { transaction: t });

            // 2. Re-enter returned items to Inventory (if requested)
            if (reenterStock && Array.isArray(items)) {
                for (const item of items) {
                    if (!item.productId) continue;
                    const qty = Number(item.quantity) || 0;
                    if (qty <= 0) continue;

                    const product = await Product.findOne({ where: { id: item.productId, companyId }, transaction: t });
                    if (product) {
                        const newStock = (Number(product.stockQuantity) || 0) + qty;
                        await product.update({ stockQuantity: newStock }, { transaction: t });

                        await StockMovement.create({
                            id: generateRobustId(),
                            productId: product.id,
                            companyId,
                            userId,
                            type: 'IN',
                            quantity: qty,
                            stockBefore: product.stockQuantity,
                            stockAfter: newStock,
                            previousStock: product.stockQuantity,
                            newStock,
                            reason: `Devolución por Nota de Crédito ${ncNumber}`,
                            date: txDate,
                            timestamp: new Date().toISOString()
                        }, { transaction: t });
                    }
                }
            }

            // 3. If customer owes credit, deduct from Customer debt
            if (customerId) {
                const customer = await Customer.findOne({ where: { id: customerId, companyId }, transaction: t });
                const currentBalance = customer ? Number(customer.creditBalance !== undefined ? customer.creditBalance : customer.currentDebt) || 0 : 0;
                if (customer && currentBalance > 0) {
                    const deductAmountUsd = currency === 'USD' ? Number(totalAmount) : (Number(totalAmount) / (Number(exchangeRate) || 1.0));
                    const newDebt = Math.max(0, currentBalance - deductAmountUsd);
                    await customer.update({ creditBalance: newDebt, currentDebt: newDebt }, { transaction: t });

                    await CreditHistory.create({
                        id: generateRobustId(),
                        customerId: customer.id,
                        companyId,
                        userId,
                        type: 'PAYMENT',
                        amount: deductAmountUsd,
                        balanceAfter: newDebt,
                        previousDebt: currentBalance,
                        newDebt,
                        description: `Ajuste por Nota de Crédito ${ncNumber}`,
                        notes: `Ajuste por Nota de Crédito ${ncNumber}`,
                        date: txDate,
                        timestamp: new Date().toISOString()
                    }, { transaction: t });
                }
            }

            // 4. Create record in FiscalBookRecord (Sales Book)
            const d = new Date(txDate);
            const rate = Number(exchangeRate) || 1.0;
            const totalVes = -Math.abs(Number(totalAmount) * (currency === 'USD' ? rate : 1.0));
            const subtotalVes = -Math.abs(Number(subtotal) * (currency === 'USD' ? rate : 1.0));
            const taxVes = -Math.abs(Number(taxAmount) * (currency === 'USD' ? rate : 1.0));

            await FiscalBookRecord.create({
                id: generateRobustId(),
                companyId,
                bookType: 'VENTAS',
                recordDate: txDate,
                documentType: 'NOTA_CREDITO',
                documentNumber: ncNumber,
                controlNumber,
                entityRif: customerRif || 'V-00000000',
                entityName: customerName || 'Cliente',
                affectedInvoiceNumber: affectedInvoiceNumber || 'S/F',
                totalAmount: totalVes,
                exemptAmount: 0,
                taxableBase: subtotalVes,
                taxRate: 16.00,
                taxAmount: taxVes,
                retainedIvaAmount: 0,
                igtfAmount: 0,
                currency: 'VES',
                exchangeRate: rate,
                periodYear: d.getFullYear(),
                periodMonth: d.getMonth() + 1,
                creditNoteId: creditNote.id,
                saleId: saleId || null,
                userId,
                notes
            }, { transaction: t });

            return creditNote;
        });
    }

    /**
     * Create Tax Retention Voucher (IVA 75%, IVA 100% or ISLR)
     */
    async createTaxRetention(companyId, userId, data) {
        const {
            retentionType,
            retentionCategory = 'EMITIDA_A_PROVEEDOR',
            periodYear,
            periodMonth,
            entityRif,
            entityName,
            invoiceNumber,
            controlNumber = '',
            invoiceDate = '',
            invoiceTotalAmount = 0,
            baseAmount = 0,
            taxAmount = 0,
            retentionPercentage = 75.0,
            retainedAmount,
            currency = 'VES',
            exchangeRate = 1.0,
            notes = '',
            date
        } = data;

        const txDate = date || new Date().toISOString().split('T')[0];
        const year = parseInt(periodYear) || new Date(txDate).getFullYear();
        const month = parseInt(periodMonth) || (new Date(txDate).getMonth() + 1);

        return await sequelize.transaction(async (t) => {
            // Bloquear la última retención emitida del periodo para garantizar correlativo SENIAT atómico sin colisiones
            const lastRet = await TaxRetention.findOne({
                where: { companyId, periodYear: year, periodMonth: month },
                order: [['voucherNumber', 'DESC']],
                transaction: t,
                lock: t.LOCK ? t.LOCK.UPDATE : undefined
            });
            let nextSeq = 1;
            if (lastRet && lastRet.voucherNumber && lastRet.voucherNumber.length >= 14) {
                const lastSeq = parseInt(lastRet.voucherNumber.slice(-8), 10);
                if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
            } else {
                const count = await TaxRetention.count({ where: { companyId, periodYear: year, periodMonth: month }, transaction: t });
                nextSeq = count + 1;
            }
            const voucherNumber = `${year}${month.toString().padStart(2, '0')}${nextSeq.toString().padStart(8, '0')}`;

            const retention = await TaxRetention.create({
                id: generateRobustId(),
                companyId,
                retentionType,
                retentionCategory,
                voucherNumber,
                periodYear: year,
                periodMonth: month,
                recordDate: txDate,
                entityRif,
                entityName,
                invoiceNumber,
                controlNumber,
                invoiceDate,
                invoiceTotalAmount: Number(invoiceTotalAmount) || 0,
                baseAmount: Number(baseAmount) || 0,
                taxAmount: Number(taxAmount) || 0,
                retentionPercentage: Number(retentionPercentage) || 75.0,
                retainedAmount: Number(retainedAmount) || 0,
                currency,
                exchangeRate: Number(exchangeRate) || 1.0,
                status: 'EMITIDO',
                userId,
                notes
            }, { transaction: t });

            return retention;
        });
    }

    /**
     * Generación de Nota de Crédito con reserva atómica de correlativos protegida por fila
     */
    static async generateCreditNote({ companyId, branchId = null, saleId, items = [], reason = 'DEVOLUCION_MERCANCIA', user, date = null, ...rest }) {
        const instance = new FiscalService();
        return await instance.issueCreditNote(companyId, user?.id || rest.userId, {
            companyId,
            branchId,
            saleId,
            items,
            reason,
            date: date || new Date().toISOString().split('T')[0],
            ...rest
        });
    }
}

module.exports = new FiscalService();
