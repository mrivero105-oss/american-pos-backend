const express = require('express');
const router = express.Router();
const { StockAlert } = require('../database/models');
const { verifyToken } = require('../middleware/auth');

// GET / - Listar alertas de sobregiro de stock
router.get('/', verifyToken, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const whereClause = {};
        if (companyId && companyId !== 'default' && companyId !== 'admin') {
            whereClause.companyId = String(companyId);
        }

        const alerts = await StockAlert.findAll({
            where: whereClause,
            order: [['createdAt', 'DESC']],
            limit: 100
        });

        res.json({ success: true, alerts });
    } catch (err) {
        console.error('[STOCK-ALERTS] Error fetching alerts:', err);
        res.status(500).json({ error: 'Error al consultar alertas de inventario' });
    }
});

// PUT /:id/resolve - Resolver alerta de stock
router.put('/:id/resolve', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const alert = await StockAlert.findByPk(id);
        if (!alert) return res.status(404).json({ error: 'Alerta no encontrada' });

        alert.resolved = true;
        await alert.save();

        res.json({ success: true, message: 'Alerta resuelta correctamente' });
    } catch (err) {
        console.error('[STOCK-ALERTS] Error resolving alert:', err);
        res.status(500).json({ error: 'Error al resolver alerta' });
    }
});

module.exports = router;
