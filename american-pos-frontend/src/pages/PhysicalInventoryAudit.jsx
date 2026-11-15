import { useState, useEffect, useRef, useMemo } from 'react';
import {
    ClipboardCheck,
    Barcode,
    Search,
    Plus,
    Minus,
    Trash2,
    Save,
    RotateCcw,
    AlertTriangle,
    CheckCircle2,
    TrendingDown,
    TrendingUp,
    DollarSign,
    Filter,
    Download,
    Layers,
    FileSpreadsheet,
    HelpCircle,
    Info,
    RefreshCw,
    Package
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { useSocket } from '../hooks/SocketContext';
import { formatMoney, fetchGlobalSettings } from '../utils/format';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

const formatSmartUsd = (val) => {
    const num = Number(val || 0);
    if (isNaN(num) || !isFinite(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatBs = (val) => {
    const num = Number(val || 0);
    if (isNaN(num) || !isFinite(num)) return '0,00';
    return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function PhysicalInventoryAudit() {
    const { user } = useAuth();
    const { socket } = useSocket();
    const { confirm, confirmDialog } = useConfirmDialog();

    // Catálogo completo de productos para búsqueda y carga rápida
    const [catalog, setCatalog] = useState([]);
    const [categories, setCategories] = useState([]);
    const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
    const [systemRate, setSystemRate] = useState(1);

    // Estado de la sesión de toma física: array de ítems en conteo
    // { id, name, barcode, category, systemStock, countedStock, cost, imageUri }
    const [auditItems, setAuditItems] = useState(() => {
        try {
            const saved = localStorage.getItem('isaac_physical_audit_draft');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    const [sessionNotes, setSessionNotes] = useState(() => {
        return localStorage.getItem('isaac_physical_audit_notes') || '';
    });

    // Filtros y Búsqueda
    const [barcodeInput, setBarcodeInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterDifference, setFilterDifference] = useState('ALL'); // 'ALL' | 'DIFF_ONLY' | 'MISSING' | 'SURPLUS' | 'EXACT'
    const [selectedCategory, setSelectedCategory] = useState('');

    // Modal de Confirmación de Ajuste
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const barcodeInputRef = useRef(null);

    // 1. Cargar Tasa y Catálogo al montar
    useEffect(() => {
        loadSettingsAndCatalog();
    }, []);

    // 2. Persistir borrador en localStorage
    useEffect(() => {
        try {
            localStorage.setItem('isaac_physical_audit_draft', JSON.stringify(auditItems));
            localStorage.setItem('isaac_physical_audit_notes', sessionNotes);
        } catch (e) {
            console.warn('[AUDIT] No se pudo guardar borrador en localStorage:', e);
        }
    }, [auditItems, sessionNotes]);

    const loadSettingsAndCatalog = async () => {
        setIsLoadingCatalog(true);
        try {
            const [settingsData, prodsRes] = await Promise.all([
                fetchGlobalSettings(),
                api.get('/products?limit=1000')
            ]);
            if (settingsData?.exchangeRate) {
                setSystemRate(Number(settingsData.exchangeRate));
            }

            const rawProds = prodsRes.data?.products || (Array.isArray(prodsRes.data) ? prodsRes.data : []);
            setCatalog(rawProds);

            const cats = Array.from(new Set(rawProds.map(p => p.category).filter(Boolean)));
            setCategories(cats);
        } catch (err) {
            console.error('[AUDIT] Error cargando catálogo:', err);
            toast.error('Error al cargar catálogo de productos para auditoría');
        } finally {
            setIsLoadingCatalog(false);
        }
    };

    // 3. Manejo de lectura de pistola de código de barras
    const handleBarcodeSubmit = (e) => {
        e.preventDefault();
        const code = barcodeInput.trim();
        if (!code) return;

        // Buscar coincidencia exacta por código de barras o ID
        const matched = catalog.find(p => 
            (p.barcode && String(p.barcode).trim().toLowerCase() === code.toLowerCase()) ||
            p.id === code
        );

        if (!matched) {
            toast.error(`Producto con código "${code}" no encontrado en catálogo`);
            setBarcodeInput('');
            return;
        }

        addProductToAudit(matched, 1);
        setBarcodeInput('');
        if (barcodeInputRef.current) barcodeInputRef.current.focus();
    };

    // Agregar producto o incrementar conteo si ya está en la lista
    const addProductToAudit = (product, qtyToAdd = 1) => {
        setAuditItems(prev => {
            const existingIndex = prev.findIndex(item => item.id === product.id);
            if (existingIndex >= 0) {
                const next = [...prev];
                const current = next[existingIndex];
                next[existingIndex] = {
                    ...current,
                    countedStock: Number((Number(current.countedStock || 0) + Number(qtyToAdd)).toFixed(4))
                };
                toast.success(`+${qtyToAdd} "${product.name}" (Total contado: ${next[existingIndex].countedStock})`, { duration: 1500 });
                return next;
            } else {
                const sysStock = Number(product.stockQuantity ?? product.stock ?? 0);
                const newItem = {
                    id: product.id,
                    name: product.name,
                    barcode: product.barcode,
                    category: product.category || 'General',
                    systemStock: sysStock,
                    countedStock: qtyToAdd,
                    cost: Number(product.cost || 0),
                    imageUri: product.imageUri
                };
                toast.success(`Agregado "${product.name}" para conteo físico`, { duration: 2000 });
                return [newItem, ...prev];
            }
        });
    };

    // Cargar todos los productos de una categoría al conteo con conteo inicial 0
    const handleLoadCategoryToAudit = (catName) => {
        if (!catName) return;
        const prods = catalog.filter(p => p.category === catName);
        if (prods.length === 0) {
            toast.error(`No hay productos en la categoría "${catName}"`);
            return;
        }

        setAuditItems(prev => {
            const existingIds = new Set(prev.map(i => i.id));
            const newEntries = prods
                .filter(p => !existingIds.has(p.id))
                .map(p => ({
                    id: p.id,
                    name: p.name,
                    barcode: p.barcode,
                    category: p.category || 'General',
                    systemStock: Number(p.stockQuantity ?? p.stock ?? 0),
                    countedStock: 0,
                    cost: Number(p.cost || 0),
                    imageUri: p.imageUri
                }));

            toast.success(`Se agregaron ${newEntries.length} productos de "${catName}" para conteo`);
            return [...newEntries, ...prev];
        });
    };

    // Cargar todo el catálogo
    const handleLoadAllCatalog = async () => {
        const confirmed = await confirm({
            title: 'Cargar catálogo completo',
            message: `¿Deseas cargar los ${catalog.length} productos del catálogo para auditoría completa?`,
            confirmText: 'Cargar catálogo',
            variant: 'primary'
        });
        if (!confirmed) {
            return;
        }
        const existingMap = new Map(auditItems.map(i => [i.id, i.countedStock]));
        const allItems = catalog.map(p => ({
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            category: p.category || 'General',
            systemStock: Number(p.stockQuantity ?? p.stock ?? 0),
            countedStock: existingMap.has(p.id) ? existingMap.get(p.id) : 0,
            cost: Number(p.cost || 0),
            imageUri: p.imageUri
        }));
        setAuditItems(allItems);
        toast.success(`Catálogo cargado con ${allItems.length} artículos`);
    };

    // Actualizar conteo físico de una fila
    const handleUpdateCount = (productId, newCount) => {
        const val = Math.max(0, Number(newCount || 0));
        setAuditItems(prev => prev.map(item => 
            item.id === productId ? { ...item, countedStock: val } : item
        ));
    };

    // Ajustar con botones +1 y -1
    const handleStepCount = (productId, delta) => {
        setAuditItems(prev => prev.map(item => {
            if (item.id !== productId) return item;
            const nextVal = Math.max(0, Number((item.countedStock + delta).toFixed(4)));
            return { ...item, countedStock: nextVal };
        }));
    };

    // Quitar producto de la lista
    const handleRemoveItem = (productId) => {
        setAuditItems(prev => prev.filter(i => i.id !== productId));
    };

    // Reiniciar sesión de auditoría
    const handleResetSession = async () => {
        const confirmed = await confirm({
            title: 'Reiniciar auditoría física',
            message: '¿Seguro que deseas vaciar toda la sesión de toma física actual? Se perderán los conteos no aplicados.',
            confirmText: 'Vaciar sesión',
            variant: 'danger'
        });
        if (!confirmed) {
            return;
        }
        setAuditItems([]);
        setSessionNotes('');
        try {
            localStorage.removeItem('isaac_physical_audit_draft');
            localStorage.removeItem('isaac_physical_audit_notes');
        } catch {}
        toast.success('Sesión de auditoría reiniciada');
    };

    // 4. Métricas y Estadísticas en Vivo
    const metrics = useMemo(() => {
        let totalCountedUnits = 0;
        let missingCount = 0;
        let missingQty = 0;
        let missingCostUsd = 0;

        let surplusCount = 0;
        let surplusQty = 0;
        let surplusCostUsd = 0;

        let exactCount = 0;

        for (const item of auditItems) {
            const counted = Number(item.countedStock || 0);
            const sys = Number(item.systemStock || 0);
            const diff = counted - sys;
            const cost = Number(item.cost || 0);

            totalCountedUnits += counted;

            if (diff < -0.0001) {
                missingCount++;
                const absMissing = Math.abs(diff);
                missingQty += absMissing;
                missingCostUsd += absMissing * cost;
            } else if (diff > 0.0001) {
                surplusCount++;
                surplusQty += diff;
                surplusCostUsd += diff * cost;
            } else {
                exactCount++;
            }
        }

        const netDifferenceUsd = surplusCostUsd - missingCostUsd;
        const netDifferenceBs = netDifferenceUsd * systemRate;

        return {
            totalItems: auditItems.length,
            totalCountedUnits,
            missingCount,
            missingQty,
            missingCostUsd,
            missingCostBs: missingCostUsd * systemRate,
            surplusCount,
            surplusQty,
            surplusCostUsd,
            surplusCostBs: surplusCostUsd * systemRate,
            exactCount,
            netDifferenceUsd,
            netDifferenceBs,
            hasDiscrepancies: missingCount > 0 || surplusCount > 0
        };
    }, [auditItems, systemRate]);

    // 5. Filtrado de ítems para la tabla
    const filteredItems = useMemo(() => {
        return auditItems.filter(item => {
            // Filtro por texto
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchName = item.name.toLowerCase().includes(q);
                const matchCode = item.barcode && item.barcode.toLowerCase().includes(q);
                const matchCat = item.category && item.category.toLowerCase().includes(q);
                if (!matchName && !matchCode && !matchCat) return false;
            }

            // Filtro por tipo de diferencia
            const diff = Number(item.countedStock || 0) - Number(item.systemStock || 0);
            if (filterDifference === 'DIFF_ONLY') return Math.abs(diff) > 0.0001;
            if (filterDifference === 'MISSING') return diff < -0.0001;
            if (filterDifference === 'SURPLUS') return diff > 0.0001;
            if (filterDifference === 'EXACT') return Math.abs(diff) <= 0.0001;

            return true;
        });
    }, [auditItems, searchQuery, filterDifference]);

    // 6. Aplicar Ajuste en Base de Datos
    const handleApplyAudit = async () => {
        if (auditItems.length === 0) {
            toast.error('No hay artículos en la sesión de conteo');
            return;
        }

        setIsSubmitting(true);
        try {
            const adjustmentsPayload = auditItems.map(item => ({
                productId: item.id,
                countedStock: item.countedStock,
                currentStock: item.systemStock
            }));

            const { data } = await api.post('/products/bulk-audit-adjust', {
                auditSessionId: `AUD-${Date.now().toString().slice(-6)}`,
                reason: 'toma_fisica',
                notes: sessionNotes.trim() || 'Auditoría física de inventario en tienda',
                adjustments: adjustmentsPayload
            });

            toast.success(
                `¡Auditoría aplicada con éxito! ${data.updatedCount} productos ajustados al stock físico real.`,
                { duration: 5000 }
            );

            // Limpiar borrador tras éxito
            handleResetSession();
            setIsConfirmModalOpen(false);
            loadSettingsAndCatalog();
        } catch (err) {
            console.error('[AUDIT] Error al aplicar auditoría:', err);
            toast.error(err.response?.data?.error || err.message || 'Error al guardar el ajuste de auditoría');
        } finally {
            setIsSubmitting(false);
        }
    };

    // 7. Exportar Acta a CSV
    const handleExportCSV = () => {
        if (auditItems.length === 0) {
            toast.error('No hay datos para exportar');
            return;
        }

        const headers = ['Producto', 'Código de Barras', 'Categoría', 'Stock Sistema', 'Conteo Físico', 'Diferencia (Unidades)', 'Estado', 'Costo USD', 'Diferencia USD', 'Diferencia Bs'];
        const rows = auditItems.map(i => {
            const diff = Number(i.countedStock || 0) - Number(i.systemStock || 0);
            const status = diff < -0.0001 ? 'FALTANTE' : (diff > 0.0001 ? 'SOBRANTE' : 'CUADRADO');
            const diffUsd = diff * Number(i.cost || 0);
            const diffBs = diffUsd * systemRate;
            return [
                `"${i.name.replace(/"/g, '""')}"`,
                `"${i.barcode || ''}"`,
                `"${i.category || ''}"`,
                i.systemStock,
                i.countedStock,
                diff.toFixed(2),
                status,
                i.cost.toFixed(2),
                diffUsd.toFixed(2),
                diffBs.toFixed(2)
            ].join(',');
        });

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Acta_Auditoria_Inventario_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('Acta de auditoría descargada');
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header del Módulo */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl">
                            <ClipboardCheck size={26} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight">
                                    Toma Física y Auditoría de Inventario
                                </h1>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    Conteo Ciego
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Escanea o cuenta productos en estantería para conciliar diferencias contra el sistema en tiempo real
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            disabled={auditItems.length === 0}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            <Download size={14} />
                            <span>Exportar Acta</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleResetSession}
                            disabled={auditItems.length === 0}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-100 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            <RotateCcw size={14} />
                            <span>Reiniciar Conteo</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsConfirmModalOpen(true)}
                            disabled={auditItems.length === 0 || isSubmitting}
                            className="flex items-center gap-2 px-4 py-2 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer"
                        >
                            <CheckCircle2 size={16} />
                            <span>Aplicar Ajuste de Auditoría</span>
                        </button>
                    </div>
                </div>

                {/* Tarjetas de Métricas en Vivo */}
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-5">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Artículos Auditados</span>
                        <div className="text-xl font-black text-slate-900 dark:text-white mt-1 font-mono">
                            {metrics.totalItems}
                        </div>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">
                            {metrics.totalCountedUnits} unidades contadas
                        </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30">
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                            <TrendingUp size={12} /> Sobrantes (+ Stock)
                        </span>
                        <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                            +{metrics.surplusQty}
                        </div>
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 mt-0.5 block">
                            +${formatSmartUsd(metrics.surplusCostUsd)} • +Bs. {formatBs(metrics.surplusCostBs)}
                        </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30">
                        <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider flex items-center gap-1">
                            <TrendingDown size={12} /> Faltantes (- Pérdida)
                        </span>
                        <div className="text-xl font-black text-red-600 dark:text-red-400 mt-1 font-mono">
                            -{metrics.missingQty}
                        </div>
                        <span className="text-[11px] font-bold text-red-700 dark:text-red-300 mt-0.5 block">
                            -${formatSmartUsd(metrics.missingCostUsd)} • -Bs. {formatBs(metrics.missingCostBs)}
                        </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30">
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider block">Exactos / Sin Variación</span>
                        <div className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
                            {metrics.exactCount}
                        </div>
                        <span className="text-[11px] text-blue-500 mt-0.5 block">
                            100% Cuadrados con sistema
                        </span>
                    </div>

                    <div className="col-span-2 sm:col-span-2 lg:col-span-1 p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 text-white border border-slate-800 shadow-md">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Desvío Monetario Neto</span>
                        <div className={`text-xl font-black mt-1 font-mono ${metrics.netDifferenceUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {metrics.netDifferenceUsd >= 0 ? '+' : ''}${formatSmartUsd(metrics.netDifferenceUsd)}
                        </div>
                        <span className="text-[11px] text-slate-300 font-bold mt-0.5 block">
                            Bs. {formatBs(metrics.netDifferenceBs)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Barra de Entrada Rápida (Pistola de Códigos) y Carga de Categorías */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    {/* Input Pistola */}
                    <form onSubmit={handleBarcodeSubmit} className="md:col-span-6 relative">
                        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                            <Barcode size={14} className="text-primary-500" />
                            <span>Escaneo Rápido con Pistola o Código de Barras (Modo Continuo)</span>
                        </label>
                        <div className="relative">
                            <input
                                ref={barcodeInputRef}
                                type="text"
                                value={barcodeInput}
                                onChange={(e) => setBarcodeInput(e.target.value)}
                                placeholder="Escanea código de barras o escribe y presiona Enter..."
                                className="w-full pl-10 pr-24 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                            />
                            <Barcode className="absolute left-3 top-3 text-slate-400" size={18} />
                            <button
                                type="submit"
                                className="absolute right-1.5 top-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                            >
                                + Contar
                            </button>
                        </div>
                    </form>

                    {/* Cargar por Categoría */}
                    <div className="md:col-span-3">
                        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                            <Layers size={14} className="text-amber-500" />
                            <span>Cargar Categoría Completa</span>
                        </label>
                        <select
                            value={selectedCategory}
                            onChange={(e) => {
                                setSelectedCategory(e.target.value);
                                if (e.target.value) handleLoadCategoryToAudit(e.target.value);
                            }}
                            className="w-full py-2.5 px-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-primary-500 cursor-pointer"
                        >
                            <option value="">-- Seleccionar categoría --</option>
                            {categories.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>

                    {/* Botón Cargar Todo */}
                    <div className="md:col-span-3 flex items-end">
                        <button
                            type="button"
                            onClick={handleLoadAllCatalog}
                            disabled={isLoadingCatalog || catalog.length === 0}
                            className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <Package size={15} />
                            <span>Cargar Todo el Catálogo ({catalog.length})</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Filtros de la Tabla */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-xs">
                {/* Buscador dentro del conteo */}
                <div className="relative w-full sm:w-80">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filtrar por nombre o código..."
                        className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-primary-500"
                    />
                    <Search className="absolute left-3 top-2 text-slate-400" size={14} />
                </div>

                {/* Segmented Filter */}
                <div className="flex items-center overflow-x-auto gap-1 w-full sm:w-auto p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl text-xs">
                    <button
                        onClick={() => setFilterDifference('ALL')}
                        className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterDifference === 'ALL' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                        Todos ({auditItems.length})
                    </button>
                    <button
                        onClick={() => setFilterDifference('DIFF_ONLY')}
                        className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterDifference === 'DIFF_ONLY' ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                        Con Diferencias ({metrics.missingCount + metrics.surplusCount})
                    </button>
                    <button
                        onClick={() => setFilterDifference('MISSING')}
                        className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterDifference === 'MISSING' ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                        Faltantes ({metrics.missingCount})
                    </button>
                    <button
                        onClick={() => setFilterDifference('SURPLUS')}
                        className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterDifference === 'SURPLUS' ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                        Sobrantes ({metrics.surplusCount})
                    </button>
                    <button
                        onClick={() => setFilterDifference('EXACT')}
                        className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${filterDifference === 'EXACT' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                        Exactos ({metrics.exactCount})
                    </button>
                </div>
            </div>

            {/* Tabla de Conteo Físico */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto max-h-[550px]">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-md z-10 border-b border-slate-200 dark:border-slate-800 text-[11px] font-black text-slate-500 uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-3">Producto / SKU</th>
                                <th className="px-4 py-3">Categoría</th>
                                <th className="px-4 py-3 text-center">Stock Sistema</th>
                                <th className="px-4 py-3 text-center">Conteo Físico Real</th>
                                <th className="px-4 py-3 text-center">Diferencia</th>
                                <th className="px-4 py-3 text-right">Costo Unitario</th>
                                <th className="px-4 py-3 text-right">Impacto en Pérdida / Ganancia</th>
                                <th className="px-4 py-3 text-center w-12">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                            {filteredItems.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-16 text-center text-slate-400 dark:text-slate-500">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <ClipboardCheck size={36} className="text-slate-300 dark:text-slate-600" />
                                            <p className="font-bold text-sm">No hay artículos en esta lista de conteo</p>
                                            <p className="text-xs max-w-sm">
                                                Escanea con la pistola de código de barras arriba o carga una categoría para iniciar la auditoría.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((item, idx) => {
                                    const diff = Number(item.countedStock || 0) - Number(item.systemStock || 0);
                                    const isMissing = diff < -0.0001;
                                    const isSurplus = diff > 0.0001;
                                    const diffUsd = diff * Number(item.cost || 0);
                                    const diffBs = diffUsd * systemRate;

                                    return (
                                        <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="text-[10px] font-mono text-slate-400 w-5">{idx + 1}</span>
                                                    <div>
                                                        <div className="font-bold text-slate-900 dark:text-white">
                                                            {item.name}
                                                        </div>
                                                        <div className="text-[10px] font-mono text-slate-400">
                                                            {item.barcode || 'S/C'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                    {item.category}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                                                {item.systemStock}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStepCount(item.id, -1)}
                                                        className="w-6 h-6 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs transition-colors cursor-pointer"
                                                    >
                                                        <Minus size={12} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        value={item.countedStock}
                                                        onChange={(e) => handleUpdateCount(item.id, e.target.value)}
                                                        className="w-16 text-center font-mono font-black text-sm bg-transparent border-0 focus:outline-hidden text-slate-900 dark:text-white"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStepCount(item.id, 1)}
                                                        className="w-6 h-6 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs transition-colors cursor-pointer"
                                                    >
                                                        <Plus size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {isMissing ? (
                                                    <span className="px-2 py-1 rounded-lg text-xs font-black font-mono bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                                        {diff.toFixed(2)} (Faltante)
                                                    </span>
                                                ) : isSurplus ? (
                                                    <span className="px-2 py-1 rounded-lg text-xs font-black font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                                        +{diff.toFixed(2)} (Sobrante)
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-1 rounded-lg text-xs font-bold font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                                        0.00 (Exacto)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-slate-600 dark:text-slate-300">
                                                ${formatSmartUsd(item.cost)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                <div className={`font-black ${isMissing ? 'text-red-600 dark:text-red-400' : (isSurplus ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')}`}>
                                                    {diffUsd >= 0 ? '+' : ''}${formatSmartUsd(diffUsd)}
                                                </div>
                                                <div className="text-[10px] text-slate-400">
                                                    Bs. {formatBs(diffBs)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveItem(item.id)}
                                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors cursor-pointer"
                                                    title="Quitar de este conteo"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal de Confirmación para Aplicar Ajuste */}
            {isConfirmModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 size={26} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                                    Confirmar Ajuste de Auditoría
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Se actualizará el stock físico y se generarán los asientos auditados en el Kardex
                                </p>
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                            <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700/50">
                                <span className="text-slate-500 font-bold">Total Artículos a Cuadrar:</span>
                                <span className="font-mono font-black text-slate-900 dark:text-white">{metrics.totalItems}</span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700/50">
                                <span className="text-slate-500 font-bold">Faltantes Totales:</span>
                                <span className="font-mono font-black text-red-600 dark:text-red-400">-{metrics.missingQty} (-${formatSmartUsd(metrics.missingCostUsd)})</span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-slate-200 dark:border-slate-700/50">
                                <span className="text-slate-500 font-bold">Sobrantes Totales:</span>
                                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">+{metrics.surplusQty} (+${formatSmartUsd(metrics.surplusCostUsd)})</span>
                            </div>
                            <div className="flex justify-between items-center py-1 text-sm font-black">
                                <span className="text-slate-800 dark:text-white">Impacto Neto en Inventario:</span>
                                <span className={`font-mono ${metrics.netDifferenceUsd >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {metrics.netDifferenceUsd >= 0 ? '+' : ''}${formatSmartUsd(metrics.netDifferenceUsd)}
                                </span>
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                                Notas o Responsable de la Toma Física (Opcional)
                            </label>
                            <textarea
                                value={sessionNotes}
                                onChange={(e) => setSessionNotes(e.target.value)}
                                placeholder="Ej: Conteo físico mensual anaqueles 1 al 4 realizado por supervisor..."
                                rows={2}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 resize-none"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setIsConfirmModalOpen(false)}
                                disabled={isSubmitting}
                                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyAudit}
                                disabled={isSubmitting}
                                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <>
                                        <RefreshCw size={14} className="animate-spin" />
                                        <span>Procesando Kardex...</span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 size={16} />
                                        <span>Confirmar y Ajustar Stock</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {confirmDialog}
        </div>
    );
}
