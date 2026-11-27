import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Plus, 
    Trash2, 
    Edit3, 
    CheckCircle2, 
    XCircle, 
    Calendar, 
    Clock, 
    Tag, 
    Package, 
    Percent, 
    ShoppingBag, 
    Search, 
    Layers, 
    RefreshCw, 
    X, 
    CreditCard, 
    Store, 
    Banknote, 
    Smartphone, 
    Building2, 
    Zap, 
    Fingerprint, 
    Loader2
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { db } from '../services/db';
import ConfirmModal from '../components/ConfirmModal';

const PROMO_TYPES = [
    { 
        id: 'PAYMENT_METHOD_DISCOUNT', 
        name: 'Método de Pago', 
        shortName: 'Por Pago',
        icon: CreditCard, 
        desc: 'Descuento si el cliente paga con un método calificado (Divisas, Pago Móvil, etc.)',
        color: 'blue'
    },
    { 
        id: 'VOLUME_DISCOUNT', 
        name: 'Mayorista / Volumen', 
        shortName: 'Por Volumen',
        icon: Package, 
        desc: 'A partir de cierta cantidad o empaque aplica precio especial o descuento %',
        color: 'indigo'
    },
    { 
        id: 'BUY_X_GET_Y', 
        name: 'Promoción 2x1 / 3x2', 
        shortName: 'Combos 2x1',
        icon: ShoppingBag, 
        desc: 'Compra X unidades y paga Y unidades',
        color: 'rose'
    },
    { 
        id: 'CATEGORY_DISCOUNT', 
        name: 'Por Categoría', 
        shortName: 'Categoría',
        icon: Tag, 
        desc: 'Porcentaje de descuento para todos los productos de un rubro',
        color: 'emerald'
    }
];

const AVAILABLE_PAYMENT_METHODS = [
    { id: 'cash_usd', name: 'Efectivo USD ($)', shortLabel: 'Dólares', icon: Banknote, color: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'cash_bs', name: 'Efectivo Bs (Bs)', shortLabel: 'Bolívares', icon: Banknote, color: 'text-emerald-600 dark:text-emerald-400' },
    { id: 'pago_movil', name: 'Pago Móvil', shortLabel: 'Pago Móvil', icon: Smartphone, color: 'text-blue-600 dark:text-blue-400' },
    { id: 'debit', name: 'Punto de Venta / Débito', shortLabel: 'Punto Débito', icon: CreditCard, color: 'text-indigo-600 dark:text-indigo-400' },
    { id: 'zelle', name: 'Zelle', shortLabel: 'Zelle', icon: Zap, color: 'text-purple-600 dark:text-purple-400' },
    { id: 'biopago', name: 'Biopago BDV', shortLabel: 'Biopago', icon: Fingerprint, color: 'text-sky-600 dark:text-sky-400' },
    { id: 'transfer', name: 'Transferencia Bancaria', shortLabel: 'Transferencia', icon: Building2, color: 'text-slate-600 dark:text-slate-400' }
];

const DAYS_NAMES = [
    { idx: 0, label: 'D', fullName: 'Domingo' },
    { idx: 1, label: 'L', fullName: 'Lunes' },
    { idx: 2, label: 'M', fullName: 'Martes' },
    { idx: 3, label: 'M', fullName: 'Miércoles' },
    { idx: 4, label: 'J', fullName: 'Jueves' },
    { idx: 5, label: 'V', fullName: 'Viernes' },
    { idx: 6, label: 'S', fullName: 'Sábado' }
];

export default function PromotionsManager() {
    const [promotions, setPromotions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    
    // Modal states
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPromo, setEditingPromo] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        title: '',
        message: '',
        variant: 'danger',
        confirmText: 'Sí, Eliminar',
        cancelText: 'Conservar',
        action: () => {}
    });
    
    // Product picker states
    const [allCatalogProducts, setAllCatalogProducts] = useState([]);
    const [productSearch, setProductSearch] = useState('');
    const [categories, setCategories] = useState([]);
    const [scopeMode, setScopeMode] = useState('ALL'); // 'ALL', 'PRODUCTS', 'CATEGORIES'

    // Form state
    const [form, setForm] = useState({
        name: '',
        type: 'PAYMENT_METHOD_DISCOUNT',
        description: '',
        buyQuantity: 1,
        payQuantity: 1,
        minQuantity: 1,
        minQuantityUnit: 'UNITS',
        customUnitName: '',
        customUnitFactor: 1,
        minUnits: 1,
        discountPercentage: 5,
        fixedPrice: '',
        targetProductIds: [],
        targetCategories: [],
        targetPaymentMethods: ['cash_usd'],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        priority: 1,
        isActive: true,
        allowStacking: false
    });

    const allCatalogProductsRef = useRef([]);
    useEffect(() => {
        allCatalogProductsRef.current = allCatalogProducts;
    }, [allCatalogProducts]);

    const fetchPromotions = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/promotions');
            if (data.success) {
                setPromotions(data.promotions || []);
            }
        } catch (err) {
            console.error('Error fetching promotions:', err);
            toast.error('Error al cargar promociones');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadCatalogData = useCallback(async () => {
        try {
            const list = await db.getAll('products');
            if (list && list.length > 0) {
                setAllCatalogProducts(list);
                const uniqueCats = [...new Set(list.map(p => p.category).filter(Boolean))];
                setCategories(uniqueCats);
            } else {
                const res = await api.get('/products', { params: { limit: 100 } });
                const prods = res.data?.products || (Array.isArray(res.data) ? res.data : []);
                setAllCatalogProducts(prods);
                const uniqueCats = [...new Set(prods.map(p => p.category).filter(Boolean))];
                setCategories(uniqueCats);
            }
        } catch (err) {
            console.warn('Error loading catalog products for promos:', err);
        }
    }, []);

    useEffect(() => {
        fetchPromotions();
        loadCatalogData();
    }, [fetchPromotions, loadCatalogData]);

    // Cerrar modal con tecla Escape
    useEffect(() => {
        if (!isModalOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                setIsModalOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen]);

    // Cargar dinámicamente presentaciones reales cuando se seleccionan productos específicos
    useEffect(() => {
        if (form.targetProductIds && form.targetProductIds.length > 0) {
            form.targetProductIds.forEach(prodId => {
                const existing = allCatalogProductsRef.current.find(p => String(p.id) === String(prodId));
                if (existing && (!existing.Presentations || existing.Presentations.length === 0)) {
                    api.get(`/products/${prodId}`).then(res => {
                        if (res.data?.Presentations && res.data.Presentations.length > 0) {
                            setAllCatalogProducts(prev => prev.map(p => 
                                String(p.id) === String(prodId) 
                                    ? { ...p, Presentations: res.data.Presentations } 
                                    : p
                            ));
                        }
                    }).catch(() => {});
                }
            });
        }
    }, [form.targetProductIds]);

    const handleOpenModal = (promo = null) => {
        if (promo) {
            setEditingPromo(promo);
            const pIds = Array.isArray(promo.targetProductIds) ? promo.targetProductIds : [];
            const cList = Array.isArray(promo.targetCategories) ? promo.targetCategories : [];
            let initialScope = 'ALL';
            if (pIds.length > 0) initialScope = 'PRODUCTS';
            else if (cList.length > 0) initialScope = 'CATEGORIES';
            setScopeMode(initialScope);

            setForm({
                name: promo.name || '',
                type: promo.type || 'PAYMENT_METHOD_DISCOUNT',
                description: promo.description || '',
                buyQuantity: promo.buyQuantity || 1,
                payQuantity: promo.payQuantity || 1,
                minQuantity: promo.minQuantity !== undefined ? parseFloat(promo.minQuantity) : (parseFloat(promo.buyQuantity) || 1),
                minQuantityUnit: promo.minQuantityUnit || 'UNITS',
                customUnitName: (promo.minQuantityUnit && promo.minQuantityUnit !== 'UNITS') ? promo.minQuantityUnit : '',
                customUnitFactor: (parseFloat(promo.minUnits) && parseFloat(promo.minQuantity)) 
                    ? Math.max(1, Math.round(parseFloat(promo.minUnits) / parseFloat(promo.minQuantity))) 
                    : 1,
                minUnits: promo.minUnits !== undefined ? parseFloat(promo.minUnits) : (parseFloat(promo.buyQuantity) || 1),
                discountPercentage: promo.discountPercentage || 0,
                fixedPrice: promo.fixedPrice !== null ? promo.fixedPrice : '',
                targetProductIds: pIds,
                targetCategories: cList,
                targetPaymentMethods: Array.isArray(promo.targetPaymentMethods) ? promo.targetPaymentMethods : ['cash_usd'],
                daysOfWeek: Array.isArray(promo.daysOfWeek) ? promo.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
                startDate: promo.startDate ? promo.startDate.split('T')[0] : '',
                endDate: promo.endDate ? promo.endDate.split('T')[0] : '',
                startTime: promo.startTime || '',
                endTime: promo.endTime || '',
                priority: promo.priority || 1,
                isActive: promo.isActive !== false,
                allowStacking: promo.allowStacking === true
            });
        } else {
            setEditingPromo(null);
            setScopeMode('ALL');
            setForm({
                name: '',
                type: 'PAYMENT_METHOD_DISCOUNT',
                description: '',
                buyQuantity: 1,
                payQuantity: 1,
                minQuantity: 1,
                minQuantityUnit: 'UNITS',
                customUnitName: '',
                customUnitFactor: 1,
                minUnits: 1,
                discountPercentage: 5,
                fixedPrice: '',
                targetProductIds: [],
                targetCategories: [],
                targetPaymentMethods: ['cash_usd'],
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                startDate: '',
                endDate: '',
                startTime: '',
                endTime: '',
                priority: 1,
                isActive: true,
                allowStacking: false
            });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) return toast.error('Ingresa un nombre para la promoción');

        if (form.type === 'PAYMENT_METHOD_DISCOUNT' && (!form.targetPaymentMethods || form.targetPaymentMethods.length === 0)) {
            return toast.error('Selecciona al menos un método de pago calificado para esta oferta');
        }

        try {
            setSubmitting(true);
            
            // Resolver factor y etiqueta de unidad de volumen
            let factor = 1;
            let unitLabel = 'UNITS';
            const qty = Math.max(1, parseFloat(form.minQuantity) || 1);

            if (form.minQuantityUnit === 'UNITS') {
                factor = 1;
                unitLabel = 'UNITS';
            } else if (form.minQuantityUnit === 'CUSTOM') {
                factor = Math.max(1, parseFloat(form.customUnitFactor) || 1);
                unitLabel = form.customUnitName?.trim() || 'Empaque';
            } else {
                const foundPres = availablePresentationOptions.find(o => o.id === form.minQuantityUnit);
                factor = foundPres ? foundPres.factor : 1;
                unitLabel = foundPres ? foundPres.label : form.minQuantityUnit;
            }

            const calculatedMinUnits = qty * factor;
            const resolvedBuyQty = form.type === 'BUY_X_GET_Y'
                ? (parseFloat(form.buyQuantity) || 2)
                : calculatedMinUnits;

            const payload = {
                ...form,
                targetProductIds: scopeMode === 'PRODUCTS' ? form.targetProductIds : [],
                targetCategories: scopeMode === 'CATEGORIES' ? form.targetCategories : [],
                fixedPrice: form.fixedPrice !== '' ? parseFloat(form.fixedPrice) : null,
                minQuantity: qty,
                minQuantityUnit: unitLabel,
                minUnits: form.type === 'BUY_X_GET_Y' ? resolvedBuyQty : calculatedMinUnits,
                buyQuantity: resolvedBuyQty,
                payQuantity: parseFloat(form.payQuantity) || 1,
                discountPercentage: parseFloat(form.discountPercentage) || 0,
                startDate: form.startDate ? `${form.startDate}T00:00:00.000-04:00` : null,
                endDate: form.endDate ? `${form.endDate}T23:59:59.999-04:00` : null
            };

            if (editingPromo) {
                const res = await api.put(`/promotions/${editingPromo.id}`, payload);
                if (res.data.success) {
                    toast.success('Promoción actualizada con éxito');
                    setIsModalOpen(false);
                    fetchPromotions();
                }
            } else {
                const res = await api.post('/promotions', payload);
                if (res.data.success) {
                    toast.success('Promoción creada con éxito');
                    setIsModalOpen(false);
                    fetchPromotions();
                }
            }
        } catch (err) {
            console.error('Error saving promotion:', err);
            toast.error(err.response?.data?.error || 'Error al guardar promoción');
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleActive = async (promo) => {
        try {
            const newStatus = !promo.isActive;
            await api.put(`/promotions/${promo.id}`, { isActive: newStatus });
            setPromotions(prev => prev.map(p => p.id === promo.id ? { ...p, isActive: newStatus } : p));
            toast.success(newStatus ? `Promoción activada` : `Promoción pausada`);
        } catch (err) {
            console.warn('[PromotionsManager] Error capturado en operación:', err?.message || err);
            console.error('[PromotionsManager] Error al cambiar estado:', err);
            toast.error('Error al cambiar estado');
        }
    };

    const handleDelete = (id, name) => {
        setConfirmConfig({
            isOpen: true,
            title: '¿Eliminar Promoción?',
            message: `¿Estás seguro de que deseas eliminar "${name}"? Dejará de aplicarse de inmediato en caja.`,
            variant: 'danger',
            confirmText: 'Sí, Eliminar',
            cancelText: 'Conservar',
            action: async () => {
                try {
                    await api.delete(`/promotions/${id}`);
                    setPromotions(prev => prev.filter(p => p.id !== id));
                    toast.success('Promoción eliminada con éxito');
                } catch (err) {
                    console.error('Error deleting promo:', err);
                    toast.error('Error al eliminar la promoción');
                }
            }
        });
    };

    const togglePaymentMethod = (methodId) => {
        setForm(prev => {
            const current = [...(prev.targetPaymentMethods || [])];
            if (current.includes(methodId)) {
                return { ...prev, targetPaymentMethods: current.filter(m => m !== methodId) };
            } else {
                return { ...prev, targetPaymentMethods: [...current, methodId] };
            }
        });
    };

    const toggleDay = (dayIndex) => {
        setForm(prev => {
            const days = [...prev.daysOfWeek];
            if (days.includes(dayIndex)) {
                return { ...prev, daysOfWeek: days.filter(d => d !== dayIndex) };
            } else {
                return { ...prev, daysOfWeek: [...days, dayIndex].sort() };
            }
        });
    };

    const selectAllDays = () => setForm(prev => ({ ...prev, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }));
    const selectWeekdays = () => setForm(prev => ({ ...prev, daysOfWeek: [1, 2, 3, 4, 5] }));
    const selectWeekends = () => setForm(prev => ({ ...prev, daysOfWeek: [5, 6, 0] }));

    const toggleProductSelect = (prodId) => {
        setForm(prev => {
            const ids = [...prev.targetProductIds];
            if (ids.includes(String(prodId))) {
                return { ...prev, targetProductIds: ids.filter(id => id !== String(prodId)) };
            } else {
                return { ...prev, targetProductIds: [...ids, String(prodId)] };
            }
        });
    };

    const toggleCategorySelect = (catName) => {
        setForm(prev => {
            const cats = [...prev.targetCategories];
            if (cats.includes(catName)) {
                return { ...prev, targetCategories: cats.filter(c => c !== catName) };
            } else {
                return { ...prev, targetCategories: [...cats, catName] };
            }
        });
    };

    const filteredPromotions = useMemo(() => {
        return promotions.filter(p => {
            const matchesType = filterType === 'ALL' || p.type === filterType;
            const matchesSearch = !searchTerm.trim() || 
                p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
            return matchesType && matchesSearch;
        });
    }, [promotions, filterType, searchTerm]);

    const activeCount = promotions.filter(p => p.isActive).length;

    // Filtered products for modal picker
    const filteredPickerProducts = useMemo(() => {
        if (!productSearch.trim()) return allCatalogProducts.slice(0, 10);
        const q = productSearch.toLowerCase().trim();
        return allCatalogProducts.filter(p => 
            (p.name && p.name.toLowerCase().includes(q)) || 
            (p.barcode && p.barcode.toLowerCase().includes(q))
        ).slice(0, 15);
    }, [allCatalogProducts, productSearch]);

    // Productos seleccionados actualmente
    const selectedProductsDetails = useMemo(() => {
        if (!form.targetProductIds || form.targetProductIds.length === 0) return [];
        return allCatalogProducts.filter(p => form.targetProductIds.includes(String(p.id)));
    }, [allCatalogProducts, form.targetProductIds]);

    // Opciones de empaque y volumen disponibles
    const availablePresentationOptions = useMemo(() => {
        const options = [
            { id: 'UNITS', label: 'Unidades / Piezas sueltas (Und)', factor: 1 }
        ];

        if (selectedProductsDetails && selectedProductsDetails.length > 0) {
            selectedProductsDetails.forEach(prod => {
                if (Array.isArray(prod.Presentations) && prod.Presentations.length > 0) {
                    prod.Presentations.forEach(pres => {
                        const factor = Number(pres.factorConversion) || 1;
                        if (factor > 1 && !options.some(o => o.factor === factor && o.label === pres.name)) {
                            const cleanLabel = (pres.name || `Presentación x${factor}`)
                                .replace(/\bcomplet[ao]s?\b/gi, '')
                                .replace(/\s+/g, ' ')
                                .trim();
                            options.push({
                                id: String(pres.id || `pres_${factor}`),
                                label: cleanLabel,
                                factor: factor
                            });
                        }
                    });
                }
                if (Number(prod.unitsPerBulk) > 1 && !options.some(o => o.factor === Number(prod.unitsPerBulk))) {
                    options.push({
                        id: 'bulk',
                        label: `${prod.bulkUnitName || 'Bulto / Caja'} (x${prod.unitsPerBulk})`,
                        factor: Number(prod.unitsPerBulk)
                    });
                }
                if (Number(prod.unitsPerMidBulk) > 1 && !options.some(o => o.factor === Number(prod.unitsPerMidBulk))) {
                    options.push({
                        id: 'midbulk',
                        label: `${prod.midBulkUnitName || 'Media Presentación'} (x${prod.unitsPerMidBulk})`,
                        factor: Number(prod.unitsPerMidBulk)
                    });
                }
            });
        }

        options.push({
            id: 'CUSTOM',
            label: 'Otro empaque (Personalizado)...',
            factor: Math.max(1, parseFloat(form.customUnitFactor) || 1)
        });

        return options;
    }, [selectedProductsDetails, form.customUnitFactor]);

    const selectedUnitOption = useMemo(() => {
        if (form.minQuantityUnit === 'CUSTOM') {
            return {
                id: 'CUSTOM',
                label: form.customUnitName?.trim() || 'Empaque personalizado',
                factor: Math.max(1, parseFloat(form.customUnitFactor) || 1)
            };
        }
        return availablePresentationOptions.find(o => o.id === form.minQuantityUnit) || availablePresentationOptions[0];
    }, [availablePresentationOptions, form.minQuantityUnit, form.customUnitName, form.customUnitFactor]);

    // Resumen dinámico textual para la vista previa en vivo
    const liveSummary = useMemo(() => {
        const typeInfo = PROMO_TYPES.find(t => t.id === form.type) || PROMO_TYPES[0];
        const discountText = form.discountPercentage > 0 
            ? `${form.discountPercentage}% de descuento` 
            : (form.fixedPrice ? `$${form.fixedPrice} precio fijo` : 'Sin descuento');

        const methods = form.targetPaymentMethods?.map(mId => {
            const f = AVAILABLE_PAYMENT_METHODS.find(m => m.id === mId);
            return f ? f.shortLabel : mId;
        }) || [];

        let scopeText = 'Toda la tienda';
        if (scopeMode === 'PRODUCTS') {
            scopeText = form.targetProductIds.length > 0 
                ? `${form.targetProductIds.length} producto(s) específico(s)` 
                : 'Ningún producto seleccionado aún';
        } else if (scopeMode === 'CATEGORIES') {
            scopeText = form.targetCategories.length > 0 
                ? `${form.targetCategories.length} categoría(s)` 
                : 'Ninguna categoría seleccionada';
        }

        const minQty = parseFloat(form.minQuantity) || 1;
        const totalUnits = parseFloat(form.minUnits) || minQty;
        const unitName = form.minQuantityUnit === 'CUSTOM' 
            ? (form.customUnitName?.trim() || 'Empaque') 
            : selectedUnitOption.label.split('(')[0].trim();

        const volumeText = totalUnits > 1 
            ? `Desde ${minQty} ${unitName} (${totalUnits} unidades en total)` 
            : 'Sin mínimo de compra (desde 1 unidad)';

        return {
            typeName: typeInfo.name,
            discountText,
            methodsText: methods.length > 0 ? methods.join(', ') : 'Ninguno',
            scopeText,
            volumeText
        };
    }, [form, scopeMode, selectedUnitOption]);

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
                                    <Percent size={18} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                            Promociones y Descuentos
                                        </h1>
                                        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                            Reglas Comerciales
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Reglas de descuento automático por método de pago, mayoreo y campañas temporales
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Barra de Acciones Superior */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                            <button
                                type="button"
                                onClick={fetchPromotions}
                                disabled={loading}
                                className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors cursor-pointer"
                                title="Actualizar promociones"
                            >
                                <RefreshCw size={13} className={loading ? 'animate-spin text-primary-500' : ''} />
                                <span>Actualizar</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleOpenModal()}
                                className="h-9 px-4 inline-flex items-center justify-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                            >
                                <Plus size={15} />
                                <span>Nueva Promoción</span>
                            </button>
                        </div>
                    </div>

                    {/* Toolbar de Filtros y Búsqueda */}
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                        {/* Selector de Tipo de Promoción */}
                        <div className="inline-flex items-center overflow-x-auto p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 gap-1 text-xs">
                            <button
                                type="button"
                                onClick={() => setFilterType('ALL')}
                                className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 cursor-pointer ${
                                    filterType === 'ALL'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                Todas ({promotions.length})
                            </button>

                            {PROMO_TYPES.map(t => {
                                const IconComp = t.icon;
                                const isSelected = filterType === t.id;
                                const countForType = promotions.filter(p => p.type === t.id).length;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => setFilterType(t.id)}
                                        className={`px-3 py-1.5 rounded-md font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                                            isSelected
                                                ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-2xs font-semibold'
                                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        <IconComp size={13} />
                                        <span>{t.shortName}</span>
                                        <span className="text-[10px] font-mono opacity-70">({countForType})</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Campo de Búsqueda */}
                        <div className="relative flex-1 md:max-w-md">
                            <Search size={14} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, rubro o detalle..."
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

            {/* Tarjetas de Métricas de Promociones */}
            <div className="px-1 sm:px-4 lg:px-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    {/* Tarjeta 1: Total */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Total de Promociones
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <Tag size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono">
                                {promotions.length}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Reglas comerciales configuradas
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 2: Activas en Caja */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Activas en Caja
                            </span>
                            <div className="w-7 h-7 rounded-md bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
                                <CheckCircle2 size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight font-mono">
                                {activeCount}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Aplicándose de forma automática
                            </p>
                        </div>
                    </div>

                    {/* Tarjeta 3: Pausadas / Inactivas */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Pausadas / Inactivas
                            </span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                <XCircle size={14} />
                            </div>
                        </div>
                        <div className="space-y-0.5">
                            <div className="text-xl sm:text-2xl font-bold text-slate-500 dark:text-slate-400 tracking-tight font-mono">
                                {promotions.length - activeCount}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Fuera de servicio temporal o vencidas
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Listado / Grid de Promociones */}
            <div className="px-1 sm:px-4 lg:px-6">
                {loading ? (
                    <div className="py-20 text-center text-slate-500 font-medium text-xs flex flex-col items-center gap-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                        <RefreshCw size={22} className="animate-spin text-primary-500 mb-1" />
                        <span>Cargando promociones comerciales...</span>
                    </div>
                ) : filteredPromotions.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-2.5 shadow-xs">
                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                            <Tag size={20} />
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                            {promotions.length === 0 ? 'Sin promociones registradas' : 'No hay promociones para este filtro'}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            Configura ofertas para incentivar pagos en divisas, compras por volumen o campañas por día.
                        </p>
                        <button
                            type="button"
                            onClick={() => handleOpenModal()}
                            className="mt-2 h-9 px-4 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                        >
                            <Plus size={14} />
                            <span>Crear Primera Promoción</span>
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                        {filteredPromotions.map(promo => {
                            const typeInfo = PROMO_TYPES.find(t => t.id === promo.type) || PROMO_TYPES[0];
                            const IconComp = typeInfo.icon;
                            const targetMethods = Array.isArray(promo.targetPaymentMethods) ? promo.targetPaymentMethods : [];
                            const targetMethodNames = targetMethods.map(mId => {
                                const found = AVAILABLE_PAYMENT_METHODS.find(m => m.id === mId);
                                return found ? found.shortLabel : mId;
                            });

                            return (
                                <div 
                                    key={promo.id}
                                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between shadow-xs ${
                                        promo.isActive
                                            ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                                            : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200/60 dark:border-slate-800/60 opacity-75'
                                    }`}
                                >
                                    <div>
                                        {/* Header de la tarjeta */}
                                        <div className="flex items-center justify-between gap-2 mb-2.5">
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium border border-slate-200 dark:border-slate-700">
                                                <IconComp size={12} className="text-slate-600 dark:text-slate-400" />
                                                <span>{typeInfo.name}</span>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => handleToggleActive(promo)}
                                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                                title="Alternar estado activa/pausada"
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full ${
                                                    promo.isActive ? 'bg-emerald-500' : 'bg-slate-400'
                                                }`} />
                                                <span className={promo.isActive ? 'text-slate-700 dark:text-slate-300' : 'text-slate-500'}>
                                                    {promo.isActive ? 'Activa' : 'Pausada'}
                                                </span>
                                            </button>
                                        </div>

                                        {/* Nombre de la promoción */}
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                                            {promo.name}
                                        </h3>

                                        {promo.description && (
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                                {promo.description}
                                            </p>
                                        )}

                                        {/* Ficha técnica de la regla */}
                                        <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
                                            {promo.type === 'PAYMENT_METHOD_DISCOUNT' && (
                                                <>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-slate-500 text-[11px]">Descuento:</span>
                                                        <span className="text-primary-600 dark:text-primary-400 font-bold font-mono text-xs">
                                                            -{promo.discountPercentage}% OFF
                                                        </span>
                                                    </div>
                                                    <div className="flex items-start justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                                                        <span className="text-slate-500 text-[11px] shrink-0">Métodos:</span>
                                                        <span className="text-slate-700 dark:text-slate-300 text-[11px] text-right font-medium truncate max-w-[170px]">
                                                            {targetMethodNames.length > 0 ? targetMethodNames.join(', ') : 'Todos'}
                                                        </span>
                                                    </div>
                                                </>
                                            )}

                                            {promo.type === 'BUY_X_GET_Y' && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-500 text-[11px]">Mecánica:</span>
                                                    <span className="text-slate-900 dark:text-white font-semibold text-xs">
                                                        Lleva {promo.buyQuantity} y Paga {promo.payQuantity}
                                                    </span>
                                                </div>
                                            )}

                                            {promo.type === 'VOLUME_DISCOUNT' && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-500 text-[11px]">Condición:</span>
                                                    <span className="text-slate-900 dark:text-white font-semibold text-xs">
                                                        {promo.discountPercentage > 0 ? `-${promo.discountPercentage}% a partir de ${promo.buyQuantity} un` : `$${promo.fixedPrice} c/u`}
                                                    </span>
                                                </div>
                                            )}

                                            {promo.type === 'CATEGORY_DISCOUNT' && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-500 text-[11px]">Descuento:</span>
                                                    <span className="text-slate-900 dark:text-white font-semibold text-xs">
                                                        -{promo.discountPercentage}% en categoría
                                                    </span>
                                                </div>
                                            )}

                                            {/* Compra mínima / Volumen */}
                                            {Number(promo.minUnits || promo.buyQuantity) > 1 && (
                                                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800">
                                                    <span className="text-slate-500 flex items-center gap-1">
                                                        <Package size={11} className="text-slate-400" />
                                                        <span>Mínimo:</span>
                                                    </span>
                                                    <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                                                        ≥ {promo.minQuantity || 1} {promo.minQuantityUnit && promo.minQuantityUnit !== 'UNITS' ? promo.minQuantityUnit : 'unds'} ({promo.minUnits || promo.buyQuantity} un)
                                                    </span>
                                                </div>
                                            )}

                                            {/* Alcance de productos */}
                                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800">
                                                <span className="text-slate-500">Aplica en:</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[150px]">
                                                    {promo.targetProductIds?.length > 0 
                                                        ? `${promo.targetProductIds.length} productos` 
                                                        : promo.targetCategories?.length > 0 
                                                            ? `${promo.targetCategories.length} categorías`
                                                            : 'Toda la tienda'}
                                                </span>
                                            </div>

                                            {/* Vigencia */}
                                            {(promo.startDate || promo.endDate) && (
                                                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800">
                                                    <span className="text-slate-500 flex items-center gap-1">
                                                        <Calendar size={11} />
                                                        <span>Vigencia:</span>
                                                    </span>
                                                    <span className="font-mono text-slate-700 dark:text-slate-300 text-[10px]">
                                                        {promo.startDate ? promo.startDate.split('T')[0] : 'Hoy'}
                                                        {' → '}
                                                        {promo.endDate ? promo.endDate.split('T')[0] : 'Indefinido'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Días y Horas */}
                                        <div className="flex items-center justify-between gap-1 mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                                            <div className="flex items-center gap-1">
                                                {DAYS_NAMES.map((d) => {
                                                    const activeDay = Array.isArray(promo.daysOfWeek) && promo.daysOfWeek.includes(d.idx);
                                                    return (
                                                        <span 
                                                            key={d.idx}
                                                            title={d.fullName}
                                                            className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${
                                                                activeDay
                                                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                                                                    : 'text-slate-300 dark:text-slate-600'
                                                            }`}
                                                        >
                                                            {d.label}
                                                        </span>
                                                    );
                                                })}
                                            </div>

                                            {promo.startTime && promo.endTime && (
                                                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                                                    <Clock size={11} />
                                                    <span>{promo.startTime}-{promo.endTime}</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Acciones inferiores */}
                                    <div className="flex items-center justify-end gap-1.5 pt-3 mt-3 border-t border-slate-100 dark:border-slate-800">
                                        <button
                                            type="button"
                                            onClick={() => handleOpenModal(promo)}
                                            className="h-7 px-2.5 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                                        >
                                            <Edit3 size={12} />
                                            <span>Editar</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(promo.id, promo.name)}
                                            className="h-7 w-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center justify-center transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                                            title="Eliminar promoción"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal de Configuración de Oferta (Gran Formato de 2 Columnas) */}
            {isModalOpen && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs animate-fadeIn">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-5xl h-[88vh] max-h-[820px] flex flex-col shadow-2xl overflow-hidden relative z-10">
                        
                        {/* Header Fijo */}
                        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-850">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                        {editingPromo ? 'Editar Oferta Comercial' : 'Crear Nueva Oferta Comercial'}
                                    </h2>
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                                        {form.type === 'PAYMENT_METHOD_DISCOUNT' ? 'Por Método de Pago' : 'Promoción'}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Configura los parámetros de cálculo, productos participantes y vigencia
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                        {form.isActive ? 'Activa' : 'Pausada'}
                                    </span>
                                    <input 
                                        type="checkbox" 
                                        checked={form.isActive} 
                                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 relative" />
                                </label>

                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Contenido en 2 Columnas con scroll fluido */}
                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
                            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 custom-scrollbar">
                                
                                {/* COLUMNA IZQUIERDA (7 de 12 cols): Reglas y Condiciones */}
                                <div className="lg:col-span-7 space-y-5">
                                    {/* Nombre de la oferta */}
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                            Nombre de la oferta o promoción *
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={form.name}
                                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                                            placeholder="Ej: 5% de descuento en divisas y pago móvil"
                                            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>

                                    {/* Selector de Tipo de Promoción (Segmented bar limpia) */}
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                            Mecánica de la oferta
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {PROMO_TYPES.map(t => {
                                                const IconComp = t.icon;
                                                const isSelected = form.type === t.id;
                                                return (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => setForm({ ...form, type: t.id })}
                                                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                                                            isSelected
                                                                ? 'bg-blue-50/70 border-blue-500/80 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500/80 dark:text-blue-100 shadow-xs'
                                                                : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                                                        }`}
                                                    >
                                                        <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                                                            <IconComp size={16} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h4 className="font-semibold text-xs leading-tight">{t.name}</h4>
                                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{t.desc}</p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Configuración del Beneficio según tipo */}
                                    <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-4">
                                        {form.type === 'PAYMENT_METHOD_DISCOUNT' && (
                                            <>
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            Métodos de pago que activan la oferta *
                                                        </label>
                                                        <div className="flex items-center gap-2 text-[11px]">
                                                            <button
                                                                type="button"
                                                                onClick={() => setForm({ ...form, targetPaymentMethods: AVAILABLE_PAYMENT_METHODS.map(m => m.id) })}
                                                                className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                                            >
                                                                Todos
                                                            </button>
                                                            <span className="text-slate-300">·</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setForm({ ...form, targetPaymentMethods: ['cash_usd'] })}
                                                                className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                                            >
                                                                Solo Divisas
                                                            </button>
                                                            <span className="text-slate-300">·</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setForm({ ...form, targetPaymentMethods: ['pago_movil'] })}
                                                                className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                                                            >
                                                                Solo Pago Móvil
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                        {AVAILABLE_PAYMENT_METHODS.map(m => {
                                                            const isSelected = form.targetPaymentMethods?.includes(m.id);
                                                            const IconComp = m.icon;
                                                            return (
                                                                <button
                                                                    key={m.id}
                                                                    type="button"
                                                                    onClick={() => togglePaymentMethod(m.id)}
                                                                    className={`px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                                                                        isSelected
                                                                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                                                    }`}
                                                                >
                                                                    <IconComp size={14} className={isSelected ? 'text-white' : m.color} />
                                                                    <span className="truncate">{m.shortLabel}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200/60 dark:border-slate-700">
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                            Porcentaje de Descuento (%) *
                                                        </label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0.1"
                                                                max="100"
                                                                required
                                                                value={form.discountPercentage}
                                                                onChange={(e) => setForm({ ...form, discountPercentage: e.target.value })}
                                                                placeholder="Ej: 5"
                                                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white pr-7"
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                            Precio Fijo Promocional ($) (Opcional)
                                                        </label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={form.fixedPrice}
                                                                onChange={(e) => setForm({ ...form, fixedPrice: e.target.value })}
                                                                placeholder="Opcional"
                                                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white pl-6"
                                                            />
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {form.type === 'BUY_X_GET_Y' && (
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                        Lleva (Cantidad de unidades)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="2"
                                                        step="1"
                                                        required
                                                        value={form.buyQuantity}
                                                        onChange={(e) => setForm({ ...form, buyQuantity: e.target.value })}
                                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                                                    />
                                                    <span className="text-[10px] text-slate-400 mt-1 block">Ej: 2 para promoción 2x1</span>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                        Paga (Unidades que se cobran)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        step="1"
                                                        required
                                                        value={form.payQuantity}
                                                        onChange={(e) => setForm({ ...form, payQuantity: e.target.value })}
                                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                                                    />
                                                    <span className="text-[10px] text-slate-400 mt-1 block">Ej: 1 para promoción 2x1</span>
                                                </div>
                                            </div>
                                        )}

                                        {form.type === 'VOLUME_DISCOUNT' && (
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                        A partir de (Mínimo unidades)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        step="1"
                                                        required
                                                        value={form.buyQuantity}
                                                        onChange={(e) => setForm({ ...form, buyQuantity: e.target.value })}
                                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                        % de Descuento
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={form.discountPercentage}
                                                        onChange={(e) => setForm({ ...form, discountPercentage: e.target.value })}
                                                        placeholder="Ej: 10 para 10%"
                                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {form.type === 'CATEGORY_DISCOUNT' && (
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                                    Porcentaje de Descuento para la categoría (%)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="1"
                                                    max="100"
                                                    required
                                                    value={form.discountPercentage}
                                                    onChange={(e) => setForm({ ...form, discountPercentage: e.target.value })}
                                                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Condición de Volumen / Cantidad Mínima */}
                                    <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Package className="text-blue-600 dark:text-blue-400" size={16} />
                                                <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                                    Condición de volumen o empaque mínimo
                                                </h4>
                                            </div>
                                            <span className="text-[10px] font-semibold text-slate-500 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                                                {Number(form.minUnits) > 1 ? `Exige ≥ ${form.minUnits} unidades` : 'Desde 1 unidad'}
                                            </span>
                                        </div>

                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            Indica si la oferta aplica desde unidades sueltas o si requiere llevar bultos, cajas o cantidades mínimas.
                                        </p>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                            <div>
                                                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                                                    Cantidad requerida *
                                                </label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    required
                                                    value={form.minQuantity}
                                                    onChange={(e) => {
                                                        const qty = Math.max(1, parseFloat(e.target.value) || 1);
                                                        const factor = form.minQuantityUnit === 'CUSTOM'
                                                            ? Math.max(1, parseFloat(form.customUnitFactor) || 1)
                                                            : (selectedUnitOption?.factor || 1);
                                                        setForm({
                                                            ...form,
                                                            minQuantity: qty,
                                                            minUnits: qty * factor,
                                                            buyQuantity: qty * factor
                                                        });
                                                    }}
                                                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                                                    Empaque / Presentación *
                                                </label>
                                                <select
                                                    value={form.minQuantityUnit}
                                                    onChange={(e) => {
                                                        const unitId = e.target.value;
                                                        const qty = parseFloat(form.minQuantity) || 1;
                                                        if (unitId === 'CUSTOM') {
                                                            const customFactor = Math.max(1, parseFloat(form.customUnitFactor) || 1);
                                                            setForm({
                                                                ...form,
                                                                minQuantityUnit: 'CUSTOM',
                                                                minUnits: qty * customFactor,
                                                                buyQuantity: qty * customFactor
                                                            });
                                                        } else {
                                                            const found = availablePresentationOptions.find(o => o.id === unitId) || availablePresentationOptions[0];
                                                            const factor = found?.factor || 1;
                                                            setForm({
                                                                ...form,
                                                                minQuantityUnit: unitId,
                                                                minUnits: qty * factor,
                                                                buyQuantity: qty * factor
                                                            });
                                                        }
                                                    }}
                                                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-xs text-slate-900 dark:text-white cursor-pointer"
                                                >
                                                    {availablePresentationOptions.map(opt => (
                                                        <option key={opt.id} value={opt.id}>
                                                            {opt.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Empaque personalizado si aplica */}
                                        {form.minQuantityUnit === 'CUSTOM' && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                                                <div>
                                                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                                                        Nombre del empaque
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={form.customUnitName}
                                                        onChange={(e) => setForm({ ...form, customUnitName: e.target.value })}
                                                        placeholder="Ej: Bulto, Fardo, Caja, Saco"
                                                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                                                        Unidades por empaque
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        step="1"
                                                        value={form.customUnitFactor}
                                                        onChange={(e) => {
                                                            const factor = Math.max(1, parseFloat(e.target.value) || 1);
                                                            const qty = parseFloat(form.minQuantity) || 1;
                                                            setForm({
                                                                ...form,
                                                                customUnitFactor: factor,
                                                                minUnits: qty * factor,
                                                                buyQuantity: qty * factor
                                                            });
                                                        }}
                                                        placeholder="Ej: 24"
                                                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-900 dark:text-white"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* COLUMNA DERECHA (5 de 12 cols): Alcance, Calendario y Resumen en Vivo */}
                                <div className="lg:col-span-5 space-y-5">
                                    
                                    {/* Alcance de Productos / Categorías */}
                                    <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Alcance de la promoción
                                        </label>
                                        <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                                            <button
                                                type="button"
                                                onClick={() => setScopeMode('ALL')}
                                                className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                                                    scopeMode === 'ALL'
                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                                }`}
                                            >
                                                <Store size={12} />
                                                <span>Toda</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setScopeMode('PRODUCTS')}
                                                className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                                                    scopeMode === 'PRODUCTS'
                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                                }`}
                                            >
                                                <Package size={12} />
                                                <span>Productos</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setScopeMode('CATEGORIES')}
                                                className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                                                    scopeMode === 'CATEGORIES'
                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                                }`}
                                            >
                                                <Layers size={12} />
                                                <span>Categorías</span>
                                            </button>
                                        </div>

                                        {/* Sub-panel Productos Específicos */}
                                        {scopeMode === 'PRODUCTS' && (
                                            <div className="space-y-2 pt-1">
                                                <div className="relative">
                                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                                                    <input
                                                        type="text"
                                                        value={productSearch}
                                                        onChange={(e) => setProductSearch(e.target.value)}
                                                        placeholder="Buscar por nombre o código..."
                                                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                                                    />
                                                </div>

                                                {filteredPickerProducts.length > 0 && (
                                                    <div className="max-h-32 overflow-y-auto p-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 space-y-0.5">
                                                        {filteredPickerProducts.map(p => {
                                                            const isSelected = form.targetProductIds.includes(String(p.id));
                                                            return (
                                                                <button
                                                                    key={p.id}
                                                                    type="button"
                                                                    onClick={() => toggleProductSelect(p.id)}
                                                                    className={`w-full flex items-center justify-between p-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${
                                                                        isSelected 
                                                                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold' 
                                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                                    }`}
                                                                >
                                                                    <span className="truncate max-w-[190px]">{p.name || p.nombre}</span>
                                                                    <span className="text-[10px] font-mono shrink-0 ml-1 font-semibold">${Number(p.price || 0).toFixed(2)}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {selectedProductsDetails.length > 0 && (
                                                    <div className="space-y-1 pt-1">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                                                Seleccionados ({selectedProductsDetails.length}):
                                                            </span>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => setForm({ ...form, targetProductIds: [] })}
                                                                className="text-[10px] text-rose-500 font-semibold hover:underline"
                                                            >
                                                                Quitar todos
                                                            </button>
                                                        </div>
                                                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                                                            {selectedProductsDetails.map(p => (
                                                                <span 
                                                                    key={p.id}
                                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium"
                                                                >
                                                                    <span className="truncate max-w-[130px]">{p.name || p.nombre}</span>
                                                                    <button 
                                                                        type="button" 
                                                                        onClick={() => toggleProductSelect(p.id)}
                                                                        className="hover:text-rose-500 cursor-pointer"
                                                                    >
                                                                        <X size={11} />
                                                                    </button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Sub-panel Categorías */}
                                        {scopeMode === 'CATEGORIES' && (
                                            <div className="space-y-1.5 pt-1">
                                                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                                                    {categories.map(cat => {
                                                        const isSelected = form.targetCategories?.includes(cat);
                                                        return (
                                                            <button
                                                                key={cat}
                                                                type="button"
                                                                onClick={() => toggleCategorySelect(cat)}
                                                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                                                                    isSelected
                                                                        ? 'bg-blue-600 text-white shadow-xs'
                                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                                                                }`}
                                                            >
                                                                {cat}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Vigencia y Días */}
                                    <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="text-blue-600 dark:text-blue-400" size={15} />
                                            <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                                Vigencia y Días Activos
                                            </h4>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[10px] font-medium text-slate-500 mb-1">
                                                    Fecha Inicio
                                                </label>
                                                <input
                                                    type="date"
                                                    value={form.startDate}
                                                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                                                    className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-medium text-slate-500 mb-1">
                                                    Fecha Límite
                                                </label>
                                                <input
                                                    type="date"
                                                    value={form.endDate}
                                                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                                                    className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white"
                                                />
                                            </div>
                                        </div>

                                        {/* Selector de días de la semana */}
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[10px] font-medium text-slate-500">
                                                    Días válidos
                                                </label>
                                                <div className="flex items-center gap-2 text-[10px]">
                                                    <button type="button" onClick={selectAllDays} className="text-blue-600 dark:text-blue-400 hover:underline">Todos</button>
                                                    <span className="text-slate-300">·</span>
                                                    <button type="button" onClick={selectWeekdays} className="text-blue-600 dark:text-blue-400 hover:underline">Lun-Vie</button>
                                                    <span className="text-slate-300">·</span>
                                                    <button type="button" onClick={selectWeekends} className="text-blue-600 dark:text-blue-400 hover:underline">Fines</button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-7 gap-1">
                                                {DAYS_NAMES.map((d) => {
                                                    const isChecked = form.daysOfWeek.includes(d.idx);
                                                    return (
                                                        <button
                                                            key={d.idx}
                                                            type="button"
                                                            onClick={() => toggleDay(d.idx)}
                                                            className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                                isChecked 
                                                                    ? 'bg-blue-600 text-white shadow-xs' 
                                                                    : 'bg-white dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                                            }`}
                                                        >
                                                            {d.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Resumen en Vivo (Live Summary) */}
                                    <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 space-y-2.5">
                                        <div className="flex items-center gap-1.5">
                                            <CheckCircle2 size={15} className="text-blue-600 dark:text-blue-400" />
                                            <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                                                Resumen de activación en caja
                                            </span>
                                        </div>

                                        <div className="space-y-1.5 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500">Beneficio:</span>
                                                <span className="font-bold text-blue-700 dark:text-blue-300">{liveSummary.discountText}</span>
                                            </div>
                                            {form.type === 'PAYMENT_METHOD_DISCOUNT' && (
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="text-slate-500 shrink-0">Pago con:</span>
                                                    <span className="font-medium text-slate-700 dark:text-slate-300 text-right truncate max-w-[160px]">
                                                        {liveSummary.methodsText}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="text-slate-500 shrink-0">Volumen:</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-300 text-right text-[11px]">
                                                    {liveSummary.volumeText}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500">Aplica a:</span>
                                                <span className="font-medium text-slate-700 dark:text-slate-300">{liveSummary.scopeText}</span>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            </div>

                            {/* Footer Fijo con botones de acción */}
                            <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-850">
                                <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
                                    Los descuentos se evalúan de forma automática en cada venta del POS
                                </span>
                                <div className="flex items-center gap-2.5 ml-auto">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shadow-blue-600/30 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {submitting && <Loader2 size={14} className="animate-spin" />}
                                        <span>{submitting ? 'Guardando...' : editingPromo ? 'Guardar Cambios' : 'Crear Oferta'}</span>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* Modal de Confirmación */}
            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant || 'danger'}
                confirmText={confirmConfig.confirmText || 'Sí, Eliminar'}
                cancelText={confirmConfig.cancelText || 'Conservar'}
            />
        </div>
    );
}
