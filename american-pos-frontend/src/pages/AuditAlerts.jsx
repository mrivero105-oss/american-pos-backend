import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/AuthContext';
import api from '../services/api';
import { AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck, RefreshCw, XCircle, Package, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

const AuditAlerts = () => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('security'); // 'security', 'quarantine', or 'stock'
    
    // Security Alerts State
    const [alerts, setAlerts] = useState([]);
    const [loadingAlerts, setLoadingAlerts] = useState(true);

    // Quarantine Sales State
    const [quarantineList, setQuarantineList] = useState([]);
    const [loadingQuarantine, setLoadingQuarantine] = useState(false);

    // Stock Conflicts State
    const [stockAlerts, setStockAlerts] = useState([]);
    const [loadingStock, setLoadingStock] = useState(false);

    const fetchAlerts = async () => {
        try {
            setLoadingAlerts(true);
            const response = await api.get('/audit/alerts');
            const list = Array.isArray(response.data) ? response.data : (response.data?.alerts || response.data?.data || []);
            setAlerts(list);
        } catch (error) {
            console.error('Error fetching alerts', error);
            toast.error('Error al obtener alertas de seguridad');
        } finally {
            setLoadingAlerts(false);
        }
    };

    const fetchQuarantine = async () => {
        try {
            setLoadingQuarantine(true);
            const response = await api.get('/lan/quarantine');
            if (response.data && response.data.success) {
                setQuarantineList(response.data.data || []);
            }
        } catch (error) {
            console.error('Error fetching quarantine sales', error);
            toast.error('Error al obtener transacciones en cuarentena LAN');
        } finally {
            setLoadingQuarantine(false);
        }
    };

    const fetchStockAlerts = async () => {
        try {
            setLoadingStock(true);
            const response = await api.get('/stock-alerts');
            if (response.data && response.data.success) {
                setStockAlerts(response.data.data || []);
            }
        } catch (error) {
            console.error('Error fetching stock alerts', error);
        } finally {
            setLoadingStock(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
        fetchQuarantine();
        fetchStockAlerts();
    }, []);

    const handleResolveAlert = async (id) => {
        try {
            await api.put(`/audit/alerts/${id}/resolve`);
            toast.success('Alerta marcada como resuelta');
            fetchAlerts();
        } catch (error) {
            console.error('Error resolving alert', error);
            toast.error('Error al resolver la alerta');
        }
    };

    const handleResolveQuarantine = async (id, action) => {
        const actionLabel = action === 'FORCE_APPROVE' ? 'aprobada' : 'anulada y descartada';
        try {
            const res = await api.post(`/lan/quarantine/${id}/resolve`, {
                action,
                supervisorId: user?.id || 'supervisor',
                notes: `Resolución manual (${action}) por ${user?.name || 'Supervisor'}`
            });
            if (res.data && res.data.success) {
                toast.success(`Transacción ${actionLabel} correctamente`);
                fetchQuarantine();
            } else {
                toast.error(res.data?.error || 'No se pudo resolver la transacción');
            }
        } catch (error) {
            console.error('Error resolving quarantine sale', error);
            toast.error('Error de servidor al resolver cuarentena');
        }
    };

    const handleResolveStockAlert = async (id) => {
        try {
            const res = await api.put(`/stock-alerts/${id}/resolve`, {
                resolutionNotes: `Revisado y auditado por ${user?.name || 'Supervisor'}`
            });
            if (res.data && res.data.success) {
                toast.success('Descuadre de stock marcado como verificado');
                fetchStockAlerts();
            } else {
                toast.error(res.data?.error || 'No se pudo resolver el conflicto de stock');
            }
        } catch (error) {
            console.error('Error resolving stock alert', error);
            toast.error('Error al resolver la alerta de stock');
        }
    };

    const getSeverityBadge = (severity) => {
        switch(severity) {
            case 'critical': return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40';
            case 'high': return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/40';
            case 'medium': return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40';
            default: return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/40';
        }
    };

    return (
        <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300 pb-24 sm:pb-12 pb-safe">
            {/* Header with Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-xl shadow-xs">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 rounded-lg text-rose-600 dark:text-rose-400 shrink-0">
                        <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Centro de Auditoría</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">Monitoreo antifraude y conflictos LAN</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex space-x-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => setActiveTab('security')}
                        className={`min-h-[36px] px-3.5 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
                            activeTab === 'security'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                        <span>Alertas ({alerts.filter(a => a.status !== 'RESOLVED').length})</span>
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('quarantine');
                            fetchQuarantine();
                        }}
                        className={`min-h-[36px] px-3.5 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                            activeTab === 'quarantine'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        <span>Cuarentena LAN</span>
                        {quarantineList.filter(q => q.status === 'pending_review').length > 0 && (
                            <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-bold rounded-full text-[10px]">
                                {quarantineList.filter(q => q.status === 'pending_review').length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('stock');
                            fetchStockAlerts();
                        }}
                        className={`min-h-[36px] px-3.5 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                            activeTab === 'stock'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Package className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Stock Offline ({stockAlerts.filter(s => s.status === 'PENDING').length})</span>
                    </button>
                </div>
            </div>

            {/* TAB 1: ALERTAS DE SEGURIDAD */}
            {activeTab === 'security' && (
                <div className="space-y-4">
                    <div className="flex justify-end">
                        <button
                            onClick={fetchAlerts}
                            className="min-h-[36px] flex items-center justify-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer shadow-xs"
                        >
                            <RefreshCw className="w-3.5 h-3.5 text-indigo-500" /> Refrescar Alertas
                        </button>
                    </div>

                    {loadingAlerts ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-rose-500 border-t-transparent"></div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Escaneando alertas de seguridad...</p>
                        </div>
                    ) : alerts.length === 0 ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 p-5 rounded-xl shadow-xs flex items-center gap-3.5">
                            <CheckCircle className="text-emerald-600 dark:text-emerald-400 w-6 h-6 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Sistema Protegido</h3>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300">No hay alertas de seguridad pendientes. Toda la actividad está verificada y en orden.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 sm:space-y-4">
                            {alerts.map(alert => (
                                <div key={alert.id} className={`bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border ${alert.status === 'RESOLVED' ? 'border-slate-200 dark:border-slate-800 opacity-60' : 'border-rose-200 dark:border-rose-900/40'} shadow-xs transition-colors`}>
                                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                        <div className="flex-1 space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${getSeverityBadge(alert.severity)}`}>
                                                    {alert.severity}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase border ${alert.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40' : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40'}`}>
                                                    {alert.status}
                                                </span>
                                                <span className="text-xs text-slate-400 font-mono">
                                                    {new Date(alert.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                            <h3 className="text-base font-bold text-slate-900 dark:text-white">{String(alert.type || 'ALERTA').toUpperCase().replace(/_/g, ' ')}</h3>
                                            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">{alert.message}</p>
                                            
                                            {alert.user && (
                                                <p className="text-xs text-slate-500">
                                                    <span className="font-semibold text-slate-700 dark:text-slate-300">Usuario involucrado:</span> {alert.user.name} ({alert.user.username})
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-end shrink-0 pt-2 sm:pt-0">
                                            {alert.status !== 'RESOLVED' ? (
                                                <button 
                                                    onClick={() => handleResolveAlert(alert.id)}
                                                    className="min-h-[36px] px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                >
                                                    <CheckCircle className="w-3.5 h-3.5" /> Marcar Resuelta
                                                </button>
                                            ) : (
                                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Resuelta</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: CUARENTENA LAN P2P */}
            {activeTab === 'quarantine' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 p-4 rounded-xl">
                        <div className="text-xs text-amber-800 dark:text-amber-200">
                            <strong className="text-amber-700 dark:text-amber-400">Sincronización Offline en Cuarentena:</strong> Transacciones generadas en cajas locales con discrepancias o validación P2P.
                        </div>
                        <button
                            onClick={fetchQuarantine}
                            className="min-h-[36px] flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-800 border border-amber-200 dark:border-amber-900/40 transition-colors shrink-0 cursor-pointer shadow-xs"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Actualizar
                        </button>
                    </div>

                    {loadingQuarantine ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent"></div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Cargando transacciones en cuarentena...</p>
                        </div>
                    ) : quarantineList.length === 0 ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 p-5 rounded-xl shadow-xs flex items-center gap-3.5">
                            <ShieldCheck className="text-emerald-600 dark:text-emerald-400 w-6 h-6 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Cuarentena Vacía</h3>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300">No hay ventas offline en cuarentena. Todas las cajas locales están sincronizadas.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 sm:space-y-4">
                            {quarantineList.map(item => {
                                const isPending = item.status === 'pending_review' || item.status === 'quarantined';
                                const payloadData = item.payload || item.salePayload;
                                return (
                                <div key={item.id} className={`bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border ${isPending ? 'border-amber-200 dark:border-amber-900/40' : 'border-slate-200 dark:border-slate-800 opacity-60'} shadow-xs`}>
                                    <div className="flex flex-col lg:flex-row justify-between gap-4">
                                        <div className="flex-1 space-y-2">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${isPending ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                                                    {String(item.status || 'pending').replace(/_/g, ' ')}
                                                </span>
                                                <span className="text-xs font-mono text-slate-400">
                                                    ID: {item.id}
                                                </span>
                                                <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/40 px-2 py-0.5 rounded">
                                                    Caja: {item.registerId || item.userId || 'POS-LAN'}
                                                </span>
                                                <span className="text-xs text-slate-400 font-mono">
                                                    {new Date(item.createdAt || Date.now()).toLocaleString()}
                                                </span>
                                            </div>

                                            <div className="bg-rose-50 dark:bg-rose-950/30 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300">
                                                <strong className="font-semibold text-rose-800 dark:text-rose-400">Motivo:</strong> {item.errorReason || item.conflictReason || 'Descuadre de inventario o duplicidad detectada.'}
                                            </div>

                                            {/* Detalles de la venta */}
                                            {payloadData && (
                                                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs space-y-2">
                                                    <div className="font-semibold text-slate-800 dark:text-white flex justify-between items-center">
                                                        <span>Venta #{payloadData.clientTransactionId || item.offlineId || String(item.id || '').slice(-6)}</span>
                                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono text-sm">
                                                            ${Number(payloadData.total || 0).toFixed(2)} USD
                                                        </span>
                                                    </div>
                                                    {Array.isArray(payloadData.items) && payloadData.items.length > 0 && (
                                                        <div className="text-slate-600 dark:text-slate-300 space-y-1 border-t border-slate-200 dark:border-slate-700/60 pt-2">
                                                            {payloadData.items.map((prod, idx) => (
                                                                <div key={idx} className="flex justify-between font-mono text-[11px]">
                                                                    <span>• {prod.quantity}x {prod.name || prod.nombre || 'Producto'}</span>
                                                                    <span>${Number(prod.subtotal || prod.price || 0).toFixed(2)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Botones de acción */}
                                        <div className="flex flex-col sm:flex-row lg:flex-col justify-center items-stretch sm:items-end gap-2 shrink-0 pt-2 lg:pt-0">
                                            {isPending ? (
                                                 <>
                                                    <button
                                                        onClick={() => handleResolveQuarantine(item.id, 'FORCE_APPROVE')}
                                                        className="min-h-[36px] px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                    >
                                                        <CheckCircle className="w-3.5 h-3.5" /> Aprobar y Forzar
                                                    </button>
                                                    <button
                                                        onClick={() => handleResolveQuarantine(item.id, 'DISCARD')}
                                                        className="min-h-[36px] px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                    >
                                                        <XCircle className="w-3.5 h-3.5" /> Rechazar y Anular
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-xs font-semibold text-slate-400 italic">
                                                    Procesada: {item.resolutionNotes || item.status}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: CONFLICTOS DE STOCK OFFLINE */}
            {activeTab === 'stock' && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40 p-4 rounded-xl">
                        <div className="text-xs text-indigo-800 dark:text-indigo-200">
                            <strong className="text-indigo-700 dark:text-indigo-400">Sobregiros & Conflictos de Stock Offline:</strong> Ventas cobradas en terminales satélite sin internet que sobrepasaron el inventario del servidor al sincronizarse.
                        </div>
                        <button
                            onClick={fetchStockAlerts}
                            className="min-h-[36px] flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-indigo-800 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-800 border border-indigo-200 dark:border-indigo-900/40 transition-colors shrink-0 cursor-pointer shadow-xs"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Actualizar
                        </button>
                    </div>

                    {loadingStock ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent"></div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Consultando conflictos de inventario...</p>
                        </div>
                    ) : stockAlerts.length === 0 ? (
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 p-5 rounded-xl shadow-xs flex items-center gap-3.5">
                            <ShieldCheck className="text-emerald-600 dark:text-emerald-400 w-6 h-6 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Inventario en Equilibrio</h3>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300">No hay discrepancias ni sobregiros de stock provocados por ventas offline.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 sm:space-y-4">
                            {stockAlerts.map(alert => {
                                const isPending = alert.status === 'PENDING';
                                return (
                                    <div key={alert.id} className={`bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border ${isPending ? 'border-indigo-200 dark:border-indigo-900/40' : 'border-slate-200 dark:border-slate-800 opacity-60'} shadow-xs`}>
                                        <div className="flex flex-col lg:flex-row justify-between gap-4">
                                            <div className="flex-1 space-y-2">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${isPending ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                                                        {alert.alertType}
                                                    </span>
                                                    <span className="text-xs font-mono text-slate-400">
                                                        Alerta #{alert.id.slice(0, 8)}
                                                    </span>
                                                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/40 px-2 py-0.5 rounded">
                                                        Venta #{alert.saleId ? alert.saleId.slice(0, 8) : 'Offline'}
                                                    </span>
                                                    <span className="text-xs text-slate-400 font-mono">
                                                        {new Date(alert.createdAt).toLocaleString()}
                                                    </span>
                                                </div>

                                                <div className="bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-200">
                                                    <strong className="font-semibold text-amber-700 dark:text-amber-300">Descuadre:</strong> Venta offline generó sobregiro de <strong>-{alert.overdraftAmount}</strong> unidades en <span className="font-bold underline">{alert.product?.name || 'Producto'}</span>.
                                                </div>

                                                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs space-y-1 font-mono">
                                                    <div className="flex justify-between text-slate-600 dark:text-slate-300">
                                                        <span>Código de Barras:</span>
                                                        <span className="font-bold text-slate-900 dark:text-white">{alert.product?.barcode || 'N/A'}</span>
                                                    </div>
                                                    <div className="flex justify-between text-slate-600 dark:text-slate-300">
                                                        <span>Stock en Servidor Previo:</span>
                                                        <span className="font-bold">{alert.expectedStock}</span>
                                                    </div>
                                                    <div className="flex justify-between text-slate-600 dark:text-slate-300">
                                                        <span>Cantidad Vendida en Caja:</span>
                                                        <span className="font-bold text-amber-600 dark:text-amber-400">{alert.soldQuantity}</span>
                                                    </div>
                                                    <div className="flex justify-between text-slate-600 dark:text-slate-300">
                                                        <span>Stock Actual en Almacén:</span>
                                                        <span className="font-bold text-rose-600 dark:text-rose-400">{alert.product?.stock ?? (Number(alert.expectedStock) - Number(alert.soldQuantity))}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Action Button */}
                                            <div className="flex flex-col justify-center items-stretch sm:items-end gap-2 shrink-0 pt-2 lg:pt-0">
                                                {isPending ? (
                                                    <button
                                                        onClick={() => handleResolveStockAlert(alert.id)}
                                                        className="min-h-[36px] px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                                    >
                                                        <CheckCircle className="w-3.5 h-3.5" /> Marcar Verificado
                                                    </button>
                                                ) : (
                                                    <span className="text-xs font-semibold text-slate-400 italic">
                                                        Auditado: {alert.resolutionNotes || 'Resuelto'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AuditAlerts;
