const { z } = require('zod');

const toggleBlockSchema = z.object({
    body: z.object({
        isBlocked: z.boolean().optional(),
        allowOverdueCredit: z.boolean().optional(),
        supervisorApprovalId: z.string().trim().max(128).nullable().optional(),
        notes: z.string().trim().max(500).optional()
    }).passthrough().optional().default({})
});

const logCollectionActionSchema = z.object({
    body: z.object({
        customerId: z.coerce.string().trim().min(1, 'ID del cliente obligatorio').max(128),
        actionType: z.string().trim().min(1).max(60).optional(),
        promisedDate: z.string().trim().max(40).nullable().optional(),
        promisedAmount: z.coerce.number().min(0, 'El monto prometido no puede ser negativo').optional(),
        notes: z.string().trim().max(2000).optional()
    }).passthrough()
});

module.exports = {
    toggleBlockSchema,
    logCollectionActionSchema
};
