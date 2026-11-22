const { z } = require('zod');

const exploreBackupSchema = z.object({
    body: z.object({
        customPath: z.string().trim().max(500).optional()
    }).optional().default({})
});

const encryptBackupSchema = z.object({
    body: z.object({
        filename: z.string().trim().min(1, 'Nombre de archivo requerido').max(255),
        password: z.string().max(256).optional()
    })
});

const restorePathSchema = z.object({
    body: z.object({
        filePath: z.string().trim().min(1, 'Ruta de respaldo requerida').max(600)
    })
});

const cloudMirrorSyncSchema = z.object({
    body: z.object({
        filename: z.string().trim().max(255).optional()
    }).optional().default({})
});

module.exports = {
    exploreBackupSchema,
    encryptBackupSchema,
    restorePathSchema,
    cloudMirrorSyncSchema
};
