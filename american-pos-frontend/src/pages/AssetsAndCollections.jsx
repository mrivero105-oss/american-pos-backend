import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    Building2, Clock, MessageSquare, Plus, RefreshCw, TrendingDown,
    Calendar, Search, FileText, ExternalLink, X, ShieldAlert,
    Download, Printer, Lock, Unlock, Banknote, History
} from 'lucide-react';
import api from '../services/api';
import { usePos } from '../hooks/PosContext';
import { useAuth } from '../hooks/AuthContext';
import AbonoModal from '../components/AbonoModal';

const showToast = (msg, type = 'info') => {
    if (type === 'success') toast.success(msg);
    else if (type === 'error') toast.error(msg);
    else toast(msg);
};

const CATEGORY_LABELS = {
    MACHINERY: 'Maquinaria y Refrigeración',
    IT_EQUIPMENT: 'Equipos de Cómputo y POS',
    FURNITURE: 'Mobiliario y Estantería',
    VEHICLE: 'Flota y Transporte',
    BUILDING: 'Inmuebles e Instalaciones'
};

const ACTION_TYPE_LABELS = {
    WHATSAPP_REMINDER: 'Notificación WhatsApp',
    PHONE_CALL: 'Llamada Telefónica',
    PAYMENT_PROMISE: 'Compromiso de Pago',
    VISIT: 'Visita Presencial',
    LEGAL_NOTICE: 'Notificación Formal',
    CREDIT_BLOCKED: 'Bloqueo de Crédito POS',
    CREDIT_UNBLOCKED: 'Rehabilitación de Crédito'
};

export default function AssetsAndCollections() {
    const { exchangeRate } = usePos();
    const { hasPermission } = useAuth();
    const confirm = async ({ title, message }) => window.confirm(`${title}\n\n${message}`);
    const location = useLocation();
    const bcvRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;

    const canCollections = hasPermission ? hasPermission('customers.collections') : true;
    const canAssets = hasPermission ? hasPermission('management.assets') : true;

    // Determine whether the user entered via "Radar de Cobranza" (?tab=collections) or "Activos Fijos" (?tab=assets)
    const isCollectionsModule = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const tabParam = params.get('tab');
        if (tabParam === 'collections') return true;
        if (tabParam === 'assets' || tabParam === 'depreciation') return false;
        return canCollections && !canAssets;
    }, [location.search, canCollections, canAssets]);

    const [assetSubTab, setAssetSubTab] = useState('assets'); // 'assets' | 'depreciation'

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tabParam = params.get('tab');
        if (tabParam === 'depreciation') setAssetSubTab('depreciation');
        else if (tabParam === 'assets') setAssetSubTab('assets');
    }, [location.search]);

    // =========================================================================
    // STATE: RADAR DE COBRANZA & ANTIGÜEDAD DE CARTERA (AGING MATRIX)
    // =========================================================================
    const [agingData, setAgingData] = useState({
        summary: {
            totalReceivable: 0,
            totalCurrent: 0,
            total16to30: 0,
            total31to60: 0,
            totalOver60: 0,
            totalCreditLimit: 0,
            customersCount: 0,
            totalListedCount: 0,
            criticalCount: 0,
            warningCount: 0,
            healthyCount: 0
        },
        customers: []
    });
    const [loadingCollections, setLoadingCollections] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'CURRENT' | '16_30' | '31_60' | 'OVER_60' | 'BLOCKED'
    const [includeZeroBalance, setIncludeZeroBalance] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]);

    // Modals for Collections
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [whatsappModalData, setWhatsappModalData] = useState(null);
    const [modalRate, setModalRate] = useState(bcvRate);
    const [actionForm, setActionForm] = useState({
        actionType: 'PAYMENT_PROMISE',
        promisedDate: '',
        promisedAmount: '',
        notes: ''
    });
    const [isActionModalOpen, setIsActionModalOpen] = useState(false);
    const [customerHistory, setCustomerHistory] = useState([]);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
    const [processingAbono, setProcessingAbono] = useState(false);

    // =========================================================================
    // STATE: PROPIEDAD, PLANTA Y EQUIPO (ACTIVOS FIJOS NIC 16)
    // =========================================================================
    const [assetsList, setAssetsList] = useState([]);
    const [loadingAssets, setLoadingAssets] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [assetCategoryFilter, setAssetCategoryFilter] = useState('ALL');
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [selectedAssetForHistory, setSelectedAssetForHistory] = useState(null);
    const [assetDepreciationLogs, setAssetDepreciationLogs] = useState([]);
    const [isAssetHistoryOpen, setIsAssetHistoryOpen] = useState(false);

    const [newAsset, setNewAsset] = useState({
        name: '',
        category: 'MACHINERY',
        purchaseDate: new Date().toISOString().split('T')[0],
        purchaseCost: '',
        salvageValue: '0',
        usefulLifeMonths: '60',
        location: 'Piso de Venta Principal',
        serialNumber: '',
        notes: ''
    });

    const [depreciationPeriod, setDepreciationPeriod] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [depreciating, setDepreciating] = useState(false);

    useEffect(() => {
        if (isCollectionsModule && canCollections) {
            fetchAgingReport(includeZeroBalance);
            api.get('/settings/payment-methods').then(r => setPaymentMethods(r.data || [])).catch(() => {});
        } else if (!isCollectionsModule && canAssets) {
            fetchAssets();
        }
    }, [isCollectionsModule, canCollections, canAssets, includeZeroBalance]);

    const fetchAgingReport = async (withZero = includeZeroBalance) => {
        try {
            setLoadingCollections(true);
            const res = await api.get('/collections/aging', {
                params: { includeZero: withZero ? 'true' : 'false' }
            });
            if (res.data?.success || res.data?.ok) {
                setAgingData({
                    summary: res.data.summary || {},
                    customers: res.data.customers || []
                });
            }
        } catch (err) {
            console.error('Error cargando antigüedad de saldos:', err);
        } finally {
            setLoadingCollections(false);
        }
    };

    const fetchAssets = async () => {
        try {
            setLoadingAssets(true);
            const res = await api.get('/assets');
            if (res.data?.success || res.data?.ok) {
                setAssetsList(res.data.assets || []);
            }
        } catch (err) {
            console.error('Error cargando activos fijos:', err);
        } finally {
            setLoadingAssets(false);
        }
    };

    const handleToggleBlock = async (customer) => {
        const cId = customer.customerId || customer.id;
        const nextBlocked = !customer.isCreditBlocked;
        try {
            const res = await api.post(`/collections/toggle-block/${cId}`, {
                isBlocked: nextBlocked
            });
            if (res.data?.success || res.data?.ok) {
                showToast(
                    nextBlocked
                        ? `Crédito en caja suspendido para ${customer.name}`
                        : `Línea de crédito rehabilitada para ${customer.name}`,
                    nextBlocked ? 'info' : 'success'
                );
                fetchAgingReport(includeZeroBalance);
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error cambiando estado de crédito', 'error');
        }
    };

    const handleOpenWhatsApp = async (customerId, customRate) => {
        const rateToUse = customRate !== undefined ? customRate : bcvRate;
        try {
            const res = await api.get(`/collections/whatsapp-message/${customerId}`, {
                params: { exchangeRate: rateToUse }
            });
            if (res.data?.success || res.data?.ok) {
                setModalRate(rateToUse);
                setWhatsappModalData({ ...res.data, customerId });
            }
        } catch (err) {
            showToast('Error al generar estado de cuenta para WhatsApp', 'error');
        }
    };

    const handleSaveAction = async (e) => {
        e.preventDefault();
        if (!selectedCustomer) return;
        const cId = selectedCustomer.customerId || selectedCustomer.id;
        try {
            const res = await api.post('/collections/log', {
                customerId: cId,
                ...actionForm
            });
            if (res.data?.success || res.data?.ok) {
                setIsActionModalOpen(false);
                setActionForm({ actionType: 'PAYMENT_PROMISE', promisedDate: '', promisedAmount: '', notes: '' });
                showToast('Compromiso / gestión asentada en bitácora de cobranza', 'success');
                fetchAgingReport(includeZeroBalance);
            }
        } catch (err) {
            showToast('Error al guardar gestión de cobranza', 'error');
        }
    };

    const handleViewHistory = async (customer) => {
        setSelectedCustomer(customer);
        const cId = customer.customerId || customer.id;
        try {
            const res = await api.get(`/collections/history/${cId}`);
            if (res.data?.success || res.data?.ok) {
                setCustomerHistory(res.data.history || res.data.logs || []);
                setIsHistoryModalOpen(true);
            }
        } catch (err) {
            console.error('Error cargando historial de cobranza:', err);
        }
    };

    const handleSaveAbono = async (abonoData) => {
        try {
            setProcessingAbono(true);
            await api.post(`/customers/${abonoData.customerId}/payment`, {
                amount: abonoData.amount,
                currency: abonoData.currency || 'USD',
                exchangeRate: abonoData.exchangeRate || bcvRate,
                method: abonoData.method,
                notes: abonoData.notes,
                saleIds: abonoData.saleIds,
                cryptoRate: abonoData.cryptoRate,
                reference: abonoData.reference
            });
            showToast('Abono registrado y descontado del saldo exigible', 'success');
            setIsAbonoModalOpen(false);
            fetchAgingReport(includeZeroBalance);
        } catch (err) {
            showToast(err.response?.data?.error || 'Error registrando abono', 'error');
        } finally {
            setProcessingAbono(false);
        }
    };

    const handleCreateAsset = async (e) => {
        e.preventDefault();
        try {
            const res = await api.post('/assets', newAsset);
            if (res.data?.success || res.data?.ok) {
                setIsAssetModalOpen(false);
                setNewAsset({
                    name: '',
                    category: 'MACHINERY',
                    purchaseDate: new Date().toISOString().split('T')[0],
                    purchaseCost: '',
                    salvageValue: '0',
                    usefulLifeMonths: '60',
                    location: 'Piso de Venta Principal',
                    serialNumber: '',
                    notes: ''
                });
                showToast('Activo fijo incorporado al libro patrimonial', 'success');
                fetchAssets();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error registrando activo fijo', 'error');
        }
    };

    const handleViewAssetHistory = async (asset) => {
        setSelectedAssetForHistory(asset);
        try {
            const res = await api.get(`/assets/${asset.id}/history`);
            if (res.data?.success || res.data?.ok) {
                setAssetDepreciationLogs(res.data.history || []);
                setIsAssetHistoryOpen(true);
            }
        } catch (err) {
            showToast('Error consultando historial de depreciación', 'error');
        }
    };

    const handleRunDepreciation = async () => {
        const ok = await confirm({
            title: 'Ejecutar Amortización y Depreciación Mensual (NIC 16)',
            message: `¿Confirmar corrida de depreciación en línea recta para el período ${depreciationPeriod}? Se actualizará el valor neto en libros de todos los bienes activos y se asentará el gasto en el Libro Diario.`
        });
        if (!ok) return;

        try {
            setDepreciating(true);
            const res = await api.post('/assets/depreciate', {
                period: depreciationPeriod,
                exchangeRate: bcvRate
            });
            if (res.data?.success || res.data?.ok) {
                showToast(
                    res.data.message || `Depreciación contabilizada (${res.data.depreciatedCount || 0} bienes actualizados)`,
                    'success'
                );
                fetchAssets();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error ejecutando depreciación', 'error');
        } finally {
            setDepreciating(false);
        }
    };

    const fmtUSD = (val) => {
        const num = parseFloat(val) || 0;
        return `$ ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const fmtBs = (valUsd) => {
        const num = (parseFloat(valUsd) || 0) * bcvRate;
        return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const filteredCustomers = useMemo(() => {
        return (agingData.customers || []).filter(c => {
            const q = searchTerm.trim().toLowerCase();
            const matchesSearch = !q ||
                c.name?.toLowerCase().includes(q) ||
                c.idDocument?.toLowerCase().includes(q) ||
                c.phone?.toLowerCase().includes(q);
            if (!matchesSearch) return false;

            if (statusFilter === 'CURRENT') return (parseFloat(c.current0to15) || 0) > 0.01;
            if (statusFilter === '16_30') return (parseFloat(c.days16to30) || 0) > 0.01;
            if (statusFilter === '31_60') return (parseFloat(c.days31to60) || 0) > 0.01;
            if (statusFilter === 'OVER_60') return (parseFloat(c.daysOver60) || 0) > 0.01;
            if (statusFilter === 'BLOCKED') return Boolean(c.isCreditBlocked);
            return true;
        });
    }, [agingData.customers, searchTerm, statusFilter]);

    const filteredAssets = useMemo(() => {
        return assetsList.filter(a => {
            if (assetCategoryFilter !== 'ALL' && a.category !== assetCategoryFilter) return false;
            const q = assetSearch.trim().toLowerCase();
            if (!q) return true;
            return (
                a.name?.toLowerCase().includes(q) ||
                a.code?.toLowerCase().includes(q) ||
                a.location?.toLowerCase().includes(q)
            );
        });
    }, [assetsList, assetSearch, assetCategoryFilter]);

    const assetMetrics = useMemo(() => {
        const totalCost = assetsList.reduce((acc, a) => acc + (parseFloat(a.purchaseCost) || 0), 0);
        const totalAccum = assetsList.reduce((acc, a) => acc + (parseFloat(a.accumulatedDepreciation) || 0), 0);
        const totalBook = assetsList.reduce((acc, a) => acc + (parseFloat(a.currentBookValue) || 0), 0);
        const monthlyQuota = assetsList
            .filter(a => a.status === 'ACTIVE')
            .reduce((acc, a) => acc + (parseFloat(a.monthlyDepreciation) || 0), 0);
        return { totalCost, totalAccum, totalBook, monthlyQuota };
    }, [assetsList]);

    const handleExportCSV = () => {
        if (isCollectionsModule) {
            const rows = [
                ['MATRIZ DE ANTIGUEDAD DE CARTERA (AGING SCHEDULE FIFO)'],
                [`Tasa BCV: Bs. ${bcvRate.toFixed(2)} / USD`, `Fecha Corte: ${new Date().toISOString().slice(0, 10)}`],
                [],
                ['Cliente', 'RIF / Cedula', 'Telefono', 'Limite Credito ($)', 'Corriente 0-15d ($)', 'Vencido 16-30d ($)', 'Mora 31-60d ($)', 'Critico +60d ($)', 'Saldo Total Exigible ($)', 'Equivalente (Bs)', 'Dias Antiguedad Max', 'Estatus']
            ];
            filteredCustomers.forEach(c => {
                const bal = parseFloat(c.totalBalance) || 0;
                rows.push([
                    `"${(c.name || '').replace(/"/g, '""')}"`,
                    c.idDocument || '',
                    c.phone || '',
                    (parseFloat(c.creditLimit) || 0).toFixed(2),
                    (parseFloat(c.current0to15) || 0).toFixed(2),
                    (parseFloat(c.days16to30) || 0).toFixed(2),
                    (parseFloat(c.days31to60) || 0).toFixed(2),
                    (parseFloat(c.daysOver60) || 0).toFixed(2),
                    bal.toFixed(2),
                    (bal * bcvRate).toFixed(2),
                    c.oldestDays || 0,
                    c.statusLabel || ''
                ]);
            });
            const csv = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(r => r.join(',')).join('\n');
            const link = document.createElement('a');
            link.setAttribute('href', encodeURI(csv));
            link.setAttribute('download', `Matriz_Antiguedad_Cartera_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            const rows = [
                ['CEDULA DE PROPIEDAD, PLANTA Y EQUIPO (ACTIVOS FIJOS NIC 16)'],
                [`Tasa BCV: Bs. ${bcvRate.toFixed(2)} / USD`],
                [],
                ['Codigo', 'Descripcion del Bien', 'Categoria', 'Ubicacion', 'Fecha Compra', 'Vida Util (Meses)', 'Costo Historico ($)', 'Depreciacion Acumulada ($)', 'Valor Neto Libros ($)', 'Valor Neto Libros (Bs)']
            ];
            filteredAssets.forEach(a => {
                const book = parseFloat(a.currentBookValue) || 0;
                rows.push([
                    a.code,
                    `"${(a.name || '').replace(/"/g, '""')}"`,
                    CATEGORY_LABELS[a.category] || a.category,
                    `"${(a.location || '').replace(/"/g, '""')}"`,
                    a.purchaseDate,
                    a.usefulLifeMonths,
                    (parseFloat(a.purchaseCost) || 0).toFixed(2),
                    (parseFloat(a.accumulatedDepreciation) || 0).toFixed(2),
                    book.toFixed(2),
                    (book * bcvRate).toFixed(2)
                ]);
            });
            const csv = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(r => r.join(',')).join('\n');
            const link = document.createElement('a');
            link.setAttribute('href', encodeURI(csv));
            link.setAttribute('download', `Cedula_Activos_Fijos_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // =========================================================================
    // RENDER MÓDULO A: RADAR DE COBRANZA Y MATRIZ DE ANTIGÜEDAD (CLIENTES)
    // =========================================================================
    if (isCollectionsModule) {
        return (
            <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5 animate-in fade-in duration-300">
                {/* CABECERA INSTITUCIONAL DE RIESGO CREDITICIO */}
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                    <div className="p-4 sm:p-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 dark:border-slate-800">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                                    AUDITORÍA DE RIESGO CREDITICIO • FIFO AGING SCHEDULE
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    Tasa Oficial BCV: Bs. {bcvRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} / USD
                                </span>
                            </div>
                            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">
                                Radar de Cobranza y Matriz de Antigüedad de Saldos
                            </h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Desglose técnico de cuentas por cobrar en 4 tramos de vencimiento (0-15d, 16-30d, 31-60d, +60d), bloqueo preventivo de caja y bitácora de compromisos
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
                            <button
                                type="button"
                                onClick={() => setIncludeZeroBalance(prev => !prev)}
                                className={`h-9 px-3 rounded-md border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                                    includeZeroBalance
                                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                                }`}
                                title="Alternar entre ver únicamente clientes con deuda pendiente o auditar toda la cartera de clientes"
                            >
                                <span>{includeZeroBalance ? 'Mostrando: Toda la Cartera' : 'Mostrando: Solo con Deuda'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleExportCSV}
                                className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <Download size={13} />
                                <span>Exportar CSV</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => window.print()}
                                className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <Printer size={13} />
                                <span>Imprimir Matriz</span>
                            </button>
                        </div>
                    </div>

                    {/* 5 RATIOS DE TRAMOS DE ANTIGÜEDAD (INTERACTIVOS PARA FILTRAR) */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                        <div
                            onClick={() => setStatusFilter('ALL')}
                            className={`p-3.5 sm:px-4 cursor-pointer transition-colors ${statusFilter === 'ALL' ? 'bg-white dark:bg-slate-900' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40'}`}
                        >
                            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block font-bold">
                                EXPOSICIÓN TOTAL CARTERA
                            </span>
                            <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                                {fmtUSD(agingData.summary.totalReceivable)}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {fmtBs(agingData.summary.totalReceivable)} ({agingData.summary.customersCount || 0} deudores)
                            </div>
                        </div>

                        <div
                            onClick={() => setStatusFilter('CURRENT')}
                            className={`p-3.5 sm:px-4 cursor-pointer transition-colors ${statusFilter === 'CURRENT' ? 'bg-white dark:bg-slate-900' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40'}`}
                        >
                            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block font-bold">
                                I · CORRIENTE (0 A 15 DÍAS)
                            </span>
                            <div className="text-base sm:text-lg font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
                                {fmtUSD(agingData.summary.totalCurrent)}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {fmtBs(agingData.summary.totalCurrent)}
                            </div>
                        </div>

                        <div
                            onClick={() => setStatusFilter('16_30')}
                            className={`p-3.5 sm:px-4 cursor-pointer transition-colors ${statusFilter === '16_30' ? 'bg-white dark:bg-slate-900' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40'}`}
                        >
                            <span className="text-[10px] font-mono uppercase tracking-wider text-blue-700 dark:text-blue-400 block font-bold">
                                II · VENCIDO (16 A 30 DÍAS)
                            </span>
                            <div className="text-base sm:text-lg font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums mt-1">
                                {fmtUSD(agingData.summary.total16to30)}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {fmtBs(agingData.summary.total16to30)}
                            </div>
                        </div>

                        <div
                            onClick={() => setStatusFilter('31_60')}
                            className={`p-3.5 sm:px-4 cursor-pointer transition-colors ${statusFilter === '31_60' ? 'bg-white dark:bg-slate-900' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40'}`}
                        >
                            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400 block font-bold">
                                III · MORA (31 A 60 DÍAS)
                            </span>
                            <div className="text-base sm:text-lg font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
                                {fmtUSD(agingData.summary.total31to60)}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {fmtBs(agingData.summary.total31to60)}
                            </div>
                        </div>

                        <div
                            onClick={() => setStatusFilter('OVER_60')}
                            className={`p-3.5 sm:px-4 col-span-2 lg:col-span-1 cursor-pointer transition-colors ${statusFilter === 'OVER_60' ? 'bg-white dark:bg-slate-900' : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/40'}`}
                        >
                            <span className="text-[10px] font-mono uppercase tracking-wider text-rose-700 dark:text-rose-400 block font-bold">
                                IV · CRÍTICO (+60 DÍAS)
                            </span>
                            <div className="text-base sm:text-lg font-mono font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-1">
                                {fmtUSD(agingData.summary.totalOver60)}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                                {fmtBs(agingData.summary.totalOver60)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* BARRA DE FILTROS DE AUDITORÍA */}
                <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-md">
                        {[
                            { id: 'ALL', label: `Todos (${agingData.customers.length})` },
                            { id: 'CURRENT', label: '0-15 Días' },
                            { id: '16_30', label: '16-30 Días' },
                            { id: '31_60', label: '31-60 Días' },
                            { id: 'OVER_60', label: '+60 Días (Crítico)' },
                            { id: 'BLOCKED', label: 'Crédito Bloqueado' }
                        ].map(f => (
                            <button
                                key={f.id}
                                type="button"
                                onClick={() => setStatusFilter(f.id)}
                                className={`h-7 px-2.5 rounded text-xs font-semibold transition-all cursor-pointer ${
                                    statusFilter === f.id
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative w-full sm:w-64">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, RIF/C.I. o teléfono..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full h-8 pl-8 pr-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs outline-none"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => fetchAgingReport(includeZeroBalance)}
                            className="h-8 px-3 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                            <RefreshCw size={12} className={loadingCollections ? 'animate-spin' : ''} />
                            <span>Conciliar</span>
                        </button>
                    </div>
                </div>

                {/* MATRIZ BANCARIA DE ANTIGÜEDAD DE SALDOS */}
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500">
                                    <th className="py-2.5 px-3.5">Titular / Documento</th>
                                    <th className="py-2.5 px-3 text-right">Cupo Crédito</th>
                                    <th className="py-2.5 px-3 text-right">0-15 Días</th>
                                    <th className="py-2.5 px-3 text-right">16-30 Días</th>
                                    <th className="py-2.5 px-3 text-right">31-60 Días</th>
                                    <th className="py-2.5 px-3 text-right">+60 Días</th>
                                    <th className="py-2.5 px-3.5 text-right">Saldo Exigible (USD / Bs)</th>
                                    <th className="py-2.5 px-3 text-center">Dictamen / Estatus POS</th>
                                    <th className="py-2.5 px-3">Último Compromiso</th>
                                    <th className="py-2.5 px-3.5 text-right">Instrumentos de Cobro</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                {loadingCollections ? (
                                    <tr>
                                        <td colSpan="10" className="p-12 text-center text-slate-400">
                                            Ejecutando conciliación FIFO de cargos, abonos y facturas por cobrar...
                                        </td>
                                    </tr>
                                ) : filteredCustomers.length === 0 ? (
                                    <tr>
                                        <td colSpan="10" className="p-12 text-center space-y-3">
                                            <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                                Cartera Saneada — Sin Saldos Vencidos en este Tramo
                                            </div>
                                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                                Actualmente ningún cliente presenta deuda pendiente en el filtro seleccionado. Si desea auditar los límites de crédito o estatus de todos sus clientes registrados, active la vista completa.
                                            </p>
                                            {!includeZeroBalance && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIncludeZeroBalance(true)}
                                                    className="h-8 px-3.5 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <span>Ver Directorio Completo de Clientes</span>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredCustomers.map(c => {
                                        const cId = c.customerId || c.id;
                                        const bal = parseFloat(c.totalBalance) || 0;
                                        const limit = parseFloat(c.creditLimit) || 0;
                                        const usagePct = limit > 0 ? Math.min(100, (bal / limit) * 100) : 0;

                                        return (
                                            <tr key={cId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                                <td className="py-2.5 px-3.5">
                                                    <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                                                    <div className="text-[10px] font-mono text-slate-400">
                                                        {c.idDocument || 'Sin RIF/C.I.'} {c.phone ? `• ${c.phone}` : ''}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                                    <div className="text-slate-700 dark:text-slate-300 font-semibold">
                                                        {limit > 0 ? fmtUSD(limit) : 'Sin límite'}
                                                    </div>
                                                    {limit > 0 && (
                                                        <div className="text-[10px] text-slate-400">
                                                            Uso: {usagePct.toFixed(0)}%
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                                                    {c.current0to15 > 0.01 ? fmtUSD(c.current0to15) : '—'}
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-700 dark:text-blue-400">
                                                    {c.days16to30 > 0.01 ? fmtUSD(c.days16to30) : '—'}
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                                                    {c.days31to60 > 0.01 ? fmtUSD(c.days31to60) : '—'}
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-rose-700 dark:text-rose-400">
                                                    {c.daysOver60 > 0.01 ? fmtUSD(c.daysOver60) : '—'}
                                                </td>
                                                <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                                                    <div className="font-bold text-slate-900 dark:text-white">{fmtUSD(bal)}</div>
                                                    <div className="text-[10px] text-slate-400">{fmtBs(bal)}</div>
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border inline-block ${
                                                        c.isCreditBlocked || c.status === 'RED'
                                                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                                                            : c.status === 'ORANGE' || c.status === 'YELLOW'
                                                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                                                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                                                    }`}>
                                                        {c.statusLabel}
                                                    </span>
                                                    {c.oldestDays > 0 && (
                                                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                                                            Antigüedad: {c.oldestDays}d
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-3">
                                                    {c.lastAction ? (
                                                        <div className="text-[11px]">
                                                            <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                                                                {ACTION_TYPE_LABELS[c.lastAction.actionType] || c.lastAction.actionType}
                                                            </span>
                                                            {c.lastAction.promisedDate ? (
                                                                <span className="text-[10px] font-mono text-amber-700 dark:text-amber-400">
                                                                    Promesa: {c.lastAction.promisedDate} ({fmtUSD(c.lastAction.promisedAmount)})
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] font-mono text-slate-400">
                                                                    {new Date(c.lastAction.createdAt).toLocaleDateString()}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-400">Sin gestiones</span>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-3.5 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        {bal > 0.01 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setSelectedCustomer({ ...c, id: cId, creditBalance: bal });
                                                                    setIsAbonoModalOpen(true);
                                                                }}
                                                                className="h-7 px-2 rounded bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                                                title="Registrar abono o pago de deuda"
                                                            >
                                                                <Banknote size={12} />
                                                                <span>Abonar</span>
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenWhatsApp(cId)}
                                                            className="h-7 px-2 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                                            title="Emitir estado de cuenta formal por WhatsApp"
                                                        >
                                                            <MessageSquare size={12} />
                                                            <span>WhatsApp</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedCustomer(c);
                                                                setActionForm({
                                                                    actionType: 'PAYMENT_PROMISE',
                                                                    promisedDate: new Date().toISOString().split('T')[0],
                                                                    promisedAmount: bal > 0 ? bal.toFixed(2) : '',
                                                                    notes: ''
                                                                });
                                                                setIsActionModalOpen(true);
                                                            }}
                                                            className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold cursor-pointer"
                                                            title="Anotar promesa de pago o llamada"
                                                        >
                                                            Promesa
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleBlock(c)}
                                                            className={`h-7 px-2 rounded border text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                                                                c.isCreditBlocked
                                                                    ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                                                            }`}
                                                            title={c.isCreditBlocked ? 'Clic para rehabilitar crédito en caja' : 'Clic para suspender preventivamente el crédito en caja'}
                                                        >
                                                            {c.isCreditBlocked ? <Lock size={11} /> : <Unlock size={11} />}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleViewHistory(c)}
                                                            className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-pointer"
                                                            title="Ver bitácora histórica de gestiones"
                                                        >
                                                            <History size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* MODAL: REGISTRAR ABONO DIRECTO */}
                {isAbonoModalOpen && selectedCustomer && (
                    <AbonoModal
                        isOpen={isAbonoModalOpen}
                        onClose={() => setIsAbonoModalOpen(false)}
                        customer={selectedCustomer}
                        onSave={handleSaveAbono}
                        processing={processingAbono}
                        exchangeRate={bcvRate}
                        paymentMethods={paymentMethods}
                    />
                )}

                {/* MODAL: WHATSAPP ESTADO DE CUENTA */}
                {whatsappModalData && (
                    <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-lg max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                <span className="font-bold text-sm text-slate-900 dark:text-white">
                                    Emisión de Estado de Cuenta Comercial (WhatsApp)
                                </span>
                                <button onClick={() => setWhatsappModalData(null)} className="text-slate-400">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-xs">
                                <span className="font-semibold">Tasa de Conversión BCV (Bs/USD):</span>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={modalRate}
                                        onChange={(e) => setModalRate(e.target.value)}
                                        className="w-24 h-8 px-2 bg-white dark:bg-slate-900 rounded border border-slate-300 dark:border-slate-700 font-mono font-bold text-right"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleOpenWhatsApp(whatsappModalData.customerId, modalRate)}
                                        className="h-8 px-3 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded font-semibold cursor-pointer"
                                    >
                                        Recalcular
                                    </button>
                                </div>
                            </div>

                            <textarea
                                rows="9"
                                value={whatsappModalData.message}
                                onChange={(e) => setWhatsappModalData({
                                    ...whatsappModalData,
                                    message: e.target.value,
                                    encodedUri: `https://wa.me/${(whatsappModalData.phone || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(e.target.value)}`
                                })}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono text-xs resize-none"
                            />

                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setWhatsappModalData(null)}
                                    className="h-9 px-4 bg-slate-100 dark:bg-slate-800 rounded text-xs font-semibold"
                                >
                                    Cerrar
                                </button>
                                <a
                                    href={whatsappModalData.encodedUri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="h-9 px-4 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold inline-flex items-center gap-1.5"
                                >
                                    <ExternalLink size={14} />
                                    <span>Enviar por WhatsApp</span>
                                </a>
                            </div>
                        </div>
                    </div>
                )}

                {/* MODAL: REGISTRAR COMPROMISO / BITÁCORA */}
                {isActionModalOpen && selectedCustomer && (
                    <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-lg max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                    Asentar Compromiso de Cobro: {selectedCustomer.name}
                                </h3>
                                <button onClick={() => setIsActionModalOpen(false)} className="text-slate-400">
                                    <X size={18} />
                                </button>
                            </div>
                            <form onSubmit={handleSaveAction} className="space-y-3 text-xs">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Tipo de Gestión</label>
                                    <select
                                        value={actionForm.actionType}
                                        onChange={(e) => setActionForm({ ...actionForm, actionType: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-semibold"
                                    >
                                        <option value="PAYMENT_PROMISE">Compromiso Formal de Pago</option>
                                        <option value="WHATSAPP_REMINDER">Notificación Escrita WhatsApp</option>
                                        <option value="PHONE_CALL">Llamada Telefónica</option>
                                        <option value="VISIT">Gestión Presencial</option>
                                        <option value="LEGAL_NOTICE">Notificación Administrativa</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block font-semibold text-slate-500 mb-1">Fecha Prometida</label>
                                        <input
                                            type="date"
                                            value={actionForm.promisedDate}
                                            onChange={(e) => setActionForm({ ...actionForm, promisedDate: e.target.value })}
                                            className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block font-semibold text-slate-500 mb-1">Monto Prometido (USD)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={actionForm.promisedAmount}
                                            onChange={(e) => setActionForm({ ...actionForm, promisedAmount: e.target.value })}
                                            className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono font-bold"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Acuerdo / Observaciones</label>
                                    <textarea
                                        rows="3"
                                        placeholder="Detalle del acuerdo con el cliente..."
                                        value={actionForm.notes}
                                        onChange={(e) => setActionForm({ ...actionForm, notes: e.target.value })}
                                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
                                    />
                                </div>
                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsActionModalOpen(false)}
                                        className="h-9 px-4 bg-slate-100 dark:bg-slate-800 rounded font-semibold"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="h-9 px-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded font-semibold cursor-pointer"
                                    >
                                        Guardar en Bitácora
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* MODAL: HISTORIAL DE COBRANZAS */}
                {isHistoryModalOpen && selectedCustomer && (
                    <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-lg max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                    Bitácora de Cobranza: {selectedCustomer.name}
                                </h3>
                                <button onClick={() => setIsHistoryModalOpen(false)} className="text-slate-400">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="max-h-80 overflow-y-auto space-y-2 text-xs">
                                {customerHistory.length === 0 ? (
                                    <p className="text-center py-6 text-slate-400">Sin gestiones previas registradas para este cliente.</p>
                                ) : (
                                    customerHistory.map(h => (
                                        <div key={h.id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                                            <div className="flex justify-between font-mono font-bold">
                                                <span>{ACTION_TYPE_LABELS[h.actionType] || h.actionType}</span>
                                                <span className="text-slate-400">{new Date(h.createdAt).toLocaleString()}</span>
                                            </div>
                                            {h.promisedDate && (
                                                <div className="text-emerald-700 dark:text-emerald-400 font-mono mt-1">
                                                    Fecha prometida: {h.promisedDate} ({fmtUSD(h.promisedAmount)})
                                                </div>
                                            )}
                                            {h.notes && <p className="text-slate-600 dark:text-slate-300 mt-1">{h.notes}</p>}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // =========================================================================
    // RENDER MÓDULO B: ACTIVOS FIJOS Y DEPRECIACIÓN ACUMULADA (NIC 16 / VEN-NIF)
    // =========================================================================
    return (
        <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5 animate-in fade-in duration-300">
            {/* CABECERA INSTITUCIONAL DE PROPIEDAD, PLANTA Y EQUIPO */}
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                                CONTROL PATRIMONIAL • NIC 16 / VEN-NIF
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Tasa Oficial BCV: Bs. {bcvRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} / USD
                            </span>
                        </div>
                        <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">
                            Cédula de Propiedad, Planta y Equipo (Activos Fijos y Depreciación)
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Inventario físico valorizado de maquinaria, equipos de refrigeración, cómputo, mobiliario y amortización mensual en línea recta
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                            <Download size={13} />
                            <span>Exportar CSV</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                            <Printer size={13} />
                            <span>Imprimir Cédula</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsAssetModalOpen(true)}
                            className="h-9 px-3.5 rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                        >
                            <Plus size={13} />
                            <span>Incorporar Activo Fijo</span>
                        </button>
                    </div>
                </div>

                {/* CINTA DE RATIOS PATRIMONIALES */}
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            COSTO HISTÓRICO DE ADQUISICIÓN
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                            {fmtUSD(assetMetrics.totalCost)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(assetMetrics.totalCost)} ({assetsList.length} bienes)
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            DEPRECIACIÓN ACUMULADA (DESGASTE)
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-1">
                            -{fmtUSD(assetMetrics.totalAccum)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(assetMetrics.totalAccum)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            VALOR NETO EN LIBROS (PATRIMONIO)
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
                            {fmtUSD(assetMetrics.totalBook)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(assetMetrics.totalBook)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            CARGO MENSUAL POR DEPRECIACIÓN
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
                            {fmtUSD(assetMetrics.monthlyQuota)} / mes
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(assetMetrics.monthlyQuota)} / mes
                        </div>
                    </div>
                </div>
            </div>

            {/* NAVEGACIÓN EXCLUSIVA DE ACTIVOS FIJOS */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-md">
                    <button
                        type="button"
                        onClick={() => setAssetSubTab('assets')}
                        className={`h-8 px-3 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                            assetSubTab === 'assets'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400'
                        }`}
                    >
                        <Building2 size={13} />
                        <span>1. Inventario de Propiedad, Planta y Equipo ({assetsList.length})</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setAssetSubTab('depreciation')}
                        className={`h-8 px-3 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                            assetSubTab === 'depreciation'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400'
                        }`}
                    >
                        <TrendingDown size={13} />
                        <span>2. Cierre y Depreciación Mensual (NIC 16)</span>
                    </button>
                </div>

                {assetSubTab === 'assets' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-64">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Filtrar por código, bien o ubicación..."
                                value={assetSearch}
                                onChange={(e) => setAssetSearch(e.target.value)}
                                className="w-full h-8 pl-8 pr-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs outline-none"
                            />
                        </div>
                        <select
                            value={assetCategoryFilter}
                            onChange={(e) => setAssetCategoryFilter(e.target.value)}
                            className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold"
                        >
                            <option value="ALL">Todas las Categorías</option>
                            <option value="MACHINERY">Maquinaria y Refrigeración</option>
                            <option value="IT_EQUIPMENT">Equipos de Cómputo y POS</option>
                            <option value="FURNITURE">Mobiliario y Estantería</option>
                            <option value="VEHICLE">Flota y Transporte</option>
                            <option value="BUILDING">Inmuebles e Instalaciones</option>
                        </select>
                    </div>
                )}
            </div>

            {/* SUB-VISTA 1: INVENTARIO PATRIMONIAL */}
            {assetSubTab === 'assets' && (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    {filteredAssets.length === 0 ? (
                        <div className="p-12 text-center space-y-3">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                Sin bienes registrados en la Cédula de Propiedad, Planta y Equipo
                            </p>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                Incorpore las neveras exhibidoras, congeladores, balanzas digitales, estaciones de punto de venta o mobiliario del establecimiento para llevar el control de su valor en libros y depreciación acumulada.
                            </p>
                            <button
                                type="button"
                                onClick={() => setIsAssetModalOpen(true)}
                                className="h-9 px-4 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                                <Plus size={14} />
                                <span>Incorporar Primer Activo Fijo</span>
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500">
                                        <th className="py-2.5 px-4">Código Bien</th>
                                        <th className="py-2.5 px-4">Descripción y Ubicación</th>
                                        <th className="py-2.5 px-4">Categoría NIC 16</th>
                                        <th className="py-2.5 px-4">Adquisición</th>
                                        <th className="py-2.5 px-4 text-right">Costo Histórico</th>
                                        <th className="py-2.5 px-4 text-right">Deprec. Acumulada</th>
                                        <th className="py-2.5 px-4 text-right">Valor Neto Libros (USD / Bs)</th>
                                        <th className="py-2.5 px-4 w-36">Vida Útil / Desgaste</th>
                                        <th className="py-2.5 px-4 text-center">Condición</th>
                                        <th className="py-2.5 px-4 text-right">Auditoría</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {filteredAssets.map(a => {
                                        const pct = Math.min(100, parseFloat(a.percentDepreciated) || 0);
                                        return (
                                            <tr key={a.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                                <td className="py-2.5 px-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                                                    {a.code}
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <div className="font-semibold text-slate-900 dark:text-white">{a.name}</div>
                                                    <div className="text-[10px] font-mono text-slate-400">
                                                        {a.location || 'Piso de Venta'} {a.serialNumber ? `• S/N: ${a.serialNumber}` : ''}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-semibold text-slate-700 dark:text-slate-300">
                                                        {CATEGORY_LABELS[a.category] || a.category}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4 font-mono text-slate-500">
                                                    {a.purchaseDate}
                                                </td>
                                                <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                                    {fmtUSD(a.purchaseCost)}
                                                </td>
                                                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                                                    -{fmtUSD(a.accumulatedDepreciation)}
                                                    <div className="text-[10px] text-slate-400">
                                                        Cuota: {fmtUSD(a.monthlyDepreciation)}/m
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                                                    <div className="font-bold text-emerald-700 dark:text-emerald-400">{fmtUSD(a.currentBookValue)}</div>
                                                    <div className="text-[10px] text-slate-400">{fmtBs(a.currentBookValue)}</div>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <div className="space-y-1 font-mono text-[10px]">
                                                        <div className="flex justify-between text-slate-500">
                                                            <span>{pct.toFixed(0)}%</span>
                                                            <span>{a.usefulLifeMonths}m</span>
                                                        </div>
                                                        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full ${pct >= 100 ? 'bg-slate-500' : 'bg-slate-900 dark:bg-slate-200'}`}
                                                                style={{ width: `${pct}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                                        a.status === 'ACTIVE'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                            : 'bg-slate-100 text-slate-600 border-slate-300'
                                                    }`}>
                                                        {a.status === 'ACTIVE' ? 'OPERATIVO' : 'AMORTIZADO'}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleViewAssetHistory(a)}
                                                        className="h-7 px-2.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold cursor-pointer"
                                                    >
                                                        Cédula
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* SUB-VISTA 2: CORRIDA MENSUAL DE DEPRECIACIÓN */}
            {assetSubTab === 'depreciation' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
                        <div>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold">
                                MOTOR DE AMORTIZACIÓN LÍNEA RECTA (NIC 16)
                            </span>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                                Contabilización Mensual de Desgaste Patrimonial
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
                                Calcula la alícuota mensual de cada activo operativo: <code className="font-mono">(Costo - Valor Salvamento) / Vida Útil</code> y genera el comprobante automático en el Libro Diario General.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 h-9 rounded border border-slate-200 dark:border-slate-700">
                                <Calendar size={14} className="text-slate-400" />
                                <input
                                    type="month"
                                    value={depreciationPeriod}
                                    onChange={(e) => setDepreciationPeriod(e.target.value)}
                                    className="bg-transparent font-mono text-xs font-bold text-slate-900 dark:text-white outline-none"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleRunDepreciation}
                                disabled={depreciating}
                                className="h-9 px-4 rounded bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                <RefreshCw size={13} className={depreciating ? 'animate-spin' : ''} />
                                <span>{depreciating ? 'Contabilizando...' : 'Ejecutar Corrida Mensual'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs font-mono">
                            <span className="font-bold uppercase text-slate-600 dark:text-slate-300">
                                Cédula de Proyección del Período ({depreciationPeriod})
                            </span>
                            <span className="font-bold text-rose-700 dark:text-rose-400">
                                Total Cargo Mensual: {fmtUSD(assetMetrics.monthlyQuota)} ({fmtBs(assetMetrics.monthlyQuota)})
                            </span>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {assetsList.filter(a => a.status === 'ACTIVE').length === 0 ? (
                                <div className="p-8 text-center text-slate-400">
                                    No hay activos operativos pendientes por depreciar.
                                </div>
                            ) : (
                                assetsList.filter(a => a.status === 'ACTIVE').map(a => (
                                    <div key={a.id} className="py-3 px-4 flex items-center justify-between">
                                        <div>
                                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300 mr-2">{a.code}</span>
                                            <span className="font-semibold text-slate-900 dark:text-white">{a.name}</span>
                                            <span className="text-[11px] font-mono text-slate-400 ml-3">
                                                Vida útil: {a.usefulLifeMonths}m • Libros actual: {fmtUSD(a.currentBookValue)}
                                            </span>
                                        </div>
                                        <div className="text-right font-mono tabular-nums">
                                            <span className="font-bold text-rose-700 dark:text-rose-400">-{fmtUSD(a.monthlyDepreciation)}</span>
                                            <span className="text-[10px] text-slate-400 ml-2">({fmtBs(a.monthlyDepreciation)})</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: INCORPORAR ACTIVO FIJO */}
            {isAssetModalOpen && (
                <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-lg max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                Incorporar Bien a Propiedad, Planta y Equipo (NIC 16)
                            </h3>
                            <button onClick={() => setIsAssetModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                            <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1.5">
                                Plantillas de Vida Útil Estándar (VEN-NIF):
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { label: '+ Nevera / Congelador (60m)', name: 'Nevera Exhibidora Comercial', cat: 'MACHINERY', months: '60' },
                                    { label: '+ Balanza Digital (36m)', name: 'Balanza Electrónica de Mostrador', cat: 'MACHINERY', months: '36' },
                                    { label: '+ Computador / POS (36m)', name: 'Estación Punto de Venta PC', cat: 'IT_EQUIPMENT', months: '36' },
                                    { label: '+ Estantería / Góndola (60m)', name: 'Módulo de Estantería Metálica', cat: 'FURNITURE', months: '60' }
                                ].map((tpl, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setNewAsset(prev => ({
                                            ...prev,
                                            name: tpl.name,
                                            category: tpl.cat,
                                            usefulLifeMonths: tpl.months
                                        }))}
                                        className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-100 cursor-pointer"
                                    >
                                        {tpl.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <form onSubmit={handleCreateAsset} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold text-slate-500 mb-1">Descripción Técnica del Bien *</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ej. Nevera Exhibidora 4 Puertas Acero Inox"
                                    value={newAsset.name}
                                    onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                                    className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-semibold"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Categoría Contable</label>
                                    <select
                                        value={newAsset.category}
                                        onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-semibold"
                                    >
                                        <option value="MACHINERY">Maquinaria y Refrigeración</option>
                                        <option value="IT_EQUIPMENT">Equipos de Cómputo y POS</option>
                                        <option value="FURNITURE">Mobiliario y Estantería</option>
                                        <option value="VEHICLE">Flota y Transporte</option>
                                        <option value="BUILDING">Inmuebles e Instalaciones</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Fecha de Adquisición *</label>
                                    <input
                                        type="date"
                                        required
                                        value={newAsset.purchaseDate}
                                        onChange={(e) => setNewAsset({ ...newAsset, purchaseDate: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Costo de Adquisición (USD) *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        placeholder="850.00"
                                        value={newAsset.purchaseCost}
                                        onChange={(e) => setNewAsset({ ...newAsset, purchaseCost: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono font-bold"
                                    />
                                    <span className="text-[10px] font-mono text-slate-400">
                                        Equiv: {fmtBs(newAsset.purchaseCost)}
                                    </span>
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Vida Útil Estimada (Meses) *</label>
                                    <input
                                        type="number"
                                        required
                                        value={newAsset.usefulLifeMonths}
                                        onChange={(e) => setNewAsset({ ...newAsset, usefulLifeMonths: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono font-bold"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Ubicación Física</label>
                                    <input
                                        type="text"
                                        placeholder="Pasillo Central / Caja 1"
                                        value={newAsset.location}
                                        onChange={(e) => setNewAsset({ ...newAsset, location: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Serial / Placa</label>
                                    <input
                                        type="text"
                                        placeholder="Opcional"
                                        value={newAsset.serialNumber}
                                        onChange={(e) => setNewAsset({ ...newAsset, serialNumber: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsAssetModalOpen(false)}
                                    className="h-9 px-4 bg-slate-100 dark:bg-slate-800 rounded text-slate-600 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="h-9 px-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded font-semibold cursor-pointer"
                                >
                                    Guardar Activo Fijo
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: HISTORIAL DE DEPRECIACIÓN DEL ACTIVO */}
            {isAssetHistoryOpen && selectedAssetForHistory && (
                <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-lg max-w-lg w-full p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div>
                                <span className="text-[10px] font-mono text-slate-400">{selectedAssetForHistory.code}</span>
                                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                                    Cédula Histórica de Amortización: {selectedAssetForHistory.name}
                                </h3>
                            </div>
                            <button onClick={() => setIsAssetHistoryOpen(false)} className="text-slate-400">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs font-mono">
                            {assetDepreciationLogs.length === 0 ? (
                                <p className="py-8 text-center font-sans text-slate-400">
                                    Aún no se han ejecutado corridas mensuales de depreciación para este bien.
                                </p>
                            ) : (
                                assetDepreciationLogs.map(log => (
                                    <div key={log.id} className="py-2.5 flex items-center justify-between">
                                        <div>
                                            <span className="font-bold text-slate-900 dark:text-white">Período {log.period}</span>
                                            {log.JournalEntry && (
                                                <span className="block text-[10px] text-slate-400">
                                                    Asiento: {log.JournalEntry.entryNumber}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-right tabular-nums">
                                            <span className="text-rose-700 dark:text-rose-400 font-bold">
                                                -{fmtUSD(log.depreciationAmount)}
                                            </span>
                                            <span className="block text-[10px] text-slate-500">
                                                Valor Libros tras cuota: {fmtUSD(log.bookValueAfter)}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
