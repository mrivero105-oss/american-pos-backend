const express = require('express');
const router = express.Router();
const { readJson, writeJson, getUserSettings, normalizeCompanyId } = require('../utils/helpers');
const { verifyToken, isAdmin, requirePermission, computeDisplayPairingToken } = require('../middleware/auth');
const { BASE_PATH, SETTINGS_FILE, PAYMENT_METHODS_FILE } = require('../config/paths');
const cache = require('../utils/cacheService');
const { User } = require('../database/models');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const SettingsStoreService = require('../services/SettingsStoreService');
const validate = require('../middleware/validate');
const {
    positiveRateSchema,
    taxesSchema,
    paymentMethodsSchema,
    setupSchema,
    regionSchema,
    autoLaunchSchema,
    printRawSchema,
    networkPrinterSchema,
    dbConfigSchema
} = require('../schemas/settingsSchema');

const getCachedSettings = () => {
    let settings = cache.get('all_settings');
    if (!settings) {
        settings = readJson(SETTINGS_FILE);
        cache.set('all_settings', settings, 3600); // cache for 1 hour
    }
    return settings;
};

const {
    COUNTRY_PRESETS,
    normalizeCountry,
    getPresetKey,
    getRegionConfig,
    isVenezuelaCountry,
    isDollarOnlyCountry,
    isSingleCurrencyCountry,
    buildPublicRegionMetadata
} = require('../constants/regionPresets');

const SENSITIVE_SETTINGS_KEY_RE = /(password|pass|secret|apikey|api_key|servicekey|service_key|privatekey|private_key|accesstoken|access_token|refreshtoken|refresh_token|bottoken|bot_token|webhooktoken|webhook_token|synckey|sync_key|authkey|auth_key|smtppass|smtp_pass)/i;

const sanitizeSettingsForNonAdmin = (value) => {
    if (Array.isArray(value)) {
        return value.map(item => sanitizeSettingsForNonAdmin(item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const clean = {};
    for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_SETTINGS_KEY_RE.test(k)) {
            continue;
        }
        clean[k] = sanitizeSettingsForNonAdmin(v);
    }
    return clean;
};

router.get('/', verifyToken, async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId) || {};
        const role = String(req.user?.role || '').toLowerCase();
        const isPrivilegedSettingsReader =
            ['admin', 'superadmin', 'owner', 'dueño', 'master'].includes(role) ||
            req.user?.permissions?.canManageSettings === true;
        res.json(isPrivilegedSettingsReader ? userSettings : sanitizeSettingsForNonAdmin(userSettings));
    } catch (err) {
        console.error('Error in GET /settings:', err);
        res.status(500).json({ error: 'Error obteniendo configuración' });
    }
});

router.get('/rate', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);

        const country = userSettings.businessInfo?.country || '';
        const regionMeta = buildPublicRegionMetadata(country);
        const isVenezuela = isVenezuelaCountry(country);
        const isSingleCountry = isSingleCurrencyCountry(country);
        const userCacheKey = req.user?.id ? `user_currency_${req.user.id}` : null;
        let currencyMode = isSingleCountry ? 'SINGLE' : (userCacheKey ? cache.get(userCacheKey) : null);

        if (!currencyMode) {
            let user = null;
            if (req.user?.id) {
                const startDb = Date.now();
                user = await User.findOne({ where: { id: req.user.id } });
                const dbTime = Date.now() - startDb;
                if (dbTime > 500) {
                    console.warn(`[PERF] User.findOne took ${dbTime}ms`);
                }
            }
            currencyMode = isSingleCountry ? 'SINGLE' : (userSettings.currencyMode || (user ? user.defaultCurrency : 'BOTH'));
            if (userCacheKey) {
                cache.set(userCacheKey, currencyMode, 300); // cache for 5 minutes
            }
        }

        if (process.env.DEBUG_VERBOSE === 'true') {
            console.log(`[RATE DEBUG] GET /rate - User: ${req.user?.id || 'guest'}, Company: ${companyId}, Country: ${regionMeta.id}, Rate: ${userSettings.exchangeRate}, Mode: ${currencyMode}`);
        }

        // BCV aplica exclusivamente a Venezuela (nunca disparar scraping BCV en Ecuador, Colombia, Panamá o USA)
        if (isVenezuela && userSettings.autoUpdateRate !== false && !req.user?.isPublicContext && req.user?.role !== 'public_guest') {
            const lastSync = userSettings.lastRateSyncAt ? new Date(userSettings.lastRateSyncAt).getTime() : 0;
            if (Date.now() - lastSync > 1000 * 60 * 60) {
                const BCVAutoSyncService = require('../services/BCVAutoSyncService');
                BCVAutoSyncService.syncRate({ reason: 'AUTO_REFRESH_GET_RATE' }).catch(() => {});
            }
        }

        res.json({
            rate: isSingleCountry ? 1.0 : (userSettings.exchangeRate || 1.0),
            euroRate: isVenezuela ? (Number(userSettings.euroRate) || 0) : (regionMeta.currencyCode === 'EUR' ? 1.0 : 0),
            currencyMode: isSingleCountry ? 'SINGLE' : currencyMode,
            autoUpdateRate: isVenezuela ? (userSettings.autoUpdateRate !== false) : false,
            lastRateSyncAt: isVenezuela ? (userSettings.lastRateSyncAt || null) : null,
            rateSource: isVenezuela ? (userSettings.rateSource || 'BCV') : 'LOCAL',
            country: regionMeta.id,
            currencyCode: regionMeta.currencyCode,
            currencySymbol: regionMeta.currencySymbol,
            taxLabel: regionMeta.taxLabel,
            taxAuthority: regionMeta.taxAuthority,
            regionConfig: regionMeta
        });
    } catch (error) {
        console.error('Error getting rate:', error);
        res.status(500).json({ error: 'Error al obtener tasa' });
    }
});

const BCVRateService = require('../services/BCVRateService');
const BCVAutoSyncService = require('../services/BCVAutoSyncService');

router.get('/bcv', async (req, res) => {
    try {
        const result = await BCVRateService.getOfficialRate();
        res.json(result);
    } catch (error) {
        console.error('Error al consultar BCV:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/bcv/euro', async (req, res) => {
    try {
        const result = await BCVRateService.getCurrentEuroRate();
        res.json(result);
    } catch (error) {
        console.error('Error al consultar Euro BCV:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/bcv/sync', verifyToken, isAdmin, async (req, res) => {
    try {
        const callerName = req.user?.username || req.user?.name || req.user?.id || 'Admin';
        const result = await BCVAutoSyncService.syncRate({ force: true, reason: `MANUAL_API_TRIGGER (${callerName})` });
        res.json(result);
    } catch (error) {
        console.error('Error al sincronizar BCV:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

const BinanceRateService = require('../services/BinanceRateService');

router.get('/binance/rate', async (req, res) => {
    try {
        const result = await BinanceRateService.getRate();
        res.json(result);
    } catch (error) {
        console.error('Error al consultar tasa Binance P2P:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/binance', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);
        const bInfo = userSettings.businessInfo || {};
        const methods = userSettings.paymentMethods || [];
        const binMethod = methods.find(m => m.id === 'binance_usdt' || m.id === 'binance') || {};

        res.json({
            rate: userSettings.binanceRate || binMethod.binanceRate || 0,
            payId: binMethod.binancePayId || bInfo.binancePayId || '',
            email: binMethod.binanceEmail || bInfo.binanceEmail || '',
            qrImage: binMethod.binanceQrImage || bInfo.binanceQrImage || '',
            roundingToleranceBs: bInfo.binanceRoundingToleranceBs ?? userSettings.binanceRoundingToleranceBs ?? 0.50,
            igtfEnabled: userSettings.binanceIgtfEnabled ?? false
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener datos de Binance' });
    }
});

router.post('/binance/rate', validate(positiveRateSchema), async (req, res) => {
    try {
        const { isCompanyAdminRole } = require('../constants/roles');
        const hasPermission = req.user?.permissions?.canManageSettings;
        const isAuthorized = isCompanyAdminRole(req.user?.role) || hasPermission;
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de administrador o gestión de configuración' });
        }

        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const { rate } = req.body;
        const parsedRate = parseFloat(rate);
        if (isNaN(parsedRate) || parsedRate <= 0) {
            return res.status(400).json({ error: 'La tasa de Binance debe ser un número mayor a 0' });
        }

        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.binanceRate = parsedRate;
        allSettings[companyId] = userSettings;
        if (companyId === '2' && allSettings['default']) {
            allSettings['default'].binanceRate = parsedRate;
        }
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);

        const io = req.app.get('io') || global.io;
        if (io) {
            const payload = { type: 'binance_rate', binanceRate: parsedRate };
            io.to(companyId).emit('settings_changed', payload);
        }

        res.json({ success: true, rate: parsedRate });
    } catch (error) {
        console.error('Update binance rate error:', error);
        res.status(500).json({ error: 'Error al actualizar tasa de Binance' });
    }
});

router.post('/rate', validate(positiveRateSchema), async (req, res) => {
    try {
        const { isCompanyAdminRole } = require('../constants/roles');
        const hasPermission = req.user?.permissions?.canManageSettings;
        const isAuthorized = isCompanyAdminRole(req.user?.role) || hasPermission;
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de administrador o gestión de configuración' });
        }

        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const { rate, euroRate, currencyMode, autoUpdateRate } = req.body;
        
        const parsedRate = parseFloat(rate);
        if (isNaN(parsedRate) || parsedRate <= 0) {
            return res.status(400).json({ error: 'La tasa de cambio debe ser un número mayor a 0' });
        }
        const parsedEuroRate = euroRate !== undefined && euroRate !== null && euroRate !== '' ? parseFloat(euroRate) : null;
        if (parsedEuroRate !== null && (isNaN(parsedEuroRate) || parsedEuroRate <= 0)) {
            return res.status(400).json({ error: 'La tasa de Euro debe ser un número mayor a 0' });
        }

        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {}, currencyMode: 'BOTH' };
        userSettings.exchangeRate = parsedRate;
        if (parsedEuroRate !== null) {
            userSettings.euroRate = parsedEuroRate;
            userSettings.lastEuroRate = parsedEuroRate;
        }
        userSettings.lastRateSyncAt = new Date().toISOString();
        if (currencyMode) {
            userSettings.currencyMode = currencyMode;
        }
        if (autoUpdateRate !== undefined) {
            userSettings.autoUpdateRate = !!autoUpdateRate;
            userSettings.rateSource = userSettings.autoUpdateRate ? 'BCV' : 'MANUAL';
        }
        allSettings[companyId] = userSettings;
        if (companyId === '2') {
            allSettings['default'] = { 
                ...allSettings['default'], 
                exchangeRate: parsedRate,
                ...(parsedEuroRate !== null ? { euroRate: parsedEuroRate, lastEuroRate: parsedEuroRate } : {}),
                currencyMode: currencyMode || userSettings.currencyMode,
                autoUpdateRate: userSettings.autoUpdateRate,
                rateSource: userSettings.rateSource || (userSettings.autoUpdateRate ? 'BCV' : 'MANUAL'),
                lastRateSyncAt: userSettings.lastRateSyncAt
            };
        }
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);
        if (req.user?.id) {
            cache.del(`user_currency_${req.user.id}`);
        }

        // Sincronizar inmediatamente a la nube de Supabase (24/7)
        SupabaseSyncService.syncConfig(true).catch(err => {
            console.warn('[CloudRateSync] Error sincronizando a Supabase:', err.message);
        });

        // Emit socket event to notify all clients
        const io = req.app.get('io');
        if (io) {
            const payload = { 
                type: 'rate', 
                exchangeRate: parsedRate,
                euroRate: userSettings.euroRate || undefined,
                currencyMode: currencyMode || userSettings.currencyMode,
                autoUpdateRate: userSettings.autoUpdateRate
            };
            io.to(companyId).emit('settings_changed', payload);
        }

        res.json({
            success: true,
            rate: parsedRate,
            euroRate: userSettings.euroRate || null,
            currencyMode: userSettings.currencyMode,
            autoUpdateRate: userSettings.autoUpdateRate
        });
    } catch (error) {
        console.error('Update rate error:', error);
        res.status(500).json({ error: 'Error al actualizar tasa' });
    }
});

router.get('/business', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);
        const bInfo = userSettings.businessInfo || { businessMode: 'STANDARD' };
        const regionMeta = buildPublicRegionMetadata(bInfo.country);
        const isVenezuela = isVenezuelaCountry(bInfo.country);
        const taxCfg = userSettings.taxConfig || {};
        const igtfEnabledVal = isVenezuela
            ? (taxCfg.igtfEnabled !== undefined ? Boolean(taxCfg.igtfEnabled) : Boolean(userSettings.igtfEnabled))
            : false;
        const igtfRateVal = isVenezuela ? (Number(taxCfg.igtfRate ?? userSettings.igtfRate ?? 3) || 0) : 0;
        const ivaEnabledVal = taxCfg.ivaEnabled !== undefined
            ? Boolean(taxCfg.ivaEnabled)
            : (userSettings.ivaEnabled !== false);
        const defaultCountryIva = getRegionConfig(bInfo.country).taxConfig.ivaRate;
        const ivaRateVal = Number(taxCfg.ivaRate ?? userSettings.ivaRate ?? defaultCountryIva) || 0;
        
        const methods = userSettings.paymentMethods || [];
        const pmMethod = methods.find(m => m.id === 'pago_movil' || m.pagoMovilBank || m.pagoMovilPhone || m.pagoMovilId) || {};

        res.json({
            ...bInfo,
            regionConfig: regionMeta,
            currencyCode: regionMeta.currencyCode,
            currencySymbol: regionMeta.currencySymbol,
            taxLabel: regionMeta.taxLabel,
            taxAuthority: regionMeta.taxAuthority,
            taxConfig: {
                ...taxCfg,
                ivaEnabled: ivaEnabledVal,
                ivaRate: ivaRateVal,
                igtfEnabled: igtfEnabledVal,
                igtfRate: igtfRateVal
            },
            ivaEnabled: ivaEnabledVal,
            ivaRate: ivaRateVal,
            igtfEnabled: igtfEnabledVal,
            igtfRate: igtfRateVal,
            broadcastPrintingEnabled: bInfo.broadcastPrintingEnabled === true,
            networkPrinterEnabled: bInfo.networkPrinterEnabled === true,
            pagoMovilBank: bInfo.pagoMovilBank || pmMethod.pagoMovilBank || '',
            pagoMovilPhone: bInfo.pagoMovilPhone || pmMethod.pagoMovilPhone || '',
            pagoMovilId: bInfo.pagoMovilId || pmMethod.pagoMovilId || '',
            pagoMovilQrMode: bInfo.pagoMovilQrMode || pmMethod.pagoMovilQrMode || 'AUTO',
            pagoMovilQrImage: bInfo.pagoMovilQrImage || pmMethod.pagoMovilQrImage || '',
            pagoMovilIncludeAmount: pmMethod.pagoMovilIncludeAmount !== false,
            binancePayId: bInfo.binancePayId || '',
            binanceEmail: bInfo.binanceEmail || '',
            binanceRate: userSettings.binanceRate || 0,
            euroRate: isVenezuela ? (Number(userSettings.euroRate) || 0) : (regionMeta.currencyCode === 'EUR' ? 1.0 : 0),
            binanceQrImage: bInfo.binanceQrImage || '',
            binanceRoundingToleranceBs: bInfo.binanceRoundingToleranceBs ?? userSettings.binanceRoundingToleranceBs ?? 0.50,
            binanceIgtfEnabled: userSettings.binanceIgtfEnabled ?? false,
            cashDifferenceToleranceUsd: userSettings.cashDifferenceToleranceUsd ?? bInfo.cashDifferenceToleranceUsd ?? 1.0,
            cashClosureMode: userSettings.cashClosureMode ?? bInfo.cashClosureMode ?? 'ASSISTED'
        });
    } catch (error) {
        res.json({ businessMode: 'STANDARD', cashClosureMode: 'ASSISTED', cashDifferenceToleranceUsd: 1.0 });
    }
});

router.get('/pago-movil', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);
        const bInfo = userSettings.businessInfo || {};
        const methods = userSettings.paymentMethods || [];
        const pmMethod = methods.find(m => m.id === 'pago_movil' || m.pagoMovilBank || m.pagoMovilPhone || m.pagoMovilId) || {};

        res.json({
            bank: pmMethod.pagoMovilBank || bInfo.pagoMovilBank || '',
            phone: pmMethod.pagoMovilPhone || bInfo.pagoMovilPhone || bInfo.phone || '',
            idNumber: pmMethod.pagoMovilId || bInfo.pagoMovilId || bInfo.rif || '',
            mode: pmMethod.pagoMovilQrMode || bInfo.pagoMovilQrMode || 'AUTO',
            customImage: pmMethod.pagoMovilQrImage || bInfo.pagoMovilQrImage || '',
            includeAmount: pmMethod.pagoMovilIncludeAmount !== false,
            name: pmMethod.name || 'Pago Móvil'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener datos de pago móvil' });
    }
});

router.post('/business', async (req, res) => {
    try {
        const info = req.body;
        const role = req.user?.role?.toLowerCase();
        const hasPermission = req.user?.permissions?.canManageSettings;
        
        // Verificación anti-bypass: Solo se permite setup sin autenticación si es la instalación inicial limpia (0 usuarios en BD)
        let isBrandNewSetup = false;
        if (!req.user || req.user.role === 'public_guest' || req.user.isPublicContext) {
            const totalUsers = await User.count().catch(() => 1);
            isBrandNewSetup = (totalUsers === 0) && (info?.initialSetupCompleted === true);
        }

        const isAuthorized = role === 'admin' || role === 'superadmin' || hasPermission || isBrandNewSetup;
        
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de administrador o gestión de configuración' });
        }

        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.businessInfo = info;
        if (companyId === '2' && allSettings['default']) {
            allSettings['default'].businessInfo = info;
        }
        if (info && info.cashDifferenceToleranceUsd !== undefined) {
            userSettings.cashDifferenceToleranceUsd = Number(info.cashDifferenceToleranceUsd);
        }
        if (info && info.cashClosureMode !== undefined) {
            userSettings.cashClosureMode = info.cashClosureMode;
        }
        if (info && info.country) {
            const key = getPresetKey(info.country);
            if (isSingleCurrencyCountry(info.country)) {
                userSettings.currencyMode = 'SINGLE';
                userSettings.exchangeRate = 1.0;
                userSettings.autoUpdateRate = false;
            } else if (key === 'venezuela') {
                userSettings.currencyMode = 'BOTH';
            }
            if (key && COUNTRY_PRESETS[key]) {
                if (!userSettings.paymentMethods || !Array.isArray(userSettings.paymentMethods) || userSettings.paymentMethods.length === 0) {
                    if (COUNTRY_PRESETS[key].paymentMethods) {
                        userSettings.paymentMethods = COUNTRY_PRESETS[key].paymentMethods.map(m => ({ ...m }));
                    }
                }
                if (!userSettings.taxConfig) {
                    if (COUNTRY_PRESETS[key].taxConfig) {
                        userSettings.taxConfig = { ...COUNTRY_PRESETS[key].taxConfig };
                    }
                }
            }
        }
        allSettings[companyId] = userSettings;
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);
        if (req.user?.id) {
            cache.del(`user_currency_${req.user.id}`);
        }
        SupabaseSyncService.syncConfig(true).catch(err => {
            console.warn('[CloudRateSync] Error sincronizando a Supabase:', err.message);
        });
        const io = req.app.get('io') || global.io;
        if (io) {
            io.to(companyId).emit('business_settings_updated', {
                broadcastPrintingEnabled: info?.broadcastPrintingEnabled === true,
                networkPrinterEnabled: info?.networkPrinterEnabled === true,
                receiptWidth: info?.receiptWidth,
                printMode: info?.printMode,
                receiptCopies: Number(info?.receiptCopies) || 1
            });
        }
        res.json({ success: true, businessInfo: info });
    } catch (error) {
        console.error('Update business info error:', error);
        res.status(500).json({ error: 'Error al actualizar info de negocio' });
    }
});

router.get('/payment-methods', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);

        const country = userSettings.businessInfo?.country || '';
        const regionCfg = getRegionConfig(country);
        const presetKey = getPresetKey(country);
        const isSingleCountry = isSingleCurrencyCountry(country);
        const isSingleMode = isSingleCountry || userSettings.currencyMode === 'SINGLE';

        let methods = userSettings.paymentMethods;

        if (isSingleCountry) {
            const targetCurrency = regionCfg.currencyCode;
            if (!methods || !Array.isArray(methods) || methods.length === 0) {
                methods = regionCfg.paymentMethods.map(m => ({ ...m }));
            } else {
                methods = methods
                    .filter(m => {
                        if (m.currency === 'VES' || m.id.includes('_bs') || m.id === 'biopago' || m.id === 'pago_movil') return false;
                        if (targetCurrency !== 'EUR' && (m.id === 'cash_eur' || m.currency === 'EUR')) return false;
                        return true;
                    })
                    .map(m => {
                        let name = m.name;
                        if (m.id === 'cash' && targetCurrency === 'USD') name = 'Efectivo';
                        if (m.id === 'cash' && targetCurrency === 'EUR') name = 'Efectivo €';
                        return { ...m, name, currency: targetCurrency };
                    });
                if (methods.length === 0) {
                    methods = regionCfg.paymentMethods.map(m => ({ ...m }));
                }
            }
            return res.json(methods);
        }

        if (!methods || !Array.isArray(methods) || methods.length === 0) {
            if (isSingleCountry && presetKey && COUNTRY_PRESETS[presetKey]?.paymentMethods) {
                methods = COUNTRY_PRESETS[presetKey].paymentMethods;
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
                    { id: 'cash_eur', name: 'Efectivo €', icon: 'Euro', type: 'CASH', currency: 'EUR' },
                    { id: 'cash_bs', name: 'Efectivo Bs', icon: 'DollarSign', type: 'CASH', currency: 'VES' },
                    { id: 'debit', name: 'Punto de Venta', icon: 'CreditCard', type: 'DIGITAL', currency: 'VES' },
                    { id: 'pago_movil', name: 'Pago Móvil', icon: 'Wallet', type: 'DIGITAL', currency: 'VES' },
                    { id: 'biopago', name: 'BioPago', icon: 'Fingerprint', type: 'DIGITAL', currency: 'VES' },
                    { id: 'zelle', name: 'Zelle', icon: 'Send', type: 'DIGITAL', currency: 'USD' },
                    { id: 'binance_usdt', name: 'Binance Pay (USDT)', icon: 'Wallet', type: 'DIGITAL', currency: 'USDT' },
                    { id: 'transfer', name: 'Transferencia', icon: 'Send', type: 'DIGITAL', currency: 'VES' },
                    { id: 'fiado', name: 'Fiado', icon: 'User', type: 'CREDIT', currency: 'USD' }
                ];
            }
        }

        if (!isSingleCountry && Array.isArray(methods)) {
            const hasBinance = methods.some(m => m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT');
            if (!hasBinance) {
                methods.push({
                    id: 'binance_usdt',
                    name: 'Binance Pay (USDT)',
                    icon: 'Wallet',
                    type: 'DIGITAL',
                    currency: 'USDT',
                    binanceRate: userSettings.businessInfo?.binanceRate || 0,
                    binancePayId: userSettings.businessInfo?.binancePayId || '',
                    binanceEmail: userSettings.businessInfo?.binanceEmail || '',
                    binanceQrMode: userSettings.businessInfo?.binanceQrMode || 'AUTO',
                    binanceQrImage: userSettings.businessInfo?.binanceQrImage || '',
                    binanceRoundingToleranceBs: userSettings.businessInfo?.binanceRoundingToleranceBs ?? 0.50,
                    binanceIgtfEnabled: !!userSettings.businessInfo?.binanceIgtfEnabled,
                    receiptLabel: userSettings.businessInfo?.binanceReceiptLabel || 'PAGO ELECTRÓNICO'
                });
            }
            methods = methods.map(m => {
                if (m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT') {
                    return {
                        ...m,
                        binanceRate: m.binanceRate ?? userSettings.businessInfo?.binanceRate ?? 0,
                        binancePayId: m.binancePayId ?? userSettings.businessInfo?.binancePayId ?? '',
                        binanceEmail: m.binanceEmail ?? userSettings.businessInfo?.binanceEmail ?? '',
                        binanceQrMode: m.binanceQrMode ?? userSettings.businessInfo?.binanceQrMode ?? 'AUTO',
                        binanceQrImage: m.binanceQrImage ?? userSettings.businessInfo?.binanceQrImage ?? '',
                        binanceRoundingToleranceBs: m.binanceRoundingToleranceBs ?? userSettings.businessInfo?.binanceRoundingToleranceBs ?? 0.50,
                        binanceIgtfEnabled: m.binanceIgtfEnabled ?? !!userSettings.businessInfo?.binanceIgtfEnabled,
                        receiptLabel: m.receiptLabel ?? userSettings.businessInfo?.binanceReceiptLabel ?? 'PAGO ELECTRÓNICO'
                    };
                }
                return m;
            });
        }

        if (isSingleMode && Array.isArray(methods)) {
            methods = methods.filter(m => m.currency !== 'VES' && !m.id.includes('_bs'));
            if (methods.length === 0) {
                methods = (presetKey && COUNTRY_PRESETS[presetKey]?.paymentMethods) || [
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

router.post('/payment-methods', requirePermission('canManageSettings'), validate(paymentMethodsSchema), async (req, res) => {
    try {
        const { paymentMethods } = req.body;
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.paymentMethods = paymentMethods;

        // Sincronizar automáticamente los datos bancarios de Pago Móvil con businessInfo
        if (Array.isArray(paymentMethods)) {
            const pmMethod = paymentMethods.find(m => m.id === 'pago_movil' || m.pagoMovilBank || m.pagoMovilPhone || m.pagoMovilId);
            if (pmMethod) {
                userSettings.businessInfo = userSettings.businessInfo || {};
                if (pmMethod.pagoMovilBank) userSettings.businessInfo.pagoMovilBank = pmMethod.pagoMovilBank;
                if (pmMethod.pagoMovilPhone) userSettings.businessInfo.pagoMovilPhone = pmMethod.pagoMovilPhone;
                if (pmMethod.pagoMovilId) userSettings.businessInfo.pagoMovilId = pmMethod.pagoMovilId;
                if (pmMethod.pagoMovilQrMode) userSettings.businessInfo.pagoMovilQrMode = pmMethod.pagoMovilQrMode;
                if (pmMethod.pagoMovilQrImage) userSettings.businessInfo.pagoMovilQrImage = pmMethod.pagoMovilQrImage;
            }

            const binMethod = paymentMethods.find(m => m.id === 'binance_usdt' || m.id === 'binance' || (m.currency || '').toUpperCase() === 'USDT');
            if (binMethod) {
                userSettings.businessInfo = userSettings.businessInfo || {};
                if (binMethod.binanceRate !== undefined) userSettings.businessInfo.binanceRate = Number(binMethod.binanceRate) || 0;
                if (binMethod.binancePayId !== undefined) userSettings.businessInfo.binancePayId = binMethod.binancePayId;
                if (binMethod.binanceEmail !== undefined) userSettings.businessInfo.binanceEmail = binMethod.binanceEmail;
                if (binMethod.binanceQrMode !== undefined) userSettings.businessInfo.binanceQrMode = binMethod.binanceQrMode;
                if (binMethod.binanceQrImage !== undefined) userSettings.businessInfo.binanceQrImage = binMethod.binanceQrImage;
                if (binMethod.binanceRoundingToleranceBs !== undefined) userSettings.businessInfo.binanceRoundingToleranceBs = Number(binMethod.binanceRoundingToleranceBs);
                if (binMethod.binanceIgtfEnabled !== undefined) userSettings.businessInfo.binanceIgtfEnabled = !!binMethod.binanceIgtfEnabled;
                if (binMethod.receiptLabel !== undefined) userSettings.businessInfo.binanceReceiptLabel = binMethod.receiptLabel;
            }
        }

        allSettings[companyId] = userSettings;
        if (companyId === '2' && allSettings['default']) {
            allSettings['default'].paymentMethods = paymentMethods;
            if (userSettings.businessInfo) {
                allSettings['default'].businessInfo = { ...allSettings['default'].businessInfo, ...userSettings.businessInfo };
            }
        }
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);
        res.json({ success: true, paymentMethods });
    } catch (error) {
        console.error('Update payment methods error:', error);
        res.status(500).json({ error: 'Error al actualizar métodos de pago' });
    }
});

router.get('/taxes', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);
        const country = userSettings.businessInfo?.country || '';
        const regionCfg = getRegionConfig(country);
        const isVenezuela = isVenezuelaCountry(country);
        const stored = userSettings.taxConfig || {};
        res.json({
            ivaEnabled: stored.ivaEnabled !== undefined ? Boolean(stored.ivaEnabled) : (userSettings.ivaEnabled !== false),
            ivaRate: Number(stored.ivaRate ?? userSettings.ivaRate ?? regionCfg.taxConfig.ivaRate) || 0,
            igtfEnabled: isVenezuela
                ? (stored.igtfEnabled !== undefined ? Boolean(stored.igtfEnabled) : Boolean(userSettings.igtfEnabled))
                : false,
            igtfRate: isVenezuela
                ? (Number(stored.igtfRate ?? userSettings.igtfRate ?? regionCfg.taxConfig.igtfRate) || 0)
                : 0,
            taxLabel: regionCfg.taxLabel,
            taxFullName: regionCfg.taxFullName,
            taxAuthority: regionCfg.taxAuthority
        });
    } catch (error) {
        console.error('Get taxes error:', error);
        res.status(500).json({ error: 'Error al obtener impuestos' });
    }
});

router.post('/taxes', requirePermission('canManageSettings'), validate(taxesSchema), async (req, res) => {
    try {
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };
        const isVenezuela = isVenezuelaCountry(userSettings.businessInfo?.country || '');
        const normalizedTaxConfig = {
            ...req.body,
            ivaEnabled: Boolean(req.body.ivaEnabled),
            ivaRate: Number(req.body.ivaRate) || 0,
            igtfEnabled: isVenezuela ? Boolean(req.body.igtfEnabled) : false,
            igtfRate: isVenezuela ? (Number(req.body.igtfRate) || 0) : 0
        };
        userSettings.taxConfig = normalizedTaxConfig;
        userSettings.ivaEnabled = normalizedTaxConfig.ivaEnabled;
        userSettings.ivaRate = normalizedTaxConfig.ivaRate;
        userSettings.igtfEnabled = normalizedTaxConfig.igtfEnabled;
        userSettings.igtfRate = normalizedTaxConfig.igtfRate;
        allSettings[companyId] = userSettings;
        if (companyId === '2' && allSettings['default']) {
            allSettings['default'].taxConfig = { ...normalizedTaxConfig };
            allSettings['default'].ivaEnabled = normalizedTaxConfig.ivaEnabled;
            allSettings['default'].ivaRate = normalizedTaxConfig.ivaRate;
            allSettings['default'].igtfEnabled = normalizedTaxConfig.igtfEnabled;
            allSettings['default'].igtfRate = normalizedTaxConfig.igtfRate;
        }
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);
        res.json({ success: true, taxConfig: normalizedTaxConfig });
    } catch (error) {
        console.error('Update taxes error:', error);
        res.status(500).json({ error: 'Error al actualizar impuestos' });
    }
});

router.get('/is-setup', async (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = allSettings[companyId] || allSettings['2'] || allSettings['default'] || Object.values(allSettings)[0];
        // Retornar true por defecto salvo que explícitamente se indique wizardCompleted: false
        const isSetup = userSettings ? userSettings.wizardCompleted !== false : true;
        res.json({ isSetup: Boolean(isSetup) });
    } catch (error) {
        res.json({ isSetup: true });
    }
});

router.post('/setup', requirePermission('canManageSettings'), validate(setupSchema), async (req, res) => {
    try {
        const { country, businessName } = req.body;
        if (!country) return res.status(400).json({ error: 'El país es requerido para la configuración' });
        
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };

        const presetKey = getPresetKey(country) || 'venezuela';
        const selectedPreset = COUNTRY_PRESETS[presetKey] || COUNTRY_PRESETS.venezuela;
        const isSingle = isSingleCurrencyCountry(presetKey);
        const nextTaxConfig = { ...selectedPreset.taxConfig };
        const nextPaymentMethods = selectedPreset.paymentMethods.map(m => ({ ...m }));
        const regionMeta = buildPublicRegionMetadata(presetKey);

        userSettings.exchangeRate = isSingle ? 1.0 : selectedPreset.exchangeRate;
        userSettings.euroRate = isSingle
            ? (selectedPreset.currencyCode === 'EUR' ? 1.0 : 0)
            : (Number(selectedPreset.euroRate) || 0);
        userSettings.currencyMode = isSingle ? 'SINGLE' : selectedPreset.currencyMode;
        userSettings.autoUpdateRate = Boolean(selectedPreset.autoUpdateRate);
        userSettings.taxConfig = nextTaxConfig;
        userSettings.ivaEnabled = Boolean(nextTaxConfig.ivaEnabled);
        userSettings.ivaRate = Number(nextTaxConfig.ivaRate) || 0;
        userSettings.igtfEnabled = Boolean(nextTaxConfig.igtfEnabled);
        userSettings.igtfRate = Number(nextTaxConfig.igtfRate) || 0;
        userSettings.paymentMethods = nextPaymentMethods;
        userSettings.regionConfig = regionMeta;
        
        // Aplicar info de negocio básica
        userSettings.businessInfo = {
            name: businessName || 'Mi Negocio POS',
            rif: '',
            address: '',
            phone: '',
            email: req.user?.email || '',
            receiptWidth: '80mm',
            country: presetKey
        };

        allSettings[companyId] = userSettings;
        if (companyId === '2' && allSettings['default']) {
            allSettings['default'] = { ...userSettings };
        }
        userSettings.wizardCompleted = true; // Marcar como completado
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);
        cache.delPrefix('user_currency_');

        const io = req.app.get('io');
        if (io && companyId) {
            io.to(companyId).emit('settings_changed', {
                type: 'region',
                country: userSettings.businessInfo.country,
                currencyMode: userSettings.currencyMode,
                exchangeRate: userSettings.exchangeRate,
                euroRate: userSettings.euroRate,
                taxConfig: nextTaxConfig,
                paymentMethods: nextPaymentMethods,
                regionConfig: regionMeta
            });
        }

        res.json({ success: true, regionConfig: regionMeta, settings: userSettings });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Error al configurar el sistema' });
    }
});

// Change region / country preset mid-lifecycle (from Settings page - Owner/Superadmin only)
router.post('/region', requirePermission('canManageSettings'), validate(regionSchema), async (req, res) => {
    try {
        const userRole = String(req.user?.role || '').toLowerCase();
        const isOwner = ['superadmin', 'owner', 'dueño', 'dueno'].includes(userRole);
        if (!isOwner) {
            return res.status(403).json({ error: 'Solo el propietario (Superadmin) puede modificar la región y moneda operativa del sistema.' });
        }

        const { country } = req.body;
        if (!country) return res.status(400).json({ error: 'País requerido' });

        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };

        const presetKey = getPresetKey(country);
        const selectedPreset = presetKey ? COUNTRY_PRESETS[presetKey] : null;
        if (!selectedPreset) return res.status(400).json({ error: `País no soportado: ${country}` });

        const previousCountry = userSettings.businessInfo?.country || '';
        // Resguardar tasas BCV previas (USD y EUR) al salir de Venezuela para restaurarlas al regresar
        if (isVenezuelaCountry(previousCountry)) {
            if (Number(userSettings.exchangeRate) > 1) {
                userSettings.lastBcvRate = Number(userSettings.exchangeRate);
            }
            if (Number(userSettings.euroRate) > 1) {
                userSettings.lastEuroRate = Number(userSettings.euroRate);
            }
        }

        const isTargetSingle = isSingleCurrencyCountry(presetKey);
        const targetExchangeRate = isTargetSingle
            ? 1.0
            : (Number(userSettings.lastBcvRate) > 1
                ? Number(userSettings.lastBcvRate)
                : (Number(userSettings.exchangeRate) > 1 ? Number(userSettings.exchangeRate) : selectedPreset.exchangeRate));
        const targetEuroRate = isTargetSingle
            ? (selectedPreset.currencyCode === 'EUR' ? 1.0 : 0)
            : (Number(userSettings.lastEuroRate) > 1
                ? Number(userSettings.lastEuroRate)
                : (Number(userSettings.euroRate) > 1 ? Number(userSettings.euroRate) : (selectedPreset.euroRate || 0)));

        const nextTaxConfig = { ...selectedPreset.taxConfig };
        const nextPaymentMethods = selectedPreset.paymentMethods.map(m => ({ ...m }));
        const regionMeta = buildPublicRegionMetadata(presetKey);

        // Aplicar preset completo sincronizando tanto taxConfig como campos legacy top-level
        userSettings.exchangeRate = targetExchangeRate;
        userSettings.euroRate = targetEuroRate;
        userSettings.currencyMode = isTargetSingle ? 'SINGLE' : selectedPreset.currencyMode;
        userSettings.autoUpdateRate = Boolean(selectedPreset.autoUpdateRate);
        userSettings.taxConfig = nextTaxConfig;
        userSettings.ivaEnabled = Boolean(nextTaxConfig.ivaEnabled);
        userSettings.ivaRate = Number(nextTaxConfig.ivaRate) || 0;
        userSettings.igtfEnabled = Boolean(nextTaxConfig.igtfEnabled);
        userSettings.igtfRate = Number(nextTaxConfig.igtfRate) || 0;
        userSettings.paymentMethods = nextPaymentMethods;
        userSettings.regionConfig = regionMeta;

        // Update country in businessInfo without resetting other business fields
        if (!userSettings.businessInfo) userSettings.businessInfo = {};
        userSettings.businessInfo.country = presetKey;

        allSettings[companyId] = userSettings;
        if (companyId === '2' && allSettings['default']) {
            allSettings['default'] = { ...userSettings };
        }
        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);

        // Invalidate user-specific currency cache
        cache.delPrefix('user_currency_');

        // Emit socket event to notify all clients with full regional payload
        const io = req.app.get('io');
        if (io) {
            io.to(companyId).emit('settings_changed', {
                type: 'region',
                country: presetKey,
                currencyMode: userSettings.currencyMode,
                exchangeRate: userSettings.exchangeRate,
                euroRate: userSettings.euroRate,
                taxConfig: nextTaxConfig,
                paymentMethods: nextPaymentMethods,
                regionConfig: regionMeta
            });
        }

        res.json({
            success: true,
            country: presetKey,
            preset: selectedPreset,
            regionConfig: regionMeta,
            settings: userSettings
        });
    } catch (error) {
        console.error('Region change error:', error);
        res.status(500).json({ error: 'Error al cambiar la región' });
    }
});

router.get('/auto-launch', async (req, res) => {
    try {
        const autoLaunchManager = require('../utils/autoLaunchManager');
        const userDataPath = process.env.USER_DATA_PATH || BASE_PATH;
        let enabled = await autoLaunchManager.getWindowsAutoLaunchStatus({ userDataPath });
        if (!enabled) {
            const allSettings = getCachedSettings();
            if (allSettings && typeof allSettings.autoLaunch === 'boolean') {
                enabled = allSettings.autoLaunch;
            }
        }
        res.json({ enabled: Boolean(enabled) });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estado de inicio automático' });
    }
});

router.post('/auto-launch', requirePermission('canManageSettings'), validate(autoLaunchSchema), async (req, res) => {
    try {
        const enabled = Boolean(req.body?.enabled);
        const autoLaunchManager = require('../utils/autoLaunchManager');
        const userDataPath = process.env.USER_DATA_PATH || BASE_PATH;

        const result = await autoLaunchManager.configureWindowsAutoLaunch(enabled, {
            userDataPath,
            isPackaged: !process.execPath.toLowerCase().includes('node.exe') && !process.execPath.toLowerCase().includes('electron.exe'),
            processExecPath: process.execPath
        });

        try {
            let settings = readJson(SETTINGS_FILE) || {};
            settings.autoLaunch = enabled;
            writeJson(SETTINGS_FILE, settings);
            cache.del('all_settings');
        } catch (e) {}

        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error || 'No se pudo actualizar el inicio automático' });
        }

        res.json({ success: true, enabled, mechanism: result.mechanism });
    } catch (error) {
        console.error('Error setting auto-launch:', error);
        res.status(500).json({ error: 'Error al actualizar el inicio automático' });
    }
});

router.post('/email-test', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const { user, pass } = req.body;
        const InvoiceEmailService = require('../services/InvoiceEmailService');
        await InvoiceEmailService.testConnection(user, pass);
        res.json({ success: true, message: 'Conexión exitosa' });
    } catch (error) {
        console.error('Email test error:', error);
        res.status(400).json({ error: error.message });
    }
});

const isSafeLanPrinterHost = (rawHost) => {
    const h = String(rawHost || '').trim().toLowerCase();
    if (!h || h.length > 120) return false;
    if (h === 'localhost') return true;
    if (/^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(h)) {
        return true;
    }
    return /^[a-z0-9][a-z0-9-]*\.local$/.test(h);
};

const isSafeSerialPortName = (rawPort) => {
    const p = String(rawPort || '').trim();
    return /^COM\d{1,3}$/i.test(p) || /^\/dev\/tty[A-Za-z0-9_-]+$/.test(p);
};

router.post('/test-network-printer', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const { host, port } = req.body;
        if (!host) {
            return res.status(400).json({ error: 'Debe ingresar la dirección IP de la impresora de red' });
        }
        if (!isSafeLanPrinterHost(host)) {
            return res.status(400).json({ error: 'Solo se permiten direcciones IP de red local privada (LAN) o nombres .local para impresoras.' });
        }
        const NetworkPrinterService = require('../services/NetworkPrinterService');
        const allSettings = getCachedSettings();
        const companyId = req.user?.companyId || 'default';
        const userSettings = getUserSettings(allSettings, companyId);
        const bizName = userSettings.businessInfo?.name || 'Isaac POS';

        const result = await NetworkPrinterService.testPrint(host, port || 9100, bizName);
        if (result.success) {
            res.json({ success: true, message: result.message || 'Ticket de prueba enviado a la impresora de red con éxito' });
        } else {
            res.status(502).json({ error: result.error || 'No se pudo conectar a la impresora de red' });
        }
    } catch (error) {
        console.error('Network printer test error:', error);
        res.status(500).json({ error: error.message || 'Error al comunicarse con la impresora de red' });
    }
});

/**
 * GET /settings/scan-network-printers
 * Escanea la subred local buscando impresoras térmicas con puerto 9100 abierto
 */
router.get('/scan-network-printers', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const NetworkPrinterService = require('../services/NetworkPrinterService');
        const printers = await NetworkPrinterService.scanSubnetForPrinters(9100, 350);
        res.json({
            success: true,
            count: printers.length,
            printers
        });
    } catch (error) {
        console.error('Scan network printers error:', error);
        res.status(500).json({ error: 'Error al escanear la red local' });
    }
});

/**
 * POST /settings/test-cluster-printers
 * Dispara un pulso de diagnóstico integral a las 3 impresoras del clúster
 */
router.post('/test-cluster-printers', requirePermission('canManageSettings'), async (req, res) => {
    try {
        const { networkHost, networkPort } = req.body;
        if (networkHost && !isSafeLanPrinterHost(networkHost)) {
            return res.status(400).json({ error: 'Solo se permiten direcciones IP de red local privada (LAN) para impresoras.' });
        }
        const io = req.app.get('io') || global.io;
        const companyId = req.user?.companyId || 'default';

        const testPayload = {
            id: 'test-' + Date.now(),
            invoiceNumber: 'TEST-DIAGNOSTICO',
            date: new Date().toISOString(),
            customerName: 'DIAGNÓSTICO GLOBAL DE CLÚSTER',
            total: 0.00,
            items: [
                { productName: 'Prueba de Salud del Clúster', quantity: 1, unitPrice: 0.00, subtotal: 0.00 }
            ]
        };

        // 1. Emitir a las laptops conectadas en LAN del mismo tenant
        if (io) {
            io.to(String(companyId)).emit('lan_print_sale', {
                sale: testPayload,
                originStationId: 'cluster-test-trigger',
                companyId
            });
        }

        // 2. Si hay impresora de red configurada, probarla
        let networkResult = { success: false, error: 'No configurada' };
        if (networkHost) {
            const NetworkPrinterService = require('../services/NetworkPrinterService');
            networkResult = await NetworkPrinterService.testPrint(networkHost, networkPort || 9100, 'TEST CLÚSTER');
        }

        res.json({
            success: true,
            message: 'Diagnóstico de clúster emitido correctamente',
            networkResult
        });
    } catch (error) {
        console.error('Test cluster printers error:', error);
        res.status(500).json({ error: error.message || 'Error en prueba de clúster' });
    }
});

/**
 * GET /settings/system-printers
 * Lista todas las impresoras locales/USB de Windows disponibles en el equipo
 */
router.get('/system-printers', async (req, res) => {
    try {
        const LocalPrinterService = require('../services/LocalPrinterService');
        const forceRefresh = req.query.refresh !== 'false';
        const printers = await LocalPrinterService.getSystemPrinters(forceRefresh);
        res.json({
            success: true,
            count: printers.length,
            printers
        });
    } catch (error) {
        console.error('Error fetching system printers:', error);
        res.status(500).json({ success: false, error: error.message, printers: [] });
    }
});

/**
 * POST /settings/print-raw
 * Envía datos RAW (ESC/POS) a una impresora local de Windows vía backend
 */
router.post('/print-raw', verifyToken, requirePermission(['canAccessPOS', 'canManageSettings']), validate(printRawSchema), async (req, res) => {
    try {
        const { printerName, content, printMode, autoPrint = false } = req.body;
        const LocalPrinterService = require('../services/LocalPrinterService');
        const resolvedPrinter = await LocalPrinterService.resolvePrinterName(printerName);
        if (!resolvedPrinter) {
            if (autoPrint === true) {
                return res.json({
                    success: false,
                    skipped: true,
                    code: 'NO_PRINTER_DETECTED',
                    message: 'No se detectó una impresora térmica conectada'
                });
            }
            return res.status(400).json({ success: false, error: 'No se detectó una impresora térmica conectada' });
        }
        await LocalPrinterService.printRaw(content, resolvedPrinter, { printMode });
        res.json({ success: true, message: 'Impresión enviada correctamente', printerName: resolvedPrinter });
    } catch (error) {
        console.error('Error in print-raw:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /settings/print-network-raw
 * Envía comandos ESC/POS en Base64 a una impresora térmica LAN (TCP 9100) con protección anti-SSRF.
 */
router.post('/print-network-raw', verifyToken, requirePermission(['canAccessPOS', 'canManageSettings']), async (req, res) => {
    try {
        const { ip, host, port = 9100, dataBase64, content } = req.body || {};
        const targetHost = String(ip || host || '').trim();
        const targetPort = Number(port) || 9100;
        if (!targetHost || !isSafeLanPrinterHost(targetHost)) {
            return res.status(400).json({ success: false, error: 'IP de impresora inválida o fuera de red local permitida.' });
        }
        if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
            return res.status(400).json({ success: false, error: 'Puerto TCP de impresora inválido.' });
        }
        let payloadBuf;
        if (dataBase64 && typeof dataBase64 === 'string') {
            payloadBuf = Buffer.from(dataBase64, 'base64');
        } else if (content && typeof content === 'string') {
            payloadBuf = Buffer.from(content, 'latin1');
        } else {
            return res.status(400).json({ success: false, error: 'Faltan datos ESC/POS para imprimir.' });
        }
        if (payloadBuf.length === 0 || payloadBuf.length > 262144) {
            return res.status(400).json({ success: false, error: 'Tamaño de trabajo ESC/POS fuera de rango (1B - 256KB).' });
        }
        const NetworkPrinterService = require('../services/NetworkPrinterService');
        const result = await NetworkPrinterService.printNetwork(targetHost, targetPort, payloadBuf);
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error in print-network-raw:', error);
        return res.status(500).json({ success: false, error: error.message || 'Error imprimiendo por red TCP/IP' });
    }
});

/**
 * POST /settings/open-drawer
 * Envía comando de apertura de gaveta a una impresora local de Windows vía backend
 */
router.post('/open-drawer', verifyToken, async (req, res) => {
    try {
        const { printerName, sequence, supervisorApprovalId, autoPrint = false } = req.body;
        const LocalPrinterService = require('../services/LocalPrinterService');
        const resolvedPrinter = await LocalPrinterService.resolvePrinterName(printerName);
        if (!resolvedPrinter) {
            if (autoPrint === true) {
                return res.json({
                    success: false,
                    skipped: true,
                    code: 'NO_PRINTER_DETECTED',
                    message: 'No se detectó una impresora conectada para abrir la gaveta'
                });
            }
            return res.status(400).json({ success: false, error: 'No se detectó una impresora conectada para abrir la gaveta' });
        }

        // 🛡️ SEGURIDAD FÍSICA: Control estricto de apertura de gaveta de dinero
        const userRole = (req.user?.role || '').toLowerCase();
        const isPrivileged = userRole === 'admin' || userRole === 'superadmin' || userRole === 'owner' || userRole === 'dueño';
        const hasPermission = req.user?.permissions?.canOpenDrawer === true;

        if (!isPrivileged && !hasPermission) {
            if (!supervisorApprovalId) {
                return res.status(403).json({ error: 'forbidden', message: 'Se requiere autorización de supervisor para abrir la gaveta de dinero.' });
            }
            try {
                const { Op } = require('sequelize');
                const { SupervisorApproval } = require('../database/models');
                const companyId = req.user?.companyId || 'default';
                const now = new Date();
                const approval = await SupervisorApproval.findOne({
                    where: {
                        id: String(supervisorApprovalId),
                        companyId,
                        used: false,
                        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                    }
                });
                const normalizedAct = String(approval?.actionType || '').trim().toUpperCase();
                const allowedDrawerActions = new Set([
                    'APERTURA MANUAL DE GAVETA',
                    'APERTURA DE GAVETA (CONFIGURACIÓN)',
                    'APERTURA DE GAVETA (CONFIGURACION)',
                    'OPEN_DRAWER'
                ]);
                if (!approval || !allowedDrawerActions.has(normalizedAct)) {
                    return res.status(403).json({ error: 'forbidden', message: 'Aprobación de supervisor inválida, de ámbito incorrecto, expirada o ya utilizada.' });
                }
                const [consumedCount] = await SupervisorApproval.update(
                    { used: true, usedAt: now },
                    {
                        where: {
                            id: approval.id,
                            companyId,
                            used: false,
                            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                        }
                    }
                );
                if (consumedCount !== 1) {
                    return res.status(403).json({ error: 'forbidden', message: 'La aprobación de supervisor ya fue utilizada.' });
                }
            } catch (authErr) {
                return res.status(403).json({ error: 'forbidden', message: 'Fallo al verificar autorización de supervisor.' });
            }
        }

        await LocalPrinterService.openDrawer({
            printerName: resolvedPrinter,
            sequence,
            user: req.user,
            reason: supervisorApprovalId
                ? `Apertura desde Configuración autorizada por supervisor (Ref #${supervisorApprovalId})`
                : 'Apertura desde Configuración'
        });

        // Registro en auditoría
        try {
            const auditController = require('../controllers/audit');
            const description = supervisorApprovalId
                ? `Apertura de gaveta desde Configuración autorizada por supervisor (Ref #${supervisorApprovalId})`
                : `Apertura de gaveta desde Configuración por usuario ${req.user.username || req.user.id}`;
            auditController.logAction(
                req.user.id,
                req.user.companyId || '2',
                'DRAWER_MANUAL_OPEN',
                description,
                printerName
            );
        } catch (_auditErr) {
            console.warn('[Settings] Aviso registrando auditoría de apertura de gaveta:', _auditErr.message);
        }

        res.json({ success: true, message: 'Pulso de apertura de gaveta enviado' });
    } catch (error) {
        console.error('Error in open-drawer:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- RUTAS DE PROTOCOLO DE BALANZA / BÁSCULA DE MOSTRADOR ---
const ScaleService = require('../services/ScaleService');

router.get('/scale/ports', verifyToken, requirePermission(['canAccessPOS', 'canManageSettings']), async (req, res) => {
    try {
        const ports = await ScaleService.listPorts();
        res.json({ success: true, ports });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/scale/read', verifyToken, requirePermission(['canAccessPOS', 'canManageSettings']), async (req, res) => {
    try {
        const port = req.query.port || 'COM1';
        if (!isSafeSerialPortName(port)) {
            return res.status(400).json({ success: false, error: 'Nombre de puerto serial inválido' });
        }
        const baudRate = parseInt(req.query.baudRate, 10) || 9600;
        const result = await ScaleService.readWeight(port, baudRate);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/scale/tare', verifyToken, requirePermission(['canAccessPOS', 'canManageSettings']), async (req, res) => {
    try {
        const port = req.body.port || 'COM1';
        if (!isSafeSerialPortName(port)) {
            return res.status(400).json({ success: false, error: 'Nombre de puerto serial inválido' });
        }
        const result = await ScaleService.sendCommand(port, 'T');
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/scale/zero', verifyToken, requirePermission(['canAccessPOS', 'canManageSettings']), async (req, res) => {
    try {
        const port = req.body.port || 'COM1';
        if (!isSafeSerialPortName(port)) {
            return res.status(400).json({ success: false, error: 'Nombre de puerto serial inválido' });
        }
        const result = await ScaleService.sendCommand(port, 'Z');
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- RUTAS DE GESTIÓN DE BASE DE DATOS Y RED (ISAAC POS MULTI-CAJA) ---
const os = require('os');
const DbConfigManager = require('../config/dbConfigManager');

/**
 * GET /settings/network-info
 * Informa sobre la IP local de la máquina física en la red LAN (para enlazar Cajas Secundarias).
 */
router.get('/network-info', (req, res) => {
    try {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push({ name, address: iface.address });
                }
            }
        }
        const primaryIp = ips.length > 0 ? ips[0].address : '127.0.0.1';
        res.json({
            success: true,
            primaryIp,
            ips,
            port: parseInt(process.env.PORT || '3005', 10),
            hostname: os.hostname()
        });
    } catch (err) {
        console.error('[Settings] Error en /network-info:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /settings/db-config
 * Devuelve la configuración de base de datos activa desde disco (%AppData%\isaac-pos\db-config.json).
 */
const isLocalLoopbackRequest = (req) => {
    const rawAddr = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim();
    return rawAddr === '127.0.0.1' || rawAddr === '::1' || rawAddr === '::ffff:127.0.0.1';
};

router.get('/db-config', requirePermission('canManageSettings'), (req, res) => {
    if (!isLocalLoopbackRequest(req)) {
        return res.status(403).json({
            success: false,
            error: 'Acceso restringido al equipo local.'
        });
    }
    try {
        const cfg = DbConfigManager.getConfig();
        res.json({
            success: true,
            config: {
                mode: cfg.mode,
                dialect: cfg.dialect,
                host: cfg.host,
                port: cfg.port,
                database: cfg.database,
                user: cfg.user,
                hasPassword: Boolean(cfg.password)
            }
        });
    } catch (err) {
        console.error('[Settings] Error leyendo db-config:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /settings/db-config
 * Guarda la configuración físicamente en disco y prueba la conectividad si es servidor.
 */
router.post('/db-config', requirePermission('canManageSettings'), validate(dbConfigSchema), async (req, res) => {
    if (!isLocalLoopbackRequest(req)) {
        return res.status(403).json({
            success: false,
            error: 'Acceso restringido: la configuración física de base de datos solo puede modificarse desde el equipo local.'
        });
    }
    try {
        const { mode, dialect, host, port, database, user, password } = req.body;
        
        const configToSave = {
            mode: mode || 'server',
            dialect: dialect || 'postgres',
            host: host !== undefined ? host : (mode === 'client' ? '' : '127.0.0.1'),
            port: parseInt(port || 5432, 10),
            database: database || 'americanpos',
            user: user || 'postgres'
        };

        if (password !== undefined && password !== null) {
            configToSave.password = password;
        }

        const saveResult = DbConfigManager.saveConfig(configToSave);
        if (!saveResult.success) {
            return res.status(500).json({ success: false, error: saveResult.error });
        }

        // Si es servidor local, probar la conexión de forma rápida
        let testResult = null;
        if (configToSave.mode === 'server') {
            try {
                testResult = await DbConfigManager.testConnection(saveResult.config);
            } catch (testErr) {
                testResult = { success: false, error: testErr.message };
            }
        }

        res.json({
            success: true,
            message: 'Configuración guardada exitosamente en el disco.',
            config: saveResult.publicConfig || DbConfigManager.getPublicConfig(),
            test: testResult
        });
    } catch (err) {
        console.error('[Settings] Error guardando db-config:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SEÑALIZACIÓN DIGITAL Y CARRUSEL PUBLICITARIO DEL VISOR DE CLIENTES ---
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const DEFAULT_CUSTOMER_DISPLAY_CONFIG = {
    layoutMode: 'split', // 'split' | 'fullscreen'
    intervalSeconds: 8,
    imageFit: 'contain', // 'cover' | 'contain'
    autoIncludePromotions: true,
    autoIncludeProducts: true,
    maxAutoProducts: 10,
    institutionalTagline: 'Precios calculados a tasa oficial vigente',
    slides: []
};

const normalizeCustomerDisplayConfig = (raw = {}) => {
    const safeObj = (raw && typeof raw === 'object') ? raw : {};
    const rawSlides = Array.isArray(safeObj.slides) ? safeObj.slides : [];
    const slides = rawSlides
        .filter(s => s && typeof s === 'object')
        .slice(0, 40)
        .map((s, idx) => ({
            id: String(s.id || `slide_${Date.now()}_${idx}`),
            enabled: s.enabled !== false,
            imageUrl: typeof s.imageUrl === 'string' ? s.imageUrl.trim() : '',
            badge: typeof s.badge === 'string' ? s.badge.trim().slice(0, 40) : '',
            title: typeof s.title === 'string' ? s.title.trim().slice(0, 120) : '',
            subtitle: typeof s.subtitle === 'string' ? s.subtitle.trim().slice(0, 220) : '',
            priceUSD: (s.priceUSD !== '' && s.priceUSD !== null && s.priceUSD !== undefined && !isNaN(Number(s.priceUSD)))
                ? Number(s.priceUSD)
                : null,
            unitLabel: typeof s.unitLabel === 'string' ? s.unitLabel.trim().slice(0, 40) : '',
            imageFit: s.imageFit === 'contain' ? 'contain' : (s.imageFit === 'cover' ? 'cover' : 'inherit'),
            productId: typeof s.productId === 'string' ? s.productId : ''
        }));

    const parsedInterval = parseInt(safeObj.intervalSeconds, 10);
    const intervalSeconds = (!isNaN(parsedInterval) && parsedInterval >= 3 && parsedInterval <= 60) ? parsedInterval : 8;
    const parsedMaxAuto = parseInt(safeObj.maxAutoProducts, 10);
    const maxAutoProducts = (!isNaN(parsedMaxAuto) && parsedMaxAuto >= 2 && parsedMaxAuto <= 24) ? parsedMaxAuto : 10;

    return {
        layoutMode: safeObj.layoutMode === 'fullscreen' ? 'fullscreen' : 'split',
        intervalSeconds,
        imageFit: safeObj.imageFit === 'cover' ? 'cover' : 'contain',
        autoIncludePromotions: safeObj.autoIncludePromotions !== false,
        autoIncludeProducts: safeObj.autoIncludeProducts !== false,
        maxAutoProducts,
        institutionalTagline: typeof safeObj.institutionalTagline === 'string'
            ? safeObj.institutionalTagline.trim().slice(0, 140)
            : DEFAULT_CUSTOMER_DISPLAY_CONFIG.institutionalTagline,
        slides
    };
};

const getDisplayAdsDirectory = () => {
    const dir = path.join(BASE_PATH, 'display_ads');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

const ALLOWED_AD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const ALLOWED_AD_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const displayAdStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        try {
            cb(null, getDisplayAdsDirectory());
        } catch (err) {
            cb(err);
        }
    },
    filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname || '').toLowerCase();
        const safeExt = ALLOWED_AD_EXTENSIONS.has(rawExt) ? rawExt : '.jpg';
        const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        cb(null, `ad_${unique}${safeExt}`);
    }
});

const displayAdUpload = multer({
    storage: displayAdStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ALLOWED_AD_MIMES.has(file.mimetype) && (ALLOWED_AD_EXTENSIONS.has(ext) || !ext)) {
            return cb(null, true);
        }
        cb(new Error('Formato no soportado. Use imágenes JPG, PNG o WEBP.'));
    }
});

const canManageDisplayAds = (req) => {
    const role = String(req.user?.role || '').toLowerCase();
    return ['admin', 'superadmin', 'owner', 'dueño', 'master', 'supervisor'].includes(role)
        || req.user?.permissions?.canManageSettings === true
        || req.user?.permissions?.canManagePromotions === true;
};

router.get('/customer-display/pairing', (req, res) => {
    try {
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : String(req.user.companyId);
        const registerId = String(req.query.registerId || '1');
        const displayToken = computeDisplayPairingToken(companyId, registerId);
        res.json({ success: true, companyId, registerId, displayToken });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error generando token de emparejamiento' });
    }
});

router.get('/customer-display', (req, res) => {
    try {
        const allSettings = getCachedSettings();
        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const userSettings = getUserSettings(allSettings, companyId);
        const config = normalizeCustomerDisplayConfig(userSettings?.customerDisplay);
        const displayToken = computeDisplayPairingToken(companyId, String(req.query.registerId || '1'));
        res.json({ success: true, config, companyId, displayToken });
    } catch (err) {
        console.error('[Settings] Error GET /customer-display:', err);
        res.status(500).json({ success: false, error: 'Error al obtener configuración del visor' });
    }
});

router.post('/customer-display', async (req, res) => {
    try {
        if (!canManageDisplayAds(req)) {
            return res.status(403).json({
                success: false,
                error: 'Acceso denegado: Se requieren permisos de administración para configurar la publicidad del visor.'
            });
        }

        const companyId = (!req.user?.companyId || req.user?.companyId === 'default' || req.user?.companyId === 'admin') ? '2' : req.user.companyId;
        const normalized = normalizeCustomerDisplayConfig(req.body?.config || req.body);

        const allSettings = getCachedSettings();
        const userSettings = allSettings[companyId] || { exchangeRate: 1.0, businessInfo: {} };
        userSettings.customerDisplay = normalized;
        allSettings[companyId] = userSettings;

        if (companyId === '2' && allSettings['default']) {
            allSettings['default'].customerDisplay = normalized;
        }

        await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);

        const io = req.app.get('io') || global.io;
        if (io) {
            io.to(companyId).emit('customer_display_ads_updated', normalized);
            io.to(`customer_displays:${companyId}`).emit('customer_display_ads_updated', normalized);
        }

        res.json({ success: true, config: normalized });
    } catch (err) {
        console.error('[Settings] Error POST /customer-display:', err);
        res.status(500).json({ success: false, error: 'Error al guardar configuración del carrusel' });
    }
});

router.post('/customer-display/upload', (req, res) => {
    if (!canManageDisplayAds(req)) {
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado: Se requieren permisos de administración para subir piezas publicitarias.'
        });
    }

    displayAdUpload.single('image')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'La imagen supera el límite máximo permitido de 8 MB.'
                : (err.message || 'Error al cargar la imagen.');
            return res.status(400).json({ success: false, error: msg });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No se recibió ningún archivo de imagen.' });
        }

        const relativeUrl = `/display_ads/${req.file.filename}`;
        res.json({
            success: true,
            imageUrl: relativeUrl,
            filename: req.file.filename
        });
    });
});

router.delete('/customer-display/upload/:filename', (req, res) => {
    try {
        if (!canManageDisplayAds(req)) {
            return res.status(403).json({ success: false, error: 'Acceso denegado.' });
        }
        const rawName = String(req.params.filename || '').trim();
        if (!rawName || path.basename(rawName) !== rawName || !/^ad_[a-zA-Z0-9_.-]+$/.test(rawName)) {
            return res.status(400).json({ success: false, error: 'Nombre de archivo inválido.' });
        }
        const targetFile = path.join(getDisplayAdsDirectory(), rawName);
        if (fs.existsSync(targetFile)) {
            fs.unlinkSync(targetFile);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Settings] Error eliminando imagen de carrusel:', err);
        res.status(500).json({ success: false, error: 'Error al eliminar archivo' });
    }
});

module.exports = router;


