import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
    Server, Wifi, Zap, Globe, Shield, RefreshCw, CheckCircle2, 
    AlertTriangle, X, Radio, HardDrive, Cpu, Terminal, ArrowRight,
    Activity, Check, ExternalLink, Network, Laptop, Sliders
} from 'lucide-react';
import api, { 
    formatServerUrl, 
    updateApiBaseUrl, 
    checkServerDetailedHealth, 
    scanLocalSubnetServers 
} from '../services/api';
import { db } from '../services/db';

const isMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    
    // 1. If running on desktop environment (Windows, Mac, Linux x86) or Electron, it is a desktop PC
    if (window.electronAPI || /Windows NT|Macintosh|Linux x86_64/i.test(navigator.userAgent)) {
        return false;
    }

    // 2. Real Native Capacitor on Android/iOS (not web runtime)
    const isCapacitorNative = Boolean(
        (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) ||
        window.location.protocol === 'capacitor:'
    );
    if (isCapacitorNative) return true;

    // 3. Mobile operating systems user agent (smartphones / tablets)
    return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export default function ServerConfigModal({ isOpen, onClose, onConfigSaved, initialIp = '' }) {
    const isMobile = isMobileDevice();

    // Active Tab: 'topology' | 'radar' | 'advanced'
    const [activeTab, setActiveTab] = useState('topology');

    // Node Role: 'server' (Master Central) | 'client' (Caja Secundaria LAN)
    const [nodeRole, setNodeRole] = useState(() => {
        if (isMobile) return 'client';
        const storedRole = localStorage.getItem('isaac_pos_node_role');
        const storedIp = localStorage.getItem('isaac_pos_server_ip') || '';
        if (storedRole === 'client' && storedIp && !storedIp.includes('127.0.0.1') && !storedIp.includes('localhost')) {
            return 'client';
        }
        return 'server';
    });

    // Connection Form
    const [serverIp, setServerIp] = useState('');
    const [apiPort, setApiPort] = useState('3005');
    const [dbPort, setDbPort] = useState('5432');
    const [dbName, setDbName] = useState('americanpos');
    const [timeoutMs, setTimeoutMs] = useState('3500');

    // Server Real Network Info
    const [serverNetworkInfo, setServerNetworkInfo] = useState(null);

    // Telemetry & Test State
    const [isTesting, setIsTesting] = useState(false);
    const [telemetry, setTelemetry] = useState(null); // { healthy, latencyMs, hostname, role, ips, error }

    // Radar LAN Scanner State
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState({ percent: 0, message: '' });
    const [discoveredServers, setDiscoveredServers] = useState([]);

    // Save State
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Initial load from storage and Electron API if available
    useEffect(() => {
        if (!isOpen) return;

        setSaveSuccess(false);
        setTelemetry(null);

        // 1. Read stored IP and Role
        const saved = localStorage.getItem('isaac_pos_server_ip') || localStorage.getItem('american_pos_server_ip') || initialIp || '';
        let savedRole = localStorage.getItem('isaac_pos_node_role');

        // On mobile devices, always enforce client terminal role
        if (isMobile) {
            savedRole = 'client';
            localStorage.setItem('isaac_pos_node_role', 'client');
        } else {
            // On desktop PC: if no role saved, or if it was marked as client without an external IP, default to 'server'
            if (!savedRole || (savedRole === 'client' && (!saved || saved.includes('127.0.0.1') || saved.includes('localhost')))) {
                savedRole = 'server';
                localStorage.setItem('isaac_pos_node_role', 'server');
            }
        }
        setNodeRole(savedRole);

        if (saved) {
            const clean = saved.replace(/^https?:\/\//, '');
            // On mobile, if saved IP was loopback, clear it so it doesn't fail
            if (isMobile && (clean.startsWith('127.0.0.1') || clean.startsWith('localhost'))) {
                setServerIp('');
            } else {
                setServerIp(clean);
            }
        } else {
            setServerIp(savedRole === 'server' ? '127.0.0.1' : '');
        }

        // 2. Query Electron DbConfigManager if available
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getDbConfig) {
            window.electronAPI.getDbConfig().then((cfg) => {
                if (cfg) {
                    if (cfg.mode) {
                        setNodeRole(cfg.mode);
                        localStorage.setItem('isaac_pos_node_role', cfg.mode);
                    }
                    if (cfg.host && cfg.mode === 'server') {
                        setServerIp(cfg.host);
                    } else if (cfg.host && cfg.mode === 'client') {
                        if (saved) {
                            setServerIp(saved.replace(/^https?:\/\//, ''));
                        } else if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
                            setServerIp(cfg.host);
                        } else {
                            setServerIp('');
                        }
                    }
                    if (cfg.port) setDbPort(String(cfg.port));
                    if (cfg.database) setDbName(cfg.database);
                }
            }).catch(() => {});
        } else {
            // Web fallback (only for desktop browsers on host PC)
            if (!isMobile && (saved.includes('127.0.0.1') || saved.includes('localhost') || !saved)) {
                setNodeRole('server');
            }
        }

        // 3. Fetch real local LAN IP for server banner
        api.get('/settings/network-info')
            .then(res => {
                if (res.data && res.data.success) {
                    setServerNetworkInfo(res.data);
                }
            })
            .catch(() => {
                api.get('/hello').then(res => {
                    if (res.data?.ips?.length) {
                        setServerNetworkInfo({
                            primaryIp: res.data.ips[0],
                            ips: res.data.ips.map(ip => ({ name: 'LAN', address: ip })),
                            port: 3005,
                            hostname: res.data.hostname
                        });
                    }
                }).catch(() => {});
            });
    }, [isOpen, initialIp, isMobile]);

    // Handle role toggle
    const handleRoleChange = (role) => {
        if (isMobile && role === 'server') {
            toast('En teléfonos móviles debes usar Caja Secundaria e ingresar la IP de la PC.', {
                icon: '📱',
                duration: 4000
            });
            return;
        }
        setNodeRole(role);
        setTelemetry(null);
        if (role === 'server') {
            setServerIp('127.0.0.1');
        } else {
            if (serverIp === '127.0.0.1' || serverIp === 'localhost') {
                setServerIp('');
            }
        }
    };

    // Run complete diagnostic test
    const handleRunDiagnostic = async (targetOverride = null) => {
        const target = targetOverride || serverIp;
        if (!target.trim()) return;

        setIsTesting(true);
        setTelemetry(null);

        try {
            const formatted = formatServerUrl(target);
            const res = await checkServerDetailedHealth(formatted, 3500);
            
            // If in Electron, also test PostgreSQL database socket
            let dbHealth = null;
            if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.testDbConnection) {
                const hostOnly = target.replace(/^https?:\/\//, '').split(':')[0];
                try {
                    const dbRes = await window.electronAPI.testDbConnection({
                        host: hostOnly || '127.0.0.1',
                        port: parseInt(dbPort, 10) || 5432,
                        database: dbName
                    });
                    dbHealth = dbRes;
                } catch (e) {
                    dbHealth = { success: false, message: e.message };
                }
            }

            setTelemetry({
                ...res,
                dbHealth
            });
        } catch (err) {
            setTelemetry({
                healthy: false,
                latencyMs: null,
                error: err.message || 'Fallo de conexión crítico'
            });
        } finally {
            setIsTesting(false);
        }
    };

    // Run Radar LAN Scan
    const handleStartRadarScan = async () => {
        setIsScanning(true);
        setScanProgress({ percent: 10, message: 'Iniciando radar de red LAN...' });
        setDiscoveredServers([]);

        try {
            const results = await scanLocalSubnetServers(
                (prog, foundServer) => {
                    if (prog) setScanProgress(prog);
                    if (foundServer) {
                        setDiscoveredServers(prev => {
                            const exists = prev.some(s => s.url === foundServer.url);
                            if (exists) return prev;
                            return [...prev, foundServer];
                        });
                    }
                },
                (immediateServer) => {
                    if (immediateServer) {
                        setDiscoveredServers(prev => {
                            const exists = prev.some(s => s.url === immediateServer.url);
                            if (exists) return prev;
                            return [...prev, immediateServer];
                        });
                    }
                }
            );
            if (results && results.length > 0) {
                setDiscoveredServers(results);
            }
        } catch (scanErr) {
            console.warn('Radar scan error:', scanErr);
        } finally {
            setIsScanning(false);
        }
    };

    // Select discovered server
    const handleSelectDiscoveredServer = (server) => {
        const cleanHost = server.url.replace(/^https?:\/\//, '');
        setServerIp(cleanHost);
        setNodeRole('client');
        setActiveTab('topology');
        handleRunDiagnostic(cleanHost);
    };

    // Save configuration
    const handleSave = async (restartRuntime = false) => {
        const cleanIp = serverIp.trim();
        localStorage.setItem('isaac_pos_node_role', nodeRole);

        if (!cleanIp || (nodeRole === 'client' && (cleanIp === '127.0.0.1' || cleanIp === 'localhost'))) {
            // User erased the IP address or configured client terminal without server IP
            localStorage.removeItem('isaac_pos_server_ip');
            localStorage.removeItem('american_pos_server_ip');
            localStorage.setItem('isaac_pos_server_ip_explicitly_cleared', 'true');
            updateApiBaseUrl('');

            // PURGE LOCAL CACHE & INDEXEDDB COMPLETELY
            try {
                await db.clear('products');
                await db.clear('categories');
                await db.clear('customers');
                await db.clear('metadata');
                await db.clear('imageCache');
                await db.clear('sales');
                await db.clear('syncQueue');
                console.log('[ServerConfigModal] Local IndexedDB purged successfully.');
            } catch (err) {
                console.warn('[ServerConfigModal] Error clearing IndexedDB:', err);
            }

            // Purge cached storage items so UI is 100% blank
            localStorage.removeItem('pos_categories');
            localStorage.removeItem('pos_stock_intelligence');
            localStorage.removeItem('pos_data_version');
            localStorage.removeItem('isaac_pos_initial_sync_done');
            localStorage.removeItem('initial_mobile_sync_completed');
            localStorage.removeItem('initial_setup_completed');
            localStorage.removeItem('last_sync_timestamp');
            localStorage.removeItem('pos_held_sales');
            localStorage.removeItem('pos_held_orders');
            localStorage.removeItem('pos_business_settings');
            localStorage.removeItem('pos_tax_settings');
            localStorage.removeItem('pos_payment_methods');
            localStorage.removeItem('isaac_pos_cached_cashiers');
            localStorage.setItem('pos_categories', '["Todas"]');

            const clearPayload = {
                mode: nodeRole,
                dialect: 'postgres',
                host: '',
                port: parseInt(dbPort, 10) || 5432,
                database: dbName,
                user: 'postgres'
            };

            // Guardar físicamente únicamente en el disco del equipo local (nunca en el servidor remoto ni desde móviles)
            if (!isMobile) {
                try {
                    await axios.post('http://127.0.0.1:3005/settings/db-config', clearPayload, { timeout: 2500 });
                } catch (e) {}
            }

            if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveDbConfigAndRestart) {
                if (restartRuntime) {
                    await window.electronAPI.saveDbConfigAndRestart(clearPayload);
                    return;
                }
            }
        } else {
            localStorage.removeItem('isaac_pos_server_ip_explicitly_cleared');
            updateApiBaseUrl(cleanIp);

            const hostOnly = cleanIp.replace(/^https?:\/\//, '').split(':')[0] || '127.0.0.1';
            const payload = {
                mode: nodeRole,
                dialect: 'postgres',
                host: nodeRole === 'server' ? '127.0.0.1' : hostOnly,
                port: parseInt(dbPort, 10) || 5432,
                database: dbName,
                user: 'postgres'
            };

            // Guardar físicamente únicamente en el disco del equipo local (nunca sobreescribir el db-config del servidor remoto)
            if (!isMobile) {
                try {
                    const apiRes = await axios.post('http://127.0.0.1:3005/settings/db-config', payload, { timeout: 2500 });
                    if (apiRes.data?.success) {
                        console.log('[ServerConfigModal] Configuración guardada en disco local exitosamente.');
                    }
                } catch (apiErr) {
                    console.warn('[ServerConfigModal] Aviso guardando db-config local:', apiErr?.message);
                }
            }

            // Compatibilidad con Electron si está disponible
            if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveDbConfigAndRestart) {
                if (restartRuntime) {
                    await window.electronAPI.saveDbConfigAndRestart(payload);
                    return;
                } else {
                    // If not restarting, test connection
                    window.electronAPI.testDbConnection(payload).catch(() => {});
                }
            }
        }

        setSaveSuccess(true);
        setTimeout(() => {
            if (onConfigSaved) onConfigSaved(cleanIp);
            onClose();
        }, 600);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe animate-in fade-in duration-200">
            <div className="bg-slate-950 border border-slate-800 rounded-t-xl sm:rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
                
                {/* MODAL HEADER: Enterprise Banner */}
                <div className="p-4 sm:p-5 bg-slate-900 border-b border-slate-800 flex items-center justify-between relative overflow-hidden gap-2">
                    <div className="flex items-center gap-2.5 sm:gap-3 relative z-10 min-w-0">
                        <div className="p-2 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 shrink-0">
                            <Network size={20} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                <h3 className="text-sm sm:text-lg font-black text-white tracking-tight truncate">
                                    Configuración de Servidor
                                </h3>
                                <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 font-mono text-[9px] sm:text-[10px] font-bold shrink-0">
                                    TCP/IP
                                </span>
                            </div>
                            <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 truncate">
                                Topología Multi-Caja • Diagnóstico de Red
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-white min-h-[44px] min-w-[44px] rounded-xl hover:bg-white/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center shrink-0"
                        title="Cerrar"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* NAVIGATION TABS */}
                <div className="flex items-center border-b border-slate-800 bg-slate-900/50 px-2 sm:px-6 pt-2 gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
                    <button
                        type="button"
                        onClick={() => setActiveTab('topology')}
                        className={`min-h-[44px] pb-3 px-3 text-[11px] sm:text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 sm:gap-2 border-b-2 cursor-pointer shrink-0 active:scale-95 ${
                            activeTab === 'topology'
                                ? 'border-blue-500 text-blue-400'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Radio size={14} />
                        <span>Conexión &amp; Rol</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('radar')}
                        className={`min-h-[44px] pb-3 px-3 text-[11px] sm:text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 sm:gap-2 border-b-2 cursor-pointer shrink-0 active:scale-95 ${
                            activeTab === 'radar'
                                ? 'border-emerald-500 text-emerald-400'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Zap size={14} />
                        <span>Radar LAN</span>
                        {discoveredServers.length > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                                {discoveredServers.length}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('advanced')}
                        className={`min-h-[44px] pb-3 px-3 text-[11px] sm:text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 sm:gap-2 border-b-2 cursor-pointer shrink-0 active:scale-95 ${
                            activeTab === 'advanced'
                                ? 'border-purple-500 text-purple-400'
                                : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                    >
                        <Sliders size={14} />
                        <span>SysAdmin</span>
                    </button>
                </div>

                {/* MODAL BODY (Scrollable) */}
                <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">

                    {/* TAB 1: TOPOLOGÍA & CONEXIÓN */}
                    {activeTab === 'topology' && (
                        <div className="space-y-6">
                            
                            {/* ROLE SELECTOR CARDS */}
                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                    <Cpu size={14} className="text-blue-400" />
                                    Arquitectura de esta Computadora
                                </label>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {/* Master Server Card */}
                                    <button
                                        type="button"
                                        onClick={() => handleRoleChange('server')}
                                        className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                                            nodeRole === 'server'
                                                ? 'bg-blue-600/15 border-blue-500/80 shadow-lg shadow-blue-500/10'
                                                : isMobile 
                                                    ? 'bg-slate-900/40 border-slate-800/80 opacity-60'
                                                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 opacity-70 hover:opacity-100'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className={`p-2 rounded-xl ${isMobile ? 'bg-slate-800 text-slate-500' : 'bg-blue-500/20 text-blue-400'}`}>
                                                <Server size={20} />
                                            </div>
                                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                                isMobile 
                                                    ? 'bg-slate-800 text-slate-400 border border-slate-700' 
                                                    : nodeRole === 'server' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-400'
                                            }`}>
                                                {isMobile ? 'SOLO EN COMPUTADORA PC' : 'MASTER HUB'}
                                            </span>
                                        </div>
                                        <div>
                                            <h4 className={`text-sm font-black ${isMobile ? 'text-slate-400' : 'text-white'}`}>
                                                Servidor Principal
                                            </h4>
                                            <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                                                {isMobile 
                                                    ? 'Aloja PostgreSQL en la PC. Un teléfono móvil no ejecuta la base de datos central.' 
                                                    : 'Aloja la Base de Datos PostgreSQL y centraliza las ventas de todas las cajas.'}
                                            </p>
                                        </div>
                                    </button>

                                    {/* LAN Spoke Card */}
                                    <button
                                        type="button"
                                        onClick={() => handleRoleChange('client')}
                                        className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                                            nodeRole === 'client'
                                                ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/15'
                                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 opacity-70 hover:opacity-100'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                                                <Laptop size={20} />
                                            </div>
                                            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                                nodeRole === 'client' 
                                                    ? 'bg-emerald-500 text-slate-950 font-black' 
                                                    : 'bg-slate-800 text-slate-400'
                                            }`}>
                                                {isMobile ? 'RECOMENDADO EN MÓVIL' : 'LAN TERMINAL'}
                                            </span>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-black text-white">Caja Secundaria {isMobile ? '/ Móvil' : 'LAN'}</h4>
                                            <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                                                {isMobile
                                                    ? 'Terminal de cobro para teléfonos. Se conecta por WiFi a la IP de tu Computadora PC.'
                                                    : 'Terminal de cobro para otra PC en red local. Se conecta por LAN/WiFi a la PC Servidor Principal.'}
                                            </p>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* TARGET SERVER IP FIELD */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                                        <Terminal size={14} className="text-indigo-400" />
                                        {nodeRole === 'server' ? 'Enlace Local de Host' : 'Nombre de Equipo (PC) o Dirección IP del Servidor'}
                                    </label>
                                    {nodeRole === 'client' && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab('radar')}
                                            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                                        >
                                            <Zap size={12} />
                                            Escanear Red LAN
                                        </button>
                                    )}
                                </div>

                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        value={serverIp}
                                        disabled={nodeRole === 'server'}
                                        onChange={(e) => setServerIp(e.target.value)}
                                        placeholder="Ej: SERVIDOR-POS o 192.168.1.50"
                                        className={`w-full px-4 py-3.5 pr-20 bg-slate-900 border rounded-2xl text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 font-mono text-base sm:text-sm min-h-[48px] shadow-inner transition-all ${
                                            nodeRole === 'server'
                                                ? 'border-slate-800 bg-slate-900/40 text-slate-400 cursor-not-allowed'
                                                : 'border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/30'
                                        }`}
                                    />
                                    {serverIp && nodeRole !== 'server' && (
                                        <button
                                            type="button"
                                            onClick={() => setServerIp('')}
                                            title="Borrar dirección"
                                            className="absolute right-14 p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-center active:scale-95"
                                        >
                                            <X size={15} />
                                        </button>
                                    )}
                                    <span className="absolute right-3.5 text-xs font-mono font-bold text-slate-500">
                                        :{apiPort}
                                    </span>
                                </div>

                                {nodeRole === 'client' && (
                                    <div className="space-y-1.5 pt-1">
                                        <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                            <span className="text-amber-400">💡</span>
                                            <span>
                                                <strong className="text-slate-200">Consejo Pro:</strong> Puedes escribir el <strong className="text-emerald-400">Nombre de la PC Servidor</strong> (ej: <code>SERVIDOR-POS</code>). Así nunca se desconfigura aunque el router cambie de IP.
                                            </span>
                                        </p>
                                    </div>
                                )}

                                {nodeRole === 'server' ? (
                                    <div className="space-y-3">
                                        {serverNetworkInfo?.primaryIp && serverNetworkInfo.primaryIp !== '127.0.0.1' ? (
                                            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="relative flex h-2.5 w-2.5">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                                        </span>
                                                        <span className="text-xs font-black uppercase tracking-wider text-emerald-200">
                                                            IP de este Servidor en tu Red Local:
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const fullAddr = `${serverNetworkInfo.primaryIp}:${apiPort}`;
                                                            navigator.clipboard.writeText(fullAddr);
                                                            toast.success(`¡IP copiada: ${fullAddr}!`, { icon: '📋' });
                                                        }}
                                                        className="px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                                                    >
                                                        <Check size={12} />
                                                        Copiar IP
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="font-mono text-base font-black text-white bg-slate-950/80 px-3 py-1.5 rounded-xl border border-emerald-500/30 flex-1 truncate">
                                                        {serverNetworkInfo.primaryIp}:{apiPort}
                                                    </div>
                                                </div>
                                                <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                                                    Escribe esta dirección en las <strong>Cajas Secundarias</strong> o teléfonos para que se conecten de inmediato a este Servidor Principal.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs flex items-start gap-2.5">
                                                <Activity size={16} className="text-blue-400 shrink-0 mt-0.5" />
                                                <p className="leading-relaxed">
                                                    Modo <strong>Servidor Principal</strong>: Esta máquina administra la base de datos central. Para enlazar otras cajas, configura en ellas la <strong>dirección IP local de esta PC</strong> en el puerto <code className="font-mono text-white bg-blue-900/60 px-1 py-0.5 rounded">{apiPort}</code>.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] font-bold text-slate-500">Acción:</span>
                                            <button
                                                type="button"
                                                onClick={() => setServerIp('')}
                                                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-bold border border-rose-500/30 cursor-pointer flex items-center gap-1.5 transition-all active:scale-95"
                                            >
                                                <X size={13} />
                                                Borrar Dirección
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* DIAGNOSTIC TELEMETRY CARD */}
                            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <Activity size={16} className="text-indigo-400" />
                                        <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                                            Diagnóstico de Conexión
                                        </span>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => handleRunDiagnostic()}
                                        disabled={isTesting || !serverIp.trim()}
                                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 text-xs font-black border border-indigo-500/40 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 active:scale-95"
                                    >
                                        {isTesting ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                                        <span>{isTesting ? 'Comprobando...' : 'Diagnosticar'}</span>
                                    </button>
                                </div>

                                {telemetry ? (
                                    <div className="space-y-3 animate-in fade-in">
                                        {/* Status banner */}
                                        <div className={`p-3 rounded-xl border flex items-center gap-3 text-xs font-bold ${
                                            telemetry.healthy 
                                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                                : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                                        }`}>
                                            {telemetry.healthy ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
                                            <div>
                                                <p className="font-black text-sm">
                                                    {telemetry.healthy ? 'Conexión Establecida con Éxito' : 'Servidor Inaccesible en la Red'}
                                                </p>
                                                <p className="font-normal text-[11px] opacity-90 mt-0.5">
                                                    {telemetry.healthy 
                                                        ? `Respuesta recibida desde ${telemetry.hostname || 'Host'} en ${telemetry.latencyMs} ms.`
                                                        : (telemetry.error || 'Verifica que la PC Servidor esté encendida y en la misma red.')
                                                    }
                                                </p>
                                            </div>
                                        </div>

                                        {/* 3-Point Telemetry Grid */}
                                        <div className="grid grid-cols-3 gap-2 text-center pt-1">
                                            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                                <span className="text-[10px] text-slate-400 font-bold block uppercase">Ping / Latencia</span>
                                                <span className={`text-xs font-mono font-black mt-1 block ${
                                                    telemetry.latencyMs && telemetry.latencyMs < 30 ? 'text-emerald-400' : 'text-amber-400'
                                                }`}>
                                                    {telemetry.latencyMs !== null ? `${telemetry.latencyMs} ms` : '---'}
                                                </span>
                                            </div>

                                            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                                <span className="text-[10px] text-slate-400 font-bold block uppercase">API Gateway</span>
                                                <span className={`text-xs font-mono font-black mt-1 block ${
                                                    telemetry.healthy ? 'text-emerald-400' : 'text-rose-400'
                                                }`}>
                                                    {telemetry.healthy ? 'HTTP 200' : 'OFFLINE'}
                                                </span>
                                            </div>

                                            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                                                <span className="text-[10px] text-slate-400 font-bold block uppercase">PostgreSQL</span>
                                                <span className="text-xs font-mono font-black text-emerald-400 mt-1 block">
                                                    {telemetry.dbHealth ? (telemetry.dbHealth.success ? 'READY' : 'WAIT') : (telemetry.healthy ? 'ENLACE OK' : '---')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-500 italic text-center py-2">
                                        Presiona "Diagnosticar" para medir latencia, enlace de red y estado del servidor.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 2: RADAR LAN (AUTO-DISCOVERY) */}
                    {activeTab === 'radar' && (
                        <div className="space-y-5">
                            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 ${isScanning ? 'animate-spin' : ''}`}>
                                        <Zap size={20} />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-black text-white">Radar de Detección de Clúster LAN</h4>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            Sondea la subred local buscando instancias activas de Isaac POS Master.
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleStartRadarScan}
                                    disabled={isScanning}
                                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                                >
                                    {isScanning ? <RefreshCw size={14} className="animate-spin" /> : <Radio size={14} />}
                                    <span>{isScanning ? 'Escaneando...' : 'Iniciar Radar'}</span>
                                </button>
                            </div>

                            {/* Progress bar if scanning */}
                            {isScanning && (
                                <div className="space-y-1.5 animate-in fade-in">
                                    <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                                        <span>{scanProgress.message}</span>
                                        <span>{scanProgress.percent}%</span>
                                    </div>
                                    <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                                        <div 
                                            className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                                            style={{ width: `${scanProgress.percent}%` }}
                                        ></div>
                                    </div>
                                </div>
                            )}

                            {/* Discovered Servers List */}
                            <div className="space-y-2.5">
                                <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                                    Servidores Detectados en la Red ({discoveredServers.length})
                                </label>

                                {discoveredServers.length > 0 ? (
                                    <div className="space-y-2">
                                        {discoveredServers.map((srv, idx) => (
                                            <div
                                                key={idx}
                                                className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-700/80 hover:border-emerald-500/60 transition-all flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 group shadow-md"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 shrink-0">
                                                        <Server size={18} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h5 className="text-xs font-black text-white truncate">{srv.hostname || 'Isaac POS Servidor'}</h5>
                                                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                                                                {srv.latencyMs} ms
                                                            </span>
                                                        </div>
                                                        <p className="text-xs font-mono text-slate-400 mt-0.5 truncate">
                                                            {srv.url}
                                                        </p>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectDiscoveredServer(srv)}
                                                    className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                                                >
                                                    <span>Conectar</span>
                                                    <ArrowRight size={13} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : !isScanning ? (
                                    <div className="p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center space-y-2">
                                        <Network size={28} className="mx-auto text-slate-600" />
                                        <p className="text-xs text-slate-400">
                                            No se han detectado servidores aún. Haz clic en <strong>"Iniciar Radar"</strong> para explorar automáticamente.
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: AJUSTES SYSADMIN */}
                    {activeTab === 'advanced' && (
                        <div className="space-y-4">
                            <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs flex items-start gap-2.5">
                                <Shield size={16} className="text-purple-400 shrink-0 mt-0.5" />
                                <p className="leading-relaxed">
                                    Parámetros técnicos de socket TCP y motor de base de datos. Solo modifica estos valores si tu entorno de red utiliza puertos asignados por tu administrador de red.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                                        Puerto API HTTP
                                    </label>
                                    <input
                                        type="text"
                                        value={apiPort}
                                        onChange={(e) => setApiPort(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base sm:text-sm min-h-[44px]"
                                    />
                                    <span className="text-[11px] text-slate-500">Por defecto: 3005</span>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                                        Puerto PostgreSQL
                                    </label>
                                    <input
                                        type="text"
                                        value={dbPort}
                                        onChange={(e) => setDbPort(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base sm:text-sm min-h-[44px]"
                                    />
                                    <span className="text-[11px] text-slate-500">Por defecto: 5432</span>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                                        Base de Datos Target
                                    </label>
                                    <input
                                        type="text"
                                        value={dbName}
                                        onChange={(e) => setDbName(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base sm:text-sm min-h-[44px]"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-black uppercase tracking-wider text-slate-400">
                                        Timeout de Red (ms)
                                    </label>
                                    <select
                                        value={timeoutMs}
                                        onChange={(e) => setTimeoutMs(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base sm:text-sm min-h-[44px] cursor-pointer"
                                    >
                                        <option value="2000">2000 ms (Rápido)</option>
                                        <option value="3500">3500 ms (Recomendado)</option>
                                        <option value="5000">5000 ms (Red Lenta)</option>
                                        <option value="10000">10000 ms (WiFi Inestable)</option>
                                    </select>
                                </div>
                            </div>

                            {/* Electron Runtime Relaunch Option */}
                            {typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveDbConfigAndRestart && (
                                <div className="pt-2 border-t border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => handleSave(true)}
                                        className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 font-black text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                                    >
                                        <RefreshCw size={14} />
                                        <span>Guardar en Windows AppData y Reiniciar Runtime de la App</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* MODAL FOOTER */}
                <div className="p-4 sm:p-6 pb-safe sm:pb-6 bg-slate-900/90 border-t border-slate-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full sm:w-auto min-h-[48px] py-3 px-5 rounded-2xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs transition-all cursor-pointer flex items-center justify-center active:scale-95"
                    >
                        Cancelar
                    </button>

                    <button
                        type="button"
                        onClick={() => handleSave(false)}
                        className="w-full sm:w-auto min-h-[48px] py-3 px-6 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 hover:from-blue-500 hover:via-indigo-500 hover:to-emerald-400 text-white font-black text-xs uppercase tracking-wider transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer border border-indigo-400/30 active:scale-95"
                    >
                        {saveSuccess ? <Check size={16} className="text-white" /> : <HardDrive size={16} />}
                        <span>{saveSuccess ? '¡Guardado con Éxito!' : 'Guardar y Aplicar'}</span>
                    </button>
                </div>

            </div>
        </div>
    );
}
