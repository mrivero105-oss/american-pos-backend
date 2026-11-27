import React, { useState, useEffect, useCallback, memo } from 'react';
import { AlertTriangle, Info, CheckCircle2, Trash2, Package, Scale, Delete, X, Percent, PauseCircle, Banknote, Zap, Plus, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import BaseModal from './BaseModal';

const ActionDialog = memo(function ActionDialog({ isOpen, onClose, type, data, onSubmit, exchangeRate = 1, currencyMode = 'BOTH' }) {
    const [inputValue, setInputValue] = useState('');
    const [secondaryValue, setSecondaryValue] = useState('');
    const [tertiaryValue, setTertiaryValue] = useState('');
    const [activeInput, setActiveInput] = useState('WEIGHT');
    const [lastEdited, setLastEdited] = useState('USD');
    const [commissionPct, setCommissionPct] = useState(() => localStorage.getItem('pos_cash_advance_pct') || '10');
    const [serviceQty, setServiceQty] = useState('1');
    const [serviceNote, setServiceNote] = useState('');
    const [selectedPackKey, setSelectedPackKey] = useState('unit');
    const [piecesSoldCount, setPiecesSoldCount] = useState('1');
    const qtyInputRef = React.useRef(null);

    const packOptions = React.useMemo(() => {
        if ((type !== 'QUANTITY_PROMPT' && type !== 'WEIGHT_PROMPT') || !data?.product) return [];
        const prod = data.product;
        const isWeighed = Boolean(prod.isSoldByWeight || prod.stockUnit === 'kg');
        const unitPrice = Number(prod.unitPrice ?? prod.basePrice ?? prod.price ?? 0);
        const list = [
            {
                key: 'unit',
                label: isWeighed ? 'Al Detal (Por Kg)' : 'Unidad Suelta',
                factor: 1,
                priceUsd: unitPrice,
                unitPriceUsd: unitPrice,
                isBulkSale: false,
                isMidBulkSale: false,
                presentation: null
            }
        ];

        const rawPres = Array.isArray(prod.Presentations) && prod.Presentations.length > 0
            ? prod.Presentations
            : (Array.isArray(prod.presentations) ? prod.presentations : []);

        if (rawPres.length > 0) {
            const sorted = [...rawPres].sort((a, b) => (Number(a.factorConversion) || 1) - (Number(b.factorConversion) || 1));
            sorted.forEach(pr => {
                const fc = Number(pr.factorConversion) || 1;
                if (!isWeighed && fc <= 1) return;
                if (fc <= 0) return;
                const totalPresUsd = Number(pr.price) > 0 ? Number(pr.price) : unitPrice * fc;
                const unitEqUsd = fc > 0 ? (totalPresUsd / fc) : unitPrice;
                list.push({
                    key: `pres_${pr.id}`,
                    label: pr.name || (isWeighed ? `Pieza (~${fc} kg)` : `Empaque x${fc}`),
                    factor: fc,
                    priceUsd: totalPresUsd,
                    unitPriceUsd: unitEqUsd,
                    isBulkSale: false,
                    isMidBulkSale: false,
                    presentation: pr
                });
            });
        } else {
            const midUnits = Number(prod.unitsPerMidBulk || 0);
            if (midUnits > (isWeighed ? 0 : 1)) {
                const totalMidUsd = Number(prod.midBulkPrice) > 0 ? Number(prod.midBulkPrice) : unitPrice * midUnits;
                list.push({
                    key: 'mid',
                    label: prod.midBulkUnitName || (isWeighed ? `Media Pieza (~${midUnits} kg)` : `Media Caja (x${midUnits})`),
                    factor: midUnits,
                    priceUsd: totalMidUsd,
                    unitPriceUsd: midUnits > 0 ? (totalMidUsd / midUnits) : unitPrice,
                    isBulkSale: false,
                    isMidBulkSale: true,
                    presentation: null
                });
            }
            const bulkUnits = Number(prod.unitsPerBulk || 1);
            if (bulkUnits > 1 || (isWeighed && bulkUnits > 0 && Number(prod.bulkPrice) > 0)) {
                const totalBulkUsd = Number(prod.bulkPrice) > 0 ? Number(prod.bulkPrice) : unitPrice * bulkUnits;
                list.push({
                    key: 'bulk',
                    label: prod.bulkUnitName || (isWeighed ? `Pieza (~${bulkUnits} kg)` : `Caja / Bulto (x${bulkUnits})`),
                    factor: bulkUnits,
                    priceUsd: totalBulkUsd,
                    unitPriceUsd: bulkUnits > 0 ? (totalBulkUsd / bulkUnits) : unitPrice,
                    isBulkSale: true,
                    isMidBulkSale: false,
                    presentation: null
                });
            }
        }
        return list;
    }, [type, data]);

    const { title, description, icon, isConfirmOnly, confirmText, cancelText, variant } = React.useMemo(() => {
        if (!isOpen) return { title: '', description: '', icon: null, isConfirmOnly: false, confirmText: '', cancelText: '', variant: 'primary' };
        let t = '';
        let d = '';
        let i = <Info size={20} />;
        let confirm = false;
        let ct = 'Confirmar';
        let clt = 'Cancelar';
        let v = 'primary'; 

        switch (type) {
            case 'QUANTITY_PROMPT':
                t = data?.product?.originalName || data?.product?.name || 'Cantidad a agregar';
                d = data?.isEditingCart
                    ? 'Modifica la cantidad de este producto en el ticket.'
                    : 'Indica la cantidad que deseas agregar al carrito.';
                i = <Package size={20} />;
                ct = data?.isEditingCart ? 'Actualizar cantidad' : 'Agregar al carrito';
                v = 'primary';
                break;
            case 'ADD_MANUAL':
                t = 'Artículo o concepto manual';
                d = 'Ingresa la descripción y el precio para sumarlo al ticket actual.';
                i = <Package size={20} />;
                ct = 'Agregar al ticket';
                break;
            case 'CASH_ADVANCE_PROMPT':
                t = data?.product?.name || 'Avance de Efectivo';
                d = 'Indica el efectivo entregado al cliente y el % de comisión.';
                i = <Banknote size={20} />;
                ct = data?.isEditingCart ? 'Actualizar avance' : 'Agregar al ticket';
                v = 'primary';
                break;
            case 'SERVICE_PRICE_PROMPT':
                t = data?.product?.name || 'Cobro de servicio';
                d = 'Ingresa el monto a cobrar en Bolívares o Dólares.';
                i = <Zap size={20} />;
                ct = data?.isEditingCart ? 'Actualizar servicio' : 'Agregar al ticket';
                v = 'primary';
                break;
            case 'WEIGHT_PROMPT': {
                const isWeighed = Boolean(data?.product?.isSoldByWeight || data?.product?.stockUnit === 'kg');
                t = isWeighed ? (data?.isEditingCart ? 'Ajustar pesaje' : 'Pesaje de producto') : 'Cantidad a agregar';
                d = data?.product?.name ? data.product.name : 'Ingresa el peso o monto a despachar';
                i = isWeighed ? <Scale size={20} /> : <Package size={20} />;
                ct = isWeighed ? (data?.isEditingCart ? 'Actualizar peso' : 'Agregar al ticket') : 'Aceptar';
                v = isWeighed ? 'warning' : 'primary';
                break;
            }
            case 'DISCOUNT_PROMPT':
                t = 'Descuento general';
                d = 'Indica el porcentaje de descuento a aplicar sobre el ticket.';
                i = <Percent size={20} />;
                ct = 'Aplicar descuento';
                break;
            case 'HOLD_SALE':
                t = 'Pausar cuenta';
                d = 'Asigna una nota o referencia para identificar este ticket en espera.';
                i = <PauseCircle size={20} />;
                ct = 'Guardar en espera';
                break;
            case 'CONFIRM_CLEAR_CART':
                t = 'Vaciar ticket de venta';
                d = 'Se quitarán todos los productos cargados en la cuenta actual.';
                i = <Trash2 size={20} />;
                confirm = true;
                ct = 'Vaciar ticket';
                v = 'danger';
                break;
            case 'CONFIRM_RESTORE_HELD':
                t = 'Restaurar cuenta en espera';
                d = 'El carrito actual será reemplazado por los productos de la cuenta seleccionada.';
                i = <AlertTriangle size={20} />;
                confirm = true;
                ct = 'Reemplazar carrito';
                v = 'warning';
                break;
            case 'CONFIRM_REMOVE_HELD':
                t = 'Descartar cuenta en espera';
                d = 'Esta cuenta pausada se eliminará de forma definitiva.';
                i = <Trash2 size={20} />;
                confirm = true;
                ct = 'Eliminar cuenta';
                v = 'danger';
                break;
            case 'CONVERT_NOTE':
                t = 'Facturar nota de entrega';
                d = 'La nota de entrega se convertirá en una factura de venta final.';
                i = <CheckCircle2 size={20} />;
                confirm = true;
                ct = 'Confirmar venta';
                v = 'primary';
                break;
            case 'CANCEL_NOTE':
                t = 'Anular nota de entrega';
                d = 'Se anulará el documento y el stock retornará automáticamente al inventario.';
                i = <AlertTriangle size={20} />;
                confirm = true;
                ct = 'Anular nota';
                v = 'danger';
                break;
            case 'INFO':
                t = 'Aviso del sistema';
                d = data?.message || 'Información importante';
                confirm = true;
                ct = 'Entendido';
                clt = '';
                break;
            default:
                break;
        }
        return { title: t, description: d, icon: i, isConfirmOnly: confirm, confirmText: ct, cancelText: clt, variant: v };
    }, [type, data, isOpen]);

    const handleSubmit = useCallback((e) => {
        if (e && e.preventDefault) e.preventDefault();
        
        if (type === 'ADD_MANUAL') {
            const priceUSD = parseFloat(secondaryValue) || 0;
            const priceBS = parseFloat(tertiaryValue) || 0;
            let price = priceUSD;
            if (lastEdited === 'VES' && priceBS > 0) {
                price = priceBS / exchangeRate;
            }
            onSubmit({ name: inputValue, price });
        } else if (type === 'CASH_ADVANCE_PROMPT') {
            const cashBs = parseFloat(String(tertiaryValue || '').replace(',', '.'));
            if (isNaN(cashBs) || cashBs <= 0) return toast.error('Ingresa el monto en Bs a entregar');
            const pct = Math.max(0, parseFloat(String(commissionPct || '0').replace(',', '.')) || 0);
            try { localStorage.setItem('pos_cash_advance_pct', String(pct)); } catch (caughtErr) { console.warn('[ActionDialog] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
            const commissionBs = cashBs * (pct / 100);
            const totalBs = cashBs + commissionBs;
            const rate = exchangeRate > 0 ? exchangeRate : 1;
            const priceUsd = totalBs / rate;
            const costUsd = cashBs / rate;
            onSubmit({
                product: data.product,
                cashBs,
                commissionPct: pct,
                commissionBs,
                totalBs,
                priceUsd,
                costUsd,
                isEditingCart: data?.isEditingCart,
                cartItemId: data?.cartItemId
            });
        } else if (type === 'SERVICE_PRICE_PROMPT') {
            const priceUSD = parseFloat(String(secondaryValue || '').replace(',', '.')) || 0;
            const priceBS = parseFloat(String(tertiaryValue || '').replace(',', '.')) || 0;
            const rate = exchangeRate > 0 ? exchangeRate : 1;
            let unitPriceUsd = priceUSD;
            if (lastEdited === 'VES' && priceBS > 0) {
                unitPriceUsd = priceBS / rate;
            }
            if (unitPriceUsd <= 0) return toast.error('Ingresa un monto válido para el servicio');
            const qty = Math.max(1, parseFloat(String(serviceQty || '1').replace(',', '.')) || 1);
            onSubmit({
                product: data.product,
                priceUsd: unitPriceUsd,
                quantity: qty,
                note: String(serviceNote || '').trim(),
                isEditingCart: data?.isEditingCart,
                cartItemId: data?.cartItemId
            });
        } else if (type === 'QUANTITY_PROMPT') {
            const parsed = parseFloat(String(inputValue || '').replace(',', '.'));
            if (isNaN(parsed) || parsed <= 0) return toast.error('Ingresa una cantidad mayor a 0');
            const chosenPack = packOptions.find(p => p.key === selectedPackKey) || packOptions[0] || {
                factor: 1,
                isBulkSale: Boolean(data?.isBulkSale),
                isMidBulkSale: Boolean(data?.isMidBulkSale),
                presentation: data?.presentation || null
            };
            const prod = data?.product;
            const isService = Boolean(prod?.isService || String(prod?.category || '').trim().toLowerCase() === 'servicios');
            if (prod && !isService && !prod.allowNegative && prod.stockQuantity !== '∞' && prod.stockQuantity !== undefined && prod.stockQuantity !== null) {
                const maxStock = Number(prod.stockQuantity);
                const inCartOther = Number(data?.alreadyInCartUnits || 0);
                const availableUnits = Math.max(0, Math.round((maxStock - inCartOther) * 1000) / 1000);
                const requestedUnits = parsed * (Number(chosenPack.factor) || 1);
                if (!isNaN(maxStock) && requestedUnits > availableUnits + 0.0001) {
                    return toast.error(`Stock insuficiente: solo hay ${availableUnits} ${prod.stockUnit || 'un'} disponibles`);
                }
            }
            onSubmit({
                quantity: parsed,
                product: data.product,
                isBulkSale: Boolean(chosenPack.isBulkSale),
                isMidBulkSale: Boolean(chosenPack.isMidBulkSale),
                presentation: chosenPack.presentation || null,
                isEditingCart: Boolean(data?.isEditingCart),
                cartItemId: data?.cartItemId || null
            });
        } else if (type === 'WEIGHT_PROMPT') {
            const parsed = parseFloat(String(inputValue || '').replace(',', '.'));
            if (isNaN(parsed) || parsed <= 0) return toast.error('Ingrese un peso o cantidad válida');
            const chosenPack = packOptions.find(p => p.key === selectedPackKey) || packOptions[0];
            const isWholesaleWeight = Boolean(chosenPack && chosenPack.key !== 'unit');
            const piecesToSell = isWholesaleWeight ? Math.max(1, parseFloat(String(piecesSoldCount || '1').replace(',', '.')) || 1) : 0;
            const prod = data?.product;
            const isService = Boolean(prod?.isService || String(prod?.category || '').trim().toLowerCase() === 'servicios');
            if (prod && !isService && !prod.allowNegative && prod.stockQuantity !== '∞' && prod.stockQuantity !== undefined && prod.stockQuantity !== null) {
                const maxStockKg = Number(prod.stockQuantity);
                const inCartOtherKg = Number(data?.alreadyInCartUnits || 0);
                const availableKg = Math.max(0, Math.round((maxStockKg - inCartOtherKg) * 1000) / 1000);
                if (!isNaN(maxStockKg) && parsed > availableKg + 0.0001) {
                    return toast.error(`Stock insuficiente: solo hay ${availableKg} ${prod.stockUnit || 'kg'} disponibles en stock`);
                }
                const maxPieces = prod.stockUnits !== undefined && prod.stockUnits !== null && Number(prod.stockUnits) > 0
                    ? Number(prod.stockUnits)
                    : null;
                if (isWholesaleWeight && maxPieces !== null && piecesToSell > maxPieces + 0.01) {
                    return toast.error(`Stock insuficiente: solo queda(n) ${maxPieces} ${chosenPack.label}(s) en stock`);
                }
            }
            onSubmit({
                weight: parsed,
                product: data.product,
                isEditingCart: data?.isEditingCart,
                cartItemId: data?.cartItemId || null,
                isWholesaleWeight,
                presentation: isWholesaleWeight ? (chosenPack.presentation || null) : null,
                wholesaleUnitPrice: isWholesaleWeight ? Number(chosenPack.unitPriceUsd) : null,
                pieceFactor: isWholesaleWeight ? Number(chosenPack.factor) : null,
                pieceLabel: isWholesaleWeight ? chosenPack.label : null,
                piecesSold: piecesToSell
            });
        } else if (type === 'DISCOUNT_PROMPT') {
            const pct = parseFloat(inputValue);
            if (isNaN(pct) || pct < 0 || pct > 100) return toast.error('Porcentaje inválido');
            onSubmit({ pct });
        } else if (type === 'HOLD_SALE') {
            onSubmit({ note: inputValue });
        } else if (isConfirmOnly) {
            onSubmit(true);
        }
    }, [type, data, exchangeRate, inputValue, secondaryValue, tertiaryValue, lastEdited, commissionPct, serviceQty, serviceNote, selectedPackKey, piecesSoldCount, packOptions, onSubmit, isConfirmOnly]);

    useEffect(() => {
        if (isOpen) {
            const defVal = data?.defaultValue !== undefined && data?.defaultValue !== null ? String(data.defaultValue) : (type === 'QUANTITY_PROMPT' ? '1' : '');
            setInputValue(defVal);
            const productPrice = Number(data?.product?.price || 0);
            const parsed = parseFloat(defVal.replace(',', '.'));
            if (type === 'QUANTITY_PROMPT' || type === 'WEIGHT_PROMPT') {
                let initialPackKey = 'unit';
                if (data?.presentation?.id) {
                    initialPackKey = `pres_${data.presentation.id}`;
                } else if (data?.isBulkSale) {
                    initialPackKey = 'bulk';
                } else if (data?.isMidBulkSale) {
                    initialPackKey = 'mid';
                }
                setSelectedPackKey(initialPackKey);
                if (data?.piecesToDeduct) {
                    setPiecesSoldCount(String(data.piecesToDeduct));
                } else {
                    setPiecesSoldCount('1');
                }

                if (type === 'QUANTITY_PROMPT') {
                    setTimeout(() => {
                        if (qtyInputRef.current) {
                            qtyInputRef.current.focus();
                            qtyInputRef.current.select();
                        }
                    }, 30);
                } else {
                    const matchedPack = packOptions.find(p => p.key === initialPackKey) || packOptions[0];
                    const activePrice = matchedPack ? Number(matchedPack.unitPriceUsd || productPrice) : productPrice;
                    let startWeight = parsed;
                    if ((isNaN(startWeight) || startWeight <= 0) && matchedPack && matchedPack.key !== 'unit' && matchedPack.factor > 0) {
                        startWeight = Number(matchedPack.factor);
                        setInputValue(startWeight.toFixed(3));
                    }
                    if (!isNaN(startWeight) && startWeight > 0 && activePrice > 0) {
                        const usd = startWeight * activePrice;
                        setSecondaryValue(usd.toFixed(2));
                        setTertiaryValue((usd * exchangeRate).toFixed(2));
                    } else {
                        setSecondaryValue('');
                        setTertiaryValue('');
                    }
                    setActiveInput('WEIGHT');
                    setLastEdited('USD');
                }
            } else if (type === 'CASH_ADVANCE_PROMPT') {
                const savedPct = localStorage.getItem('pos_cash_advance_pct') || '10';
                setCommissionPct(data?.commissionPct !== undefined ? String(data.commissionPct) : savedPct);
                const initCashBs = data?.cashBs ? String(data.cashBs) : '';
                setTertiaryValue(initCashBs);
                setSecondaryValue(initCashBs && exchangeRate > 0 ? (parseFloat(initCashBs) / exchangeRate).toFixed(2) : '');
                setLastEdited('VES');
            } else if (type === 'SERVICE_PRICE_PROMPT') {
                setServiceQty(data?.quantity ? String(data.quantity) : '1');
                setServiceNote(data?.note || '');
                if (data?.priceUsd && data.priceUsd > 0) {
                    setSecondaryValue(Number(data.priceUsd).toFixed(2));
                    setTertiaryValue((Number(data.priceUsd) * exchangeRate).toFixed(2));
                } else {
                    setSecondaryValue('');
                    setTertiaryValue('');
                }
                setLastEdited(currencyMode === 'USD' ? 'USD' : 'VES');
            } else if (!isNaN(parsed) && productPrice > 0) {
                const usd = parsed * productPrice;
                setSecondaryValue(usd.toFixed(2));
                setTertiaryValue((usd * exchangeRate).toFixed(2));
                setActiveInput('WEIGHT');
                setLastEdited('USD');
            } else {
                setSecondaryValue('');
                setTertiaryValue('');
                setActiveInput('WEIGHT');
                setLastEdited('USD');
            }
        }
    }, [isOpen, type, data, exchangeRate, currencyMode, packOptions]);

    useEffect(() => {
        if (isOpen) {
            const handleKeys = (e) => {
                if (e.key === 'Escape' || e.key === 'Esc') {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                    return;
                }
                
                const isTextInput = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';
                const isSpace = e.key === ' ' || e.code === 'Space';
                const isEnter = e.key === 'Enter';

                if (isEnter || (isSpace && (!isTextInput || isConfirmOnly))) {
                    if (!isTextInput || isConfirmOnly) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSubmit(e);
                    }
                }
            };
            window.addEventListener('keydown', handleKeys, true);
            return () => window.removeEventListener('keydown', handleKeys, true);
        }
    }, [isOpen, onClose, isConfirmOnly, handleSubmit]);

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth={(type === 'WEIGHT_PROMPT' || type === 'QUANTITY_PROMPT' || type === 'CASH_ADVANCE_PROMPT' || type === 'SERVICE_PRICE_PROMPT') ? 'max-w-[460px]' : 'max-w-[420px]'}
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xl flex flex-col max-h-[90dvh]"
        >
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* Header */}
                <div className="px-5 pt-5 pb-4 flex items-start gap-3.5 relative">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        variant === 'danger'
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200/70 dark:border-rose-900/50'
                            : variant === 'warning'
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200/70 dark:border-amber-900/50'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700'
                    }`}>
                        {React.cloneElement(icon, { size: 19, strokeWidth: 2 })}
                    </div>

                    <div className="flex-1 min-w-0 pr-6">
                        <h2 className="text-base sm:text-[17px] font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                            {title}
                        </h2>
                        <p className="text-xs sm:text-[13px] font-normal text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                            {description}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        aria-label="Cerrar"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable Body (only rendered when there are inputs/controls) */}
                {!isConfirmOnly && (
                    <div className="px-5 pb-5 flex-1 overflow-y-auto space-y-4">
                        {type === 'QUANTITY_PROMPT' && (() => {
                            const prod = data?.product || {};
                            const rate = exchangeRate > 0 ? exchangeRate : 1;
                            const chosenPack = packOptions.find(p => p.key === selectedPackKey) || packOptions[0] || {
                                key: 'unit',
                                label: 'Unidad Suelta',
                                factor: 1,
                                priceUsd: Number(prod.price) || 0
                            };
                            const packPriceUsd = Number(chosenPack.priceUsd) || 0;
                            const qtyNum = Math.max(0, parseFloat(String(inputValue || '0').replace(',', '.')) || 0);
                            const subtotalUsd = qtyNum * packPriceUsd;
                            const subtotalBs = subtotalUsd * rate;
                            const totalUnitsNeeded = qtyNum * (Number(chosenPack.factor) || 1);
                            const maxStockUnits = prod.stockQuantity !== undefined && prod.stockQuantity !== '∞'
                                ? Number(prod.stockQuantity)
                                : null;
                            const maxPacksAvailable = (maxStockUnits !== null && !isNaN(maxStockUnits) && chosenPack.factor > 0)
                                ? Math.floor(maxStockUnits / chosenPack.factor)
                                : null;

                            const quickQtys = [1, 2, 3, 5, 6, 10, 12];

                            const applyQty = (val) => {
                                const nextVal = Math.max(1, val);
                                setInputValue(String(nextVal));
                                if (qtyInputRef.current) {
                                    qtyInputRef.current.focus();
                                    qtyInputRef.current.select();
                                }
                            };

                            return (
                                <div className="space-y-3.5 text-left">
                                    {/* Selector de Presentación / Empaque (si el producto tiene empaques y no está editando una fila fija) */}
                                    {packOptions.length > 1 && !data?.isEditingCart && (
                                        <div>
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                                Presentación a despachar
                                            </label>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {packOptions.map((opt) => {
                                                    const isSelected = opt.key === chosenPack.key;
                                                    const optBs = (Number(opt.priceUsd) || 0) * rate;
                                                    return (
                                                        <button
                                                            key={opt.key}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedPackKey(opt.key);
                                                                if (qtyInputRef.current) {
                                                                    qtyInputRef.current.focus();
                                                                    qtyInputRef.current.select();
                                                                }
                                                            }}
                                                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                                                isSelected
                                                                    ? 'bg-blue-600/10 dark:bg-blue-500/15 border-blue-600 dark:border-blue-400 text-slate-900 dark:text-white ring-1 ring-blue-500/30'
                                                                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                            }`}
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="text-xs font-extrabold truncate">
                                                                    {opt.label}
                                                                </div>
                                                                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                                    {opt.factor === 1 ? '1 unidad' : `${opt.factor} unidades`}
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <div className="text-xs font-black tabular-nums">
                                                                    {currencyMode === 'USD'
                                                                        ? `$${Number(opt.priceUsd).toFixed(2)}`
                                                                        : `Bs ${optBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                                                </div>
                                                                {currencyMode !== 'USD' && (
                                                                    <div className="text-[10px] font-bold text-slate-400 tabular-nums">
                                                                        ${Number(opt.priceUsd).toFixed(2)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Control Principal de Cantidad */}
                                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                Cantidad ({chosenPack.label})
                                            </span>
                                            {maxPacksAvailable !== null && (
                                                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                                    Disponible: {maxPacksAvailable} {chosenPack.factor > 1 ? `(${maxStockUnits} un)` : 'un'}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2.5">
                                            <button
                                                type="button"
                                                onClick={() => applyQty((parseFloat(inputValue) || 1) - 1)}
                                                className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 active:scale-95 transition-all cursor-pointer shrink-0 shadow-2xs"
                                                title="Restar 1"
                                            >
                                                <Minus size={18} strokeWidth={2.5} />
                                            </button>

                                            <input
                                                ref={qtyInputRef}
                                                type="number"
                                                inputMode="numeric"
                                                min="1"
                                                step="1"
                                                autoFocus
                                                value={inputValue}
                                                onFocus={e => e.target.select()}
                                                onChange={e => setInputValue(e.target.value)}
                                                className="w-full h-12 text-center bg-white dark:bg-slate-900 border-2 border-blue-500/70 dark:border-blue-500/60 rounded-xl font-black text-2xl text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 tabular-nums"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => applyQty((parseFloat(inputValue) || 0) + 1)}
                                                className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 active:scale-95 transition-all cursor-pointer shrink-0 shadow-2xs"
                                                title="Sumar 1"
                                            >
                                                <Plus size={18} strokeWidth={2.5} />
                                            </button>
                                        </div>

                                        {/* Botones rápidos de cantidad */}
                                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                            {quickQtys.map(q => {
                                                const isActive = Number(inputValue) === q;
                                                const exceedsStock = !prod.allowNegative && maxPacksAvailable !== null && q > maxPacksAvailable;
                                                return (
                                                    <button
                                                        key={q}
                                                        type="button"
                                                        disabled={exceedsStock}
                                                        onClick={() => applyQty(q)}
                                                        className={`flex-1 min-w-[38px] py-1.5 rounded-lg text-xs font-extrabold border transition-all cursor-pointer ${
                                                            exceedsStock
                                                                ? 'opacity-35 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                                                                : isActive
                                                                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white shadow-2xs'
                                                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                        }`}
                                                    >
                                                        {q}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Resumen de Subtotal */}
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                                Subtotal ({qtyNum || 0} {chosenPack.factor > 1 ? `${chosenPack.label} = ${totalUnitsNeeded} un` : (qtyNum === 1 ? 'unidad' : 'unidades')})
                                            </span>
                                            <span className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums">
                                                {currencyMode === 'USD'
                                                    ? `$${subtotalUsd.toFixed(2)} USD`
                                                    : `Bs ${subtotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                            </span>
                                        </div>
                                        {currencyMode !== 'USD' && (
                                            <div className="text-right">
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-xs font-extrabold font-mono text-blue-700 dark:text-blue-300 tabular-nums">
                                                    ${subtotalUsd.toFixed(2)} USD
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {type === 'ADD_MANUAL' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                        Descripción
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        autoFocus
                                        value={inputValue}
                                        onChange={e => setInputValue(e.target.value)}
                                        placeholder="Ej. Servicio o producto varios"
                                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-slate-900 dark:text-white font-semibold text-sm transition-all"
                                    />
                                </div>
                                <div className={`grid ${currencyMode === 'USD' ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                            Precio (USD)
                                        </label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={secondaryValue}
                                            onChange={e => {
                                                setLastEdited('USD');
                                                const val = e.target.value.replace(',', '.');
                                                setSecondaryValue(e.target.value);
                                                const parsed = parseFloat(val);
                                                if (!isNaN(parsed) && exchangeRate > 0) {
                                                    setTertiaryValue((parsed * exchangeRate).toFixed(2));
                                                } else if (!val) setTertiaryValue('');
                                            }}
                                            placeholder="0.00 $"
                                            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all tabular-nums"
                                        />
                                    </div>
                                    {currencyMode !== 'USD' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                                Precio (Bs)
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={tertiaryValue}
                                                onChange={e => {
                                                    setLastEdited('VES');
                                                    const val = e.target.value.replace(',', '.');
                                                    setTertiaryValue(e.target.value);
                                                    const parsed = parseFloat(val);
                                                    if (!isNaN(parsed) && exchangeRate > 0) {
                                                        setSecondaryValue((parsed / exchangeRate).toFixed(3));
                                                    } else if (!val) setSecondaryValue('');
                                                }}
                                                placeholder="0.00 Bs"
                                                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-emerald-600 dark:text-emerald-400 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all tabular-nums"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {type === 'CASH_ADVANCE_PROMPT' && (() => {
                            const cashBs = Math.max(0, parseFloat(String(tertiaryValue || '0').replace(',', '.')) || 0);
                            const pct = Math.max(0, parseFloat(String(commissionPct || '0').replace(',', '.')) || 0);
                            const commissionBs = cashBs * (pct / 100);
                            const totalBs = cashBs + commissionBs;
                            const rate = exchangeRate > 0 ? exchangeRate : 1;
                            const cashUsd = cashBs / rate;
                            const commissionUsd = commissionBs / rate;
                            const totalUsd = totalBs / rate;

                            const quickBsAmounts = [200, 500, 1000, 2000, 5000];
                            const quickPcts = [5, 8, 10, 12, 15];

                            const applyCashBs = (valBs) => {
                                const strVal = String(valBs);
                                setTertiaryValue(strVal);
                                setSecondaryValue(rate > 0 ? (Number(valBs) / rate).toFixed(2) : '');
                                setLastEdited('VES');
                            };

                            return (
                                <div className="space-y-3.5 text-left">
                                    {/* Monto a entregar en Bs */}
                                    <div className="rounded-xl border border-emerald-500/70 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                                Efectivo a entregar al cliente (Bs)
                                            </label>
                                            {cashUsd > 0 && (
                                                <span className="text-[11px] font-semibold font-mono text-slate-500 dark:text-slate-400">
                                                    ≈ ${cashUsd.toFixed(2)} USD
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-400">Bs</span>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                required
                                                autoFocus
                                                value={tertiaryValue}
                                                onChange={e => {
                                                    const raw = e.target.value;
                                                    setTertiaryValue(raw);
                                                    setLastEdited('VES');
                                                    const parsed = parseFloat(raw.replace(',', '.'));
                                                    if (!isNaN(parsed) && rate > 0) {
                                                        setSecondaryValue((parsed / rate).toFixed(2));
                                                    } else {
                                                        setSecondaryValue('');
                                                    }
                                                }}
                                                placeholder="Ej. 1000"
                                                className="w-full bg-transparent font-black text-2xl sm:text-3xl text-slate-900 dark:text-white outline-none tabular-nums"
                                            />
                                        </div>
                                        {/* Botones rápidos de montos en Bs */}
                                        <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/40">
                                            {quickBsAmounts.map(amt => (
                                                <button
                                                    key={amt}
                                                    type="button"
                                                    onClick={() => applyCashBs(amt)}
                                                    className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                                        Math.abs(cashBs - amt) < 0.01
                                                            ? 'bg-emerald-600 text-white'
                                                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                                                    }`}
                                                >
                                                    Bs {amt.toLocaleString('es-VE')}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Porcentaje de Comisión */}
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                                Comisión del servicio (%)
                                            </label>
                                            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 w-24">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={commissionPct}
                                                    onChange={e => setCommissionPct(e.target.value)}
                                                    className="w-full bg-transparent text-right font-extrabold text-sm text-slate-900 dark:text-white outline-none tabular-nums"
                                                />
                                                <span className="text-xs font-bold text-slate-400">%</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {quickPcts.map(p => (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() => setCommissionPct(String(p))}
                                                    className={`flex-1 min-w-[48px] py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                                                        Math.abs(pct - p) < 0.01
                                                            ? 'bg-sky-600 text-white shadow-2xs'
                                                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                    }`}
                                                >
                                                    {p}%
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Desglose Contable en Vivo */}
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-3.5 space-y-2 shadow-2xs">
                                        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                                            <span>Efectivo entregado de caja (Costo base):</span>
                                            <span className="font-bold font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                                                Bs {cashBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-400">
                                            <span className="font-semibold">Ganancia por comisión ({pct}%):</span>
                                            <span className="font-extrabold font-mono tabular-nums">
                                                + Bs {commissionBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${commissionUsd.toFixed(2)})
                                            </span>
                                        </div>
                                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                            <div>
                                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                                    Total a cobrar (Punto / Pago Móvil)
                                                </span>
                                                <span className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums">
                                                    Bs {totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <span className="inline-flex items-center px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-xs font-extrabold font-mono text-sky-700 dark:text-sky-300 tabular-nums">
                                                    ${totalUsd.toFixed(2)} USD
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {type === 'SERVICE_PRICE_PROMPT' && (() => {
                            const rate = exchangeRate > 0 ? exchangeRate : 1;
                            const unitUsd = parseFloat(String(secondaryValue || '0').replace(',', '.')) || 0;
                            const unitBs = parseFloat(String(tertiaryValue || '0').replace(',', '.')) || 0;
                            const qty = Math.max(1, parseFloat(String(serviceQty || '1').replace(',', '.')) || 1);
                            const totalBs = (lastEdited === 'VES' ? unitBs : unitUsd * rate) * qty;
                            const totalUsd = (lastEdited === 'VES' ? (unitBs / rate) : unitUsd) * qty;

                            return (
                                <div className="space-y-3.5 text-left">
                                    {/* Inputs sincronizados Bs / USD */}
                                    <div className={`grid ${currencyMode === 'USD' ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
                                        {currencyMode !== 'USD' && (
                                            <div className={`rounded-xl border p-3 transition-colors ${lastEdited === 'VES' ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'}`}>
                                                <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                                                    Precio en Bs (VES)
                                                </label>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">Bs</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        autoFocus={currencyMode !== 'USD'}
                                                        value={tertiaryValue}
                                                        onFocus={() => setLastEdited('VES')}
                                                        onChange={e => {
                                                            setLastEdited('VES');
                                                            const raw = e.target.value;
                                                            setTertiaryValue(raw);
                                                            const parsed = parseFloat(raw.replace(',', '.'));
                                                            if (!isNaN(parsed) && rate > 0) {
                                                                setSecondaryValue((parsed / rate).toFixed(3));
                                                            } else if (!raw) {
                                                                setSecondaryValue('');
                                                            }
                                                        }}
                                                        placeholder="0.00"
                                                        className="w-full bg-transparent font-black text-xl text-slate-900 dark:text-white outline-none tabular-nums"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        <div className={`rounded-xl border p-3 transition-colors ${lastEdited === 'USD' ? 'border-sky-500 bg-sky-50/40 dark:bg-sky-950/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'}`}>
                                            <label className="block text-[11px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400 mb-1">
                                                Precio en $ (USD)
                                            </label>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-extrabold text-sky-600 dark:text-sky-400">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    autoFocus={currencyMode === 'USD'}
                                                    value={secondaryValue}
                                                    onFocus={() => setLastEdited('USD')}
                                                    onChange={e => {
                                                        setLastEdited('USD');
                                                        const raw = e.target.value;
                                                        setSecondaryValue(raw);
                                                        const parsed = parseFloat(raw.replace(',', '.'));
                                                        if (!isNaN(parsed) && rate > 0) {
                                                            setTertiaryValue((parsed * rate).toFixed(2));
                                                        } else if (!raw) {
                                                            setTertiaryValue('');
                                                        }
                                                    }}
                                                    placeholder="0.00"
                                                    className="w-full bg-transparent font-black text-xl text-slate-900 dark:text-white outline-none tabular-nums"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Cantidad y Detalle opcional */}
                                    <div className="grid grid-cols-12 gap-3">
                                        <div className="col-span-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-2.5">
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                                                Cantidad
                                            </label>
                                            <div className="flex items-center justify-between gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setServiceQty(String(Math.max(1, (parseFloat(serviceQty) || 1) - 1)))}
                                                    className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                                                >
                                                    <Minus size={13} />
                                                </button>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={serviceQty}
                                                    onChange={e => setServiceQty(e.target.value)}
                                                    className="w-12 text-center bg-transparent font-extrabold text-sm text-slate-900 dark:text-white outline-none tabular-nums"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setServiceQty(String((parseFloat(serviceQty) || 1) + 1))}
                                                    className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                                                >
                                                    <Plus size={13} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="col-span-7 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-2.5">
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                                                Detalle (Opcional)
                                            </label>
                                            <input
                                                type="text"
                                                value={serviceNote}
                                                onChange={e => setServiceNote(e.target.value)}
                                                placeholder="Ej. Color, B/N, Escaneo..."
                                                className="w-full bg-transparent font-semibold text-xs sm:text-sm text-slate-900 dark:text-white outline-none"
                                            />
                                        </div>
                                    </div>

                                    {/* Resumen del Total del Servicio */}
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                                        <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                                                Total a cobrar ({qty} {qty === 1 ? 'servicio' : 'servicios'})
                                            </span>
                                            <span className="text-base font-black text-slate-900 dark:text-white font-mono tabular-nums">
                                                Bs {totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 text-xs font-extrabold font-mono text-sky-700 dark:text-sky-300 tabular-nums">
                                                ${totalUsd.toFixed(2)} USD
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {type === 'WEIGHT_PROMPT' && (() => {
                            const chosenPack = packOptions.find(p => p.key === selectedPackKey) || packOptions[0];
                            const isWholesalePack = Boolean(chosenPack && chosenPack.key !== 'unit');
                            const baseRetailPrice = Number(data?.product?.basePrice ?? data?.product?.unitPrice ?? data?.product?.price ?? 0);
                            const productPrice = isWholesalePack
                                ? Number(chosenPack.unitPriceUsd || baseRetailPrice)
                                : baseRetailPrice;
                            const weightUnit = data?.product?.stockUnit || 'kg';
                            const currentStock = data?.product?.stockQuantity !== undefined && data?.product?.stockQuantity !== '∞'
                                ? Number(data?.product?.stockQuantity)
                                : null;
                            const priceBs = productPrice * exchangeRate;
                            const primaryWholesalePack = packOptions.find(p => p.key !== 'unit');
                            const exactStockUnits = data?.product?.stockUnits !== undefined && data?.product?.stockUnits !== null && Number(data?.product?.stockUnits) > 0
                                ? Number(data.product.stockUnits)
                                : null;
                            const stockPieces = exactStockUnits !== null
                                ? exactStockUnits
                                : ((currentStock !== null && !isNaN(currentStock) && primaryWholesalePack && primaryWholesalePack.factor > 0)
                                    ? Math.round((currentStock / primaryWholesalePack.factor) * 10) / 10
                                    : null);

                            const presets = isWholesalePack && chosenPack.factor > 0
                                ? [
                                    { label: `1 ${chosenPack.label} (~${Number(chosenPack.factor).toFixed(2)}kg)`, val: Number(chosenPack.factor) * 1, pieces: 1 },
                                    { label: `2 ${chosenPack.label}s (~${(Number(chosenPack.factor) * 2).toFixed(2)}kg)`, val: Number(chosenPack.factor) * 2, pieces: 2 },
                                    { label: `3 ${chosenPack.label}s (~${(Number(chosenPack.factor) * 3).toFixed(2)}kg)`, val: Number(chosenPack.factor) * 3, pieces: 3 },
                                    { label: `5 ${chosenPack.label}s (~${(Number(chosenPack.factor) * 5).toFixed(2)}kg)`, val: Number(chosenPack.factor) * 5, pieces: 5 },
                                    { label: `10 ${chosenPack.label}s (~${(Number(chosenPack.factor) * 10).toFixed(2)}kg)`, val: Number(chosenPack.factor) * 10, pieces: 10 },
                                ]
                                : [
                                    { label: '100g', val: 0.1 },
                                    { label: '250g', val: 0.25 },
                                    { label: '500g', val: 0.5 },
                                    { label: '750g', val: 0.75 },
                                    { label: '1 kg', val: 1.0 },
                                    { label: '1.5 kg', val: 1.5 },
                                    { label: '2 kg', val: 2.0 },
                                ];

                            const handleSelectWeightMode = (pack) => {
                                setSelectedPackKey(pack.key);
                                setPiecesSoldCount('1');
                                const nextPrice = Number(pack.unitPriceUsd || baseRetailPrice);
                                const currentW = parseFloat(String(inputValue || '').replace(',', '.'));
                                const targetW = (pack.key !== 'unit' && pack.factor > 0)
                                    ? Number(pack.factor)
                                    : (!isNaN(currentW) && currentW > 0 ? currentW : 0);
                                if (targetW > 0) {
                                    setInputValue(targetW.toFixed(3));
                                    if (nextPrice > 0) {
                                        const usd = targetW * nextPrice;
                                        setSecondaryValue(usd.toFixed(2));
                                        setTertiaryValue((usd * exchangeRate).toFixed(2));
                                    }
                                }
                                setActiveInput('WEIGHT');
                            };

                            const handleApplyPreset = (kg, pieces = undefined) => {
                                setActiveInput('WEIGHT');
                                if (pieces !== undefined) setPiecesSoldCount(String(pieces));
                                const wStr = kg.toFixed(3);
                                setInputValue(wStr);
                                if (productPrice > 0) {
                                    const usd = kg * productPrice;
                                    setSecondaryValue(usd.toFixed(2));
                                    setTertiaryValue((usd * exchangeRate).toFixed(2));
                                }
                            };

                            const handleKeypad = (key) => {
                                let curr = activeInput === 'WEIGHT' ? inputValue : activeInput === 'USD' ? secondaryValue : tertiaryValue;
                                curr = String(curr || '');
                                let next = curr;

                                if (key === 'CLEAR') {
                                    next = '';
                                } else if (key === 'BACK') {
                                    next = curr.slice(0, -1);
                                } else if (key === '.') {
                                    if (!curr.includes('.')) next = curr ? curr + '.' : '0.';
                                } else {
                                    next = curr === '0' ? key : curr + key;
                                }

                                if (activeInput === 'WEIGHT') {
                                    setInputValue(next);
                                    const parsed = parseFloat(next.replace(',', '.'));
                                    if (!isNaN(parsed) && productPrice > 0) {
                                        const usd = parsed * productPrice;
                                        setSecondaryValue(usd.toFixed(2));
                                        setTertiaryValue((usd * exchangeRate).toFixed(2));
                                    } else if (!next) {
                                        setSecondaryValue('');
                                        setTertiaryValue('');
                                    }
                                } else if (activeInput === 'USD') {
                                    setSecondaryValue(next);
                                    const parsedUsd = parseFloat(next.replace(',', '.'));
                                    if (!isNaN(parsedUsd) && productPrice > 0) {
                                        const weight = parsedUsd / productPrice;
                                        setInputValue(Number(weight.toFixed(4)).toString());
                                        setTertiaryValue((parsedUsd * exchangeRate).toFixed(2));
                                    } else if (!next) {
                                        setInputValue('');
                                        setTertiaryValue('');
                                    }
                                } else if (activeInput === 'VES') {
                                    setTertiaryValue(next);
                                    const parsedBs = parseFloat(next.replace(',', '.'));
                                    if (!isNaN(parsedBs) && productPrice > 0 && exchangeRate > 0) {
                                        const parsedUsd = parsedBs / exchangeRate;
                                        const weight = parsedUsd / productPrice;
                                        setInputValue(Number(weight.toFixed(4)).toString());
                                        setSecondaryValue(parsedUsd.toFixed(2));
                                    } else if (!next) {
                                        setInputValue('');
                                        setSecondaryValue('');
                                    }
                                }
                            };

                            return (
                                <div className="space-y-3.5 text-left">
                                    {/* Selector Al Detal vs Al Mayor por Pieza/Peine */}
                                    {packOptions.length > 1 && (
                                        <div>
                                            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5 block">
                                                Modalidad de Venta (Detal vs. Mayor por Pieza)
                                            </label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {packOptions.map(pack => {
                                                    const active = selectedPackKey === pack.key;
                                                    const isWholesale = pack.key !== 'unit';
                                                    return (
                                                        <button
                                                            key={pack.key}
                                                            type="button"
                                                            onClick={() => handleSelectWeightMode(pack)}
                                                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                                                active
                                                                    ? (isWholesale
                                                                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-500/30'
                                                                        : 'bg-primary-600 text-white border-primary-600 shadow-sm ring-2 ring-primary-500/30')
                                                                    : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between gap-1">
                                                                <span className="text-xs font-black truncate">
                                                                    {isWholesale ? `Mayor: ${pack.label}` : 'Al Detal (Por Kg)'}
                                                                </span>
                                                                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                                                    active ? 'bg-black/20 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                                                                }`}>
                                                                    ${Number(pack.unitPriceUsd).toFixed(2)}/kg
                                                                </span>
                                                            </div>
                                                            <span className={`text-[10px] mt-0.5 ${active ? 'text-white/85' : 'text-slate-400'}`}>
                                                                {isWholesale
                                                                    ? `Pieza ~${pack.factor} kg (≈ $${Number(pack.priceUsd).toFixed(2)})`
                                                                    : 'Rebanado / Porcionado libre'}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Product Header Card */}
                                    <div className="bg-slate-50 dark:bg-white/5 p-3 rounded-2xl border border-slate-200 dark:border-white/10 flex items-center justify-between">
                                        <div className="min-w-0 pr-2">
                                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase tracking-wider flex items-center gap-1">
                                                    <Scale size={9} /> {isWholesalePack ? `Mayor (${chosenPack.label})` : `Venta por ${weightUnit.toUpperCase()}`}
                                                </span>
                                                {currentStock !== null && !isNaN(currentStock) && (
                                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                                        Stock: {stockPieces !== null ? `${stockPieces} ${primaryWholesalePack.label}(s) · ` : ''}{currentStock.toFixed(2)} {weightUnit}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                                                {data?.product?.name}
                                            </h3>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-xs font-black text-primary-500">
                                                ${productPrice.toFixed(2)} /{weightUnit}
                                            </div>
                                            {exchangeRate > 0 && (
                                                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                                    Bs {priceBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /{weightUnit}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Weight Presets */}
                                    <div>
                                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5 block">
                                            {isWholesalePack ? `Selección Rápida de ${chosenPack.label}s (Luego ajusta el peso exacto de balanza abajo)` : 'Pesos Rápidos'}
                                        </label>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {presets.map(p => {
                                                const isSelected = isWholesalePack
                                                    ? (Number(piecesSoldCount) === p.pieces)
                                                    : (Math.abs(parseFloat(inputValue || '0') - p.val) < 0.0001);
                                                const maxFreeKg = currentStock !== null ? Math.max(0, currentStock - Number(data?.alreadyInCartUnits || 0)) : null;
                                                const exceedsStock = !data?.product?.allowNegative && (
                                                    (maxFreeKg !== null && p.val > maxFreeKg + 0.0001) ||
                                                    (isWholesalePack && p.pieces && stockPieces !== null && p.pieces > stockPieces + 0.01)
                                                );
                                                return (
                                                    <button
                                                        key={p.label}
                                                        type="button"
                                                        disabled={exceedsStock}
                                                        onClick={() => handleApplyPreset(p.val, p.pieces)}
                                                        className={`px-2.5 py-1 min-h-[36px] rounded-xl text-xs font-black transition-all flex items-center justify-center ${
                                                            exceedsStock
                                                                ? 'opacity-35 cursor-not-allowed bg-slate-100 dark:bg-white/5 text-slate-400 border border-slate-200 dark:border-white/10'
                                                                : isSelected
                                                                    ? 'bg-amber-500 text-white shadow-xs shadow-amber-500/30 ring-2 ring-amber-500/30 cursor-pointer active:scale-95'
                                                                    : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-amber-500/10 hover:text-amber-600 border border-slate-200 dark:border-white/10 cursor-pointer active:scale-95'
                                                        }`}
                                                    >
                                                        {p.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {isWholesalePack && (
                                        <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
                                                    Unidades físicas a descontar ({chosenPack.label}s)
                                                </div>
                                                <div className="text-[9.5px] text-slate-500 dark:text-slate-400">
                                                    Como cada {chosenPack.label} varía de peso, pon abajo lo que pesó en balanza
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setPiecesSoldCount(String(Math.max(1, (parseFloat(piecesSoldCount) || 1) - 1)))}
                                                    className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 font-black text-xs text-slate-700 dark:text-white cursor-pointer"
                                                >
                                                    -
                                                </button>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={piecesSoldCount}
                                                    onChange={(e) => setPiecesSoldCount(e.target.value.replace(',', '.'))}
                                                    className="w-12 text-center py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-xs font-black text-slate-900 dark:text-white outline-none"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const nextP = (parseFloat(piecesSoldCount) || 1) + 1;
                                                        if (!data?.product?.allowNegative && stockPieces !== null && nextP > stockPieces) {
                                                            toast.error(`Solo hay ${stockPieces} ${chosenPack.label}(s) en stock`);
                                                            return;
                                                        }
                                                        setPiecesSoldCount(String(nextP));
                                                    }}
                                                    className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 font-black text-xs text-slate-700 dark:text-white cursor-pointer"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* 3-Way Synchronized Inputs */}
                                    <div className="space-y-2">
                                        {/* Weight Input (Primary) */}
                                        <div className={`relative rounded-2xl transition-all border ${activeInput === 'WEIGHT' ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-500/5' : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5'}`}>
                                            <div className="flex items-center justify-between px-3 pt-2">
                                                <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                                    <Scale size={11} className="text-amber-500" /> {isWholesalePack ? `Peso Real en Balanza de ${piecesSoldCount || 1} ${chosenPack.label}(s) (${weightUnit})` : `Peso Exacto (${weightUnit})`}
                                                </label>
                                                {activeInput === 'WEIGHT' && (
                                                    <span className="text-[8px] font-bold text-amber-500 uppercase">Activo</span>
                                                )}
                                            </div>
                                            <div className="relative px-3 pb-2 flex items-center">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    required
                                                    autoFocus
                                                    value={inputValue}
                                                    onFocus={() => setActiveInput('WEIGHT')}
                                                    onChange={e => {
                                                        setActiveInput('WEIGHT');
                                                        const val = e.target.value.replace(',', '.');
                                                        setInputValue(e.target.value);
                                                        const parsed = parseFloat(val);
                                                        if (!isNaN(parsed) && productPrice > 0) {
                                                            const rawUsd = parsed * productPrice;
                                                            setSecondaryValue(rawUsd.toFixed(2));
                                                            setTertiaryValue((rawUsd * exchangeRate).toFixed(2));
                                                        } else if (!val) {
                                                            setSecondaryValue('');
                                                            setTertiaryValue('');
                                                        }
                                                    }}
                                                    placeholder="0.000"
                                                    className="w-full bg-transparent font-black text-2xl text-slate-900 dark:text-white outline-none tabular-nums"
                                                />
                                                <span className="text-sm font-black text-slate-400 uppercase ml-2">{weightUnit}</span>
                                            </div>
                                            {!data?.product?.allowNegative && currentStock !== null && parseFloat(String(inputValue || '0').replace(',', '.')) > Math.max(0, currentStock - Number(data?.alreadyInCartUnits || 0)) + 0.0001 && (
                                                <div className="px-3 pb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                                                    <AlertTriangle size={13} className="shrink-0" />
                                                    <span>Supera el stock disponible ({Math.max(0, Math.round((currentStock - Number(data?.alreadyInCartUnits || 0)) * 1000) / 1000)} {weightUnit})</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Dollar & Bolivar Amount Inputs */}
                                        <div className={`grid ${currencyMode === 'USD' ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                                            {/* USD Input */}
                                            <div className={`relative rounded-lg transition-colors border p-2 ${activeInput === 'USD' ? 'border-sky-500 ring-1 ring-sky-500 bg-sky-50/40 dark:bg-sky-950/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
                                                <label className="text-[8px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-0.5">
                                                    Monto en $ (USD)
                                                </label>
                                                <div className="flex items-center">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={secondaryValue}
                                                        onFocus={() => setActiveInput('USD')}
                                                        onChange={e => {
                                                            setActiveInput('USD');
                                                            const val = e.target.value.replace(',', '.');
                                                            setSecondaryValue(e.target.value);
                                                            const parsedUsd = parseFloat(val);
                                                            if (!isNaN(parsedUsd) && productPrice > 0) {
                                                                const weight = parsedUsd / productPrice;
                                                                setInputValue(Number(weight.toFixed(4)).toString());
                                                                setTertiaryValue((parsedUsd * exchangeRate).toFixed(2));
                                                            } else if (!val) {
                                                                setInputValue('');
                                                                setTertiaryValue('');
                                                            }
                                                        }}
                                                        placeholder="0.00"
                                                        className="w-full bg-transparent font-bold text-sm text-slate-900 dark:text-white outline-none tabular-nums"
                                                    />
                                                    <span className="text-xs font-bold text-slate-400">$</span>
                                                </div>
                                            </div>

                                            {/* VES Input */}
                                            {currencyMode !== 'USD' && (
                                                <div className={`relative rounded-lg transition-colors border p-2 ${activeInput === 'VES' ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'}`}>
                                                    <label className="text-[8px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-0.5">
                                                        Monto en Bs (VES)
                                                    </label>
                                                    <div className="flex items-center">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={tertiaryValue}
                                                            onFocus={() => setActiveInput('VES')}
                                                            onChange={e => {
                                                                setActiveInput('VES');
                                                                const val = e.target.value.replace(',', '.');
                                                                setTertiaryValue(e.target.value);
                                                                const parsedBs = parseFloat(val);
                                                                if (!isNaN(parsedBs) && productPrice > 0 && exchangeRate > 0) {
                                                                    const parsedUsd = parsedBs / exchangeRate;
                                                                    const weight = parsedUsd / productPrice;
                                                                    setInputValue(Number(weight.toFixed(4)).toString());
                                                                    setSecondaryValue(parsedUsd.toFixed(2));
                                                                } else if (!val) {
                                                                    setInputValue('');
                                                                    setSecondaryValue('');
                                                                }
                                                            }}
                                                            placeholder="0.00"
                                                            className="w-full bg-transparent font-bold text-sm text-emerald-600 dark:text-emerald-400 outline-none tabular-nums"
                                                        />
                                                        <span className="text-xs font-bold text-slate-400">Bs</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Touch Keypad */}
                                    <div className="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {['1', '2', '3'].map(k => (
                                                <button
                                                    key={k}
                                                    type="button"
                                                    onClick={() => handleKeypad(k)}
                                                    className="h-10 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-base rounded-md shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                                                >
                                                    {k}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => handleKeypad('BACK')}
                                                className="h-10 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 font-bold rounded-md shadow-2xs border border-rose-200 dark:border-rose-900/40 transition-colors flex items-center justify-center cursor-pointer"
                                                title="Borrar"
                                            >
                                                <Delete size={16} />
                                            </button>

                                            {['4', '5', '6'].map(k => (
                                                <button
                                                    key={k}
                                                    type="button"
                                                    onClick={() => handleKeypad(k)}
                                                    className="h-10 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-base rounded-md shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                                                >
                                                    {k}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => handleKeypad('CLEAR')}
                                                className="h-10 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 font-bold text-xs uppercase tracking-wider rounded-md shadow-2xs border border-amber-200 dark:border-amber-900/40 transition-colors flex items-center justify-center cursor-pointer"
                                                title="Limpiar"
                                            >
                                                C
                                            </button>

                                            {['7', '8', '9'].map(k => (
                                                <button
                                                    key={k}
                                                    type="button"
                                                    onClick={() => handleKeypad(k)}
                                                    className="h-10 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-base rounded-md shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                                                >
                                                    {k}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => handleKeypad('.')}
                                                className="h-10 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-lg rounded-md shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                                            >
                                                .
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleKeypad('0')}
                                                className="h-10 col-span-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-base rounded-md shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                                            >
                                                0
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleKeypad('00')}
                                                className="h-10 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-sm rounded-md shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center cursor-pointer"
                                            >
                                                00
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleApplyPreset(0.5)}
                                                className="h-10 bg-sky-50 dark:bg-sky-950/30 hover:bg-sky-100 dark:hover:bg-sky-900/40 text-sky-600 dark:text-sky-400 font-bold text-xs rounded-md shadow-2xs border border-sky-200 dark:border-sky-900/40 transition-colors flex items-center justify-center cursor-pointer"
                                            >
                                                ½ kg
                                            </button>
                                        </div>
                                    </div>

                                    {/* Summary Banner */}
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between">
                                        <div>
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Total Estimado</span>
                                            <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                                                {tertiaryValue ? `Bs ${parseFloat(tertiaryValue).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Bs 0,00'}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-sm font-bold text-sky-600 dark:text-sky-400 tabular-nums block">
                                                ${secondaryValue ? parseFloat(secondaryValue).toFixed(2) : '0.00'} USD
                                            </span>
                                            <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400">
                                                {inputValue ? `${inputValue} ${weightUnit}` : `0 ${weightUnit}`}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {(type === 'DISCOUNT_PROMPT' || type === 'HOLD_SALE') && (
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                                    {type === 'HOLD_SALE' ? 'Referencia o cliente' : 'Porcentaje de descuento (%)'}
                                </label>
                                <input
                                    type="text"
                                    inputMode={type === 'HOLD_SALE' ? 'text' : 'decimal'}
                                    required
                                    autoFocus
                                    value={inputValue}
                                    onChange={e => setInputValue(e.target.value)}
                                    placeholder={type === 'HOLD_SALE' ? 'Ej. Mesa 4 / Juan Pérez' : '0.00'}
                                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none text-slate-900 dark:text-white font-semibold text-base transition-all"
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Action Footer */}
                <div className="px-5 py-3.5 pb-[max(0.875rem,calc(0.875rem+env(safe-area-inset-bottom,0px)))] border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0">
                    {cancelText && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full sm:w-auto min-h-[38px] px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/70 transition-colors font-semibold text-xs sm:text-[13px] flex items-center justify-center cursor-pointer"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        type="submit"
                        className={`w-full sm:w-auto min-h-[38px] px-4 py-2 text-white rounded-lg transition-colors font-semibold text-xs sm:text-[13px] flex items-center justify-center gap-2 cursor-pointer shadow-2xs ${
                            variant === 'danger'
                                ? 'bg-rose-600 hover:bg-rose-700'
                                : variant === 'warning'
                                    ? 'bg-amber-600 hover:bg-amber-700'
                                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-primary-600 dark:hover:bg-primary-500'
                        }`}
                    >
                        <span className="truncate">
                            {type === 'WEIGHT_PROMPT'
                                ? (data?.isEditingCart
                                    ? `Actualizar a ${inputValue || '0'} ${data?.product?.stockUnit || 'kg'}`
                                    : `Agregar ${inputValue || '0'} ${data?.product?.stockUnit || 'kg'}`)
                                : confirmText}
                        </span>
                        {isConfirmOnly && (
                            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-white/15 rounded text-[10px] font-mono leading-none">
                                ↵
                            </kbd>
                        )}
                    </button>
                </div>
            </form>
        </BaseModal>
    );
});

export default ActionDialog;
