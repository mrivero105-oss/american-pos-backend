import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExchangeRateModal from '../../src/components/ExchangeRateModal';

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn()
}));

vi.mock('../../src/services/api', () => ({
  default: {
    get: mockApiGet,
    post: mockApiPost
  }
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

describe('ExchangeRateModal — Edición manual de tasa de cambio sin sobrescritura BCV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pos_auto_update_rate', 'true');
  });

  it('permite editar manualmente la tasa, desactiva auto-BCV, no resetea al desmarcar y NO llama a /settings/bcv/sync al guardar', async () => {
    let resolveBcv;
    mockApiGet.mockImplementation((url) => {
      if (url === '/settings/rate') {
        return Promise.resolve({
          data: { rate: 919.8227, euroRate: 1011.17949056, autoUpdateRate: true }
        });
      }
      if (url === '/settings/bcv') {
        return new Promise((resolve) => {
          resolveBcv = () => resolve({
            data: { success: true, rate: 919.8227, euroRate: 1011.17949056 }
          });
        });
      }
      return Promise.resolve({ data: {} });
    });
    mockApiPost.mockResolvedValue({ data: { success: true } });

    const onClose = vi.fn();
    const onRateUpdated = vi.fn();

    render(
      <ExchangeRateModal
        isOpen={true}
        onClose={onClose}
        currentRate={919.8227}
        currentEuroRate={1011.17949056}
        currencyMode="BOTH"
        onRateUpdated={onRateUpdated}
      />
    );

    const inputs = screen.getAllByPlaceholderText('0.00');
    const usdInput = inputs[0];
    expect(usdInput.value).toBe('919.8227');

    // El usuario escribe su tasa manual mientras la consulta silenciosa BCV aún está en vuelo
    fireEvent.change(usdInput, { target: { value: '985.50' } });
    expect(usdInput.value).toBe('985.50');

    // La consulta silenciosa BCV responde tarde: NO debe sobrescribir lo escrito por el usuario
    if (resolveBcv) resolveBcv();
    await waitFor(() => {
      expect(screen.getByText(/919\.8227 Bs \/ USD/)).toBeInTheDocument();
    });
    expect(usdInput.value).toBe('985.50');

    // Desmarcar/marcar checkbox NO debe resetear el input del usuario
    const autoCheckbox = screen.getByRole('checkbox');
    expect(autoCheckbox.checked).toBe(false);
    fireEvent.click(autoCheckbox);
    expect(usdInput.value).toBe('985.50');

    // Guardar cambios debe enviar autoUpdateRate: false (porque el valor difiere del BCV) y NO llamar a /settings/bcv/sync
    fireEvent.click(screen.getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/settings/rate',
        expect.objectContaining({
          rate: 985.5,
          autoUpdateRate: false
        })
      );
    });

    const syncCalls = mockApiPost.mock.calls.filter(([url]) => url === '/settings/bcv/sync');
    expect(syncCalls).toHaveLength(0);
    expect(onRateUpdated).toHaveBeenCalledWith(985.5, 1011.17949056);
    expect(onClose).toHaveBeenCalled();
  });
});
