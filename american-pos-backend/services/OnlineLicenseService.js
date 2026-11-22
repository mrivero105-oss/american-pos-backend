const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Op } = require('sequelize');
const { BASE_PATH, SETTINGS_FILE } = require('../config/paths');
const SecretVault = require('../config/secretVault');
const licenseUtils = require('../utils/licenseUtils');

const clearLicenseCacheSafe = (machineId = null) => {
    try {
        const { clearLicenseCache } = require('../middleware/licenseMiddleware');
        if (typeof clearLicenseCache === 'function') {
            clearLicenseCache(machineId);
        }
    } catch (_) {}
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 60 * 60 * 1000; // 1 hora de tolerancia ante cambios menores de zona/NTP

class OnlineLicenseService {
    constructor() {
        this.io = null;
        this.intervalTimer = null;
        this.startupTimer = null;
        this.isSyncing = false;
    }

    _isIsolatedEnv() {
        return (
            process.env.ISAAC_TEST_ISOLATED === '1' ||
            process.env.NODE_ENV === 'test' ||
            process.env.DISABLE_BACKGROUND_WORKERS === 'true'
        );
    }

    getDefaultGraceDays() {
        const parsed = parseInt(process.env.LICENSE_OFFLINE_GRACE_DAYS || '7', 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 7;
    }

    getGatewayUrl(explicitUrl = null) {
        if (explicitUrl && typeof explicitUrl === 'string' && explicitUrl.trim()) {
            return explicitUrl.trim().replace(/\/+$/, '');
        }
        const fromEnv = process.env.LICENSE_GATEWAY_URL || SecretVault.getSecret('LICENSE_GATEWAY_URL') || '';
        if (fromEnv && fromEnv.trim()) {
            return fromEnv.trim().replace(/\/+$/, '');
        }
        try {
            const cfgPath = path.join(BASE_PATH, 'cloud_license_config.json');
            if (fs.existsSync(cfgPath)) {
                const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                if (parsed?.gatewayUrl && typeof parsed.gatewayUrl === 'string') {
                    return parsed.gatewayUrl.trim().replace(/\/+$/, '');
                }
            }
        } catch (_) {}
        return '';
    }

    saveGatewayUrl(gatewayUrl) {
        const clean = String(gatewayUrl || '').trim().replace(/\/+$/, '');
        if (clean && !/^https?:\/\//i.test(clean)) {
            throw new Error('La URL del servidor de licencias debe iniciar con http:// o https://');
        }
        if (!fs.existsSync(BASE_PATH)) {
            fs.mkdirSync(BASE_PATH, { recursive: true });
        }
        const cfgPath = path.join(BASE_PATH, 'cloud_license_config.json');
        const payload = {
            gatewayUrl: clean,
            updatedAt: new Date().toISOString()
        };
        const tmpPath = `${cfgPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmpPath, cfgPath);
        return clean;
    }

    _getBusinessLabel() {
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
                const comp = settings['2'] || settings['default'] || Object.values(settings)[0] || {};
                return comp?.businessInfo?.name || comp?.businessName || 'Isaac POS';
            }
        } catch (_) {}
        return 'Isaac POS';
    }

    /**
     * Evalúa localmente si una licencia permite operar según el último lease firmado en línea
     * y los días de gracia offline configurados. No requiere internet en cada request.
     */
    evaluateLocalLicenseWithOnlinePolicy(licenseRecord, machineId, now = Date.now(), options = {}) {
        if (!licenseRecord) {
            return {
                allowed: false,
                code: 'licencia_requerida',
                reason: 'No hay una licencia registrada para este equipo.'
            };
        }

        const meta = (licenseRecord.meta && typeof licenseRecord.meta === 'object') ? licenseRecord.meta : {};
        const recordStatus = String(licenseRecord.status || '').toLowerCase();

        if (recordStatus === 'suspended' || recordStatus === 'revoked') {
            return {
                allowed: false,
                code: 'licencia_suspendida',
                status: recordStatus,
                suspended: true,
                reason: meta.suspensionReason || meta.onlineLease?.reason || 'Licencia suspendida por el proveedor. Verifica tu estado de cuenta o contacta a soporte.'
            };
        }

        if (licenseRecord.expiresAt) {
            const dbExpMs = Date.parse(licenseRecord.expiresAt);
            if (Number.isFinite(dbExpMs) && now > dbExpMs) {
                return {
                    allowed: false,
                    code: 'licencia_suspendida',
                    status: 'suspended',
                    suspended: true,
                    expired: true,
                    reason: 'La licencia de este terminal ha expirado. Contacta al proveedor para renovarla.'
                };
            }
        }

        const gatewayUrl = options.gatewayUrl !== undefined ? options.gatewayUrl : this.getGatewayUrl();
        const onlineRequired = Boolean(gatewayUrl) || Boolean(meta.requiresOnlineValidation);
        const defaultGraceDays = Number.isFinite(Number(options.graceDays))
            ? Number(options.graceDays)
            : this.getDefaultGraceDays();

        const leaseToken = meta.onlineLeaseToken;
        if (leaseToken) {
            const leaseCheck = licenseUtils.verifyRemoteLeaseToken(leaseToken, machineId);
            if (!leaseCheck.valid) {
                if (onlineRequired) {
                    return {
                        allowed: false,
                        code: 'licencia_verificacion_requerida',
                        graceExpired: true,
                        reason: 'La prueba de validación en línea local es inválida. Conecta el equipo a internet para validar tu licencia.'
                    };
                }
                return { allowed: true, onlineVerified: false, mode: 'legacy_fallback' };
            }

            const lease = leaseCheck.lease;
            if (lease.status === 'suspended' || lease.status === 'revoked') {
                return {
                    allowed: false,
                    code: 'licencia_suspendida',
                    status: lease.status,
                    suspended: true,
                    reason: lease.reason || 'Licencia suspendida por el proveedor.',
                    lease
                };
            }

            if (lease.expMs && now > lease.expMs) {
                return {
                    allowed: false,
                    code: 'licencia_suspendida',
                    status: 'suspended',
                    suspended: true,
                    expired: true,
                    reason: 'La licencia del sistema ha vencido. Contacta al proveedor para renovarla.',
                    lease
                };
            }

            if (lease.serverTime && (now + CLOCK_SKEW_TOLERANCE_MS < lease.serverTime)) {
                return {
                    allowed: false,
                    code: 'licencia_verificacion_requerida',
                    graceExpired: true,
                    clockSkew: true,
                    reason: 'El reloj del sistema es anterior a la última validación en línea. Corrige la fecha u obtén verificación online.',
                    lease
                };
            }

            if (lease.graceUntil && now > lease.graceUntil) {
                return {
                    allowed: false,
                    code: 'licencia_verificacion_requerida',
                    graceExpired: true,
                    reason: `Se agotó el periodo de gracia offline (${lease.graceDays} días). Conecta el equipo a internet y pulsa "Verificar Estado en Línea".`,
                    graceUntil: new Date(lease.graceUntil).toISOString(),
                    graceDays: lease.graceDays,
                    lease
                };
            }

            return {
                allowed: true,
                onlineVerified: true,
                status: 'active',
                graceDays: lease.graceDays,
                graceUntil: lease.graceUntil ? new Date(lease.graceUntil).toISOString() : null,
                lastSyncAt: meta.onlineSync?.lastHeartbeatAt || (lease.iat ? new Date(lease.iat).toISOString() : null),
                lease
            };
        }

        if (!onlineRequired) {
            return {
                allowed: true,
                onlineVerified: false,
                mode: 'offline_only',
                status: 'active'
            };
        }

        const anchorIso = licenseRecord.activatedAt || licenseRecord.createdAt;
        const anchorMs = anchorIso ? Date.parse(anchorIso) : NaN;
        const baseMs = Number.isFinite(anchorMs) ? anchorMs : now;
        const initialGraceUntil = baseMs + (defaultGraceDays * DAY_MS);

        if (meta.onlineSync?.maxObservedLocalMs && (now + CLOCK_SKEW_TOLERANCE_MS < Number(meta.onlineSync.maxObservedLocalMs))) {
            return {
                allowed: false,
                code: 'licencia_verificacion_requerida',
                graceExpired: true,
                clockSkew: true,
                reason: 'Cambio anómalo en la fecha del sistema. Conecta el equipo a internet para validar tu licencia.'
            };
        }

        if (now > initialGraceUntil) {
            return {
                allowed: false,
                code: 'licencia_verificacion_requerida',
                graceExpired: true,
                graceDays: defaultGraceDays,
                graceUntil: new Date(initialGraceUntil).toISOString(),
                reason: `Han transcurrido más de ${defaultGraceDays} días sin completar la primera verificación en línea. Conecta el equipo a internet.`
            };
        }

        return {
            allowed: true,
            onlineVerified: false,
            pendingFirstHeartbeat: true,
            status: 'active',
            graceDays: defaultGraceDays,
            graceUntil: new Date(initialGraceUntil).toISOString()
        };
    }

    /**
     * Consulta al Gateway central de licencias y persiste el lease RSA-2048 firmado en la licencia local.
     */
    async syncHeartbeat(targetMachineId = null, options = {}) {
        const allowInTest = Boolean(options.gatewayUrl) || process.env.ALLOW_ONLINE_LICENSE_TEST === '1';
        if (this._isIsolatedEnv() && !allowInTest) {
            return { success: false, skipped: true, reason: 'Entorno aislado/test' };
        }

        const gatewayUrl = this.getGatewayUrl(options.gatewayUrl);
        if (!gatewayUrl) {
            return { success: false, skipped: true, reason: 'LICENSE_GATEWAY_URL no configurada' };
        }

        if (this.isSyncing && !options.force) {
            return { success: false, skipped: true, reason: 'Sincronización de licencia en progreso' };
        }

        this.isSyncing = true;
        try {
            const { License } = require('../database/models');
            const serverMachineId = await licenseUtils.getMachineId();
            const machineId = String(targetMachineId || serverMachineId).trim();

            const localLicense = await License.findOne({
                where: {
                    machineId,
                    status: { [Op.in]: ['active', 'suspended', 'revoked'] }
                },
                order: [['createdAt', 'DESC']]
            });

            const payload = {
                machineId,
                serverMachineId,
                businessName: options.businessName || this._getBusinessLabel(),
                appVersion: '24.04.0',
                localStatus: localLicense?.status || 'none',
                licenseKey: localLicense?.licenseKey || undefined,
                clientTimeMs: Date.now()
            };

            const httpPost = options.httpPost || ((url, body, cfg) => axios.post(url, body, cfg));
            const timeoutMs = Number(options.timeoutMs || 6000);
            const resp = await httpPost(`${gatewayUrl}/heartbeat`, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: timeoutMs
            });

            const resData = resp?.data || {};
            if (!resData.leaseToken) {
                return {
                    success: false,
                    error: resData.error || 'El servidor de licencias no devolvió un leaseToken firmado.'
                };
            }

            const verifyRes = licenseUtils.verifyRemoteLeaseToken(resData.leaseToken, machineId);
            if (!verifyRes.valid) {
                return {
                    success: false,
                    tampered: true,
                    error: verifyRes.message
                };
            }

            const lease = verifyRes.lease;
            const prevStatus = localLicense?.status || null;
            const nowIso = new Date().toISOString();

            if (localLicense) {
                const prevMeta = (localLicense.meta && typeof localLicense.meta === 'object') ? localLicense.meta : {};
                const nextMeta = {
                    ...prevMeta,
                    requiresOnlineValidation: true,
                    onlineLease: lease,
                    onlineLeaseToken: resData.leaseToken,
                    suspensionReason: lease.status === 'active' ? null : (lease.reason || 'Licencia suspendida por el proveedor.'),
                    onlineSync: {
                        ...(prevMeta.onlineSync || {}),
                        gatewayUrl,
                        lastHeartbeatAt: nowIso,
                        lastServerTimeMs: lease.serverTime,
                        maxObservedLocalMs: Math.max(Number(prevMeta.onlineSync?.maxObservedLocalMs || 0), Date.now())
                    }
                };

                await localLicense.update({
                    status: lease.status,
                    meta: nextMeta
                });
            }

            if (machineId === serverMachineId) {
                clearLicenseCacheSafe();
            } else {
                clearLicenseCacheSafe(machineId);
            }

            if (this.io && typeof this.io.emit === 'function' && prevStatus !== lease.status) {
                this.io.emit('license_status_changed', {
                    machineId,
                    status: lease.status,
                    reason: lease.reason || null,
                    graceUntil: lease.graceUntil ? new Date(lease.graceUntil).toISOString() : null
                });
            }

            return {
                success: true,
                machineId,
                status: lease.status,
                reason: lease.reason || null,
                graceDays: lease.graceDays,
                graceUntil: lease.graceUntil ? new Date(lease.graceUntil).toISOString() : null,
                lease
            };
        } catch (err) {
            return {
                success: false,
                offline: true,
                error: err?.response?.data?.error || err.message || 'No se pudo conectar al servidor de licencias'
            };
        } finally {
            this.isSyncing = false;
        }
    }

    start(io = null, intervalMs = 15 * 60 * 1000) {
        if (io) this.io = io;
        if (this._isIsolatedEnv()) {
            return;
        }
        if (this.intervalTimer) return;

        this.startupTimer = setTimeout(() => {
            this.syncHeartbeat().catch(() => {});
        }, 10000);
        if (typeof this.startupTimer.unref === 'function') this.startupTimer.unref();

        this.intervalTimer = setInterval(() => {
            this.syncHeartbeat().catch(() => {});
        }, intervalMs);
        if (typeof this.intervalTimer.unref === 'function') this.intervalTimer.unref();
    }

    stop() {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
    }
}

module.exports = new OnlineLicenseService();
