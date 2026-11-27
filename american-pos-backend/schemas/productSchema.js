const { z } = require('zod');

const numeric = z.coerce.number().nonnegative().default(0);
const numericAllowNegative = z.coerce.number().default(0);

const productSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'El nombre es obligatorio'),
        price: numeric,
        priceBs: numeric.optional(),
        cost: numeric,
        stockQuantity: numericAllowNegative,
        minStock: numeric,
        category: z.string().optional(),
        barcode: z.string().optional(),
        taxStatus: z.enum(['gravable', 'exento']).optional(),
        isSoldByWeight: z.boolean().optional(),
        stockUnit: z.string().optional(),
        supplierId: z.string().nullable().optional(),
        bulkUnitName: z.string().optional(),
        unitsPerBulk: numeric,
        margin: numericAllowNegative,
        bulkCost: numeric,
        bulkPrice: numeric.optional(),
        bulkPriceBs: numeric.optional(),
        bulkBarcode: z.string().nullable().optional(),
        midBulkUnitName: z.string().optional(),
        unitsPerMidBulk: numeric.optional(),
        midBulkCost: numeric.optional(),
        midBulkPrice: numeric.optional(),
        midBulkPriceBs: numeric.optional(),
        midBulkBarcode: z.string().nullable().optional(),
        imageUri: z.string().nullable().optional(),
        presentations: z.array(z.object({
            id: z.string().optional(),
            name: z.string(),
            factorConversion: z.coerce.number().positive(),
            price: numeric,
            cost: numeric.optional(),
            barcode: z.string().nullable().optional(),
            isDefaultPurchase: z.boolean().optional(),
            isDefaultSale: z.boolean().optional(),
            orderIndex: z.number().optional()
        })).optional()
    }).passthrough()
});

const productUpdateSchema = z.object({
    body: productSchema.shape.body.partial().passthrough()
});

const stockCountSchema = z.object({
    body: z.object({
        stockQuantity: z.coerce.number(),
        previousStock: z.coerce.number().optional(),
        reason: z.string().max(255).optional()
    }).passthrough()
});

module.exports = { productSchema, productUpdateSchema, stockCountSchema };
