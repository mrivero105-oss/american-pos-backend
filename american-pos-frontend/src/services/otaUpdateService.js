import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import axios from 'axios';
import toast from 'react-hot-toast';
import { getBaseUrl } from './api';
import { getSupabaseStoragePublicUrl } from '../config/supabaseConfig';

let isChecking = false;
let updateReady = false;
let newVersionDownloaded = null;

export const otaUpdateService = {
    /**
     * Inicializa el servicio OTA en la app nativa.
     * Marca el bundle actual como funcional para prevenir rollbacks automáticos de Capacitor.
     */
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

        // Buscar actualizaciones silenciosamente tras iniciar la app
        setTimeout(() => {
            this.checkForUpdates({ silent: true }).catch((err) => {
                console.warn('[OTA_UPDATE] Error en verificación inicial:', err?.message || err);
            });
        }, 3500);
    },

    /**
     * Retorna la versión actual registrada o la nativa por defecto.
     */
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
     * Consulta el servidor LAN / Cloud por nuevas versiones empaquetadas.
     * @param {Object} options
     * @param {boolean} options.silent - Si es true, no muestra toasts a menos que haya descarga
     * @param {boolean} options.immediate - Si es true, recarga la app inmediatamente al completar
     * @param {Function} options.onProgress - Callback con porcentaje (0 - 100)
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

            // Consultar manifiesto de versión:
            // 1. Prioridad: Supabase Cloud Storage (24/7 con datos móviles en Internet)
            // 2. Fallback: Servidor local de la PC (Wi-Fi)
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

            if (remote.version === currentVer) {
                if (toastId) toast.success('La aplicación ya está en la última versión.', { id: toastId });
                return { updateAvailable: false, currentVersion: currentVer };
            }

            // Hay una versión nueva: Preparar descarga
            if (toastId) {
                toast.loading(`Descargando actualización v${remote.version.split('.').slice(-1)[0] || ''}...`, { id: toastId });
            }

            let progressListener = null;
            if (options.onProgress) {
                progressListener = await CapacitorUpdater.addListener('downloadProgress', (info) => {
                    const percent = Math.round(info.percent || 0);
                    options.onProgress(percent);
                });
            }

            const downloadUrl = remote.bundleUrl.startsWith('http')
                ? remote.bundleUrl
                : `${baseUrl}${remote.bundleUrl}`;

            console.log(`[OTA_UPDATE] 📥 Descargando bundle desde: ${downloadUrl}`);
            const bundle = await CapacitorUpdater.download({
                url: downloadUrl,
                version: remote.version,
                checksum: remote.checksum || ''
            });

            if (progressListener) {
                progressListener.remove();
            }

            console.log('[OTA_UPDATE] ✅ Bundle descargado:', bundle.id);

            // Registrar nuevo bundle como el activo
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
                toast.success('✨ ¡Actualización OTA descargada! Se aplicará al reiniciar la aplicación.', {
                    duration: 8000,
                    icon: '🚀'
                });
            }

            return {
                updateAvailable: true,
                newVersion: remote.version,
                bundleId: bundle.id
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
