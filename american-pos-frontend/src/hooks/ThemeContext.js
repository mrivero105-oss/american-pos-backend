import { createContext, useContext } from 'react';

export const ThemeContext =
    globalThis.__ISAAC_THEME_CONTEXT__ ||
    (globalThis.__ISAAC_THEME_CONTEXT__ = createContext());

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
