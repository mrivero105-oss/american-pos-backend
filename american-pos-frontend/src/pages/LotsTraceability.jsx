import { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { 
    Clock, AlertTriangle, ShieldAlert, CheckCircle2, Search, 
    RefreshCcw, Download, Plus, Tag, History, Trash2, Edit3, 
    Layers, Calendar, DollarSign, Package, AlertCircle, ArrowUpRight,
    X, ChevronRight, FileText, Check, ShieldCheck, Barcode, RotateCcw,
    ScanLine, Loader2
} from 'lucide-react';
import api from '../services/api';
import { usePos } from '../hooks/PosContext';
import { formatUSD, formatBs, formatStock, formatDate } from '../utils/format';

export default function LotsTraceability() {
    const { exchangeRate } = usePos();

    const [loading, setLoading] = useState(true);
    const [lotsData, setLotsData] = useState({ summary: {}, lots: [] });
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('all'); // 'all' | 'expired' | 'critical' | 'warning' | 'healthy'

    // Modales
    const [isLotModalOpen, setIsLotModalOpen] = useState(false);
    const [editingLot, setEditingLot] = useState(null);
    const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
    const [selectedPromoLot, setSelectedPromoLot] = useState(null);
    const [isWriteOffModalOpen, setIsWriteOffModalOpen] = useState(false);
    const [selectedWriteOffLot, setSelectedWriteOffLot] = useState(null);
    const [isTraceabilityModalOpen, setIsTraceabilityModalOpen] = useState(false);
    const [traceabilityData, setTraceabilityData] = useState(null);
    const [loadingTrace, setLoadingTrace] = useState(false);

    // Listas auxiliares para formulario de lote
    const [productsList, setProductsList] = useState([]);
    const [suppliersList, setSuppliersList] = useState([]);
    const [searchingProducts, setSearchingProducts] = useState(false);

    // Cargar datos del dashboard
    const fetchDashboard = async (tab = activeTab, search = searchQuery) => {
        try {
            setLoading(true);
            const res = await api.get('/lots/dashboard', {
                params: {
                    status: tab,
                    search: search.trim()
                }
            });
            if (res.data?.success) {
                setLotsData({
                    summary: res.data.summary || {},
                    lots: res.data.lots || []
                });
            }
        } catch (err) {
            console.error('Error cargando lotes:', err);
            toast.error(err.response?.data?.error || 'No se pudo cargar el control de lotes');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboard(activeTab, searchQuery);
    }, [activeTab]);

    // Buscador interactivo de productos para modal de lote
    const [productSearchInput, setProductSearchInput] = useState('');
    const [selectedProductObj, setSelectedProductObj] = useState(null);
    const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
    const lotNumberInputRef = useRef(null);
    const productSearchInputRef = useRef(null);

    // Búsqueda dinámica de productos (por nombre, código de barra o categoría)
    const searchCatalogProducts = async (term = '') => {
        try {
            setSearchingProducts(true);
            const res = await api.get('/products', {
                params: {
                    search: term.trim(),
                    limit: 40
                }
            });
            const list = res.data?.products || (Array.isArray(res.data) ? res.data : []);
            setProductsList(list);
            return list;
        } catch (e) {
            console.warn('Error buscando productos:', e);
            return [];
        } finally {
            setSearchingProducts(false);
        }
    };

    // Debounce para búsqueda interactiva de productos en modal
    useEffect(() => {
        if (!isLotModalOpen || selectedProductObj) return;
        const timer = setTimeout(() => {
            searchCatalogProducts(productSearchInput);
        }, 200);
        return () => clearTimeout(timer);
    }, [productSearchInput, isLotModalOpen, selectedProductObj]);

    // Debounce para búsqueda en tabla principal
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchDashboard(activeTab, searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Cargar proveedores
    const loadSuppliers = async () => {
        try {
            const suppRes = await api.get('/suppliers');
            setSuppliersList(suppRes.data?.suppliers || (Array.isArray(suppRes.data) ? suppRes.data : []));
        } catch (e) {
            console.warn('Error loading suppliers:', e);
        }
    };

    // Formulario de Lote
    const [lotForm, setLotForm] = useState({
        id: '',
        productId: '',
        lotNumber: '',
        quantity: '',
        expirationDate: '',
        cost: '',
        supplierId: ''
    });
    const [savingLot, setSavingLot] = useState(false);

    const handleSelectProduct = (product) => {
        setSelectedProductObj(product);
        setProductSearchInput(product.name);
        setIsProductDropdownOpen(false);
        setLotForm(prev => ({
            ...prev,
            productId: product.id,
            cost: (prev.cost !== '' && Number(prev.cost) > 0) ? prev.cost : (product.cost || 0),
            supplierId: prev.supplierId || product.supplierId || ''
        }));
        setTimeout(() => lotNumberInputRef.current?.focus(), 100);
    };

    const handleProductSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const clean = productSearchInput.trim().toLowerCase();
            if (!clean) return;

            // 1. Coincidencia exacta por código de barra (pistola de escaneo)
            const exactBarcodeMatch = productsList.find(p => (p.barcode || '').toLowerCase() === clean);
            if (exactBarcodeMatch) {
                handleSelectProduct(exactBarcodeMatch);
                return;
            }

            // 2. Si hay al menos un resultado filtrado, seleccionar el primero
            if (productsList.length > 0) {
                handleSelectProduct(productsList[0]);
            }
        } else if (e.key === 'Escape') {
            setIsProductDropdownOpen(false);
        }
    };

    const handleOpenLotModal = async (lot = null) => {
        loadSuppliers();
        if (lot) {
            setEditingLot(lot);
            setSelectedProductObj(lot.product ? {
                id: lot.product.id,
                name: lot.product.name,
                barcode: lot.product.barcode || lot.product.code,
                category: lot.product.category,
                cost: lot.cost || lot.product.cost,
                stockQuantity: lot.product.stock,
                imageUri: lot.product.image
            } : null);
            setProductSearchInput(lot.product?.name || '');
            setIsProductDropdownOpen(false);
            setLotForm({
                id: lot.id,
                productId: lot.product?.id || '',
                lotNumber: lot.lotNumber || '',
                quantity: lot.quantity || 0,
                expirationDate: lot.expirationDate || '',
                cost: lot.cost || 0,
                supplierId: lot.supplier?.id || ''
            });
        } else {
            setEditingLot(null);
            setSelectedProductObj(null);
            setProductSearchInput('');
            setIsProductDropdownOpen(true);
            searchCatalogProducts('');
            setLotForm({
                id: '',
                productId: '',
                lotNumber: '',
                quantity: '',
                expirationDate: '',
                cost: '',
                supplierId: ''
            });
            setTimeout(() => productSearchInputRef.current?.focus(), 150);
        }
        setIsLotModalOpen(true);
    };

    const handleSaveLot = async (e) => {
        e.preventDefault();
        if (!lotForm.productId) return toast.error('Selecciona un producto');
        if (!lotForm.lotNumber.trim()) return toast.error('Ingresa el número de lote');
        if (!lotForm.quantity || Number(lotForm.quantity) <= 0) return toast.error('Ingresa una cantidad válida');

        try {
            setSavingLot(true);
            if (editingLot) {
                await api.put(`/lots/${editingLot.id}`, lotForm);
                toast.success('Lote actualizado exitosamente');
            } else {
                await api.post('/lots', lotForm);
                toast.success('Lote registrado en el inventario');
            }
            setIsLotModalOpen(false);
            fetchDashboard();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al guardar el lote');
        } finally {
            setSavingLot(false);
        }
    };

    // Modal de Promoción Rápida
    const [promoForm, setPromoForm] = useState({ discountPercentage: 20, promoDays: 15 });
    const [savingPromo, setSavingPromo] = useState(false);

    const handleOpenPromoModal = (lot) => {
        setSelectedPromoLot(lot);
        setPromoForm({ discountPercentage: 20, promoDays: 15 });
        setIsPromoModalOpen(true);
    };

    const handleCreatePromo = async (e) => {
        e.preventDefault();
        if (!selectedPromoLot) return;
        try {
            setSavingPromo(true);
            const res = await api.post(`/lots/${selectedPromoLot.id}/send-to-promo`, promoForm);
            toast.success(res.data?.message || '¡Promoción de liquidación creada!');
            setIsPromoModalOpen(false);
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al crear la promoción');
        } finally {
            setSavingPromo(false);
        }
    };

    // Modal de Baja por Merma / Caducidad
    const [writeOffForm, setWriteOffForm] = useState({ reason: 'Caducidad vencida', notes: '', quantity: '' });
    const [savingWriteOff, setSavingWriteOff] = useState(false);

    const handleOpenWriteOffModal = (lot) => {
        setSelectedWriteOffLot(lot);
        setWriteOffForm({
            reason: 'Caducidad vencida',
            notes: '',
            quantity: lot.quantity
        });
        setIsWriteOffModalOpen(true);
    };

    const handleWriteOff = async (e) => {
        e.preventDefault();
        if (!selectedWriteOffLot) return;
        try {
            setSavingWriteOff(true);
            const res = await api.post(`/lots/${selectedWriteOffLot.id}/write-off`, writeOffForm);
            toast.success(res.data?.message || 'Baja de lote procesada correctamente');
            setIsWriteOffModalOpen(false);
            fetchDashboard();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al dar de baja el lote');
        } finally {
            setSavingWriteOff(false);
        }
    };

    // Modal de Trazabilidad
    const handleOpenTraceability = async (lot) => {
        try {
            setLoadingTrace(true);
            setIsTraceabilityModalOpen(true);
            const res = await api.get(`/lots/${lot.id}/traceability`);
            if (res.data?.success) {
                setTraceabilityData(res.data);
            }
        } catch (err) {
            toast.error('Error al consultar trazabilidad');
            setIsTraceabilityModalOpen(false);
        } finally {
            setLoadingTrace(false);
        }
    };

    // Exportar CSV
    const handleExportCSV = () => {
        if (!lotsData.lots.length) return toast.error('No hay lotes para exportar');
        const headers = ['Producto', 'Codigo', 'Lote', 'Vencimiento', 'Dias_Restantes', 'Estado', 'Stock', 'Costo_Unitario', 'Costo_Total_Riesgo', 'Proveedor'];
        const rows = lotsData.lots.map(l => [
            `"${(l.product?.name || '').replace(/"/g, '""')}"`,
            `"${l.product?.code || l.product?.barcode || ''}"`,
            `"${l.lotNumber}"`,
            `"${l.expirationDate || 'N/A'}"`,
            l.daysRemaining,
            `"${l.healthCategory}"`,
            l.quantity,
            l.cost,
            l.totalCost,
            `"${(l.supplier?.name || 'N/A').replace(/"/g, '""')}"`
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `auditoria_lotes_fefo_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success('Auditoría de lotes exportada');
    };

    const summary = lotsData.summary || {};

    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
            {/* Header Principal */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                            <Clock size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                                    Radar de Lotes, Caducidad & Trazabilidad FEFO
                                </h1>
                                <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                    Control Sanitario
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Priorización de salida por fecha de vencimiento (FEFO), auditoría de lotes y mitigación de mermas
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={handleExportCSV}
                        className="px-3.5 py-2 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    >
                        <Download size={14} className="text-slate-500" />
                        <span>Exportar CSV</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => fetchDashboard()}
                        disabled={loading}
                        className="px-3 py-2 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                        title="Refrescar lista"
                    >
                        <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>

                    <button
                        type="button"
                        onClick={() => handleOpenLotModal()}
                        className="px-3.5 py-2 min-h-[38px] rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    >
                        <Plus size={15} />
                        <span>Registrar Lote</span>
                    </button>
                </div>
            </div>

            {/* Tarjetas de Indicadores Ejecutivos (KPIs) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Vencidos */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs transition-all">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Pérdida por Vencidos
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                            <ShieldAlert size={16} />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
                            {formatUSD(summary.expired?.capitalRisk || 0)}
                        </div>
                        {exchangeRate > 1 && (
                            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                                {formatBs((summary.expired?.capitalRisk || 0) * exchangeRate)}
                            </div>
                        )}
                        <p className="text-[11px] text-rose-600/90 dark:text-rose-400/80 font-medium mt-1.5">
                            {summary.expired?.count || 0} lote(s) caducados (bloqueados)
                        </p>
                    </div>
                </div>

                {/* 2. Críticos < 30 días */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs transition-all">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Riesgo Crítico (&lt; 30 Días)
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                            <AlertTriangle size={16} />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                            {formatUSD(summary.critical?.capitalRisk || 0)}
                        </div>
                        {exchangeRate > 1 && (
                            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                                {formatBs((summary.critical?.capitalRisk || 0) * exchangeRate)}
                            </div>
                        )}
                        <p className="text-[11px] text-amber-600/90 dark:text-amber-400/80 font-medium mt-1.5">
                            {summary.critical?.count || 0} lote(s) próximos a vencer
                        </p>
                    </div>
                </div>

                {/* 3. Tramo Preventivo 31 a 60 días */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs transition-all">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Preventivos (31 - 60 Días)
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                            <Clock size={16} />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                            {formatUSD(summary.warning?.capitalRisk || 0)}
                        </div>
                        {exchangeRate > 1 && (
                            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                                {formatBs((summary.warning?.capitalRisk || 0) * exchangeRate)}
                            </div>
                        )}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1.5">
                            {summary.warning?.count || 0} lote(s) en ventana de promoción
                        </p>
                    </div>
                </div>

                {/* 4. Inventario Total en Lotes */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-xs transition-all">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Lotes Activos Totales
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                            <Layers size={16} />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                            {summary.totalActiveLots || 0} <span className="text-xs font-normal text-slate-500">lotes</span>
                        </div>
                        <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                            {formatStock(summary.totalUnits || 0)} unidades en almacén
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">
                            Valor total: {formatUSD(summary.totalCostValue || 0)}
                        </p>
                    </div>
                </div>
            </div>

            {/* Pestañas de Semáforo y Buscador */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-slate-800">
                {/* Tabs */}
                <div className="flex flex-wrap items-center gap-1">
                    {[
                        { id: 'all', label: 'Todos los Lotes', count: (lotsData.lots || []).length },
                        { id: 'expired', label: 'Vencidos', color: 'text-red-600', badgeBg: 'bg-red-500/15', count: summary.expired?.count || 0 },
                        { id: 'critical', label: 'Críticos (< 30d)', color: 'text-orange-600', badgeBg: 'bg-orange-500/15', count: summary.critical?.count || 0 },
                        { id: 'warning', label: 'Preventivos (31-60d)', color: 'text-amber-600', badgeBg: 'bg-amber-500/15', count: summary.warning?.count || 0 },
                        { id: 'healthy', label: 'Óptimos (> 60d)', color: 'text-emerald-600', badgeBg: 'bg-emerald-500/15', count: summary.healthy?.count || 0 }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                activeTab === tab.id
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            <span>{tab.label}</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                                activeTab === tab.id
                                    ? 'bg-white/20 dark:bg-slate-900/20 text-white dark:text-slate-900'
                                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                            }`}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Input Buscador */}
                <div className="relative w-full lg:w-80">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') fetchDashboard(activeTab, searchQuery); }}
                        placeholder="Buscar producto, código o lote..."
                        className="w-full pl-8 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Tabla de Lotes FEFO */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[750px]">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-3">Producto / Código</th>
                                <th className="px-4 py-3">Nro. Lote</th>
                                <th className="px-4 py-3">Vencimiento (FEFO)</th>
                                <th className="px-4 py-3">Existencias</th>
                                <th className="px-4 py-3">Costo / Valor Riesgo</th>
                                <th className="px-4 py-3">Proveedor</th>
                                <th className="px-4 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {lotsData.lots && lotsData.lots.length > 0 ? (
                                lotsData.lots.map((lot) => {
                                    const isExpired = lot.healthCategory === 'EXPIRED';
                                    const isCritical = lot.healthCategory === 'CRITICAL';
                                    const isWarning = lot.healthCategory === 'WARNING';

                                    let badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40';
                                    let badgeText = `Vence en ${lot.daysRemaining} días`;

                                    if (isExpired) {
                                        badgeColor = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/40';
                                        badgeText = `Vencido hace ${Math.abs(lot.daysRemaining)} días`;
                                    } else if (isCritical) {
                                        badgeColor = 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/40';
                                        badgeText = `¡Vence en ${lot.daysRemaining} días!`;
                                    } else if (isWarning) {
                                        badgeColor = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40';
                                        badgeText = `Vence en ${lot.daysRemaining} días`;
                                    }

                                    return (
                                        <tr key={lot.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                            {/* Producto */}
                                            <td className="px-4 py-3">
                                                <div className="font-semibold text-slate-900 dark:text-white">
                                                    {lot.product?.name || 'Producto sin nombre'}
                                                </div>
                                                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                                    {lot.product?.code || lot.product?.barcode || 'S/C'} • {lot.product?.category || 'General'}
                                                </div>
                                            </td>

                                            {/* Nro Lote */}
                                            <td className="px-4 py-3">
                                                <span className="font-mono font-bold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                                    {lot.lotNumber}
                                                </span>
                                            </td>

                                            {/* Vencimiento */}
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-slate-800 dark:text-slate-200">
                                                    {lot.expirationDate || 'Sin fecha'}
                                                </div>
                                                <div className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border mt-0.5 ${badgeColor}`}>
                                                    {badgeText}
                                                </div>
                                            </td>

                                            {/* Existencias */}
                                            <td className="px-4 py-3">
                                                <span className="font-extrabold text-slate-900 dark:text-white">
                                                    {formatStock(lot.quantity)}
                                                </span>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-1">
                                                    {lot.product?.stockUnit || 'UND'}
                                                </span>
                                            </td>

                                            {/* Costo / Valor Riesgo */}
                                            <td className="px-4 py-3 font-mono">
                                                <div className="font-bold text-slate-900 dark:text-white">
                                                    {formatUSD(lot.totalCost)}
                                                </div>
                                                <div className="text-[10px] text-slate-500">
                                                    c/u: {formatUSD(lot.cost)}
                                                </div>
                                            </td>

                                            {/* Proveedor */}
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                                {lot.supplier?.name || <span className="text-slate-400 italic">No especificado</span>}
                                            </td>

                                            {/* Acciones */}
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {/* Liquidar en Oferta */}
                                                    {!isExpired && lot.quantity > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenPromoModal(lot)}
                                                            className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 transition-colors cursor-pointer"
                                                            title="Crear oferta de liquidación rápida antes de vencer"
                                                        >
                                                            <Tag size={13} />
                                                        </button>
                                                    )}

                                                    {/* Trazabilidad */}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenTraceability(lot)}
                                                        className="p-1.5 rounded-lg border border-sky-200 dark:border-sky-800/40 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/40 text-sky-700 dark:text-sky-300 transition-colors cursor-pointer"
                                                        title="Ver trazabilidad y bitácora de salidas"
                                                    >
                                                        <History size={13} />
                                                    </button>

                                                    {/* Dar de Baja / Merma */}
                                                    {lot.quantity > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenWriteOffModal(lot)}
                                                            className="p-1.5 rounded-lg border border-red-200 dark:border-red-800/40 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                                                            title="Dar de baja por caducidad (Acta de merma)"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}

                                                    {/* Editar */}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenLotModal(lot)}
                                                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                                                        title="Editar lote"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan="7" className="px-4 py-8 text-center text-slate-400 text-xs">
                                        No se encontraron lotes registrados para el filtro seleccionado.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODAL: Registrar / Editar Lote */}
            {isLotModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
                                    <Package size={17} />
                                </div>
                                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                                    {editingLot ? 'Editar Lote' : 'Registrar Nuevo Lote'}
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsLotModalOpen(false)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveLot} className="p-4 sm:p-5 space-y-4 text-xs">
                            {/* Selector / Buscador Inteligente de Producto */}
                            <div>
                                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    Producto *
                                </label>

                                {selectedProductObj ? (
                                    /* Tarjeta de Producto Seleccionado */
                                    <div className="p-3 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0 overflow-hidden font-bold">
                                                {selectedProductObj.imageUri ? (
                                                    <img src={selectedProductObj.imageUri} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <Package size={20} />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-900 dark:text-white truncate text-xs">
                                                    {selectedProductObj.name}
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                    <span className="font-mono bg-slate-200 dark:bg-slate-800 px-1.5 py-0.2 rounded text-slate-700 dark:text-slate-300">
                                                        {selectedProductObj.barcode || 'Sin código'}
                                                    </span>
                                                    <span>•</span>
                                                    <span>Stock: <strong>{formatStock(selectedProductObj.stockQuantity ?? selectedProductObj.stock ?? 0)}</strong></span>
                                                    <span>•</span>
                                                    <span>Costo: <strong>${Number(selectedProductObj.cost || 0).toFixed(2)}</strong></span>
                                                </div>
                                            </div>
                                        </div>
                                        {!editingLot && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedProductObj(null);
                                                    setLotForm(prev => ({ ...prev, productId: '' }));
                                                    setProductSearchInput('');
                                                    setIsProductDropdownOpen(true);
                                                    searchCatalogProducts('');
                                                    setTimeout(() => productSearchInputRef.current?.focus(), 100);
                                                }}
                                                className="shrink-0 text-[11px] font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400 hover:underline px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-white dark:bg-slate-800 cursor-pointer"
                                            >
                                                Cambiar
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    /* Input de Búsqueda Interactiva con Auto-completado */
                                    <div className="relative">
                                        <div className="relative">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                ref={productSearchInputRef}
                                                type="text"
                                                value={productSearchInput}
                                                onChange={(e) => {
                                                    setProductSearchInput(e.target.value);
                                                    setIsProductDropdownOpen(true);
                                                }}
                                                onFocus={() => setIsProductDropdownOpen(true)}
                                                onKeyDown={handleProductSearchKeyDown}
                                                placeholder="Escribe nombre o escanea código de barras..."
                                                className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 font-medium"
                                            />
                                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-slate-400">
                                                {searchingProducts ? (
                                                    <Loader2 size={13} className="animate-spin text-amber-500" />
                                                ) : (
                                                    <Barcode size={15} className="text-slate-400" title="Soporta lector de código de barras" />
                                                )}
                                            </div>
                                        </div>

                                        {/* Dropdown flotante de resultados */}
                                        {isProductDropdownOpen && (
                                            <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-100 dark:divide-slate-800">
                                                {productsList.length > 0 ? (
                                                    productsList.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => handleSelectProduct(p)}
                                                            className="p-2.5 hover:bg-amber-500/10 dark:hover:bg-amber-500/15 cursor-pointer transition-colors flex items-center justify-between gap-2"
                                                        >
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-bold text-slate-900 dark:text-white truncate">
                                                                    {p.name}
                                                                </div>
                                                                <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded text-slate-600 dark:text-slate-300 font-semibold">
                                                                        {p.barcode || 'S/C'}
                                                                    </span>
                                                                    <span>•</span>
                                                                    <span className="truncate">{p.category || 'General'}</span>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 font-mono">
                                                                    ${Number(p.cost || 0).toFixed(2)}
                                                                </div>
                                                                <div className="text-[10px] text-slate-500">
                                                                    Stock: {formatStock(p.stockQuantity ?? p.stock ?? 0)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="p-4 text-center text-slate-400 text-xs">
                                                        {searchingProducts ? (
                                                            'Buscando en catálogo...'
                                                        ) : (
                                                            <>No se encontraron productos para <strong className="text-slate-600 dark:text-slate-200 font-mono">"{productSearchInput}"</strong></>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Lote y Vencimiento */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Número de Lote *
                                    </label>
                                    <input
                                        ref={lotNumberInputRef}
                                        type="text"
                                        value={lotForm.lotNumber}
                                        onChange={(e) => setLotForm(prev => ({ ...prev, lotNumber: e.target.value }))}
                                        placeholder="Ej: LOTE-2026-A"
                                        required
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono uppercase focus:outline-none focus:border-amber-500"
                                    />
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Fecha de Caducidad *
                                    </label>
                                    <input
                                        type="date"
                                        value={lotForm.expirationDate}
                                        onChange={(e) => setLotForm(prev => ({ ...prev, expirationDate: e.target.value }))}
                                        required
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                                    />
                                </div>
                            </div>

                            {/* Cantidad y Costo */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Cantidad en Lote *
                                    </label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={lotForm.quantity}
                                        onChange={(e) => setLotForm(prev => ({ ...prev, quantity: e.target.value }))}
                                        placeholder="0.00"
                                        required
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none focus:border-amber-500"
                                    />
                                </div>

                                <div>
                                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Costo Unitario ($)
                                    </label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={lotForm.cost}
                                        onChange={(e) => setLotForm(prev => ({ ...prev, cost: e.target.value }))}
                                        placeholder="0.00"
                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:outline-none focus:border-amber-500"
                                    />
                                </div>
                            </div>

                            {/* Proveedor */}
                            <div>
                                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    Proveedor Origen
                                </label>
                                <select
                                    value={lotForm.supplierId}
                                    onChange={(e) => setLotForm(prev => ({ ...prev, supplierId: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                                >
                                    <option value="">Sin proveedor asignado</option>
                                    {suppliersList.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsLotModalOpen(false)}
                                    className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingLot}
                                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50"
                                >
                                    {savingLot ? 'Guardando...' : 'Guardar Lote'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Crear Oferta Rápida de Liquidación */}
            {isPromoModalOpen && selectedPromoLot && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <Tag size={18} className="text-amber-600" />
                                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                                    Liquidar en Oferta Preventiva
                                </h3>
                            </div>
                            <button onClick={() => setIsPromoModalOpen(false)} className="text-slate-400">
                                <X size={16} />
                            </button>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            Crea una promoción temporal en el POS para <strong>{selectedPromoLot.product?.name}</strong> (Lote #{selectedPromoLot.lotNumber}) para acelerar la rotación antes del vencimiento ({selectedPromoLot.expirationDate}).
                        </p>

                        <form onSubmit={handleCreatePromo} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold mb-1">Porcentaje de Descuento (%)</label>
                                <input
                                    type="number"
                                    min="5"
                                    max="80"
                                    value={promoForm.discountPercentage}
                                    onChange={(e) => setPromoForm(prev => ({ ...prev, discountPercentage: e.target.value }))}
                                    required
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                                />
                            </div>

                            <div>
                                <label className="block font-semibold mb-1">Duración de la Campaña (Días)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={promoForm.promoDays}
                                    onChange={(e) => setPromoForm(prev => ({ ...prev, promoDays: e.target.value }))}
                                    required
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsPromoModalOpen(false)}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingPromo}
                                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold"
                                >
                                    {savingPromo ? 'Activando...' : 'Activar Promoción en POS'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Dar de Baja por Caducidad / Merma */}
            {isWriteOffModalOpen && selectedWriteOffLot && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <ShieldAlert size={18} className="text-red-600" />
                                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                                    Baja de Lote por Caducidad (Merma)
                                </h3>
                            </div>
                            <button onClick={() => setIsWriteOffModalOpen(false)} className="text-slate-400">
                                <X size={16} />
                            </button>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            Esta acción descontará el stock de <strong>{selectedWriteOffLot.product?.name}</strong> y registrará la merma contable bajo el lote <strong>#{selectedWriteOffLot.lotNumber}</strong>.
                        </p>

                        <form onSubmit={handleWriteOff} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold mb-1">Cantidad a dar de baja</label>
                                <input
                                    type="number"
                                    step="any"
                                    max={selectedWriteOffLot.quantity}
                                    value={writeOffForm.quantity}
                                    onChange={(e) => setWriteOffForm(prev => ({ ...prev, quantity: e.target.value }))}
                                    required
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                                />
                                <span className="text-[10px] text-slate-500">
                                    Disponible en lote: {selectedWriteOffLot.quantity} {selectedWriteOffLot.product?.stockUnit || 'UND'}
                                </span>
                            </div>

                            <div>
                                <label className="block font-semibold mb-1">Motivo / Causa</label>
                                <select
                                    value={writeOffForm.reason}
                                    onChange={(e) => setWriteOffForm(prev => ({ ...prev, reason: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                                >
                                    <option value="Caducidad vencida">Caducidad vencida</option>
                                    <option value="Deterioro / Empaque roto">Deterioro / Empaque roto</option>
                                    <option value="Retiro sanitario de laboratorio">Retiro sanitario de laboratorio</option>
                                    <option value="Merma por almacenamiento">Merma por almacenamiento</option>
                                </select>
                            </div>

                            <div>
                                <label className="block font-semibold mb-1">Observaciones / Justificación</label>
                                <textarea
                                    value={writeOffForm.notes}
                                    onChange={(e) => setWriteOffForm(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Detalles para auditoría interna..."
                                    rows={2}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsWriteOffModalOpen(false)}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingWriteOff}
                                    className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold"
                                >
                                    {savingWriteOff ? 'Procesando...' : 'Confirmar Baja de Inventario'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Trazabilidad y Bitácora */}
            {isTraceabilityModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <History size={18} className="text-sky-600" />
                                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                                    Bitácora de Trazabilidad del Lote
                                </h3>
                            </div>
                            <button onClick={() => setIsTraceabilityModalOpen(false)} className="text-slate-400">
                                <X size={16} />
                            </button>
                        </div>

                        {loadingTrace ? (
                            <div className="py-12 text-center text-xs text-slate-400 animate-pulse">
                                Consultando bitácora de movimientos y ventas...
                            </div>
                        ) : traceabilityData ? (
                            <div className="space-y-4 text-xs">
                                {/* Ficha Resumen */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <div>
                                        <span className="text-[10px] text-slate-500 block">Producto</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-100 truncate block">
                                            {traceabilityData.product?.name}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 block">Lote</span>
                                        <span className="font-mono font-bold text-slate-800 dark:text-slate-100 block">
                                            {traceabilityData.lot?.lotNumber}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 block">Vencimiento</span>
                                        <span className="font-medium text-slate-800 dark:text-slate-100 block">
                                            {traceabilityData.lot?.expirationDate || 'N/A'}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 block">Proveedor</span>
                                        <span className="text-slate-700 dark:text-slate-300 block truncate">
                                            {traceabilityData.supplier?.name || 'Inventario Inicial'}
                                        </span>
                                    </div>
                                </div>

                                {/* Despachos en Ventas */}
                                <div>
                                    <h4 className="font-bold uppercase tracking-wider text-[11px] text-slate-700 dark:text-slate-300 mb-2">
                                        Historial de Despachos en Ventas ({traceabilityData.salesHistory?.length || 0})
                                    </h4>
                                    {traceabilityData.salesHistory?.length > 0 ? (
                                        <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                                            {traceabilityData.salesHistory.map((s, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-2.5 text-[11px]">
                                                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                                        Ticket #{s.saleId}
                                                    </span>
                                                    <span className="text-slate-500">
                                                        {new Date(s.date).toLocaleDateString()} {new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    <span className="font-bold text-slate-900 dark:text-white">
                                                        {s.quantity} und. ({formatUSD(s.subtotal)})
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-slate-400 italic text-[11px]">
                                            No se registran salidas en ventas con este número de lote específico.
                                        </p>
                                    )}
                                </div>

                                {/* Bajas o Mermas */}
                                {traceabilityData.wasteHistory?.length > 0 && (
                                    <div>
                                        <h4 className="font-bold uppercase tracking-wider text-[11px] text-red-600 dark:text-red-400 mb-2">
                                            Registros de Merma / Baja Sanitaria
                                        </h4>
                                        <div className="border border-red-200 dark:border-red-900/40 rounded-xl divide-y divide-red-100 dark:divide-red-950/40">
                                            {traceabilityData.wasteHistory.map((w, idx) => (
                                                <div key={idx} className="p-2.5 text-[11px] space-y-1">
                                                    <div className="flex justify-between font-semibold text-red-700 dark:text-red-300">
                                                        <span>Baja: {w.quantity} unidades</span>
                                                        <span>{formatUSD(w.cost)}</span>
                                                    </div>
                                                    <p className="text-slate-500">{w.notes}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
}
