const { z } = require('zod');

const numeric = z.coerce.number().nonnegative().default(0);

const saleSchema = z.object({
    body: z.object({
        items: z.array(z.object({
            productId: z.coerce.string().optional(),
            id: z.coerce.string().optional(),
            name: z.string(),
            originalName: z.string().optional(),
            quantity: z.coerce.number().positive(),
            price: numeric,
            cost: numeric.optional(),
            category: z.string().optional(),
            isCustom: z.boolean().optional(),
            isBulk: z.boolean().optional(),
            unitsPerBulk: numeric.optional(),
            bulkPrice: numeric.optional(),
            bulkUnitName: z.string().optional(),
            isMidBulk: z.boolean().optional(),
            unitsPerMidBulk: numeric.optional(),
            midBulkPrice: numeric.optional(),
            midBulkUnitName: z.string().optional(),
            promoDiscount: numeric.optional(),
            appliedPromoName: z.string().nullable().optional(),
            finalUnitPrice: numeric.optional(),
            presentationId: z.string().nullable().optional(),
            presentationName: z.string().nullable().optional(),
            factorConversion: numeric.optional(),
        }).passthrough()).min(1, 'La venta debe tener al menos un producto'),
        customerId: z.coerce.string().nullable().optional(),
        customerName: z.string().nullable().optional(),
        paymentMethod: z.string().optional(),
        paymentMethods: z.array(z.any()).optional(),
        total: numeric,
        subtotal: numeric,
        tax: numeric,
        discount: numeric,
        receivedAmount: numeric,
        changeAmount: numeric,
        igtfAmount: numeric,
        taxInfo: z.any().optional(),
        documentType: z.enum(['factura', 'nota_entrega']).optional(),
        registerId: z.coerce.string().optional()
    }).passthrough()
});

module.exports = { saleSchema };
