const { z } = require('zod');

const registerAssetSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1, 'Nombre del activo obligatorio').max(200),
        purchaseDate: z.string().trim().min(4, 'Fecha de adquisición obligatoria').max(40),
        purchaseCost: z.coerce.number().positive('El costo de compra debe ser mayor a 0'),
        category: z.string().trim().max(60).optional(),
        code: z.string().trim().max(60).nullable().optional(),
        salvageValue: z.coerce.number().min(0).optional(),
        usefulLifeMonths: z.coerce.number().int().positive().max(1200).optional(),
        location: z.string().trim().max(200).optional(),
        serialNumber: z.string().trim().max(120).optional()
    }).passthrough()
});

const depreciateAssetsSchema = z.object({
    body: z.object({
        period: z.string().trim().regex(/^\d{4}-\d{2}$/, 'El formato del período debe ser YYYY-MM')
    }).passthrough()
});

module.exports = {
    registerAssetSchema,
    depreciateAssetsSchema
};
