import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MobilePOSLoginScreen from '../../src/components/mobile/MobilePOSLoginScreen';
import LockScreen from '../../src/components/LockScreen';

vi.mock('../../src/services/biometricService', () => ({
  default: {
    checkSupport: vi.fn().mockResolvedValue(false),
    getEnrolledCredential: vi.fn().mockReturnValue(null)
  }
}));

const mockTheme = {
  appBg: 'bg-slate-950',
  modalCard: 'bg-slate-900',
  border: 'border-slate-800',
  textPrimary: 'text-white',
  textSecondary: 'text-slate-300',
  textMuted: 'text-slate-400',
  inputBg: 'bg-slate-800 text-white border-slate-700'
};

function LoginHarness({ onLogin, enrolledBioUser = null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <MobilePOSLoginScreen
      T={mockTheme}
      isLight={false}
      businessInfo={{ name: 'Tienda Test' }}
      serverHealth={true}
      mobileServerIp="192.168.1.10:3005"
      setShowServerModal={vi.fn()}
      setServerFeedback={vi.fn()}
      loginError={null}
      enrolledBioUser={enrolledBioUser}
      handleMobileBiometricLogin={vi.fn()}
      isBioLoggingIn={false}
      isLoggingIn={false}
      handleMobileLogin={onLogin}
      loginUsername={username}
      setLoginUsername={setUsername}
      loginPassword={password}
      setLoginPassword={setPassword}
    />
  );
}

afterEach(() => {
  delete window.__ISAAC_NATIVE_KEYBOARD__;
  document.documentElement.style.removeProperty('--isaac-keyboard-overlap');
});

describe('MobilePOSLoginScreen — Navegación Enter (Usuario -> Contraseña) y responsividad', () => {
  it('al presionar Enter en Usuario mueve el foco a Contraseña sin enviar el formulario prematuramente, y envía al presionar Enter en Contraseña', () => {
    const onLogin = vi.fn((e) => e?.preventDefault?.());
    render(<LoginHarness onLogin={onLogin} />);

    const userInput = screen.getByPlaceholderText('Ingresa tu usuario');
    const passInput = screen.getByPlaceholderText('••••••••');

    expect(userInput.getAttribute('enterkeyhint')).toBe('next');
    expect(passInput.getAttribute('enterkeyhint')).toBe('go');

    userInput.focus();
    fireEvent.change(userInput, { target: { value: 'cajero1' } });
    fireEvent.keyDown(userInput, { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(document.activeElement).toBe(passInput);
    expect(onLogin).not.toHaveBeenCalled();

    // Incluso si un teclado Android dispara submit del form con contraseña vacía, mantiene foco en Contraseña
    fireEvent.submit(userInput.closest('form'));
    expect(document.activeElement).toBe(passInput);
    expect(onLogin).not.toHaveBeenCalled();

    // Ahora escribe la contraseña y envía el formulario
    fireEvent.change(passInput, { target: { value: 'secreto123' } });
    fireEvent.submit(passInput.closest('form'));
    expect(onLogin).toHaveBeenCalledTimes(1);

    // Toggle mostrar/ocultar contraseña
    const toggleBtn = screen.getByRole('button', { name: /Mostrar contraseña/i });
    expect(passInput.getAttribute('type')).toBe('password');
    fireEvent.click(toggleBtn);
    expect(passInput.getAttribute('type')).toBe('text');
  });

  it('entra automáticamente en modo compacto al tocar Usuario o abrir el teclado nativo Android y restaura al cerrarse', () => {
    const { container } = render(
      <LoginHarness
        onLogin={vi.fn()}
        enrolledBioUser={{ name: 'Manuel', username: 'admin' }}
      />
    );

    const rootWrapper = container.querySelector('[data-login-compact]');
    expect(rootWrapper.getAttribute('data-login-compact')).toBe('false');
    expect(screen.getByText(/Entrar con Huella Dactilar/i)).toBeTruthy();
    expect(screen.getByText(/Configurar IP de Servidor PC/i)).toBeTruthy();

    // Al tocar Usuario, entra en modo compacto de inmediato ocultando Huella y Configurar IP
    const userInput = screen.getByPlaceholderText('Ingresa tu usuario');
    fireEvent.focus(userInput);
    expect(rootWrapper.getAttribute('data-login-compact')).toBe('true');
    expect(screen.queryByText(/Entrar con Huella Dactilar/i)).toBeNull();
    expect(screen.queryByText(/Configurar IP de Servidor PC/i)).toBeNull();

    // Puente nativo Android reporta teclado de 310px sin redimensionar innerHeight -> publica --isaac-keyboard-overlap
    act(() => {
      window.dispatchEvent(new CustomEvent('isaac-native-keyboard', { detail: { visible: true, heightPx: 310 } }));
    });
    expect(document.documentElement.style.getPropertyValue('--isaac-keyboard-overlap')).toBe('310px');
    expect(rootWrapper.getAttribute('data-login-compact')).toBe('true');

    // Al cerrar el teclado nativo (ej. botón Atrás de Android), restaura vista centrada completa y limpia overlap
    act(() => {
      window.dispatchEvent(new CustomEvent('isaac-native-keyboard', { detail: { visible: false, heightPx: 0 } }));
    });
    expect(document.documentElement.style.getPropertyValue('--isaac-keyboard-overlap')).toBe('0px');
    expect(rootWrapper.getAttribute('data-login-compact')).toBe('false');
    expect(screen.getByText(/Entrar con Huella Dactilar/i)).toBeTruthy();
    expect(screen.getByText(/Configurar IP de Servidor PC/i)).toBeTruthy();
  });

  it('LockScreen se adapta automáticamente al modo compacto al enfocar el PIN o abrir teclado nativo', () => {
    const { container } = render(
      <LockScreen
        user={{ name: 'Cajero Uno', username: 'cajero1' }}
        onUnlock={vi.fn().mockResolvedValue({ success: true })}
        onLogout={vi.fn()}
      />
    );

    const overlay = container.querySelector('[data-lock-compact]');
    expect(overlay.getAttribute('data-lock-compact')).toBe('false');

    const pinInput = screen.getByPlaceholderText(/Ingresa tu PIN o clave/i);
    fireEvent.focus(pinInput);
    expect(overlay.getAttribute('data-lock-compact')).toBe('true');

    act(() => {
      window.dispatchEvent(new CustomEvent('isaac-native-keyboard', { detail: { visible: true, heightPx: 290 } }));
    });
    expect(document.documentElement.style.getPropertyValue('--isaac-keyboard-overlap')).toBe('290px');

    act(() => {
      window.dispatchEvent(new CustomEvent('isaac-native-keyboard', { detail: { visible: false, heightPx: 0 } }));
    });
    expect(overlay.getAttribute('data-lock-compact')).toBe('false');
  });
});
