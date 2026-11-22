const { z } = require('zod');

const createBranchSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1, 'Nombre de sucursal obligatorio').max(150),
        address: z.string().trim().max(400).nullable().optional(),
        phone: z.string().trim().max(60).nullable().optional(),
        email: z.string().trim().max(160).nullable().optional(),
        code: z.string().trim().max(40).optional(),
        type: z.string().trim().max(40).optional(),
        managerName: z.string().trim().max(120).optional(),
        color: z.string().trim().max(80).optional(),
        invoicePrefix: z.string().trim().max(24).optional(),
        isMain: z.boolean().optional(),
        isActive: z.boolean().optional()
    }).passthrough()
});

const updateBranchSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1).max(150).optional(),
        address: z.string().trim().max(400).nullable().optional(),
        phone: z.string().trim().max(60).nullable().optional(),
        email: z.string().trim().max(160).nullable().optional(),
        code: z.string().trim().max(40).optional(),
        type: z.string().trim().max(40).optional(),
        isMain: z.boolean().optional(),
        isActive: z.boolean().optional()
    }).passthrough()
});

const switchBranchSchema = z.object({
    body: z.object({
        branchId: z.coerce.string().trim().max(128).nullable().optional()
    }).passthrough()
});

module.exports = {
    createBranchSchema,
    updateBranchSchema,
    switchBranchSchema
};
