const { z } = require('zod');

const positiveRateSchema = z.object({
    body: z.object({
        rate: z.coerce.number().positive('La tasa debe ser mayor a 0').max(100000000),
        currencyMode: z.enum(['BOTH', 'SINGLE', 'USD', 'VES']).or(z.string().trim().max(20)).optional(),
        autoUpdateRate: z.boolean().optional()
    })
});

const taxesSchema = z.object({
    body: z.object({
        ivaEnabled: z.boolean().optional(),
        ivaRate: z.coerce.number().min(0).max(100).optional(),
        igtfEnabled: z.boolean().optional(),
        igtfRate: z.coerce.number().min(0).max(100).optional()
    }).passthrough()
});

const paymentMethodsSchema = z.object({
    body: z.object({
        paymentMethods: z.array(z.object({
            id: z.string().trim().min(1).max(80),
            name: z.string().trim().min(1).max(120)
        }).passthrough())
    })
});

const setupSchema = z.object({
    body: z.object({
        country: z.string().trim().min(1, 'El país es requerido').max(80),
        businessName: z.string().trim().max(200).optional()
    }).passthrough()
});

const regionSchema = z.object({
    body: z.object({
        country: z.string().trim().min(1, 'País requerido').max(80)
    })
});

const autoLaunchSchema = z.object({
    body: z.object({
        enabled: z.boolean()
    })
});

const printRawSchema = z.object({
    body: z.object({
        printerName: z.string().trim().max(200).nullable().optional(),
        content: z.string().min(1, 'Contenido de impresión requerido').max(200000),
        printMode: z.string().trim().max(40).optional(),
        autoPrint: z.boolean().optional()
    })
});

const networkPrinterSchema = z.object({
    body: z.object({
        ip: z.string().trim().min(1).max(255).optional(),
        host: z.string().trim().min(1).max(255).optional(),
        port: z.coerce.number().int().min(1).max(65535).optional(),
        type: z.string().trim().max(40).optional()
    }).passthrough()
});

const dbConfigSchema = z.object({
    body: z.object({
        mode: z.enum(['server', 'client']).optional(),
        dialect: z.enum(['postgres']).optional(),
        host: z.string().trim().max(255).optional(),
        port: z.coerce.number().int().min(1).max(65535).optional(),
        database: z.string().trim().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/, 'Nombre de BD inválido').optional(),
        user: z.string().trim().min(1).max(63).optional(),
        password: z.string().max(256).nullable().optional()
    })
});

module.exports = {
    positiveRateSchema,
    taxesSchema,
    paymentMethodsSchema,
    setupSchema,
    regionSchema,
    autoLaunchSchema,
    printRawSchema,
    networkPrinterSchema,
    dbConfigSchema
};
