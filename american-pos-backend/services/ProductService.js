const { Product, BranchStock, Supplier, AuditLog, StockMovement, SupplierProductMapping, Branch, VarianteProducto, ProductPresentation, WarehouseStock } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, readJson, readJsonAsync, getUserSettings } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/precision');
const cacheService = require('../utils/cacheService');
const { SETTINGS_FILE } = require('../config/paths');
const productMediaService = require('./product/productMediaService');
const productWasteAndAudit = require('./product/productWasteAndAudit');
const ProductStockService = require('./products/ProductStockService');
const ProductImportService = require('./products/ProductImportService');


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
            const activeBranchId = await ProductStockService.resolveActiveBranch(reqUser, t);

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
                await ProductStockService.syncPresentations(
                    productId,
                    companyId,
                    newProduct.barcode,
                    presentationsToSync,
                    t,
                    { replaceExisting: false }
                );
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
            const activeBranchId = await ProductStockService.resolveActiveBranch(reqUser, t);

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

            await ProductStockService.applyBranchStockAdjustment({
                oldProduct,
                updateData,
                activeBranchId,
                productId,
                userId,
                companyId,
                transaction: t
            });

            // Logic for Audit diff
            const changes = this._getDiff(oldProduct, updateData);
            if (changes.length > 0) {
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
                await ProductStockService.syncPresentations(
                    productId,
                    companyId,
                    updatedProduct.barcode,
                    presentationsToSync,
                    t,
                    { replaceExisting: true }
                );
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
        return ProductStockService.bulkPriceAdjustment(this, reqUser, params);
    }

    /**
     * Get low stock with caching.
     */
    async getLowStockAlerts(companyId) {
        return ProductStockService.getLowStockAlerts(companyId);
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
        return ProductImportService.tokenizeForCatalogMatch(rawName);
    }

    /**
     * Process an imported catalog or invoice of products from a vendor.
     * Matches external names with existing mappings or suggests high-precision matches in O(N) memory.
     */
    async processCatalogImport(reqUser, extractedItems, supplierId = null) {
        return ProductImportService.processCatalogImport(this, reqUser, extractedItems, supplierId);
    }

    /**
     * Search products for manual linking (compatible with PostgreSQL and SQLite)
     */
    async searchProductsForLink(reqUser, search) {
        return ProductImportService.searchProductsForLink(reqUser, search);
    }

    /**
     * Registra o actualiza de forma idempotente el vínculo Nombre Proveedor -> Producto Local
     * sin disparar choques ON CONFLICT en PostgreSQL ni duplicar filas con supplierId NULL.
     */
    async _saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, transaction) {
        return ProductImportService.saveSupplierMappingSafe(cleanExternalName, finalLocalProductId, finalSupplierId, transaction);
    }

    /**
     * Apply the approved mappings, update product costs/IVA/stock, and optionally close PurchaseOrder + Accounts Payable atomically.
     */
    async applySupplierMapping(reqUser, mappings, invoiceOptions = {}) {
        return ProductImportService.applySupplierMapping(this, reqUser, mappings, invoiceOptions);
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
