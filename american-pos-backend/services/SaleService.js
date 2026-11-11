const { Sale, SaleItem, Product, ProductLot, BranchStock, StockMovement, AuditLog, Customer, CreditHistory, SupervisorApproval, VarianteProducto, CashShift, CashMovement, StockAlert, ProductPresentation } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, getUserSettings, readJson, readJsonAsync } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const { Op, Transaction } = require('sequelize');
const precision = require('../utils/precision');
const cache = require('../utils/cacheService');
const LANClusterService = require('./LANClusterService');

const inFlightTransactions = new Set();

class SaleService {
    async getSaleDetails(companyId, saleId, role, requestingUserId = null) {
        const where = { id: String(saleId), companyId: String(companyId) };
        if (requestingUserId) {
            where.userId = String(requestingUserId);
        }
        const sale = await Sale.findOne({
            where,
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });
        if (sale && sale.taxInfo?.dailyTicketNumber && typeof sale.setDataValue === 'function') {
            sale.setDataValue('dailyTicketNumber', sale.taxInfo.dailyTicketNumber);
        }
        return sale;
    }

    /**
     * Process a complete sale transaction with financial-grade integrity.
     */
    async processSale(reqUser, saleData, options = {}) {
        const companyId = String(reqUser.companyId);
        const userId = String(reqUser.id);
        const userBranchId = String(reqUser.activeBranchId || '1');

        // 1. VERIFICAR CLIENT_TRANSACTION_ID & IDEMPOTENCY LOCK
        const clientTransactionId = saleData.clientTransactionId || saleData.id || generateRobustId();
        saleData.clientTransactionId = clientTransactionId;
        saleData.id = clientTransactionId;

        // 1A. Verificación Persistente en DB (A prueba de caídas o reinicios del servidor Node.js)
        const existingSale = await Sale.findByPk(clientTransactionId, { include: [{ model: SaleItem, as: 'SaleItems' }] });
        if (existingSale) {
            console.warn(`[Idempotency] Venta ya persistida en DB interceptada exitosamente: ${clientTransactionId}`);
            return existingSale;
        }

        // 1B. Verificación en Memoria Volátil (Rebote rápido de UI en milisegundos)
        if (inFlightTransactions.has(clientTransactionId)) {
            console.warn(`[Idempotency] Rebote de UI o doble clic interceptado en memoria para TX: ${clientTransactionId}`);
            // Esperar brevemente (hasta 2s) a que la transacción concurrente termine de persistir
            for (let i = 0; i < 20; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const completed = await Sale.findByPk(clientTransactionId, { include: [{ model: SaleItem, as: 'SaleItems' }] });
                if (completed) {
                    console.log(`[Idempotency] Transacción concurrente ${clientTransactionId} resuelta y recuperada con éxito.`);
                    return completed;
                }
            }
            throw new Error(`TRANSACCION_DUPLICADA: La venta ${clientTransactionId} ya está en curso.`);
        }
        inFlightTransactions.add(clientTransactionId);
        setTimeout(() => inFlightTransactions.delete(clientTransactionId), 10000);

        // 1C. VERIFICACIÓN DE CAJA ABIERTA (Resiliente y Multi-Caja)
        let openShift = null;
        if (!options.bypassShiftCheck) {
            const currentRegisterId = String(saleData.registerId || '1');
            
            // 1. Buscar turno abierto por el usuario actual en esta caja física
            openShift = await CashShift.findOne({
                where: { userId: String(userId), registerId: currentRegisterId, status: 'open' }
            });

            // 2. Buscar turno abierto por la caja física en uso (ej: Caja 2 / Charcutería / DEV-...)
            if (!openShift && currentRegisterId && currentRegisterId !== '1') {
                openShift = await CashShift.findOne({
                    where: { registerId: currentRegisterId, status: 'open' }
                });
            }

            // 3. Fallback: Buscar turno abierto por el usuario actual en cualquier caja
            if (!openShift) {
                openShift = await CashShift.findOne({
                    where: { userId: String(userId), status: 'open' }
                });
            }

            // 4. Si el usuario logueado es admin, superadmin, supervisor o coincide por nombre
            if (!openShift) {
                const userRole = (reqUser.role || '').toLowerCase();
                const userName = (reqUser.name || reqUser.username || '').toLowerCase().trim();

                if (userName) {
                    const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
                    openShift = await CashShift.findOne({
                        where: {
                            status: 'open',
                            userName: { [likeOp]: `%${userName}%` }
                        }
                    });
                }

                if (!openShift && ['admin', 'superadmin', 'owner', 'supervisor'].includes(userRole)) {
                    openShift = await CashShift.findOne({
                        where: { status: 'open' },
                        order: [['openedAt', 'DESC']]
                    });
                }
            }

            if (!openShift) {
                throw new Error('CAJA_CERRADA: Debes abrir el turno de caja antes de realizar una venta.');
            }
        }

        // 🛡️ REGLA MODO ESTACIÓN: Validación de categorías y productos permitidos para esta caja (Doble Candado en Backend)
        let stationCategories = openShift?.allowedCategories;
        if (typeof stationCategories === 'string') {
            try { stationCategories = JSON.parse(stationCategories); } catch { stationCategories = []; }
        }
        let stationProducts = openShift?.allowedProducts;
        if (typeof stationProducts === 'string') {
            try { stationProducts = JSON.parse(stationProducts); } catch { stationProducts = []; }
        }
        const hasCatFilter = Array.isArray(stationCategories) && stationCategories.length > 0;
        const hasProdFilter = Array.isArray(stationProducts) && stationProducts.length > 0;

        if (hasCatFilter || hasProdFilter) {
            const normalizeStationText = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
            const allowedNorm = hasCatFilter ? stationCategories.map(normalizeStationText) : [];
            const allowedProdSet = new Set(hasProdFilter ? stationProducts.map(id => String(id).replace(/__bulk$|__mid$|__pres_.*$/, '')) : []);

            // Consultar categorías reales de los productos desde la base de datos (Zero-Trust)
            const cleanProductIds = [...new Set(
                (saleData.items || [])
                    .map(it => String(it.productId || it.id || '').replace(/__bulk$|__mid$|__pres_.*$/, ''))
                    .filter(Boolean)
            )];
            const { Product } = require('../database/models');
            const dbProducts = await Product.findAll({
                where: { id: { [Op.in]: cleanProductIds } },
                attributes: ['id', 'name', 'category']
            });
            const dbCategoryMap = new Map(dbProducts.map(p => [String(p.id), p.category]));
            const dbNameMap = new Map(dbProducts.map(p => [String(p.id), p.name]));

            for (const item of (saleData.items || [])) {
                const pId = String(item.productId || item.id || '').replace(/__bulk$|__mid$|__pres_.*$/, '');
                let isPermitted = false;

                if (hasProdFilter && allowedProdSet.has(pId)) {
                    isPermitted = true;
                }

                if (!isPermitted && hasCatFilter) {
                    const rawCategory = dbCategoryMap.get(pId) || item.category || '';
                    const itemCatNorm = normalizeStationText(rawCategory);
                    isPermitted = allowedNorm.includes(itemCatNorm);
                    if (!isPermitted) {
                        const itemNameNorm = normalizeStationText(dbNameMap.get(pId) || item.name || item.description);
                        isPermitted = allowedNorm.some(allowed => 
                            itemNameNorm.includes(allowed) && !itemCatNorm.includes('golosina') && !itemNameNorm.includes('sorpresa')
                        );
                    }
                }

                if (!isPermitted) {
                    const itemName = dbNameMap.get(pId) || item.name || item.description || `ID: ${pId}`;
                    const restrictionLabel = hasCatFilter ? stationCategories.join(', ') : `${stationProducts.length} productos autorizados`;
                    throw new Error(`ESTACION_RESTRINGIDA: Esta terminal está autorizada únicamente para facturar [${restrictionLabel}]. El producto "${itemName}" no pertenece a este rubro.`);
                }
            }
        }

        const { items, customerId, total, discount, receivedAmount, changeAmount, branchId: clientBranchId } = saleData;
        
        let branchId = null;
        const rawBranchId = clientBranchId || userBranchId;
        if (rawBranchId && String(rawBranchId) !== 'undefined' && String(rawBranchId) !== 'null' && String(rawBranchId) !== '1') {
            branchId = String(rawBranchId);
        }

        // Verify branch actually exists to prevent FOREIGN KEY constraint errors
        let dbBranch = null;
        if (branchId) {
            dbBranch = await sequelize.models.Branch.findOne({ where: { id: branchId, companyId } });
        }
        if (!dbBranch) {
            dbBranch = await sequelize.models.Branch.findOne({ 
                where: { companyId, isMain: true },
                order: [['createdAt', 'ASC']]
            });
        }
        if (!dbBranch) {
            dbBranch = await sequelize.models.Branch.findOne({ where: { companyId }, order: [['createdAt', 'ASC']] });
        }
        if (!dbBranch) {
            dbBranch = await sequelize.models.Branch.findOne({ where: { isMain: true }, order: [['createdAt', 'ASC']] }) || await sequelize.models.Branch.findOne({ order: [['createdAt', 'ASC']] });
        }
        if (!dbBranch) {
            dbBranch = await sequelize.models.Branch.create({
                id: generateRobustId(),
                userId,
                companyId,
                name: 'Principal',
                isMain: true,
                isActive: true
            });
        }
        branchId = dbBranch.id;

        if (!items || !items.length) {
            throw new Error('INTEGRITY_ERROR: No se pueden procesar ventas sin productos.');
        }

        // 2. INTEGRITY CHECK & ZERO-TRUST PRICE RECALCULATION
        const resolveCleanProductId = (it) => {
            const raw = String(it.productId || it.id || '').trim();
            return raw.replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
        };
        const itemIds = items.map(resolveCleanProductId).filter(Boolean);
        const companyCondition = (companyId === '2' || companyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }] }
            : { companyId };
        const dbProducts = await Product.findAll({ where: { id: itemIds, ...companyCondition }, include: [{ model: ProductPresentation, as: 'Presentations' }] });
        const dbProductMap = new Map(dbProducts.map(p => [String(p.id), p]));

        let serverCalculatedSubtotal = 0;
        for (const item of items) {
            const itemQty = Number(item.quantity) || 0;
            if (itemQty <= 0) throw new Error(`INTEGRITY_ERROR: Cantidad inválida para producto: ${item.name}`);
            
            const rawId = String(item.productId || item.id || '').trim();
            const prodId = resolveCleanProductId(item);
            const dbProd = dbProductMap.get(prodId);
            let isBulkItem = Boolean(item.isBulk || rawId.endsWith('__bulk'));
            let isMidBulkItem = Boolean(item.isMidBulk || rawId.endsWith('__mid'));

            let dynamicPres = null;
            const isWeightedWholesale = Boolean(item.isWeightedWholesale || rawId.includes('__wpres_'));
            if (dbProd && (item.presentationId || rawId.includes('__pres_') || rawId.includes('__wpres_'))) {
                const targetPresId = item.presentationId || (rawId.includes('__wpres_') ? rawId.split('__wpres_')[1] : rawId.split('__pres_')[1]);
                dynamicPres = dbProd.Presentations?.find(p => String(p.id) === String(targetPresId));
                if (dynamicPres) {
                    item.presentationId = dynamicPres.id;
                    item.presentationName = dynamicPres.name;
                    if (isWeightedWholesale) {
                        item.factorConversion = 1;
                        const wholesaleUnitPrice = Number(dynamicPres.factorConversion) > 0
                            ? precision.divide(Number(dynamicPres.price), Number(dynamicPres.factorConversion))
                            : Number(dbProd.price);
                        if (!item.price || Math.abs(Number(item.price) - wholesaleUnitPrice) <= 0.015) {
                            item.price = Number(item.price) > 0 ? Number(item.price) : wholesaleUnitPrice;
                        }
                    } else {
                        item.factorConversion = Number(dynamicPres.factorConversion);
                        if (!item.price || Math.abs(Number(item.price) - Number(dynamicPres.price)) <= 0.001) {
                            item.price = Number(dynamicPres.price);
                        }
                    }
                }
            }

            if (dbProd && !isBulkItem && !isMidBulkItem && !dynamicPres) {
                const candidateBulkPrice = Number(dbProd.bulkPrice) > 0 
                    ? Number(dbProd.bulkPrice) 
                    : (Number(dbProd.unitsPerBulk) > 1 ? precision.multiply(Number(dbProd.price) || 0, Number(dbProd.unitsPerBulk)) : 0);
                const candidateMidPrice = Number(dbProd.midBulkPrice) > 0 
                    ? Number(dbProd.midBulkPrice) 
                    : (Number(dbProd.unitsPerMidBulk) > 1 ? precision.multiply(Number(dbProd.price) || 0, Number(dbProd.unitsPerMidBulk)) : 0);

                if (candidateBulkPrice > 0 && Math.abs(Number(item.price) - candidateBulkPrice) <= 0.001) {
                    isBulkItem = true;
                    item.isBulk = true;
                } else if (candidateMidPrice > 0 && Math.abs(Number(item.price) - candidateMidPrice) <= 0.001) {
                    isMidBulkItem = true;
                    item.isMidBulk = true;
                }
            }

            let officialPrice = 0;
            if (dbProd) {
                if (dynamicPres) {
                    if (isWeightedWholesale) {
                        const rawP = Number(dynamicPres.price) || 0;
                        const facP = Number(dynamicPres.factorConversion) || 1;
                        const retP = Number(dbProd.price) || 0;
                        officialPrice = (rawP > 0 && retP > 0 && rawP <= retP)
                            ? rawP
                            : (facP > 0 ? precision.divide(rawP, facP) : retP);
                    } else {
                        officialPrice = Number(dynamicPres.price) || 0;
                    }
                } else if (isWeightedWholesale) {
                    const rawBulkP = Number(dbProd.bulkPrice) || 0;
                    const facBulkP = Number(dbProd.unitsPerBulk) || 1;
                    const retP = Number(dbProd.price) || 0;
                    officialPrice = (rawBulkP > 0 && retP > 0 && rawBulkP <= retP)
                        ? rawBulkP
                        : (facBulkP > 0 && rawBulkP > 0 ? precision.divide(rawBulkP, facBulkP) : retP);
                } else if (isBulkItem) {
                    officialPrice = Number(dbProd.bulkPrice) > 0 
                        ? Number(dbProd.bulkPrice) 
                        : precision.multiply(Number(dbProd.price) || 0, Number(dbProd.unitsPerBulk) || 1);
                } else if (isMidBulkItem) {
                    officialPrice = Number(dbProd.midBulkPrice) > 0 
                        ? Number(dbProd.midBulkPrice) 
                        : precision.multiply(Number(dbProd.price) || 0, Number(dbProd.unitsPerMidBulk) || 1);
                } else {
                    officialPrice = Number(dbProd.price) || 0;
                }
            } else {
                officialPrice = Number(item.price) || 0;
            }

            let itemPrice = officialPrice;
            const isServiceItem = Boolean(item.isService) || String(dbProd?.category || item.category || '').trim().toLowerCase() === 'servicios';

            // Permiso canModifyPrices: si el precio enviado difiere del catálogo (los servicios tienen monto variable por naturaleza)
            const priceTolerance = isWeightedWholesale ? 0.015 : 0.001;
            if (dbProd && Number(item.price) > 0 && Math.abs(Number(item.price) - officialPrice) > priceTolerance) {
                const canModifyPrices = isServiceItem || ['superadmin', 'admin', 'owner', 'supervisor'].includes((reqUser.role || '').toLowerCase()) || reqUser.permissions?.canModifyPrices === true;
                if (!canModifyPrices && !saleData.supervisorApprovalId) {
                    throw new Error(`INTEGRITY_ERROR: No tienes permiso para modificar el precio del producto "${item.name}". El precio oficial ($${officialPrice.toFixed(2)}) no coincide con el recibido ($${Number(item.price).toFixed(2)}). Se requiere la aprobación de un supervisor.`);
                }
                itemPrice = Number(item.price);
            } else if (isWeightedWholesale && Number(item.price) > 0) {
                itemPrice = Number(item.price);
            }
            
            const itemSubtotal = precision.multiply(itemPrice, itemQty);
            console.log(`[ZERO-TRUST CALC] Item: ${item.name}${isBulkItem ? ' [PAQUETE]' : (isMidBulkItem ? ' [MEDIA]' : '')}, Price: ${itemPrice}, Qty: ${itemQty}, Subtotal: ${itemSubtotal}`);
            serverCalculatedSubtotal = precision.add([serverCalculatedSubtotal, itemSubtotal]);
        }

        const discountValue = Number(discount) || 0;
        const promoDiscountValue = Number(saleData.promoDiscount) || 0;
        const totalEffectiveDiscount = precision.add([discountValue, promoDiscountValue]);
        const settings = await this._getSettings(companyId);
        let recalculatedIgtf = 0;
        
        let supervisorApprovalRecord = null;
        const canApplyDiscounts = reqUser.role === 'superadmin' || reqUser.role === 'admin' || reqUser.permissions?.canApplyDiscounts === true;

        // --- REGLA DE NEGOCIO: AUTORIZACIÓN DE DESCUENTO ---
        if (discountValue > 0 && !canApplyDiscounts) {
            if (!saleData.supervisorApprovalId) {
                throw new Error('AUTH_REQUIRED: No tienes permiso para aplicar descuentos. Se requiere la aprobación de un supervisor.');
            }
        }

        if (discountValue > (serverCalculatedSubtotal * 0.10) && reqUser.role !== 'superadmin') {
            if (!saleData.supervisorApprovalId) {
                throw new Error('AUTH_REQUIRED: Los descuentos mayores al 10% requieren la aprobación de un supervisor.');
            }
        }

        if (saleData.supervisorApprovalId) {
            supervisorApprovalRecord = await SupervisorApproval.findOne({
                where: { id: saleData.supervisorApprovalId, companyId }
            });
            if (!supervisorApprovalRecord) {
                throw new Error('AUTH_REQUIRED: La aprobación de supervisor provista es inválida o no existe.');
            }
            if (supervisorApprovalRecord.used) {
                throw new Error('AUTH_REQUIRED: Esta aprobación de supervisor ya fue utilizada previamente.');
            }
            if (supervisorApprovalRecord.expiresAt && new Date(supervisorApprovalRecord.expiresAt) < new Date()) {
                throw new Error('AUTH_REQUIRED: La aprobación de supervisor ha expirado.');
            }
        }

        const exchangeRate = Number(settings.exchangeRate) || 1.0;
        console.log(`[SALE-CALC] Subtotal: ${serverCalculatedSubtotal}, Discount: ${discountValue}, Rate: ${exchangeRate}`);

        const foreignCurrencyPayments = (saleData.paymentMethods || []).filter(p => {
            const pmCurrency = (p.currency || '').toUpperCase();
            const isCrypto = p.method === 'binance_usdt' || pmCurrency === 'USDT';
            if (isCrypto) {
                return !!settings.binanceIgtfEnabled;
            }
            return (pmCurrency ? pmCurrency === 'USD' : !p.method.includes('_bs')) && p.method !== 'zelle' && p.method !== 'fiado';
        });
        const totalUsdTendered = foreignCurrencyPayments.reduce((sum, p) => precision.add([sum, Number(p.amount) || 0]), 0);

        if (totalUsdTendered > 0 && settings.igtfEnabled) {
            const igtfRate = Number(settings.igtfRate || 3);
            const requiredPrincipal = precision.subtract(serverCalculatedSubtotal, totalEffectiveDiscount);
            const maxUsableFromTendered = precision.divide(totalUsdTendered, 1 + (igtfRate / 100));
            const appliedPrincipal = Math.min(requiredPrincipal, maxUsableFromTendered);
            recalculatedIgtf = precision.round(precision.multiply(appliedPrincipal, igtfRate / 100));
        }

        const serverCalculatedTotalExact = precision.add([
            precision.subtract(serverCalculatedSubtotal, totalEffectiveDiscount),
            recalculatedIgtf
        ]);
        const serverCalculatedTotalRounded = precision.round(serverCalculatedTotalExact, 2);
        const saleTotal = Number(total) || 0;
        console.log(`[SALE-CALC] Final Total Exact: ${serverCalculatedTotalExact}, Rounded: ${serverCalculatedTotalRounded}, Received: ${saleTotal}`);

        // Tolerancia Inteligente (Zero-Trust Integrity Check)
        // Aceptamos coincidencia exacta de VortexMathEngine o coincidencia redondeada a 2 decimales, o diferencia menor a 0.05 por conversiones de divisas/IGTF.
        const diffExact = Math.abs(precision.subtract(serverCalculatedTotalExact, saleTotal));
        const diffRounded = Math.abs(precision.subtract(serverCalculatedTotalRounded, saleTotal));
        const minDiff = Math.min(diffExact, diffRounded);

        let effectiveTolerance = 0.01;
        const hasBinancePayment = (saleData.paymentMethods || []).some(p => p.method === 'binance_usdt' || (p.currency || '').toUpperCase() === 'USDT');
        if (hasBinancePayment) {
            const roundingToleranceBs = Number(settings.binanceRoundingToleranceBs ?? settings.businessInfo?.binanceRoundingToleranceBs ?? 0.50);
            const binRate = Number(settings.binanceRate ?? settings.businessInfo?.binanceRate ?? exchangeRate);
            const dynamicTolBs = Math.max(roundingToleranceBs, binRate * 0.006, exchangeRate * 0.006);
            const toleranceInUsd = exchangeRate > 0 ? (dynamicTolBs / exchangeRate) : 0.02;
            effectiveTolerance = Math.max(0.01, toleranceInUsd);
        }

        if (minDiff > effectiveTolerance && !options.forceOverridePrice) {
            console.warn(`[ZERO-TRUST INTEGRITY] Total mismatch: Server Exact ${serverCalculatedTotalExact} / Rounded ${serverCalculatedTotalRounded} vs Client ${saleTotal}. Diff: ${minDiff}, Tol: ${effectiveTolerance}`);
            throw new Error(`INTEGRITY_ERROR: Discrepancia en el total. Servidor: ${serverCalculatedTotalRounded}, Recibido: ${saleTotal}. Diferencia: ${minDiff}`);
        }

        // La única fuente de verdad contable es el cálculo del servidor
        const serverCalculatedTotal = serverCalculatedTotalRounded;

        // 3. NORMALIZE PAYMENTS & CREDIT CHECK
        const normalizedPayments = this._normalizePayments(saleData, serverCalculatedTotal, exchangeRate, settings);

        // 🛡️ CANDADO ANTI-FRAUDE PARA BINANCE USDT (Verificación de Referencia Única 7 Días cuando se suministra referencia)
        const binancePayments = normalizedPayments.filter(p => p.method === 'binance_usdt' || (p.currency || '').toUpperCase() === 'USDT');
        for (const bp of binancePayments) {
            const ref = String(bp.reference || '').trim();
            if (ref && ref.length >= 4) {
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const dupRows = await sequelize.query(`
                    SELECT s."id"
                    FROM "Sales" s,
                         jsonb_array_elements(
                             CASE WHEN jsonb_typeof(s."paymentMethods") = 'array' THEN s."paymentMethods" ELSE '[]'::jsonb END
                         ) AS pm
                    WHERE s."companyId" = :companyId
                      AND s."date" >= :sevenDaysAgo
                      AND s."status" <> 'cancelled'
                      AND s."id" <> :clientTransactionId
                      AND (pm->>'method' = 'binance_usdt' OR UPPER(COALESCE(pm->>'currency', '')) = 'USDT')
                      AND LOWER(TRIM(COALESCE(pm->>'reference', ''))) = LOWER(:ref)
                    LIMIT 1;
                `, {
                    replacements: { companyId, sevenDaysAgo, clientTransactionId, ref },
                    type: sequelize.QueryTypes.SELECT
                });
                if (dupRows.length > 0) {
                    throw new Error(`FRAUDE_REFERENCIA_DUPLICADA: La referencia de Binance "${ref}" ya fue registrada en otra venta en los últimos 7 días.`);
                }
            }
        }
        const creditTotal = precision.add(
            normalizedPayments
                .filter(p => p.method === 'fiado')
                .map(p => Number(p.amount) || 0)
        );

        if (creditTotal > 0 && !customerId && !saleData.customerName) {
            throw new Error('INTEGRITY_ERROR: Debe seleccionar un cliente para procesar una venta a crédito (Fiado).');
        }

        // 🛡️ BLINDAJE ANTI-FRAUDE: Validar que la suma de pagos recibidos + crédito fiado cubra el total de la factura (TRAMPA 4 RESUELTA)
        let totalCoveredUsd = 0;
        for (const p of normalizedPayments) {
            const amt = Number(p.amount) || 0;
            if (amt > 0) {
                const cur = String(p.currency || 'USD').toUpperCase();
                if (cur === 'VES' || cur === 'BS') {
                    totalCoveredUsd = precision.add([totalCoveredUsd, exchangeRate > 0 ? precision.divide(amt, exchangeRate) : amt]);
                } else {
                    totalCoveredUsd = precision.add([totalCoveredUsd, amt]);
                }
            }
        }
        const totalSettledOrCreditedUsd = precision.add([totalCoveredUsd, creditTotal || 0]);
        const underpaymentDiff = precision.round(precision.subtract(serverCalculatedTotal, totalSettledOrCreditedUsd), 2);
        if (underpaymentDiff > 0.05 && !options.forceOverridePrice) {
            throw new Error(`FRAUDE_PAGO_INSUFICIENTE: Total Factura: ${serverCalculatedTotal.toFixed(2)}, Cubierto: ${totalSettledOrCreditedUsd.toFixed(2)}. Falta: ${underpaymentDiff.toFixed(2)}`);
        }

        const saleDate = saleData.date || saleData.timestamp || new Date().toISOString();
        const now = saleDate;
        let saleRecord = null;

        // --- BEGIN TRANSACTION (POSTGRESQL READ COMMITTED + DETERMINISTIC FOR UPDATE LOCKS) ---
        const t = await sequelize.transaction();

        try {
            // Resolver caja activa de la venta para numeración correlativa independiente por caja física
            const resolvedRegisterId = String((saleData.registerId && saleData.registerId !== '1') ? saleData.registerId : (openShift?.registerId || saleData.registerId || '1')).trim();
            const resolvedRegisterName = String(saleData.registerName || saleData.registerDisplayName || openShift?.registerName || 'Caja Principal').trim();

            let registerSequenceFilter = {};
            if (resolvedRegisterId && resolvedRegisterId !== '1' && resolvedRegisterId !== 'default') {
                registerSequenceFilter = { registerId: resolvedRegisterId };
            } else if (resolvedRegisterName) {
                registerSequenceFilter = { registerName: resolvedRegisterName };
            } else {
                registerSequenceFilter = { userId: String(userId) };
            }

            // Calcular número correlativo de Ticket del Día por Caja (Atómico, Determinista y Libre de Condiciones de Carrera)
            const parsedSaleDate = new Date(saleDate);
            const refDate = isNaN(parsedSaleDate.getTime()) ? new Date() : parsedSaleDate;
            const dateKey = refDate.toISOString().slice(0, 10);
            let dailyTicketNumber = Number(saleData.dailyTicketNumber || saleData.taxInfo?.dailyTicketNumber) || 0;

            try {
                const [regSeq] = await sequelize.query(`
                    INSERT INTO "DailyRegisterSequences" ("companyId", "registerId", "dateKey", "currentNumber")
                    VALUES (:companyId, :registerId, :dateKey, 1)
                    ON CONFLICT ("companyId", "registerId", "dateKey")
                    DO UPDATE SET "currentNumber" = "DailyRegisterSequences"."currentNumber" + 1
                    RETURNING "currentNumber";
                `, {
                    replacements: { companyId, registerId: resolvedRegisterId, dateKey },
                    type: sequelize.QueryTypes.SELECT,
                    transaction: t
                });
                if (regSeq?.currentNumber) {
                    dailyTicketNumber = Number(regSeq.currentNumber);
                }
            } catch (seqErr) {
                console.warn('[SaleService] Aviso en secuencia atómica de ticket diario, usando fallback:', seqErr.message);
                if (!dailyTicketNumber) {
                    const startOfDayIso = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), 0, 0, 0, 0).toISOString();
                    const endOfDayIso = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), 23, 59, 59, 999).toISOString();
                    const todaySalesCount = await Sale.count({
                        where: {
                            ...companyCondition,
                            ...registerSequenceFilter,
                            date: { [Op.between]: [startOfDayIso, endOfDayIso] }
                        },
                        transaction: t
                    }).catch(() => 0);
                    dailyTicketNumber = todaySalesCount + 1;
                }
            }

            const enrichedTaxInfo = {
                ...(saleData.taxInfo && typeof saleData.taxInfo === 'object' ? saleData.taxInfo : {}),
                dailyTicketNumber
            };

            // 4. CREACIÓN EN ESTADO PENDING (GARANTÍA DE IDEMPOTENCIA POR DB)
            const saleRecordData = {
                id: clientTransactionId,
                companyId,
                userId,
                customerId: customerId ? String(customerId) : null,
                branchId,
                paymentMethod: normalizedPayments[0]?.method || saleData.paymentMethod || 'cash',
                paymentMethods: normalizedPayments,
                total: serverCalculatedTotal,
                subtotal: serverCalculatedSubtotal,
                tax: Number(saleData.tax) || 0,
                discount: discountValue,
                receivedAmount: Number(receivedAmount) || 0,
                changeAmount: Number(changeAmount) || 0,
                igtfAmount: recalculatedIgtf,
                taxInfo: enrichedTaxInfo,
                date: saleDate,
                timestamp: saleDate,
                exchangeRate,
                documentType: saleData.documentType || 'factura',
                customerName: saleData.customerName || 'Cliente Ocasional',
                paymentStatus: creditTotal > 0 ? 'pending' : 'paid',
                status: 'pending', // <--- ESTADO INICIAL SEGURO
                registerId: resolvedRegisterId,
                registerName: resolvedRegisterName,
                cashierName: reqUser.name || reqUser.username || saleData.cashierName || 'Cajero',
                promoDiscount: Number(saleData.promoDiscount) || 0,
                appliedPromotions: Array.isArray(saleData.appliedPromotions) ? saleData.appliedPromotions : []
            };

            try {
                saleRecord = await Sale.create(saleRecordData, { transaction: t });
            } catch (createError) {
                // Si la DB lanza error de clave duplicada, significa que la venta YA fue procesada
                if (createError.name === 'SequelizeUniqueConstraintError' || createError.message.includes('UNIQUE constraint failed')) {
                    await t.rollback();
                    console.warn(`[Idempotency] Request duplicado interceptado para TX: ${clientTransactionId}`);
                    return await Sale.findByPk(clientTransactionId, { include: [{ model: SaleItem, as: 'SaleItems' }] });
                }
                throw createError; // Si es otro error de DB, lo dejamos subir
            }

            // 5. PROCESAR INVENTARIO (CON ROW-LEVEL LOCKING EN ORDEN DETERMINÍSTICO ANTI-DEADLOCK)
            let totalCashAdvanceBs = 0;
            const sortedItems = [...items].sort((a, b) => {
                const idA = String(a.productId || a.id || '').trim().replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
                const idB = String(b.productId || b.id || '').trim().replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
                return idA.localeCompare(idB);
            });
            for (const item of sortedItems) {
                const rawId = String(item.productId || item.id || '').trim();
                const pId = rawId.replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
                if (!pId || pId === 'undefined' || (pId === 'null' && !item.isCustom)) continue;

                let cost = Number(item.cost) || 0;
                let category = item.category || 'General';
                let product = null;

                if (!item.isCustom && pId) {
                    product = await Product.findOne({
                        where: { id: pId, ...companyCondition },
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                        transaction: t
                    });

                    // SI EL PRODUCTO FUE BORRADO MIENTRAS ESTABA EN EL CARRITO, ABORTAR
                    if (!product) {
                        if (options.bypassStockCheck) {
                            console.warn(`[SYNC-INTEGRITY] Producto "${item.name}" (ID: ${pId}) no existe en el catálogo de la PC. Se procesa como personalizado en caliente para no bloquear la sincronización.`);
                            cost = Number(item.cost) || 0;
                            category = item.category || category;
                        } else {
                            throw new Error(`INTEGRITY_ERROR: Producto no encontrado o inactivo (${item.name}). Venta abortada.`);
                        }
                    } else if (product.companyId !== companyId && (companyId === '2' || companyId === 'default')) {
                        // Auto-healing: align product tenant ID
                        await product.update({ companyId }, { transaction: t });
                    }
                }

                const isBulkItem = Boolean(item.isBulk || rawId.endsWith('__bulk'));
                const isMidBulkItem = Boolean(item.isMidBulk || rawId.endsWith('__mid'));
                const isServiceItem = Boolean(item.isService) || String(product?.category || item.category || '').trim().toLowerCase() === 'servicios';

                if (product) {
                    // En servicios (como Avance BS), respetar el costo enviado por el POS (ej. efectivo entregado) para que la utilidad sea únicamente la comisión
                    cost = (isServiceItem && Number(item.cost) > 0) ? Number(item.cost) : (Number(product.cost) || 0);
                    category = product.category || category;
                }

                if (product && !isServiceItem) {
                    const itemQty = Number(item.quantity) || 0;
                    const unitsMultiplier = Number(item.factorConversion) > 0 
                        ? Number(item.factorConversion)
                        : (isBulkItem 
                            ? (Number(product.unitsPerBulk) || Number(item.unitsPerBulk) || 1) 
                            : (isMidBulkItem 
                                ? (Number(product.unitsPerMidBulk) || Number(item.unitsPerMidBulk) || 1)
                                : 1));
                    const unitsToDeduct = precision.multiply(itemQty, unitsMultiplier);

                    // DEDUCCIÓN EN SUCURSAL CON TRACKING DE STOCK (KARDEX)
                    let branchStock = null;
                    if (branchId) {
                        try {
                            let created;
                            [branchStock, created] = await BranchStock.findOrCreate({
                                where: { productId: pId, branchId, companyId },
                                defaults: { quantity: 0 },
                                transaction: t,
                                lock: t.LOCK.UPDATE
                            });
                        } catch (err) {
                            if (err.name === 'SequelizeForeignKeyConstraintError' || (err.message && err.message.includes('FOREIGN KEY'))) {
                                try { await t.rollback(); } catch(e){} // Explicit rollback to release locks immediately
                                throw new Error(`INTEGRITY_ERROR: Producto "${product.name}" o Sucursal no encontrados (Falla de Integridad).`);
                            }
                            throw err;
                        }
                    }

                    // Determinar stock previo disponible (Priorizar sucursal activa, o stock global)
                    const masterStock = Number(product.stockQuantity ?? product.stock ?? 0);
                    const stockBefore = branchStock ? Number(branchStock.quantity || 0) : masterStock;
                    const stockAfter = precision.subtract(stockBefore, unitsToDeduct);

                    // VALIDACIÓN FÍSICA Y RESOLUCIÓN INTELIGENTE DE SOBREGIRO OFFLINE
                    if (stockAfter < 0) {
                        const overdraft = Math.abs(stockAfter);
                        if (!product.allowNegative && !options.bypassStockCheck) {
                            throw new Error(`STOCK_ERROR: Inventario insuficiente para "${product.name}". Requerido: ${unitsToDeduct} un, Disponible: ${stockBefore} un.`);
                        }
                        if (options.bypassStockCheck && sequelize.getDialect() === 'postgres') {
                            await sequelize.query("SET LOCAL app.bypass_stock_trigger = 'true';", { transaction: t });
                        }

                        // Registrar auditoría de sobregiro por venta offline concurrente
                        try {
                            const alertId = `ALERT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
                            await StockAlert.create({
                                id: alertId,
                                productId: pId,
                                productName: product.name,
                                saleId: clientTransactionId,
                                companyId,
                                cashierName: reqUser.name || reqUser.username || saleData.cashierName || 'Cajero',
                                registerName: saleData.registerName || 'Caja Principal',
                                expectedStock: stockBefore,
                                soldQuantity: unitsToDeduct,
                                overdraftAmount: overdraft,
                                resolved: false
                            }, { transaction: t });

                            console.warn(`[STOCK-OVERDRAFT] Conflicto registrado para "${product.name}". Requerido: ${unitsToDeduct}, Prev: ${stockBefore}, Sobregiro: ${overdraft}`);

                            if (global.io) {
                                global.io.emit('stock_conflict_alert', {
                                    id: alertId,
                                    productName: product.name,
                                    saleId: clientTransactionId,
                                    overdraftAmount: overdraft,
                                    cashierName: reqUser.name || saleData.cashierName || 'Cajero',
                                    registerName: saleData.registerName || 'Caja Principal',
                                    timestamp: new Date().toISOString()
                                });
                            }
                        } catch (alertErr) {
                            console.error('[STOCK-ALERT] Error creando alerta de stock:', alertErr.message);
                        }
                    }

                    // --- INICIO LÓGICA DE LOTES FIFO ---
                    let remainingQtyToDeduct = unitsToDeduct;
                    const activeLots = await ProductLot.findAll({
                        where: { 
                            productId: pId, 
                            companyId, 
                            quantity: { [Op.gt]: 0 }, 
                            status: 'active' 
                        },
                        order: [
                            [sequelize.fn('COALESCE', sequelize.col('expirationDate'), '9999-12-31'), 'ASC'],
                            ['createdAt', 'ASC']
                        ],
                        transaction: t,
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE
                    });

                    for (const lot of activeLots) {
                        if (remainingQtyToDeduct <= 0) break;
                        const deductFromLot = Math.min(Number(lot.quantity), remainingQtyToDeduct);
                        const newLotQty = Number(lot.quantity) - deductFromLot;
                        
                        await lot.update({ 
                            quantity: newLotQty,
                            status: newLotQty <= 0 ? 'exhausted' : 'active' 
                        }, { transaction: t });

                        remainingQtyToDeduct -= deductFromLot;
                    }
                    // --- FIN LÓGICA DE LOTES FIFO ---

                    // 1. Descuento atómico en sucursal si aplica
                    if (branchStock) {
                        await branchStock.decrement('quantity', { by: unitsToDeduct, transaction: t });
                    }

                    // 2. Descuento atómico directo en la tabla maestra de productos (evita Lost Updates)
                    await product.decrement(['stockQuantity', 'stock'], { by: unitsToDeduct, transaction: t });

                    const piecesToDeduct = Number(item.piecesToDeduct) || 0;
                    if (product.stockUnits !== null && product.stockUnits !== undefined && Number(product.stockUnits) > 0) {
                        if (stockAfter <= 0) {
                            await product.update({ stockUnits: 0 }, { transaction: t });
                        } else if (piecesToDeduct > 0) {
                            const nextUnits = Math.max(0, Math.round((Number(product.stockUnits) - piecesToDeduct) * 100) / 100);
                            await product.update({ stockUnits: nextUnits }, { transaction: t });
                        } else if ((product.isSoldByWeight || product.stockUnit === 'kg') && unitsToDeduct > 0) {
                            const avgPieceWeight = (Number(product.unitsPerBulk) > 0 && Number(product.unitsPerBulk) !== 1)
                                ? Number(product.unitsPerBulk)
                                : (stockBefore > 0 ? (stockBefore / Number(product.stockUnits)) : 0);
                            if (avgPieceWeight > 0) {
                                const fractionalPieces = unitsToDeduct / avgPieceWeight;
                                const nextUnits = Math.max(0, Math.round((Number(product.stockUnits) - fractionalPieces) * 100) / 100);
                                await product.update({ stockUnits: nextUnits }, { transaction: t });
                            }
                        }
                    }

                    // 3. Recargar la instancia dentro de la transacción para obtener el valor actualizado real
                    await product.reload({ transaction: t });

                    // 4. Registro incondicional en el Kardex (resuelve también el Hallazgo 6)
                    const movementReason = item.presentationName 
                        ? `Venta #${saleRecord.id.split('-').pop()} (${itemQty} ${item.presentationName} x ${unitsMultiplier} un)`
                        : (isBulkItem 
                            ? `Venta #${saleRecord.id.split('-').pop()} (${itemQty} ${product.bulkUnitName || 'Bulto/Caja'} x ${unitsMultiplier} un)`
                            : (isMidBulkItem
                                ? `Venta #${saleRecord.id.split('-').pop()} (${itemQty} ${product.midBulkUnitName || 'Media Presentación'} x ${unitsMultiplier} un)`
                                : `Venta #${saleRecord.id.split('-').pop()}`));

                    await StockMovement.create({
                        id: generateRobustId(),
                        productId: product.id,
                        branchId: branchId || null,
                        userId,
                        companyId,
                        type: 'OUT',
                        quantity: unitsToDeduct,
                        stockBefore,
                        stockAfter: branchStock ? precision.subtract(stockBefore, unitsToDeduct) : product.stockQuantity,
                        reason: movementReason,
                        referenceId: saleRecord.id,
                        date: now,
                        timestamp: now
                    }, { transaction: t });

                    if (item.variante_id || item.variantId) {
                        const varId = String(item.variante_id || item.variantId);
                        const variant = await VarianteProducto.findByPk(varId, { transaction: t, lock: t.LOCK.UPDATE });
                        if (variant) {
                            await variant.decrement('stock', { by: unitsToDeduct, transaction: t });
                        }
                    }
                }

                const itemPrice = Number(item.price !== undefined ? item.price : (item.precio || 0));
                const itemQty = Number(item.quantity || 1);
                const itemBulkMultiplier = isBulkItem ? (Number(product?.unitsPerBulk) || Number(item.unitsPerBulk) || 1) : 1;
                const itemMidBulkMultiplier = isMidBulkItem ? (Number(product?.unitsPerMidBulk) || Number(item.unitsPerMidBulk) || 1) : 1;
                const effectiveCost = isBulkItem 
                    ? (Number(product?.bulkCost) > 0 ? Number(product.bulkCost) : precision.multiply(cost, itemBulkMultiplier))
                    : (isMidBulkItem
                        ? (Number(product?.midBulkCost) > 0 ? Number(product.midBulkCost) : precision.multiply(cost, itemMidBulkMultiplier))
                        : cost);

                const itemFactorConversion = Number(item.factorConversion) > 0
                    ? Number(item.factorConversion)
                    : (isBulkItem ? itemBulkMultiplier : (isMidBulkItem ? itemMidBulkMultiplier : 1));

                const createdSaleItem = await SaleItem.create({
                    saleId: clientTransactionId,
                    productId: pId || `manual-${Date.now()}`,
                    name: item.name || item.nombre || 'Producto',
                    quantity: itemQty,
                    price: itemPrice,
                    cost: effectiveCost,
                    subtotal: precision.multiply(itemQty, itemPrice),
                    category,
                    companyId,
                    batchNumber: product ? product.batchNumber : (item.batchNumber || null),
                    expirationDate: product ? product.expirationDate : (item.expirationDate || null),
                    es_controlado: Boolean((product && product.es_controlado) || item.es_controlado),
                    recipe: item.recipe ? (typeof item.recipe === 'object' ? JSON.stringify(item.recipe) : String(item.recipe)) : null,
                    isBulk: isBulkItem,
                    unitsPerBulk: itemBulkMultiplier,
                    isMidBulk: isMidBulkItem,
                    unitsPerMidBulk: itemMidBulkMultiplier,
                    presentationId: item.presentationId || null,
                    presentationName: item.presentationName || null,
                    factorConversion: itemFactorConversion,
                    promoDiscount: Number(item.promoDiscount) || 0,
                    appliedPromoName: item.appliedPromoName || null
                }, { transaction: t });

                // DEDUCCIÓN AUTOMÁTICA DE COMPONENTES DE RECETA / COMBO (BOM)
                try {
                    const ProductionService = require('./ProductionService');
                    await ProductionService.processKitSaleDeduction(createdSaleItem, t, companyId);
                } catch (kitErr) {
                    console.warn('[SaleService] Error procesando descuento de receta combo:', kitErr.message);
                }

                // DESCUENTO AUTOMÁTICO DE EFECTIVO EN GAVETA POR AVANCE DE EFECTIVO (Avance BS)
                const isCashAdvanceItem = Boolean(item.isCashAdvance) || (isServiceItem && /\bavance\b/i.test(String(item.originalName || item.name || product?.name || '')));
                if (isCashAdvanceItem) {
                    const explicitCashBs = Number(item.cashBs) > 0
                        ? precision.multiply(Number(item.cashBs), itemQty)
                        : (effectiveCost > 0 ? precision.multiply(precision.multiply(effectiveCost, exchangeRate), itemQty) : 0);
                    if (explicitCashBs > 0) {
                        totalCashAdvanceBs = precision.add([totalCashAdvanceBs, explicitCashBs]);
                    }
                }
            }

            // 5B. REGISTRAR SALIDA DE EFECTIVO EN CAJA SI HUBO AVANCE DE EFECTIVO (Avance BS)
            if (totalCashAdvanceBs > 0 && openShift) {
                await CashMovement.create({
                    id: `ADV-${clientTransactionId}`,
                    shiftId: openShift.id,
                    userId: String(userId),
                    userName: reqUser.name || reqUser.username || saleData.cashierName || 'Cajero',
                    companyId,
                    type: 'out',
                    category: 'CASH_ADVANCE',
                    amount: precision.round(totalCashAdvanceBs, 2),
                    currency: 'VES',
                    paymentMethodId: 'cash_bs',
                    reason: `Avance de Efectivo Bs entregado al cliente (Ticket #${dailyTicketNumber || clientTransactionId.slice(-6).toUpperCase()})`,
                    timestamp: now
                }, { transaction: t });
            }

            // 6. PROCESAR CRÉDITO / FIADO EN EL LEDGER
            if (creditTotal > 0) {
                let customer;
                if (customerId) {
                    customer = await Customer.findOne({
                        where: { id: String(customerId), ...companyCondition },
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                        transaction: t
                    });
                } else if (saleData.customerName) {
                    const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
                    customer = await Customer.findOne({
                        where: { name: { [likeOp]: String(saleData.customerName).trim() }, ...companyCondition },
                        lock: sequelize.constructor.Transaction.LOCK.UPDATE,
                        transaction: t
                    });
                }

                if (!customer) {
                    throw new Error(`CREDIT_ERROR: Cliente no encontrado en la base de datos.`);
                }

                // 🛡️ REGLA FINANCIERA: Bloqueo explícito por suspensión administrativa
                if (customer.isCreditBlocked && !options.bypassCreditLimit && !saleData.supervisorApprovalId) {
                    throw new Error(`CREDIT_ERROR: El crédito del cliente "${customer.name}" se encuentra suspendido o bloqueado por administración.`);
                }

                // 🛡️ REGLA FINANCIERA: Verificación de facturas vencidas por días de mora (creditLimitDays)
                const creditLimitDays = Number(customer.creditLimitDays) || 0;
                if (creditLimitDays > 0 && Number(customer.creditBalance) > 0 && !options.bypassCreditLimit && !saleData.supervisorApprovalId) {
                    const oldestPendingCharge = await CreditHistory.findOne({
                        where: {
                            customerId: customer.id,
                            companyId,
                            type: 'charge'
                        },
                        order: [['createdAt', 'ASC']],
                        transaction: t
                    });

                    if (oldestPendingCharge && oldestPendingCharge.createdAt) {
                        const oldestDate = new Date(oldestPendingCharge.createdAt);
                        const daysDiff = Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
                        if (daysDiff > creditLimitDays) {
                            throw new Error(`CREDIT_ERROR: El cliente "${customer.name}" posee deuda con ${daysDiff} días de vencimiento (Plazo concedido: ${creditLimitDays} días). Se requiere liquidar el saldo pendiente o autorización de un supervisor.`);
                        }
                    }
                }

                const creditLimit = Number(customer.creditLimit) || 0;
                const currentBalance = Number(customer.creditBalance) || 0;
                const available = precision.round(precision.subtract(creditLimit, currentBalance), 6);

                if (creditLimit <= 0 && !options.bypassCreditLimit) {
                    throw new Error(`CREDIT_ERROR: El cliente "${customer.name}" no tiene límite de crédito asignado.`);
                }
                if (creditTotal > available && !options.bypassCreditLimit) {
                    throw new Error(`CREDIT_ERROR: Crédito insuficiente para "${customer.name}". Disponible: ${available.toFixed(2)}`);
                }

                const roundedAmount = precision.round(creditTotal, 2);
                const newBalance = precision.round(precision.add([currentBalance, roundedAmount]), 2);

                // LEDGER FINANCIERO (VERDAD ABSOLUTA)
                await CreditHistory.create({
                    id: generateRobustId(),
                    userId,
                    companyId,
                    customerId: customer.id,
                    type: 'charge', // <-- CLASIFICACIÓN CONTABLE
                    amount: roundedAmount,
                    balanceAfter: newBalance,
                    description: `Factura #CAJA${saleRecordData.registerId}-${clientTransactionId.slice(-6).toUpperCase()}`,
                    paymentMethod: 'fiado',
                    saleId: clientTransactionId,
                    timestamp: now
                }, { transaction: t });

                // CACHÉ DE BALANCE
                customer.creditBalance = newBalance;
                await customer.save({ transaction: t });
            }

            // 7. PUNTOS DE LEALTAD
            if (customerId) {
                const loyaltyRate = Number(settings?.loyaltyPointsRate || saleData.loyaltyPointsRate || options.loyaltyPointsRate || 0.10);
                const pointsToAward = precision.round(precision.multiply(serverCalculatedTotal, loyaltyRate), 0);
                if (pointsToAward > 0) {
                    await Customer.increment('loyaltyPoints', {
                        by: pointsToAward,
                        where: { id: String(customerId), ...companyCondition },
                        transaction: t
                    });
                }
            }

            // 8. MARCAR COMO COMPLETED (ÉXITO TOTAL)
            await saleRecord.update({ status: 'completed' }, { transaction: t });
            // Consumir aprobación de supervisor de descuento (anti-replay)
            if (supervisorApprovalRecord) {
                await supervisorApprovalRecord.update({
                    used: true,
                    usedAt: new Date(),
                    referenceId: saleRecord.id
                }, { transaction: t });
            }

            // 8B. ENCOLAR EN OUTBOX PARA SINCRONIZACION NUBE (SUPABASE 24/7)
            try {
                const SupabaseSyncService = require('./SupabaseSyncService');
                const outboxPayload = {
                    id: String(saleRecord.id),
                    sucursal_id: String(userBranchId || 'principal'),
                    numero_factura: String(saleData.documentNumber || saleData.invoiceNumber || saleRecord.id),
                    cliente_nombre: String(saleData.customerName || 'Consumidor Final'),
                    subtotal: Number(serverCalculatedSubtotal || saleRecord.subtotal || 0),
                    impuesto: Number(saleRecord.tax || saleData.tax || 0),
                    total: Number(serverCalculatedTotal || saleTotal || 0),
                    metodo_pago: String(saleData.paymentMethod || 'EFECTIVO'),
                    items_detalle: (items || []).map(it => ({
                        id: it.productId || it.id,
                        nombre: it.name,
                        cantidad: Number(it.quantity || 1),
                        precio: Number(it.price || 0),
                        total: Number(it.total || 0)
                    })),
                    fecha_hora: saleRecord.createdAt || new Date()
                };
                await SupabaseSyncService.queueEvent('ventas', saleRecord.id, 'INSERT', outboxPayload, t);
            } catch (syncErr) {
                console.warn('[SyncOutbox] Advertencia encolando venta:', syncErr.message);
            }

            // 9. COMMIT FINANCIERO FINAL
            await t.commit();

            // Auditoría post-commit
            this._logAudit(reqUser, 'CREATE_SALE', `Venta completada: ${clientTransactionId}`, clientTransactionId, null, { total: saleTotal }).catch(() => {});

            // Propagar cambio de stock por LAN en tiempo real
            try {
                if (Array.isArray(items) && items.length > 0) {
                    const broadcastItems = items.map(it => {
                        const rawId = String(it.productId || it.id || '').trim();
                        const cleanId = rawId.replace(/__bulk$|__mid$/, '');
                        const isBulk = Boolean(it.isBulk || rawId.endsWith('__bulk'));
                        const isMidBulk = Boolean(it.isMidBulk || rawId.endsWith('__mid'));
                        const mult = isBulk ? (Number(it.unitsPerBulk) || 1) : (isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1);
                        const qty = precision.multiply(Number(it.quantity) || 1, mult);
                        return { productId: cleanId, quantity: qty, name: it.name };
                    });
                    LANClusterService.broadcastLANEvent('lan_stock_update', { items: broadcastItems, timestamp: Date.now() });
                }
            } catch (lanErr) {}

            // INTEGRACIÓN SRI ECUADOR: Procesar comprobante electrónico asíncronamente
            const bizCountry = settings.businessInfo?.country || settings.country || '';
            if (bizCountry.toLowerCase() === 'ecuador') {
                try {
                    const SriService = require('./SriService');
                    SriService.processInvoice(saleRecord, settings).catch(sriErr => {
                        console.error('[SaleService] Error en procesamiento asíncrono SRI:', sriErr);
                    });
                } catch (sriReqErr) {
                    console.error('[SaleService] No se pudo instanciar SriService:', sriReqErr);
                }
            }

            const finalSale = await Sale.findOne({
                where: { id: clientTransactionId, companyId },
                include: [{ model: SaleItem, as: 'SaleItems' }]
            });
            if (finalSale && typeof finalSale.setDataValue === 'function') {
                finalSale.setDataValue('dailyTicketNumber', dailyTicketNumber);
            }

            // INTEGRACIÓN CONTABLE NIIF AUTOMÁTICA (ASÍNCRONA NO BLOQUEANTE POST-COMMIT)
            setImmediate(async () => {
                try {
                    const AccountingEngineService = require('./AccountingEngineService');
                    await AccountingEngineService.generateSaleEntry(finalSale || saleRecord, companyId);
                } catch (accErr) {
                    console.warn('[SaleService] Aviso en asiento contable automático post-venta:', accErr.message);
                }
            });

            return finalSale;

        } catch (error) {
            // Liberar lock de idempotencia inmediatamente en caso de fallo para permitir reintentos legítimos
            inFlightTransactions.delete(clientTransactionId);

            // ROLLBACK GARANTIZADO
            try { 
                if (t && !t.finished) await t.rollback(); 
            } catch(e) {}
            
            console.error(`[TX-ROLLBACK] Transacción fallida ${clientTransactionId}:`, error.message);
            throw error; // Propagar error al frontend
        }
    }

    /**
     * Payment Normalization (USD/VES).
     */
    _normalizePayments(saleData, saleTotal, exchangeRate, settings = {}) {
        if (saleData.paymentMethods?.length > 0) {
            return saleData.paymentMethods.map(p => {
                const isBinance = p.method === 'binance_usdt' || (p.currency || '').toUpperCase() === 'USDT';
                if (isBinance) {
                    const amountUsdt = precision.round(Number(p.amount) || 0, 2);
                    const cryptoRate = Number(p.cryptoRate || exchangeRate || 0);
                    let convertedAmountBs = Number(p.convertedAmountBs || 0);
                    if (!convertedAmountBs && exchangeRate > 0) {
                        convertedAmountBs = precision.round(precision.multiply(amountUsdt, exchangeRate), 2);
                    }
                    const convertedAmountUsd = amountUsdt;
                    return {
                        ...p,
                        method: 'binance_usdt',
                        receiptLabel: p.receiptLabel || 'PAGO ELECTRÓNICO',
                        amount: amountUsdt,
                        currency: 'USDT',
                        cryptoRate: cryptoRate > 0 ? cryptoRate : undefined,
                        convertedAmountBs: convertedAmountBs > 0 ? convertedAmountBs : undefined,
                        convertedAmountUsd
                    };
                }
                return p;
            });
        }

        const { amountTenderedUsd = 0, amountTenderedVes = 0, paymentMethod = 'cash' } = saleData;
        const tenderedUsd = Number(amountTenderedUsd);
        const tenderedVes = Number(amountTenderedVes);

        if (tenderedUsd === 0 && tenderedVes === 0) {
            return [{ method: paymentMethod, amount: saleTotal, currency: 'USD' }];
        }

        const normalized = [];
        if (tenderedVes > 0) {
            const tenderedVesInUsd = precision.normalizeToUsd(tenderedVes, exchangeRate);
            normalized.push({ 
                method: paymentMethod + '_bs', 
                amount: precision.round(tenderedVes, 2), 
                currency: 'VES', 
                convertedAmountUsd: tenderedVesInUsd 
            });
        }
        if (tenderedUsd > 0) {
            normalized.push({ 
                method: paymentMethod, 
                amount: precision.round(tenderedUsd, 2), 
                currency: 'USD' 
            });
        }

        return normalized.length > 0 ? normalized : [{ method: paymentMethod, amount: saleTotal, currency: 'USD' }];
    }

    async updateOrphanSaleCustomer(saleId, customerId, customerName, companyId = null) {
        const whereClause = { id: String(saleId) };
        if (companyId) whereClause.companyId = companyId;
        return await Sale.update(
            { 
                customerId: customerId ? String(customerId) : null, 
                customerName: customerName || 'Cliente Ocasional' 
            },
            { where: whereClause }
        );
    }

    async _getSettings(companyId) {
        let settings = cache.get('all_settings');
        if (!settings) {
            settings = await readJsonAsync(SETTINGS_FILE);
            cache.set('all_settings', settings, 3600);
        }
        return getUserSettings(settings, companyId);
    }

    async _logAudit(reqUser, action, description, entityId, oldVal, newVal) {
        try {
            await AuditLog.create({
                id: generateRobustId(),
                userId: reqUser.id,
                companyId: reqUser.companyId,
                action,
                description,
                entityId,
                oldValue: oldVal ? JSON.stringify(oldVal) : null,
                newValue: newVal ? JSON.stringify(newVal) : null,
                timestamp: new Date().toISOString()
            });
        } catch (e) { }
    }
}

module.exports = new SaleService();
