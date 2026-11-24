import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import axios from 'axios';
import toast from 'react-hot-toast';
import { getBaseUrl } from './api';
import { getSupabaseStoragePublicUrl } from '../config/supabaseConfig';
import { OTA_PUBLIC_KEY_PEM } from '../config/otaPublicKey';
import { computeSha256Hex, verifyRsaSha256Bytes } from '../utils/clientLicenseValidator';

let isChecking = false;
let updateReady = false;
let newVersionDownloaded = null;

/**
 * Compara dos versiones numéricas/semver separadas por punto (ej. "24.4.3.1795365711").
 * Retorna:
 *  > 0 si remoteVer > localVer (actualización válida)
 *    0 si son equivalentes
 *  < 0 si remoteVer < localVer (downgrade — debe rechazarse)
 */
export function compareOtaVersions(remoteVer, localVer) {
    const parseParts = (v) => String(v || '')
        .trim()
        .replace(/^v/i, '')
        .split('.')
        .map((seg) => {
            const m = seg.match(/^\d+/);
            return m ? Number(m[0]) : 0;
        });

    const a = parseParts(remoteVer);
    const b = parseParts(localVer);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

/**
 * Verifica integridad criptográfica estricta (fallo cerrado) de un paquete OTA descargado.
 * - Exige checksum SHA-256 válido (64 hex chars) y coincidencia exacta con los bytes descargados.
 * - Exige firma digital RSA-SHA256 obligatoria contra la clave pública OTA dedicada embebida.
 * - Si el manifiesto incluye otaManifestSignature, valida también version|checksum|buildTime.
 */
export async function verifyOtaPackageIntegrity(bundleBytes, remoteManifest, options = {}) {
    if (!bundleBytes) {
        throw new Error('Paquete OTA vacío o ilegible.');
    }
    const bytes = bundleBytes instanceof Uint8Array
        ? bundleBytes
        : new Uint8Array(bundleBytes);

    if (bytes.byteLength === 0) {
        throw new Error('Paquete OTA vacío (0 bytes).');
    }

    const expectedChecksum = String(remoteManifest?.checksum || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) {
        throw new Error('Manifiesto OTA sin checksum SHA-256 válido. Actualización rechazada.');
    }

    const actualChecksum = (await computeSha256Hex(bytes)).toLowerCase();
    if (actualChecksum !== expectedChecksum) {
        throw new Error('Integridad SHA-256 del paquete OTA inválida. Actualización rechazada.');
    }

    const publicKeyPem = options.publicKeyPem || OTA_PUBLIC_KEY_PEM;
    const signature = String(remoteManifest?.otaSignature || '').trim();
    if (!signature) {
        throw new Error('Paquete OTA sin firma digital RSA-SHA256 obligatoria. Actualización rechazada.');
    }

    const isSignatureValid = await verifyRsaSha256Bytes(bytes, signature, publicKeyPem);
    if (!isSignatureValid) {
        throw new Error('Firma criptográfica RSA-SHA256 del paquete OTA inválida. Actualización rechazada.');
    }

    if (remoteManifest?.otaManifestSignature && remoteManifest?.version && remoteManifest?.buildTime) {
        const canonical = `${remoteManifest.version}|${expectedChecksum}|${remoteManifest.buildTime}`;
        const manifestBytes = new TextEncoder().encode(canonical);
        const isManifestValid = await verifyRsaSha256Bytes(
            manifestBytes,
            String(remoteManifest.otaManifestSignature).trim(),
            publicKeyPem
        );
        if (!isManifestValid) {
            throw new Error('Firma criptográfica del manifiesto OTA inválida. Actualización rechazada.');
        }
    }

    return { verified: true, mode: 'rsa-sha256', checksum: actualChecksum };
}

export const otaUpdateService = {
    async init() {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        try {
            await CapacitorUpdater.notifyAppReady();
            console.log('[OTA_UPDATE] 🚀 App lista confirmada ante CapacitorUpdater.');
        } catch (e) {
            console.warn('[OTA_UPDATE] Advertencia en notifyAppReady:', e?.message || e);
        }

        setTimeout(() => {
            this.checkForUpdates({ silent: true }).catch((err) => {
                console.warn('[OTA_UPDATE] Error en verificación inicial:', err?.message || err);
            });
        }, 3500);
    },

    async getCurrentVersion() {
        if (!Capacitor.isNativePlatform()) {
            return 'Web / Localhost';
        }
        try {
            const current = await CapacitorUpdater.current();
            return current?.bundle?.version || localStorage.getItem('isaac_pos_ota_version') || '1.0.0';
        } catch {
            return localStorage.getItem('isaac_pos_ota_version') || '1.0.0';
        }
    },

    /**
     * Consulta el servidor Cloud / LAN por nuevas versiones empaquetadas.
     * Política estricta (Fallo Cerrado):
     * - Anti-downgrade: exige remote.version > currentVer.
     * - Firma RSA-SHA256 + SHA-256 obligatorios contra OTA_PUBLIC_KEY_PEM antes de instalar.
     * - Pasa el checksum SHA-256 firmado y verificado de forma obligatoria a CapacitorUpdater.download.
     */
    async checkForUpdates(options = { silent: true, immediate: false, onProgress: null }) {
        if (!Capacitor.isNativePlatform()) {
            if (!options.silent) {
                toast('Las actualizaciones OTA automáticas funcionan en la app nativa móvil (APK).', { icon: 'ℹ️' });
            }
            return { updateAvailable: false };
        }

        if (isChecking) {
            return { updateAvailable: false, checking: true };
        }

        isChecking = true;
        const toastId = !options.silent ? toast.loading('Buscando actualizaciones...') : null;

        let baseUrl = '';
        try {
            baseUrl = getBaseUrl() || '';

            let res = null;
            try {
                const cloudManifestUrl = getSupabaseStoragePublicUrl('app-updates', 'version.json');
                if (!cloudManifestUrl) throw new Error('Supabase URL no configurada');
                res = await axios.get(`${cloudManifestUrl}?_t=${Date.now()}`, { timeout: 5000 });
                console.log('[OTA_UPDATE] ☁️ Manifiesto de versión obtenido desde Supabase Cloud Storage');
            } catch (cloudErr) {
                console.warn('[OTA_UPDATE] Supabase Storage no disponible, intentando servidor local PC:', cloudErr.message);
                if (baseUrl) {
                    try {
                        res = await axios.get(`${baseUrl}/version.json?_t=${Date.now()}`, { timeout: 4000 });
                    } catch {
                        res = await axios.get(`${baseUrl}/api/app-update-info`, { timeout: 4000 });
                    }
                }
            }

            if (!res || !res.data) {
                if (toastId) toast.dismiss(toastId);
                return { updateAvailable: false };
            }

            const remote = res.data;
            if (!remote || !remote.version || !remote.bundleUrl) {
                if (toastId) toast.error('Respuesta inválida del servidor.');
                return { updateAvailable: false };
            }

            const currentVer = await this.getCurrentVersion();
            console.log(`[OTA_UPDATE] Versión actual: ${currentVer} | Remota en servidor: ${remote.version}`);

            // Protección anti-downgrade monotónica
            const cmp = compareOtaVersions(remote.version, currentVer);
            if (cmp <= 0) {
                if (cmp < 0) {
                    console.warn(`[OTA_UPDATE] 🛡️ Downgrade bloqueado: remota ${remote.version} < actual ${currentVer}`);
                }
                if (toastId) toast.success('La aplicación ya está en la última versión.', { id: toastId });
                return { updateAvailable: false, currentVersion: currentVer, downgradeBlocked: cmp < 0 };
            }

            // Fail-closed antes de descargar: exigir firma RSA-SHA256 y checksum SHA-256 en manifiesto
            if (!String(remote.otaSignature || '').trim()) {
                throw new Error('Paquete OTA sin firma digital RSA-SHA256 obligatoria. Actualización rechazada.');
            }
            if (!/^[a-f0-9]{64}$/i.test(String(remote.checksum || '').trim())) {
                throw new Error('Manifiesto OTA sin checksum SHA-256 válido. Actualización rechazada.');
            }

            const downloadUrl = remote.bundleUrl.startsWith('http')
                ? remote.bundleUrl
                : `${baseUrl}${remote.bundleUrl}`;

            if (toastId) {
                toast.loading('Verificando firma digital RSA-SHA256...', { id: toastId });
            }

            const zipRes = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                timeout: 60000
            });
            const verification = await verifyOtaPackageIntegrity(zipRes.data, remote, {
                publicKeyPem: options.publicKeyPem
            });
            console.log('[OTA_UPDATE] 🔐 Firma criptográfica RSA-SHA256 y checksum SHA-256 verificados correctamente.');

            if (toastId) {
                toast.loading(`Instalando actualización v${remote.version.split('.').slice(-1)[0] || ''}...`, { id: toastId });
            }

            let progressListener = null;
            if (options.onProgress) {
                progressListener = await CapacitorUpdater.addListener('downloadProgress', (info) => {
                    const percent = Math.round(info.percent || 0);
                    options.onProgress(percent);
                });
            }

            console.log(`[OTA_UPDATE] 📥 Descargando bundle verificado desde: ${downloadUrl}`);
            const bundle = await CapacitorUpdater.download({
                url: downloadUrl,
                version: remote.version,
                checksum: verification.checksum
            });

            if (progressListener) {
                progressListener.remove();
            }

            console.log('[OTA_UPDATE] ✅ Bundle verificado listo:', bundle.id);

            await CapacitorUpdater.set(bundle);
            localStorage.setItem('isaac_pos_ota_version', remote.version);
            updateReady = true;
            newVersionDownloaded = remote.version;

            if (toastId) toast.dismiss(toastId);

            if (options.immediate) {
                toast.success('¡Actualización instalada! Reiniciando...', { duration: 2000 });
                setTimeout(async () => {
                    await CapacitorUpdater.reload();
                }, 1500);
            } else {
                toast.success('✨ ¡Actualización OTA verificada! Se aplicará al reiniciar la aplicación.', {
                    duration: 8000,
                    icon: '🚀'
                });
            }

            return {
                updateAvailable: true,
                newVersion: remote.version,
                bundleId: bundle.id,
                verificationMode: verification.mode
            };
        } catch (err) {
            console.error('[OTA_UPDATE] Error durante la actualización OTA:', err);
            let userMsg = 'Error al verificar actualización.';
            if (err.response?.status === 503) {
                userMsg = 'Servidor PC no disponible temporalmente (503). Reintenta en unos instantes.';
            } else if (err.code === 'ECONNABORTED' || err.message?.includes('Network')) {
                userMsg = `Sin conexión con la PC principal (${baseUrl}). Verifica la IP en Conexión PC.`;
            } else if (err.message) {
                userMsg = `Aviso de actualización: ${err.message}`;
            }
            if (toastId) toast.error(userMsg, { id: toastId });
            return { updateAvailable: false, error: err };
        } finally {
            isChecking = false;
        }
    },

    isUpdateReady() {
        return updateReady;
    },

    getNewVersion() {
        return newVersionDownloaded;
    },

    async applyAndReload() {
        if (Capacitor.isNativePlatform()) {
            await CapacitorUpdater.reload();
        } else {
            window.location.reload();
        }
    }
};

export default otaUpdateService;
