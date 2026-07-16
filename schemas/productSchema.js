const { z } = require('zod');

const numeric = z.coerce.number().nonnegative().default(0);

const productSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'El nombre es obligatorio'),
        price: numeric,
        cost: numeric,
        stockQuantity: numeric,
        minStock: numeric,
        category: z.string().optional(),
        barcode: z.string().optional(),
        taxStatus: z.enum(['gravable', 'exento']).optional(),
        isSoldByWeight: z.boolean().optional(),
        stockUnit: z.string().optional(),
        supplierId: z.string().nullable().optional(),
        bulkUnitName: z.string().optional(),
        unitsPerBulk: numeric,
        margin: numeric,
        bulkCost: numeric,
        imageUri: z.string().optional()
    }).passthrough()
});

module.exports = { productSchema };
