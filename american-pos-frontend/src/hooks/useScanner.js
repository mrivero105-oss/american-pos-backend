import { useEffect, useRef } from 'react';

/**
 * Hook global y resiliente para lectores de códigos de barras:
 * - Pistolas láser / 2D USB y Bluetooth (con o sin sufijo Enter/Tab)
 * - Escáneres con pausa antes de Enter (hasta 350ms)
 * - Auto-disparo por ráfaga rápida sin Enter (lectores sin sufijo CR/LF)
 * - Recepción en tiempo real desde cámara móvil / terminal remota ('remote-barcode-scan')
 *
 * @param {Function} onScan - Callback al completar lectura: (barcode, meta) => void
 * @param {Object} options - Opciones de configuración
 * @param {number} options.timeout - Máx ms entre teclas de una ráfaga (default: 150ms)
 * @param {number} options.minLength - Longitud mínima de código (default: 3)
 * @param {boolean} options.enabled - Habilitar/deshabilitar listener (default: true)
 * @param {boolean} options.allowInInputs - Permitir captura de ráfagas rápidas aunque el foco esté en un input (default: false)
 * @param {boolean} options.priority - Si es true (ej. dentro de un Modal abierto), intercepta antes que la vista de fondo (default: false)
 */
export default function useScanner(onScan, options = {}) {
    const {
        timeout = 150,
        minLength = 3,
        enabled = true,
        allowInInputs = false,
        priority = false
    } = options;

    const bufferRef = useRef('');
    const timerRef = useRef(null);
    const firstKeyTimeRef = useRef(0);
    const lastKeyTimeRef = useRef(0);
    const lastDispatchedRef = useRef({ code: '', time: 0 });
    const onScanRef = useRef(onScan);

    useEffect(() => {
        onScanRef.current = onScan;
    }, [onScan]);

    useEffect(() => {
        if (!enabled) return;

        const resetBuffer = () => {
            bufferRef.current = '';
            firstKeyTimeRef.current = 0;
            lastKeyTimeRef.current = 0;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };

        const dispatchScan = (rawCode, meta = {}) => {
            const cleanCode = String(rawCode || '').replace(/[\r\n\t]+/g, '').trim();
            if (!cleanCode || cleanCode.length < minLength) return false;

            const nowMs = Date.now();
            if (
                lastDispatchedRef.current.code === cleanCode &&
                (nowMs - lastDispatchedRef.current.time) < 350
            ) {
                return false;
            }

            lastDispatchedRef.current = { code: cleanCode, time: nowMs };
            window.__ISAAC_LAST_LOCAL_SCAN__ = { barcode: cleanCode, ts: nowMs };

            const activeEl = document.activeElement;
            const isPosSearch = Boolean(activeEl?.dataset?.posSearch === 'true');
            if (isPosSearch && activeEl) {
                activeEl.value = '';
                window.dispatchEvent(new CustomEvent('pos-scanner-clear'));
            }

            if (onScanRef.current) {
                onScanRef.current(cleanCode, meta);
                return true;
            }
            return false;
        };

        const extractPrintableChar = (e) => {
            if (e.key && e.key.length === 1) {
                return e.key;
            }
            if (e.code) {
                if (e.code.startsWith('Digit') && e.code.length === 6) {
                    return e.code.slice(5);
                }
                if (e.code.startsWith('Numpad') && e.code.length === 7 && /\d/.test(e.code[6])) {
                    return e.code[6];
                }
            }
            return null;
        };

        const handleKeyDown = (e) => {
            if (e.ctrlKey || e.metaKey) return;

            // Si hay un modal prioritario abierto y este hook NO es prioritario, ceder el paso
            if (!priority && document.body.dataset.scannerModalActive === 'true') {
                resetBuffer();
                return;
            }

            const activeEl = document.activeElement;
            const tag = activeEl?.tagName;
            const isEditable = Boolean(
                activeEl && (
                    tag === 'INPUT' ||
                    tag === 'TEXTAREA' ||
                    tag === 'SELECT' ||
                    activeEl.isContentEditable
                )
            );
            const isPosSearch = Boolean(activeEl?.dataset?.posSearch === 'true');
            const isBarcodeField = Boolean(activeEl?.dataset?.barcodeInput === 'true');

            const now = performance.now();
            const timeSinceLastKey = lastKeyTimeRef.current > 0 ? (now - lastKeyTimeRef.current) : 999;
            const isHardwareBurstTiming = timeSinceLastKey <= 45;

            if (isEditable && !isPosSearch && !isBarcodeField && !allowInInputs) {
                if (isHardwareBurstTiming) {
                    // Detectada ráfaga de escáner dentro de un input normal:
                    // 1. Si el primer carácter se coló en el input hace <45ms, limpiarlo
                    if (bufferRef.current.length === 1 && activeEl && typeof activeEl.value === 'string') {
                        const leakedChar = bufferRef.current;
                        if (activeEl.value.endsWith(leakedChar)) {
                            activeEl.value = activeEl.value.slice(0, -1);
                            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }
                    // 2. Bloquear la inserción en el input pero permitir que useScanner siga acumulando el código
                    e.preventDefault();
                    e.stopPropagation();
                } else if (e.key === 'Enter' && bufferRef.current.length >= minLength) {
                    // Bloquear el Enter final del escáner para que NO haga submit del formulario
                    e.preventDefault();
                    e.stopPropagation();
                } else {
                    // Es el primer carácter o escritura humana manual:
                    // Guardar timestamp y primer carácter en buffer sin abortar el rastreo temporal
                    if (e.key.length === 1) {
                        bufferRef.current = e.key;
                        lastKeyTimeRef.current = now;
                    } else {
                        resetBuffer();
                    }
                    return;
                }
            }

            if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.key === 'Tab') {
                const currentBuffer = bufferRef.current.trim();
                const charCount = currentBuffer.length;
                const totalDuration = charCount > 1 ? (now - firstKeyTimeRef.current) : 0;
                const avgInterval = charCount > 1 ? (totalDuration / (charCount - 1)) : 0;

                // Si acaba de auto-dispararse hace pocos ms por ráfaga sin Enter, consumir el Enter tardío
                if (
                    e.key !== 'Tab' &&
                    lastDispatchedRef.current.code &&
                    (Date.now() - lastDispatchedRef.current.time) < 450
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    resetBuffer();
                    return;
                }

                const isRapidBurst = charCount >= minLength && (
                    avgInterval <= timeout ||
                    (!isPosSearch && !isEditable)
                );

                if (
                    (isRapidBurst && e.key !== 'Tab') ||
                    (e.key === 'Tab' && charCount >= minLength && avgInterval <= 85)
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    resetBuffer();
                    if (isBarcodeField && activeEl) {
                        activeEl.value = currentBuffer;
                    }
                    dispatchScan(currentBuffer, { source: 'hardware_keyboard', target: activeEl });
                    return;
                }

                resetBuffer();
                return;
            }

            const ch = extractPrintableChar(e);
            if (!ch) return;

            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }

            if (lastKeyTimeRef.current > 0 && (now - lastKeyTimeRef.current) > 320) {
                bufferRef.current = '';
                firstKeyTimeRef.current = now;
            } else if (bufferRef.current.length === 0) {
                firstKeyTimeRef.current = now;
            }

            bufferRef.current += ch;
            lastKeyTimeRef.current = now;

            const currentBuffer = bufferRef.current;
            const charCount = currentBuffer.length;
            const totalDuration = charCount > 1 ? (now - firstKeyTimeRef.current) : 0;
            const avgInterval = charCount > 1 ? (totalDuration / (charCount - 1)) : 999;

            // Auto-disparo para lectores configurados SIN tecla Enter al final (ráfaga ultrarrápida >= 5 chars)
            timerRef.current = setTimeout(() => {
                const pending = bufferRef.current.trim();
                const count = pending.length;
                if (count >= Math.max(minLength, 5) && avgInterval <= 55) {
                    resetBuffer();
                    dispatchScan(pending, { source: 'hardware_auto_burst', target: document.activeElement });
                } else {
                    // Dar margen adicional por si el lector envía Enter con retardo (hasta 350ms total)
                    timerRef.current = setTimeout(() => {
                        resetBuffer();
                    }, 200);
                }
            }, 150);
        };

        const handleRemoteScan = (e) => {
            if (!priority && document.body.dataset.scannerModalActive === 'true') {
                return;
            }
            const code = e?.detail?.barcode || e?.detail?.code;
            if (!code) return;
            if (priority && typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            dispatchScan(code, { source: e?.detail?.source || 'remote', remote: true });
        };

        if (priority) {
            document.body.dataset.scannerModalActive = 'true';
        }

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('remote-barcode-scan', handleRemoteScan);

        return () => {
            if (priority) {
                delete document.body.dataset.scannerModalActive;
            }
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('remote-barcode-scan', handleRemoteScan);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [timeout, minLength, enabled, allowInInputs, priority]);
}
