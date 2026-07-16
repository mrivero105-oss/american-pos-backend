const express = require('express');
const router = express.Router();
const { Sale, CashShift, sequelize } = require('../database/models');
const { verifyToken, isSuperAdmin } = require('../middleware/auth');

// Diagnostic endpoint - shows database status and health metrics (SUPERADMIN ONLY)
router.get('/database', verifyToken, isSuperAdmin, async (req, res) => {
    try {
        const dbPath = sequelize.options?.storage || sequelize.config?.storage || 'unknown';

        // Count records
        const totalSales = await Sale.count();
        const openShifts = await CashShift.count({ where: { status: 'open' } });
        const closedShifts = await CashShift.count({ where: { status: 'closed' } });

        // Get latest sales
        const latestSales = await Sale.findAll({
            order: [['createdAt', 'DESC']],
            limit: 10,
            attributes: ['id', 'createdAt', 'date', 'total', 'paymentMethod']
        });

        // Get current shift
        const currentShift = await CashShift.findOne({
            where: { status: 'open' },
            order: [['openedAt', 'DESC']]
        });

        res.json({
            success: true,
            database: {
                path: dbPath,
                connected: true
            },
            counts: {
                totalSales,
                openShifts,
                closedShifts
            },
            currentShift: currentShift ? {
                id: currentShift.id,
                openedAt: currentShift.openedAt,
                initialAmount: currentShift.initialAmount
            } : null,
            latestSales: latestSales.map(s => ({
                id: s.id,
                createdAt: s.createdAt,
                date: s.date,
                total: s.total,
                paymentMethod: s.paymentMethod
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;
