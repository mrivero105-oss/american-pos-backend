const { z } = require('zod');

const createFiscalRecordSchema = z.object({
    body: z.object({
        bookType: z.string().trim().min(1, 'Tipo de libro obligatorio').max(40),
        recordDate: z.string().trim().min(4, 'Fecha obligatoria').max(40),
        documentNumber: z.coerce.string().trim().min(1, 'Número de documento obligatorio').max(80),
        documentType: z.string().trim().max(40).optional(),
        controlNumber: z.string().trim().max(80).optional(),
        entityRif: z.string().trim().max(60).optional(),
        entityName: z.string().trim().max(200).optional(),
        affectedInvoiceNumber: z.string().trim().max(80).optional(),
        totalAmount: z.coerce.number().optional(),
        exemptAmount: z.coerce.number().optional(),
        taxableBase: z.coerce.number().optional(),
        taxRate: z.coerce.number().min(0).max(100).optional(),
        taxAmount: z.coerce.number().optional(),
        retainedIvaAmount: z.coerce.number().min(0).optional(),
        igtfAmount: z.coerce.number().min(0).optional(),
        currency: z.string().trim().max(16).optional(),
        exchangeRate: z.coerce.number().positive().optional(),
        notes: z.string().max(1000).optional()
    }).passthrough()
});

const createRetentionSchema = z.object({
    body: z.object({
        voucherNumber: z.string().trim().max(80).optional(),
        recordDate: z.string().trim().max(40).optional(),
        retentionCategory: z.string().trim().max(60).optional(),
        taxType: z.string().trim().max(40).optional(),
        entityName: z.string().trim().max(200).optional(),
        entityRif: z.string().trim().max(60).optional(),
        invoiceNumber: z.coerce.string().trim().max(80).optional(),
        baseAmount: z.coerce.number().min(0).optional(),
        taxAmount: z.coerce.number().min(0).optional(),
        retentionPercentage: z.coerce.number().min(0).max(100).optional(),
        retainedAmount: z.coerce.number().min(0).optional(),
        exchangeRate: z.coerce.number().positive().optional()
    }).passthrough()
});

const issueCreditNoteSchema = z.object({
    body: z.object({
        saleId: z.coerce.string().nullable().optional(),
        branchId: z.coerce.string().nullable().optional(),
        customerId: z.coerce.string().nullable().optional(),
        totalAmount: z.coerce.number().positive('El monto total de la nota de crédito debe ser mayor a 0'),
        subtotal: z.coerce.number().min(0).optional(),
        taxAmount: z.coerce.number().min(0).optional(),
        exemptAmount: z.coerce.number().min(0).optional(),
        currency: z.string().trim().max(16).optional(),
        exchangeRate: z.coerce.number().positive().optional(),
        reenterStock: z.boolean().optional(),
        items: z.array(z.object({
            productId: z.coerce.string().optional(),
            quantity: z.coerce.number().positive().optional()
        }).passthrough()).optional()
    }).passthrough()
});

const fiscalActionSchema = z.object({
    body: z.object({
        action: z.string().trim().min(1, 'Acción fiscal requerida').max(60),
        saleId: z.coerce.string().nullable().optional(),
        targetType: z.string().trim().max(40).optional(),
        targetPort: z.string().trim().max(80).optional(),
        baudRate: z.coerce.number().int().positive().optional(),
        targetPrinter: z.string().trim().max(200).optional(),
        spoolerPath: z.string().trim().max(500).optional()
    }).passthrough()
});

module.exports = {
    createFiscalRecordSchema,
    createRetentionSchema,
    issueCreditNoteSchema,
    fiscalActionSchema
};
