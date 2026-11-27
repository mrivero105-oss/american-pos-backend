import { createContext, useContext } from 'react';

export const AuthContext =
    globalThis.__ISAAC_AUTH_CONTEXT__ ||
    (globalThis.__ISAAC_AUTH_CONTEXT__ = createContext());

export const useAuth = () => useContext(AuthContext) || {};
