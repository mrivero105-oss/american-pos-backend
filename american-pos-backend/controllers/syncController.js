const { Sale } = require('../database/models');
const SaleService = require('../services/SaleService');
const LANClusterService = require('../services/LANClusterService');

/**
 * Normaliza los payloads heredados de ventas offline hacia el contrato estricto de SaleService
 * para garantizar cálculo Zero-Trust, secuencias correlativas, lotes y auditoría unificada.
 */
function normalizeOfflineSalePayload(localSale) {
    const itemsRaw = Array.isArray(localSale.items) ? localSale.items : [];
    const items = itemsRaw.map((item) => {
        const productId = String(item.productId || item.producto_id || item.id);
        const hasExplicitPrice = item.price !== undefined || item.precio !== undefined;
        return {
            ...item,
            id: String(item.id || productId),
            productId,
            name: item.name || item.nombre || 'Producto',
            quantity: Number(item.quantity ?? item.qty ?? 1),
            ...(hasExplicitPrice ? { price: Number(item.price !== undefined ? item.price : item.precio) } : {}),
            variantId: item.variantId || item.variante_id || null,
            presentationId: item.presentationId || item.presentacion_id || null
        };
    });

    let paymentMethods = localSale.paymentMethods;
    if (typeof paymentMethods === 'string') {
        try {
            paymentMethods = JSON.parse(paymentMethods);
        } catch (_) {
            paymentMethods = undefined;
        }
    }

    return {
        ...localSale,
        id: localSale.id ? String(localSale.id) : undefined,
        offlineId: localSale.offlineId || (localSale.id ? String(localSale.id) : undefined),
        date: localSale.date || localSale.created_at || localSale.timestamp || new Date().toISOString(),
        customerId: localSale.customerId ? String(localSale.customerId) : null,
        customerName: localSale.customerName || 'Cliente Ocasional',
        igtfAmount: Number(localSale.igtfAmount !== undefined ? localSale.igtfAmount : (localSale.igtf || 0)),
        paymentMethods: Array.isArray(paymentMethods) ? paymentMethods : undefined,
        items
    };
}

exports.syncOfflineSales = async (req, res) => {
    const { sales } = req.body;
    if (!sales || !Array.isArray(sales) || sales.length === 0) {
        return res.status(400).json({ error: 'Lista de ventas para sincronización vacía o inválida.' });
    }

    const syncedIds = [];
    const errors = [];
    const allSyncedItems = [];
    const reqUser = {
        ...req.user,
        companyId: String(req.user?.companyId || 'default'),
        id: String(req.user?.id || 'system')
    };

    for (const localSale of sales) {
        try {
            const normalized = normalizeOfflineSalePayload(localSale);
            if (!normalized.id) {
                throw new Error('La venta offline debe incluir un identificador único (id).');
            }

            const existing = await Sale.findOne({
                where: { id: normalized.id, companyId: reqUser.companyId }
            });
            if (existing) {
                syncedIds.push(localSale.id);
                continue;
            }

            const processed = await SaleService.processSale(reqUser, normalized, {
                bypassCreditLimit: false,
                bypassStockCheck: true,
                bypassShiftCheck: true,
                isOfflineSync: true
            });

            syncedIds.push(localSale.id);
            if (Array.isArray(normalized.items)) {
                allSyncedItems.push(...normalized.items);
            }

            const io = req.app?.get('io');
            if (io && processed) {
                io.to(reqUser.companyId).emit('sale_completed', processed);
            }
        } catch (itemErr) {
            console.error(`Error procesando venta offline ID ${localSale?.id}:`, itemErr.message);
            errors.push({ id: localSale?.id, error: itemErr.message });
        }
    }

    try {
        if (allSyncedItems.length > 0) {
            LANClusterService.broadcastLANEvent('lan_stock_update', { items: allSyncedItems, timestamp: Date.now() });
        }
    } catch (lanErr) {
        console.warn('[SyncController] Aviso difundiendo actualización de stock LAN:', lanErr.message);
    }

    return res.json({ success: true, syncedIds, errors });
};
