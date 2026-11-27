const { z } = require('zod');

const createLotSchema = z.object({
    body: z.object({
        productId: z.coerce.string().trim().min(1, 'ID de producto obligatorio').max(128),
        lotNumber: z.string().trim().min(1, 'Número de lote obligatorio').max(120),
        quantity: z.coerce.number().min(0, 'La cantidad del lote no puede ser negativa'),
        expirationDate: z.string().trim().max(40).nullable().optional(),
        cost: z.coerce.number().min(0).optional(),
        supplierId: z.coerce.string().nullable().optional(),
        status: z.string().trim().max(40).optional()
    }).passthrough()
});

const updateLotSchema = z.object({
    body: z.object({
        productId: z.coerce.string().trim().min(1).max(128).optional(),
        lotNumber: z.string().trim().min(1).max(120).optional(),
        quantity: z.coerce.number().min(0, 'La cantidad del lote no puede ser negativa').optional(),
        expirationDate: z.string().trim().max(40).nullable().optional(),
        cost: z.coerce.number().min(0).optional(),
        supplierId: z.coerce.string().nullable().optional(),
        status: z.string().trim().max(40).optional()
    }).passthrough()
});

const writeOffLotSchema = z.object({
    body: z.object({
        reason: z.string().trim().max(300).optional(),
        notes: z.string().trim().max(1000).optional(),
        quantity: z.coerce.number().positive('La cantidad de baja debe ser mayor a 0').nullable().optional(),
        responsibleName: z.string().trim().max(120).optional()
    }).passthrough().optional().default({})
});

const lotPromoSchema = z.object({
    body: z.object({
        discountPercentage: z.coerce.number().min(1).max(99).optional(),
        promoDays: z.coerce.number().int().min(1).max(365).optional(),
        customName: z.string().trim().max(160).nullable().optional()
    }).passthrough().optional().default({})
});

module.exports = {
    createLotSchema,
    updateLotSchema,
    writeOffLotSchema,
    lotPromoSchema
};
