import {
    ArrowRight,
    Box,
    Receipt,
    ScanBarcode,
    ShoppingCart,
    Wallet
} from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';
import { isDollarOnlyCountry } from '../../utils/format';

export default function MobilePOSBottomDock({
    isLight,
    cart,
    totalItemsCount,
    totalUSD,
    totalBS,
    isDollarCountry: isDollarCountryProp,
    setIsMobileCartOpen,
    handleSelectPaymentMethod,
    setIsCheckoutOpen,
    activeModule,
    setActiveModule,
    pendingSalesCount,
    setIsScannerOpen
}) {
    const isDollarCountry = isDollarCountryProp !== undefined
        ? Boolean(isDollarCountryProp)
        : isDollarOnlyCountry(typeof localStorage !== 'undefined' ? localStorage.getItem('pos_country') : '');
    return (
        <div
            className={`px-3 pt-1.5 pb-1.5 border-t shrink-0 z-20 ${
                isLight ? 'bg-white border-[#e2e8f0]' : 'bg-[#0b0e14] border-[#1c2330]'
            }`}
            style={{ paddingBottom: 'max(0.4rem, env(safe-area-inset-bottom, 0px))' }}
        >
            <div className="w-full max-w-2xl lg:max-w-none mx-auto flex flex-col gap-2">
                {/* 1. Isla Flotante de Cobro Dual (Solo visible cuando hay productos en el ticket) */}
                {cart.length > 0 && (
                    <div className="lg:hidden w-full rounded-2xl p-1.5 bg-[#0f172a] border border-emerald-500/50 shadow-lg flex items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                triggerHaptic(12);
                                setIsMobileCartOpen(true);
                            }}
                            className="flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1 rounded-xl hover:bg-white/5 active:scale-[0.99] transition-transform cursor-pointer text-left"
                            title="Toca para revisar o editar los artículos del ticket"
                        >
                            <div className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 font-mono font-black text-xs flex items-center justify-center shrink-0 shadow-xs">
                                {totalItemsCount}
                            </div>
                            <div className="min-w-0 flex-1 leading-tight">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-sm sm:text-base font-black font-mono text-white tabular-nums">
                                        ${totalUSD.toFixed(2)}
                                    </span>
                                    {!isDollarCountry && (
                                        <span className="text-[11px] font-extrabold font-mono text-amber-300 tabular-nums truncate">
                                            • Bs. {totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-400 block truncate">
                                    Toca para ver detalle del ticket ({totalItemsCount} {totalItemsCount === 1 ? 'ítem' : 'ítems'})
                                </span>
                            </div>
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                triggerHaptic(18);
                                handleSelectPaymentMethod('Efectivo USD');
                                setIsCheckoutOpen(true);
                            }}
                            className="h-10 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shrink-0 shadow-md cursor-pointer transition-transform"
                            title="Ir directo a cobrar en 1 toque"
                        >
                            <span>Cobrar</span>
                            <ArrowRight size={15} className="stroke-[2.8]" />
                        </button>
                    </div>
                )}

                {/* 2. Dock Táctico Inferior de 5 Accesos Ergonómicos (Thumb Zone Navigation) */}
                <nav className="grid grid-cols-5 items-center gap-1 pt-0.5">
                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            setActiveModule('pos');
                        }}
                        className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                            activeModule === 'pos'
                                ? 'text-emerald-500 font-black'
                                : (isLight ? 'text-slate-500 hover:text-slate-900 font-bold' : 'text-slate-400 hover:text-white font-bold')
                        }`}
                    >
                        <ShoppingCart size={17} />
                        <span className="text-[10px] mt-0.5 leading-none">Venta</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            setActiveModule('sales');
                        }}
                        className={`relative flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                            activeModule === 'sales'
                                ? 'text-emerald-500 font-black'
                                : (isLight ? 'text-slate-500 hover:text-slate-900 font-bold' : 'text-slate-400 hover:text-white font-bold')
                        }`}
                    >
                        <Receipt size={17} />
                        <span className="text-[10px] mt-0.5 leading-none">Tickets</span>
                        {pendingSalesCount > 0 && (
                            <span className="absolute top-0.5 right-3 min-w-[15px] h-[15px] px-1 rounded-full bg-amber-500 text-slate-950 font-black text-[9px] flex items-center justify-center">
                                {pendingSalesCount}
                            </span>
                        )}
                    </button>

                    {/* Botón Central Destacado: Escáner Láser de Cámara */}
                    <div className="flex items-center justify-center">
                        <button
                            type="button"
                            onClick={async () => {
                                triggerHaptic(18);
                                if (activeModule !== 'pos') setActiveModule('pos');
                                if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.ensureCameraPermission) {
                                    try {
                                        await window.Capacitor.Plugins.PosNativeHardware.ensureCameraPermission();
                                    } catch (caughtErr) { console.warn('[MobilePOSBottomDock] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
                                }
                                setIsScannerOpen(true);
                            }}
                            aria-label="Escanear código de barras con cámara"
                            className="w-12 h-11 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center shadow-md active:scale-90 transition-transform cursor-pointer border border-emerald-300/60"
                            title="Escanear código de barras con cámara"
                        >
                            <ScanBarcode size={20} className="stroke-[2.4]" />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            setActiveModule('inventory');
                        }}
                        className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                            activeModule === 'inventory'
                                ? 'text-emerald-500 font-black'
                                : (isLight ? 'text-slate-500 hover:text-slate-900 font-bold' : 'text-slate-400 hover:text-white font-bold')
                        }`}
                    >
                        <Box size={17} />
                        <span className="text-[10px] mt-0.5 leading-none">Stock</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            setActiveModule('cash');
                        }}
                        className={`flex flex-col items-center justify-center py-1 rounded-xl transition-colors cursor-pointer ${
                            activeModule === 'cash'
                                ? 'text-emerald-500 font-black'
                                : (isLight ? 'text-slate-500 hover:text-slate-900 font-bold' : 'text-slate-400 hover:text-white font-bold')
                        }`}
                    >
                        <Wallet size={17} />
                        <span className="text-[10px] mt-0.5 leading-none">Caja</span>
                    </button>
                </nav>
            </div>
        </div>
    );
}
