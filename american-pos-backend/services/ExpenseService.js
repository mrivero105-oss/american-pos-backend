const { Expense, AuditLog, CashShift } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');


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
            const methodKey = String(paymentMethod || 'cash').toLowerCase().trim();
            const isVesMethod = ['cash_bs', 'cash_ves', 'efectivo_bs', 'pago_movil', 'transfer_bs', 'ves', 'bs'].includes(methodKey) ||
                                methodKey.includes('_bs') || methodKey.includes('_ves') || methodKey.endsWith('bs');
            const expCurrency = (expenseData.currency || (isVesMethod ? 'VES' : 'USD')).toUpperCase();
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
                    physicalDrawerAmount = rawAmt;
                    usdAmount = Math.round((rawAmt / rate) * 100) / 100;
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
            const [updated] = await Expense.update(updateData, { where: { id, companyId }, transaction: t });

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
                if (updateData.amount !== undefined || updateData.nativeAmount !== undefined || updateData.description !== undefined) {
                    try {
                        const { CashMovement } = require('../database/models');
                        const updates = {};
                        const finalCur = (updateData.currency || updatedExpense.currency || 'USD').toUpperCase();
                        if (updateData.amount !== undefined || updateData.nativeAmount !== undefined) {
                            if (finalCur === 'VES' && parseFloat(updateData.nativeAmount) > 0) {
                                updates.amount = parseFloat(updateData.nativeAmount);
                            } else {
                                updates.amount = parseFloat(updateData.amount ?? updatedExpense.amount);
                            }
                            updates.currency = finalCur;
                        }
                        if (updateData.description !== undefined) updates.reason = `Gasto: ${updateData.description} [${id}]`;
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

                await this._logAudit(reqUser, 'EXPENSE_DELETE', `Eliminado gasto: ${expense.description}`, id, expense, null);
                return true;
            }
            return false;
        });
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
