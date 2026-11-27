const express = require('express');
const router = express.Router();
const { Refund, Sale, Product, StockMovement, BranchStock } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');

const { isAdmin, requirePermission } = require('../middleware/auth');
const { isSupervisorOrAboveRole } = require('../constants/roles');

router.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId || '2';
        const isAdminUser = isSupervisorOrAboveRole(req.user?.role);

        // 🔒 SEGURIDAD: Aislamiento multi-tenant por empresa.
        // Los cajeros solo auditan sus propias devoluciones; supervisores y admins ven las de la empresa.
        const where = { companyId };
        if (!isAdminUser) {
            where.userId = req.user.id;
        }

        const refunds = await Refund.findAll({
            where,
            order: [['timestamp', 'DESC']],
            limit: 50
        });
        res.json(refunds);
    } catch (error) {
        console.error('Get refunds error:', error);
        res.status(500).json({ error: 'Error al obtener devoluciones' });
    }
});

router.post('/', async (req, res) => {
    try {
        const RefundService = require('../services/RefundService');
        const refund = await RefundService.processRefund(req.user, req.body);
        res.status(201).json(refund);
    } catch (error) {
        console.error('Refund process error:', error);
        res.status(400).json({ 
            message: error.message || 'Error al procesar la devolución' 
        });
    }
});

module.exports = router;
