import { create } from 'zustand';

/**
 * Store atómico de baja frecuencia para configuración operativa, tasa y moneda del negocio.
 * Evita re-renders en cascada cuando cambia el carrito de compras en PosContext.
 */
export const useBusinessSettingsStore = create((set) => ({
    rate: Number(typeof localStorage !== 'undefined' ? localStorage.getItem('pos_exchange_rate') : 1) || 1,
    currencyMode: (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_currency_mode') : null) || 'BOTH',
    country: (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_country') : '') || '',
    businessMode: (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_business_mode') : null) || 'STANDARD',
    businessInfo: {},
    paymentMethods: [],
    lastSyncedAt: 0,

    setSettings: (partial) => set((state) => {
        if (!partial || typeof partial !== 'object') return state;
        return {
            ...state,
            ...partial,
            rate: partial.rate !== undefined ? (Number(partial.rate) || 1) : state.rate,
            businessMode: partial.businessInfo?.businessMode || partial.businessMode || state.businessMode,
            lastSyncedAt: Date.now()
        };
    })
}));

export default useBusinessSettingsStore;
