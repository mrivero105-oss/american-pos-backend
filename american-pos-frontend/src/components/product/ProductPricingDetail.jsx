import React from 'react';
import { DollarSign, Package, Plus, Trash2, Info, Barcode, Check } from 'lucide-react';
import { precisionRound } from '../../utils/format';

export default function ProductPricingDetail({
    formData,
    setFormData,
    handleChange,
    currencyMode,
    showBsInputs,
    exchangeRate = 1,
    loading
}) {
    const presentations = Array.isArray(formData?.presentations) ? formData.presentations : [];
    const unitPrice = parseFloat(formData?.price) || 0;
    const unitCost = parseFloat(formData?.cost) || 0;
    const rate = parseFloat(exchangeRate) || 1;
    const isWeightProduct = Boolean(formData?.isSoldByWeight || formData?.stockUnit === 'kg');

    // Sincroniza las presentaciones y actualiza de forma transparente los campos heredados (bulk/midBulk) y el detal
    const updatePresentationsWithLegacySync = (newList, extraFormData = {}) => {
        const sorted = [...newList].sort((a, b) => (Number(a.factorConversion) || 0) - (Number(b.factorConversion) || 0));
        
        let bulkFields = {
            bulkUnitName: 'Bulto',
            unitsPerBulk: 1,
            bulkCost: '',
            bulkPrice: '',
            bulkBarcode: '',
            midBulkUnitName: 'Media Presentación',
            unitsPerMidBulk: 0,
            midBulkCost: '',
            midBulkPrice: '',
            midBulkBarcode: ''
        };

        if (sorted.length > 0) {
            // El empaque mayor es el marcado como compra habitual o el de mayor factor
            const defaultPurchasePres = sorted.find(p => p.isDefaultPurchase);
            const highestPres = defaultPurchasePres || sorted[sorted.length - 1];
            
            bulkFields.bulkUnitName = highestPres.name || 'Bulto / Caja';
            bulkFields.unitsPerBulk = Number(highestPres.factorConversion) || 1;
            bulkFields.bulkCost = highestPres.cost ? String(highestPres.cost) : '';
            bulkFields.bulkPrice = highestPres.price ? String(highestPres.price) : '';
            bulkFields.bulkPriceBs = highestPres.priceBs ? String(highestPres.priceBs) : (highestPres.price && rate > 0 ? String(Math.round(Number(highestPres.price) * rate * 100) / 100) : '');
            bulkFields.bulkBarcode = highestPres.barcode || '';

            // Si hay empaque intermedio (ej: medio bulto, media caja, medio cartón)
            const remaining = sorted.filter(p => p.id !== highestPres.id);
            if (remaining.length > 0) {
                const midPres = remaining[remaining.length - 1]; // El segundo más grande
                bulkFields.midBulkUnitName = midPres.name || 'Media Presentación';
                bulkFields.unitsPerMidBulk = Number(midPres.factorConversion) || 0;
                bulkFields.midBulkCost = midPres.cost ? String(midPres.cost) : '';
                bulkFields.midBulkPrice = midPres.price ? String(midPres.price) : '';
                bulkFields.midBulkPriceBs = midPres.priceBs ? String(midPres.priceBs) : (midPres.price && rate > 0 ? String(Math.round(Number(midPres.price) * rate * 100) / 100) : '');
                bulkFields.midBulkBarcode = midPres.barcode || '';
            }
        }

        setFormData?.(prev => ({
            ...prev,
            ...bulkFields,
            ...extraFormData,
            presentations: newList
        }));
    };

    const handleAddPresentation = () => {
        const factor = 2;
        const suggestedCost = unitCost > 0 ? (Math.round(unitCost * factor * 100) / 100).toFixed(2) : '';
        const suggestedPrice = unitPrice > 0 ? (Math.round(unitPrice * factor * 100) / 100).toFixed(2) : '';
        const suggestedPriceBs = suggestedPrice && rate > 0 ? (Math.round(parseFloat(suggestedPrice) * rate * 100) / 100).toString() : '';

        const newPres = {
            id: `pres_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: '',
            factorConversion: factor,
            price: suggestedPrice,
            priceBs: suggestedPriceBs,
            cost: suggestedCost,
            barcode: '',
            isDefaultPurchase: presentations.length === 0,
            isManualPrice: false,
            isCustomFactor: false
        };

        updatePresentationsWithLegacySync([...presentations, newPres]);
    };

    const inferFactorFromName = (rawName) => {
        const txt = String(rawName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        if (!txt) return null;
        const explicitNum = txt.match(/(?:x|\()\s*(\d+)\b|\b(\d+)\s*(?:un|und|unid|unidades|pza|pzas)\b/i);
        if (explicitNum) {
            const n = parseInt(explicitNum[1] || explicitNum[2], 10);
            if (n > 0) return n;
        }
        if ((txt.includes('medio') || txt.includes('1/2')) && txt.includes('carton')) return 15;
        if (txt === 'carton' || txt.startsWith('carton ')) return 30;
        if ((txt.includes('media') || txt.includes('1/2')) && txt.includes('docena')) return 6;
        if (txt === 'docena' || txt.startsWith('docena ')) return 12;
        return null;
    };

    // Calcula de forma bidireccional los precios y costos a partir de una presentación de compra (ej. Caja, Bulto, Fardo)
    const calculatePricingFromPresentation = (presCostNum, factorNum, presIndex, currentList) => {
        if (!presCostNum || presCostNum <= 0 || !factorNum || factorNum <= 0) {
            return { updatedList: currentList, extraChanges: {} };
        }

        const currentMarginStr = String(formData?.margin ?? '').trim();
        const marginVal = currentMarginStr !== '' ? (parseFloat(currentMarginStr) || 0) : 30;

        // 1. Precio de venta de la propia presentación (ej. Caja)
        const presPriceNum = marginVal > 0 
            ? Math.round(presCostNum * (1 + marginVal / 100) * 100) / 100 
            : presCostNum;
        const presPriceStr = presPriceNum.toFixed(2);
        const presPriceBsStr = rate > 0 ? (Math.round(presPriceNum * rate * 100) / 100).toString() : '';
        const unitWholesaleEq = (Math.round((presPriceNum / factorNum) * 100) / 100).toString();

        const updatedList = [...currentList];
        updatedList[presIndex] = {
            ...updatedList[presIndex],
            cost: presCostNum.toString(),
            price: presPriceStr,
            priceBs: presPriceBsStr,
            wholesaleUnitPrice: unitWholesaleEq,
            isManualPrice: false
        };

        // 2. Determinar si esta presentación debe actualizar el costo y precio al detal
        // Se actualiza si:
        // - Está marcada como compra habitual a proveedor (isDefaultPurchase)
        // - O es la única presentación en la lista
        // - O el costo al detal actual es 0 o está vacío
        const isDefault = Boolean(updatedList[presIndex].isDefaultPurchase || updatedList.length === 1 || unitCost === 0);

        let extraChanges = {};
        if (isDefault) {
            const unitCostVal = presCostNum / factorNum;
            const retailCostStr = unitCostVal < 0.01 
                ? precisionRound(unitCostVal, 4).toString()
                : (Number.isInteger(Math.round(unitCostVal * 100)) ? (Math.round(unitCostVal * 100) / 100).toFixed(2) : precisionRound(unitCostVal, 4).toString());
            const retailCostBsStr = rate > 0 && unitCostVal > 0 
                ? (Math.round(unitCostVal * rate * 100) / 100).toString() 
                : '';

            const rawRetailPrice = marginVal > 0 ? (unitCostVal * (1 + marginVal / 100)) : unitCostVal;
            const retailPriceNum = Math.round(rawRetailPrice * 100) / 100;
            const retailPriceStr = retailPriceNum >= 0.01 
                ? retailPriceNum.toFixed(2) 
                : precisionRound(rawRetailPrice, 4).toString();
            const retailPriceBsStr = rate > 0 && retailPriceNum > 0 
                ? (Math.round(retailPriceNum * rate * 100) / 100).toString() 
                : '';

            extraChanges = {
                cost: retailCostStr,
                costBs: retailCostBsStr,
                price: retailPriceStr,
                priceBs: retailPriceBsStr,
                margin: currentMarginStr !== '' ? currentMarginStr : '30'
            };

            // Sincronizar otras presentaciones secundarias que dependan del detal si no tienen precio manual
            updatedList.forEach((p, idx) => {
                if (idx !== presIndex && !p.isManualPrice) {
                    const otherFactor = Number(p.factorConversion) || 1;
                    const otherCostVal = unitCostVal * otherFactor;
                    const otherCostStr = (Math.round(otherCostVal * 100) / 100).toFixed(2);
                    const otherPriceVal = marginVal > 0 
                        ? (Math.round(otherCostVal * (1 + marginVal / 100) * 100) / 100).toFixed(2)
                        : (Math.round(retailPriceNum * otherFactor * 100) / 100).toFixed(2);
                    const otherPriceBsStr = rate > 0 ? (Math.round(parseFloat(otherPriceVal) * rate * 100) / 100).toString() : '';

                    updatedList[idx] = {
                        ...p,
                        cost: otherCostStr,
                        price: otherPriceVal,
                        priceBs: otherPriceBsStr,
                        wholesaleUnitPrice: retailPriceStr
                    };
                }
            });
        }

        return { updatedList, extraChanges };
    };

    const handleUpdatePresentation = (index, field, value) => {
        const list = [...presentations];
        if (!list[index]) return;

        // Si se marca como compra habitual, desmarcar las demás
        if (field === 'isDefaultPurchase' && value === true) {
            list.forEach((p, i) => {
                p.isDefaultPurchase = (i === index);
            });
            const presCost = parseFloat(list[index].cost) || 0;
            const factor = Number(list[index].factorConversion) || 1;
            if (presCost > 0 && factor > 0) {
                const { updatedList, extraChanges } = calculatePricingFromPresentation(presCost, factor, index, list);
                updatePresentationsWithLegacySync(updatedList, extraChanges);
                return;
            }
        } else if (field === 'cost') {
            const rawCost = String(value ?? '').replace(',', '.').trim();
            const presCost = parseFloat(rawCost);
            const factor = Number(list[index].factorConversion) || 1;

            if (rawCost === '') {
                list[index] = { ...list[index], cost: '' };
                updatePresentationsWithLegacySync(list);
                return;
            }

            if (!Number.isNaN(presCost) && presCost > 0 && factor > 0) {
                const { updatedList, extraChanges } = calculatePricingFromPresentation(presCost, factor, index, list);
                updatedList[index].cost = rawCost;
                updatePresentationsWithLegacySync(updatedList, extraChanges);
                return;
            } else {
                list[index] = { ...list[index], cost: rawCost };
            }
        } else if (field === 'factorConversion') {
            const rawStr = String(value ?? '').replace(',', '.').trim();
            const numericFactor = parseFloat(rawStr);
            const currentCost = parseFloat(list[index].cost) || 0;

            const nextItem = {
                ...list[index],
                factorConversion: rawStr === '' ? '' : rawStr,
                isCustomFactor: true
            };
            list[index] = nextItem;

            if (!Number.isNaN(numericFactor) && numericFactor > 0) {
                if (currentCost > 0) {
                    const { updatedList, extraChanges } = calculatePricingFromPresentation(currentCost, numericFactor, index, list);
                    updatedList[index].factorConversion = rawStr;
                    updatePresentationsWithLegacySync(updatedList, extraChanges);
                    return;
                } else if (unitCost > 0) {
                    nextItem.cost = (Math.round(unitCost * numericFactor * 100) / 100).toFixed(2);
                    if (unitPrice > 0 && !nextItem.isManualPrice) {
                        const calcUsd = (Math.round(unitPrice * numericFactor * 100) / 100).toFixed(2);
                        nextItem.price = calcUsd;
                        nextItem.priceBs = rate > 0 ? (Math.round(parseFloat(calcUsd) * rate * 100) / 100).toString() : '';
                    }
                    list[index] = nextItem;
                }
            }
        } else if (field === 'name') {
            const nextItem = { ...list[index], name: value };
            if (!list[index].isCustomFactor) {
                const inferred = inferFactorFromName(value);
                if (inferred && inferred > 0) {
                    nextItem.factorConversion = inferred;
                    const currentCost = parseFloat(list[index].cost) || 0;
                    if (currentCost > 0) {
                        list[index] = nextItem;
                        const { updatedList, extraChanges } = calculatePricingFromPresentation(currentCost, inferred, index, list);
                        updatePresentationsWithLegacySync(updatedList, extraChanges);
                        return;
                    }
                    if (unitPrice > 0 && !list[index].isManualPrice) {
                        const calcUsd = (Math.round(unitPrice * inferred * 100) / 100).toFixed(2);
                        nextItem.price = calcUsd;
                        nextItem.priceBs = rate > 0 ? (Math.round(parseFloat(calcUsd) * rate * 100) / 100).toString() : '';
                    }
                    if (unitCost > 0) {
                        nextItem.cost = (Math.round(unitCost * inferred * 100) / 100).toFixed(2);
                    }
                }
            }
            list[index] = nextItem;
        } else {
            list[index] = { ...list[index], [field]: value };
        }

        updatePresentationsWithLegacySync(list);
    };

    const handleUpdatePresentationUsd = (index, rawValue) => {
        const list = [...presentations];
        if (!list[index]) return;
        const clean = typeof rawValue === 'string' ? rawValue.replace(',', '.') : rawValue;
        const numUsd = parseFloat(clean) || 0;
        const factor = Number(list[index].factorConversion) || 1;
        const autoBs = rate > 0 && numUsd > 0 ? (Math.round(numUsd * rate * 100) / 100).toString() : '';
        const unitEq = factor > 0 && numUsd > 0 ? (Math.round((numUsd / factor) * 100) / 100).toString() : '';
        
        list[index] = { 
            ...list[index], 
            price: clean,
            priceBs: autoBs,
            wholesaleUnitPrice: unitEq,
            isManualPrice: true
        };
        updatePresentationsWithLegacySync(list);
    };

    const handleUpdatePresentationUnitUsd = (index, rawValue) => {
        const list = [...presentations];
        if (!list[index]) return;
        const clean = typeof rawValue === 'string' ? rawValue.replace(',', '.') : rawValue;
        const numUnitUsd = parseFloat(clean) || 0;
        const factor = Number(list[index].factorConversion) || 1;
        const totalUsd = numUnitUsd > 0 && factor > 0 ? (Math.round(numUnitUsd * factor * 100) / 100).toFixed(2) : (clean === '' ? '' : '0');
        const autoBs = rate > 0 && parseFloat(totalUsd) > 0 ? (Math.round(parseFloat(totalUsd) * rate * 100) / 100).toString() : '';

        list[index] = {
            ...list[index],
            wholesaleUnitPrice: clean,
            price: totalUsd,
            priceBs: autoBs,
            isManualPrice: true
        };
        updatePresentationsWithLegacySync(list);
    };

    const handleUpdatePresentationBs = (index, rawValue) => {
        const list = [...presentations];
        if (!list[index]) return;
        const clean = typeof rawValue === 'string' ? rawValue.replace(',', '.') : rawValue;
        const numBs = parseFloat(clean) || 0;
        const factor = Number(list[index].factorConversion) || 1;
        const autoUsd = rate > 0 && numBs > 0 ? (Math.round((numBs / rate) * 10000) / 10000).toString() : (clean === '' ? '' : '0');
        const unitEq = factor > 0 && parseFloat(autoUsd) > 0 ? (Math.round((parseFloat(autoUsd) / factor) * 100) / 100).toString() : '';
        
        list[index] = { 
            ...list[index], 
            priceBs: clean,
            price: autoUsd,
            wholesaleUnitPrice: unitEq,
            isManualPrice: true
        };
        updatePresentationsWithLegacySync(list);
    };

    const handleRemovePresentation = (index) => {
        const list = [...presentations];
        list.splice(index, 1);
        updatePresentationsWithLegacySync(list);
    };

    const handleSuggestPrice = (index, discountPercent = 0) => {
        const pres = presentations[index];
        if (!pres) return;
        const factor = Number(pres.factorConversion) || 1;
        const unitDiscounted = unitPrice * (1 - discountPercent / 100);
        const calculated = unitDiscounted * factor;
        const usdVal = calculated > 0 ? calculated.toFixed(2) : '';
        const bsVal = usdVal && rate > 0 ? (Math.round(parseFloat(usdVal) * rate * 100) / 100).toString() : '';

        const list = [...presentations];
        list[index] = {
            ...list[index],
            price: usdVal,
            priceBs: bsVal,
            wholesaleUnitPrice: unitDiscounted > 0 ? unitDiscounted.toFixed(2) : '',
            isManualPrice: discountPercent !== 0
        };
        updatePresentationsWithLegacySync(list);
    };

    const handleSuggestCost = (index) => {
        const pres = presentations[index];
        if (!pres) return;
        const factor = Number(pres.factorConversion) || 1;
        const calculated = unitCost * factor;
        handleUpdatePresentation(index, 'cost', calculated > 0 ? calculated.toFixed(2) : '');
    };

    const handleUpdateUnitEquivalent = (index, newUnitVal) => {
        const pres = presentations[index];
        if (!pres) return;
        const factor = Number(pres.factorConversion) || 1;
        const val = parseFloat(newUnitVal) || 0;
        const totalPrice = val * factor;
        handleUpdatePresentation(index, 'price', totalPrice > 0 ? totalPrice.toFixed(2) : '');
    };

    const handleGenerateBarcode = (index) => {
        const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
        handleUpdatePresentation(index, 'barcode', String(randomDigits));
    };

    const calcMargin = (unitCost > 0 && unitPrice > 0)
        ? (((unitPrice - unitCost) / unitCost) * 100)
        : (parseFloat(formData?.margin) || 0);
    const profitUnitUsd = (unitPrice > 0 && unitCost > 0) ? (unitPrice - unitCost) : 0;

    return (
        <div className="flex flex-col gap-3 sm:gap-4 min-w-0">
            {/* BLOQUE 1: CONSOLA DE PRECIO AL DETAL Y MARGEN (ESTILO SQUARE / TOAST POS) */}
            <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
                {/* Encabezado de la consola */}
                <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                            <DollarSign size={15} />
                        </span>
                        <div>
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                Precio al detal y margen comercial
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Precio por unidad individual ({formData.stockUnit || 'unidad'})
                            </p>
                        </div>
                    </div>

                    {profitUnitUsd > 0 && (
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 font-mono">
                            +${profitUnitUsd.toFixed(2)} ({calcMargin.toFixed(1)}%)
                        </span>
                    )}
                </div>

                {/* Parámetros: Costo Base y Margen Deseado */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Costo {currencyMode !== 'VES' ? '($)' : '(Bs)'}
                        </label>
                        <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold text-xs pointer-events-none">
                                {currencyMode !== 'VES' ? '$' : 'Bs'}
                            </span>
                            <input
                                type="text"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                name={currencyMode !== 'VES' ? 'cost' : 'costBs'}
                                value={currencyMode !== 'VES' ? formData.cost : formData.costBs}
                                onChange={handleChange}
                                placeholder="0.00"
                                className="w-full h-10 pl-7 pr-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-sm font-bold font-mono text-slate-900 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Margen de ganancia
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                inputMode="decimal"
                                step="any"
                                name="margin"
                                value={formData.margin}
                                onChange={handleChange}
                                placeholder="30"
                                className="w-full h-10 pl-3 pr-7 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-sm font-bold font-mono text-slate-900 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all text-right"
                                disabled={loading}
                            />
                            <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 font-bold text-xs pointer-events-none">
                                %
                            </span>
                        </div>
                    </div>
                </div>

                {/* Precios de Venta: Sincronizados y destacados */}
                <div className={`grid gap-3 ${showBsInputs ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <div>
                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5">
                            Precio de venta ($) <span className="text-blue-600">*</span>
                        </label>
                        <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 dark:text-slate-400 font-bold text-xs pointer-events-none">
                                $
                            </span>
                            <input
                                required={!formData.priceBs}
                                type="text"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                name="price"
                                value={formData.price}
                                onChange={handleChange}
                                placeholder="0.00"
                                className="w-full h-10 pl-7 pr-3 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-650 focus:border-blue-600 dark:focus:border-blue-400 rounded-lg text-sm font-black font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-xs"
                                disabled={loading}
                            />
                        </div>
                    </div>

                    {showBsInputs && (
                        <div>
                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5">
                                Precio de venta (Bs) <span className="text-blue-600">*</span>
                            </label>
                            <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 dark:text-slate-400 font-bold text-xs pointer-events-none">
                                    Bs
                                </span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    step="any"
                                    min="0"
                                    name="priceBs"
                                    value={formData.priceBs}
                                    onChange={handleChange}
                                    placeholder="0.00"
                                    className="w-full h-10 pl-9 pr-3 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-650 focus:border-blue-600 dark:focus:border-blue-400 rounded-lg text-sm font-black font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-xs"
                                    disabled={loading}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Barra de sincronización bimonetaria */}
                {showBsInputs && (
                    <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>Sincronización bimonetaria en tiempo real</span>
                        </span>
                        {rate > 1 && (
                            <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                                Tasa: 1 $ = Bs {Number(rate).toLocaleString('es-VE')}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* BLOQUE 2: PRESENTACIONES Y EMPAQUES MAYORISTAS */}
            <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                            <Package size={15} />
                        </span>
                        <div>
                            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                Presentaciones mayoristas
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {isWeightProduct
                                    ? 'Piezas enteras (Peine, Horma, Barra, Saco o Caja)'
                                    : 'Venta por caja, bulto, fardo o empaque cerrado'}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleAddPresentation}
                        className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-xs active:scale-95"
                    >
                        <Plus size={14} />
                        <span>Agregar empaque</span>
                    </button>
                </div>

                {presentations.length === 0 ? (
                    <div className="py-5 px-4 bg-slate-50/60 dark:bg-slate-850/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-750 text-center space-y-1">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            Este producto solo se vende al detal (1 unidad).
                        </p>
                        <p className="text-[11px] text-slate-400">
                            Para configurar cajas, bultos o fardos con descuento o precio especial, pulsa en <strong>Agregar empaque</strong>.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {presentations.map((pres, index) => {
                            const presPriceNum = parseFloat(pres.price) || 0;
                            const presCostNum = parseFloat(pres.cost) || 0;
                            const factor = Number(pres.factorConversion) || 1;
                            const presPriceBs = rate > 0 ? (presPriceNum * rate).toFixed(2) : '0.00';

                            const unitEqPrice = factor > 0 ? (presPriceNum / factor) : 0;
                            const profitDollars = presPriceNum - presCostNum;
                            const retailTotal = factor * unitPrice;
                            const savingsPct = retailTotal > presPriceNum && retailTotal > 0
                                ? Math.round(((retailTotal - presPriceNum) / retailTotal) * 100)
                                : 0;

                            return (
                                <div 
                                    key={pres.id || index}
                                    className="p-3.5 bg-slate-50/70 dark:bg-slate-850/60 rounded-xl border border-slate-200 dark:border-slate-750 space-y-3 transition-colors hover:border-slate-300 dark:hover:border-slate-650"
                                >
                                    {/* Encabezado de la presentación */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="w-5 h-5 rounded-md bg-slate-200 dark:bg-slate-750 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center">
                                                {index + 1}
                                            </span>
                                            <span className="font-bold text-xs text-slate-800 dark:text-slate-100">
                                                {pres.name || `Presentación #${index + 1}`}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                                <input
                                                    type="checkbox"
                                                    checked={!!pres.isDefaultPurchase}
                                                    onChange={(e) => handleUpdatePresentation(index, 'isDefaultPurchase', e.target.checked)}
                                                    className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                                                />
                                                <span>Compra habitual</span>
                                            </label>

                                            <button
                                                type="button"
                                                onClick={() => handleRemovePresentation(index)}
                                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                                title="Eliminar presentación"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Fila 1: Nombre y factor de conversión */}
                                    <div className={`grid grid-cols-1 gap-2.5 ${isWeightProduct ? 'sm:grid-cols-3' : 'sm:grid-cols-3'}`}>
                                        <div className={isWeightProduct ? 'sm:col-span-1' : 'sm:col-span-2'}>
                                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                                {isWeightProduct ? 'Nombre de la pieza' : 'Nombre del empaque'}
                                            </label>
                                            <input
                                                type="text"
                                                placeholder={isWeightProduct ? 'Ej. Peine, Horma, Pieza...' : 'Ej. Bulto x 24, Caja, Fardo...'}
                                                value={pres.name}
                                                onChange={(e) => handleUpdatePresentation(index, 'name', e.target.value)}
                                                className="w-full h-9 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1 text-center">
                                                {isWeightProduct ? 'Peso prom. (kg)' : 'Contenido (unid.)'}
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={String(pres.factorConversion ?? '').replace(/\.0{4,}$/, '').replace(/(\.\d*?[1-9])0{3,}$/, '$1')}
                                                    onChange={(e) => handleUpdatePresentation(index, 'factorConversion', e.target.value)}
                                                    onBlur={(e) => {
                                                        const parsed = parseFloat(String(e.target.value || '').replace(',', '.'));
                                                        if (!parsed || parsed <= 0) {
                                                            handleUpdatePresentation(index, 'factorConversion', 1);
                                                        } else {
                                                            handleUpdatePresentation(index, 'factorConversion', isWeightProduct ? parsed : Math.max(1, Math.round(parsed)));
                                                        }
                                                    }}
                                                    className="w-full h-9 pl-3 pr-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-center"
                                                />
                                                <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 text-[11px] font-medium pointer-events-none">
                                                    {isWeightProduct ? 'kg' : 'und'}
                                                </span>
                                            </div>
                                        </div>

                                        {isWeightProduct && (
                                            <div>
                                                <div className="flex items-center justify-between mb-1">
                                                    <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                                        Precio Kg mayor ($)
                                                    </label>
                                                    {unitPrice > 0 && (
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSuggestPrice(index, 0)}
                                                                className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                                                                title="Igualar al detal"
                                                            >
                                                                = Detal
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSuggestPrice(index, 5)}
                                                                className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                                                                title="5% menos"
                                                            >
                                                                -5%
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 font-bold text-xs pointer-events-none">$</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder={unitPrice > 0 ? unitPrice.toFixed(2) : '0.00'}
                                                        value={pres.wholesaleUnitPrice !== undefined ? pres.wholesaleUnitPrice : (unitEqPrice > 0 ? (Math.round(unitEqPrice * 100) / 100).toString() : '')}
                                                        onChange={(e) => handleUpdatePresentationUnitUsd(index, e.target.value)}
                                                        className="w-full h-9 pl-6 pr-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                    />
                                                    <span className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 text-[10px] font-medium pointer-events-none">
                                                        /kg
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Fila 2: Precios y Costos */}
                                    <div className={`grid gap-2.5 items-end ${showBsInputs ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                                                    {isWeightProduct ? `Precio ${pres.name || 'Pieza'} ($)` : 'Precio venta ($) *'}
                                                </label>
                                                {unitPrice > 0 && !isWeightProduct && (
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSuggestPrice(index, 0)}
                                                            className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                                                            title="Calcular precio exacto (Detal × Unidades)"
                                                        >
                                                            = Detal
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSuggestPrice(index, 5)}
                                                            className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                                                            title="5% de descuento por empaque"
                                                        >
                                                            -5% desc.
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="relative">
                                                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 font-bold text-xs pointer-events-none">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="0.00"
                                                    value={pres.price}
                                                    onChange={(e) => handleUpdatePresentationUsd(index, e.target.value)}
                                                    className="w-full h-9 pl-6 pr-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-650 rounded-lg text-xs font-black font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>

                                        {showBsInputs && (
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 mb-1">
                                                    Precio venta (Bs) *
                                                </label>
                                                <div className="relative">
                                                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 font-bold text-xs pointer-events-none">Bs</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="0.00"
                                                        value={pres.priceBs !== undefined ? pres.priceBs : (pres.price && rate > 0 ? (Math.round(Number(pres.price) * rate * 100) / 100).toString() : '')}
                                                        onChange={(e) => handleUpdatePresentationBs(index, e.target.value)}
                                                        className="w-full h-9 pl-8 pr-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-650 rounded-lg text-xs font-black font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                                Costo compra ($)
                                            </label>
                                            <div className="relative">
                                                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 font-bold text-xs pointer-events-none">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="0.00"
                                                    value={pres.cost}
                                                    onChange={(e) => handleUpdatePresentation(index, 'cost', e.target.value)}
                                                    className="w-full h-9 pl-6 pr-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                                    Código de barra
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => handleGenerateBarcode(index)}
                                                    className="text-[10px] font-semibold text-blue-600 hover:underline cursor-pointer"
                                                >
                                                    Generar
                                                </button>
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    placeholder="Opcional..."
                                                    value={pres.barcode || ''}
                                                    onChange={(e) => handleUpdatePresentation(index, 'barcode', e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === 'NumpadEnter') {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                        }
                                                    }}
                                                    className="w-full h-9 pl-3 pr-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                />
                                                <span className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 pointer-events-none">
                                                    <Barcode size={13} />
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Resumen comercial claro y humano */}
                                    {factor > 0 && presPriceNum > 0 && (
                                        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-750 text-xs">
                                            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                                <span>
                                                    Equivale a <strong className="text-slate-900 dark:text-white font-mono">${unitEqPrice.toFixed(2)}</strong> por {isWeightProduct ? 'kg al mayor' : (formData.stockUnit || 'unidad')}
                                                </span>
                                                {showBsInputs && <span className="text-slate-400 font-mono">(Bs {presPriceBs})</span>}
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {savingsPct > 0 && (
                                                    <span className="px-2 py-0.5 rounded-md font-bold text-[11px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                        {savingsPct}% ahorro
                                                    </span>
                                                )}
                                                {presCostNum > 0 && (
                                                    <span className={`text-[11px] font-semibold ${profitDollars >= 0 ? 'text-slate-500 dark:text-slate-400' : 'text-rose-600'}`}>
                                                        Ganancia: ${profitDollars.toFixed(2)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
