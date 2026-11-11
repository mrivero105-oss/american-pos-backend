const { BankAccount, BankTransaction, BankTransfer, ExchangeDifferenceLog, CashMovement, CashShift, AuditLog } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');

class BankingService {
    /**
     * List all bank accounts for a company with calculated balances.
     */
    async getAccounts(companyId) {
        return await BankAccount.findAll({
            where: { companyId, isActive: true },
            order: [['createdAt', 'ASC']]
        });
    }

    /**
     * Create a new bank account.
     */
    async createAccount(companyId, userId, data) {
        const { bankName, accountNumber, accountType, currency, initialBalance, accountHolder, holderIdDoc, phone, color } = data;
        const initialBal = Number(initialBalance) || 0;

        return await sequelize.transaction(async (t) => {
            const accountId = generateRobustId();
            const account = await BankAccount.create({
                id: accountId,
                companyId,
                bankName,
                accountNumber: accountNumber || '',
                accountType: accountType || 'CORRIENTE',
                currency: currency || 'VES',
                initialBalance: initialBal,
                currentBalance: initialBal,
                accountHolder: accountHolder || '',
                holderIdDoc: holderIdDoc || '',
                phone: phone || '',
                color: color || '#0284c7',
                isActive: true
            }, { transaction: t });

            // If there is an initial balance, log an initial transaction
            if (initialBal > 0) {
                await BankTransaction.create({
                    id: generateRobustId(),
                    companyId,
                    bankAccountId: accountId,
                    type: 'INGRESO',
                    amount: initialBal,
                    currency: currency || 'VES',
                    exchangeRate: 1.0,
                    referenceNumber: 'SALDO-INICIAL',
                    description: 'Saldo inicial de apertura de cuenta',
                    category: 'SALDO_INICIAL',
                    date: new Date().toISOString().split('T')[0],
                    status: 'CONCILIADO',
                    reconciledAt: new Date(),
                    reconciledBy: userId,
                    userId
                }, { transaction: t });
            }

            try {
                await AuditLog.create({
                    id: generateRobustId(),
                    userId,
                    action: 'CREATE_BANK_ACCOUNT',
                    details: JSON.stringify({ accountId, bankName, currency, initialBalance: initialBal }),
                    timestamp: new Date().toISOString(),
                    companyId
                }, { transaction: t });
            } catch (e) {}

            return account;
        });
    }

    /**
     * Update bank account information.
     */
    async updateAccount(companyId, userId, id, data) {
        const account = await BankAccount.findOne({ where: { id, companyId } });
        if (!account) throw new Error('Cuenta bancaria no encontrada');

        const { bankName, accountNumber, accountType, accountHolder, holderIdDoc, phone, color, isActive } = data;
        
        await account.update({
            bankName: bankName !== undefined ? bankName : account.bankName,
            accountNumber: accountNumber !== undefined ? accountNumber : account.accountNumber,
            accountType: accountType !== undefined ? accountType : account.accountType,
            accountHolder: accountHolder !== undefined ? accountHolder : account.accountHolder,
            holderIdDoc: holderIdDoc !== undefined ? holderIdDoc : account.holderIdDoc,
            phone: phone !== undefined ? phone : account.phone,
            color: color !== undefined ? color : account.color,
            isActive: isActive !== undefined ? isActive : account.isActive
        });

        return account;
    }

    /**
     * Deactivate a bank account (Soft Delete).
     */
    async deleteAccount(companyId, userId, id) {
        const account = await BankAccount.findOne({ where: { id, companyId } });
        if (!account) throw new Error('Cuenta bancaria no encontrada');

        await account.update({ isActive: false });
        return { success: true, message: 'Cuenta bancaria desactivada correctamente' };
    }

    /**
     * Get transactions with filtering and pagination.
     */
    async getTransactions(companyId, query) {
        const { bankAccountId, status, type, category, startDate, endDate, dateRange, search, limit = 100 } = query;
        const whereClause = { companyId };

        if (bankAccountId && bankAccountId !== 'ALL') {
            whereClause.bankAccountId = bankAccountId;
        }

        if (status && status !== 'ALL') {
            whereClause.status = status;
        }

        if (type && type !== 'ALL') {
            whereClause.type = type;
        }

        if (category && category !== 'ALL') {
            whereClause.category = category;
        }

        if (startDate && endDate) {
            whereClause.date = { [Op.between]: [startDate, endDate] };
        } else if (startDate) {
            whereClause.date = { [Op.gte]: startDate };
        } else if (endDate) {
            whereClause.date = { [Op.lte]: endDate };
        } else if (dateRange && dateRange !== 'all') {
            const now = new Date();
            const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            if (dateRange === 'today') {
                whereClause.date = todayStr;
            } else if (dateRange === 'this_month') {
                const startOfMonth = `${todayStr.substring(0, 7)}-01`;
                whereClause.date = { [Op.gte]: startOfMonth };
            } else if (dateRange === 'last_7_days' || dateRange === 'this_week') {
                const d = new Date(now.getTime() - (7 * 86400000) - (now.getTimezoneOffset() * 60000));
                whereClause.date = { [Op.gte]: d.toISOString().split('T')[0] };
            }
        }

        if (search) {
            whereClause[Op.or] = [
                { referenceNumber: { [Op.like]: `%${search}%` } },
                { description: { [Op.like]: `%${search}%` } }
            ];
        }

        return await BankTransaction.findAll({
            where: whereClause,
            include: [{ model: BankAccount, as: 'Account', attributes: ['bankName', 'accountNumber', 'currency', 'color'] }],
            order: [['date', 'DESC'], ['createdAt', 'DESC']],
            limit: parseInt(limit, 10)
        });
    }

    /**
     * Record a manual bank movement (Ingreso, Egreso, Comision).
     */
    async createManualTransaction(companyId, userId, data) {
        const { bankAccountId, type, amount, referenceNumber, description, category, date, notes } = data;
        const parsedAmount = Number(amount);
        if (!parsedAmount || parsedAmount <= 0) throw new Error('El monto debe ser mayor a cero');

        return await sequelize.transaction(async (t) => {
            const account = await BankAccount.findOne({ 
                where: { id: bankAccountId, companyId }, 
                lock: t.LOCK.UPDATE,
                transaction: t 
            });
            if (!account) throw new Error('Cuenta bancaria no encontrada');

            let currentBal = Number(account.currentBalance) || 0;
            const isIngreso = type === 'INGRESO' || type === 'TRANSFERENCIA_ENTRADA';
            
            if (isIngreso) {
                currentBal += parsedAmount;
            } else {
                currentBal -= parsedAmount;
            }

            await account.update({ currentBalance: currentBal }, { transaction: t });

            const transaction = await BankTransaction.create({
                id: generateRobustId(),
                companyId,
                bankAccountId,
                type,
                amount: parsedAmount,
                currency: account.currency,
                exchangeRate: 1.0,
                referenceNumber: referenceNumber || '',
                description: description || (isIngreso ? 'Depósito / Ingreso Bancario' : 'Retiro / Egreso Bancario'),
                category: category || 'MANUAL',
                date: date || new Date().toISOString().split('T')[0],
                status: 'PENDIENTE',
                userId,
                notes: notes || ''
            }, { transaction: t });

            return transaction;
        });
    }

    /**
     * Execute a transfer between two bank accounts or between cash drawer and bank.
     */
    async createTransfer(companyId, userId, transferData) {
        const {
            fromType, // 'BANK' or 'CASH_DRAWER'
            fromId,
            toType,   // 'BANK' or 'CASH_DRAWER'
            toId,
            amountSent,
            currencySent = 'VES',
            amountReceived,
            currencyReceived = 'VES',
            exchangeRate = 1.0,
            referenceNumber = '',
            notes = '',
            date
        } = transferData;

        const sent = Number(amountSent);
        const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1.0;
        if (sent <= 0) throw new Error('Los montos transferidos deben ser superiores a cero');

        const txDate = date || new Date().toISOString().split('T')[0];

        return await sequelize.transaction(async (t) => {
            let fromDesc = '';
            let toDesc = '';
            let fromAccount = null;
            let toAccount = null;

            // Adquirir locks en orden determinístico si ambos son cuentas bancarias
            if (fromType === 'BANK' && toType === 'BANK') {
                const ids = [String(fromId), String(toId)].sort();
                const lockedAccounts = [];
                for (const id of ids) {
                    const acc = await BankAccount.findOne({
                        where: { id, companyId },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                    if (acc) lockedAccounts.push(acc);
                }
                fromAccount = lockedAccounts.find(a => String(a.id) === String(fromId));
                toAccount = lockedAccounts.find(a => String(a.id) === String(toId));
            } else {
                if (fromType === 'BANK') {
                    fromAccount = await BankAccount.findOne({
                        where: { id: fromId, companyId },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                }
                if (toType === 'BANK') {
                    toAccount = await BankAccount.findOne({
                        where: { id: toId, companyId },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                }
            }

            if (fromType === 'BANK' && !fromAccount) throw new Error('Cuenta de origen bancaria no encontrada');
            if (toType === 'BANK' && !toAccount) throw new Error('Cuenta de destino bancaria no encontrada');

            const resolvedCurrencySent = (fromType === 'BANK' ? fromAccount.currency : (currencySent || 'VES')).toUpperCase();
            const resolvedCurrencyReceived = (toType === 'BANK' ? toAccount.currency : (currencyReceived || resolvedCurrencySent)).toUpperCase();

            // Conversión multimoneda automática si las monedas difieren y no se especificó un amountReceived distinto
            let received = Number(amountReceived);
            if (!received || received <= 0 || (resolvedCurrencySent !== resolvedCurrencyReceived && Math.abs(received - sent) < 0.001 && rate !== 1)) {
                if (resolvedCurrencySent === resolvedCurrencyReceived) {
                    received = sent;
                } else if (resolvedCurrencySent === 'USD' && resolvedCurrencyReceived === 'VES') {
                    received = Math.round(sent * rate * 100) / 100;
                } else if (resolvedCurrencySent === 'VES' && resolvedCurrencyReceived === 'USD') {
                    if (rate <= 0) throw new Error('Debe indicar una tasa de cambio válida para convertir de VES a USD');
                    received = Math.round((sent / rate) * 100) / 100;
                } else {
                    received = sent;
                }
            }
            if (received <= 0) throw new Error('El monto recibido calculado debe ser superior a cero');

            // Handle Origin
            if (fromType === 'BANK') {
                fromDesc = `${fromAccount.bankName} (${fromAccount.currency})`;
                
                const newBal = Number(fromAccount.currentBalance) - sent;
                await fromAccount.update({ currentBalance: newBal }, { transaction: t });

                await BankTransaction.create({
                    id: generateRobustId(),
                    companyId,
                    bankAccountId: fromId,
                    type: 'TRANSFERENCIA_SALIDA',
                    amount: sent,
                    currency: fromAccount.currency,
                    exchangeRate: rate,
                    referenceNumber,
                    description: `Transferencia enviada a ${toType === 'BANK' ? `${toAccount.bankName} (${toAccount.currency})` : 'Caja'}`,
                    category: 'TRANSFERENCIA',
                    date: txDate,
                    status: 'CONCILIADO',
                    userId,
                    notes
                }, { transaction: t });
            } else if (fromType === 'CASH_DRAWER') {
                // Deduct from cash movement
                fromDesc = 'Caja Chica / Punto de Venta';
                let resolvedShiftId = fromId;
                const existingShift = fromId ? await CashShift.findOne({ where: { id: fromId, companyId }, transaction: t }) : null;
                if (!existingShift) {
                    const activeShift = await CashShift.findOne({ where: { companyId, status: 'open' }, order: [['openedAt', 'DESC']], transaction: t });
                    if (activeShift) {
                        resolvedShiftId = activeShift.id;
                    } else {
                        throw new Error('No se puede transferir desde Caja: No hay un turno de caja abierto en el sistema.');
                    }
                }
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: resolvedShiftId,
                    userId,
                    companyId,
                    type: 'out',
                    amount: sent,
                    currency: resolvedCurrencySent,
                    paymentMethodId: resolvedCurrencySent === 'USD' ? 'cash' : 'cash_bs',
                    category: 'DEPOSITO_BANCO',
                    reason: `Depósito a banco Ref: ${referenceNumber || 'S/R'} - ${notes}`,
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            }

            // Handle Destination
            if (toType === 'BANK') {
                toDesc = `${toAccount.bankName} (${toAccount.currency})`;

                const newBal = Number(toAccount.currentBalance) + received;
                await toAccount.update({ currentBalance: newBal }, { transaction: t });

                await BankTransaction.create({
                    id: generateRobustId(),
                    companyId,
                    bankAccountId: toId,
                    type: 'TRANSFERENCIA_ENTRADA',
                    amount: received,
                    currency: toAccount.currency,
                    exchangeRate: rate,
                    referenceNumber,
                    description: `Transferencia recibida desde ${fromDesc}`,
                    category: 'TRANSFERENCIA',
                    date: txDate,
                    status: 'CONCILIADO',
                    userId,
                    notes
                }, { transaction: t });
            } else if (toType === 'CASH_DRAWER') {
                // Add into cash movement
                toDesc = 'Caja Chica / Punto de Venta';
                let resolvedShiftId = toId;
                const existingShift = toId ? await CashShift.findOne({ where: { id: toId, companyId }, transaction: t }) : null;
                if (!existingShift) {
                    const activeShift = await CashShift.findOne({ where: { companyId, status: 'open' }, order: [['openedAt', 'DESC']], transaction: t });
                    if (activeShift) {
                        resolvedShiftId = activeShift.id;
                    } else {
                        throw new Error('No se puede transferir hacia Caja: No hay un turno de caja abierto en el sistema.');
                    }
                }
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: resolvedShiftId,
                    userId,
                    companyId,
                    type: 'in',
                    amount: received,
                    currency: resolvedCurrencyReceived,
                    paymentMethodId: resolvedCurrencyReceived === 'USD' ? 'cash' : 'cash_bs',
                    category: 'RETIRO_BANCO',
                    reason: `Ingreso por retiro bancario Ref: ${referenceNumber || 'S/R'} - ${notes}`,
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            }

            const transferRecord = await BankTransfer.create({
                id: generateRobustId(),
                companyId,
                fromType,
                fromId: fromId || 'CASH_DRAWER',
                toType,
                toId: toId || 'CASH_DRAWER',
                amountSent: sent,
                currencySent: resolvedCurrencySent,
                amountReceived: received,
                currencyReceived: resolvedCurrencyReceived,
                exchangeRate: rate,
                referenceNumber,
                notes,
                userId,
                date: txDate
            }, { transaction: t });

            return transferRecord;
        });
    }

    /**
     * Mark a transaction as reconciled.
     */
    async reconcileTransaction(companyId, userId, transactionId, reconciled = true) {
        const tx = await BankTransaction.findOne({ where: { id: transactionId, companyId } });
        if (!tx) throw new Error('Transacción bancaria no encontrada');

        await tx.update({
            status: reconciled ? 'CONCILIADO' : 'PENDIENTE',
            reconciledAt: reconciled ? new Date() : null,
            reconciledBy: reconciled ? userId : null
        });

        return tx;
    }

    /**
     * Get Cash Flow Overview (Aggregated Bank balances + Open Cash shifts).
     */
    async getCashFlowSummary(companyId) {
        const accounts = await BankAccount.findAll({ where: { companyId, isActive: true } });
        
        let bankTotalVes = 0;
        let bankTotalUsd = 0;

        accounts.forEach(acc => {
            const bal = Number(acc.currentBalance) || 0;
            if (acc.currency === 'USD') bankTotalUsd += bal;
            else bankTotalVes += bal;
        });

        // Open shifts
        const openShifts = await CashShift.findAll({ where: { companyId, status: 'open' } });
        let cashDrawerTotalVes = 0;
        let cashDrawerTotalUsd = 0;

        openShifts.forEach(shift => {
            cashDrawerTotalUsd += Number(shift.currentCashUsd || shift.initialCashUsd || 0);
            cashDrawerTotalVes += Number(shift.currentCashBs || shift.initialCashBs || 0);
        });

        return {
            bankAccounts: accounts,
            totals: {
                banks: { ves: bankTotalVes, usd: bankTotalUsd },
                cashDrawers: { ves: cashDrawerTotalVes, usd: cashDrawerTotalUsd },
                consolidated: {
                    ves: bankTotalVes + cashDrawerTotalVes,
                    usd: bankTotalUsd + cashDrawerTotalUsd
                }
            }
        };
    }
}

module.exports = new BankingService();
