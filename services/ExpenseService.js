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
        const { amount, description, category, date, paymentMethod, deductFromCash } = expenseData;

        return await sequelize.transaction(async (t) => {
            const newExpense = await Expense.create({
                id: generateRobustId(),
                userId,
                companyId,
                amount: parseFloat(amount),
                description,
                category: category || 'General',
                date: date || new Date().toISOString().split('T')[0],
                paymentMethod: paymentMethod || 'cash'
            }, { transaction: t });

            // If user wants to deduct from open cash drawer (explicitly or via paymentMethod='cash')
            if (deductFromCash || paymentMethod === 'cash') {
                const { CashMovement } = require('../database/models');
                const currentShift = await CashShift.findOne({
                    where: { userId, status: 'open', companyId },
                    order: [['openedAt', 'DESC']],
                    transaction: t
                });

                if (currentShift) {
                    await CashMovement.create({
                        id: generateRobustId(),
                        shiftId: currentShift.id,
                        userId,
                        companyId,
                        type: 'expense',
                        amount: parseFloat(amount),
                        reason: `Gasto: ${description}`,
                        timestamp: new Date().toISOString()
                    }, { transaction: t });
                }
            }

            await this._logAudit(reqUser, 'EXPENSE_CREATE', `Gasto registrado: ${description} (${amount})`, newExpense.id, null, newExpense);
        


            return newExpense;
        });
    }

    /**
     * Update an expense with diff auditing.
     */
    async updateExpense(reqUser, id, updateData) {
        const { companyId } = reqUser;
        const expense = await Expense.findOne({ where: { id, companyId } });
        if (!expense) throw new Error('Gasto no encontrado');

        const oldValues = expense.toJSON();
        const [updated] = await Expense.update(updateData, { where: { id, companyId } });

        if (updated) {
            const updatedExpense = await Expense.findOne({ where: { id, companyId } });
            const changes = this._getDiff(oldValues, updatedExpense.toJSON());
            
            if (changes.length > 0) {
                await this._logAudit(
                    reqUser, 
                    'EXPENSE_UPDATE', 
                    `Actualizado gasto: ${changes.join(', ')}`, 
                    id, 
                    oldValues, 
                    updatedExpense
                );
            }



            return updatedExpense;
        }
        return null;
    }

    /**
     * Delete an expense.
     */
    async deleteExpense(reqUser, id) {
        const { companyId } = reqUser;
        const expense = await Expense.findOne({ where: { id, companyId } });
        if (!expense) return false;

        const deleted = await Expense.destroy({ where: { id, companyId } });
        if (deleted) {
            await this._logAudit(reqUser, 'EXPENSE_DELETE', `Eliminado gasto: ${expense.description}`, id, expense, null);
            


            return true;
        }
        return false;
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
    async _logAudit(reqUser, action, description, entityId, oldValue, newValue) {
        try {
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
            });
        } catch (error) {
            console.error('Audit log error:', error);
        }
    }
}

module.exports = new ExpenseService();
