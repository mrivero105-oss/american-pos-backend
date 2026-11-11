const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const auditController = require('../controllers/audit');

// Middleware to grant access to Dueño (superadmin/owner/dueño), Administrador (admin), and Supervisor (supervisor), or users with canAccessAudit
const canAccessAudit = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const role = (req.user.role || '').toLowerCase();
    const permissions = req.user.permissions || {};

    const isAllowedRole = ['superadmin', 'admin', 'supervisor', 'owner', 'dueño'].includes(role);
    const hasAuditPerm = permissions.canAccessAudit === true;

    if (isAllowedRole || hasAuditPerm) {
        return next();
    }
    return res.status(403).json({ error: 'Acceso denegado: Se requiere rol de Dueño, Administrador o Supervisor' });
};

// All audit routes require authentication and audit privileges (Dueño, Admin, Supervisor)
router.use(verifyToken);
router.use(canAccessAudit);

// Rutas de Auditoría
router.get('/logs', auditController.getLogs);
router.get('/stats', auditController.getStats);
router.get('/verify-chain', auditController.verifyChain);

// Rutas de Alertas
router.get('/alerts', auditController.getAlerts);
router.put('/alerts/resolve-all', auditController.resolveAllAlerts);
router.put('/alerts/:id/resolve', auditController.resolveAlert);
router.patch('/alerts/:id/status', auditController.resolveAlert);

module.exports = router;
