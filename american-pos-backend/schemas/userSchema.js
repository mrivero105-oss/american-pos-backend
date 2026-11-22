const { z } = require('zod');

const pinOrHash = z.union([
    z.string().trim().max(128),
    z.number().transform(String),
    z.null()
]);

const createUserSchema = z.object({
    body: z.object({
        email: z.string().trim().email('Correo electrónico inválido').max(180).optional().or(z.literal('')),
        username: z.string().trim().min(1).max(100).optional(),
        password: z.string().min(1, 'Contraseña requerida').max(256),
        role: z.string().trim().min(1).max(50).optional(),
        name: z.string().trim().max(160).optional(),
        status: z.enum(['active', 'inactive', 'suspended']).optional(),
        defaultCurrency: z.string().trim().max(16).optional(),
        activeBranchId: z.string().trim().max(100).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        avatarColor: z.string().trim().max(40).nullable().optional(),
        permissions: z.record(z.boolean()).optional(),
        supervisorPin: pinOrHash.optional()
    }).refine((d) => Boolean(d.email || d.username), {
        message: 'Se requiere correo electrónico o nombre de usuario'
    })
});

const updateUserSchema = z.object({
    body: z.object({
        email: z.string().trim().email('Correo electrónico inválido').max(180).optional(),
        username: z.string().trim().min(1).max(100).optional(),
        password: z.string().min(1).max(256).optional(),
        role: z.string().trim().min(1).max(50).optional(),
        name: z.string().trim().min(1).max(160).optional(),
        status: z.enum(['active', 'inactive', 'suspended']).optional(),
        defaultCurrency: z.string().trim().max(16).optional(),
        activeBranchId: z.string().trim().max(100).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        avatarColor: z.string().trim().max(40).nullable().optional(),
        permissions: z.record(z.boolean()).optional(),
        supervisorPin: pinOrHash.optional(),
        currentPin: z.union([z.string().max(128), z.number().transform(String)]).optional()
    })
});

const supervisorPinSchema = z.object({
    body: z.object({
        pin: z.union([z.string().trim().min(4).max(128), z.number().transform(String)]),
        currentPin: z.union([z.string().trim().min(1).max(128), z.number().transform(String)]).optional()
    })
});

module.exports = {
    createUserSchema,
    updateUserSchema,
    supervisorPinSchema
};
