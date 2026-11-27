const validate = (schema) => (req, res, next) => {
    try {
        const parsed = schema.parse({
            body: req.body,
            query: req.query,
            params: req.params
        });

        // Replace original with validated/cleaned/coerced data
        // En Express 5, req.query es un getter de solo lectura en el prototipo IncomingMessage:
        // usamos Object.defineProperty para exponer el objeto query validado/coerced sin TypeError.
        if (parsed.body !== undefined) {
            req.body = parsed.body;
        }
        if (parsed.query !== undefined) {
            Object.defineProperty(req, 'query', {
                value: parsed.query,
                configurable: true,
                enumerable: true,
                writable: true
            });
        }
        if (parsed.params !== undefined) {
            req.params = parsed.params;
        }

        return next();
    } catch (error) {
        console.error('Validation error:', error);

        // Compatibilidad plena con Zod v4 (.issues) y Zod v3 (.errors) sin exponer errores internos crudos
        const rawIssues = (error && Array.isArray(error.issues))
            ? error.issues
            : (error && Array.isArray(error.errors) ? error.errors : null);

        const details = rawIssues
            ? rawIssues.map((issue) => ({
                path: issue.path,
                code: issue.code,
                message: issue.message
            }))
            : [{ path: [], code: 'invalid_input', message: 'Datos de entrada inválidos' }];

        return res.status(400).json({
            error: 'Error de validación',
            details
        });
    }
};

module.exports = validate;