const express = require('express');
const router = express.Router();
const supplierService = require('../services/SupplierService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Supplier } = require('../database/models');

const os = require('os');

// Ensure image directory dynamically in a writable location
const getUploadDir = () => {
    const baseDir = process.env.USER_DATA_PATH || os.tmpdir();
    const dir = path.join(baseDir, 'supplier_logos');

    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
};

// Setup Multer Storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, getUploadDir());
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'supplier-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de logo no permitido. Solo se aceptan imágenes.'));
        }
    }
});

/**
 * GET /public-list - Search and list active suppliers (Protected for Sync)
 */
router.get('/public-list', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const suppliers = await Supplier.findAll({
            where: { isActive: true, companyId },
            attributes: [
                'id', 'name', 'rif', 'phone', 'email', 'address', 
                'creditBalance', ['contact', 'contactPerson'], 'logoUri'
            ]
        });
        res.json(suppliers || []);
    } catch (error) {
        console.error('Public suppliers list error:', error);
        res.status(500).json({ error: `Error al obtener proveedores: ${error.message || error}` });
    }
});

// GET / - List all suppliers
router.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const role = req.user?.role || 'admin';
        const suppliers = await supplierService.getAllSuppliers(companyId, role);
        res.json(suppliers || []);
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({ error: `Error al obtener proveedores: ${error.message || error}` });
    }
});

// GET /export - Export suppliers (data only)
router.get('/export', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const role = req.user?.role || 'admin';
        const suppliers = await supplierService.getAllSuppliers(companyId, role);
        // Exclude internal IDs for cleaner export
        const exportData = suppliers.map(s => {
            const { id, userId, companyId, createdAt, updatedAt, ...rest } = s.toJSON();
            return rest;
        });
        res.json(exportData);
    } catch (error) {
        console.error('Export suppliers error:', error);
        res.status(500).json({ error: 'Error al exportar proveedores' });
    }
});

// POST / - Create supplier with logo
router.post('/', upload.single('logo'), async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const newSupplier = await supplierService.createSupplier(user, req.body, req.file);
        res.status(201).json(newSupplier);
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
});

// PUT /:id - Update supplier
router.put('/:id', upload.single('logo'), async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const updatedSupplier = await supplierService.updateSupplier(user, req.params.id, req.body, req.file);
        if (updatedSupplier) {
            res.json({ message: 'Proveedor actualizado', supplier: updatedSupplier });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
});

// DELETE /:id - Delete supplier
router.delete('/:id', async (req, res, next) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const success = await supplierService.deleteSupplier(user, req.params.id);
        if (success) {
            res.json({ success: true, message: 'Proveedor eliminado' });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        next(error);
    }
});

// GET /:id/credit-history - Supplier credit movements
router.get('/:id/credit-history', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { SupplierCreditHistory } = require('../database/models');
        const supplier = await supplierService.getSupplierById(req.params.id, companyId);
        if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });

        const history = await SupplierCreditHistory.findAll({
            where: { supplierId: req.params.id, companyId },
            order: [['timestamp', 'DESC']]
        });

        res.json({ supplier, history });
    } catch (error) {
        console.error('Supplier history error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// POST /:id/payment - Register payment to supplier
router.post('/:id/payment', async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const payment = await supplierService.registerPayment(user, req.params.id, req.body);
        res.json(payment);
    } catch (error) {
        console.error('Supplier payment error:', error);
        res.status(error.message === 'Proveedor no encontrado' ? 404 : 500).json({ error: error.message });
    }
});

// POST /:id/products - Synchronize products list
router.post('/:id/products', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        await supplierService.syncProducts(companyId, req.params.id, req.body.productIds);
        res.json({ success: true, message: 'Productos sincronizados exitosamente' });
    } catch (error) {
        console.error('Supplier products sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
