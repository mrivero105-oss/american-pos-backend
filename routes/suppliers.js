const express = require('express');
const router = express.Router();
const { Supplier } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

router.get('/', async (req, res) => {
    try {
        const suppliers = await Supplier.findAll({ where: { userId: req.user.id } });
        res.json(suppliers);
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({ error: 'Error al obtener proveedores' });
    }
});

router.post('/', async (req, res) => {
    try {
        const newSupplier = await Supplier.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...req.body
        });
        res.status(201).json(newSupplier);
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const [updated] = await Supplier.update(req.body, {
            where: { id: req.params.id, userId: req.user.id }
        });
        if (updated) {
            res.json({ message: 'Proveedor actualizado' });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await Supplier.destroy({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (deleted) {
            res.json({ message: 'Proveedor eliminado' });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        console.error('Delete supplier error:', error);
        res.status(500).json({ error: 'Error al eliminar proveedor' });
    }
});

module.exports = router;
