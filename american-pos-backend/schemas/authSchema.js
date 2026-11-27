const { z } = require('zod');

const nonEmptySecret = z.union([
    z.string().min(1, 'Campo requerido').max(256),
    z.number().transform(String)
]);

const loginSchema = z.object({
    body: z.object({
        username: z.string().trim().min(1).max(160).optional(),
        email: z.string().trim().min(1).max(160).optional(),
        password: nonEmptySecret
    }).refine(
        (d) => Boolean((d.username && d.username.length > 0) || (d.email && d.email.length > 0)),
        { message: 'Debe proporcionar usuario o correo electrónico' }
    )
});

const quickUnlockSchema = z.object({
    body: z.object({
        pinOrPassword: nonEmptySecret
    })
});

const supervisorAuthorizeSchema = z.object({
    body: z.object({
        supervisorId: z.string().trim().min(1, 'Supervisor requerido').max(100),
        pin: nonEmptySecret.optional(),
        biometricToken: z.string().max(512).optional(),
        challengeId: z.string().trim().min(1).max(128).optional(),
        signature: z.string().trim().min(1).max(512).optional(),
        isBiometric: z.boolean().optional(),
        actionType: z.string().trim().min(1).max(120).optional(),
        referenceId: z.union([z.string(), z.number(), z.null()]).optional(),
        metadata: z.record(z.unknown()).optional()
    })
});

const changePinSchema = z.object({
    body: z.object({
        oldPin: nonEmptySecret,
        newPin: nonEmptySecret
    })
});

const setQuickPinSchema = z.object({
    body: z.object({
        pin: nonEmptySecret,
        currentPassword: nonEmptySecret.optional()
    })
});

module.exports = {
    loginSchema,
    quickUnlockSchema,
    supervisorAuthorizeSchema,
    changePinSchema,
    setQuickPinSchema
};
