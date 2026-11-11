export const IDLE_LOCK_STORAGE_KEY = 'app_idle_lock_minutes';
export const IDLE_LOCK_CHANGED_EVENT = 'idle-lock-settings-changed';

const MAX_IDLE_LOCK_MINUTES = 24 * 60;
const DEFAULT_IDLE_LOCK_MINUTES = 15;

export function getIdleLockMinutes() {
    const raw = localStorage.getItem(IDLE_LOCK_STORAGE_KEY);
    if (raw === null || raw === '') return DEFAULT_IDLE_LOCK_MINUTES;

    const minutes = parseInt(raw, 10);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_IDLE_LOCK_MINUTES;
}

export function getIdleLockTimeoutMs() {
    const minutes = getIdleLockMinutes();
    return minutes > 0 ? minutes * 60 * 1000 : 0;
}

export function setIdleLockMinutes(minutes) {
    const value = Math.max(0, Math.min(MAX_IDLE_LOCK_MINUTES, Math.floor(Number(minutes) || 0)));
    localStorage.setItem(IDLE_LOCK_STORAGE_KEY, String(value));
    window.dispatchEvent(new CustomEvent(IDLE_LOCK_CHANGED_EVENT, { detail: { minutes: value } }));
    return value;
}

export function formatIdleLockLabel(minutes) {
    if (!minutes || minutes <= 0) return 'Desactivado';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) return `${hours} h`;
    return `${hours} h ${remainingMinutes} min`;
}
