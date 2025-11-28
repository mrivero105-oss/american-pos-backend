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

// Middleware de autenticación simulado (siempre pasa)
const verifyToken = (req, res, next) => next();

// --- RUTAS DE PRODUCTOS ---
app.get('/products', (req, res) => {
    const db = readJson(DB_FILE);
    res.json(db.products.sort((a, b) => a.name.localeCompare(b.name)));
});

app.post('/products', (req, res) => {
    const db = readJson(DB_FILE);
    const newProduct = { id: Date.now().toString(), ...req.body };
    db.products.push(newProduct);
    writeJson(DB_FILE, db);
    res.status(201).json(newProduct);
});

app.put('/products/:id', (req, res) => {
    const db = readJson(DB_FILE);
    const index = db.products.findIndex(p => p.id === req.params.id);
    if (index !== -1) {
        db.products[index] = { ...db.products[index], ...req.body };
        writeJson(DB_FILE, db);
        res.json({ message: 'Producto actualizado' });
    } else {
        res.status(404).json({ message: 'Producto no encontrado' });
    }
});

app.delete('/products/:id', (req, res) => {
    const db = readJson(DB_FILE);
    db.products = db.products.filter(p => p.id !== req.params.id);
    writeJson(DB_FILE, db);
    res.json({ message: 'Producto eliminado' });
});

// --- RUTAS DE CLIENTES ---
app.get('/customers', (req, res) => {
    const db = readJson(DB_FILE);
    res.json(db.customers.sort((a, b) => a.name.localeCompare(b.name)));
});

app.post('/customers', (req, res) => {
    const db = readJson(DB_FILE);
    const newCustomer = { id: Date.now().toString(), ...req.body };
    db.customers.push(newCustomer);
    writeJson(DB_FILE, db);
    res.status(201).json(newCustomer);
});

app.put('/customers/:id', (req, res) => {
    const db = readJson(DB_FILE);
    const index = db.customers.findIndex(c => c.id === req.params.id);
    if (index !== -1) {
        db.customers[index] = { ...db.customers[index], ...req.body };
        writeJson(DB_FILE, db);
        res.json({ message: 'Cliente actualizado' });
    } else {
        res.status(404).json({ message: 'Cliente no encontrado' });
    }
});

app.delete('/customers/:id', (req, res) => {
    const db = readJson(DB_FILE);
    db.customers = db.customers.filter(c => c.id !== req.params.id);
    writeJson(DB_FILE, db);
    res.json({ message: 'Cliente eliminado' });
});

// --- RUTAS DE VENTAS ---
app.get('/sales', (req, res) => {
    const db = readJson(DB_FILE);
    res.json(db.sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
});

app.post('/sales', (req, res) => {
    const db = readJson(DB_FILE);
    const newSale = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        ...req.body
    };

    // Actualizar stock
    newSale.items.forEach(item => {
        const product = db.products.find(p => p.id === item.productId || p.id === item.id);
        if (product) {
            product.stockQuantity -= item.quantity;
        }
    });

    db.sales.push(newSale);
    writeJson(DB_FILE, db);
    res.status(201).json({ message: "Venta registrada", saleId: newSale.id });
});

// --- RUTAS DE CONFIGURACIÓN ---
app.get('/settings/rate', (req, res) => {
    const settings = readJson(SETTINGS_FILE);
    res.json({ rate: settings.exchangeRate || 1.0 });
});

app.post('/settings/rate', (req, res) => {
    const settings = readJson(SETTINGS_FILE);
    settings.exchangeRate = parseFloat(req.body.rate);
    writeJson(SETTINGS_FILE, settings);
    res.json({ message: 'Tasa actualizada' });
});

app.get('/settings/business', (req, res) => {
    const settings = readJson(SETTINGS_FILE);
    res.json(settings.businessInfo || {});
});

app.post('/settings/business', (req, res) => {
    const settings = readJson(SETTINGS_FILE);
    settings.businessInfo = req.body;
    writeJson(SETTINGS_FILE, settings);
    res.json({ message: 'Información actualizada' });
});

app.get('/settings/payment-methods', (req, res) => {
    const methods = readJson(PAYMENT_METHODS_FILE);
    res.json(methods || []);
});

app.post('/settings/payment-methods', (req, res) => {
    const { paymentMethods } = req.body;
    writeJson(PAYMENT_METHODS_FILE, paymentMethods);
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

// --- DASHBOARD ---
app.get('/dashboard-summary', (req, res) => {
    const db = readJson(DB_FILE);
    const totalRevenue = db.sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
    const lowStockItems = db.products
        .filter(p => p.stockQuantity <= 5)
        .map(p => ({ name: p.name, stock: p.stockQuantity }));

    res.json({
        totalRevenue,
        numberOfSales: db.sales.length,
        lowStockItems,
        salesLast7Days: { labels: [], data: [] } // Simplificado por ahora
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor Local (JSON) corriendo en http://0.0.0.0:${port}`);
});