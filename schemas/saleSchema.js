const { z } = require('zod');

const numeric = z.coerce.number().nonnegative().default(0);

const saleSchema = z.object({
    body: z.object({
        items: z.array(z.object({
            productId: z.string().optional(),
            id: z.string().optional(),
            name: z.string(),
            quantity: z.coerce.number().positive(),
            price: numeric,
            isCustom: z.boolean().optional(),
        })).min(1, 'La venta debe tener al menos un producto'),
        customerId: z.string().nullable().optional(),
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
        registerId: z.string().optional()
    }).passthrough()
});

module.exports = { saleSchema };
