import { useState, useEffect, useRef, useCallback, memo, lazy, Suspense } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { db } from '../services/db';
import { useAuth } from '../hooks/AuthContext';
import { useSocket } from '../hooks/SocketContext';
import {
    Search, 
    Plus, 
    Edit2, 
    Trash2, 
    Package, 
    Clock, 
    X, 
    Download, 
    Upload, 
    Printer, 
    Image as ImageIcon, 
    LayoutGrid, 
    List as ListIcon, 
    Loader2, 
    FileText, 
    Pill, 
    AlertTriangle, 
    TrendingUp, 
    TrendingDown, 
    DollarSign, 
    AlertCircle, 
    RefreshCw, 
    Tag, 
    Layers, 
    RotateCcw
} from 'lucide-react';
const ProductModal = lazy(() => import('../components/ProductModal'));
import ConfirmModal from '../components/ConfirmModal';
import KardexModal from '../components/KardexModal';
import LabelModal from '../components/LabelModal';
import BulkEditModal from '../components/BulkEditModal';
import QuickStockAdjustModal from '../components/QuickStockAdjustModal';
import WasteManagementModal from '../components/WasteManagementModal';
import { getImageUrl } from '../utils/imageUtils';
import { formatMoney, fetchGlobalSettings, formatStock, isSingleCurrencyMode, isVesOnlyMode } from '../utils/format';
import useScanner from '../hooks/useScanner';

// Custom debounce hook for search optimization
function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}

// Componente de fila memoizado para la vista de tabla
const ProductRow = memo(function ProductRow({ product, user, isSelected, onToggleSelect, onEdit, onDelete, onKardex, onQuickAdjust, onGenerateIA, onPrintLabel, isGeneratingIA, renderFormatMoney, formatStock, getImageUrl }) {
    const canEditProducts = ['superadmin', 'admin', 'supervisor', 'owner', 'dueño', 'master'].includes((user?.role || '').toLowerCase()) || user?.permissions?.canCreateProducts || user?.permissions?.canManageInventory;
    return (
    <tr key={product.id} className="group hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors relative">
        <td className="px-4 py-4 w-10">
            <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(product)}
                className="w-4 h-4 rounded border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 text-primary-600 focus:ring-primary-500 cursor-pointer"
            />
        </td>
        <td className="px-4 py-4 cursor-pointer group/prod" onClick={() => canEditProducts && onEdit(product)} title={canEditProducts ? "Toca para editar producto" : product.name}>
            <div className="flex items-center gap-3 sm:gap-4">
                <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg sm:rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center shrink-0 relative group/img">
                    <img
                        src={getImageUrl(product.imageUri)}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        loading="lazy"
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'block'; }}
                    />
                    <ImageIcon className="text-slate-500 dark:text-slate-600 hidden" size={16} />
                </div>
                <div className="flex flex-col min-w-0 gap-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-200 truncate max-w-[140px] sm:max-w-[240px] text-xs sm:text-sm group-hover/prod:text-primary-500 transition-colors flex items-center gap-1">
                            {product.name}
                            {canEditProducts && <Edit2 size={12} className="text-primary-500 opacity-60 group-hover/prod:opacity-100 shrink-0" />}
                        </span>
                        {product.es_controlado && (
                            <span className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[8px] font-black uppercase tracking-widest rounded flex items-center gap-1 shrink-0 shadow-sm" title="Exige Récipe Médico Controlado">
                                <AlertTriangle size={10} className="text-red-500" /> RÉCIPE
                            </span>
                        )}
                    </div>
                    <span className="text-[8px] sm:text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{product.barcode || product.id.slice(0, 8)}</span>
                    {Number(product.unitsPerBulk) > 1 && (
                        <span className="text-[8px] font-black text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 w-fit mt-0.5" title={`Presentación: ${product.unitsPerBulk} ${product.isSoldByWeight || product.stockUnit === 'kg' ? 'kg' : 'unidades'}`}>
                            <Layers size={10} className="text-amber-600 dark:text-amber-400" />
                            <span>{product.bulkUnitName || 'Paq.'} {product.isSoldByWeight || product.stockUnit === 'kg' ? `(~${product.unitsPerBulk} kg)` : `x${product.unitsPerBulk}`} {product.bulkPrice ? `($${Number(product.bulkPrice).toFixed(2)})` : ''}</span>
                        </span>
                    )}
                    {product.principio_activo && (
                        <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 w-fit mt-0.5">
                            <Pill size={11} /> {product.principio_activo}
                        </span>
                    )}
                    {product.expirationDate && (
                        <span className={`text-[9px] font-bold flex items-center gap-1 mt-0.5 ${new Date(product.expirationDate) < new Date(Date.now() + 60*24*60*60*1000) ? 'text-red-500 animate-pulse' : 'text-amber-500'}`}>
                            <Clock size={10} /> Vence: {product.expirationDate} {product.batchNumber ? `(Lote: ${product.batchNumber})` : ''}
                        </span>
                    )}
                </div>
            </div>
        </td>
        <td className="hidden lg:table-cell px-6 py-4 cursor-pointer" onClick={() => canEditProducts && onEdit(product)}>
            <span className="px-2.5 py-1 rounded-lg bg-primary-500/5 dark:bg-primary-500/5 border border-primary-500/10 text-[9px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-widest">
                {product.category || 'General'}
            </span>
        </td>
        <td className="hidden xl:table-cell px-6 py-4 cursor-pointer" onClick={() => canEditProducts && onEdit(product)}>
            <span className="text-slate-600 dark:text-slate-400 font-bold text-xs italic">{product.Supplier?.name || 'Distribuidor'}</span>
        </td>
        <td className="px-4 py-4 text-center">
            {(product.isService || String(product.category || '').trim().toLowerCase() === 'servicios') ? (
                <div
                    className="inline-flex flex-col items-center px-3 py-1 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-400"
                    title="Servicio intangible — No requiere ni suma stock físico"
                >
                    <span className="font-black text-base leading-none">∞</span>
                    <span className="text-[8px] font-black uppercase tracking-widest mt-0.5">SERVICIO</span>
                </div>
            ) : (
                /* Clickable Quick Adjust Stock Button */
                <button
                    type="button"
                    onClick={() => onQuickAdjust(product)}
                    className="group/stock inline-flex flex-col items-center px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all cursor-pointer"
                    title="Haz clic para Ajuste Rápido de Stock"
                >
                    <div className="flex items-center gap-1.5">
                        {Number(product.stockQuantity) <= (Number(product.minStock) || 0) && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>}
                        <span className={`font-black text-[13px] sm:text-sm tabular-nums group-hover/stock:text-primary-500 transition-colors ${Number(product.stockQuantity) <= (Number(product.minStock) || 0) ? 'text-red-500 dark:text-red-400' : 'text-slate-900 dark:text-slate-200'}`}>
                            {formatStock(product.stockQuantity, product.isSoldByWeight ? 3 : 0)}
                        </span>
                        <RefreshCw size={11} className="text-slate-400 opacity-0 group-hover/stock:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{product.stockUnit || 'UND'}</span>
                    {(product.isSoldByWeight || product.stockUnit === 'kg') && Number(product.stockQuantity) > 0 && (Number(product.stockUnits) > 0 || (Number(product.unitsPerBulk) > 0 && Number(product.unitsPerBulk) !== 1)) && (
                        <span className="text-[8.5px] font-black text-amber-600 dark:text-amber-400 mt-0.5">
                            {Number(product.stockUnits) > 0
                                ? `${Number(product.stockUnits)} ${product.bulkUnitName || 'Pza'}`
                                : `≈ ${Math.round((Number(product.stockQuantity) / Number(product.unitsPerBulk)) * 10) / 10} ${product.bulkUnitName || 'Pza'}`}
                        </span>
                    )}
                </button>
            )}
        </td>
        <td className="px-4 py-4 text-right cursor-pointer" onClick={() => canEditProducts && onEdit(product)} title={canEditProducts ? "Toca para editar precio" : ""}>
            <div className="flex flex-col items-end group-hover:text-primary-500 transition-colors">
                <span className="font-black text-sm text-slate-900 dark:text-slate-200 tabular-nums">{renderFormatMoney(product.price, isSingleCurrencyMode() ? 'USD' : 'VES')}</span>
                {!isSingleCurrencyMode() && (
                    <span className="text-[10px] font-black text-primary-500 uppercase tracking-widest">{renderFormatMoney(product.price, 'USD')}</span>
                )}
            </div>
        </td>
        <td className="px-6 py-4 text-center">
            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs divide-x divide-slate-200 dark:divide-slate-800 overflow-hidden">
                {['admin', 'superadmin', 'owner', 'master'].includes(user?.role?.toLowerCase()) && (
                    <button
                        onClick={() => onKardex(product)}
                        title="Movimientos de Stock (Kardex)"
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                    >
                        <Clock size={14} />
                    </button>
                )}
                {['admin', 'superadmin', 'owner', 'master'].includes(user?.role?.toLowerCase()) && (
                    <button
                        onClick={() => onGenerateIA(product)}
                        disabled={isGeneratingIA}
                        title="Buscar Imagen del Producto"
                        className={`p-1.5 transition-colors ${isGeneratingIA ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80'}`}
                    >
                        {isGeneratingIA ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    </button>
                )}
                <button
                    onClick={() => onPrintLabel ? onPrintLabel(product) : null}
                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                    title="Generar e Imprimir Etiqueta"
                >
                    <Printer size={14} />
                </button>
                {canEditProducts && (
                    <button
                        onClick={() => onEdit(product)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                        title="Editar Ficha de Producto"
                    >
                        <Edit2 size={14} />
                    </button>
                )}
                {canEditProducts && (
                    <button
                        onClick={() => onDelete(product.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="Eliminar Producto"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>
        </td>
    </tr>
    );
});

// Componente de tarjeta de inventario optimizado para pantallas táctiles móviles
const MobileProductCard = memo(function MobileProductCard({ product, user, isSelected, onToggleSelect, onEdit, onDelete, onKardex, onQuickAdjust, onGenerateIA, onPrintLabel, isGeneratingIA, renderFormatMoney, formatStock, getImageUrl }) {
    const canEditProducts = ['superadmin', 'admin', 'supervisor', 'owner', 'dueño', 'master'].includes((user?.role || '').toLowerCase()) || user?.permissions?.canCreateProducts || user?.permissions?.canManageInventory;
    const isServiceItem = Boolean(product.isService || String(product.category || '').trim().toLowerCase() === 'servicios');
    const isOutOfStock = !isServiceItem && Number(product.stockQuantity) <= 0;
    const isLowStock = !isServiceItem && !isOutOfStock && Number(product.stockQuantity) <= (Number(product.minStock) || 0);

    return (
        <div className={`p-3.5 sm:p-4 rounded-xl sm:rounded-2xl bg-white dark:bg-slate-900 border transition-all ${
            isSelected 
                ? 'border-primary-500 shadow-md shadow-primary-500/20' 
                : 'border-slate-200 dark:border-slate-800 shadow-xs'
        }`}>
            <div className="flex gap-3">
                {/* Checkbox + Thumbnail */}
                <div className="relative shrink-0">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(product)}
                        className="absolute top-1 left-1 z-10 w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-primary-600 focus:ring-primary-500 bg-white dark:bg-slate-800 cursor-pointer"
                    />
                    <div 
                        onClick={() => onEdit(product)}
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg sm:rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center cursor-pointer"
                    >
                        {product.imageUri ? (
                            <img src={getImageUrl(product.imageUri)} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                            <ImageIcon size={24} className="text-slate-400" />
                        )}
                    </div>
                </div>

                {/* Main Details */}
                <div className="min-w-0 flex-1 flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-start gap-2">
                            <h4 
                                onClick={() => onEdit(product)}
                                className="font-black text-slate-900 dark:text-white text-xs sm:text-sm uppercase tracking-tight line-clamp-2 leading-snug cursor-pointer hover:text-primary-500 transition-colors"
                            >
                                {product.name}
                            </h4>
                            <div className="text-right shrink-0">
                                <span className="font-mono font-black text-xs sm:text-sm text-slate-900 dark:text-white block">
                                    {renderFormatMoney(product.price, isSingleCurrencyMode() ? 'USD' : 'VES')}
                                </span>
                                {!isSingleCurrencyMode() && (
                                    <span className="font-mono text-[9.5px] sm:text-[10px] font-bold text-primary-500 block">
                                        {renderFormatMoney(product.price, 'USD')}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[8.5px] font-mono font-bold text-slate-400 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded uppercase">
                                {product.barcode || product.id.slice(0, 8)}
                            </span>
                            {product.category && (
                                <span className="text-[8.5px] font-black text-primary-600 dark:text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded uppercase">
                                    {product.category}
                                </span>
                            )}
                            {product.es_controlado && (
                                <span className="text-[8px] font-black text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded uppercase">
                                    RÉCIPE
                                </span>
                            )}
                            {Number(product.unitsPerBulk) > 1 && (
                                <span className="text-[8px] font-black text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase">
                                    <Layers size={9} className="text-amber-600 dark:text-amber-400" />
                                    <span>{product.bulkUnitName || 'PAQ'} x{product.unitsPerBulk}</span>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Stock Pill + Actions Row */}
                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 dark:border-white/5 gap-2">
                        {isServiceItem ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                                <span>∞ SERVICIO</span>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onQuickAdjust(product)}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold tabular-nums transition-colors border ${
                                    isOutOfStock
                                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                                        : isLowStock
                                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                }`}
                                title="Toca para ajustar stock"
                            >
                                <span>Stock: {formatStock(product.stockQuantity, product.isSoldByWeight ? 3 : 0)} {product.stockUnit || 'UND'}</span>
                                <RefreshCw size={10} className="opacity-60" />
                            </button>
                        )}

                        <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-x divide-slate-200 dark:divide-slate-800 shadow-2xs overflow-hidden shrink-0">
                            {['admin', 'superadmin', 'owner', 'master'].includes(user?.role?.toLowerCase()) && (
                                <button
                                    onClick={() => onKardex(product)}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                                    title="Kardex"
                                >
                                    <Clock size={14} />
                                </button>
                            )}
                            {['admin', 'superadmin', 'owner', 'master'].includes(user?.role?.toLowerCase()) && (
                                <button
                                    onClick={() => onGenerateIA(product)}
                                    disabled={isGeneratingIA}
                                    title="Buscar Imagen del Producto"
                                    className={`p-1.5 transition-colors ${isGeneratingIA ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80'}`}
                                >
                                    {isGeneratingIA ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                                </button>
                            )}
                            <button
                                onClick={() => onPrintLabel ? onPrintLabel(product) : null}
                                className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                                title="Imprimir Etiqueta"
                            >
                                <Printer size={14} />
                            </button>
                            {canEditProducts && (
                                <button
                                    onClick={() => onEdit(product)}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                                    title="Editar"
                                >
                                    <Edit2 size={14} />
                                </button>
                            )}
                            {canEditProducts && (
                                <button
                                    onClick={() => onDelete(product.id)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                    title="Eliminar"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// Componente de tarjeta memoizado para la vista de cuadrícula
const ProductCard = memo(({ product, user, isSelected, onToggleSelect, onEdit, onQuickAdjust, onGenerateIA, onPrintLabel, isGeneratingIA, renderFormatMoney, formatStock, getImageUrl }) => (
    <div
        onClick={() => onEdit ? onEdit(product) : onToggleSelect(product)}
        className={`group relative flex flex-col bg-white dark:bg-slate-900 border rounded-xl sm:rounded-2xl overflow-hidden shadow-xs transition-all duration-200 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 ${isSelected ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-slate-200 dark:border-slate-800'}`}
    >
        <div className="aspect-square relative overflow-hidden bg-slate-100 dark:bg-slate-950">
            <img
                src={getImageUrl(product.imageUri)}
                alt={product.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
                onError={(e) => { e.target.style.display = 'none'; e.target.nextElementSibling.style.display = 'flex'; }}
            />
            <div className="absolute inset-0 hidden items-center justify-center text-slate-600 dark:text-slate-300 dark:text-slate-700">
                <ImageIcon size={48} strokeWidth={1} />
            </div>

            {/* Selection Indicator */}
            <div 
                className="absolute top-3 right-3 z-20"
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(product);
                }}
            >
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors duration-200 ${isSelected ? 'bg-primary-500 border-primary-500 text-white shadow-lg' : 'bg-black/40 border-white/20 hover:bg-black/60'}`}>
                    {isSelected && <Plus size={16} strokeWidth={4} className="rotate-45" />}
                </div>
            </div>

            {/* Edit Quick Badge */}
            <div className="absolute top-3 left-3 z-20">
                <div className="p-1.5 rounded-xl bg-black/40 backdrop-blur-md border border-white/20 text-white hover:bg-primary-600 transition-colors">
                    <Edit2 size={13} />
                </div>
            </div>

            {/* Image Generation Button for Grid View */}
            {!product.imageUri && ['admin', 'superadmin', 'owner', 'master'].includes(user?.role?.toLowerCase()) && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onGenerateIA(product);
                    }}
                    className="absolute bottom-4 right-4 p-3 bg-slate-900/80 hover:bg-slate-800 text-sky-400 rounded-2xl shadow-xl transition-all z-50 cursor-pointer active:scale-90 flex items-center justify-center border border-white/20 backdrop-blur-sm"
                    title="Buscar Imagen del Producto"
                    disabled={isGeneratingIA}
                >
                    {isGeneratingIA ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                </button>
            )}

            {(Number(product.stockQuantity) <= (Number(product.minStock) || 0)) && (
                <div className="absolute bottom-3 left-3 bg-red-600 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg uppercase tracking-widest">
                    Stock Crítico
                </div>
            )}
        </div>

        <div className="p-5 flex-1 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[9px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-widest">{product.category || 'General'}</span>
                    {product.es_controlado && (
                        <span className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-[8px] font-black uppercase tracking-widest rounded flex items-center gap-1 shadow-sm" title="Exige Récipe Médico Controlado">
                            <AlertTriangle size={10} className="text-red-500" /> RÉCIPE
                        </span>
                    )}
                </div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm line-clamp-2 leading-tight min-h-[2.5rem] flex items-center gap-1.5">
                    {product.name}
                    <Edit2 size={12} className="text-primary-500 opacity-60 shrink-0" />
                </h3>
                {product.principio_activo && (
                    <span className="text-[9px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded flex items-center gap-1 w-fit mt-0.5">
                        <Pill size={11} /> {product.principio_activo}
                    </span>
                )}
            </div>

            <div className="mt-auto pt-4 border-t border-slate-100 dark:border-white/5 flex flex-col gap-2">
                <div className="flex flex-col">
                    <span className="text-lg font-black text-slate-900 dark:text-white tabular-nums leading-none">{renderFormatMoney(product.price, isSingleCurrencyMode() ? 'USD' : 'VES')}</span>
                    {!isSingleCurrencyMode() && (
                        <span className="text-[11px] font-black text-primary-500 uppercase tracking-widest mt-1">{renderFormatMoney(product.price, 'USD')}</span>
                    )}
                </div>
                <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                        Existencia: {formatStock(product.stockQuantity, product.isSoldByWeight ? 3 : 0)} {product.stockUnit || 'UND'}
                        {(product.isSoldByWeight || product.stockUnit === 'kg') && Number(product.unitsPerBulk) > 0 && Number(product.unitsPerBulk) !== 1 && Number(product.stockQuantity) > 0
                            ? ` (≈ ${Math.round((Number(product.stockQuantity) / Number(product.unitsPerBulk)) * 10) / 10} ${product.bulkUnitName || 'Pza'})`
                            : ''}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onPrintLabel) onPrintLabel(product);
                            }}
                            className="p-1.5 hover:bg-indigo-500/10 rounded-lg text-indigo-500 transition-colors"
                            title="Generar e Imprimir Etiqueta"
                        >
                            <Printer size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onQuickAdjust(product);
                            }}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg text-primary-500"
                            title="Ajuste Rápido de Stock"
                        >
                            <RefreshCw size={13} />
                        </button>
                    </div>
                </div>
                {product.expirationDate && (
                    <div className="mt-1">
                        <span className={`text-[9px] font-bold flex items-center gap-1 ${new Date(product.expirationDate) < new Date(Date.now() + 60*24*60*60*1000) ? 'text-red-500 animate-pulse' : 'text-amber-500'}`}>
                            <Clock size={10} /> Vence: {product.expirationDate} {product.batchNumber ? `(Lote: ${product.batchNumber})` : ''}
                        </span>
                    </div>
                )}
            </div>
        </div>
    </div>
));
ProductCard.displayName = 'ProductCard';

export function InventoryList() {
    const { user, hasPermission } = useAuth();
    const { socket } = useSocket();
    const canCreateProducts = hasPermission('canCreateProducts') || ['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes((user?.role || '').toLowerCase());
    const canViewCosts = hasPermission('canViewCosts') || ['superadmin', 'owner', 'dueño', 'admin', 'supervisor', 'master'].includes((user?.role || '').toLowerCase());
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [suppliers, setSuppliers] = useState([]);
    const [supplierFilter, setSupplierFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [categories, setCategories] = useState([]);
    const [stockFilter, setStockFilter] = useState('all'); // 'all' | 'low' | 'out' | 'in'
    const [missingCostOnly, setMissingCostOnly] = useState(false);
    const [pharmacyFilter, setPharmacyFilter] = useState('all'); // 'all' | 'controlled' | 'expiring'
    const [priceRange, setPriceRange] = useState({ min: '', max: '' });
    const showFilters = true;
    const [viewMode, setViewMode] = useState(() => {
        return localStorage.getItem('inventory_view_mode') || 'list';
    });
    const tableSectionRef = useRef(null);

    // Executive Valuation KPIs
    const [valuationLoaded, setValuationLoaded] = useState(false);
    const [valuation, setValuation] = useState({
        totalValueAtCost: 0,
        totalRetailValue: 0,
        itemCount: 0,
        serviceCount: 0,
        totalCatalogCount: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        projectedMarginProfit: 0,
        projectedMarginPercent: 0,
        missingCostCount: 0,
        missingCostRetailValue: 0,
        zeroPriceCount: 0,
        canViewCosts: true
    });

    // Pagination state
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const limit = 50;

    // Modals state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isKardexOpen, setIsKardexOpen] = useState(false);
    const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
    const [isQuickStockOpen, setIsQuickStockOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [selectedProducts, setSelectedProducts] = useState([]);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [isWasteModalOpen, setIsWasteModalOpen] = useState(false);
    const [wasteModalProduct, setWasteModalProduct] = useState(null);
    const [branches, setBranches] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [generatingIAId, setGeneratingIAId] = useState(null);
    const [settings, setSettings] = useState({ rate: 1, currencyMode: 'BOTH' });

    // Confirm Modal state
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    const handleInventoryScan = useCallback(async (rawBarcode) => {
        const cleanCode = String(rawBarcode || '').trim();
        if (!cleanCode) return;

        // Buscar primero en el catálogo local si el código ya existe
        try {
            const localProds = await db.getAll('products');
            const lower = cleanCode.toLowerCase();
            const stripped = lower.replace(/^0+/, '');
            const matched = localProds.find(p => {
                const cands = [
                    p.barcode,
                    p.bulkBarcode,
                    p.midBulkBarcode,
                    ...(Array.isArray(p.Presentations) ? p.Presentations.map(pr => pr?.barcode) : []),
                    ...(Array.isArray(p.presentations) ? p.presentations.map(pr => pr?.barcode) : []),
                    ...(Array.isArray(p.Variantes) ? p.Variantes.map(v => v?.codigo_barras || v?.sku) : [])
                ].filter(Boolean).map(c => String(c).trim().toLowerCase());
                return cands.some(c => c === lower || (stripped.length >= 4 && c.replace(/^0+/, '') === stripped));
            });

            if (matched) {
                setSearchTerm(cleanCode);
                toast.success(`Producto encontrado: ${matched.name}`, { id: 'inv-barcode-scan' });
                return;
            }
        } catch (localScanErr) {
            console.warn('[Inventory] Error buscando código en catálogo local:', localScanErr?.message || localScanErr);
        }

        // Si no está en caché local, consultar al servidor por si acaso
        try {
            const { data } = await api.get('/products', { params: { search: cleanCode, limit: 5 } });
            const list = Array.isArray(data) ? data : (data?.products || []);
            if (list.length > 0) {
                setSearchTerm(cleanCode);
                toast.success(`Producto encontrado: ${list[0].name}`, { id: 'inv-barcode-scan' });
                return;
            }
        } catch (caughtErr) { console.warn('[Inventory] Error en operación auxiliar:', caughtErr?.message || caughtErr); }

        // Si el código no existe en ningún producto, abrir modal para registrarlo con el código ya pre-cargado
        setSearchTerm('');
        setSelectedProduct({ barcode: cleanCode });
        setIsModalOpen(true);
        toast(`Código nuevo (${cleanCode}): registra los datos del producto`, { id: 'inv-barcode-scan' });
    }, []);

    useScanner(handleInventoryScan, {
        enabled: !isModalOpen && !isKardexOpen && !isLabelModalOpen && !isQuickStockOpen && !isBulkModalOpen && !isWasteModalOpen
    });

    const fetchValuation = useCallback(async () => {
        try {
            const params = user?.activeBranchId ? { branchId: user.activeBranchId } : {};
            const { data } = await api.get('/reports/bi/inventory-valuation', { params });
            setValuation(data || {
                totalValueAtCost: 0,
                totalRetailValue: 0,
                itemCount: 0,
                serviceCount: 0,
                totalCatalogCount: 0,
                lowStockCount: 0,
                outOfStockCount: 0,
                projectedMarginProfit: 0,
                projectedMarginPercent: 0,
                missingCostCount: 0,
                missingCostRetailValue: 0,
                zeroPriceCount: 0,
                canViewCosts: true
            });
            setValuationLoaded(true);
        } catch (error) {
            console.error('Error fetching valuation metrics:', error);
        }
    }, [user?.activeBranchId]);

    const handleKpiStockToggle = useCallback((target) => {
        setMissingCostOnly(false);
        setStockFilter(prev => {
            const next = prev === target ? 'all' : target;
            if (next !== 'all') {
                setTimeout(() => tableSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }
            return next;
        });
    }, []);

    const handleMissingCostToggle = useCallback(() => {
        setMissingCostOnly(prev => {
            const next = !prev;
            if (next) {
                setStockFilter('all');
                setTimeout(() => tableSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }
            return next;
        });
    }, []);

    const fetchSuppliers = useCallback(async (signal) => {
        try {
            const { data } = await api.get('/suppliers', { signal });
            setSuppliers(data || []);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') return;
            console.warn('Error fetching suppliers in Inventory:', error?.message || error);
        }
    }, []);

    const fetchCategories = useCallback(async (signal) => {
        const cleanCategoryList = (list) => [...new Set(
            (list || [])
                .map(c => c?.trim())
                .filter(c => Boolean(c) && !c.toLowerCase().includes('sin stock'))
        )].sort((a, b) => a.localeCompare(b, 'es'));

        try {
            const { data } = await api.get('/products/categories', { timeout: 8000, signal });
            const uniqueCats = cleanCategoryList(data);
            if (uniqueCats.length > 0) {
                setCategories(uniqueCats);
                try { localStorage.setItem('pos_categories', JSON.stringify(uniqueCats)); } catch (caughtErr) { console.warn('[Inventory] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
            }
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') return;
            console.warn('Fallback offline de categorías en Inventory:', error?.message || error);
            try {
                const cached = cleanCategoryList(JSON.parse(localStorage.getItem('pos_categories') || '[]'));
                if (cached.length > 0) {
                    setCategories(cached);
                } else {
                    const localProducts = await db.getAll('products');
                    const localCats = cleanCategoryList((localProducts || []).map(p => p.category));
                    if (localCats.length > 0) setCategories(localCats);
                }
            } catch (fallbackErr) {
                console.warn('Categories offline fallback error:', fallbackErr);
            }
        }
    }, []);

    const fetchSettings = useCallback(async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    }, []);

    const fetchBranches = useCallback(async (signal) => {
        try {
            const { data } = await api.get('/branches', { signal });
            setBranches(data || []);
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') return;
            console.warn('Error fetching branches in Inventory:', error?.message || error);
        }
    }, []);

    const stableGetImageUrl = useCallback((uri) => getImageUrl(uri), []);
    const stableFormatStock = useCallback((qty, decimals) => formatStock(qty, decimals), []);
    const stableRenderFormatMoney = useCallback((val, mode) => formatMoney(val, mode, settings), [settings]);

    const productsCountRef = useRef(0);
    useEffect(() => {
        productsCountRef.current = products.length;
    }, [products.length]);

    const fetchProducts = useCallback(async (resetPage = false) => {
        try {
            if (resetPage && productsCountRef.current === 0) setLoading(true);

            const currentPage = resetPage ? 1 : page;
            let url = '/products';
            const params = new URLSearchParams();

            params.append('limit', limit);
            params.append('page', currentPage);
            params.append('branchScoped', 'true');
            if (user?.activeBranchId) params.append('branchId', user.activeBranchId);

            if (debouncedSearchTerm) params.append('search', debouncedSearchTerm);
            if (supplierFilter) params.append('supplierId', supplierFilter);
            if (categoryFilter) params.append('category', categoryFilter);
            if (stockFilter !== 'all') params.append('stockStatus', stockFilter);
            if (missingCostOnly) params.append('missingCost', 'true');
            if (pharmacyFilter === 'controlled') params.append('es_controlado', 'true');
            if (pharmacyFilter === 'expiring') params.append('expirationFilter', 'expiring');
            if (priceRange.min) params.append('minPrice', priceRange.min);
            if (priceRange.max) params.append('maxPrice', priceRange.max);

            url += `?${params.toString()}`;
            const { data } = await api.get(url);

            const productData = Array.isArray(data?.products) ? data.products : (Array.isArray(data) ? data : []);
            const totalItems = data?.total || productData.length;

            if (resetPage) {
                setProducts(productData);
                setHasMore(productData.length < totalItems);
            } else {
                setProducts(prev => {
                    const existingIds = new Set(prev.map(p => p.id));
                    const newProducts = productData.filter(p => !existingIds.has(p.id));
                    return [...prev, ...newProducts];
                });
                setHasMore(totalItems > (page * limit));
            }
        } catch (error) {
            console.error('Error fetching products:', error);
            // Offline fallback: load from IndexedDB
            try {
                let localProducts = await db.getAll('products');
                if (localProducts && localProducts.length > 0) {
                    const isServiceItem = (p) => String(p.category || '').trim().toLowerCase() === 'servicios';
                    // Apply client-side filtering
                    if (debouncedSearchTerm) {
                        const term = debouncedSearchTerm.toLowerCase();
                        localProducts = localProducts.filter(p =>
                            (p.name || '').toLowerCase().includes(term) ||
                            (p.barcode || '').toLowerCase().includes(term) ||
                            (p.sku || '').toLowerCase().includes(term)
                        );
                    }
                    if (categoryFilter) {
                        const catTarget = categoryFilter.trim().toLowerCase();
                        localProducts = localProducts.filter(p => (p.category || '').trim().toLowerCase() === catTarget);
                    }
                    if (stockFilter === 'low') {
                        localProducts = localProducts.filter(p => !isServiceItem(p) && Number(p.stockQuantity || 0) <= Number(p.minStock || 0) && Number(p.stockQuantity || 0) > 0);
                    } else if (stockFilter === 'out') {
                        localProducts = localProducts.filter(p => !isServiceItem(p) && Number(p.stockQuantity || 0) <= 0);
                    }
                    if (missingCostOnly) {
                        localProducts = localProducts.filter(p => !isServiceItem(p) && Number(p.stockQuantity || 0) > 0 && Number(p.cost || 0) <= 0);
                    }
                    // Sort by name
                    localProducts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    // Client-side pagination
                    const start = (resetPage ? 0 : (page - 1)) * limit;
                    const paginated = localProducts.slice(start, start + limit);
                    if (resetPage) {
                        setProducts(paginated);
                    } else {
                        setProducts(prev => {
                            const existingIds = new Set(prev.map(p => p.id));
                            const newProducts = paginated.filter(p => !existingIds.has(p.id));
                            return [...prev, ...newProducts];
                        });
                    }
                    setHasMore(localProducts.length > (start + limit));
                    console.log(`[Inventory] Loaded ${paginated.length} products from IndexedDB (offline mode)`);
                }
            } catch (dbErr) {
                console.error('Error loading from IndexedDB:', dbErr);
            }
        } finally {
            setLoading(false);
        }
    }, [page, debouncedSearchTerm, supplierFilter, categoryFilter, stockFilter, missingCostOnly, pharmacyFilter, priceRange, limit, user?.activeBranchId]);

    useEffect(() => {
        const controller = new AbortController();
        fetchSettings();
        fetchSuppliers(controller.signal);
        fetchCategories(controller.signal);
        fetchValuation();
        if (['admin', 'superadmin'].includes(user?.role?.toLowerCase())) {
            fetchBranches(controller.signal);
        }
        return () => controller.abort();
    }, [user?.role, fetchSettings, fetchSuppliers, fetchCategories, fetchBranches, fetchValuation]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearchTerm, supplierFilter, categoryFilter, stockFilter, missingCostOnly, pharmacyFilter, priceRange]);

    useEffect(() => {
        fetchProducts(page === 1);
    }, [fetchProducts, page]);

    // Socket.io updates
    const lastUpdateRef = useRef(0);
    useEffect(() => {
        if (!socket) return;
        const handleRealTimeUpdate = () => {
            const now = Date.now();
            if (now - lastUpdateRef.current < 2000) return;
            lastUpdateRef.current = now;
            fetchProducts(true);
            fetchValuation();
        };

        const handleProductUpdated = (updatedProduct) => {
            setProducts(prev => {
                let stockQty = updatedProduct.stockQuantity;
                if (Array.isArray(updatedProduct.BranchStocks) && updatedProduct.BranchStocks.length > 0) {
                    if (user?.activeBranchId) {
                        const branchRow = updatedProduct.BranchStocks.find(s => String(s.branchId) === String(user.activeBranchId));
                        stockQty = branchRow ? Number(branchRow.quantity || 0) : 0;
                    } else {
                        stockQty = updatedProduct.BranchStocks.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
                    }
                }
                return prev.map(p => p.id === updatedProduct.id ? {
                    ...p,
                    ...updatedProduct,
                    stockQuantity: Number(stockQty)
                } : p);
            });
            fetchValuation();
        };

        socket.on('inventory_changed', handleRealTimeUpdate);
        socket.on('product_updated', handleProductUpdated);
        return () => {
            socket.off('inventory_changed', handleRealTimeUpdate);
            socket.off('product_updated', handleProductUpdated);
        };
    }, [socket, fetchProducts, fetchValuation, user?.activeBranchId]);

    const handleCreateProduct = () => {
        setSelectedProduct(null);
        setIsModalOpen(true);
    };

    const handleToggleSelect = useCallback((product) => {
        setSelectedProducts(prev => {
            const isAlreadySelected = prev.some(p => p.id === product.id);
            if (isAlreadySelected) {
                return prev.filter(p => p.id !== product.id);
            } else {
                return [...prev, product];
            }
        });
    }, []);

    const handleEditProduct = useCallback(async (product) => {
        try {
            setProcessing(true);
            let prodData = null;
            try {
                const { data } = await api.get(`/products/${product.id}`, { timeout: 3000 });
                prodData = data;
            } catch (netErr) {
                console.warn('Network error fetching product details, falling back to local DB:', netErr);
            }

            if (!prodData) {
                try {
                    prodData = await db.getById('products', product.id);
                } catch (dbErr) {
                    console.error('Error fetching product from IndexedDB:', dbErr);
                }
            }

            if (!prodData) {
                prodData = product;
            }

            if (prodData) {
                setSelectedProduct(prodData);
                setIsModalOpen(true);
            } else {
                toast.error('No se pudieron cargar los datos del producto');
            }
        } catch (error) {
            console.error('Error in handleEditProduct:', error);
            if (product) {
                setSelectedProduct(product);
                setIsModalOpen(true);
            } else {
                toast.error('Error al abrir editor de producto');
            }
        } finally {
            setProcessing(false);
        }
    }, []);

    const handleKardex = useCallback((product) => {
        setSelectedProduct(product);
        setIsKardexOpen(true);
    }, []);

    const handlePrintSingleLabel = useCallback((product) => {
        setSelectedProducts([product]);
        setIsLabelModalOpen(true);
    }, []);

    const handleOpenQuickAdjust = useCallback((product) => {
        setSelectedProduct(product);
        setIsQuickStockOpen(true);
    }, []);

    const handleOpenWasteModal = useCallback((product = null) => {
        setWasteModalProduct(product);
        setIsWasteModalOpen(true);
    }, []);

    const handleSaveQuickStockAdjust = async (adjustData) => {
        try {
            setProcessing(true);
            let data = null;
            try {
                const res = await api.post(`/products/${adjustData.productId}/quick-stock-adjust`, adjustData, { timeout: 3500 });
                data = res.data;
            } catch (netErr) {
                console.warn('Quick stock adjust offline fallback:', netErr);
            }

            if (data) {
                const beforeVal = data.stockBefore ?? data.currentStock ?? 0;
                const afterVal = data.stockAfter ?? data.newStock ?? 0;
                toast.success(`Stock actualizado: ${beforeVal} → ${afterVal}`);
                setProducts(prev => prev.map(p => p.id === adjustData.productId ? {
                    ...p,
                    stockQuantity: afterVal
                } : p));
                try {
                    const prod = await db.getById('products', adjustData.productId);
                    if (prod) {
                        await db.put('products', { ...prod, stockQuantity: afterVal });
                    }
                } catch (caughtErr) { console.warn('[Inventory] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
            } else {
                // Offline update in IndexedDB
                const prod = await db.getById('products', adjustData.productId);
                if (prod) {
                    const before = Number(prod.stockQuantity) || 0;
                    const qty = Number(adjustData.quantity) || 0;
                    const after = adjustData.type === 'set'
                        ? qty
                        : (adjustData.type === 'subtract' ? Math.max(0, before - qty) : (before + qty));
                    const updated = { ...prod, stockQuantity: after };
                    await db.put('products', updated);
                    setProducts(prev => prev.map(p => p.id === adjustData.productId ? { ...p, stockQuantity: after } : p));
                    toast.success(`Stock actualizado localmente: ${before} → ${after} [Offline]`);
                }
            }

            setIsQuickStockOpen(false);
            fetchValuation();
        } catch (error) {
            console.error('Error in quick stock adjust:', error);
            const msg = error.response?.data?.error || error.message;
            toast.error('Error al ajustar stock: ' + msg);
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteProduct = (id) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Producto',
            message: '¿Seguro que desea eliminar este producto? Esta acción no se puede deshacer.',
            variant: 'danger',
            confirmText: 'Eliminar Producto',
            action: async () => {
                let deletedOnline = false;
                try {
                    await api.delete(`/products/${id}`, { timeout: 3500 });
                    deletedOnline = true;
                    toast.success('Producto eliminado exitosamente');
                } catch (error) {
                    if (error.response?.status === 409 && error.response?.data?.code === 'ENTITY_HAS_DEPENDENCIES') {
                        setTimeout(() => {
                            setConfirmConfig({
                                isOpen: true,
                                title: 'Inactivar Producto',
                                message: 'Este producto tiene historial de ventas o inventario y no puede borrarse físicamente. ¿Deseas inactivarlo para que no aparezca en el POS?',
                                variant: 'primary',
                                confirmText: 'Inactivar Producto',
                                action: async () => {
                                    try {
                                        await api.put(`/products/${id}`, { status: 'inactive' }, { timeout: 3500 });
                                        toast.success('Producto inactivado correctamente');
                                        fetchProducts(true);
                                        fetchValuation();
                                    } catch (_err) {
                                        try {
                                            const prod = await db.getById('products', id);
                                            if (prod) {
                                                await db.put('products', { ...prod, status: 'inactive' });
                                                setProducts(prev => prev.filter(p => p.id !== id));
                                                toast.success('Producto inactivado localmente [Offline]');
                                            }
                                        } catch (caughtErr) { console.warn('[Inventory] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
                                    }
                                }
                            });
                        }, 300);
                        return;
                    }
                    console.warn('Online delete failed, falling back to local deletion:', error);
                }

                if (!deletedOnline) {
                    try {
                        await db.delete('products', id);
                    } catch (caughtErr) { console.warn('[Inventory] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
                    setProducts(prev => prev.filter(p => p.id !== id));
                    toast.success('Producto eliminado localmente [Offline]');
                } else {
                    try {
                        await db.delete('products', id);
                    } catch (caughtErr) { console.warn('[Inventory] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
                    fetchProducts(true);
                }
                fetchValuation();
            }
        });
    };

    const handleSaveProduct = async (productData) => {
        try {
            setProcessing(true);
            const isOfflineMode = localStorage.getItem('isaac_pos_is_offline_mode') === 'true';
            let savedOnline = false;
            let onlineProduct = null;

            if (!isOfflineMode) {
                try {
                    if (selectedProduct && selectedProduct.id) {
                        const { data } = await api.put(`/products/${selectedProduct.id}`, productData, { timeout: 4000 });
                        onlineProduct = data?.product || data;
                        savedOnline = true;
                        toast.success('Producto actualizado exitosamente');
                    } else {
                        const { data } = await api.post('/products', productData, { timeout: 4000 });
                        onlineProduct = data?.product || data;
                        savedOnline = true;
                        toast.success('Producto creado exitosamente');
                    }
                } catch (netErr) {
                    if (netErr.response && netErr.response.status >= 400 && netErr.response.status < 500) {
                        const errorMsg = netErr.response?.data?.error || netErr.response?.data?.message || 'Error al validar el producto';
                        toast.error(errorMsg);
                        setProcessing(false);
                        return;
                    }
                    console.warn('Could not save product online, saving locally in offline mode:', netErr);
                }
            }

            if (!savedOnline) {
                const targetId = (selectedProduct && selectedProduct.id) ? selectedProduct.id : `offline_${Date.now()}`;
                const localProd = {
                    ...(selectedProduct || {}),
                    ...productData,
                    id: targetId,
                    updated_at: new Date().toISOString(),
                    isOfflineModified: true
                };

                // 1. Save in primary IndexedDB
                try {
                    await db.put('products', localProd);
                } catch (dbErr) {
                    console.error('Error saving to db.products:', dbErr);
                }

                // 2. Queue for background sync
                try {
                    await db.put('syncQueue', {
                        endpoint: selectedProduct?.id ? `/products/${selectedProduct.id}` : '/products',
                        method: selectedProduct?.id ? 'PUT' : 'POST',
                        payload: productData,
                        ...(!selectedProduct?.id ? { tempLocalId: targetId } : {}),
                        timestamp: Date.now()
                    });
                } catch (queueErr) {
                    console.warn('Could not enqueue in syncQueue:', queueErr);
                }

                // 3. Update local state optimistically
                setProducts(prev => {
                    const exists = prev.some(p => p.id === targetId);
                    if (exists) {
                        return prev.map(p => p.id === targetId ? { ...p, ...localProd } : p);
                    } else {
                        return [localProd, ...prev];
                    }
                });

                toast.success('Producto guardado localmente [Offline]');
            } else if (onlineProduct) {
                try {
                    await db.put('products', onlineProduct);
                } catch (caughtErr) { console.warn('[Inventory] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
                fetchProducts(true);
            }

            fetchValuation();
            setIsModalOpen(false);
        } catch (error) {
            console.error('Error saving product', error);
            const msg = error.response?.data?.details || error.response?.data?.error || error.message || 'Error desconocido';
            toast.error(`Error al guardar producto: ${msg}`);
        } finally {
            setProcessing(false);
        }
    };

    const handleGenerateIAImage = async (product) => {
        try {
            setGeneratingIAId(product.id);
            toast.loading('Buscando imagen en catálogo web...', { id: 'ia-gen' });

            const { data } = await api.post(`/products/${product.id}/generate-image`);
            toast.success('¡Imagen asignada exitosamente!', { id: 'ia-gen' });

            setProducts(prev => prev.map(p =>
                p.id === product.id ? { ...p, imageUri: data.imageUri, imageUrl: null } : p
            ));
        } catch (error) {
            console.error('Error fetching image:', error);
            const msg = error.response?.data?.error || 'No se pudo obtener imagen';
            toast.error('No se pudo obtener imagen: ' + msg, { id: 'ia-gen' });
        } finally {
            setGeneratingIAId(null);
        }
    };

    const handleExportExcel = async () => {
        try {
            setLoading(true);
            const res = await api.get('/products/export/excel', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `inventario_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            toast.success('Inventario exportado a Excel con éxito');
        } catch (error) {
            console.error('Error exporting excel:', error);
            toast.error('Error al exportar inventario a Excel');
        } finally {
            setLoading(false);
        }
    };

    const handleImportExcel = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setConfirmConfig({
            isOpen: true,
            title: 'Importar Inventario',
            message: 'Esto actualizará o creará productos según el archivo Excel. ¿Desea continuar?',
            variant: 'primary',
            confirmText: 'Importar Excel',
            action: async () => {
                try {
                    setProcessing(true);
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        try {
                            const base64 = event.target.result.split(',')[1];
                            await api.post('/products/import/excel', { base64 });
                            toast.success('Inventario actualizado exitosamente');
                            fetchProducts(true);
                            fetchValuation();
                        } catch (error) {
                            console.error('Error importing excel:', error);
                            const msg = error.response?.data?.error || error.message;
                            toast.error('Error al importar Excel: ' + msg);
                        } finally {
                            setProcessing(false);
                            e.target.value = '';
                        }
                    };
                    reader.readAsDataURL(file);
                } catch (error) {
                    console.error('File reading error:', error);
                    setProcessing(false);
                    e.target.value = '';
                }
            }
        });
    };

    const handleDownloadPdfCatalog = async () => {
        try {
            const loadingToast = toast.loading('Diseñando catálogo PDF profesional...');
            const response = await api.get('/catalog/pdf', {
                responseType: 'arraybuffer',
                timeout: 60000
            });

            const arr = new Uint8Array(response.data);
            const isPdf = arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46;

            if (!isPdf) {
                const text = new TextDecoder().decode(response.data);
                try {
                    const errorData = JSON.parse(text);
                    throw new Error(errorData.error || 'Error del servidor');
                } catch (_e) {
                    throw new Error('El archivo generado no es un PDF válido');
                }
            }

            toast.dismiss(loadingToast);

            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Catalogo_IsaacPOS_${new Date().toISOString().split('T')[0]}.pdf`);
            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                link.remove();
                window.URL.revokeObjectURL(url);
            }, 100);

            toast.success('Catálogo PDF generado con éxito');
        } catch (error) {
            console.error('Error downloading PDF catalog:', error);
            toast.error('Fallo al generar PDF: ' + (error.message || 'Error técnico'));
        }
    };

    const handleBulkSave = async (bulkData) => {
        try {
            setProcessing(true);
            const { data } = await api.post('/products/bulk-edit', bulkData);
            toast.success(`Ajuste masivo completado en ${data.count || 0} productos`);
            fetchProducts(true);
            fetchValuation();
            setIsBulkModalOpen(false);
            setSelectedProducts([]);
        } catch (error) {
            console.error('Error applying bulk changes:', error);
            const msg = error.response?.data?.error || error.message;
            toast.error('Error al aplicar cambios: ' + msg);
        } finally {
            setProcessing(false);
        }
    };

    // Infinite scroll observer
    const sentinelRef = useRef(null);
    useEffect(() => {
        if (!sentinelRef.current || loading || !hasMore) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setPage(prev => prev + 1);
            }
        }, { threshold: 0.1 });
        observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, [loading, hasMore]);

    // Persist view mode preference
    useEffect(() => {
        localStorage.setItem('inventory_view_mode', viewMode);
    }, [viewMode]);

    const _renderFormatMoney = (val, mode = null) => formatMoney(val, mode, settings);

    const showCostCards = canViewCosts && valuation.canViewCosts !== false;
    const isVesOnly = isVesOnlyMode(settings);
    const isSingleCurr = isSingleCurrencyMode(settings);
    const kpiCurrency = isVesOnly ? 'VES' : 'USD';
    const marginPct = Number(valuation.projectedMarginPercent || 0);
    const isNegativeMargin = marginPct < 0;

    return (
        <div className="space-y-6 pb-28 sm:pb-20 pb-safe animate-in fade-in duration-500 responsive-zoom">
            {/* Header Section */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 relative z-10 px-1 sm:px-2">
                <div className="w-full xl:w-auto min-w-[280px]">
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                            Inventario
                        </h1>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <Package size={12} className="text-primary-600 dark:text-primary-400" />
                            Control de Stock & Kardex
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>{valuation.branchName ? `Sucursal: ${valuation.branchName}` : 'Catálogo centralizado de artículos'}</span>
                        <span className="inline-block w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                        <span className="tabular-nums font-mono font-medium text-slate-700 dark:text-slate-300">
                            {valuationLoaded ? valuation.itemCount : '—'} SKUs físicos{valuation.serviceCount > 0 ? ` (+${valuation.serviceCount} serv.)` : ''}
                        </span>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full xl:w-auto">
                    {/* Secondary Tools Button Group */}
                    <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-x divide-slate-200 dark:divide-slate-700 shadow-2xs overflow-hidden w-full sm:w-auto flex-wrap sm:flex-nowrap">
                        {/* Waste and Shrinkage Management Button */}
                        <button
                            onClick={() => handleOpenWasteModal(null)}
                            className="flex-1 sm:flex-initial px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                            title="Registrar mermas, pérdidas justificadas y ver auditoría de stock"
                        >
                            <TrendingDown size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>Mermas</span>
                        </button>

                        {/* Mass Price Update Button */}
                        <button
                            onClick={() => setIsBulkModalOpen(true)}
                            className="flex-1 sm:flex-initial px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                            title="Actualizar precios masivamente por categoría o proveedor"
                        >
                            <Tag size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>Precios</span>
                        </button>

                        {/* Barcode & Shelf Label Printing Button */}
                        <button
                            onClick={() => setIsLabelModalOpen(true)}
                            className="flex-1 sm:flex-initial px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                            title="Generar e imprimir etiquetas térmicas y de góndola"
                        >
                            <Printer size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>Etiquetas</span>
                        </button>

                        {/* Export to Excel */}
                        <button
                            onClick={handleExportExcel}
                            disabled={loading || processing}
                            className="flex-1 sm:flex-initial px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                            title="Exportar inventario en formato Excel"
                        >
                            <Download size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>Exportar</span>
                        </button>

                        {/* Import from Excel */}
                        <label className={`flex-1 sm:flex-initial px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <Upload size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>Importar</span>
                            <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportExcel} disabled={processing} />
                        </label>

                        {/* PDF Catalog */}
                        <button
                            onClick={handleDownloadPdfCatalog}
                            className="w-full sm:w-auto px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                            title="Descargar catálogo en PDF con fotos y precios"
                        >
                            <FileText size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>Catálogo PDF</span>
                        </button>
                    </div>

                    {/* New Product Button - Hero Primary Action */}
                    {canCreateProducts && (
                        <button
                            onClick={handleCreateProduct}
                            className="w-full sm:w-auto shrink-0 px-3.5 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-semibold text-xs shadow-2xs transition-colors flex items-center justify-center gap-1.5"
                        >
                            <Plus size={14} className="stroke-[2.5]" />
                            <span>Nuevo Producto</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Executive Valuation & Stock KPI Grid */}
            <div className={`px-1 sm:px-2 grid grid-cols-2 ${showCostCards ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-3 sm:gap-4`}>
                {/* Total SKUs */}
                <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800 shadow-2xs transition-all">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Catálogo SKUs</span>
                        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                            <Package size={14} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white tracking-tight tabular-nums">
                            {valuationLoaded ? valuation.itemCount : '—'}
                        </span>
                        {valuation.serviceCount > 0 && (
                            <span
                                className="text-[11px] font-medium text-slate-400 dark:text-slate-500 font-mono"
                                title={`${valuation.serviceCount} servicio(s) excluidos del conteo físico y alertas`}
                            >
                                +{valuation.serviceCount} serv.
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1.5 truncate">
                        <Layers size={12} className="text-slate-400 shrink-0" />
                        <span>{categories.length} categorías registradas</span>
                    </div>
                </div>

                {/* Valuation at Cost */}
                {showCostCards && (
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800 shadow-2xs transition-all">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Inversión Costo</span>
                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                                <DollarSign size={14} />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-mono tabular-nums">
                            {valuationLoaded ? formatMoney(valuation.totalValueAtCost || 0, kpiCurrency, settings) : '—'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center justify-between gap-2 truncate">
                            {!isSingleCurr && !isVesOnly ? (
                                <span className="font-mono tabular-nums truncate">
                                    ≈ {((valuation.totalValueAtCost || 0) * (settings.rate || 1)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                                </span>
                            ) : (
                                <span className="truncate">Costo real registrado</span>
                            )}
                            {valuation.missingCostCount > 0 && (
                                <button
                                    type="button"
                                    onClick={handleMissingCostToggle}
                                    className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                        missingCostOnly
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                                    }`}
                                    title={`${valuation.missingCostCount} producto(s) con stock no tienen costo registrado (Retail: ${formatMoney(valuation.missingCostRetailValue || 0, 'USD', settings)}). Haz clic para filtrarlos.`}
                                >
                                    <AlertTriangle size={10} />
                                    <span>{valuation.missingCostCount} sin costo</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Valuation at Retail & Margin */}
                {showCostCards && (
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800 shadow-2xs transition-all">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Retail Proyectado</span>
                            <div className="w-7 h-7 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                <TrendingUp size={14} />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight font-mono tabular-nums">
                            {valuationLoaded ? formatMoney(valuation.totalRetailValue || 0, kpiCurrency, settings) : '—'}
                        </div>
                        <div
                            className={`text-xs font-medium mt-2 flex items-center gap-1.5 truncate ${
                                isNegativeMargin
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                            title={`Ganancia proyectada: ${formatMoney(valuation.projectedMarginProfit || 0, kpiCurrency, settings)} (calculado sobre productos con costo y precio cargados${valuation.zeroPriceCount > 0 ? `; ${valuation.zeroPriceCount} con stock sin precio` : ''})`}
                        >
                            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isNegativeMargin ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                            <span className="truncate">
                                Margen Proyectado: {isNegativeMargin ? '' : '+'}{marginPct}%
                            </span>
                        </div>
                    </div>
                )}

                {/* Stock Alerts (Low & Out) */}
                <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800 shadow-2xs transition-all">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Alertas Stock</span>
                        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                            <AlertCircle size={14} />
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <button
                            type="button"
                            onClick={() => handleKpiStockToggle('low')}
                            className={`text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 tabular-nums rounded px-1 -mx-1 transition-all ${
                                stockFilter === 'low'
                                    ? 'bg-amber-50 dark:bg-amber-950/50 ring-1 ring-amber-300 dark:ring-amber-700'
                                    : 'hover:underline'
                            }`}
                            title={stockFilter === 'low' ? 'Clic para quitar filtro de bajo stock' : 'Filtrar por Bajo Stock'}
                        >
                            {valuationLoaded ? (valuation.lowStockCount || 0) : '—'} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">bajos</span>
                        </button>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <button
                            type="button"
                            onClick={() => handleKpiStockToggle('out')}
                            className={`text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums rounded px-1 -mx-1 transition-all ${
                                stockFilter === 'out'
                                    ? 'bg-rose-50 dark:bg-rose-950/50 ring-1 ring-rose-300 dark:ring-rose-700'
                                    : 'hover:underline'
                            }`}
                            title={stockFilter === 'out' ? 'Clic para quitar filtro de agotados' : 'Filtrar por Agotados'}
                        >
                            {valuationLoaded ? (valuation.outOfStockCount || 0) : '—'} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">agotados</span>
                        </button>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1 truncate">
                        {(stockFilter === 'low' || stockFilter === 'out') ? (
                            <button
                                type="button"
                                onClick={() => setStockFilter('all')}
                                className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 font-medium hover:underline"
                            >
                                <X size={11} />
                                <span>Filtro activo • Clic para limpiar</span>
                            </button>
                        ) : (
                            <span>Selecciona una cifra para filtrar</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Controls & Filters Unified Panel */}
            <div className="px-1 sm:px-2">
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col gap-4">
                    {/* Top Row: Search & View */}
                    <div className="flex flex-col md:flex-row gap-3 items-center w-full">
                        <div className="relative flex-1 group w-full">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-primary-500 transition-colors pointer-events-none" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar por nombre, código de barras, categoría o principio activo..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg sm:rounded-xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-950 focus:border-primary-500 outline-none transition-all font-medium text-sm min-h-[42px]"
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                >
                                    <X size={15} />
                                </button>
                            )}
                        </div>

                        <div className="flex bg-slate-100 dark:bg-slate-950/60 p-1 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-800 shrink-0">
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded-md sm:rounded-lg transition-all ${
                                    viewMode === 'list'
                                        ? 'inv-toggle-active bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                                        : 'inv-toggle-inactive text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                                }`}
                                title="Vista de Tabla"
                            >
                                <ListIcon size={18} />
                            </button>
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded-md sm:rounded-lg transition-all ${
                                    viewMode === 'grid'
                                        ? 'inv-toggle-active bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                                        : 'inv-toggle-inactive text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                                }`}
                                title="Vista de Cuadrícula"
                            >
                                <LayoutGrid size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Pharmacy Quick Filters Bar */}
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1.5">
                            <Pill size={13} className="text-slate-400 shrink-0" /> Modo Farmacia:
                        </span>
                        <button
                            onClick={() => setPharmacyFilter(prev => prev === 'controlled' ? 'all' : 'controlled')}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border ${
                                pharmacyFilter === 'controlled'
                                    ? 'bg-amber-500 text-white border-amber-600 shadow-2xs'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                            }`}
                        >
                            <AlertTriangle size={12} className={pharmacyFilter === 'controlled' ? 'text-white' : 'text-amber-500'} />
                            <span>Psicotrópicos / Récipe</span>
                        </button>
                        <button
                            onClick={() => setPharmacyFilter(prev => prev === 'expiring' ? 'all' : 'expiring')}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border ${
                                pharmacyFilter === 'expiring'
                                    ? 'bg-rose-600 text-white border-rose-700 shadow-2xs'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                            }`}
                        >
                            <Clock size={12} className={pharmacyFilter === 'expiring' ? 'text-white' : 'text-rose-500'} />
                            <span>Próximos a Vencer (&lt; 60 días)</span>
                        </button>
                        {pharmacyFilter !== 'all' && (
                            <button
                                onClick={() => setPharmacyFilter('all')}
                                className="px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors ml-1 inline-flex items-center gap-1"
                            >
                                <X size={12} />
                                <span>Quitar filtro</span>
                            </button>
                        )}
                        {missingCostOnly && (
                            <button
                                type="button"
                                onClick={() => setMissingCostOnly(false)}
                                className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500 text-white border border-amber-600 shadow-2xs inline-flex items-center gap-1.5 ml-auto"
                                title="Clic para mostrar todos los productos"
                            >
                                <AlertTriangle size={12} />
                                <span>Mostrando solo sin costo</span>
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {/* Bottom Row: Advanced Filters */}
                    {showFilters && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Proveedor</label>
                                <select
                                    value={supplierFilter}
                                    onChange={(e) => setSupplierFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 text-xs font-medium focus:bg-white dark:focus:bg-slate-950 focus:border-primary-500 outline-none transition-all min-h-[38px]"
                                >
                                    <option value="" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Todos los proveedores</option>
                                    {suppliers.map(sup => <option key={sup.id} value={sup.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{sup.name}</option>)}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Categoría</label>
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 text-xs font-medium focus:bg-white dark:focus:bg-slate-950 focus:border-primary-500 outline-none transition-all min-h-[38px]"
                                >
                                    <option value="" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Todas las categorías</option>
                                    {categories.map(cat => <option key={cat} value={cat} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">{cat}</option>)}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Stock</label>
                                <div className="flex bg-slate-100 dark:bg-slate-950/60 rounded-lg border border-slate-200 dark:border-slate-800 p-1 min-h-[38px]">
                                    {[
                                        { id: 'all', label: 'Todos' },
                                        { id: 'low', label: 'Bajo' },
                                        { id: 'out', label: 'Agotado' }
                                    ].map(opt => (
                                        <button
                                            key={opt.id}
                                            onClick={() => setStockFilter(opt.id)}
                                            className={`flex-1 py-1 text-xs font-semibold rounded-md transition-all ${
                                                stockFilter === opt.id
                                                    ? 'inv-toggle-active bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                                                    : 'inv-toggle-inactive text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Rango de Precio ($)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        placeholder="Mín"
                                        value={priceRange.min}
                                        onChange={(e) => setPriceRange(prev => ({ ...prev, min: e.target.value }))}
                                        className="w-1/2 px-2.5 py-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white text-xs font-medium focus:bg-white dark:focus:bg-slate-950 focus:border-primary-500 outline-none min-h-[38px]"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Máx"
                                        value={priceRange.max}
                                        onChange={(e) => setPriceRange(prev => ({ ...prev, max: e.target.value }))}
                                        className="w-1/2 px-2.5 py-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white text-xs font-medium focus:bg-white dark:focus:bg-slate-950 focus:border-primary-500 outline-none min-h-[38px]"
                                    />
                                </div>
                            </div>

                            <div className="flex items-end">
                                <button
                                    onClick={() => {
                                        setSearchTerm('');
                                        setSupplierFilter('');
                                        setCategoryFilter('');
                                        setStockFilter('all');
                                        setMissingCostOnly(false);
                                        setPharmacyFilter('all');
                                        setPriceRange({ min: '', max: '' });
                                    }}
                                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-semibold text-xs border border-slate-200 dark:border-slate-700 transition-all min-h-[38px] flex items-center justify-center gap-1.5"
                                >
                                    <RotateCcw size={13} />
                                    <span>Limpiar Filtros</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Product List / Grid */}
            <div ref={tableSectionRef} className="px-1 sm:px-2">
                {viewMode === 'list' ? (
                    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto custom-scrollbar">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-950/60">
                                        <th className="px-4 py-3.5 w-10">
                                            <input
                                                type="checkbox"
                                                checked={selectedProducts.length > 0 && selectedProducts.length === products.length}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedProducts([...products]);
                                                    } else {
                                                        setSelectedProducts([]);
                                                    }
                                                }}
                                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-primary-600 focus:ring-primary-500 cursor-pointer"
                                            />
                                        </th>
                                        <th className="px-4 py-3.5">Producto</th>
                                        <th className="hidden lg:table-cell px-6 py-3.5">Categoría</th>
                                        <th className="hidden xl:table-cell px-6 py-3.5">Proveedor</th>
                                        <th className="px-4 py-3.5 text-center">Stock (Ajuste 1-Click)</th>
                                        <th className="px-4 py-3.5 text-right">Precio</th>
                                        <th className="px-6 py-3.5 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {loading && products.length === 0 ? (
                                        <tr>
                                            <td colSpan="7" className="py-24 text-center">
                                                <div className="inline-flex items-center gap-3 text-primary-500 font-black text-xs uppercase tracking-widest animate-pulse">
                                                    <div className="w-2.5 h-2.5 bg-primary-500 rounded-full animate-ping"></div>
                                                    Indexando Catálogo de Inventario...
                                                </div>
                                            </td>
                                        </tr>
                                    ) : products.length === 0 ? (
                                        <tr>
                                            <td colSpan="7" className="py-24 text-center">
                                                <Package size={48} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
                                                <h3 className="text-slate-700 dark:text-white font-black uppercase tracking-wider text-sm mb-1">No se encontraron productos</h3>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Intente modificando los filtros de búsqueda</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        products.map((product) => (
                                            <ProductRow
                                                key={product.id}
                                                product={product}
                                                user={user}
                                                isSelected={selectedProducts.some(p => p.id === product.id)}
                                                onToggleSelect={handleToggleSelect}
                                                onEdit={handleEditProduct}
                                                onDelete={handleDeleteProduct}
                                                onKardex={handleKardex}
                                                onQuickAdjust={handleOpenQuickAdjust}
                                                onGenerateIA={handleGenerateIAImage}
                                                onPrintLabel={handlePrintSingleLabel}
                                                isGeneratingIA={generatingIAId === product.id}
                                                renderFormatMoney={stableRenderFormatMoney}
                                                formatStock={stableFormatStock}
                                                getImageUrl={stableGetImageUrl}
                                                currencyMode={settings.currencyMode}
                                            />
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Card List View */}
                        <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5 p-2 space-y-2.5">
                            {loading && products.length === 0 ? (
                                <div className="py-20 text-center">
                                    <div className="inline-flex items-center gap-2.5 text-primary-500 font-black text-xs uppercase tracking-widest animate-pulse">
                                        <div className="w-2 h-2 bg-primary-500 rounded-full animate-ping"></div>
                                        Indexando Inventario...
                                    </div>
                                </div>
                            ) : products.length === 0 ? (
                                <div className="py-16 text-center">
                                    <Package size={40} className="text-slate-400 dark:text-slate-600 mx-auto mb-2" />
                                    <p className="text-xs font-black uppercase text-slate-700 dark:text-white">Sin productos</p>
                                </div>
                            ) : (
                                products.map((product) => (
                                    <MobileProductCard
                                        key={product.id}
                                        product={product}
                                        user={user}
                                        isSelected={selectedProducts.some(p => p.id === product.id)}
                                        onToggleSelect={handleToggleSelect}
                                        onEdit={handleEditProduct}
                                        onDelete={handleDeleteProduct}
                                        onKardex={handleKardex}
                                        onQuickAdjust={handleOpenQuickAdjust}
                                        onGenerateIA={handleGenerateIAImage}
                                        onPrintLabel={handlePrintSingleLabel}
                                        isGeneratingIA={generatingIAId === product.id}
                                        renderFormatMoney={stableRenderFormatMoney}
                                        formatStock={stableFormatStock}
                                        getImageUrl={stableGetImageUrl}
                                        currencyMode={settings.currencyMode}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
                        {products.map((product) => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                user={user}
                                isSelected={selectedProducts.some(p => p.id === product.id)}
                                onToggleSelect={handleToggleSelect}
                                onEdit={handleEditProduct}
                                onQuickAdjust={handleOpenQuickAdjust}
                                onGenerateIA={handleGenerateIAImage}
                                onPrintLabel={handlePrintSingleLabel}
                                isGeneratingIA={generatingIAId === product.id}
                                renderFormatMoney={stableRenderFormatMoney}
                                formatStock={stableFormatStock}
                                getImageUrl={stableGetImageUrl}
                                currencyMode={settings.currencyMode}
                            />
                        ))}
                    </div>
                )}

                {/* Infinite Scroll Sentinel */}
                <div ref={sentinelRef} className="py-6 flex items-center justify-center">
                    {hasMore && loading && (
                        <div className="flex items-center gap-2 text-primary-500 font-black text-xs uppercase tracking-widest">
                            <Loader2 size={16} className="animate-spin" /> Cargando más productos...
                        </div>
                    )}
                </div>

                {/* Floating Selection Action Bar for Mobile & Desktop */}
                {selectedProducts.length > 0 && (
                    <div className="fixed bottom-6 left-4 right-4 sm:left-auto sm:right-6 bg-slate-900/95 backdrop-blur-xl border border-white/20 p-3 rounded-2xl shadow-2xl z-[150] flex items-center justify-between gap-3 animate-in slide-in-from-bottom duration-300">
                        <div className="flex items-center gap-2 pl-2">
                            <span className="w-6 h-6 rounded-full bg-primary-500 text-white font-black text-xs flex items-center justify-center">
                                {selectedProducts.length}
                            </span>
                            <span className="text-xs font-black text-white uppercase tracking-wider hidden sm:inline">
                                {selectedProducts.length === 1 ? selectedProducts[0].name : 'Seleccionados'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedProducts.length === 1 && (
                                <button
                                    onClick={() => handleEditProduct(selectedProducts[0])}
                                    className="px-3 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
                                >
                                    <Edit2 size={14} /> Editar
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (selectedProducts.length === 1) {
                                        handleOpenQuickAdjust(selectedProducts[0]);
                                    } else {
                                        setIsBulkModalOpen(true);
                                    }
                                }}
                                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-1.5 border border-white/10 cursor-pointer"
                            >
                                <RefreshCw size={14} /> {selectedProducts.length === 1 ? 'Stock' : 'Precios'}
                            </button>
                            <button
                                onClick={() => setSelectedProducts([])}
                                className="p-2 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
                                title="Deseleccionar"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <Suspense fallback={null}>
                    <ProductModal
                        isOpen={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                        onSave={handleSaveProduct}
                        product={selectedProduct}
                        categories={categories}
                        suppliers={suppliers}
                        branches={branches}
                    />
                </Suspense>
            )}

            <QuickStockAdjustModal
                isOpen={isQuickStockOpen}
                onClose={() => setIsQuickStockOpen(false)}
                product={selectedProduct}
                onSave={handleSaveQuickStockAdjust}
                processing={processing}
                onOpenWasteModule={handleOpenWasteModal}
            />

            <WasteManagementModal
                isOpen={isWasteModalOpen}
                onClose={() => {
                    setIsWasteModalOpen(false);
                    setWasteModalProduct(null);
                }}
                products={products}
                initialProduct={wasteModalProduct}
                onProductUpdated={(updatedProd) => {
                    setProducts(prev => prev.map(p => p.id === updatedProd.id ? { ...p, ...updatedProd } : p));
                    fetchValuation();
                }}
                user={user}
                settings={settings}
            />

            <KardexModal
                isOpen={isKardexOpen}
                onClose={() => setIsKardexOpen(false)}
                product={selectedProduct}
            />

            <LabelModal
                isOpen={isLabelModalOpen}
                onClose={() => setIsLabelModalOpen(false)}
                products={selectedProducts.length > 0 ? selectedProducts : products.slice(0, 30)}
                exchangeRate={settings.rate}
            />

            <BulkEditModal
                isOpen={isBulkModalOpen}
                onClose={() => setIsBulkModalOpen(false)}
                onSave={handleBulkSave}
                selectedCount={selectedProducts.length}
                products={selectedProducts}
                categories={categories}
                suppliers={suppliers}
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

export default function Inventory() {
    return <InventoryList />;
}
