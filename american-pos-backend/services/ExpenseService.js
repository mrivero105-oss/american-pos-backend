const { Expense, AuditLog, CashShift } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/VortexMathEngine');
const AccountingEngineService = require('./AccountingEngineService');


class ExpenseService {
    /**
     * Get all expenses with filters.
     */
    async getAllExpenses(companyId, queryParams) {
        const { startDate, endDate, category } = queryParams;
        const whereClause = { companyId };

        if (startDate && endDate) {
            whereClause.date = {
                [Op.between]: [startDate, endDate]
            };
        }

        if (category) {
            whereClause.category = category;
        }

        return await Expense.findAll({
            where: whereClause,
            order: [['date', 'DESC'], ['createdAt', 'DESC']]
        });
    }

    /**
     * Get summary of expenses (total amount).
     */
    async getSummary(companyId, queryParams) {
        const { date } = queryParams;
        const whereClause = { companyId };
        if (date) whereClause.date = date;

        const total = await Expense.sum('amount', { where: whereClause }) || 0;
        return { total };
    }

    /**
     * Create a new expense with audit and optional cash deduction.
     */
    async createExpense(reqUser, expenseData) {
        const { id: userId, companyId } = reqUser;
        const { amount, nativeAmount, exchangeRate, description, category, date, paymentMethod, deductFromCash, invoiceUrl } = expenseData;

        return await sequelize.transaction(async (t) => {
            const methodKey = String(paymentMethod || 'cash')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '_');
            const isVesMethod = ['cash_bs', 'cash_ves', 'efectivo_bs', 'pago_movil', 'pagomovil', 'transfer_bs', 'biopago', 'ves', 'bs'].includes(methodKey) ||
                                methodKey.includes('_bs') || methodKey.includes('_ves') || methodKey.endsWith('bs');
            const rawCur = String(expenseData.currency || (isVesMethod ? 'VES' : 'USD'))
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase()
                .trim();
            const expCurrency = ['VES', 'BS', 'BS.', 'BSF', 'BOLIVARES'].includes(rawCur) ? 'VES' : rawCur;
            const resolvedMethodId = paymentMethod || (expCurrency === 'VES' ? 'cash_bs' : 'cash');

            const rawAmt = parseFloat(amount) || 0;
            const rate = parseFloat(exchangeRate) > 0 ? parseFloat(exchangeRate) : 1;
            let usdAmount = rawAmt;
            let physicalDrawerAmount = rawAmt;

            if (expCurrency === 'VES') {
                if (parseFloat(nativeAmount) > 0) {
                    // Frontend envió amount normalizado en USD y nativeAmount en Bolívares
                    usdAmount = rawAmt;
                    physicalDrawerAmount = parseFloat(nativeAmount);
                } else if (rate > 1) {
                    // API directa envió monto en Bolívares + tasa de cambio
                    physicalDrawerAmount = precision.round(rawAmt, 2);
                    usdAmount = precision.round(precision.divide(rawAmt, rate), 2);
                }
            }

            const newExpense = await Expense.create({
                id: generateRobustId(),
                userId: String(userId),
                companyId,
                amount: usdAmount,
                currency: expCurrency,
                description,
                category: category || 'General',
                date: date || new Date().toISOString().split('T')[0],
                paymentMethod: resolvedMethodId,
                invoiceUrl: invoiceUrl || null
            }, { transaction: t });

            // If user wants to deduct from open cash drawer (explicitly or via cash methods)
            const isCashExpense = deductFromCash !== undefined
                ? Boolean(deductFromCash)
                : (methodKey.includes('cash') || methodKey.includes('efectivo'));

            if (isCashExpense) {
                const { CashMovement } = require('../database/models');
                let currentShift = await CashShift.findOne({
                    where: { userId: String(userId), status: 'open', companyId },
                    order: [['openedAt', 'DESC']],
                    transaction: t
                });

                if (!currentShift) {
                    currentShift = await CashShift.findOne({
                        where: { status: 'open', companyId },
                        order: [['openedAt', 'DESC']],
                        transaction: t
                    });
                }

                if (currentShift) {
                    await CashMovement.create({
                        id: generateRobustId(),
                        shiftId: currentShift.id,
                        userId: String(userId),
                        companyId,
                        type: 'expense',
                        category: 'EXPENSE',
                        amount: physicalDrawerAmount,
                        currency: expCurrency,
                        paymentMethodId: resolvedMethodId,
                        reason: `Gasto: ${description} [${newExpense.id}]`,
                        timestamp: new Date().toISOString()
                    }, { transaction: t });
                }
            }

            await AccountingEngineService.generateExpenseEntry(newExpense, companyId, t);

            await this._logAudit(reqUser, 'EXPENSE_CREATE', `Gasto registrado: ${description} ($${usdAmount} USD / ${physicalDrawerAmount} ${expCurrency})`, newExpense.id, null, newExpense, t);

            return newExpense;
        });
    }

    /**
     * Update an expense with diff auditing.
     */
    async updateExpense(reqUser, id, updateData) {
        const { companyId } = reqUser;
        return await sequelize.transaction(async (t) => {
            const expense = await Expense.findOne({ where: { id, companyId }, transaction: t });
            if (!expense) throw new Error('Gasto no encontrado');

            const oldValues = expense.toJSON();
            const normalizedUpdate = { ...updateData };
            if (normalizedUpdate.currency) {
                const rawUpdCur = String(normalizedUpdate.currency)
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toUpperCase()
                    .trim();
                normalizedUpdate.currency = ['VES', 'BS', 'BS.', 'BSF', 'BOLIVARES'].includes(rawUpdCur) ? 'VES' : rawUpdCur;
                const updRate = parseFloat(normalizedUpdate.exchangeRate) > 0 ? parseFloat(normalizedUpdate.exchangeRate) : 1;
                if (normalizedUpdate.currency === 'VES' && normalizedUpdate.amount !== undefined && !(parseFloat(normalizedUpdate.nativeAmount) > 0) && updRate > 1) {
                    const rawUpdAmt = parseFloat(normalizedUpdate.amount) || 0;
                    normalizedUpdate.nativeAmount = precision.round(rawUpdAmt, 2);
                    normalizedUpdate.amount = precision.round(precision.divide(rawUpdAmt, updRate), 2);
                }
            }
            const [updated] = await Expense.update(normalizedUpdate, { where: { id, companyId }, transaction: t });

            if (updated) {
                const updatedExpense = await Expense.findOne({ where: { id, companyId }, transaction: t });
                const changes = this._getDiff(oldValues, updatedExpense.toJSON());
                
                if (changes.length > 0) {
                    await this._logAudit(
                        reqUser, 
                        'EXPENSE_UPDATE', 
                        `Actualizado gasto: ${changes.join(', ')}`, 
                        id, 
                        oldValues, 
                        updatedExpense,
                        t
                    );
                }

                // Sincronizar con CashMovement si cambió el monto, moneda o descripción
                if (normalizedUpdate.amount !== undefined || normalizedUpdate.nativeAmount !== undefined || normalizedUpdate.description !== undefined) {
                    try {
                        const { CashMovement } = require('../database/models');
                        const updates = {};
                        const finalCur = (normalizedUpdate.currency || updatedExpense.currency || 'USD').toUpperCase();
                        if (normalizedUpdate.amount !== undefined || normalizedUpdate.nativeAmount !== undefined) {
                            if (finalCur === 'VES' && parseFloat(normalizedUpdate.nativeAmount) > 0) {
                                updates.amount = parseFloat(normalizedUpdate.nativeAmount);
                            } else {
                                updates.amount = parseFloat(normalizedUpdate.amount ?? updatedExpense.amount);
                            }
                            updates.currency = finalCur;
                        }
                        if (normalizedUpdate.description !== undefined) updates.reason = `Gasto: ${normalizedUpdate.description} [${id}]`;
                        await CashMovement.update(updates, {
                            where: {
                                companyId,
                                type: 'expense',
                                reason: { [Op.like]: `%[${id}]%` }
                            },
                            transaction: t
                        });
                    } catch (e) {
                        console.warn('[ExpenseService] Error al actualizar CashMovement asociado:', e.message);
                    }
                }

                return updatedExpense;
            }
            return null;
        });
    }

    /**
     * Delete an expense.
     */
    async deleteExpense(reqUser, id) {
        const { companyId } = reqUser;
        return await sequelize.transaction(async (t) => {
            const expense = await Expense.findOne({ where: { id, companyId }, transaction: t });
            if (!expense) return false;

            const deleted = await Expense.destroy({ where: { id, companyId }, transaction: t });
            if (deleted) {
                // Eliminar movimiento de caja asociado para mantener el arqueo exacto
                try {
                    const { CashMovement } = require('../database/models');
                    await CashMovement.destroy({
                        where: {
                            companyId,
                            type: 'expense',
                            reason: { [Op.like]: `%[${id}]%` }
                        },
                        transaction: t
                    });
                } catch (e) {
                    console.warn('[ExpenseService] Error al eliminar CashMovement asociado:', e.message);
                }

                await this._logAudit(reqUser, 'EXPENSE_DELETE', `Eliminado gasto: ${expense.description}`, id, expense, null, t);
                return true;
            }
            return false;
        });
    }

    /**
     * Sync batch of offline mobile expenses idempotently.
     */
    async syncExpenses(reqUser, expenses = []) {
        const synced = [];
        const failed = [];
        const list = Array.isArray(expenses) ? expenses : [];

        for (const item of list) {
            try {
                if (!item || !item.description) {
                    failed.push({ id: item?.id || null, error: 'Descripción obligatoria' });
                    continue;
                }
                const existing = item.id && !String(item.id).startsWith('exp_off_') && !String(item.id).startsWith('local-')
                    ? await Expense.findOne({ where: { id: String(item.id), companyId: reqUser.companyId } })
                    : null;

                if (existing) {
                    synced.push({ localId: item.id, id: existing.id, action: 'skipped_existing' });
                    continue;
                }

                const created = await this.createExpense(reqUser, {
                    ...item,
                    amount: item.amount ?? item.monto
                });
                synced.push({ localId: item.id || null, id: created.id, action: 'created' });
            } catch (err) {
                failed.push({ id: item?.id || null, error: err.message });
            }
        }

        return { syncedCount: synced.length, synced, failed };
    }

    /**
     * Helper to get diff between objects.
     */
    _getDiff(oldObj, newObj) {
        const changes = [];
        const fieldsToAudit = ['amount', 'description', 'category', 'date', 'paymentMethod'];

        fieldsToAudit.forEach(field => {
            if (newObj[field] !== undefined && String(oldObj[field]) !== String(newObj[field])) {
                changes.push(`${field}: ${oldObj[field] || 'N/A'} -> ${newObj[field]}`);
            }
        });
        return changes;
    }

    /**
     * Helper to log audits.
     */
    async _logAudit(reqUser, action, description, entityId, oldValue, newValue, transaction = null) {
        try {
            const options = transaction ? { transaction } : {};
            await AuditLog.create({
                id: generateRobustId(),
                userId: reqUser.id,
                companyId: reqUser.companyId,
                action,
                description,
                entityId,
                oldValue: oldValue ? JSON.stringify(oldValue) : null,
                newValue: newValue ? JSON.stringify(newValue) : null,
                timestamp: new Date().toISOString()
            }, options);
        } catch (error) {
            console.error('Audit log error:', error);
        }
    }
}

module.exports = new ExpenseService();
