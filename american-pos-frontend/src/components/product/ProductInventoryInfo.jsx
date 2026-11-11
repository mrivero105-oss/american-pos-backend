import React, { useState, useEffect } from 'react';
import { BarChart3, Weight, Scan, Package, Calendar } from 'lucide-react';

export default function ProductInventoryInfo({
    formData,
    setFormData,
    handleChange,
    loading,
    exchangeRate = 1,
    setScannerMode,
    setIsBarcodeScannerOpen
}) {
    const isWeightProduct = Boolean(formData?.isSoldByWeight || formData?.stockUnit === 'kg');
    const presentations = Array.isArray(formData?.presentations) ? formData.presentations : [];
    const primaryPresIndex = presentations.findIndex(p => p.isDefaultPurchase) >= 0
        ? presentations.findIndex(p => p.isDefaultPurchase)
        : (presentations.length > 0 ? 0 : -1);
    const primaryPres = primaryPresIndex >= 0 ? presentations[primaryPresIndex] : null;
    const pieceName = (primaryPres?.name || '').trim() || 'Peine / Pieza';
    const currentFactor = Number(primaryPres?.factorConversion) || 0;
    const stockKg = parseFloat(formData?.stockQuantity) || 0;

    const [piecesInput, setPiecesInput] = useState(
        formData?.stockUnits !== undefined && formData?.stockUnits !== null && formData?.stockUnits !== ''
            ? String(formData.stockUnits)
            : ''
    );
    const [isEditingPieces, setIsEditingPieces] = useState(false);
    const [singleWeighInput, setSingleWeighInput] = useState('');
    const [weighedList, setWeighedList] = useState([]);

    useEffect(() => {
        if (!isEditingPieces) {
            if (formData?.stockUnits !== undefined && formData?.stockUnits !== null && formData?.stockUnits !== '') {
                setPiecesInput(String(formData.stockUnits));
            } else if (stockKg > 0 && currentFactor > 0) {
                const calcPieces = Math.round((stockKg / currentFactor) * 100) / 100;
                setPiecesInput(String(calcPieces));
            } else if (stockKg === 0) {
                setPiecesInput('');
            }
        }
    }, [formData?.stockUnits, stockKg, currentFactor, isEditingPieces]);

    const updatePrimaryPresentationFactor = (newFactorVal, nextStockKg = undefined) => {
        if (!setFormData) return;
        const cleanStr = String(newFactorVal ?? '').replace(',', '.');
        const numFactor = parseFloat(cleanStr);
        const rate = parseFloat(exchangeRate) || 1;
        const unitPrice = parseFloat(formData?.price) || 0;
        const unitCost = parseFloat(formData?.cost) || 0;

        setFormData(prev => {
            const list = Array.isArray(prev.presentations) ? [...prev.presentations] : [];
            const idx = list.findIndex(p => p.isDefaultPurchase) >= 0
                ? list.findIndex(p => p.isDefaultPurchase)
                : (list.length > 0 ? 0 : -1);

            if (idx >= 0) {
                const oldPres = list[idx];
                const oldFactor = Number(oldPres.factorConversion) || 1;
                const oldPrice = parseFloat(oldPres.price) || 0;
                const wholesaleKgPrice = (oldPres.isManualPrice && oldPrice > 0 && oldFactor > 0)
                    ? (oldPrice / oldFactor)
                    : unitPrice;

                const updatedPres = {
                    ...oldPres,
                    factorConversion: cleanStr,
                    isCustomFactor: true
                };

                if (!Number.isNaN(numFactor) && numFactor > 0) {
                    if (wholesaleKgPrice > 0) {
                        const calcUsd = (Math.round(wholesaleKgPrice * numFactor * 100) / 100).toFixed(2);
                        updatedPres.price = calcUsd;
                        updatedPres.priceBs = rate > 0 ? (Math.round(parseFloat(calcUsd) * rate * 100) / 100).toString() : '';
                    }
                    if (unitCost > 0) {
                        updatedPres.cost = (Math.round(unitCost * numFactor * 100) / 100).toFixed(2);
                    }
                }
                list[idx] = updatedPres;
            } else if (!Number.isNaN(numFactor) && numFactor > 0) {
                const calcUsd = unitPrice > 0 ? (Math.round(unitPrice * numFactor * 100) / 100).toFixed(2) : '';
                list.push({
                    id: `pres_${Date.now()}`,
                    name: 'Peine',
                    factorConversion: cleanStr,
                    price: calcUsd,
                    priceBs: calcUsd && rate > 0 ? (Math.round(parseFloat(calcUsd) * rate * 100) / 100).toString() : '',
                    cost: unitCost > 0 ? (Math.round(unitCost * numFactor * 100) / 100).toFixed(2) : '',
                    barcode: '',
                    isDefaultPurchase: true,
                    isManualPrice: false,
                    isCustomFactor: true
                });
            }

            const targetPres = list[idx >= 0 ? idx : 0];
            const targetFactor = Number(targetPres?.factorConversion) || numFactor || 1;
            const finalStockKg = nextStockKg !== undefined ? nextStockKg : stockKg;
            const updatedStockUnits = targetFactor > 0 && finalStockKg > 0
                ? Math.round((finalStockKg / targetFactor) * 100) / 100
                : 0;

            return {
                ...prev,
                presentations: list,
                stockUnits: updatedStockUnits > 0 ? updatedStockUnits : prev.stockUnits
            };
        });
    };

    const handleAddSingleWeigh = () => {
        const val = parseFloat(String(singleWeighInput).replace(',', '.'));
        if (Number.isNaN(val) || val <= 0) return;
        const nextList = [...weighedList, val];
        setWeighedList(nextList);
        const sumKg = Math.round(nextList.reduce((acc, curr) => acc + curr, 0) * 1000) / 1000;
        const avgFactor = Math.round((sumKg / nextList.length) * 1000) / 1000;
        setSingleWeighInput('');
        setFormData(prev => ({
            ...prev,
            stockQuantity: String(sumKg),
            stockUnits: nextList.length
        }));
        setPiecesInput(String(nextList.length));
        updatePrimaryPresentationFactor(avgFactor, sumKg);
    };

    const handleRemoveWeighedItem = (removeIdx) => {
        const nextList = weighedList.filter((_, i) => i !== removeIdx);
        setWeighedList(nextList);
        const sumKg = Math.round(nextList.reduce((acc, curr) => acc + curr, 0) * 1000) / 1000;
        const count = nextList.length;
        const avgFactor = count > 0 ? Math.round((sumKg / count) * 1000) / 1000 : currentFactor;
        setFormData(prev => ({
            ...prev,
            stockQuantity: count > 0 ? String(sumKg) : '0',
            stockUnits: count
        }));
        setPiecesInput(String(count));
        if (count > 0) updatePrimaryPresentationFactor(avgFactor, sumKg);
    };

    return (
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
            {/* Header Limpio Square POS */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                        <BarChart3 size={15} />
                    </span>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        Control de existencias
                    </h3>
                </div>
            </div>

            <div className="space-y-3.5">
                {/* Fila 1: Stock Actual + Unidad de Medida */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Stock actual
                        </label>
                        <input
                            type="text"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            name="stockQuantity"
                            value={formData.stockQuantity}
                            onChange={handleChange}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-sm font-bold font-mono text-slate-900 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all"
                            placeholder="0"
                            disabled={loading}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Unidad de medida
                        </label>
                        <select
                            name="stockUnit"
                            value={formData.stockUnit || 'und'}
                            onChange={handleChange}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all cursor-pointer"
                            disabled={loading}
                        >
                            <option value="und">Unidad (und)</option>
                            <option value="kg">Kilogramo (kg)</option>
                            <option value="g">Gramo (g)</option>
                            <option value="lt">Litro (lt)</option>
                            <option value="ml">Mililitro (ml)</option>
                            <option value="tab">Tabletas / Blíster</option>
                        </select>
                    </div>
                </div>

                {/* Sub-panel Táctil de Pesaje para Carnicerías / Charcuterías */}
                {isWeightProduct && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-850/80 rounded-lg border border-slate-200 dark:border-slate-750 space-y-2.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                <Weight size={13} className="text-blue-500" />
                                Módulo de pesaje de {pieceName}s
                            </span>
                            {currentFactor > 0 && (
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    Promedio: <strong>{currentFactor} kg/{pieceName}</strong>
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-1.5">
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder={`Peso individual (kg)...`}
                                value={singleWeighInput}
                                onChange={(e) => setSingleWeighInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddSingleWeigh();
                                    }
                                }}
                                className="flex-1 h-8 px-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-mono font-medium outline-none focus:border-blue-500"
                            />
                            <button
                                type="button"
                                onClick={handleAddSingleWeigh}
                                disabled={loading || !singleWeighInput}
                                className="h-8 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold rounded-md transition-all active:scale-95 cursor-pointer"
                            >
                                + Sumar pesada
                            </button>
                        </div>

                        {weighedList.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                                {weighedList.map((w, idx) => (
                                    <span
                                        key={idx}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                                    >
                                        #{idx + 1}: {w}kg
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveWeighedItem(idx)}
                                            className="text-slate-400 hover:text-rose-600 ml-0.5 cursor-pointer"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Fila 2: Stock Mínimo + Toggle Venta por Peso */}
                <div className="grid grid-cols-2 gap-3 items-center pt-0.5">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Stock mínimo de alerta
                        </label>
                        <input
                            type="text"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            name="minStock"
                            value={formData.minStock}
                            onChange={handleChange}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-sm font-medium text-slate-900 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all"
                            placeholder="5"
                            disabled={loading}
                        />
                    </div>

                    <div className="pt-5">
                        <label className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-750 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                            <input
                                type="checkbox"
                                name="isSoldByWeight"
                                checked={formData.isSoldByWeight}
                                onChange={handleChange}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                                disabled={loading}
                            />
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                <Weight size={14} className="text-slate-500" />
                                Venta por peso (Báscula)
                            </span>
                        </label>
                    </div>
                </div>

                {/* Fila 3: Trazabilidad (Lote y Vencimiento) */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                            <Calendar size={13} className="text-slate-400" />
                            Lote y vencimiento
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                setScannerMode('OCR');
                                setIsBarcodeScannerOpen(true);
                            }}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                            <Scan size={12} />
                            Escanear con cámara
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <input
                                type="text"
                                name="batchNumber"
                                value={formData.batchNumber || ''}
                                onChange={handleChange}
                                placeholder="N° de lote (opcional)"
                                className="w-full h-9 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs font-mono font-medium text-slate-900 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 transition-all placeholder:font-sans placeholder:text-slate-400"
                                disabled={loading}
                            />
                        </div>
                        <div>
                            <input
                                type="date"
                                name="expirationDate"
                                value={formData.expirationDate || ''}
                                onChange={handleChange}
                                className="w-full h-9 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 transition-all"
                                disabled={loading}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
