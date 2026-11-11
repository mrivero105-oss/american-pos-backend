import { create } from 'zustand';

/**
 * usePosStore - Atomic Store for Global POS Terminal State
 * Separates customer selection, drawer state, and exchange rate from layout renders.
 */
export const usePosStore = create((set) => ({
    selectedCustomer: null,
    customerSearch: '',
    isCustomerDropdownOpen: false,
    heldSalesCount: 0,
    isCheckoutOpen: false,
    isHeldModalOpen: false,
    selectedIndex: -1,

    setSelectedCustomer: (customer) => set({ selectedCustomer: customer }),
    setCustomerSearch: (search) => set({ customerSearch: search }),
    setIsCustomerDropdownOpen: (open) => set({ isCustomerDropdownOpen: open }),
    setHeldSalesCount: (count) => set({ heldSalesCount: count }),
    setIsCheckoutOpen: (open) => set({ isCheckoutOpen: open }),
    setIsHeldModalOpen: (open) => set({ isHeldModalOpen: open }),
    setSelectedIndex: (idx) => set({ selectedIndex: idx }),

    resetPosSession: () => set({
        selectedCustomer: null,
        customerSearch: '',
        isCustomerDropdownOpen: false,
        isCheckoutOpen: false,
        selectedIndex: -1
    })
}));
