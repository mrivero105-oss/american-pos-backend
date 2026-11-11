import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { 
    Search, Plus, Edit2, Trash2, Users, Star, Banknote, X, 
    History as HistoryIcon, Clock, MessageCircle, Download, 
    Upload, AlertCircle, CheckCircle, UserX, UserCheck, 
    FileText, Award, Eye, TrendingUp, CreditCard, ShieldCheck,
    Check, Copy, AlertTriangle, RefreshCw, ChevronRight, IdCard,
    ArrowUpRight, ArrowDownRight, MoreHorizontal, Phone, CheckCircle2
} from 'lucide-react';
import CustomerModal from '../components/CustomerModal';
import AbonoModal from '../components/AbonoModal';
import CreditHistoryModal from '../components/CreditHistoryModal';
import ReceiptModal from '../components/ReceiptModal';
import ConfirmModal from '../components/ConfirmModal';
import Customer360Modal from '../components/Customer360Modal';
import RedeemPointsModal from '../components/RedeemPointsModal';
import AccountStatementModal from '../components/AccountStatementModal';
import CustomerImportModal from '../components/CustomerImportModal';
import { db } from '../services/db';
import { formatMoney, fetchGlobalSettings, isUsdOnlyMode } from '../utils/format';
import { triggerHaptic } from '../utils/haptics';

export default function Customers() {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterTab, setFilterTab] = useState('all'); // 'all', 'debt', 'vip', 'inactive'
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [copiedDoc, setCopiedDoc] = useState(null);
    const limit = 30;

    // Custom debounce hook
    const useDebounce = (value, delay) => {
        const [debouncedValue, setDebouncedValue] = useState(value);
        useEffect(() => {
            const handler = setTimeout(() => setDebouncedValue(value), delay);
            return () => clearTimeout(handler);
        }, [value, delay]);
        return debouncedValue;
    };

    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [is360ModalOpen, setIs360ModalOpen] = useState(false);
    const [isRedeemModalOpen, setIsRedeemModalOpen] = useState(false);
    const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
    const [businessSettings, setBusinessSettings] = useState({});
    const [paymentMethods, setPaymentMethods] = useState([]);

    // Receipt Modal state
    const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
    const [selectedSale, setSelectedSale] = useState(null);

    // Confirm Modal state
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    useEffect(() => {
        setPage(1);
    }, [debouncedSearchTerm, filterTab]);

    useEffect(() => {
        fetchCustomers(page === 1);
        loadSettings();
        fetchBusinessSettings();
        fetchPaymentMethods();
    }, [debouncedSearchTerm, filterTab, page]);

    const loadSettings = async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    };

    const fetchBusinessSettings = async () => {
        try {
            const res = await api.get('/settings/business');
            setBusinessSettings(res.data || {});
        } catch (e) {
            console.error('Error fetching business settings', e);
        }
    };

    const fetchPaymentMethods = async () => {
        try {
            const { data } = await api.get('/settings/payment-methods');
            setPaymentMethods(data || []);
        } catch (e) {
            console.error('Error fetching payment methods:', e);
        }
    };

    const fetchCustomers = async (resetPage = false) => {
        try {
            if (resetPage) setLoading(true);
            const currentPage = resetPage ? 1 : page;
            const params = new URLSearchParams();
            params.append('limit', limit);
            params.append('page', currentPage);
            
            if (filterTab !== 'all') {
                params.append('filter', filterTab);
            }
            
            if (debouncedSearchTerm) {
                params.append('search', debouncedSearchTerm);
            }
            
            const res = await api.get(`/customers?${params.toString()}`);
            const customerData = Array.isArray(res.data) ? res.data : (res.data.customers || []);
            
            if (currentPage === 1) {
                setCustomers(customerData);
            } else {
                setCustomers(prev => {
                    const existingIds = new Set(prev.map(c => c.id));
                    const newCustomers = customerData.filter(c => !existingIds.has(c.id));
                    return [...prev, ...newCustomers];
                });
            }
            setHasMore(res.data.totalPages ? currentPage < res.data.totalPages : false);
        } catch (error) {
            console.error('Error fetching customers, falling back to local DB', error);
            if (page === 1) {
                const localCustomers = await db.getAll('customers');
                setCustomers(Array.isArray(localCustomers) ? localCustomers : []);
                setHasMore(false);
            }
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    const handleRefresh = () => {
        triggerHaptic('light');
        setIsRefreshing(true);
        fetchCustomers(true);
    };

    const handleCreateCustomer = () => {
        triggerHaptic('light');
        setSelectedCustomer(null);
        setIsModalOpen(true);
    };

    const handleEditCustomer = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsModalOpen(true);
    };

    const handleOpen360 = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIs360ModalOpen(true);
    };

    const handleOpenRedeem = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsRedeemModalOpen(true);
    };

    const handleOpenStatement = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsStatementModalOpen(true);
    };

    const handleDeleteCustomer = (id) => {
        triggerHaptic('medium');
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Cliente',
            message: '¿Seguro que desea eliminar este cliente? Esta acción no se puede deshacer.',
            variant: 'danger',
            confirmText: 'Eliminar Cliente',
            action: async () => {
                try {
                    await api.delete(`/customers/${id}`);
                    toast.success('Cliente eliminado exitosamente');
                    fetchCustomers(true);
                } catch (error) {
                    if (error.response?.status === 409 && error.response?.data?.code === 'ENTITY_HAS_DEPENDENCIES') {
                        setTimeout(() => {
                            setConfirmConfig({
                                isOpen: true,
                                title: 'Inactivar Cliente',
                                message: 'Este cliente tiene historial de compras o créditos en el sistema y no puede borrarse físicamente por seguridad contable. ¿Deseas archivarlo/inactivarlo?',
                                variant: 'primary',
                                confirmText: 'Inactivar y Archivar',
                                action: async () => {
                                    try {
                                        await api.put(`/customers/${id}`, { isActive: false });
                                        toast.success('Cliente inactivado y archivado correctamente');
                                        fetchCustomers(true);
                                    } catch (_err) {
                                        toast.error('Error al inactivar cliente');
                                    }
                                }
                            });
                        }, 300);
                    } else {
                        console.error('Error deleting customer', error);
                        const msg = error.response?.data?.error || 'Error al eliminar cliente';
                        toast.error(msg);
                    }
                }
            }
        });
    };

    const handleToggleActive = async (customer) => {
        triggerHaptic('light');
        const newStatus = customer.isActive === false ? true : false;
        try {
            await api.put(`/customers/${customer.id}`, { isActive: newStatus });
            toast.success(newStatus ? 'Cliente reactivado con éxito' : 'Cliente archivado');
            fetchCustomers(true);
        } catch (error) {
            toast.error('Error al actualizar estado del cliente');
        }
    };

    const handleSaveCustomer = async (customerData) => {
        try {
            setProcessing(true);
            if (selectedCustomer) {
                await api.put(`/customers/${selectedCustomer.id}`, customerData);
                toast.success('Cliente actualizado con éxito');
            } else {
                await api.post('/customers', customerData);
                toast.success('Cliente creado con éxito');
            }
            fetchCustomers(true);
            setIsModalOpen(false);
        } catch (error) {
            console.error('Error saving customer', error);
            toast.error('Error al guardar cliente: ' + (error.response?.data?.error || error.message));
        } finally {
            setProcessing(false);
        }
    };

    const handleOpenHistory = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsHistoryModalOpen(true);
    };

    const handleViewReceipt = async (saleId) => {
        try {
            const res = await api.get(`/sales/${saleId}`);
            setSelectedSale(res.data);
            setIsReceiptModalOpen(true);
        } catch (error) {
            console.error('Error fetching sale details:', error);
            toast.error('Error al obtener los detalles de la venta');
        }
    };

    const handleRegisterAbono = (customer) => {
        triggerHaptic('light');
        setSelectedCustomer(customer);
        setIsAbonoModalOpen(true);
    };

    const handleSaveAbono = async (abonoData) => {
        try {
            setProcessing(true);
            await api.post(`/customers/${abonoData.customerId}/payment`, {
                amount: abonoData.amount,
                currency: abonoData.currency || 'USD',
                exchangeRate: abonoData.exchangeRate || settings.rate || 1,
                method: abonoData.method,
                notes: abonoData.notes,
                saleIds: abonoData.saleIds,
                cryptoRate: abonoData.cryptoRate,
                cryptoAmount: abonoData.cryptoAmount,
                reference: abonoData.reference
            });
            toast.success('Abono registrado con éxito y sincronizado a caja');
            fetchCustomers(true);
            setIsAbonoModalOpen(false);
        } catch (error) {
            console.error('Error registering payment:', error);
            toast.error('Error al registrar abono: ' + (error.response?.data?.error || error.message));
        } finally {
            setProcessing(false);
        }
    };

    const handleExportCSV = async () => {
        try {
            const toastId = toast.loading('Exportando cartera de clientes...');
            const response = await api.get('/customers/export', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `cartera_clientes_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.dismiss(toastId);
            toast.success('Cartera exportada exitosamente');
        } catch (error) {
            console.error('Error exporting customers:', error);
            toast.error('Error al exportar cartera de clientes');
        }
    };

    const handleSendWhatsAppDebtReminder = (customer) => {
        triggerHaptic('light');
        if (!customer.phone) {
            toast.error('El cliente no tiene un número telefónico registrado');
            return;
        }
        const debtUsd = parseFloat(customer.creditBalance) || 0;
        const rate = settings.rate || 1;
        const debtBs = (debtUsd * rate).toFixed(2);
        const bizName = businessSettings.name || 'American POS';
        
        let message = `Estimado(a) *${customer.name}*, le contactamos de *${bizName}*.\n\n`;
        if (debtUsd > 0) {
            message += `Le recordamos amablemente que mantiene un saldo pendiente de *$${debtUsd.toFixed(2)} USD* (${debtBs} Bs).\n\n`;
            message += `Agradecemos coordinar la conciliación de su cuenta. Si ya realizó su transferencia o abono, por favor compártanos el comprobante por este medio.\n\n`;
        } else {
            message += `Nos comunicamos para saludarle y agradecer su preferencia. Estamos a su completa disposición.\n\n`;
        }
        message += `Saludos cordiales.`;

        const phone = customer.phone.replace(/[^0-9]/g, '');
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    };

    const handleCopyDoc = (doc, e) => {
        e?.stopPropagation();
        if (!doc || doc === '---') return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(doc);
        }
        setCopiedDoc(doc);
        toast.success(`Documento ${doc} copiado`, { duration: 1500 });
        setTimeout(() => setCopiedDoc(null), 2000);
    };

    // Infinite Scroll Intersection Observer
    const observer = useRef(null);
    const lastCustomerElementRef = useCallback(node => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                setPage(prev => prev + 1);
            }
        }, { threshold: 0.1 });
        if (node) observer.current.observe(node);
    }, [loading, hasMore]);

    // Financial & Portfolio Metrics
    const metrics = useMemo(() => {
        let totalExposure = 0;
        let totalDebtCount = 0;
        let totalLoyaltyPoints = 0;
        let totalCreditLimit = 0;
        let vipCount = 0;
        let activeCount = 0;

        customers.forEach(c => {
            const bal = parseFloat(c.creditBalance) || 0;
            const lim = parseFloat(c.creditLimit) || 0;
            const pts = parseFloat(c.loyaltyPoints) || 0;

            if (bal > 0) {
                totalExposure += bal;
                totalDebtCount++;
            }
            totalCreditLimit += lim;
            totalLoyaltyPoints += pts;
            if (c.isVIP) vipCount++;
            if (c.isActive !== false) activeCount++;
        });

        return {
            totalExposure,
            totalDebtCount,
            totalLoyaltyPoints,
            totalCreditLimit,
            vipCount,
            activeCount,
            totalCustomers: customers.length
        };
    }, [customers]);

    // Format currency display helpers
    const formatNumber = (num) => {
        return Number(num || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    return (
        <div className="space-y-5 pb-24 pb-safe animate-in fade-in duration-300">
            {/* Header Corporativo Nivel ERP */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Título y subtítulo */}
                        <div>
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300">
                                    <Users size={18} />
                                </div>
                                <div>
                                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                        Gestión de Clientes
                                    </h1>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Directorio comercial, cuentas por cobrar y fidelización
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Barra de Acciones Superior */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-0.5 shadow-2xs">
                                <button
                                    type="button"
                                    onClick={handleRefresh}
                                    disabled={loading || isRefreshing}
                                    className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                    title="Actualizar catálogo de clientes"
                                >
                                    <RefreshCw size={13} className={loading || isRefreshing ? 'animate-spin text-primary-500' : ''} />
                                    <span className="hidden sm:inline">Actualizar</span>
                                </button>

                                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

                                <button
                                    type="button"
                                    onClick={() => setIsImportModalOpen(true)}
                                    className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                    title="Importar clientes desde archivo Excel o CSV"
                                >
                                    <Upload size={13} />
                                    <span>Importar</span>
                                </button>

                                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

                                <button
                                    type="button"
                                    onClick={handleExportCSV}
                                    className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                                    title="Exportar cartera a archivo CSV"
                                >
                                    <Download size={13} />
                                    <span>Exportar</span>
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={handleCreateCustomer}
                                className="h-9 px-4 inline-flex items-center justify-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                            >
                                <Plus size={15} />
                                <span>Nuevo Cliente</span>
                            </button>
                        </div>
                    </div>

                    {/* Toolbar de Filtros y Búsqueda */}
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                        {/* Segmented Control */}
                        <div className="inline-flex items-center overflow-x-auto p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 gap-1 text-xs">
                            <button
                                type="button"
                                onClick={() => setFilterTab('all')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 cursor-pointer ${
                                    filterTab === 'all'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                Todos ({metrics.totalCustomers})
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterTab('debt')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                    filterTab === 'debt'
                                        ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-2xs font-semibold'
                                        : metrics.totalDebtCount > 0
                                            ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/20'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <span>Con Saldo Pendiente</span>
                                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${
                                    filterTab === 'debt'
                                        ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                                }`}>
                                    {metrics.totalDebtCount}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterTab('vip')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
                                    filterTab === 'vip'
                                        ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Star size={12} fill={filterTab === 'vip' ? 'currentColor' : 'none'} className="text-amber-500" />
                                <span>VIP ({metrics.vipCount})</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setFilterTab('inactive')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 cursor-pointer ${
                                    filterTab === 'inactive'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                Archivados
                            </button>
                        </div>

                        {/* Campo de Búsqueda */}
                        <div className="relative flex-1 md:max-w-md">
                            <Search size={14} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar por razón social, cédula, RIF o teléfono..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="block w-full h-9 pl-9 pr-8 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                            />
                            {searchTerm && (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tarjetas de Métricas Ejecutivas / KPIs */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {/* Tarjeta 1: Cartera de Clientes */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Cartera Registrada
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <Users size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {metrics.totalCustomers}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {metrics.activeCount} activos · {metrics.vipCount} VIP
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 2: Cuentas por Cobrar (Deuda) */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Cuentas por Cobrar
                            </span>
                            <div className="w-7 h-7 rounded-md bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30">
                                <Banknote size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-rose-600 dark:text-rose-400 tracking-tight font-mono">
                                $ {formatNumber(metrics.totalExposure)}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {metrics.totalDebtCount > 0 ? (
                                    <span className="text-rose-600 dark:text-rose-400 font-medium">
                                        {metrics.totalDebtCount} con saldo pendiente
                                    </span>
                                ) : (
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                        Cartera 100% solvente
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 3: Puntos de Lealtad */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Puntos Otorgados
                            </span>
                            <div className="w-7 h-7 rounded-md bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
                                <Award size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {formatNumber(metrics.totalLoyaltyPoints)}{' '}
                                <span className="text-xs font-normal text-slate-500">pts</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Fidelización comercial activa
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 4: Línea de Crédito Autorizada */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Crédito Autorizado
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <CreditCard size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                $ {formatNumber(metrics.totalCreditLimit)}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Capacidad crediticia global
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid de Datos Principal */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    {/* Vista Desktop / Tabla */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                                    <th className="px-4 py-3 text-left">Cliente / Razón Social</th>
                                    <th className="px-4 py-3 text-left">Documento / RIF</th>
                                    <th className="px-4 py-3 text-right">Fidelidad</th>
                                    <th className="px-4 py-3 text-right">Límite Crédito</th>
                                    <th className="px-4 py-3 text-right">Saldo Pendiente</th>
                                    <th className="px-4 py-3 text-center">Estado</th>
                                    <th className="px-4 py-3 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {loading && page === 1 ? (
                                    <tr>
                                        <td colSpan="7" className="py-20 text-center">
                                            <div className="inline-flex flex-col items-center gap-2 text-slate-600 dark:text-slate-300">
                                                <RefreshCw size={22} className="animate-spin text-primary-500 mb-1" />
                                                <span className="font-medium text-xs">Cargando directorio de clientes...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : customers.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="py-16 text-center">
                                            <div className="max-w-sm mx-auto space-y-2.5">
                                                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                                                    <Users size={20} />
                                                </div>
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                    No se encontraron clientes
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    No hay registros que coincidan con los filtros aplicados.
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={handleCreateCustomer}
                                                    className="mt-2 px-3.5 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                                                >
                                                    Registrar Nuevo Cliente
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    customers.map((customer) => {
                                        const creditBal = parseFloat(customer.creditBalance) || 0;
                                        const loyaltyPts = parseFloat(customer.loyaltyPoints) || 0;
                                        const creditLim = parseFloat(customer.creditLimit) || 0;
                                        const hasDebt = creditBal > 0;
                                        const isInactive = customer.isActive === false;
                                        const rate = settings.rate || 1;
                                        const isUsd = isUsdOnlyMode(settings);
                                        const refBs = (creditBal * rate).toFixed(2);

                                        return (
                                            <tr 
                                                key={customer.id} 
                                                className={`transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30 ${
                                                    isInactive ? 'opacity-60 bg-slate-50/40 dark:bg-slate-800/10' : ''
                                                }`}
                                            >
                                                {/* 1. Cliente / Razón Social */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div 
                                                            onClick={() => handleOpen360(customer)}
                                                            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0 cursor-pointer hover:border-primary-500 transition-colors"
                                                            title="Ver expediente 360°"
                                                        >
                                                            {(customer.name || '').charAt(0).toUpperCase() || 'C'}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpen360(customer)}
                                                                    className="font-medium text-slate-900 dark:text-white truncate hover:text-primary-600 dark:hover:text-primary-400 transition-colors text-left cursor-pointer"
                                                                    title="Ver expediente 360°"
                                                                >
                                                                    {customer.name}
                                                                </button>
                                                                {!!customer.isVIP && (
                                                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-1.5 py-0.2 rounded">
                                                                        <Star size={9} fill="currentColor" /> VIP
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {customer.phone ? (
                                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono block mt-0.5">
                                                                    {customer.phone}
                                                                </span>
                                                            ) : (
                                                                <span className="text-[11px] text-slate-400 dark:text-slate-500 block mt-0.5">
                                                                    Sin teléfono
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* 2. Documento */}
                                                <td className="px-4 py-3">
                                                    {customer.idDocument && customer.idDocument !== '---' ? (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleCopyDoc(customer.idDocument, e)}
                                                            className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group cursor-pointer"
                                                            title="Copiar documento"
                                                        >
                                                            <span>{customer.idDocument}</span>
                                                            {copiedDoc === customer.idDocument ? (
                                                                <Check size={12} className="text-emerald-500" />
                                                            ) : (
                                                                <Copy size={12} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                            )}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-400 font-mono text-xs">---</span>
                                                    )}
                                                </td>

                                                {/* 3. Fidelidad (Puntos) */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex items-center gap-1.5">
                                                        <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            {formatNumber(loyaltyPts)} <span className="text-[10px] font-normal text-slate-500">pts</span>
                                                        </span>
                                                        {loyaltyPts > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenRedeem(customer)}
                                                                className="text-[10px] font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                                                                title="Canjear puntos de lealtad"
                                                            >
                                                                Canjear
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* 4. Límite de Crédito */}
                                                <td className="px-4 py-3 text-right">
                                                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                                                        $ {formatNumber(creditLim)}
                                                    </span>
                                                </td>

                                                {/* 5. Saldo Deudor */}
                                                <td className="px-4 py-3 text-right">
                                                    {hasDebt ? (
                                                        <div className="inline-flex flex-col items-end">
                                                            <span className="font-mono font-bold text-xs text-rose-600 dark:text-rose-400">
                                                                $ {formatNumber(creditBal)}
                                                            </span>
                                                            {!isUsd && (
                                                                <span className="text-[10px] font-mono text-slate-400">
                                                                    Ref. Bs {formatNumber(refBs)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                                                            $ 0.00
                                                        </span>
                                                    )}
                                                </td>

                                                {/* 6. Estado */}
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleActive(customer)}
                                                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                                        title="Alternar estado activo/archivado"
                                                    >
                                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                                            isInactive ? 'bg-slate-400' : 'bg-emerald-500'
                                                        }`} />
                                                        <span className={isInactive ? 'text-slate-500' : 'text-slate-700 dark:text-slate-300'}>
                                                            {isInactive ? 'Archivado' : 'Activo'}
                                                        </span>
                                                    </button>
                                                </td>

                                                {/* 7. Acciones Profesionales Organizadas */}
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex items-center justify-end gap-1.5">
                                                        {/* Acción Primaria Contextual: Cobrar si debe, o Ver Ficha si está solvente */}
                                                        {hasDebt ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRegisterAbono(customer)}
                                                                className="h-7 px-2.5 inline-flex items-center gap-1 bg-primary-600 hover:bg-primary-700 text-white rounded-md text-xs font-medium shadow-2xs transition-colors cursor-pointer"
                                                                title="Registrar abono / cobranza"
                                                            >
                                                                <Banknote size={13} />
                                                                <span>Abonar</span>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpen360(customer)}
                                                                className="h-7 px-2.5 inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md text-xs font-medium transition-colors cursor-pointer"
                                                                title="Ver expediente 360°"
                                                            >
                                                                <Eye size={13} />
                                                                <span>Ficha</span>
                                                            </button>
                                                        )}

                                                        {/* Canal WhatsApp si tiene número registrado */}
                                                        {customer.phone && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSendWhatsAppDebtReminder(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800/40 transition-colors cursor-pointer"
                                                                title={hasDebt ? "Enviar recordatorio formal por WhatsApp" : "Contactar por WhatsApp"}
                                                            >
                                                                <MessageCircle size={14} />
                                                            </button>
                                                        )}

                                                        {/* Botonera de Mantenimiento Agrupada */}
                                                        <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-x divide-slate-200 dark:divide-slate-700 shadow-2xs">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenStatement(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                                title="Estado de cuenta oficial (PDF/Extracto)"
                                                            >
                                                                <FileText size={13} />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenHistory(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                                title="Historial de compras y créditos"
                                                            >
                                                                <HistoryIcon size={13} />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() => handleEditCustomer(customer)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                                title="Editar cliente"
                                                            >
                                                                <Edit2 size={13} />
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteCustomer(customer.id)}
                                                                className="w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                                                                title="Eliminar o archivar cliente"
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Vista Móvil / Tarjetas Estructuradas */}
                    <div className="md:hidden p-3.5 space-y-3">
                        {loading && page === 1 ? (
                            <div className="py-12 text-center text-slate-500 font-medium text-xs flex flex-col items-center gap-2">
                                <RefreshCw size={20} className="animate-spin text-primary-500" />
                                <span>Cargando clientes...</span>
                            </div>
                        ) : customers.length === 0 ? (
                            <div className="py-12 text-center text-slate-400 space-y-2">
                                <Users size={32} className="mx-auto opacity-40" />
                                <p className="text-xs font-semibold">Sin clientes registrados</p>
                            </div>
                        ) : (
                            customers.map((customer) => {
                                const creditBal = parseFloat(customer.creditBalance) || 0;
                                const loyaltyPts = parseFloat(customer.loyaltyPoints) || 0;
                                const creditLim = parseFloat(customer.creditLimit) || 0;
                                const hasDebt = creditBal > 0;
                                const isInactive = customer.isActive === false;
                                const rate = settings.rate || 1;
                                const isUsd = isUsdOnlyMode(settings);
                                const refBs = (creditBal * rate).toFixed(2);

                                return (
                                    <div 
                                        key={customer.id} 
                                        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-2xs ${
                                            isInactive ? 'opacity-60 bg-slate-50/50 dark:bg-slate-850' : ''
                                        }`}
                                    >
                                        {/* Fila 1: Avatar, Nombre y Saldo Pendiente */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div 
                                                onClick={() => handleOpen360(customer)}
                                                className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                                            >
                                                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-300 shrink-0">
                                                    {(customer.name || '').charAt(0).toUpperCase() || 'C'}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                                            {customer.name}
                                                        </h4>
                                                        {!!customer.isVIP && (
                                                            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800/40">
                                                                VIP
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                                        {customer.idDocument || 'Sin documento'}{customer.phone ? ` · ${customer.phone}` : ''}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Saldo Deudor Badge */}
                                            <div className="shrink-0 text-right">
                                                {hasDebt ? (
                                                    <div className="inline-flex flex-col items-end">
                                                        <span className="font-mono font-bold text-xs text-rose-600 dark:text-rose-400">
                                                            $ {formatNumber(creditBal)}
                                                        </span>
                                                        {!isUsd && (
                                                            <span className="text-[10px] font-mono text-slate-400">
                                                                Ref. Bs {formatNumber(refBs)}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] font-mono text-slate-400">
                                                        $ 0.00
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Fila 2: Indicadores de Crédito y Fidelidad */}
                                        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <div>
                                                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Límite Crédito</span>
                                                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                                    $ {formatNumber(creditLim)}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Puntos Fidelidad</span>
                                                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                                    {formatNumber(loyaltyPts)} pts
                                                </span>
                                            </div>
                                        </div>

                                        {/* Fila 3: Acciones Rápidas */}
                                        <div className="flex items-center gap-1.5 pt-1">
                                            {customer.phone && (
                                                <button 
                                                    type="button"
                                                    onClick={() => handleSendWhatsAppDebtReminder(customer)}
                                                    className="h-8 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 border border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                                                >
                                                    <MessageCircle size={13} />
                                                    <span>WhatsApp</span>
                                                </button>
                                            )}

                                            {hasDebt && (
                                                <button 
                                                    type="button"
                                                    onClick={() => handleRegisterAbono(customer)}
                                                    className="flex-1 h-8 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 bg-primary-600 hover:bg-primary-700 text-white transition-colors cursor-pointer shadow-2xs"
                                                >
                                                    <Banknote size={13} />
                                                    <span>Abonar</span>
                                                </button>
                                            )}

                                            <button 
                                                type="button"
                                                onClick={() => handleOpen360(customer)}
                                                className="flex-1 h-8 px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                            >
                                                <Eye size={13} />
                                                <span>Ficha 360°</span>
                                            </button>

                                            <button 
                                                type="button"
                                                onClick={() => handleEditCustomer(customer)}
                                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                                title="Editar cliente"
                                            >
                                                <Edit2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Barra de Paginación y Resumen */}
                    <div className="px-4 py-3 bg-slate-50/60 dark:bg-slate-800/20 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                            Mostrando <strong className="font-semibold text-slate-700 dark:text-slate-300 font-mono">{customers.length}</strong> clientes en cartera
                        </span>

                        {hasMore && !loading && (
                            <div ref={lastCustomerElementRef} className="inline-flex items-center gap-2 text-xs text-slate-400">
                                <div className="w-3.5 h-3.5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                                <span>Cargando más clientes...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Sub-Modales del Módulo de Clientes */}
            <CustomerModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                onSave={handleSaveCustomer} 
                customer={selectedCustomer} 
                processing={processing} 
            />
            
            <AbonoModal 
                isOpen={isAbonoModalOpen} 
                onClose={() => setIsAbonoModalOpen(false)} 
                onSave={handleSaveAbono} 
                customer={selectedCustomer} 
                processing={processing} 
            />

            <CreditHistoryModal 
                isOpen={isHistoryModalOpen} 
                onClose={() => setIsHistoryModalOpen(false)} 
                customerId={selectedCustomer?.id} 
                onViewReceipt={handleViewReceipt}
            />

            <Customer360Modal
                isOpen={is360ModalOpen}
                onClose={() => setIs360ModalOpen(false)}
                customerId={selectedCustomer?.id}
                onOpenAbono={handleRegisterAbono}
                onOpenHistory={handleOpenHistory}
                onOpenStatement={handleOpenStatement}
                onOpenRedeem={handleOpenRedeem}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
            />

            <RedeemPointsModal
                isOpen={isRedeemModalOpen}
                onClose={() => setIsRedeemModalOpen(false)}
                customer={selectedCustomer}
                onSuccess={() => fetchCustomers(true)}
            />

            <AccountStatementModal
                isOpen={isStatementModalOpen}
                onClose={() => setIsStatementModalOpen(false)}
                customer={selectedCustomer}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
            />

            <CustomerImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSuccess={() => fetchCustomers(true)}
            />

            <ReceiptModal
                isOpen={isReceiptModalOpen}
                onClose={() => setIsReceiptModalOpen(false)}
                sale={selectedSale}
                businessSettings={businessSettings}
                exchangeRate={settings.rate}
                currencyMode={settings.currencyMode}
                paymentMethods={paymentMethods}
            />

            <ConfirmModal 
                isOpen={confirmConfig.isOpen} 
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} 
                onConfirm={confirmConfig.action} 
                title={confirmConfig.title} 
                message={confirmConfig.message} 
                variant={confirmConfig.variant} 
                confirmText={confirmConfig.confirmText} 
            />
        </div>
    );
}
