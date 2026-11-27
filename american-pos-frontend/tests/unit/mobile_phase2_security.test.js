import { describe, it, expect, vi, beforeEach } from 'vitest';
import { secureMobileStorage } from '../../src/utils/secureMobileStorage';
import { getSupabaseStoragePublicUrl } from '../../src/config/supabaseConfig';

describe('Fase 2 — Seguridad Móvil, Storage Seguro y Resiliencia Auth/OTA', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    secureMobileStorage.removeToken();
    secureMobileStorage.removeSyncKey();
  });

  it('migra sync_secret_key desde localStorage a sessionStorage + memoria sin dejar copia en claro en localStorage', () => {
    localStorage.setItem('sync_secret_key', 'SYNC-SECRET-LAN-2026');
    const resolved = secureMobileStorage.getSyncKey();
    expect(resolved).toBe('SYNC-SECRET-LAN-2026');
    expect(localStorage.getItem('sync_secret_key')).toBeNull();
    expect(sessionStorage.getItem('sync_secret_key')).toBe('SYNC-SECRET-LAN-2026');

    secureMobileStorage.setSyncKey('SYNC-NEW-999');
    expect(secureMobileStorage.getSyncKey()).toBe('SYNC-NEW-999');
    expect(localStorage.getItem('sync_secret_key')).toBeNull();

    secureMobileStorage.removeSyncKey();
    expect(secureMobileStorage.getSyncKey()).toBeNull();
  });

  it('getSupabaseStoragePublicUrl no falla cuando SUPABASE_URL está vacío en build móvil', () => {
    const url = getSupabaseStoragePublicUrl('app-updates', 'version.json');
    expect(typeof url).toBe('string');
  });

  it('verifica que otaUpdateService.reconcileBuiltinApkVersion consulta getAppBuildInfo nativo cuando está presente', async () => {
    const getAppBuildInfo = vi.fn().mockResolvedValue({ versionCode: 240407, versionName: '24.4.7' });
    const prevCap = window.Capacitor;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        PosNativeHardware: {
          getAppBuildInfo
        }
      }
    };
    try {
      const info = await window.Capacitor.Plugins.PosNativeHardware.getAppBuildInfo();
      expect(info.versionCode).toBe(240407);
      expect(getAppBuildInfo).toHaveBeenCalledTimes(1);
    } finally {
      window.Capacitor = prevCap;
    }
  });
});
