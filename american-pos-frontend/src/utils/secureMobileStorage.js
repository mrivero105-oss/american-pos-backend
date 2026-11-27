/**
 * secureMobileStorage.js
 * Capa de almacenamiento seguro para Isaac POS (Desktop, Web y Android Capacitor).
 * - El JWT nunca se escribe en claro de forma persistente en localStorage:
 *   reside en memoria + sessionStorage (y limpia restos legados de localStorage).
 * - Los perfiles cacheados para operación offline se sanitizan antes de guardarse.
 */

const TOKEN_KEY = 'auth_token';
const SYNC_KEY_STORAGE = 'sync_secret_key';
const USER_PROFILE_KEY = 'isaac_pos_saved_user_profile';
const SESSION_ACTIVE_KEY = 'isaac_pos_session_active';

let memoryToken = null;
let memorySyncKey = null;

function sanitizeProfileForCache(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const {
    password: _p,
    supervisorPin: _sp,
    quickPin: _qp,
    biometricTokenHash: _bh,
    currentSessionId: _sid,
    token: _tok,
    ...safe
  } = profile;
  return safe;
}

export const secureMobileStorage = {
  getToken: () => {
    if (memoryToken) return memoryToken;
    try {
      if (typeof sessionStorage !== 'undefined') {
        const sTok = sessionStorage.getItem(TOKEN_KEY);
        if (sTok) {
          memoryToken = sTok;
          return sTok;
        }
      }
      if (typeof localStorage !== 'undefined') {
        const legacyTok = localStorage.getItem(TOKEN_KEY);
        if (legacyTok) {
          memoryToken = legacyTok;
          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem(TOKEN_KEY, legacyTok);
            }
            localStorage.removeItem(TOKEN_KEY);
          } catch (err) {
            console.warn('[SecureStorage] Error migrando token a sessionStorage:', err?.message);
          }
          return legacyTok;
        }
      }
      return null;
    } catch {
      return memoryToken;
    }
  },

  restoreTokenFromNative: async () => {
    if (memoryToken) return memoryToken;
    try {
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.getSecureSecret) {
        const res = await window.Capacitor.Plugins.PosNativeHardware.getSecureSecret({ key: TOKEN_KEY });
        if (res?.value) {
          memoryToken = String(res.value);
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(TOKEN_KEY, memoryToken);
          }
          return memoryToken;
        }
      }
    } catch (err) {
      console.warn('[SecureStorage] Error restaurando token desde Android Keystore:', err?.message);
    }
    return null;
  },

  setToken: (token) => {
    const normalized = token ? String(token) : null;
    memoryToken = normalized;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
      }
      if (typeof sessionStorage !== 'undefined') {
        if (!normalized) {
          sessionStorage.removeItem(TOKEN_KEY);
        } else {
          sessionStorage.setItem(TOKEN_KEY, normalized);
        }
      }
      if (normalized && typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.saveSecureSecret) {
        window.Capacitor.Plugins.PosNativeHardware.saveSecureSecret({ key: TOKEN_KEY, value: normalized }).catch(() => {});
      }
    } catch (e) {
      console.warn('[SecureStorage] Error guardando token:', e);
    }
  },

  removeToken: () => {
    memoryToken = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(TOKEN_KEY);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
      }
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.removeSecureSecret) {
        window.Capacitor.Plugins.PosNativeHardware.removeSecureSecret({ key: TOKEN_KEY }).catch(() => {});
      }
    } catch (err) {
      console.warn('[SecureStorage] Error removiendo token:', err?.message);
    }
  },

  getSyncKey: () => {
    if (memorySyncKey) return memorySyncKey;
    try {
      if (typeof sessionStorage !== 'undefined') {
        const sKey = sessionStorage.getItem(SYNC_KEY_STORAGE);
        if (sKey) {
          memorySyncKey = sKey;
          return sKey;
        }
      }
      if (typeof localStorage !== 'undefined') {
        const legacyKey = localStorage.getItem(SYNC_KEY_STORAGE);
        if (legacyKey) {
          memorySyncKey = legacyKey;
          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem(SYNC_KEY_STORAGE, legacyKey);
            }
            if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.saveSecureSecret) {
              window.Capacitor.Plugins.PosNativeHardware.saveSecureSecret({ key: SYNC_KEY_STORAGE, value: legacyKey }).catch(() => {});
            }
            localStorage.removeItem(SYNC_KEY_STORAGE);
          } catch (err) {
            console.warn('[SecureStorage] Error migrando syncKey:', err?.message);
          }
          return legacyKey;
        }
      }
      return null;
    } catch {
      return memorySyncKey;
    }
  },

  restoreSyncKeyFromNative: async () => {
    if (memorySyncKey) return memorySyncKey;
    try {
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.getSecureSecret) {
        const res = await window.Capacitor.Plugins.PosNativeHardware.getSecureSecret({ key: SYNC_KEY_STORAGE });
        if (res?.value) {
          memorySyncKey = String(res.value);
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(SYNC_KEY_STORAGE, memorySyncKey);
          }
          return memorySyncKey;
        }
      }
    } catch (err) {
      console.warn('[SecureStorage] Error restaurando syncKey desde Android Keystore:', err?.message);
    }
    return null;
  },

  setSyncKey: (keyVal) => {
    const normalized = keyVal ? String(keyVal).trim() : null;
    memorySyncKey = normalized;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SYNC_KEY_STORAGE);
      }
      if (typeof sessionStorage !== 'undefined') {
        if (!normalized) sessionStorage.removeItem(SYNC_KEY_STORAGE);
        else sessionStorage.setItem(SYNC_KEY_STORAGE, normalized);
      }
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
        if (normalized && window.Capacitor?.Plugins?.PosNativeHardware?.saveSecureSecret) {
          window.Capacitor.Plugins.PosNativeHardware.saveSecureSecret({ key: SYNC_KEY_STORAGE, value: normalized }).catch(() => {});
        } else if (!normalized && window.Capacitor?.Plugins?.PosNativeHardware?.removeSecureSecret) {
          window.Capacitor.Plugins.PosNativeHardware.removeSecureSecret({ key: SYNC_KEY_STORAGE }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[SecureStorage] Error guardando syncKey:', err?.message);
    }
  },

  removeSyncKey: () => {
    memorySyncKey = null;
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SYNC_KEY_STORAGE);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SYNC_KEY_STORAGE);
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.removeSecureSecret) {
        window.Capacitor.Plugins.PosNativeHardware.removeSecureSecret({ key: SYNC_KEY_STORAGE }).catch(() => {});
      }
    } catch (err) {
      console.warn('[SecureStorage] Error removiendo syncKey:', err?.message);
    }
  },

  getUserProfile: () => {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(USER_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setUserProfile: (profile) => {
    try {
      if (typeof localStorage === 'undefined') return;
      const safe = sanitizeProfileForCache(profile);
      if (!safe) {
        localStorage.removeItem(USER_PROFILE_KEY);
      } else {
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(safe));
      }
    } catch (e) {
      console.warn('[SecureStorage] Error guardando perfil:', e);
    }
  },

  removeUserProfile: () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(USER_PROFILE_KEY);
      }
    } catch (err) {
      console.warn('[SecureStorage] Error removiendo perfil:', err?.message);
    }
  },

  isSessionActive: () => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        return sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true';
      }
      return false;
    } catch {
      return false;
    }
  },

  setSessionActive: (active = true) => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_ACTIVE_KEY, active ? 'true' : 'false');
      }
    } catch (err) {
      console.warn('[SecureStorage] Error marcando sesión activa:', err?.message);
    }
  },

  clearSession: () => {
    memoryToken = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_PROFILE_KEY);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(SESSION_ACTIVE_KEY);
      }
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.removeSecureSecret) {
        window.Capacitor.Plugins.PosNativeHardware.removeSecureSecret({ key: TOKEN_KEY }).catch(() => {});
      }
    } catch (err) {
      console.warn('[SecureStorage] Error limpiando sesión:', err?.message);
    }
  }
};

export default secureMobileStorage;
