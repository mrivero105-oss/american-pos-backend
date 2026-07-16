const express = require('express');
const router = express.Router();
const LANClusterService = require('../services/LANClusterService');
const { QuarantineSale, Sale, Product, VarianteProducto, sequelize } = require('../database/models');
const SaleService = require('../services/SaleService');
const logger = require('../utils/logger');

/**
 * GET /lan/peers
 * Devuelve la topología de red P2P local y el estado de los nodos descubiertos.
 */
router.get('/peers', (req, res) => {
    try {
        res.json({
            success: true,
            ...LANClusterService.getClusterTopology()
        });
    } catch (error) {
        logger.error(`Error en GET /lan/peers: ${error.message}`);
        res.status(500).json({ error: 'Error al obtener topología de red LAN P2P' });
    }
});

/**
 * POST /lan/broadcast-sale
 * Recibe o propaga una venta generada offline a las demás cajas hermanas en LAN.
 */
router.post('/broadcast-sale', async (req, res) => {
    const { saleData } = req.body;
    if (!saleData) {
        return res.status(400).json({ error: 'Faltan datos transaccionales (saleData).' });
    }

    try {
        LANClusterService.broadcastLANEvent('lan_sale_sync', { saleData, receivedViaRest: true });
        res.json({ success: true, message: 'Transacción propagada al clúster LAN exitosamente.' });
    } catch (error) {
        logger.error(`Error en POST /lan/broadcast-sale: ${error.message}`);
        res.status(500).json({ error: 'Error al propagar venta por LAN' });
    }
});

/**
 * GET /lan/quarantine
 * Lista todas las transacciones en cuarentena que esperan revisión o resolución P2P.
 */
router.get('/quarantine', async (req, res) => {
    try {
        const statusFilter = req.query.status || 'quarantined';
        const companyId = req.user?.companyId || req.query.companyId || '1';

        const quarantined = await QuarantineSale.findAll({
            where: {
                companyId,
                status: statusFilter
            },
            order: [['createdAt', 'DESC']],
            limit: 100
        });

        // Parse rawPayload for easier display on frontend
        const parsedResults = quarantined.map(item => {
            let parsedPayload = {};
            try {
                parsedPayload = JSON.parse(item.rawPayload);
            } catch (e) {}
            return {
                id: item.id,
                companyId: item.companyId,
                userId: item.userId,
                errorReason: item.errorReason,
                status: item.status,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                payload: parsedPayload
            };
        });

        res.json({ success: true, count: parsedResults.length, data: parsedResults });
    } catch (error) {
        logger.error(`Error en GET /lan/quarantine: ${error.message}`);
        res.status(500).json({ error: 'Error al consultar lista de cuarentena P2P' });
    }
});

/**
 * POST /lan/quarantine/:id/resolve
 * Resuelve una transacción en cuarentena (Aprobar o Descartar).
 */
router.post('/quarantine/:id/resolve', async (req, res) => {
    const { id } = req.params;
    const { action, forceStockDeduction } = req.body; // action: 'APPROVE' | 'DISCARD'

    if (!action || !['APPROVE', 'FORCE_APPROVE', 'DISCARD'].includes(action)) {
        return res.status(400).json({ error: "Acción inválida. Debe ser 'APPROVE', 'FORCE_APPROVE' o 'DISCARD'." });
    }
    const normalizedAction = (action === 'FORCE_APPROVE') ? 'APPROVE' : action;

    const t = await sequelize.transaction();
    try {
        const item = await QuarantineSale.findOne({
            where: { id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!item) {
            await t.rollback();
            return res.status(404).json({ error: 'Registro en cuarentena no encontrado.' });
        }

        if (normalizedAction === 'DISCARD') {
            await item.update({ status: 'discarded' }, { transaction: t });
            await t.commit();
            LANClusterService.broadcastLANEvent('lan_quarantine_resolved', { id, action: 'DISCARD' });
            return res.json({ success: true, message: 'Venta en cuarentena descartada correctamente.' });
        }

        // Si es APPROVE, intentamos procesar la venta formalmente o forzar ingreso
        let payload = {};
        try {
            payload = JSON.parse(item.rawPayload);
        } catch (e) {
            await t.rollback();
            return res.status(400).json({ error: 'El payload en cuarentena no es JSON válido.' });
        }

        // Si se solicita deducción forzada de stock aunque quede negativo
        if ((forceStockDeduction || action === 'FORCE_APPROVE') && Array.isArray(payload.items)) {
            for (const prodItem of payload.items) {
                const prodId = String(prodItem.productId || prodItem.producto_id || prodItem.id);
                const product = await Product.findOne({ where: { id: prodId }, transaction: t });
                if (product) {
                    const rawStock = Number(product.stockQuantity || product.stock || 0) - Number(prodItem.quantity);
                    await product.update({ stockQuantity: String(rawStock), stock: null }, { transaction: t });
                }
            }
        }

        // Intentar registrar la venta usando SaleService (en modo bypass para evitar re-cuarentena)
        const mockUser = {
            id: req.user?.id || item.userId || '1',
            companyId: item.companyId || '1',
            activeBranchId: req.user?.activeBranchId || '1',
            name: req.user?.name || 'Supervisor P2P'
        };

        const result = await SaleService.processSale(mockUser, payload, {
            bypassCreditLimit: true,
            bypassStockCheck: true,
            transaction: t
        });

        await item.update({ status: 'resolved' }, { transaction: t });
        await t.commit();

        // Notificar al clúster LAN que la venta se aprobó y el stock cambió
        LANClusterService.broadcastLANEvent('lan_quarantine_resolved', { id, action: 'APPROVE', saleId: result.sale?.id });
        if (payload.items) {
            LANClusterService.broadcastLANEvent('lan_stock_update', { items: payload.items, timestamp: Date.now() });
        }

        res.json({ success: true, message: 'Venta en cuarentena aprobada y procesada al POS.', sale: result.sale });
    } catch (error) {
        if (!t.finished) await t.rollback();
        logger.error(`Error resolviendo cuarentena ${id}: ${error.message}`);
        res.status(500).json({ error: `No se pudo resolver la venta en cuarentena: ${error.message}` });
    }
});

module.exports = router;
