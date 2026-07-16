const { Customer, Sale, CreditHistory, AuditLog, CashShift } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/precision');


class CustomerService {
    /**
     * Get all customers with search and pagination.
     */
    async getAllCustomers(reqUser, queryParams) {
        const { companyId } = reqUser;
        const { search, page = 1, limit = 0 } = queryParams;

        const whereClause = { companyId };

        if (search) {
            const searchTerm = search.trim();
            if (sequelize.getDialect() === 'postgres') {
                whereClause[Op.or] = [
                    { name: { [Op.iLike]: `%${searchTerm}%` } },
                    { idDocument: { [Op.iLike]: `%${searchTerm}%` } },
                    { email: { [Op.iLike]: `%${searchTerm}%` } },
                    sequelize.literal(`similarity(LOWER("Customer"."name"), LOWER(${sequelize.escape(searchTerm)})) > 0.15`),
                    sequelize.literal(`word_similarity(LOWER("Customer"."name"), LOWER(${sequelize.escape(searchTerm)})) > 0.3`)
                ];
            } else {
                whereClause[Op.or] = [
                    { name: { [Op.like]: `%${searchTerm}%` } },
                    { idDocument: { [Op.like]: `%${searchTerm}%` } },
                    { email: { [Op.like]: `%${searchTerm}%` } }
                ];
            }
        }

        if (parseInt(limit) === 0) {
            return await Customer.findAll({
                where: whereClause,
                order: [['updatedAt', 'DESC']],
                raw: true
            });
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { count, rows } = await Customer.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset,
            order: [['updatedAt', 'DESC']],
            raw: true
        });

        return {
            customers: rows,
            total: count,
            page: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit))
        };
    }

    /**
     * Get a single customer by ID.
     */
    async getCustomerById(id, companyId) {
        return await Customer.findOne({
            where: { id, companyId }
        });
    }

    /**
     * Create a new customer with audit log.
     */
    async createCustomer(reqUser, customerData) {
        const { id: userId, companyId } = reqUser;
        const { name, idDocument, email, phone, address, creditLimit, notes } = customerData;

        const newCustomer = await Customer.create({
            id: generateRobustId(),
            userId,
            companyId,
            name,
            idDocument,
            email,
            phone,
            address,
            creditLimit: Number(creditLimit) || 0,
            notes,
            creditBalance: 0
        });

        await this._logAudit(reqUser, 'CUSTOMER_CREATE', `Nuevo cliente registrado: ${newCustomer.name}`, newCustomer.id, null, newCustomer);



        return newCustomer;
    }

    /**
     * Update an existing customer with diff auditing.
     */
    async updateCustomer(reqUser, id, updateData) {
        const { companyId } = reqUser;
        const customer = await Customer.findOne({ where: { id, companyId } });
        if (!customer) throw new Error('Cliente no encontrado');

        const oldValues = customer.toJSON();
        
        // Sanitize update data to prevent overwriting protected fields
        const { name, idDocument, email, phone, address, creditLimit, notes } = updateData;
        const sanitizedUpdate = {};
        if (name !== undefined) sanitizedUpdate.name = name;
        if (idDocument !== undefined) sanitizedUpdate.idDocument = idDocument;
        if (email !== undefined) sanitizedUpdate.email = email;
        if (phone !== undefined) sanitizedUpdate.phone = phone;
        if (address !== undefined) sanitizedUpdate.address = address;
        if (creditLimit !== undefined) sanitizedUpdate.creditLimit = Number(creditLimit);
        if (notes !== undefined) sanitizedUpdate.notes = notes;

        const [updated] = await Customer.update(sanitizedUpdate, { where: { id, companyId } });

        if (updated) {
            const updatedCustomer = await Customer.findOne({ where: { id, companyId } });
            const changes = this._getDiff(oldValues, updatedCustomer.toJSON());
            
            if (changes.length > 0) {
                await this._logAudit(
                    reqUser, 
                    'CUSTOMER_UPDATE', 
                    `Actualizado cliente ${customer.name}: ${changes.join(', ')}`, 
                    id, 
                    oldValues, 
                    updatedCustomer
                );
            }



            return updatedCustomer;
        }
        return null;
    }

    /**
     * Register a payment towards credit balance (Abono).
     */
    async registerPayment(reqUser, customerId, paymentData) {
        const { id: userId, companyId } = reqUser;
        const { amount, method, notes, saleIds } = paymentData;

        if (!amount || amount <= 0) throw new Error('El monto debe ser mayor a 0');

        return await sequelize.transaction(async (t) => {
            const customer = await Customer.findOne({ where: { id: customerId, companyId }, transaction: t });
            if (!customer) throw new Error('Cliente no encontrado');

            const oldBalance = Number(customer.creditBalance) || 0;
            const roundedAmount = precision.round(amount, 2);
            const newBalance = precision.round(precision.subtract(oldBalance, roundedAmount), 2);

            await customer.update({ creditBalance: newBalance }, { transaction: t });

            // Update individual sales if specified
            if (Array.isArray(saleIds) && saleIds.length > 0) {
                await Sale.update({ paymentStatus: 'paid' }, { 
                    where: { 
                        id: { [Op.in]: saleIds },
                        customerId,
                        companyId
                    },
                    transaction: t
                });
            }

            // Record in Credit History
            const historyEntry = await CreditHistory.create({
                id: generateRobustId(),
                customerId,
                userId,
                companyId,
                timestamp: new Date().toISOString(),
                type: 'payment',
                amount: parseFloat(amount),
                balanceAfter: newBalance,
                description: notes || 'Abono a cuenta',
                paymentMethod: method || 'cash'
            }, { transaction: t });

            // Add to Cash Shift (if open)
            const currentShift = await CashShift.findOne({
                where: { companyId, status: 'open' },
                order: [['openedAt', 'DESC']],
                transaction: t
            });

            if (currentShift) {
                const { CashMovement } = require('../database/models');
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: currentShift.id,
                    userId: String(reqUser.id),
                    companyId: companyId,
                    type: 'in',
                    amount: parseFloat(amount),
                    currency: 'USD',
                    paymentMethodId: method || 'cash',
                    category: 'PAYMENT',
                    reason: `Abono de cliente: ${customer.name}`,
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            }

            await this._logAudit(reqUser, 'CUSTOMER_PAYMENT', `Abono de ${amount} registrado para ${customer.name}`, customerId, { oldBalance }, { newBalance });



            return { success: true, newBalance, historyEntry };
        });
    }

    /**
     * Delete a customer.
     */
    async deleteCustomer(reqUser, id) {
        const { companyId } = reqUser;
        const customer = await Customer.findOne({ where: { id, companyId } });
        if (!customer) return false;

        const { Sale, CreditHistory } = require('../database/models');
        const salesCount = await Sale.count({ where: { customerId: id, companyId } });
        if (salesCount > 0) {
            throw new Error('No se puede eliminar el cliente porque tiene ventas asociadas.');
        }

        return await sequelize.transaction(async (t) => {
            await CreditHistory.destroy({ where: { customerId: id, companyId }, transaction: t });
            
            const deleted = await Customer.destroy({ where: { id, companyId }, transaction: t });
            if (deleted) {
                await this._logAudit(reqUser, 'CUSTOMER_DELETE', `Eliminado cliente: ${customer.name}`, id, customer, null);
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
        const ignoreFields = ['updatedAt', 'createdAt'];
        const fieldsToAudit = ['name', 'idDocument', 'phone', 'email', 'address', 'creditLimit', 'isVIP', 'isActive'];

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

module.exports = new CustomerService();
