const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sequelize } = require('../database/connection');
const { BusinessSetting } = require('../database/models');
const { runWithTenantContext } = require('../database/tenantContext');
const { BASE_PATH, SETTINGS_FILE } = require('../config/paths');
const { readJson, writeJson, normalizeCompanyId } = require('../utils/helpers');
const cache = require('../utils/cacheService');

const BASE64_EXTERNALIZE_THRESHOLD_BYTES = 4096;

function saveBase64ToSupplierLogos(base64DataUri, prefix, companyId) {
    if (typeof base64DataUri !== 'string' || !base64DataUri.startsWith('data:image/') || base64DataUri.length < BASE64_EXTERNALIZE_THRESHOLD_BYTES) {
        return base64DataUri;
    }
    try {
        const match = base64DataUri.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!match) return base64DataUri;
        let ext = match[1].toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        if (!['png', 'jpg', 'webp', 'gif', 'svg'].includes(ext)) ext = 'png';
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length === 0) return base64DataUri;

        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
        const safeComp = String(companyId || '2').replace(/[^a-zA-Z0-9_-]/g, '');
        const fileName = `${prefix}_${safeComp}_${hash}.${ext}`;
        const logosDir = path.join(BASE_PATH, 'supplier_logos');
        if (!fs.existsSync(logosDir)) {
            fs.mkdirSync(logosDir, { recursive: true });
        }
        const filePath = path.join(logosDir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, buf);
        }
        return `/supplier_logos/${fileName}`;
    } catch (err) {
        console.warn('[SettingsStore] No se pudo externalizar imagen Base64:', err.message);
        return base64DataUri;
    }
}

function optimizeCompanySettingsPayload(companyId, companySettings) {
    if (!companySettings || typeof companySettings !== 'object') return { settings: companySettings, changed: false };
    let changed = false;
    const bInfo = companySettings.businessInfo;
    if (bInfo && typeof bInfo === 'object') {
        if (bInfo.logoUrl !== undefined) {
            if (!bInfo.logo && typeof bInfo.logoUrl === 'string' && bInfo.logoUrl.trim()) {
                bInfo.logo = bInfo.logoUrl;
            }
            delete bInfo.logoUrl;
            changed = true;
        }
        const imgFields = [
            ['logo', 'biz_logo'],
            ['pagoMovilQrImage', 'biz_pm_qr'],
            ['binanceQrImage', 'biz_bin_qr']
        ];
        for (const [field, prefix] of imgFields) {
            if (typeof bInfo[field] === 'string' && bInfo[field].startsWith('data:image/') && bInfo[field].length >= BASE64_EXTERNALIZE_THRESHOLD_BYTES) {
                const extUrl = saveBase64ToSupplierLogos(bInfo[field], prefix, companyId);
                if (extUrl !== bInfo[field]) {
                    bInfo[field] = extUrl;
                    changed = true;
                }
            }
        }
    }

    if (Array.isArray(companySettings.paymentMethods)) {
        for (const pm of companySettings.paymentMethods) {
            if (!pm || typeof pm !== 'object') continue;
            if (typeof pm.pagoMovilQrImage === 'string' && pm.pagoMovilQrImage.startsWith('data:image/') && pm.pagoMovilQrImage.length >= BASE64_EXTERNALIZE_THRESHOLD_BYTES) {
                const extUrl = saveBase64ToSupplierLogos(pm.pagoMovilQrImage, 'pm_qr', companyId);
                if (extUrl !== pm.pagoMovilQrImage) {
                    pm.pagoMovilQrImage = extUrl;
                    changed = true;
                }
            }
            if (typeof pm.binanceQrImage === 'string' && pm.binanceQrImage.startsWith('data:image/') && pm.binanceQrImage.length >= BASE64_EXTERNALIZE_THRESHOLD_BYTES) {
                const extUrl = saveBase64ToSupplierLogos(pm.binanceQrImage, 'bin_qr', companyId);
                if (extUrl !== pm.binanceQrImage) {
                    pm.binanceQrImage = extUrl;
                    changed = true;
                }
            }
        }
    }

    return { settings: companySettings, changed };
}

/**
 * Gestiona la configuración del negocio con respaldo transaccional en PostgreSQL ("BusinessSettings")
 * y compatibilidad síncrona con settings.json atómico + caché de aplicación.
 */
class SettingsStoreService {
    static async ensureTableExists() {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS "BusinessSettings" (
                "id" VARCHAR(255) PRIMARY KEY,
                "companyId" VARCHAR(255) NOT NULL UNIQUE,
                "settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
                "version" INTEGER NOT NULL DEFAULT 1,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
    }

    /**
     * Persiste la configuración de una empresa dentro de una transacción con bloqueo de fila (FOR UPDATE)
     * y sincroniza caché + settings.json atómicamente.
     */
    static async persistCompanySettings(rawCompanyId, companySettings, allSettingsSnapshot = null) {
        const companyId = normalizeCompanyId(rawCompanyId);
        optimizeCompanySettingsPayload(companyId, companySettings);
        const allSettings = allSettingsSnapshot || readJson(SETTINGS_FILE) || {};
        allSettings[companyId] = companySettings;
        if (companyId === '2' && allSettings.default) {
            delete allSettings.default;
        }

        writeJson(SETTINGS_FILE, allSettings);
        cache.set('all_settings', allSettings, 3600);

        try {
            await runWithTenantContext({ companyId, userId: 'system-settings', isSuperAdmin: true }, async () => {
                await sequelize.transaction(async (t) => {
                    const existing = await BusinessSetting.findOne({
                        where: { companyId },
                        transaction: t,
                        lock: t.LOCK ? t.LOCK.UPDATE : undefined
                    });
                    if (existing) {
                        await existing.update({
                            settings: companySettings,
                            version: (Number(existing.version) || 1) + 1
                        }, { transaction: t });
                    } else {
                        await BusinessSetting.create({
                            id: companyId,
                            companyId,
                            settings: companySettings,
                            version: 1
                        }, { transaction: t });
                    }
                });
            });
        } catch (dbErr) {
            // Si la BD aún está arrancando o la tabla no existe en tests aislados, el JSON atómico ya quedó persistido.
            if (!/does not exist|ECONNREFUSED|not initialized/i.test(String(dbErr?.message || ''))) {
                console.warn('[SettingsStore] Aviso persistiendo BusinessSettings en PG:', dbErr.message);
            }
        }
        return allSettings;
    }

    /**
     * Hidrata settings desde PostgreSQL si existen registros más completos que el archivo local.
     */
    static async hydrateAllFromDb() {
        try {
            const diskSettings = readJson(SETTINGS_FILE) || {};
            const rows = await runWithTenantContext({ companyId: '', userId: 'system-settings', isSuperAdmin: true }, async () => {
                return await BusinessSetting.findAll({ raw: true });
            });
            if (!rows || rows.length === 0) {
                // Sembrar BD inicialmente desde settings.json si existe configuración del comercio
                const entries = Object.entries(diskSettings).filter(([k, v]) =>
                    k !== 'autoLaunch' && v && typeof v === 'object'
                );
                for (const [key, cfg] of entries) {
                    const normalized = normalizeCompanyId(key);
                    if (key === 'default' && diskSettings['2']) continue;
                    await BusinessSetting.findOrCreate({
                        where: { companyId: normalized },
                        defaults: { id: normalized, companyId: normalized, settings: cfg, version: 1 }
                    }).catch(() => {});
                }
                return diskSettings;
            }

            let changed = false;
            const merged = { ...diskSettings };
            if (merged['2'] && merged.default) {
                delete merged.default;
                changed = true;
            }
            for (const [compKey, compCfg] of Object.entries(merged)) {
                if (compKey === 'autoLaunch' || !compCfg || typeof compCfg !== 'object') continue;
                const optRes = optimizeCompanySettingsPayload(compKey, compCfg);
                if (optRes.changed) {
                    changed = true;
                    await BusinessSetting.update(
                        { settings: compCfg },
                        { where: { companyId: normalizeCompanyId(compKey) } }
                    ).catch(() => {});
                }
            }
            for (const row of rows) {
                if (row.companyId && row.settings && typeof row.settings === 'object' && !merged[row.companyId]) {
                    optimizeCompanySettingsPayload(row.companyId, row.settings);
                    merged[row.companyId] = row.settings;
                    changed = true;
                }
            }
            if (changed) {
                writeJson(SETTINGS_FILE, merged);
            }
            cache.set('all_settings', merged, 3600);
            return merged;
        } catch (_err) {
            return readJson(SETTINGS_FILE) || {};
        }
    }
}

module.exports = SettingsStoreService;
