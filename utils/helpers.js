const fs = require('fs');
const { sequelize } = require('../database/connection');
const { SETTINGS_FILE, PAYMENT_METHODS_FILE, DB_FILE } = require('../config/paths');

/**
 * Generates a more robust ID to prevent collisions during high-speed operations.
 */
const generateRobustId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Helper functions for JSON persistence (Settings/Backup)
 */
const readJson = (file) => {
    if (!fs.existsSync(file)) {
        if (file === SETTINGS_FILE) return {};
        if (file === PAYMENT_METHODS_FILE) return [];
        if (file === DB_FILE) return { users: [], products: [], customers: [], sales: [] };
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error('Error reading JSON:', file, e);
        return null;
    }
};

const writeJson = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error writing JSON:', file, e);
    }
};

/**
 * Sanitizes an array of objects to include only the fields that REALLY exist in the SQLite table.
 */
const sanitizeForModel = async (model, dataArray, t) => {
    if (!dataArray || !Array.isArray(dataArray)) return { data: [], fields: [] };

    try {
        const queryOptions = t ? { transaction: t } : {};
        const [results] = await sequelize.query(`PRAGMA table_info(${model.getTableName()})`, queryOptions);
        const actualColumns = results.map(r => r.name);
        const actualColumnsSet = new Set(actualColumns);

        const sanitizedData = dataArray.map(item => {
            const sanitizedItem = {};
            Object.keys(item).forEach(key => {
                if (actualColumnsSet.has(key)) {
                    sanitizedItem[key] = item[key];
                }
            });
            return sanitizedItem;
        });

        return { data: sanitizedData, fields: actualColumns };
    } catch (error) {
        console.error(`Sanitization error for ${model.name}:`, error.message);
        return { data: dataArray, fields: Object.keys(model.getAttributes()) };
    }
};

/**
 * Robust bulkCreate that only inserts columns that REALLY exist in the DB.
 */
const bulkCreateResilient = async (model, dataArray, t) => {
    if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) return;
    const { data, fields } = await sanitizeForModel(model, dataArray, t);
    await model.bulkCreate(data, { fields, transaction: t });
};

/**
 * Helper to get user settings safely
 */
const getUserSettings = (allSettings, userId) => {
    return allSettings[userId] || { exchangeRate: 1.0, businessInfo: {} };
};

module.exports = {
    generateRobustId,
    readJson,
    writeJson,
    sanitizeForModel,
    bulkCreateResilient,
    getUserSettings
};
