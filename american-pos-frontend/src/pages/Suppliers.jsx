import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import {
    Search, 
    Plus, 
    Edit2, 
    Trash2, 
    Truck, 
    X, 
    Phone, 
    History, 
    Download, 
    Upload, 
    Package, 
    MessageCircle, 
    ShoppingBag, 
    CheckCircle2, 
    Clock, 
    XCircle, 
    DollarSign, 
    Eye, 
    FileText, 
    PackageCheck, 
    ChevronDown, 
    ChevronUp, 
    Globe, 
    Building2
} from 'lucide-react';
import SupplierModal from '../components/SupplierModal';
import ConfirmModal from '../components/ConfirmModal';
import SupplierCreditModal from '../components/SupplierCreditModal';
import SupplierProductsModal from '../components/SupplierProductsModal';
import PurchaseOrderModal from '../components/PurchaseOrderModal';
import InvoiceViewerModal from '../components/InvoiceViewerModal';
import OrderReceptionModal from '../components/OrderReceptionModal';
import SupplierLogoSearchModal from '../components/SupplierLogoSearchModal';
import SupplierLogoBox from '../components/SupplierLogoBox';
import { isDollarOnlyCountry, isSingleCurrencyMode } from '../utils/format';

export default function Suppliers({ defaultTab = null } = {}) {
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const effectiveCountry = localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = isDollarCountry || isSingleCurrencyMode();

    // Default tab based on prop, URL path or search query (?tab=orders)
    const initialTab = (defaultTab === 'orders' || location.pathname === '/purchase-orders' || searchParams.get('tab') === 'orders') ? 'orders' : 'suppliers';
    const [activeTab, setActiveTab] = useState(initialTab);

    // --- State: Suppliers ---
    const [suppliers, setSuppliers] = useState([]);
    const [suppliersLoading, setSuppliersLoading] = useState(true);
    const [supplierSearchTerm, setSupplierSearchTerm] = useState('');
    const [supplierBalanceFilter, setSupplierBalanceFilter] = useState('all'); // all, with_debt, solvent

    // --- State: Purchase Orders ---
    const [orders, setOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [orderSearchTerm, setOrderSearchTerm] = useState('');
    const [orderStatusFilter, setOrderStatusFilter] = useState('all'); // all, pending, received, cancelled, with_invoice
    const [expandedOrder, setExpandedOrder] = useState(null);
    const [sendingWaId, setSendingWaId] = useState(null);

    // --- Modals State ---
    const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
    const [isProductsModalOpen, setIsProductsModalOpen] = useState(false);
    const [isPurchaseOrderModalOpen, setIsPurchaseOrderModalOpen] = useState(false);
    const [orderSupplierId, setOrderSupplierId] = useState(null);
    const [viewerInvoice, setViewerInvoice] = useState({ isOpen: false, url: '', details: {} });
    const [receptionModalOrder, setReceptionModalOrder] = useState(null);
    const [logoSearchSupplier, setLogoSearchSupplier] = useState(null);

    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    const [bcvRate, setBcvRate] = useState(null);

    useEffect(() => {
        if (location.pathname === '/purchase-orders' || searchParams.get('tab') === 'orders') {
            setActiveTab('orders');
        } else if (searchParams.get('tab') === 'suppliers') {
            setActiveTab('suppliers');
        }
    }, [location.pathname, searchParams]);

    const fetchBcvRate = useCallback(async () => {
        try {
            const res = await api.get('/suppliers/bcv-rate');
            if (res.data && Number(res.data.rate) > 0) {
                setBcvRate(Number(res.data.rate));
            }
        } catch (e) {
            console.warn('Error al obtener tasa BCV en Proveedores:', e);
        }
    }, []);

    const fetchSuppliers = useCallback(async () => {
        try {
            setSuppliersLoading(true);
            const res = await api.get('/suppliers');
            setSuppliers(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error('Error fetching suppliers:', error);
        } finally {
            setSuppliersLoading(false);
        }
    }, []);

    const fetchOrders = useCallback(async () => {
        try {
            setOrdersLoading(true);
            const res = await api.get('/purchase-orders');
            setOrders(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setOrdersLoading(false);
        }
    }, []);

    const fetchAll = useCallback(() => {
        fetchSuppliers();
        fetchOrders();
        fetchBcvRate();
    }, [fetchSuppliers, fetchOrders, fetchBcvRate]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // --- Supplier Handlers ---
    const handleCreateSupplier = () => {
        setSelectedSupplier(null);
        setIsSupplierModalOpen(true);
    };

    const handleEditSupplier = (supplier) => {
        setSelectedSupplier(supplier);
        setIsSupplierModalOpen(true);
    };

    const handleOpenOrderModalForSupplier = (supplier) => {
        setSelectedSupplier(supplier);
        setOrderSupplierId(supplier?.id || null);
        setIsPurchaseOrderModalOpen(true);
    };

    const handleSaveSupplier = async (supplierData, selectedFile) => {
        try {
            setProcessing(true);
            let dataToSend = supplierData;
            let config = {};

            if (selectedFile) {
                dataToSend = new FormData();
                dataToSend.append('data', JSON.stringify(supplierData));
                dataToSend.append('logo', selectedFile);
                config = { headers: { 'Content-Type': 'multipart/form-data' } };
            }

            if (selectedSupplier) {
                await api.put(`/suppliers/${selectedSupplier.id}`, dataToSend, config);
                toast.success('Proveedor actualizado correctamente');
            } else {
                await api.post('/suppliers', dataToSend, config);
                toast.success('Proveedor creado exitosamente');
            }
            fetchSuppliers();
            setIsSupplierModalOpen(false);
        } catch (error) {
            console.error('Error saving supplier', error);
            toast.error('Error al guardar proveedor');
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteSupplier = (id) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Proveedor',
            message: '¿Seguro que desea eliminar este proveedor? Esta acción no se puede deshacer.',
            variant: 'danger',
            confirmText: 'Eliminar Proveedor',
            action: async () => {
                try {
                    await api.delete(`/suppliers/${id}`);
                    toast.success('Proveedor eliminado exitosamente');
                    fetchSuppliers();
                } catch (error) {
                    if (error.response?.status === 409 && error.response?.data?.code === 'ENTITY_HAS_DEPENDENCIES') {
                        setTimeout(() => {
                            setConfirmConfig({
                                isOpen: true,
                                title: 'Inactivar Proveedor',
                                message: 'Este proveedor tiene historial de compras o deudas y no puede borrarse físicamente. ¿Deseas inactivarlo?',
                                variant: 'primary',
                                confirmText: 'Inactivar Proveedor',
                                action: async () => {
                                    try {
                                        await api.put(`/suppliers/${id}`, { isActive: false });
                                        toast.success('Proveedor inactivado correctamente');
                                        fetchSuppliers();
                                    } catch (_err) {
                                        toast.error('Error al inactivar proveedor');
                                    }
                                }
                            });
                        }, 300);
                    } else {
                        console.error('Error deleting supplier', error);
                        toast.error(error.response?.data?.error || 'Error al eliminar proveedor');
                    }
                }
            }
        });
    };

    const handleExportSuppliers = async () => {
        try {
            const res = await api.get('/suppliers/export');
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `proveedores_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            toast.success('Lista de proveedores exportada');
        } catch (error) {
            console.error('Error exporting suppliers', error);
            toast.error('Error al exportar proveedores');
        }
    };

    const handleImportSuppliers = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = JSON.parse(event.target.result);
                await api.post('/suppliers/import', json);
                toast.success('Proveedores importados exitosamente');
                fetchSuppliers();
            } catch (err) {
                console.error('Error importing suppliers:', err);
                toast.error('Archivo no válido o error al importar');
            }
        };
        reader.readAsText(file);
    };

    // --- Purchase Order Handlers ---
    const handleCreateOrder = async (orderData) => {
        try {
            setProcessing(true);
            await api.post('/purchase-orders', orderData);
            toast.success('Orden de compra registrada exitosamente');
            fetchAll();
            setIsPurchaseOrderModalOpen(false);
        } catch (error) {
            console.error('Error creating order:', error);
            toast.error('Error al crear la orden: ' + (error.response?.data?.error || error.message));
        } finally {
            setProcessing(false);
        }
    };

    const handleReceiveOrder = (order) => {
        setReceptionModalOrder(order);
    };



    const handleTogglePaymentStatus = (order) => {
        const isPaid = order.paymentStatus === 'paid';
        const targetStatus = isPaid ? 'unpaid' : 'paid';
        const targetLabel = isPaid ? 'POR PAGAR' : 'PAGADA';

        setConfirmConfig({
            isOpen: true,
            title: `Marcar Factura como ${targetLabel}`,
            message: `¿Deseas cambiar el estado de la factura #${order.referenceNumber || order.id.slice(0, 8)} a ${targetLabel}? Esto actualizará el balance de cuenta del proveedor.`,
            variant: isPaid ? 'warning' : 'success',
            confirmText: `Marcar como ${targetLabel}`,
            action: async () => {
                try {
                    setProcessing(true);
                    await api.put(`/purchase-orders/${order.id}/payment-status`, {
                        paymentStatus: targetStatus,
                        updateSupplierBalance: true
                    });
                    toast.success(`Factura marcada como ${targetLabel}`);
                    fetchAll();
                } catch (error) {
                    console.error('Error updating payment status:', error);
                    toast.error('Error al actualizar estado: ' + (error.response?.data?.error || error.message));
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const handleDeleteOrder = (id, orderStatus = 'pending') => {
        const isReceived = orderStatus === 'received';
        setConfirmConfig({
            isOpen: true,
            title: isReceived ? 'Eliminar Factura / Albarán Recibido' : 'Eliminar Orden',
            message: isReceived 
                ? '¿Deseas eliminar permanentemente esta factura/albarán? Se revertirá automáticamente el stock ingresado y el saldo pendiente con el proveedor.' 
                : '¿Deseas eliminar permanentemente esta orden? Esta acción no se puede deshacer.',
            variant: 'danger',
            confirmText: 'Eliminar Permanente',
            action: async () => {
                try {
                    setProcessing(true);
                    await api.delete(`/purchase-orders/${id}`);
                    toast.success('Orden eliminada exitosamente');
                    fetchOrders();
                } catch (error) {
                    console.error('Error deleting order:', error);
                    toast.error('Error al eliminar: ' + (error.response?.data?.error || error.message));
                } finally {
                    setProcessing(false);
                }
            }
        });
    };

    const handleSendWhatsApp = async (order) => {
        const supplierObj = suppliers.find(s => String(s.id) === String(order.supplierId));
        const targetPhone = supplierObj?.phone;

        setSendingWaId(order.id);
        const toastId = toast.loading('Procesando envío de orden a WhatsApp...');
        try {
            const res = await api.post(`/purchase-orders/${order.id}/send-whatsapp`, {
                phone: targetPhone
            });
            toast.dismiss(toastId);

            if (res.data?.botSent) {
                toast.success(`Pedido enviado por WhatsApp a ${res.data.supplierName || 'Proveedor'}`);
            } else if (res.data?.whatsappUrl) {
                window.open(res.data.whatsappUrl, '_blank');
                toast.success(`Abriendo WhatsApp para ${res.data.supplierName || 'Proveedor'}...`);
            } else {
                toast.success('Orden enviada correctamente');
            }
        } catch (err) {
            toast.dismiss(toastId);
            console.error('Error sending order WhatsApp:', err);
            toast.error(err.response?.data?.error || 'Error al enviar orden por WhatsApp');
        } finally {
            setSendingWaId(null);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'pending':
                return (
                    <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 px-2 py-0.5 rounded text-[11px] font-medium">
                        <Clock size={11} /> Pendiente
                    </span>
                );
            case 'received':
                return (
                    <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded text-[11px] font-medium">
                        <CheckCircle2 size={11} /> Recibida
                    </span>
                );
            case 'cancelled':
                return (
                    <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-[11px] font-medium">
                        <XCircle size={11} /> Cancelada
                    </span>
                );
            default:
                return (
                    <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded text-[11px] font-medium">
                        {status}
                    </span>
                );
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    // --- Computed Filtered Data ---
    const filteredSuppliers = useMemo(() => {
        if (!Array.isArray(suppliers)) return [];
        return suppliers.filter(s => {
            const matchesSearch =
                (s.name || '').toLowerCase().includes(supplierSearchTerm.toLowerCase()) ||
                (s.contact || '').toLowerCase().includes(supplierSearchTerm.toLowerCase()) ||
                (s.phone || '').includes(supplierSearchTerm) ||
                (s.id || '').toLowerCase().includes(supplierSearchTerm.toLowerCase()) ||
                (s.rif || '').toLowerCase().includes(supplierSearchTerm.toLowerCase());

            if (!matchesSearch) return false;

            const balance = Number(s.creditBalance || 0);
            if (supplierBalanceFilter === 'with_debt') return balance > 0;
            if (supplierBalanceFilter === 'solvent') return balance <= 0;
            return true;
        });
    }, [suppliers, supplierSearchTerm, supplierBalanceFilter]);

    const debtSuppliersCount = useMemo(() => {
        return suppliers.filter(s => Number(s.creditBalance || 0) > 0).length;
    }, [suppliers]);

    const filteredOrders = useMemo(() => {
        if (!Array.isArray(orders)) return [];
        return orders.filter(o => {
            const supplierObj = suppliers.find(s => String(s.id) === String(o.supplierId));
            const matchesSearch =
                (supplierObj?.name || o.supplierId || '').toLowerCase().includes(orderSearchTerm.toLowerCase()) ||
                (o.referenceNumber || '').toLowerCase().includes(orderSearchTerm.toLowerCase()) ||
                (o.id || '').toLowerCase().includes(orderSearchTerm.toLowerCase());

            if (!matchesSearch) return false;

            if (orderStatusFilter === 'pending') return o.status === 'pending';
            if (orderStatusFilter === 'received') return o.status === 'received';
            if (orderStatusFilter === 'cancelled') return o.status === 'cancelled';
            if (orderStatusFilter === 'with_invoice') return !!o.invoiceUrl;
            return true;
        });
    }, [orders, suppliers, orderSearchTerm, orderStatusFilter]);

    // --- KPIs ---
    const totalDebt = useMemo(() => {
        return suppliers.reduce((sum, s) => sum + Number(s.creditBalance || 0), 0);
    }, [suppliers]);

    const pendingOrdersCount = useMemo(() => {
        return orders.filter(o => o.status === 'pending').length;
    }, [orders]);

    const scannedInvoicesCount = useMemo(() => {
        return orders.filter(o => !!o.invoiceUrl).length;
    }, [orders]);

    return (
        <div className="space-y-5 sm:space-y-6 pb-28 sm:pb-20 pb-safe animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <Truck size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                            Proveedores & Compras
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Administración de proveedores comerciales, órdenes de compra y control de cuentas por pagar
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                    <button
                        onClick={() => { setOrderSupplierId(null); setIsPurchaseOrderModalOpen(true); }}
                        className="shrink-0 flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[38px] bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-xs transition-colors shadow-xs cursor-pointer"
                    >
                        <ShoppingBag size={14} />
                        <span>Nueva Orden</span>
                    </button>
                    <button
                        onClick={handleCreateSupplier}
                        className="shrink-0 flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[38px] bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-xs cursor-pointer"
                    >
                        <Plus size={14} />
                        <span>Nuevo Proveedor</span>
                    </button>
                </div>
            </div>

            {/* KPI Stat Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* Total Proveedores */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Directorio Comercial</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">{suppliers.length}</span>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Proveedores</span>
                        </div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <Building2 size={18} />
                    </div>
                </div>

                {/* Órdenes Pendientes */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Órdenes en Tránsito</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className={`text-2xl font-bold font-mono ${pendingOrdersCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
                                {pendingOrdersCount}
                            </span>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Por recibir</span>
                        </div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-200 dark:border-amber-800/40 shrink-0">
                        <Clock size={18} />
                    </div>
                </div>

                {/* Facturas Digitalizadas */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Facturas Digitalizadas</span>
                        <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">{scannedInvoicesCount}</span>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Documentos</span>
                        </div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-200 dark:border-indigo-800/40 shrink-0">
                        <FileText size={18} />
                    </div>
                </div>

                {/* Balance Deuda Total */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Deuda Acumulada</span>
                        <div className="flex flex-col mt-1">
                            <div className="flex items-baseline gap-2">
                                <span className={`text-2xl font-bold font-mono ${totalDebt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                                    ${Number(totalDebt || 0).toFixed(2)}
                                </span>
                                <span className={`text-xs font-medium ${totalDebt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {totalDebt > 0 ? 'Por Pagar' : 'Al día'}
                                </span>
                            </div>
                            {!isUsdOnly && totalDebt > 0 && bcvRate > 0 && (
                                <span className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                                    ≈ Bs. {(totalDebt * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className={`w-9 h-9 rounded-lg ${totalDebt > 0 ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'} flex items-center justify-center shrink-0`}>
                        <DollarSign size={18} />
                    </div>
                </div>
            </div>

            {/* Tab Switcher & Secondary Actions */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div className="flex items-center overflow-x-auto no-scrollbar gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700 w-full sm:w-auto">
                    <button
                        onClick={() => { setActiveTab('suppliers'); setSearchParams({ tab: 'suppliers' }); }}
                        className={`shrink-0 flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-md font-medium text-xs transition-colors cursor-pointer ${
                            activeTab === 'suppliers'
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                        }`}
                    >
                        <Building2 size={14} />
                        <span>Directorio</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {suppliers.length}
                        </span>
                    </button>
                    <button
                        onClick={() => { setActiveTab('orders'); setSearchParams({ tab: 'orders' }); }}
                        className={`shrink-0 flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-md font-medium text-xs transition-colors cursor-pointer ${
                            activeTab === 'orders'
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
                        }`}
                    >
                        <ShoppingBag size={14} />
                        <span>Órdenes & Albaranes</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono border ${
                            pendingOrdersCount > 0 
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/40 font-semibold' 
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}>
                            {orders.length}
                        </span>
                    </button>
                </div>

                {activeTab === 'suppliers' && (
                    <div className="hidden sm:flex items-center gap-1.5">
                        <button
                            onClick={handleExportSuppliers}
                            title="Exportar base de proveedores a JSON"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700 transition-colors shadow-xs text-xs font-medium cursor-pointer"
                        >
                            <Download size={13} />
                            <span>Exportar</span>
                        </button>
                        <label
                            title="Importar proveedores desde archivo JSON"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700 transition-colors shadow-xs text-xs font-medium cursor-pointer"
                        >
                            <Upload size={13} />
                            <span>Importar</span>
                            <input type="file" accept=".json" onChange={handleImportSuppliers} className="hidden" />
                        </label>
                    </div>
                )}
            </div>

            {/* ========================================================================= */}
            {/* TAB 1: DIRECTORIO DE PROVEEDORES */}
            {/* ========================================================================= */}
            {activeTab === 'suppliers' && (
                <div className="space-y-4">
                    {/* Toolbar: Search + Quick Balance Filter */}
                    <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                            <input
                                type="text"
                                placeholder="Buscar por razón social, contacto, RIF o teléfono..."
                                value={supplierSearchTerm}
                                onChange={(e) => setSupplierSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none transition-colors"
                            />
                            {supplierSearchTerm && (
                                <button
                                    onClick={() => setSupplierSearchTerm('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                                    title="Limpiar búsqueda"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Quick Balance Status Pills */}
                        <div className="flex items-center gap-1 w-full md:w-auto overflow-x-auto no-scrollbar">
                            {[
                                { id: 'all', label: 'Todos', count: suppliers.length },
                                { id: 'with_debt', label: 'Con Saldo Pendiente', count: debtSuppliersCount, alert: debtSuppliersCount > 0 },
                                { id: 'solvent', label: 'Solventes', count: suppliers.length - debtSuppliersCount }
                            ].map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setSupplierBalanceFilter(filter.id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 font-medium ${
                                        supplierBalanceFilter === filter.id
                                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xs font-semibold'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <span>{filter.label}</span>
                                    <span className={`text-[10px] px-1.5 py-0.1 rounded font-mono ${
                                        supplierBalanceFilter === filter.id
                                            ? 'bg-white/20 dark:bg-black/20 text-white dark:text-slate-900'
                                            : filter.alert
                                                ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
                                                : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                    }`}>
                                        {filter.count}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Suppliers Data: Table & Mobile Views */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[880px]">
                                <thead>
                                    <tr className="bg-slate-50/75 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        <th className="px-4 py-3">Proveedor / Razón Social</th>
                                        <th className="hidden lg:table-cell px-4 py-3">Contacto Comercial</th>
                                        <th className="hidden xl:table-cell px-4 py-3">Teléfono / WhatsApp</th>
                                        <th className="px-4 py-3 text-right">Balance Contable</th>
                                        <th className="px-4 py-3 text-center w-72">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs text-slate-700 dark:text-slate-300">
                                    {suppliersLoading ? (
                                        <tr>
                                            <td colSpan="5" className="py-16 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                                Cargando catálogo de proveedores...
                                            </td>
                                        </tr>
                                    ) : filteredSuppliers.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="py-16 text-center">
                                                <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-8 max-w-sm mx-auto">
                                                    <Truck size={36} className="text-slate-400 mx-auto mb-2 opacity-60" />
                                                    <h3 className="text-slate-800 dark:text-white font-semibold text-sm">Sin Proveedores</h3>
                                                    <p className="text-xs text-slate-500 mt-0.5">No se encontraron registros con los criterios seleccionados</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredSuppliers.map(supplier => (
                                            <tr key={supplier.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <SupplierLogoBox 
                                                            supplier={supplier}
                                                            onClick={() => setLogoSearchSupplier(supplier)}
                                                            size="md"
                                                        />
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-slate-900 dark:text-white font-semibold truncate">
                                                                {supplier.name}
                                                            </span>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                {supplier.rif && (
                                                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-medium">
                                                                        RIF: {supplier.rif}
                                                                    </span>
                                                                )}
                                                                <span className="text-[10px] text-slate-400 font-mono">
                                                                    ID: {supplier.id.slice(0, 8)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="hidden lg:table-cell px-4 py-3">
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-slate-800 dark:text-slate-200 font-medium truncate">
                                                            {supplier.contact || 'Sin representante asignado'}
                                                        </span>
                                                        {supplier.email && (
                                                            <span className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                                                                {supplier.email}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="hidden xl:table-cell px-4 py-3">
                                                    {supplier.phone ? (
                                                        <div className="inline-flex items-center gap-2">
                                                            <span className="font-mono text-xs text-slate-800 dark:text-slate-200 font-medium">
                                                                {supplier.phone}
                                                            </span>
                                                            <a 
                                                                href={`https://wa.me/${supplier.phone.replace(/[^0-9]/g, '')}`} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer"
                                                                title="Abrir conversación en WhatsApp"
                                                                className="p-1 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800/40 transition-colors cursor-pointer"
                                                            >
                                                                <Phone size={13} />
                                                            </a>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 font-normal">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="inline-flex flex-col items-end">
                                                        <span className={`font-mono font-semibold text-xs ${Number(supplier.creditBalance || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                                            ${Number(supplier.creditBalance || 0).toFixed(2)} USD
                                                        </span>
                                                        {Number(supplier.creditBalance || 0) > 0 ? (
                                                            <div className="flex flex-col items-end mt-0.5">
                                                                <span className="inline-flex items-center px-1.5 py-0.2 text-[10px] font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded border border-rose-200 dark:border-rose-800/40">
                                                                    Por Liquidar
                                                                </span>
                                                                {!isUsdOnly && bcvRate > 0 && (
                                                                    <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                                                                        ≈ Bs. {(Number(supplier.creditBalance || 0) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="inline-flex items-center px-1.5 py-0.2 text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded mt-0.5">
                                                                Solvente
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={() => handleOpenOrderModalForSupplier(supplier)}
                                                            className="px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800/40 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                                                            title="Generar orden de compra y enviar por WhatsApp"
                                                        >
                                                            <MessageCircle size={13} />
                                                            <span>Pedir</span>
                                                        </button>
                                                        <button
                                                            onClick={() => { setSelectedSupplier(supplier); setIsProductsModalOpen(true); }}
                                                            className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                                                            title="Ver catálogo de productos asociados"
                                                        >
                                                            <Package size={13} />
                                                            <span>Productos</span>
                                                        </button>
                                                        <button
                                                            onClick={() => { setSelectedSupplier(supplier); setIsCreditModalOpen(true); }}
                                                            className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                                                            title="Historial de créditos y pagos"
                                                        >
                                                            <History size={13} />
                                                            <span>Cuenta</span>
                                                        </button>
                                                        <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
                                                        <button
                                                            onClick={() => handleEditSupplier(supplier)}
                                                            title="Editar datos del proveedor"
                                                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                        >
                                                            <Edit2 size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => setLogoSearchSupplier(supplier)}
                                                            title="Asignar logotipo comercial"
                                                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                        >
                                                            <Globe size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteSupplier(supplier.id)}
                                                            title="Eliminar proveedor"
                                                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards View */}
                        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                            {suppliersLoading ? (
                                <div className="py-12 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                                    Cargando catálogo de proveedores...
                                </div>
                            ) : filteredSuppliers.length === 0 ? (
                                <div className="py-12 text-center text-slate-400">
                                    <Truck size={36} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Sin proveedores registrados</p>
                                </div>
                            ) : (
                                filteredSuppliers.map(supplier => {
                                    const hasDebt = Number(supplier.creditBalance || 0) > 0;

                                    return (
                                        <div key={supplier.id} className="p-4 space-y-3 bg-white dark:bg-slate-900">
                                            {/* Top Row: Logo + Name + Balance */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <SupplierLogoBox 
                                                        supplier={supplier}
                                                        onClick={() => setLogoSearchSupplier(supplier)}
                                                        size="md"
                                                    />
                                                    <div className="min-w-0">
                                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                                            {supplier.name}
                                                        </h4>
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                                                            {supplier.contact ? `Contacto: ${supplier.contact}` : 'Sin representante'} {supplier.phone ? `• ${supplier.phone}` : ''}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <div className={`px-2 py-0.5 rounded text-xs font-mono font-semibold border ${
                                                        hasDebt 
                                                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/40' 
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                    }`}>
                                                        ${Number(supplier.creditBalance || 0).toFixed(2)}
                                                    </div>
                                                    <span className="text-[9px] font-medium text-slate-400 block mt-0.5">
                                                        {hasDebt ? 'Por liquidar' : 'Solvente'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Action Buttons Row */}
                                            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                                <button
                                                    onClick={() => handleOpenOrderModalForSupplier(supplier)}
                                                    className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 text-xs font-medium flex items-center justify-center gap-1.5"
                                                    title="Pedido WhatsApp"
                                                >
                                                    <MessageCircle size={13} />
                                                    <span>Pedir</span>
                                                </button>

                                                <button
                                                    onClick={() => { setSelectedSupplier(supplier); setIsProductsModalOpen(true); }}
                                                    className="py-1.5 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1"
                                                    title="Catálogo de productos"
                                                >
                                                    <Package size={13} />
                                                    <span>Productos</span>
                                                </button>

                                                <button
                                                    onClick={() => { setSelectedSupplier(supplier); setIsCreditModalOpen(true); }}
                                                    className="py-1.5 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1"
                                                    title="Historial de cuenta"
                                                >
                                                    <History size={13} />
                                                    <span>Cuenta</span>
                                                </button>

                                                <button
                                                    onClick={() => handleEditSupplier(supplier)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                                    title="Editar"
                                                >
                                                    <Edit2 size={14} />
                                                </button>

                                                <button
                                                    onClick={() => handleDeleteSupplier(supplier.id)}
                                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 2: HISTORIAL DE COMPRAS & ALBARANES */}
            {/* ========================================================================= */}
            {activeTab === 'orders' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                    {/* Search & Status Filters */}
                    <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                            <input
                                type="text"
                                placeholder="Buscar por proveedor, ID o número de referencia..."
                                value={orderSearchTerm}
                                onChange={(e) => setOrderSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none transition-colors"
                            />
                            {orderSearchTerm && (
                                <button
                                    onClick={() => setOrderSearchTerm('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                                    title="Limpiar búsqueda"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Filter Pills */}
                        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto no-scrollbar">
                            {[
                                { id: 'all', label: 'Todas' },
                                { id: 'pending', label: 'Pendientes' },
                                { id: 'received', label: 'Recibidas' },
                                { id: 'with_invoice', label: 'Con Factura' },
                                { id: 'cancelled', label: 'Canceladas' }
                            ].map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setOrderStatusFilter(filter.id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                                        orderStatusFilter === filter.id
                                            ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-xs font-semibold'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Orders Data: Table & Mobile Views */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                        {/* Mobile Cards View */}
                        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                            {ordersLoading ? (
                                <div className="py-12 text-center text-slate-500 font-medium text-xs uppercase tracking-wider">
                                    Cargando órdenes de compra...
                                </div>
                            ) : filteredOrders.length === 0 ? (
                                <div className="py-12 text-center text-slate-400">
                                    <ShoppingBag size={40} className="text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                                    <h4 className="text-slate-800 dark:text-white font-semibold text-sm">Sin Órdenes</h4>
                                    <p className="text-xs text-slate-500 mt-0.5">No se encontraron órdenes registradas</p>
                                </div>
                            ) : (
                                filteredOrders.map(order => {
                                    const supplierObj = suppliers.find(s => String(s.id) === String(order.supplierId));
                                    const isExpanded = expandedOrder === order.id;
                                    const orderItems = Array.isArray(typeof order.items === 'string' ? JSON.parse(order.items || '[]') : order.items)
                                        ? (typeof order.items === 'string' ? JSON.parse(order.items || '[]') : order.items)
                                        : [];

                                    return (
                                        <div key={`mobile-order-${order.id}`} className="p-4 space-y-3 bg-white dark:bg-slate-900">
                                            {/* Header */}
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <span className="font-mono font-semibold text-xs text-slate-900 dark:text-white block">
                                                        #{order.id.slice(0, 8)}
                                                    </span>
                                                    {order.referenceNumber && (
                                                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono block mt-0.5">
                                                            Ref: {order.referenceNumber}
                                                        </span>
                                                    )}
                                                    <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 block truncate mt-1">
                                                        {supplierObj?.name || order.supplierId}
                                                    </span>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <span className="text-sm font-bold text-slate-900 dark:text-white font-mono block">
                                                        ${parseFloat(order.total || 0).toFixed(2)}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-medium block mt-0.5">
                                                        {formatDate(order.expectedDate || order.createdAt)}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Status & Payment pills */}
                                            <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                                                {getStatusBadge(order.status)}
                                                <button
                                                    type="button"
                                                    onClick={() => handleTogglePaymentStatus(order)}
                                                    className="cursor-pointer"
                                                    title={`Estado de liquidación (Actual: ${order.paymentStatus === 'paid' ? 'Pagado' : 'Por Pagar'})`}
                                                >
                                                    {order.paymentStatus === 'paid' ? (
                                                        <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded text-[10px] font-medium">
                                                            <CheckCircle2 size={11} /> Pagado
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40 px-2 py-0.5 rounded text-[10px] font-medium">
                                                            <Clock size={11} /> Por Pagar
                                                        </span>
                                                    )}
                                                </button>
                                                {order.invoiceUrl && (
                                                    <button
                                                        onClick={() => setViewerInvoice({
                                                            isOpen: true,
                                                            url: order.invoiceUrl,
                                                            details: {
                                                                referenceNumber: order.referenceNumber || order.id,
                                                                supplierName: supplierObj?.name || order.supplierId,
                                                                date: formatDate(order.expectedDate || order.date)
                                                            }
                                                        })}
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/40 rounded text-[10px] font-medium cursor-pointer ml-auto"
                                                    >
                                                        <Eye size={11} /> Factura
                                                    </button>
                                                )}
                                            </div>

                                            {/* Action buttons */}
                                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                                <button
                                                    onClick={() => handleSendWhatsApp(order)}
                                                    disabled={sendingWaId === order.id}
                                                    className="flex-1 py-1.5 px-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                                >
                                                    {sendingWaId === order.id ? (
                                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-emerald-600"></div>
                                                    ) : (
                                                        <MessageCircle size={13} />
                                                    )}
                                                    <span>WhatsApp</span>
                                                </button>

                                                {order.status === 'pending' && (
                                                    <button
                                                        onClick={() => handleReceiveOrder(order)}
                                                        disabled={processing}
                                                        className="flex-1 py-1.5 px-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                                    >
                                                        <PackageCheck size={13} /> Recibir
                                                    </button>
                                                )}

                                                {order.status === 'received' && (
                                                    <button
                                                        onClick={() => handleReceiveOrder(order)}
                                                        disabled={processing}
                                                        className="flex-1 py-1.5 px-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                                                    >
                                                        <Edit2 size={13} /> Editar
                                                    </button>
                                                )}

                                                <button
                                                    onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                                                    className="py-1.5 px-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1"
                                                >
                                                    <span>{orderItems.length} ítems</span>
                                                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                </button>

                                                <button
                                                    onClick={() => handleDeleteOrder(order.id, order.status)}
                                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                                                    title="Eliminar orden"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>

                                            {/* Expanded items */}
                                            {isExpanded && orderItems.length > 0 && (
                                                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1.5 border border-slate-200 dark:border-slate-700">
                                                    {orderItems.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between items-center text-xs">
                                                            <span className="font-medium text-slate-800 dark:text-slate-200">{item.name}</span>
                                                            <span className="text-slate-500 dark:text-slate-400 font-mono">{item.quantity} x ${item.cost}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left text-xs min-w-[900px] border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/75 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        <th className="px-4 py-3">ID / Referencia</th>
                                        <th className="px-4 py-3">Proveedor</th>
                                        <th className="px-4 py-3">Estado Operativo</th>
                                        <th className="px-4 py-3">Liquidación</th>
                                        <th className="px-4 py-3 text-right">Total ($ USD)</th>
                                        <th className="px-4 py-3">Fecha Prevista</th>
                                        <th className="px-4 py-3 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {ordersLoading ? (
                                        <tr>
                                            <td colSpan="7" className="py-16 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                                Cargando historial de órdenes de compra...
                                            </td>
                                        </tr>
                                    ) : filteredOrders.length === 0 ? (
                                        <tr>
                                            <td colSpan="7" className="py-16 text-center">
                                                <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-8 max-w-sm mx-auto">
                                                    <ShoppingBag size={36} className="text-slate-400 mx-auto mb-2 opacity-60" />
                                                    <h3 className="text-slate-800 dark:text-white font-semibold text-sm">Sin Órdenes Registradas</h3>
                                                    <p className="text-xs text-slate-500 mt-0.5">No se encontraron órdenes con los filtros seleccionados</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredOrders.map(order => {
                                            const supplierObj = suppliers.find(s => String(s.id) === String(order.supplierId));
                                            const isExpanded = expandedOrder === order.id;

                                            return (
                                                <React.Fragment key={order.id}>
                                                    <tr 
                                                        onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                                                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
                                                    >
                                                        <td className="px-4 py-3 font-mono">
                                                            <div className="flex items-center gap-2">
                                                                <div className="text-slate-400 group-hover:text-primary-500 transition-colors">
                                                                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                                                </div>
                                                                <div>
                                                                    <span className="font-semibold text-slate-900 dark:text-white text-xs block">
                                                                        #{order.id.slice(0, 8)}
                                                                    </span>
                                                                    {order.referenceNumber && (
                                                                        <span className="text-[10px] text-slate-400 font-mono block">
                                                                            Ref: {order.referenceNumber}
                                                                        </span>
                                                                    )}
                                                                    {order.invoiceUrl && (
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/40 rounded text-[9px] font-medium mt-0.5">
                                                                            <Eye size={10} /> Factura
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="font-semibold text-slate-900 dark:text-white text-xs truncate">
                                                                    {supplierObj?.name || order.supplierId}
                                                                </span>
                                                                {supplierObj?.phone && (
                                                                    <span className="text-[10px] text-slate-400 font-mono">
                                                                        {supplierObj.phone}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {getStatusBadge(order.status)}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleTogglePaymentStatus(order);
                                                                }}
                                                                title={`Clic para alternar estado de liquidación`}
                                                                className="cursor-pointer"
                                                            >
                                                                {order.paymentStatus === 'paid' ? (
                                                                    <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded text-[10px] font-medium">
                                                                        <CheckCircle2 size={10} /> Pagado
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40 px-2 py-0.5 rounded text-[10px] font-medium">
                                                                        <Clock size={10} /> Por Pagar
                                                                    </span>
                                                                )}
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-3 font-mono font-semibold text-xs text-right text-slate-900 dark:text-white tabular-nums">
                                                            ${parseFloat(order.total || 0).toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-500 font-medium">
                                                            {formatDate(order.expectedDate || order.createdAt)}
                                                        </td>
                                                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex items-center justify-center gap-1.5">
                                                                <button
                                                                    onClick={() => handleSendWhatsApp(order)}
                                                                    disabled={sendingWaId === order.id}
                                                                    className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                                                                    title="Enviar orden de compra al WhatsApp del proveedor"
                                                                >
                                                                    {sendingWaId === order.id ? (
                                                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-emerald-600"></div>
                                                                    ) : (
                                                                        <MessageCircle size={13} />
                                                                    )}
                                                                    <span>WhatsApp</span>
                                                                </button>
                                                                {order.invoiceUrl && (
                                                                    <button
                                                                        onClick={() => setViewerInvoice({
                                                                            isOpen: true,
                                                                            url: order.invoiceUrl,
                                                                            details: {
                                                                                referenceNumber: order.referenceNumber || order.id,
                                                                                supplierName: supplierObj?.name || order.supplierId,
                                                                                date: formatDate(order.expectedDate || order.date)
                                                                            }
                                                                        })}
                                                                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition-colors cursor-pointer"
                                                                        title="Ver Factura Real Digitalizada"
                                                                    >
                                                                        <Eye size={14} />
                                                                    </button>
                                                                )}
                                                                {order.status === 'pending' && (
                                                                    <button
                                                                        onClick={() => handleReceiveOrder(order)}
                                                                        disabled={processing}
                                                                        className="px-2.5 py-1 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                                                                        title="Verificar y Recibir Mercancía en Inventario"
                                                                    >
                                                                        <PackageCheck size={13} /> Recibir
                                                                    </button>
                                                                )}
                                                                {order.status === 'received' && (
                                                                    <button
                                                                        onClick={() => handleReceiveOrder(order)}
                                                                        disabled={processing}
                                                                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                                        title="Editar albarán recibido"
                                                                    >
                                                                        <Edit2 size={13} />
                                                                    </button>
                                                                )}
                                                                <button
                                                                    onClick={() => handleDeleteOrder(order.id, order.status)}
                                                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                                                                    title="Eliminar registro"
                                                                >
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded Order Detail */}
                                                    {isExpanded && (
                                                        <tr>
                                                            <td colSpan="7" className="px-6 py-4 bg-slate-50/70 dark:bg-slate-900/60 border-y border-slate-200 dark:border-slate-800">
                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                                                    {/* Items Breakdown */}
                                                                    <div>
                                                                        <h4 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                                                            Productos en la Orden
                                                                        </h4>
                                                                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                                                            {(Array.isArray(typeof order.items === 'string' ? JSON.parse(order.items || '[]') : order.items) ? (typeof order.items === 'string' ? JSON.parse(order.items || '[]') : order.items) : []).map((item, idx) => (
                                                                                <div key={idx} className="flex justify-between items-center bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                                                                                    <div>
                                                                                        <p className="text-xs font-medium text-slate-800 dark:text-white leading-tight">{item.name}</p>
                                                                                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">Cant: {item.quantity} x ${item.cost}</p>
                                                                                    </div>
                                                                                    <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                                                                                        ${(item.quantity * item.cost).toFixed(2)}
                                                                                    </span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>

                                                                    {/* Physical Invoice Attached Card */}
                                                                    <div>
                                                                        <h4 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                                                            Factura Física Digitalizada
                                                                        </h4>
                                                                        {order.invoiceUrl ? (
                                                                            <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col justify-between gap-3 shadow-xs">
                                                                                <div className="flex items-center gap-2.5">
                                                                                    <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
                                                                                        <FileText size={18} />
                                                                                    </div>
                                                                                    <div>
                                                                                        <p className="text-xs font-semibold text-slate-800 dark:text-white">Documento Digital</p>
                                                                                        <p className="text-[10px] text-slate-500 font-medium">Comprobante archivado en el sistema</p>
                                                                                    </div>
                                                                                </div>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setViewerInvoice({
                                                                                        isOpen: true,
                                                                                        url: order.invoiceUrl,
                                                                                        details: {
                                                                                            referenceNumber: order.referenceNumber || order.id,
                                                                                            supplierName: supplierObj?.name || order.supplierId,
                                                                                            date: formatDate(order.expectedDate || order.date)
                                                                                        }
                                                                                    })}
                                                                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                                                                >
                                                                                    <Eye size={13} />
                                                                                    <span>Visualizar Documento</span>
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-400 flex flex-col items-center justify-center text-center gap-1.5 h-full min-h-[90px]">
                                                                                <FileText size={20} className="text-slate-300 dark:text-slate-600" />
                                                                                <span>No se adjuntó comprobante digital en esta orden.</span>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Notes & Direct Action */}
                                                                    <div className="flex flex-col justify-between">
                                                                        <div>
                                                                            <h4 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                                                                Notas & Observaciones
                                                                            </h4>
                                                                            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 min-h-[60px]">
                                                                                {order.notes || 'Sin notas registradas.'}
                                                                            </div>
                                                                        </div>
                                                                        <div className="mt-3">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleSendWhatsApp(order)}
                                                                                disabled={sendingWaId === order.id}
                                                                                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                                                                            >
                                                                                <MessageCircle size={14} />
                                                                                <span>Reenviar por WhatsApp</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODALS --- */}
            <SupplierModal 
                isOpen={isSupplierModalOpen} 
                onClose={() => setIsSupplierModalOpen(false)} 
                onSave={handleSaveSupplier} 
                supplier={selectedSupplier} 
                processing={processing} 
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
            
            <SupplierCreditModal 
                isOpen={isCreditModalOpen} 
                onClose={() => setIsCreditModalOpen(false)} 
                supplier={selectedSupplier} 
                onUpdate={fetchSuppliers} 
            />
            
            <SupplierProductsModal 
                isOpen={isProductsModalOpen} 
                onClose={() => setIsProductsModalOpen(false)} 
                supplier={selectedSupplier} 
                onUpdate={fetchSuppliers} 
                onOpenPurchaseOrder={(sup) => {
                    setIsProductsModalOpen(false);
                    handleOpenOrderModalForSupplier(sup);
                }}
            />
            
            <PurchaseOrderModal 
                isOpen={isPurchaseOrderModalOpen} 
                onClose={() => setIsPurchaseOrderModalOpen(false)} 
                onSave={handleCreateOrder} 
                processing={processing} 
                initialSupplierId={orderSupplierId} 
            />

            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice(prev => ({ ...prev, isOpen: false }))}
                invoiceUrl={viewerInvoice.url}
                title="Factura Real Digitalizada"
                details={viewerInvoice.details}
            />

            {receptionModalOrder && (
                <OrderReceptionModal
                    isOpen={!!receptionModalOrder}
                    onClose={() => setReceptionModalOrder(null)}
                    order={receptionModalOrder}
                    supplier={suppliers.find(s => String(s.id) === String(receptionModalOrder.supplierId))}
                    onReceptionCompleted={fetchAll}
                    bcvRate={bcvRate}
                />
            )}

            <SupplierLogoSearchModal
                isOpen={!!logoSearchSupplier}
                onClose={() => setLogoSearchSupplier(null)}
                supplierName={logoSearchSupplier?.name || ''}
                supplierId={logoSearchSupplier?.id || null}
                onSelectLogo={async (logoUri) => {
                    const supId = logoSearchSupplier?.id;
                    if (supId && logoUri) {
                        setSuppliers(prev => prev.map(s => String(s.id) === String(supId) ? { ...s, logoUri } : s));
                    }
                    await fetchSuppliers();
                    setLogoSearchSupplier(null);
                }}
            />
        </div>
    );
}
