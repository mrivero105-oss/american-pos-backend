const { Supplier, Product, SupplierCreditHistory, AuditLog } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const precision = require('../utils/precision');


class SupplierService {
    /**
     * Get all suppliers.
     */
    async getAllSuppliers(companyId = 'default', role) {
        const finalCompanyId = companyId || 'default';
        if (process.env.DEBUG_VERBOSE === 'true') {
            console.log(`[SUPPLIER-DEBUG] Fetching for Company: ${finalCompanyId}, Role: ${role}`);
        }
        const companyCondition = (finalCompanyId === '2' || finalCompanyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }, { companyId: null }] }
            : { companyId: finalCompanyId };
        const whereClause = finalCompanyId && finalCompanyId !== 'all' ? companyCondition : {};
        const suppliers = await Supplier.findAll({
            where: whereClause
        });
        return (suppliers || []).map(s => s.get ? s.get({ plain: true }) : s);
    }

    /**
     * Get supplier by ID.
     */
    async getSupplierById(id, companyId = 'default') {
        const finalCompanyId = companyId || 'default';
        const companyCondition = (finalCompanyId === '2' || finalCompanyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }, { companyId: null }] }
            : { companyId: finalCompanyId };
        const whereClause = finalCompanyId && finalCompanyId !== 'all' ? { id, ...companyCondition } : { id };
        return await Supplier.findOne({ where: whereClause });
    }

    /**
     * Create a new supplier with audit.
     */
    async createSupplier(reqUser = {}, supplierData, logoFile) {
        const userId = reqUser?.id || 'admin';
        const companyId = reqUser?.companyId || 'default';
        
        let logoUri = null;
        if (logoFile) {
            logoUri = `supplier_logos/${logoFile.filename}`;
        }

        // Handle stringified JSON from FormData if needed
        let finalData = { ...supplierData };
        if (supplierData.data) {
            try {
                finalData = JSON.parse(supplierData.data);
            } catch (e) {}
        }

        const newSupplier = await Supplier.create({
            id: generateRobustId(),
            userId,
            companyId,
            ...finalData,
            logoUri
        });

        await this._logAudit(reqUser, 'SUPPLIER_CREATE', `Nuevo proveedor registrado: ${newSupplier.name}`, newSupplier.id, null, newSupplier);
        


        return newSupplier;
    }

    /**
     * Update an existing supplier with diff auditing.
     */
    async updateSupplier(reqUser = {}, id, updateData, logoFile) {
        const finalCompanyId = reqUser?.companyId || 'default';
        const isSuperOrAdmin = reqUser?.role === 'admin' || reqUser?.role === 'superadmin';
        const companyCondition = (finalCompanyId === '2' || finalCompanyId === 'default' || isSuperOrAdmin)
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }, { companyId: null }] }
            : { companyId: finalCompanyId };

        let supplier = await Supplier.findOne({ where: { id, ...companyCondition } });
        if (!supplier && isSuperOrAdmin) {
            supplier = await Supplier.findByPk(id);
        }
        if (!supplier) throw new Error('Proveedor no encontrado');

        const oldValues = supplier.toJSON();
        
        let finalUpdate = { ...updateData };
        if (updateData.data) {
            try {
                finalUpdate = JSON.parse(updateData.data);
            } catch (e) {}
        }

        if (logoFile) {
            finalUpdate.logoUri = `supplier_logos/${logoFile.filename}`;
            // Replicar en rutas candidatas
            try {
                const fileBuf = fs.readFileSync(logoFile.path);
                const candidates = [
                    path.join(__dirname, '..', 'supplier_logos'),
                    process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'supplier_logos') : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', 'supplier_logos') : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', 'supplier_logos') : null,
                    process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', 'supplier_logos') : null
                ].filter(Boolean);
                candidates.forEach(d => {
                    try {
                        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                        fs.writeFileSync(path.join(d, logoFile.filename), fileBuf);
                    } catch (_) {}
                });
            } catch (_) {}

            // Delete old logo
            if (supplier.logoUri) {
                this._deleteLogoFile(supplier.logoUri);
            }
        }

        await supplier.update(finalUpdate);
        const updatedSupplier = supplier.toJSON();
        const changes = this._getDiff(oldValues, updatedSupplier);
        
        if (changes.length > 0) {
            await this._logAudit(
                reqUser, 
                'SUPPLIER_UPDATE', 
                `Actualizado proveedor ${supplier.name}: ${changes.join(', ')}`, 
                id, 
                oldValues, 
                updatedSupplier
            );
        }

        return updatedSupplier;
    }

    /**
     * Register a payment to a supplier.
     */
    async registerPayment(reqUser = {}, supplierId, paymentData) {
        const userId = reqUser?.id || 'admin';
        const companyId = reqUser?.companyId || 'default';
        const { amount, method, description, currency = 'USD', exchangeRate } = paymentData;
        const numAmount = precision.round(Number(amount) || 0, 2);

        const { readJson, getUserSettings } = require('../utils/helpers');
        const { SETTINGS_FILE } = require('../config/paths');

        let usdAmount = numAmount;
        if (currency === 'VES') {
            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : (Number(userSettings.exchangeRate) || 1.0);
            usdAmount = rate > 0 ? precision.round(precision.divide(numAmount, rate), 2) : numAmount;
        }

        return await sequelize.transaction(async (t) => {
            const supplier = await Supplier.findOne({ where: { id: supplierId, companyId }, transaction: t });
            if (!supplier) throw new Error('Proveedor no encontrado');

            const oldBalance = Number(supplier.creditBalance) || 0;
            const newBalance = precision.round(precision.subtract(oldBalance, usdAmount), 2);
            await supplier.update({ creditBalance: newBalance }, { transaction: t });

            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const activeRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : (Number(userSettings.exchangeRate) || 1.0);

            const historyEntry = await SupplierCreditHistory.create({
                id: generateRobustId(),
                supplierId,
                userId,
                companyId,
                timestamp: new Date().toISOString(),
                type: 'payment',
                amount: usdAmount,
                balanceAfter: newBalance,
                description: description || `Pago a proveedor (${numAmount} ${currency}${currency === 'VES' ? ` @ ${activeRate} Bs/$` : ` = ${(usdAmount * activeRate).toFixed(2)} Bs`})`,
                paymentMethod: method || 'cash',
                exchangeRate: activeRate
            }, { transaction: t });

            await this._logAudit(reqUser, 'SUPPLIER_PAYMENT', `Pago de ${numAmount} ${currency} (${usdAmount} USD) registrado para ${supplier.name}`, supplierId, { oldBalance: supplier.creditBalance }, { newBalance }, t);

            // Add to Cash Shift (if open for this cashier) and deduct cash
            const { CashShift, CashMovement } = require('../database/models');
            const shiftWhere = { companyId, status: 'open' };
            if (userId) shiftWhere.userId = String(userId);

            const currentShift = await CashShift.findOne({
                where: shiftWhere,
                order: [['openedAt', 'DESC']],
                transaction: t
            });

            if (currentShift) {
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: currentShift.id,
                    userId: String(userId),
                    companyId: companyId,
                    type: 'out',
                    amount: numAmount,
                    currency: currency || 'USD',
                    paymentMethodId: method || 'cash',
                    category: 'EXPENSE',
                    reason: `Pago a proveedor: ${supplier.name} (${numAmount} ${currency})`,
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            }

            return historyEntry;
        });
    }

    /**
     * Synchronize products for a supplier.
     */
    async syncProducts(companyId = 'default', supplierId, productIds) {
        const finalCompanyId = companyId || 'default';
        if (!Array.isArray(productIds)) throw new Error('Se requiere una lista de IDs de productos');

        return await sequelize.transaction(async (t) => {
            // Unassign products not in the list
            await Product.update(
                { supplierId: null },
                {
                    where: {
                        supplierId: supplierId,
                        id: { [Op.notIn]: productIds.length > 0 ? productIds : ['none'] },
                        companyId
                    },
                    transaction: t
                }
            );

            // Assign products in the list
            if (productIds.length > 0) {
                await Product.update(
                    { supplierId: supplierId },
                    {
                        where: {
                            id: { [Op.in]: productIds },
                            companyId
                        },
                        transaction: t
                    }
                );
            }
            return true;
        });
    }

    /**
     * Delete a supplier.
     */
    async deleteSupplier(reqUser = {}, id) {
        const companyId = reqUser?.companyId || 'default';
        const supplier = await Supplier.findOne({ where: { id, companyId } });
        if (!supplier) return false;

        // Check for existing purchase orders
        const { PurchaseOrder, SupplierCreditHistory, SupplierProductMapping, Product } = require('../database/models');
        const ordersCount = await PurchaseOrder.count({ where: { supplierId: id, companyId } });
        if (ordersCount > 0) {
            throw new Error('No se puede eliminar el proveedor porque tiene órdenes de compra asociadas.');
        }
        
        const productsCount = await Product.count({ where: { supplierId: id, companyId } });
        if (productsCount > 0) {
            throw new Error('No se puede eliminar el proveedor porque tiene productos asociados.');
        }

        return await sequelize.transaction(async (t) => {
            await SupplierCreditHistory.destroy({ where: { supplierId: id, companyId }, transaction: t });
            await SupplierProductMapping.destroy({ where: { supplierId: id }, transaction: t });

            const deleted = await Supplier.destroy({ where: { id, companyId }, transaction: t });
            if (deleted) {
                if (supplier.logoUri) {
                    this._deleteLogoFile(supplier.logoUri);
                }
                await this._logAudit(reqUser, 'SUPPLIER_DELETE', `Eliminado proveedor: ${supplier.name}`, id, supplier, null);
                return true;
            }
            return false;
        });
    }

    /**
     * Private: Delete logo file from disk.
     */
    _deleteLogoFile(logoUri) {
        try {
            const fileName = path.basename(logoUri);
            const candidates = [
                path.join(__dirname, '..', 'supplier_logos'),
                process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'supplier_logos') : null,
                process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', 'supplier_logos') : null,
                process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', 'supplier_logos') : null,
                process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', 'supplier_logos') : null
            ].filter(Boolean);

            candidates.forEach(d => {
                const fullPath = path.join(d, fileName);
                if (fs.existsSync(fullPath)) {
                    try { fs.unlinkSync(fullPath); } catch (_) {}
                }
            });
        } catch (e) {
            console.error('Error deleting logo file:', e);
        }
    }

    /**
     * Helper to get diff between objects.
     */
    _getDiff(oldObj, newObj) {
        const changes = [];
        const fieldsToAudit = ['name', 'rif', 'phone', 'email', 'address', 'contactPerson', 'creditLimit', 'isActive'];

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
    async _logAudit(reqUser = {}, action, description, entityId, oldValue, newValue, transaction = null) {
        try {
            const options = transaction ? { transaction } : {};
            await AuditLog.create({
                id: generateRobustId(),
                userId: reqUser?.id || 'admin',
                companyId: reqUser?.companyId || 'default',
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

module.exports = new SupplierService();
