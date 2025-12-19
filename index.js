const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Archivos de base de datos
const DB_FILE = path.join(__dirname, 'db.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const PAYMENT_METHODS_FILE = path.join(__dirname, 'payment_methods.json');

// Helper para leer/escribir JSON
const readJson = (file) => {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const writeJson = (file, data) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// Inicializar archivos si no existen
if (!fs.existsSync(DB_FILE)) writeJson(DB_FILE, { products: [], customers: [], sales: [] });
if (!fs.existsSync(SETTINGS_FILE)) writeJson(SETTINGS_FILE, { exchangeRate: 1.0, businessInfo: {} });
if (!fs.existsSync(PAYMENT_METHODS_FILE)) writeJson(PAYMENT_METHODS_FILE, []);

// Middleware de autenticación
// Simple Secret for token verification (In production use env var)
const AUTH_SECRET = 'american-pos-secret-2025';

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No autenticado' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token inválido' });

    // Format: user:userId:timestamp:signature
    if (token.startsWith('user:')) {
        const parts = token.split(':');
        if (parts.length >= 3) {
            req.user = { id: parts[1] };
            return next();
        }
    }

    return res.status(401).json({ error: 'Token inválido o malformado' });
};

// --- RUTAS DE AUTENTICACIÓN (SIMULADO) ---
// --- RUTAS DE AUTENTICACIÓN ---
app.post('/auth/login', (req, res) => {
    console.log('Login attempt:', req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const db = readJson(DB_FILE);
    // Ensure users array exists
    if (!db.users) db.users = [];

    // Find user
    const user = db.users.find(u => u.email === email && u.password === password);

    if (user) {
        // Check Status
        if (user.status === 'blocked') return res.status(401).json({ error: 'Tu cuenta ha sido bloqueada' });

        // Check Trial
        if (user.trial_expires_at && new Date() > new Date(user.trial_expires_at)) {
            return res.status(401).json({ error: 'Tu periodo de prueba ha expirado' });
        }

        // Return success with token and user info (excluding password)
        const { password: _, ...userWithoutPassword } = user;
        const timestamp = Date.now();
        const token = `user:${user.id}:${timestamp}`; // Add signature logic if needed later

        res.json({
            success: true,
            token: token,
            user: userWithoutPassword
        });
    } else {
        res.status(401).json({ error: 'Credenciales inválidas (user-not-found / wrong-password)' });
    }
});

// --- RUTAS DE PRODUCTOS ---
// Apply middleware to all remaining routes
app.use(verifyToken);

app.get('/products', (req, res) => {
    const db = readJson(DB_FILE);
    let userProducts = db.products.filter(p => p.userId === req.user.id);

    // Sort
    userProducts.sort((a, b) => a.name.localeCompare(b.name));

    console.log('[DEBUG-BACKEND] req.query:', req.query);

    // Filter by Category
    if (req.query.category && req.query.category !== 'Todas') {
        // Handle 'Sin Categoría' specifically if needed, or just exact match
        // Assuming 'Sin Categoría' is stored as such or null.
        // Let's rely on exact match for now as frontend sends specific strings.
        userProducts = userProducts.filter(p => (p.category || 'Sin Categoría') === req.query.category);
    }

    // Filter by Search Query
    if (req.query.search) {
        const q = req.query.search.toLowerCase();
        userProducts = userProducts.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.description && p.description.toLowerCase().includes(q))
        );
    }



    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 0; // 0 = all

    if (limit > 0) {
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedResults = userProducts.slice(startIndex, endIndex);

        res.json({
            products: paginatedResults,
            total: userProducts.length,
            page: page,
            totalPages: Math.ceil(userProducts.length / limit)
        });
    } else {
        // Legacy/All mode - return array directly (or wrapped? Let's keep it wrapped to unify usage, OR check if client requested pagination)
        // To be safe and compatible with existing frontend momentarily, if NO params are sent, we might want to return pure array? 
        // BUT the plan said "This change modifies the API response structure". 
        // Let's implement the change. If params are missing, return valid structure with all items.
        // Actually, for backwards compat, maybe we should check if 'page' is present?
        // If query.page is present => Return object.
        // If not => Return array (Legacy behavior).
        if (req.query.page) {
            res.json({
                products: userProducts,
                total: userProducts.length,
                page: 1,
                totalPages: 1
            });
        } else {
            res.json(userProducts);
        }
    }
});

app.post('/products', (req, res) => {
    const db = readJson(DB_FILE);
    const newProduct = {
        id: Date.now().toString(),
        userId: req.user.id,
        ...req.body
    };
    db.products.push(newProduct);
    writeJson(DB_FILE, db);
    res.status(201).json(newProduct);
});

app.put('/products/:id', (req, res) => {
    const db = readJson(DB_FILE);
    const index = db.products.findIndex(p => p.id === req.params.id && p.userId === req.user.id);
    if (index !== -1) {
        // Preserve userId
        db.products[index] = { ...db.products[index], ...req.body, userId: req.user.id };
        writeJson(DB_FILE, db);
        res.json({ message: 'Producto actualizado' });
    } else {
        res.status(404).json({ message: 'Producto no encontrado' });
    }
});

app.delete('/products/:id', (req, res) => {
    const db = readJson(DB_FILE);
    const initialLength = db.products.length;
    db.products = db.products.filter(p => !(p.id === req.params.id && p.userId === req.user.id));

    if (db.products.length < initialLength) {
        writeJson(DB_FILE, db);
        res.json({ message: 'Producto eliminado' });
    } else {
        res.status(404).json({ message: 'Producto no encontrado' });
    }
});

// --- RUTAS DE CLIENTES ---
app.get('/products/categories', (req, res) => {
    const db = readJson(DB_FILE);
    const userProducts = db.products.filter(p => p.userId === req.user.id);

    // Calculate counts
    const categoryCounts = {};
    let total = 0;

    userProducts.forEach(p => {
        const cat = p.category || 'Sin Categoría';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        total++;
    });

    // Create array format prefered by frontend
    // We can also return just the map. Frontend expects list of categories.
    // Let's return mapped object to be flexible.
    res.json({
        total: total,
        counts: categoryCounts
    });
});

// --- RUTAS DE CLIENTES ---
app.get('/customers', (req, res) => {
    const db = readJson(DB_FILE);
    let userCustomers = db.customers.filter(c => c.userId === req.user.id);

    // Server-side filtering (Search)
    const searchQuery = req.query.search ? req.query.search.toLowerCase() : null;
    if (searchQuery) {
        userCustomers = userCustomers.filter(c =>
            c.name.toLowerCase().includes(searchQuery) ||
            (c.idDocument && c.idDocument.includes(searchQuery)) ||
            (c.email && c.email.toLowerCase().includes(searchQuery))
        );
    }

    // Sort
    userCustomers.sort((a, b) => a.name.localeCompare(b.name));

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20; // Default limit for customers

    // Check if pagination is requested (by page param presence)or force it?
    // Let's mirror products logic: if limit > 0 it paginates.
    // If client sends page=1, we should assume limit=20 if not specified.

    if (req.query.page || req.query.limit) {
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedResults = userCustomers.slice(startIndex, endIndex);

        res.json({
            customers: paginatedResults,
            total: userCustomers.length,
            page: page,
            totalPages: Math.ceil(userCustomers.length / limit)
        });
    } else {
        // Legacy: Return all (for initial backwards compat or full dumps)
        res.json(userCustomers);
    }
});

app.post('/customers', (req, res) => {
    const db = readJson(DB_FILE);
    const newCustomer = {
        id: Date.now().toString(),
        userId: req.user.id,
        ...req.body
    };
    db.customers.push(newCustomer);
    writeJson(DB_FILE, db);
    res.status(201).json(newCustomer);
});

app.put('/customers/:id', (req, res) => {
    const db = readJson(DB_FILE);
    const index = db.customers.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
    if (index !== -1) {
        db.customers[index] = { ...db.customers[index], ...req.body, userId: req.user.id };
        writeJson(DB_FILE, db);
        res.json({ message: 'Cliente actualizado' });
    } else {
        res.status(404).json({ message: 'Cliente no encontrado' });
    }
});

app.delete('/customers/:id', (req, res) => {
    const db = readJson(DB_FILE);
    const initialLength = db.customers.length;
    db.customers = db.customers.filter(c => !(c.id === req.params.id && c.userId === req.user.id));

    if (db.customers.length < initialLength) {
        writeJson(DB_FILE, db);
        res.json({ message: 'Cliente eliminado' });
    } else {
        res.status(404).json({ message: 'Cliente no encontrado' });
    }
});

// --- RUTAS DE PROVEEDORES ---

// Get all suppliers
app.get('/suppliers', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.suppliers) db.suppliers = [];
    const userSuppliers = db.suppliers.filter(s => s.userId === req.user.id);
    res.json(userSuppliers);
});

// Create supplier
app.post('/suppliers', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.suppliers) db.suppliers = [];

    const newSupplier = {
        id: Date.now().toString(),
        userId: req.user.id,
        name: req.body.name,
        contactName: req.body.contactName || '',
        phone: req.body.phone || '',
        email: req.body.email || '',
        address: req.body.address || '',
        notes: req.body.notes || '',
        createdAt: new Date().toISOString()
    };

    db.suppliers.push(newSupplier);
    writeJson(DB_FILE, db);
    res.status(201).json(newSupplier);
});

// Update supplier
app.put('/suppliers/:id', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.suppliers) db.suppliers = [];

    const index = db.suppliers.findIndex(s => s.id === req.params.id && s.userId === req.user.id);
    if (index !== -1) {
        db.suppliers[index] = { ...db.suppliers[index], ...req.body, userId: req.user.id };
        writeJson(DB_FILE, db);
        res.json({ message: 'Proveedor actualizado', supplier: db.suppliers[index] });
    } else {
        res.status(404).json({ message: 'Proveedor no encontrado' });
    }
});

// Delete supplier
app.delete('/suppliers/:id', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.suppliers) db.suppliers = [];

    const initialLength = db.suppliers.length;
    db.suppliers = db.suppliers.filter(s => !(s.id === req.params.id && s.userId === req.user.id));

    if (db.suppliers.length < initialLength) {
        writeJson(DB_FILE, db);
        res.json({ message: 'Proveedor eliminado' });
    } else {
        res.status(404).json({ message: 'Proveedor no encontrado' });
    }
});

// --- RUTAS DE ÓRDENES DE COMPRA ---

// Get all purchase orders
app.get('/purchase-orders', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.purchaseOrders) db.purchaseOrders = [];
    const userOrders = db.purchaseOrders
        .filter(o => o.userId === req.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(userOrders);
});

// Create purchase order
app.post('/purchase-orders', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.purchaseOrders) db.purchaseOrders = [];
    if (!db.suppliers) db.suppliers = [];

    const supplier = db.suppliers.find(s => s.id === req.body.supplierId && s.userId === req.user.id);
    if (!supplier) {
        return res.status(404).json({ message: 'Proveedor no encontrado' });
    }

    const items = req.body.items || [];
    const total = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);

    const newOrder = {
        id: Date.now().toString(),
        userId: req.user.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        items: items,
        total: total,
        status: 'pending',
        createdAt: new Date().toISOString(),
        receivedAt: null,
        notes: req.body.notes || ''
    };

    db.purchaseOrders.push(newOrder);
    writeJson(DB_FILE, db);
    res.status(201).json(newOrder);
});

// Update purchase order
app.put('/purchase-orders/:id', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.purchaseOrders) db.purchaseOrders = [];

    const index = db.purchaseOrders.findIndex(o => o.id === req.params.id && o.userId === req.user.id);
    if (index === -1) {
        return res.status(404).json({ message: 'Orden no encontrada' });
    }

    // Don't allow editing if already received
    if (db.purchaseOrders[index].status === 'received') {
        return res.status(400).json({ message: 'No se puede editar una orden ya recibida' });
    }

    db.purchaseOrders[index] = { ...db.purchaseOrders[index], ...req.body, userId: req.user.id };
    writeJson(DB_FILE, db);
    res.json({ message: 'Orden actualizada', order: db.purchaseOrders[index] });
});

// Receive purchase order (updates stock)
app.post('/purchase-orders/:id/receive', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.purchaseOrders) db.purchaseOrders = [];

    const orderIndex = db.purchaseOrders.findIndex(o => o.id === req.params.id && o.userId === req.user.id);
    if (orderIndex === -1) {
        return res.status(404).json({ message: 'Orden no encontrada' });
    }

    const order = db.purchaseOrders[orderIndex];
    if (order.status === 'received') {
        return res.status(400).json({ message: 'Orden ya fue recibida' });
    }

    // Update stock for each item
    order.items.forEach(item => {
        const productIndex = db.products.findIndex(p => p.id === item.productId && p.userId === req.user.id);
        if (productIndex !== -1) {
            db.products[productIndex].stockQuantity = (db.products[productIndex].stockQuantity || 0) + item.quantity;
        }
    });

    // Update order status
    db.purchaseOrders[orderIndex].status = 'received';
    db.purchaseOrders[orderIndex].receivedAt = new Date().toISOString();

    writeJson(DB_FILE, db);
    res.json({ message: 'Orden recibida. Stock actualizado.', order: db.purchaseOrders[orderIndex] });
});

// Cancel purchase order
app.post('/purchase-orders/:id/cancel', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.purchaseOrders) db.purchaseOrders = [];

    const orderIndex = db.purchaseOrders.findIndex(o => o.id === req.params.id && o.userId === req.user.id);
    if (orderIndex === -1) {
        return res.status(404).json({ message: 'Orden no encontrada' });
    }

    if (db.purchaseOrders[orderIndex].status === 'received') {
        return res.status(400).json({ message: 'No se puede cancelar una orden ya recibida' });
    }

    db.purchaseOrders[orderIndex].status = 'cancelled';
    writeJson(DB_FILE, db);
    res.json({ message: 'Orden cancelada', order: db.purchaseOrders[orderIndex] });
});

// --- RUTAS DE CRÉDITO ---

// Get credit history for a customer
app.get('/customers/:id/credit-history', (req, res) => {
    const db = readJson(DB_FILE);

    // Verify customer belongs to user
    const customer = db.customers.find(c => c.id === req.params.id && c.userId === req.user.id);
    if (!customer) {
        return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Initialize credit_history if not exists
    if (!db.credit_history) db.credit_history = [];

    const history = db.credit_history
        .filter(h => h.customerId === req.params.id && h.userId === req.user.id)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
        customer: {
            id: customer.id,
            name: customer.name,
            creditLimit: customer.creditLimit || 0,
            creditBalance: customer.creditBalance || 0
        },
        history: history
    });
});

// Register a credit payment (abono)
app.post('/customers/:id/credit-payment', (req, res) => {
    const db = readJson(DB_FILE);

    // Find customer
    const customerIndex = db.customers.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
    if (customerIndex === -1) {
        return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    const customer = db.customers[customerIndex];
    const { amount, description, paymentMethod } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Monto inválido' });
    }

    const currentBalance = customer.creditBalance || 0;
    if (amount > currentBalance) {
        return res.status(400).json({ message: 'El abono excede la deuda actual' });
    }

    // Update balance
    db.customers[customerIndex].creditBalance = currentBalance - amount;

    // Initialize credit_history if not exists
    if (!db.credit_history) db.credit_history = [];

    // Add to history
    const historyEntry = {
        id: Date.now().toString(),
        userId: req.user.id,
        customerId: req.params.id,
        type: 'payment',
        amount: amount,
        balanceAfter: db.customers[customerIndex].creditBalance,
        description: description || 'Abono a crédito',
        paymentMethod: paymentMethod || 'cash',
        timestamp: new Date().toISOString()
    };

    db.credit_history.push(historyEntry);
    writeJson(DB_FILE, db);

    res.json({
        message: 'Abono registrado',
        newBalance: db.customers[customerIndex].creditBalance,
        historyEntry: historyEntry
    });
});

// Get customers with outstanding credit (morosos)
app.get('/reports/delinquent-customers', (req, res) => {
    const db = readJson(DB_FILE);

    const delinquent = db.customers
        .filter(c => c.userId === req.user.id && (c.creditBalance || 0) > 0)
        .map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            idDocument: c.idDocument,
            creditLimit: c.creditLimit || 0,
            creditBalance: c.creditBalance || 0,
            availableCredit: (c.creditLimit || 0) - (c.creditBalance || 0)
        }))
        .sort((a, b) => b.creditBalance - a.creditBalance); // Sort by debt descending

    const totalDebt = delinquent.reduce((sum, c) => sum + c.creditBalance, 0);

    res.json({
        customers: delinquent,
        totalCustomers: delinquent.length,
        totalDebt: totalDebt
    });
});

// --- RUTAS DE VENTAS ---
app.get('/sales', (req, res) => {
    const db = readJson(DB_FILE);
    let userSales = db.sales.filter(s => s.userId === req.user.id);

    // Apply date filter if provided
    if (req.query.date) {
        const filterDate = req.query.date; // Expected format: YYYY-MM-DD
        userSales = userSales.filter(s => {
            if (!s.timestamp) return false;
            const saleDate = new Date(s.timestamp).toISOString().split('T')[0]; // Extract YYYY-MM-DD
            return saleDate === filterDate;
        });
    }

    res.json(userSales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
});

app.post('/sales', (req, res) => {
    const db = readJson(DB_FILE);

    // Handle credit (fiado) sales
    if (req.body.paymentMethod === 'fiado') {
        if (!req.body.customerId) {
            return res.status(400).json({ message: 'Se requiere un cliente para venta a crédito' });
        }

        const customerIndex = db.customers.findIndex(c => c.id === req.body.customerId && c.userId === req.user.id);
        if (customerIndex === -1) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }

        const customer = db.customers[customerIndex];
        const creditLimit = customer.creditLimit || 0;
        const creditBalance = customer.creditBalance || 0;
        const availableCredit = creditLimit - creditBalance;
        const saleTotal = req.body.total || 0;

        if (creditLimit === 0) {
            return res.status(400).json({ message: 'Este cliente no tiene crédito habilitado' });
        }

        if (saleTotal > availableCredit) {
            return res.status(400).json({
                message: `Crédito insuficiente. Disponible: $${availableCredit.toFixed(2)}, Requerido: $${saleTotal.toFixed(2)}`
            });
        }

        // Update customer credit balance
        db.customers[customerIndex].creditBalance = creditBalance + saleTotal;
    }

    const newSale = {
        id: Date.now().toString(),
        userId: req.user.id,
        timestamp: new Date().toISOString(),
        ...req.body
    };

    // Actualizar stock (scoped to user)
    newSale.items.forEach(item => {
        const product = db.products.find(p => (p.id === item.productId || p.id === item.id) && p.userId === req.user.id);
        if (product) {
            product.stock = Number(product.stock || 0) - Number(item.quantity);
        }
    });

    db.sales.push(newSale);

    // If fiado, add to credit history
    if (req.body.paymentMethod === 'fiado' && req.body.customerId) {
        if (!db.credit_history) db.credit_history = [];

        const customer = db.customers.find(c => c.id === req.body.customerId);
        db.credit_history.push({
            id: (Date.now() + 1).toString(),
            userId: req.user.id,
            customerId: req.body.customerId,
            type: 'charge',
            amount: req.body.total,
            balanceAfter: customer.creditBalance,
            saleId: newSale.id,
            description: `Venta #${newSale.id.slice(-6)}`,
            timestamp: new Date().toISOString()
        });
    }

    writeJson(DB_FILE, db);
    res.status(201).json(newSale);
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
app.get('/backup', (req, res) => {
    try {
        const backupData = {
            db: readJson(DB_FILE),
            settings: readJson(SETTINGS_FILE),
            paymentMethods: readJson(PAYMENT_METHODS_FILE),
            timestamp: new Date().toISOString(),
            version: '1.0'
        };
        res.json(backupData);
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ message: 'Error creating backup' });
    }
});

app.post('/restore', (req, res) => {
    try {
        const { db, settings, paymentMethods } = req.body;

        if (!db || !settings) {
            return res.status(400).json({ message: 'Invalid backup file format' });
        }

        // Create local backups before overwriting
        if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, `${DB_FILE}.bak`);
        if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
        if (fs.existsSync(PAYMENT_METHODS_FILE)) fs.copyFileSync(PAYMENT_METHODS_FILE, `${PAYMENT_METHODS_FILE}.bak`);

        // Restore data
        writeJson(DB_FILE, db);
        writeJson(SETTINGS_FILE, settings);
        if (paymentMethods) writeJson(PAYMENT_METHODS_FILE, paymentMethods);

        res.json({ message: 'Backup restored successfully' });
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ message: 'Error restoring backup' });
    }
});


// --- RUTAS DE CONTROL DE CAJA ---

// Obtener turno actual (abierto)
app.get('/cash/current', (req, res) => {
    const db = readJson(DB_FILE);
    // Ensure arrays exist
    if (!db.cash_shifts) db.cash_shifts = [];
    if (!db.cash_movements) db.cash_movements = [];

    const currentShift = db.cash_shifts.find(s => s.status === 'open');

    if (!currentShift) {
        return res.json(null);
    }

    // Calculate totals for current shift
    const movements = db.cash_movements.filter(m => m.shiftId === currentShift.id);
    const sales = db.sales.filter(s => {
        const saleDate = new Date(s.timestamp);
        const openDate = new Date(currentShift.openedAt);
        return saleDate >= openDate; // Simple check, ideally check if before closedAt (which is null here)
    });

    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
    const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

    const expectedCash = currentShift.startingCash + totalSales + totalIn - totalOut;

    res.json({
        ...currentShift,
        totalSales,
        totalIn,
        totalOut,
        expectedCash
    });
});

// Abrir caja
app.post('/cash/open', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.cash_shifts) db.cash_shifts = [];

    // Check if already open
    const openShift = db.cash_shifts.find(s => s.status === 'open');
    if (openShift) {
        return res.status(400).json({ message: 'Ya hay una caja abierta' });
    }

    const newShift = {
        id: Date.now().toString(),
        openedAt: new Date().toISOString(),
        closedAt: null,
        startingCash: parseFloat(req.body.amount) || 0,
        expectedCash: 0, // Will be calculated on close
        actualCash: 0,
        status: 'open',
        userId: req.body.userId || 'admin'
    };

    db.cash_shifts.push(newShift);
    writeJson(DB_FILE, db);
    res.status(201).json(newShift);
});

// Cerrar caja
app.post('/cash/close', (req, res) => {
    const db = readJson(DB_FILE);
    const currentShift = db.cash_shifts.find(s => s.status === 'open');

    if (!currentShift) {
        return res.status(400).json({ message: 'No hay caja abierta para cerrar' });
    }

    const actualCash = parseFloat(req.body.actualCash) || 0;

    // Calculate expected
    const movements = (db.cash_movements || []).filter(m => m.shiftId === currentShift.id);
    const sales = db.sales.filter(s => {
        const saleDate = new Date(s.timestamp);
        const openDate = new Date(currentShift.openedAt);
        return saleDate >= openDate;
    });

    // Filter sales by cash payment method if possible, but for now assume all sales affect cash or logic handles it
    // Ideally we filter by paymentMethod === 'cash' or 'combined' parts.
    // For simplicity in this JSON DB version, we'll sum total sales. 
    // In a real app, we'd sum only CASH payments.

    // Let's try to be smarter:
    let cashSalesTotal = 0;
    sales.forEach(sale => {
        if (sale.paymentDetails) {
            sale.paymentDetails.forEach(pd => {
                if (pd.method === 'cash' || pd.method === 'cash_usd' || pd.method === 'cash_bs') {
                    // Convert to base currency (USD)
                    const amount = pd.currency === 'VES' ? (pd.amount / (sale.exchangeRate || 1)) : pd.amount;
                    cashSalesTotal += amount;
                }
            });
        } else {
            // Legacy or simple sale
            if (sale.paymentMethod === 'cash') {
                cashSalesTotal += sale.total;
            }
        }
    });

    const totalIn = movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
    const totalOut = movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

    const expectedCash = currentShift.startingCash + cashSalesTotal + totalIn - totalOut;

    currentShift.closedAt = new Date().toISOString();
    currentShift.status = 'closed';
    currentShift.actualCash = actualCash;
    currentShift.expectedCash = expectedCash;
    currentShift.difference = actualCash - expectedCash;

    writeJson(DB_FILE, db);
    res.json(currentShift);
});

// Registrar movimiento
app.post('/cash/movement', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.cash_movements) db.cash_movements = [];

    const currentShift = (db.cash_shifts || []).find(s => s.status === 'open');
    if (!currentShift) {
        return res.status(400).json({ message: 'Debe abrir la caja primero' });
    }

    const newMovement = {
        id: Date.now().toString(),
        shiftId: currentShift.id,
        type: req.body.type, // 'in' or 'out'
        amount: parseFloat(req.body.amount),
        reason: req.body.reason,
        timestamp: new Date().toISOString()
    };

    db.cash_movements.push(newMovement);
    writeJson(DB_FILE, db);
    res.status(201).json(newMovement);
});

// --- REPORTES ---
app.get('/reports/daily', (req, res) => {
    const db = readJson(DB_FILE);
    const dateStr = req.query.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const dailySales = db.sales.filter(s => {
        const d = new Date(s.timestamp);
        return s.userId === req.user.id && d >= startOfDay && d <= endOfDay;
    });

    // Aggregate by category
    const byCategory = {};
    dailySales.forEach(s => {
        s.items.forEach(item => {
            const cat = item.category || 'Otros'; // Need to join with products if category not in item
            // In this simple DB, item might not have category. We'd need to look it up.
            // For speed, let's assume item has it or we skip it.
            // Actually, let's look it up from products array
            const product = db.products.find(p => p.id === item.id || p.id === item.productId);
            const category = product ? (product.category || 'Otros') : 'Otros';

            if (!byCategory[category]) byCategory[category] = 0;
            byCategory[category] += (item.price * item.quantity);
        });
    });

    // Aggregate by Payment Method
    const byPaymentMethod = {};
    dailySales.forEach(s => {
        if (s.paymentDetails) {
            s.paymentDetails.forEach(pd => {
                const method = pd.method;
                // Normalize amount to USD
                const amount = pd.currency === 'VES' ? (pd.amount / (s.exchangeRate || 1)) : pd.amount;
                if (!byPaymentMethod[method]) byPaymentMethod[method] = 0;
                byPaymentMethod[method] += amount;
            });
        } else {
            const method = s.paymentMethod || 'cash';
            if (!byPaymentMethod[method]) byPaymentMethod[method] = 0;
            byPaymentMethod[method] += s.total;
        }
    });

    res.json({
        date: dateStr,
        totalRevenue: dailySales.reduce((sum, s) => sum + s.total, 0),
        transactionCount: dailySales.length,
        byCategory,
        byPaymentMethod
    });
});

// --- RUTAS DE REEMBOLSOS (NUEVO) ---
app.post('/refunds', (req, res) => {
    try {
        const { saleId, items, reason, timestamp } = req.body;

        if (!saleId || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Datos de reembolso inválidos' });
        }

        const db = readJson(DB_FILE);
        const saleIndex = db.sales.findIndex(s => s.id === saleId);

        if (saleIndex === -1) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const sale = db.sales[saleIndex];

        // Ensure refunds array exists
        if (!db.refunds) db.refunds = [];

        const refundId = Date.now().toString();
        const refund = {
            id: refundId,
            saleId: saleId,
            items: items, // items: [{ id: 'prod1', quantity: 2, price: 10.0, name: 'Prod' }]
            totalRefunded: items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            reason: reason || 'Sin motivo especificado',
            timestamp: timestamp || new Date().toISOString(),
            userId: req.user.id
        };

        // 1. Update Stock
        items.forEach(refundItem => {
            const product = db.products.find(p => p.id === refundItem.id);
            if (product) {
                // Only increase stock if it's managed (not -1 or null)
                const currentStock = product.stock !== undefined ? product.stock : product.stockQuantity;
                if (currentStock !== null && currentStock !== undefined && currentStock !== -1) {
                    product.stock = Number(currentStock) + Number(refundItem.quantity);
                    // Legacy sync
                    product.stockQuantity = product.stock;
                }
            }
        });

        // 2. Update Sale Status
        // Check if fully refunded
        const totalItemsInSale = sale.items.reduce((sum, i) => sum + i.quantity, 0);

        // Calculate total previously refunded items for this sale
        const previousRefunds = db.refunds.filter(r => r.saleId === saleId);
        const previouslyRefundedQty = previousRefunds.reduce((sum, r) => sum + r.items.reduce((is, i) => is + i.quantity, 0), 0);

        const currentRefundQty = items.reduce((sum, i) => sum + i.quantity, 0);
        const totalRefundedQty = previouslyRefundedQty + currentRefundQty;

        if (totalRefundedQty >= totalItemsInSale) {
            sale.status = 'REFUNDED';
        } else {
            sale.status = 'PARTIAL_REFUNDED';
        }

        // 3. Save Refund
        db.refunds.push(refund);

        // Update DB
        writeJson(DB_FILE, db);

        res.json({ success: true, refund: refund, newSaleStatus: sale.status });

    } catch (error) {
        console.error('Error processing refund:', error);
        res.status(500).json({ error: 'Error interno al procesar reembolso' });
    }
});

// --- RUTAS DE USUARIOS ---
app.get('/users', (req, res) => {
    const db = readJson(DB_FILE);
    // Ensure users array exists
    if (!db.users) db.users = [];
    // Return users without passwords
    const usersSafe = db.users.map(u => {
        const { password, ...safeUser } = u;
        return safeUser;
    });
    res.json(usersSafe);
});

app.post('/users', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.users) db.users = [];

    const newUser = {
        id: Date.now().toString(),
        email: req.body.email,
        password: req.body.password, // In a real app, hash this!
        role: req.body.role || 'user',
        currency: req.body.currency || 'USD',
        createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    writeJson(DB_FILE, db);

    const { password, ...safeUser } = newUser;
    res.status(201).json(safeUser);
});

app.put('/users/:id', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.users) db.users = [];

    const index = db.users.findIndex(u => u.id === req.params.id);
    if (index !== -1) {
        // Update fields, keep id and createdAt
        const updatedUser = { ...db.users[index], ...req.body };
        // Don't allow changing ID
        updatedUser.id = db.users[index].id;
        db.users[index] = updatedUser;
        writeJson(DB_FILE, db);

        const { password, ...safeUser } = updatedUser;
        res.json(safeUser);
    } else {
        res.status(404).json({ message: 'Usuario no encontrado' });
    }
});

app.delete('/users/:id', (req, res) => {
    const db = readJson(DB_FILE);
    if (!db.users) db.users = [];

    const initialLength = db.users.length;
    db.users = db.users.filter(u => u.id !== req.params.id);

    if (db.users.length < initialLength) {
        writeJson(DB_FILE, db);
        res.json({ message: 'Usuario eliminado' });
    } else {
        res.status(404).json({ message: 'Usuario no encontrado' });
    }
});

// --- DASHBOARD ---
app.get('/dashboard-summary', (req, res) => {
    const db = readJson(DB_FILE);
    const userSales = db.sales.filter(s => s.userId === req.user.id);
    const userProducts = db.products.filter(p => p.userId === req.user.id);

    const totalRevenue = userSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
    const lowStockItems = userProducts
        .filter(p => (p.stock || p.stockQuantity || 0) <= 5)
        .map(p => ({ name: p.name, stock: p.stock || p.stockQuantity || 0 }));

    res.json({
        totalRevenue,
        numberOfSales: userSales.length,
        lowStockItems,
        salesLast7Days: { labels: [], data: [] } // Simplificado por ahora
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor Local (JSON) corriendo en http://0.0.0.0:${port}`);
});