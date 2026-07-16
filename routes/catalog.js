const express = require('express');
const router = express.Router();
const { Product } = require('../database/models');
const { getUserSettings, readJson } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const { Op } = require('sequelize');
const CatalogPdfGenerator = require('../utils/catalogPdf');

/**
 * GET /whatsapp
 * Genera un catálogo formateado para enviarlo por WhatsApp
 */
router.get('/whatsapp', async (req, res) => {
    try {
        // 1. Obtener productos con stock
        const products = await Product.findAll({
            where: {
                companyId: req.user.companyId,
                stockQuantity: {
                    [Op.gt]: 0
                }
            },
            order: [
                ['category', 'ASC'],
                ['name', 'ASC']
            ],
            raw: true
        });

        if (products.length === 0) {
            return res.json({ text: "Actualmente no hay productos con stock disponible." });
        }

        // 2. Obtener configuración de moneda
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.companyId);
        const rate = userSettings.exchangeRate || 1.0;
        const currencyMode = userSettings.currencyMode || 'BOTH';
        const businessName = userSettings.businessInfo?.name || 'Nuestro Catálogo';

        // 3. Agrupar por categorías
        const categories = {};
        products.forEach(p => {
            const cat = p.category || 'GENERAL';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(p);
        });

        // 4. Formatear mensaje
        let message = `*🌟 ${businessName.toUpperCase()} 🌟*\n`;
        message += `_Catálogo de Productos Disponibles_\n\n`;

        Object.keys(categories).forEach(catName => {
            message += `*--------------------------*\n`;
            message += `*📂 ${catName.toUpperCase()}*\n`;
            message += `*--------------------------*\n`;

            categories[catName].forEach(p => {
                const priceUsd = parseFloat(p.price) || 0;
                const priceBs = priceUsd * rate;

                let priceStr = '';
                if (currencyMode === 'USD') {
                    priceStr = `$${priceUsd.toFixed(2)}`;
                } else if (currencyMode === 'VES') {
                    priceStr = `Bs. ${priceBs.toFixed(2)}`;
                } else {
                    priceStr = `$${priceUsd.toFixed(2)} (Bs. ${priceBs.toFixed(2)})`;
                }

                message += `• ${p.name}: ${priceStr}\n`;
            });
            message += `\n`;
        });

        message += `_Precios sujetos a cambio sin previo aviso._\n`;
        message += `*Tasa del día:* ${rate.toFixed(2)} Bs/$`;

        res.json({ text: message });
    } catch (error) {
        console.error('Error generating WhatsApp catalog:', error);
        res.status(500).json({ error: 'Error al generar catálogo' });
    }
});

/**
 * GET /pdf
 * Genera un catálogo profesional en PDF
 */
router.get('/pdf', async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const logFile = path.join(os.tmpdir(), 'american_pos_pdf_debug.log');
    
    try {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] INITIATING PDF for ${req.user.companyId}\n`);
        
        // 1. Obtener productos con stock
        const products = await Product.findAll({
            where: {
                companyId: req.user.companyId,
                stockQuantity: {
                    [Op.gt]: 0
                }
            },
            order: [
                ['category', 'ASC'],
                ['name', 'ASC']
            ],
            raw: true
        });

        // 2. Obtener configuración
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.companyId);
        
        // 3. Agrupar por categorías
        const categories = {};
        products.forEach(p => {
            const cat = p.category || 'GENERAL';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(p);
        });

        // 4. Generar PDF
        const baseUrl = `${req.protocol}://${req.hostname}:3005`;
        const pdfBuffer = await CatalogPdfGenerator.generate(
            userSettings.businessInfo || {},
            categories,
            {
                rate: userSettings.exchangeRate || 1.0,
                currencyMode: userSettings.currencyMode || 'BOTH',
                baseUrl: baseUrl
            }
        );

        res.contentType('application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=catalogo.pdf');
        res.end(pdfBuffer, 'binary');
    } catch (error) {
        console.error('Error generating PDF catalog:', error);
        // Robust logging to tmp
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const logFile = path.join(os.tmpdir(), 'american_pos_pdf_debug.log');
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] FATAL ERROR: ${error.message}\n${error.stack}\n\n`);
        
        res.status(500).json({ error: 'Error al generar PDF: ' + error.message });
    }
});

module.exports = router;
