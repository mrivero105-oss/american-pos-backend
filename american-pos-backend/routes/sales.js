const express = require('express');
const router = express.Router();
const SaleService = require('../services/SaleService');
const { Sale, SaleItem, RegisterDraft } = require('../database/models');
const { Op } = require('sequelize');
const { sequelize } = require('../database/connection');
const validate = require('../middleware/validate');
const { saleSchema } = require('../schemas/saleSchema');

/**
 * POST /public-sync - Sync local mobile sales to server (Protected)
 */
router.post('/public-sync', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const { sales } = req.body;
        if (!Array.isArray(sales)) return res.status(400).json({ error: 'Formato de ventas inválido' });

        console.log(`[SYNC] Recibidas ${sales.length} ventas del móvil (Usuario: ${req.user.name})`);
        const { Sale } = require('../database/models');
        const { Op } = require('sequelize');
        const results = { success: [], errors: [] };
        const CHUNK_SIZE = 25;

        for (let i = 0; i < sales.length; i += CHUNK_SIZE) {
            // Ceder control al Event Loop entre lotes para no saturar RAM ni bloquear Express
            await new Promise(resolve => setImmediate(resolve));
            const chunk = sales.slice(i, i + CHUNK_SIZE);
            const chunkIds = chunk.map(s => String(s.id));
            
            // Optimización I/O: Consulta masiva por lote de IDs existentes en lugar de N consultas findOne
            const existingSales = await Sale.findAll({
                where: { id: { [Op.in]: chunkIds }, companyId: String(req.user.companyId) }
            });
            const existingMap = new Map(existingSales.map(s => [String(s.id), s]));

            for (let saleData of chunk) {
                try {
                    // EXTREME TYPE SANITIZATION: Postgres strict type matching
                    saleData.id = String(saleData.id);
                    if (saleData.customerId) saleData.customerId = String(saleData.customerId);
                    if (saleData.items) {
                        saleData.items = saleData.items.map(item => ({
                            ...item,
                            id: String(item.id),
                            productId: item.productId ? String(item.productId) : String(item.id)
                        }));
                    }

                    const saleId = saleData.id;
                    const existing = existingMap.get(String(saleId));

                    if (existing) {
                        if (!existing.customerId || existing.customerId === '') {
                            console.log(`[SYNC] Vinculando venta huérfana existente: ${saleData.id} -> ${saleData.customerName}`);
                            await SaleService.updateOrphanSaleCustomer(saleData.id, saleData.customerId, saleData.customerName);
                            results.success.push({ id: saleData.id, message: 'Vinculado' });
                        } else {
                            console.log(`[SYNC] Salteando venta duplicada (ya vinculada): ${saleData.id}`);
                            results.success.push({ id: saleData.id, message: 'Ya existe' });
                        }
                        continue;
                    }

                const processed = await SaleService.processSale(req.user, saleData, { 
                    bypassCreditLimit: true, 
                    bypassStockCheck: true,
                    bypassShiftCheck: true 
                });
                console.log(`[SYNC] Éxito: Venta ${saleData.id} registrada en DB con ID ${processed.id}`);
                results.success.push({ id: saleData.id, dbId: processed.id });

                const io = req.app.get('io');
                if (io) {
                    io.to(req.user.companyId).emit('sale_completed', processed);
                    io.to(req.user.companyId).emit('inventory_changed');
                }
            } catch (err) {
                console.error(`[SYNC] !!! ERROR CRÍTICO en venta ${saleData.id}:`, err.message);
                results.errors.push({ id: saleData.id, error: err.message });
            }
        }
        }
        res.json({ success: true, synced: results.success.length, errors: results.errors.length, details: results });
    } catch (error) {
        console.error('Mobile sales sync error:', error);
        res.status(500).json({ error: 'Error interno en sincronización de ventas' });
    }
});

/**
 * GET /public-list - Get sales history for mobile (Protected)
 */
router.get('/public-list', require('../middleware/auth').verifyToken, async (req, res) => {
    try {
        const where = {};
        // IDOR FIX: Always enforce companyId
        where.companyId = req.user.companyId;
        if (req.user.role?.toLowerCase() === 'user') {
            where.userId = req.user.id;
        }

        const sales = await Sale.findAll({
            where,
            limit: 50,
            order: [['date', 'DESC']],
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });
        res.json(sales);
    } catch (error) {
        console.error('Public sales list error:', error);
        res.status(500).json({ error: 'Error al obtener historial de ventas' });
    }
});
router.get('/', async (req, res) => {
    try {
        const {
            date, startDate, endDate, documentType, paymentMethod,
            status, minAmount, maxAmount, customerId, userId, registerId, page = 1, limit = 50
        } = req.query;

        const whereClause = {};
        const userRole = (req.user.role || '').toLowerCase();
        const isUserAdmin = ['admin', 'superadmin', 'owner', 'supervisor'].includes(userRole);

        // IDOR FIX: Always enforce companyId with fallback for company '2' / 'default'
        const compId = req.user.companyId || '2';
        whereClause.companyId = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;
        
        if (!isUserAdmin) {
            // Regla de integridad y auditoría: Los cajeros y vendedores SOLO ven sus propias ventas
            whereClause.userId = req.user.id;
            if (registerId) {
                whereClause.registerId = registerId;
            }
        } else {
            // Los administradores tienen acceso global y pueden filtrar por cajero o por caja
            if (userId) {
                whereClause.userId = userId;
            }
            if (registerId) {
                whereClause.registerId = registerId;
            }
        }

        // Timezone-aware date range parsing (UTC vs Hora Local Negocio)
        const parseDateBoundary = (dateStr, isEnd, tzOffsetQuery) => {
            if (!dateStr) return null;
            const offsetMinutes = tzOffsetQuery !== undefined ? parseInt(tzOffsetQuery) : 240; // Default Venezuela UTC-4
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const d = new Date(isEnd ? `${dateStr}T23:59:59.999Z` : `${dateStr}T00:00:00.000Z`);
                d.setMinutes(d.getMinutes() + offsetMinutes);
                return d.toISOString();
            }
            if (isEnd && !dateStr.includes('T')) return dateStr + 'T23:59:59.999Z';
            return dateStr;
        };

        const filterDate = date || null;
        const effStartDate = startDate || filterDate;
        const effEndDate = endDate || filterDate;

        if (effStartDate && effEndDate) {
            const startIso = parseDateBoundary(effStartDate, false, req.query.timezoneOffset);
            const endIso = parseDateBoundary(effEndDate, true, req.query.timezoneOffset);
            whereClause.date = { [Op.between]: [startIso, endIso] };
        } else if (effStartDate) {
            whereClause.date = { [Op.gte]: parseDateBoundary(effStartDate, false, req.query.timezoneOffset) };
        } else if (effEndDate) {
            whereClause.date = { [Op.lte]: parseDateBoundary(effEndDate, true, req.query.timezoneOffset) };
        }

        if (documentType) whereClause.documentType = documentType;
        if (paymentMethod) whereClause.paymentMethod = paymentMethod;
        if (status) whereClause.status = status;
        if (customerId) whereClause.customerId = customerId;

        if (minAmount || maxAmount) {
            whereClause.total = {};
            if (minAmount) whereClause.total[Op.gte] = parseFloat(minAmount);
            if (maxAmount) whereClause.total[Op.lte] = parseFloat(maxAmount);
        }

        let count = 0;
        let rows = [];

        try {
            const result = await Sale.findAndCountAll({
                where: whereClause,
                limit: parseInt(limit),
                offset: (parseInt(page) - 1) * parseInt(limit),
                order: [['date', 'DESC']]
            });
            count = result.count;
            rows = result.rows;
        } catch (queryErr) {
            console.warn('[GET /sales] Primary findAndCountAll failed:', queryErr.message);

            // Fallback: If missing columns in Postgres or SQLite, query only guaranteed core columns
            if (queryErr.message.includes('column') || queryErr.message.includes('does not exist') || queryErr.message.includes('no such column')) {
                console.log('[GET /sales] Attempting resilient fallback with core columns...');
                const coreAttrs = [
                    'id', 'date', 'total', 'paymentMethod', 'paymentMethods', 'customerId',
                    'customerName', 'userId', 'companyId', 'status', 'documentType',
                    'exchangeRate', 'taxInfo', 'notes', 'createdAt'
                ];
                try {
                    const fallbackResult = await Sale.findAndCountAll({
                        attributes: coreAttrs,
                        where: whereClause,
                        limit: parseInt(limit),
                        offset: (parseInt(page) - 1) * parseInt(limit),
                        order: [['date', 'DESC']]
                    });
                    count = fallbackResult.count;
                    rows = fallbackResult.rows;
                } catch (fallbackErr) {
                    console.error('[GET /sales] Core attributes fallback also failed:', fallbackErr.message);
                    throw fallbackErr;
                }
            } else {
                throw queryErr;
            }
        }

        const sanitizedRows = rows.map(r => {
            const sale = (typeof r.toJSON === 'function') ? r.toJSON() : { ...r };
            let numTotal = parseFloat(sale.total);
            if (isNaN(numTotal) || numTotal <= 0) {
                const sub = parseFloat(sale.subtotal);
                if (!isNaN(sub) && sub > 0) {
                    numTotal = sub;
                } else {
                    let pms = sale.paymentMethods;
                    if (typeof pms === 'string') {
                        try { pms = JSON.parse(pms); } catch (_) {}
                    }
                    if (Array.isArray(pms)) {
                        const pmSum = pms.reduce((acc, p) => acc + (parseFloat(p?.amount) || 0), 0);
                        if (pmSum > 0) numTotal = pmSum;
                    }
                }
            }
            sale.total = !isNaN(numTotal) && numTotal > 0 ? numTotal : 0;
            return sale;
        });

        res.json({
            data: sanitizedRows,
            pagination: {
                totalItems: count,
                totalPages: Math.ceil(count / limit) || 1,
                currentPage: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: 'Error al obtener ventas: ' + error.message });
    }
});

/**
 * GET /daily-count - Obtiene el conteo de ventas del día actual y el próximo número de ticket diario por Caja
 */
router.get('/daily-count', async (req, res) => {
    try {
        const compId = req.user?.companyId || '2';
        const companyWhere = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;

        const { CashShift } = require('../database/models');
        const userId = String(req.user?.id || '');

        let effRegisterName = String(req.query.registerName || '').trim();
        let effRegisterId = String(req.query.registerId || req.headers['x-station-id'] || '').trim();

        // Si tenemos un registerId físico de estación, consultar turno abierto de esa estación si falta nombre
        if (!effRegisterName && effRegisterId && effRegisterId !== '1' && effRegisterId !== 'default') {
            const openShift = await CashShift.findOne({
                where: { registerId: effRegisterId, status: 'open' },
                order: [['openedAt', 'DESC']]
            }).catch(() => null);
            if (openShift && openShift.registerName) {
                effRegisterName = openShift.registerName;
            }
        }

        // Prioridad estricta por estación física (registerId) para garantizar que cada caja
        // (ej. Caja Principal vs Charcutería / Caja 2) tenga su correlativo de tickets 100% individual
        let registerFilter = {};
        if (effRegisterId && effRegisterId !== '1' && effRegisterId !== 'default') {
            registerFilter = { registerId: effRegisterId };
        } else if (effRegisterName) {
            registerFilter = { registerName: effRegisterName };
        } else if (userId) {
            registerFilter = { userId };
        }

        const now = new Date();
        const startOfDayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
        const endOfDayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
        const localDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const todayCount = await Sale.count({
            where: {
                companyId: companyWhere,
                ...registerFilter,
                date: { [Op.between]: [startOfDayIso, endOfDayIso] }
            }
        });

        res.json({
            success: true,
            date: localDateKey,
            registerName: effRegisterName || 'Caja Principal',
            registerId: effRegisterId || '1',
            count: todayCount,
            nextTicketNumber: todayCount + 1
        });
    } catch (error) {
        console.error('Error in GET /sales/daily-count:', error);
        res.status(500).json({ error: 'Error al consultar conteo diario de tickets' });
    }
});

/**
 * GET /registers - List all active and registered cash registers/terminals (Owner/Manager/Admin only)
 */
router.get('/registers', async (req, res) => {
    try {
        const userRole = String(req.user?.role || '').toLowerCase();
        const isAuthorized = ['admin', 'superadmin', 'owner', 'dueño', 'dueno', 'gerente', 'manager', 'administrador', 'supervisor'].includes(userRole);
        
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Acceso denegado: solo dueños, gerentes o administradores pueden consultar terminales' });
        }

        const compId = req.user.companyId || '2';
        const companyWhere = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;

        const { CashShift } = require('../database/models');
        const LANClusterService = require('../services/LANClusterService');

        // 1. Cajas con turnos actualmente abiertos
        let openShifts = [];
        try {
            openShifts = await CashShift.findAll({
                where: {
                    status: 'open',
                    companyId: companyWhere
                },
                attributes: ['registerId', 'registerName', 'userName', 'openedAt'],
                raw: true
            });
        } catch (e) {
            console.warn('[GET /sales/registers] Error al consultar CashShift:', e.message);
        }

        // 2. Cajas históricas registradas en ventas
        let historicalRegisters = [];
        try {
            historicalRegisters = await Sale.findAll({
                where: { companyId: companyWhere },
                attributes: ['registerId', 'registerName'],
                group: ['registerId', 'registerName'],
                raw: true
            });
        } catch (e) {
            console.warn('[GET /sales/registers] Error al consultar Sale registers:', e.message);
        }

        // 3. Nodos LAN P2P descubiertos
        let lanPeers = [];
        try {
            const topology = LANClusterService.getClusterTopology();
            lanPeers = topology.peers || [];
        } catch (e) {}

        const registerMap = new Map();

        // Caja principal base
        registerMap.set('1', {
            id: '1',
            name: 'Caja 1 (Principal)',
            isActive: false,
            activeUser: null
        });

        // Integrar cajas históricas
        historicalRegisters.forEach(r => {
            if (r.registerId) {
                const regId = String(r.registerId);
                if (!registerMap.has(regId)) {
                    registerMap.set(regId, {
                        id: regId,
                        name: r.registerName || `Caja ${regId}`,
                        isActive: false,
                        activeUser: null
                    });
                }
            }
        });

        // Integrar terminales LAN descubiertas
        lanPeers.forEach(p => {
            const regId = String(p.nodeId || p.ip);
            if (!registerMap.has(regId)) {
                registerMap.set(regId, {
                    id: regId,
                    name: p.nodeName || `Caja LAN (${p.ip})`,
                    isActive: true,
                    ip: p.ip,
                    activeUser: null
                });
            }
        });

        // Marcar cajas activas según turnos abiertos
        openShifts.forEach(s => {
            const regId = String(s.registerId || '1');
            const current = registerMap.get(regId) || {
                id: regId,
                name: s.registerName || `Caja ${regId}`,
                isActive: true
            };
            current.isActive = true;
            current.activeUser = s.userName;
            current.openedAt = s.openedAt;
            registerMap.set(regId, current);
        });

        const sortedRegisters = Array.from(registerMap.values()).sort((a, b) => {
            if (a.isActive && !b.isActive) return -1;
            if (!a.isActive && b.isActive) return 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

        res.json({
            success: true,
            registers: sortedRegisters
        });
    } catch (error) {
        console.error('Error in GET /sales/registers:', error);
        res.status(500).json({ error: 'Error al consultar cajas registradas' });
    }
});

/**
 * GET /register-draft/:registerId - Recupera el borrador activo en caliente de la caja (Resiliencia ante Apagones)
 */
router.get('/register-draft/:registerId', async (req, res) => {
    try {
        const { registerId } = req.params;
        const compId = String(req.user?.companyId || '2');
        const companyCondition = (compId === '2' || compId === 'default') ? ['2', 'default', '1'] : [compId];

        const draft = await RegisterDraft.findOne({
            where: {
                registerId,
                companyId: { [Op.in]: companyCondition },
                type: 'auto_draft',
                status: 'active'
            },
            order: [['updatedAt', 'DESC']]
        });

        if (!draft) {
            return res.json({ success: true, draft: null });
        }

        // Si el borrador fue guardado hace más de 24 horas, descartarlo
        const ageHours = (Date.now() - new Date(draft.updatedAt).getTime()) / (1000 * 3600);
        if (ageHours > 24) {
            await draft.update({ status: 'discarded' });
            return res.json({ success: true, draft: null });
        }

        return res.json({ success: true, draft });
    } catch (error) {
        console.error('Error obteniendo borrador de caja:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /register-draft/:registerId - Guarda o actualiza atómicamente el borrador en caliente en PostgreSQL
 */
router.put('/register-draft/:registerId', async (req, res) => {
    try {
        const { registerId } = req.params;
        const compId = String(req.user?.companyId || '2');
        const { items, customer, totals, notes, totalUSD, totalVES } = req.body;

        // Si el carrito está vacío, limpiar el borrador activo de esa caja
        if (!Array.isArray(items) || items.length === 0) {
            await RegisterDraft.destroy({
                where: {
                    registerId,
                    type: 'auto_draft'
                }
            });
            return res.json({ success: true, cleared: true });
        }

        const draftId = `draft_${compId}_${registerId}`;
        const [draft] = await RegisterDraft.upsert({
            id: draftId,
            registerId,
            companyId: compId,
            userId: req.user?.id || null,
            userName: req.user?.name || req.user?.username || 'Cajero',
            type: 'auto_draft',
            customer: customer || null,
            items,
            totals: totals || null,
            notes: notes || null,
            itemCount: items.length,
            totalUSD: parseFloat(totalUSD || 0),
            totalVES: parseFloat(totalVES || 0),
            status: 'active',
            updatedAt: new Date()
        });

        return res.json({ success: true, draftId: draft.id });
    } catch (error) {
        console.error('Error guardando borrador en caliente:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /register-draft/:registerId - Elimina el borrador tras finalizar la venta o reiniciar el carrito
 */
router.delete('/register-draft/:registerId', async (req, res) => {
    try {
        const { registerId } = req.params;
        await RegisterDraft.destroy({
            where: {
                registerId,
                type: 'auto_draft'
            }
        });
        return res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando borrador de caja:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /remote-held-sales - Lista preventas/comandas móviles y borradores persistidos en PostgreSQL
 */
router.get('/remote-held-sales', async (req, res) => {
    try {
        const compId = String(req.user?.companyId || '2');
        const companyCondition = (compId === '2' || compId === 'default') ? ['2', 'default', '1'] : [compId];

        let dbDrafts = [];
        try {
            dbDrafts = await RegisterDraft.findAll({
                where: {
                    companyId: { [Op.in]: companyCondition },
                    type: { [Op.in]: ['presale', 'manual_held', 'auto_draft'] },
                    status: 'active'
                },
                order: [['updatedAt', 'DESC']],
                limit: 50
            });
        } catch (dbErr) {
            console.warn('[Sales] Aviso consultando RegisterDrafts en PostgreSQL:', dbErr.message);
        }

        const active = dbDrafts.map(d => ({
            id: d.id,
            code: d.code || d.id.slice(-6).toUpperCase(),
            registerId: d.registerId,
            userName: d.userName,
            customer: d.customer,
            items: d.items,
            totals: d.totals,
            notes: d.notes,
            itemCount: d.itemCount,
            total: parseFloat(d.totalUSD || 0),
            totalUSD: parseFloat(d.totalUSD || 0),
            totalVES: parseFloat(d.totalVES || 0),
            type: d.type,
            timestamp: new Date(d.updatedAt).getTime(),
            createdAt: d.createdAt
        }));

        return res.json({ success: true, sales: active });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /remote-held-sale/:codeOrId - Reclama o elimina una preventa móvil o borrador
 */
router.delete('/remote-held-sale/:codeOrId', async (req, res) => {
    try {
        const target = String(req.params.codeOrId || '').trim();
        let targetId = target;

        // Actualizar en PostgreSQL de forma persistente
        try {
            await RegisterDraft.update({ status: 'claimed' }, {
                where: {
                    [Op.or]: [
                        { id: target },
                        { code: target.toUpperCase() }
                    ]
                }
            });
        } catch (_) {}

        // Mantener consistencia en caché de memoria y avisar por Sockets
        const reg = global.__remoteHeldSalesRegistry || (global.__remoteHeldSalesRegistry = { items: new Map(), recentBroadcasts: new Map() });
        let removed = null;
        for (const [k, v] of reg.items.entries()) {
            if (String(k).toUpperCase() === target.toUpperCase() || String(v.id || '').toUpperCase() === target.toUpperCase() || String(v.code || '').toUpperCase() === target.toUpperCase()) {
                removed = v;
                reg.items.delete(k);
            }
        }

        const io = req.app.get('io') || global.io;
        if (io) {
            io.emit('remote_held_sale_claimed', {
                id: removed?.id || target,
                code: removed?.code || target,
                claimedBy: req.user?.name || req.user?.username || 'Caja PC'
            });
        }

        return res.json({ success: true, removed: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /:id - Get sale details
 */
router.get('/:id', async (req, res) => {
    try {
        const userRole = (req.user.role || '').toLowerCase();
        const isUserAdmin = ['admin', 'superadmin', 'owner', 'supervisor'].includes(userRole);
        const sale = await SaleService.getSaleDetails(req.user.companyId, req.params.id, req.user.role, isUserAdmin ? null : req.user.id);
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
        res.json(sale);
    } catch (error) {
        console.error('Get sale by ID error:', error);
        res.status(500).json({ error: 'Error al obtener la venta' });
    }
});

/**
 * GET /:id/items - Obtiene los items de una venta especifica
 */
router.get('/:id/items', async (req, res) => {
    try {
        const userRole = (req.user.role || '').toLowerCase();
        const isUserAdmin = ['admin', 'superadmin', 'owner', 'supervisor'].includes(userRole);

        if (!isUserAdmin) {
            const parentSale = await Sale.findOne({
                where: { id: req.params.id, companyId: req.user.companyId, userId: req.user.id }
            });
            if (!parentSale) {
                return res.status(404).json({ error: 'Venta no encontrada o no autorizada' });
            }
        }

        const compId = req.user.companyId || '2';
        const companyCondition = (compId === '2' || compId === 'default')
            ? { [Op.or]: ['2', 'default', null] }
            : compId;

        const whereClause = {
            saleId: req.params.id,
            companyId: companyCondition
        };
        const items = await SaleItem.findAll({ where: whereClause });
        res.json(items);
    } catch (error) {
        console.error('Get sale items error:', error);
        res.status(500).json({ error: 'Error al obtener items de la venta' });
    }
});

/**
 * POST /:id/email - Enviar factura por correo electrónico
 */
router.post('/:id/email', async (req, res) => {
    try {
        const { recipientEmail, recipientName } = req.body;
        
        // Validate email format
        if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
            return res.status(400).json({ error: 'Email del destinatario inválido' });
        }

        // Load sale with items
        let sale = null;
        if (req.user?.companyId) {
            sale = await Sale.findOne({
                where: { id: req.params.id, companyId: req.user.companyId },
                include: [{ model: SaleItem, as: 'SaleItems' }]
            });
        }
        if (!sale) {
            sale = await Sale.findOne({
                where: { id: req.params.id },
                include: [{ model: SaleItem, as: 'SaleItems' }]
            });
        }
        if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });

        // Load business settings
        const { readJson, getUserSettings } = require('../utils/helpers');
        const { SETTINGS_FILE } = require('../config/paths');
        const settings = getUserSettings(readJson(SETTINGS_FILE), req.user.companyId);
        const businessInfo = settings.businessInfo || {};

        // Send email
        const InvoiceEmailService = require('../services/InvoiceEmailService');
        await InvoiceEmailService.sendInvoiceEmail(
            sale.toJSON(),
            sale.SaleItems.map(i => i.toJSON()),
            businessInfo,
            recipientEmail,
            recipientName
        );

        res.json({ success: true, message: 'Factura enviada exitosamente' });
    } catch (error) {
        console.error('Email invoice error:', error);
        res.status(500).json({ error: 'Error al enviar la factura: ' + error.message });
    }
});

/**
 * POST / - Register a new sale
 */
router.post('/', validate(saleSchema), async (req, res) => {
    try {
        const sale = await SaleService.processSale(req.user, req.body);
        let safeSale;
        try {
            safeSale = sale.get ? sale.get({ plain: true }) : sale;
        } catch (e) {
            safeSale = sale;
        }

        // Emit Real-Time Events
        const io = req.app.get('io') || global.io;
        if (io) {
            io.to(req.user.companyId).emit('sale_completed', sale);
            io.to(req.user.companyId).emit('inventory_changed');
            io.to(req.user.companyId).emit('cash_register_activity', {
                type: 'sale',
                registerId: sale.registerId || req.body?.registerId || '1',
                registerName: sale.registerName || `Caja ${sale.registerId || req.body?.registerId || '1'}`,
                userId: req.user.id,
                userName: req.user.name || req.user.username,
                customerName: sale.customerName || req.body?.customerName || 'Cliente',
                amount: Number(sale.total) || 0,
                paymentMethod: sale.paymentMethod || 'Efectivo',
                timestamp: sale.date || new Date().toISOString(),
                saleId: sale.id
            });
        }

        // 🖨️ Réplica Multicaja (LAN P2P) e Impresora de Red (3ra Impresora Ethernet/Wi-Fi)
        setImmediate(async () => {
            try {
                const { SETTINGS_FILE } = require('../config/paths');
                const { readJson, getUserSettings } = require('../utils/helpers');
                const allSettings = readJson(SETTINGS_FILE);
                const userSettings = getUserSettings(allSettings, req.user.companyId);
                const bizInfo = userSettings?.businessInfo || {};

                // 1. Broadcast en Tiempo Real para Réplica Simultánea en Laptops (SOLO si está explícitamente habilitado)
                if (io && bizInfo.broadcastPrintingEnabled === true) {
                    const broadcastPayload = {
                        sale: safeSale,
                        originStationId: req.headers['x-station-id'] || req.body?.originStationId || req.body?.stationId || req.body?.registerId || req.user?.id,
                        companyId: req.user?.companyId
                    };
                    io.emit('lan_print_sale', broadcastPayload);
                }

                // 2. Impresión Automática en Impresora de Red (SOLO si está explícitamente habilitada)
                if (bizInfo.networkPrinterEnabled === true) {
                    const NetworkPrinterService = require('../services/NetworkPrinterService');
                    // Soporte para múltiples impresoras de red (Array, comas o IP única)
                    let targetPrinters = [];
                    if (Array.isArray(bizInfo.networkPrinters) && bizInfo.networkPrinters.length > 0) {
                        targetPrinters = bizInfo.networkPrinters;
                    } else if (bizInfo.networkPrinterIp) {
                        const ips = String(bizInfo.networkPrinterIp).split(',').map(s => s.trim()).filter(Boolean);
                        const defaultPort = parseInt(bizInfo.networkPrinterPort, 10) || 9100;
                        targetPrinters = ips.map(ip => {
                            if (ip.includes(':')) {
                                const parts = ip.split(':');
                                return {
                                    host: parts[0].trim(),
                                    port: parseInt(parts[1].trim(), 10) || defaultPort,
                                    role: bizInfo.networkPrinterRole || 'MIRROR'
                                };
                            }
                            return {
                                host: ip,
                                port: defaultPort,
                                role: bizInfo.networkPrinterRole || 'MIRROR'
                            };
                        });
                    }

                    for (const netPr of targetPrinters) {
                        const host = netPr.host || netPr.ip;
                        const port = parseInt(netPr.port, 10) || 9100;
                        if (!host) continue;

                        const customBiz = { ...bizInfo, networkPrinterRole: netPr.role || bizInfo.networkPrinterRole || 'MIRROR' };
                        NetworkPrinterService.printSale(host, port, safeSale, customBiz).then(printRes => {
                            if (!printRes.success) {
                                console.warn(`[NetworkPrinter] No se pudo imprimir en ${host}:${port}: ${printRes.error}`);
                            } else {
                                console.log(`[NetworkPrinter] Ticket de venta #${safeSale.invoiceNumber || safeSale.id} enviado exitosamente a red (${host}:${port})`);
                            }
                        }).catch(e => {
                            console.warn(`[NetworkPrinter] Error enviando a ${host}:${port}:`, e.message);
                        });
                    }
                }
            } catch (netErr) {
                console.warn('[NetworkPrinter] Error en impresión de red:', netErr.message);
            }
        });

        res.status(201).json(safeSale);
    } catch (error) {
        console.error('Create sale error:', error);
        try {
            const logDir = process.env.USER_DATA_PATH || require('path').join(__dirname, '..', 'logs');
            if (!require('fs').existsSync(logDir)) require('fs').mkdirSync(logDir, { recursive: true });
            require('fs').appendFileSync(require('path').join(logDir, 'zod_error_sales.txt'), `\n[${new Date().toISOString()}] SALE ERROR: ${error.message}\n${error.stack}\n`);
        } catch (e) { }
        const lowerMsg = error.message.toLowerCase();
        const isBusinessError = lowerMsg.includes('crédito') || 
                                lowerMsg.includes('cliente') || 
                                lowerMsg.includes('stock') || 
                                error.message.includes('INTEGRITY_ERROR') || 
                                error.message.includes('AUTH_REQUIRED');
        res.status(isBusinessError ? 400 : 500).json({ error: error.message, message: error.message });
    }
});

/**
 * GET /reports/controlled-meds - Official Controlled Medications Report (Libro Psicotrópicos)
 */
router.get('/reports/controlled-meds', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const items = await SaleItem.findAll({
            where: {
                companyId,
                [Op.or]: [
                    { es_controlado: true },
                    { recipe: { [Op.ne]: null } }
                ]
            },
            include: [
                { 
                    model: Sale, 
                    where: { companyId },
                    attributes: ['date', 'id', 'customerName', 'userId', 'registerName', 'status'],
                    required: false
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: 500
        });

        const report = items.map(item => {
            let recipeData = {};
            if (typeof item.recipe === 'string') {
                try { recipeData = JSON.parse(item.recipe); } catch(e) {}
            } else if (item.recipe) {
                recipeData = item.recipe;
            }

            return {
                id: item.id,
                date: item.Sale?.date || item.createdAt,
                saleId: item.saleId,
                productName: item.name,
                quantity: item.quantity,
                batchNumber: item.batchNumber || 'N/A',
                expirationDate: item.expirationDate || 'N/A',
                status: item.Sale?.status || 'completed',
                patientName: recipeData.patientName || item.Sale?.customerName || 'Consumidor Final',
                patientId: recipeData.patientId || 'S/D',
                doctorName: recipeData.doctorName || 'Médico S/D',
                doctorLicense: recipeData.doctorLicense || 'MPPS S/D',
                recipeNumber: recipeData.recipeNumber || 'S/N',
                dispensedBy: item.Sale?.registerName || item.Sale?.userId || 'Cajero'
            };
        });

        res.json(report);
    } catch (error) {
        console.error('Error fetching controlled meds report:', error);
        res.status(500).json({ error: 'Error al obtener el libro de controlados: ' + error.message });
    }
});

/**
 * POST /remote-held-sale - Recibe una preventa o comanda móvil (Canal de respaldo HTTP REST + Socket)
 */
router.post('/remote-held-sale', async (req, res) => {
    try {
        const payload = req.body;
        if (!payload || !payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
            return res.status(400).json({ success: false, error: 'El carrito de preventa está vacío o es inválido' });
        }

        const reg = global.__remoteHeldSalesRegistry || (global.__remoteHeldSalesRegistry = { items: new Map(), recentBroadcasts: new Map() });
        const now = Date.now();
        const saleId = String(payload.id || payload.code || `presale_${now}`);
        const enriched = {
            ...payload,
            id: saleId,
            companyId: String(payload.companyId || req.user?.companyId || '2'),
            timestamp: payload.timestamp || now
        };
        reg.items.set(saleId, enriched);

        // Persistir en PostgreSQL para que sobreviva a apagones o reinicios del servidor
        try {
            await RegisterDraft.upsert({
                id: saleId,
                registerId: payload.registerId || 'mobile_order',
                companyId: enriched.companyId,
                userId: req.user?.id || payload.userId || null,
                userName: payload.waiterName || payload.userName || req.user?.name || 'Comanda Móvil',
                code: payload.code || saleId.slice(-6).toUpperCase(),
                type: 'presale',
                customer: payload.customer || null,
                items: payload.items,
                totals: payload.totals || null,
                notes: payload.notes || (payload.table ? `Mesa: ${payload.table}` : null),
                itemCount: payload.items.length,
                totalUSD: parseFloat(payload.totalUSD || payload.total || 0),
                totalVES: parseFloat(payload.totalVES || 0),
                status: 'active',
                updatedAt: new Date()
            });
        } catch (dbErr) {
            console.warn('[Presale] Aviso guardando comanda en PostgreSQL:', dbErr.message);
        }

        for (const [k, v] of reg.items.entries()) {
            if (now - (v.timestamp || 0) > 12 * 3600 * 1000) reg.items.delete(k);
        }
        while (reg.items.size > 100) {
            const oldestKey = reg.items.keys().next().value;
            reg.items.delete(oldestKey);
        }

        const io = req.app.get('io') || global.io;
        let broadcasted = false;
        if (io) {
            const lastSent = reg.recentBroadcasts.get(saleId) || 0;
            if (now - lastSent > 6000) {
                reg.recentBroadcasts.set(saleId, now);
                io.emit('remote_held_sale', enriched);
                broadcasted = true;
            }
        }

        return res.json({
            success: true,
            broadcasted,
            message: 'Preventa despachada y notificada a Caja Principal con éxito',
            code: enriched.code || enriched.id,
            timestamp: enriched.timestamp
        });
    } catch (error) {
        console.error('Error procesando preventa remota móvil:', error);
        return res.status(500).json({ success: false, error: 'Error al registrar preventa remota: ' + error.message });
    }
});

module.exports = router;
