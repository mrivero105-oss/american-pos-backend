const { sequelize, AccountCatalog, JournalEntry, JournalEntryLine, User } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');

class AccountingEngineService {
    /**
     * Alias de compatibilidad para inicializar catálogo
     */
    static async seedDefaultCatalog(companyId = 'default') {
        return this.seedDefaultChartOfAccounts(companyId);
    }

    /**
     * Siembra el catálogo contable base (PUC estándar para Venezuela / NIIF)
     */
    static async seedDefaultChartOfAccounts(companyId = 'default') {
        const count = await AccountCatalog.count({ where: { companyId } });
        if (count > 0) {
            return { success: true, message: 'El catálogo ya contiene cuentas registradas.', count };
        }

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

        const created = [];
        for (const acc of defaultAccounts) {
            const item = await AccountCatalog.create({
                id: generateRobustId(),
                companyId,
                ...acc
            });
            created.push(item);
        }

        return { success: true, message: `Se sembraron ${created.length} cuentas en el PUC.`, count: created.length };
    }

    /**
     * Busca una cuenta por su código contable
     */
    static async findAccountByCode(code, companyId = 'default') {
        return await AccountCatalog.findOne({ where: { code, companyId } });
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

        const dateStr = entryDate || new Date().toISOString().split('T')[0];
        const year = dateStr.substring(0, 4);

        // Validar sumatorias de Debe y Haber
        let sumDebit = 0;
        let sumCredit = 0;

        for (const line of lines) {
            const d = parseFloat(line.debit) || 0;
            const c = parseFloat(line.credit) || 0;
            sumDebit += d;
            sumCredit += c;
        }

        const diff = Math.abs(sumDebit - sumCredit);
        if (diff > 0.005) {
            throw new Error(`Asiento descuadrado: Debe ($${sumDebit.toFixed(2)}) != Haber ($${sumCredit.toFixed(2)}). Diferencia: $${diff.toFixed(2)}.`);
        }

        // Generar correlativo
        const countEntries = await JournalEntry.count({
            where: {
                companyId,
                entryDate: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] }
            },
            transaction: transaction || undefined
        });
        const entryNumber = `AS-${year}-${String(countEntries + 1).padStart(5, '0')}`;

        const executeOperations = async (t) => {
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
                exchangeRate: parseFloat(exchangeRate) || 1,
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

                const debitVal = parseFloat(line.debit) || 0;
                const creditVal = parseFloat(line.credit) || 0;

                await JournalEntryLine.create({
                    id: generateRobustId(),
                    journalEntryId: entryId,
                    accountId: line.accountId,
                    description: line.description || description || '',
                    debit: debitVal,
                    credit: creditVal,
                    lineOrder: line._origIdx + 1
                }, { transaction: t });

                // Actualizar saldos acumulados de la cuenta
                const rate = parseFloat(exchangeRate) || 1;
                let deltaUSD = 0;
                if (account.nature === 'DEBIT') {
                    deltaUSD = debitVal - creditVal;
                } else {
                    deltaUSD = creditVal - debitVal;
                }

                const newBalanceUSD = (parseFloat(account.balanceUSD) || 0) + deltaUSD;
                const newBalanceVES = (parseFloat(account.balanceVES) || 0) + (deltaUSD * rate);

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
    static async generateSaleEntry(sale, companyId = 'default') {
        try {
            const total = parseFloat(sale.total) || 0;
            if (total <= 0) return null;

            const tax = parseFloat(sale.tax) || 0;
            const discount = parseFloat(sale.discount) || 0;
            const igtf = parseFloat(sale.igtfAmount) || 0;
            const subtotal = parseFloat(sale.subtotal) || (total - tax - igtf + discount);
            const rate = parseFloat(sale.exchangeRate) || 1;

            // Calcular Costo de Mercancía Vendida (CMV) si hay items
            let totalCost = 0;
            if (Array.isArray(sale.SaleItems)) {
                totalCost = sale.SaleItems.reduce((acc, item) => {
                    const c = parseFloat(item.cost) || 0;
                    const q = parseFloat(item.quantity) || 1;
                    return acc + (c * q);
                }, 0);
            }

            // Buscar cuentas (auto-inicializando el catálogo NIIF si aún no existe para la empresa)
            let accCaja = await this.findAccountByCode('1.1.1.01.001', companyId);
            if (!accCaja) {
                await this.seedDefaultChartOfAccounts(companyId);
                accCaja = await this.findAccountByCode('1.1.1.01.001', companyId);
            }
            const accBanco = await this.findAccountByCode('1.1.1.02.001', companyId);
            const accCxC = await this.findAccountByCode('1.1.2.01.001', companyId);
            const accVentas = await this.findAccountByCode('4.1.1.01.001', companyId);
            const accIvaDebito = await this.findAccountByCode('2.1.2.01.001', companyId);
            const accIgtf = await this.findAccountByCode('2.1.2.04.001', companyId);
            const accDescuentos = await this.findAccountByCode('4.1.2.01.001', companyId);
            const accCostoVenta = await this.findAccountByCode('5.1.1.01.001', companyId);
            const accInventario = await this.findAccountByCode('1.1.3.01.001', companyId);

            if (!accCaja || !accVentas) {
                console.warn('[Accounting] No se encontraron las cuentas básicas de venta. Omitiendo asiento.');
                return null;
            }

            const isCredit = sale.paymentStatus === 'pending' || sale.paymentStatus === 'credit' || sale.paymentStatus === 'unpaid';
            const lines = [];
            const invRef = `Venta Factura #${sale.invoiceNumber || String(sale.id).substring(0, 8)}`;

            // 1. Debe: Desglose entre Efectivo (Caja), Medios Bancarios (POS/Transferencia/Pago Móvil/Zelle) y Crédito (CxC)
            let pms = [];
            if (Array.isArray(sale.paymentMethods)) {
                pms = sale.paymentMethods;
            } else if (typeof sale.paymentMethods === 'string') {
                try { pms = JSON.parse(sale.paymentMethods) || []; } catch (e) {}
            }

            if (isCredit && accCxC && pms.length <= 1) {
                lines.push({
                    accountId: accCxC.id,
                    description: invRef,
                    debit: total,
                    credit: 0
                });
            } else if (pms.length > 0 && accBanco) {
                let cashUsd = 0;
                let bankUsd = 0;
                let creditUsd = 0;

                for (const pm of pms) {
                    const mKey = String(pm.method || '').toLowerCase();
                    const cur = String(pm.currency || (mKey.includes('ves') || mKey.includes('bs') ? 'VES' : 'USD')).toUpperCase();
                    const rawAmt = parseFloat(pm.amount) || 0;
                    const eqUsd = parseFloat(pm.convertedAmountUsd) > 0
                        ? parseFloat(pm.convertedAmountUsd)
                        : (cur === 'VES' && rate > 0 ? (rawAmt / rate) : rawAmt);

                    if (mKey === 'fiado' || mKey === 'credit') {
                        creditUsd += eqUsd;
                    } else if (['card', 'pos', 'punto', 'pago_movil', 'pagomovil', 'transfer', 'zelle', 'biopago', 'binance'].some(k => mKey.includes(k))) {
                        bankUsd += eqUsd;
                    } else {
                        cashUsd += eqUsd;
                    }
                }

                const sumBreakdown = cashUsd + bankUsd + creditUsd;
                const scale = sumBreakdown > 0 ? (total / sumBreakdown) : 1;
                cashUsd = Math.round(cashUsd * scale * 100) / 100;
                bankUsd = Math.round(bankUsd * scale * 100) / 100;
                creditUsd = Math.round((total - cashUsd - bankUsd) * 100) / 100;

                if (cashUsd > 0) lines.push({ accountId: accCaja.id, description: `${invRef} (Efectivo)`, debit: cashUsd, credit: 0 });
                if (bankUsd > 0) lines.push({ accountId: accBanco.id, description: `${invRef} (Bancos/Digital)`, debit: bankUsd, credit: 0 });
                if (creditUsd > 0) lines.push({ accountId: (accCxC || accCaja).id, description: `${invRef} (CxC)`, debit: creditUsd, credit: 0 });
            } else {
                const mKey = String(sale.paymentMethod || 'cash').toLowerCase();
                const isBankMethod = accBanco && ['card', 'pos', 'punto', 'pago_movil', 'pagomovil', 'transfer', 'zelle', 'biopago', 'binance'].some(k => mKey.includes(k));
                const accReceiving = isCredit && accCxC ? accCxC : (isBankMethod ? accBanco : accCaja);
                lines.push({
                    accountId: accReceiving.id,
                    description: invRef,
                    debit: total,
                    credit: 0
                });
            }

            // Si hubo descuento, registrar al Debe
            if (discount > 0 && accDescuentos) {
                lines.push({
                    accountId: accDescuentos.id,
                    description: `Descuento concedido Factura #${sale.invoiceNumber || sale.id.substring(0, 8)}`,
                    debit: discount,
                    credit: 0
                });
            }

            // 2. Haber: Venta Bruta (subtotal ya representa el valor bruto de los renglones)
            const grossSale = subtotal;
            lines.push({
                accountId: accVentas.id,
                description: `Ingreso por Venta Factura #${sale.invoiceNumber || sale.id.substring(0, 8)}`,
                debit: 0,
                credit: grossSale
            });

            // 3. Haber: IVA Débito Fiscal si aplica
            if (tax > 0 && accIvaDebito) {
                lines.push({
                    accountId: accIvaDebito.id,
                    description: `IVA Débito Fiscal Factura #${sale.invoiceNumber || sale.id.substring(0, 8)}`,
                    debit: 0,
                    credit: tax
                });
            }

            // 3b. Haber: IGTF por Enterar (3%) si aplica
            if (igtf > 0 && accIgtf) {
                lines.push({
                    accountId: accIgtf.id,
                    description: `IGTF por Enterar Factura #${sale.invoiceNumber || sale.id.substring(0, 8)}`,
                    debit: 0,
                    credit: igtf
                });
            }

            // 4. Asiento de Costo de Venta si tenemos costo registrado
            if (totalCost > 0 && accCostoVenta && accInventario) {
                lines.push({
                    accountId: accCostoVenta.id,
                    description: `Costo de Mercancía Vendida Factura #${sale.invoiceNumber || sale.id.substring(0, 8)}`,
                    debit: totalCost,
                    credit: 0
                });
                lines.push({
                    accountId: accInventario.id,
                    description: `Descarga de Inventario Factura #${sale.invoiceNumber || sale.id.substring(0, 8)}`,
                    debit: 0,
                    credit: totalCost
                });
            }

            return await this.createEntry({
                companyId,
                entryDate: sale.date ? sale.date.split('T')[0] : new Date().toISOString().split('T')[0],
                description: `Contabilización Venta #${sale.invoiceNumber || sale.id.substring(0, 8)} - ${sale.customerName || 'Cliente General'}`,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                exchangeRate: rate,
                referenceType: 'SALE',
                referenceId: sale.id,
                userId: sale.userId,
                lines
            });
        } catch (err) {
            console.error('[Accounting] Error al generar asiento de venta:', err.message);
            return null;
        }
    }

    /**
     * Generador automático de Asiento Contable por Gasto
     */
    static async generateExpenseEntry(expense, companyId = 'default') {
        try {
            const amount = parseFloat(expense.amount) || 0;
            if (amount <= 0) return null;

            const accGasto = await this.findAccountByCode('6.1.2.01.001', companyId) || await this.findAccountByCode('6.1.1.01.001', companyId);
            const accCaja = await this.findAccountByCode('1.1.1.01.001', companyId);

            if (!accGasto || !accCaja) return null;

            const lines = [
                {
                    accountId: accGasto.id,
                    description: `Gasto: ${expense.description || expense.category || 'Operativo'}`,
                    debit: amount,
                    credit: 0
                },
                {
                    accountId: accCaja.id,
                    description: `Desembolso Gasto: ${expense.description || 'Operativo'}`,
                    debit: 0,
                    credit: amount
                }
            ];

            return await this.createEntry({
                companyId,
                entryDate: expense.date ? expense.date.split('T')[0] : new Date().toISOString().split('T')[0],
                description: `Contabilización Gasto: ${expense.description || expense.category || 'Operativo'}`,
                entryType: 'AUTOMATIC',
                currency: 'USD',
                referenceType: 'EXPENSE',
                referenceId: expense.id,
                lines
            });
        } catch (err) {
            console.error('[Accounting] Error al generar asiento de gasto:', err.message);
            return null;
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
            const costPerUnit = parseFloat(product?.cost || 0);
            const totalCost = parseFloat((costPerUnit * quantityBaseUnits).toFixed(4));
            if (totalCost <= 0) return null;

            // 1. Buscar o inicializar la cuenta de gasto por mermas (6.1.7.01.001)
            let accGastoMerma = await this.findAccountByCode('6.1.7.01.001', companyId);
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
            let accInventario = await this.findAccountByCode('1.1.3.01.001', companyId);
            if (!accInventario) {
                accInventario = await AccountCatalog.findOne({
                    where: { companyId, code: { [Op.like]: '1.1.3%' }, isSelectable: true },
                    transaction: transaction || undefined
                });
            }

            if (!accInventario) {
                console.warn('[Accounting] No se encontró cuenta de inventario para registrar asiento de merma.');
                return null;
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
            const debit = parseFloat(line.debit) || 0;
            const credit = parseFloat(line.credit) || 0;

            if (account.nature === 'DEBIT') {
                runningBalance += (debit - credit);
            } else {
                runningBalance += (credit - debit);
            }

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
                deltaMap[line.accountId].debit += parseFloat(line.debit) || 0;
                deltaMap[line.accountId].credit += parseFloat(line.credit) || 0;
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
            let bal = parseFloat(acc.balanceUSD) || 0;
            const post = postDeltas[acc.id];
            if (post) {
                const postDelta = acc.nature === 'DEBIT'
                    ? (post.debit - post.credit)
                    : (post.credit - post.debit);
                bal -= postDelta;
            }
            let debitBalance = 0;
            let creditBalance = 0;

            if (acc.nature === 'DEBIT') {
                if (bal >= 0) debitBalance = bal;
                else creditBalance = Math.abs(bal);
            } else {
                if (bal >= 0) creditBalance = bal;
                else debitBalance = Math.abs(bal);
            }

            totalDebits += debitBalance;
            totalCredits += creditBalance;

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

        const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

        return {
            asOfDate: dateFilter,
            accounts: report,
            totalDebits,
            totalCredits,
            difference: Math.abs(totalDebits - totalCredits),
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
            let bal = parseFloat(acc.balanceUSD) || 0;
            const post = postDeltas[acc.id];
            if (post) {
                const postDelta = acc.nature === 'DEBIT'
                    ? (post.debit - post.credit)
                    : (post.credit - post.debit);
                bal -= postDelta;
            }

            if (acc.accountType === 'ASSET') {
                assets.push({ code: acc.code, name: acc.name, balance: bal });
                totalAssets += (acc.nature === 'DEBIT' ? bal : -bal);
            } else if (acc.accountType === 'LIABILITY') {
                liabilities.push({ code: acc.code, name: acc.name, balance: bal });
                totalLiabilities += (acc.nature === 'CREDIT' ? bal : -bal);
            } else if (acc.accountType === 'EQUITY') {
                equity.push({ code: acc.code, name: acc.name, balance: bal });
                totalEquity += (acc.nature === 'CREDIT' ? bal : -bal);
            } else if (acc.accountType === 'REVENUE') {
                totalRevenue += (acc.nature === 'CREDIT' ? bal : -bal);
            } else if (acc.accountType === 'COST') {
                totalCost += (acc.nature === 'DEBIT' ? bal : -bal);
            } else if (acc.accountType === 'EXPENSE') {
                totalExpense += (acc.nature === 'DEBIT' ? bal : -bal);
            }
        }

        // Incorporar el Resultado del Período / Ejercicio al Patrimonio
        const periodNetResult = totalRevenue - (totalCost + totalExpense);
        if (Math.abs(periodNetResult) > 0.0001) {
            equity.push({
                code: '3.1.4.01.001',
                name: 'Resultado del Ejercicio Actual (Utilidad / Pérdida)',
                balance: periodNetResult
            });
            totalEquity += periodNetResult;
        }

        const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
        const discrepancy = Math.abs(totalAssets - totalLiabilitiesAndEquity);

        return {
            assets,
            liabilities,
            equity,
            totalAssets,
            totalLiabilities,
            totalEquity,
            totalLiabilitiesAndEquity,
            periodNetResult,
            isBalanced: discrepancy < 0.05,
            discrepancy
        };
    }
}

module.exports = AccountingEngineService;
