import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MobilePOSLoginScreen from '../../src/components/mobile/MobilePOSLoginScreen';

const mockTheme = {
  appBg: 'bg-slate-950',
  modalCard: 'bg-slate-900',
  border: 'border-slate-800',
  textPrimary: 'text-white',
  textSecondary: 'text-slate-300',
  textMuted: 'text-slate-400',
  inputBg: 'bg-slate-800 text-white border-slate-700'
};

function LoginHarness({ onLogin }) {
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
      enrolledBioUser={null}
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
});
