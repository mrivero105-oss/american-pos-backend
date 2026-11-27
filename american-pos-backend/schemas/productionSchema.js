const { z } = require('zod');

const recipeItemSchema = z.object({
    componentProductId: z.string().trim().min(1, 'ID de insumo requerido').max(100),
    quantityRequired: z.coerce.number().positive('Cantidad requerida debe ser mayor a 0'),
    unit: z.string().trim().max(32).optional(),
    wastePercentage: z.coerce.number().min(0).max(100).optional()
});

const createRecipeSchema = z.object({
    body: z.object({
        recipeName: z.string().trim().min(1, 'Nombre de receta requerido').max(200),
        targetProductId: z.string().trim().min(1, 'Producto terminado requerido').max(100),
        yieldQuantity: z.coerce.number().positive().optional(),
        laborCost: z.coerce.number().min(0).optional(),
        overheadCost: z.coerce.number().min(0).optional(),
        isKit: z.boolean().optional(),
        instructions: z.string().max(5000).optional(),
        items: z.array(recipeItemSchema).min(1, 'La receta debe incluir al menos un insumo')
    })
});

const createProductionOrderSchema = z.object({
    body: z.object({
        bomId: z.string().trim().min(1, 'Receta (BOM) requerida').max(100),
        quantityPlanned: z.coerce.number().positive('Cantidad planificada debe ser mayor a 0'),
        warehouseSourceId: z.string().trim().max(100).nullable().optional(),
        warehouseDestId: z.string().trim().max(100).nullable().optional(),
        notes: z.string().max(1000).optional()
    })
});

const completeProductionOrderSchema = z.object({
    body: z.object({
        quantityActual: z.coerce.number().positive().optional(),
        notes: z.string().max(1000).optional()
    }).optional().default({})
});

module.exports = {
    createRecipeSchema,
    createProductionOrderSchema,
    completeProductionOrderSchema
};
