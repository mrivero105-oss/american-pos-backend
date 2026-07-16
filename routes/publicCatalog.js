const express = require('express');
const router = express.Router();
const { Product } = require('../database/models');
const { getUserSettings, readJson } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');

/**
 * GET /:companyId
 * Catálogo web público (sin autenticación)
 */
router.get('/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Configuración de la empresa
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        
        if (!userSettings) {
            return res.status(404).json({ error: 'Comercio no encontrado' });
        }

        const products = await Product.findAll({
            where: {
                companyId: companyId,
                status: 'active'
            },
            attributes: ['id', 'name', 'price', 'category', 'stockQuantity', 'imageUri'],
            order: [
                ['category', 'ASC'],
                ['name', 'ASC']
            ],
            raw: true
        });

        // Limpiar información sensible y filtrar sin stock si está configurado así
        const publicProducts = products
            //.filter(p => p.stockQuantity > 0) // Opcional: mostrar solo con stock
            .map(p => ({
                id: p.id,
                name: p.name,
                price: parseFloat(p.price) || 0,
                category: p.category || 'General',
                imageUrl: p.imageUri,
                hasStock: parseFloat(p.stockQuantity) > 0
            }));

        res.json({
            business: {
                name: userSettings.businessInfo?.name || 'Tienda en Línea',
                address: userSettings.businessInfo?.address || '',
                phone: userSettings.businessInfo?.phone || '',
                rate: userSettings.exchangeRate || 1.0,
                currencyMode: userSettings.currencyMode || 'BOTH'
            },
            products: publicProducts
        });
    } catch (error) {
        console.error('Error fetching public catalog:', error);
        res.status(500).json({ error: 'Error al cargar catálogo' });
    }
});

module.exports = router;
