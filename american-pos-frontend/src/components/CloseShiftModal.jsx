import { useState, useEffect, useMemo } from 'react';
import { 
    CheckCircle, X, AlertTriangle, ArrowRight, Save, Printer, 
    DollarSign, CreditCard, Smartphone, Banknote, RefreshCw, 
    ShieldCheck, ChevronDown, ChevronUp, Lock, CheckCircle2,
    Store, Copy, Clock, Landmark, User, Wallet, Send
} from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatUSD, formatBs, isSingleCurrencyMode, getGlobalSettings } from '../utils/format';
import { printZReportReceipt, printShiftInventoryReceipt } from '../utils/printCashReceipts';
import SupervisorAuthModal from './SupervisorAuthModal';
import { useAuth } from '../hooks/AuthContext';
import { usePos } from '../hooks/PosContext';
import BlindClosureModal from './BlindClosureModal';

// Helper for bill/coin chip inputs
const DenominationInput = ({ label, value, onChange, isCoin = false }) => (
    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-500/40 transition-colors group">
        <span className="font-black text-slate-800 dark:text-slate-200 text-sm tracking-tight">{label}</span>
        <div className="flex items-center gap-1.5">
            {!isCoin && (
                <div className="hidden sm:flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onChange((Number(value) || 0) + 1)}
                        className="px-2 py-1 bg-white dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-600 transition-all active:scale-95"
                    >
                        +1
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange((Number(value) || 0) + 5)}
                        className="px-2 py-1 bg-white dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-600 transition-all active:scale-95"
                    >
                        +5
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange((Number(value) || 0) + 10)}
                        className="px-2 py-1 bg-white dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-600 transition-all active:scale-95"
                    >
                        +10
                    </button>
                </div>
            )}
            <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min="0"
                value={value || ''}
                onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 sm:w-20 p-1.5 text-center font-black bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white outline-none focus:border-primary-500 text-sm shadow-inner"
                placeholder="0"
            />
        </div>
    </div>
);

export default function CloseShiftModal(props) {
    const {
        isOpen,
        onClose,
        currentShift,
        onSuccess,
        businessSettings = {},
        paymentMethods = [],
        exchangeRate: propExchangeRate,
        currencyMode: propCurrencyMode
    } = props;

    // Detect if Blind Closure Mode is active
    const savedSettings = (() => {
        try {
            return JSON.parse(localStorage.getItem('pos_business_settings') || localStorage.getItem('pos_business_info') || '{}');
        } catch (_) { return {}; }
    })();

    const effectiveClosureMode = businessSettings?.cashClosureMode || 
                                 savedSettings?.cashClosureMode || 
                                 localStorage.getItem('pos_cash_closure_mode') || 
                                 'ASSISTED';

    const { user } = useAuth();
    let posExchangeRate = null;
    let posCurrencyMode = null;
    try {
        const pos = usePos();
        if (pos) {
            posExchangeRate = pos.exchangeRate;
            posCurrencyMode = pos.currencyMode;
        }
    } catch (_e) {}

    const [rate, setRate] = useState(() => {
        const globalRate = getGlobalSettings()?.rate;
        const candidate = Number(
            propExchangeRate ||
            businessSettings?.rate ||
            businessSettings?.exchangeRate ||
            currentShift?.exchangeRate ||
            posExchangeRate ||
            globalRate ||
            localStorage.getItem('pos_exchange_rate') ||
            1.0
        );
        return candidate > 0 ? candidate : 1.0;
    });

    useEffect(() => {
        if (isOpen) {
            api.get('/settings/rate')
                .then(res => {
                    const r = Number(res.data?.rate);
                    if (r > 0) setRate(r);
                })
                .catch(() => {});
        }
    }, [isOpen]);

    useEffect(() => {
        const globalRate = getGlobalSettings()?.rate;
        const candidate = Number(
            propExchangeRate ||
            businessSettings?.rate ||
            businessSettings?.exchangeRate ||
            currentShift?.exchangeRate ||
            posExchangeRate ||
            globalRate ||
            localStorage.getItem('pos_exchange_rate') ||
            0
        );
        if (candidate > 0 && candidate !== rate) {
            setRate(candidate);
        }
    }, [propExchangeRate, businessSettings?.rate, businessSettings?.exchangeRate, currentShift?.exchangeRate, posExchangeRate]);

    const isUserAdminOrSupervisor = ['admin', 'superadmin', 'owner', 'supervisor'].includes(String(user?.role || '').toLowerCase());
    const activeCurrencyMode = propCurrencyMode || businessSettings?.currencyMode || posCurrencyMode || localStorage.getItem('pos_currency_mode') || 'BOTH';
    const singleCurrency = isSingleCurrencyMode({ currencyMode: activeCurrencyMode, ...businessSettings });
    const rawTolerance = businessSettings.cashDifferenceToleranceUsd;
    const tolerance = (rawTolerance !== undefined && rawTolerance !== null && !isNaN(Number(rawTolerance))) ? Number(rawTolerance) : 1.0;

    // UI States
    const [loading, setLoading] = useState(false);
    const [showDenomHelper, setShowDenomHelper] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [approval, setApproval] = useState(null);
    const [closureResult, setClosureResult] = useState(null);
    const [notes, setNotes] = useState('');

    // Denominations for bill counter
    const [usdDenoms, setUsdDenoms] = useState({
        '100': 0, '50': 0, '20': 0, '10': 0, '5': 0, '1': 0,
        '0.50': 0, '0.25': 0, '0.10': 0, '0.05': 0, '0.01': 0
    });
    const [looseCoins, setLooseCoins] = useState(0);

    // Dynamic Payment Methods list
    const [loadedMethods, setLoadedMethods] = useState(paymentMethods || []);

    useEffect(() => {
        if (Array.isArray(paymentMethods) && paymentMethods.length > 0) {
            setLoadedMethods(paymentMethods);
        } else if (isOpen) {
            api.get('/settings/payment-methods')
                .then(res => {
                    if (Array.isArray(res.data) && res.data.length > 0) {
                        setLoadedMethods(res.data);
                    }
                })
                .catch(() => {});
        }
    }, [isOpen, paymentMethods]);

    // Dynamic Declared Amounts Map: { [methodId]: stringValue }
    const [declaredAmounts, setDeclaredAmounts] = useState({});

    const handleDeclaredChange = (methodId, val) => {
        setDeclaredAmounts(prev => ({
            ...prev,
            [methodId]: val
        }));
    };

    // Synchronize denomination count into declaredAmounts['cash']
    const denomTotalUSD = useMemo(() => {
        let total = 0;
        Object.entries(usdDenoms).forEach(([denom, count]) => {
            total += Number(denom) * (Number(count) || 0);
        });
        total += Number(looseCoins) || 0;
        return Math.round(total * 100) / 100;
    }, [usdDenoms, looseCoins]);

    const handleDenomChange = (bill, val) => {
        const next = { ...usdDenoms, [bill]: val };
        setUsdDenoms(next);
        let total = 0;
        Object.entries(next).forEach(([d, c]) => {
            total += Number(d) * (Number(c) || 0);
        });
        total += Number(looseCoins) || 0;
        const formatted = total > 0 ? (Math.round(total * 100) / 100).toFixed(2) : '';
        setDeclaredAmounts(prev => ({ ...prev, cash: formatted }));
    };

    const handleLooseCoinsChange = (val) => {
        setLooseCoins(val);
        let total = 0;
        Object.entries(usdDenoms).forEach(([d, c]) => {
            total += Number(d) * (Number(c) || 0);
        });
        total += Number(val) || 0;
        const formatted = total > 0 ? (Math.round(total * 100) / 100).toFixed(2) : '';
        setDeclaredAmounts(prev => ({ ...prev, cash: formatted }));
    };

    // Canonical method ID helper to unify aliases (cash_bs vs efectivo_bs, etc.)
    const canonicalizeMethodId = (id) => {
        if (!id) return 'cash';
        const key = String(id).toLowerCase().trim();
        if (['efectivo_bs', 'cash_bs', 'cash_ves', 'ves', 'bs'].includes(key)) return 'cash_bs';
        if (['efectivo_usd', 'cash_usd', 'cash'].includes(key)) return 'cash';
        if (['card', 'tarjeta', 'punto', 'punto_de_venta', 'debito', 'debit'].includes(key)) return 'debit';
        if (['pagomovil', 'mobile', 'pago_movil'].includes(key)) return 'pago_movil';
        if (['transferencia', 'transfer_bs', 'transfer'].includes(key)) return 'transfer';
        if (['credito', 'credit', 'fiado'].includes(key)) return 'fiado';
        return key;
    };

    // Helper: Determine if a payment method uses VES currency
    const isVesPayment = (method, isSingle = false) => {
        if (isSingle) return false;
        if (!method) return false;
        if (typeof method === 'object') {
            const cur = String(method.currency || method.defaultCurrency || '').toUpperCase();
            if (cur === 'USD' || cur === '$' || cur === 'COP') return false;
            if (cur === 'VES' || cur === 'BS') return true;
        }
        const id = (typeof method === 'string' ? method : method.id || '').toLowerCase();
        const strictlyVesKeys = ['pago_movil', 'pagomovil', 'cash_bs', 'efectivo_bs', 'transfer_bs', 'biopago', 'ves', 'bs', 'debit', 'debito', 'tarjeta_debito', 'punto_de_venta'];
        return strictlyVesKeys.some(k => id === k || id.includes(k));
    };

    // Initial VES Amount for dual-currency display
    const initialVesAmount = useMemo(() => {
        const ib = currentShift?.initialBreakdown || {};
        const directBs = Number(ib.cash_bs ?? ib.efectivo_bs ?? ib.cash_ves ?? 0);
        if (directBs > 0) return directBs;
        const safeRate = rate > 0 ? rate : 1.0;
        return (Number(currentShift?.initialAmount) || 0) * safeRate;
    }, [currentShift, rate]);

    // Active methods list to display in Arqueo (Unified & Anti-Duplication)
    const activeMethods = useMemo(() => {
        let baseList = [...loadedMethods];

        // Fallbacks if no payment methods loaded yet
        if (baseList.length === 0) {
            if (singleCurrency) {
                baseList = [
                    { id: 'cash', name: 'Efectivo $ (USD)', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
                    { id: 'debit', name: 'Punto de Venta / Débito', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD' },
                    { id: 'zelle', name: 'Zelle / Transferencias', icon: 'Send', type: 'DIGITAL', currency: 'USD' }
                ];
            } else {
                baseList = [
                    { id: 'cash', name: 'Efectivo $', icon: 'DollarSign', type: 'CASH', currency: 'USD' },
                    { id: 'cash_bs', name: 'Efectivo Bs', icon: 'Banknote', type: 'CASH', currency: 'VES' },
                    { id: 'debit', name: 'Punto de Venta', icon: 'CreditCard', type: 'DIGITAL', currency: 'VES' },
                    { id: 'pago_movil', name: 'Pago Móvil', icon: 'Smartphone', type: 'DIGITAL', currency: 'VES' },
                    { id: 'zelle', name: 'Zelle', icon: 'Send', type: 'DIGITAL', currency: 'USD' },
                    { id: 'fiado', name: 'Crédito / Fiado', icon: 'User', type: 'CREDIT', currency: 'USD' }
                ];
            }
        }

        // Canonicalize base methods to eliminate any duplicates
        const seenCanonical = new Set();
        const list = [];
        baseList.forEach(m => {
            const canon = canonicalizeMethodId(m.id);
            if (!seenCanonical.has(canon)) {
                seenCanonical.add(canon);
                list.push({
                    ...m,
                    id: canon,
                    name: canon === 'cash_bs' ? 'Efectivo Bs' : canon === 'cash' ? 'Efectivo $' : m.name
                });
            }
        });

        // Single currency mode: filter out VES-only methods unless they have positive expected balance
        let filtered = list;
        if (singleCurrency) {
            filtered = list.filter(m => {
                const isV = isVesPayment(m, true);
                const hasActivity = Number(currentShift?.expectedBreakdown?.[m.id]) > 0 || Number(currentShift?.initialBreakdown?.[m.id]) > 0;
                return !isV || hasActivity;
            });
        }

        // Merge any other unmapped method from expectedBreakdown or initialBreakdown with recorded activity
        const eb = currentShift?.expectedBreakdown || {};
        const ib = currentShift?.initialBreakdown || {};
        const activityKeys = new Set([...Object.keys(eb), ...Object.keys(ib)]);

        activityKeys.forEach(k => {
            const canon = canonicalizeMethodId(k);
            if (!seenCanonical.has(canon) && canon !== 'total') {
                seenCanonical.add(canon);
                const isV = isVesPayment(canon, singleCurrency);
                filtered.push({
                    id: canon,
                    name: canon === 'cash_bs' ? 'Efectivo Bs' : canon.replace(/_/g, ' ').toUpperCase(),
                    icon: canon.includes('cash') ? 'Banknote' : 'CreditCard',
                    type: canon.includes('cash') ? 'CASH' : 'DIGITAL',
                    currency: isV ? 'VES' : 'USD'
                });
            }
        });

        return filtered;
    }, [loadedMethods, currentShift, singleCurrency]);

    // Expected amount per method (Robust & Deduplicated)
    const getExpectedForMethod = (methodId) => {
        if (!currentShift) return 0;
        const eb = currentShift.expectedBreakdown || {};
        const pbn = currentShift.paymentBreakdownNative || currentShift.paymentBreakdown || {};
        const ib = currentShift.initialBreakdown || {};
        const canon = canonicalizeMethodId(methodId);

        const aliases = {
            'cash': ['cash', 'cash_usd', 'efectivo_usd'],
            'cash_bs': ['cash_bs', 'efectivo_bs', 'cash_ves', 'ves', 'bs'],
            'debit': ['debit', 'card', 'punto', 'punto_de_venta', 'debito', 'tarjeta'],
            'pago_movil': ['pago_movil', 'pagomovil', 'mobile'],
            'transfer': ['transfer', 'transferencia', 'transfer_bs'],
            'fiado': ['fiado', 'credito', 'credit'],
            'biopago': ['biopago']
        };

        const targetKeys = aliases[canon] || [canon, methodId];

        // 1. Check if eb contains any of the target keys
        let totalEb = 0;
        let matchedEb = false;
        targetKeys.forEach(k => {
            if (eb[k] !== undefined && eb[k] !== null) {
                totalEb += Number(eb[k]) || 0;
                matchedEb = true;
            }
        });
        if (matchedEb && totalEb > 0) return totalEb;

        // 1b. Fallback to paymentBreakdownNative / paymentBreakdown for sales-based methods (like fiado/crédito, punto, etc.)
        let totalPbn = 0;
        let matchedPbn = false;
        targetKeys.forEach(k => {
            if (pbn[k] !== undefined && pbn[k] !== null) {
                totalPbn += Number(pbn[k]) || 0;
                matchedPbn = true;
            }
        });
        if (matchedPbn && totalPbn > 0) {
            // If cash, add initial breakdown
            if (canon === 'cash' || canon === 'cash_bs') {
                targetKeys.forEach(k => {
                    if (ib[k] !== undefined && ib[k] !== null) {
                        totalPbn += Number(ib[k]) || 0;
                    }
                });
            }
            return totalPbn;
        }
        if (matchedEb) return totalEb;

        // 2. Fallback to currentShift calculated cash fields if cash
        if (canon === 'cash' && currentShift.expectedCashUsd !== undefined && currentShift.expectedCashUsd !== null && Number(currentShift.expectedCashUsd) > 0) {
            return Number(currentShift.expectedCashUsd) || 0;
        }
        if (canon === 'cash_bs' && currentShift.expectedCashBs !== undefined && currentShift.expectedCashBs !== null && Number(currentShift.expectedCashBs) > 0) {
            return Number(currentShift.expectedCashBs) || 0;
        }

        // 3. Fallback to initialBreakdown if no sales recorded yet
        let totalIb = 0;
        let matchedIb = false;
        targetKeys.forEach(k => {
            if (ib[k] !== undefined && ib[k] !== null) {
                totalIb += Number(ib[k]) || 0;
                matchedIb = true;
            }
        });
        return matchedIb ? totalIb : 0;
    };

    // Load & Restore Draft
    useEffect(() => {
        if (isOpen && currentShift) {
            setClosureResult(null);
            setApproval(null);
            const draftStr = localStorage.getItem(`closure_draft_${currentShift.id}`);
            if (draftStr) {
                try {
                    const draft = JSON.parse(draftStr);
                    if (draft.declaredAmounts) setDeclaredAmounts(draft.declaredAmounts);
                    if (draft.usdDenoms) setUsdDenoms(draft.usdDenoms);
                    if (draft.looseCoins) setLooseCoins(draft.looseCoins);
                    if (draft.notes) setNotes(draft.notes);
                } catch (_e) {}
            }
        }
    }, [isOpen, currentShift?.id]);

    // Save draft periodically
    useEffect(() => {
        if (isOpen && currentShift && !closureResult) {
            const draft = { declaredAmounts, usdDenoms, looseCoins, notes };
            localStorage.setItem(`closure_draft_${currentShift.id}`, JSON.stringify(draft));
        }
    }, [declaredAmounts, usdDenoms, looseCoins, notes, isOpen, currentShift?.id, closureResult]);

    // Shortcut: Auto-populate declared with expected values for ALL methods
    const handlePopulateExpected = () => {
        const next = {};
        activeMethods.forEach(m => {
            const exp = getExpectedForMethod(m.id);
            next[m.id] = exp.toFixed(2);
        });
        setDeclaredAmounts(next);
        toast.success('Montos del sistema copiados a todos los métodos de pago');
    };

    // Live calculations across all active methods
    const liveCalculations = useMemo(() => {
        let declaredTotalUSD = 0;
        let expectedTotalUSD = 0;
        let declaredTotalVES = 0;
        let expectedTotalVES = 0;
        const diffsByMethod = {};

        const safeRate = rate > 0 ? rate : 1.0;

        activeMethods.forEach(m => {
            const isVes = isVesPayment(m, singleCurrency);
            const expected = getExpectedForMethod(m.id);
            const declared = Number(declaredAmounts[m.id]) || 0;
            const diff = Math.round((declared - expected) * 100) / 100;
            diffsByMethod[m.id] = diff;

            if (isVes) {
                declaredTotalUSD += (declared / safeRate);
                expectedTotalUSD += (expected / safeRate);
                declaredTotalVES += declared;
                expectedTotalVES += expected;
            } else {
                declaredTotalUSD += declared;
                expectedTotalUSD += expected;
                declaredTotalVES += (declared * safeRate);
                expectedTotalVES += (expected * safeRate);
            }
        });

        declaredTotalUSD = Math.round(declaredTotalUSD * 100) / 100;
        expectedTotalUSD = Math.round(expectedTotalUSD * 100) / 100;
        declaredTotalVES = Math.round(declaredTotalVES * 100) / 100;
        expectedTotalVES = Math.round(expectedTotalVES * 100) / 100;

        const netDifferenceUSD = Math.round((declaredTotalUSD - expectedTotalUSD) * 100) / 100;
        const netDifferenceVES = Math.round((declaredTotalVES - expectedTotalVES) * 100) / 100;
        const exceedsTolerance = Math.abs(netDifferenceUSD) > tolerance;

        return {
            diffsByMethod,
            declaredTotalUSD,
            expectedTotalUSD,
            declaredTotalVES,
            expectedTotalVES,
            netDifferenceUSD,
            netDifferenceVES,
            exceedsTolerance
        };
    }, [declaredAmounts, activeMethods, currentShift, singleCurrency, rate, tolerance]);

    if (effectiveClosureMode === 'BLIND') {
        return <BlindClosureModal {...props} />;
    }

    // Difference Badge Renderer
    const renderDiffBadge = (diff, isCurrencyVES = false) => {
        if (diff === 0) {
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 size={12} /> Cuadrado
                </span>
            );
        }
        if (diff > 0) {
            const formatted = isCurrencyVES ? `+Bs. ${diff.toFixed(2)}` : `+$${diff.toFixed(2)}`;
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    {formatted} (Sobrante)
                </span>
            );
        }
        const formatted = isCurrencyVES ? `-Bs. ${Math.abs(diff).toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
        return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                {formatted} (Faltante)
            </span>
        );
    };

    // Icon helper per method
    const renderMethodIcon = (m) => {
        const id = String(m?.id || '').toLowerCase();
        const type = String(m?.type || '').toUpperCase();
        if (type === 'CASH' || id.includes('cash') || id === 'efectivo') {
            const isVes = isVesPayment(m, singleCurrency);
            return (
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${isVes ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                    {isVes ? 'Bs' : <DollarSign size={18} />}
                </div>
            );
        }
        if (id.includes('movil') || id.includes('mobile')) {
            return (
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-black">
                    <Smartphone size={18} />
                </div>
            );
        }
        if (id.includes('zelle') || id.includes('transfer') || id.includes('wire')) {
            return (
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black">
                    <Landmark size={18} />
                </div>
            );
        }
        if (id.includes('fiado') || id.includes('credit') || id.includes('credito') || id.includes('cashea')) {
            return (
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-black">
                    <User size={18} />
                </div>
            );
        }
        return (
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black">
                <CreditCard size={18} />
            </div>
        );
    };

    // Quick tag chips for notes
    const quickTags = [
        'Sin incidencias',
        'Ajuste por redondeo',
        'Faltante de cambio menor',
        'Propina en gaveta',
        'Venta fuera de sistema'
    ];

    const addTag = (tag) => {
        setNotes(prev => prev ? `${prev} | ${tag}` : tag);
    };

    // Submission Handler
    const handleCloseShift = async (activeApproval = approval) => {
        if (liveCalculations.exceedsTolerance && !isUserAdminOrSupervisor && !activeApproval) {
            toast.error(`El descuadre ($${Math.abs(liveCalculations.netDifferenceUSD).toFixed(2)} USD) excede la tolerancia permitida ($${tolerance.toFixed(2)} USD). Requiere autorización.`);
            setShowAuthModal(true);
            return;
        }

        try {
            setLoading(true);
            const supervisorId = activeApproval?.metadata?.approverId || activeApproval?.supervisorId || activeApproval?.id || (isUserAdminOrSupervisor ? user?.id : null);
            const supervisorName = activeApproval?.metadata?.approverName || activeApproval?.supervisorName || activeApproval?.name || (isUserAdminOrSupervisor ? (user?.name || user?.username) : null);

            const numericBreakdown = {};
            activeMethods.forEach(m => {
                numericBreakdown[m.id] = Number(declaredAmounts[m.id]) || 0;
            });

            // Payload compatible with both /cash/close and /cash/close-blind
            const payload = {
                registerId: currentShift.registerId || '1',
                shiftId: currentShift.id,
                finalBreakdown: {
                    ...numericBreakdown
                },
                declaration: {
                    usd: Number(declaredAmounts['cash']) || 0,
                    ves: Number(declaredAmounts['cash_bs'] ?? declaredAmounts['cash_ves'] ?? declaredAmounts['efectivo_bs']) || 0,
                    card: Number(declaredAmounts['debit'] ?? declaredAmounts['card'] ?? declaredAmounts['punto']) || 0,
                    mobile: Number(declaredAmounts['pago_movil'] ?? declaredAmounts['pagomovil']) || 0,
                    zelle: Number(declaredAmounts['zelle']) || 0,
                    looseCoins: Number(looseCoins) || 0
                },
                notes,
                supervisorApprovalId: activeApproval?.id || null,
                approvedBy: supervisorId,
                supervisorId,
                supervisorName,
                overrideBySupervisor: !!activeApproval || isUserAdminOrSupervisor
            };

            const { data } = await api.post('/cash/close', payload);

            const enrichedClosedShift = {
                ...currentShift,
                ...(data?.shift || data || {}),
                totalSalesAmount: Number(data?.salesSummary?.totalSales || data?.totalSalesAmount || currentShift?.totalSalesAmount || 0),
                salesCount: Number(data?.salesSummary?.salesCount || data?.salesCount || currentShift?.salesCount || 0),
                expectedBreakdown: {
                    ...(currentShift?.expectedBreakdown || {}),
                    ...(data?.salesSummary?.expectedBreakdown || data?.expectedBreakdown || {})
                },
                physicalBreakdown: {
                    ...numericBreakdown,
                    ...(data?.salesSummary?.physicalBreakdown || data?.physicalBreakdown || {})
                }
            };

            setClosureResult({
                ...data,
                shift: enrichedClosedShift
            });
            localStorage.removeItem(`closure_draft_${currentShift.id}`);
            
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('shift_status_changed', { 
                    detail: { isOpen: false, shift: null } 
                }));
            }

            // Imprimir automáticamente el comprobante de cierre (Corte Z) en segundo plano y abrir gaveta
            try {
                const shiftItems = data?.salesSummary?.itemsSummary || data?.shift?.salesSummary?.itemsSummary || data?.itemsSummary || [];
                printZReportReceipt({
                    shift: enrichedClosedShift,
                    closureResult: data,
                    declaration: payload.declaration,
                    difference: data?.shift?.difference ?? data?.difference ?? liveCalculations.netDifferenceUSD,
                    supervisorName,
                    user,
                    settings: businessSettings,
                    businessSettings,
                    exchangeRate: rate,
                    currencyMode: singleCurrency ? 'SINGLE' : 'BOTH',
                    kickDrawer: businessSettings?.openDrawerOnPrint !== false,
                    itemsSummary: shiftItems
                });

                if (businessSettings?.zReportItemsPrintMode === 'SEPARATE' && shiftItems.length > 0) {
                    printShiftInventoryReceipt({
                        shift: enrichedClosedShift,
                        itemsSummary: shiftItems,
                        settings: businessSettings,
                        businessSettings
                    });
                }
            } catch (printErr) {
                console.warn('Auto-print Z-Report warning:', printErr);
            }

            toast.success('Turno de caja cerrado e impreso exitosamente');
        } catch (error) {
            const isAuthReq = error.response?.data?.code === 'SUPERVISOR_AUTH_REQUIRED' || error.response?.status === 403;
            const errStr = String(error.response?.data?.error || error.response?.data?.message || error.message || '').toLowerCase();

            if (isAuthReq) {
                toast.error(error.response?.data?.error || error.response?.data?.message || `Descuadre supera la tolerancia ($${tolerance.toFixed(2)} USD). Autorización requerida.`);
                setShowAuthModal(true);
            } else if (errStr.includes('ya se encuentra cerrado') || errStr.includes('ya está cerrado') || errStr.includes('cerrado')) {
                toast.success('El turno ya se encuentra cerrado en el sistema.');
                localStorage.removeItem(`closure_draft_${currentShift.id}`);
                onClose();
                if (onSuccess) onSuccess(currentShift);
            } else {
                toast.error(error.response?.data?.error || error.response?.data?.message || 'Error al cerrar caja');
            }
        } finally {
            setLoading(false);
        }
    };

    // Print Thermal Z-Report Receipt
    const handlePrintZReport = () => {
        try {
            printZReportReceipt({
                shift: closureResult?.shift || closureResult || currentShift,
                closureResult,
                user,
                settings: businessSettings,
                businessSettings,
                exchangeRate: rate,
                currencyMode: singleCurrency ? 'SINGLE' : 'BOTH'
            });
            toast.success('Imprimiendo comprobante de cierre (Corte Z)');
        } catch (e) {
            console.error('Error printing Z-Report:', e);
            toast.error('No se pudo enviar la impresión del Corte Z');
        }
    };

    const handleFinish = () => {
        onClose();
        if (onSuccess) {
            onSuccess(closureResult?.shift || closureResult || currentShift);
        }
    };

    if (!isOpen || !currentShift) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Cierre Asistido & Arqueo de Caja"
            maxWidth="max-w-4xl"
            className="h-[92dvh] max-h-[92dvh] flex flex-col overflow-hidden"
        >
            {closureResult ? (
                /* SUCCESS & AUDIT SUMMARY VIEW */
                <div className="flex flex-col h-full max-h-[92dvh] overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                    <div className="flex-1 overflow-y-auto min-h-0 p-6 sm:p-8 space-y-6 custom-scrollbar">
                        <div className="text-center p-5 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800">
                            <div className="w-12 h-12 bg-emerald-600 text-white rounded-lg flex items-center justify-center mx-auto mb-2.5">
                                <CheckCircle size={26} />
                            </div>
                            <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                ¡Caja Cerrada Exitosamente!
                            </h3>
                            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">
                                Turno de caja auditado, sellado criptográficamente y registrado.
                            </p>
                        </div>

                        {/* Financial Summary */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60 text-center">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Sistema</span>
                                <span className="text-lg font-black font-mono text-slate-800 dark:text-slate-200 block">
                                    ${liveCalculations.expectedTotalUSD.toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mt-0.5 font-mono">
                                        ≈ {formatBs(liveCalculations.expectedTotalVES)}
                                    </span>
                                )}
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60 text-center">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Declarado</span>
                                <span className="text-lg font-black font-mono text-slate-800 dark:text-slate-200 block">
                                    ${liveCalculations.declaredTotalUSD.toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block mt-0.5 font-mono">
                                        ≈ {formatBs(liveCalculations.declaredTotalVES)}
                                    </span>
                                )}
                            </div>
                            <div className={`p-4 rounded-2xl border text-center ${
                                liveCalculations.netDifferenceUSD === 0 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
                                    : liveCalculations.netDifferenceUSD > 0
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                                    : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                            }`}>
                                <span className="text-[10px] font-black uppercase tracking-widest block opacity-70">Diferencia Final</span>
                                <span className="text-lg font-black font-mono block">
                                    {liveCalculations.netDifferenceUSD === 0 ? '$0.00' : `${liveCalculations.netDifferenceUSD > 0 ? '+' : ''}$${liveCalculations.netDifferenceUSD.toFixed(2)} USD`}
                                </span>
                                {!singleCurrency && liveCalculations.netDifferenceUSD !== 0 && (
                                    <span className="text-xs font-bold opacity-80 block mt-0.5 font-mono">
                                        ≈ {liveCalculations.netDifferenceVES > 0 ? '+' : ''}{formatBs(liveCalculations.netDifferenceVES)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="p-4 sm:p-6 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 flex flex-col sm:flex-row gap-3">
                        <button
                            onClick={handlePrintZReport}
                            className="flex-1 py-4 min-h-[48px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black rounded-2xl uppercase tracking-wider text-xs flex items-center justify-center gap-2 hover:opacity-95 shadow-xl transition-all active:scale-95 cursor-pointer"
                        >
                            <Printer size={18} /> Imprimir Corte Z
                        </button>
                        <button
                            onClick={handleFinish}
                            className="flex-1 py-4 bg-primary-600 hover:bg-primary-700 text-white font-black rounded-2xl uppercase tracking-wider text-xs flex items-center justify-center gap-2 shadow-xl shadow-primary-600/20 transition-all active:scale-95 cursor-pointer"
                        >
                            Finalizar y Salir
                        </button>
                    </div>
                </div>
            ) : (
                /* ACTIVE FORM VIEW */
                <div className="flex flex-col h-full max-h-[92dvh] overflow-hidden">
                    {/* Fixed Modal Header */}
                    <div className="px-5 py-4 sm:px-6 sm:py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur shrink-0 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0 border border-primary-500/20 shadow-inner">
                                <Store size={22} />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-sm sm:text-base font-black text-slate-800 dark:text-white uppercase tracking-tight truncate">
                                        Caja {currentShift.registerId || '01'}
                                    </h3>
                                    <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                                        {currentShift.userName || user?.name || 'Cajero'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                                    <Clock size={12} className="shrink-0 text-slate-400" />
                                    <span>
                                        Abierta a las {new Date(currentShift.openedAt || Date.now()).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={handlePopulateExpected}
                                className="px-3.5 py-2 sm:px-4 sm:py-2.5 min-h-[40px] bg-primary-500/10 hover:bg-primary-500/20 text-primary-600 dark:text-primary-400 border border-primary-500/25 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 active:scale-95 shadow-sm cursor-pointer"
                                title="Rellenar todos los campos con los montos esperados del sistema"
                            >
                                <Copy size={15} />
                                <span className="hidden sm:inline">Copiar Esperados</span>
                                <span className="sm:hidden">Esperados</span>
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
                                title="Cerrar ventana"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Content Body */}
                    <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 sm:px-6 sm:py-5 space-y-6 custom-scrollbar">
                        {/* Operational Breakdown Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-3 bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/70">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Fondo Inicial</span>
                                <span className="text-base font-black font-mono text-slate-800 dark:text-slate-100 block">
                                    ${(Number(currentShift.initialAmount) || 0).toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-[10px] font-bold text-slate-400 truncate block font-mono">
                                        ≈ {formatBs(initialVesAmount)}
                                    </span>
                                )}
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/70">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Ventas Turno</span>
                                <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400 block">
                                    ${(Number(currentShift.totalSalesAmount) || 0).toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-[10px] font-bold text-slate-400 truncate block font-mono">
                                        ≈ {formatBs((Number(currentShift.totalSalesAmount) || 0) * (rate > 0 ? rate : 1.0))}
                                    </span>
                                )}
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/70">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Efectivo Teórico</span>
                                <span className="text-base font-black font-mono text-primary-600 dark:text-primary-400 block">
                                    ${(Number(currentShift.expectedCashUsd) || getExpectedForMethod('cash')).toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-[10px] font-bold text-slate-400 truncate block font-mono">
                                        ≈ {formatBs(getExpectedForMethod('cash_bs'))}
                                    </span>
                                )}
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/70">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Sistema</span>
                                <span className="text-base font-black font-mono text-indigo-600 dark:text-indigo-400 block">
                                    ${liveCalculations.expectedTotalUSD.toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-[10px] font-bold text-slate-400 truncate block font-mono">
                                        ≈ {formatBs(liveCalculations.expectedTotalVES)}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Live Comparison Table */}
                        <div className="bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                <h4 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">
                                    Arqueo por Método de Pago
                                </h4>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    Comparación en tiempo real ({activeMethods.length} Métodos)
                                </span>
                            </div>

                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {activeMethods.map(method => {
                                    const isVes = isVesPayment(method, singleCurrency);
                                    const expected = getExpectedForMethod(method.id);
                                    const val = declaredAmounts[method.id] ?? '';
                                    const diff = liveCalculations.diffsByMethod[method.id] ?? 0;
                                    const isCashUsd = method.id === 'cash' || (!isVes && method.type === 'CASH');

                                    return (
                                        <div key={method.id} className="p-4 space-y-3">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                                <div className="flex items-center gap-3">
                                                    {renderMethodIcon(method)}
                                                    <div>
                                                        <span className="text-xs font-black uppercase text-slate-800 dark:text-white block">
                                                            {method.name || method.id.replace(/_/g, ' ').toUpperCase()}
                                                        </span>
                                                        <span className="text-[11px] font-bold text-slate-400">
                                                            Esperado: <strong className="font-mono text-slate-700 dark:text-slate-300">
                                                                {isVes ? `Bs. ${expected.toFixed(2)}` : `$${expected.toFixed(2)}`}
                                                            </strong>
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    <div className="relative">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                                                            {isVes ? 'Bs' : '$'}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            inputMode="decimal"
                                                            step="0.01"
                                                            min="0"
                                                            value={val}
                                                            onChange={(e) => handleDeclaredChange(method.id, e.target.value)}
                                                            placeholder="0.00"
                                                            className="w-36 sm:w-44 pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base sm:text-sm font-black font-mono text-slate-900 dark:text-white outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all shadow-inner text-right"
                                                        />
                                                    </div>

                                                    <div className="w-28 text-right shrink-0">
                                                        {renderDiffBadge(diff, isVes)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Helper for Cash USD denomination breakdown */}
                                            {isCashUsd && (
                                                <div className="pt-1 border-t border-slate-100 dark:border-slate-800/60">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDenomHelper(!showDenomHelper)}
                                                        className="text-primary-600 dark:text-primary-400 text-xs font-black hover:underline flex items-center gap-1.5 transition-colors cursor-pointer"
                                                    >
                                                        <Banknote size={14} />
                                                        <span>Desglosar Billetes y Monedas 💵</span>
                                                        {showDenomHelper ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </button>

                                                    {showDenomHelper && (
                                                        <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-200">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                                                                    Contador de Billetes USD
                                                                </span>
                                                                <span className="text-xs font-black font-mono text-primary-600 dark:text-primary-400">
                                                                    Total: ${denomTotalUSD.toFixed(2)} USD
                                                                </span>
                                                            </div>

                                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                                {['100', '50', '20', '10', '5', '1'].map(bill => (
                                                                    <DenominationInput
                                                                        key={bill}
                                                                        label={`$${bill}`}
                                                                        value={usdDenoms[bill]}
                                                                        onChange={(val) => handleDenomChange(bill, val)}
                                                                    />
                                                                ))}
                                                            </div>

                                                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                                                                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 block mb-2">
                                                                    Monedas y Fracciones USD
                                                                </span>
                                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                                    {[
                                                                        { denom: '0.50', label: '$0.50' },
                                                                        { denom: '0.25', label: '$0.25' },
                                                                        { denom: '0.10', label: '$0.10' },
                                                                        { denom: '0.05', label: '$0.05' },
                                                                        { denom: '0.01', label: '$0.01' }
                                                                    ].map(coin => (
                                                                        <DenominationInput
                                                                            key={coin.denom}
                                                                            label={coin.label}
                                                                            value={usdDenoms[coin.denom]}
                                                                            onChange={(val) => handleDenomChange(coin.denom, val)}
                                                                            isCoin={true}
                                                                        />
                                                                    ))}

                                                                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                                                        <span className="font-black text-slate-800 dark:text-slate-200 text-xs">Sueltas $</span>
                                                                        <input
                                                                            type="number"
                                                                            inputMode="decimal"
                                                                            step="0.01"
                                                                            min="0"
                                                                            value={looseCoins || ''}
                                                                            onChange={(e) => handleLooseCoinsChange(parseFloat(e.target.value) || 0)}
                                                                            className="w-20 p-1.5 text-center font-black bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white outline-none focus:border-primary-500 text-sm shadow-inner font-mono"
                                                                            placeholder="0.00"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Live Discrepancy & Shift Balance Alert */}
                        <div className={`p-4 sm:p-5 rounded-xl border transition-all ${
                            liveCalculations.netDifferenceUSD === 0
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                                : liveCalculations.exceedsTolerance
                                ? 'bg-red-500/10 border-red-500/30 text-red-900 dark:text-red-200'
                                : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
                        }`}>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    {liveCalculations.netDifferenceUSD === 0 ? (
                                        <CheckCircle size={28} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    ) : (
                                        <AlertTriangle size={28} className={liveCalculations.exceedsTolerance ? 'text-red-600 dark:text-red-400 shrink-0' : 'text-amber-600 dark:text-amber-400 shrink-0'} />
                                    )}
                                    <div>
                                        <h4 className="text-sm font-black uppercase tracking-tight">
                                            {liveCalculations.netDifferenceUSD === 0 
                                                ? 'Caja Cuadrada Perfectamente' 
                                                : liveCalculations.netDifferenceUSD > 0 
                                                ? `Sobrante Neto de +$${liveCalculations.netDifferenceUSD.toFixed(2)} USD` 
                                                : `Faltante Neto de -$${Math.abs(liveCalculations.netDifferenceUSD).toFixed(2)} USD`}
                                            {!singleCurrency && liveCalculations.netDifferenceUSD !== 0 && (
                                                <span className="text-xs font-bold ml-1.5 opacity-90 font-mono">
                                                    ({liveCalculations.netDifferenceVES > 0 ? '+' : ''}{formatBs(liveCalculations.netDifferenceVES)})
                                                </span>
                                            )}
                                        </h4>
                                        <p className="text-[11px] font-bold opacity-80">
                                            {liveCalculations.netDifferenceUSD === 0
                                                ? 'Los valores declarados coinciden exactamente con el registro del sistema.'
                                                : liveCalculations.exceedsTolerance
                                                ? `El descuadre excede la tolerancia configurada ($${tolerance.toFixed(2)} USD). Requiere PIN de supervisor.`
                                                : `Diferencia dentro del margen de tolerancia ($${tolerance.toFixed(2)} USD).`}
                                        </p>
                                    </div>
                                </div>

                                <div className="text-right shrink-0">
                                    <span className="text-[10px] font-black uppercase tracking-widest block opacity-70">Total Declarado</span>
                                    <span className="text-lg font-black font-mono block">
                                        ${liveCalculations.declaredTotalUSD.toFixed(2)} USD
                                    </span>
                                    {!singleCurrency && (
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono block">
                                            ≈ {formatBs(liveCalculations.declaredTotalVES)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Observations & Notes */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                    Observaciones de Cierre (Opcional)
                                </label>
                                <span className="text-[10px] font-bold text-slate-400">Auditoría</span>
                            </div>

                            {/* Quick Chips */}
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {quickTags.map(tag => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => addTag(tag)}
                                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-700 transition-all active:scale-95 cursor-pointer"
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>

                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                placeholder="¿Alguna irregularidad, entrega especial o nota para administración?"
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-800 dark:text-white outline-none resize-none focus:border-primary-500 shadow-inner"
                            />
                        </div>
                    </div>

                    {/* Pinned Bottom Action Footer */}
                    <div className="px-5 py-4 sm:px-6 sm:py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur shrink-0 flex items-center justify-between gap-4">
                        <div className="hidden sm:flex items-center gap-3 min-w-0">
                            <span className="text-xs font-bold text-slate-400 shrink-0">Total Declarado:</span>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-base font-black font-mono text-slate-800 dark:text-slate-100 shrink-0">
                                    ${liveCalculations.declaredTotalUSD.toFixed(2)} USD
                                </span>
                                {!singleCurrency && (
                                    <span className="text-xs font-bold text-slate-400 font-mono">
                                        ({formatBs(liveCalculations.declaredTotalVES)})
                                    </span>
                                )}
                            </div>
                            <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shrink-0 ${
                                liveCalculations.netDifferenceUSD === 0
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                    : liveCalculations.netDifferenceUSD > 0
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                    : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
                            }`}>
                                {liveCalculations.netDifferenceUSD === 0 
                                    ? 'Cuadrado' 
                                    : `${liveCalculations.netDifferenceUSD > 0 ? '+' : ''}$${liveCalculations.netDifferenceUSD.toFixed(2)} USD`}
                            </span>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto ml-auto">
                            <button
                                type="button"
                                disabled={loading}
                                onClick={onClose}
                                className="w-1/3 sm:w-auto px-5 py-3.5 min-h-[48px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-black rounded-2xl uppercase tracking-wider transition-all active:scale-95 cursor-pointer flex items-center justify-center"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={loading}
                                onClick={() => handleCloseShift()}
                                className="w-2/3 sm:w-auto px-6 py-3.5 min-h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-2xl uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                                {loading ? (
                                    <>Procesando Cierre...</>
                                ) : (
                                    <>
                                        <Save size={16} /> Confirmar y Cerrar Caja
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Supervisor Auth Modal */}
            {showAuthModal && (
                <SupervisorAuthModal
                    isOpen={showAuthModal}
                    onClose={() => setShowAuthModal(false)}
                    onAuthorized={(authData) => {
                        setShowAuthModal(false);
                        setApproval(authData);
                        handleCloseShift(authData);
                    }}
                    actionType="CASH_CLOSE_OVERRIDE"
                    actionLabel="cerrar turno con descuadre"
                />
            )}
        </BaseModal>
    );
}
