const {
    Product,
    BranchStock,
    Supplier,
    StockMovement,
    SupplierProductMapping,
    Branch
} = require('../../database/models');
const { sequelize } = require('../../database/connection');
const { generateRobustId, readJsonAsync, getUserSettings } = require('../../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../../utils/precision');
const cacheService = require('../../utils/cacheService');
const { SETTINGS_FILE } = require('../../config/paths');

function tokenizeForCatalogMatch(rawName) {
    const normalized = String(rawName || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/(\d+),(\d+)/g, '$1.$2')
        .replace(/\b1000\s*(?:grs?|gr|g)\b/g, '1kg')
        .replace(/\b1000\s*(?:ml|cc)\b/g, '1l')
        .replace(/\b(\d+(?:\.\d+)?)\s*(?:kilos?|kgs?|kg)\b/g, '$1kg')
        .replace(/\b(\d+(?:\.\d+)?)\s*(?:gramos?|grs?|gr|g)\b/g, '$1g')
        .replace(/\b(\d+(?:\.\d+)?)\s*(?:litros?|lts?|lt|l)\b/g, '$1l')
        .replace(/\b(\d+(?:\.\d+)?)\s*(?:mililitros?|ml|cc)\b/g, '$1ml')
        .replace(/\b(\d+(?:\.\d+)?)\s*(?:onzas?|oz)\b/g, '$1oz')
        .replace(/\b1?\s*x\s*\d{1,4}\b/g, ' ')
        .replace(/[^a-z0-9.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const stopWords = new Set([
        'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'por', 'en', 'un', 'una',
        'caja', 'bulto', 'bult', 'und', 'unid', 'unidad', 'unidades', 'paq', 'paquete', 'pac',
        'display', 'disp', 'dis', 'tira', 'fardo', 'fdo', 'pack', 'pcs', 'ctn', 'pet', 'env',
        'gravable', 'exento'
    ]);

    const measureRegex = /^\d+(?:\.\d+)?(?:kg|g|l|ml|oz)$/;
    const rawTokens = normalized.split(' ').filter(Boolean);
    const measures = [];
    const tokens = [];

    for (const tk of rawTokens) {
        if (measureRegex.test(tk)) {
            measures.push(tk);
            continue;
        }
        if (stopWords.has(tk)) continue;
        if (/^\d+$/.test(tk) && tk.length <= 2) continue;
        if (tk.length >= 2) tokens.push(tk);
    }

    return { normalized, tokens, measures };
}

async function processCatalogImport(productService, reqUser, extractedItems, supplierId = null) {
    const { companyId } = reqUser;
    const results = [];

    const itemsList = Array.isArray(extractedItems)
        ? extractedItems
        : (Array.isArray(extractedItems?.items) ? extractedItems.items : []);

    const docCurrency = (Array.isArray(extractedItems)
        ? 'USD'
        : (extractedItems?.currency || 'USD')).toUpperCase().includes('BS') ? 'BS' : 'USD';

    const detectedDate = !Array.isArray(extractedItems)
        ? (extractedItems?.invoiceDate || extractedItems?.date || null)
        : null;

    const documentType = !Array.isArray(extractedItems) && extractedItems?.documentType
        ? String(extractedItems.documentType).toUpperCase()
        : 'INVOICE';

    const referenceNumber = !Array.isArray(extractedItems) ? (extractedItems?.referenceNumber || null) : null;
    const docSubtotal = !Array.isArray(extractedItems) && extractedItems?.docSubtotal != null ? Number(extractedItems.docSubtotal) : null;
    const docTaxAmount = !Array.isArray(extractedItems) && extractedItems?.docTaxAmount != null ? Number(extractedItems.docTaxAmount) : null;
    const docTotal = !Array.isArray(extractedItems) && extractedItems?.docTotal != null ? Number(extractedItems.docTotal) : null;

    let rate = !Array.isArray(extractedItems) && extractedItems?.exchangeRate
        ? Number(extractedItems.exchangeRate)
        : null;

    let rateSource = !Array.isArray(extractedItems) && extractedItems?.rateSource
        ? extractedItems.rateSource
        : 'BCV';

    let posExchangeRate = 1;
    try {
        const allSettings = await readJsonAsync(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        posExchangeRate = parseFloat(userSettings.exchangeRate || 1) || 1;
    } catch (_e) {
        posExchangeRate = 1;
    }

    if (docCurrency === 'BS' && (!rate || rate <= 0)) {
        try {
            const BCVRateService = require('../BCVRateService');
            const bcvRes = await BCVRateService.getOfficialRate(detectedDate);
            if (bcvRes?.rate && bcvRes.rate > 0) {
                rate = Number(bcvRes.rate);
                rateSource = bcvRes.source || 'BCV';
            }
        } catch (rateErr) {
            console.warn('[processCatalogImport] No se pudo obtener tasa oficial BCV:', rateErr.message);
        }

        if (!rate || rate <= 0) {
            rate = posExchangeRate;
            rateSource = 'Ajustes';
        }
    } else if (docCurrency === 'USD' && (!rate || rate <= 0)) {
        rate = posExchangeRate > 1 ? posExchangeRate : 1;
    }

    let effectiveSupplierId = (supplierId && supplierId !== 'null' && supplierId !== '') ? String(supplierId) : null;
    let detectedSupplierName = !Array.isArray(extractedItems) ? (extractedItems?.supplierName || null) : null;

    if (!effectiveSupplierId && !Array.isArray(extractedItems) && (extractedItems?.supplierRif || extractedItems?.supplierName)) {
        try {
            const companySuppliers = await Supplier.findAll({
                where: { companyId },
                attributes: ['id', 'name', 'rif'],
                raw: true
            });
            if (extractedItems.supplierRif) {
                const cleanTargetRif = String(extractedItems.supplierRif).replace(/[^A-Z0-9]/gi, '').toUpperCase();
                const byRif = companySuppliers.find(s => {
                    const sRif = String(s.rif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                    return sRif && cleanTargetRif && (sRif.includes(cleanTargetRif) || cleanTargetRif.includes(sRif));
                });
                if (byRif) {
                    effectiveSupplierId = byRif.id;
                    detectedSupplierName = byRif.name;
                }
            }
            if (!effectiveSupplierId && extractedItems.supplierName) {
                const cleanTargetName = String(extractedItems.supplierName).toLowerCase().trim();
                const byName = companySuppliers.find(s => {
                    const sName = String(s.name || '').toLowerCase().trim();
                    return sName && sName.length >= 4 && (sName.includes(cleanTargetName) || cleanTargetName.includes(sName));
                });
                if (byName) {
                    effectiveSupplierId = byName.id;
                    detectedSupplierName = byName.name;
                }
            }
        } catch (supErr) {
            console.warn('[processCatalogImport] Aviso buscando proveedor automático:', supErr.message);
        }
    }

    const [existingMappings, companyProducts] = await Promise.all([
        SupplierProductMapping.findAll({
            include: [{
                model: Product,
                as: 'Product',
                where: { companyId },
                required: true,
                attributes: ['id', 'name', 'cost', 'price', 'barcode', 'unitsPerBulk', 'margin', 'taxStatus', 'stockQuantity']
            }]
        }),
        Product.findAll({
            where: { companyId },
            attributes: ['id', 'name', 'cost', 'price', 'barcode', 'unitsPerBulk', 'margin', 'taxStatus', 'stockQuantity'],
            raw: true
        })
    ]);

    const specificMappingMap = new Map();
    const globalMappingMap = new Map();
    existingMappings.forEach(m => {
        if (!m.Product) return;
        const key = String(m.externalName || '').trim().toLowerCase();
        if (!key) return;
        if (effectiveSupplierId && String(m.supplierId || '') === effectiveSupplierId) {
            specificMappingMap.set(key, m.Product);
        }
        if (!globalMappingMap.has(key)) {
            globalMappingMap.set(key, m.Product);
        }
    });

    const barcodeIndex = new Map();
    const exactNormIndex = new Map();
    const indexedCatalog = companyProducts.map(prod => {
        const parsed = productService._tokenizeForCatalogMatch(prod.name);
        if (prod.barcode) {
            barcodeIndex.set(String(prod.barcode).trim(), prod);
        }
        if (parsed.normalized && !exactNormIndex.has(parsed.normalized)) {
            exactNormIndex.set(parsed.normalized, prod);
        }
        return {
            prod,
            normalized: parsed.normalized,
            tokenSet: new Set(parsed.tokens),
            tokens: parsed.tokens,
            measures: parsed.measures
        };
    });

    const buildMatchedDto = (p) => ({
        id: p.id,
        name: p.name,
        cost: Number(p.cost || 0),
        currentCost: Number(p.cost || 0),
        price: Number(p.price || 0),
        barcode: p.barcode || null,
        unitsPerBulk: Number(p.unitsPerBulk || 1),
        margin: Number(p.margin || 0),
        taxStatus: p.taxStatus || 'gravable',
        stockQuantity: Number(p.stockQuantity || 0)
    });

    for (const item of itemsList) {
        if (!item.externalName || typeof item.externalName !== 'string') continue;

        const nameToMatch = item.externalName.trim();
        const lowerKey = nameToMatch.toLowerCase();

        const rawPrice = precision.parseNumericInput(item.price ?? item.cost ?? 0);
        const isExempt = item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0;
        const taxRate = item.taxRate !== undefined ? Number(item.taxRate) : (isExempt ? 0 : 16);
        const taxStatus = isExempt ? 'exento' : 'gravable';
        const suggestedQuantity = Math.max(1, parseInt(item.suggestedQuantity || 1, 10) || 1);
        const purchasedQuantity = Math.max(0, precision.parseNumericInput(item.purchasedQuantity ?? (documentType === 'CATALOG' ? 0 : 1)));

        const basePriceBs = docCurrency === 'BS'
            ? precision.round(rawPrice, 2)
            : (rate > 0 ? precision.round(precision.multiply(rawPrice, rate), 2) : 0);
        const basePriceUsd = docCurrency === 'BS'
            ? (rate > 0 ? precision.round(precision.divide(rawPrice, rate), 6) : rawPrice)
            : precision.round(rawPrice, 6);

        const baseItemData = {
            externalName: nameToMatch,
            barcode: item.barcode || null,
            purchasedQuantity,
            price: basePriceUsd,
            basePrice: basePriceUsd,
            basePriceBs,
            rawPriceBs: basePriceBs,
            suggestedQuantity,
            isExempt,
            taxRate,
            taxStatus
        };

        const matchedFromSupplierMap = specificMappingMap.get(lowerKey);
        const matchedFromGlobalMap = !matchedFromSupplierMap ? globalMappingMap.get(lowerKey) : null;
        if (matchedFromSupplierMap || matchedFromGlobalMap) {
            const targetProd = matchedFromSupplierMap || matchedFromGlobalMap;
            results.push({
                ...baseItemData,
                matchedProduct: buildMatchedDto(targetProd),
                confidence: matchedFromSupplierMap ? 100 : 98
            });
            continue;
        }

        const itemTokens = productService._tokenizeForCatalogMatch(nameToMatch);
        const byBarcode = item.barcode ? barcodeIndex.get(String(item.barcode).trim()) : null;
        const byExactNorm = !byBarcode && itemTokens.normalized ? exactNormIndex.get(itemTokens.normalized) : null;
        if (byBarcode || byExactNorm) {
            results.push({
                ...baseItemData,
                matchedProduct: buildMatchedDto(byBarcode || byExactNorm),
                confidence: byBarcode ? 99 : 95
            });
            continue;
        }

        let bestCandidate = null;
        let bestScore = 0;

        if (itemTokens.tokens.length > 0) {
            for (const entry of indexedCatalog) {
                if (entry.tokens.length === 0) continue;

                if (itemTokens.measures.length > 0 && entry.measures.length > 0) {
                    const sharesMeasure = itemTokens.measures.some(m => entry.measures.includes(m));
                    if (!sharesMeasure) continue;
                }

                let matchedCount = 0;
                for (const tk of itemTokens.tokens) {
                    if (entry.tokenSet.has(tk)) {
                        matchedCount += 1;
                    } else if (tk.length >= 4) {
                        const partialHit = entry.tokens.some(et => et.length >= 4 && (et.startsWith(tk) || tk.startsWith(et)));
                        if (partialHit) matchedCount += 0.8;
                    }
                }

                if (matchedCount === 0) continue;

                const unionSize = new Set([...itemTokens.tokens, ...entry.tokens]).size || 1;
                const jaccard = matchedCount / unionSize;
                const coverageExternal = matchedCount / itemTokens.tokens.length;
                const coverageLocal = matchedCount / entry.tokens.length;
                let score = (jaccard * 0.45) + (Math.max(coverageExternal, coverageLocal) * 0.35) + (Math.min(coverageExternal, coverageLocal) * 0.20);

                if (itemTokens.measures.length > 0 && entry.measures.some(m => itemTokens.measures.includes(m))) {
                    score += 0.12;
                }

                if (matchedCount < 1.5 && (itemTokens.tokens.length >= 2 && entry.tokens.length >= 2) && score < 0.65) {
                    continue;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = entry.prod;
                }
            }
        }

        if (bestCandidate && bestScore >= 0.56) {
            results.push({
                ...baseItemData,
                matchedProduct: buildMatchedDto(bestCandidate),
                confidence: bestScore >= 0.88 ? 92 : 70
            });
        } else {
            results.push({
                ...baseItemData,
                matchedProduct: null,
                confidence: 0
            });
        }
    }

    results.items = results;
    results.currency = docCurrency;
    results.rate = rate;
    results.posExchangeRate = posExchangeRate;
    results.invoiceDate = detectedDate;
    results.rateSource = rateSource;
    results.documentType = documentType;
    results.referenceNumber = referenceNumber;
    results.detectedSupplierId = effectiveSupplierId;
    results.detectedSupplierName = detectedSupplierName;
    results.docSubtotal = docSubtotal;
    results.docTaxAmount = docTaxAmount;
    results.docTotal = docTotal;

    return results;
}

async function searchProductsForLink(reqUser, search) {
    const { companyId } = reqUser;
    const searchTerm = (search || '').trim();
    if (!searchTerm) return [];

    const isPostgres = sequelize.getDialect() === 'postgres';
    const safeLikePattern = sequelize.escape(`%${searchTerm}%`);
    const searchCondition = isPostgres
        ? {
            [Op.or]: [
                sequelize.literal(`public.immutable_unaccent(lower("Product"."name")) ILIKE public.immutable_unaccent(lower(${safeLikePattern}))`),
                sequelize.literal(`COALESCE("Product"."barcode", '') ILIKE ${safeLikePattern}`)
            ]
        }
        : {
            [Op.or]: [
                sequelize.where(sequelize.fn('LOWER', sequelize.col('name')), { [Op.like]: `%${searchTerm.toLowerCase()}%` }),
                sequelize.where(sequelize.fn('LOWER', sequelize.fn('COALESCE', sequelize.col('barcode'), '')), { [Op.like]: `%${searchTerm.toLowerCase()}%` })
            ]
        };

    const products = await Product.findAll({
        where: {
            companyId,
            ...searchCondition
        },
        attributes: ['id', 'name', 'cost', 'price', 'barcode', 'unitsPerBulk', 'margin', 'taxStatus', 'stockQuantity'],
        limit: 25
    });

    const ProductServiceRef = require('../ProductService');
    const canSeeCosts = typeof ProductServiceRef?.canUserViewCosts === 'function'
        ? ProductServiceRef.canUserViewCosts(reqUser)
        : false;

    return products.map(p => {
        const plain = p.get({ plain: true });
        const cleanCost = Number(plain.cost || 0);
        const mapped = {
            ...plain,
            cost: cleanCost,
            currentCost: cleanCost,
            price: Number(plain.price || 0),
            unitsPerBulk: Number(plain.unitsPerBulk || 1),
            margin: Number(plain.margin || 0),
            stockQuantity: Number(plain.stockQuantity || 0)
        };
        if (!canSeeCosts) {
            delete mapped.cost;
            delete mapped.currentCost;
            delete mapped.margin;
        }
        return mapped;
    });
}

async function saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, transaction) {
    const whereClause = {
        externalName: cleanExternalName,
        supplierId: finalSupplierId
    };
    const existing = await SupplierProductMapping.findOne({
        where: whereClause,
        transaction
    });
    if (existing) {
        await existing.update({
            localProductId: finalLocalProductId,
            lastUpdated: new Date()
        }, { transaction });
    } else {
        await SupplierProductMapping.create({
            externalName: cleanExternalName,
            localProductId: finalLocalProductId,
            supplierId: finalSupplierId,
            lastUpdated: new Date()
        }, { transaction });
    }
}

async function applySupplierMapping(productService, reqUser, mappings, invoiceOptions = {}) {
    const { companyId, id: userId } = reqUser;
    let updateCount = 0;
    const resolvedOrderItems = [];

    const t = await sequelize.transaction();
    try {
        let dbBranch = null;
        if (reqUser.activeBranchId && reqUser.activeBranchId !== '1' && reqUser.activeBranchId !== 'null' && reqUser.activeBranchId !== 'undefined') {
            dbBranch = await Branch.findOne({ where: { id: reqUser.activeBranchId, companyId }, transaction: t });
        }
        if (!dbBranch) {
            dbBranch = await Branch.findOne({ where: { companyId }, transaction: t });
        }
        if (!dbBranch) {
            dbBranch = await Branch.create({
                id: generateRobustId(),
                userId,
                companyId,
                name: 'Principal',
                isMain: true,
                isActive: true
            }, { transaction: t });
        }
        const activeBranchId = dbBranch.id;

        const allSettings = await readJsonAsync(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const posRate = parseFloat(userSettings.exchangeRate || 1) || 1;

        let headerSupplierId = (invoiceOptions?.supplierId && invoiceOptions.supplierId !== 'null' && invoiceOptions.supplierId !== '')
            ? String(invoiceOptions.supplierId)
            : null;

        if (!headerSupplierId && invoiceOptions?.newSupplier?.name) {
            const cleanName = String(invoiceOptions.newSupplier.name).trim();
            const cleanRif = invoiceOptions.newSupplier.rif ? String(invoiceOptions.newSupplier.rif).trim() : null;

            let existing = null;
            if (cleanRif) {
                existing = await Supplier.findOne({ where: { companyId, rif: cleanRif }, transaction: t });
            }
            if (!existing && cleanName) {
                existing = await Supplier.findOne({ where: { companyId, name: cleanName }, transaction: t });
            }

            if (existing) {
                headerSupplierId = existing.id;
            } else {
                const newSup = await Supplier.create({
                    id: generateRobustId(),
                    name: cleanName,
                    rif: cleanRif,
                    phone: invoiceOptions.newSupplier.phone ? String(invoiceOptions.newSupplier.phone).trim() : null,
                    contact: invoiceOptions.newSupplier.contact ? String(invoiceOptions.newSupplier.contact).trim() : null,
                    companyId,
                    userId,
                    creditBalance: 0,
                    isActive: true
                }, { transaction: t });
                headerSupplierId = newSup.id;
            }
        }
        const isInvoiceMode = invoiceOptions?.importMode === 'INVOICE' || invoiceOptions?.createPurchaseOrder === true;
        const refLabel = invoiceOptions?.referenceNumber ? `Factura ${invoiceOptions.referenceNumber}` : 'Importador';

        for (const map of mappings) {
            try {
                const {
                    externalName,
                    localProductId,
                    price,
                    supplierId,
                    quantity = 1,
                    purchasedQuantity,
                    margin,
                    allowZeroMargin = false,
                    newPrice,
                    isNew,
                    initialStock,
                    imageUri,
                    barcode,
                    taxStatus,
                    isExempt,
                    taxRate
                } = map;

                if (margin !== undefined && margin !== null && margin !== '' && !isNaN(parseFloat(margin)) && parseFloat(margin) < 0) {
                    throw new Error(`El margen de utilidad no puede ser negativo para "${externalName || 'producto'}".`);
                }

                const isNewProduct = isNew === true || String(isNew) === 'true';
                const finalSupplierId = (supplierId && supplierId !== 'null' && supplierId !== '')
                    ? String(supplierId)
                    : headerSupplierId;
                const cleanExternalName = String(externalName || 'DESCONOCIDO').trim();
                let finalLocalProductId = (localProductId && localProductId !== 'null') ? String(localProductId) : null;

                const safeBulkCost = Math.max(0, precision.round(precision.parseNumericInput(price), 6));
                const unitQuantity = Math.max(1, precision.parseNumericInput(quantity) || 1);
                const unitCost = precision.round(precision.divide(safeBulkCost, unitQuantity), 6);

                const itemIsExempt = isExempt === true || taxStatus === 'exento' || (taxRate !== undefined && Number(taxRate) === 0);
                const resolvedTaxStatus = itemIsExempt ? 'exento' : 'gravable';
                const stockToAdd = isInvoiceMode ? Math.max(0, precision.round(precision.parseNumericInput(initialStock), 6)) : 0;
                const packsPurchased = Math.max(0, precision.parseNumericInput(purchasedQuantity ?? (isInvoiceMode ? 1 : 0)));

                const allowZero = allowZeroMargin === true || String(allowZeroMargin) === 'true';
                const hasExplicitMargin = margin !== undefined && margin !== null && margin !== '' && !isNaN(parseFloat(margin));
                const parsedExplicitMargin = hasExplicitMargin ? precision.round(parseFloat(margin), 4) : null;

                const computeSalesPrice = (effMargin, fallbackPrice = 0) => {
                    if (newPrice !== undefined && newPrice !== null && precision.parseNumericInput(newPrice) > 0) {
                        const explicitPvp = precision.parseNumericInput(newPrice);
                        return explicitPvp < 0.10 ? precision.round(explicitPvp, 4) : precision.round(explicitPvp, 2);
                    }
                    if (unitCost > 0) {
                        const safeMargin = precision.parseNumericInput(effMargin);
                        if (safeMargin <= 0 && !allowZero) {
                            if (fallbackPrice > unitCost) {
                                return fallbackPrice < 0.10 ? precision.round(fallbackPrice, 4) : precision.round(fallbackPrice, 2);
                            }
                            const defaultMarkupPvp = precision.multiply(unitCost, 1.30);
                            return defaultMarkupPvp < 0.10 ? precision.round(defaultMarkupPvp, 4) : precision.round(defaultMarkupPvp, 2);
                        }
                        const effectiveSafeMargin = Math.max(0, safeMargin);
                        const multiplier = precision.add([1, precision.divide(effectiveSafeMargin, 100)]);
                        const rawPvp = precision.multiply(unitCost, multiplier);
                        return rawPvp < 0.10 ? precision.round(rawPvp, 4) : precision.round(rawPvp, 2);
                    }
                    return fallbackPrice;
                };

                if (isNewProduct) {
                    const newId = generateRobustId();
                    const updatedMargin = (hasExplicitMargin && (parsedExplicitMargin > 0 || allowZero))
                        ? parsedExplicitMargin
                        : 30;
                    const updatedPrice = computeSalesPrice(updatedMargin, 0);
                    const updatedPriceBs = precision.round(precision.multiply(updatedPrice, posRate), 2);

                    const newProduct = await Product.create({
                        id: newId,
                        name: cleanExternalName,
                        barcode: barcode ? String(barcode).trim() : null,
                        cost: unitCost,
                        price: updatedPrice,
                        priceBs: updatedPriceBs,
                        bulkCost: safeBulkCost,
                        unitsPerBulk: unitQuantity,
                        margin: updatedMargin,
                        companyId,
                        userId,
                        category: 'General',
                        stockUnit: 'unidad',
                        taxStatus: resolvedTaxStatus,
                        supplierId: finalSupplierId,
                        imageUri: imageUri || null,
                        status: 'active',
                        stockQuantity: stockToAdd,
                        stock: stockToAdd
                    }, { transaction: t });

                    finalLocalProductId = newProduct.id;

                    if (stockToAdd > 0 && activeBranchId) {
                        await BranchStock.create({
                            productId: newId,
                            branchId: activeBranchId,
                            quantity: stockToAdd,
                            companyId
                        }, { transaction: t });

                        await StockMovement.create({
                            id: generateRobustId(),
                            productId: newId,
                            userId,
                            companyId,
                            type: 'IN',
                            quantity: stockToAdd,
                            stockBefore: 0,
                            stockAfter: stockToAdd,
                            reason: `Carga Inicial (${refLabel})`,
                            referenceId: invoiceOptions?.referenceNumber || newId,
                            date: new Date().toISOString()
                        }, { transaction: t });
                    }

                    await productService._saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, t);

                    await productService._logAudit(
                        reqUser,
                        'PRODUCT_CREATED_IMPORT',
                        `Nuevo por Importación: ${cleanExternalName}`,
                        finalLocalProductId,
                        { cost: 0, price: 0, stock: 0, taxStatus: null },
                        { cost: unitCost, margin: updatedMargin, price: updatedPrice, priceBs: updatedPriceBs, stock: stockToAdd, taxStatus: resolvedTaxStatus },
                        t
                    );

                    resolvedOrderItems.push({
                        productId: finalLocalProductId,
                        name: cleanExternalName,
                        purchasedQuantity: packsPurchased > 0 ? packsPurchased : (stockToAdd > 0 ? precision.round(precision.divide(stockToAdd, unitQuantity), 4) : 1),
                        unitsPerBulk: unitQuantity,
                        quantity: stockToAdd > 0 ? stockToAdd : unitQuantity,
                        bulkCost: safeBulkCost,
                        cost: unitCost,
                        taxStatus: resolvedTaxStatus,
                        subtotal: precision.round(precision.multiply(safeBulkCost, packsPurchased > 0 ? packsPurchased : 1), 2)
                    });

                    updateCount++;
                    continue;
                }

                if (!finalLocalProductId) continue;

                await productService._saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, t);

                const product = await Product.findOne({
                    where: { id: finalLocalProductId, companyId },
                    include: [{ model: BranchStock, as: 'BranchStocks' }],
                    transaction: t
                });

                if (product) {
                    const oldCost = precision.parseNumericInput(product.cost);
                    const oldPrice = precision.parseNumericInput(product.price);
                    const oldPriceBs = product.priceBs;
                    const oldMargin = product.margin;
                    const oldTaxStatus = product.taxStatus;

                    let updatedMargin;
                    if (hasExplicitMargin && (parsedExplicitMargin > 0 || allowZero)) {
                        updatedMargin = parsedExplicitMargin;
                    } else if (precision.parseNumericInput(product.margin) > 0) {
                        updatedMargin = precision.round(precision.parseNumericInput(product.margin), 4);
                    } else if (oldCost > 0 && oldPrice > oldCost) {
                        updatedMargin = precision.round(precision.multiply(precision.divide(precision.subtract(oldPrice, oldCost), oldCost), 100), 4);
                    } else if (unitCost > 0 && oldPrice > unitCost) {
                        updatedMargin = precision.round(precision.multiply(precision.divide(precision.subtract(oldPrice, unitCost), unitCost), 100), 4);
                    } else {
                        updatedMargin = 30;
                    }
                    const updatedPrice = computeSalesPrice(updatedMargin, oldPrice);
                    if (unitCost > 0 && updatedPrice > 0 && (!hasExplicitMargin || (parsedExplicitMargin === 0 && !allowZero))) {
                        updatedMargin = precision.round(precision.multiply(precision.divide(precision.subtract(updatedPrice, unitCost), unitCost), 100), 4);
                    }
                    const updatedPriceBs = precision.round(precision.multiply(updatedPrice, posRate), 2);

                    const updateData = {
                        bulkCost: safeBulkCost,
                        unitsPerBulk: unitQuantity,
                        cost: unitCost,
                        margin: updatedMargin,
                        price: updatedPrice,
                        priceBs: updatedPriceBs,
                        taxStatus: resolvedTaxStatus
                    };

                    if (finalSupplierId) {
                        updateData.supplierId = finalSupplierId;
                    }
                    if (imageUri) {
                        updateData.imageUri = imageUri;
                    }

                    if (stockToAdd > 0) {
                        const currentGlobalStock = Number(product.stockQuantity ?? product.stock ?? 0);
                        const newGlobalStock = precision.round(precision.add([currentGlobalStock, stockToAdd]), 6);
                        updateData.status = 'active';
                        updateData.stockQuantity = String(newGlobalStock);
                        updateData.stock = String(newGlobalStock);

                        if (activeBranchId) {
                            const branchStock = product.BranchStocks?.find(s => s.branchId === activeBranchId);
                            const stockBefore = branchStock ? Number(branchStock.quantity) : 0;
                            const stockAfter = precision.round(precision.add([stockBefore, stockToAdd]), 6);

                            if (branchStock) {
                                await branchStock.update({ quantity: stockAfter }, { transaction: t });
                            } else {
                                await BranchStock.create({
                                    productId: finalLocalProductId,
                                    branchId: activeBranchId,
                                    quantity: stockAfter,
                                    companyId
                                }, { transaction: t });
                            }

                            await StockMovement.create({
                                id: generateRobustId(),
                                productId: finalLocalProductId,
                                userId,
                                companyId,
                                type: 'IN',
                                quantity: stockToAdd,
                                stockBefore: currentGlobalStock,
                                stockAfter: newGlobalStock,
                                reason: `Recepción Mercancía (${refLabel})`,
                                referenceId: invoiceOptions?.referenceNumber || finalLocalProductId,
                                date: new Date().toISOString()
                            }, { transaction: t });
                        }
                    }

                    await product.update(updateData, { transaction: t });
                    updateCount++;

                    resolvedOrderItems.push({
                        productId: finalLocalProductId,
                        name: product.name || cleanExternalName,
                        purchasedQuantity: packsPurchased > 0 ? packsPurchased : (stockToAdd > 0 ? precision.round(precision.divide(stockToAdd, unitQuantity), 4) : 1),
                        unitsPerBulk: unitQuantity,
                        quantity: stockToAdd > 0 ? stockToAdd : unitQuantity,
                        bulkCost: safeBulkCost,
                        cost: unitCost,
                        taxStatus: resolvedTaxStatus,
                        subtotal: precision.round(precision.multiply(safeBulkCost, packsPurchased > 0 ? packsPurchased : 1), 2)
                    });

                    await productService._logAudit(
                        reqUser,
                        'COST_UPDATE_IMPORT',
                        `Importación (${refLabel}): ${product.name}`,
                        finalLocalProductId,
                        { cost: oldCost, margin: oldMargin, price: oldPrice, priceBs: oldPriceBs, taxStatus: oldTaxStatus },
                        { cost: unitCost, margin: updatedMargin, price: updatedPrice, priceBs: updatedPriceBs, taxStatus: resolvedTaxStatus },
                        t
                    );
                }
            } catch (error) {
                console.error('[IMPORT ERROR] Falla en item:', map.externalName, error);
                throw error;
            }
        }

        let createdPurchaseOrderId = null;
        let creditCharged = false;
        let newSupplierBalance = null;

        if (isInvoiceMode && invoiceOptions?.createPurchaseOrder && resolvedOrderItems.length > 0) {
            const { PurchaseOrder, SupplierCreditHistory } = require('../../database/models');
            const paymentStatus = invoiceOptions.paymentStatus === 'unpaid' ? 'unpaid' : 'paid';

            if (paymentStatus === 'unpaid' && !headerSupplierId) {
                throw new Error('Debes seleccionar un Proveedor para registrar la factura a Crédito (Cuentas por Pagar).');
            }

            const calculatedTotalUsd = resolvedOrderItems.reduce(
                (acc, it) => precision.round(precision.add([acc, it.subtotal || 0]), 2),
                0
            );
            const explicitTotalUsd = precision.parseNumericInput(invoiceOptions.totalUsd);
            const finalTotalUsd = explicitTotalUsd > 0 ? precision.round(explicitTotalUsd, 2) : calculatedTotalUsd;

            const invRate = precision.parseNumericInput(invoiceOptions.exchangeRate) > 0
                ? precision.round(precision.parseNumericInput(invoiceOptions.exchangeRate), 6)
                : posRate;
            const explicitTotalVes = precision.parseNumericInput(invoiceOptions.totalVes);
            const finalTotalVes = explicitTotalVes > 0
                ? precision.round(explicitTotalVes, 2)
                : precision.round(precision.multiply(finalTotalUsd, invRate), 2);

            const arrivalDate = invoiceOptions.invoiceDate || new Date().toISOString().split('T')[0];
            const dueDate = paymentStatus === 'unpaid' ? (invoiceOptions.dueDate || null) : null;
            const refNo = String(invoiceOptions.referenceNumber || '').trim() || `IMP-${Date.now().toString().slice(-6)}`;
            const orderId = generateRobustId();

            await PurchaseOrder.create({
                id: orderId,
                userId,
                companyId,
                supplierId: headerSupplierId,
                date: arrivalDate,
                arrivalDate,
                expectedDate: dueDate || arrivalDate,
                dueDate,
                exchangeRate: invRate,
                status: 'received',
                receivedAt: new Date().toISOString(),
                referenceNumber: refNo,
                invoiceUrl: invoiceOptions.invoiceUrl || null,
                paymentStatus,
                items: resolvedOrderItems,
                notes: invoiceOptions.notes || `Recepción procesada desde Importador (${resolvedOrderItems.length} renglones)`,
                total: finalTotalUsd,
                totalVes: finalTotalVes
            }, { transaction: t });

            createdPurchaseOrderId = orderId;

            if (paymentStatus === 'unpaid' && headerSupplierId && finalTotalUsd > 0) {
                const supplier = await Supplier.findOne({
                    where: { id: headerSupplierId, companyId },
                    transaction: t
                });
                if (!supplier) {
                    throw new Error('El proveedor seleccionado no existe o no pertenece a esta empresa.');
                }

                const oldBalance = Number(supplier.creditBalance) || 0;
                newSupplierBalance = precision.round(precision.add([oldBalance, finalTotalUsd]), 2);
                await supplier.update({ creditBalance: newSupplierBalance }, { transaction: t });

                await SupplierCreditHistory.create({
                    id: generateRobustId(),
                    supplierId: headerSupplierId,
                    userId,
                    companyId,
                    timestamp: new Date().toISOString(),
                    type: 'charge',
                    amount: finalTotalUsd,
                    balanceAfter: newSupplierBalance,
                    description: `Factura ${refNo} (Tasa: ${invRate} Bs/$) - Recepción Importador (${resolvedOrderItems.length} ítems)`,
                    paymentMethod: 'credit',
                    purchaseOrderId: orderId,
                    referenceNumber: refNo,
                    invoiceUrl: invoiceOptions.invoiceUrl || null,
                    arrivalDate,
                    dueDate,
                    exchangeRate: invRate
                }, { transaction: t });

                creditCharged = true;
            } else if (paymentStatus === 'paid' && headerSupplierId && finalTotalUsd > 0) {
                const supplier = await Supplier.findOne({
                    where: { id: headerSupplierId, companyId },
                    transaction: t
                });
                const currentBalance = Number(supplier?.creditBalance || 0);
                const payMethod = invoiceOptions.paymentMethod || 'cash';
                const chargeId = generateRobustId();

                await SupplierCreditHistory.create({
                    id: chargeId,
                    supplierId: headerSupplierId,
                    userId,
                    companyId,
                    timestamp: new Date().toISOString(),
                    type: 'charge',
                    amount: finalTotalUsd,
                    balanceAfter: currentBalance,
                    description: `Factura ${refNo} (Contado / Tasa: ${invRate} Bs/$) - Recepción (${resolvedOrderItems.length} ítems)`,
                    paymentMethod: payMethod,
                    purchaseOrderId: orderId,
                    referenceNumber: refNo,
                    invoiceUrl: invoiceOptions.invoiceUrl || null,
                    arrivalDate,
                    dueDate: arrivalDate,
                    exchangeRate: invRate
                }, { transaction: t });

                await SupplierCreditHistory.create({
                    id: generateRobustId(),
                    supplierId: headerSupplierId,
                    userId,
                    companyId,
                    timestamp: new Date().toISOString(),
                    type: 'payment',
                    amount: finalTotalUsd,
                    balanceAfter: currentBalance,
                    description: `Liquidación Contado (${payMethod}) Factura ${refNo}`,
                    paymentMethod: payMethod,
                    purchaseOrderId: orderId,
                    referenceNumber: refNo,
                    invoiceUrl: invoiceOptions.invoiceUrl || null,
                    arrivalDate,
                    dueDate: arrivalDate,
                    exchangeRate: invRate
                }, { transaction: t });
            }
        }

        await t.commit();

        cacheService.delPrefix('categories_');
        productService.invalidateCatalogCache();

        if (invoiceOptions && Object.keys(invoiceOptions).length > 0) {
            return {
                updateCount,
                updatedCount: updateCount,
                purchaseOrderId: createdPurchaseOrderId,
                creditCharged,
                newSupplierBalance
            };
        }
        return updateCount;
    } catch (error) {
        await t.rollback();
        console.error('[IMPORT TRANSACTION ROLLBACK] La importación fue revertida debido a un error:', error.message);
        throw error;
    }
}

module.exports = {
    tokenizeForCatalogMatch,
    processCatalogImport,
    searchProductsForLink,
    saveSupplierMappingSafe,
    applySupplierMapping
};
