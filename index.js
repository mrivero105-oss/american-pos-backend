require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { sequelize, User } = require('./database/models');
const { verifyToken } = require('./middleware/auth');

// Import Routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const customerRoutes = require('./routes/customers');
const supplierRoutes = require('./routes/suppliers');
const cashRoutes = require('./routes/cash');
const reportRoutes = require('./routes/reports');
const settingRoutes = require('./routes/settings');
const syncRoutes = require('./routes/sync');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const refundRoutes = require('./routes/refunds');
const userRoutes = require('./routes/users');
const backupRoutes = require('./routes/backup');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files (MUST be before auth middleware)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/product_images', express.static(path.join(__dirname, 'product_images')));

// Auth Middleware (Global except for specific public paths)
app.use(verifyToken);

// Mount Routes
app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/sales', salesRoutes);
app.use('/customers', customerRoutes);
app.use('/suppliers', supplierRoutes);
app.use('/cash', cashRoutes);
app.use('/reports', reportRoutes);
app.use('/settings', settingRoutes);
app.use('/sync', syncRoutes);
app.use('/purchase-orders', purchaseOrderRoutes);
app.use('/refunds', refundRoutes);
app.use('/users', userRoutes);
app.use('/backup', backupRoutes);

// SPA Fallback (Redirect all non-API requests to index.html)
app.get('*', (req, res, next) => {
    // Skip API routes
    const apiPaths = [
        '/auth', '/products', '/sales', '/customers', '/suppliers',
        '/cash', '/reports', '/settings', '/sync', '/purchase-orders',
        '/refunds', '/users', '/backup', '/hello'
    ];
    if (apiPaths.some(p => req.path.startsWith(p))) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hello route
app.get('/hello', (req, res) => res.json({ message: 'American POS Server Running' }));

// Start Server
const PORT = Number(process.env.PORT) || 3000;

const startServer = async (p) => {
    return new Promise((resolve) => {
        const server = app.listen(p, '0.0.0.0', async () => {
            console.log(`🚀 American POS Server running at http://localhost:${p}`);

            try {
                // Ensure Database connection
                await sequelize.authenticate();
                console.log('✅ Database connected.');

                // Initial Data Check
                const userCount = await User.count();
                if (userCount === 0) {
                    console.log('Creating default admin user...');
                    await User.create({
                        id: '1',
                        email: 'admin@americanpos.com',
                        password: 'admin',
                        name: 'Administrador',
                        role: 'admin',
                        status: 'active'
                    });
                }
            } catch (error) {
                console.error('Startup Error:', error);
            }
            resolve({ server, port: p });
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${p} in use, trying ${p + 1}...`);
                resolve(startServer(p + 1));
            } else {
                console.error('Server error:', err);
            }
        });
    });
};

startServer(PORT);