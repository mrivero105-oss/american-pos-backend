const express = require('express');
const router = express.Router();
const PayrollService = require('../services/PayrollService');
const { Employee, PayrollPeriod, PayrollReceipt } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const { requirePermission } = require('../middleware/auth');

router.use(requirePermission('canManagePayroll'));

// Listar empleados
router.get('/employees', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const employees = await Employee.findAll({
            where: { companyId },
            order: [['lastName', 'ASC'], ['firstName', 'ASC']]
        });
        res.json({ success: true, employees });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Registrar nuevo empleado
router.post('/employees', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const {
            idCard, firstName, lastName, email, phone, position,
            department, hireDate, contractType, salaryType,
            baseSalary, foodAllowance, bankName, bankAccountNumber,
            status, userId, notes
        } = req.body;

        if (!idCard || !firstName || !lastName) {
            return res.status(400).json({ success: false, error: 'Cédula, nombre y apellido son obligatorios.' });
        }

        const employee = await Employee.create({
            id: generateRobustId(),
            companyId,
            idCard,
            firstName,
            lastName,
            email: email || '',
            phone: phone || '',
            position: position || 'Personal',
            department: department || 'VENTAS',
            hireDate: hireDate || new Date().toISOString().split('T')[0],
            contractType: contractType || 'INDEFINIDO',
            salaryType: salaryType || 'MONTHLY_USD',
            baseSalary: parseFloat(baseSalary) || 0,
            foodAllowance: parseFloat(foodAllowance) || 0,
            bankName: bankName || '',
            bankAccountNumber: bankAccountNumber || '',
            status: status || 'ACTIVE',
            userId: userId || null,
            notes: notes || ''
        });

        res.json({ success: true, employee });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Actualizar empleado
router.put('/employees/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { id } = req.params;
        const employee = await Employee.findOne({ where: { id, companyId } });
        if (!employee) return res.status(404).json({ success: false, error: 'Empleado no encontrado.' });

        await employee.update(req.body);
        res.json({ success: true, employee });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Listar períodos de nómina
router.get('/periods', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const periods = await PayrollPeriod.findAll({
            where: { companyId },
            order: [['startDate', 'DESC']]
        });
        res.json({ success: true, periods });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Crear nuevo período de nómina
router.post('/periods', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { periodName, frequency, startDate, endDate, paymentDate, exchangeRate } = req.body;

        if (!periodName || !startDate || !endDate || !paymentDate) {
            return res.status(400).json({ success: false, error: 'Nombre, fecha de inicio, fin y pago son obligatorios.' });
        }

        const period = await PayrollPeriod.create({
            id: generateRobustId(),
            companyId,
            periodName,
            frequency: frequency || 'QUINCENAL',
            startDate,
            endDate,
            paymentDate,
            exchangeRate: parseFloat(exchangeRate) || 1,
            status: 'OPEN'
        });

        res.json({ success: true, period });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Calcular nómina de un período
router.post('/periods/:id/calculate', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await PayrollService.calculatePeriod(id);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Cerrar y desembolsar período
router.post('/periods/:id/close', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || 'admin';
        const companyId = req.user?.companyId || 'default';

        const result = await PayrollService.closeAndDisbursePeriod(id, {
            userId,
            companyId
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Obtener recibos de un período
router.get('/periods/:id/receipts', async (req, res) => {
    try {
        const { id } = req.params;
        const receipts = await PayrollReceipt.findAll({
            where: { payrollPeriodId: id },
            include: [{ model: Employee, as: 'Employee' }],
            order: [[{ model: Employee, as: 'Employee' }, 'lastName', 'ASC']]
        });
        res.json({ success: true, receipts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Exportar archivo TXT bancario
router.get('/periods/:id/bank-txt', async (req, res) => {
    try {
        const { id } = req.params;
        const bankCode = req.query.bank || 'BANESCO';
        const result = await PayrollService.generateBankTxt(id, bankCode);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.content);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
