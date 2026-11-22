const { z } = require('zod');

const openShiftSchema = z.object({
    body: z.object({
        registerId: z.union([z.string().max(64), z.number().transform(String)]).optional(),
        registerName: z.string().trim().max(120).optional(),
        initialAmount: z.coerce.number().min(0).optional(),
        initialAmountUsd: z.coerce.number().min(0).optional(),
        initialAmountBs: z.coerce.number().min(0).optional(),
        notes: z.string().max(1000).optional()
    }).passthrough()
});

const closeShiftSchema = z.object({
    body: z.object({
        registerId: z.union([z.string().max(64), z.number().transform(String)]).optional(),
        finalAmount: z.coerce.number().min(0).optional(),
        declaredUsd: z.coerce.number().min(0).optional(),
        declaredBs: z.coerce.number().min(0).optional(),
        notes: z.string().max(1000).optional()
    }).passthrough()
});

const cashMovementSchema = z.object({
    body: z.object({
        type: z.string().trim().min(1, 'Tipo de movimiento requerido').max(40),
        amount: z.coerce.number().positive('El monto del movimiento debe ser mayor a 0'),
        currency: z.string().trim().max(16).optional(),
        reason: z.string().trim().max(500).optional(),
        registerId: z.union([z.string().max(64), z.number().transform(String)]).optional(),
        registerName: z.string().trim().max(120).optional()
    }).passthrough()
});

const forceCloseShiftSchema = z.object({
    body: z.object({
        reason: z.string().trim().max(500).optional()
    }).optional().default({})
});

const registerNameSchema = z.object({
    body: z.object({
        registerName: z.string().trim().min(1, 'Nombre de caja requerido').max(120)
    })
});

const stationCategoriesSchema = z.object({
    body: z.object({
        shiftId: z.string().trim().max(100).optional(),
        registerId: z.union([z.string().max(64), z.number().transform(String)]).optional(),
        allowedCategories: z.array(z.string().trim().max(120)).optional(),
        allowedProducts: z.array(z.string().trim().max(100)).optional(),
        categories: z.array(z.string().trim().min(1).max(120)).optional()
    }).passthrough()
});

const drawerOpenEventSchema = z.object({
    body: z.object({
        reason: z.string().trim().max(500).optional(),
        registerId: z.union([z.string().max(64), z.number().transform(String)]).optional()
    }).optional().default({})
});

const alertStatusUpdateSchema = z.object({
    body: z.object({
        status: z.string().trim().min(1).max(40).optional(),
        resolutionNotes: z.string().trim().max(1000).optional()
    }).passthrough()
});

module.exports = {
    openShiftSchema,
    closeShiftSchema,
    cashMovementSchema,
    forceCloseShiftSchema,
    registerNameSchema,
    stationCategoriesSchema,
    drawerOpenEventSchema,
    alertStatusUpdateSchema
};
