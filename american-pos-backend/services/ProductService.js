const { Product, BranchStock, Supplier, AuditLog, StockMovement, SupplierProductMapping, Branch, VarianteProducto, ProductPresentation, WarehouseStock } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, readJson, readJsonAsync, getUserSettings } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/precision');
const cacheService = require('../utils/cacheService');
const { SETTINGS_FILE } = require('../config/paths');
const productMediaService = require('./product/productMediaService');
const productWasteAndAudit = require('./product/productWasteAndAudit');
const fs = require('fs');
const path = require('path');


class ProductService {
    constructor() {
        this._serverBootMs = Date.now();
        this._deletedProductsLog = new Map();
    }

    /**
     * Registra un producto eliminado para sincronización delta (?since=)
     */
    recordDeletedProduct(companyId, productId) {
        const compKey = String(companyId || 'default');
        const now = Date.now();
        let list = this._deletedProductsLog.get(compKey);
        if (!list) {
            list = [];
            this._deletedProductsLog.set(compKey, list);
        }
        list.push({ id: String(productId), deletedAtMs: now });
        // Podar entradas > 24h o exceso de tamaño para mantener memoria acotada
        if (list.length > 500) {
            const cutoff = now - (24 * 60 * 60 * 1000);
            const pruned = list.filter(e => e.deletedAtMs >= cutoff).slice(-2000);
            this._deletedProductsLog.set(compKey, pruned);
        }
    }

    getDeletedProductsSince(companyId, sinceMs) {
        const compKey = String(companyId || 'default');
        const list = this._deletedProductsLog.get(compKey);
        if (!Array.isArray(list) || list.length === 0) return [];
        const ids = new Set();
        for (const entry of list) {
            if (entry.deletedAtMs >= sinceMs) ids.add(entry.id);
        }
        return Array.from(ids);
    }

    /**
     * Evalúa si el usuario solicitante tiene autorización para visualizar costos de compra y márgenes.
     */
    canUserViewCosts(reqUser) {
        if (!reqUser || reqUser.id === 'lan-mobile-node' || reqUser.isUnauthenticatedLan === true) {
            return false;
        }
        if (reqUser.permissions && reqUser.permissions.canViewCosts !== undefined) {
            return Boolean(reqUser.permissions.canViewCosts);
        }
        const role = String(reqUser.role || '').toLowerCase();
        return ['admin', 'superadmin', 'owner', 'dueño', 'master', 'supervisor', 'inventory'].includes(role);
    }

    /**
     * Remueve campos financieros sensibles (costos y márgenes) para roles sin permiso o nodos LAN no autenticados.
     */
    sanitizeProductForUser(p, allowCosts) {
        if (!allowCosts && p) {
            delete p.cost;
            delete p.bulkCost;
            delete p.midBulkCost;
            delete p.margin;
            if (Array.isArray(p.Presentations)) {
                p.Presentations.forEach(pres => {
                    delete pres.cost;
                    delete pres.marginTarget;
                });
            }
        }
        return p;
    }

    invalidateCatalogCache() {
        cacheService.delPrefix('catalog_full_');
        cacheService.delPrefix('low_stock_');
        cacheService.delPrefix('ai_catalog_');
    }

    /**
     * Get all products with filtering and branch stock mapping.
     */
    async getAllProducts(reqUser, queryParams) {
        const { companyId, activeBranchId } = reqUser;
        const { category, search, minimal, page = 1, limit = 0, supplierId, stockFilter, stockStatus, minPrice, maxPrice, status, es_controlado, expirationFilter, branchScoped, branchId: queryBranchId, missingCost, since, delta } = queryParams;
        const currentStockFilter = stockFilter || stockStatus; 
        const isMinimal = minimal === 'true';
        const isDeltaRequested = Boolean(since) || delta === 'true';
        const serverTime = new Date().toISOString();

        const whereClause = { companyId };

        // Resolver sucursal activa solo cuando se solicita vista por sucursal (evita alterar sync móvil global)
        let scopedBranch = null;
        if (branchScoped === 'true' || queryBranchId) {
            const candidateBranch = String(queryBranchId || activeBranchId || '').trim();
            if (candidateBranch && !['1', 'null', 'undefined', 'global'].includes(candidateBranch.toLowerCase())) {
                const branchCompanyCond = (companyId === '2' || companyId === 'default')
                    ? { [Op.or]: ['2', 'default', null] }
                    : companyId;
                scopedBranch = await Branch.findOne({
                    where: { id: candidateBranch, companyId: branchCompanyCond },
                    attributes: ['id'],
                    raw: true
                }).catch(() => null);
            }
        }

        // Handle Status filtering (keep out-of-stock products active and visible in catalog)
        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = 'active';
        }

        if (category && category !== 'Todas') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.where(
                    sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('Product.category'))),
                    String(category).trim().toLowerCase()
                )
            ];
        }

        if (supplierId) {
            whereClause.supplierId = supplierId;
        }

        if (es_controlado === 'true' || es_controlado === true) {
            whereClause.es_controlado = true;
        }

        if (expirationFilter === 'expiring') {
            const sixtyDaysFromNow = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            whereClause.expirationDate = {
                [Op.and]: [
                    { [Op.ne]: null },
                    { [Op.ne]: '' },
                    { [Op.lte]: sixtyDaysFromNow }
                ]
            };
        } else if (expirationFilter === 'expired') {
            const today = new Date().toISOString().split('T')[0];
            whereClause.expirationDate = {
                [Op.and]: [
                    { [Op.ne]: null },
                    { [Op.ne]: '' },
                    { [Op.lt]: today }
                ]
            };
        }

        const notServiceSql = "LOWER(TRIM(COALESCE(\"Product\".\"category\", ''))) <> 'servicios'";
        const isServiceSql = "LOWER(TRIM(COALESCE(\"Product\".\"category\", ''))) = 'servicios'";
        const stockSqlExpr = scopedBranch
            ? `COALESCE((SELECT bs."quantity" FROM "BranchStocks" bs WHERE bs."productId" = "Product"."id" AND bs."branchId" = ${sequelize.escape(scopedBranch.id)} LIMIT 1), 0)`
            : `COALESCE((SELECT SUM(bs."quantity") FROM "BranchStocks" bs WHERE bs."productId" = "Product"."id"), "Product"."stockQuantity", 0)`;

        if (currentStockFilter === 'low') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.literal(notServiceSql),
                sequelize.literal(`(${stockSqlExpr}) <= COALESCE("Product"."minStock", 0) AND (${stockSqlExpr}) > 0`)
            ];
        } else if (currentStockFilter === 'out') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.literal(notServiceSql),
                sequelize.literal(`(${stockSqlExpr}) <= 0`)
            ];
        } else if (currentStockFilter === 'in') {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                {
                    [Op.or]: [
                        sequelize.literal(isServiceSql),
                        sequelize.literal(`(${stockSqlExpr}) > COALESCE("Product"."minStock", 0)`)
                    ]
                }
            ];
        }

        if (missingCost === 'true' || missingCost === true) {
            whereClause[Op.and] = [
                ...(whereClause[Op.and] || []),
                sequelize.literal(notServiceSql),
                sequelize.literal(`(${stockSqlExpr}) > 0`),
                sequelize.literal('COALESCE("Product"."cost", 0) <= 0')
            ];
        }

        if (minPrice || maxPrice) {
            const priceCond = {};
            if (minPrice) priceCond[Op.gte] = parseFloat(minPrice);
            if (maxPrice) priceCond[Op.lte] = parseFloat(maxPrice);
            whereClause.price = priceCond;
        }

        if (search) {
            const searchTerm = String(search).trim();
            const safePattern = sequelize.escape(`%${searchTerm}%`);
            whereClause[Op.or] = [
                sequelize.literal(`public.immutable_unaccent(lower("Product"."name")) ILIKE public.immutable_unaccent(lower(${safePattern}))`),
                sequelize.literal(`COALESCE("Product"."barcode", '') ILIKE ${safePattern}`),
                sequelize.literal(`COALESCE("Product"."bulkBarcode", '') ILIKE ${safePattern}`),
                sequelize.literal(`COALESCE("Product"."midBulkBarcode", '') ILIKE ${safePattern}`),
                sequelize.literal(`public.immutable_unaccent(lower(COALESCE("Product"."principio_activo", ''))) ILIKE public.immutable_unaccent(lower(${safePattern}))`),
                sequelize.literal(`EXISTS (SELECT 1 FROM "product_presentaciones" pp WHERE pp."productId" = "Product"."id" AND COALESCE(pp."barcode", '') ILIKE ${safePattern})`)
            ];
        }

        // Master Performance Optimization: Lean payload for high-count inventory loading
        const isMasterFullView = queryParams.fullCatalog === 'true';
        
        const options = {
            where: whereClause,
            attributes: isMinimal ? [
                'id', 'name', 'price', 'cost', 'stockQuantity', 'stockUnits', 'imageUri', 'category', 'barcode', 'supplierId', 'isSoldByWeight', 'isFractional',
                'taxStatus', 'stockUnit', 'minStock', 'bulkUnitName', 'unitsPerBulk', 'bulkPrice', 'bulkPriceBs', 'bulkBarcode', 'midBulkUnitName', 'unitsPerMidBulk', 'midBulkCost', 'midBulkPrice', 'midBulkPriceBs', 'midBulkBarcode', 'allowNegative', 'batchNumber', 'expirationDate', 'es_controlado', 'principio_activo'
            ] : [
                'id', 'name', 'price', 'priceBs', 'barcode', 'imageUri',
                'stockQuantity', 'stockUnits', 'stockUnit', 'isSoldByWeight', 'category', 'status',
                'supplierId', 'cost', 'minStock', 'bulkUnitName', 'unitsPerBulk', 'bulkPrice', 'bulkPriceBs', 'bulkBarcode', 'midBulkUnitName', 'unitsPerMidBulk', 'midBulkCost', 'midBulkPrice', 'midBulkPriceBs', 'midBulkBarcode',
                'margin', 'bulkCost', 'taxStatus', 'allowNegative', 'batchNumber', 'expirationDate', 'es_controlado', 'principio_activo'
            ],
            include: [
                { model: BranchStock, as: 'BranchStocks', attributes: ['quantity', 'branchId'] },
                { model: VarianteProducto, as: 'Variantes' },
                { model: ProductPresentation, as: 'Presentations' },
                ...(isMinimal ? [] : [{ model: Supplier, attributes: ['name'] }])
            ],
            order: [['name', 'ASC']],
            distinct: true
        };

        // Master Bypass: If fullCatalog is explicitly requested, we ignore limit/offset limits.
        const hasPaginationLimit = Number(limit) > 0 && !isMasterFullView;
        if (hasPaginationLimit) {
            options.limit = parseInt(limit);
            options.offset = (parseInt(page) - 1) * parseInt(limit);
        }

        const allowCosts = this.canUserViewCosts(reqUser);
        const isSimpleCatalogRequest =
            !hasPaginationLimit &&
            !search &&
            !minPrice &&
            !maxPrice &&
            !supplierId &&
            !currentStockFilter &&
            !expirationFilter &&
            !missingCost &&
            !es_controlado &&
            (!category || category === 'Todas');

        // FAST-PATH DELTA SYNC (?since=<ISO>): Transfiere únicamente los productos modificados/eliminados desde el último sync
        if (since && isSimpleCatalogRequest) {
            const parsedSince = new Date(String(since));
            const sinceMs = parsedSince.getTime();
            const canServeDelta = !Number.isNaN(sinceMs) && sinceMs >= (this._serverBootMs - 5000);

            if (canServeDelta) {
                const deltaAttrs = [...new Set([...options.attributes, 'status', 'updatedAt'])];
                // Incluir tanto productos con updatedAt >= since como productos cuyo BranchStock cambió desde since
                const [directChanged, changedBranchStocks] = await Promise.all([
                    Product.findAll({
                        where: { companyId, updatedAt: { [Op.gte]: parsedSince } },
                        attributes: deltaAttrs,
                        order: [['name', 'ASC']],
                        raw: true
                    }),
                    BranchStock.findAll({
                        where: { companyId, updatedAt: { [Op.gte]: parsedSince } },
                        attributes: ['productId'],
                        raw: true
                    }).catch(() => [])
                ]);

                const directIds = new Set((directChanged || []).map(p => String(p.id)));
                const extraStockProductIds = [...new Set(
                    (changedBranchStocks || [])
                        .map(bs => String(bs.productId))
                        .filter(pid => pid && !directIds.has(pid))
                )];

                let extraProducts = [];
                if (extraStockProductIds.length > 0) {
                    extraProducts = await Product.findAll({
                        where: { companyId, id: { [Op.in]: extraStockProductIds } },
                        attributes: deltaAttrs,
                        raw: true
                    }).catch(() => []);
                }

                const combinedRows = [...(directChanged || []), ...(extraProducts || [])];
                const targetStatus = status || 'active';
                const deletedIdSet = new Set(this.getDeletedProductsSince(companyId, sinceMs));
                const activeDeltaProducts = [];

                for (const row of combinedRows) {
                    if (row.status && row.status !== targetStatus) {
                        deletedIdSet.add(String(row.id));
                    } else {
                        activeDeltaProducts.push(row);
                    }
                }

                if (activeDeltaProducts.length > 0) {
                    const deltaIds = activeDeltaProducts.map(p => p.id).filter(Boolean);
                    const deltaSupIds = !isMinimal
                        ? [...new Set(activeDeltaProducts.map(p => p.supplierId).filter(Boolean))]
                        : [];

                    const [bsRaw, varRaw, presRaw, supRaw] = await Promise.all([
                        BranchStock.findAll({
                            where: { productId: { [Op.in]: deltaIds } },
                            attributes: ['productId', 'quantity', 'branchId'],
                            raw: true
                        }),
                        VarianteProducto.findAll({
                            where: { producto_id: { [Op.in]: deltaIds } },
                            raw: true
                        }).catch(() => []),
                        ProductPresentation.findAll({
                            where: { productId: { [Op.in]: deltaIds } },
                            raw: true
                        }).catch(() => []),
                        deltaSupIds.length > 0
                            ? Supplier.findAll({
                                where: { id: { [Op.in]: deltaSupIds } },
                                attributes: ['id', 'name'],
                                raw: true
                            }).catch(() => [])
                            : Promise.resolve([])
                    ]);

                    const bsMap = new Map();
                    for (const bs of (bsRaw || [])) {
                        const k = String(bs.productId);
                        let arr = bsMap.get(k);
                        if (!arr) { arr = []; bsMap.set(k, arr); }
                        arr.push({ quantity: bs.quantity, branchId: bs.branchId });
                    }
                    const varMap = new Map();
                    for (const v of (varRaw || [])) {
                        const k = String(v.producto_id);
                        let arr = varMap.get(k);
                        if (!arr) { arr = []; varMap.set(k, arr); }
                        arr.push(v);
                    }
                    const presMap = new Map();
                    for (const pr of (presRaw || [])) {
                        const k = String(pr.productId);
                        let arr = presMap.get(k);
                        if (!arr) { arr = []; presMap.set(k, arr); }
                        arr.push(pr);
                    }
                    const supMap = new Map();
                    for (const s of (supRaw || [])) supMap.set(String(s.id), { name: s.name });

                    for (const p of activeDeltaProducts) {
                        const pid = String(p.id);
                        p.BranchStocks = bsMap.get(pid) || [];
                        p.Variantes = varMap.get(pid) || [];
                        p.Presentations = presMap.get(pid) || [];
                        if (!isMinimal) {
                            p.Supplier = p.supplierId ? (supMap.get(String(p.supplierId)) || null) : null;
                        }
                        if (scopedBranch) {
                            const branchRow = p.BranchStocks.find(s => String(s.branchId) === String(scopedBranch.id));
                            p.stockQuantity = Number(branchRow ? branchRow.quantity : 0);
                        } else {
                            const hasBs = p.BranchStocks.length > 0;
                            const totalBs = hasBs ? precision.add(p.BranchStocks.map(s => Number(s.quantity) || 0)) : 0;
                            p.stockQuantity = Number(hasBs ? totalBs : (p.stockQuantity || p.stock || 0));
                        }
                        if (String(p.category || '').trim().toLowerCase() === 'servicios') {
                            p.isService = true;
                            p.isSoldByWeight = false;
                            p.isFractional = false;
                            p.stockUnit = 'un';
                            p.allowNegative = true;
                            p.stockQuantity = 0;
                            p.minStock = 0;
                        }
                        this.sanitizeProductForUser(p, allowCosts);
                    }
                }

                return {
                    delta: true,
                    fullSyncRequired: false,
                    serverTime,
                    products: activeDeltaProducts,
                    deletedIds: Array.from(deletedIdSet),
                    total: activeDeltaProducts.length,
                    page: 1,
                    totalPages: 1
                };
            }
        }

        const isCacheableFullCatalog =
            process.env.ISAAC_TEST_ISOLATED !== '1' &&
            isSimpleCatalogRequest;
        const catalogCacheKey = isCacheableFullCatalog
            ? `catalog_full_${companyId}_${status || 'active'}_${scopedBranch ? scopedBranch.id : 'global'}_${isMinimal ? 'min' : 'full'}`
            : null;

        if (catalogCacheKey) {
            const cachedRaw = cacheService.get(catalogCacheKey);
            if (Array.isArray(cachedRaw)) {
                const cloned = cachedRaw.map(p => {
                    const copy = { ...p };
                    if (Array.isArray(p.Presentations)) {
                        copy.Presentations = p.Presentations.map(pr => ({ ...pr }));
                    }
                    this.sanitizeProductForUser(copy, allowCosts);
                    return copy;
                });
                return isDeltaRequested
                    ? { delta: false, fullSyncRequired: true, serverTime, products: cloned, deletedIds: [], total: cloned.length, page: 1, totalPages: 1 }
                    : { products: cloned, total: cloned.length, page: 1, totalPages: 1 };
            }
        }

        let count = 0;
        let products = [];

        // Fast-Path Sin Producto Cartesiano ORM:
        // En vez de 1 query gigante con 4 LEFT OUTER JOIN + instanciación pesada de Sequelize Models,
        // ejecutamos consultas planas (raw: true) en paralelo y ensamblamos las relaciones en O(N).
        const baseFindOptions = {
            where: whereClause,
            attributes: options.attributes,
            order: options.order,
            raw: true
        };
        if (hasPaginationLimit) {
            baseFindOptions.limit = options.limit;
            baseFindOptions.offset = options.offset;
        }

        if (hasPaginationLimit) {
            const [rowsRaw, totalCount] = await Promise.all([
                Product.findAll(baseFindOptions),
                Product.count({ where: whereClause })
            ]);
            products = Array.isArray(rowsRaw) ? rowsRaw : [];
            count = Number(totalCount) || 0;
        } else {
            const rowsRaw = await Product.findAll(baseFindOptions);
            products = Array.isArray(rowsRaw) ? rowsRaw : [];
            count = products.length;
        }

        if (products.length > 0) {
            const productIds = products.map(p => p.id).filter(Boolean);
            const supplierIds = !isMinimal
                ? [...new Set(products.map(p => p.supplierId).filter(Boolean))]
                : [];

            const [branchStocksRaw, variantsRaw, presentationsRaw, suppliersRaw] = await Promise.all([
                BranchStock.findAll({
                    where: { productId: { [Op.in]: productIds } },
                    attributes: ['productId', 'quantity', 'branchId'],
                    raw: true
                }),
                VarianteProducto.findAll({
                    where: { producto_id: { [Op.in]: productIds } },
                    raw: true
                }).catch(() => []),
                ProductPresentation.findAll({
                    where: { productId: { [Op.in]: productIds } },
                    raw: true
                }).catch(() => []),
                supplierIds.length > 0
                    ? Supplier.findAll({
                        where: { id: { [Op.in]: supplierIds } },
                        attributes: ['id', 'name'],
                        raw: true
                    }).catch(() => [])
                    : Promise.resolve([])
            ]);

            const bsMap = new Map();
            for (const bs of (branchStocksRaw || [])) {
                const key = String(bs.productId);
                let arr = bsMap.get(key);
                if (!arr) { arr = []; bsMap.set(key, arr); }
                arr.push({ quantity: bs.quantity, branchId: bs.branchId });
            }

            const varMap = new Map();
            for (const v of (variantsRaw || [])) {
                const key = String(v.producto_id);
                let arr = varMap.get(key);
                if (!arr) { arr = []; varMap.set(key, arr); }
                arr.push(v);
            }

            const presMap = new Map();
            for (const pr of (presentationsRaw || [])) {
                const key = String(pr.productId);
                let arr = presMap.get(key);
                if (!arr) { arr = []; presMap.set(key, arr); }
                arr.push(pr);
            }

            const supMap = new Map();
            for (const s of (suppliersRaw || [])) {
                supMap.set(String(s.id), { name: s.name });
            }

            for (const p of products) {
                const pid = String(p.id);
                p.BranchStocks = bsMap.get(pid) || [];
                p.Variantes = varMap.get(pid) || [];
                p.Presentations = presMap.get(pid) || [];
                if (!isMinimal) {
                    p.Supplier = p.supplierId ? (supMap.get(String(p.supplierId)) || null) : null;
                }
            }
        }

        // Precise Stock Aggregation (por sucursal activa si branchScoped, o consolidado global)
        products.forEach(p => {
            if (scopedBranch) {
                const branchRow = Array.isArray(p.BranchStocks)
                    ? p.BranchStocks.find(s => String(s.branchId) === String(scopedBranch.id))
                    : null;
                p.stockQuantity = Number(branchRow ? branchRow.quantity : 0);
            } else {
                let totalPhysicalStock = 0;

                // Sum all branch records
                if (p.BranchStocks && p.BranchStocks.length > 0) {
                    totalPhysicalStock = precision.add(p.BranchStocks.map(s => Number(s.quantity) || 0));
                }

                const hasBranchStocks = p.BranchStocks && p.BranchStocks.length > 0;

                // CRITICAL: Ensure stockQuantity is ALWAYS a number and correctly named for the mobile client
                p.stockQuantity = Number(hasBranchStocks ? totalPhysicalStock : (p.stockQuantity || p.stock || 0));
            }
            if (String(p.category || '').trim().toLowerCase() === 'servicios') {
                p.isService = true;
                p.isSoldByWeight = false;
                p.isFractional = false;
                p.stockUnit = 'un';
                p.allowNegative = true;
                p.stockQuantity = 0;
                p.minStock = 0;
            }
        });

        if (catalogCacheKey) {
            const snapshotToCache = products.map(p => ({
                ...p,
                Presentations: Array.isArray(p.Presentations) ? p.Presentations.map(pr => ({ ...pr })) : p.Presentations
            }));
            cacheService.set(catalogCacheKey, snapshotToCache, 30);
        }

        products.forEach(p => {
            this.sanitizeProductForUser(p, allowCosts);
        });

        // Debug Log (only enabled when DEBUG_VERBOSE=true)
        if (process.env.DEBUG_VERBOSE === 'true' && products.length > 0) {
            console.log(`[SYNC DEBUG] Sample Product: ${products[0].name} | Stock: ${products[0].stockQuantity}`);
        }

        if (isDeltaRequested) {
            return {
                delta: false,
                fullSyncRequired: true,
                serverTime,
                products,
                deletedIds: [],
                total: count,
                page: parseInt(page),
                totalPages: limit > 0 ? Math.ceil(count / limit) : 1
            };
        }

        return { products, total: count, page: parseInt(page), totalPages: limit > 0 ? Math.ceil(count / limit) : 1 };
    }

    /**
     * Create a product and log the audit.
     */
    async createProduct(reqUser, productData) {
        const { id: userId, companyId } = reqUser;
        const productId = generateRobustId();
        const presentationsToSync = Array.isArray(productData?.presentations) ? [...productData.presentations] : null;
        if (productData) delete productData.presentations;
        
        const t = await sequelize.transaction();
        try {
            // Find or create default branch if none exists for the company to prevent foreign key errors
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

            if (productData) {
                if (typeof productData.barcode === 'string') productData.barcode = productData.barcode.trim() || null;
                if (typeof productData.bulkBarcode === 'string') productData.bulkBarcode = productData.bulkBarcode.trim() || null;
                if (typeof productData.midBulkBarcode === 'string') productData.midBulkBarcode = productData.midBulkBarcode.trim() || null;
                if (productData.bulkBarcode && productData.bulkBarcode === productData.barcode) productData.bulkBarcode = null;
                if (productData.midBulkBarcode && (productData.midBulkBarcode === productData.barcode || productData.midBulkBarcode === productData.bulkBarcode)) {
                    productData.midBulkBarcode = null;
                }
            }

            const newProduct = await Product.create({
                ...productData,
                id: productId,
                userId,
                companyId
            }, { transaction: t });

            const initialStock = Number(productData.stockQuantity) || 0;
            if (initialStock > 0) {
                await BranchStock.create({
                    productId,
                    branchId: activeBranchId,
                    quantity: initialStock,
                    companyId
                }, { transaction: t });

                await StockMovement.create({
                    id: generateRobustId(),
                    productId,
                    userId,
                    companyId,
                    type: 'IN',
                    quantity: initialStock,
                    stockBefore: 0,
                    stockAfter: initialStock,
                    reason: 'Carga Inicial (Creación)',
                    referenceId: productId,
                    date: new Date().toISOString()
                }, { transaction: t });
            }

            if (presentationsToSync && presentationsToSync.length > 0) {
                const usedPresBarcodes = new Set();
                if (newProduct.barcode) usedPresBarcodes.add(String(newProduct.barcode).trim());
                for (let idx = 0; idx < presentationsToSync.length; idx++) {
                    const pres = presentationsToSync[idx];
                    const factor = parseFloat(pres.factorConversion);
                    if (!factor || factor <= 0 || !pres.name) continue;
                    let cleanBarcode = typeof pres.barcode === 'string' && pres.barcode.trim() ? pres.barcode.trim() : null;
                    if (cleanBarcode) {
                        if (usedPresBarcodes.has(cleanBarcode)) {
                            cleanBarcode = null;
                        } else {
                            usedPresBarcodes.add(cleanBarcode);
                            await ProductPresentation.update(
                                { barcode: null },
                                { where: { barcode: cleanBarcode }, transaction: t }
                            );
                        }
                    }
                    await ProductPresentation.create({
                        id: pres.id || generateRobustId(),
                        productId,
                        name: pres.name.trim(),
                        factorConversion: factor,
                        price: Number(pres.price) || 0,
                        cost: Number(pres.cost) || 0,
                        barcode: cleanBarcode,
                        isDefaultPurchase: Boolean(pres.isDefaultPurchase),
                        isDefaultSale: Boolean(pres.isDefaultSale),
                        orderIndex: pres.orderIndex !== undefined ? pres.orderIndex : idx,
                        companyId
                    }, { transaction: t });
                }
            }

            await t.commit();
            this.invalidateCatalogCache();
            const plainProduct = newProduct.get({ plain: true });
            await this._logAudit(reqUser, 'CREATE_PRODUCT', `Creado producto: ${plainProduct.name}`, productId, null, plainProduct);
            return plainProduct;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Update product with branch stock logic and audit.
     */
    async updateProduct(reqUser, productId, updateData) {
        const { companyId, id: userId } = reqUser;
        
        // Iniciamos transacción ACID
        const t = await sequelize.transaction();

        let presentationsToSync = null;
        if (updateData && updateData.presentations !== undefined) {
            presentationsToSync = Array.isArray(updateData.presentations) ? [...updateData.presentations] : [];
            delete updateData.presentations;
        }

        // Prevención de Mass Assignment: eliminar campos protegidos
        delete updateData.id;
        delete updateData.companyId;
        delete updateData.userId;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        try {
            // Find or create default branch if none exists for the company
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

            const oldProduct = await Product.findOne({ 
                where: { id: productId, companyId },
                lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                transaction: t
            });
            
            if (!oldProduct) throw new Error('Producto no encontrado');

            oldProduct.BranchStocks = await BranchStock.findAll({
                where: { productId, companyId },
                transaction: t
            });

            // Handle Stock Adjustments
            if (updateData.stockQuantity !== undefined) {
                const totalBranchStock = oldProduct.BranchStocks && oldProduct.BranchStocks.length > 0
                    ? precision.add(oldProduct.BranchStocks.map(s => Number(s.quantity) || 0))
                    : 0;

                const currentStock = activeBranchId 
                    ? (oldProduct.BranchStocks?.find(s => s.branchId === activeBranchId)?.quantity || 0)
                    : (totalBranchStock > 0 ? totalBranchStock : (oldProduct.stockQuantity || 0));
                
                const diff = precision.subtract(updateData.stockQuantity, currentStock);

                if (diff !== 0) {
                    const stockBefore = Number(currentStock) || 0;
                    const stockAfter = Number(updateData.stockQuantity);

                    if (activeBranchId) {
                        const branchStockRecord = oldProduct.BranchStocks?.find(s => s.branchId === activeBranchId);
                        if (branchStockRecord) {
                            await BranchStock.update(
                                { quantity: stockAfter }, 
                                { where: { id: branchStockRecord.id }, transaction: t }
                            );
                        } else {
                            await BranchStock.create(
                                { branchId: activeBranchId, productId, quantity: stockAfter, companyId },
                                { transaction: t }
                            );
                        }
                    } else if (oldProduct.BranchStocks && oldProduct.BranchStocks.length > 0) {
                        // Global adjustment: keep the branch stocks in sync with the new total stock
                        const firstRecord = oldProduct.BranchStocks[0];
                        await BranchStock.update(
                            { quantity: stockAfter },
                            { where: { id: firstRecord.id }, transaction: t }
                        );
                        if (oldProduct.BranchStocks.length > 1) {
                            const otherIds = oldProduct.BranchStocks.slice(1).map(s => s.id);
                            await BranchStock.update(
                                { quantity: 0 },
                                { where: { id: { [Op.in]: otherIds } }, transaction: t }
                            );
                        }
                    }

                    await StockMovement.create({
                        id: generateRobustId(),
                        productId,
                        userId,
                        companyId,
                        type: 'ADJUSTMENT',
                        quantity: Math.abs(diff),
                        stockBefore,
                        stockAfter,
                        reason: activeBranchId ? `Ajuste Manual (Sucursal ${activeBranchId})` : 'Ajuste Manual',
                        referenceId: productId,
                        date: new Date().toISOString()
                    }, { transaction: t });
                }

                // Keep product active in catalog even when stock reaches 0
                const finalStock = Number(updateData.stockQuantity);
                if (finalStock <= 0 && !oldProduct.allowNegative) {
                    if (oldProduct.stockUnits !== null && oldProduct.stockUnits !== undefined && updateData.stockUnits === undefined) {
                        updateData.stockUnits = 0;
                    }
                }
                if (!updateData.status || updateData.status === 'inactive') {
                    updateData.status = 'active';
                }
            }

            // Logic for Audit diff
            const changes = this._getDiff(oldProduct, updateData);
            if (changes.length > 0) {
                // Not passing transaction to audit log to avoid failing the whole process just for a log, 
                // but wait, it's better to pass it so it rolls back if the main fails.
                await AuditLog.create({
                    id: generateRobustId(),
                    userId: reqUser.id,
                    companyId: reqUser.companyId,
                    action: 'PRODUCT_UPDATE',
                    description: `Actualizado ${oldProduct.name}: ${changes.join(', ')}`,
                    entityId: productId,
                    oldValue: JSON.stringify(oldProduct),
                    newValue: JSON.stringify(updateData),
                    timestamp: new Date().toISOString()
                }, { transaction: t }).catch(e => console.warn('AuditLog failed:', e.message));
            }

            if (updateData) {
                if (typeof updateData.barcode === 'string') updateData.barcode = updateData.barcode.trim() || null;
                if (typeof updateData.bulkBarcode === 'string') updateData.bulkBarcode = updateData.bulkBarcode.trim() || null;
                if (typeof updateData.midBulkBarcode === 'string') updateData.midBulkBarcode = updateData.midBulkBarcode.trim() || null;
                const effectiveBarcode = updateData.barcode !== undefined ? updateData.barcode : oldProduct.barcode;
                const effectiveBulkBarcode = updateData.bulkBarcode !== undefined ? updateData.bulkBarcode : oldProduct.bulkBarcode;
                if (effectiveBulkBarcode && effectiveBulkBarcode === effectiveBarcode) {
                    updateData.bulkBarcode = null;
                }
                if (updateData.midBulkBarcode && (updateData.midBulkBarcode === effectiveBarcode || updateData.midBulkBarcode === (updateData.bulkBarcode !== undefined ? updateData.bulkBarcode : oldProduct.bulkBarcode))) {
                    updateData.midBulkBarcode = null;
                }
            }

            const updatedProduct = await oldProduct.update(updateData, { transaction: t });

            if (presentationsToSync !== null) {
                await ProductPresentation.destroy({ where: { productId }, transaction: t });
                const usedPresBarcodes = new Set();
                if (updatedProduct.barcode) usedPresBarcodes.add(String(updatedProduct.barcode).trim());
                for (let idx = 0; idx < presentationsToSync.length; idx++) {
                    const pres = presentationsToSync[idx];
                    const factor = parseFloat(pres.factorConversion);
                    if (!factor || factor <= 0 || !pres.name) continue;
                    let cleanBarcode = typeof pres.barcode === 'string' && pres.barcode.trim() ? pres.barcode.trim() : null;
                    if (cleanBarcode) {
                        if (usedPresBarcodes.has(cleanBarcode)) {
                            cleanBarcode = null;
                        } else {
                            usedPresBarcodes.add(cleanBarcode);
                            await ProductPresentation.update(
                                { barcode: null },
                                { where: { barcode: cleanBarcode }, transaction: t }
                            );
                        }
                    }
                    await ProductPresentation.create({
                        id: pres.id || generateRobustId(),
                        productId,
                        name: pres.name.trim(),
                        factorConversion: factor,
                        price: Number(pres.price) || 0,
                        cost: Number(pres.cost) || 0,
                        barcode: cleanBarcode,
                        isDefaultPurchase: Boolean(pres.isDefaultPurchase),
                        isDefaultSale: Boolean(pres.isDefaultSale),
                        orderIndex: pres.orderIndex !== undefined ? pres.orderIndex : idx,
                        companyId
                    }, { transaction: t });
                }
            }
            
            await t.commit();
            this.invalidateCatalogCache();
            return updatedProduct.get({ plain: true });

        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Alias for bulk price adjustment (called by POST /products/bulk-edit)
     */
    async bulkEdit(reqUser, params) {
        return await this.bulkPriceAdjustment(reqUser, params);
    }

    /**
     * Bulk price adjustment.
     */
    async bulkPriceAdjustment(reqUser, params) {
        const { target, category, supplierId, productIds, adjustmentType, direction, value } = params;
        const whereClause = { companyId: reqUser.companyId };
        const numericValue = precision.parseNumericInput(value);

        if (target === 'selected' && productIds?.length > 0) {
            whereClause.id = { [Op.in]: productIds };
        } else if (target === 'category' && category) {
            whereClause.category = category;
        } else if (target === 'supplier' && supplierId) {
            whereClause.supplierId = supplierId;
        }

        const allSettings = await readJsonAsync(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, reqUser.companyId);
        const posRate = precision.parseNumericInput(userSettings?.exchangeRate || userSettings?.bcvRate || 0);

        let updatedCount = 0;
        await sequelize.transaction(async (t) => {
            const products = await Product.findAll({
                where: whereClause,
                order: [['id', 'ASC']],
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            for (const p of products) {
                const currentPrice = precision.parseNumericInput(p.price || 0);
                const currentCost = precision.parseNumericInput(p.cost || 0);
                let newPrice = currentPrice;
                let nextMargin = precision.parseNumericInput(p.margin || 0);

                if (adjustmentType === 'percentage') {
                    const percentVal = precision.divide(numericValue, 100);
                    if (direction === 'increase') {
                        const multiplier = precision.add([1, percentVal]);
                        newPrice = precision.multiply(currentPrice, multiplier);
                    } else {
                        const multiplier = precision.subtract(1, percentVal);
                        newPrice = precision.multiply(currentPrice, multiplier);
                    }
                    if (currentCost > 0) {
                        nextMargin = precision.round(precision.multiply(precision.divide(precision.subtract(newPrice, currentCost), currentCost), 100), 4);
                    }
                } else if (adjustmentType === 'margin') {
                    // Estandarizado a Markup sobre Costo: Precio = Costo * (1 + margen% / 100)
                    if (currentCost <= 0) {
                        continue;
                    }
                    const safeMargin = Math.max(0, numericValue);
                    const multiplier = precision.add([1, precision.divide(safeMargin, 100)]);
                    newPrice = precision.multiply(currentCost, multiplier);
                    nextMargin = precision.round(safeMargin, 4);
                } else {
                    newPrice = direction === 'increase'
                        ? precision.add([currentPrice, numericValue])
                        : precision.subtract(currentPrice, numericValue);
                    if (currentCost > 0) {
                        nextMargin = precision.round(precision.multiply(precision.divide(precision.subtract(newPrice, currentCost), currentCost), 100), 4);
                    }
                }

                newPrice = Math.max(0, newPrice < 0.10 ? precision.round(newPrice, 4) : precision.round(newPrice, 2));
                const patch = { price: newPrice, margin: nextMargin };
                if (posRate > 0) {
                    patch.priceBs = precision.round(precision.multiply(newPrice, posRate), 2);
                }
                await p.update(patch, { transaction: t });
                updatedCount += 1;
            }
        });

        this.invalidateCatalogCache();
        await this._logAudit(reqUser, 'PRODUCT_BULK_PRICE_ADJUST', `Ajuste masivo (${adjustmentType}): ${direction || 'set'} de ${numericValue}${adjustmentType === 'fixed' ? '$' : '%'} para ${updatedCount} productos.`, 'BULK', null, null);

        return updatedCount;
    }

    /**
     * Get low stock with caching.
     */
    async getLowStockAlerts(companyId) {
        const cacheKey = `low_stock_${companyId}`;
        const cached = cacheService.get(cacheKey);
        if (cached) return cached;

        const products = await Product.findAll({
            where: {
                companyId,
                stockQuantity: { [Op.lte]: sequelize.col('minStock') },
                minStock: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'stockQuantity', 'minStock'],
            raw: true
        });

        cacheService.set(cacheKey, products, 180);
        return products;
    }

    // Helper: Log Audit (protegido con SAVEPOINT para no abortar transacciones activas en PostgreSQL si el actor es Employee)
    async _logAudit(reqUser, action, description, entityId, oldVal, newVal, transaction = null) {
        const basePayload = {
            id: generateRobustId(),
            userId: reqUser?.id || null,
            companyId: reqUser?.companyId || null,
            action,
            description,
            entityId,
            oldValue: oldVal ? JSON.stringify(oldVal) : null,
            newValue: newVal ? JSON.stringify(newVal) : null,
            timestamp: new Date().toISOString()
        };

        try {
            if (transaction) {
                await sequelize.transaction({ transaction }, async (sp) => {
                    await AuditLog.create(basePayload, { transaction: sp });
                });
            } else {
                await AuditLog.create(basePayload);
            }
        } catch (e) {
            try {
                const fallbackPayload = { ...basePayload, id: generateRobustId(), userId: null };
                if (transaction) {
                    await sequelize.transaction({ transaction }, async (sp2) => {
                        await AuditLog.create(fallbackPayload, { transaction: sp2 });
                    });
                } else {
                    await AuditLog.create(fallbackPayload);
                }
            } catch (fallbackErr) {
                console.warn('AuditLog failed:', fallbackErr.message);
            }
        }
    }

    // Helper: Get field differences
    _getDiff(oldObj, newObj) {
        const fields = [
            'name', 'price', 'cost', 'category', 'barcode', 'stockQuantity', 'stockUnits', 'minStock', 
            'supplierId', 'taxStatus', 'bulkUnitName', 'unitsPerBulk', 'margin', 'bulkCost'
        ];
        const changes = [];
        fields.forEach(f => {
            if (newObj[f] !== undefined && String(newObj[f]) !== String(oldObj[f] || '')) {
                changes.push(`${f}: ${oldObj[f] || 'N/A'} -> ${newObj[f]}`);
            }
        });
        return changes;
    }

    /**
     * Delete a product and its associated stock.
     */
    async deleteProduct(companyId, productId) {
        const product = await Product.findOne({ where: { id: productId, companyId } });
        if (!product) throw new Error('Producto no encontrado');

        const t = await sequelize.transaction();
        try {
            // 1. Intentar borrar registros de inventario y mapeos vinculados
            await BranchStock.destroy({ where: { productId }, transaction: t });
            await StockMovement.destroy({ where: { productId }, transaction: t });
            await SupplierProductMapping.destroy({ where: { localProductId: productId }, transaction: t });
            
            // 2. Intentar borrar el producto principal
            await product.destroy({ transaction: t });
            
            await t.commit();
            this.recordDeletedProduct(companyId, productId);
            this.invalidateCatalogCache();
            return true;
        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * Normaliza nombres de productos y extrae tokens y medidas (kg, g, l, ml, oz) para vinculación de alta precisión.
     */
    _tokenizeForCatalogMatch(rawName) {
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

    /**
     * Process an imported catalog or invoice of products from a vendor.
     * Matches external names with existing mappings or suggests high-precision matches in O(N) memory.
     */
    async processCatalogImport(reqUser, extractedItems, supplierId = null) {
        const { companyId } = reqUser;
        const results = [];

        // 1. Extraer lista real de ítems y metadatos fiscales/contables
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

        // Obtener tasa activa de venta del POS desde settings
        let posExchangeRate = 1;
        try {
            const allSettings = await readJsonAsync(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            posExchangeRate = parseFloat(userSettings.exchangeRate || 1) || 1;
        } catch (e) {
            posExchangeRate = 1;
        }

        // Si la moneda es Bolívares y no vino tasa impresa, obtenerla del BCV histórico/actual o ajustes
        if (docCurrency === 'BS' && (!rate || rate <= 0)) {
            try {
                const BCVRateService = require('./BCVRateService');
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

        // 2. Auto-detectar Proveedor por RIF o Razón Social si no fue preseleccionado
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

        // 3. Cargar mapeos previos de la empresa y catálogo activo en 2 consultas únicas (cero N+1)
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

        // Pre-indexar catálogo de la empresa para matching instantáneo y exacto
        const barcodeIndex = new Map();
        const exactNormIndex = new Map();
        const indexedCatalog = companyProducts.map(prod => {
            const parsed = this._tokenizeForCatalogMatch(prod.name);
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

            // Precisión de 6 decimales en costos base USD y 2 decimales en Bolívares
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

            // Nivel 1: Mapeo histórico aprendido del proveedor o de la empresa
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

            // Nivel 2: Código de barras exacto o nombre normalizado idéntico
            const itemTokens = this._tokenizeForCatalogMatch(nameToMatch);
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

            // Nivel 3: Similitud inteligente por tokens y verificación estricta de medida/gramaje
            let bestCandidate = null;
            let bestScore = 0;

            if (itemTokens.tokens.length > 0) {
                for (const entry of indexedCatalog) {
                    if (entry.tokens.length === 0) continue;

                    // Si ambos especifican gramaje/volumen (ej. 2L vs 1.5L) y ninguno coincide, descartar para evitar falsos cruces
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

                    // Requerir al menos 2 tokens coincidentes si el nombre tiene varias palabras y el único match es genérico
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

        // Estructura híbrida compatible con consumidores legacy y modernos
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

    /**
     * Search products for manual linking (compatible with PostgreSQL and SQLite)
     */
    async searchProductsForLink(reqUser, search) {
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

        return products.map(p => {
            const plain = p.get({ plain: true });
            const cleanCost = Number(plain.cost || 0);
            return {
                ...plain,
                cost: cleanCost,
                currentCost: cleanCost,
                price: Number(plain.price || 0),
                unitsPerBulk: Number(plain.unitsPerBulk || 1),
                margin: Number(plain.margin || 0),
                stockQuantity: Number(plain.stockQuantity || 0)
            };
        });
    }

    /**
     * Registra o actualiza de forma idempotente el vínculo Nombre Proveedor -> Producto Local
     * sin disparar choques ON CONFLICT en PostgreSQL ni duplicar filas con supplierId NULL.
     */
    async _saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, transaction) {
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

    /**
     * Apply the approved mappings, update product costs/IVA/stock, and optionally close PurchaseOrder + Accounts Payable atomically.
     */
    async applySupplierMapping(reqUser, mappings, invoiceOptions = {}) {
        const { companyId, id: userId } = reqUser;
        let updateCount = 0;
        const resolvedOrderItems = [];

        const t = await sequelize.transaction();
        try {
            // 1. Resolver sucursal activa para Kardex y BranchStock
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

            // 2. Obtener tasa de cambio activa del POS para el PVP en Bs
            const allSettings = await readJsonAsync(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const posRate = parseFloat(userSettings.exchangeRate || 1) || 1;

            let headerSupplierId = (invoiceOptions?.supplierId && invoiceOptions.supplierId !== 'null' && invoiceOptions.supplierId !== '')
                ? String(invoiceOptions.supplierId)
                : null;

            // Auto-crear proveedor si fue detectado por OCR y aprobado por el usuario
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

                    // Precisión exacta de 6 decimales con VortexMathEngine
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

                    // RAMA A: Producto Nuevo (creación limpia sin doble suma de stock)
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

                        await this._saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, t);

                        await this._logAudit(
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

                    // RAMA B: Producto Existente
                    if (!finalLocalProductId) continue;

                    await this._saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, t);

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

                        await this._logAudit(
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

            // 3. Cierre Contable Atómico: Orden de Compra Recibida + Cuentas por Pagar (si aplica)
            let createdPurchaseOrderId = null;
            let creditCharged = false;
            let newSupplierBalance = null;

            if (isInvoiceMode && invoiceOptions?.createPurchaseOrder && resolvedOrderItems.length > 0) {
                const { PurchaseOrder, SupplierCreditHistory } = require('../database/models');
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

                // Si la factura es a Crédito ("unpaid"), cargar automáticamente la Cuenta por Pagar al Proveedor
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
                    // Si la factura fue pagada de Contado, registrar en el historial de compras solventes del proveedor
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

            // Invalidar cachés de catálogo y categorías tras confirmar transacción
            cacheService.delPrefix('categories_');
            this.invalidateCatalogCache();

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

    async generateImageIA(productId) {
        return productMediaService.generateImageIA(productId);
    }

    async searchImagesIA(productId, fallbackName = '', fallbackCategory = '') {
        return productMediaService.searchImagesIA(productId, fallbackName, fallbackCategory);
    }

    async downloadAndSetImage(productId, imageUrl, fallbackName = '', fallbackCategory = '', reqUser = null) {
        return productMediaService.downloadAndSetImage(productId, imageUrl, fallbackName, fallbackCategory, reqUser);
    }

    async updateBarcodeIA(productId, reqUser = null) {
        return productMediaService.updateBarcodeIA(productId, reqUser);
    }

    async recordWaste(reqUser, productId, body) {
        return productWasteAndAudit.recordWaste(reqUser, productId, body);
    }

    async getWasteHistory(reqUser, queryParams = {}) {
        return productWasteAndAudit.getWasteHistory(reqUser, queryParams);
    }

    async exportWasteExcel(reqUser, queryParams = {}) {
        return productWasteAndAudit.exportWasteExcel(reqUser, queryParams);
    }

    async quickStockAdjust(reqUser, productId, body) {
        return productWasteAndAudit.quickStockAdjust(reqUser, productId, body);
    }

    async bulkAuditAdjust(reqUser, body = {}) {
        return productWasteAndAudit.bulkAuditAdjust(reqUser, body);
    }

}

module.exports = new ProductService();
