import { createContext, useContext } from 'react';

export const PosContext =
    globalThis.__ISAAC_POS_CONTEXT__ ||
    (globalThis.__ISAAC_POS_CONTEXT__ = createContext());

export const usePos = () => {
    const context = useContext(PosContext);
    if (!context) throw new Error('usePos debe usarse dentro de PosProvider');
    return context;
};
