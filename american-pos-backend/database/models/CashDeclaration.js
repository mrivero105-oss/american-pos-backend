const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const CashDeclaration = sequelize.define('CashDeclaration', {
    id: { type: DataTypes.STRING, primaryKey: true },
    shiftId: { type: DataTypes.STRING, allowNull: false },
    userId: { type: DataTypes.STRING, allowNull: false },
    companyId: { type: DataTypes.STRING, allowNull: false },
    
    // Lo que el cajero cuenta físicamente
    declaredCashUSD: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    declaredCashVES: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    declaredZelle: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    declaredCard: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 }, // Punto de Venta
    declaredMobile: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 }, // Pago Movil
    
    // Lo que el sistema calcula
    expectedCashUSD: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    expectedCashVES: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    expectedZelle: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    expectedCard: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    expectedMobile: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },

    // Descuadres (Declarado - Esperado)
    differenceUSD: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    differenceVES: { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
    
    // Huella inmutable (Firma digital simple)
    hash: { type: DataTypes.STRING },
    notes: { type: DataTypes.TEXT }
});

module.exports = CashDeclaration;
