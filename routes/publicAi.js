const express = require('express');
const router = express.Router();
const AIService = require('../services/AIService');
const { z } = require('zod');

// Schema de validación
const aiQuerySchema = z.object({
    companyId: z.string().min(1, "El ID de compañía es requerido"),
    query: z.string().min(1, "El query no puede estar vacío").max(1000, "El query es demasiado largo"),
    history: z.array(z.object({
        role: z.enum(['user', 'model']),
        content: z.string()
    })).optional().default([])
});

// POST /
router.post('/', async (req, res) => {
    try {
        // Validación estricta con Zod
        const validatedData = aiQuerySchema.parse(req.body);
        const { companyId, query, history } = validatedData;

        const response = await AIService.askCustomerBot(companyId, query, history);
        res.json({ response });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ 
                error: 'Datos de entrada inválidos', 
                details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`) 
            });
        }
        
        console.error('[AI_PUBLIC_ROUTE_ERROR]', error);
        res.status(500).json({ error: 'Error interno al procesar la IA.' });
    }
});

module.exports = router;
