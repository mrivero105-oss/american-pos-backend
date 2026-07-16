const express = require('express');
const router = express.Router();
const { readJson, writeJson, getUserSettings } = require('../utils/helpers');
const { isAdmin } = require('../middleware/auth');
const { SETTINGS_FILE, PAYMENT_METHODS_FILE } = require('../config/paths');
const cache = require('../utils/cacheService');
const { User } = require('../database/models');

const getCachedSettings = () => {
    let settings = cache.get('all_settings');
    if (!settings) {
        settings = readJson(SETTINGS_FILE);
        cache.set('all_settings', settings, 3600); // cache for 1 hour
    }
    return settings;
};

const COUNTRY_PRESETS = {
    'venezuela': {
        exchangeRate: 36.5,
        currencyMode: 'BOTH',
        taxConfig: { ivaEnabled: true, ivaRate: 16.0, igtfEnabled: true, igtfRate: 3.0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo $', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'cash_bs', name: 'Efectivo Bs', icon: 'DollarSign', type: 'CASH', currency: 'VES' },
            { id: 'debit', name: 'Punto de Venta', icon: 'CreditCard', type: 'DIGITAL', currency: 'VES' },
            { id: 'pago_movil', name: 'Pago Móvil', icon: 'Smartphone', type: 'DIGITAL', currency: 'VES' },
            { id: 'zelle', name: 'Zelle', icon: 'Send', type: 'DIGITAL', currency: 'USD' },
            { id: 'fiado', name: 'Crédito / Fiado', icon: 'User', type: 'CREDIT', currency: 'USD' }
        ]
    },
    'colombia': {
        exchangeRate: 3950,
        currencyMode: 'SINGLE',
        taxConfig: { ivaEnabled: true, ivaRate: 19.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo COP', icon: 'DollarSign', type: 'CASH', currency: 'COP' },
            { id: 'debit', name: 'Tarjeta Débito', icon: 'CreditCard', type: 'DIGITAL', currency: 'COP' },
            { id: 'nequi', name: 'Nequi / Daviplata', icon: 'Smartphone', type: 'DIGITAL', currency: 'COP' },
            { id: 'fiado', name: 'Crédito', icon: 'User', type: 'CREDIT', currency: 'COP' }
        ]
    },
    'usa': {
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        taxConfig: { ivaEnabled: true, ivaRate: 7.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Cash', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'card', name: 'Credit Card', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
            { id: 'zelle', name: 'Zelle / Venmo', icon: 'Send', type: 'DIGITAL', currency: 'USD' }
        ]
    },
    'panama': {
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        taxConfig: { ivaEnabled: true, ivaRate: 7.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo (USD)', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'card', name: 'Tarjeta de Crédito', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
            { id: 'yappy', name: 'Yappy', icon: 'Smartphone', type: 'DIGITAL', currency: 'USD' }
        ]
    },
    'ecuador': {
        exchangeRate: 1.0,
        currencyMode: 'SINGLE',
        taxConfig: { ivaEnabled: true, ivaRate: 15.0, igtfEnabled: false, igtfRate: 0 },
        paymentMethods: [
            { id: 'cash', name: 'Efectivo (USD)', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
            { id: 'card', name: 'Tarjeta / Débito', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
            { id: 'transfer', name: 'Transferencia', icon: 'Smartphone', type: 'DIGITAL', currency: 'USD' },
            { id: 'fiado', name: 'Crédito', icon: 'User', type: 'CREDIT', currency: 'USD' }
        ]
    }
};

router.get('/rate', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const userSettings = getUserSettings(allSettings, req.user.companyId);

        const country = (userSettings.businessInfo?.country || '').toLowerCase().trim();
        const isSingleCountry = ['ecuador', 'usa', 'panama', 'colombia'].includes(country);
        const userCacheKey = `user_currency_${req.user.id}`;
        let currencyMode = isSingleCountry ? 'SINGLE' : cache.get(userCacheKey);

        if (!currencyMode) {
            const startDb = Date.now();
            const user = await User.findOne({ where: { id: req.user.id } });
            const dbTime = Date.now() - startDb;
            if (dbTime > 500) {
                console.warn(`[PERF] User.findOne took ${dbTime}ms`);
            }
            currencyMode = isSingleCountry ? 'SINGLE' : (userSettings.currencyMode || (user ? user.defaultCurrency : 'BOTH'));
            cache.set(userCacheKey, currencyMode, 300); // cache for 5 minutes
        }

        console.log(`[RATE DEBUG] GET /rate - User: ${req.user.id}, Company: ${req.user.companyId}, Rate: ${userSettings.exchangeRate}, Mode: ${currencyMode}`);

        res.json({
            rate: isSingleCountry ? 1.0 : (userSettings.exchangeRate || 1.0),
            currencyMode: currencyMode
        });
    } catch (error) {
        console.error('Get rate error:', error);
        res.status(500).json({ error: 'Error al obtener tasa' });
    }
});

router.post('/rate', isAdmin, async (req, res) => {
    try {
        console.log('Received rate update req.body:', req.body, 'user:', req.user.id);
        const { rate, currencyMode } = req.body;
        
        const parsedRate = parseFloat(rate);
        if (isNaN(parsedRate) || parsedRate <= 0) {
            return res.status(400).json({ error: 'La tasa de cambio debe ser un número mayor a 0' });
        }

        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId] || { exchangeRate: 1.0, businessInfo: {}, currencyMode: 'BOTH' };
        userSettings.exchangeRate = parsedRate;
        if (currencyMode) {
            userSettings.currencyMode = currencyMode;
        }
        allSettings[req.user.companyId] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings); // update cache
        // Invalidate user-specific currency cache so GET /rate returns the new value immediately
        cache.del(`user_currency_${req.user.id}`);

        // Emit socket event to notify all clients in the same company
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('settings_changed', { 
                type: 'rate', 
                exchangeRate: parseFloat(rate),
                currencyMode: currencyMode || userSettings.currencyMode
            });
        }

        res.json({ success: true, rate, currencyMode: userSettings.currencyMode });
    } catch (error) {
        console.error('Update rate error:', error);
        res.status(500).json({ error: 'Error al actualizar tasa' });
    }
});

router.get('/business', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = req.user?.companyId || 'default';
        const userSettings = getUserSettings(allSettings, companyId);
        res.json(userSettings.businessInfo || { businessMode: 'STANDARD' });
    } catch (error) {
        res.json({ businessMode: 'STANDARD' });
    }
});

router.post('/business', isAdmin, async (req, res) => {
    try {
        const info = req.body;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.businessInfo = info;
        if (info && info.country) {
            const c = info.country.toLowerCase().trim();
            if (['ecuador', 'usa', 'panama', 'colombia'].includes(c)) {
                userSettings.currencyMode = 'SINGLE';
                userSettings.exchangeRate = 1.0;
            } else if (c === 'venezuela') {
                userSettings.currencyMode = 'BOTH';
            }
            if (COUNTRY_PRESETS[c]) {
                if (COUNTRY_PRESETS[c].paymentMethods) {
                    userSettings.paymentMethods = COUNTRY_PRESETS[c].paymentMethods;
                }
                if (COUNTRY_PRESETS[c].taxConfig) {
                    userSettings.taxConfig = COUNTRY_PRESETS[c].taxConfig;
                }
            }
        }
        allSettings[req.user.companyId] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings); // update cache
        cache.del(`user_currency_${req.user.id}`);
        res.json({ success: true, businessInfo: info });
    } catch (error) {
        console.error('Update business info error:', error);
        res.status(500).json({ error: 'Error al actualizar info de negocio' });
    }
});

router.get('/payment-methods', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const userSettings = getUserSettings(allSettings, req.user.companyId);

        const country = (userSettings.businessInfo?.country || '').toLowerCase().trim();
        const isSingleCountry = ['ecuador', 'usa', 'panama', 'colombia'].includes(country);
        const isSingleMode = isSingleCountry || userSettings.currencyMode === 'SINGLE';

        let methods = userSettings.paymentMethods;

        if (!methods || !Array.isArray(methods) || methods.length === 0) {
            if (isSingleCountry && COUNTRY_PRESETS[country]?.paymentMethods) {
                methods = COUNTRY_PRESETS[country].paymentMethods;
            } else if (isSingleMode) {
                methods = [
                    { id: 'cash', name: 'Efectivo $', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
                    { id: 'card', name: 'Tarjeta / Débito', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
                    { id: 'transfer', name: 'Transferencia', icon: 'Smartphone', type: 'DIGITAL', currency: 'USD' },
                    { id: 'fiado', name: 'Crédito', icon: 'User', type: 'CREDIT', currency: 'USD' }
                ];
            } else {
                methods = [
                    { id: 'cash', name: 'Efectivo $', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
                    { id: 'cash_bs', name: 'Efectivo Bs', icon: 'DollarSign', type: 'CASH', currency: 'VES' },
                    { id: 'debit', name: 'Punto de Venta', icon: 'CreditCard', type: 'DIGITAL', currency: 'VES' },
                    { id: 'pago_movil', name: 'Pago Móvil', icon: 'Wallet', type: 'DIGITAL', currency: 'VES' },
                    { id: 'zelle', name: 'Zelle', icon: 'Send', type: 'DIGITAL', currency: 'USD' },
                    { id: 'transfer', name: 'Transferencia', icon: 'Send', type: 'DIGITAL', currency: 'VES' },
                    { id: 'fiado', name: 'Fiado', icon: 'User', type: 'CREDIT', currency: 'USD' }
                ];
            }
        }

        if (isSingleMode && Array.isArray(methods)) {
            methods = methods.filter(m => m.currency !== 'VES' && !m.id.includes('_bs'));
            if (methods.length === 0) {
                methods = COUNTRY_PRESETS[country]?.paymentMethods || [
                    { id: 'cash', name: 'Efectivo $', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
                    { id: 'card', name: 'Tarjeta / Débito', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
                    { id: 'transfer', name: 'Transferencia', icon: 'Smartphone', type: 'DIGITAL', currency: 'USD' }
                ];
            }
        }

        res.json(methods);
    } catch (error) {
        console.error('Get payment methods error:', error);
        res.status(500).json({ error: 'Error al obtener métodos de pago' });
    }
});

router.post('/payment-methods', isAdmin, async (req, res) => {
    try {
        const { paymentMethods } = req.body;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.paymentMethods = paymentMethods;
        allSettings[req.user.companyId] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings); // update cache
        res.json({ success: true, paymentMethods });
    } catch (error) {
        console.error('Update payment methods error:', error);
        res.status(500).json({ error: 'Error al actualizar métodos de pago' });
    }
});

router.get('/taxes', async (req, res) => {
    try {
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, req.user.companyId);
        const defaultTaxes = {
            ivaEnabled: true,
            ivaRate: 16.0,
            igtfEnabled: true,
            igtfRate: 3.0
        };
        res.json(userSettings.taxConfig || defaultTaxes);
    } catch (error) {
        console.error('Get taxes error:', error);
        res.status(500).json({ error: 'Error al obtener impuestos' });
    }
});

router.post('/taxes', isAdmin, async (req, res) => {
    try {
        const taxConfig = req.body;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.taxConfig = taxConfig;
        allSettings[req.user.companyId] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings); // update cache
        res.json({ success: true, taxConfig });
    } catch (error) {
        console.error('Update taxes error:', error);
        res.status(500).json({ error: 'Error al actualizar impuestos' });
    }
});

router.get('/is-setup', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId];
        // Forzamos que se muestre si no existe la bandera explícita de completado
        const isSetup = !!(userSettings && userSettings.wizardCompleted);
        res.json({ isSetup });
    } catch (error) {
        res.status(500).json({ error: 'Error al verificar configuración' });
    }
});

router.post('/setup', isAdmin, async (req, res) => {
    try {
        const { country, businessName } = req.body;
        if (!country) return res.status(400).json({ error: 'El país es requerido para la configuración' });
        
        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId] || { exchangeRate: 1.0, businessInfo: {} };

        const selectedPreset = COUNTRY_PRESETS[country.toLowerCase()] || COUNTRY_PRESETS['venezuela'];
        
        // Aplicar preset
        Object.assign(userSettings, selectedPreset);
        
        // Aplicar info de negocio básica
        userSettings.businessInfo = {
            name: businessName || 'Mi Negocio POS',
            rif: '',
            address: '',
            phone: '',
            email: req.user.email || '',
            receiptWidth: '80mm',
            country: country.toLowerCase()
        };

        allSettings[req.user.companyId] = userSettings;
        userSettings.wizardCompleted = true; // Marcar como completado
        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings);
        cache.del(`user_currency_${req.user.id}`);
        cache.del(`user_currency_${req.user?.id || 'default'}`);

        const io = req.app.get('io');
        if (io && req.user?.companyId) {
            io.to(req.user.companyId).emit('settings_changed', {
                type: 'region',
                country: country.toLowerCase(),
                currencyMode: selectedPreset.currencyMode,
                exchangeRate: selectedPreset.exchangeRate
            });
        }

        res.json({ success: true, settings: userSettings });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Error al configurar el sistema' });
    }
});

// Change region / country preset mid-lifecycle (from Settings page)
router.post('/region', isAdmin, async (req, res) => {
    try {
        const { country } = req.body;
        if (!country) return res.status(400).json({ error: 'País requerido' });

        const allSettings = getCachedSettings();
        const userSettings = allSettings[req.user.companyId] || { exchangeRate: 1.0, businessInfo: {} };

        const selectedPreset = COUNTRY_PRESETS[country.toLowerCase()];
        if (!selectedPreset) return res.status(400).json({ error: `País no soportado: ${country}` });

        // Apply preset fields (currency, taxes, payment methods) without overwriting business identity
        userSettings.exchangeRate = selectedPreset.exchangeRate;
        userSettings.currencyMode = selectedPreset.currencyMode;
        userSettings.taxConfig = selectedPreset.taxConfig;
        userSettings.paymentMethods = selectedPreset.paymentMethods;

        // Update country in businessInfo without resetting other business fields
        if (!userSettings.businessInfo) userSettings.businessInfo = {};
        userSettings.businessInfo.country = country.toLowerCase();

        allSettings[req.user.companyId] = userSettings;
        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings);

        // Invalidate user-specific currency cache
        cache.del(`user_currency_${req.user.id}`);

        // Emit socket event to notify all clients
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.companyId).emit('settings_changed', {
                type: 'region',
                country: country.toLowerCase(),
                currencyMode: selectedPreset.currencyMode,
                exchangeRate: selectedPreset.exchangeRate
            });
        }

        res.json({
            success: true,
            country: country.toLowerCase(),
            preset: selectedPreset,
            settings: userSettings
        });
    } catch (error) {
        console.error('Region change error:', error);
        res.status(500).json({ error: 'Error al cambiar la región' });
    }
});

router.get('/auto-launch', async (req, res) => {
    try {
        const { execSync } = require('child_process');
        let enabled = false;
        try {
            const regOutput = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS"', { encoding: 'utf-8' });
            if (regOutput && regOutput.includes('American POS')) {
                enabled = true;
            }
        } catch (e) {
            const allSettings = getCachedSettings();
            enabled = !!allSettings.autoLaunch;
        }
        res.json({ enabled });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estado de inicio automático' });
    }
});

router.post('/auto-launch', isAdmin, async (req, res) => {
    try {
        const { enabled } = req.body;
        const { execSync } = require('child_process');
        const os = require('os');
        const path = require('path');
        const fs = require('fs');

        let targetPath = process.execPath;
        if (targetPath.toLowerCase().includes('node.exe') || targetPath.toLowerCase().includes('electron.exe')) {
            const defaultInstallPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'AmericanPOS', 'American POS.exe');
            if (fs.existsSync(defaultInstallPath)) {
                targetPath = defaultInstallPath;
            }
        }

        if (enabled) {
            try {
                execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS" /t REG_SZ /d "\\"${targetPath}\\"" /f`, { stdio: 'ignore' });
            } catch (e) {
                console.error('Reg add error:', e);
            }
        } else {
            try {
                execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "American POS" /f`, { stdio: 'ignore' });
            } catch (e) {}
        }

        try {
            let settings = readJson(SETTINGS_FILE) || {};
            settings.autoLaunch = enabled;
            writeJson(SETTINGS_FILE, settings);
            cache.del('all_settings');
        } catch (e) {}

        res.json({ success: true, enabled });
    } catch (error) {
        console.error('Error setting auto-launch:', error);
        res.status(500).json({ error: 'Error al actualizar el inicio automático' });
    }
});

module.exports = router;
