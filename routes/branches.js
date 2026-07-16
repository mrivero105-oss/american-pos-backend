const express = require('express');
const router = express.Router();
const { Branch, User } = require('../database/models');
const { isAdmin } = require('../middleware/auth');
const { generateRobustId } = require('../utils/helpers');

// Fetch all branches
router.get('/', isAdmin, async (req, res) => {
    try {
        const branches = await Branch.findAll();
        res.json(branches);
    } catch (error) {
        console.error('Get branches error:', error);
        res.status(500).json({ error: 'Error al obtener sucursales' });
    }
});

// Create new branch
router.post('/', isAdmin, async (req, res) => {
    try {
        const newBranch = await Branch.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...req.body
        });
        res.status(201).json(newBranch);
    } catch (error) {
        console.error('Create branch error:', error);
        res.status(500).json({ error: 'Error al crear sucursal' });
    }
});

// Update user active branch
router.post('/switch', isAdmin, async (req, res) => {
    try {
        const { branchId } = req.body;
        // Verify branch exists or is null (global view)
        if (branchId) {
            const branch = await Branch.findByPk(branchId);
            if (!branch) return res.status(404).json({ error: 'Sucursal no encontrada' });
        }

        await User.update({ activeBranchId: branchId || null }, { where: { id: req.user.id } });
        res.json({ success: true, activeBranchId: branchId || null });
    } catch (error) {
        console.error('Switch branch error:', error);
        res.status(500).json({ error: 'Error al cambiar de sucursal' });
    }
});

// Update branch
router.put('/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const branch = await Branch.findByPk(id);
        
        if (!branch) {
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        }

        await branch.update(req.body);
        res.json(branch);
    } catch (error) {
        console.error('Update branch error:', error);
        res.status(500).json({ error: 'Error al actualizar sucursal' });
    }
});

// Delete branch
router.delete('/:id', isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const branch = await Branch.findByPk(id);
        
        if (!branch) {
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        }

        await branch.destroy();
        res.json({ success: true, message: 'Sucursal eliminada' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
