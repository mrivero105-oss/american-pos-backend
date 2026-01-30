const express = require('express');
const router = express.Router();
const { Product, sequelize } = require('../database/models');
const fetch = require('node-fetch');

router.post('/pull-products', async (req, res) => {
    try {
        console.log(`SYNC: User ${req.user.id} initiated product pull.`);
        const CLOUD_URL = 'https://american-pos-main.pages.dev/products?limit=1000';

        console.log('Sync: Fetching products from cloud...');
        const response = await fetch(CLOUD_URL, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Cloud API error: ${response.statusText}`);
        }

        const t = await sequelize.transaction();
        try {
            let updatedCount = 0;
            let createdCount = 0;

            const cloudData = await response.json();
            const cloudProducts = Array.isArray(cloudData) ? cloudData : (cloudData.products || []);

            if (cloudProducts.length === 0) {
                await t.rollback();
                return res.json({ success: true, message: 'No hay productos para sincronizar.', details: { updated: 0 } });
            }

            const globalProducts = await Product.findAll({ transaction: t });
            console.log(`Sync: Loaded ${globalProducts.length} global products for mapping.`);

            const productMapById = new Map();
            const productMapByBarcode = new Map();
            const productMapByName = new Map();

            globalProducts.forEach(lp => {
                const idStr = String(lp.id);
                productMapById.set(idStr, lp);
                if (lp.userId === req.user.id) {
                    if (lp.barcode) productMapByBarcode.set(lp.barcode, lp);
                    productMapByName.set(lp.name.toLowerCase(), lp);
                }
            });

            for (const p of cloudProducts) {
                try {
                    const cloudId = p.id ? String(p.id) : null;
                    if (!cloudId) continue;

                    const incomingData = {
                        name: String(p.name || 'Sin nombre'),
                        price: parseFloat(p.price) || 0,
                        stock: parseFloat(p.stockQuantity) || 0,
                        stockQuantity: parseFloat(p.stockQuantity) || 0,
                        category: String(p.category || 'General'),
                        barcode: String(p.barcode || ''),
                        imageUri: String(p.imageUri || ''),
                        userId: req.user.id
                    };

                    let existingProduct = productMapById.get(cloudId);
                    if (!existingProduct && incomingData.barcode) {
                        existingProduct = productMapByBarcode.get(incomingData.barcode);
                    }
                    if (!existingProduct && incomingData.name) {
                        existingProduct = productMapByName.get(incomingData.name.toLowerCase());
                    }

                    if (existingProduct) {
                        await existingProduct.update(incomingData, { transaction: t });
                        updatedCount++;
                    } else {
                        await Product.create({
                            id: cloudId,
                            isCustom: false,
                            ...incomingData
                        }, { transaction: t });
                        createdCount++;
                    }
                } catch (prodError) {
                    console.error(`Sync error for product ${p.name}:`, prodError.name, prodError.message);
                }
            }

            await t.commit();
            res.json({
                success: true,
                message: `Sincronización exitosa: ${updatedCount} actualizados, ${createdCount} nuevos.`,
                details: { updated: updatedCount, created: createdCount }
            });
        } catch (dbError) {
            console.error('Fatal sync error:', dbError);
            if (t) await t.rollback();
            res.status(500).json({ error: 'Error fatal en la sincronización: ' + dbError.message });
        }
    } catch (error) {
        console.error('Cloud Sync Error:', error);
        res.status(500).json({ error: 'Error al sincronizar con la nube: ' + error.message });
    }
});

router.post('/purge-products', async (req, res) => {
    try {
        console.log(`Sync: Purging all products for user ${req.user.id}...`);
        const deletedCount = await Product.destroy({
            where: { userId: req.user.id }
        });
        res.json({
            success: true,
            message: `Catálogo reiniciado: ${deletedCount} productos eliminados localmente.`,
            details: { purged: deletedCount }
        });
    } catch (error) {
        console.error('Purge Error:', error);
        res.status(500).json({ error: 'Error al limpiar el catálogo: ' + error.message });
    }
});

module.exports = router;
