const { sequelize, AccountCatalog, JournalEntry, JournalEntryLine, User } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/VortexMathEngine');

const BANK_METHOD_KEYWORDS = [
    'card', 'pos', 'punto', 'pago_movil', 'pagomovil',
    'transfer', 'zelle', 'biopago', 'binance', 'mobile_payment',
    'bank', 'digital', 'debit', 'tarjeta'
];

class AccountingEngineService {
    static _isBankMethod(methodStr) {
        const mKey = String(methodStr || '').toLowerCase().trim();
        if (!mKey || mKey === 'credit' || mKey === 'fiado' || mKey === 'credit_usd') return false;
        if (mKey.includes('cash') || mKey.includes('efectivo')) return false;
        return BANK_METHOD_KEYWORDS.some(k => mKey.includes(k));
    }

    /**
     * Alias de compatibilidad para inicializar catálogo
     */
    static async seedDefaultCatalog(companyId = 'default', transaction = null) {
        return this.seedDefaultChartOfAccounts(companyId, transaction);
    }

    /**
     * Siembra el catálogo contable base (PUC estándar para Venezuela / NIIF)
     */
    static async seedDefaultChartOfAccounts(companyId = 'default', transaction = null) {
        const existingRows = await AccountCatalog.findAll({
            attributes: ['code'],
            where: { companyId },
            ...(transaction ? { transaction } : {})
        });
        const existingCodes = new Set(existingRows.map(r => r.code));

        const defaultAccounts = [
            // 1. Activo
            { code: '1', name: 'ACTIVO', accountType: 'ASSET', nature: 'DEBIT', level: 1, isSelectable: false },
            { code: '1.1', name: 'ACTIVO CORRIENTE', accountType: 'ASSET', nature: 'DEBIT', level: 2, isSelectable: false },
            { code: '1.1.1', name: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', accountType: 'ASSET', nature: 'DEBIT', level: 3, isSelectable: false },
            { code: '1.1.1.01.001', name: 'Caja Principal (Efectivo)', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.1.01.002', name: 'Caja Chica', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.1.02.001', name: 'Bancos Nacionales (VES)', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.1.02.002', name: 'Bancos Divisas / Custodia (USD)', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            
            { code: '1.1.2', name: 'CUENTAS POR COBRAR COMERCIALES', accountType: 'ASSET', nature: 'DEBIT', level: 3, isSelectable: false },
            { code: '1.1.2.01.001', name: 'Clientes Nacionales por Cobrar', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.2.02.001', name: 'Anticipos y Préstamos a Empleados', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },

            { code: '1.1.3', name: 'INVENTARIOS', accountType: 'ASSET', nature: 'DEBIT', level: 3, isSelectable: false },
            { code: '1.1.3.01.001', name: 'Inventario de Mercancías para la Venta', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.3.02.001', name: 'Inventario de Materias Primas e Insumos', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.3.03.001', name: 'Inventario de Productos Terminados', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },

            { code: '1.1.4', name: 'CRÉDITOS Y RETENCIONES FISCALES', accountType: 'ASSET', nature: 'DEBIT', level: 3, isSelectable: false },
            { code: '1.1.4.01.001', name: 'IVA Crédito Fiscal (Compras)', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.4.02.001', name: 'Retenciones de IVA Recibidas / Clientes', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.1.4.03.001', name: 'Anticipos de ISLR', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },

            // 1.2 Activo No Corriente
            { code: '1.2', name: 'ACTIVO NO CORRIENTE', accountType: 'ASSET', nature: 'DEBIT', level: 2, isSelectable: false },
            { code: '1.2.1', name: 'PROPIEDAD, PLANTA Y EQUIPOS', accountType: 'ASSET', nature: 'DEBIT', level: 3, isSelectable: false },
            { code: '1.2.1.01.001', name: 'Vehículos y Transporte', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.2.1.02.001', name: 'Mobiliario y Equipos de Oficina', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.2.1.03.001', name: 'Equipos de Computación y POS', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.2.1.04.001', name: 'Maquinaria y Enseres Operativos', accountType: 'ASSET', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '1.2.9', name: 'DEPRECIACIÓN ACUMULADA', accountType: 'ASSET', nature: 'CREDIT', level: 3, isSelectable: false },
            { code: '1.2.9.01.001', name: 'Depreciación Acumulada Activos Fijos', accountType: 'ASSET', nature: 'CREDIT', level: 5, isSelectable: true },

            // 2. Pasivo
            { code: '2', name: 'PASIVO', accountType: 'LIABILITY', nature: 'CREDIT', level: 1, isSelectable: false },
            { code: '2.1', name: 'PASIVO CORRIENTE', accountType: 'LIABILITY', nature: 'CREDIT', level: 2, isSelectable: false },
            { code: '2.1.1', name: 'CUENTAS POR PAGAR COMERCIALES', accountType: 'LIABILITY', nature: 'CREDIT', level: 3, isSelectable: false },
            { code: '2.1.1.01.001', name: 'Proveedores Nacionales por Pagar', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },

            { code: '2.1.2', name: 'OBLIGACIONES TRIBUTARIAS POR PAGAR', accountType: 'LIABILITY', nature: 'CREDIT', level: 3, isSelectable: false },
            { code: '2.1.2.01.001', name: 'IVA Débito Fiscal (Ventas)', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '2.1.2.02.001', name: 'Retenciones de IVA por Enterar a Proveedores', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '2.1.2.03.001', name: 'Retenciones de ISLR por Enterar', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '2.1.2.04.001', name: 'IGTF por Enterar (3%)', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },

            { code: '2.1.3', name: 'OBLIGACIONES LABORALES POR PAGAR', accountType: 'LIABILITY', nature: 'CREDIT', level: 3, isSelectable: false },
            { code: '2.1.3.01.001', name: 'Sueldos y Salarios por Pagar', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '2.1.3.02.001', name: 'Retenciones IVSS / Paro Forzoso por Enterar', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '2.1.3.03.001', name: 'Retenciones FAOV por Enterar', accountType: 'LIABILITY', nature: 'CREDIT', level: 5, isSelectable: true },

            // 3. Patrimonio
            { code: '3', name: 'PATRIMONIO', accountType: 'EQUITY', nature: 'CREDIT', level: 1, isSelectable: false },
            { code: '3.1.1.01.001', name: 'Capital Social Suscrito y Pagado', accountType: 'EQUITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '3.1.2.01.001', name: 'Reserva Legal', accountType: 'EQUITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '3.1.3.01.001', name: 'Resultados Acumulados de Ejercicios Anteriores', accountType: 'EQUITY', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '3.1.4.01.001', name: 'Resultado del Ejercicio Actual', accountType: 'EQUITY', nature: 'CREDIT', level: 5, isSelectable: true },

            // 4. Ingresos
            { code: '4', name: 'INGRESOS', accountType: 'REVENUE', nature: 'CREDIT', level: 1, isSelectable: false },
            { code: '4.1.1.01.001', name: 'Ventas de Mercancías Generales', accountType: 'REVENUE', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '4.1.2.01.001', name: 'Descuentos en Ventas', accountType: 'REVENUE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '4.2.1.01.001', name: 'Otros Ingresos Operativos', accountType: 'REVENUE', nature: 'CREDIT', level: 5, isSelectable: true },
            { code: '4.3.1.01.001', name: 'Ganancia en Diferencial Cambiario', accountType: 'REVENUE', nature: 'CREDIT', level: 5, isSelectable: true },

            // 5. Costos
            { code: '5', name: 'COSTOS', accountType: 'COST', nature: 'DEBIT', level: 1, isSelectable: false },
            { code: '5.1.1.01.001', name: 'Costo de Ventas (CMV)', accountType: 'COST', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '5.1.2.01.001', name: 'Costos de Producción y Transformación', accountType: 'COST', nature: 'DEBIT', level: 5, isSelectable: true },

            // 6. Gastos
            { code: '6', name: 'GASTOS', accountType: 'EXPENSE', nature: 'DEBIT', level: 1, isSelectable: false },
            { code: '6.1', name: 'GASTOS OPERATIVOS Y ADMINISTRATIVOS', accountType: 'EXPENSE', nature: 'DEBIT', level: 2, isSelectable: false },
            { code: '6.1.1.01.001', name: 'Sueldos y Salarios del Personal', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.1.02.001', name: 'Beneficio de Alimentación (Cestaticket)', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.1.03.001', name: 'Comisiones de Vendedores', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.2.01.001', name: 'Servicios Públicos (Luz, Agua, Telecom)', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.3.01.001', name: 'Alquileres de Inmuebles Comerciales', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.4.01.001', name: 'Mantenimiento y Reparaciones', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.5.01.001', name: 'Publicidad y Mercadeo', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.6.01.001', name: 'Gasto por Depreciación de Activos Fijos', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.1.7.01.001', name: 'Pérdidas por Mermas y Averías de Inventario', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.2.1.01.001', name: 'Comisiones Bancarias y Tarifas', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true },
            { code: '6.3.1.01.001', name: 'Pérdida en Diferencial Cambiario', accountType: 'EXPENSE', nature: 'DEBIT', level: 5, isSelectable: true }
        ];

        const missingAccounts = defaultAccounts.filter(acc => !existingCodes.has(acc.code));
        if (missingAccounts.length === 0) {
            return { success: true, message: 'El catálogo ya contiene cuentas registradas.', count: existingRows.length };
        }

        const recordsToInsert = missingAccounts.map(acc => ({
            id: generateRobustId(),
            companyId,
            ...acc
        }));

        if (transaction) {
            await AccountCatalog.bulkCreate(recordsToInsert, { transaction });
        } else {
            await sequelize.transaction(async (tx) => {
                await AccountCatalog.bulkCreate(recordsToInsert, { transaction: tx });
            });
        }

        return { success: true, message: `Se sembraron ${recordsToInsert.length} cuentas en el PUC.`, count: recordsToInsert.length };
    }

    /**
     * Busca una cuenta por su código contable
     */
    static async findAccountByCode(code, companyId = 'default', transaction = null) {
        return await AccountCatalog.findOne({
            where: { code, companyId },
            ...(transaction ? { transaction } : {})
        });
    }

    /**
     * Crea un asiento contable validando estrictamente la partida doble
     */
    static async createEntry({
        companyId = 'default',
        entryDate,
        description,
        entryType = 'AUTOMATIC',
        currency = 'USD',
        exchangeRate = 1,
        referenceType = null,
        referenceId = null,
        userId = null,
        lines = [],
        transaction = null
    }) {
        if (!Array.isArray(lines) || lines.length < 2) {
            throw new Error('Un asiento contable requiere al menos 2 líneas para cumplir la partida doble.');
        }

        const dateStr = (entryDate ? String(entryDate).split('T')[0] : new Date().toISOString().split('T')[0]);
        const year = dateStr.substring(0, 4);

        // Validar sumatorias de Debe y Haber con aritmética exacta BigInt (patrón Fowler)
        let sumDebit = 0;
        let sumCredit = 0;

        for (const line of lines) {
            const d = precision.round(line.debit || 0, 2);
            const c = precision.round(line.credit || 0, 2);
            sumDebit = precision.add(sumDebit, d);
            sumCredit = precision.add(sumCredit, c);
        }
        sumDebit = precision.round(sumDebit, 2);
        sumCredit = precision.round(sumCredit, 2);

        const diff = Math.abs(precision.subtract(sumDebit, sumCredit));
        if (diff > 0.005) {
            throw new Error(`Asiento descuadrado: Debe ($${sumDebit.toFixed(2)}) != Haber ($${sumCredit.toFixed(2)}). Diferencia: $${diff.toFixed(2)}.`);
        }

        const executeOperations = async (t) => {
            // Serializar correlativo del año por empresa evitando colisiones y huecos
            if (typeof sequelize.getDialect === 'function' && sequelize.getDialect() === 'postgres') {
                await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:lockKey))', {
                    replacements: { lockKey: `je_seq_${companyId}_${year}` },
                    transaction: t
                });
            }

            const lastEntry = await JournalEntry.findOne({
                where: {
                    companyId,
                    entryNumber: { [Op.like]: `AS-${year}-%` }
                },
                order: [['entryNumber', 'DESC']],
                attributes: ['entryNumber'],
                transaction: t
            });
            const lastSeq = lastEntry?.entryNumber
                ? (parseInt(String(lastEntry.entryNumber).split('-').pop(), 10) || 0)
                : 0;
            const entryNumber = `AS-${year}-${String(lastSeq + 1).padStart(5, '0')}`;

            const rate = precision.parseNumericInput(exchangeRate) > 0
                ? precision.parseNumericInput(exchangeRate)
                : 1;

            const entryId = generateRobustId();
            const entry = await JournalEntry.create({
                id: entryId,
                companyId,
                entryNumber,
                entryDate: dateStr,
                description: description || 'Asiento contable',
                entryType,
                status: 'POSTED',
                totalDebit: sumDebit,
                totalCredit: sumCredit,
                currency,
                exchangeRate: rate,
                referenceType,
                referenceId,
                userId
            }, { transaction: t });

            // Crear líneas y actualizar saldos de cuenta (con LOCK.UPDATE en orden determinístico por accountId)
            const sortedLines = [...lines].map((l, idx) => ({ ...l, _origIdx: idx }))
                .sort((a, b) => String(a.accountId || '').localeCompare(String(b.accountId || '')));

            for (const line of sortedLines) {
                const account = await AccountCatalog.findOne({
                    where: { id: line.accountId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
                if (!account) {
                    throw new Error(`Cuenta contable no encontrada: ${line.accountId}`);
                }
                if (account.isSelectable === false) {
                    throw new Error(`La cuenta contable ${account.code} (${account.name}) es de agrupación y no admite cargos directos.`);
                }

                const debitVal = precision.round(line.debit || 0, 2);
                const creditVal = precision.round(line.credit || 0, 2);

                await JournalEntryLine.create({
                    id: generateRobustId(),
                    journalEntryId: entryId,
                    accountId: line.accountId,
                    description: line.description || description || '',
                    debit: debitVal,
                    credit: creditVal,
                    lineOrder: line._origIdx + 1
                }, { transaction: t });

                // Actualizar saldos acumulados de la cuenta en USD y VES exactos
                const deltaUSD = account.nature === 'DEBIT'
                    ? precision.subtract(debitVal, creditVal)
                    : precision.subtract(creditVal, debitVal);
                const deltaVES = precision.round(precision.multiply(deltaUSD, rate), 2);

                const newBalanceUSD = precision.round(precision.add(account.balanceUSD || 0, deltaUSD), 2);
                const newBalanceVES = precision.round(precision.add(account.balanceVES || 0, deltaVES), 2);

                await account.update({
                    balanceUSD: newBalanceUSD,
                    balanceVES: newBalanceVES
                }, { transaction: t });
            }

            return entry;
        };

        if (transaction) {
            return await executeOperations(transaction);
        } else {
            return await sequelize.transaction(executeOperations);
        }
    }

    /**
     * Generador automático de Asiento Contable por Venta
     */
    static async generateSaleEntry(sale, companyId = 'default', transaction = null) {
        try {
            const round2 = (n) => precision.round(n || 0, 2);
            const total = round2(sale.total);
            if (total <= 0) return null;

            const tax = round2(sale.tax);
            const discount = round2(sale.discount);
            const promoDiscount = round2(sale.promoDiscount);
            const totalDiscount = round2(precision.add(discount, promoDiscount));
            const igtf = round2(sale.igtfAmount);
            const rateRaw = precision.parseNumericInput(sale.exchangeRate);
            const rate = rateRaw > 0 ? rateRaw : 1;

            // Calcular Costo de Mercancía Vendida (CMV) exacto si hay items
            let totalCost = 0;
            if (Array.isArray(sale.SaleItems)) {
                let rawCostSum = 0;
                for (const item of sale.SaleItems) {
                    const c = precision.parseNumericInput(item.cost);
                    const q = (item.quantity !== undefined && item.quantity !== null)
                        ? precision.parseNumericInput(item.quantity)
                        : 1;
                    rawCostSum = precision.add(rawCostSum, precision.multiply(c, q));
                }
                totalCost = round2(rawCostSum);
            }

            // Resolver catálogo contable (sembrando cuentas PUC faltantes en la transacción si aplica)
            let accCaja = await this.findAccountByCode('1.1.1.01.001', companyId, transaction);
            let accBanco = await this.findAccountByCode('1.1.1.02.001', companyId, transaction);
            let accCxC = await this.findAccountByCode('1.1.2.01.001', companyId, transaction);
            let accVentas = await this.findAccountByCode('4.1.1.01.001', companyId, transaction);
            let accIvaDebito = await this.findAccountByCode('2.1.2.01.001', companyId, transaction);
            let accIgtf = await this.findAccountByCode('2.1.2.04.001', companyId, transaction);
            let accDescuentos = await this.findAccountByCode('4.1.2.01.001', companyId, transaction);
            let accCostoVenta = await this.findAccountByCode('5.1.1.01.001', companyId, transaction);
            let accInventario = await this.findAccountByCode('1.1.3.01.001', companyId, transaction);

            const missingNeeded = !accCaja || !accVentas || !accBanco || !accCxC
                || (totalDiscount > 0 && !accDescuentos)
                || (tax > 0 && !accIvaDebito)
                || (igtf > 0 && !accIgtf)
                || (totalCost > 0 && (!accCostoVenta || !accInventario));

            if (missingNeeded) {
                await this.seedDefaultChartOfAccounts(companyId, transaction);
                accCaja = accCaja || await this.findAccountByCode('1.1.1.01.001', companyId, transaction);
                accBanco = accBanco || await this.findAccountByCode('1.1.1.02.001', companyId, transaction);
                accCxC = accCxC || await this.findAccountByCode('1.1.2.01.001', companyId, transaction);
                accVentas = accVentas || await this.findAccountByCode('4.1.1.01.001', companyId, transaction);
                accIvaDebito = accIvaDebito || await this.findAccountByCode('2.1.2.01.001', companyId, transaction);
                accIgtf = accIgtf || await this.findAccountByCode('2.1.2.04.001', companyId, transaction);
                accDescuentos = accDescuentos || await this.findAccountByCode('4.1.2.01.001', companyId, transaction);
                accCostoVenta = accCostoVenta || await this.findAccountByCode('5.1.1.01.001', companyId, transaction);
                accInventario = accInventario || await this.findAccountByCode('1.1.3.01.001', companyId, transaction);
            }

            if (!accCaja || !accVentas) {
                throw new Error('Cuentas contables base de venta (Caja 1.1.1.01.001 / Ventas 4.1.1.01.001) no encontradas.');
            }

            const isCredit = sale.paymentStatus === 'pending' || sale.paymentStatus === 'credit' || sale.paymentStatus === 'unpaid';
            const lines = [];
            const invRef = `Venta Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`;

            // 1. Debe: Desglose entre Efectivo (Caja), Medios Bancarios (Bancos) y Crédito (CxC)
            let pms = [];
            if (Array.isArray(sale.paymentMethods)) {
                pms = sale.paymentMethods;
            } else if (typeof sale.paymentMethods === 'string') {
                try { pms = JSON.parse(sale.paymentMethods) || []; } catch (_) { pms = []; }
            }

            if (isCredit && pms.length === 0) {
                if (!accCxC) {
                    throw new Error('Cuenta contable CxC (1.1.2.01.001) no encontrada para registrar venta a crédito.');
                }
                lines.push({
                    accountId: accCxC.id,
                    description: invRef,
                    debit: total,
                    credit: 0
                });
            } else if (pms.length > 0) {
                let cashUsd = 0;
                let bankUsd = 0;
                let creditUsd = 0;

                for (const pm of pms) {
                    const mKey = String(pm.method || '').toLowerCase();
                    const cur = String(pm.currency || (mKey.includes('ves') || mKey.includes('bs') ? 'VES' : 'USD')).toUpperCase();
                    const rawAmt = precision.parseNumericInput(pm.amount);
                    const convUsd = precision.parseNumericInput(pm.convertedAmountUsd);
                    const eqUsd = convUsd > 0
                        ? convUsd
                        : ((cur === 'VES' || cur === 'BS') && rate > 0 ? precision.divide(rawAmt, rate) : rawAmt);

                    if (mKey === 'fiado' || mKey === 'credit' || mKey === 'credit_usd') {
                        creditUsd = precision.add(creditUsd, eqUsd);
                    } else if (this._isBankMethod(mKey)) {
                        bankUsd = precision.add(bankUsd, eqUsd);
                    } else {
                        cashUsd = precision.add(cashUsd, eqUsd);
                    }
                }

                const hadCredit = creditUsd > 0;
                const sumBreakdown = precision.add([cashUsd, bankUsd, creditUsd]);
                if (sumBreakdown <= 0) {
                    if (isCredit) {
                        creditUsd = total;
                    } else if (this._isBankMethod(sale.paymentMethod)) {
                        bankUsd = total;
                    } else {
                        cashUsd = total;
                    }
                } else {
                    const scale = precision.divide(total, sumBreakdown);
                    cashUsd = round2(precision.multiply(cashUsd, scale));
                    bankUsd = round2(precision.multiply(bankUsd, scale));
                    if (hadCredit) {
                        creditUsd = Math.max(0, round2(precision.subtract(total, precision.add(cashUsd, bankUsd))));
                    } else {
                        creditUsd = 0;
                        const residual = round2(precision.subtract(total, precision.add(cashUsd, bankUsd)));
                        if (residual !== 0) {
                            if (bankUsd > 0) bankUsd = round2(precision.add(bankUsd, residual));
                            else cashUsd = round2(precision.add(cashUsd, residual));
                        }
                    }
                }

                if (bankUsd > 0 && !accBanco) {
                    throw new Error('Cuenta contable Bancos (1.1.1.02.001) no encontrada para cobro bancario.');
                }
                if (creditUsd > 0 && !accCxC) {
                    throw new Error('Cuenta contable CxC (1.1.2.01.001) no encontrada para porción fiada.');
                }

                if (cashUsd > 0) lines.push({ accountId: accCaja.id, description: `${invRef} (Efectivo)`, debit: cashUsd, credit: 0 });
                if (bankUsd > 0) lines.push({ accountId: accBanco.id, description: `${invRef} (Bancos/Digital)`, debit: bankUsd, credit: 0 });
                if (creditUsd > 0) lines.push({ accountId: accCxC.id, description: `${invRef} (CxC)`, debit: creditUsd, credit: 0 });
            } else {
                const isBankMethod = this._isBankMethod(sale.paymentMethod);
                if (isCredit && !accCxC) {
                    throw new Error('Cuenta contable CxC (1.1.2.01.001) no encontrada para venta a crédito.');
                }
                if (!isCredit && isBankMethod && !accBanco) {
                    throw new Error('Cuenta contable Bancos (1.1.1.02.001) no encontrada para venta bancaria.');
                }
                const accReceiving = isCredit ? accCxC : (isBankMethod ? accBanco : accCaja);
                lines.push({
                    accountId: accReceiving.id,
                    description: invRef,
                    debit: total,
                    credit: 0
                });
            }

            // Descuentos concedidos al Debe (sin omitir ni maquillar si existen)
            if (totalDiscount > 0) {
                if (!accDescuentos) {
                    throw new Error('Cuenta contable Descuentos en Ventas (4.1.2.01.001) no encontrada.');
                }
                lines.push({
                    accountId: accDescuentos.id,
                    description: `Descuento concedido Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`,
                    debit: totalDiscount,
                    credit: 0
                });
            }

            // Validar existencia estricta de cuentas fiscales si aplican impuestos
            if (tax > 0 && !accIvaDebito) {
                throw new Error('Cuenta contable IVA Débito Fiscal (2.1.2.01.001) no encontrada.');
            }
            if (igtf > 0 && !accIgtf) {
                throw new Error('Cuenta contable IGTF por Enterar (2.1.2.04.001) no encontrada.');
            }

            // 2. Haber: Venta Bruta Neta de Impuestos (total + totalDiscount - tax - igtf)
            const grossSale = round2(precision.subtract(precision.add(total, totalDiscount), precision.add(tax, igtf)));
            if (grossSale < 0) {
                throw new Error(`Descuadre contable en venta #${sale.invoiceNumber || sale.id}: impuestos (${tax} + ${igtf}) exceden monto bruto (${precision.add(total, totalDiscount)}).`);
            }
            if (grossSale > 0) {
                lines.push({
                    accountId: accVentas.id,
                    description: `Ingreso por Venta Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`,
                    debit: 0,
                    credit: grossSale
                });
            }

            // 3. Haber: IVA Débito Fiscal
            if (tax > 0) {
                lines.push({
                    accountId: accIvaDebito.id,
                    description: `IVA Débito Fiscal Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`,
                    debit: 0,
                    credit: tax
                });
            }

            // 3b. Haber: IGTF por Enterar (3%)
            if (igtf > 0) {
                lines.push({
                    accountId: accIgtf.id,
                    description: `IGTF por Enterar Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`,
                    debit: 0,
                    credit: igtf
                });
            }

            // 4. Costo de Mercancía Vendida (CMV) vs Inventario
            if (totalCost > 0) {
                if (!accCostoVenta || !accInventario) {
                    throw new Error('Cuentas contables de Costo de Venta (5.1.1.01.001) o Inventario (1.1.3.01.001) no encontradas.');
                }
                lines.push({
                    accountId: accCostoVenta.id,
                    description: `Costo de Mercancía Vendida Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`,
                    debit: totalCost,
                    credit: 0
                });
                lines.push({
                    accountId: accInventario.id,
                    description: `Descarga de Inventario Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`,
                    debit: 0,
                    credit: totalCost
                });
            }

            const entryDateNormalized = sale.date
                ? (sale.date instanceof Date ? sale.date.toISOString().split('T')[0] : String(sale.date).split('T')[0])
                : new Date().toISOString().split('T')[0];

            return await this.createEntry({
                companyId,
                entryDate: entryDateNormalized,
                description: `Contabilización Venta #${sale.invoiceNumber || String(sale.id).substring(0, 8)} - ${sale.customerName || 'Cliente General'}`,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                exchangeRate: rate,
                referenceType: 'SALE',
                referenceId: sale.id,
                userId: sale.userId,
                lines,
                transaction
            });
        } catch (err) {
            console.error('[Accounting] Error crítico al generar asiento de venta:', err.message);
            throw err;
        }
    }

    /**
     * Generador automático de Asiento Contable por Gasto
     */
    static async generateExpenseEntry(expense, companyId = 'default', transaction = null) {
        try {
            const amount = precision.round(expense.amount || 0, 2);
            if (amount <= 0) return null;

            let accGasto = await this.findAccountByCode('6.1.2.01.001', companyId, transaction)
                || await this.findAccountByCode('6.1.1.01.001', companyId, transaction);
            const useBank = this._isBankMethod(expense.paymentMethod);
            let accSalida = useBank
                ? await this.findAccountByCode('1.1.1.02.001', companyId, transaction)
                : await this.findAccountByCode('1.1.1.01.001', companyId, transaction);

            if (!accGasto || !accSalida) {
                await this.seedDefaultChartOfAccounts(companyId, transaction);
                accGasto = accGasto
                    || await this.findAccountByCode('6.1.2.01.001', companyId, transaction)
                    || await this.findAccountByCode('6.1.1.01.001', companyId, transaction);
                accSalida = useBank
                    ? (accSalida || await this.findAccountByCode('1.1.1.02.001', companyId, transaction))
                    : (accSalida || await this.findAccountByCode('1.1.1.01.001', companyId, transaction));
            }

            if (!accGasto || !accSalida) {
                throw new Error('Cuentas contables de Gasto (6.1.2.01.001) o Caja/Bancos no encontradas.');
            }

            const lines = [
                {
                    accountId: accGasto.id,
                    description: `Gasto: ${expense.description || expense.category || 'Operativo'}`,
                    debit: amount,
                    credit: 0
                },
                {
                    accountId: accSalida.id,
                    description: `Desembolso Gasto (${useBank ? 'Bancos' : 'Caja'}): ${expense.description || 'Operativo'}`,
                    debit: 0,
                    credit: amount
                }
            ];

            return await this.createEntry({
                companyId,
                entryDate: expense.date ? String(expense.date).split('T')[0] : new Date().toISOString().split('T')[0],
                description: `Contabilización Gasto: ${expense.description || expense.category || 'Operativo'}`,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                exchangeRate: precision.parseNumericInput(expense.exchangeRate) > 0 ? precision.parseNumericInput(expense.exchangeRate) : 1,
                referenceType: 'EXPENSE',
                referenceId: expense.id,
                userId: expense.userId || null,
                lines,
                transaction
            });
        } catch (err) {
            console.error('[Accounting] Error al generar asiento de gasto:', err.message);
            throw err;
        }
    }

    /**
     * Generador automático de Asiento Contable por Devolución / Nota de Crédito
     */
    static async generateRefundEntry(refund, sale = null, companyId = 'default', transaction = null) {
        try {
            const round2 = (n) => precision.round(n || 0, 2);
            const totalRefund = round2(refund.amount);
            if (totalRefund <= 0) return null;

            const taxRefund = round2(refund.taxAmount ?? refund.tax ?? 0);
            const igtfRefund = round2(refund.igtfAmount ?? refund.igtf ?? 0);
            const netSalesReversal = round2(precision.subtract(totalRefund, precision.add(taxRefund, igtfRefund)));
            if (netSalesReversal < 0) {
                throw new Error(`Descuadre en devolución #${refund.id}: impuestos reversados exceden el monto devuelto.`);
            }

            const returnedCost = round2(refund.returnedCost || 0);
            const rateRaw = precision.parseNumericInput(refund.exchangeRate || sale?.exchangeRate);
            const rate = rateRaw > 0 ? rateRaw : 1;

            let accCaja = await this.findAccountByCode('1.1.1.01.001', companyId, transaction);
            let accBanco = await this.findAccountByCode('1.1.1.02.001', companyId, transaction);
            let accCxC = await this.findAccountByCode('1.1.2.01.001', companyId, transaction);
            let accVentas = await this.findAccountByCode('4.1.1.01.001', companyId, transaction);
            let accIvaDebito = await this.findAccountByCode('2.1.2.01.001', companyId, transaction);
            let accIgtf = await this.findAccountByCode('2.1.2.04.001', companyId, transaction);
            let accCostoVenta = await this.findAccountByCode('5.1.1.01.001', companyId, transaction);
            let accInventario = await this.findAccountByCode('1.1.3.01.001', companyId, transaction);

            if (!accCaja || !accVentas || !accBanco || !accCxC || (taxRefund > 0 && !accIvaDebito) || (igtfRefund > 0 && !accIgtf) || (returnedCost > 0 && (!accCostoVenta || !accInventario))) {
                await this.seedDefaultChartOfAccounts(companyId, transaction);
                accCaja = accCaja || await this.findAccountByCode('1.1.1.01.001', companyId, transaction);
                accBanco = accBanco || await this.findAccountByCode('1.1.1.02.001', companyId, transaction);
                accCxC = accCxC || await this.findAccountByCode('1.1.2.01.001', companyId, transaction);
                accVentas = accVentas || await this.findAccountByCode('4.1.1.01.001', companyId, transaction);
                accIvaDebito = accIvaDebito || await this.findAccountByCode('2.1.2.01.001', companyId, transaction);
                accIgtf = accIgtf || await this.findAccountByCode('2.1.2.04.001', companyId, transaction);
                accCostoVenta = accCostoVenta || await this.findAccountByCode('5.1.1.01.001', companyId, transaction);
                accInventario = accInventario || await this.findAccountByCode('1.1.3.01.001', companyId, transaction);
            }

            if (!accCaja || !accVentas) {
                throw new Error('Cuentas base de venta no encontradas para asiento de devolución.');
            }

            const lines = [];
            const refLabel = `Devolución Venta #${sale?.invoiceNumber || refund.saleId || String(refund.id).substring(0, 8)}`;

            if (netSalesReversal > 0) {
                lines.push({
                    accountId: accVentas.id,
                    description: `Reverso Ingreso ${refLabel}`,
                    debit: netSalesReversal,
                    credit: 0
                });
            }
            if (taxRefund > 0) {
                if (!accIvaDebito) throw new Error('Cuenta IVA Débito Fiscal (2.1.2.01.001) no encontrada para devolución.');
                lines.push({
                    accountId: accIvaDebito.id,
                    description: `Reverso IVA ${refLabel}`,
                    debit: taxRefund,
                    credit: 0
                });
            }
            if (igtfRefund > 0) {
                if (!accIgtf) throw new Error('Cuenta IGTF por Enterar (2.1.2.04.001) no encontrada para devolución.');
                lines.push({
                    accountId: accIgtf.id,
                    description: `Reverso IGTF ${refLabel}`,
                    debit: igtfRefund,
                    credit: 0
                });
            }

            let pms = [];
            if (Array.isArray(refund.paymentMethods)) pms = refund.paymentMethods;
            else if (typeof refund.paymentMethods === 'string') {
                try { pms = JSON.parse(refund.paymentMethods) || []; } catch (_) { pms = []; }
            }

            if (pms.length > 0) {
                let cashUsd = 0;
                let bankUsd = 0;
                let creditUsd = 0;
                for (const pm of pms) {
                    const mKey = String(pm.method || '').toLowerCase();
                    const cur = String(pm.currency || (mKey.includes('ves') || mKey.includes('bs') ? 'VES' : 'USD')).toUpperCase();
                    const rawAmt = precision.parseNumericInput(pm.amount);
                    const convUsd = precision.parseNumericInput(pm.convertedAmountUsd);
                    const eqUsd = convUsd > 0 ? convUsd : ((cur === 'VES' || cur === 'BS') && rate > 0 ? precision.divide(rawAmt, rate) : rawAmt);
                    if (mKey === 'fiado' || mKey === 'credit' || mKey === 'credit_usd') creditUsd = precision.add(creditUsd, eqUsd);
                    else if (this._isBankMethod(mKey)) bankUsd = precision.add(bankUsd, eqUsd);
                    else cashUsd = precision.add(cashUsd, eqUsd);
                }
                const sumPms = precision.add([cashUsd, bankUsd, creditUsd]);
                if (sumPms > 0) {
                    const scale = precision.divide(totalRefund, sumPms);
                    cashUsd = round2(precision.multiply(cashUsd, scale));
                    bankUsd = round2(precision.multiply(bankUsd, scale));
                    creditUsd = round2(precision.subtract(totalRefund, precision.add(cashUsd, bankUsd)));
                } else {
                    cashUsd = totalRefund;
                }
                if (cashUsd > 0) lines.push({ accountId: accCaja.id, description: `Reembolso Efectivo ${refLabel}`, debit: 0, credit: cashUsd });
                if (bankUsd > 0) {
                    if (!accBanco) throw new Error('Cuenta Bancos (1.1.1.02.001) no encontrada para reembolso bancario.');
                    lines.push({ accountId: accBanco.id, description: `Reembolso Bancos ${refLabel}`, debit: 0, credit: bankUsd });
                }
                if (creditUsd > 0) {
                    if (!accCxC) throw new Error('Cuenta CxC (1.1.2.01.001) no encontrada para abono crédito en devolución.');
                    lines.push({ accountId: accCxC.id, description: `Reverso CxC ${refLabel}`, debit: 0, credit: creditUsd });
                }
            } else {
                const isCreditSale = sale?.paymentStatus === 'pending' || sale?.paymentStatus === 'credit' || sale?.paymentStatus === 'unpaid';
                const isBankSale = this._isBankMethod(sale?.paymentMethod);
                const accOut = isCreditSale ? accCxC : (isBankSale ? accBanco : accCaja);
                lines.push({ accountId: accOut.id, description: `Salida ${refLabel}`, debit: 0, credit: totalRefund });
            }

            if (returnedCost > 0 && !refund.isQuarantine) {
                if (!accCostoVenta || !accInventario) {
                    throw new Error('Cuentas CMV / Inventario no encontradas para reingreso por devolución.');
                }
                lines.push({ accountId: accInventario.id, description: `Reingreso Inventario ${refLabel}`, debit: returnedCost, credit: 0 });
                lines.push({ accountId: accCostoVenta.id, description: `Reverso CMV ${refLabel}`, debit: 0, credit: returnedCost });
            }

            return await this.createEntry({
                companyId,
                entryDate: refund.date ? String(refund.date).split('T')[0] : new Date().toISOString().split('T')[0],
                description: refLabel,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                exchangeRate: rate,
                referenceType: 'REFUND',
                referenceId: refund.id,
                userId: refund.userId || null,
                lines,
                transaction
            });
        } catch (err) {
            console.error('[Accounting] Error al generar asiento de devolución:', err.message);
            throw err;
        }
    }

    /**
     * Generador automático de Asiento Contable por Compra / Recepción de Mercancía
     */
    static async generatePurchaseEntry(purchase, companyId = 'default', transaction = null) {
        try {
            const round2 = (n) => precision.round(n || 0, 2);
            const total = round2(purchase.total);
            if (total <= 0) return null;

            const tax = round2(purchase.tax ?? purchase.iva ?? 0);
            const netInventory = round2(precision.subtract(total, tax));
            if (netInventory < 0) {
                throw new Error(`Descuadre en compra #${purchase.referenceNumber || purchase.id}: IVA (${tax}) excede total (${total}).`);
            }
            const rateRaw = precision.parseNumericInput(purchase.exchangeRate);
            const rate = rateRaw > 0 ? rateRaw : 1;

            let accInventario = await this.findAccountByCode('1.1.3.01.001', companyId, transaction);
            let accIvaCredito = await this.findAccountByCode('1.1.4.01.001', companyId, transaction);
            let accProveedores = await this.findAccountByCode('2.1.1.01.001', companyId, transaction);
            let accCaja = await this.findAccountByCode('1.1.1.01.001', companyId, transaction);
            let accBanco = await this.findAccountByCode('1.1.1.02.001', companyId, transaction);

            if (!accInventario || !accProveedores || !accCaja || !accBanco || (tax > 0 && !accIvaCredito)) {
                await this.seedDefaultChartOfAccounts(companyId, transaction);
                accInventario = accInventario || await this.findAccountByCode('1.1.3.01.001', companyId, transaction);
                accIvaCredito = accIvaCredito || await this.findAccountByCode('1.1.4.01.001', companyId, transaction);
                accProveedores = accProveedores || await this.findAccountByCode('2.1.1.01.001', companyId, transaction);
                accCaja = accCaja || await this.findAccountByCode('1.1.1.01.001', companyId, transaction);
                accBanco = accBanco || await this.findAccountByCode('1.1.1.02.001', companyId, transaction);
            }

            if (!accInventario || !accProveedores) {
                throw new Error('Cuentas de Inventario (1.1.3.01.001) o Proveedores (2.1.1.01.001) no encontradas.');
            }

            const ref = `Compra #${purchase.referenceNumber || String(purchase.id).substring(0, 8)}`;
            const lines = [];
            if (netInventory > 0) {
                lines.push({ accountId: accInventario.id, description: `Ingreso Inventario ${ref}`, debit: netInventory, credit: 0 });
            }
            if (tax > 0) {
                if (!accIvaCredito) throw new Error('Cuenta IVA Crédito Fiscal (1.1.4.01.001) no encontrada.');
                lines.push({ accountId: accIvaCredito.id, description: `IVA Crédito Fiscal ${ref}`, debit: tax, credit: 0 });
            }

            const isPaid = String(purchase.paymentStatus || '').toLowerCase() === 'paid';
            const accHaber = isPaid
                ? (this._isBankMethod(purchase.paymentMethod) ? accBanco : accCaja)
                : accProveedores;

            lines.push({
                accountId: accHaber.id,
                description: isPaid ? `Pago ${ref}` : `Cuenta por Pagar ${ref}`,
                debit: 0,
                credit: total
            });

            return await this.createEntry({
                companyId,
                entryDate: purchase.date ? String(purchase.date).split('T')[0] : new Date().toISOString().split('T')[0],
                description: `Contabilización ${ref}`,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                exchangeRate: rate,
                referenceType: 'PURCHASE',
                referenceId: purchase.id,
                userId: purchase.userId || null,
                lines,
                transaction
            });
        } catch (err) {
            console.error('[Accounting] Error al generar asiento de compra:', err.message);
            throw err;
        }
    }

    /**
     * Generador automático de Asiento Contable por Merma / Baja de Inventario (PUC NIIF)
     * Débito: 6.1.7.01.001 (Pérdidas por Mermas y Averías de Inventario)
     * Crédito: 1.1.3.01.001 (Inventario de Mercancías para la Venta)
     */
    static async recordWasteMovement({
        companyId = 'default',
        product,
        quantityBaseUnits,
        reason = 'merma',
        notes = '',
        responsibleName = '',
        userId = null,
        movementId = null,
        transaction = null
    }) {
        try {
            const costPerUnit = precision.parseNumericInput(product?.cost);
            const totalCost = precision.round(precision.multiply(costPerUnit, quantityBaseUnits), 2);
            if (totalCost <= 0) return null;

            // 1. Buscar o inicializar la cuenta de gasto por mermas (6.1.7.01.001)
            let accGastoMerma = await this.findAccountByCode('6.1.7.01.001', companyId, transaction);
            if (!accGastoMerma) {
                accGastoMerma = await AccountCatalog.create({
                    id: generateRobustId(),
                    companyId,
                    code: '6.1.7.01.001',
                    name: 'Pérdidas por Mermas y Averías de Inventario',
                    accountType: 'EXPENSE',
                    nature: 'DEBIT',
                    level: 5,
                    isSelectable: true
                }, { transaction: transaction || undefined });
            }

            // 2. Buscar la cuenta de inventario (1.1.3.01.001)
            let accInventario = await this.findAccountByCode('1.1.3.01.001', companyId, transaction);
            if (!accInventario) {
                await this.seedDefaultChartOfAccounts(companyId, transaction);
                accInventario = await this.findAccountByCode('1.1.3.01.001', companyId, transaction)
                    || await AccountCatalog.findOne({
                        where: { companyId, code: { [Op.like]: '1.1.3%' }, isSelectable: true },
                        transaction: transaction || undefined
                    });
            }

            if (!accInventario) {
                throw new Error('Cuenta contable de inventario (1.1.3.01.001) no encontrada para registrar merma.');
            }

            const description = `Baja de Inventario por Merma: ${product?.name || 'Producto'} (${quantityBaseUnits} unds - Motivo: ${reason})${notes ? ' - ' + notes : ''}`;

            const lines = [
                {
                    accountId: accGastoMerma.id,
                    description: `Pérdida por Merma/Avería: ${product?.name || ''}`,
                    debit: totalCost,
                    credit: 0
                },
                {
                    accountId: accInventario.id,
                    description: `Descarga de Inventario: ${product?.name || ''}`,
                    debit: 0,
                    credit: totalCost
                }
            ];

            return await this.createEntry({
                companyId,
                entryDate: new Date().toISOString().split('T')[0],
                description,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                exchangeRate: 1,
                referenceType: 'WASTE',
                referenceId: movementId || product?.id,
                userId,
                lines,
                transaction
            });
        } catch (err) {
            console.error('[Accounting] Error al generar asiento de merma:', err.message);
            if (transaction) throw err;
            return null;
        }
    }


    /**
     * Libro Diario con filtros y detalles de líneas
     */
    static async getJournalEntries({ companyId = 'default', startDate, endDate, entryType, limit = 50, offset = 0 }) {
        const where = { companyId };
        if (startDate && endDate) {
            where.entryDate = { [Op.between]: [startDate, endDate] };
        } else if (startDate) {
            where.entryDate = { [Op.gte]: startDate };
        } else if (endDate) {
            where.entryDate = { [Op.lte]: endDate };
        }
        if (entryType) {
            where.entryType = entryType;
        }

        const { count, rows } = await JournalEntry.findAndCountAll({
            where,
            include: [
                {
                    model: JournalEntryLine,
                    as: 'Lines',
                    include: [
                        {
                            model: AccountCatalog,
                            as: 'Account',
                            attributes: ['id', 'code', 'name', 'accountType', 'nature']
                        }
                    ]
                }
            ],
            order: [['entryDate', 'DESC'], ['entryNumber', 'DESC']],
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0
        });

        return { total: count, entries: rows };
    }

    /**
     * Libro Mayor de una cuenta
     */
    static async getGeneralLedger(accountId, { companyId = 'default', startDate, endDate }) {
        const account = await AccountCatalog.findOne({ where: { id: accountId, companyId } });
        if (!account) throw new Error('Cuenta contable no encontrada');

        const lineWhere = { accountId };
        const entryWhere = { companyId };

        if (startDate && endDate) {
            entryWhere.entryDate = { [Op.between]: [startDate, endDate] };
        }

        const lines = await JournalEntryLine.findAll({
            where: lineWhere,
            include: [
                {
                    model: JournalEntry,
                    as: 'Entry',
                    where: entryWhere,
                    attributes: ['id', 'entryNumber', 'entryDate', 'description', 'referenceType']
                }
            ],
            order: [[{ model: JournalEntry, as: 'Entry' }, 'entryDate', 'ASC']]
        });

        let runningBalance = 0;
        const movements = lines.map(line => {
            const debit = precision.round(line.debit || 0, 2);
            const credit = precision.round(line.credit || 0, 2);

            const movementDelta = account.nature === 'DEBIT'
                ? precision.subtract(debit, credit)
                : precision.subtract(credit, debit);
            runningBalance = precision.round(precision.add(runningBalance, movementDelta), 2);

            return {
                id: line.id,
                entryNumber: line.Entry?.entryNumber,
                entryDate: line.Entry?.entryDate,
                description: line.description || line.Entry?.description,
                debit,
                credit,
                runningBalance
            };
        });

        return {
            account: {
                id: account.id,
                code: account.code,
                name: account.name,
                nature: account.nature,
                accountType: account.accountType,
                finalBalanceUSD: account.balanceUSD,
                finalBalanceVES: account.balanceVES
            },
            movements
        };
    }

    /**
     * Calcula el mapa de ajustes históricos para obtener saldos exactos a una fecha de corte (asOfDate)
     */
    static async _getPostDateDeltasMap(companyId, asOfDate) {
        const deltaMap = {};
        if (!asOfDate) return deltaMap;

        const postEntries = await JournalEntry.findAll({
            where: {
                companyId,
                status: 'POSTED',
                entryDate: { [Op.gt]: asOfDate }
            },
            include: [{ model: JournalEntryLine, as: 'Lines' }]
        });

        for (const entry of postEntries) {
            for (const line of (entry.Lines || [])) {
                if (!deltaMap[line.accountId]) {
                    deltaMap[line.accountId] = { debit: 0, credit: 0 };
                }
                deltaMap[line.accountId].debit = precision.add(deltaMap[line.accountId].debit, line.debit || 0);
                deltaMap[line.accountId].credit = precision.add(deltaMap[line.accountId].credit, line.credit || 0);
            }
        }
        return deltaMap;
    }

    /**
     * Balance de Comprobación (Sumas y Saldos)
     */
    static async getTrialBalance({ companyId = 'default', asOfDate }) {
        const dateFilter = asOfDate || new Date().toISOString().split('T')[0];

        const [accounts, postDeltas] = await Promise.all([
            AccountCatalog.findAll({
                where: { companyId, isSelectable: true, isActive: true },
                order: [['code', 'ASC']]
            }),
            this._getPostDateDeltasMap(companyId, asOfDate)
        ]);

        let totalDebits = 0;
        let totalCredits = 0;

        const report = accounts.map(acc => {
            let bal = precision.parseNumericInput(acc.balanceUSD);
            const post = postDeltas[acc.id];
            if (post) {
                const postDelta = acc.nature === 'DEBIT'
                    ? precision.subtract(post.debit, post.credit)
                    : precision.subtract(post.credit, post.debit);
                bal = precision.subtract(bal, postDelta);
            }
            bal = precision.round(bal, 2);

            let debitBalance = 0;
            let creditBalance = 0;

            if (acc.nature === 'DEBIT') {
                if (bal >= 0) debitBalance = bal;
                else creditBalance = Math.abs(bal);
            } else {
                if (bal >= 0) creditBalance = bal;
                else debitBalance = Math.abs(bal);
            }

            totalDebits = precision.add(totalDebits, debitBalance);
            totalCredits = precision.add(totalCredits, creditBalance);

            return {
                id: acc.id,
                code: acc.code,
                name: acc.name,
                nature: acc.nature,
                accountType: acc.accountType,
                debitBalance,
                creditBalance
            };
        });

        totalDebits = precision.round(totalDebits, 2);
        totalCredits = precision.round(totalCredits, 2);
        const difference = precision.round(Math.abs(precision.subtract(totalDebits, totalCredits)), 2);
        const isBalanced = difference < 0.01;

        return {
            asOfDate: dateFilter,
            accounts: report,
            totalDebits,
            totalCredits,
            difference,
            isBalanced
        };
    }

    /**
     * Balance de Situación Financiera (Balance General: Activo = Pasivo + Patrimonio)
     */
    static async getBalanceSheet({ companyId = 'default', asOfDate }) {
        const [accounts, postDeltas] = await Promise.all([
            AccountCatalog.findAll({
                where: { companyId, isSelectable: true, isActive: true },
                order: [['code', 'ASC']]
            }),
            this._getPostDateDeltasMap(companyId, asOfDate)
        ]);

        const assets = [];
        const liabilities = [];
        const equity = [];

        let totalAssets = 0;
        let totalLiabilities = 0;
        let totalEquity = 0;
        let totalRevenue = 0;
        let totalCost = 0;
        let totalExpense = 0;

        for (const acc of accounts) {
            let bal = precision.parseNumericInput(acc.balanceUSD);
            const post = postDeltas[acc.id];
            if (post) {
                const postDelta = acc.nature === 'DEBIT'
                    ? precision.subtract(post.debit, post.credit)
                    : precision.subtract(post.credit, post.debit);
                bal = precision.subtract(bal, postDelta);
            }
            bal = precision.round(bal, 2);

            if (acc.accountType === 'ASSET') {
                assets.push({ code: acc.code, name: acc.name, balance: bal });
                totalAssets = precision.add(totalAssets, acc.nature === 'DEBIT' ? bal : -bal);
            } else if (acc.accountType === 'LIABILITY') {
                liabilities.push({ code: acc.code, name: acc.name, balance: bal });
                totalLiabilities = precision.add(totalLiabilities, acc.nature === 'CREDIT' ? bal : -bal);
            } else if (acc.accountType === 'EQUITY') {
                equity.push({ code: acc.code, name: acc.name, balance: bal });
                totalEquity = precision.add(totalEquity, acc.nature === 'CREDIT' ? bal : -bal);
            } else if (acc.accountType === 'REVENUE') {
                totalRevenue = precision.add(totalRevenue, acc.nature === 'CREDIT' ? bal : -bal);
            } else if (acc.accountType === 'COST') {
                totalCost = precision.add(totalCost, acc.nature === 'DEBIT' ? bal : -bal);
            } else if (acc.accountType === 'EXPENSE') {
                totalExpense = precision.add(totalExpense, acc.nature === 'DEBIT' ? bal : -bal);
            }
        }

        // Incorporar el Resultado del Período / Ejercicio al Patrimonio
        const periodNetResult = precision.round(
            precision.subtract(totalRevenue, precision.add(totalCost, totalExpense)),
            2
        );
        if (Math.abs(periodNetResult) > 0.0001) {
            equity.push({
                code: '3.1.4.01.001',
                name: 'Resultado del Ejercicio Actual (Utilidad / Pérdida)',
                balance: periodNetResult
            });
            totalEquity = precision.add(totalEquity, periodNetResult);
        }

        totalAssets = precision.round(totalAssets, 2);
        totalLiabilities = precision.round(totalLiabilities, 2);
        totalEquity = precision.round(totalEquity, 2);
        const totalLiabilitiesAndEquity = precision.round(precision.add(totalLiabilities, totalEquity), 2);
        const discrepancy = precision.round(Math.abs(precision.subtract(totalAssets, totalLiabilitiesAndEquity)), 2);

        return {
            assets,
            liabilities,
            equity,
            totalAssets,
            totalLiabilities,
            totalEquity,
            totalLiabilitiesAndEquity,
            periodNetResult,
            isBalanced: discrepancy < 0.01,
            discrepancy
        };
    }
}

module.exports = AccountingEngineService;
