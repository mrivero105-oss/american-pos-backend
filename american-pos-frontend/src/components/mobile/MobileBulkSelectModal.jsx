import { useState, useEffect } from 'react';
import {
  X, 
  Package, 
  ShoppingCart, 
  Plus, 
  Minus, 
  Layers, 
  Box
} from 'lucide-react';

const triggerHaptic = (ms = 12) => {
  try {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(ms);
    }
  } catch { /* Vibración háptica opcional no soportada */ }
};

/**
 * MobileBulkSelectModal
 * Bottom-sheet / modal táctil de alta velocidad para seleccionar presentación
 * de venta: Presentaciones dinámicas (Huevos, etc.), Unidad Suelta, Media Caja o Caja Completa (Bulto).
 */
export default function MobileBulkSelectModal({
  isOpen,
  onClose,
  product,
  exchangeRate = 950,
  onConfirmSelection,
  T = {}
}) {
  const [selectedType, setSelectedType] = useState(() => {
    if (Array.isArray(product?.Presentations) && product.Presentations.length > 0) {
      return `pres_${product.Presentations[0].id}`;
    }
    if (Number(product?.unitsPerBulk) > 1) return 'bulk';
    if (Number(product?.unitsPerMidBulk) > 0) return 'mid';
    return 'unit';
  });
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (product) {
      if (Array.isArray(product.Presentations) && product.Presentations.length > 0) {
        setSelectedType(`pres_${product.Presentations[0].id}`);
      } else if (Number(product.unitsPerBulk) > 1) {
        setSelectedType('bulk');
      } else if (Number(product.unitsPerMidBulk) > 0) {
        setSelectedType('mid');
      } else {
        setSelectedType('unit');
      }
      setQuantity(1);
    }
  }, [product]);

  if (!isOpen || !product) return null;

  const unitPriceUSD = Number(product.price || product.precio || 0);
  const unitPriceBS = Number(product.priceBs) > 0 ? Number(product.priceBs) : (unitPriceUSD * exchangeRate);

  const unitsPerBulk = Number(product.unitsPerBulk) || 1;
  const bulkPriceUSD = Number(product.bulkPrice) > 0 
    ? Number(product.bulkPrice) 
    : (unitPriceUSD * unitsPerBulk);
  const bulkPriceBS = Number(product.bulkPriceBs) > 0 
    ? Number(product.bulkPriceBs) 
    : (bulkPriceUSD * exchangeRate);
  const bulkUnitName = product.bulkUnitName || 'Caja';

  const unitsPerMid = Number(product.unitsPerMidBulk) || 0;
  const midBulkPriceUSD = Number(product.midBulkPrice) > 0 
    ? Number(product.midBulkPrice) 
    : (unitPriceUSD * (unitsPerMid || 1));
  const midBulkPriceBS = Number(product.midBulkPriceBs) > 0 
    ? Number(product.midBulkPriceBs) 
    : (midBulkPriceUSD * exchangeRate);
  const midBulkUnitName = product.midBulkUnitName || 'Media Caja';

  const totalStockUnits = Number(product.stockQuantity ?? product.stock ?? 0);
  const maxBoxesAvailable = unitsPerBulk > 1 ? Math.floor(totalStockUnits / unitsPerBulk) : totalStockUnits;
  const maxMidBoxesAvailable = unitsPerMid > 0 ? Math.floor(totalStockUnits / unitsPerMid) : totalStockUnits;

  // Cálculos de ahorro
  const regularBulkCost = unitPriceUSD * unitsPerBulk;
  const bulkSavingsUSD = regularBulkCost > bulkPriceUSD ? (regularBulkCost - bulkPriceUSD) : 0;
  const bulkUnitPriceEquiv = unitsPerBulk > 0 ? (bulkPriceUSD / unitsPerBulk) : unitPriceUSD;

  const regularMidCost = unitPriceUSD * unitsPerMid;
  const midSavingsUSD = regularMidCost > midBulkPriceUSD ? (regularMidCost - midBulkPriceUSD) : 0;
  const midUnitPriceEquiv = unitsPerMid > 0 ? (midBulkPriceUSD / unitsPerMid) : unitPriceUSD;

  // Presentación actualmente seleccionada
  let activePriceUSD = unitPriceUSD;
  let activePriceBS = unitPriceBS;
  let activeUnitsToDeductPerPack = 1;
  let activePackName = 'Unidad';
  let activeMaxQty = totalStockUnits;

  let selectedPres = null;
  if (selectedType.startsWith('pres_')) {
    const presId = selectedType.replace('pres_', '');
    selectedPres = product.Presentations?.find(p => String(p.id) === String(presId));
    if (selectedPres) {
      activePriceUSD = Number(selectedPres.price);
      activePriceBS = activePriceUSD * exchangeRate;
      activeUnitsToDeductPerPack = Number(selectedPres.factorConversion) || 1;
      activePackName = `${selectedPres.name} x${activeUnitsToDeductPerPack}`;
      activeMaxQty = activeUnitsToDeductPerPack > 0 ? Math.floor(totalStockUnits / activeUnitsToDeductPerPack) : totalStockUnits;
    }
  } else if (selectedType === 'bulk') {
    activePriceUSD = bulkPriceUSD;
    activePriceBS = bulkPriceBS;
    activeUnitsToDeductPerPack = unitsPerBulk;
    activePackName = `${bulkUnitName} x${unitsPerBulk}`;
    activeMaxQty = maxBoxesAvailable;
  } else if (selectedType === 'mid') {
    activePriceUSD = midBulkPriceUSD;
    activePriceBS = midBulkPriceBS;
    activeUnitsToDeductPerPack = unitsPerMid;
    activePackName = `${midBulkUnitName} x${unitsPerMid}`;
    activeMaxQty = maxMidBoxesAvailable;
  }

  const lineTotalUSD = activePriceUSD * quantity;
  const lineTotalBS = lineTotalUSD * exchangeRate;
  const totalUnitsDeducted = quantity * activeUnitsToDeductPerPack;

  const handleSelectPresentation = (type) => {
    triggerHaptic(10);
    setSelectedType(type);
  };

  const handleConfirm = () => {
    triggerHaptic(15);
    onConfirmSelection?.({
      product,
      type: selectedType, // 'unit' | 'mid' | 'bulk' | 'pres_...'
      isBulk: selectedType === 'bulk',
      isMidBulk: selectedType === 'mid',
      presentation: selectedPres || null,
      quantity,
      priceUSD: activePriceUSD,
      priceBS: activePriceBS,
      unitsMultiplier: activeUnitsToDeductPerPack,
      packName: activePackName
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-xs animate-fadeIn">
      <div 
        className={`w-full max-w-lg rounded-t-xl sm:rounded-xl ${T.modalCard || 'bg-slate-900'} border-t sm:border ${T.border || 'border-slate-800'} shadow-2xl flex flex-col max-h-[92vh] overflow-hidden`}
      >
        {/* Encabezado del Modal */}
        <div className={`p-4 border-b ${T.border || 'border-slate-800'} flex items-center justify-between shrink-0 ${T.subPanelBg || 'bg-slate-950/50'}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shrink-0">
              <Package size={20} />
            </div>
            <div className="min-w-0">
              <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary || 'text-white'} truncate`}>
                {product.name || product.nombre}
              </h3>
              <p className={`text-[10px] ${T.textMuted || 'text-slate-400'} flex items-center gap-1.5`}>
                <span>Stock: <b>{totalStockUnits} un.</b></span>
                {unitsPerBulk > 1 && (
                  <span>• <b>{maxBoxesAvailable} {bulkUnitName}s</b> disp.</span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg ${T.btnGhost} cursor-pointer active:scale-90`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Opciones de Presentación */}
        <div className="p-4 overflow-y-auto space-y-2.5 custom-scrollbar text-xs">
          <p className={`text-[11px] font-black uppercase tracking-wider ${T.textSecondary || 'text-slate-400'}`}>
            Selecciona la Presentación de Venta:
          </p>

          {/* PRESENTACIONES DINÁMICAS (Tier 4 / N Presentaciones) */}
          {Array.isArray(product.Presentations) && product.Presentations.map((pres) => {
            const factor = Number(pres.factorConversion) || 1;
            const pPriceUSD = Number(pres.price) || 0;
            const pPriceBS = Number(pres.priceBs) > 0 ? Number(pres.priceBs) : (pPriceUSD * exchangeRate);
            const regCost = unitPriceUSD * factor;
            const savingsUSD = regCost > pPriceUSD ? (regCost - pPriceUSD) : 0;
            const unitEquiv = factor > 0 ? (pPriceUSD / factor) : unitPriceUSD;
            const maxAvailable = factor > 0 ? Math.floor(totalStockUnits / factor) : totalStockUnits;
            const isSelected = selectedType === `pres_${pres.id}`;

            return (
              <div
                key={`pres-${pres.id}`}
                onClick={() => handleSelectPresentation(`pres_${pres.id}`)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-500/15 shadow-sm'
                    : `${T.modalSubCard || 'bg-slate-800/60'} border-slate-700/60 hover:border-slate-600`
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${
                    isSelected 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'bg-slate-800 text-indigo-400 border border-slate-700'
                  }`}>
                    <Layers size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm ${T.textPrimary || 'text-white'}`}>
                        {pres.name} (x{factor} un)
                      </span>
                      {savingsUSD > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Ahorro -${savingsUSD.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <p className={`text-[10.5px] ${T.textMuted || 'text-slate-400'} mt-0.5`}>
                      Sale a <b>${unitEquiv.toFixed(2)} c/u</b> • {maxAvailable} disp.
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-bold text-base text-emerald-500 dark:text-emerald-400 block leading-tight">
                    ${pPriceUSD.toFixed(2)}
                  </span>
                  <span className={`text-[10px] font-semibold ${T.textSecondary || 'text-slate-400'} block leading-tight`}>
                    Bs. {pPriceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            );
          })}

          {/* 1. OPCIÓN: CAJA COMPLETA / BULTO */}
          {unitsPerBulk > 1 && (
            <div
              onClick={() => handleSelectPresentation('bulk')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex items-center justify-between gap-3 ${
                selectedType === 'bulk'
                  ? 'border-indigo-500 bg-indigo-500/15 shadow-sm'
                  : `${T.modalSubCard || 'bg-slate-800/60'} border-slate-700/60 hover:border-slate-600`
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${
                  selectedType === 'bulk' 
                    ? 'bg-indigo-600 text-white shadow-sm' 
                    : 'bg-slate-800 text-indigo-400 border border-slate-700'
                }`}>
                  <Package size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${T.textPrimary || 'text-white'}`}>
                      {bulkUnitName} Completa (x{unitsPerBulk} un)
                    </span>
                    {bulkSavingsUSD > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        Ahorro -${bulkSavingsUSD.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <p className={`text-[10.5px] ${T.textMuted || 'text-slate-400'} mt-0.5`}>
                    Sale a <b>${bulkUnitPriceEquiv.toFixed(2)} c/u</b> • {maxBoxesAvailable} disp.
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="font-bold text-base text-emerald-500 dark:text-emerald-400 block leading-tight">
                  ${bulkPriceUSD.toFixed(2)}
                </span>
                <span className={`text-[10px] font-semibold ${T.textSecondary || 'text-slate-400'} block leading-tight`}>
                  Bs. {bulkPriceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* 2. OPCIÓN: MEDIA CAJA (Si está configurada) */}
          {unitsPerMid > 0 && (
            <div
              onClick={() => handleSelectPresentation('mid')}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex items-center justify-between gap-3 ${
                selectedType === 'mid'
                  ? 'border-indigo-500 bg-indigo-500/15 shadow-sm'
                  : `${T.modalSubCard || 'bg-slate-800/60'} border-slate-700/60 hover:border-slate-600`
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${
                  selectedType === 'mid' 
                    ? 'bg-indigo-600 text-white shadow-sm' 
                    : 'bg-slate-800 text-indigo-400 border border-slate-700'
                }`}>
                  <Layers size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${T.textPrimary || 'text-white'}`}>
                      {midBulkUnitName} (x{unitsPerMid} un)
                    </span>
                    {midSavingsUSD > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        Ahorro -${midSavingsUSD.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <p className={`text-[10.5px] ${T.textMuted || 'text-slate-400'} mt-0.5`}>
                    Sale a <b>${midUnitPriceEquiv.toFixed(2)} c/u</b> • {maxMidBoxesAvailable} disp.
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="font-bold text-base text-emerald-500 dark:text-emerald-400 block leading-tight">
                  ${midBulkPriceUSD.toFixed(2)}
                </span>
                <span className={`text-[10px] font-semibold ${T.textSecondary || 'text-slate-400'} block leading-tight`}>
                  Bs. {midBulkPriceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* 3. OPCIÓN: UNIDAD SUELTA / DETAL */}
          <div
            onClick={() => handleSelectPresentation('unit')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden flex items-center justify-between gap-3 ${
              selectedType === 'unit'
                ? 'border-indigo-500 bg-indigo-500/15 shadow-sm'
                : `${T.modalSubCard || 'bg-slate-800/60'} border-slate-700/60 hover:border-slate-600`
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${
                selectedType === 'unit' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'bg-slate-800 text-indigo-400 border border-slate-700'
              }`}>
                <Box size={18} />
              </div>
              <div className="min-w-0">
                <span className={`font-bold text-sm ${T.textPrimary || 'text-white'}`}>
                  Unidad Suelta (Detal)
                </span>
                <p className={`text-[10.5px] ${T.textMuted || 'text-slate-400'} mt-0.5`}>
                  1 unidad individual • {totalStockUnits} un. disponibles
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="font-bold text-base text-emerald-500 dark:text-emerald-400 block leading-tight">
                ${unitPriceUSD.toFixed(2)}
              </span>
              <span className={`text-[10px] font-semibold ${T.textSecondary || 'text-slate-400'} block leading-tight`}>
                Bs. {unitPriceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Selector de Cantidad */}
          <div className={`mt-3 p-3 rounded-xl ${T.subPanelBg || 'bg-slate-950/40'} border ${T.border || 'border-slate-800'} flex items-center justify-between gap-3`}>
            <div>
              <span className={`text-[10.5px] uppercase font-bold ${T.textSecondary || 'text-slate-400'}`}>
                Cantidad a Vender:
              </span>
              <p className={`text-xs font-bold ${T.textPrimary || 'text-white'}`}>
                {quantity} {quantity === 1 ? activePackName : `${activePackName}s`}
                {activeUnitsToDeductPerPack > 1 && (
                  <span className="text-[10px] text-indigo-400 font-semibold ml-1.5">
                    ({totalUnitsDeducted} un. de inventario)
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setQuantity(prev => Math.max(1, prev - 1));
                }}
                className={`w-9 h-9 rounded-lg ${T.btnGhost} border ${T.border || 'border-slate-700'} flex items-center justify-center font-bold text-base cursor-pointer active:scale-90`}
              >
                <Minus size={14} />
              </button>

              <span className={`w-8 text-center font-bold text-base ${T.textPrimary || 'text-white'}`}>
                {quantity}
              </span>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setQuantity(prev => Math.min(activeMaxQty, prev + 1));
                }}
                className={`w-9 h-9 rounded-lg ${T.btnGhost} border ${T.border || 'border-slate-700'} flex items-center justify-center font-bold text-base cursor-pointer active:scale-90`}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Botones de Cantidad Rápida */}
          <div className="flex items-center gap-1.5 justify-center">
            {[1, 2, 3, 5, 10].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setQuantity(n);
                }}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  quantity === n
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : `${T.btnGhost} border ${T.border || 'border-slate-800'} ${T.textMuted || 'text-slate-400'}`
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Footer con Botón de Confirmación */}
        <div className={`p-4 border-t ${T.border || 'border-slate-800'} flex items-center justify-between gap-3 shrink-0 ${T.subPanelBg || 'bg-slate-950/50'}`}>
          <div>
            <span className={`text-[10px] font-semibold ${T.textSecondary || 'text-slate-400'} uppercase block`}>
              Total a Cobrar:
            </span>
            <div className="font-bold text-lg text-emerald-600 dark:text-emerald-400 leading-tight">
              ${lineTotalUSD.toFixed(2)}
            </div>
            <div className={`text-[10px] font-semibold text-amber-500 leading-tight`}>
              Bs. {lineTotalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-colors"
          >
            <ShoppingCart size={16} />
            <span>Agregar al Carrito</span>
          </button>
        </div>
      </div>
    </div>
  );
}
