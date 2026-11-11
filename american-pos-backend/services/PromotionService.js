const { Promotion } = require('../database/models');
const { Op } = require('sequelize');
const { getCurrentlyActivePromotions, evaluateCartPromotions } = require('../utils/promotionsEngineCore');

class PromotionService {
    /**
     * Obtiene todas las promociones configuradas de la empresa
     */
    static async getAllPromotions(companyId = 'default') {
        const where = {
            [Op.or]: [{ companyId }, { companyId: 'default' }]
        };
        return await Promotion.findAll({
            where,
            order: [['priority', 'DESC'], ['createdAt', 'DESC']]
        });
    }

    /**
     * Obtiene únicamente las promociones válidas y activas en este preciso momento
     * (Verificando rango de fechas, día de la semana y rango horario si aplica)
     */
    static async getActivePromotions(companyId = 'default') {
        const allPromos = await this.getAllPromotions(companyId);
        return getCurrentlyActivePromotions(allPromos);
    }

    /**
     * Crea una nueva promoción o combo
     */
    static async createPromotion(data, companyId = 'default') {
        const id = 'promo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        return await Promotion.create({
            id,
            companyId,
            name: data.name,
            code: data.code || null,
            description: data.description || '',
            type: data.type || 'BUY_X_GET_Y',
            buyQuantity: parseFloat(data.buyQuantity) || 2,
            payQuantity: parseFloat(data.payQuantity) || 1,
            discountPercentage: parseFloat(data.discountPercentage) || 0,
            fixedPrice: data.fixedPrice !== null && data.fixedPrice !== undefined && data.fixedPrice !== '' ? parseFloat(data.fixedPrice) : null,
            targetProductIds: Array.isArray(data.targetProductIds) ? data.targetProductIds : [],
            targetCategories: Array.isArray(data.targetCategories) ? data.targetCategories : [],
            targetPaymentMethods: Array.isArray(data.targetPaymentMethods) ? data.targetPaymentMethods : [],
            minQuantity: parseFloat(data.minQuantity) || 1,
            minQuantityUnit: data.minQuantityUnit || 'UNITS',
            minUnits: parseFloat(data.minUnits) || parseFloat(data.buyQuantity) || 1,
            comboItems: Array.isArray(data.comboItems) ? data.comboItems : [],
            minCartTotal: parseFloat(data.minCartTotal) || 0,
            daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
            startDate: data.startDate || null,
            endDate: data.endDate || null,
            startTime: data.startTime || null,
            endTime: data.endTime || null,
            priority: parseInt(data.priority, 10) || 1,
            isActive: data.isActive !== false,
            allowStacking: data.allowStacking === true,
            applyAutomatically: data.applyAutomatically !== false
        });
    }

    /**
     * Actualiza una promoción existente
     */
    static async updatePromotion(id, data, companyId = 'default') {
        const promo = await Promotion.findOne({
            where: { id, [Op.or]: [{ companyId }, { companyId: 'default' }] }
        });
        if (!promo) throw new Error('Promoción no encontrada');

        await promo.update({
            name: data.name !== undefined ? data.name : promo.name,
            code: data.code !== undefined ? data.code : promo.code,
            description: data.description !== undefined ? data.description : promo.description,
            type: data.type !== undefined ? data.type : promo.type,
            buyQuantity: data.buyQuantity !== undefined ? parseFloat(data.buyQuantity) : promo.buyQuantity,
            payQuantity: data.payQuantity !== undefined ? parseFloat(data.payQuantity) : promo.payQuantity,
            discountPercentage: data.discountPercentage !== undefined ? parseFloat(data.discountPercentage) : promo.discountPercentage,
            fixedPrice: data.fixedPrice !== undefined ? (data.fixedPrice !== null && data.fixedPrice !== '' ? parseFloat(data.fixedPrice) : null) : promo.fixedPrice,
            targetProductIds: data.targetProductIds !== undefined ? data.targetProductIds : promo.targetProductIds,
            targetCategories: data.targetCategories !== undefined ? data.targetCategories : promo.targetCategories,
            targetPaymentMethods: data.targetPaymentMethods !== undefined ? data.targetPaymentMethods : promo.targetPaymentMethods,
            minQuantity: data.minQuantity !== undefined ? parseFloat(data.minQuantity) : promo.minQuantity,
            minQuantityUnit: data.minQuantityUnit !== undefined ? data.minQuantityUnit : promo.minQuantityUnit,
            minUnits: data.minUnits !== undefined ? parseFloat(data.minUnits) : promo.minUnits,
            comboItems: data.comboItems !== undefined ? data.comboItems : promo.comboItems,
            minCartTotal: data.minCartTotal !== undefined ? parseFloat(data.minCartTotal) : promo.minCartTotal,
            daysOfWeek: data.daysOfWeek !== undefined ? data.daysOfWeek : promo.daysOfWeek,
            startDate: data.startDate !== undefined ? data.startDate : promo.startDate,
            endDate: data.endDate !== undefined ? data.endDate : promo.endDate,
            startTime: data.startTime !== undefined ? data.startTime : promo.startTime,
            endTime: data.endTime !== undefined ? data.endTime : promo.endTime,
            priority: data.priority !== undefined ? parseInt(data.priority, 10) : promo.priority,
            isActive: data.isActive !== undefined ? data.isActive : promo.isActive,
            allowStacking: data.allowStacking !== undefined ? data.allowStacking : promo.allowStacking,
            applyAutomatically: data.applyAutomatically !== undefined ? data.applyAutomatically : promo.applyAutomatically
        });

        return promo;
    }

    /**
     * Elimina una promoción
     */
    static async deletePromotion(id, companyId = 'default') {
        const promo = await Promotion.findOne({
            where: { id, [Op.or]: [{ companyId }, { companyId: 'default' }] }
        });
        if (!promo) throw new Error('Promoción no encontrada');
        await promo.destroy();
        return { success: true };
    }

    /**
     * Motor de Evaluación: Recibe los ítems del carrito y calcula los descuentos y ahorros
     * Delega el cálculo matemático al motor compartido (promotionsEngineCore)
     */
    static async evaluateCart(cartItems = [], companyId = 'default', paymentMethod = null) {
        const activePromos = await this.getActivePromotions(companyId);
        return evaluateCartPromotions(cartItems, activePromos, paymentMethod);
    }
}

module.exports = PromotionService;
