import axios from 'axios';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getTerminalId } from '../utils/terminalIdentity';
import secureMobileStorage from '../utils/secureMobileStorage';

export const PosNativeHardware = (typeof window !== 'undefined' && window.__posNativeHardwarePlugin)
    ? window.__posNativeHardwarePlugin
    : (() => {
        const plugin = registerPlugin('PosNativeHardware');
        if (typeof window !== 'undefined') window.__posNativeHardwarePlugin = plugin;
        return plugin;
    })();

// Helper to ensure URL has port (defaults to 3005 for plain http/IP) while preserving explicit https:// (default 443)
export const formatServerUrl = (input) => {
    if (!input || !input.trim()) return '';
    let clean = input.trim().replace(/:517[34]/, '').replace(/\/+$/, '');
    const isHttps = clean.toLowerCase().startsWith('https://');
    const protocol = isHttps ? 'https://' : 'http://';
    const hasProtocol = clean.toLowerCase().startsWith('http://') || isHttps;
    const urlWithoutProto = hasProtocol ? clean.replace(/^https?:\/\//i, '') : clean;
    const hasPort = urlWithoutProto.includes(':');
    const finalHost = (hasPort || isHttps) ? urlWithoutProto : `${urlWithoutProto}:3005`;
    return `${protocol}${finalHost.replace(/\/+$/, '')}`;
};

// Get base URL from localStorage (for mobile) or default to local/lan backend (for desktop/browser)
export const getBaseUrl = () => {
    const isNativeCapacitor = typeof window !== 'undefined' && (
        (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) ||
        window.location.protocol === 'capacitor:'
    );

    const isExplicitlyCleared = typeof window !== 'undefined' && localStorage.getItem('isaac_pos_server_ip_explicitly_cleared') === 'true';
    const savedIp = typeof window !== 'undefined' ? (localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip')) : '';

    // 1. Si hay una IP de servidor guardada y apunta a una máquina remota (no loopback):
    //    SIEMPRE respetarla para que las Cajas Terminales no intenten conectar a 127.0.0.1
    if (savedIp && !isExplicitlyCleared && (typeof window === 'undefined' || (!['localhost', '127.0.0.1'].includes(window.location.hostname) && !window.electronAPI) || localStorage.getItem('isaac_pos_node_role') === 'client')) {
        const clean = savedIp.trim();
        const hostOnly = clean.replace(/^https?:\/\//, '').split(':')[0];
        if (hostOnly && hostOnly !== '127.0.0.1' && hostOnly !== 'localhost') {
            return formatServerUrl(clean);
        }
    }

    // 2. Si es Servidor Host local o no hay IP remota configurada:
    if (typeof window !== 'undefined' && !isNativeCapacitor) {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const currentPort = window.location.port;
        const devPorts = ['5173', '5174', '5175'];
        if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'file:' || window.electronAPI) {
            const localHost = hostname === 'localhost' ? 'localhost' : '127.0.0.1';
            const httpProto = protocol === 'https:' ? 'https:' : 'http:';
            const targetPort = (protocol === 'file:' || !currentPort || devPorts.includes(currentPort)) ? '3005' : currentPort;
            return `${httpProto}//${localHost}:${targetPort}`;
        }
    }

    // On Capacitor Android, check if running on real device
    if (isNativeCapacitor) {
        const host = window.location.hostname;
        if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '') {
            return `http://${host}:3005`;
        }
        // Sin IP guardada: no apuntar a una IP privada fija; esperar configuración o autoDiscoverServer()
        if (savedIp && !isExplicitlyCleared) return formatServerUrl(savedIp);
        return '';
    }

    // Auto-detect production vs development (Vite = 5173/5174, Backend = 3005)
    const currentPort = typeof window !== 'undefined' ? window.location.port : '';
    const devPorts = ['5173', '5174', '5175'];
    const targetPort = devPorts.includes(currentPort) ? '3005' : (currentPort || '3005');

    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        if (isExplicitlyCleared) return '';
        return `${protocol}//${hostname}:${targetPort}`;
    }

    return `http://127.0.0.1:${targetPort}`;
};

const api = axios.create({
    baseURL: getBaseUrl(),
    timeout: 8000,
    headers: {
        'Content-Type': 'application/json'
    },
    withCredentials: true
});

// Update baseURL on the fly if needed
export const updateApiBaseUrl = (newIp) => {
    if (newIp && newIp.trim()) {
        const finalUrl = formatServerUrl(newIp);
        api.defaults.baseURL = finalUrl;
        localStorage.setItem('isaac_pos_server_ip', newIp.trim());
        localStorage.removeItem('isaac_pos_server_ip_explicitly_cleared');
    } else {
        localStorage.removeItem('isaac_pos_server_ip');
        localStorage.removeItem('american_pos_server_ip');
        localStorage.setItem('isaac_pos_server_ip_explicitly_cleared', 'true');
        api.defaults.baseURL = '';
    }
};

// Check server health quickly via /hello endpoint (instant latency + real DB readiness)
export const checkServerHealth = async (customUrl = null, options = {}) => {
    const targetUrl = customUrl ? formatServerUrl(customUrl) : (api.defaults.baseURL || getBaseUrl() || 'http://127.0.0.1:3005');
    try {
        const res = await axios.get(`${targetUrl}/hello`, { timeout: options.timeoutMs || 3500 });
        if (res.status === 200) {
            if (res.data && res.data.dbReady === false) return false;
            if (options.requireMasterHost && res.data?.role === 'LAN_SPOKE') return false;
            return true;
        }
    } catch {
        return false;
    }
    return false;
};

// Detailed Health Check with Latency, Hostname & Node Telemetry
export const checkServerDetailedHealth = async (customUrl = null, timeoutMs = 3000) => {
    const targetUrl = customUrl ? formatServerUrl(customUrl) : (api.defaults.baseURL || getBaseUrl());
    const t0 = performance.now();
    try {
        const res = await axios.get(`${targetUrl}/hello`, { timeout: timeoutMs });
        const latencyMs = Math.round(performance.now() - t0);
        if (res.status === 200 && res.data) {
            const isDbReady = res.data.dbReady !== false;
            return {
                healthy: isDbReady,
                dbReady: isDbReady,
                latencyMs,
                status: isDbReady ? (res.data.status || 'ready') : 'db_offline',
                error: isDbReady ? null : 'Servidor alcanzable, pero la base de datos no está conectada',
                server: res.data.server || 'isaac-pos',
                hostname: res.data.hostname || 'Servidor Isaac POS',
                role: res.data.role || 'MASTER_CLOUD_HUB',
                ips: res.data.ips || [],
                dbDialect: res.data.dbDialect || 'postgres',
                url: targetUrl
            };
        }
    } catch (e1) {
        // If it was a network timeout or connection refused, DO NOT waste time trying /time!
        const isTimeout = e1.code === 'ECONNABORTED' || e1.message?.toLowerCase().includes('timeout') || e1.message?.includes('Network Error');
        if (!isTimeout) {
            try {
                const res2 = await axios.get(`${targetUrl}/time`, { timeout: Math.min(timeoutMs, 1000) });
                const latencyMs = Math.round(performance.now() - t0);
                if (res2.status === 200) {
                    return {
                        healthy: true,
                        latencyMs,
                        status: 'ready',
                        server: 'isaac-pos',
                        hostname: 'Servidor Isaac POS',
                        role: 'STANDALONE',
                        ips: [],
                        dbDialect: 'postgres',
                        url: targetUrl
                    };
                }
            } catch (e2) {
                console.warn('[API] Sonda fallback /ping no respondió:', e2?.message);
            }
        }
        return {
            healthy: false,
            latencyMs: null,
            error: e1.message || 'Sin respuesta del servidor',
            url: targetUrl
        };
    }
    return {
        healthy: false,
        latencyMs: null,
        error: 'Servidor inaccesible',
        url: targetUrl
    };
};

// Radar Scanner for Local LAN Subnet Servers (High-Speed Concurrent Scanner)
export const scanLocalSubnetServers = async (progressCb = null, onFound = null) => {
    const discovered = [];
    const candidates = new Set();

    // 0. Extract saved server IP (Top Priority)
    const savedIpRaw = typeof window !== 'undefined' 
        ? (localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip') || '') 
        : '';
    const savedIp = savedIpRaw.replace(/^https?:\/\//, '').split(':')[0].trim();
    if (savedIp && savedIp !== '127.0.0.1' && savedIp !== 'localhost') {
        candidates.add(savedIp);
    }

    // 1. If in Electron, try UDP LAN broadcast discovery (fast 800ms probe)
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.discoverLanServer) {
        try {
            if (progressCb) progressCb({ percent: 10, message: 'Consultando broadcast UDP LAN...' });
            const udpRes = await window.electronAPI.discoverLanServer(800);
            if (udpRes && udpRes.found && udpRes.server) {
                const sHost = udpRes.server.host || udpRes.server.ip;
                if (sHost) candidates.add(sHost);
            }
        } catch (e) {
            console.warn('[API] Error en descubrimiento UDP LAN:', e?.message);
        }
    }

    // 2. Add local machine loopback
    candidates.add('127.0.0.1');
    candidates.add('localhost');
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            candidates.add(window.location.hostname);
        }
    }

    // 3. Dynamic Native Android Subnet Detection
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
        try {
            const net = await PosNativeHardware.getNetworkInfo();
            if (net && net.subnet) {
                if (net.gateway) candidates.add(net.gateway);
                const dynHosts = [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 50, 100, 200, 254];
                dynHosts.forEach(n => candidates.add(`${net.subnet}${n}`));
                if (net.ip) {
                    const lastOctet = parseInt(net.ip.split('.')[3], 10);
                    if (!isNaN(lastOctet)) {
                        for (let d = -4; d <= 4; d++) {
                            const target = lastOctet + d;
                            if (target > 1 && target < 255) candidates.add(`${net.subnet}${target}`);
                        }
                    }
                }
            }
        } catch (netErr) {
            console.warn('[API] No se pudo obtener info de red nativa:', netErr?.message);
        }
    }

    // 4. Infer subnet from saved IP or location hostname if available
    const inferredMatch = (savedIp || (typeof window !== 'undefined' ? window.location?.hostname : '') || '').match(/^(\d+\.\d+\.\d+\.)/);
    if (inferredMatch && inferredMatch[1]) {
        const prefix = inferredMatch[1];
        [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 50, 100, 200].forEach(n => candidates.add(`${prefix}${n}`));
    }

    // 5. Common Subnet candidates fallback (probing standard LAN ranges)
    const commonSubnetIps = [
        '192.168.1.2', '192.168.1.1', '192.168.1.3', '192.168.1.4', '192.168.1.5',
        '192.168.1.10', '192.168.1.20', '192.168.1.50', '192.168.1.100',
        '192.168.0.2', '192.168.0.1', '192.168.0.3', '192.168.0.4', '192.168.0.5',
        '192.168.0.10', '192.168.0.20', '192.168.0.50', '192.168.0.100',
        '10.0.0.2', '10.0.0.1', '10.0.0.100'
    ];
    commonSubnetIps.forEach(ip => candidates.add(ip));

    const candidateList = Array.from(candidates);
    const total = candidateList.length;

    // Fast Single-Host Probe Helper (Checks port 3005 first; ignores empty LAN_SPOKE client shells)
    const isClientNode = typeof window !== 'undefined' && localStorage.getItem('isaac_pos_node_role') === 'client';
    const probeHost = async (host) => {
        const target3005 = `http://${host}:3005`;
        const check3005 = await checkServerDetailedHealth(target3005, 1000);
        if (check3005 && check3005.healthy && !(isClientNode && check3005.role === 'LAN_SPOKE')) {
            return { ...check3005, host, port: '3005' };
        }
        // If host is loopback or the previously saved IP, test alternate ports quickly
        if (host === '127.0.0.1' || host === 'localhost' || host === savedIp) {
            for (const port of ['5005', '8080']) {
                const altUrl = `http://${host}:${port}`;
                const checkAlt = await checkServerDetailedHealth(altUrl, 800);
                if (checkAlt && checkAlt.healthy) {
                    return { ...checkAlt, host, port };
                }
            }
        }
        return null;
    };

    // Parallel Subnet Execution in Batches of 8 Concurrently
    const batchSize = 8;
    let scannedCount = 0;

    for (let i = 0; i < candidateList.length; i += batchSize) {
        const batch = candidateList.slice(i, i + batchSize);
        if (progressCb) {
            const percent = Math.min(95, Math.round(15 + (scannedCount / total) * 80));
            progressCb({
                percent,
                message: `Escaneando ráfaga ${i + 1} a ${Math.min(i + batchSize, total)} de ${total} hosts...`
            });
        }

        await Promise.allSettled(
            batch.map(async (host) => {
                const found = await probeHost(host);
                if (found) {
                    const exists = discovered.some(d => d.url === found.url);
                    if (!exists) {
                        discovered.push(found);
                        if (onFound) onFound(found);
                        if (progressCb) {
                            progressCb({
                                percent: Math.min(95, Math.round(15 + (scannedCount / total) * 80)),
                                message: `¡Servidor detectado en ${host}!`,
                                currentHost: host
                            }, found);
                        }
                    }
                }
            })
        );
        scannedCount += batch.length;
    }

    if (progressCb) progressCb({ percent: 100, message: `Escaneo finalizado. ${discovered.length} servidor(es) detectado(s).` });
    return discovered;
};

// Automatic LAN/WiFi Server Discovery - Smart & Throttled
let isDiscovering = false;
export const autoDiscoverServer = async () => {
    if (isDiscovering) return null;
    const isCleared = typeof window !== 'undefined' && localStorage.getItem('isaac_pos_server_ip_explicitly_cleared') === 'true';
    const currentRole = typeof window !== 'undefined' ? (localStorage.getItem('isaac_pos_node_role') || 'client') : 'client';
    const savedIp = typeof window !== 'undefined' ? (localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip')) : '';

    // If user explicitly deleted the server IP, do not auto-reconnect
    if (isCleared) {
        return null;
    }

    isDiscovering = true;

    try {
        // 1. Check if current baseURL is already reachable (and is a true master server when in client mode)
        const currentUrl = api.defaults.baseURL || getBaseUrl();
        const isCurrentLoopback = currentUrl && (currentUrl.includes('127.0.0.1') || currentUrl.includes('localhost'));
        if (currentUrl && !(currentRole === 'client' && isCurrentLoopback)) {
            const isHealthy = await checkServerHealth(currentUrl, { requireMasterHost: currentRole === 'client' });
            if (isHealthy) {
                isDiscovering = false;
                return currentUrl;
            }
        }

        const isDesktop = typeof window !== 'undefined' && Boolean(window.electronAPI);
        const ports = ['3005'];
        const hostCandidates = new Set();

        // 0. Si estamos en Electron (Desktop), probar primero el descubrimiento UDP broadcast
        if (isDesktop && window.electronAPI && window.electronAPI.discoverLanServer) {
            try {
                const udpRes = await window.electronAPI.discoverLanServer(1500);
                if (udpRes && udpRes.found && udpRes.server) {
                    const sHost = udpRes.server.host || udpRes.server.ip;
                    const sPort = udpRes.server.port || '3005';
                    if (sHost) {
                        const targetUrl = sHost.startsWith('http') ? `${sHost}:${sPort}` : `http://${sHost}:${sPort}`;
                        const isHealthy = await checkServerHealth(targetUrl);
                        if (isHealthy) {
                            updateApiBaseUrl(targetUrl);
                            window.dispatchEvent(new CustomEvent('server-discovered', { detail: { url: targetUrl } }));
                            isDiscovering = false;
                            return targetUrl;
                        }
                    }
                }
            } catch (udpErr) {
                console.warn('[API] Falló sonda UDP autoDiscoverServer:', udpErr?.message);
            }
        }

        // Localhost only if server role
        if (currentRole === 'server' || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))) {
            hostCandidates.add('http://127.0.0.1');
            hostCandidates.add('http://localhost');
        }

        // Si hay una IP previamente guardada, probarla como prioridad
        if (savedIp) {
            const cleanIp = savedIp.startsWith('http') ? savedIp : `http://${savedIp}`;
            hostCandidates.add(cleanIp.replace(/:[0-9]+$/, ''));
        }

        // LAN candidates para clientes (tanto Desktop como Navegador y Móvil)
        if (currentRole === 'client' || !isDesktop) {
            // Dynamic Native Android Subnet Probing
            if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
                try {
                    const net = await PosNativeHardware.getNetworkInfo();
                    if (net && net.subnet) {
                        if (net.gateway) hostCandidates.add(`http://${net.gateway}`);
                        [1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 50, 100, 101, 200].forEach(n => {
                            hostCandidates.add(`http://${net.subnet}${n}`);
                        });
                        if (net.ip) {
                            const lastOctet = parseInt(net.ip.split('.')[3], 10);
                            if (!isNaN(lastOctet)) {
                                for (let d = -4; d <= 4; d++) {
                                    const target = lastOctet + d;
                                    if (target > 1 && target < 255) hostCandidates.add(`http://${net.subnet}${target}`);
                                }
                            }
                        }
                    }
                } catch (netErr) {
                    console.warn('[API] Error leyendo subred nativa en autoDiscover:', netErr?.message);
                }
            }

            if (typeof window !== 'undefined' && window.location && window.location.hostname) {
                if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                    hostCandidates.add(`http://${window.location.hostname}`);
                }
            }

            [
                'http://192.168.1.30',
                'http://192.168.1.50',
                'http://192.168.1.100',
                'http://192.168.1.2',
                'http://192.168.1.3',
                'http://192.168.1.4',
                'http://192.168.1.5',
                'http://192.168.1.6',
                'http://192.168.1.10',
                'http://192.168.0.50',
                'http://192.168.0.100',
                'http://192.168.0.2',
                'http://192.168.0.3',
                'http://192.168.0.4',
                'http://192.168.1.1'
            ].forEach(ip => hostCandidates.add(ip));
        }

        const primaryCandidates = Array.from(hostCandidates);

        // Probe primary candidates in parallel batches of 10
        const batchSize = 10;
        for (let i = 0; i < primaryCandidates.length; i += batchSize) {
            const batch = primaryCandidates.slice(i, i + batchSize);
            const promises = batch.flatMap(host => 
                ports.map(port => 
                    checkServerHealth(`${host}:${port}`, { requireMasterHost: currentRole === 'client' })
                        .then(ok => ok ? `${host}:${port}` : null)
                        .catch(() => null)
                )
            );

            const results = await Promise.all(promises);
            const found = results.find(r => r !== null);
            if (found) {
                updateApiBaseUrl(found);
                window.dispatchEvent(new CustomEvent('server-discovered', { detail: { url: found } }));
                isDiscovering = false;
                return found;
            }
        }
    } catch {
        // Silent catch
    } finally {
        isDiscovering = false;
    }
    return null;
};

// Interceptor: Attach baseURL fallback + Authorization Bearer token + LAN Sync Key
api.interceptors.request.use((config) => {
    if (!config.baseURL && !config.url?.startsWith('http')) {
        const fallbackUrl = getBaseUrl();
        if (fallbackUrl) {
            config.baseURL = fallbackUrl;
        } else {
            return Promise.reject(new Error('Sin servidor configurado'));
        }
    }
    const token = secureMobileStorage.getToken();
    if (token && !config.headers['Authorization'] && !config.headers['authorization']) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }
    const envSyncKey = localStorage.getItem('sync_secret_key');
    if (envSyncKey && !config.headers['x-sync-key'] && !config.headers['X-Sync-Key']) {
        config.headers['x-sync-key'] = envSyncKey;
    }
    const rawCompanyId = localStorage.getItem('companyId');
    const activeCompanyId = (rawCompanyId && rawCompanyId.length < 10 && rawCompanyId !== 'null' && rawCompanyId !== 'undefined') ? rawCompanyId : '2';
    if (!config.headers['x-company-id'] && !config.headers['X-Company-Id']) {
        config.headers['x-company-id'] = activeCompanyId;
    }
    try {
        const termId = getTerminalId();
        if (termId && !config.headers['x-terminal-id'] && !config.headers['X-Terminal-Id']) {
            config.headers['x-terminal-id'] = termId;
        }
    } catch (termErr) {
        console.warn('[API] Error adjuntando terminalId:', termErr?.message);
    }
    return config;
});

// Response Interceptor: Handle 401 Unauthorized & 403 License Required globally
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response) {
            if (error.response.status === 401) {
                const isLogout = error.config && error.config.url && error.config.url.includes('/auth/logout');
                const isLogin = error.config && error.config.url && error.config.url.includes('/auth/login');
                const isMe = error.config && error.config.url && error.config.url.includes('/auth/me');
                const isLoginPage = window.location.hash.includes('/login') || window.location.pathname.includes('/login');

                const isLockScreen = document.body?.dataset?.screenLocked === 'true';

                if (!isLogout && !isLogin && !isMe && !isLoginPage && !isLockScreen) {
                    window.dispatchEvent(new CustomEvent('auth-unauthorized'));
                }
            } else if (error.response.status === 403) {
                const data = error.response.data;
                if (data && (
                    data.error === 'licencia_requerida' ||
                    data.error === 'licencia_invalida' ||
                    data.error === 'licencia_suspendida' ||
                    data.error === 'licencia_verificacion_requerida'
                )) {
                    console.warn('[API] Requerimiento de licencia detectado:', data.message || data.reason || data.error);
                    window.dispatchEvent(new CustomEvent('license-required', { detail: data }));
                }
            }
        } else if (typeof window !== 'undefined' && !window.electronAPI && navigator.onLine !== false) {
            const now = Date.now();
            if (!window.__lastDhcpHealAt || now - window.__lastDhcpHealAt > 30000) {
                window.__lastDhcpHealAt = now;
                setTimeout(() => { autoDiscoverServer().catch(() => {}); }, 200);
            }
        }
        return Promise.reject(error);
    }
);

// Gentle background check on app start (mobile/tablet only - desktop uses local server or manual setup)
if (typeof window !== 'undefined') {
    const isDesktop = Boolean(window.electronAPI);
    const isClientRole = localStorage.getItem('isaac_pos_node_role') === 'client';
    if (!isDesktop || isClientRole) {
        setTimeout(() => {
            const currentUrl = api.defaults.baseURL || getBaseUrl();
            checkServerHealth(currentUrl).then(ok => {
                if (!ok) {
                    autoDiscoverServer().catch(() => {});
                }
            }).catch(() => {});
        }, 1500);
    }
}

export default api;
