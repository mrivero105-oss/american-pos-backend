/**
 * haptics.js - Isaac POS
 * Sistema unificado de feedback háptico con aceleración por hardware.
 * Prioriza el motor táctil lineal nativo de Android (0ms latencia) y fallback a Web Vibration API.
 */

export const hapticTap = () => {
    try {
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.triggerHaptic) {
            window.Capacitor.Plugins.PosNativeHardware.triggerHaptic({ type: 'light' });
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(15);
        }
    } catch (_e) {}
};

export const hapticSuccess = () => {
    try {
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.triggerHaptic) {
            window.Capacitor.Plugins.PosNativeHardware.triggerHaptic({ type: 'medium' });
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([20, 40, 20]);
        }
    } catch (_e) {}
};

export const hapticHeavy = () => {
    try {
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.triggerHaptic) {
            window.Capacitor.Plugins.PosNativeHardware.triggerHaptic({ type: 'heavy' });
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(45);
        }
    } catch (_e) {}
};

export const hapticError = () => {
    try {
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.triggerHaptic) {
            window.Capacitor.Plugins.PosNativeHardware.triggerHaptic({ type: 'heavy' });
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([60, 40, 60]);
        }
    } catch (_e) {}
};

export const triggerHaptic = (typeOrMs = 'light') => {
    if (typeof typeOrMs === 'number') {
        if (typeOrMs >= 25) return hapticHeavy();
        if (typeOrMs >= 18) return hapticSuccess();
        return hapticTap();
    }
    if (typeOrMs === 'heavy') return hapticHeavy();
    if (typeOrMs === 'medium' || typeOrMs === 'success') return hapticSuccess();
    if (typeOrMs === 'error') return hapticError();
    return hapticTap();
};

export default {
    tap: hapticTap,
    success: hapticSuccess,
    heavy: hapticHeavy,
    error: hapticError,
    trigger: triggerHaptic
};
