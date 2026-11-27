const crypto = require('crypto');
const { verifyJwtResilient, safeSecretEqual, verifyDisplayPairingToken, verifySocketJwtUser } = require('../middleware/auth');
const { isSupervisorOrAboveRole, isCompanyAdminRole } = require('../constants/roles');
const LANClusterService = require('./LANClusterService');

/**
 * Crea un concentrador Socket.IO virtual que replica emisiones a todas las instancias/puertos activos.
 * @param {Array} ioInstances Lista mutable de instancias Socket.IO activas.
 */
function createVirtualIoHub(ioInstances) {
    return {
        to: (room) => ({
            emit: (event, ...args) => {
                ioInstances.forEach((instance) => {
                    instance.to(room).emit(event, ...args);
                });
            }
        }),
        in: (room) => ({
            emit: (event, ...args) => {
                ioInstances.forEach((instance) => {
                    instance.in(room).emit(event, ...args);
                });
            }
        }),
        emit: (event, ...args) => {
            ioInstances.forEach((instance) => {
                instance.emit(event, ...args);
            });
        },
        disconnectUser: (userId, reason = 'Sesión revocada por administrador') => {
            if (!userId) return;
            const targetRoom = `user:${String(userId)}`;
            ioInstances.forEach((instance) => {
                try {
                    instance.to(targetRoom).emit('force_logout', { userId: String(userId), reason, timestamp: Date.now() });
                    instance.to(targetRoom).emit('session_revoked', { userId: String(userId), reason, timestamp: Date.now() });
                    if (typeof instance.in === 'function') {
                        const roomOps = instance.in(targetRoom);
                        if (roomOps && typeof roomOps.disconnectSockets === 'function') {
                            roomOps.disconnectSockets(true);
                        }
                    }
                } catch (_) {}
            });
        }
    };
}

function disconnectUserSockets(io, userId, reason = 'Sesión revocada por administrador') {
    if (!io || !userId) return;
    if (typeof io.disconnectUser === 'function') {
        io.disconnectUser(userId, reason);
        return;
    }
    const targetRoom = `user:${String(userId)}`;
    try {
        io.to(targetRoom).emit('force_logout', { userId: String(userId), reason, timestamp: Date.now() });
        io.to(targetRoom).emit('session_revoked', { userId: String(userId), reason, timestamp: Date.now() });
        if (typeof io.in === 'function') {
            const roomOps = io.in(targetRoom);
            if (roomOps && typeof roomOps.disconnectSockets === 'function') {
                roomOps.disconnectSockets(true);
            }
        }
    } catch (_) {}
}

function parseCookieToken(rawCookieHeader) {
    const rawCookie = String(rawCookieHeader || '');
    if (!rawCookie) return null;
    for (const part of rawCookie.split(';')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx > 0 && part.slice(0, eqIdx).trim() === 'authToken') {
            return decodeURIComponent(part.slice(eqIdx + 1).trim());
        }
    }
    return null;
}

/**
 * Registra middleware de autenticación multi-tenant y listeners Socket.IO en una instancia.
 * @param {import('socket.io').Server} io Instancia Socket.IO a configurar.
 * @param {{ logger?: Console }} [options] Opciones de logging.
 */
function setupSocketEvents(io, { logger = console } = {}) {
    io.use(async (socket, next) => {
        try {
            const cookieToken = parseCookieToken(socket.handshake.headers?.cookie);
            const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace(/^Bearer\s+/, '') ||
                cookieToken;

            if (token) {
                const decoded = verifyJwtResilient(token);
                const sockUserCheck = await verifySocketJwtUser(decoded);
                if (!sockUserCheck.ok) {
                    return next(new Error(sockUserCheck.error || 'Unauthorized socket session'));
                }
                socket.user = {
                    ...decoded,
                    role: sockUserCheck.role,
                    companyId: sockUserCheck.companyId
                };
                socket.companyId = sockUserCheck.companyId;
                socket.authMode = 'jwt';
                return next();
            }

            const syncKey = String(
                socket.handshake.auth?.syncKey ||
                socket.handshake.headers?.['x-sync-key'] ||
                ''
            );
            const expectedSyncKey = String(process.env.SYNC_SECRET_KEY || '');
            if (syncKey && expectedSyncKey && safeSecretEqual(syncKey, expectedSyncKey)) {
                socket.isSyncNode = true;
                socket.companyId = String(process.env.DEFAULT_COMPANY_ID || '2');
                socket.authMode = 'sync_key';
                return next();
            }

            if (socket.handshake.auth?.mode === 'customer_display') {
                const targetComp = String(socket.handshake.auth?.companyId || '2');
                const targetReg = String(socket.handshake.auth?.registerId || '1');
                const displayToken = String(socket.handshake.auth?.displayToken || '');
                if (displayToken && verifyDisplayPairingToken(displayToken, targetComp, targetReg)) {
                    socket.isCustomerDisplayOnly = true;
                    socket.companyId = targetComp;
                    socket.registerId = targetReg;
                    socket.authMode = 'customer_display';
                    return next();
                }
            }
        } catch (sockErr) {
            logger.warn('[SOCKET AUTH] Error verificando handshake:', sockErr.message);
        }

        return next(new Error('Unauthorized socket connection'));
    });

    io.on('connection', (socket) => {
        let userCompanyId = String(socket.companyId || 'default');
        const isAuthenticatedClient = Boolean(socket.user || socket.isSyncNode);

        if (isAuthenticatedClient) {
            socket.join(userCompanyId);
            if (socket.user?.id) {
                socket.join(`user:${String(socket.user.id)}`);
            }
        }

        socket.on('join_company', (requestedCompanyId) => {
            if (!isAuthenticatedClient) return;
            const role = String(socket.user?.role || '').toLowerCase();
            const canSwitchCompany = role === 'superadmin';
            if (socket.user?.companyId && !canSwitchCompany) {
                userCompanyId = String(socket.user.companyId);
            } else if (requestedCompanyId && canSwitchCompany) {
                userCompanyId = String(requestedCompanyId);
            }
            socket.companyId = userCompanyId;
            socket.join(userCompanyId);
        });

        const socketHasPermission = (permKeys = []) => {
            if (!socket.user) return false;
            if (isCompanyAdminRole(socket.user.role) || isSupervisorOrAboveRole(socket.user.role)) return true;
            const perms = socket.user.permissions || {};
            return permKeys.some((k) => perms[k] === true);
        };

        const safeEmitCompany = (eventName, payload) => {
            try {
                socket.to(userCompanyId).emit(eventName, payload);
            } catch (err) {
                logger.warn(`[SOCKET] Error emitiendo ${eventName}:`, err.message);
            }
        };

        socket.on('internal_chat_typing', (data) => {
            if (!isAuthenticatedClient || !socket.user) return;
            safeEmitCompany('internal_chat_typing', {
                ...(data && typeof data === 'object' ? data : {}),
                userId: socket.user.id,
                username: socket.user.username || socket.user.email || data?.username,
                companyId: userCompanyId
            });
        });

        socket.on('internal_chat_stop_typing', (data) => {
            if (!isAuthenticatedClient || !socket.user) return;
            safeEmitCompany('internal_chat_stop_typing', {
                ...(data && typeof data === 'object' ? data : {}),
                userId: socket.user.id,
                companyId: userCompanyId
            });
        });

        socket.on('lan_announce', (peerData) => {
            if (!isAuthenticatedClient) return;
            try {
                if (!peerData || typeof peerData !== 'object' || !peerData.nodeId) return;
                const ts = Number(peerData.timestamp || 0);
                const hasValidSig = typeof peerData.sig === 'string' &&
                    Number.isFinite(ts) &&
                    Math.abs(Date.now() - ts) <= 5 * 60 * 1000 &&
                    (() => {
                        const expected = LANClusterService.computePacketSignature({
                            type: peerData.type || 'LAN_HEARTBEAT',
                            nodeId: peerData.nodeId,
                            ip: peerData.ip,
                            httpPort: peerData.httpPort,
                            role: peerData.role,
                            timestamp: peerData.timestamp
                        });
                        const a = Buffer.from(peerData.sig, 'utf8');
                        const b = Buffer.from(expected, 'utf8');
                        return a.length === b.length && crypto.timingSafeEqual(a, b);
                    })();

                if (!hasValidSig && !(socket.user && isCompanyAdminRole(socket.user.role))) {
                    logger.warn(`[SOCKET SECURITY] lan_announce rechazado sin firma HMAC ni privilegios admin (nodeId=${String(peerData.nodeId).slice(0, 64)})`);
                    return;
                }

                const safePort = parseInt(peerData.httpPort, 10);
                LANClusterService.peers.set(`${String(peerData.nodeId).slice(0, 128)}`, {
                    nodeId: String(peerData.nodeId).slice(0, 128),
                    nodeName: String(peerData.nodeName || 'Nodo LAN').replace(/[<>"']/g, '').slice(0, 64),
                    ip: String(peerData.ip || socket.handshake.address || '').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45),
                    httpPort: Number.isInteger(safePort) && safePort > 0 && safePort <= 65535 ? safePort : 3005,
                    role: peerData.role === 'MASTER_CLOUD_HUB' ? 'MASTER_CLOUD_HUB' : 'LAN_SPOKE',
                    status: 'ONLINE',
                    companyId: userCompanyId,
                    lastSeen: Date.now()
                });
                LANClusterService.notifyTopologyChange();
            } catch (err) {
                logger.warn('[SOCKET] Error en lan_announce:', err.message);
            }
        });

        socket.on('lan_stock_update', (data) => {
            if (!isAuthenticatedClient || !socket.user) return;
            safeEmitCompany('lan_stock_update', data);
        });

        socket.on('lan_sale_sync', (payload) => {
            if (!isAuthenticatedClient || !socket.user) return;
            safeEmitCompany('lan_sale_sync', payload);
        });

        socket.on('product_updated', (payload) => {
            if (!isAuthenticatedClient || socket.isSyncNode) return;
            if (!socketHasPermission(['canManageInventory', 'canCreateProducts', 'canEditProducts'])) return;
            safeEmitCompany('product_updated', payload);
        });

        socket.on('inventory_changed', (payload) => {
            if (!isAuthenticatedClient) return;
            if (!socket.isSyncNode && !socketHasPermission(['canManageInventory', 'canAccessPOS'])) return;
            safeEmitCompany('inventory_changed', payload || { timestamp: Date.now() });
        });

        socket.on('customers_changed', (payload) => {
            if (!isAuthenticatedClient) return;
            if (!socket.isSyncNode && !socketHasPermission(['canManageCustomers', 'canAccessPOS'])) return;
            safeEmitCompany('customers_changed', payload || { timestamp: Date.now() });
        });

        socket.on('expenses_changed', (payload) => {
            if (!isAuthenticatedClient || socket.isSyncNode) return;
            if (!socketHasPermission(['canManageExpenses', 'canManageCashShift', 'canAccessPOS'])) return;
            safeEmitCompany('expenses_changed', payload || { timestamp: Date.now() });
        });

        socket.on('cash_updated', (payload) => {
            if (!isAuthenticatedClient || socket.isSyncNode) return;
            if (!socketHasPermission(['canManageCashShift', 'canAccessPOS'])) return;
            safeEmitCompany('cash_updated', payload || { timestamp: Date.now() });
        });

        socket.on('join_customer_display', (info) => {
            try {
                const targetCompany = isAuthenticatedClient
                    ? userCompanyId
                    : String(socket.companyId || '');
                if (!targetCompany) return;
                const regId = socket.isCustomerDisplayOnly
                    ? String(socket.registerId || '1')
                    : String(info?.registerId || socket.registerId || '1');
                socket.join(`customer_displays:${targetCompany}`);
                if (regId) socket.join(`display_register:${targetCompany}:${regId}`);
            } catch (err) {
                logger.warn('[SOCKET] Error en join_customer_display:', err.message);
            }
        });

        socket.on('request_customer_display_cart', (data) => {
            try {
                const targetCompany = isAuthenticatedClient
                    ? userCompanyId
                    : String(socket.companyId || '');
                if (!targetCompany) return;
                socket.to(targetCompany).emit('request_customer_display_cart', data);
            } catch (err) {
                logger.warn('[SOCKET] Error en request_customer_display_cart:', err.message);
            }
        });

        const forwardDisplayEvent = (eventName, payload, includeRegister = false) => {
            if (!isAuthenticatedClient) return;
            try {
                socket.to(userCompanyId).emit(eventName, payload);
                io.to(`customer_displays:${userCompanyId}`).emit(eventName, payload);
                if (includeRegister && payload?.registerId) {
                    socket.to(`display_register:${userCompanyId}:${payload.registerId}`).emit(eventName, payload);
                }
            } catch (err) {
                logger.warn(`[SOCKET] Error en ${eventName}:`, err.message);
            }
        };

        socket.on('customer_display_cart_update', (payload) => forwardDisplayEvent('customer_display_cart_update', payload, true));
        socket.on('customer_display_payment_update', (payload) => forwardDisplayEvent('customer_display_payment_update', payload, true));
        socket.on('customer_display_sale_completed', (payload) => forwardDisplayEvent('customer_display_sale_completed', payload, false));
        socket.on('customer_display_ads_updated', (payload) => forwardDisplayEvent('customer_display_ads_updated', payload, false));

        socket.on('remote_held_sale', (payload) => {
            if (!isAuthenticatedClient) return;
            try {
                if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return;
                const reg = global.__remoteHeldSalesRegistry || (global.__remoteHeldSalesRegistry = { items: new Map(), recentBroadcasts: new Map() });
                const now = Date.now();
                const saleId = String(payload.id || payload.code || `presale_${now}`);
                const enriched = {
                    ...payload,
                    id: saleId,
                    companyId: userCompanyId,
                    timestamp: payload.timestamp || now
                };
                reg.items.set(saleId, enriched);

                for (const [k, v] of reg.items.entries()) {
                    if (now - (v.timestamp || 0) > 12 * 3600 * 1000) reg.items.delete(k);
                }
                while (reg.items.size > 100) {
                    const oldestKey = reg.items.keys().next().value;
                    reg.items.delete(oldestKey);
                }

                const lastSent = reg.recentBroadcasts.get(saleId) || 0;
                if (now - lastSent > 6000) {
                    reg.recentBroadcasts.set(saleId, now);
                    io.to(userCompanyId).emit('remote_held_sale', enriched);
                }
            } catch (err) {
                logger.warn('[SOCKET] Error en remote_held_sale:', err.message);
            }
        });

        socket.on('remote_barcode_scan', (payload) => {
            if (!isAuthenticatedClient) return;
            try {
                const code = String(payload?.barcode || payload?.code || '').trim();
                if (!code) return;
                socket.to(userCompanyId).emit('remote_barcode_scan', {
                    barcode: code,
                    companyId: userCompanyId,
                    source: payload?.source || 'mobile_socket',
                    senderSocketId: socket.id,
                    timestamp: payload?.timestamp || Date.now()
                });
            } catch (err) {
                logger.warn('[SOCKET] Error en remote_barcode_scan:', err.message);
            }
        });
    });
}

module.exports = {
    createVirtualIoHub,
    setupSocketEvents,
    disconnectUserSockets
};
