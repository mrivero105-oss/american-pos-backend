const { z } = require('zod');

const customerSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'El nombre es obligatorio'),
        idDocument: z.string().optional(),
        email: z.string().email('Email inválido').nullable().optional().or(z.literal('')),
        phone: z.string().optional(),
        address: z.string().optional(),
        creditLimit: z.coerce.number().nonnegative().default(0),
        notes: z.string().optional()
    }).passthrough()
});

module.exports = { customerSchema };
