import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import api, { formatServerUrl } from '../services/api';

const SocketContext = globalThis.__ISAAC_SOCKET_CONTEXT__ || (globalThis.__ISAAC_SOCKET_CONTEXT__ = createContext());

export function useSocket() {
    return useContext(SocketContext);
}

export const SocketProvider = ({ children }) => {
    const { user, refreshUser } = useAuth();
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (!user || !user.companyId) return;

        const isLocalDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && localStorage.getItem('isaac_pos_node_role') !== 'client';
        const savedIp = !isLocalDev ? (localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip')) : '';
        let socketUrl = '';
        if (savedIp) {
            socketUrl = formatServerUrl(savedIp);
        } else if (typeof window !== 'undefined' && ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || window.location.protocol === 'capacitor:')) {
            socketUrl = api.defaults.baseURL || 'http://192.168.1.30:3005';
        } else if (isLocalDev) {
            const localHost = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? 'localhost' : '127.0.0.1';
            const currentPort = typeof window !== 'undefined' ? window.location.port : '';
            const devPorts = ['5173', '5174', '5175'];
            const targetPort = (devPorts.includes(currentPort) || !currentPort) ? '3005' : currentPort;
            socketUrl = `http://${localHost}:${targetPort}`;
        } else {
            const currentPort = window.location.port;
            const devPorts = ['5173', '5174', '5175'];
            const targetPort = devPorts.includes(currentPort) ? '3005' : (currentPort || '3005');
            const protocol = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http:' : window.location.protocol;
            socketUrl = `${protocol}//${window.location.hostname}:${targetPort}`;
        }

        const authToken = localStorage.getItem('auth_token');
        const newSocket = io(socketUrl, {
            auth: { token: authToken },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 10000,
            timeout: 10000,
            transports: ['polling', 'websocket'],
            upgrade: true
        });

        newSocket.on('connect', () => {
            console.log('🔗 Connected to realtime server:', newSocket.id);
            setIsConnected(true);
            newSocket.emit('join_company', user.companyId);
        });

        newSocket.on('user_updated', (data) => {
            console.log('🔄 user_updated recibido vía socket:', data);
            if (!data || !data.userId || (user && data.userId === user.id)) {
                if (typeof refreshUser === 'function') refreshUser();
            }
        });

        newSocket.on('users_changed', () => {
            console.log('🔄 users_changed recibido vía socket');
            if (typeof refreshUser === 'function') refreshUser();
        });

        newSocket.on('remote_barcode_scan', (data) => {
            try {
                if (!data || !data.barcode) return;
                // Evitar procesar eco en el mismo dispositivo emisor
                if (data.senderSocketId && newSocket.id && data.senderSocketId === newSocket.id) return;
                const lastLocalScan = window.__ISAAC_LAST_LOCAL_SCAN__;
                if (lastLocalScan && lastLocalScan.barcode === String(data.barcode).trim() && (Date.now() - lastLocalScan.ts) < 1200) {
                    return;
                }
                window.dispatchEvent(new CustomEvent('remote-barcode-scan', { detail: data }));
            } catch (e) {}
        });

        newSocket.on('disconnect', (reason) => {
            if (reason === 'io client disconnect') {
                console.log('🔄 Sesión actualizada: Reconectando en tiempo real...');
            } else {
                console.log('📡 Enlace en tiempo real en espera:', reason);
            }
            setIsConnected(false);
        });

        // Mobile lifecycle: Auto-reconnect when phone unlocks or comes online
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && newSocket && !newSocket.connected) {
                newSocket.connect();
            }
        };

        const handleOnline = () => {
            if (newSocket && !newSocket.connected) {
                newSocket.connect();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', handleOnline);

        setSocket(newSocket);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', handleOnline);
            newSocket.disconnect();
            setIsConnected(false);
        };
    }, [user?.id, user?.companyId]);

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
        </SocketContext.Provider>
    );
};
