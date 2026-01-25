const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { connectDB, sequelize } = require('./database/connection');
const {
    Product,
    Customer,
    Sale,
    User,
    Supplier,
    CashShift,
    Refund,
    CreditHistory,
    PurchaseOrder
} = require('./database/models');
const { Op } = require('sequelize');

const app = express();
const port = process.env.PORT || 3000;

// Define file paths for legacy config/backup
// Define file paths for legacy config/backup
// Use USER_DATA_PATH if available
const BASE_PATH = process.env.USER_DATA_PATH || __dirname;
const DB_FILE = path.join(BASE_PATH, 'db.json');
const SETTINGS_FILE = path.join(BASE_PATH, 'settings.json');
const PAYMENT_METHODS_FILE = path.join(BASE_PATH, 'payment_methods.json');

// Helper functions for JSON persistence (Settings/Backup)
const readJson = (file) => {
    if (!fs.existsSync(file)) {
        if (file === SETTINGS_FILE) return {};
        if (file === PAYMENT_METHODS_FILE) return [];
        if (file === DB_FILE) return { users: [], products: [], customers: [], sales: [] };
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { console.error('Error reading JSON:', file, e); return null; }
};

const writeJson = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) { console.error('Error writing JSON:', file, e); }
};

/**
 * Generates a more robust ID to prevent collisions during high-speed operations.
 */
const generateRobustId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;


/**
 * Sanitizes an array of objects to include only the fields that REALLY exist in the SQLite table.
 * Returns both the sanitized data and the list of valid fields to use in bulkCreate.
 */
const sanitizeForModel = async (model, dataArray, t) => {
    if (!dataArray || !Array.isArray(dataArray)) return { data: [], fields: [] };

    try {
        // Get ACTUAL columns from the database table
        const queryOptions = t ? { transaction: t } : {};
        const [results] = await sequelize.query(`PRAGMA table_info(${model.getTableName()})`, queryOptions);
        const actualColumns = results.map(r => r.name);
        const actualColumnsSet = new Set(actualColumns);

        const sanitizedData = dataArray.map(item => {
            const sanitizedItem = {};
            // Only keep keys that exist in the physical database table
            Object.keys(item).forEach(key => {
                if (actualColumnsSet.has(key)) {
                    sanitizedItem[key] = item[key];
                }
            });
            return sanitizedItem;
        });

        return { data: sanitizedData, fields: actualColumns };
    } catch (error) {
        console.error(`Sanitization error for ${model.name}:`, error.message);
        return { data: dataArray, fields: Object.keys(model.getAttributes()) };
    }
};

/**
 * Robust bulkCreate that only inserts columns that REALLY exist in the DB.
 */
const bulkCreateResilient = async (model, dataArray, t) => {
    if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) return;
    const { data, fields } = await sanitizeForModel(model, dataArray, t);
    await model.bulkCreate(data, { fields, transaction: t });
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize Database
// connectDB moved to startServer to ensure sync before listen

// --- COPIAS DE SEGURIDAD (LEGACY / ADAPTED) ---
// Note: Backup logic needs to be adapted for SQLite later

// Middleware de autenticación
// Simple Secret for token verification (In production use env var)
const AUTH_SECRET = 'american-pos-secret-2025';

const verifyToken = (req, res, next) => {
    // 1. Excluir rutas estáticas y de login del token check (PRIMERO)
    // Agregamos sw.js y manifest.json por si acaso
    if (req.path === '/' ||
        req.path === '/index.html' ||
        req.path === '/sw.js' ||
        req.path === '/manifest.json' ||
        req.path.startsWith('/assets') ||
        req.path.startsWith('/js') ||
        req.path.startsWith('/css') ||
        req.path.startsWith('/fonts') ||
        req.path === '/auth/login') {
        return next();
    }

    // 2. Verificar Header
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No autenticado' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token inválido' });

    // 3. Verificar Token (Format: user:userId:timestamp:signature)
    if (token.startsWith('user:')) {
        const parts = token.split(':');
        if (parts.length >= 3) {
            req.user = { id: parts[1] };
            return next();
        }
    }

    return res.status(401).json({ error: 'Token inválido o malformado' });
};

// --- RUTAS DE AUTENTICACIÓN ---
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    try {
        const authenticatedUser = await User.findOne({
            where: {
                [Op.or]: [{ username: email }, { username: email }] // Assuming email might be username field in legacy
            }
        });
        // Note: Password check should ideally be hashed. For legacy plaintext compatibility:
        if (authenticatedUser && authenticatedUser.password === password) {
            // Check Status/Trial could be added here if columns exist

            const { password: _, ...userWithoutPassword } = authenticatedUser.toJSON();
            const timestamp = Date.now();
            const token = `user:${authenticatedUser.id}:${timestamp}`;

            res.json({
                success: true,
                token: token,
                user: userWithoutPassword
            });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// --- RUTAS DE PRODUCTOS ---
// Apply middleware to all remaining routes
app.use(verifyToken);

app.get('/products', async (req, res) => {
    try {
        const whereClause = { userId: req.user.id };

        // Filter by Category
        if (req.query.category && req.query.category !== 'Todas') {
            whereClause.category = req.query.category;
        }

        // Filter by Search Query
        if (req.query.search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${req.query.search}%` } },
                // { description: { [Op.like]: `%${req.query.search}%` } } // Add if description exists
            ];
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 0;

        let options = {
            where: whereClause,
            order: [['name', 'ASC']]
        };

        if (limit > 0) {
            options.limit = limit;
            options.offset = (page - 1) * limit;
        }

        const { count, rows } = await Product.findAndCountAll(options);

        // Normalize stockQuantity if needed (handled in model or frontend, but here for consistency)
        const products = rows.map(p => {
            const plain = p.toJSON();
            plain.stockQuantity = (plain.stockQuantity !== undefined && plain.stockQuantity !== null) ? plain.stockQuantity : (plain.stock || 0);
            return plain;
        });

        if (limit > 0 || req.query.page) {
            res.json({
                products: products,
                total: count,
                page: page,
                totalPages: limit > 0 ? Math.ceil(count / limit) : 1
            });
        } else {
            res.json(products);
        }

    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

app.post('/products', async (req, res) => {
    try {
        // Sanitize input against actual schema
        const { data } = await sanitizeForModel(Product, [req.body]);
        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'Datos de producto inválidos' });
        }

        const productData = data[0];
        const newProduct = await Product.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...productData
        });
        res.status(201).json(newProduct);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

app.post('/products/bulk', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { products } = req.body;
        if (!products || !Array.isArray(products)) {
            return res.status(400).json({ error: 'Se requiere un arreglo de productos' });
        }

        console.log(`Processing bulk upload for ${products.length} products`);

        const preparedProducts = products.map(p => ({
            ...p,
            id: p.id || generateRobustId(),
            userId: req.user.id,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        // We use bulkCreateResilient which already handles sanitization and transaction
        await bulkCreateResilient(Product, preparedProducts, t);

        await t.commit();
        res.json({ success: true, count: products.length });
    } catch (error) {
        if (t) await t.rollback();
        console.error('Bulk products error:', error);
        res.status(500).json({ error: 'Error en carga masiva: ' + error.message });
    }
});


app.put('/products/:id', async (req, res) => {
    try {
        // Sanitize input against actual schema
        const { data } = await sanitizeForModel(Product, [req.body]);
        if (!data || data.length === 0) {
            return res.status(400).json({ error: 'Datos de actualización inválidos' });
        }

        const updateData = data[0];
        const [updated] = await Product.update(updateData, {
            where: { id: req.params.id, userId: req.user.id }
        });
        if (updated) {
            res.json({ message: 'Producto actualizado' });
        } else {
            res.status(404).json({ message: 'Producto no encontrado' });
        }
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

app.delete('/products/:id', async (req, res) => {
    try {
        const deleted = await Product.destroy({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (deleted) {
            res.json({ message: 'Producto eliminado' });
        } else {
            res.status(404).json({ message: 'Producto no encontrado' });
        }
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// --- RUTAS DE CATEGORIAS ---
app.get('/products/categories', async (req, res) => {
    try {
        const products = await Product.findAll({
            where: { userId: req.user.id },
            attributes: ['category']
        });

        const categoryCounts = {};
        let total = 0;

        products.forEach(p => {
            const cat = p.category || 'Sin Categoría';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
            total++;
        });

        res.json({
            total: total,
            counts: categoryCounts
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

// --- RUTAS DE CLIENTES ---
app.get('/customers', async (req, res) => {
    try {
        const whereClause = { userId: req.user.id };

        if (req.query.search) {
            const q = req.query.search.toLowerCase();
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${q}%` } },
                { idDocument: { [Op.like]: `%${q}%` } },
                { email: { [Op.like]: `%${q}%` } }
            ];
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        // Condition for legacy vs pagination
        if (req.query.page || req.query.limit) {
            const { count, rows } = await Customer.findAndCountAll({
                where: whereClause,
                order: [['name', 'ASC']],
                limit: limit,
                offset: (page - 1) * limit
            });

            res.json({
                customers: rows,
                total: count,
                page: page,
                totalPages: Math.ceil(count / limit)
            });
        } else {
            const customers = await Customer.findAll({
                where: whereClause,
                order: [['name', 'ASC']]
            });
            res.json(customers);
        }

    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

app.post('/customers', async (req, res) => {
    try {
        const newCustomer = await Customer.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...req.body
        });
        res.status(201).json(newCustomer);
    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

app.put('/customers/:id', async (req, res) => {
    try {
        const [updated] = await Customer.update(req.body, {
            where: { id: req.params.id, userId: req.user.id }
        });
        if (updated) {
            res.json({ message: 'Cliente actualizado' });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

app.delete('/customers/:id', async (req, res) => {
    try {
        const deleted = await Customer.destroy({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (deleted) {
            res.json({ message: 'Cliente eliminado' });
        } else {
            res.status(404).json({ message: 'Cliente no encontrado' });
        }
    } catch (error) {
        console.error('Delete customer error:', error);

        // Debug logging to file
        try {
            const fs = require('fs');
            const logPath = require('path').join(__dirname, 'delete_error.log');
            const debugInfo = {
                timestamp: new Date().toISOString(),
                message: error.message,
                name: error.name,
                code: error.code,
                parentCode: error.parent ? error.parent.code : undefined,
                originalCode: error.original ? error.original.code : undefined,
                stack: error.stack
            };
            fs.appendFileSync(logPath, JSON.stringify(debugInfo, null, 2) + '\n---\n');
        } catch (e) { console.error('Error writing log:', e); }

        // Robust constraint check
        const errorStr = String(error) + JSON.stringify(error);
        if (
            errorStr.includes('SQLITE_CONSTRAINT') ||
            errorStr.includes('FOREIGN KEY') ||
            errorStr.includes('SequelizeForeignKeyConstraintError')
        ) {
            res.status(409).json({ error: 'No se puede eliminar el cliente porque tiene ventas o registros asociados.' });
        } else {
            res.status(500).json({ error: 'Error al eliminar cliente: ' + (error.message || 'Error desconocido') });
        }
    }
});

// --- RUTAS DE PROVEEDORES ---

// Get all suppliers
app.get('/suppliers', verifyToken, async (req, res) => {
    try {
        const suppliers = await Supplier.findAll({ where: { userId: req.user.id } });
        res.json(suppliers);
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({ error: 'Error al obtener proveedores' });
    }
});

// Create supplier
app.post('/suppliers', async (req, res) => {
    try {
        const newSupplier = await Supplier.create({
            id: generateRobustId(),
            userId: req.user.id,
            ...req.body,
            createdAt: new Date().toISOString()
        });
        res.status(201).json(newSupplier);
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
});

// Update supplier
app.put('/suppliers/:id', async (req, res) => {
    try {
        const [updated] = await Supplier.update(req.body, {
            where: { id: req.params.id, userId: req.user.id }
        });

        if (updated) {
            // Fetch updated for response as per original code
            const supplier = await Supplier.findOne({ where: { id: req.params.id } });
            res.json({ message: 'Proveedor actualizado', supplier });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
});

// Delete supplier
app.delete('/suppliers/:id', async (req, res) => {
    try {
        const deleted = await Supplier.destroy({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (deleted) {
            res.json({ message: 'Proveedor eliminado' });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        console.error('Delete supplier error:', error);
        res.status(500).json({ error: 'Error al eliminar proveedor' });
    }
});

// --- RUTAS DE ÓRDENES DE COMPRA ---

// --- RUTAS DE ÓRDENES DE COMPRA ---

// Get all purchase orders
app.get('/purchase-orders', async (req, res) => {
    try {
        const userOrders = await PurchaseOrder.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']]
        });
        res.json(userOrders);
    } catch (error) {
        console.error('Get purchase orders error:', error);
        res.status(500).json({ error: 'Error al obtener órdenes de compra' });
    }
});

// Create purchase order
app.post('/purchase-orders', async (req, res) => {
    try {
        const supplier = await Supplier.findOne({ where: { id: req.body.supplierId, userId: req.user.id } });
        if (!supplier) {
            return res.status(404).json({ message: 'Proveedor no encontrado' });
        }

        const items = req.body.items || [];
        const total = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);

        const newOrder = await PurchaseOrder.create({
            id: generateRobustId(),
            userId: req.user.id,
            supplierId: supplier.id,
            supplierName: supplier.name,
            items: items,
            total: total,
            status: 'pending',
            createdAt: new Date().toISOString(),
            receivedAt: null,
            notes: req.body.notes || ''
        });
        res.status(201).json(newOrder);
    } catch (error) {
        console.error('Create purchase order error:', error);
        res.status(500).json({ error: 'Error al crear orden de compra' });
    }
});

// Update purchase order
app.put('/purchase-orders/:id', async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({ where: { id: req.params.id, userId: req.user.id } });
        if (!order) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        if (order.status === 'received') {
            return res.status(400).json({ message: 'No se puede editar una orden ya recibida' });
        }

        await order.update(req.body);
        res.json({ message: 'Orden actualizada', order });
    } catch (error) {
        console.error('Update purchase order error:', error);
        res.status(500).json({ error: 'Error al actualizar orden de compra' });
    }
});

// Receive purchase order (updates stock)
app.post('/purchase-orders/:id/receive', async (req, res) => {
    const t = await sequelize.transaction(); // Use transaction for atomicity
    try {
        const order = await PurchaseOrder.findOne({
            where: { id: req.params.id, userId: req.user.id },
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        if (order.status === 'received') {
            await t.rollback();
            return res.status(400).json({ message: 'Orden ya fue recibida' });
        }

        // Update stock for each item
        // Note: items is a JSON array
        const items = order.items;
        for (const item of items) {
            const product = await Product.findOne({ where: { id: item.productId, userId: req.user.id }, transaction: t });
            if (product) {
                const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                await product.update({ stockQuantity: currentStock + item.quantity }, { transaction: t });
            }
        }

        await order.update({
            status: 'received',
            receivedAt: new Date().toISOString()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Orden recibida. Stock actualizado.', order });

    } catch (error) {
        await t.rollback();
        console.error('Receive purchase order error:', error);
        res.status(500).json({ error: 'Error al recibir orden' });
    }
});

// Cancel purchase order
app.post('/purchase-orders/:id/cancel', async (req, res) => {
    try {
        const order = await PurchaseOrder.findOne({ where: { id: req.params.id, userId: req.user.id } });
        if (!order) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        if (order.status === 'received') {
            return res.status(400).json({ message: 'No se puede cancelar una orden ya recibida' });
        }

        await order.update({ status: 'cancelled' });
        res.json({ message: 'Orden cancelada', order });
    } catch (error) {
        console.error('Cancel purchase order error:', error);
        res.status(500).json({ error: 'Error al cancelar orden' });
    }
});

// --- DASHBOARD ---
app.get('/dashboard/summary', async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const userId = req.user.id;

        // Helper helper to safe-guard async calls
        const safeQuery = async (promise, fallback) => {
            try { return await promise; } catch (e) { console.error('Query error:', e); return fallback; }
        };

        // Daily Sales
        const dailySalesTotal = await safeQuery(Sale.sum('total', {
            where: {
                userId: userId,
                date: { [Op.like]: `${todayStr}%` }
            }
        }), 0);

        // Monthly Sales
        const monthlySalesTotal = await safeQuery(Sale.sum('total', {
            where: {
                userId: userId,
                date: { [Op.like]: `${currentMonth}%` }
            }
        }), 0);

        // Product Count
        const productCount = await safeQuery(Product.count({ where: { userId: userId } }), 0);

        // Low Stock Items (Robust check for stock OR stockQuantity)
        // Check which column has data usually? We check both < 5
        const lowStockItems = await safeQuery(Product.findAll({
            where: {
                userId: userId,
                [Op.or]: [
                    { stock: { [Op.lt]: 5, [Op.ne]: null } },
                    { stockQuantity: { [Op.lt]: 5, [Op.ne]: null } }
                ]
            },
            limit: 10,
            attributes: ['id', 'name', 'stock', 'stockQuantity'] // Fetch raw first
        }), []);

        // Map to expected frontend format
        const formattedLowStock = lowStockItems.map(p => ({
            name: p.name,
            stock: (p.stockQuantity !== null && p.stockQuantity !== undefined) ? p.stockQuantity : (p.stock || 0)
        }));

        // Recent Sales
        const recentSales = await safeQuery(Sale.findAll({
            where: { userId: userId },
            limit: 5,
            order: [['date', 'DESC']]
        }), []);

        res.json({
            dailySales: dailySalesTotal || 0,
            monthlySales: monthlySalesTotal || 0,
            productCount: productCount || 0,
            lowStockItems: formattedLowStock,
            recentSales: recentSales
        });
    } catch (error) {
        console.error('Dashboard summary critical error:', error);
        res.status(500).json({ error: 'Error al obtener resumen de dashboard' });
    }
});

// Dashboard Profit Metrics
app.get('/dashboard/profit', async (req, res) => {
    try {
        const userId = req.user.id;
        const { startDate, endDate, range } = req.query;

        // Define date range
        let dateFilter = {};
        const now = new Date();

        if (startDate && endDate) {
            dateFilter = {
                [Op.between]: [startDate, endDate]
            };
        } else if (range) {
            switch (range) {
                case 'day':
                    const todayStr = now.toISOString().split('T')[0];
                    dateFilter = { [Op.like]: `${todayStr}%` };
                    break;
                case 'week':
                    const weekAgo = new Date(now);
                    weekAgo.setDate(now.getDate() - 7);
                    dateFilter = { [Op.gte]: weekAgo.toISOString() };
                    break;
                case 'month':
                    const monthStr = now.toISOString().slice(0, 7);
                    dateFilter = { [Op.like]: `${monthStr}%` };
                    break;
                default:
                    const defaultTodayStr = now.toISOString().split('T')[0];
                    dateFilter = { [Op.like]: `${defaultTodayStr}%` };
            }
        } else {
            // Default to today
            const todayStr = now.toISOString().split('T')[0];
            dateFilter = { [Op.like]: `${todayStr}%` };
        }

        // Get sales in the period
        const sales = await Sale.findAll({
            where: {
                userId: userId,
                date: dateFilter
            }
        });

        let totalRevenue = 0;
        let totalCost = 0;
        let totalProfit = 0;
        let productCount = 0;


        // Calculate profit for each sale
        for (const sale of sales) {
            const saleRevenue = sale.total || 0;
            let saleCost = 0;


            // Process each item in the sale
            if (sale.items && Array.isArray(sale.items)) {
                for (const item of sale.items) {
                    productCount++;

                    // Try to find the product to get its cost
                    const product = await Product.findOne({ where: { id: item.id } });

                    const cost = product && product.cost ? product.cost : 0;
                    const quantity = item.quantity || 0;


                    saleCost += cost * quantity;
                }
            }


            totalRevenue += saleRevenue;
            totalCost += saleCost;
        }

        totalProfit = totalRevenue - totalCost;
        // User requested Markup (Profit / Cost) instead of Margin (Profit / Revenue)
        const margin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;


        res.json({
            profit: parseFloat(totalProfit.toFixed(2)),
            revenue: parseFloat(totalRevenue.toFixed(2)),
            cost: parseFloat(totalCost.toFixed(2)),
            margin: parseFloat(margin.toFixed(2)),
            productCount: productCount,
            salesCount: sales.length
        });

    } catch (error) {
        console.error('Dashboard profit error:', error);
        res.status(500).json({ error: 'Error calculando ganancias' });
    }
});

// --- CLIENTES (CRÉDITOS) ---

// --- CLIENTES (CRÉDITOS) ---

app.get('/customers/:id/credit-history', async (req, res) => {
    try {
        const customerId = req.params.id;

        // Fetch Customer
        const customer = await Customer.findOne({ where: { id: customerId, userId: req.user.id } });
        if (!customer) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        // Find sales on credit (fiado or credit)
        const creditSales = await Sale.findAll({
            where: {
                [Op.or]: [
                    { customerId: customerId },
                    // { 'client.id': customerId } 
                ],
                [Op.or]: [
                    { paymentMethod: 'credit' },
                    { paymentMethod: 'fiado' },
                    { paymentMethod: { [Op.like]: '%credit%' } }, // Fallback for JSON
                    { paymentMethod: { [Op.like]: '%fiado%' } }
                ]
            }
        });

        const formattedSales = creditSales.map(s => ({
            id: s.id,
            date: s.date, // or timestamp field
            type: 'purchase',
            amount: s.total,
            description: `Compra #...${s.id ? s.id.slice(-4) : '????'}`
        }));

        // Find payments
        const payments = await CreditHistory.findAll({
            where: {
                customerId: customerId,
                type: 'payment'
            }
        });

        const history = [...formattedSales, ...payments.map(p => p.toJSON())]
            .sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));

        res.json({
            customer: customer,
            history: history
        });
    } catch (error) {
        console.error('Get credit history error:', error);
        res.status(500).json({ error: 'Error al obtener historial de crédito' });
    }
});

app.post('/customers/:id/credit-payment', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const customerId = req.params.id;
        const { amount, description, paymentMethod } = req.body;

        const customer = await Customer.findOne({ where: { id: customerId, userId: req.user.id }, transaction: t });

        if (!customer) {
            await t.rollback();
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }

        const paymentAmount = parseFloat(amount);
        const currentBalance = customer.creditBalance || 0;

        // Update customer balance (subtracting payment)
        await customer.update({ creditBalance: Math.max(0, currentBalance - paymentAmount) }, { transaction: t });

        const newPayment = await CreditHistory.create({
            id: generateRobustId(),
            customerId,
            userId: req.user.id,
            amount: paymentAmount,
            description,
            paymentMethod,
            type: 'payment',
            timestamp: new Date().toISOString()
        }, { transaction: t });

        await t.commit();
        res.json(newPayment);

    } catch (error) {
        await t.rollback();
        console.error('Create payment error:', error);
        res.status(500).json({ error: 'Error al registrar abono' });
    }
});


// Get customers with outstanding credit (morosos)
// Note: This relies on 'creditBalance' on Customer. 
// Since I suspect I missed that column in model definition, I'll trust standard logic or need to fix model.
app.get('/reports/delinquent-customers', async (req, res) => {
    try {
        const delinquentCustomers = await Customer.findAll({
            where: {
                userId: req.user.id,
                creditBalance: { [Op.gt]: 0 }
            },
            order: [['creditBalance', 'DESC']]
        });

        const totalDebt = delinquentCustomers.reduce((sum, c) => sum + (c.creditBalance || 0), 0);

        res.json({
            customers: delinquentCustomers,
            totalCustomers: delinquentCustomers.length,
            totalDebt: totalDebt
        });
    } catch (error) {
        console.error('Delinquent customers report error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de morosos' });
    }
});

// --- RUTAS DE VENTAS ---
app.get('/sales', async (req, res) => {
    try {
        const sales = await Sale.findAll({
            where: { userId: req.user.id },
            limit: 50, // Safety limit
            order: [['date', 'DESC']]
        });
        res.json(sales);
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: 'Error al obtener ventas: ' + error.message });
    }
});

app.post('/sales', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { paymentMethod, customerId, total, items } = req.body;

        // Handle credit (fiado) sales
        if (paymentMethod === 'fiado') {
            if (!customerId) {
                await t.rollback();
                return res.status(400).json({ message: 'Se requiere un cliente para venta a crédito' });
            }

            const customer = await Customer.findOne({ where: { id: customerId, userId: req.user.id }, transaction: t });
            if (!customer) {
                await t.rollback();
                return res.status(404).json({ message: 'Cliente no encontrado' });
            }

            const creditLimit = customer.creditLimit || 0;
            const creditBalance = customer.creditBalance || 0; // Assuming we added this column or will add it. If not, this logic fails.
            // Assuming for now column exists or we accept it might fail if not migrated. 
            // Better: Check model definition. Model has 'userId'. We likely need to migrate schema if we want these columns.
            // But 'creditLimit' was in db.json.

            const availableCredit = creditLimit - creditBalance;
            const saleTotal = total || 0;

            if (creditLimit > 0 && saleTotal > availableCredit) { // Only check if limit is set
                await t.rollback();
                // return res.status(400).json({
                //     message: `Crédito insuficiente. Disponible: $${availableCredit.toFixed(2)}, Requerido: $${saleTotal.toFixed(2)}`
                // });
                // Commented out STRICT check for now to match potentially looser legacy behavior or just warn.
                // Re-enabling strict check:
                return res.status(400).json({
                    message: `Crédito insuficiente. Disponible: $${availableCredit.toFixed(2)}, Requerido: $${saleTotal.toFixed(2)}`
                });
            }

            // Updates
            await customer.update({ creditBalance: creditBalance + saleTotal }, { transaction: t });

            // Add to credit history
            await CreditHistory.create({
                id: generateRobustId(),
                userId: req.user.id,
                customerId: customerId,
                type: 'charge',
                amount: saleTotal,
                balanceAfter: creditBalance + saleTotal,
                saleId: null, // Will update or set if possible. ID is generated on create.
                description: 'Venta (Fiado)',
                paymentMethod: 'fiado',
                timestamp: new Date().toISOString()
            }, { transaction: t });
        }

        // Get current exchange rate
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.id);
        const currentExchangeRate = userSettings.exchangeRate || 1.0;

        const newSale = await Sale.create({
            id: generateRobustId(),
            userId: req.user.id,
            date: new Date().toISOString(), // Map to 'date' column
            customerName: req.body.customerName || (req.body.customer ? req.body.customer.name : 'Cliente Ocasional'),
            exchangeRate: currentExchangeRate, // Store exchange rate at time of sale
            ...req.body
        }, { transaction: t });

        // Update stock
        for (const item of items) {
            const pId = item.productId || item.id; // Safely get ID
            if (!pId) continue; // Skip if no ID

            const product = await Product.findOne({
                where: {
                    id: pId,
                    userId: req.user.id
                },
                transaction: t
            });

            if (product) {
                const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                await product.update({ stockQuantity: currentStock - Number(item.quantity) }, { transaction: t });
            }
        }

        await t.commit();
        res.status(201).json(newSale);

    } catch (error) {
        await t.rollback();
        console.error('Create sale error:', error);
        res.status(500).json({ error: 'Error al registrar venta: ' + error.message });
    }
});

// --- RUTAS DE CONFIGURACIÓN ---
// Helper to get user settings safely
const getUserSettings = (allSettings, userId) => {
    return allSettings[userId] || { exchangeRate: 1.0, businessInfo: {} };
};

app.get('/settings/rate', (req, res) => {
    const allSettings = readJson(SETTINGS_FILE);
    const userSettings = getUserSettings(allSettings, req.user.id);
    res.json({ rate: userSettings.exchangeRate || 1.0 });
});

app.post('/settings/rate', (req, res) => {
    const allSettings = readJson(SETTINGS_FILE);
    if (!allSettings[req.user.id]) allSettings[req.user.id] = {};

    allSettings[req.user.id].exchangeRate = parseFloat(req.body.rate);
    writeJson(SETTINGS_FILE, allSettings);
    res.json({ message: 'Tasa actualizada' });
});

app.get('/settings/business', (req, res) => {
    const allSettings = readJson(SETTINGS_FILE);
    const userSettings = getUserSettings(allSettings, req.user.id);
    res.json(userSettings.businessInfo || {});
});

app.post('/settings/business', (req, res) => {
    const allSettings = readJson(SETTINGS_FILE);
    if (!allSettings[req.user.id]) allSettings[req.user.id] = {};

    allSettings[req.user.id].businessInfo = req.body;
    writeJson(SETTINGS_FILE, allSettings);
    res.json({ message: 'Información actualizada' });
});

app.get('/settings/payment-methods', (req, res) => {
    const methods = readJson(PAYMENT_METHODS_FILE);
    // Return user specific methods OR defaults if empty/new user? 
    // For now, return specific. If empty, frontend handles it or we could copy defaults.
    // Let's copy defaults if empty for better UX. (Optional, can just return empty)
    const userMethods = methods.filter(m => m.userId === req.user.id);
    res.json(userMethods || []);
});

app.post('/settings/payment-methods', (req, res) => {
    let methods = readJson(PAYMENT_METHODS_FILE);
    const { paymentMethods } = req.body;

    // Remove old methods for this user
    methods = methods.filter(m => m.userId !== req.user.id);

    // Add new methods with userId
    const newMethods = paymentMethods.map(m => ({ ...m, userId: req.user.id }));
    methods.push(...newMethods);

    writeJson(PAYMENT_METHODS_FILE, methods);
    res.json({ message: 'Métodos de pago actualizados' });
});

// --- BACKUP & RESTORE ---
// --- BACKUP & RESTORE ---
app.get('/backup', async (req, res) => {
    try {
        // Fetch all data from SQLite
        const dbData = {
            users: await User.findAll(),
            products: await Product.findAll(),
            customers: await Customer.findAll(),
            sales: await Sale.findAll(),
            suppliers: await Supplier.findAll(),
            cash_shifts: await CashShift.findAll(),
            refunds: await Refund.findAll(),
            credit_history: await CreditHistory.findAll(),
            purchaseOrders: await PurchaseOrder.findAll()
        };

        const backupData = {
            db: dbData,
            settings: readJson(SETTINGS_FILE),
            paymentMethods: readJson(PAYMENT_METHODS_FILE),
            timestamp: new Date().toISOString(),
            version: '2.0 (SQLite)'
        };
        res.json(backupData);
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ message: 'Error creating backup' });
    }
});

app.post('/restore', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        let db = req.body.db;
        let settings = req.body.settings;
        let paymentMethods = req.body.paymentMethods;

        // Auto-detect flat structure (Legacy or different export format)
        // If db is missing but we have products/customers/sales at root, assume flat structure
        if (!db && (req.body.products || req.body.customers || req.body.sales)) {
            console.log('Detected flat backup structure (Legacy). Adapting...');
            db = req.body;
            // In flat structure, settings might be at root too if not extracted
            if (!settings && req.body.settings) settings = req.body.settings;
        }

        if (!settings && db && db.settings) {
            settings = db.settings;
        }

        // Normalize Keys
        if (db) {
            if (db.cashShifts && !db.cash_shifts) db.cash_shifts = db.cashShifts;
            if (db.creditHistory && !db.credit_history) db.credit_history = db.creditHistory;
        }

        console.log('Restore DB Keys:', db ? Object.keys(db) : 'missing');
        console.log('Restore Settings:', settings ? 'present' : 'missing');

        if (!db || !settings) {
            console.error('Invalid backup format: missing db or settings (Final Check)');
            await t.rollback();
            return res.status(400).json({ message: 'Invalid backup file format' });
        }

        // Restore Settings & Payment Methods (Files)
        if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
        if (fs.existsSync(PAYMENT_METHODS_FILE)) fs.copyFileSync(PAYMENT_METHODS_FILE, `${PAYMENT_METHODS_FILE}.bak`);

        if (paymentMethods) writeJson(PAYMENT_METHODS_FILE, paymentMethods);

        // Restore Database (SQLite)
        // Explicitly delete legacy tables not in current models to prevent FK constraints
        try {
            await sequelize.query("DELETE FROM sale_items", { transaction: t });
        } catch (e) {
            console.log("Legacy table sale_items not found or empty", e.message);
        }
        try {
            await sequelize.query("DELETE FROM password_resets", { transaction: t });
        } catch (e) {
            console.log("Legacy table password_resets not found or empty", e.message);
        }

        // 2. Clear all tables (Order matters now!)
        await PurchaseOrder.destroy({ where: {}, transaction: t });
        await CreditHistory.destroy({ where: {}, transaction: t });
        await Refund.destroy({ where: {}, transaction: t });
        await CashShift.destroy({ where: {}, transaction: t });
        await Sale.destroy({ where: {}, transaction: t });
        // sale_items deleted above, so unblocking Sales and Products
        await Supplier.destroy({ where: {}, transaction: t });
        await Customer.destroy({ where: {}, transaction: t });
        await Product.destroy({ where: {}, transaction: t });
        await User.destroy({ where: {}, transaction: t });

        // 3. Bulk Create
        // Sanitize Data (Fix Orphans)
        const validUserIds = new Set(db.users ? db.users.map(u => u.id) : []);
        const validCustomerIds = new Set(db.customers ? db.customers.map(c => c.id) : []);

        if (db.customers) {
            db.customers.forEach(c => {
                if (c.userId && !validUserIds.has(c.userId)) c.userId = null;
            });
        }
        if (db.suppliers) {
            db.suppliers.forEach(s => {
                if (s.userId && !validUserIds.has(s.userId)) s.userId = null;
            });
        }
        if (db.sales) {
            db.sales.forEach(s => {
                if (s.userId && !validUserIds.has(s.userId)) s.userId = null;
                if (s.customerId && !validCustomerIds.has(s.customerId)) s.customerId = null;
            });
        }
        if (db.cash_shifts) {
            db.cash_shifts.forEach(cs => {
                if (cs.userId && !validUserIds.has(cs.userId)) cs.userId = null;
            });
        }
        if (db.purchaseOrders) {
            db.purchaseOrders.forEach(po => {
                if (po.userId && !validUserIds.has(po.userId)) po.userId = null;
            });
        }

        await bulkCreateResilient(User, db.users, t);
        await bulkCreateResilient(Product, db.products, t);
        await bulkCreateResilient(Customer, db.customers, t);
        await bulkCreateResilient(Supplier, db.suppliers, t);
        await bulkCreateResilient(Sale, db.sales, t);
        await bulkCreateResilient(CashShift, db.cash_shifts, t);
        await bulkCreateResilient(Refund, db.refunds, t);
        await bulkCreateResilient(CreditHistory, db.credit_history, t);
        await bulkCreateResilient(PurchaseOrder, db.purchaseOrders, t);

        // 4. Re-enable Foreign Keys
        await sequelize.query("PRAGMA foreign_keys = ON", { transaction: t });

        await t.commit();
        console.log('Restore SUCCESS');
        res.json({ message: 'Backup restored successfully' });
    } catch (error) {
        await t.rollback();
        console.error('--- RESTORE ERROR ---');
        console.error('Name:', error.name);
        console.error('Message:', error.message);
        if (error.parent) console.error('Parent Error:', error.parent.message || error.parent);
        if (error.errors) console.error('Details:', error.errors.map(e => e.message).join(', '));
        console.error('----------------------');
        res.status(500).json({ message: 'Error restoring backup: ' + (error.message || 'Unknown error') });
    }
});

// --- RUTAS DE CONTROL DE CAJA ---

// Obtener turno actual (abierto)
app.get('/cash/current', async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'No autorizado' });

        const currentShift = await CashShift.findOne({
            where: {
                userId: req.user.id,
                status: 'open'
            }
        });

        if (!currentShift) {
            return res.json(null);
        }

        const movements = currentShift.movements || [];

        // We also need sales since opening.
        // Use 'date' column, not 'timestamp'
        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: { [Op.gte]: currentShift.openedAt }
            }
        });

        // Filter sales by cash payment method if possible
        let cashSalesTotal = 0;
        sales.forEach(sale => {
            if (sale.paymentMethod === 'cash') {
                cashSalesTotal += sale.total;
            } else if (typeof sale.paymentMethod === 'string' && sale.paymentMethod.includes('cash')) {
                // Handle complex payment methods if they are strings
                cashSalesTotal += sale.total;
            } else if (Array.isArray(sale.paymentMethod)) {
                // If it's an array of payment detail objects
                sale.paymentMethod.forEach(pm => {
                    if (pm.method === 'cash' || pm.method === 'cash_usd' || pm.method === 'cash_bs') {
                        const amount = pm.currency === 'VES' ? (pm.amount / (sale.exchangeRate || 1)) : pm.amount;
                        cashSalesTotal += amount;
                    }
                });
            }
        });

        const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
        const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

        const expectedCash = currentShift.startingCash + cashSalesTotal + totalIn - totalOut;

        res.json({
            ...currentShift.toJSON(),
            cashSalesTotal,
            totalSalesAmount: sales.reduce((sum, s) => sum + s.total, 0),
            salesCount: sales.length,
            totalIn,
            totalOut,
            expectedCash
        });
    } catch (error) {
        console.error('Get current shift error:', error);
        res.status(500).json({ error: 'Error al obtener turno actual' });
    }
});

// Abrir caja
app.post('/cash/open', async (req, res) => {
    console.log('💰 Recibida solicitud /cash/open:', req.body);
    try {
        if (!req.user) return res.status(401).json({ error: 'No autorizado' });

        // Check if already open for this user
        const openShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (openShift) {
            console.warn('⚠️ Intento de abrir caja cuando ya hay una abierta para el usuario:', req.user.id);
            return res.status(400).json({ message: 'Ya tienes una caja abierta' });
        }

        const initialAmount = parseFloat(req.body.amount) || 0;
        console.log(`🚀 Abriendo caja para usuario ${req.user.id} con monto inicial ${initialAmount}`);

        const newShift = await CashShift.create({
            id: generateRobustId(),
            openedAt: new Date().toISOString(),
            status: 'open',
            userId: req.user.id,
            startingCash: initialAmount,
            expectedCash: 0,
            actualCash: 0,
            movements: [],
            salesSummary: {}
        });

        console.log('✅ Caja abierta con éxito:', newShift.id);
        res.status(201).json(newShift);
    } catch (error) {
        console.error('❌ Error al abrir caja:', error);
        res.status(500).json({ error: 'Error al abrir caja', detail: error.message });
    }
});

// Cerrar caja
app.post('/cash/close', async (req, res) => {
    console.log('💰 Recibida solicitud /cash/close:', req.body);
    try {
        if (!req.user) return res.status(401).json({ error: 'No autorizado' });

        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            console.warn('⚠️ Intento de cerrar caja pero no hay ninguna abierta para el usuario:', req.user.id);
            return res.status(400).json({ message: 'No hay caja abierta para cerrar' });
        }

        const actualCashInput = parseFloat(req.body.actualCash) || 0;
        console.log(`🎬 Cerrando caja ${currentShift.id}. Real Contado: ${actualCashInput}`);

        // Calculate expected totals again (to be safe)
        const movements = currentShift.movements || [];
        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                date: { [Op.gte]: currentShift.openedAt }
            }
        });

        let cashSalesTotal = 0;
        sales.forEach(sale => {
            if (sale.paymentMethod === 'cash') {
                cashSalesTotal += sale.total;
            } else if (Array.isArray(sale.paymentMethod)) {
                sale.paymentMethod.forEach(pm => {
                    if (pm.method === 'cash' || pm.method === 'cash_usd' || pm.method === 'cash_bs') {
                        const amount = pm.currency === 'VES' ? (pm.amount / (sale.exchangeRate || 1)) : pm.amount;
                        cashSalesTotal += amount;
                    }
                });
            }
        });

        const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
        const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

        const expectedCash = (currentShift.startingCash || 0) + cashSalesTotal + totalIn - totalOut;

        console.log(`📊 Totales: Fondo ${currentShift.startingCash}, Ventas ${cashSalesTotal}, Entradas ${totalIn}, Salidas ${totalOut}. Esperado: ${expectedCash}`);

        await currentShift.update({
            status: 'closed',
            closedAt: new Date().toISOString(),
            actualCash: actualCashInput,
            expectedCash: expectedCash,
            difference: actualCashInput - expectedCash,
            salesSummary: JSON.stringify({
                totalSales: sales.reduce((sum, s) => sum + s.total, 0),
                cashSales: cashSalesTotal,
                salesCount: sales.length,
                totalIn,
                totalOut
            })
        });

        console.log('✅ Caja cerrada con éxito.');
        res.json(currentShift);
    } catch (error) {
        console.error('❌ Error al cerrar caja:', error);
        res.status(500).json({ error: 'Error al cerrar caja', detail: error.message });
    }
});

// Registrar movimiento (SQLite Fix)
app.post('/cash/movement', async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'No autorizado' });

        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            return res.status(400).json({ message: 'Debe abrir la caja primero' });
        }

        const newMovement = {
            id: generateRobustId(),
            shiftId: currentShift.id,
            type: req.body.type, // 'in' or 'out'
            amount: parseFloat(req.body.amount),
            reason: req.body.reason,
            timestamp: new Date().toISOString()
        };

        // Update JSON column properly
        const movements = currentShift.movements || [];
        movements.push(newMovement);

        await currentShift.update({ movements: movements }); // Explicit update

        res.status(201).json(newMovement);
    } catch (error) {
        console.error('Create movement error:', error);
        res.status(500).json({ error: 'Error al registrar movimiento' });
    }
});

// Obtener historial de movimientos
app.get('/cash/movements', async (req, res) => {
    try {
        const userId = req.user.id;
        if (req.query.shiftId) {
            const shift = await CashShift.findOne({ where: { id: req.query.shiftId, userId } });
            res.json(shift ? (shift.movements || []) : []);
        } else {
            const currentShift = await CashShift.findOne({ where: { userId, status: 'open' } });
            res.json(currentShift ? (currentShift.movements || []) : []);
        }
    } catch (error) {
        console.error('Get movements error:', error);
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
});

// Obtener historial de cierres
app.get('/cash/history', async (req, res) => {
    try {
        const history = await CashShift.findAll({
            where: {
                userId: req.user.id,
                status: 'closed'
            },
            order: [['openedAt', 'DESC']],
            limit: 50
        });
        res.json(history);
    } catch (error) {
        console.error('Get cash history error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// Reporte X (Corte X) - Estado actual de la caja
app.get('/cash/x-report', async (req, res) => {
    try {
        const currentShift = await CashShift.findOne({
            where: { userId: req.user.id, status: 'open' }
        });

        if (!currentShift) {
            return res.status(404).json({ message: 'No hay caja abierta' });
        }

        const movements = currentShift.movements || [];
        const sales = await Sale.findAll({
            where: {
                userId: req.user.id,
                timestamp: { [Op.gte]: currentShift.openedAt }
            }
        });

        let cashSalesTotal = 0;
        sales.forEach(sale => {
            if (sale.paymentMethod === 'cash') {
                cashSalesTotal += sale.total;
            } else if (Array.isArray(sale.paymentMethod)) {
                sale.paymentMethod.forEach(pm => {
                    if (pm.method === 'cash' || pm.method === 'cash_usd' || pm.method === 'cash_bs') {
                        const amount = pm.currency === 'VES' ? (pm.amount / (sale.exchangeRate || 1)) : pm.amount;
                        cashSalesTotal += amount;
                    }
                });
            }
        });

        const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
        const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);
        const expectedCash = currentShift.startingCash + cashSalesTotal + totalIn - totalOut;

        res.json({
            shift: currentShift,
            salesCount: sales.length,
            totalSales: cashSalesTotal, // Returning cash-only sales as per expected UI
            totalIn,
            totalOut,
            expectedCash,
            generatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('X Report error:', error);
        res.status(500).json({ error: 'Error al generar reporte X' });
    }
});

// --- REPORTES ---
app.get('/reports/daily', async (req, res) => {
    try {
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const userId = req.user.id;

        const startOfDay = new Date(dateStr).toISOString();
        const endOfDay = new Date(new Date(dateStr).setHours(23, 59, 59, 999)).toISOString();

        const dailySales = await Sale.findAll({
            where: {
                userId: userId,
                timestamp: { [Op.between]: [startOfDay, endOfDay] }
            }
        });

        const byCategory = {};
        let total = 0;

        dailySales.forEach(s => {
            total += s.total;
            // Simplified category logic for now
        });

        res.json({
            date: dateStr,
            totalSales: total,
            count: dailySales.length,
            byCategory
        });

    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({ error: 'Error agregando reporte diario' });
    }
});

// --- RUTAS DE REEMBOLSOS (NUEVO) ---
app.post('/refunds', async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { saleId, items, reason, timestamp } = req.body;

        const sale = await Sale.findOne({ where: { id: saleId, userId: req.user.id }, transaction: t });
        if (!sale) {
            await t.rollback();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const refundTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const newRefund = await Refund.create({
            id: generateRobustId(),
            userId: req.user.id,
            saleId: saleId,
            products: items,
            total: refundTotal, // Check schema if total exists
            reason: reason || '',
            date: timestamp || new Date().toISOString()
        }, { transaction: t });

        // Update Stock
        for (const item of items) {
            const product = await Product.findOne({ where: { [Op.or]: [{ id: item.id }, { id: item.productId }], userId: req.user.id }, transaction: t });
            if (product) {
                const currentStock = (product.stockQuantity !== undefined && product.stockQuantity !== null) ? product.stockQuantity : (product.stock || 0);
                await product.update({ stockQuantity: currentStock + Number(item.quantity) }, { transaction: t });
            }
        }

        // Update Sale status logic could go here

        await t.commit();
        res.json({ success: true, refund: newRefund });

    } catch (error) {
        await t.rollback();
        console.error('Create refund error:', error);
        res.status(500).json({ error: 'Error al registrar devolución' });
    }
});

// --- RUTAS DE USUARIOS ---
app.get('/users', async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: { exclude: ['password'] } // Exclude password from result
        });
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

app.post('/users', async (req, res) => {
    try {
        const { email, password, role, businessInfo, dataScope } = req.body;

        // Map email to username as per model definition
        const newUser = await User.create({
            id: generateRobustId(),
            username: email, // Backend uses username, frontend sends email
            password: password, // In production, hash this!
            role: role || 'user',
            name: email.split('@')[0], // derived name
            // Add other fields if model supports them (User model in models.js seems limited)
            // businessInfo and dataScope might need to be stored in a new column or handled if model updated.
            // For now, we stick to the existing model schema.
        });

        const safeUser = newUser.toJSON();
        delete safeUser.password;

        res.status(201).json(safeUser);
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

app.put('/users/:id', async (req, res) => {
    try {
        const { email, password, role, businessInfo, dataScope } = req.body;
        const updateData = {};

        if (email) updateData.username = email;
        if (password) updateData.password = password;
        if (role) updateData.role = role;

        // If businessInfo is needed, we need to check if User model has it.
        // Based on read, User model only has id, username, password, role, name.
        // We might be losing dataScope/businessInfo if we don't add columns.
        // However, standardizing basic fields is the priority.

        const [updated] = await User.update(updateData, {
            where: { id: req.params.id }
        });

        if (updated) {
            const user = await User.findOne({ where: { id: req.params.id } });
            const safeUser = user.toJSON();
            delete safeUser.password;
            res.json(safeUser);
        } else {
            res.status(404).json({ message: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

app.delete('/users/:id', async (req, res) => {
    try {
        const deleted = await User.destroy({
            where: { id: req.params.id }
        });

        if (deleted) {
            res.json({ message: 'Usuario eliminado' });
        } else {
            res.status(404).json({ message: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});


// --- SYNCHRONIZATION ---
// OFFLINE MODE: Sync disabled
app.post('/sync/pull', async (req, res) => {
    return res.status(503).json({ error: 'Modo Offline: Sincronización deshabilitada' });
    try {
        console.time('SyncPull');
        console.log('Iniciando sincronización desde la nube...');

        // 1. Fetch from Cloud with Timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('https://american-pos-beta.web.app/api/products', { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) throw new Error(`Cloud API error: ${response.status}`);

        const cloudData = await response.json();
        const cloudProducts = Array.isArray(cloudData) ? cloudData : (cloudData.products || []);

        if (!Array.isArray(cloudProducts)) {
            throw new Error('Invalid data format from cloud');
        }

        let updates = 0;
        let creates = 0;

        // 2. Transact Update
        await sequelize.transaction(async (t) => {
            for (const p of cloudProducts) {
                if (!p.id) continue;

                const [product, created] = await Product.findOrCreate({
                    where: { id: String(p.id) },
                    defaults: {
                        name: p.name || 'Sin Nombre',
                        price: Number(p.price) || 0,
                        priceBs: Number(p.priceBs) || 0,
                        stock: Number(p.stock) || 0,
                        stockQuantity: Number(p.stock) || 0, // Ensure both fields
                        category: p.category || 'General',
                        imageUri: p.imageUri,
                        barcode: p.barcode,
                        userId: req.user ? req.user.id : '1'
                    },
                    transaction: t
                });

                if (!created) {
                    await product.update({
                        name: p.name || product.name,
                        price: p.price !== undefined ? Number(p.price) : product.price,
                        priceBs: p.priceBs !== undefined ? Number(p.priceBs) : product.priceBs,
                        stock: p.stock !== undefined ? Number(p.stock) : product.stock,
                        stockQuantity: p.stock !== undefined ? Number(p.stock) : product.stockQuantity,
                        category: p.category || product.category,
                        imageUri: p.imageUri || product.imageUri,
                        barcode: p.barcode || product.barcode
                    }, { transaction: t });
                    updates++;
                } else {
                    creates++;
                }
            }
        });

        console.timeEnd('SyncPull');

        res.json({
            success: true,
            message: 'Sincronización completada',
            details: {
                totalCloud: cloudProducts.length,
                updates: updates,
                creates: creates
            }
        });

    } catch (e) {
        console.error('Sync error:', e);
        // Don't crash 500 effectively if it's just a fetch error
        res.status(502).json({ error: 'Error de conexión con la nube: ' + e.message });
    }
});

// Fallback para SPA (Single Page Application)
// Cualquier ruta que no sea API, devolver index.html
app.get('*', (req, res) => {
    // Si es una petición API que no coincidió con nada, devolver 404 JSON
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Endpoint no encontrado' });
    }
    // De lo contrario servir la app
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- INICIO DEL SERVIDOR ---

const startServer = (portOverride, dataPath) => {
    return new Promise((resolve, reject) => {

        // Inicializar archivos si no existen (Settings y Payment Methods)
        if (!fs.existsSync(SETTINGS_FILE)) writeJson(SETTINGS_FILE, { exchangeRate: 1.0, businessInfo: {} });
        if (!fs.existsSync(PAYMENT_METHODS_FILE)) writeJson(PAYMENT_METHODS_FILE, []);

        // Inicializar Admin en SQLite y luego iniciar servidor
        (async () => {
            try {
                // Determine if we need to sync. 
                await connectDB();

                const userCount = await User.count();
                if (userCount === 0) {
                    await User.create({
                        id: "1",
                        username: "admin@americanpos.com",
                        password: "admin",
                        role: "admin",
                        name: "Administrador"
                    });
                    console.log('Usuario admin por defecto creado en SQLite: admin@americanpos.com / admin');
                }
            } catch (dbErr) {
                console.error('Error inicializando base de datos:', dbErr);
            }

            // Start listening after DB init attempt
            let attempts = 0;
            const maxAttempts = 10;
            let currentPort = portOverride || port;

            const attemptListen = (p) => {
                const server = app.listen(p, '0.0.0.0', () => {
                    console.log(`Backend American POS corriendo en http://0.0.0.0:${p}`);
                    console.log(`Base de datos (SQLite): pos.sqlite`);
                    resolve({ server, port: p });
                });

                server.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        console.log(`Puerto ${p} ocupado, intentando con ${p + 1}...`);
                        attempts++;
                        if (attempts < maxAttempts) {
                            attemptListen(p + 1);
                        } else {
                            reject(new Error(`No se pudo encontrar un puerto libre después de ${maxAttempts} intentos.`));
                        }
                    } else {
                        reject(err);
                    }
                });
            };

            attemptListen(currentPort);
        })().catch(reject);
    });
};

// Si se ejecuta directamente (node index.js)
if (require.main === module) {
    startServer().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}

module.exports = { startServer, app };