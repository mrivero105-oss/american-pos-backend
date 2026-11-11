const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const Employee = sequelize.define('Employee', {
    id: { type: DataTypes.STRING, primaryKey: true },
    companyId: { type: DataTypes.STRING, allowNull: false, defaultValue: 'default' },
    idCard: { type: DataTypes.STRING, allowNull: false }, // Cédula ej: V-18452910
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, defaultValue: '' },
    phone: { type: DataTypes.STRING, defaultValue: '' },
    position: { type: DataTypes.STRING, defaultValue: 'Personal' }, // Cargo
    department: { type: DataTypes.STRING, defaultValue: 'VENTAS' }, // 'VENTAS', 'ALMACEN', 'ADMINISTRACION', 'OPERACIONES'
    hireDate: { type: DataTypes.STRING, defaultValue: '' }, // YYYY-MM-DD
    contractType: { type: DataTypes.STRING, defaultValue: 'INDEFINIDO' }, // 'INDEFINIDO', 'TEMPORAL', 'HONORARIOS'
    salaryType: { type: DataTypes.STRING, defaultValue: 'MONTHLY_USD' }, // 'MONTHLY_USD', 'MONTHLY_VES', 'BIWEEKLY_USD'
    baseSalary: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('baseSalary');
            return val === null ? 0 : parseFloat(val);
        }
    },
    foodAllowance: { 
        type: DataTypes.DECIMAL(20, 6), 
        defaultValue: 0,
        get() {
            const val = this.getDataValue('foodAllowance');
            return val === null ? 0 : parseFloat(val);
        }
    },
    bankName: { type: DataTypes.STRING, defaultValue: '' }, // Ej: Banesco, Banco de Venezuela
    bankAccountNumber: { type: DataTypes.STRING, defaultValue: '' }, // 20 dígitos
    status: { type: DataTypes.STRING, defaultValue: 'ACTIVE' }, // 'ACTIVE', 'VACATION', 'LEAVE', 'TERMINATED'
    userId: { type: DataTypes.STRING, allowNull: true }, // Relación con usuario POS si comisiona
    notes: { type: DataTypes.TEXT, defaultValue: '' }
}, {
    timestamps: true,
    tableName: 'Employees'
});

module.exports = Employee;
