const jwt = require('jsonwebtoken');
const AUTH_SECRET = process.env.JWT_SECRET || 'american-pos-secret-2025';

const verifyToken = (req, res, next) => {
    // 1. Exclude static routes and login from token check
    if (req.path === '/' ||
        req.path === '/index.html' ||
        req.path === '/sw.js' ||
        req.path === '/manifest.json' ||
        req.path.startsWith('/assets') ||
        req.path.startsWith('/js') ||
        req.path.startsWith('/css') ||
        req.path.startsWith('/fonts') ||
        req.path.startsWith('/product_images') ||
        req.path.startsWith('/img') ||
        req.path === '/hello' ||
        req.path === '/auth/login') {
        return next();
    }

    // 2. Verify Header
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No autenticado' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token inválido' });

    // 3. Verify Token
    try {
        const decoded = jwt.verify(token, AUTH_SECRET);
        req.user = decoded;
        return next();
    } catch (err) {
        // Fallback for legacy tokens (will be removed in future)
        if (token.startsWith('user:')) {
            const parts = token.split(':');
            if (parts.length >= 3) {
                req.user = { id: parts[1] };
                return next();
            }
        }
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
};

module.exports = {
    verifyToken,
    AUTH_SECRET
};
