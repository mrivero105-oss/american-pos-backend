import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { 
    Warehouse as WarehouseIcon, Truck, ClipboardList, Tags, Plus, Search, 
    RefreshCw, CheckCircle2, AlertTriangle, Clock, ArrowRight, 
    ArrowUpRight, ArrowDownRight, Edit2, Trash2, X, ChevronRight,
    Building2, Package, Layers, ShieldCheck, MapPin, Calculator, FileText, Check
} from 'lucide-react';
import api from '../services/api';
import { formatMoney } from '../utils/format';
import ConfirmModal from '../components/ConfirmModal';

export default function WarehousesManager() {
    const [activeTab, setActiveTab] = useState('almacenes'); // 'almacenes', 'traslados', 'conteo', 'precios'
    const [loading, setLoading] = useState(false);

    // Data lists
    const [warehouses, setWarehouses] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [counts, setCounts] = useState([]);
    const [priceLists, setPriceLists] = useState([]);
    const [products, setProducts] = useState([]);

    // Drill down / selection
    const [selectedWarehouse, setSelectedWarehouse] = useState(null);
    const [warehouseStocks, setWarehouseStocks] = useState([]);
    const [stockSearch, setStockSearch] = useState('');
    const [stockLoading, setStockLoading] = useState(false);

    // Confirm dialog modern state
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        title: '',
        message: '',
        variant: 'danger',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        onConfirm: () => {}
    });

    // Modals
    const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
    const [editingWarehouse, setEditingWarehouse] = useState(null);
    const [warehouseForm, setWarehouseForm] = useState({
        name: '',
        code: '',
        location: '',
        description: '',
        isDefaultSaleWarehouse: false
    });

    const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
    const [adjustItem, setAdjustItem] = useState(null);
    const [adjustForm, setAdjustForm] = useState({ newQuantity: '', reason: '' });

    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
    const [transferForm, setTransferForm] = useState({
        fromWarehouseId: '',
        toWarehouseId: '',
        driverName: '',
        vehiclePlate: '',
        notes: '',
        status: 'BORRADOR',
        items: []
    });
    const [transferProdSearch, setTransferProdSearch] = useState('');

    const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
    const [receivingTransfer, setReceivingTransfer] = useState(null);
    const [receivedItemsInputs, setReceivedItemsInputs] = useState([]);
    const [receptionNotes, setReceptionNotes] = useState('');

    const [isCountModalOpen, setIsCountModalOpen] = useState(false);
    const [countForm, setCountForm] = useState({
        warehouseId: '',
        countedBy: '',
        blindCount: true
    });

    const [isCountExecModalOpen, setIsCountExecModalOpen] = useState(false);
    const [activeCount, setActiveCount] = useState(null);
    const [countItemsState, setCountItemsState] = useState([]);

    const [isPriceListModalOpen, setIsPriceListModalOpen] = useState(false);
    const [editingPriceList, setEditingPriceList] = useState(null);
    const [priceListForm, setPriceListForm] = useState({
        name: '',
        code: '',
        description: '',
        type: 'PERCENTAGE',
        percentageAdjustment: 0,
        currency: 'USD',
        isDefault: false
    });

    // Price Simulator State
    const [simProduct, setSimProduct] = useState('');
    const [simPriceList, setSimPriceList] = useState('');
    const [simQuantity, setSimQuantity] = useState(1);
    const [simResult, setSimResult] = useState(null);

    // Initial Load
    useEffect(() => {
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [whRes, trfRes, cntRes, plRes, prodRes] = await Promise.all([
                api.get('/warehouses').catch(() => ({ data: [] })),
                api.get('/warehouses/transfers/list').catch(() => ({ data: [] })),
                api.get('/warehouses/counts/list').catch(() => ({ data: [] })),
                api.get('/warehouses/price-lists/list').catch(() => ({ data: [] })),
                api.get('/products').catch(() => ({ data: [] }))
            ]);

            setWarehouses(whRes.data || []);
            setTransfers(trfRes.data || []);
            setCounts(cntRes.data || []);
            setPriceLists(plRes.data || []);
            setProducts(Array.isArray(prodRes.data) ? prodRes.data : prodRes.data?.products || []);

            if (whRes.data?.length > 0 && !selectedWarehouse) {
                const def = whRes.data.find(w => w.isDefaultSaleWarehouse) || whRes.data[0];
                handleSelectWarehouse(def);
            }
        } catch (error) {
            console.error('Error fetching initial data:', error);
            toast.error('Error al sincronizar datos logísticos');
        } finally {
            setLoading(false);
        }
    };

    const handleSelectWarehouse = async (wh) => {
        setSelectedWarehouse(wh);
        setStockLoading(true);
        try {
            const res = await api.get(`/warehouses/${wh.id}/stock`);
            setWarehouseStocks(res.data || []);
        } catch (error) {
            console.error('Error loading warehouse stock:', error);
            toast.error('Error al cargar existencias del almacén');
        } finally {
            setStockLoading(false);
        }
    };

    // Filtered stocks
    const filteredStocks = useMemo(() => {
        if (!stockSearch) return warehouseStocks;
        const q = stockSearch.toLowerCase();
        return warehouseStocks.filter(s => 
            (s.productName && s.productName.toLowerCase().includes(q)) ||
            (s.barcode && s.barcode.toLowerCase().includes(q))
        );
    }, [warehouseStocks, stockSearch]);

    // Stats
    const totalUnitsAll = useMemo(() => {
        return warehouses.reduce((acc, w) => acc + (w.totalItems || 0), 0);
    }, [warehouses]);

    const inTransitCount = useMemo(() => {
        return transfers.filter(t => t.status === 'EN_TRANSITO').length;
    }, [transfers]);

    const pendingCounts = useMemo(() => {
        return counts.filter(c => c.status === 'EN_PROGRESO').length;
    }, [counts]);

    // ----------------------------------------------------
    // ALMACENES HANDLERS
    // ----------------------------------------------------
    const handleOpenWarehouseModal = (wh = null) => {
        if (wh) {
            setEditingWarehouse(wh);
            setWarehouseForm({
                name: wh.name,
                code: wh.code,
                location: wh.location || '',
                description: wh.description || '',
                isDefaultSaleWarehouse: Boolean(wh.isDefaultSaleWarehouse)
            });
        } else {
            setEditingWarehouse(null);
            setWarehouseForm({
                name: '',
                code: '',
                location: '',
                description: '',
                isDefaultSaleWarehouse: false
            });
        }
        setIsWarehouseModalOpen(true);
    };

    const handleSaveWarehouse = async (e) => {
        e.preventDefault();
        if (!warehouseForm.name) return toast.error('El nombre del almacén es obligatorio');

        try {
            if (editingWarehouse) {
                await api.put(`/warehouses/${editingWarehouse.id}`, warehouseForm);
                toast.success('Almacén actualizado con éxito');
            } else {
                await api.post('/warehouses', warehouseForm);
                toast.success('Almacén creado con éxito');
            }
            setIsWarehouseModalOpen(false);
            fetchInitialData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al guardar almacén');
        }
    };

    const handleDeleteWarehouse = (wh) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Almacén',
            message: `¿Estás seguro de que deseas eliminar el almacén "${wh.name}"? Esta acción no se puede deshacer.`,
            variant: 'danger',
            confirmText: 'Eliminar Almacén',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await api.delete(`/warehouses/${wh.id}`);
                    toast.success('Almacén eliminado correctamente');
                    fetchInitialData();
                    if (selectedWarehouse?.id === wh.id) setSelectedWarehouse(null);
                } catch (error) {
                    toast.error(error.response?.data?.error || 'Error al eliminar almacén');
                }
            }
        });
    };

    // ----------------------------------------------------
    // AJUSTE MANUAL DE STOCK
    // ----------------------------------------------------
    const handleOpenAdjustModal = (item) => {
        setAdjustItem(item);
        setAdjustForm({ newQuantity: item.quantity, reason: '' });
        setIsAdjustModalOpen(true);
    };

    const handleSaveStockAdjust = async (e) => {
        e.preventDefault();
        if (!adjustItem || !selectedWarehouse) return;
        const newQty = parseFloat(adjustForm.newQuantity);
        if (isNaN(newQty) || newQty < 0) return toast.error('Ingrese una cantidad válida');

        try {
            await api.post(`/warehouses/${selectedWarehouse.id}/adjust-stock`, {
                productId: adjustItem.productId,
                newQuantity: newQty,
                reason: adjustForm.reason
            });
            toast.success('Stock actualizado correctamente');
            setIsAdjustModalOpen(false);
            handleSelectWarehouse(selectedWarehouse);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al ajustar stock');
        }
    };

    // ----------------------------------------------------
    // GUÍAS DE TRASLADO HANDLERS
    // ----------------------------------------------------
    const handleOpenTransferModal = () => {
        if (warehouses.length < 2) {
            return toast.error('Se requieren al menos 2 almacenes para realizar traslados');
        }
        setTransferForm({
            fromWarehouseId: warehouses[0]?.id || '',
            toWarehouseId: warehouses[1]?.id || '',
            driverName: '',
            vehiclePlate: '',
            notes: '',
            status: 'BORRADOR',
            items: []
        });
        setTransferProdSearch('');
        setIsTransferModalOpen(true);
    };

    const handleAddTransferItem = (prod) => {
        const existing = transferForm.items.find(it => it.productId === prod.id);
        if (existing) {
            setTransferForm(prev => ({
                ...prev,
                items: prev.items.map(it => it.productId === prod.id ? { ...it, quantity: it.quantity + 1 } : it)
            }));
        } else {
            setTransferForm(prev => ({
                ...prev,
                items: [...prev.items, {
                    productId: prod.id,
                    productName: prod.name,
                    productSku: prod.barcode || '',
                    quantity: 1
                }]
            }));
        }
        toast.success(`Agregado: ${prod.name}`);
    };

    const handleRemoveTransferItem = (prodId) => {
        setTransferForm(prev => ({
            ...prev,
            items: prev.items.filter(it => it.productId !== prodId)
        }));
    };

    const handleSaveTransfer = async (e) => {
        e.preventDefault();
        if (!transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
            return toast.error('Seleccione almacén origen y destino');
        }
        if (transferForm.fromWarehouseId === transferForm.toWarehouseId) {
            return toast.error('El almacén origen y destino no pueden ser iguales');
        }
        if (transferForm.items.length === 0) {
            return toast.error('Agregue al menos un producto a la guía');
        }

        try {
            await api.post('/warehouses/transfers', transferForm);
            toast.success('Guía de traslado generada exitosamente');
            setIsTransferModalOpen(false);
            fetchInitialData();
            if (selectedWarehouse) handleSelectWarehouse(selectedWarehouse);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al generar traslado');
        }
    };

    const handleDispatchTransfer = (trf) => {
        setConfirmConfig({
            isOpen: true,
            title: `Despachar Guía ${trf.transferNumber}`,
            message: `¿Confirmar despacho de la guía ${trf.transferNumber}? El stock se descontará de inmediato del almacén de origen y pasará a estado En Tránsito.`,
            variant: 'primary',
            confirmText: 'Despachar Guía',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await api.post(`/warehouses/transfers/${trf.id}/dispatch`);
                    toast.success(`Guía ${trf.transferNumber} en tránsito`);
                    fetchInitialData();
                    if (selectedWarehouse) handleSelectWarehouse(selectedWarehouse);
                } catch (error) {
                    toast.error(error.response?.data?.error || 'Error al despachar guía');
                }
            }
        });
    };

    const handleOpenReceiveModal = (trf) => {
        setReceivingTransfer(trf);
        setReceivedItemsInputs(trf.Items?.map(it => ({
            id: it.id,
            productId: it.productId,
            productName: it.productName,
            quantityDispatched: it.quantityDispatched,
            quantityReceived: it.quantityDispatched, // por defecto asume completo
            discrepancyReason: ''
        })) || []);
        setReceptionNotes('');
        setIsReceiveModalOpen(true);
    };

    const handleConfirmReceiveTransfer = async (e) => {
        e.preventDefault();
        if (!receivingTransfer) return;

        try {
            await api.post(`/warehouses/transfers/${receivingTransfer.id}/receive`, {
                receivedItems: receivedItemsInputs,
                notes: receptionNotes
            });
            toast.success(`Guía ${receivingTransfer.transferNumber} recibida e ingresada a stock`);
            setIsReceiveModalOpen(false);
            fetchInitialData();
            if (selectedWarehouse) handleSelectWarehouse(selectedWarehouse);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al recibir guía');
        }
    };

    // ----------------------------------------------------
    // TOMAS FÍSICAS (AUDITORÍAS) HANDLERS
    // ----------------------------------------------------
    const handleOpenNewCountModal = () => {
        setCountForm({
            warehouseId: warehouses[0]?.id || '',
            countedBy: '',
            blindCount: true
        });
        setIsCountModalOpen(true);
    };

    const handleCreateCount = async (e) => {
        e.preventDefault();
        if (!countForm.warehouseId) return toast.error('Seleccione un almacén para el conteo');

        try {
            const res = await api.post('/warehouses/counts', countForm);
            toast.success(`Conteo ${res.data.countNumber} iniciado con éxito`);
            setIsCountModalOpen(false);
            fetchInitialData();
            handleOpenCountExec(res.data);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al iniciar conteo');
        }
    };

    const handleOpenCountExec = (cnt) => {
        setActiveCount(cnt);
        setCountItemsState(cnt.items || []);
        setIsCountExecModalOpen(true);
    };

    const handleCountUnitChange = (index, value) => {
        const val = parseFloat(value) || 0;
        setCountItemsState(prev => {
            const next = [...prev];
            const item = { ...next[index] };
            item.countedStock = val;
            item.difference = val - item.systemStock;
            item.differenceCost = item.difference * (item.costPrice || 0);
            item.counted = true;
            next[index] = item;
            return next;
        });
    };

    const handleSaveCountProgress = async () => {
        if (!activeCount) return;
        try {
            const res = await api.put(`/warehouses/counts/${activeCount.id}/progress`, {
                items: countItemsState
            });
            setActiveCount(res.data);
            toast.success('Progreso de conteo guardado');
            fetchInitialData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al guardar progreso');
        }
    };

    const handleApplyInventoryAdjustment = () => {
        if (!activeCount) return;
        setConfirmConfig({
            isOpen: true,
            title: 'Aplicar Ajuste de Auditoría',
            message: `¿Confirmar APLICACIÓN del ajuste de inventario ${activeCount.countNumber}? Se actualizarán automáticamente los stocks de todos los productos auditados con discrepancias.`,
            variant: 'primary',
            confirmText: 'Aplicar Ajuste',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await api.post(`/warehouses/counts/${activeCount.id}/apply`, {
                        notes: 'Ajuste confirmado por auditoría'
                    });
                    toast.success('¡Inventario ajustado y sincronizado exitosamente!');
                    setIsCountExecModalOpen(false);
                    fetchInitialData();
                    if (selectedWarehouse) handleSelectWarehouse(selectedWarehouse);
                } catch (error) {
                    toast.error(error.response?.data?.error || 'Error al aplicar conteo');
                }
            }
        });
    };

    // ----------------------------------------------------
    // LISTAS DE PRECIOS HANDLERS
    // ----------------------------------------------------
    const handleOpenPriceListModal = (pl = null) => {
        if (pl) {
            setEditingPriceList(pl);
            setPriceListForm({
                name: pl.name,
                code: pl.code,
                description: pl.description || '',
                type: pl.type || 'PERCENTAGE',
                percentageAdjustment: pl.percentageAdjustment || 0,
                currency: pl.currency || 'USD',
                isDefault: Boolean(pl.isDefault)
            });
        } else {
            setEditingPriceList(null);
            setPriceListForm({
                name: '',
                code: '',
                description: '',
                type: 'PERCENTAGE',
                percentageAdjustment: 0,
                currency: 'USD',
                isDefault: false
            });
        }
        setIsPriceListModalOpen(true);
    };

    const handleSavePriceList = async (e) => {
        e.preventDefault();
        if (!priceListForm.name) return toast.error('El nombre de la lista es requerido');

        try {
            if (editingPriceList) {
                await api.put(`/warehouses/price-lists/${editingPriceList.id}`, priceListForm);
                toast.success('Lista de precios actualizada');
            } else {
                await api.post('/warehouses/price-lists', priceListForm);
                toast.success('Lista de precios creada');
            }
            setIsPriceListModalOpen(false);
            fetchInitialData();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al guardar lista de precios');
        }
    };

    const handleDeletePriceList = (pl) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Lista de Precios',
            message: `¿Estás seguro de que deseas eliminar la lista "${pl.name}"? Los productos asignados volverán a su precio de venta estándar.`,
            variant: 'danger',
            confirmText: 'Eliminar Lista',
            cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await api.delete(`/warehouses/price-lists/${pl.id}`);
                    toast.success('Lista eliminada correctamente');
                    fetchInitialData();
                } catch (error) {
                    toast.error(error.response?.data?.error || 'Error al eliminar');
                }
            }
        });
    };

    const handleCalculatePriceSim = async () => {
        if (!simProduct) return toast.error('Seleccione un producto');
        try {
            const res = await api.get('/warehouses/calculate-price', {
                params: {
                    productId: simProduct,
                    priceListId: simPriceList || undefined,
                    quantity: simQuantity
                }
            });
            const p = products.find(pr => pr.id === simProduct);
            setSimResult({
                productName: p?.name || 'Producto',
                basePrice: p?.price || 0,
                finalPrice: res.data.finalPrice,
                savings: (p?.price || 0) - res.data.finalPrice
            });
        } catch (error) {
            toast.error('Error al simular precio');
        }
    };

    return (
        <div className="space-y-6 pb-28 sm:pb-20 pb-safe">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs text-slate-900 dark:text-white">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                            <WarehouseIcon size={20} />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                                Logística & Almacenes Múltiples
                            </h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Piso de venta, depósitos, guías de traslado en tránsito, tomas físicas y listas de precios
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleOpenTransferModal}
                        className="flex items-center gap-2 px-3.5 py-2 min-h-[38px] bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                    >
                        <Truck size={14} className="text-slate-500 dark:text-slate-400" />
                        Guía de Traslado
                    </button>
                    <button
                        onClick={handleOpenNewCountModal}
                        className="flex items-center gap-2 px-3.5 py-2 min-h-[38px] bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                    >
                        <ClipboardList size={14} className="text-slate-500 dark:text-slate-400" />
                        Toma Física
                    </button>
                    <button
                        onClick={() => handleOpenWarehouseModal()}
                        className="flex items-center gap-2 px-3.5 py-2 min-h-[38px] bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 rounded-lg font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                    >
                        <Plus size={14} />
                        Nuevo Almacén
                    </button>
                </div>
            </div>

            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Almacenes Activos</span>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">{warehouses.length}</div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                        <Building2 size={18} />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Stock Total Unidades</span>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">{totalUnitsAll.toLocaleString()}</div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                        <Package size={18} />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">En Tránsito Activos</span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">{inTransitCount}</span>
                            {inTransitCount > 0 && (
                                <span className="px-2 py-0.5 text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 font-bold rounded-md">
                                    En tránsito
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                        <Truck size={18} />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                    <div>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">Tomas en Progreso</span>
                        <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">{pendingCounts}</div>
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                        <ClipboardList size={18} />
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 overflow-x-auto no-scrollbar pb-1">
                <button
                    onClick={() => setActiveTab('almacenes')}
                    className={`shrink-0 flex items-center justify-center min-h-[40px] gap-2 px-4 py-2 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                        activeTab === 'almacenes'
                            ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                            : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    <WarehouseIcon size={15} />
                    Almacenes & Stock
                </button>

                <button
                    onClick={() => setActiveTab('traslados')}
                    className={`shrink-0 flex items-center justify-center min-h-[40px] gap-2 px-4 py-2 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                        activeTab === 'traslados'
                            ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                            : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    <Truck size={15} />
                    Guías de Traslado
                    {inTransitCount > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded font-mono font-bold">
                            {inTransitCount}
                        </span>
                    )}
                </button>

                <button
                    onClick={() => setActiveTab('conteo')}
                    className={`shrink-0 flex items-center justify-center min-h-[40px] gap-2 px-4 py-2 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                        activeTab === 'conteo'
                            ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                            : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    <ClipboardList size={15} />
                    Tomas Físicas (Auditorías)
                </button>

                <button
                    onClick={() => setActiveTab('precios')}
                    className={`shrink-0 flex items-center justify-center min-h-[40px] gap-2 px-4 py-2 font-semibold text-xs border-b-2 transition-all cursor-pointer ${
                        activeTab === 'precios'
                            ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                            : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    <Tags size={15} />
                    Listas de Precios
                </button>
            </div>

            {/* TAB CONTENT: 1. ALMACENES & STOCK */}
            {activeTab === 'almacenes' && (
                <div className="space-y-6">
                    {/* Warehouses Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {warehouses.map(wh => {
                            const isSelected = selectedWarehouse?.id === wh.id;
                            return (
                                <div
                                    key={wh.id}
                                    onClick={() => handleSelectWarehouse(wh)}
                                    className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                                        isSelected
                                            ? 'bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2.5 rounded-xl ${
                                                wh.isDefaultSaleWarehouse 
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                            }`}>
                                                <Building2 size={20} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                    {wh.name}
                                                </h3>
                                                <span className="text-xs font-mono font-bold text-indigo-500">{wh.code}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleOpenWarehouseModal(wh); }}
                                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            {!wh.isDefaultSaleWarehouse && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteWarehouse(wh); }}
                                                    className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-lg text-slate-400 hover:text-rose-500"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {wh.location && (
                                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-3">
                                            <MapPin size={12} /> {wh.location}
                                        </p>
                                    )}

                                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs font-medium">
                                        <span className="text-slate-500">Unidades:</span>
                                        <span className="font-black text-slate-900 dark:text-white">{(wh.totalItems || 0).toLocaleString()} uds.</span>
                                    </div>

                                    {wh.isDefaultSaleWarehouse && (
                                        <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">
                                            <Check size={12} /> Piso de Venta Principal
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Stock Detail View of Selected Warehouse */}
                    {selectedWarehouse && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/20">
                                <div>
                                    <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                                        Existencias en: <span className="text-indigo-600 dark:text-indigo-400">{selectedWarehouse.name}</span>
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        {filteredStocks.length} productos registrados en este almacén
                                    </p>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            value={stockSearch}
                                            onChange={e => setStockSearch(e.target.value)}
                                            placeholder="Buscar producto o código..."
                                            className="pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none w-64"
                                        />
                                    </div>
                                    <button
                                        onClick={() => handleSelectWarehouse(selectedWarehouse)}
                                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-slate-500"
                                        title="Refrescar"
                                    >
                                        <RefreshCw size={16} className={stockLoading ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-100/70 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 uppercase font-black tracking-wider">
                                        <tr>
                                            <th className="p-3 pl-5">Producto</th>
                                            <th className="p-3">Código / Barras</th>
                                            <th className="p-3 text-right">Precio Detal</th>
                                            <th className="p-3 text-right">Costo</th>
                                            <th className="p-3 text-right">Stock Almacén</th>
                                            <th className="p-3 text-right">Valoración</th>
                                            <th className="p-3 text-center">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                        {filteredStocks.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="text-center py-10 text-slate-400">
                                                    No hay existencias cargadas en este almacén aún.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredStocks.map(s => (
                                                <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                    <td className="p-3 pl-5 font-bold text-slate-900 dark:text-white">
                                                        {s.productName}
                                                    </td>
                                                    <td className="p-3 font-mono text-slate-500">
                                                        {s.barcode || 'S/C'}
                                                    </td>
                                                    <td className="p-3 text-right text-slate-700 dark:text-slate-300">
                                                        {formatMoney(s.price)}
                                                    </td>
                                                    <td className="p-3 text-right text-slate-500">
                                                        {formatMoney(s.cost)}
                                                    </td>
                                                    <td className="p-3 text-right font-black">
                                                        <span className={`px-2 py-0.5 rounded-md ${
                                                            s.quantity > 5 
                                                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' 
                                                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                                                        }`}>
                                                            {s.quantity} {s.unit}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-right font-bold text-slate-900 dark:text-white">
                                                        {formatMoney(s.valuation)}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <button
                                                            onClick={() => handleOpenAdjustModal(s)}
                                                            className="px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-400 rounded-lg text-slate-600 dark:text-slate-300 font-bold transition-all text-[11px]"
                                                        >
                                                            Ajustar
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: 2. GUÍAS DE TRASLADO */}
            {activeTab === 'traslados' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-white text-sm">Historial de Guías de Traslado Inter-Almacén</h3>
                            <button
                                onClick={handleOpenTransferModal}
                                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs shadow transition-all"
                            >
                                <Plus size={14} /> Nueva Guía
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-100/70 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 uppercase font-black">
                                    <tr>
                                        <th className="p-3 pl-5">N° Guía</th>
                                        <th className="p-3">Origen</th>
                                        <th className="p-3">Destino</th>
                                        <th className="p-3">Chofer / Placa</th>
                                        <th className="p-3 text-right">Items / Uds</th>
                                        <th className="p-3 text-center">Estado</th>
                                        <th className="p-3 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                    {transfers.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="text-center py-10 text-slate-400">
                                                No hay traslados registrados.
                                            </td>
                                        </tr>
                                    ) : (
                                        transfers.map(t => {
                                            const isBorrador = t.status === 'BORRADOR';
                                            const isEnTransito = t.status === 'EN_TRANSITO';
                                            const isRecibido = t.status.startsWith('RECIBIDO');

                                            return (
                                                <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                    <td className="p-3 pl-5 font-mono font-black text-indigo-600 dark:text-indigo-400">
                                                        {t.transferNumber}
                                                    </td>
                                                    <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                                        {t.FromWarehouse?.name || 'Origen'}
                                                    </td>
                                                    <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                                        {t.ToWarehouse?.name || 'Destino'}
                                                    </td>
                                                    <td className="p-3 text-slate-500">
                                                        {t.driverName ? `${t.driverName} (${t.vehiclePlate || 'S/P'})` : 'Entrega directa'}
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <span className="font-bold text-slate-900 dark:text-white">{t.itemsCount} productos</span> ({t.totalUnits} uds)
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase tracking-wider ${
                                                            isBorrador ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                                                            isEnTransito ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 animate-pulse' :
                                                            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                                        }`}>
                                                            {t.status.replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-center space-x-2">
                                                        {isBorrador && (
                                                            <button
                                                                onClick={() => handleDispatchTransfer(t)}
                                                                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all"
                                                            >
                                                                Despachar
                                                            </button>
                                                        )}
                                                        {isEnTransito && (
                                                            <button
                                                                onClick={() => handleOpenReceiveModal(t)}
                                                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all"
                                                            >
                                                                Recibir en Destino
                                                            </button>
                                                        )}
                                                        {isRecibido && (
                                                            <span className="text-xs text-slate-400 font-bold">Completada</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: 3. TOMAS FÍSICAS */}
            {activeTab === 'conteo' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-white text-sm">Auditorías & Tomas Físicas de Inventario</h3>
                                <p className="text-xs text-slate-500">Conteos ciegos para control de merma y balance de stock</p>
                            </div>
                            <button
                                onClick={handleOpenNewCountModal}
                                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow transition-all"
                            >
                                <Plus size={14} /> Nueva Toma Física
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-100/70 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 uppercase font-black">
                                    <tr>
                                        <th className="p-3 pl-5">N° Conteo</th>
                                        <th className="p-3">Almacén</th>
                                        <th className="p-3">Responsable</th>
                                        <th className="p-3">Modalidad</th>
                                        <th className="p-3 text-right">Discrepancia Uds</th>
                                        <th className="p-3 text-center">Estado</th>
                                        <th className="p-3 text-center">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                    {counts.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="text-center py-10 text-slate-400">
                                                No hay tomas físicas de inventario registradas.
                                            </td>
                                        </tr>
                                    ) : (
                                        counts.map(cnt => (
                                            <tr key={cnt.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                <td className="p-3 pl-5 font-mono font-black text-emerald-600 dark:text-emerald-400">
                                                    {cnt.countNumber}
                                                </td>
                                                <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                                    {cnt.Warehouse?.name || 'Almacén'}
                                                </td>
                                                <td className="p-3 text-slate-500">
                                                    {cnt.countedBy || 'Personal de Tienda'}
                                                </td>
                                                <td className="p-3">
                                                    <span className="px-2 py-0.5 text-[10px] font-black rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                        {cnt.blindCount ? 'CONTEO CIEGO' : 'CONTEO VISIBLE'}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-right font-black">
                                                    <span className={cnt.totalDiscrepancyUnits !== 0 ? 'text-rose-500' : 'text-emerald-500'}>
                                                        {cnt.totalDiscrepancyUnits} uds
                                                    </span>
                                                </td>
                                                <td className="p-3 text-center">
                                                    <span className={`px-2.5 py-1 text-[10px] font-black rounded-full uppercase ${
                                                        cnt.status === 'EN_PROGRESO' 
                                                            ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' 
                                                            : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                                    }`}>
                                                        {cnt.status}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-center">
                                                    <button
                                                        onClick={() => handleOpenCountExec(cnt)}
                                                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-[11px] shadow-sm transition-all"
                                                    >
                                                        {cnt.status === 'EN_PROGRESO' ? 'Continuar Conteo' : 'Ver Detalle'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: 4. LISTAS DE PRECIOS */}
            {activeTab === 'precios' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Price Lists Table */}
                        <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white">Estrategias y Listas de Precios</h3>
                                    <p className="text-xs text-slate-500">Segmentación para ventas al detal, mayor, distribuidores o VIP</p>
                                </div>
                                <button
                                    onClick={() => handleOpenPriceListModal()}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs shadow transition-all"
                                >
                                    <Plus size={14} /> Nueva Lista
                                </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {priceLists.map(pl => (
                                    <div
                                        key={pl.id}
                                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                    {pl.name}
                                                </h4>
                                                <span className="text-xs font-mono font-bold text-indigo-500">{pl.code}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleOpenPriceListModal(pl)}
                                                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                {!pl.isDefault && (
                                                    <button
                                                        onClick={() => handleDeletePriceList(pl)}
                                                        className="p-1 text-slate-400 hover:text-rose-500"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <p className="text-xs text-slate-500">{pl.description || 'Sin descripción'}</p>

                                        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/60 dark:border-slate-700/60 font-medium">
                                            <span className="text-slate-500">Ajuste:</span>
                                            <span className={`font-black ${
                                                pl.percentageAdjustment < 0 
                                                    ? 'text-emerald-600 dark:text-emerald-400' 
                                                    : pl.percentageAdjustment > 0 
                                                    ? 'text-indigo-600 dark:text-indigo-400' 
                                                    : 'text-slate-600 dark:text-slate-400'
                                            }`}>
                                                {pl.percentageAdjustment > 0 ? `+${pl.percentageAdjustment}%` : `${pl.percentageAdjustment}%`}
                                            </span>
                                        </div>

                                        {pl.isDefault && (
                                            <span className="inline-block px-2 py-0.5 text-[10px] font-black bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded">
                                                Lista Predeterminada
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Interactive Price Simulator */}
                        <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xs">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                                    <Calculator size={16} />
                                </div>
                                <h3 className="font-bold text-sm tracking-tight text-slate-900 dark:text-white">Simulador de Precios</h3>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Comprueba al instante cómo se aplica la regla de precios a un producto según lista y cantidad
                            </p>

                            <div className="space-y-3 pt-2">
                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Producto</label>
                                    <select
                                        value={simProduct}
                                        onChange={e => setSimProduct(e.target.value)}
                                        className="w-full mt-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg outline-none text-slate-900 dark:text-white focus:border-slate-400 transition-colors"
                                    >
                                        <option value="">Seleccione un producto...</option>
                                        {products.map(p => (
                                            <option key={p.id} value={p.id}>{p.name} - Base: {formatMoney(p.price)}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Lista de Precios</label>
                                    <select
                                        value={simPriceList}
                                        onChange={e => setSimPriceList(e.target.value)}
                                        className="w-full mt-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg outline-none text-slate-900 dark:text-white focus:border-slate-400 transition-colors"
                                    >
                                        <option value="">Precio Base (Sin lista)</option>
                                        {priceLists.map(pl => (
                                            <option key={pl.id} value={pl.id}>{pl.name} ({pl.percentageAdjustment}%)</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cantidad</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={simQuantity}
                                        onChange={e => setSimQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                        className="w-full mt-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg outline-none text-slate-900 dark:text-white focus:border-slate-400 font-mono transition-colors"
                                    />
                                </div>

                                <button
                                    onClick={handleCalculatePriceSim}
                                    className="w-full py-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 font-semibold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
                                >
                                    Calcular Precio
                                </button>

                                {simResult && (
                                    <div className="mt-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1">
                                        <div className="text-xs text-slate-500 dark:text-slate-400">Precio Unitario Calculado:</div>
                                        <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                                            {formatMoney(simResult.finalPrice)}
                                        </div>
                                        {simResult.savings !== 0 && (
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                                Diferencia vs PVP Base: {simResult.savings > 0 ? `Ahorro de ${formatMoney(simResult.savings)}` : `Recargo de ${formatMoney(Math.abs(simResult.savings))}`}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: Crear/Editar Almacén */}
            {isWarehouseModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md max-h-[92dvh] overflow-y-auto pb-safe shadow-2xl animate-in fade-in zoom-in-95">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white">
                                {editingWarehouse ? 'Editar Almacén' : 'Nuevo Almacén / Bodega'}
                            </h3>
                            <button onClick={() => setIsWarehouseModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveWarehouse} className="p-5 space-y-4 text-xs">
                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Nombre del Almacén</label>
                                <input
                                    type="text"
                                    required
                                    value={warehouseForm.name}
                                    onChange={e => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                                    placeholder="Ej: Depósito Central, Piso de Venta"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Código</label>
                                    <input
                                        type="text"
                                        value={warehouseForm.code}
                                        onChange={e => setWarehouseForm({ ...warehouseForm, code: e.target.value })}
                                        placeholder="Ej: ALM-01"
                                        className="w-full mt-1 p-2 font-mono uppercase bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Ubicación / Zona</label>
                                    <input
                                        type="text"
                                        value={warehouseForm.location}
                                        onChange={e => setWarehouseForm({ ...warehouseForm, location: e.target.value })}
                                        placeholder="Ej: Zona Norte, Pasillo 4"
                                        className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Descripción</label>
                                <textarea
                                    value={warehouseForm.description}
                                    onChange={e => setWarehouseForm({ ...warehouseForm, description: e.target.value })}
                                    rows={2}
                                    placeholder="Detalles sobre el uso de este almacén"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="checkbox"
                                    id="defaultSale"
                                    checked={warehouseForm.isDefaultSaleWarehouse}
                                    onChange={e => setWarehouseForm({ ...warehouseForm, isDefaultSaleWarehouse: e.target.checked })}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <label htmlFor="defaultSale" className="font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                                    Almacén predeterminado para ventas en caja (Piso de Venta)
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsWarehouseModalOpen(false)}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg"
                                >
                                    Guardar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Ajustar Stock Manual */}
            {isAdjustModalOpen && adjustItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm max-h-[92dvh] overflow-y-auto pb-safe shadow-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white">Ajuste de Stock</h3>
                            <button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveStockAdjust} className="p-5 space-y-4 text-xs">
                            <div>
                                <span className="text-slate-500">Producto:</span>
                                <div className="font-black text-sm text-slate-900 dark:text-white">{adjustItem.productName}</div>
                                <div className="text-slate-400 font-mono text-[11px]">Stock actual: {adjustItem.quantity} {adjustItem.unit}</div>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Nueva Cantidad Física</label>
                                <input
                                    type="number"
                                    step="any"
                                    required
                                    value={adjustForm.newQuantity}
                                    onChange={e => setAdjustForm({ ...adjustForm, newQuantity: e.target.value })}
                                    className="w-full mt-1 p-2 font-mono font-bold text-base bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Motivo del Ajuste</label>
                                <input
                                    type="text"
                                    value={adjustForm.reason}
                                    onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                                    placeholder="Ej: Merma detectada, conteo rápido"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAdjustModalOpen(false)}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg"
                                >
                                    Aplicar Ajuste
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Nueva Guía de Traslado */}
            {isTransferModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92dvh] pb-safe flex flex-col overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white">Generar Guía de Traslado</h3>
                            <button onClick={() => setIsTransferModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveTransfer} className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Almacén Origen</label>
                                    <select
                                        value={transferForm.fromWarehouseId}
                                        onChange={e => setTransferForm({ ...transferForm, fromWarehouseId: e.target.value })}
                                        className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    >
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Almacén Destino</label>
                                    <select
                                        value={transferForm.toWarehouseId}
                                        onChange={e => setTransferForm({ ...transferForm, toWarehouseId: e.target.value })}
                                        className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    >
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Nombre del Chofer / Transportista</label>
                                    <input
                                        type="text"
                                        value={transferForm.driverName}
                                        onChange={e => setTransferForm({ ...transferForm, driverName: e.target.value })}
                                        placeholder="Ej: José Silva"
                                        className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Placa del Vehículo</label>
                                    <input
                                        type="text"
                                        value={transferForm.vehiclePlate}
                                        onChange={e => setTransferForm({ ...transferForm, vehiclePlate: e.target.value })}
                                        placeholder="Ej: A12BC3D"
                                        className="w-full mt-1 p-2 uppercase font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    />
                                </div>
                            </div>

                            {/* Product Search & Selection */}
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                                <label className="font-bold text-slate-700 dark:text-slate-300">Agregar Productos al Despacho</label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                    <input
                                        type="text"
                                        value={transferProdSearch}
                                        onChange={e => setTransferProdSearch(e.target.value)}
                                        placeholder="Buscar por nombre o código de barra..."
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none"
                                    />
                                </div>

                                {transferProdSearch && (
                                    <div className="max-h-36 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 shadow-md">
                                        {products.filter(p => p.name.toLowerCase().includes(transferProdSearch.toLowerCase())).slice(0, 5).map(p => (
                                            <div
                                                key={p.id}
                                                onClick={() => { handleAddTransferItem(p); setTransferProdSearch(''); }}
                                                className="p-2 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs"
                                            >
                                                <span className="font-bold text-slate-800 dark:text-slate-200">{p.name}</span>
                                                <span className="text-indigo-600 dark:text-indigo-400 font-bold">+ Agregar</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Selected Items Table */}
                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden mt-3">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold">
                                            <tr>
                                                <th className="p-2 pl-3">Producto</th>
                                                <th className="p-2 w-28 text-right">Cantidad</th>
                                                <th className="p-2 w-12 text-center"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {transferForm.items.length === 0 ? (
                                                <tr>
                                                    <td colSpan={3} className="text-center py-6 text-slate-400">
                                                        No has agregado productos a la guía.
                                                    </td>
                                                </tr>
                                            ) : (
                                                transferForm.items.map((it, idx) => (
                                                    <tr key={it.productId}>
                                                        <td className="p-2 pl-3 font-semibold text-slate-800 dark:text-slate-200">
                                                            {it.productName}
                                                        </td>
                                                        <td className="p-2 text-right">
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={it.quantity}
                                                                onChange={e => {
                                                                    const val = parseFloat(e.target.value) || 1;
                                                                    setTransferForm(prev => ({
                                                                        ...prev,
                                                                        items: prev.items.map((item, i) => i === idx ? { ...item, quantity: val } : item)
                                                                    }));
                                                                }}
                                                                className="w-20 p-1 text-right font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                                                            />
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveTransferItem(it.productId)}
                                                                className="text-rose-500 hover:text-rose-700"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Notas / Instrucciones de Envío</label>
                                <textarea
                                    value={transferForm.notes}
                                    onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })}
                                    rows={2}
                                    placeholder="Observaciones para el transportista o recepción"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsTransferModalOpen(false)}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg"
                                >
                                    Crear Guía de Traslado
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Recepción de Guía (Cotejo de Cantidades) */}
            {isReceiveModalOpen && receivingTransfer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92dvh] pb-safe flex flex-col overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white">
                                    Recepción de Guía: {receivingTransfer.transferNumber}
                                </h3>
                                <p className="text-xs text-slate-500">
                                    Verifique las cantidades físicas recibidas antes de ingresar al stock destino.
                                </p>
                            </div>
                            <button onClick={() => setIsReceiveModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleConfirmReceiveTransfer} className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
                            <table className="w-full text-left">
                                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold">
                                    <tr>
                                        <th className="p-2 pl-3">Producto</th>
                                        <th className="p-2 text-right">Despachado</th>
                                        <th className="p-2 text-right w-28">Recibido Real</th>
                                        <th className="p-2">Motivo Discrepancia</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                    {receivedItemsInputs.map((item, idx) => (
                                        <tr key={item.productId}>
                                            <td className="p-2 pl-3 font-semibold text-slate-800 dark:text-slate-200">
                                                {item.productName}
                                            </td>
                                            <td className="p-2 text-right font-mono font-bold text-slate-600 dark:text-slate-400">
                                                {item.quantityDispatched} uds
                                            </td>
                                            <td className="p-2 text-right">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={item.quantityReceived}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setReceivedItemsInputs(prev => prev.map((it, i) => i === idx ? { ...it, quantityReceived: val } : it));
                                                    }}
                                                    className="w-20 p-1 text-right font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="text"
                                                    placeholder="Si falta o sobra..."
                                                    value={item.discrepancyReason}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setReceivedItemsInputs(prev => prev.map((it, i) => i === idx ? { ...it, discrepancyReason: val } : it));
                                                    }}
                                                    className="w-full p-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Notas Generales de Recepción</label>
                                <textarea
                                    value={receptionNotes}
                                    onChange={e => setReceptionNotes(e.target.value)}
                                    rows={2}
                                    placeholder="Observaciones finales de la entrega..."
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsReceiveModalOpen(false)}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg"
                                >
                                    Confirmar e Ingresar a Stock
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Iniciar Nueva Toma Física */}
            {isCountModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm max-h-[92dvh] overflow-y-auto pb-safe shadow-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white">Nueva Toma Física</h3>
                            <button onClick={() => setIsCountModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleCreateCount} className="p-5 space-y-4 text-xs">
                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Almacén a Auditar</label>
                                <select
                                    value={countForm.warehouseId}
                                    onChange={e => setCountForm({ ...countForm, warehouseId: e.target.value })}
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                >
                                    {warehouses.map(w => (
                                        <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Responsable / Auditor</label>
                                <input
                                    type="text"
                                    value={countForm.countedBy}
                                    onChange={e => setCountForm({ ...countForm, countedBy: e.target.value })}
                                    placeholder="Nombre del personal que contará"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="checkbox"
                                    id="blindToggle"
                                    checked={countForm.blindCount}
                                    onChange={e => setCountForm({ ...countForm, blindCount: e.target.checked })}
                                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <label htmlFor="blindToggle" className="font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                                    Conteo Ciego (Oculta el stock teórico para evitar sesgos)
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsCountModalOpen(false)}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg"
                                >
                                    Iniciar Conteo
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: Ejecución y Cierre de Toma Física */}
            {isCountExecModalOpen && activeCount && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92dvh] pb-safe flex flex-col overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    Conteo de Inventario: <span className="font-mono text-emerald-500">{activeCount.countNumber}</span>
                                </h3>
                                <span className="text-xs text-slate-500">
                                    Almacén: {activeCount.Warehouse?.name || 'Almacén'} | Modalidad: {activeCount.blindCount ? 'Ciego' : 'Visible'}
                                </span>
                            </div>
                            <button onClick={() => setIsCountExecModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
                            <table className="w-full text-left">
                                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase">
                                    <tr>
                                        <th className="p-2.5 pl-3">Producto</th>
                                        {!activeCount.blindCount && <th className="p-2.5 text-right">Stock Sistema</th>}
                                        <th className="p-2.5 text-right w-32">Conteo Físico</th>
                                        <th className="p-2.5 text-right">Diferencia</th>
                                        <th className="p-2.5 text-right">Impacto Costo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                    {countItemsState.map((it, idx) => (
                                        <tr key={it.productId} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                            <td className="p-2.5 pl-3 font-bold text-slate-900 dark:text-white">
                                                {it.productName}
                                                <span className="block text-[11px] font-mono text-slate-400">{it.barcode}</span>
                                            </td>
                                            {!activeCount.blindCount && (
                                                <td className="p-2.5 text-right font-mono text-slate-600 dark:text-slate-400">
                                                    {it.systemStock} uds
                                                </td>
                                            )}
                                            <td className="p-2.5 text-right">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    disabled={activeCount.status !== 'EN_PROGRESO'}
                                                    value={it.countedStock}
                                                    onChange={e => handleCountUnitChange(idx, e.target.value)}
                                                    className="w-24 p-1.5 text-right font-mono font-black text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                                />
                                            </td>
                                            <td className="p-2.5 text-right font-mono font-bold">
                                                <span className={it.difference === 0 ? 'text-emerald-500' : it.difference > 0 ? 'text-indigo-500' : 'text-rose-500'}>
                                                    {it.difference > 0 ? `+${it.difference}` : it.difference} uds
                                                </span>
                                            </td>
                                            <td className="p-2.5 text-right font-bold text-slate-800 dark:text-slate-200">
                                                {formatMoney(it.differenceCost || 0)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                            <button
                                type="button"
                                onClick={() => setIsCountExecModalOpen(false)}
                                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs"
                            >
                                Cerrar Ventana
                            </button>

                            {activeCount.status === 'EN_PROGRESO' && (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleSaveCountProgress}
                                        className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-bold text-xs"
                                    >
                                        Guardar Avance
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleApplyInventoryAdjustment}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow-lg"
                                    >
                                        Aplicar Ajuste a Inventario
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: Crear/Editar Lista de Precios */}
            {isPriceListModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm max-h-[92dvh] overflow-y-auto pb-safe shadow-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-slate-900 dark:text-white">
                                {editingPriceList ? 'Editar Lista de Precios' : 'Nueva Lista de Precios'}
                            </h3>
                            <button onClick={() => setIsPriceListModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSavePriceList} className="p-5 space-y-4 text-xs">
                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Nombre de la Lista</label>
                                <input
                                    type="text"
                                    required
                                    value={priceListForm.name}
                                    onChange={e => setPriceListForm({ ...priceListForm, name: e.target.value })}
                                    placeholder="Ej: Mayorista 15%, VIP, Empleados"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Código</label>
                                    <input
                                        type="text"
                                        value={priceListForm.code}
                                        onChange={e => setPriceListForm({ ...priceListForm, code: e.target.value })}
                                        placeholder="Ej: MAYOR"
                                        className="w-full mt-1 p-2 uppercase font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-slate-700 dark:text-slate-300">Ajuste % (+ / -)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={priceListForm.percentageAdjustment}
                                        onChange={e => setPriceListForm({ ...priceListForm, percentageAdjustment: e.target.value })}
                                        placeholder="Ej: -10 para 10% desc"
                                        className="w-full mt-1 p-2 font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300">Descripción</label>
                                <textarea
                                    value={priceListForm.description}
                                    onChange={e => setPriceListForm({ ...priceListForm, description: e.target.value })}
                                    rows={2}
                                    placeholder="Condiciones o notas para esta lista"
                                    className="w-full mt-1 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="checkbox"
                                    id="defaultPriceList"
                                    checked={priceListForm.isDefault}
                                    onChange={e => setPriceListForm({ ...priceListForm, isDefault: e.target.checked })}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <label htmlFor="defaultPriceList" className="font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                                    Lista Predeterminada (Detal PVP)
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsPriceListModalOpen(false)}
                                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg"
                                >
                                    Guardar Lista
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            
            {/* Modal de Confirmación Moderno */}
            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.onConfirm}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant}
                confirmText={confirmConfig.confirmText}
                cancelText={confirmConfig.cancelText}
            />
        </div>
    );
}
