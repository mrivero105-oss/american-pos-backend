const { z } = require('zod');

const createExpenseSchema = z.object({
    body: z.object({
        description: z.string().trim().min(1, 'Descripción obligatoria').max(500),
        amount: z.coerce.number().positive('El monto del gasto debe ser mayor a 0'),
        currency: z.string().trim().max(16).optional(),
        category: z.string().trim().max(120).optional(),
        paymentMethod: z.string().trim().max(60).optional(),
        date: z.string().trim().max(60).optional(),
        notes: z.string().max(1000).optional()
    }).passthrough()
});

const updateExpenseSchema = z.object({
    body: z.object({
        description: z.string().trim().min(1).max(500).optional(),
        amount: z.coerce.number().positive('El monto del gasto debe ser mayor a 0').optional(),
        currency: z.string().trim().max(16).optional(),
        category: z.string().trim().max(120).optional(),
        paymentMethod: z.string().trim().max(60).optional(),
        date: z.string().trim().max(60).optional(),
        notes: z.string().max(1000).optional()
    }).passthrough()
});

const syncExpensesSchema = z.object({
    body: z.object({
        expenses: z.array(z.object({
            description: z.string().trim().min(1).max(500),
            amount: z.coerce.number().positive()
        }).passthrough()).max(500)
    }).passthrough()
});

module.exports = {
    createExpenseSchema,
    updateExpenseSchema,
    syncExpensesSchema
};
