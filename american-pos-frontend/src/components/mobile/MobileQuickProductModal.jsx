import { useState, useRef } from 'react';
import {
  X, 
  Camera, 
  RefreshCw, 
  Search, 
  ScanBarcode, 
  Package, 
  Sliders, 
  ShieldAlert, 
  Layers, 
  Calendar, 
  Scale
} from 'lucide-react';
import CachedImage from '../CachedImage';

/**
 * Modal táctil completo de Creación / Edición de Producto para POS Móvil.
 * Incluye pestañas organizadas:
 *  1. General (Precios, Costos, Stock, Código, Foto, IVA)
 *  2. Mayorista (Venta por Empaque / Caja y Media Caja)
 *  3. Avanzado (Balanza, Stock Mínimo, Lotes, Vencimiento y Control Farmacéutico)
 */
export default function MobileQuickProductModal({
  isOpen,
  onClose,
  T,
  isLight,
  productFormData,
  setProductFormData,
  handleSaveProduct,
  isSavingProduct,
  isUploadingImage,
  handleProductImageUpload,
  onOpenImageSearch,
  generateInternalEanBarcode = () => {},
  setScannerTarget = () => {},
  setIsScannerOpen = () => {},
  isCustomCategoryMode = false,
  setIsCustomCategoryMode = () => {},
  selectableCategories = ['General'],
  exchangeRate = 1,
  triggerHaptic = () => {},
  canViewCosts = true
}) {
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'bulk' | 'advanced'
  const imageFileInputRef = useRef(null);

  if (!isOpen) return null;

  const hasBulkConfig = Boolean(Number(productFormData.unitsPerBulk) > 1 || Number(productFormData.bulkPrice) > 0);
  const hasAdvancedConfig = Boolean(
    productFormData.isSoldByWeight || 
    productFormData.batchNumber || 
    productFormData.expirationDate || 
    productFormData.es_controlado ||
    productFormData.principio_activo
  );

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
      <div className={`w-full max-w-md sm:max-w-lg ${T.modalCard} rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col max-h-[94dvh] overflow-hidden`}>
        
        {/* Cabecera del Modal */}
        <div className={`flex items-center justify-between border-b ${T.border} pb-2.5 shrink-0`}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${productFormData.isNew ? 'bg-emerald-500' : 'bg-blue-500'}`} />
            <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary}`}>
              {productFormData.isNew ? 'Nuevo producto' : 'Editar producto'}
            </h3>
          </div>
          <button 
            type="button"
            onClick={() => onClose()}
            className={`${T.textMuted} hover:opacity-100 p-2 rounded-lg cursor-pointer active:scale-90 transition-transform`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Barra de Pestañas Táctiles (Tabs) */}
        <div className={`flex items-center gap-1.5 p-1 rounded-xl my-3 shrink-0 ${isLight ? 'bg-slate-100' : 'bg-[#0b0e14]'}`}>
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setActiveTab('general');
            }}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'general'
                ? (isLight ? 'bg-white text-blue-700 shadow-2xs' : 'bg-blue-600 text-white shadow-2xs')
                : (isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200')
            }`}
          >
            <Layers size={13} />
            <span>General</span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setActiveTab('bulk');
            }}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 relative ${
              activeTab === 'bulk'
                ? (isLight ? 'bg-white text-amber-700 shadow-2xs' : 'bg-amber-600 text-white shadow-2xs')
                : (isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200')
            }`}
          >
            <Package size={13} />
            <span>Mayor / Cajas</span>
            {hasBulkConfig && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setActiveTab('advanced');
            }}
            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 relative ${
              activeTab === 'advanced'
                ? (isLight ? 'bg-white text-indigo-700 shadow-2xs' : 'bg-indigo-600 text-white shadow-2xs')
                : (isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-slate-200')
            }`}
          >
            <Sliders size={13} />
            <span>Avanzado</span>
            {hasAdvancedConfig && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
            )}
          </button>
        </div>

        {/* Cuerpo del Formulario con scroll independiente */}
        <form onSubmit={handleSaveProduct} className="flex-1 overflow-y-auto custom-scrollbar pr-0.5 space-y-3.5">
          
          {/* ======================================================== */}
          {/* TAB 1: INFORMACIÓN GENERAL Y ESENCIAL                     */}
          {/* ======================================================== */}
          {activeTab === 'general' && (
            <div className="space-y-3">
              {/* Foto del Producto */}
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div 
                    onClick={() => !isUploadingImage && imageFileInputRef.current?.click()}
                    className={`w-14 h-14 rounded-xl border overflow-hidden flex flex-col items-center justify-center relative cursor-pointer transition-colors ${
                      isLight 
                        ? 'bg-slate-50 border-slate-300 text-slate-400 hover:border-slate-400' 
                        : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'
                    }`}
                    title="Toca para subir foto"
                  >
                    {productFormData.imageUri ? (
                      <CachedImage 
                        src={productFormData.imageUri} 
                        alt="Producto" 
                        className="w-full h-full object-contain p-1 bg-white"
                      />
                    ) : (
                      <Camera size={18} />
                    )}
                    {isUploadingImage && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <RefreshCw size={14} className="animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  {productFormData.imageUri && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setProductFormData(p => ({ ...p, imageUri: '' }));
                      }}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 text-white border border-white dark:border-slate-900 flex items-center justify-center shadow-xs cursor-pointer"
                      title="Quitar foto"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] font-semibold ${T.textSecondary} block mb-1.5`}>
                    Imagen del producto
                  </span>
                  <input 
                    type="file" 
                    ref={imageFileInputRef}
                    accept="image/*"
                    capture="environment"
                    onChange={handleProductImageUpload}
                    className="hidden" 
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => imageFileInputRef.current?.click()}
                      disabled={isUploadingImage}
                      className={`h-8.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-colors whitespace-nowrap ${
                        isLight
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                    >
                      <Camera size={13} className="text-slate-500 shrink-0" />
                      <span>{productFormData.imageUri ? 'Subir otra' : 'Subir foto'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        onOpenImageSearch();
                      }}
                      className={`h-8.5 px-2 rounded-lg text-[11px] font-semibold border flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-colors whitespace-nowrap ${
                        isLight
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                    >
                      <Search size={13} className="text-slate-500 shrink-0" />
                      <span>Catálogo</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Nombre del Producto */}
              <div>
                <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Nombre del producto *</label>
                <input 
                  type="text" 
                  required
                  value={productFormData.name}
                  onChange={(e) => setProductFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ej: Harina PAN 1kg"
                  className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-3 text-xs font-semibold outline-none`}
                />
              </div>

              {/* Código de Barras y Categoría */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={`text-[11px] font-semibold ${T.textSecondary}`}>Código</label>
                    <button
                      type="button"
                      onClick={generateInternalEanBarcode}
                      className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Generar
                    </button>
                  </div>
                  <div className="relative flex items-center">
                    <input 
                      type="text" 
                      value={productFormData.barcode}
                      onChange={(e) => setProductFormData(p => ({ ...p, barcode: e.target.value }))}
                      placeholder="Código de barras"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-2.5 pr-8 text-xs font-mono font-semibold outline-none`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        setScannerTarget('product_barcode');
                        setIsScannerOpen(true);
                      }}
                      title="Escanear código"
                      className={`absolute right-1.5 p-1.5 rounded-md ${T.textMuted} hover:opacity-100 cursor-pointer flex items-center justify-center`}
                    >
                      <ScanBarcode size={15} />
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={`text-[11px] font-semibold ${T.textSecondary}`}>Categoría</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomCategoryMode(prev => {
                          const next = !prev;
                          if (!next && !productFormData.category.trim()) {
                            setProductFormData(p => ({ ...p, category: 'General' }));
                          }
                          return next;
                        });
                      }}
                      className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {isCustomCategoryMode ? 'Ver lista' : '+ Nueva'}
                    </button>
                  </div>
                  {isCustomCategoryMode ? (
                    <input 
                      type="text" 
                      value={productFormData.category}
                      onChange={(e) => setProductFormData(p => ({ ...p, category: e.target.value }))}
                      placeholder="Escribir categoría..."
                      autoFocus
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-2.5 text-xs font-semibold outline-none`}
                    />
                  ) : (
                    <select
                      value={productFormData.category || 'General'}
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsCustomCategoryMode(true);
                          setProductFormData(p => ({ ...p, category: '' }));
                        } else {
                          setProductFormData(p => ({ ...p, category: e.target.value }));
                        }
                      }}
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-2.5 text-xs font-semibold outline-none cursor-pointer`}
                    >
                      {selectableCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="__NEW__">+ Crear nueva categoría...</option>
                    </select>
                  )}
                </div>
              </div>

              {/* Costo USD y Margen de Ganancia (%) - Solo usuarios con permiso canViewCosts */}
              {canViewCosts && (
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Costo ($)</label>
                  <div className="relative">
                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold ${T.textMuted}`}>$</span>
                    <input 
                      type="number" 
                      step="0.01" 
                      value={productFormData.costUSD}
                      onChange={(e) => {
                        const val = e.target.value;
                        const costNum = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const marginNum = parseFloat(p.margin);
                          const currentPrice = parseFloat(p.priceUSD) || 0;
                          if (costNum > 0 && !isNaN(marginNum) && String(p.margin).trim() !== '') {
                            const nextUsd = (costNum * (1 + marginNum / 100)).toFixed(2);
                            const nextBs = (parseFloat(nextUsd) * exchangeRate).toFixed(2);
                            return { ...p, costUSD: val, priceUSD: nextUsd, priceBS: nextBs };
                          }
                          if (costNum > 0 && currentPrice > 0) {
                            const nextMargin = (((currentPrice - costNum) / costNum) * 100).toFixed(1).replace(/\.0$/, '');
                            return { ...p, costUSD: val, margin: nextMargin };
                          }
                          return { ...p, costUSD: val };
                        });
                      }}
                      placeholder="0.00"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-6 pr-2.5 text-xs font-semibold outline-none`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Margen ganancia (%)</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.1" 
                      value={productFormData.margin ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const marginNum = parseFloat(val);
                        setProductFormData(p => {
                          const costNum = parseFloat(p.costUSD) || 0;
                          if (costNum > 0 && !isNaN(marginNum)) {
                            const nextUsd = (costNum * (1 + marginNum / 100)).toFixed(2);
                            const nextBs = (parseFloat(nextUsd) * exchangeRate).toFixed(2);
                            return { ...p, margin: val, priceUSD: nextUsd, priceBS: nextBs };
                          }
                          return { ...p, margin: val };
                        });
                      }}
                      placeholder="30"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-3 pr-6 text-xs font-semibold outline-none`}
                    />
                    <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold ${T.textMuted}`}>%</span>
                  </div>
                </div>
              </div>
              )}

              {/* Precios: USD y Bs */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>
                    Precio venta ($) *
                  </label>
                  <div className="relative">
                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold ${T.textMuted}`}>$</span>
                    <input 
                      type="number" 
                      step="0.01" 
                      required
                      value={productFormData.priceUSD}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const costNum = parseFloat(p.costUSD) || 0;
                          const nextMargin = (costNum > 0 && num > 0)
                            ? (((num - costNum) / costNum) * 100).toFixed(1).replace(/\.0$/, '')
                            : p.margin;
                          return {
                            ...p,
                            priceUSD: val,
                            priceBS: num > 0 ? (num * exchangeRate).toFixed(2) : '',
                            margin: nextMargin
                          };
                        });
                      }}
                      placeholder="0.00"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-6 pr-2.5 text-xs font-bold outline-none`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>
                    Precio venta (Bs)
                  </label>
                  <div className="relative">
                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold ${T.textMuted}`}>Bs</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={productFormData.priceBS}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const nextUsdNum = num > 0 && exchangeRate > 0 ? (num / exchangeRate) : 0;
                          const costNum = parseFloat(p.costUSD) || 0;
                          const nextMargin = (costNum > 0 && nextUsdNum > 0)
                            ? (((nextUsdNum - costNum) / costNum) * 100).toFixed(1).replace(/\.0$/, '')
                            : p.margin;
                          return {
                            ...p,
                            priceBS: val,
                            priceUSD: nextUsdNum > 0 ? nextUsdNum.toFixed(2) : '',
                            margin: nextMargin
                          };
                        });
                      }}
                      placeholder="0.00"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-7 pr-2.5 text-xs font-bold outline-none`}
                    />
                  </div>
                </div>
              </div>

              {/* Stock Disponible y Botones de Ajuste Rápido */}
              <div className="grid grid-cols-2 gap-2.5 items-end">
                <div>
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Stock disponible</label>
                  <input 
                    type="number" 
                    step="any" 
                    value={productFormData.stock}
                    onChange={(e) => setProductFormData(p => ({ ...p, stock: e.target.value }))}
                    placeholder="0"
                    className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-3 text-xs font-bold outline-none`}
                  />
                </div>
                <div>
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Ajustar stock</label>
                  <div className="grid grid-cols-4 gap-1 h-9.5">
                    {[-10, -1, 1, 10].map(delta => (
                      <button
                        type="button"
                        key={delta}
                        onClick={() => {
                          const cur = parseFloat(productFormData.stock) || 0;
                          setProductFormData(p => ({ ...p, stock: String(Math.max(0, Number((cur + delta).toFixed(3)))) }));
                        }}
                        className={`h-full rounded-lg text-[11px] font-semibold border ${T.btnGhost} flex items-center justify-center cursor-pointer active:scale-95`}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Impuesto / IVA (Selector segmentado sobrio) */}
              <div className="flex items-center justify-between pt-1">
                <span className={`text-xs font-semibold ${T.textSecondary}`}>Impuesto (IVA)</span>
                <div className={`inline-flex p-0.5 rounded-lg border ${isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'}`}>
                  <button
                    type="button"
                    onClick={() => setProductFormData(p => ({ ...p, taxStatus: 'gravable' }))}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                      productFormData.taxStatus === 'gravable'
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'bg-slate-800 text-white'
                        : T.textMuted
                    }`}
                  >
                    Gravable ({(() => {
                      try {
                        const saved = JSON.parse(localStorage.getItem('pos_business_info') || '{}');
                        const rate = Number(saved?.taxConfig?.ivaRate ?? saved?.ivaRate);
                        return Number.isFinite(rate) && rate >= 0 ? `${rate}%` : 'Impuesto';
                      } catch {
                        return 'Impuesto';
                      }
                    })()})
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductFormData(p => ({ ...p, taxStatus: 'exento' }))}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                      productFormData.taxStatus === 'exento'
                        ? isLight
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'bg-slate-800 text-white'
                        : T.textMuted
                    }`}
                  >
                    Exento
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: VENTA AL MAYOR (EMPAQUES, CAJAS, MEDIA CAJA)      */}
          {/* ======================================================== */}
          {activeTab === 'bulk' && (
            <div className="space-y-3.5">
              <div className={`p-3 rounded-xl border ${isLight ? 'bg-amber-50/50 border-amber-200/80' : 'bg-amber-950/20 border-amber-900/40'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Package size={15} className="text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Venta por Caja / Bulto / Display Completo
                  </span>
                </div>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/70 mb-3">
                  Permite vender el empaque completo descontando automáticamente las unidades del inventario unitario.
                </p>

                <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Nombre empaque</label>
                    <input 
                      type="text" 
                      value={productFormData.bulkUnitName || 'Caja'}
                      onChange={(e) => setProductFormData(p => ({ ...p, bulkUnitName: e.target.value }))}
                      placeholder="Ej: Caja, Bulto, Display"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-2.5 text-xs font-semibold outline-none`}
                    />
                  </div>
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Unidades por empaque</label>
                    <input 
                      type="number" 
                      step="1"
                      min="1"
                      value={productFormData.unitsPerBulk || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const unitsNum = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const priceNum = parseFloat(p.priceUSD) || 0;
                          // Si no hay precio de caja o está vacío, sugerir automáticamente precio x unidades
                          const suggestedPrice = (unitsNum > 1 && priceNum > 0 && !p.bulkPrice) 
                            ? (unitsNum * priceNum).toFixed(2) 
                            : p.bulkPrice;
                          return {
                            ...p,
                            unitsPerBulk: val,
                            bulkPrice: suggestedPrice,
                            bulkPriceBs: (suggestedPrice && exchangeRate > 0) ? (parseFloat(suggestedPrice) * exchangeRate).toFixed(2) : p.bulkPriceBs
                          };
                        });
                      }}
                      placeholder="Ej: 12 ó 24"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-2.5 text-xs font-bold outline-none`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Precio empaque ($)</label>
                    <div className="relative">
                      <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold ${T.textMuted}`}>$</span>
                      <input 
                        type="number" 
                        step="0.01"
                        value={productFormData.bulkPrice || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const num = parseFloat(val) || 0;
                          setProductFormData(p => ({
                            ...p,
                            bulkPrice: val,
                            bulkPriceBs: num > 0 ? (num * exchangeRate).toFixed(2) : ''
                          }));
                        }}
                        placeholder="0.00"
                        className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-6 pr-2.5 text-xs font-bold outline-none`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Precio empaque (Bs)</label>
                    <div className="relative">
                      <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold ${T.textMuted}`}>Bs</span>
                      <input 
                        type="number" 
                        step="0.1"
                        value={productFormData.bulkPriceBs || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const num = parseFloat(val) || 0;
                          setProductFormData(p => ({
                            ...p,
                            bulkPriceBs: val,
                            bulkPrice: (num > 0 && exchangeRate > 0) ? (num / exchangeRate).toFixed(2) : ''
                          }));
                        }}
                        placeholder="0.00"
                        className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-7 pr-2.5 text-xs font-bold outline-none`}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={`text-[11px] font-semibold ${T.textSecondary}`}>Código de barras del empaque / caja</label>
                    <span className="text-[10px] text-slate-400">Escaneable en mostrador</span>
                  </div>
                  <div className="relative flex items-center">
                    <input 
                      type="text" 
                      value={productFormData.bulkBarcode || ''}
                      onChange={(e) => setProductFormData(p => ({ ...p, bulkBarcode: e.target.value }))}
                      placeholder="Código del fardo o caja"
                      className={`w-full h-9.5 ${T.inputBg} border rounded-lg pl-2.5 pr-8 text-xs font-mono font-semibold outline-none`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        setScannerTarget('product_bulk_barcode');
                        setIsScannerOpen(true);
                      }}
                      title="Escanear código de caja"
                      className={`absolute right-1.5 p-1.5 rounded-md ${T.textMuted} hover:opacity-100 cursor-pointer flex items-center justify-center`}
                    >
                      <ScanBarcode size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Sub-bloque Media Caja */}
              <div className={`p-3 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold">Media Presentación / Media Caja</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={Boolean(productFormData.enableMidBulk)} 
                      onChange={(e) => setProductFormData(p => ({ ...p, enableMidBulk: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all dark:border-slate-600 peer-checked:bg-amber-500"></div>
                  </label>
                </div>

                {productFormData.enableMidBulk && (
                  <div className="space-y-2.5 pt-1 animate-fadeIn">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Nombre</label>
                        <input 
                          type="text" 
                          value={productFormData.midBulkUnitName || 'Media Caja'}
                          onChange={(e) => setProductFormData(p => ({ ...p, midBulkUnitName: e.target.value }))}
                          placeholder="Media Caja"
                          className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-semibold outline-none`}
                        />
                      </div>
                      <div>
                        <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Unidades</label>
                        <input 
                          type="number" 
                          step="1"
                          value={productFormData.unitsPerMidBulk || ''}
                          onChange={(e) => setProductFormData(p => ({ ...p, unitsPerMidBulk: e.target.value }))}
                          placeholder="Ej: 6"
                          className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-bold outline-none`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Precio ($)</label>
                        <div className="relative">
                          <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold ${T.textMuted}`}>$</span>
                          <input 
                            type="number" 
                            step="0.01"
                            value={productFormData.midBulkPrice || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const num = parseFloat(val) || 0;
                              setProductFormData(p => ({
                                ...p,
                                midBulkPrice: val,
                                midBulkPriceBs: num > 0 ? (num * exchangeRate).toFixed(2) : ''
                              }));
                            }}
                            placeholder="0.00"
                            className={`w-full h-9 ${T.inputBg} border rounded-lg pl-6 pr-2.5 text-xs font-bold outline-none`}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Código de barras</label>
                        <input 
                          type="text" 
                          value={productFormData.midBulkBarcode || ''}
                          onChange={(e) => setProductFormData(p => ({ ...p, midBulkBarcode: e.target.value }))}
                          placeholder="Código opcional"
                          className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-mono font-semibold outline-none`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: AVANZADO (BALANZA, STOCK MÍNIMO, FARMACIA Y LOTES) */}
          {/* ======================================================== */}
          {activeTab === 'advanced' && (
            <div className="space-y-3.5">
              {/* Balanza y Unidades de Medida */}
              <div className={`p-3 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'}`}>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Scale size={14} className="text-blue-500" />
                  <span className="text-xs font-bold">Unidad de Medida & Balanza</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Unidad de medida</label>
                    <select
                      value={productFormData.stockUnit || 'und'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProductFormData(p => ({
                          ...p,
                          stockUnit: val,
                          isSoldByWeight: val === 'kg' || val === 'gr' ? true : p.isSoldByWeight
                        }));
                      }}
                      className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-semibold outline-none cursor-pointer`}
                    >
                      <option value="und">Unidades (und)</option>
                      <option value="kg">Kilogramos (kg)</option>
                      <option value="gr">Gramos (gr)</option>
                      <option value="lt">Litros (lt)</option>
                      <option value="tab">Tabletas / Blíster (tab)</option>
                      <option value="mts">Metros (mts)</option>
                    </select>
                  </div>

                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Stock mínimo alerta</label>
                    <input 
                      type="number" 
                      step="any"
                      value={productFormData.minStock ?? '2'}
                      onChange={(e) => setProductFormData(p => ({ ...p, minStock: e.target.value }))}
                      placeholder="2"
                      className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-bold outline-none`}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] font-semibold">¿Vender por peso (Balanza digital)?</span>
                  <input 
                    type="checkbox"
                    checked={Boolean(productFormData.isSoldByWeight)}
                    onChange={(e) => setProductFormData(p => ({ ...p, isSoldByWeight: e.target.checked }))}
                    className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Trazabilidad: Lote y Vencimiento */}
              <div className={`p-3 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/50 border-slate-800'}`}>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Calendar size={14} className="text-emerald-500" />
                  <span className="text-xs font-bold">Lote y Vencimiento</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>N° de Lote</label>
                    <input 
                      type="text" 
                      value={productFormData.batchNumber || ''}
                      onChange={(e) => setProductFormData(p => ({ ...p, batchNumber: e.target.value }))}
                      placeholder="Ej: LOTE-2026A"
                      className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-mono font-semibold outline-none`}
                    />
                  </div>
                  <div>
                    <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Fecha de Vencimiento</label>
                    <input 
                      type="date" 
                      value={productFormData.expirationDate || ''}
                      onChange={(e) => setProductFormData(p => ({ ...p, expirationDate: e.target.value }))}
                      className={`w-full h-9 ${T.inputBg} border rounded-lg px-2 text-xs font-semibold outline-none`}
                    />
                  </div>
                </div>
              </div>

              {/* Farmacia y Control */}
              <div className={`p-3 rounded-xl border ${isLight ? 'bg-indigo-50/50 border-indigo-200/80' : 'bg-indigo-950/20 border-indigo-900/40'}`}>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <ShieldAlert size={14} className="text-indigo-500" />
                  <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                    Farmacia & Medicamentos Controlados
                  </span>
                </div>

                <div className="mb-2.5">
                  <label className={`text-[11px] font-semibold ${T.textSecondary} block mb-1`}>Principio Activo (Genérico)</label>
                  <input 
                    type="text" 
                    value={productFormData.principio_activo || ''}
                    onChange={(e) => setProductFormData(p => ({ ...p, principio_activo: e.target.value }))}
                    placeholder="Ej: Ibuprofeno 400mg, Amoxicilina..."
                    className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs font-semibold outline-none`}
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className="text-[11px] font-bold block text-red-600 dark:text-red-400">
                      ¿Es Medicamento Controlado?
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      Exige récipe y datos del médico en la venta
                    </span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={Boolean(productFormData.es_controlado)}
                    onChange={(e) => setProductFormData(p => ({ ...p, es_controlado: e.target.checked }))}
                    className="w-4 h-4 rounded text-red-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Botón Guardar / Actualizar (Fijo al final de cada pestaña) */}
          <div className="pt-2">
            <button 
              type="submit"
              disabled={isSavingProduct}
              className="w-full h-10.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] disabled:opacity-50 text-white font-bold rounded-xl text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-blue-600/20"
            >
              {isSavingProduct ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <span>{productFormData.isNew ? 'Crear producto' : 'Guardar todos los cambios'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
