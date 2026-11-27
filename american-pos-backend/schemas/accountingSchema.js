const { z } = require('zod');

const createAccountSchema = z.object({
    body: z.object({
        code: z.string().trim().min(1, 'Código contable requerido').max(60),
        name: z.string().trim().min(1, 'Nombre de cuenta requerido').max(200),
        accountType: z.string().trim().min(1, 'Tipo de cuenta requerido').max(60),
        nature: z.enum(['DEBIT', 'CREDIT', 'DEUDORA', 'ACREEDORA']).optional(),
        parentId: z.coerce.string().nullable().optional(),
        isSelectable: z.boolean().optional(),
        description: z.string().max(1000).optional()
    }).passthrough()
});

const createEntrySchema = z.object({
    body: z.object({
        entryDate: z.string().trim().max(40).optional(),
        description: z.string().trim().max(1000).optional(),
        currency: z.string().trim().max(16).optional(),
        exchangeRate: z.coerce.number().positive('La tasa de cambio debe ser mayor a 0').optional(),
        lines: z.array(z.object({
            accountId: z.union([z.string(), z.number().transform(String)]).optional(),
            accountCode: z.string().trim().max(60).optional(),
            debit: z.coerce.number().min(0).optional(),
            credit: z.coerce.number().min(0).optional(),
            description: z.string().max(500).optional()
        }).passthrough()).min(2, 'Se requieren al menos 2 líneas para registrar el asiento contable.')
    }).passthrough()
});

module.exports = {
    createAccountSchema,
    createEntrySchema
};
