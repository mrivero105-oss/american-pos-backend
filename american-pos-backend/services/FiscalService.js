const { Op } = require('sequelize');
const { 
    Sale, SaleItem, Customer, Product, StockMovement, 
    CreditHistory, PurchaseOrder, Supplier, FiscalBookRecord, 
    TaxRetention, CreditNote, FiscalSequence, BranchStock, Branch 
} = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const precision = require('../utils/precision');

class FiscalService {

    /**
     * Get or Auto-Sync Sales Book for a given Month and Year
     */
    async getSalesBook(companyId, periodYear, periodMonth) {
        const year = parseInt(periodYear);
        const month = parseInt(periodMonth);

        // Format start and exclusive next-month boundary [startDate, nextStartDate) para incluir el último día incluso si date trae hora ISO
        const padMonth = month.toString().padStart(2, '0');
        const startDate = `${year}-${padMonth}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${padMonth}-${lastDay.toString().padStart(2, '0')}`;
        const nextMonthYear = month === 12 ? year + 1 : year;
        const nextMonthNum = month === 12 ? 1 : month + 1;
        const nextStartDate = `${nextMonthYear}-${nextMonthNum.toString().padStart(2, '0')}-01`;

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
                    { date: { [Op.gte]: startDate, [Op.lt]: nextStartDate } },
                    { timestamp: { [Op.between]: [startDate, `${endDate}T23:59:59.999Z`] } }
                ]
            },
            order: [['date', 'ASC']]
        });

        // 3. Fetch Credit Notes in period
        const creditNotes = await CreditNote.findAll({
            where: {
                companyId,
                status: 'APLICADA',
                date: { [Op.gte]: startDate, [Op.lt]: nextStartDate }
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

            const rate = Number(sale.exchangeRate) > 0 ? Number(sale.exchangeRate) : 1.0;
            const saleCurrency = String(sale.currency || 'USD').toUpperCase();
            const factorVes = (saleCurrency === 'VES' || saleCurrency === 'BS') ? 1.0 : rate;
            const totalVes = precision.round(precision.multiply(Number(sale.total) || 0, factorVes), 2);
            const taxVes = precision.round(precision.multiply(Number(sale.tax) || 0, factorVes), 2);
            const igtfVes = precision.round(precision.multiply(Number(sale.igtfAmount) || 0, factorVes), 2);

            const totalDiscountUsd = precision.add([Number(sale.discount) || 0, Number(sale.promoDiscount) || 0]);
            const netBilledNoIgtfVes = (totalDiscountUsd > 0 && Number(sale.total) > 0)
                ? Math.max(0, precision.round(precision.subtract(totalVes, igtfVes), 2))
                : precision.round(precision.multiply(Number(sale.subtotal || sale.total) || 0, factorVes), 2);

            const isExempt = taxVes <= 0;
            let netTaxableBaseVes = 0;
            let exemptAmountVes = 0;
            if (isExempt) {
                exemptAmountVes = netBilledNoIgtfVes;
            } else {
                const maxPossibleTaxable = Math.max(0, precision.round(precision.subtract(netBilledNoIgtfVes, taxVes), 2));
                const estimatedTaxableAt16 = precision.round(precision.divide(taxVes, 0.16), 2);
                netTaxableBaseVes = (estimatedTaxableAt16 > 0 && estimatedTaxableAt16 < maxPossibleTaxable - 0.05)
                    ? estimatedTaxableAt16
                    : maxPossibleTaxable;
                exemptAmountVes = Math.max(0, precision.round(precision.subtract(maxPossibleTaxable, netTaxableBaseVes), 2));
            }

            const rawSaleDate = sale.date instanceof Date
                ? sale.date.toISOString()
                : String(sale.date || sale.timestamp || startDate);
            const docNumber = sale.invoiceNumber || sale.documentNumber || (sale.id.length > 8 ? sale.id.slice(-8).toUpperCase() : sale.id);
            const ctrlNumber = sale.controlNumber || sale.taxInfo?.controlNumber || `00-${String(docNumber).replace(/[^0-9A-Za-z-]/g, '').slice(-8) || sale.id.slice(-6).toUpperCase()}`;

            rows.push({
                id: `sale-${sale.id}`,
                companyId,
                bookType: 'VENTAS',
                recordDate: rawSaleDate.split('T')[0],
                documentType: 'FACTURA',
                documentNumber: docNumber,
                controlNumber: ctrlNumber,
                entityRif: sale.customerRif || 'V-00000000',
                entityName: sale.customerName || 'Consumidor Final',
                affectedInvoiceNumber: '',
                totalAmount: totalVes,
                exemptAmount: exemptAmountVes,
                taxableBase: netTaxableBaseVes,
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

            const rate = Number(nc.exchangeRate) > 0 ? Number(nc.exchangeRate) : 1.0;
            const factorNcVes = String(nc.currency || 'VES').toUpperCase() === 'USD' ? rate : 1.0;
            const totalVes = -Math.abs(precision.round(precision.multiply(Number(nc.totalAmount) || 0, factorNcVes), 2));
            const taxVes = -Math.abs(precision.round(precision.multiply(Number(nc.taxAmount) || 0, factorNcVes), 2));
            const hasTax = Math.abs(taxVes) > 0;
            const subtotalVes = -Math.abs(precision.round(precision.multiply(Number(nc.subtotal) || 0, factorNcVes), 2));
            const exemptRaw = Number(nc.exemptAmount) > 0
                ? Number(nc.exemptAmount)
                : (!hasTax && Number(nc.subtotal || 0) === 0 ? (Number(nc.totalAmount) || 0) : 0);
            const exemptVes = -Math.abs(precision.round(precision.multiply(exemptRaw, factorNcVes), 2));

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
                exemptAmount: exemptVes,
                taxableBase: subtotalVes,
                taxRate: hasTax ? 16.00 : 0,
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
            acc.totalVentas = precision.round(precision.add([acc.totalVentas, Number(r.totalAmount) || 0]), 2);
            acc.totalExento = precision.round(precision.add([acc.totalExento, Number(r.exemptAmount) || 0]), 2);
            acc.totalBaseImponible = precision.round(precision.add([acc.totalBaseImponible, Number(r.taxableBase) || 0]), 2);
            acc.totalDebitoFiscal = precision.round(precision.add([acc.totalDebitoFiscal, Number(r.taxAmount) || 0]), 2);
            acc.totalIgtf = precision.round(precision.add([acc.totalIgtf, Number(r.igtfAmount) || 0]), 2);
            acc.totalIvaRetenido = precision.round(precision.add([acc.totalIvaRetenido, Number(r.retainedIvaAmount) || 0]), 2);
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
        const nextMonthYear = month === 12 ? year + 1 : year;
        const nextMonthNum = month === 12 ? 1 : month + 1;
        const nextStartDate = `${nextMonthYear}-${nextMonthNum.toString().padStart(2, '0')}-01`;

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

        // 2. Fetch completed Purchase Orders and Suppliers in period [startDate, nextStartDate)
        const purchases = await PurchaseOrder.findAll({
            where: {
                companyId,
                status: { [Op.in]: ['received', 'completed', 'paid'] },
                date: { [Op.gte]: startDate, [Op.lt]: nextStartDate }
            },
            order: [['date', 'ASC']]
        });

        const supplierIds = [...new Set(purchases.map(po => po.supplierId).filter(Boolean).map(String))];
        const suppliers = supplierIds.length > 0
            ? await Supplier.findAll({ where: { id: { [Op.in]: supplierIds }, companyId }, raw: true })
            : [];
        const supplierMap = new Map(suppliers.map(s => [String(s.id), s]));

        // 3. Fetch real issued VAT/ISLR retentions for the period (no 75% inventado)
        const periodRetentions = await TaxRetention.findAll({
            where: {
                companyId,
                periodYear: year,
                periodMonth: month,
                retentionCategory: 'EMITIDA_A_PROVEEDOR',
                status: { [Op.ne]: 'ANULADO' }
            },
            raw: true
        });

        const existingPoIds = new Set(existingRecords.filter(r => r.purchaseOrderId).map(r => r.purchaseOrderId));
        const rows = [...existingRecords.map(r => r.toJSON())];

        // Merge purchase orders using real Supplier metadata and real tax/retention records
        for (const po of purchases) {
            if (existingPoIds.has(po.id)) continue;

            const rate = Number(po.exchangeRate) > 0 ? Number(po.exchangeRate) : 1.0;
            const totalUsd = Number(po.total) || 0;
            const totalVes = Number(po.totalVes) > 0
                ? precision.round(Number(po.totalVes), 2)
                : precision.round(precision.multiply(totalUsd, rate), 2);

            const supplier = po.supplierId ? supplierMap.get(String(po.supplierId)) : null;
            const poItems = Array.isArray(po.items) ? po.items : (() => {
                if (typeof po.items === 'string') {
                    try { const p = JSON.parse(po.items); return Array.isArray(p) ? p : []; } catch (_) { return []; }
                }
                return [];
            })();

            // Calcular IVA real a partir de ítems o metadatos explícitos de la orden (no asumir / 1.16 ciegamente)
            let explicitTaxUsd = 0;
            let explicitTaxableUsd = 0;
            let explicitExemptUsd = 0;
            let hasExplicitItemTaxInfo = false;

            for (const it of poItems) {
                const qty = Number(it.quantity ?? it.receivedQuantity ?? 1) || 1;
                const unitCost = Number(it.cost ?? it.unitCost ?? it.price ?? 0) || 0;
                const lineTotal = Number(it.subtotal ?? precision.multiply(qty, unitCost)) || 0;
                const isExemptItem = it.isExempt === true || it.taxStatus === 'exento' || Number(it.taxRate) === 0;
                const itemTaxRate = Number(it.taxRate);

                if (Number(it.taxAmount) > 0) {
                    hasExplicitItemTaxInfo = true;
                    explicitTaxUsd = precision.add([explicitTaxUsd, Number(it.taxAmount)]);
                    explicitTaxableUsd = precision.add([explicitTaxableUsd, lineTotal]);
                } else if (!isExemptItem && itemTaxRate > 0) {
                    hasExplicitItemTaxInfo = true;
                    const factor = precision.divide(itemTaxRate, 100);
                    const base = precision.divide(lineTotal, precision.add([1, factor]));
                    explicitTaxableUsd = precision.add([explicitTaxableUsd, base]);
                    explicitTaxUsd = precision.add([explicitTaxUsd, precision.subtract(lineTotal, base)]);
                } else if (isExemptItem) {
                    hasExplicitItemTaxInfo = true;
                    explicitExemptUsd = precision.add([explicitExemptUsd, lineTotal]);
                }
            }

            const poRetentions = periodRetentions.filter(ret =>
                (ret.purchaseOrderId && String(ret.purchaseOrderId) === String(po.id)) ||
                (po.referenceNumber && ret.invoiceNumber && String(ret.invoiceNumber).trim() === String(po.referenceNumber).trim())
            );
            const retentionVes = poRetentions.reduce((sum, ret) => {
                const retRate = Number(ret.exchangeRate) > 0 ? Number(ret.exchangeRate) : rate;
                const amt = Number(ret.retainedAmount) || 0;
                const amtVes = String(ret.currency || 'VES').toUpperCase() === 'USD'
                    ? precision.multiply(amt, retRate)
                    : amt;
                return precision.round(precision.add([sum, amtVes]), 2);
            }, 0);

            let taxableBaseVes = 0;
            let exemptAmountVes = totalVes;
            let taxAmountVes = 0;
            let effectiveTaxRate = 0;

            if (hasExplicitItemTaxInfo && explicitTaxUsd > 0) {
                taxAmountVes = precision.round(precision.multiply(explicitTaxUsd, rate), 2);
                taxableBaseVes = precision.round(precision.multiply(explicitTaxableUsd, rate), 2);
                exemptAmountVes = Math.max(0, precision.round(precision.subtract(totalVes, precision.add([taxableBaseVes, taxAmountVes])), 2));
                effectiveTaxRate = taxableBaseVes > 0 ? precision.round(precision.multiply(precision.divide(taxAmountVes, taxableBaseVes), 100), 2) : 16.00;
            } else if (poRetentions.length > 0 && Number(poRetentions[0].taxAmount) > 0) {
                const retTax = poRetentions.reduce((s, r) => precision.add([s, Number(r.taxAmount) || 0]), 0);
                const retBase = poRetentions.reduce((s, r) => precision.add([s, Number(r.baseAmount) || 0]), 0);
                taxAmountVes = precision.round(retTax, 2);
                taxableBaseVes = precision.round(retBase, 2);
                exemptAmountVes = Math.max(0, precision.round(precision.subtract(totalVes, precision.add([taxableBaseVes, taxAmountVes])), 2));
                effectiveTaxRate = 16.00;
            }

            rows.push({
                id: `po-${po.id}`,
                companyId,
                bookType: 'COMPRAS',
                recordDate: String(po.date || startDate).split('T')[0],
                documentType: 'FACTURA',
                documentNumber: po.referenceNumber || `OC-${po.id.slice(-6)}`,
                controlNumber: po.referenceNumber ? `00-${String(po.referenceNumber).replace(/[^0-9A-Za-z-]/g, '').slice(-6)}` : `00-${po.id.slice(-6)}`,
                entityRif: supplier?.rif || 'S/R',
                entityName: supplier?.name || `Proveedor Orden #${po.id.slice(-4)}`,
                affectedInvoiceNumber: '',
                totalAmount: totalVes,
                exemptAmount: exemptAmountVes,
                taxableBase: taxableBaseVes,
                taxRate: effectiveTaxRate,
                taxAmount: taxAmountVes,
                retainedIvaAmount: retentionVes,
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
            acc.totalCompras = precision.round(precision.add([acc.totalCompras, Number(r.totalAmount) || 0]), 2);
            acc.totalExento = precision.round(precision.add([acc.totalExento, Number(r.exemptAmount) || 0]), 2);
            acc.totalBaseImponible = precision.round(precision.add([acc.totalBaseImponible, Number(r.taxableBase) || 0]), 2);
            acc.totalCreditoFiscal = precision.round(precision.add([acc.totalCreditoFiscal, Number(r.taxAmount) || 0]), 2);
            acc.totalIvaRetenido = precision.round(precision.add([acc.totalIvaRetenido, Number(r.retainedIvaAmount) || 0]), 2);
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
     * Crea de forma atómica una Nota de Crédito fiscal y su asiento en Libro de Ventas
     * dentro de una transacción Sequelize ya abierta.
     */
    async createCreditNoteInTransaction(companyId, userId, data, t) {
        const {
            saleId,
            affectedInvoiceNumber,
            customerId,
            customerName,
            customerRif,
            subtotal = 0,
            taxAmount = 0,
            exemptAmount = 0,
            totalAmount = 0,
            currency = 'VES',
            exchangeRate = 1.0,
            reason = 'DEVOLUCION_MERCANCIA',
            reenterStock = true,
            items = [],
            date,
            notes = '',
            branchId = null
        } = data;

        const creditNoteId = generateRobustId();
        const txDate = date || new Date().toISOString().split('T')[0];
        const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1.0;

        let seq = await FiscalSequence.findOne({
            where: {
                companyId,
                branchId: branchId || null,
                documentType: 'CREDIT_NOTE'
            },
            lock: t.LOCK ? t.LOCK.UPDATE : undefined,
            transaction: t
        });

        if (!seq) {
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

        const nextNumber = Number(seq.lastNumber) + 1;
        const nextControl = Number(seq.lastControlNumber) + 1;
        const ncNumber = `${seq.prefix || 'NC-'}${String(nextNumber).padStart(6, '0')}`;
        const controlNumber = `00-${String(nextControl).padStart(6, '0')}`;

        await seq.update({
            lastNumber: nextNumber,
            lastControlNumber: nextControl
        }, { transaction: t });

        const totalNum = Number(totalAmount) || 0;
        const totalAmountUsd = String(currency).toUpperCase() === 'USD'
            ? totalNum
            : (rate > 0 ? totalNum / rate : 0);

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
            totalAmount: totalNum,
            currency,
            exchangeRate: rate,
            totalAmountUsd,
            reason,
            reenterStock,
            items,
            status: 'APLICADA',
            date: txDate,
            userId,
            notes
        }, { transaction: t });

        const d = new Date(txDate);
        const periodYear = !isNaN(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
        const periodMonth = !isNaN(d.getTime()) ? (d.getMonth() + 1) : (new Date().getMonth() + 1);
        const factorVes = String(currency).toUpperCase() === 'USD' ? rate : 1.0;

        const totalVes = -Math.abs(totalNum * factorVes);
        const subtotalVes = -Math.abs((Number(subtotal) || 0) * factorVes);
        const exemptVes = -Math.abs((Number(exemptAmount) || 0) * factorVes);
        const taxVes = -Math.abs((Number(taxAmount) || 0) * factorVes);

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
            exemptAmount: exemptVes,
            taxableBase: subtotalVes,
            taxRate: 16.00,
            taxAmount: taxVes,
            retainedIvaAmount: 0,
            igtfAmount: 0,
            currency: 'VES',
            exchangeRate: rate,
            originalTotalUsd: -Math.abs(totalAmountUsd),
            periodYear,
            periodMonth,
            creditNoteId: creditNote.id,
            saleId: saleId || null,
            userId,
            notes
        }, { transaction: t });

        return creditNote;
    }

    /**
     * Issue a Credit Note and process inventory & accounting effects
     */
    async issueCreditNote(companyId, userId, data) {
        const {
            saleId,
            branchId = null,
            customerId,
            subtotal = 0,
            taxAmount = 0,
            totalAmount = 0,
            currency = 'VES',
            exchangeRate = 1.0,
            reenterStock = true,
            items = [],
            date
        } = data;

        const txDate = date || new Date().toISOString().split('T')[0];

        return await sequelize.transaction(async (t) => {
            const creditNote = await this.createCreditNoteInTransaction(companyId, userId, data, t);
            const ncNumber = creditNote.creditNoteNumber;

            // Resolver sucursal destino para mantener consistencia en BranchStock
            let targetBranchId = branchId;
            if (!targetBranchId && saleId) {
                const origSale = await Sale.findOne({ where: { id: saleId, companyId }, attributes: ['branchId'], transaction: t });
                if (origSale?.branchId) targetBranchId = origSale.branchId;
            }
            if (!targetBranchId && reenterStock) {
                const defaultBranch = await Branch.findOne({ where: { companyId }, order: [['createdAt', 'ASC']], transaction: t });
                if (defaultBranch) targetBranchId = defaultBranch.id;
            }

            // 2. Re-enter returned items to Inventory (if requested)
            let returnedCostUsd = 0;
            if (reenterStock && Array.isArray(items)) {
                for (const item of items) {
                    if (!item.productId) continue;
                    const qty = precision.parseNumericInput(item.quantity);
                    if (qty <= 0) continue;

                    const product = await Product.findOne({ where: { id: item.productId, companyId }, lock: t.LOCK.UPDATE, transaction: t });
                    if (product) {
                        const unitCost = precision.parseNumericInput(product.cost);
                        if (unitCost > 0) {
                            returnedCostUsd = precision.add([returnedCostUsd, precision.multiply(unitCost, qty)]);
                        }
                        const stockBefore = precision.parseNumericInput(product.stockQuantity ?? product.stock);
                        const newStock = precision.round(precision.add([stockBefore, qty]), 4);
                        await product.update({ stockQuantity: String(newStock), stock: String(newStock) }, { transaction: t });

                        if (targetBranchId) {
                            const bStock = await BranchStock.findOne({
                                where: { productId: product.id, branchId: targetBranchId, companyId },
                                lock: t.LOCK.UPDATE,
                                transaction: t
                            });
                            if (bStock) {
                                const nextBranchQty = precision.round(precision.add([precision.parseNumericInput(bStock.quantity), qty]), 4);
                                await bStock.update({ quantity: nextBranchQty }, { transaction: t });
                            } else {
                                await BranchStock.create({
                                    id: generateRobustId(),
                                    companyId,
                                    branchId: targetBranchId,
                                    productId: product.id,
                                    quantity: qty
                                }, { transaction: t });
                            }
                        }

                        await StockMovement.create({
                            id: generateRobustId(),
                            productId: product.id,
                            companyId,
                            userId,
                            type: 'IN',
                            quantity: qty,
                            stockBefore: String(stockBefore),
                            stockAfter: String(newStock),
                            reason: `Devolución por Nota de Crédito ${ncNumber}`,
                            referenceId: creditNote.id,
                            date: txDate,
                            timestamp: new Date().toISOString()
                        }, { transaction: t });
                    }
                }
            }

            // 3. If customer owes credit, deduct from Customer balance (solo campo real creditBalance)
            let creditDeductedUsd = 0;
            if (customerId) {
                const customer = await Customer.findOne({ where: { id: customerId, companyId }, lock: t.LOCK.UPDATE, transaction: t });
                const currentBalance = customer ? precision.parseNumericInput(customer.creditBalance) : 0;
                if (customer && currentBalance > 0) {
                    const rateSafe = precision.parseNumericInput(exchangeRate) || 1.0;
                    const totalNum = precision.parseNumericInput(totalAmount);
                    const deductAmountUsd = String(currency).toUpperCase() === 'USD'
                        ? precision.round(totalNum, 2)
                        : precision.round(precision.divide(totalNum, rateSafe), 2);
                    const appliedCreditDeduction = Math.min(currentBalance, Math.max(0, deductAmountUsd));
                    const newDebt = Math.max(0, precision.round(precision.subtract(currentBalance, appliedCreditDeduction), 2));
                    await customer.update({ creditBalance: newDebt }, { transaction: t });

                    if (appliedCreditDeduction > 0) {
                        creditDeductedUsd = appliedCreditDeduction;
                        await CreditHistory.create({
                            id: generateRobustId(),
                            customerId: customer.id,
                            companyId,
                            userId,
                            type: 'credit',
                            amount: appliedCreditDeduction,
                            balanceAfter: newDebt,
                            description: `Ajuste por Nota de Crédito ${ncNumber}`,
                            timestamp: new Date().toISOString()
                        }, { transaction: t });
                    }
                }
            }

            // 4. Asiento Contable Automático síncrono dentro de la transacción fiscal
            const totalUsd = precision.round(precision.parseNumericInput(creditNote.totalAmountUsd), 2);
            if (totalUsd > 0 && !data.skipAccounting) {
                const AccountingEngineService = require('./AccountingEngineService');
                const rateSafe = precision.parseNumericInput(exchangeRate) || 1.0;
                const isUsd = String(currency).toUpperCase() === 'USD';
                const taxUsd = isUsd
                    ? precision.round(precision.parseNumericInput(taxAmount), 2)
                    : precision.round(precision.divide(precision.parseNumericInput(taxAmount), rateSafe), 2);
                const relatedSale = saleId
                    ? await Sale.findOne({ where: { id: saleId, companyId }, transaction: t })
                    : null;

                const paymentMethods = [];
                if (creditDeductedUsd > 0) {
                    paymentMethods.push({ method: 'fiado', amount: creditDeductedUsd, currency: 'USD' });
                }
                const remainingUsd = precision.round(Math.max(0, precision.subtract(totalUsd, creditDeductedUsd)), 2);
                if (remainingUsd > 0) {
                    paymentMethods.push({ method: 'cash', amount: remainingUsd, currency: 'USD' });
                }

                await AccountingEngineService.generateRefundEntry({
                    id: creditNote.id,
                    saleId: saleId || null,
                    userId,
                    date: txDate,
                    exchangeRate: rateSafe,
                    amount: totalUsd,
                    taxAmount: Math.min(taxUsd, totalUsd),
                    igtfAmount: 0,
                    returnedCost: reenterStock ? precision.round(returnedCostUsd, 2) : 0,
                    isQuarantine: !reenterStock,
                    paymentMethods
                }, relatedSale, companyId, t);
            }

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
