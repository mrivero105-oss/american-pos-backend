import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  recordDiagnosticEvent,
  getDiagnosticEvents,
  clearDiagnosticEvents,
  redactSensitiveData,
  redactSensitiveText,
  buildDiagnosticReportText
} from '../../src/services/mobileDiagnosticsService';
import MobileSyncCenterView from '../../src/components/mobile/MobileSyncCenterView';

vi.mock('../../src/services/api', () => ({
  default: {
    defaults: { baseURL: 'http://192.168.1.2:3005' },
    get: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } })
  }
}));

vi.mock('../../src/services/db', () => ({
  db: {
    getAll: vi.fn().mockResolvedValue([]),
    getByIndex: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../../src/db/localDb', () => ({
  default: {
    sales: {
      where: () => ({ equals: () => ({ toArray: vi.fn().mockResolvedValue([]) }) }),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined)
    }
  }
}));

vi.mock('../../src/services/otaUpdateService', () => ({
  default: {
    getCurrentVersion: vi.fn().mockResolvedValue('24.4.0.1795609934'),
    isUpdateReady: vi.fn().mockReturnValue(false),
    subscribeUpdateReady: vi.fn().mockReturnValue(() => {}),
    checkForUpdates: vi.fn().mockResolvedValue({ updateAvailable: false }),
    applyAndReload: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../../src/services/cloudRateSyncService', () => ({
  default: {
    init: vi.fn(),
    subscribe: vi.fn().mockReturnValue(() => {}),
    checkRate: vi.fn().mockResolvedValue(undefined),
    lastRate: 1070
  }
}));

const mockTheme = {
  appBg: 'bg-slate-950',
  subPanelBg: 'bg-slate-900',
  border: 'border-slate-800',
  textPrimary: 'text-white',
  textSecondary: 'text-slate-300',
  textMuted: 'text-slate-400',
  btnGhost: 'bg-slate-800'
};

describe('Bloque 1 — Caja Negra Sanitizada (mobileDiagnosticsService) y Panel RBAC', () => {
  beforeEach(() => {
    clearDiagnosticEvents();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('redacta estrictamente JWT, Bearer, contraseñas, PINs, claves PEM y query secrets sin fugas', async () => {
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.sIgNaTuReSeCrEt123456';
    const fakePem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw\n-----END PRIVATE KEY-----';

    const cleanText = redactSensitiveText(
      `Fallo auth Bearer ${fakeJwt} en https://lan.local/api?token=abc123456&user=ok ${fakePem}`
    );
    expect(cleanText).not.toContain(fakeJwt);
    expect(cleanText).not.toContain('abc123456');
    expect(cleanText).not.toContain('MIIEvQIBADAN');
    expect(cleanText).toContain('Bearer [REDACTED]');
    expect(cleanText).toContain('[REDACTED_PEM_KEY]');

    const cleanObj = redactSensitiveData({
      username: 'cajero1',
      password: 'mi-clave-super-secreta',
      supervisorPin: '9988',
      authorization: `Bearer ${fakeJwt}`,
      nested: { cookie: 'sid=topsecret', okField: 42 }
    });
    expect(cleanObj.username).toBe('cajero1');
    expect(cleanObj.password).toBe('[REDACTED]');
    expect(cleanObj.supervisorPin).toBe('[REDACTED]');
    expect(cleanObj.authorization).toBe('[REDACTED]');
    expect(cleanObj.nested.cookie).toBe('[REDACTED]');
    expect(cleanObj.nested.okField).toBe(42);

    recordDiagnosticEvent('error', 'auth', `Error con ${fakeJwt}`, { password: 'secret', endpoint: '/auth/login' });
    const reportJson = await buildDiagnosticReportText({ appVersion: '24.4.0.999' });
    expect(reportJson).not.toContain(fakeJwt);
    expect(reportJson).not.toContain('mi-clave');
    expect(reportJson).not.toContain('"secret"');
    expect(reportJson).toContain('[REDACTED]');
  });

  it('respeta el tope circular de 300 eventos y permite limpiar la Caja Negra', () => {
    for (let i = 0; i < 340; i++) {
      recordDiagnosticEvent(i % 2 === 0 ? 'info' : 'error', 'sync', `Evento #${i}`);
    }
    const all = getDiagnosticEvents();
    expect(all.length).toBe(300);
    expect(all[0].message).toBe('Evento #339');
    expect(all[all.length - 1].message).toBe('Evento #40');

    clearDiagnosticEvents();
    expect(getDiagnosticEvents().length).toBe(0);
  });

  it('MobileSyncCenterView oculta el panel Diagnóstico para cajeros y lo muestra solo con canManageSettings=true', async () => {
    recordDiagnosticEvent('error', 'ota', 'Prueba error diagnóstico visible solo admin');

    const { rerender } = render(
      <MobileSyncCenterView
        T={mockTheme}
        canManageSettings={false}
        onBackToPOS={vi.fn()}
        showToast={vi.fn()}
      />
    );
    expect(screen.queryByText(/Diagnóstico del Terminal/i)).toBeNull();

    rerender(
      <MobileSyncCenterView
        T={mockTheme}
        canManageSettings={true}
        onBackToPOS={vi.fn()}
        showToast={vi.fn()}
      />
    );
    expect(screen.getByText(/Diagnóstico del Terminal/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Ver eventos/i }));
    expect(screen.getByText(/Prueba error diagnóstico visible solo admin/i)).toBeTruthy();
  });
});
