const validate = (schema) => (req, res, next) => {
    try {
        const parsed = schema.parse({
            body: req.body,
            query: req.query,
            params: req.params
        });

        // Replace original with validated/cleaned/coerced data
        req.body = parsed.body || req.body;
        req.query = parsed.query || req.query;
        req.params = parsed.params || req.params;

        return next();
    } catch (error) {
        console.error('Validation error:', error);
        
        // Ensure error response is robust even if error.errors is missing
        const details = (error && error.errors) ? error.errors : (error ? error.message : 'Error desconocido');
        
        return res.status(400).json({
            error: 'Error de validación',
            details: details
        });
    }
};

module.exports = validate;