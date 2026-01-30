const express = require('express');
const router = express.Router();
const { Sale, Product } = require('../database/models');
const { Op } = require('sequelize');

router.get('/dashboard/summary', async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: { [Op.like]: `${date}%` }
            }
        });

        const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
        const cashSales = sales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'cash_bs').reduce((sum, s) => sum + s.total, 0);

        res.json({
            totalSales,
            cashSales,
            salesCount: sales.length,
            date
        });
    } catch (error) {
        console.error('Dashboard summary error:', error);
        res.status(500).json({ error: 'Error al obtener resumen' });
    }
});

router.get('/daily', async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: { [Op.like]: `${date}%` }
            },
            order: [['date', 'DESC']]
        });
        res.json(sales);
    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({ error: 'Error al obtener reporte diario' });
    }
});

module.exports = router;
