import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SocketContext } from '../hooks/SocketContext';
import { useAuth } from '../hooks/AuthContext';
import api, { formatServerUrl, getBaseUrl } from '../services/api';
import secureMobileStorage from '../utils/secureMobileStorage';
import { setRuntimeCloudConfig } from '../config/supabaseConfig';

export const SocketProvider = ({ children }) => {
    const { user, refreshUser } = useAuth();
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [serverRevision, setServerRevision] = useState(0);
    const refreshUserRef = useRef(refreshUser);
    refreshUserRef.current = refreshUser;
    const userId = user?.id;
    const companyId = user?.companyId;

    useEffect(() => {
        const handleServerUrlChanged = () => {
            setServerRevision((prev) => prev + 1);
        };
        window.addEventListener('server-discovered', handleServerUrlChanged);
        window.addEventListener('api-base-url-changed', handleServerUrlChanged);
        return () => {
            window.removeEventListener('server-discovered', handleServerUrlChanged);
            window.removeEventListener('api-base-url-changed', handleServerUrlChanged);
        };
    }, []);

    useEffect(() => {
        if (!userId || !companyId) return;

        const isLocalDev =
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
            localStorage.getItem('isaac_pos_node_role') !== 'client';
        const savedIp = !isLocalDev
            ? localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip')
            : '';
        let socketUrl = '';
        if (savedIp) {
            socketUrl = formatServerUrl(savedIp);
        } else if (
            typeof window !== 'undefined' &&
            ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) ||
                window.location.protocol === 'capacitor:')
        ) {
            socketUrl = api.defaults.baseURL || '';
        } else if (isLocalDev) {
            const localHost =
                typeof window !== 'undefined' && window.location.hostname === 'localhost'
                    ? 'localhost'
                    : '127.0.0.1';
            const currentPort = typeof window !== 'undefined' ? window.location.port : '';
            const devPorts = ['5173', '5174', '5175'];
            const targetPort = devPorts.includes(currentPort) || !currentPort ? '3005' : currentPort;
            socketUrl = `http://${localHost}:${targetPort}`;
        } else {
            const currentPort = window.location.port;
            const devPorts = ['5173', '5174', '5175'];
            const targetPort = devPorts.includes(currentPort) ? '3005' : currentPort || '3005';
            const protocol =
                window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                    ? 'http:'
                    : window.location.protocol;
            socketUrl = `${protocol}//${window.location.hostname}:${targetPort}`;
        }

        if (!socketUrl) return;
        const authToken = secureMobileStorage.getToken();
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
            newSocket.emit('join_company', companyId);
        });

        newSocket.on('user_updated', (data) => {
            console.log('🔄 user_updated recibido vía socket:', data);
            if (!data || !data.userId || data.userId === userId) {
                if (typeof refreshUserRef.current === 'function') refreshUserRef.current();
            }
        });

        newSocket.on('users_changed', () => {
            console.log('🔄 users_changed recibido vía socket');
            if (typeof refreshUserRef.current === 'function') refreshUserRef.current();
        });

        newSocket.on('remote_barcode_scan', (data) => {
            try {
                if (!data || !data.barcode) return;
                if (data.senderSocketId && newSocket.id && data.senderSocketId === newSocket.id) return;
                const lastLocalScan = window.__ISAAC_LAST_LOCAL_SCAN__;
                if (
                    lastLocalScan &&
                    lastLocalScan.barcode === String(data.barcode).trim() &&
                    Date.now() - lastLocalScan.ts < 1200
                ) {
                    return;
                }
                window.dispatchEvent(new CustomEvent('remote-barcode-scan', { detail: data }));
            } catch (err) {
                console.warn('[SocketProvider] Error procesando remote_barcode_scan:', err?.message);
            }
        });

        const handleForcedDisconnect = (payload) => {
            console.warn('🔒 Sesión revocada por el servidor vía WebSocket:', payload?.reason || payload);
            try {
                secureMobileStorage.removeToken();
                secureMobileStorage.setSessionActive(false);
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('isaac_pos_session_revoked', 'true');
                }
            } catch {
                // Ignorar error de storage restringido
            }
            try {
                newSocket.disconnect();
            } catch {
                // Socket ya cerrado
            }
            window.dispatchEvent(new CustomEvent('auth-unauthorized', {
                detail: { forced: true, reason: payload?.reason || 'Sesión revocada por el administrador' }
            }));
        };

        const handleCloudConfigUpdated = (payload) => {
            if (payload && typeof payload === 'object') {
                setRuntimeCloudConfig(payload, api?.defaults?.baseURL || getBaseUrl());
            }
        };

        newSocket.on('force_logout', handleForcedDisconnect);
        newSocket.on('session_revoked', handleForcedDisconnect);
        newSocket.on('cloud_config_updated', handleCloudConfigUpdated);

        newSocket.on('disconnect', (reason) => {
            if (reason === 'io client disconnect') {
                console.log('🔄 Sesión actualizada: Reconectando en tiempo real...');
            } else {
                console.log('📡 Enlace en tiempo real en espera:', reason);
            }
            setIsConnected(false);
        });

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
            newSocket.off('force_logout', handleForcedDisconnect);
            newSocket.off('session_revoked', handleForcedDisconnect);
            newSocket.off('cloud_config_updated', handleCloudConfigUpdated);
            newSocket.disconnect();
            setSocket(null);
            setIsConnected(false);
        };
    }, [userId, companyId, serverRevision]);

    const contextValue = useMemo(() => ({ socket, isConnected }), [socket, isConnected]);

    return (
        <SocketContext.Provider value={contextValue}>
            {children}
        </SocketContext.Provider>
    );
};
