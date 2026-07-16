const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const auditController = require('../controllers/audit');

// Middleware to restrict access to admins/superadmins
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const role = (req.user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'superadmin') {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
};

// All audit routes require authentication and admin privileges
router.use(verifyToken);
router.use(requireAdmin);

// Rutas de Auditoría
router.get('/logs', auditController.getLogs);

// Rutas de Alertas
router.get('/alerts', auditController.getAlerts);
router.put('/alerts/:id/resolve', auditController.resolveAlert);

module.exports = router;
