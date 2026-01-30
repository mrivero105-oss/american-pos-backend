const express = require('express');
const router = express.Router();
const { Product, sequelize } = require('../database/models');
const { Op } = require('sequelize');
const { generateRobustId, sanitizeForModel, bulkCreateResilient } = require('../utils/helpers');

router.get('/', async (req, res) => {
    try {
        console.log(`API: Fetching products for user ID: ${req.user.id}`);
        const whereClause = { userId: req.user.id };

        if (req.query.category && req.query.category !== 'Todas') {
            whereClause.category = req.query.category;
        }

        if (req.query.search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${req.query.search}%` } },
            ];
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 0;

        let options = {
            where: whereClause,
            order: [['name', 'ASC']]
        };

        if (limit > 0) {
            options.limit = limit;
            options.offset = (page - 1) * limit;
        }

        const { count, rows } = await Product.findAndCountAll(options);

        const products = rows.map(p => {
            const plain = p.toJSON();
            plain.stockQuantity = (plain.stockQuantity !== undefined && plain.stockQuantity !== null) ? plain.stockQuantity : (plain.stock || 0);
            return plain;
        });

        if (limit > 0 || req.query.page) {
            res.json({
                products: products,
                total: count,
                page: page,
                totalPages: limit > 0 ? Math.ceil(count / limit) : 1
            });
        } else {
            res.json(products);
        }
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { data } = await sanitizeForModel(Product, [req.body]);
        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'Datos de producto inválidos' });
        }

        const productData = data[0];
        const newProduct = await Product.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...productData
        });
        res.status(201).json(newProduct);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

router.post('/bulk', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { products } = req.body;
        if (!products || !Array.isArray(products)) {
            return res.status(400).json({ error: 'Se requiere un arreglo de productos' });
        }

        const preparedProducts = products.map(p => ({
            ...p,
            id: p.id || generateRobustId(),
            userId: req.user.id,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        await bulkCreateResilient(Product, preparedProducts, t);
        await t.commit();
        res.json({ success: true, count: products.length });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Bulk products error:', error);
        res.status(500).json({ error: 'Error en carga masiva: ' + error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { data } = await sanitizeForModel(Product, [req.body]);
        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'Datos de actualización inválidos' });
        }

        const updateData = data[0];
        const [updated] = await Product.update(updateData, {
            where: { id: req.params.id, userId: req.user.id }
        });
        if (updated) {
            res.json({ message: 'Producto actualizado' });
        } else {
            res.status(404).json({ message: 'Producto no encontrado' });
        }
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await Product.destroy({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (deleted) {
            res.json({ message: 'Producto eliminado' });
        } else {
            res.status(404).json({ message: 'Producto no encontrado' });
        }
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

router.get('/categories', async (req, res) => {
    try {
        const products = await Product.findAll({
            where: { userId: req.user.id },
            attributes: ['category']
        });

        const categoryCounts = {};
        let total = 0;

        products.forEach(p => {
            const cat = p.category || 'Sin Categoría';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
            total++;
        });

        res.json({
            total: total,
            counts: categoryCounts
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

module.exports = router;
