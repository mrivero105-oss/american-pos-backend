const { z } = require('zod');

const createDeliveryNoteSchema = z.object({
    body: z.object({
        items: z.array(z.object({
            productId: z.coerce.string().optional(),
            id: z.coerce.string().optional(),
            name: z.string().optional(),
            quantity: z.coerce.number().positive('La cantidad del ítem debe ser mayor a 0'),
            price: z.coerce.number().min(0).optional(),
            subtotal: z.coerce.number().min(0).optional(),
            factorConversion: z.coerce.number().positive().optional(),
            category: z.string().optional()
        }).passthrough()).min(1, 'El albarán debe incluir al menos un ítem'),
        total: z.coerce.number().min(0, 'El total del albarán no puede ser negativo'),
        subtotal: z.coerce.number().min(0).optional(),
        tax: z.coerce.number().min(0).optional(),
        customerId: z.coerce.string().nullable().optional(),
        customerName: z.string().nullable().optional(),
        paymentMethod: z.string().trim().max(60).optional()
    }).passthrough()
});

const convertDeliveryNoteSchema = z.object({
    body: z.object({
        paymentMethod: z.string().trim().min(1).max(60).optional()
    }).passthrough().optional().default({})
});

module.exports = {
    createDeliveryNoteSchema,
    convertDeliveryNoteSchema
};
