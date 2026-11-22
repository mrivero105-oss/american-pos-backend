import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, X, Search, Camera, Box, ShoppingCart, ScanBarcode, Plus, Minus } from 'lucide-react';
import { playSuccessSound } from '../../utils/sounds';
import CachedImage from '../CachedImage';
import { VoiceMicButton } from '../../utils/voiceSearch';

const stripAccents = (str = '') => String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function MobilePriceCheckerModal({
  isOpen,
  onClose,
  T,
  priceCheckerSearch,
  setPriceCheckerSearch,
  onOpenScanner,
  setScannerTarget = () => {},
  setPosMode = () => {},
  isDollarCountry = false,
  triggerHaptic = () => {},
  priceCheckerProduct,
  setPriceCheckerProduct,
  exchangeRate,
  addToCart,
  showToast,
  products
}) {
  const [checkQty, setCheckQty] = useState(1);

  // Al seleccionar o cambiar un producto, restablecemos la cantidad de consulta a 1
  useEffect(() => {
    setCheckQty(1);
  }, [priceCheckerProduct?.id]);

  const searchResults = useMemo(() => {
    const qClean = stripAccents(priceCheckerSearch || '').trim();
    const tokens = qClean ? qClean.split(/\s+/).filter(Boolean) : [];
    if (tokens.length === 0 || !Array.isArray(products)) return [];
    const matched = [];
    for (const p of products) {
      const blob = `${stripAccents(p.name || p.nombre || '')} ${String(p.barcode || p.codigo_barras || '').toLowerCase()} ${String(p.sku || '').toLowerCase()}`;
      if (tokens.every(t => blob.includes(t))) {
        matched.push(p);
        if (matched.length >= 8) break;
      }
    }
    return matched;
  }, [priceCheckerSearch, products]);

  return (
    <AnimatePresence>
      {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 animate-fadeIn">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className={`w-full max-w-md ${T.modalCard} rounded-xl p-4 sm:p-5 shadow-2xl border border-amber-500/40 flex flex-col space-y-3.5 max-h-[94dvh] overflow-y-auto`}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                    <Tag size={18} />
                  </div>
                  <div>
                    <h3 className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>
                      Verificador de Precios & Stock
                    </h3>
                    <p className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Pistola BT & Cámara listos • Consulta sin alterar carrito
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                  }}
                  className="p-1 rounded-full text-slate-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Buscador Rápido y Gatillo de Cámara */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted}`} />
                  <input
                    type="text"
                    value={priceCheckerSearch}
                    onChange={(e) => setPriceCheckerSearch(e.target.value)}
                    placeholder="Escribe o dicta nombre o código..."
                    autoFocus
                    className={`w-full ${T.inputBg} border rounded-xl pl-9 pr-14 py-2.5 text-xs font-bold outline-none focus:border-amber-500`}
                  />
                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    {priceCheckerSearch && (
                      <button
                        type="button"
                        onClick={() => setPriceCheckerSearch('')}
                        className="p-1 text-slate-400"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <VoiceMicButton
                      size={14}
                      prompt="Di el producto para consultar su precio..."
                      onResult={(spokenText) => setPriceCheckerSearch(spokenText)}
                      onError={(errMsg) => showToast?.(`🎤 ${errMsg}`)}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    setScannerTarget('cart');
                    setPosMode('PRICE_CHECKER');
                    onOpenScanner();
                  }}
                  className="px-3 py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/30 text-xs font-black flex items-center gap-1 cursor-pointer active:scale-95"
                  title="Abrir escáner de cámara"
                >
                  <Camera size={14} />
                  <span>Cámara</span>
                </button>
              </div>

              {/* Contenido: Producto Seleccionado O Resultados de Búsqueda O Guía Vacía */}
              {priceCheckerProduct ? (
                <div className="space-y-3 animate-fadeIn">
                  {/* Foto & Info */}
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-20 rounded-2xl bg-slate-900 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                      {priceCheckerProduct.imageUrl || priceCheckerProduct.imageUri || priceCheckerProduct.image ? (
                        <CachedImage
                          src={priceCheckerProduct.imageUrl || priceCheckerProduct.imageUri || priceCheckerProduct.image}
                          alt={priceCheckerProduct.name}
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        <Box size={28} className="text-slate-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-wider block">
                        {priceCheckerProduct.category || 'General'}
                      </span>
                      <h4 className={`text-sm font-black ${T.textPrimary} leading-tight line-clamp-2`}>
                        {priceCheckerProduct.name || priceCheckerProduct.nombre}
                      </h4>
                      {priceCheckerProduct.barcode && (
                        <span className="text-[10px] font-mono text-slate-400 mt-1 block">
                          Cód: {priceCheckerProduct.barcode}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Precios Gigantes */}
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/30 text-center space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                      PRECIO AL PÚBLICO
                    </span>
                    <div className="text-4xl sm:text-5xl font-black text-emerald-400 font-mono tracking-tight">
                      ${Number(priceCheckerProduct.price || priceCheckerProduct.precio || 0).toFixed(2)}
                    </div>
                    {!isDollarCountry && (
                      <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono">
                        Bs. {(Number(priceCheckerProduct.price || priceCheckerProduct.precio || 0) * exchangeRate).toFixed(2)}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 font-medium pt-0.5 flex items-center justify-center gap-2">
                      <span className={priceCheckerProduct.is_exempt || priceCheckerProduct.taxRate === 0 ? 'text-blue-400 font-bold' : 'text-slate-300'}>
                        {priceCheckerProduct.is_exempt || priceCheckerProduct.taxRate === 0 ? 'Exento de IVA' : 'IVA (16%) Incluido'}
                      </span>
                      <span>•</span>
                      <span>Tasa oficial: Bs. {exchangeRate.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Selector Táctil de Cantidad para Pasillo */}
                  <div className={`p-2.5 rounded-xl ${T.subPanelBg} border ${T.border} space-y-2`}>
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className={T.textMuted}>Cantidad a añadir:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setCheckQty(prev => Math.max(1, prev - 1));
                          }}
                          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-90 flex items-center justify-center text-slate-200 cursor-pointer border border-slate-700"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center font-mono font-black text-sm text-white">
                          {checkQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setCheckQty(prev => prev + 1);
                          }}
                          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-90 flex items-center justify-center text-slate-200 cursor-pointer border border-slate-700"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Atajos de cantidad rápida */}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {[1, 2, 3, 5, 10].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setCheckQty(val);
                          }}
                          className={`flex-1 py-1 rounded-md text-[11px] font-mono font-bold border transition-all cursor-pointer ${
                            checkQty === val
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                              : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 border-slate-700/60'
                          }`}
                        >
                          x{val}
                        </button>
                      ))}
                      {Number(priceCheckerProduct.unitsPerBulk) > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(10);
                            setCheckQty(Number(priceCheckerProduct.unitsPerBulk));
                          }}
                          className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer whitespace-nowrap ${
                            checkQty === Number(priceCheckerProduct.unitsPerBulk)
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                              : 'bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-400 border-indigo-800/40'
                          }`}
                          title={`Añadir bulto completo (${priceCheckerProduct.unitsPerBulk} unid)`}
                        >
                          Bulto ({priceCheckerProduct.unitsPerBulk})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stock y Almacenes */}
                  <div className={`p-3 rounded-2xl ${T.subPanelBg} border ${T.border} space-y-1.5`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className={T.textMuted}>Disponibilidad Total:</span>
                      <span className={`font-black ${
                        Number(priceCheckerProduct.stockQuantity ?? priceCheckerProduct.stock ?? 0) > 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}>
                        {Number(priceCheckerProduct.stockQuantity ?? priceCheckerProduct.stock ?? 0) > 0
                          ? `🟢 En Stock (${priceCheckerProduct.stockQuantity ?? priceCheckerProduct.stock ?? 0} unid)`
                          : '🔴 Sin Existencias'}
                      </span>
                    </div>

                    {/* Precios por Bulto / Empaque si existen */}
                    {priceCheckerProduct.bulkPrice > 0 && (
                      <div className="flex items-center justify-between text-xs border-t border-slate-800 pt-1 text-indigo-400 font-bold">
                        <span>📦 {priceCheckerProduct.bulkUnitName || 'Bulto'} x{priceCheckerProduct.unitsPerBulk || 1}:</span>
                        <span className="font-mono font-black">${Number(priceCheckerProduct.bulkPrice).toFixed(2)} USD</span>
                      </div>
                    )}
                  </div>

                  {/* Acciones */}
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(20);
                        addToCart(priceCheckerProduct, checkQty);
                        playSuccessSound();
                        showToast(`🛒 +${checkQty} ${priceCheckerProduct.name || priceCheckerProduct.nombre} al carrito`);
                        setCheckQty(1);
                      }}
                      className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-600/30"
                    >
                      <ShoppingCart size={16} />
                      <span>
                        {checkQty > 1
                          ? `Añadir ${checkQty} al Carrito ($${(Number(priceCheckerProduct.price || priceCheckerProduct.precio || 0) * checkQty).toFixed(2)})`
                          : `+1 al Carrito ($${Number(priceCheckerProduct.price || priceCheckerProduct.precio || 0).toFixed(2)})`}
                      </span>
                    </button>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(15);
                          setPriceCheckerProduct(null);
                          setPriceCheckerSearch('');
                          setScannerTarget('cart');
                          setPosMode('PRICE_CHECKER');
                          onOpenScanner();
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/30 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Camera size={14} />
                        <span>Escanear Siguiente</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(10);
                          setPriceCheckerProduct(null);
                          setPriceCheckerSearch('');
                          setCheckQty(1);
                        }}
                        className={`px-4 py-2.5 rounded-xl border ${T.btnGhost} text-xs font-bold cursor-pointer active:scale-95`}
                      >
                        Consultar Otro
                      </button>
                    </div>
                  </div>
                </div>
              ) : priceCheckerSearch.trim() ? (
                /* Resultados de Búsqueda Rápida */
                <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                  {searchResults.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500">
                      No se encontraron coincidencias
                    </div>
                  ) : (
                    searchResults.map(p => (
                      <div
                        key={p.id}
                        onClick={() => {
                          triggerHaptic(15);
                          setPriceCheckerProduct(p);
                        }}
                        className={`p-2.5 rounded-xl border ${T.border} ${T.ticketItemBg} flex items-center justify-between gap-2.5 cursor-pointer hover:border-amber-500/50 active:scale-98 transition-all group`}
                      >
                        <div className="min-w-0 flex-1">
                          <h4 className={`text-xs font-bold ${T.textPrimary} truncate group-hover:text-amber-400 transition-colors`}>{p.name || p.nombre}</h4>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                            <span>Stock: {p.stockQuantity ?? p.stock ?? 0}</span>
                            {!isDollarCountry && (
                              <span className="text-amber-400/90 font-bold">Bs. {(Number(p.price || p.precio || 0) * exchangeRate).toFixed(2)}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right font-mono font-black text-emerald-400 text-xs sm:text-sm">
                            ${Number(p.price || p.precio || 0).toFixed(2)}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic(20);
                              addToCart(p, 1);
                              playSuccessSound();
                              showToast(`🛒 +1 ${p.name || p.nombre} al carrito`);
                            }}
                            className="p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 flex items-center justify-center cursor-pointer active:scale-90"
                            title="Añadir 1 directo al carrito"
                          >
                            <ShoppingCart size={13} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                /* Estado Inicial / Instrucciones */
                <div className="py-8 flex flex-col items-center justify-center text-center space-y-2 text-slate-500">
                  <div className="w-14 h-14 rounded-xl bg-slate-800/40 border border-slate-700/50 flex items-center justify-center text-amber-400 animate-pulse">
                    <ScanBarcode size={32} />
                  </div>
                  <h4 className={`font-black text-xs ${T.textPrimary}`}>
                    Listo para Consultar Precios
                  </h4>
                  <p className="text-[11px] text-slate-400 max-w-xs">
                    Dispara con tu pistola lectora Bluetooth, usa la cámara o escribe en el buscador para ver el precio gigante.
                  </p>
                </div>
              )}
            </motion.div>
          </div>
        )}
    </AnimatePresence>
  );
}