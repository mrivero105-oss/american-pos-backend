import { createContext, useContext } from 'react';

export const SocketContext =
    globalThis.__ISAAC_SOCKET_CONTEXT__ ||
    (globalThis.__ISAAC_SOCKET_CONTEXT__ = createContext());

export function useSocket() {
    return useContext(SocketContext);
}
