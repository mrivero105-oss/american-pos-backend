const express = require('express');
const router = express.Router();
const { CashShift, Sale } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

router.get('/current', async (req, res) => {
    try {
        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            return res.status(404).json({ message: 'No hay turno de caja abierto' });
        }

        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: {
                    $gte: currentShift.openedAt
                }
            }
        });

        const cashSales = sales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'cash_bs');
        const cashSalesTotal = cashSales.reduce((sum, s) => sum + s.total, 0);

        const movements = currentShift.movements || [];
        const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
        const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

        const expectedAmount = currentShift.initialAmount + cashSalesTotal + totalIn - totalOut;

        res.json({
            ...currentShift.toJSON(),
            cashSalesTotal,
            totalSalesAmount: sales.reduce((sum, s) => sum + s.total, 0),
            salesCount: sales.length,
            totalIn,
            totalOut,
            expectedAmount
        });
    } catch (error) {
        console.error('Get current shift error:', error);
        res.status(500).json({ error: 'Error al obtener turno actual' });
    }
});

router.post('/open', async (req, res) => {
    try {
        const existingShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (existingShift) {
            return res.status(400).json({ message: 'Ya existe un turno de caja abierto' });
        }

        const initialAmount = parseFloat(req.body.amount) || 0;

        const newShift = await CashShift.create({
            id: generateRobustId(),
            openedAt: new Date().toISOString(),
            status: 'open',
            userId: req.user.id,
            initialAmount: initialAmount,
            expectedAmount: 0,
            finalAmount: 0,
            movements: [],
            salesSummary: {}
        });

        res.status(201).json(newShift);
    } catch (error) {
        console.error('Open shift error:', error);
        res.status(500).json({ error: 'Error al abrir caja' });
    }
});

router.post('/close', async (req, res) => {
    try {
        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            return res.status(400).json({ message: 'No hay caja abierta para cerrar' });
        }

        const finalAmountInput = parseFloat(req.body.finalAmount) || 0;
        console.log(`🎬 Cerrando caja ${currentShift.id}. Real Contado: ${finalAmountInput}`);

        const movements = currentShift.movements || [];
        const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
        const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: {
                    $gte: currentShift.openedAt
                }
            }
        });

        const cashSales = sales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'cash_bs');
        const cashSalesTotal = cashSales.reduce((sum, s) => sum + s.total, 0);

        const expectedAmount = (currentShift.initialAmount || 0) + cashSalesTotal + totalIn - totalOut;

        await currentShift.update({
            status: 'closed',
            closedAt: new Date().toISOString(),
            finalAmount: finalAmountInput,
            expectedAmount: expectedAmount,
            difference: finalAmountInput - expectedAmount,
            salesSummary: JSON.stringify({
                totalSales: sales.reduce((sum, s) => sum + s.total, 0),
                cashSales: cashSalesTotal,
                salesCount: sales.length,
                totalIn,
                totalOut
            })
        });

        res.json(currentShift);
    } catch (error) {
        console.error('Close shift error:', error);
        res.status(500).json({ error: 'Error al cerrar caja' });
    }
});

router.post('/movement', async (req, res) => {
    try {
        const { type, amount, reason } = req.body;
        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            return res.status(400).json({ message: 'No hay turno de caja abierto para registrar movimientos' });
        }

        const movements = currentShift.movements || [];
        movements.push({
            id: generateRobustId(),
            type,
            amount: parseFloat(amount),
            reason,
            timestamp: new Date().toISOString()
        });

        await currentShift.update({ movements });
        res.json({ success: true, movements });
    } catch (error) {
        console.error('Add movement error:', error);
        res.status(500).json({ error: 'Error al registrar movimiento' });
    }
});

router.get('/history', async (req, res) => {
    try {
        const shifts = await CashShift.findAll({
            where: { userId: req.user.id, status: 'closed' },
            limit: 20,
            order: [['closedAt', 'DESC']]
        });
        res.json(shifts);
    } catch (error) {
        console.error('Get cash history error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

router.get('/x-report', async (req, res) => {
    try {
        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            return res.status(404).json({ message: 'No hay turno abierto' });
        }

        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: { $gte: currentShift.openedAt }
            }
        });

        const cashSales = sales.filter(s => s.paymentMethod === 'cash' || s.paymentMethod === 'cash_bs');
        const cashSalesTotal = cashSales.reduce((sum, s) => sum + s.total, 0);

        const movements = currentShift.movements || [];
        const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
        const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);
        const expectedAmount = currentShift.initialAmount + cashSalesTotal + totalIn - totalOut;

        res.json({
            shift: currentShift,
            salesCount: sales.length,
            totalSales: cashSalesTotal,
            totalIn,
            totalOut,
            expectedAmount,
            generatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('X-Report error:', error);
        res.status(500).json({ error: 'Error al generar reporte X' });
    }
});

module.exports = router;
