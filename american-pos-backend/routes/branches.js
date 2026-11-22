const express = require('express');
const router = express.Router();
const { Branch, User, BranchStock, Product, Sale, CashShift } = require('../database/models');
const { isAdmin, invalidateUserAuthCache } = require('../middleware/auth');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');
const validate = require('../middleware/validate');
const {
    createBranchSchema,
    updateBranchSchema,
    switchBranchSchema
} = require('../schemas/branchesSchema');

// Fetch all branches enriched with operational stats
router.get('/', async (req, res) => {
    try {
        const companyId = req.user.companyId || '2';
        const companyCondition = (companyId === '2' || companyId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : companyId;
        let branches;
        try {
            branches = await Branch.findAll({
                where: { companyId: companyCondition },
                order: [['isMain', 'DESC'], ['name', 'ASC']]
            });
        } catch (bErr) {
            console.warn('[Get branches] Full attributes query failed, falling back to core attributes:', bErr.message);
            branches = await Branch.findAll({
                where: { companyId: companyCondition },
                attributes: ['id', 'name', 'isMain', 'isActive', 'companyId']
            });
        }

        // Auto-heal / sync for main branch if catalog products are not yet in BranchStock
        const mainBranch = (branches && branches.length > 0) ? (branches.find(b => b.isMain) || branches[0]) : null;
        if (mainBranch && BranchStock && Product) {
            try {
                const totalCatalog = await Product.count({ where: { companyId: companyCondition } });
                const currentBranchRows = await BranchStock.count({ where: { branchId: mainBranch.id, companyId: companyCondition } });
                if (totalCatalog > currentBranchRows) {
                    const catalogProducts = await Product.findAll({
                        where: { companyId: companyCondition },
                        attributes: ['id', 'stockQuantity'],
                        raw: true
                    });
                    const existingBS = await BranchStock.findAll({
                        where: { branchId: mainBranch.id, companyId: companyCondition },
                        attributes: ['productId'],
                        raw: true
                    });
                    const existingSet = new Set(existingBS.map(x => x.productId));
                    const missing = catalogProducts
                        .filter(p => !existingSet.has(p.id))
                        .map(p => ({
                            branchId: mainBranch.id,
                            productId: p.id,
                            companyId: mainBranch.companyId || companyId,
                            quantity: Number(p.stockQuantity || 0)
                        }));
                    if (missing.length > 0) {
                        await BranchStock.bulkCreate(missing, { ignoreDuplicates: true });
                    }
                }
            } catch (syncErr) {
                console.warn('BranchStock auto-heal warning:', syncErr.message);
            }
        }

        // Enriquecer cada sucursal con métricas rápidas
        const enriched = await Promise.all((branches || []).map(async (b) => {
            const bJson = typeof b.toJSON === 'function' ? b.toJSON() : b;
            const [usersCount, stockCount] = await Promise.all([
                User ? User.count({ where: { activeBranchId: b.id, companyId: companyCondition } }).catch(() => 0) : 0,
                BranchStock ? BranchStock.count({ where: { branchId: b.id, companyId: companyCondition, quantity: { [Op.gt]: 0 } } }).catch(() => 0) : 0
            ]);
            return {
                ...bJson,
                usersCount: usersCount || 0,
                stockCount: stockCount || 0
            };
        }));

        res.json(enriched);
    } catch (error) {
        console.error('Get branches error:', error);
        res.status(500).json({ error: 'Error al obtener sucursales', details: error.message });
    }
});

// Create new branch
router.post('/', isAdmin, validate(createBranchSchema), async (req, res) => {
    try {
        const companyId = req.user.companyId || 'default';
        const { isMain, name, address, phone, email, code, type, managerName, color, invoicePrefix, isActive } = req.body;

        // If marked as main, unset any other main branch
        if (isMain) {
            await Branch.update({ isMain: false }, { where: { companyId } });
        }

        const newBranch = await Branch.create({
            id: generateRobustId(),
            userId: req.user.id,
            companyId,
            name,
            address,
            phone,
            email,
            code: code || `SUC-${Math.floor(100 + Math.random() * 900)}`,
            type: type || 'STORE',
            managerName: managerName || '',
            color: color || 'from-primary-600 to-indigo-700',
            invoicePrefix: invoicePrefix || '',
            isMain: !!isMain,
            isActive: isActive !== undefined ? isActive : true
        });

        res.status(201).json(newBranch);
    } catch (error) {
        console.error('Create branch error:', error);
        res.status(500).json({ error: 'Error al crear sucursal' });
    }
});

// Update user active branch
router.post('/switch', isAdmin, validate(switchBranchSchema), async (req, res) => {
    try {
        const { branchId } = req.body;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        
        let branchName = 'Global (Todas)';
        if (branchId) {
            const branch = await Branch.findOne({ where: { id: branchId, companyId: companyCondition } });
            if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });
            branchName = branch.name;
        }

        await User.update({ activeBranchId: branchId || null }, { where: { id: req.user.id } });
        invalidateUserAuthCache(req.user.id);
        res.json({ success: true, activeBranchId: branchId || null, branchName });
    } catch (error) {
        console.error('Switch branch error:', error);
        res.status(500).json({ error: 'Error al cambiar de sucursal' });
    }
});

// Update branch
router.put('/:id', isAdmin, validate(updateBranchSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        const branch = await Branch.findOne({ where: { id, companyId: companyCondition } });
        
        if (!branch) {
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        }

        if (req.body.isMain) {
            await Branch.update({ isMain: false }, { where: { companyId: companyCondition, id: { [Op.ne]: id } } });
        }

        const updateData = { ...req.body };
        delete updateData.id;
        delete updateData.companyId;

        await branch.update(updateData);
        res.json(branch);
    } catch (error) {
        console.error('Update branch error:', error);
        res.status(500).json({ error: 'Error al actualizar sucursal' });
    }
});

// Toggle Branch Active/Inactive Status
router.patch('/:id/toggle-status', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        const branch = await Branch.findOne({ where: { id, companyId: companyCondition } });
        
        if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });

        const newStatus = !branch.isActive;
        await branch.update({ isActive: newStatus });
        res.json({ success: true, isActive: newStatus, message: `Sucursal ${newStatus ? 'activada' : 'desactivada'} con éxito.` });
    } catch (error) {
        console.error('Toggle branch status error:', error);
        res.status(500).json({ error: 'Error al cambiar estado de la sucursal' });
    }
});

// Set branch as Main (Matriz)
router.patch('/:id/set-main', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        const branch = await Branch.findOne({ where: { id, companyId: companyCondition } });
        
        if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });

        await Branch.update({ isMain: false }, { where: { companyId: companyCondition } });
        await branch.update({ isMain: true, isActive: true });
        res.json({ success: true, message: `"${branch.name}" designada como Casa Matriz.` });
    } catch (error) {
        console.error('Set main branch error:', error);
        res.status(500).json({ error: 'Error al definir sede principal' });
    }
});

// GET /branches/:id/analytics - Branch Performance, Stock Valuation & Staff
router.get('/:id/analytics', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        const branch = await Branch.findOne({ where: { id, companyId: companyCondition } });
        
        if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });

        const [salesCount, totalSalesSum, staffList, recentSales, branchStocks] = await Promise.all([
            Sale ? Sale.count({ where: { branchId: id, companyId: companyCondition } }).catch(() => 0) : 0,
            Sale ? Sale.sum('total', { where: { branchId: id, companyId: companyCondition } }).catch(() => 0) : 0,
            User.findAll({
                where: { activeBranchId: id, companyId: companyCondition },
                attributes: ['id', 'name', 'username', 'role', 'status', 'avatarColor']
            }).catch(() => []),
            Sale ? Sale.findAll({
                where: { branchId: id, companyId: companyCondition },
                limit: 5,
                order: [['createdAt', 'DESC']],
                attributes: ['id', 'total', 'paymentMethod', 'createdAt', 'status']
            }).catch(() => []) : [],
            BranchStock && Product ? BranchStock.findAll({
                where: { branchId: id, companyId: companyCondition, quantity: { [Op.gt]: 0 } },
                include: [{ model: Product, attributes: ['price', 'cost'] }]
            }).catch(() => []) : []
        ]);

        // Calculate Stock Valuation (at cost, with fallback to price if cost is 0)
        let totalValuationUSD = 0;
        let totalRetailValuationUSD = 0;
        let totalUnits = 0;
        branchStocks.forEach(bs => {
            const qty = Number(bs.quantity) || 0;
            const price = Number(bs.Product?.price) || 0;
            const cost = Number(bs.Product?.cost) > 0 ? Number(bs.Product?.cost) : price;
            totalUnits += qty;
            totalValuationUSD += qty * cost;
            totalRetailValuationUSD += qty * price;
        });

        res.json({
            branch,
            salesCount: salesCount || 0,
            totalSalesUSD: totalSalesSum || 0,
            totalItemsInStock: branchStocks.length,
            totalUnitsInStock: totalUnits,
            inventoryValuationUSD: totalValuationUSD,
            staff: staffList || [],
            recentSales: recentSales || []
        });
    } catch (error) {
        console.error('Branch analytics error:', error);
        res.status(500).json({ error: 'Error al obtener analíticas de sucursal' });
    }
});

// Delete branch
router.delete('/:id', isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        const branch = await Branch.findOne({ where: { id, companyId: companyCondition } });
        
        if (!branch) {
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        }

        if (branch.isMain) {
            return res.status(400).json({
                error: 'No se puede eliminar la sucursal designada como Casa Matriz. Designe otra sucursal principal primero.'
            });
        }

        if (BranchStock) {
            const activeStockCount = await BranchStock.count({
                where: { branchId: id, companyId: companyCondition, quantity: { [Op.gt]: 0 } }
            }).catch(() => 0);

            if (activeStockCount > 0) {
                return res.status(400).json({ 
                    error: 'No se puede eliminar la sucursal porque contiene inventario físico activo. Realice un ajuste o transferencia previa.' 
                });
            }
            await BranchStock.destroy({ where: { branchId: id, companyId: companyCondition } }).catch(() => {});
        }

        await branch.destroy();
        res.json({ success: true, message: 'Sucursal eliminada correctamente' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
