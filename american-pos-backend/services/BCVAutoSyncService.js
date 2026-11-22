const BCVRateService = require('./BCVRateService');
const SupabaseSyncService = require('./SupabaseSyncService');
const { readJson, writeJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const cache = require('../utils/cacheService');

/**
 * BCVAutoSyncService
 * Servicio de sincronización automática de la tasa oficial del Banco Central de Venezuela (BCV).
 * 
 * Funcionalidades:
 * 1. Sincroniza la tasa oficial en el arranque del servidor si la opción está activada.
 * 2. Monitorea periódicamente (cada 30 minutos) si el BCV actualiza la tasa oficial del día.
 * 3. Notifica en tiempo real vía WebSockets a todas las cajas y pantallas abiertas para que
 *    se recalculen los precios instantáneamente a 0ms sin requerir recargar la página.
 * 4. Permite forzar la sincronización manual vía endpoint API (/settings/bcv/sync).
 */
class BCVAutoSyncService {
    constructor() {
        this.io = null;
        this.timer = null;
        this.startupTimer = null;
        this.isSyncing = false;
        this.lastSyncTime = null;
        this.lastKnownRate = null;
    }

    /**
     * Inicializa el servicio con la instancia de Socket.IO del servidor
     */
    init(io) {
        if (process.env.ISAAC_TEST_ISOLATED === '1' || process.env.NODE_ENV === 'test' || process.env.DISABLE_BACKGROUND_WORKERS === 'true') {
            return;
        }
        this.io = io;
        console.log('[BCVAutoSync] 🚀 Inicializando servicio de actualización automática de tasa BCV...');

        // Ejecutar primera verificación 5 segundos después del arranque
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null;
            this.syncRate({ reason: 'STARTUP' }).catch(err => {
                console.warn('[BCVAutoSync] Aviso en sincronización inicial:', err.message);
            });
        }, 5000);
        if (typeof this.startupTimer.unref === 'function') this.startupTimer.unref();

        // Intervalo periódico: cada 30 minutos
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            this.syncRate({ reason: 'PERIODIC_SCHEDULE' }).catch(err => {
                console.warn('[BCVAutoSync] Aviso en sincronización periódica:', err.message);
            });
        }, 1000 * 60 * 30);
        if (typeof this.timer.unref === 'function') this.timer.unref();
    }

    stop() {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Ejecuta la sincronización de la tasa oficial contra el BCV
     */
    async syncRate({ force = false, reason = 'MANUAL' } = {}) {
        if (!force && (process.env.ISAAC_TEST_ISOLATED === '1' || process.env.NODE_ENV === 'test' || process.env.DISABLE_BACKGROUND_WORKERS === 'true')) {
            return { success: false, skipped: true, reason: 'TEST_ISOLATED' };
        }
        if (this.isSyncing) {
            console.log('[BCVAutoSync] ⏳ Sincronización ya en progreso, omitiendo...');
            return { success: false, inProgress: true };
        }

        this.isSyncing = true;
        try {
            const allSettings = readJson(SETTINGS_FILE) || {};
            const companyId = '2'; // Empresa principal activa
            const userSettings = getUserSettings(allSettings, companyId);

            // Verificar si el país es de moneda fija única (Ecuador, Panamá, USA)
            const country = (userSettings.businessInfo?.country || '').toLowerCase();
            const isUsdCountry = ['ecuador', 'panama', 'usa', 'estados unidos'].some(c => country.includes(c));
            if (isUsdCountry && !force) {
                console.log('[BCVAutoSync] Omitiendo sincronización: país configurado como 100% USD.');
                // Sincronizar inmediatamente a la nube de Supabase (24/7)
                SupabaseSyncService.syncConfig(true).catch(err => {
                    console.warn('[BCVAutoSync] Error sincronizando tasa a Supabase:', err.message);
                });

                return { success: false, reason: 'USD_ONLY_COUNTRY' };
            }

            // Verificar si la actualización automática está activada por el usuario
            const isAutoEnabled = userSettings.autoUpdateRate !== false;
            if (!isAutoEnabled && !force) {
                console.log('[BCVAutoSync] Omitiendo: Actualización automática desactivada por el usuario (Modo Manual).');
                // Sincronizar inmediatamente a la nube de Supabase (24/7)
                SupabaseSyncService.syncConfig(true).catch(err => {
                    console.warn('[BCVAutoSync] Error sincronizando tasa a Supabase:', err.message);
                });

                return { success: false, reason: 'AUTO_UPDATE_DISABLED' };
            }

            console.log(`[BCVAutoSync] 🔍 Consultando tasa oficial vigente del BCV (${reason})...`);
            const bcvResult = await BCVRateService.getOfficialRate();

            if (!bcvResult || !bcvResult.rate || isNaN(bcvResult.rate) || bcvResult.rate <= 0) {
                throw new Error('La tasa retornada por BCV no es válida');
            }

            const newRate = Number(bcvResult.rate);
            const currentRate = Number(userSettings.exchangeRate || 1.0);
            this.lastSyncTime = new Date().toISOString();

            // Si la tasa cambió o si es forzada
            const rateChanged = Math.abs(newRate - currentRate) > 0.0001;

            if (rateChanged || force) {
                console.log(`[BCVAutoSync] 💱 Tasa oficial actualizada: ${currentRate} Bs/$ ➔ ${newRate} Bs/$ (Fuente: ${bcvResult.source})`);

                userSettings.exchangeRate = newRate;
                userSettings.lastRateSyncAt = this.lastSyncTime;
                userSettings.rateSource = bcvResult.source || 'BCV';
                userSettings.autoUpdateRate = true;

                allSettings[companyId] = userSettings;
                if (allSettings['default']) {
                    allSettings['default'].exchangeRate = newRate;
                    allSettings['default'].lastRateSyncAt = this.lastSyncTime;
                    allSettings['default'].rateSource = bcvResult.source || 'BCV';
                    allSettings['default'].autoUpdateRate = true;
                }

                const SettingsStoreService = require('./SettingsStoreService');
                await SettingsStoreService.persistCompanySettings(companyId, userSettings, allSettings);
                cache.del(`user_currency_1`);
                cache.del(`user_currency_2`);

                this.lastKnownRate = newRate;

                // Transmitir en tiempo real por WebSockets a todas las terminales
                const io = this.io;
                if (io) {
                    const payload = {
                        type: 'rate',
                        exchangeRate: newRate,
                        currencyMode: userSettings.currencyMode || 'BOTH',
                        autoUpdateRate: true,
                        source: bcvResult.source || 'BCV',
                        syncedAt: this.lastSyncTime,
                        reason
                    };
                    const roomsToNotify = new Set([String(companyId || '2')]);
                    if (allSettings['default']) roomsToNotify.add('default');
                    for (const room of roomsToNotify) {
                        io.to(room).emit('settings_changed', payload);
                    }
                    console.log(`[BCVAutoSync] 📡 Evento WebSocket emitido a terminales: ${newRate} Bs/$`);
                }

                // Sincronizar inmediatamente a la nube de Supabase (24/7)
                SupabaseSyncService.syncConfig(true).catch(err => {
                    console.warn('[BCVAutoSync] Error sincronizando tasa a Supabase:', err.message);
                });

                return {
                    success: true,
                    updated: true,
                    rate: newRate,
                    previousRate: currentRate,
                    source: bcvResult.source,
                    syncedAt: this.lastSyncTime
                };
            } else {
                console.log(`[BCVAutoSync] ✅ Tasa verificada sin cambios: ${currentRate} Bs/$ (al día).`);
                // Sincronizar inmediatamente a la nube de Supabase (24/7)
                SupabaseSyncService.syncConfig(true).catch(err => {
                    console.warn('[BCVAutoSync] Error sincronizando tasa a Supabase:', err.message);
                });

                return {
                    success: true,
                    updated: false,
                    rate: currentRate,
                    source: bcvResult.source,
                    syncedAt: this.lastSyncTime
                };
            }
        } catch (error) {
            console.error('[BCVAutoSync] ❌ Error en sincronización:', error.message);
            return { success: false, error: error.message };
        } finally {
            this.isSyncing = false;
        }
    }
}

const service = new BCVAutoSyncService();
module.exports = service;
