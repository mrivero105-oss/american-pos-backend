import { describe, it, expect, beforeEach } from 'vitest';
import { useMobileModalStore, selectHasActiveOverlay } from '../../src/store/useMobileModalStore';
import { useMobilePosStore } from '../../src/store/useMobilePosStore';

describe('Bloque 3 (Fase 4) — Stores Zustand Modulares y Preservación de Scroll', () => {
  beforeEach(() => {
    useMobileModalStore.getState().resetAllModals();
    useMobilePosStore.setState({ activeModule: 'pos', moduleScrollPositions: {} });
  });

  it('useMobileModalStore cierra overlays en orden LIFO estricto y actualiza selectHasActiveOverlay', () => {
    expect(selectHasActiveOverlay(useMobileModalStore.getState())).toBe(false);

    const setField = useMobileModalStore.getState().setModalField;
    setField('isMobileCartOpen', true);
    setField('isCheckoutOpen', true);
    setField('printedReceipt', { id: 'sale-1' });
    setField('supervisorAuthRequest', { title: 'Descuento' });

    expect(selectHasActiveOverlay(useMobileModalStore.getState())).toBe(true);

    // 1. Supervisor tiene prioridad máxima
    expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
    expect(useMobileModalStore.getState().supervisorAuthRequest).toBeNull();
    expect(useMobileModalStore.getState().printedReceipt).not.toBeNull();

    // 2. Recibo impreso
    expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
    expect(useMobileModalStore.getState().printedReceipt).toBeNull();

    // 3. Checkout
    expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
    expect(useMobileModalStore.getState().isCheckoutOpen).toBe(false);

    // 4. Carrito móvil
    expect(useMobileModalStore.getState().closeTopOverlay()).toBe(true);
    expect(useMobileModalStore.getState().isMobileCartOpen).toBe(false);
    expect(selectHasActiveOverlay(useMobileModalStore.getState())).toBe(false);

    // 5. Ya no quedan overlays
    expect(useMobileModalStore.getState().closeTopOverlay()).toBe(false);
  });

  it('useMobilePosStore preserva independientemente el scroll de cada pestaña/módulo', () => {
    const store = useMobilePosStore.getState();
    store.setModuleScrollPosition('pos', 640);
    store.setModuleScrollPosition('inventory', 1280);
    store.setModuleScrollPosition('settings', 320);

    expect(useMobilePosStore.getState().getModuleScrollPosition('pos')).toBe(640);
    expect(useMobilePosStore.getState().getModuleScrollPosition('inventory')).toBe(1280);
    expect(useMobilePosStore.getState().getModuleScrollPosition('settings')).toBe(320);
    expect(useMobilePosStore.getState().getModuleScrollPosition('cash')).toBe(0);

    // Valores negativos se normalizan a 0
    store.setModuleScrollPosition('pos', -50);
    expect(useMobilePosStore.getState().getModuleScrollPosition('pos')).toBe(0);
  });
});
