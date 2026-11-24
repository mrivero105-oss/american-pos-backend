import { useState, useEffect, useRef, useCallback } from 'react';
import BaseModal from './BaseModal';
import { Landmark, RefreshCw, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { isSingleCurrencyMode } from '../utils/format';

export default function ExchangeRateModal({ isOpen, onClose, currentRate, currentEuroRate = 0, currencyMode, onRateUpdated }) {
    const isSingleDollar = isSingleCurrencyMode(currencyMode);
    const currencySuffix = isSingleDollar ? '$' : 'Bs';
    const [rate, setRate] = useState(currentRate?.toString() || '1');
    const [euroRate, setEuroRate] = useState(() => {
        if (Number(currentEuroRate) > 0) return String(currentEuroRate);
        const saved = localStorage.getItem('pos_euro_rate');
        return saved && Number(saved) > 0 ? saved : '';
    });
    const [autoUpdate, setAutoUpdate] = useState(() => {
        const saved = localStorage.getItem('pos_auto_update_rate');
        return saved !== null ? saved === 'true' : true;
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingBCV, setIsFetchingBCV] = useState(false);
    const [bcvError, setBcvError] = useState('');
    const [lastBcvRate, setLastBcvRate] = useState(null);
    const [lastBcvEuroRate, setLastBcvEuroRate] = useState(null);
    const inputRef = useRef(null);
    const wasOpenRef = useRef(false);
    const hasManualEditRef = useRef(false);

    const handleFetchBCV = useCallback(async (isSilent = false) => {
        setIsFetchingBCV(true);
        setBcvError('');
        try {
            let bcvRate = null;
            let bcvEuro = null;
            // 1. Backend oficial (retorna USD y EUR oficial en una sola llamada)
            try {
                const { data } = await api.get('/settings/bcv');
                if (data && data.success) {
                    if (data.rate) bcvRate = data.rate;
                    if (data.euroRate) bcvEuro = data.euroRate;
                }
            } catch (caughtErr) { console.warn('[ExchangeRateModal] Error en operación auxiliar:', caughtErr?.message || caughtErr); }

            // 2. Fallback DolarAPI (USD + EUR)
            if (!bcvRate || !bcvEuro) {
                try {
                    const [usdRes, eurRes] = await Promise.allSettled([
                        !bcvRate ? fetch('https://ve.dolarapi.com/v1/dolares/oficial') : Promise.resolve(null),
                        !bcvEuro ? fetch('https://ve.dolarapi.com/v1/euros/oficial') : Promise.resolve(null)
                    ]);
                    if (usdRes.status === 'fulfilled' && usdRes.value?.ok) {
                        const data = await usdRes.value.json();
                        if (data?.promedio) bcvRate = data.promedio;
                    }
                    if (eurRes.status === 'fulfilled' && eurRes.value?.ok) {
                        const data = await eurRes.value.json();
                        if (data?.promedio) bcvEuro = data.promedio;
                    }
                } catch (caughtErr) { console.warn('[ExchangeRateModal] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
            }

            // 3. Fallback PyDolarVenezuela API
            if (!bcvRate) {
                const res = await fetch('https://pydolarvenezuela-api.vercel.app/api/v1/dollar?page=bcv');
                if (!res.ok) throw new Error('No se pudo conectar con el servicio oficial');
                const data = await res.json();
                if (data && data.monitors && data.monitors.bcv && data.monitors.bcv.price) {
                    bcvRate = data.monitors.bcv.price;
                }
            }

            if (bcvRate && !isNaN(bcvRate)) {
                setLastBcvRate(bcvRate);
                if (bcvEuro && !isNaN(bcvEuro)) {
                    setLastBcvEuroRate(bcvEuro);
                }
                // Solo rellenar los inputs cuando el usuario pulsa "Actualizar" explícitamente (nunca pisar edición manual al abrir)
                if (!isSilent) {
                    hasManualEditRef.current = false;
                    setRate(bcvRate.toString());
                    if (bcvEuro && !isNaN(bcvEuro)) {
                        setEuroRate(bcvEuro.toString());
                    }
                    toast.success(`Tasa BCV obtenida: ${bcvRate} Bs/$${bcvEuro ? ` · ${bcvEuro} Bs/€` : ''}`);
                    if (inputRef.current) inputRef.current.focus();
                }
            } else {
                throw new Error('No se pudo obtener la tasa oficial');
            }
        } catch (_err) {
            if (!isSilent) {
                setBcvError('No se pudo consultar el Banco Central de Venezuela.');
                toast.error('Error al consultar tasa oficial');
            }
        } finally {
            setIsFetchingBCV(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) {
            wasOpenRef.current = false;
            return;
        }
        // Inicializar únicamente en la transición cerrado -> abierto (nunca resetear inputs si cambia autoUpdate o llegan ticks)
        if (wasOpenRef.current) return;
        wasOpenRef.current = true;
        hasManualEditRef.current = false;

        const initial = currentRate?.toString() || '1';
        setRate(initial);
        const savedEur = Number(currentEuroRate) > 0 ? String(currentEuroRate) : (localStorage.getItem('pos_euro_rate') || '');
        setEuroRate(Number(savedEur) > 0 ? savedEur : '');
        setBcvError('');

        api.get('/settings/rate').then(res => {
            if (res.data) {
                if (res.data.autoUpdateRate !== undefined && !hasManualEditRef.current) {
                    setAutoUpdate(res.data.autoUpdateRate);
                    localStorage.setItem('pos_auto_update_rate', res.data.autoUpdateRate ? 'true' : 'false');
                }
                if (res.data.rate) {
                    setLastBcvRate((prev) => prev ?? res.data.rate);
                }
                if (Number(res.data.euroRate) > 0) {
                    setLastBcvEuroRate((prev) => prev ?? res.data.euroRate);
                    if (!hasManualEditRef.current) {
                        setEuroRate(String(res.data.euroRate));
                    }
                    localStorage.setItem('pos_euro_rate', String(res.data.euroRate));
                }
            }
        }).catch(() => {});

        if (!isSingleDollar) {
            handleFetchBCV(true);
        }

        const focusTimer = setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.select();
            }
        }, 80);

        return () => clearTimeout(focusTimer);
    }, [isOpen, currentRate, currentEuroRate, isSingleDollar, handleFetchBCV]);

    const handleManualRateChange = (rawValue) => {
        const cleaned = rawValue.replace(/[^0-9.,]/g, '');
        hasManualEditRef.current = true;
        setRate(cleaned);
        // Si el usuario ingresa una tasa manual diferente a la oficial/actual, desactivar auto-sync inmediatamente
        const parsed = parseFloat(cleaned.replace(',', '.'));
        const refUsd = Number(lastBcvRate || currentRate || 0);
        if (!isNaN(parsed) && parsed > 0 && (!refUsd || Math.abs(parsed - refUsd) > 0.0001)) {
            setAutoUpdate(false);
        }
    };

    const handleManualEuroChange = (rawValue) => {
        const cleaned = rawValue.replace(/[^0-9.,]/g, '');
        hasManualEditRef.current = true;
        setEuroRate(cleaned);
        const parsed = parseFloat(cleaned.replace(',', '.'));
        const refEur = Number(lastBcvEuroRate || currentEuroRate || 0);
        if (!isNaN(parsed) && parsed > 0 && (!refEur || Math.abs(parsed - refEur) > 0.0001)) {
            setAutoUpdate(false);
        }
    };

    const handleSave = async () => {
        const val = parseFloat(rate.toString().replace(',', '.'));
        if (isNaN(val) || val <= 0) {
            toast.error('Ingresa una tasa de cambio válida');
            return;
        }
        const eurVal = euroRate !== '' ? parseFloat(euroRate.toString().replace(',', '.')) : null;
        if (eurVal !== null && (isNaN(eurVal) || eurVal <= 0)) {
            toast.error('Ingresa una tasa de Euro válida o déjala vacía');
            return;
        }

        // Si el usuario modificó la tasa manualmente a un valor distinto al BCV, respetar el modo manual sin sobrescribir
        const differsFromBcv =
            hasManualEditRef.current &&
            lastBcvRate != null &&
            Math.abs(val - Number(lastBcvRate)) > 0.0001;
        const effectiveAutoUpdate = differsFromBcv ? false : autoUpdate;

        setIsSaving(true);
        try {
            await api.post('/settings/rate', {
                rate: val,
                ...(eurVal ? { euroRate: eurVal } : {}),
                autoUpdateRate: effectiveAutoUpdate
            });
            localStorage.setItem('pos_auto_update_rate', effectiveAutoUpdate ? 'true' : 'false');
            localStorage.setItem('pos_exchange_rate', String(val));
            if (eurVal) {
                localStorage.setItem('pos_euro_rate', String(eurVal));
            }

            // Solo sincronizar con el BCV si el usuario dejó autoUpdate activo y NO editó una tasa manual personalizada
            if (effectiveAutoUpdate && !hasManualEditRef.current) {
                try {
                    await api.post('/settings/bcv/sync');
                } catch (caughtErr) { console.warn('[ExchangeRateModal] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
            }

            if (onRateUpdated) {
                await Promise.resolve(onRateUpdated(val, eurVal));
            }
            toast.success(
                differsFromBcv
                    ? `Tasa manual guardada: ${val} ${currencySuffix} (Auto-BCV desactivado)`
                    : `Tasa guardada: ${val} ${currencySuffix}${eurVal ? ` · € ${eurVal} Bs` : ''}`
            );
            onClose();
        } catch (err) {
            console.error('Error al guardar tasa:', err);
            toast.error(err.response?.data?.error || 'Error al guardar la tasa');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <BaseModal 
            isOpen={isOpen} 
            onClose={onClose} 
            maxWidth="max-w-md" 
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl"
        >
            {/* Encabezado */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200">
                        <Landmark size={20} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                            Tasa de Cambio
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Configuración monetaria del sistema
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    type="button"
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Cerrar (Esc)"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Contenido */}
            <div className="p-5 space-y-4">
                
                {/* Referencia Oficial BCV */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Banco Central de Venezuela
                            </span>
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                                Oficial
                            </span>
                        </div>
                        <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                            {lastBcvRate ? `${lastBcvRate} Bs / USD` : 'Consultando...'}
                        </div>
                        {lastBcvEuroRate && (
                            <div className="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400">
                                {lastBcvEuroRate} Bs / EUR (€)
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => handleFetchBCV(false)}
                        disabled={isFetchingBCV}
                        className="px-3 py-1.5 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                        title="Consultar tasas oficiales USD y EUR en vivo"
                    >
                        <RefreshCw size={13} className={isFetchingBCV ? "animate-spin text-primary-500" : ""} />
                        <span>{isFetchingBCV ? 'Buscando...' : 'Actualizar'}</span>
                    </button>
                </div>

                {/* Input de tasa aplicada */}
                <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Tasa aplicada en caja (Bs por 1 USD)
                    </label>
                    <div className="relative">
                        <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500 transition-all overflow-hidden shadow-sm">
                            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-r border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                                $1.00 =
                            </div>
                            <input
                                ref={inputRef}
                                type="text"
                                inputMode="decimal"
                                value={rate}
                                onChange={(e) => handleManualRateChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSave();
                                    }
                                }}
                                className="w-full px-3 py-2.5 bg-transparent font-mono text-xl font-bold text-slate-900 dark:text-white focus:outline-none text-right"
                                placeholder="0.00"
                            />
                            <div className="px-3.5 py-2.5 text-xs font-bold font-mono text-slate-500 dark:text-slate-400 select-none">
                                {currencySuffix}
                            </div>
                        </div>
                    </div>
                    {lastBcvRate && String(lastBcvRate) !== rate.trim() && (
                        <button
                            type="button"
                            onClick={() => {
                                hasManualEditRef.current = false;
                                setRate(String(lastBcvRate));
                            }}
                            className="text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 cursor-pointer pt-0.5"
                        >
                            Usar tasa oficial del BCV ({lastBcvRate} Bs)
                        </button>
                    )}
                </div>

                {/* Input de tasa Euro BCV */}
                {!isSingleDollar && (
                    <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Tasa Euro BCV (Bs por 1 EUR) <span className="font-normal text-slate-400">· cobros en €</span>
                        </label>
                        <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all overflow-hidden shadow-sm">
                            <div className="px-3.5 py-2 bg-indigo-50/70 dark:bg-indigo-950/40 border-r border-slate-200 dark:border-slate-700 text-xs font-bold text-indigo-600 dark:text-indigo-400 select-none">
                                €1.00 =
                            </div>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={euroRate}
                                onChange={(e) => handleManualEuroChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSave();
                                    }
                                }}
                                className="w-full px-3 py-2 bg-transparent font-mono text-lg font-bold text-slate-900 dark:text-white focus:outline-none text-right"
                                placeholder="0.00"
                            />
                            <div className="px-3.5 py-2 text-xs font-bold font-mono text-indigo-500 dark:text-indigo-400 select-none">
                                Bs
                            </div>
                        </div>
                        {lastBcvEuroRate && String(lastBcvEuroRate) !== euroRate.trim() && (
                            <button
                                type="button"
                                onClick={() => {
                                    hasManualEditRef.current = false;
                                    setEuroRate(String(lastBcvEuroRate));
                                }}
                                className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer pt-0.5"
                            >
                                Usar Euro oficial del BCV ({lastBcvEuroRate} Bs/€)
                            </button>
                        )}
                    </div>
                )}

                {/* Sincronización automática */}
                <div className="pt-1">
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autoUpdate}
                            onChange={(e) => setAutoUpdate(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 dark:bg-slate-900 dark:checked:bg-primary-600 cursor-pointer"
                        />
                        <div className="space-y-0.5">
                            <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                                Sincronización automática con el BCV
                            </span>
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                Actualiza automáticamente la tasa del sistema al abrir el POS y cada vez que el Banco Central publique una nueva tasa oficial.
                            </span>
                        </div>
                    </label>
                </div>

                {/* Banner de error si existe */}
                {bcvError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs font-medium">
                        {bcvError}
                    </div>
                )}
            </div>

            {/* Pie de modal */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5 bg-slate-50/60 dark:bg-slate-900/80 shrink-0">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-4 py-2 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-500 active:bg-primary-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                >
                    {isSaving ? (
                        <>
                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>Guardando...</span>
                        </>
                    ) : (
                        <>
                            <Check size={14} strokeWidth={2.5} />
                            <span>Guardar Cambios</span>
                        </>
                    )}
                </button>
            </div>
        </BaseModal>
    );
}
