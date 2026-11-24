const express = require('express');
const router = express.Router();
const CollectionIntelligenceService = require('../services/CollectionIntelligenceService');
const { requirePermission } = require('../middleware/auth');
const { SupervisorApproval } = require('../database/models');
const validate = require('../middleware/validate');
const {
    toggleBlockSchema,
    logCollectionActionSchema
} = require('../schemas/collectionsSchema');

const ALLOWED_CREDIT_UNLOCK_ROLES = new Set(['superadmin', 'admin', 'owner', 'dueño', 'dueno', 'supervisor', 'gerente']);
const ALLOWED_UNLOCK_APPROVAL_ACTIONS = new Set(['CREDIT_LIMIT_OVERRIDE', 'CREDIT_OVERRIDE', 'CREDIT_LIMIT', 'POS_OVERRIDE', 'GENERAL_ACTION']);

// Perfil de crédito y semáforo para el POS (accesible a cualquier cajero autenticado)
router.get('/customer-profile/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { customerId } = req.params;
        const profile = await CollectionIntelligenceService.getCustomerCreditProfile(customerId, companyId);
        res.json({ success: true, ok: true, profile });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// Bloquear o desbloquear línea de crédito de un cliente en el POS
// Permite ejecución directa a administradores/supervisores/usuarios con permiso de cobranza o gestión de clientes,
// o mediante aprobación criptográfica única de supervisor (supervisorApprovalId) desde caja.
router.post('/toggle-block/:customerId', validate(toggleBlockSchema), async (req, res) => {
    try {
        const companyId = String(req.user?.companyId || 'default');
        const userId = req.user?.id || null;
        const userRole = String(req.user?.role || '').toLowerCase();
        const hasDirectPermission = ALLOWED_CREDIT_UNLOCK_ROLES.has(userRole)
            || Boolean(req.user?.permissions?.canAccessCollections)
            || Boolean(req.user?.permissions?.canManageCustomers);

        const { customerId } = req.params;
        const { isBlocked, allowOverdueCredit, supervisorApprovalId, notes } = req.body || {};

        let approvalRecord = null;
        if (!hasDirectPermission) {
            if (!supervisorApprovalId) {
                return res.status(403).json({
                    success: false,
                    ok: false,
                    error: 'Se requiere permiso de Cobranza/Supervisor o autorización por PIN de supervisor para desbloquear este cliente.'
                });
            }
            approvalRecord = await SupervisorApproval.findOne({
                where: { id: String(supervisorApprovalId), companyId }
            });
            if (!approvalRecord) {
                return res.status(403).json({ success: false, ok: false, error: 'Aprobación de supervisor inválida o inexistente.' });
            }
            if (approvalRecord.used) {
                return res.status(403).json({ success: false, ok: false, error: 'Esta aprobación de supervisor ya fue utilizada.' });
            }
            if (approvalRecord.expiresAt && new Date(approvalRecord.expiresAt) < new Date()) {
                return res.status(403).json({ success: false, ok: false, error: 'Esta aprobación de supervisor ha expirado.' });
            }
            const normalizedAction = String(approvalRecord.actionType || '').trim().toUpperCase();
            if (!ALLOWED_UNLOCK_APPROVAL_ACTIONS.has(normalizedAction)) {
                return res.status(403).json({ success: false, ok: false, error: 'La autorización de supervisor no corresponde a desbloqueo de crédito.' });
            }
        }

        const result = await CollectionIntelligenceService.toggleCreditBlock(
            customerId,
            isBlocked,
            companyId,
            userId,
            { allowOverdueCredit, notes }
        );

        if (approvalRecord) {
            await SupervisorApproval.update(
                { used: true, usedAt: new Date(), referenceId: String(customerId) },
                { where: { id: approvalRecord.id, companyId, used: false } }
            );
        }

        const io = req.app?.get('io');
        if (io) {
            io.to(companyId).emit('customers_changed', {
                action: 'credit_block_toggled',
                customerId: String(customerId),
                isCreditBlocked: result.isCreditBlocked,
                allowOverdueCredit: result.allowOverdueCredit,
                timestamp: Date.now()
            });
        }

        res.json({ success: true, ok: true, ...result });
    } catch (err) {
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

router.use(requirePermission('canAccessCollections'));

// Matriz de Antigüedad de Saldos (Aging Analysis)
router.get('/aging', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const includeZero = req.query.includeZero === 'true' || req.query.includeZero === '1';
        const data = await CollectionIntelligenceService.getAgingAnalysis(companyId, includeZero);
        res.json({ success: true, ok: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// Generar mensaje personalizado de WhatsApp
router.get('/whatsapp-message/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { customerId } = req.params;
        let exchangeRate = parseFloat(req.query.exchangeRate || req.query.rate);
        if (isNaN(exchangeRate) || exchangeRate <= 1) {
            const { readJson, getUserSettings } = require('../utils/helpers');
            const { SETTINGS_FILE } = require('../config/paths');
            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const sysRate = parseFloat(userSettings.exchangeRate);
            if (!isNaN(sysRate) && sysRate > 0) {
                exchangeRate = sysRate;
            }
        }
        const result = await CollectionIntelligenceService.generateWhatsAppMessage(customerId, exchangeRate, companyId);
        res.json({ success: true, ok: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

// Registrar gestión de cobranza o promesa de pago
router.post('/log', validate(logCollectionActionSchema), async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const userId = req.user?.id || null;
        const log = await CollectionIntelligenceService.logAction({
            companyId,
            userId,
            ...req.body
        });
        res.json({ success: true, ok: true, log });
    } catch (err) {
        res.status(400).json({ success: false, ok: false, error: err.message });
    }
});

// Historial de gestiones de cobro de un cliente
router.get('/history/:customerId', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { customerId } = req.params;
        const history = await CollectionIntelligenceService.getCustomerActionsHistory(customerId, companyId);
        res.json({ success: true, ok: true, history, logs: history });
    } catch (err) {
        res.status(500).json({ success: false, ok: false, error: err.message });
    }
});

module.exports = router;
