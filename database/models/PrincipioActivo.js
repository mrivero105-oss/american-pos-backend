const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection');

const PrincipioActivo = sequelize.define('PrincipioActivo', {
    id: { 
        type: DataTypes.INTEGER, 
        primaryKey: true, 
        autoIncrement: true 
    },
    nombre: { 
        type: DataTypes.STRING, 
        allowNull: false 
    },
    descripcion: { 
        type: DataTypes.TEXT,
        allowNull: true
    }
});

module.exports = PrincipioActivo;
