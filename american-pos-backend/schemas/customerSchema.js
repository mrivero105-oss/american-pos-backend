const { z } = require('zod');

const customerSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
        idDocument: z.string().trim().max(80).nullable().optional(),
        email: z.string().trim().email('Email inválido').nullable().optional().or(z.literal('')),
        phone: z.string().trim().max(60).nullable().optional(),
        address: z.string().trim().max(400).nullable().optional(),
        creditLimit: z.coerce.number().nonnegative().default(0),
        notes: z.string().max(1000).nullable().optional(),
        isVip: z.boolean().optional(),
        isActive: z.boolean().optional(),
        priceTier: z.string().max(50).nullable().optional()
    }).passthrough()
});

const customerUpdateSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1, 'El nombre es obligatorio').max(200).optional(),
        idDocument: z.string().trim().max(80).nullable().optional(),
        email: z.string().trim().email('Email inválido').nullable().optional().or(z.literal('')),
        phone: z.string().trim().max(60).nullable().optional(),
        address: z.string().trim().max(400).nullable().optional(),
        creditLimit: z.coerce.number().nonnegative().optional(),
        notes: z.string().max(1000).nullable().optional(),
        isVip: z.boolean().optional(),
        isActive: z.boolean().optional(),
        priceTier: z.string().max(50).nullable().optional()
    }).passthrough()
});

module.exports = { customerSchema, customerUpdateSchema };
