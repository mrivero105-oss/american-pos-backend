/**
 * Módulo de Identidad de Terminal (Isaac POS)
 * Genera, almacena y recupera un identificador persistente e inmutable por terminal/dispositivo.
 */

const TERMINAL_ID_STORAGE_KEY = 'isaac_pos_terminal_id';

/**
 * Genera un código de terminal aleatorio en formato TERM-XXXX-XXXX-XXXX
 */
function generateTerminalCode() {
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const segment = (len) => {
        let result = '';
        for (let i = 0; i < len; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };
    return `TERM-${segment(4)}-${segment(4)}-${segment(4)}`;
}

/**
 * Obtiene el ID de la terminal actual.
 * Si no existe en localStorage, genera uno nuevo y lo guarda.
 */
export function getTerminalId() {
    if (typeof window === 'undefined') return 'TERM-UNKNOWN-HOST';

    try {
        let terminalId = localStorage.getItem(TERMINAL_ID_STORAGE_KEY);
        if (terminalId && (terminalId.startsWith('POS-') || terminalId.startsWith('TERM-'))) {
            return terminalId;
        }

        // Si es una instalación host local con Electron y tiene HWID nativo disponible
        if (window.electronAPI && typeof window.electronAPI.getMachineId === 'function') {
            try {
                const nativeHwid = window.electronAPI.getMachineId();
                if (nativeHwid && nativeHwid.startsWith('POS-')) {
                    localStorage.setItem(TERMINAL_ID_STORAGE_KEY, nativeHwid);
                    return nativeHwid;
                }
            } catch (e) {
                console.warn('[TerminalIdentity] No se pudo leer HWID de Electron:', e.message);
            }
        }

        // Para equipos clientes, navegadores web, tablets y teléfonos:
        // Generar un ID único de terminal persistente
        const newTerminalId = generateTerminalCode();
        localStorage.setItem(TERMINAL_ID_STORAGE_KEY, newTerminalId);
        return newTerminalId;
    } catch (e) {
        console.warn('[TerminalIdentity] Error accediendo a localStorage:', e.message);
        return 'TERM-TEMP-CLIENT';
    }
}

/**
 * Permite asignar un Terminal ID explícito (por ejemplo, si el servidor le asigna su HWID nativo)
 */
export function setTerminalId(customId) {
    if (typeof window === 'undefined' || !customId) return;
    try {
        localStorage.setItem(TERMINAL_ID_STORAGE_KEY, customId.trim());
    } catch (e) {
        console.warn('[TerminalIdentity] Error guardando terminal ID:', e.message);
    }
}

export default getTerminalId;
