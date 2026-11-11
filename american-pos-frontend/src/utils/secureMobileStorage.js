/**
 * secureMobileStorage.js
 * Capa de almacenamiento seguro para Isaac POS Mobile.
 * Centraliza y blinda el acceso a credenciales, tokens JWT y perfiles de sesión.
 */

const TOKEN_KEY = 'auth_token';
const USER_PROFILE_KEY = 'isaac_pos_saved_user_profile';
const SESSION_ACTIVE_KEY = 'isaac_pos_session_active';

export const secureMobileStorage = {
  getToken: () => {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  },

  setToken: (token) => {
    try {
      if (typeof localStorage === 'undefined') return;
      if (!token) {
        localStorage.removeItem(TOKEN_KEY);
      } else {
        localStorage.setItem(TOKEN_KEY, String(token));
      }
    } catch (e) {
      console.warn('[SecureStorage] Error guardando token:', e);
    }
  },

  removeToken: () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {}
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
      if (!profile) {
        localStorage.removeItem(USER_PROFILE_KEY);
      } else {
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
      }
    } catch (e) {
      console.warn('[SecureStorage] Error guardando perfil:', e);
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
    } catch {}
  },

  clearSession: () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_PROFILE_KEY);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SESSION_ACTIVE_KEY);
      }
    } catch {}
  }
};

export default secureMobileStorage;
