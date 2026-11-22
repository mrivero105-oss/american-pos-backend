const { z } = require('zod');

const createSupplierSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1, 'Nombre de proveedor requerido').max(200),
        contactName: z.string().trim().max(160).optional(),
        contact: z.string().trim().max(160).optional(),
        phone: z.string().trim().max(60).optional(),
        email: z.string().trim().max(180).optional(),
        address: z.string().trim().max(400).optional(),
        rif: z.string().trim().max(60).optional(),
        category: z.string().trim().max(120).optional(),
        notes: z.string().max(2000).optional(),
        creditLimit: z.coerce.number().min(0).optional(),
        debt: z.coerce.number().min(0).optional(),
        creditBalance: z.coerce.number().optional()
    }).passthrough()
});

const updateSupplierSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1).max(200).optional(),
        contactName: z.string().trim().max(160).optional(),
        contact: z.string().trim().max(160).optional(),
        phone: z.string().trim().max(60).optional(),
        email: z.string().trim().max(180).optional(),
        address: z.string().trim().max(400).optional(),
        rif: z.string().trim().max(60).optional(),
        category: z.string().trim().max(120).optional(),
        notes: z.string().max(2000).optional()
    }).passthrough()
});

const supplierInvoiceSchema = z.object({
    body: z.object({
        supplierId: z.string().trim().min(1, 'ID de proveedor requerido').max(100),
        amount: z.coerce.number().positive('El monto de la factura debe ser mayor a 0'),
        referenceNumber: z.string().trim().max(100).optional(),
        arrivalDate: z.string().trim().max(40).optional(),
        dueDate: z.string().trim().max(40).nullable().optional(),
        exchangeRate: z.coerce.number().positive().optional(),
        notes: z.string().max(1000).optional(),
        currency: z.string().trim().max(16).optional(),
        invoiceUrl: z.string().trim().max(500).optional()
    }).passthrough()
});

const supplierPaymentSchema = z.object({
    body: z.object({
        amount: z.coerce.number().positive('El monto del pago debe ser mayor a 0'),
        paymentMethod: z.string().trim().max(60).optional(),
        currency: z.string().trim().max(16).optional(),
        exchangeRate: z.coerce.number().positive().optional(),
        notes: z.string().max(1000).optional(),
        description: z.string().max(1000).optional(),
        referenceNumber: z.string().trim().max(120).optional()
    }).passthrough()
});

const supplierProductsSyncSchema = z.object({
    body: z.object({
        productIds: z.array(z.string().trim().min(1).max(100))
    })
});

module.exports = {
    createSupplierSchema,
    updateSupplierSchema,
    supplierInvoiceSchema,
    supplierPaymentSchema,
    supplierProductsSyncSchema
};
