import { create } from 'zustand';

/**
 * useCartStore - High-Performance Atomic Store for Isaac POS Cart
 * Eliminates unnecessary full-tree re-renders across POS components.
 */
export const useCartStore = create((set, get) => ({
    items: [],
    lastAddedId: null,
    discountActive: 0,

    setItems: (items) => set({ items: typeof items === 'function' ? items(get().items) : items }),

    setLastAddedId: (id) => set({ lastAddedId: id }),

    setDiscountActive: (discount) => set({ discountActive: discount }),

    addItem: (item) => set((state) => {
        const existingIndex = state.items.findIndex(p => p.id === item.id);
        if (existingIndex > -1) {
            const updated = [...state.items];
            updated[existingIndex] = {
                ...updated[existingIndex],
                quantity: Number(updated[existingIndex].quantity) + Number(item.quantity || 1)
            };
            return { items: updated, lastAddedId: item.id };
        }
        return { items: [item, ...state.items], lastAddedId: item.id };
    }),

    updateQuantity: (id, quantity) => set((state) => {
        if (quantity <= 0) {
            return { items: state.items.filter(p => p.id !== id) };
        }
        return {
            items: state.items.map(p => p.id === id ? { ...p, quantity } : p)
        };
    }),

    removeItem: (id) => set((state) => ({
        items: state.items.filter(p => p.id !== id)
    })),

    clearCart: () => set({ items: [], lastAddedId: null, discountActive: 0 })
}));
