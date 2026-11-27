import { useState, useEffect } from 'react';
import {
    Printer, 
    Save, 
    Loader2, 
    Network, 
    Coins, 
    CheckCircle2, 
    RefreshCw, 
    Layers, 
    Receipt, 
    Play, 
    Server, 
    Laptop, 
    Search, 
    ArrowRightLeft, 
    Eye, 
    Zap, 
    FileText, 
    Activity, 
    Radio, 
    Lock
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { isDollarOnlyCountry, isUsdOnlyMode, getTaxIdLabel } from '../../utils/format';

export default function PrinterSettings({
    business,
    setBusiness,
    systemPrinters = [],
    saving,
    onSave,
    onTestPrint,
    onTestDrawer,
    onRefreshPrinters,
    refreshingPrinters = false
}) {
    const effectiveCountry = business?.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const taxIdLabel = getTaxIdLabel(effectiveCountry);
    const isUsdOnly = isDollarCountry || isUsdOnlyMode({ country: effectiveCountry, ...business });

    // Impresora asignada localmente a este equipo (Laptop 1 o Laptop 2)
    const [stationPrinter, setStationPrinter] = useState('');
    const [isManualInput, setIsManualInput] = useState(false);
    const [testingNetwork, setTestingNetwork] = useState(false);
    const [scanningNetwork, setScanningNetwork] = useState(false);
    const [discoveredPrinters, setDiscoveredPrinters] = useState([]);
    const [testingCluster, setTestingCluster] = useState(false);
    const [clusterReport, setClusterReport] = useState(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);

    useEffect(() => {
        const localPrinter = localStorage.getItem('pos_station_printer');
        if (localPrinter) {
            setStationPrinter(localPrinter);
        } else if (business.printerName) {
            setStationPrinter(business.printerName);
        }
    }, [business.printerName]);

    const handleStationPrinterChange = (e) => {
        const val = e.target.value;
        setStationPrinter(val);
        localStorage.setItem('pos_station_printer', val);
        setBusiness(prev => ({ ...prev, printerName: val }));
    };

    // Auto-Discovery: Escanear subred en busca de impresoras con puerto 9100 abierto
    const handleScanNetworkPrinters = async () => {
        setScanningNetwork(true);
        setDiscoveredPrinters([]);
        const toastId = toast.loading('Escaneando red local en busca de impresoras térmicas (Puerto 9100)...');

        try {
            const res = await api.get('/settings/scan-network-printers');
            const found = res.data?.printers || [];
            setDiscoveredPrinters(found);

            if (found.length > 0) {
                toast.success(`¡Se encontraron ${found.length} impresora(s) en la red!`, { id: toastId });
            } else {
                toast.error('No se detectaron impresoras en el puerto 9100. Verifica que esté encendida y conectada al router.', { id: toastId });
            }
        } catch (err) {
            console.error('Scan error:', err);
            toast.error('Error al escanear la red local.', { id: toastId });
        } finally {
            setScanningNetwork(false);
        }
    };

    const handleSelectDiscoveredPrinter = (ip, port = 9100) => {
        setBusiness(prev => ({
            ...prev,
            networkPrinterIp: ip,
            networkPrinterPort: port,
            networkPrinterEnabled: true
        }));
        toast.success(`Impresora de red vinculada a ${ip}:${port}`);
    };

    // Prueba de conexión directa a la 3ra impresora IP
    const handleTestNetworkPrinter = async () => {
        if (!business.networkPrinterIp) {
            return toast.error('Ingrese la dirección IP de la impresora de red');
        }

        setTestingNetwork(true);
        const toastId = toast.loading(`Conectando con ${business.networkPrinterIp}:${business.networkPrinterPort || 9100}...`);

        try {
            const res = await api.post('/settings/test-network-printer', {
                host: business.networkPrinterIp,
                port: business.networkPrinterPort || 9100
            });

            toast.success(res.data?.message || '¡Prueba enviada a la impresora de red con éxito!', { id: toastId });
        } catch (err) {
            console.error('Error testing network printer:', err);
            const msg = err.response?.data?.error || err.message || 'Fallo de conexión';
            toast.error(`Error: ${msg}`, { id: toastId });
        } finally {
            setTestingNetwork(false);
        }
    };

    // Diagnóstico Integral Simultáneo (Test de las 3 a la vez)
    const handleTestCluster = async () => {
        setTestingCluster(true);
        setClusterReport(null);
        const toastId = toast.loading('Disparando pulso de diagnóstico integral a las 3 impresoras...');

        try {
            // 1. Probar la impresora local inmediatamente si existe
            if (onTestPrint) {
                onTestPrint();
            }

            // 2. Disparar evento a la red (Laptop 2 e Impresora de Red)
            const res = await api.post('/settings/test-cluster-printers', {
                networkHost: business.networkPrinterEnabled ? business.networkPrinterIp : null,
                networkPort: business.networkPrinterPort || 9100
            });

            const netRes = res.data?.networkResult;
            setClusterReport({
                local: { ok: true, name: stationPrinter || 'Predeterminada de Windows' },
                replicaLan: { ok: true, note: 'Pulso emitido por WebSocket P2P' },
                network: {
                    configured: Boolean(business.networkPrinterEnabled && business.networkPrinterIp),
                    ok: netRes?.success || false,
                    error: netRes?.error || null,
                    ip: business.networkPrinterIp
                }
            });

            toast.success('¡Test simultáneo enviado con éxito a todo el clúster!', { id: toastId });
        } catch (err) {
            console.error('Cluster test error:', err);
            toast.error('Error al emitir prueba simultánea.', { id: toastId });
        } finally {
            setTestingCluster(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header de Control Limpio y Adaptativo */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/30">
                        <Printer size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Impresión & Periféricos
                            </h2>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40 flex items-center gap-1.5">
                                <Activity size={12} className="text-blue-500" />
                                {business.broadcastPrintingEnabled === true ? 'Clúster Multicaja Activo' : 'Modo Directo'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Gestión de tickets: USB local, réplica LAN multicaja e impresora Ethernet / Wi-Fi
                        </p>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap items-center gap-2">
                    {onTestPrint && (
                        <button
                            type="button"
                            onClick={onTestPrint}
                            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                            title="Imprimir ticket de prueba en la impresora USB de este equipo"
                        >
                            <Printer size={14} className="text-blue-500" />
                            <span>Probar USB</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowPreviewModal(true)}
                        className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                        title="Ver cómo queda el ticket físico"
                    >
                        <Eye size={14} className="text-slate-500 dark:text-slate-400" />
                        <span>Vista Previa</span>
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        <span>Guardar</span>
                    </button>
                </div>
            </div>

            {/* Formulario en 2 Columnas */}
            <form onSubmit={onSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Columna Izquierda: Hardware Local (7 de 12) */}
                <div className="lg:col-span-7 space-y-6">
                    
                    {/* 1. SELECCIÓN DE IMPRESORA USB LOCAL */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center border border-blue-100 dark:border-blue-900/30 shrink-0">
                                    <Laptop size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        Impresora de Tickets Local (USB)
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Dispositivo físico conectado a esta computadora
                                    </p>
                                </div>
                            </div>

                            {stationPrinter ? (
                                <span className="text-xs font-mono font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 rounded-lg flex items-center gap-1.5">
                                    <CheckCircle2 size={13} />
                                    {stationPrinter}
                                </span>
                            ) : (
                                <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 rounded-lg">
                                    Predeterminada
                                </span>
                            )}
                        </div>

                        {/* Selector de Impresora */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Dispositivo de Impresión Asignado
                                </label>
                                <div className="flex items-center gap-3">
                                    {onRefreshPrinters && (
                                        <button
                                            type="button"
                                            onClick={onRefreshPrinters}
                                            disabled={refreshingPrinters}
                                            className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                                            title="Volver a escanear impresoras en Windows"
                                        >
                                            <RefreshCw size={12} className={refreshingPrinters ? "animate-spin" : ""} />
                                            <span>{refreshingPrinters ? 'Buscando...' : 'Escanear Windows'}</span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIsManualInput(!isManualInput)}
                                        className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                    >
                                        <span>{isManualInput ? 'Seleccionar de lista' : 'Entrada manual'}</span>
                                    </button>
                                </div>
                            </div>

                            {isManualInput ? (
                                <div className="space-y-1.5">
                                    <input
                                        type="text"
                                        value={stationPrinter}
                                        onChange={handleStationPrinterChange}
                                        placeholder="Ej: POS-80, EPSON TM-T20, Generic / Text Only"
                                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20"
                                    />
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Escribe el nombre exacto de la impresora tal como aparece en Dispositivos e Impresoras de Windows.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <select
                                        value={stationPrinter}
                                        onChange={handleStationPrinterChange}
                                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 cursor-pointer"
                                    >
                                        <option value="">-- Usar predeterminada de Windows --</option>
                                        {stationPrinter && !systemPrinters.some(p => p.name?.toLowerCase() === stationPrinter.toLowerCase()) && (
                                            <option value={stationPrinter}>
                                                {stationPrinter} (Guardada actualmente)
                                            </option>
                                        )}
                                        {Array.isArray(systemPrinters) && systemPrinters.map((p, i) => (
                                            <option key={i} value={p.name}>
                                                {p.name} {p.isDefault ? '• (Predeterminada)' : ''} {p.portName ? `[${p.portName}]` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                        <span>
                                            {systemPrinters.length > 0 
                                                ? `✓ ${systemPrinters.length} impresora(s) detectada(s) en Windows`
                                                : 'Buscando impresoras de Windows...'}
                                        </span>
                                        {systemPrinters.length === 0 && onRefreshPrinters && (
                                            <button
                                                type="button"
                                                onClick={onRefreshPrinters}
                                                className="text-primary-600 dark:text-primary-400 hover:underline"
                                            >
                                                Actualizar lista
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Fila: Ancho de Bobina y Motor de Impresión */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            {/* Ancho de Bobina */}
                            <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Ancho de Bobina Térmica
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: '80mm', label: '80mm', desc: 'Estándar (48 col)' },
                                        { id: '58mm', label: '58mm', desc: 'Mini (32 col)' }
                                    ].map(fmt => (
                                        <button
                                            key={fmt.id}
                                            type="button"
                                            onClick={() => setBusiness({ ...business, receiptWidth: fmt.id })}
                                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                                (business.receiptWidth || '80mm') === fmt.id
                                                    ? 'bg-primary-50 text-primary-900 border-primary-500 dark:bg-primary-950/40 dark:text-primary-200 dark:border-primary-500 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                                            }`}
                                        >
                                            <div className="text-xs font-bold">{fmt.label}</div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{fmt.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Motor de Impresión */}
                            <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Modo de Salida Local
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'RAW', label: 'RAW Nativo', desc: 'ESC/POS rápido' },
                                        { id: 'HTML', label: 'Gráfico HTML', desc: 'Renderizado web' }
                                    ].map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => setBusiness({ ...business, printMode: m.id })}
                                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                                (business.printMode || 'RAW') === m.id
                                                    ? 'bg-primary-50 text-primary-900 border-primary-500 dark:bg-primary-950/40 dark:text-primary-200 dark:border-primary-500 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                                            }`}
                                        >
                                            <div className="text-xs font-bold">{m.label}</div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{m.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Copias del Comprobante */}
                            <div className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Copias por Venta
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 1, label: '1 Copia', desc: 'Solo ticket cliente' },
                                        { id: 2, label: '2 Copias', desc: 'Cliente + Control de caja' }
                                    ].map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setBusiness({ ...business, receiptCopies: c.id })}
                                            className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                                (Number(business.receiptCopies) || 1) === c.id
                                                    ? 'bg-primary-50 text-primary-900 border-primary-500 dark:bg-primary-950/40 dark:text-primary-200 dark:border-primary-500 shadow-xs'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                                            }`}
                                        >
                                            <div className="text-xs font-bold">{c.label}</div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.desc}</div>
                                        </button>
                                    ))}
                                </div>
                                {Number(business.receiptCopies) === 2 && (
                                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                        ✓ La impresora emitirá consecutivamente el comprobante del cliente y la copia de control interno, cada uno con su propio corte de papel.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 2. GAVETA PORTAMONEDAS */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center border border-amber-100 dark:border-amber-900/30 shrink-0">
                                    <Coins size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        Gaveta de Dinero (Portamonedas)
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Apertura por pulso eléctrico RJ11 conectado a la impresora
                                    </p>
                                </div>
                            </div>

                            {onTestDrawer && (
                                <button
                                    type="button"
                                    onClick={onTestDrawer}
                                    className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
                                    title="Requiere PIN de Supervisor"
                                >
                                    <Lock size={13} className="text-amber-600 dark:text-amber-400" />
                                    <span>Abrir Gaveta</span>
                                </button>
                            )}
                        </div>

                        <div className="space-y-3">
                            {/* Toggle 1 */}
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
                                <div>
                                    <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                                        Apertura Automática al Cobrar
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Envía pulso a la impresora para abrir el cajón al finalizar la venta
                                    </span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={business.openDrawerOnPrint !== false}
                                        onChange={(e) => setBusiness({ ...business, openDrawerOnPrint: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>

                            {/* Toggle 2 */}
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
                                <div>
                                    <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                                        Abrir Solo con Efectivo o Vuelto
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Si el pago es 100% digital (Punto de Venta, Pago Móvil), no abrir la gaveta
                                    </span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={business.openDrawerOnlyCash !== false}
                                        onChange={(e) => setBusiness({ ...business, openDrawerOnlyCash: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>

                            {/* Toggle 3 */}
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
                                <div>
                                    <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                                        Restringir Botón Manual a Cajeros
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Exigir PIN de supervisor para abrir la gaveta manualmente con F9
                                    </span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={business.requireSupervisorForDrawer !== false}
                                        onChange={(e) => setBusiness({ ...business, requireSupervisorForDrawer: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* 3. PERSONALIZACIÓN DEL TICKET */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center border border-emerald-100 dark:border-emerald-900/30 shrink-0">
                                    <Receipt size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        Textos del Comprobante
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Encabezado y pie de recibo impreso
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowPreviewModal(true)}
                                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
                            >
                                <Eye size={13} className="text-emerald-600 dark:text-emerald-400" />
                                <span>Ver Recibo</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Encabezado del Ticket
                                </label>
                                <input
                                    type="text"
                                    value={business.receiptHeader || ''}
                                    onChange={(e) => setBusiness({ ...business, receiptHeader: e.target.value })}
                                    placeholder="¡Bienvenidos a nuestro local!"
                                    className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Pie de Recibo (Despedida)
                                </label>
                                <input
                                    type="text"
                                    value={business.receiptFooter || ''}
                                    onChange={(e) => setBusiness({ ...business, receiptFooter: e.target.value })}
                                    placeholder="¡Gracias por su compra! Vuelva pronto"
                                    className="w-full px-3.5 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                                />
                            </div>
                        </div>

                        {/* Toggle: Factura Solo en Bs */}
                        {!isUsdOnly && (
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4 mt-2">
                                <div>
                                    <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                                        Ticket Solo en Bolívares (Ocultar Tasa y USD)
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Solo imprime importes en Bs, omitiendo referencias a divisas
                                    </span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(business.receiptOnlyBs)}
                                        onChange={(e) => {
                                            setBusiness({ ...business, receiptOnlyBs: e.target.checked });
                                            localStorage.setItem('pos_receipt_only_bs', String(e.target.checked));
                                        }}
                                        className="sr-only peer"
                                    />
                                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>
                        )}
                    </div>

                    {/* 4. AUDITORÍA DE MERCANCÍA EN CORTE Z */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center border border-purple-100 dark:border-purple-900/30 shrink-0">
                                    <Layers size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        Auditoría de Mercancía en Corte Z
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Resumen de productos vendidos y existencias en inventario al cerrar caja
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {/* Toggle 1: Activar/Desactivar */}
                            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4">
                                <div>
                                    <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                                        Incluir Mercancía y Stock en Corte Z
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Imprime cuántas unidades/cartones/cajas se vendieron y cuántas quedan en inventario
                                    </span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={business.includeItemsInZReport !== false}
                                        onChange={(e) => setBusiness({ ...business, includeItemsInZReport: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                                </label>
                            </div>

                            {/* Selector de Modo de Impresión si está activo */}
                            {business.includeItemsInZReport !== false && (
                                <div className="space-y-1.5 pt-1">
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Modo de Impresión de Mercancía
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {[
                                            { id: 'INTEGRATED', label: 'Mismo Ticket Z', desc: 'Tira continua al final del Z' },
                                            { id: 'SEPARATE', label: 'Ticket Anexo', desc: 'Tira separada con su propio corte' },
                                            { id: 'DISABLED', label: 'Solo en Pantalla', desc: 'No imprimir en papel térmico' }
                                        ].map(opt => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => setBusiness({ ...business, zReportItemsPrintMode: opt.id })}
                                                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                                    (business.zReportItemsPrintMode || 'INTEGRATED') === opt.id
                                                        ? 'bg-purple-50 text-purple-900 border-purple-500 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-500 shadow-xs'
                                                        : 'bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                                                }`}
                                            >
                                                <div className="text-xs font-bold">{opt.label}</div>
                                                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{opt.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                {/* Columna Derecha: Red Local & Multicaja (5 de 12) */}
                <div className="lg:col-span-5 space-y-6">

                    {/* 1. TOPOLOGÍA DEL NEGOCIO */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="w-9 h-9 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center border border-indigo-100 dark:border-indigo-900/30 shrink-0">
                                <Network size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                    Topología de Impresión
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Rutas de emisión hacia las estaciones
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2.5">
                            {/* Nodo 1 */}
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                                        <Laptop size={14} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-800 dark:text-white">Caja Local (Esta PC)</div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[160px]">
                                            {stationPrinter || 'Predeterminada'}
                                        </div>
                                    </div>
                                </div>
                                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-2 py-0.5 rounded-md">
                                    Conectada
                                </span>
                            </div>

                            {/* Nodo 2 */}
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                                        <ArrowRightLeft size={14} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-800 dark:text-white">Caja 2 (LAN P2P)</div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                            WebSocket (~15ms)
                                        </div>
                                    </div>
                                </div>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                    business.broadcastPrintingEnabled === true 
                                        ? 'text-indigo-700 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/50' 
                                        : 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                                }`}>
                                    {business.broadcastPrintingEnabled === true ? 'Activa' : 'Pausada'}
                                </span>
                            </div>

                            {/* Nodo 3 */}
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-7 h-7 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                                        <Server size={14} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-800 dark:text-white">3ra Impresora (Red)</div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[160px]">
                                            {business.networkPrinterEnabled && business.networkPrinterIp ? `${business.networkPrinterIp}:9100` : 'Sin configurar'}
                                        </div>
                                    </div>
                                </div>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                    business.networkPrinterEnabled && business.networkPrinterIp 
                                        ? 'text-cyan-700 bg-cyan-50 dark:text-cyan-400 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800/50' 
                                        : 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                                }`}>
                                    {business.networkPrinterEnabled && business.networkPrinterIp ? 'TCP 9100' : 'Inactiva'}
                                </span>
                            </div>
                        </div>

                        {/* Switch de Réplica Multicaja */}
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div>
                                <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                                    Réplica Automática Multicaja
                                </span>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Imprime simultáneamente en ambas laptops al vender
                                </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                                <input
                                    type="checkbox"
                                    checked={business.broadcastPrintingEnabled === true}
                                    onChange={(e) => {
                                        const enabled = e.target.checked;
                                        setBusiness({ ...business, broadcastPrintingEnabled: enabled });
                                        localStorage.setItem('pos_broadcast_print_enabled', String(enabled));
                                    }}
                                    className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                            </label>
                        </div>
                    </div>

                    {/* 2. 3RA IMPRESORA DE RED (ETHERNET / WI-FI) */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400 rounded-xl flex items-center justify-center border border-cyan-100 dark:border-cyan-900/30 shrink-0">
                                    <Server size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                        Impresora de Red Ethernet
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Conectada directo al router por cable o Wi-Fi
                                    </p>
                                </div>
                            </div>

                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                <input
                                    type="checkbox"
                                    checked={business.networkPrinterEnabled === true}
                                    onChange={(e) => setBusiness({ ...business, networkPrinterEnabled: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                            </label>
                        </div>

                        {/* Auto-Discovery Bar */}
                        <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                                <Search size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
                                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    Búsqueda en red LAN
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={handleScanNetworkPrinters}
                                disabled={scanningNetwork}
                                className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                            >
                                {scanningNetwork ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
                                <span>{scanningNetwork ? 'Escaneando...' : 'Escanear'}</span>
                            </button>
                        </div>

                        {/* Discovered Printers list */}
                        {discoveredPrinters.length > 0 && (
                            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 space-y-2">
                                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 block">
                                    Impresoras encontradas (clic para asignar):
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {discoveredPrinters.map((p, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => handleSelectDiscoveredPrinter(p.ip, p.port)}
                                            className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-medium flex items-center gap-1.5 hover:bg-emerald-100 transition-colors cursor-pointer"
                                        >
                                            <Server size={12} />
                                            <span>{p.ip}:{p.port}</span>
                                            <span className="text-[10px] opacity-75">({p.latencyMs}ms)</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2 space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    IP en la Red (LAN)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej: 192.168.1.100"
                                    value={business.networkPrinterIp || ''}
                                    onChange={(e) => setBusiness({ ...business, networkPrinterIp: e.target.value.trim() })}
                                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Puerto RAW
                                </label>
                                <input
                                    type="number"
                                    placeholder="9100"
                                    value={business.networkPrinterPort || '9100'}
                                    onChange={(e) => setBusiness({ ...business, networkPrinterPort: e.target.value })}
                                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-medium text-slate-900 dark:text-white focus:outline-none focus:border-primary-500"
                                />
                            </div>
                        </div>

                        {/* Roles de la 3ra impresora */}
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Rol de Impresión
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { id: 'MIRROR', title: 'Espejo', desc: 'Copia idéntica' },
                                    { id: 'DISPATCH', title: 'Despacho', desc: 'Sin montos' },
                                    { id: 'KITCHEN', title: 'Comanda', desc: 'Solo pedidos' }
                                ].map(role => (
                                    <button
                                        key={role.id}
                                        type="button"
                                        onClick={() => setBusiness({ ...business, networkPrinterRole: role.id })}
                                        className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                                            (business.networkPrinterRole || 'MIRROR') === role.id
                                                ? 'bg-primary-50 text-primary-900 border-primary-500 dark:bg-primary-950/40 dark:text-primary-200 dark:border-primary-500 shadow-xs'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                                        }`}
                                    >
                                        <div className="text-xs font-bold">{role.title}</div>
                                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{role.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Botón Test Red */}
                        <button
                            type="button"
                            onClick={handleTestNetworkPrinter}
                            disabled={testingNetwork || !business.networkPrinterIp}
                            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40"
                        >
                            {testingNetwork ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                            <span>Probar Conexión TCP (Puerto 9100)</span>
                        </button>
                    </div>

                    {/* 3. DIAGNÓSTICO INTEGRAL DE CLÚSTER */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Zap size={16} className="text-amber-500" />
                                <span className="text-xs font-bold text-slate-900 dark:text-white">
                                    Diagnóstico Sincronizado
                                </span>
                            </div>

                            <button
                                type="button"
                                onClick={handleTestCluster}
                                disabled={testingCluster}
                                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {testingCluster ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                                <span>Test Simultáneo</span>
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            Envía un pulso de prueba conjunto para validar simultáneamente la Impresora 1 (USB), Impresora 2 (LAN) y la 3ra Impresora (Red).
                        </p>

                        {clusterReport && (
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs font-mono">
                                <div className="flex justify-between">
                                    <span className="text-slate-500 dark:text-slate-400">USB Local:</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Enviado al Spooler</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500 dark:text-slate-400">Caja 2 (LAN P2P):</span>
                                    <span className="text-indigo-600 dark:text-indigo-400 font-semibold">✓ Pulso emitido</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500 dark:text-slate-400">3ra Impresora:</span>
                                    <span className={`font-semibold ${clusterReport.network?.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                        {clusterReport.network?.configured ? (clusterReport.network?.ok ? '✓ Conexión OK' : '✕ Error de red') : 'Sin configurar'}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </form>

            {/* Modal de Simulación de Ticket */}
            {showPreviewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-xl relative">
                        <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2 text-slate-900 dark:text-white text-sm font-bold">
                                <FileText size={18} className="text-primary-600 dark:text-primary-400" />
                                <span>Vista Previa del Ticket Físico</span>
                            </div>
                            <button
                                onClick={() => setShowPreviewModal(false)}
                                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Bobina Virtual Realista */}
                        <div className="flex justify-center p-4 bg-slate-100 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 overflow-y-auto max-h-[60vh]">
                            <div 
                                className="bg-white text-black p-5 font-mono text-xs shadow-md border-t-4 border-dashed border-slate-400"
                                style={{ width: (business.receiptWidth || '80mm') === '58mm' ? '230px' : '300px' }}
                            >
                                <div className="text-center font-bold text-sm uppercase mb-1">
                                    {business.name || 'INVERSIONES ISAAC POS C.A.'}
                                </div>
                                <div className="text-center text-[10px] text-slate-600">
                                    {taxIdLabel}: {business.rif || (taxIdLabel === 'RUC' ? '1790012345001' : 'J-50123456-7')}
                                </div>
                                <div className="text-center text-[10px] text-slate-600">
                                    {business.address || 'Av. Principal Local #14'}
                                </div>
                                <div className="text-center text-[10px] text-slate-600 mb-2">
                                    Tel: {business.phone || '+58 412-1234567'}
                                </div>
                                {business.receiptHeader && (
                                    <div className="text-center text-[10px] font-bold border-y border-dashed border-black py-1 my-1">
                                        {business.receiptHeader}
                                    </div>
                                )}
                                <div className="text-left text-[10px] my-2">
                                    <div>COMPROBANTE: #FAC-000124</div>
                                    <div>FECHA: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    <div>CLIENTE: CLIENTE OCASIONAL</div>
                                </div>
                                <div className="border-b border-dashed border-black my-1"></div>
                                <div className="space-y-1 my-2 text-[10px]">
                                    <div className="flex justify-between">
                                        <span>2x Aceite Motor 20W50</span>
                                        <span>$17.00</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>1x Filtro Aceite</span>
                                        <span>$4.00</span>
                                    </div>
                                </div>
                                <div className="border-t border-dashed border-black my-1"></div>
                                <div className="flex justify-between font-bold text-sm my-1">
                                    <span>{isUsdOnly ? 'TOTAL:' : 'TOTAL USD:'}</span>
                                    <span>$21.00</span>
                                </div>
                                {!isUsdOnly && (
                                    <>
                                        <div className="flex justify-between text-[11px]">
                                            <span>TOTAL BS:</span>
                                            <span>Bs. 766.50</span>
                                        </div>
                                        <div className="text-[9px] text-slate-500 text-right mb-2">Tasa BCV: 36.50</div>
                                    </>
                                )}
                                <div className="border-t border-dashed border-black my-2"></div>
                                <div className="text-center text-[10px] font-bold mt-2">
                                    {business.receiptFooter || '¡GRACIAS POR SU COMPRA!'}
                                </div>
                                <div className="text-center text-[8px] text-slate-500 mt-1">
                                    [ BOBINA {(business.receiptWidth || '80mm').toUpperCase()} - ROL: {business.networkPrinterRole || 'ESPEJO'} ]
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span>Formato: <strong className="text-slate-900 dark:text-white font-mono">{business.receiptWidth || '80mm'}</strong></span>
                            <button
                                onClick={() => setBusiness({ ...business, receiptWidth: (business.receiptWidth || '80mm') === '80mm' ? '58mm' : '80mm' })}
                                className="text-primary-600 dark:text-primary-400 hover:underline font-medium cursor-pointer"
                            >
                                Cambiar a {(business.receiptWidth || '80mm') === '80mm' ? '58mm' : '80mm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
