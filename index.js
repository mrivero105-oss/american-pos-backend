
require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const nodemailer = require('nodemailer');
let serviceAccount;
try {
    serviceAccount = require('/etc/secrets/serviceAccountKey.json');
} catch (e) {
    serviceAccount = require('./serviceAccountKey.json');
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==========================================
// CONFIGURACIÓN DE EMAIL (GMAIL)
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'mrivero105@gmail.com',
        pass: 'cgapvlnljeoihcgr'
    },
    tls: {
        rejectUnauthorized: false
    }
});

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Función para generar HTML del recibo
const generateReceiptHtml = (sale, customer, exchangeRate, businessInfo = {}) => {
    const date = sale.timestamp ? new Date(sale.timestamp.toDate()).toLocaleString('es-VE') : new Date().toLocaleString('es-VE');
    const totalBs = sale.total * exchangeRate;

    let itemsHtml = sale.items.map(item => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">${item.name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">x${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right; color: #333;">$${(item.price * item.quantity).toFixed(2)}</td>
        </tr>
    `).join('');

    return `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
                ${businessInfo.logoUrl ? `<img src="${businessInfo.logoUrl}" style="max-width: 80px; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;">` : ''}
                <h2 style="margin: 0; color: #1e293b;">${businessInfo.name || 'American POS'}</h2>
                ${businessInfo.address ? `<p style="margin: 5px 0 0; color: #64748b; font-size: 12px;">${businessInfo.address}</p>` : ''}
                ${businessInfo.phone ? `<p style="margin: 2px 0 0; color: #64748b; font-size: 12px;">Tel: ${businessInfo.phone}</p>` : ''}
                ${businessInfo.taxId ? `<p style="margin: 2px 0 0; color: #64748b; font-size: 12px;">RIF/NIT: ${businessInfo.taxId}</p>` : ''}
                <p style="margin: 10px 0 0; color: #64748b; font-size: 14px; font-weight: bold;">Recibo de Venta</p>
                <p style="margin: 2px 0 0; font-size: 12px; color: #94a3b8;">${date}</p>
            </div>
            
            ${customer ? `
                <div style="margin-bottom: 20px; padding: 15px; background-color: #f8fafc; border-radius: 8px;">
                    <p style="margin: 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Cliente</p>
                    <p style="margin: 5px 0 0; font-weight: bold; color: #334155;">${customer.name}</p>
                    <p style="margin: 2px 0 0; font-size: 14px; color: #475569;">${customer.phone}</p>
                </div>
            ` : ''}

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background-color: #f1f5f9;">
                        <th style="text-align: left; padding: 8px; font-size: 12px; color: #475569; text-transform: uppercase;">Item</th>
                        <th style="text-align: left; padding: 8px; font-size: 12px; color: #475569; text-transform: uppercase;">Cant</th>
                        <th style="text-align: right; padding: 8px; font-size: 12px; color: #475569; text-transform: uppercase;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div style="border-top: 2px solid #1e293b; padding-top: 15px; margin-top: 10px;">
                <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 18px; color: #0f172a; margin-bottom: 5px;">
                    <span>Total USD:</span>
                    <span>$${sale.total.toFixed(2)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 14px; color: #64748b;">
                    <span>Total BS (Ref):</span>
                    <span>Bs ${totalBs.toFixed(2)}</span>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                <p style="margin: 0; font-size: 10px; color: #cbd5e1;">ID: ${sale.id}</p>
                <p style="margin: 10px 0 0; font-size: 14px; color: #64748b;">¡Gracias por su compra!</p>
            </div>
        </div>
    `;
};

const getCleanSearchTerms = (product) => {
    const stopWords = /\b(de|la|el|los|las|con|sin|y|a|para)\b/ig;

    const cleanedName = product.name
        .toLowerCase()
        .replace(stopWords, '')
        .replace(/\d+(\s*)?(grs|gr|g|ml|l|kg|cc|unds|und)/ig, '')
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    const categoryTerm = (product.category && product.category.toLowerCase() !== 'general')
        ? product.category.toLowerCase().replace(stopWords, '').trim()
        : '';

    return [cleanedName, categoryTerm].filter(Boolean).join(',');
};

// --- RUTAS DE PRODUCTOS ---
app.get('/products', verifyToken, async (req, res) => {
    try {
        const snapshot = await db.collection('products').get();
        const products = [];
        snapshot.forEach(doc => { products.push(doc.data()); });
        res.status(200).json(products.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) { res.status(500).json({ message: "Error al obtener productos" }); }
});

app.post('/products', verifyToken, async (req, res) => {
    try {
        const { name, price, category, stockQuantity, description, imageUri, barcode } = req.body;
        const newProduct = { name, price, category, stockQuantity, description, imageUri, barcode: barcode || '' };
        const docRef = db.collection('products').doc();
        const productToSave = { ...newProduct, id: docRef.id };
        await docRef.set(productToSave);
        res.status(201).send(productToSave);
    } catch (error) { res.status(500).json({ message: "Error al crear producto" }); }
});

app.put('/products/:productId', verifyToken, async (req, res) => {
    try {
        const { productId } = req.params;
        const { name, price, category, stockQuantity, description, imageUri, barcode } = req.body;
        const updatedProduct = { name, price, category, stockQuantity, description, imageUri, barcode: barcode || '' };
        await db.collection('products').doc(productId).update(updatedProduct);
        res.status(200).json({ message: 'Producto actualizado' });
    } catch (error) { res.status(500).json({ message: "Error al actualizar producto" }); }
});

app.delete('/products/:productId', verifyToken, async (req, res) => {
    try {
        const { productId } = req.params;
        await db.collection('products').doc(productId).delete();
        res.status(200).json({ message: 'Producto eliminado' });
    } catch (error) { res.status(500).json({ message: "Error al eliminar producto" }); }
});

// ========== VENTAS ==========
app.post('/sales', verifyToken, async (req, res) => {
    try {
        const { items, total, customerId, paymentMethod, paymentDetails } = req.body;
        const saleRef = db.collection('sales').doc();
        const saleData = {
            id: saleRef.id,
            items,
            total,
            paymentMethod: paymentMethod || 'cash',
            paymentDetails: paymentDetails || {},
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        if (customerId) {
            saleData.customerId = customerId;
        }

        await saleRef.set(saleData);

        const batch = db.batch();
        for (const item of items) {
            const productId = item.productId || item.id;
            if (productId && !productId.startsWith('custom-')) {
                const productRef = db.collection('products').doc(productId);
                batch.update(productRef, { stockQuantity: admin.firestore.FieldValue.increment(-item.quantity) });
            }
        }
        await batch.commit();
        res.status(201).json({ message: "Venta registrada.", saleId: saleRef.id });
    } catch (error) {
        console.error('Error al crear venta:', error);
        res.status(500).json({ message: "Error al registrar la venta." });
    }
});

app.get('/sales', verifyToken, async (req, res) => {
    try {
        const { date } = req.query;
        let query = db.collection('sales').orderBy('timestamp', 'desc');

        if (date) {
            try {
                const startDate = new Date(date);
                startDate.setUTCHours(0, 0, 0, 0);
                const endDate = new Date(date);
                endDate.setUTCHours(23, 59, 59, 999);
                query = query.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);
            } catch (e) {
                return res.status(400).json({ message: "Formato de fecha inválido. Use YYYY-MM-DD." });
            }
        }

        const salesSnapshot = await query.get();
        const salesHistory = [];
        salesSnapshot.forEach(doc => {
            const data = doc.data();
            salesHistory.push({ id: doc.id, ...data });
        });
        res.status(200).json(salesHistory);
    } catch (error) {
        console.error("Error al obtener historial de ventas:", error);
        res.status(500).json({ message: "Error al obtener el historial." });
    }
});

app.get('/sales/:id', verifyToken, async (req, res) => {
    try {
        const saleId = req.params.id;
        const doc = await db.collection('sales').doc(saleId).get();
        if (!doc.exists) {
            return res.status(404).json({ message: 'Venta no encontrada' });
        }
        const settingsDoc = await db.collection('settings').doc('config').get();
        const exchangeRate = settingsDoc.exists ? settingsDoc.data().exchangeRate : 1.0;
        res.status(200).json({ sale: doc.data(), exchangeRate });
    } catch (error) {
        res.status(500).json({ message: "Error al obtener la venta." });
    }
});

app.post('/sales/:id/email', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        const doc = await db.collection('sales').doc(id).get();
        if (!doc.exists) {
            return res.status(404).json({ message: 'Venta no encontrada' });
        }

        const sale = doc.data();
        let customer = null;
        if (sale.customerId) {
            const customerDoc = await db.collection('customers').doc(sale.customerId).get();
            if (customerDoc.exists) {
                customer = customerDoc.data();
            }
        }

        // Obtener tasa e info del negocio
        const settingsDoc = await db.collection('settings').doc('config').get();
        const exchangeRate = settingsDoc.exists ? settingsDoc.data().exchangeRate : 1.0;
        const businessInfo = settingsDoc.exists ? (settingsDoc.data().businessInfo || {}) : {};

        const htmlContent = generateReceiptHtml(sale, customer, exchangeRate, businessInfo);

        const mailOptions = {
            from: '"American POS" <noreply@americanpos.com>',
            to: email,
            subject: `Recibo de Venta #${id.substring(0, 8)} - American POS`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);

        console.log(`Recibo enviado a ${email}`);
        res.status(200).json({ message: 'Recibo enviado por email', email });
    } catch (error) {
        console.error('Error al enviar email:', error);
        res.status(500).json({ message: 'Error al enviar email: ' + error.message });
    }
});

// ========== DASHBOARD ==========  
app.get('/dashboard-summary', verifyToken, async (req, res) => {
    try {
        const { date } = req.query;
        let salesQuery = db.collection('sales');

        if (date) {
            try {
                const startDate = new Date(date);
                startDate.setUTCHours(0, 0, 0, 0);
                const endDate = new Date(date);
                endDate.setUTCHours(23, 59, 59, 999);
                salesQuery = salesQuery.where('timestamp', '>=', startDate).where('timestamp', '<=', endDate);
            } catch (e) {
                return res.status(400).json({ message: "Formato de fecha inválido. Use YYYY-MM-DD." });
            }
        }

        const salesSnapshot = await salesQuery.get();
        let totalRevenue = 0;
        salesSnapshot.forEach(doc => { totalRevenue += doc.data().total || 0; });

        const productsSnapshot = await db.collection('products').where('stockQuantity', '<=', 5).get();
        const lowStockItems = [];
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            lowStockItems.push({ name: product.name, stock: product.stockQuantity });
        });

        const sevenDaysAgoDate = new Date(date || new Date());
        sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 6);
        sevenDaysAgoDate.setUTCHours(0, 0, 0, 0);

        const last7DaysSalesSnapshot = await db.collection('sales').where('timestamp', '>=', sevenDaysAgoDate).get();

        const salesByDay = {};
        const dayLabels = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(sevenDaysAgoDate);
            d.setDate(d.getDate() + (6 - i));
            const day = d.toLocaleDateString('es-ES', { weekday: 'short' });
            dayLabels.push(day);
            salesByDay[day] = 0;
        }

        last7DaysSalesSnapshot.forEach(doc => {
            const sale = doc.data();
            if (sale.timestamp) {
                const saleDate = sale.timestamp.toDate();
                const day = saleDate.toLocaleDateString('es-ES', { weekday: 'short' });
                if (salesByDay.hasOwnProperty(day)) {
                    salesByDay[day] += sale.total;
                }
            }
        });

        const salesData = dayLabels.map(day => salesByDay[day] || 0);

        res.status(200).json({
            totalRevenue: totalRevenue,
            numberOfSales: salesSnapshot.size,
            lowStockItems: lowStockItems.sort((a, b) => a.stock - b.stock),
            salesLast7Days: {
                labels: dayLabels,
                data: salesData
            }
        });
    } catch (error) {
        console.error("Error en /dashboard-summary:", error);
        res.status(500).json({ message: "Error al generar el resumen" });
    }
});

// ========== SETTINGS ==========
app.get('/settings/rate', verifyToken, async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('config').get();
        if (!doc.exists) {
            res.status(200).json({ rate: 1.0 });
        } else {
            res.status(200).json({ rate: doc.data().exchangeRate || 1.0 });
        }
    } catch (error) { res.status(500).json({ message: 'Error al obtener la tasa.' }); }
});

app.post('/settings/rate', verifyToken, async (req, res) => {
    try {
        const { rate } = req.body;
        await db.collection('settings').doc('config').set({ exchangeRate: parseFloat(rate) }, { merge: true });
        res.status(200).json({ message: 'Tasa actualizada.' });
    } catch (error) { res.status(500).json({ message: 'Error al actualizar la tasa.' }); }
});

app.get('/settings/business', verifyToken, async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('config').get();
        res.status(200).json(doc.exists ? (doc.data().businessInfo || {}) : {});
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener info del negocio' });
    }
});

app.post('/settings/business', verifyToken, async (req, res) => {
    try {
        const { name, address, phone, taxId, logoUrl } = req.body;
        await db.collection('settings').doc('config').set({
            businessInfo: { name, address, phone, taxId, logoUrl }
        }, { merge: true });
        res.status(200).json({ message: 'Información del negocio actualizada' });
    } catch (error) {
        console.error('Error al actualizar información del negocio:', error);
        res.status(500).json({ message: 'Error al actualizar información del negocio' });
    }
});

// ========== PAYMENT METHODS ==========
app.get('/settings/payment-methods', verifyToken, async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('config').get();
        const paymentMethods = doc.exists ? (doc.data().paymentMethods || []) : [];
        res.status(200).json(paymentMethods);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener métodos de pago' });
    }
});

app.post('/settings/payment-methods', verifyToken, async (req, res) => {
    try {
        const { paymentMethods } = req.body;
        await db.collection('settings').doc('config').set({ paymentMethods }, { merge: true });
        res.status(200).json({ message: 'Métodos de pago actualizados' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar métodos de pago' });
    }
});

app.get('/customers/:customerId', verifyToken, async (req, res) => {
    try {
        const { customerId } = req.params;
        const doc = await db.collection('customers').doc(customerId).get();
        if (!doc.exists) {
            return res.status(404).json({ message: 'Cliente no encontrado' });
        }
        res.status(200).json(doc.data());
    } catch (error) { res.status(500).json({ message: 'Error al obtener cliente' }); }
});

app.post('/customers', verifyToken, async (req, res) => {
    try {
        const { name, phone, email, address, idDocument } = req.body;
        const docRef = db.collection('customers').doc();
        await docRef.set({
            id: docRef.id,
            name,
            phone,
            email: email || '',
            address: address || '',
            idDocument: idDocument || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(201).json({ message: 'Cliente creado', id: docRef.id });
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ message: "Error al crear cliente" });
    }
});

app.put('/customers/:customerId', verifyToken, async (req, res) => {
    try {
        const { customerId } = req.params;
        const { name, phone, email, address, idDocument } = req.body;
        await db.collection('customers').doc(customerId).update({
            name, phone, email: email || '', address: address || '', idDocument: idDocument || ''
        });
        res.status(200).json({ message: 'Cliente actualizado' });
    } catch (error) { res.status(500).json({ message: 'Error al actualizar cliente' }); }
});

app.delete('/customers/:customerId', verifyToken, async (req, res) => {
    try {
        await db.collection('customers').doc(req.params.customerId).delete();
        res.status(200).json({ message: 'Cliente borrado' });
    } catch (error) { res.status(500).json({ message: 'Error al borrar cliente' }); }
});

app.get('/customers/:customerId/sales', verifyToken, async (req, res) => {
    try {
        const { customerId } = req.params;
        const salesSnapshot = await db.collection('sales')
            .where('customerId', '==', customerId)
            .orderBy('timestamp', 'desc')
            .get();
        const sales = [];
        salesSnapshot.forEach(doc => { sales.push(doc.data()); });
        res.status(200).json(sales);
    } catch (error) { res.status(500).json({ message: 'Error al obtener ventas del cliente' }); }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${port}`);
});
