const fs = require('fs');
const fsPromises = require('fs').promises;
const { sequelize } = require('../database/connection');
const { SETTINGS_FILE, PAYMENT_METHODS_FILE, DB_FILE } = require('../config/paths');

const crypto = require('crypto');

/**
 * Generates an unshakeable cryptographic ID (UUID v4) to prevent collisions during high-speed/bulk operations.
 */
const generateRobustId = () => crypto.randomUUID();

let settingsCache = null;

/**
 * Helper functions for JSON persistence (Settings/Backup)
 */
const readJson = (file) => {
    if (file === SETTINGS_FILE && settingsCache) return settingsCache;
    if (!fs.existsSync(file)) return getDefaultJson(file);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (file === SETTINGS_FILE) settingsCache = data;
        return data;
    } catch (e) {
        console.error('Error reading JSON:', file, e);
        return null;
    }
};

const readJsonAsync = async (file) => {
    if (file === SETTINGS_FILE && settingsCache) return settingsCache;
    try {
        await fsPromises.access(file);
        const content = (await fsPromises.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
        const data = JSON.parse(content);
        if (file === SETTINGS_FILE) settingsCache = data;
        return data;
    } catch (e) {
        if (e.code === 'ENOENT') return getDefaultJson(file);
        console.error('Error reading JSON Async:', file, e);
        return null;
    }
};

const writeJson = (file, data) => {
    try {
        if (file === SETTINGS_FILE) settingsCache = data;
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error writing JSON:', file, e);
    }
};

const writeJsonAsync = async (file, data) => {
    try {
        if (file === SETTINGS_FILE) settingsCache = data;
        await fsPromises.writeFile(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error writing JSON Async:', file, e);
    }
};

const getDefaultJson = (file) => {
    if (file === SETTINGS_FILE) return {};
    if (file === PAYMENT_METHODS_FILE) return [];
    if (file === DB_FILE) return { users: [], products: [], customers: [], sales: [] };
    return null;
};

/**
 * Sanitizes an array of objects to include only the fields that REALLY exist in the SQLite table.
 */
const sanitizeForModel = async (model, dataArray, t) => {
    if (!dataArray || !Array.isArray(dataArray)) return { data: [], fields: [] };

    try {
        const queryOptions = t ? { transaction: t } : {};
        const qi = sequelize.getQueryInterface();
        const description = await qi.describeTable(model.getTableName(), queryOptions);
        const actualColumns = Object.keys(description);
        const actualColumnsSet = new Set(actualColumns);

        const sanitizedData = dataArray.map(item => {
            const sanitizedItem = {};
            Object.keys(item).forEach(key => {
                if (actualColumnsSet.has(key)) {
                    let val = item[key];
                    // Special case: empty string to null for nullable columns (prevents FK errors)
                    if (val === "" && description[key] && description[key].allowNull) {
                        val = null;
                    }
                    sanitizedItem[key] = val;
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
    try {
        await model.bulkCreate(data, {
            fields,
            transaction: t,
            validate: false,        // Skip JS-level validation (allowNull checks, etc.)
            ignoreDuplicates: true  // Skip records with duplicate primary keys
        });
    } catch (err) {
        // If bulk fails, try one-by-one to skip only the bad records
        console.warn(`[bulkCreateResilient] Bulk failed for ${model.name}, trying row-by-row. Error: ${err.message}`);
        let successCount = 0;
        for (const record of data) {
            try {
                await model.create(record, { transaction: t, validate: false });
                successCount++;
            } catch (rowErr) {
                console.warn(`[bulkCreateResilient] Skipping bad record in ${model.name}: ${rowErr.message}`);
            }
        }
        console.log(`[bulkCreateResilient] ${model.name}: saved ${successCount}/${data.length} records`);
    }
};

const fixMojibake = (str) => {
    if (!str || typeof str !== 'string') return str;
    return str
        .replace(/CrÃ©dito/gi, 'Crédito')
        .replace(/DÃ©bito/gi, 'Débito')
        .replace(/MÃ³vil/gi, 'Móvil')
        .replace(/Ã©/g, 'é')
        .replace(/Ã¡/g, 'á')
        .replace(/Ã­/g, 'í')
        .replace(/Ã³/g, 'ó')
        .replace(/Ãº/g, 'ú')
        .replace(/Ã±/g, 'ñ')
        .replace(/Ã‰/g, 'É')
        .replace(/Ã“/g, 'Ó')
        .replace(/Ã/g, 'Á');
};

/**
 * Helper to get user settings safely
 */
const getUserSettings = (allSettings, userId) => {
    if (!allSettings) return { exchangeRate: 1.0, businessInfo: {} };
    const settings = allSettings[userId] || allSettings['2'] || allSettings['default'] || Object.values(allSettings)[0] || { exchangeRate: 1.0, businessInfo: {} };
    if (settings && Array.isArray(settings.paymentMethods)) {
        settings.paymentMethods = settings.paymentMethods.map(pm => ({
            ...pm,
            name: fixMojibake(pm.name)
        }));
    }
    return settings;
};

module.exports = {
    generateRobustId,
    readJson,
    readJsonAsync,
    writeJson,
    writeJsonAsync,
    sanitizeForModel,
    bulkCreateResilient,
    getUserSettings,
    fixMojibake
};
