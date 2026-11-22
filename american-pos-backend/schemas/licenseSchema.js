const { z } = require('zod');

const activateLicenseSchema = z.object({
    body: z.object({
        key: z.string().trim().min(1, 'Llave requerida').max(4096),
        machineId: z.string().trim().min(1).max(128).optional()
    }).passthrough()
});

const generateLicenseSchema = z.object({
    body: z.object({
        machineId: z.string().trim().min(1, 'Machine ID requerido').max(128),
        days: z.coerce.number().int().min(-1).max(36500).optional(),
        duration: z.coerce.number().int().min(-1).max(52560000).optional(),
        unit: z.enum(['days', 'minutes']).optional()
    }).passthrough()
});

const syncOnlineLicenseSchema = z.object({
    body: z.object({
        machineId: z.string().trim().max(128).optional()
    }).passthrough().optional().default({})
});

const onlineConfigSchema = z.object({
    body: z.object({
        gatewayUrl: z.string().trim().max(512).optional().default(''),
        vendorSecret: z.string().max(256).optional()
    }).passthrough()
});

module.exports = {
    activateLicenseSchema,
    generateLicenseSchema,
    syncOnlineLicenseSchema,
    onlineConfigSchema
};
