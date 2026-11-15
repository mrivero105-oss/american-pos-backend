import { memo, forwardRef, useRef, useState, useEffect, useMemo } from 'react';
import {  
    ShoppingCart,
    Trash2, 
    PlusCircle, 
    Clock, 
    Printer, 
    Users, 
    ChevronDown, 
    Search, 
    UserPlus, 
    CheckCircle2, 
    X, 
    Package, 
    Minus, 
    Plus, 
    Pause, 
    Tag, 
    CreditCard, 
    ArrowRight,
    RefreshCw,
    FileText,
    Scale,
    Layers,
    Volume2,
    VolumeX,
    Lock,
    Tv,
    Banknote,
    Receipt,
    Hash,
    ShieldAlert
} from 'lucide-react';
import { CachedImage } from './CachedImage';
import { formatStock, formatBs, isDualCurrencyMode, isDollarOnlyCountry, isUsdOnlyMode } from '../utils/format';
import { usePos } from '../hooks/PosContext';
import { useTheme } from '../hooks/ThemeContext';
import { useAuth } from '../hooks/AuthContext';
import SupervisorPinModal from './SupervisorPinModal';
import CustomerDisplayModal from './CustomerDisplayModal';
import { isSoundMuted, toggleSoundMute, playScanSound, playDeleteSound } from '../utils/sounds';
import { triggerHaptic } from '../utils/haptics';
import api from '../services/api';
import toast from 'react-hot-toast';

/**
 * CartItem - Renglón Contable de Alta Precisión
 * Estructura ergonómica estilo terminal bancario / retail de élite
 */
const CartItem = memo(forwardRef(({ 
    item, 
    idx, 
    updateQuantity, 
    renderFormatMoney, 
    currencyMode, 
    searchInputRef, 
    onEditWeight, 
    onTogglePresentation, 
    onApplyTierSuggestion 
}, ref) => {
    const isService = Boolean(item.isService || String(item.category || '').trim().toLowerCase() === 'servicios');
    const isCashAdvance = Boolean(item.isCashAdvance || (isService && /\bavance\b/i.test(String(item.originalName || item.name || ''))));
    const isWeighed = !isService && !!(item.isSoldByWeight || item.stockUnit === 'kg' || item.isFractional);
    const weightUnit = item.stockUnit || 'kg';
    const isBulk = !isService && Boolean(item.isBulk);
    const isMidBulk = !isService && Boolean(item.isMidBulk);
    const isTaxExempt = item.taxRate === 0 || item.isExempt === true || item.exempt === true;

    // Swipe-to-Action on Mobile (Touch Events)
    const [dragX, setDragX] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const touchStartRef = useRef({ x: 0, y: 0, time: 0, isHorizontal: null });
    const thresholdVibratedRef = useRef(false);

    const handleQtyChange = (newQty) => {
        if (navigator.vibrate) navigator.vibrate(25);
        if (newQty > item.quantity) {
            playScanSound();
        } else if (newQty === 0) {
            playDeleteSound();
        }
        updateQuantity(item.id, newQty);
    };

    const handleTouchStart = (e) => {
        e.stopPropagation();
        const touch = e.touches[0];
        touchStartRef.current = {
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now(),
            isHorizontal: null
        };
        thresholdVibratedRef.current = false;
        setIsSwiping(true);
    };

    const handleTouchMove = (e) => {
        if (!isSwiping) return;
        const touch = e.touches[0];
        const diffX = touch.clientX - touchStartRef.current.x;
        const diffY = touch.clientY - touchStartRef.current.y;

        if (touchStartRef.current.isHorizontal === null) {
            if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
                touchStartRef.current.isHorizontal = Math.abs(diffX) > Math.abs(diffY);
            }
        }

        if (touchStartRef.current.isHorizontal) {
            e.stopPropagation();
            const maxDrag = 110;
            const resistance = 0.75;
            let currentDrag = diffX * resistance;
            if (currentDrag > maxDrag) currentDrag = maxDrag;
            if (currentDrag < -maxDrag) currentDrag = -maxDrag;

            if (Math.abs(currentDrag) >= 65 && !thresholdVibratedRef.current) {
                thresholdVibratedRef.current = true;
                if (navigator.vibrate) try { navigator.vibrate(25); } catch (_) {}
            } else if (Math.abs(currentDrag) < 65) {
                thresholdVibratedRef.current = false;
            }

            setDragX(currentDrag);
        }
    };

    const handleTouchEnd = (e) => {
        if (!isSwiping) return;
        e?.stopPropagation();
        setIsSwiping(false);

        const ACTION_THRESHOLD = 65;
        if (dragX <= -ACTION_THRESHOLD) {
            if (navigator.vibrate) try { navigator.vibrate(40); } catch (_) {}
            playDeleteSound();
            updateQuantity(item.id, 0);
        } else if (dragX >= ACTION_THRESHOLD) {
            if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
            playScanSound();
            handleQtyChange(item.quantity + 1);
        }

        setDragX(0);
        touchStartRef.current.isHorizontal = null;
    };

    const lineTotalUsd = (item.price * item.quantity) - (Number(item.promoDiscount) || 0);

    return (
        <div 
            ref={ref} 
            className="relative overflow-hidden rounded-xl mb-1.5 select-none"
        >
            {/* Background Action Reveal Layer (Touch Swipe) */}
            <div className="absolute inset-0 flex items-center justify-between pointer-events-none rounded-xl overflow-hidden">
                <div 
                    className={`h-full w-full bg-gradient-to-r from-emerald-600 to-teal-500 text-white flex items-center px-4 font-black text-xs uppercase tracking-wider transition-opacity duration-150 ${
                        dragX > 15 ? 'opacity-100' : 'opacity-0'
                    }`}
                >
                    <div className="flex items-center gap-1.5" style={{ transform: `scale(${Math.min(1.2, 0.7 + (dragX / 100))})` }}>
                        <Plus size={18} strokeWidth={3} />
                        <span>+1 Unidad</span>
                    </div>
                </div>

                <div 
                    className={`h-full w-full bg-gradient-to-l from-rose-600 to-red-500 text-white flex items-center justify-end px-4 font-black text-xs uppercase tracking-wider transition-opacity duration-150 ${
                        dragX < -15 ? 'opacity-100' : 'opacity-0'
                    }`}
                >
                    <div className="flex items-center gap-1.5" style={{ transform: `scale(${Math.min(1.2, 0.7 + (Math.abs(dragX) / 100))})` }}>
                        <span>Eliminar</span>
                        <Trash2 size={18} strokeWidth={2.5} />
                    </div>
                </div>
            </div>

            {/* Fila del Producto - Estructura Táctica */}
            <div 
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                style={{
                    transform: `translate3d(${dragX}px, 0, 0)`,
                    transition: isSwiping ? 'none' : 'transform 0.26s cubic-bezier(0.2, 0, 0, 1)'
                }}
                className="pos-ticket-item group relative bg-white dark:bg-[#0c1427] hover:bg-slate-50/80 dark:hover:bg-[#111c38] border border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl p-2.5 transition-all shadow-2xs z-10"
            >
                {/* Botón de Eliminación Rápida */}
                <button 
                    type="button"
                    onClick={() => {
                        if (navigator.vibrate) navigator.vibrate(40);
                        playDeleteSound();
                        updateQuantity(item.id, 0);
                    }}
                    className="absolute top-2 right-2 w-6 h-6 bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 dark:bg-slate-800/80 dark:hover:bg-rose-950/50 dark:text-slate-400 dark:hover:text-rose-300 rounded-lg flex items-center justify-center transition-all z-10 border border-slate-200/80 dark:border-slate-700/80 cursor-pointer active:scale-90"
                    title="Eliminar este producto del ticket"
                >
                    <Trash2 size={12} strokeWidth={2.2} />
                </button>
            
                <div className="flex items-start gap-2.5">
                    {/* Thumbnail con Badge Numérico de Renglón */}
                    <div className="relative shrink-0 mt-0.5">
                        <div className="w-11 h-11 aspect-square bg-slate-100 dark:bg-slate-900 rounded-xl flex items-center justify-center border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-2xs">
                            {item.imageUri || item.imageUrl ? (
                                <CachedImage 
                                    src={item.imageUrl || item.imageUri} 
                                    alt={item.name} 
                                    className="w-full h-full object-cover object-center block"
                                    fallback={<Package size={18} className="text-slate-400 dark:text-slate-500" />}
                                />
                            ) : (
                                <Package size={18} className="text-slate-400 dark:text-slate-500" />
                            )}
                        </div>
                        <span className="absolute -top-1.5 -left-1.5 bg-slate-800 dark:bg-slate-700 text-white text-[9px] font-mono font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-2xs border border-white dark:border-slate-900">
                            {idx + 1}
                        </span>
                    </div>
                    
                    {/* Contenido Central */}
                    <div className="flex-1 min-w-0 pr-6">
                        {/* Nombre del Producto */}
                        <h4 className="font-bold text-xs sm:text-[13px] text-slate-900 dark:text-white tracking-tight leading-snug line-clamp-2" title={item.name}>
                            {item.name}
                        </h4>

                        {/* Metadatos y Presentación */}
                        <div className="mt-1 flex items-center flex-wrap gap-1.5">
                            {/* Badge Fiscal */}
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-mono font-semibold tracking-tight uppercase border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-700/80">
                                {isTaxExempt ? 'EXENTO' : 'IVA 16%'}
                            </span>

                            {/* Selector de Presentación o Peso */}
                            {item.presentationName ? (
                                <button
                                    type="button"
                                    onClick={() => onTogglePresentation && onTogglePresentation(item.id)}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight inline-flex items-center gap-1 border bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300/80 dark:border-slate-700 transition-colors cursor-pointer"
                                    title="Alternar presentación"
                                >
                                    <Layers size={9.5} className="text-slate-500 dark:text-slate-400 shrink-0" />
                                    <span className="truncate max-w-[120px]">{item.presentationName}</span>
                                    <span className="text-[8px] text-primary-600 dark:text-primary-400 font-extrabold">↺</span>
                                </button>
                            ) : (Number(item.unitsPerBulk) > 1 || Number(item.unitsPerMidBulk) > 0) ? (
                                <button
                                    type="button"
                                    onClick={() => onTogglePresentation && onTogglePresentation(item.id)}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight inline-flex items-center gap-1 border bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300/80 dark:border-slate-700 transition-colors cursor-pointer"
                                    title="Alternar entre Detal, Media y Mayor"
                                >
                                    <Package size={9.5} className="text-slate-500 dark:text-slate-400 shrink-0" />
                                    <span className="truncate max-w-[120px]">
                                        {isBulk ? (item.bulkUnitName || 'Bulto') : (isMidBulk ? (item.midBulkUnitName || 'Media') : 'Unidad')}
                                    </span>
                                    <span className="text-[8px] text-primary-600 dark:text-primary-400 font-extrabold">↺</span>
                                </button>
                            ) : null}

                            {/* Precio Unitario */}
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                                {currencyMode === 'BOTH' ? (
                                    <span>
                                        {renderFormatMoney(item.price, 'VES')}{isWeighed ? `/${weightUnit}` : ''} · <span className="font-semibold text-slate-500 dark:text-slate-400">{renderFormatMoney(item.price, 'USD')}</span>
                                    </span>
                                ) : (
                                    <span>{renderFormatMoney(item.price, currencyMode === 'VES' ? 'VES' : 'USD')}{isWeighed ? `/${weightUnit}` : ''}</span>
                                )}
                            </span>
                        </div>

                        {/* Descuento por Promoción si aplica */}
                        {Number(item.promoDiscount) > 0 && (
                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800/80 uppercase">
                                <Tag size={9} className="text-rose-500 shrink-0" />
                                <span>{item.appliedPromoName || 'Promoción'}</span>
                                <span className="font-mono font-black ml-0.5">(-${Number(item.promoDiscount).toFixed(2)})</span>
                            </div>
                        )}

                        {/* Fila Inferior: Controles de Cantidad y Total de Renglón */}
                        <div className="mt-2 pt-1 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-2">
                            {/* Stepper Monolítico Ergonómico */}
                            {isCashAdvance ? (
                                <button
                                    type="button"
                                    onClick={() => onEditWeight && onEditWeight(item)}
                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[10.5px] font-bold transition-colors cursor-pointer"
                                >
                                    <Banknote size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span>Ajustar avance</span>
                                </button>
                            ) : isWeighed ? (
                                <button 
                                    type="button"
                                    onClick={() => onEditWeight && onEditWeight(item)}
                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:text-amber-300 border border-amber-300/80 dark:border-amber-700/80 rounded-lg text-[11px] font-mono font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
                                >
                                    <Scale size={12} className="text-amber-600 dark:text-amber-400" />
                                    <span>{formatStock(item.quantity, 3)} {weightUnit}</span>
                                    <span className="text-[9px] text-amber-600 underline font-bold ml-0.5">Pesar</span>
                                </button>
                            ) : (
                                <div className="inline-flex items-center h-7 rounded-lg border border-slate-300/90 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/80 overflow-hidden shadow-2xs">
                                    <button 
                                        type="button"
                                        onClick={() => handleQtyChange(Math.max(0, item.quantity - 1))}
                                        className="w-7 h-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer active:scale-90"
                                        title="Disminuir (-1)"
                                    >
                                        <Minus size={11} strokeWidth={2.5} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onEditWeight && onEditWeight(item)}
                                        className="h-full px-2 min-w-[2.25rem] text-center font-mono font-black text-xs text-slate-900 dark:text-white bg-white dark:bg-slate-800/90 border-x border-slate-200 dark:border-slate-700/80 tabular-nums cursor-pointer hover:text-primary-600 transition-colors"
                                        title="Hacer clic para ingresar cantidad numérica"
                                    >
                                        {item.quantity}
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => handleQtyChange(item.quantity + 1)}
                                        className="w-7 h-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer active:scale-90"
                                        title="Aumentar (+1)"
                                    >
                                        <Plus size={11} strokeWidth={2.5} />
                                    </button>
                                </div>
                            )}

                            {/* Total de Renglón Contable */}
                            <div className="flex flex-col items-end leading-none">
                                <div className="font-mono font-black text-sm text-slate-950 dark:text-white tabular-nums tracking-tight">
                                    {renderFormatMoney(item.finalSubtotal ?? (item.price * item.quantity - (Number(item.promoDiscount) || 0)), currencyMode === 'USD' ? 'USD' : 'VES')}
                                </div>
                                {currencyMode === 'BOTH' && (
                                    <span className="font-mono font-bold text-[10.5px] text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                                        {renderFormatMoney(lineTotalUsd, 'USD')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}));

/**
 * CartSidebar - Terminal de Venta y Liquidación de Élite
 */
const CartSidebar = memo(({
    localCart,
    handleClearCart,
    onAddToCart,
    updateQuantity,
    onTogglePresentation,
    onEditWeight,
    onApplyTierSuggestion,
    handleHoldSale,
    setIsCheckoutOpen,
    setIsHeldModalOpen,
    handlePrintLast,
    handleOpenDrawer,
    setActionDialog,
    selectedCustomer,
    setSelectedCustomer,
    activeCustomer,
    customerSearch,
    setCustomerSearch,
    isCustomerDropdownOpen,
    setIsCustomerDropdownOpen,
    filteredCustomers,
    setShowNewCustomerModal,
    subtotal,
    taxableBase,
    exemptBase,
    ivaAmount,
    ivaRate,
    igtfAmount = 0,
    igtfRate = 3,
    igtfEnabled = false,
    discountActive,
    discountAmount,
    totalPromoSavings = 0,
    appliedPromotions = [],
    total,
    totalWithIgtf,
    currencyMode,
    exchangeRate,
    renderFormatMoney,
    processing,
    heldSalesCount,
    searchInputRef,
    handleSaveQuotation,
    businessSettings,
    showCustomerSelector = false,
    onClose = null
}) => {
    const { isShiftOpen, promptOpenCashShift, country, isUsdOnly, registerId, registerDisplayName, clearPosState } = usePos();
    const isDollar = isUsdOnly || isDollarOnlyCountry(country) || isDollarOnlyCountry(businessSettings?.country);
    const displayCurrencyMode = isDollar ? 'SINGLE' : currencyMode;
    const isDual = !isDollar && isDualCurrencyMode({ currencyMode, country, ...businessSettings });
    const normCountry = String(country || businessSettings?.country || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isEcuador = normCountry.includes('ecuador');
    const { theme } = useTheme();

    const { user } = useAuth();
    const userRole = String(user?.role || '').toLowerCase();
    const isPrivileged = ['admin', 'superadmin', 'owner', 'dueño', 'master', 'supervisor'].includes(userRole);
    const requireSupervisor = businessSettings?.requireSupervisorForDrawer !== false;
    const isDrawerProtected = requireSupervisor && !isPrivileged;

    const [isSupervisorDrawerOpen, setIsSupervisorDrawerOpen] = useState(false);

    useEffect(() => {
        const handleReq = () => setIsSupervisorDrawerOpen(true);
        if (typeof window !== 'undefined') {
            window.addEventListener('request_supervisor_drawer', handleReq);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('request_supervisor_drawer', handleReq);
            }
        };
    }, []);

    const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());

    const getLocalTodayKey = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const activeRegisterKey = String(registerId || localStorage.getItem('pos_device_id') || registerDisplayName || localStorage.getItem('pos_register_name') || 'default')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
    const trackerStorageKey = `pos_daily_ticket_tracker_${activeRegisterKey}`;

    const [nextTicketNumber, setNextTicketNumber] = useState(() => {
        try {
            const currentId = String(registerId || localStorage.getItem('pos_device_id') || '').trim();
            const raw = localStorage.getItem(trackerStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (
                    parsed &&
                    parsed.date === getLocalTodayKey() &&
                    (!currentId || !parsed.registerId || parsed.registerId === currentId) &&
                    Number.isFinite(Number(parsed.count))
                ) {
                    return Number(parsed.count) + 1;
                }
            }
        } catch (_) {}
        return 1;
    });

    useEffect(() => {
        let mounted = true;
        const syncDailyTicketCount = async () => {
            const todayKey = getLocalTodayKey();
            const currentRegName = registerDisplayName || localStorage.getItem('pos_register_name') || '';
            const currentRegId = registerId || localStorage.getItem('pos_device_id') || '';
            try {
                const res = await api.get('/sales/daily-count', {
                    params: {
                        registerName: currentRegName,
                        registerId: currentRegId
                    }
                });
                if (mounted && res.data && Number.isFinite(Number(res.data.count))) {
                    const count = Number(res.data.count);
                    const dateStr = res.data.date || todayKey;
                    const trackerData = JSON.stringify({ date: dateStr, count, registerName: currentRegName, registerId: currentRegId });
                    localStorage.setItem(trackerStorageKey, trackerData);
                    setNextTicketNumber(count + 1);
                }
            } catch (_) {
                try {
                    const raw = localStorage.getItem(trackerStorageKey);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (!parsed || parsed.date !== todayKey || (currentRegId && parsed.registerId && parsed.registerId !== currentRegId)) {
                            const resetData = JSON.stringify({ date: todayKey, count: 0, registerName: currentRegName, registerId: currentRegId });
                            localStorage.setItem(trackerStorageKey, resetData);
                            if (mounted) setNextTicketNumber(1);
                        } else if (mounted) {
                            setNextTicketNumber((Number(parsed.count) || 0) + 1);
                        }
                    } else if (mounted) {
                        setNextTicketNumber(1);
                    }
                } catch (_e) {}
            }
        };

        syncDailyTicketCount();

        const handleTicketUpdated = (e) => {
            if (e.detail && Number.isFinite(Number(e.detail.nextTicketNumber))) {
                setNextTicketNumber(Number(e.detail.nextTicketNumber));
            } else {
                syncDailyTicketCount();
            }
        };

        window.addEventListener('pos-daily-ticket-updated', handleTicketUpdated);
        const dayCheckInterval = setInterval(syncDailyTicketCount, 30000);

        return () => {
            mounted = false;
            window.removeEventListener('pos-daily-ticket-updated', handleTicketUpdated);
            clearInterval(dayCheckInterval);
        };
    }, [registerDisplayName, registerId, user?.id, trackerStorageKey]);

    useEffect(() => {
        const handleMuteChange = (e) => {
            if (e.detail && typeof e.detail.muted === 'boolean') {
                setSoundMutedState(e.detail.muted);
            }
        };
        window.addEventListener('pos-sound-mute-changed', handleMuteChange);
        return () => window.removeEventListener('pos-sound-mute-changed', handleMuteChange);
    }, []);

    const handleToggleSound = () => {
        const nextMuted = toggleSoundMute();
        setSoundMutedState(nextMuted);
        if (navigator.vibrate) try { navigator.vibrate(25); } catch (_) {}
        if (!nextMuted) {
            playScanSound();
        }
    };

    const [isCustomerDisplayModalOpen, setIsCustomerDisplayModalOpen] = useState(false);

    const handleOpenCustomerDisplay = (e) => {
        if (e && e.shiftKey) {
            const width = 1280;
            const height = 720;
            const left = (window.screen.width - width) / 2;
            const top = (window.screen.height - height) / 2;
            const popup = window.open(
                '/#/display',
                'IsaacCustomerDisplay',
                `width=${width},height=${height},top=${top},left=${left},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
            );
            if (!popup) {
                window.open('/#/display', '_blank');
            }
            return;
        }
        setIsCustomerDisplayModalOpen(true);
    };

    // Mobile Swipe Gesture Handlers to dismiss cart
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);

    const handleTouchStart = (e) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e) => {
        if (!onClose) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX.current;
        const deltaY = e.changedTouches[0].clientY - touchStartY.current;
        
        if (deltaX > 75 && Math.abs(deltaY) < 75) {
            onClose();
        } else if (deltaY > 80 && Math.abs(deltaX) < 75) {
            onClose();
        }
    };

    const handleCheckoutClick = () => {
        if (!isShiftOpen) {
            promptOpenCashShift();
            return;
        }
        setIsCheckoutOpen(true);
    };

    // Unidades totales calculadas reactivamente
    const totalUnitsCount = useMemo(() => {
        return localCart.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
    }, [localCart]);

    return (
        <div 
            className="pos-ticket-panel flex w-full h-full flex-col bg-[#f0f4f8] dark:bg-[#060c1c] border-l border-slate-300/80 dark:border-slate-800 z-20 overflow-hidden relative shadow-[-4px_0_20px_rgba(0,0,0,0.04)]"
        >
            {/* Header del Ticket - Diseño Terminal Bancaria */}
            <div 
                className="pos-ticket-header shrink-0 flex flex-col bg-[#e8edf4] dark:bg-[#081024] border-b border-slate-300/80 dark:border-slate-800"
            >
                {/* Mobile Pull Handle */}
                {onClose && (
                    <div 
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className="lg:hidden w-full pt-2 pb-1.5 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 cursor-pointer select-none border-b border-slate-200 dark:border-slate-800"
                        onClick={onClose}
                        title="Desliza o toca para cerrar"
                    >
                        <div className="w-10 h-1 rounded-full bg-slate-400 dark:bg-slate-600"></div>
                    </div>
                )}

                {/* Barra de Identidad del Ticket */}
                {/* Cabecera del Ticket */}
                <div className="pos-ticket-header px-3 py-2.5 bg-white/80 dark:bg-slate-900/90 backdrop-blur-xs flex justify-between items-center border-b border-slate-200/90 dark:border-slate-800">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {onClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="lg:hidden p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-white rounded-lg transition-all active:scale-95 flex items-center justify-center border border-slate-200 dark:border-slate-700 cursor-pointer"
                                title="Cerrar Carrito"
                            >
                                <X size={14} />
                            </button>
                        )}
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0 border border-slate-800 shadow-2xs relative">
                                <Receipt size={15} strokeWidth={2.4} />
                                {localCart.length > 0 && (
                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse"></span>
                                )}
                            </div>
                            <div className="flex flex-col min-w-0 leading-tight">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono font-black text-sm text-slate-900 dark:text-white tracking-tight">
                                        Ticket #{nextTicketNumber}
                                    </span>
                                    {localCart.length > 0 ? (
                                        <span className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 tracking-wider">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                            EN VENTA
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 tracking-wider">
                                            LISTO
                                        </span>
                                    )}
                                </div>
                                <span className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400 truncate">
                                    {localCart.length === 0 ? 'Sin artículos agregados' : `${localCart.length} ${localCart.length === 1 ? 'producto' : 'productos'} · ${totalUnitsCount} ${totalUnitsCount === 1 ? 'und' : 'unds'}`}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    {/* Controles Auxiliares integrados en micro-toolbar */}
                    <div className="flex items-center gap-1 bg-slate-100/90 dark:bg-slate-800/80 p-0.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 shrink-0">
                        {/* Visor de Clientes (Segunda Pantalla) */}
                        <button
                            type="button"
                            onClick={handleOpenCustomerDisplay}
                            className="h-7 w-7 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 transition-all cursor-pointer shadow-2xs flex items-center justify-center active:scale-95 shrink-0"
                            title="Visor de Clientes (Shift + Clic para pantalla externa)"
                        >
                            <Tv size={13} />
                        </button>

                        {/* Silenciador de Audio */}
                        <button
                            type="button"
                            onClick={handleToggleSound}
                            className={`h-7 w-7 rounded-lg transition-all cursor-pointer shadow-2xs flex items-center justify-center active:scale-95 shrink-0 ${
                                soundMuted 
                                    ? 'bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900' 
                                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                            title={soundMuted ? 'Sonidos silenciados (Clic para activar)' : 'Silenciar efectos'}
                        >
                            {soundMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                        </button>

                        {/* Limpiar Ticket F6 */}
                        <button 
                            type="button"
                            onClick={handleClearCart || (() => {
                                clearPosState();
                                triggerHaptic('medium');
                                toast.success('Ticket vaciado', { duration: 1500, icon: '🗑️' });
                            })}
                            disabled={localCart.length === 0}
                            className="h-7 px-2 bg-white dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 text-slate-700 dark:text-slate-300 rounded-lg transition-all disabled:opacity-35 disabled:hover:bg-white flex items-center gap-1 active:scale-95 shadow-2xs cursor-pointer font-bold shrink-0"
                            title="Limpiar Ticket completo (F6)"
                        >
                            <Trash2 size={12} className={localCart.length > 0 ? "text-rose-500" : ""} />
                            <span className="text-[9.5px] font-mono font-bold">F6</span>
                        </button>
                    </div>
                </div>

                {/* Comandos Rápidos del POS (Botonera Táctica con Identidad Semántica) */}
                <div className="pos-ticket-commands p-2 bg-slate-100/80 dark:bg-slate-900/90 grid grid-cols-5 gap-1.5 border-b border-slate-200/90 dark:border-slate-800">
                    {[
                        { 
                            icon: PlusCircle, 
                            label: 'Varios', 
                            shortcut: 'F3', 
                            action: () => setActionDialog({ isOpen: true, type: 'ADD_MANUAL', data: { defaultValue: '' } }),
                            colorClasses: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 hover:border-slate-300 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 dark:text-slate-200 dark:border-slate-700/80',
                            iconColor: 'text-slate-600 dark:text-slate-300',
                            badgeClasses: 'bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-600/70'
                        },
                        { 
                            icon: Clock, 
                            label: localCart.length > 0 ? 'Pausar' : 'Espera', 
                            shortcut: 'F5', 
                            count: heldSalesCount, 
                            action: () => {
                                if (localCart.length > 0) {
                                    handleHoldSale();
                                } else {
                                    setIsHeldModalOpen(true);
                                }
                            },
                            countAction: () => setIsHeldModalOpen(true),
                            colorClasses: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 hover:border-slate-300 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 dark:text-slate-200 dark:border-slate-700/80',
                            iconColor: 'text-slate-600 dark:text-slate-300',
                            badgeClasses: 'bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-600/70'
                        },
                        { 
                            icon: FileText, 
                            label: 'Cotizar', 
                            shortcut: 'Ctrl+S', 
                            disabled: localCart.length === 0 || processing, 
                            action: handleSaveQuotation,
                            colorClasses: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 hover:border-slate-300 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 dark:text-slate-200 dark:border-slate-700/80',
                            iconColor: 'text-slate-600 dark:text-slate-300',
                            badgeClasses: 'bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-600/70'
                        },
                        { 
                            icon: Printer, 
                            label: 'Reimpr.', 
                            shortcut: 'Último',
                            action: handlePrintLast,
                            colorClasses: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 hover:border-slate-300 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 dark:text-slate-200 dark:border-slate-700/80',
                            iconColor: 'text-slate-600 dark:text-slate-300',
                            badgeClasses: 'bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-600/70'
                        },
                        { 
                            icon: isDrawerProtected ? Lock : Banknote, 
                            label: 'Gaveta', 
                            shortcut: isDrawerProtected ? 'PIN' : 'F9', 
                            action: () => {
                                if (isDrawerProtected) {
                                    setIsSupervisorDrawerOpen(true);
                                } else {
                                    handleOpenDrawer();
                                }
                            },
                            colorClasses: 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 hover:border-slate-300 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 dark:text-slate-200 dark:border-slate-700/80',
                            iconColor: 'text-slate-600 dark:text-slate-300',
                            badgeClasses: 'bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-600/70'
                        }
                    ].map((btn, bIdx) => (
                        <button 
                            key={bIdx}
                            type="button"
                            onClick={btn.action}
                            disabled={btn.disabled}
                            title={`${btn.label} (${btn.shortcut})`}
                            className={`flex flex-col items-center justify-between h-12 py-1.5 px-1 rounded-xl border transition-all relative cursor-pointer select-none group active:scale-[0.96] shadow-2xs hover:shadow-xs ${
                                btn.disabled 
                                    ? 'opacity-35 cursor-not-allowed bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 grayscale' 
                                    : btn.colorClasses
                            }`}
                        >
                            <btn.icon size={15} strokeWidth={2.3} className={`${btn.iconColor} shrink-0 transition-transform group-hover:scale-110`} />
                            <span className="text-[10.5px] font-black tracking-tight leading-none mt-0.5">
                                {btn.label}
                            </span>
                            <span className={`text-[7.5px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border leading-none tracking-wider ${btn.badgeClasses}`}>
                                {btn.shortcut}
                            </span>
                            {btn.count > 0 && (
                                <span 
                                    onClick={(e) => {
                                        if (btn.countAction) {
                                            e.stopPropagation();
                                            btn.countAction();
                                        }
                                    }}
                                    className="absolute -top-1.5 -right-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[9.5px] min-w-[18px] h-4.5 px-1 rounded-full flex items-center justify-center font-black shadow-md border-2 border-white dark:border-slate-900 animate-pulse transition-transform hover:scale-115 cursor-pointer"
                                    title={`Hay ${btn.count} venta(s) en espera. Clic para abrirlas.`}
                                >
                                    {btn.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Selector de Cliente (solo si se activa explícitamente) */}
                {showCustomerSelector && (
                    <div className="pos-ticket-customer px-2 py-1.5 bg-white/80 dark:bg-slate-900/60 relative border-b border-slate-200 dark:border-slate-800">
                        <button 
                            onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between group cursor-pointer"
                        >
                            <div className="flex items-center gap-2 truncate">
                                <Users size={13} className="text-primary-500 shrink-0" />
                                <span className="text-[11.5px] font-bold text-slate-900 dark:text-slate-100 truncate">
                                    {activeCustomer ? activeCustomer.name : 'Cliente Ocasional'}
                                </span>
                            </div>
                            <ChevronDown size={13} className="text-slate-400 shrink-0" />
                        </button>
                    </div>
                )}
            </div>

            {/* Feed de Productos del Ticket */}
            <div 
                className="pos-ticket-feed flex-1 overflow-y-auto min-h-0 px-2 py-2 space-y-1 custom-scrollbar bg-[#f0f4f8] dark:bg-[#060c1c]"
            >
                {localCart.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-4 text-center select-none">
                        <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 flex items-center justify-center mb-3 shadow-xs">
                            <ShoppingCart size={22} className="text-slate-400 dark:text-slate-500" />
                        </div>
                        <h3 className="font-extrabold text-sm text-slate-800 dark:text-slate-200">
                            Ticket Listo para Escanear
                        </h3>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-[220px] leading-relaxed">
                            Selecciona artículos del catálogo o escanea con la pistola de código de barras.
                        </p>
                        <div className="mt-4 flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/80 text-[10.5px] font-mono text-slate-500 dark:text-slate-400 shadow-2xs">
                            <span className="font-bold text-slate-700 dark:text-slate-300">Tip:</span> Pulsa F4 para buscar
                        </div>
                    </div>
                ) : (
                    <>
                        {localCart.map((item, idx) => (
                            <CartItem
                                key={`${item.id}-${item.selectedPresentationId || 'std'}-${idx}`}
                                item={item}
                                idx={idx}
                                updateQuantity={updateQuantity}
                                renderFormatMoney={renderFormatMoney}
                                currencyMode={currencyMode}
                                searchInputRef={searchInputRef}
                                onEditWeight={onEditWeight}
                                onTogglePresentation={onTogglePresentation}
                                onApplyTierSuggestion={onApplyTierSuggestion}
                            />
                        ))}

                        {/* Panel Táctico de Cierre de Renglones (elimina el vacío estético) */}
                        <div className="mt-3 p-2.5 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 space-y-1.5 shadow-2xs">
                            <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
                                <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                                    <Hash size={12} className="text-primary-500" /> Renglones registrados:
                                </span>
                                <span className="font-bold text-slate-900 dark:text-slate-100">
                                    {localCart.length} {localCart.length === 1 ? 'artículo' : 'artículos'} ({totalUnitsCount} pzas)
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 dark:border-slate-800/60 pt-1.5">
                                <span>Caja: {registerDisplayName || 'Principal'}</span>
                                <span className="font-mono">Tasa: {formatBs(exchangeRate)}</span>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Footer - Consola de Liquidación Financiera */}
            <div 
                className="pos-ticket-footer shrink-0 p-2.5 pb-safe bg-white dark:bg-[#070e20] border-t border-slate-200 dark:border-slate-800 space-y-2 relative z-10 shadow-lg"
            >
                {/* Panel Oscuro Ledger Contable */}
                <div className="bg-slate-900 dark:bg-slate-950 text-white rounded-xl p-3 border border-slate-800 shadow-md space-y-2">
                    {/* Desglose de Impuestos si aplica */}
                    {(taxableBase > 0 || ivaAmount > 0 || igtfEnabled || exemptBase > 0) && (
                        <div className="space-y-1 pb-2 border-b border-slate-800/90 text-[10.5px] font-mono">
                            {taxableBase > 0 && (
                                <div className="flex justify-between items-center text-slate-400">
                                    <span>Base Gravable:</span>
                                    <span className="text-slate-200 font-semibold">{renderFormatMoney(taxableBase, isDual ? 'VES' : null)}</span>
                                </div>
                            )}
                            {ivaAmount > 0 && (
                                <div className="flex justify-between items-center text-slate-400">
                                    <span className="flex items-center gap-1">
                                        IVA ({ivaRate}%):
                                    </span>
                                    <span className="text-slate-200 font-semibold">{renderFormatMoney(ivaAmount, isDual ? 'VES' : null)}</span>
                                </div>
                            )}
                            {igtfEnabled && (
                                <div className="flex justify-between items-center text-slate-400">
                                    <span>IGTF (3%):</span>
                                    <span className="text-slate-200 font-semibold">{renderFormatMoney(igtfAmount, isDual ? 'VES' : null)}</span>
                                </div>
                            )}
                            {exemptBase > 0 && (
                                <div className="flex justify-between items-center text-slate-400">
                                    <span>Monto Exento:</span>
                                    <span className="text-slate-200 font-semibold">{renderFormatMoney(exemptBase, isDual ? 'VES' : null)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Descuentos y Promociones Activas */}
                    {Number(totalPromoSavings) > 0 && (
                        <div className="flex justify-between items-center px-2 py-1 bg-slate-800/80 border border-slate-700/80 rounded-lg text-[10.5px]">
                            <span className="text-slate-300 font-semibold flex items-center gap-1">
                                <Tag size={11} className="text-slate-400" /> Ahorro Promoción:
                            </span>
                            <span className="font-mono font-bold text-slate-200">
                                -{renderFormatMoney(totalPromoSavings, isDual ? 'VES' : null)}
                            </span>
                        </div>
                    )}

                    {discountActive > 0 && (
                        <div className="flex justify-between items-center px-2 py-1 bg-slate-800/80 border border-slate-700/80 rounded-lg text-[10.5px]">
                            <span className="text-slate-300 font-semibold">
                                Descuento (-{discountActive}%):
                            </span>
                            <span className="font-mono font-bold text-slate-200">
                                -{renderFormatMoney(discountAmount, isDual ? 'VES' : null)}
                            </span>
                        </div>
                    )}

                    {/* Total a Pagar Principal (Doble Moneda) */}
                    <div className="flex justify-between items-end gap-2 pt-0.5">
                        <div className="flex flex-col min-w-0">
                            <span className="text-[9.5px] font-black uppercase tracking-widest text-slate-400">
                                Total a Pagar
                            </span>
                            <div className="text-2xl xl:text-3xl font-black text-white font-mono tracking-tight leading-none mt-1 truncate">
                                {renderFormatMoney(total, isDual ? 'VES' : null)}
                            </div>
                        </div>

                        {isDual && (
                            <div className="flex flex-col items-end shrink-0">
                                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400 leading-none mb-1">
                                    {igtfEnabled ? 'Total con IGTF' : 'Ref. Divisas'}
                                </span>
                                <div className="text-base xl:text-lg font-black text-emerald-400 font-mono tracking-tight leading-none px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700/80 shadow-2xs">
                                    {renderFormatMoney(igtfEnabled ? totalWithIgtf : total, 'USD')}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Botones Secundarios: Pausar y Descuento */}
                <div className="grid grid-cols-2 gap-1.5">
                    <button 
                        type="button"
                        onClick={handleHoldSale}
                        disabled={localCart.length === 0}
                        className="flex items-center justify-center gap-1.5 py-1.5 min-h-[36px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                        title="Pausar ticket actual (F5)"
                    >
                        <Pause size={12} className="text-slate-500" />
                        <span>Pausar</span>
                        <span className="text-[9.5px] font-mono text-slate-400 font-semibold">(F5)</span>
                    </button>

                    <button 
                        type="button"
                        onClick={() => setActionDialog({ isOpen: true, type: 'DISCOUNT_PROMPT', data: null })}
                        className={`flex items-center justify-center gap-1.5 py-1.5 min-h-[36px] rounded-xl border text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-2xs ${
                            discountActive > 0 
                                ? 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200' 
                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                        title="Aplicar descuento porcentual (F7)"
                    >
                        <Tag size={12} className="text-slate-500" />
                        <span>{discountActive > 0 ? `Desc. -${discountActive}%` : 'Descuento'}</span>
                        <span className="text-[9.5px] font-mono text-slate-400 font-semibold">(F7)</span>
                    </button>
                </div>

                {/* Botón Maestro de Cobro F2 */}
                <button 
                    type="button"
                    onClick={handleCheckoutClick}
                    disabled={localCart.length === 0 || processing}
                    className={`pos-checkout-btn w-full py-3 min-h-[48px] rounded-xl transition-all flex items-center justify-between px-4 group/pay select-none active:scale-[0.98] shadow-md ${
                        localCart.length === 0
                            ? 'bg-slate-200 dark:bg-slate-800/80 text-slate-400 dark:text-slate-600 border border-slate-300/80 dark:border-slate-700/80 cursor-not-allowed shadow-none'
                            : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-black text-sm sm:text-base border border-emerald-500 cursor-pointer shadow-emerald-900/20'
                    }`}
                >
                    {processing ? (
                        <div className="w-full flex items-center justify-center gap-2">
                            <RefreshCw className="animate-spin text-white" size={18} />
                            <span className="font-black text-white text-xs tracking-wider uppercase">Procesando...</span>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-2.5">
                                <CreditCard size={18} strokeWidth={2.4} className={`transition-transform ${localCart.length > 0 ? 'group-hover/pay:scale-110 text-white' : 'text-slate-400'}`} />
                                <span className="text-sm sm:text-base font-black tracking-wider uppercase">
                                    {localCart.length === 0 ? 'Sin Productos' : 'Cobrar / Pagar'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-[11px] font-mono font-black px-2 py-0.5 rounded-md border ${
                                    localCart.length > 0 
                                        ? 'bg-emerald-700/80 text-white border-emerald-400/40' 
                                        : 'bg-slate-300 dark:bg-slate-700 text-slate-500 border-transparent'
                                }`}>
                                    F2
                                </span>
                                <ArrowRight size={18} strokeWidth={2.6} className={`transition-transform ${localCart.length > 0 ? 'group-hover/pay:translate-x-1 text-white' : 'text-slate-400'}`} />
                            </div>
                        </>
                    )}
                </button>
            </div>

            {/* Modal PIN de Supervisor para Gaveta */}
            {isSupervisorDrawerOpen && (
                <SupervisorPinModal
                    isOpen={isSupervisorDrawerOpen}
                    onClose={() => setIsSupervisorDrawerOpen(false)}
                    onApprove={(approvalId) => {
                        setIsSupervisorDrawerOpen(false);
                        handleOpenDrawer('Apertura manual autorizada por supervisor #' + (approvalId || 'OK'));
                    }}
                    actionType="APERTURA MANUAL DE GAVETA"
                    referenceId="DRAWER_MANUAL"
                />
            )}

            {/* Modal de Visor de Clientes */}
            <CustomerDisplayModal
                isOpen={isCustomerDisplayModalOpen}
                onClose={() => setIsCustomerDisplayModalOpen(false)}
            />
        </div>
    );
});

export default CartSidebar;
