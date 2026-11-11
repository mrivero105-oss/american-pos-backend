const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Product, ProductPresentation, User } = require('../database/models');
const PromotionService = require('../services/PromotionService');
const { getUserSettings, readJson } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const cache = require('../utils/cacheService');

const normalizeCountry = (country) => {
    if (!country || typeof country !== 'string') return '';
    return country
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
};

const isDollarOnlyCountry = (country) => {
    const clean = normalizeCountry(country);
    return ['ecuador', 'panama', 'usa', 'eeuu', 'estadosunidos', 'unitedstates', 'us'].includes(clean);
};

/**
 * GET /display/feed
 * Feed público de solo lectura para el Visor de Clientes y Carrusel de Señalización Digital
 * (Compatible con segundo monitor HDMI y Tablets / Smart TVs por Wi-Fi sin sesión iniciada).
 * Seguridad estricta: Nunca expone costos, márgenes ni credenciales.
 */
router.get('/display/feed', async (req, res) => {
    try {
        const allSettings = cache.get('all_settings') || readJson(SETTINGS_FILE) || {};

        let companyId = String(req.query.companyId || '').trim();
        if (!companyId || companyId === 'default' || companyId === 'admin') {
            if (allSettings['2']) {
                companyId = '2';
            } else {
                const primaryUser = await User.findOne({
                    attributes: ['companyId'],
                    order: [['id', 'ASC']],
                    raw: true
                }).catch(() => null);
                companyId = primaryUser?.companyId || '2';
            }
        }

        const userSettings = getUserSettings(allSettings, companyId) || {};
        const bInfo = userSettings.businessInfo || {};
        const country = bInfo.country || '';
        const usdSingle = isDollarOnlyCountry(country);
        const exchangeRate = usdSingle ? 1.0 : (parseFloat(userSettings.exchangeRate) || 1.0);
        const currencyMode = usdSingle ? 'SINGLE' : (userSettings.currencyMode || 'BOTH');

        const rawDisplay = (userSettings.customerDisplay && typeof userSettings.customerDisplay === 'object')
            ? userSettings.customerDisplay
            : {};

        const maxAutoProducts = Math.min(24, Math.max(2, parseInt(rawDisplay.maxAutoProducts, 10) || 10));
        const displayConfig = {
            layoutMode: rawDisplay.layoutMode === 'fullscreen' ? 'fullscreen' : 'split',
            intervalSeconds: Math.min(60, Math.max(3, parseInt(rawDisplay.intervalSeconds, 10) || 8)),
            imageFit: rawDisplay.imageFit === 'cover' ? 'cover' : 'contain',
            autoIncludePromotions: rawDisplay.autoIncludePromotions !== false,
            autoIncludeProducts: rawDisplay.autoIncludeProducts !== false,
            maxAutoProducts,
            institutionalTagline: typeof rawDisplay.institutionalTagline === 'string' && rawDisplay.institutionalTagline.trim()
                ? rawDisplay.institutionalTagline.trim()
                : 'Precios calculados a tasa oficial vigente',
            slides: Array.isArray(rawDisplay.slides)
                ? rawDisplay.slides.filter(s => s && s.enabled !== false)
                : []
        };

        // Métodos de pago públicos para mostrador y QR Pago Móvil / Binance Pay
        const rawMethods = Array.isArray(userSettings.paymentMethods) ? userSettings.paymentMethods : [];
        const publicPaymentMethods = rawMethods
            .filter(m => m && m.enabled !== false)
            .map(m => ({
                id: m.id,
                name: m.name,
                type: m.type,
                currency: m.currency,
                icon: m.icon || '',
                pagoMovilBank: m.pagoMovilBank || '',
                pagoMovilPhone: m.pagoMovilPhone || '',
                pagoMovilId: m.pagoMovilId || '',
                pagoMovilQrMode: m.pagoMovilQrMode || 'AUTO',
                pagoMovilQrImage: m.pagoMovilQrImage || '',
                pagoMovilIncludeAmount: m.pagoMovilIncludeAmount !== false,
                binancePayId: m.binancePayId || bInfo.binancePayId || '',
                binanceEmail: m.binanceEmail || bInfo.binanceEmail || '',
                binanceRate: Number(m.binanceRate || userSettings.binanceRate || 0),
                binanceQrImage: m.binanceQrImage || bInfo.binanceQrImage || '',
                binanceQrMode: m.binanceQrMode || ((m.binanceQrImage || bInfo.binanceQrImage) ? 'IMAGE' : 'AUTO'),
                zelleEmail: m.zelleEmail || bInfo.zelleEmail || '',
                zelleHolder: m.zelleHolder || bInfo.zelleHolder || '',
                bankName: m.bankName || '',
                accountNumber: m.accountNumber || '',
                accountHolder: m.accountHolder || ''
            }));

        const pmMethod = rawMethods.find(m => m.id === 'pago_movil' || m.pagoMovilBank || m.pagoMovilPhone || m.pagoMovilId) || {};
        const pagoMovil = {
            bank: pmMethod.pagoMovilBank || bInfo.pagoMovilBank || '',
            phone: pmMethod.pagoMovilPhone || bInfo.pagoMovilPhone || bInfo.phone || '',
            idNumber: pmMethod.pagoMovilId || bInfo.pagoMovilId || bInfo.rif || '',
            mode: pmMethod.pagoMovilQrMode || bInfo.pagoMovilQrMode || 'AUTO',
            customImage: pmMethod.pagoMovilQrImage || bInfo.pagoMovilQrImage || '',
            includeAmount: pmMethod.pagoMovilIncludeAmount !== false,
            name: pmMethod.name || 'Pago Móvil'
        };

        const binMethod = rawMethods.find(m => m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT' || m.binancePayId || m.binanceEmail) || {};
        const binancePay = {
            payId: binMethod.binancePayId || bInfo.binancePayId || '',
            email: binMethod.binanceEmail || bInfo.binanceEmail || '',
            rate: Number(binMethod.binanceRate || userSettings.binanceRate || 0),
            qrImage: binMethod.binanceQrImage || bInfo.binanceQrImage || '',
            mode: binMethod.binanceQrMode || ((binMethod.binanceQrImage || bInfo.binanceQrImage) ? 'IMAGE' : 'AUTO'),
            name: binMethod.name || 'Binance Pay (USDT)'
        };

        // Consultar productos activos con fotografía y stock disponible (estrictamente sin costos)
        const primaryUsers = await User.findAll({
            attributes: ['companyId'],
            raw: true
        }).catch(() => []);
        const dbCompanyIds = primaryUsers.map(u => u.companyId).filter(Boolean);
        const companyCandidates = [...new Set([companyId, ...dbCompanyIds, '2', '1', 'default'].filter(Boolean))];

        const productsWithImage = await Product.findAll({
            where: {
                companyId: { [Op.in]: companyCandidates },
                status: 'active',
                [Op.or]: [
                    { stockQuantity: { [Op.gt]: 0 } },
                    { stock: { [Op.gt]: 0 } }
                ],
                imageUri: {
                    [Op.and]: [
                        { [Op.ne]: null },
                        { [Op.ne]: '' }
                    ]
                }
            },
            attributes: ['id', 'name', 'price', 'category', 'stock', 'stockQuantity', 'imageUri', 'isSoldByWeight', 'stockUnit'],
            include: [
                {
                    model: ProductPresentation,
                    as: 'Presentations',
                    attributes: ['id', 'name', 'factorConversion', 'price'],
                    required: false
                }
            ],
            order: [['name', 'ASC']],
            limit: Math.max(maxAutoProducts, 16)
        }).catch((err) => {
            console.error('[PublicCatalog] Error querying featured products:', err.message);
            return [];
        });

        const productMap = new Map();
        const sanitizedFeatured = productsWithImage.map(rawProd => {
            const p = typeof rawProd.toJSON === 'function' ? rawProd.toJSON() : rawProd;
            const presentations = Array.isArray(p.Presentations)
                ? p.Presentations
                    .filter(pr => pr && Number(pr.price) > 0)
                    .map(pr => ({
                        id: pr.id,
                        name: pr.name,
                        factorConversion: parseFloat(pr.factorConversion) || 1,
                        price: parseFloat(pr.price) || 0
                    }))
                : [];

            const cleanItem = {
                id: p.id,
                name: p.name,
                price: parseFloat(p.price) || 0,
                category: p.category || 'Catálogo General',
                imageUrl: p.imageUri || '',
                unitType: p.isSoldByWeight ? (p.stockUnit || 'kg') : 'unit',
                presentations
            };
            productMap.set(String(p.id), cleanItem);
            return cleanItem;
        });

        // Promociones activas reales del módulo de Ofertas
        let activePromotions = [];
        try {
            const promos = await PromotionService.getActivePromotions(companyId);
            activePromotions = (Array.isArray(promos) ? promos : []).map(pr => {
                const rawP = typeof pr.toJSON === 'function' ? pr.toJSON() : pr;
                const targetIds = Array.isArray(rawP.targetProductIds) ? rawP.targetProductIds : [];
                let matchedProduct = null;
                for (const tid of targetIds) {
                    if (productMap.has(String(tid))) {
                        matchedProduct = productMap.get(String(tid));
                        break;
                    }
                }
                return {
                    id: rawP.id,
                    name: rawP.name,
                    description: rawP.description || '',
                    type: rawP.type,
                    buyQuantity: parseFloat(rawP.buyQuantity) || 0,
                    payQuantity: parseFloat(rawP.payQuantity) || 0,
                    discountPercentage: parseFloat(rawP.discountPercentage) || 0,
                    fixedPrice: rawP.fixedPrice !== null && rawP.fixedPrice !== undefined ? parseFloat(rawP.fixedPrice) : null,
                    targetCategories: Array.isArray(rawP.targetCategories) ? rawP.targetCategories : [],
                    previewImage: matchedProduct?.imageUrl || '',
                    previewProductName: matchedProduct?.name || '',
                    previewProductPrice: matchedProduct?.price || null
                };
            });
        } catch (_promoErr) {}

        res.json({
            success: true,
            companyId,
            business: {
                name: bInfo.name || 'Isaac POS',
                logo: bInfo.logo || '',
                country: country,
                address: bInfo.address || '',
                phone: bInfo.phone || '',
                rif: bInfo.rif || ''
            },
            exchangeRate,
            currencyMode,
            paymentMethods: publicPaymentMethods,
            pagoMovil,
            binancePay,
            displayConfig,
            activePromotions,
            featuredProducts: sanitizedFeatured.slice(0, maxAutoProducts)
        });
    } catch (error) {
        console.error('Error fetching public display feed:', error);
        res.status(500).json({ success: false, error: 'Error al cargar señalización del visor' });
    }
});

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
