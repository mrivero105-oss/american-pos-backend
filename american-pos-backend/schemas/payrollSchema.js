const { z } = require('zod');

const createEmployeeSchema = z.object({
    body: z.object({
        idCard: z.coerce.string().trim().min(1, 'Cédula obligatoria').max(40),
        firstName: z.string().trim().min(1, 'Nombre obligatorio').max(120),
        lastName: z.string().trim().min(1, 'Apellido obligatorio').max(120),
        email: z.string().trim().max(160).optional(),
        phone: z.string().trim().max(60).optional(),
        position: z.string().trim().max(120).optional(),
        department: z.string().trim().max(120).optional(),
        hireDate: z.string().trim().max(40).optional(),
        contractType: z.string().trim().max(40).optional(),
        salaryType: z.string().trim().max(40).optional(),
        baseSalary: z.coerce.number().min(0, 'El salario base no puede ser negativo').optional(),
        foodAllowance: z.coerce.number().min(0).optional(),
        status: z.string().trim().max(40).optional()
    }).passthrough()
});

const updateEmployeeSchema = z.object({
    body: z.object({
        idCard: z.coerce.string().trim().min(1).max(40).optional(),
        firstName: z.string().trim().min(1).max(120).optional(),
        lastName: z.string().trim().min(1).max(120).optional(),
        baseSalary: z.coerce.number().min(0).optional(),
        foodAllowance: z.coerce.number().min(0).optional(),
        status: z.string().trim().max(40).optional()
    }).passthrough()
});

const createPeriodSchema = z.object({
    body: z.object({
        periodName: z.string().trim().min(1, 'Nombre de período obligatorio').max(120),
        frequency: z.string().trim().max(40).optional(),
        startDate: z.string().trim().min(4, 'Fecha de inicio obligatoria').max(40),
        endDate: z.string().trim().min(4, 'Fecha de fin obligatoria').max(40),
        paymentDate: z.string().trim().min(4, 'Fecha de pago obligatoria').max(40),
        exchangeRate: z.coerce.number().positive('La tasa de cambio debe ser mayor a 0').optional()
    }).passthrough()
});

module.exports = {
    createEmployeeSchema,
    updateEmployeeSchema,
    createPeriodSchema
};
