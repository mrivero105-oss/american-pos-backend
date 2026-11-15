import {
    Menu,
    PauseCircle,
    Plus,
    PlusCircle,
    Search,
    Tag,
    Utensils,
    X
} from 'lucide-react';
import IsaacWebLogo from '../IsaacWebLogo';
import { triggerHaptic } from '../../utils/haptics';
import { VoiceMicButton } from '../../utils/voiceSearch';

export default function MobilePOSHeader({
    T,
    isLight,
    activeModule,
    user,
    setIsSideNavOpen,
    isRestaurantBusiness,
    selectedTable,
    setIsTableSelectModalOpen,
    posMode,
    setIsPriceCheckerModalOpen,
    searchInputRef,
    searchQuery,
    setActiveModule,
    setSearchQuery,
    showToast,
    setIsManualItemModalOpen,
    openCreateProduct,
    heldSales,
    setIsHeldSalesModalOpen
}) {
    return (
        <header className={`app-main-header ${T.headerBg} flex flex-col shrink-0 z-30 transition-colors w-full border-b ${T.border}`}>
            {/* Fila 1: Menú + Logo Oficial de Marca (Adaptado para Android) + Acciones Rápidas (Mesa / Precios) */}
            <div
                className={`w-full pt-2.5 pb-2 px-3 flex items-center justify-between gap-2 ${
                    isLight ? 'bg-white' : 'bg-[#0b0e14]'
                }`}
                style={{ paddingTop: 'max(0.65rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))' }}
            >
                {/* Izquierda: Botón de Menú + Logo Oficial Isaac POS */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            setIsSideNavOpen(true);
                        }}
                        className={`w-9 h-9 rounded-xl border transition-transform cursor-pointer flex items-center justify-center shrink-0 active:scale-95 ${
                            isLight
                                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                : 'bg-[#131924] hover:bg-[#1a2230] text-slate-100 border-[#232d3f]'
                        }`}
                        title="Abrir centro de módulos"
                    >
                        <Menu size={17} />
                    </button>

                    <IsaacWebLogo
                        isLight={isLight}
                        height="h-[38px] sm:h-[44px]"
                        imgClassName="max-w-[190px] sm:max-w-[225px] contrast-[1.05]"
                    />
                </div>

                {/* Derecha: Selector de Mesa + Consultor de Precios */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {activeModule === 'pos' && (
                        <>
                            {isRestaurantBusiness && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        triggerHaptic(12);
                                        setIsTableSelectModalOpen(true);
                                    }}
                                    className={`h-8 px-2.5 rounded-xl border flex items-center justify-center gap-1 shrink-0 active:scale-95 transition-transform cursor-pointer ${
                                        selectedTable
                                            ? 'bg-amber-500 text-slate-950 border-amber-500 font-black shadow-2xs'
                                            : (isLight
                                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                                : 'bg-[#131924] text-slate-300 border-[#232d3f]')
                                    }`}
                                    title="Asignar mesa o notas de comanda"
                                >
                                    <Utensils size={13} className="shrink-0" />
                                    <span className="text-[10.5px] font-extrabold max-w-[58px] truncate">
                                        {selectedTable ? selectedTable.replace('Mesa ', 'M.') : 'Mesa'}
                                    </span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => {
                                    triggerHaptic(15);
                                    setIsPriceCheckerModalOpen(true);
                                }}
                                className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 active:scale-95 transition-transform cursor-pointer ${
                                    posMode === 'PRICE_CHECKER'
                                        ? 'bg-amber-500 text-slate-950 border-amber-500'
                                        : (isLight
                                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                                            : 'bg-[#131924] text-slate-300 border-[#232d3f]')
                                }`}
                                title="Verificador de Precios y Stock"
                            >
                                <Tag size={14} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Fila 2 (Solo en POS): Buscador Táctico Curvo + Acciones Rápidas de Catálogo */}
            {activeModule === 'pos' && user && (
                <div
                    className={`px-3 pb-2 flex items-center gap-1.5 w-full ${
                        isLight ? 'bg-white' : 'bg-[#0b0e14]'
                    }`}
                >
                    <div className="search-bar-container relative flex-1 min-w-0">
                        <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted} pointer-events-none`} />
                        <input
                            ref={searchInputRef}
                            type="text"
                            autoComplete="on"
                            autoCorrect="on"
                            spellCheck={true}
                            value={searchQuery}
                            onChange={(e) => {
                                if (activeModule !== 'pos') setActiveModule('pos');
                                setSearchQuery(e.target.value);
                            }}
                            placeholder="Buscar producto, principio activo o código..."
                            className={`w-full h-9 rounded-xl pl-8 pr-14 text-xs font-semibold transition-colors outline-none select-text border ${
                                isLight
                                    ? 'bg-[#f4f6f9] border-[#dce1e8] text-[#0a0d12] placeholder-[#64748b] focus:bg-white focus:border-emerald-600'
                                    : 'bg-[#131924] border-[#232d3f] text-[#f8fafc] placeholder-[#64748b] focus:bg-[#171f2e] focus:border-emerald-500/70'
                            }`}
                        />
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchQuery('');
                                        searchInputRef.current?.focus();
                                    }}
                                    className={`${T.textMuted} hover:${T.textPrimary} p-1 cursor-pointer`}
                                    title="Limpiar búsqueda"
                                >
                                    <X size={13} />
                                </button>
                            )}
                            <VoiceMicButton
                                size={14}
                                prompt="Di el nombre del producto que buscas..."
                                onResult={(spokenText) => {
                                    if (activeModule !== 'pos') setActiveModule('pos');
                                    setSearchQuery(spokenText);
                                }}
                                onError={(errMsg) => showToast(`🎤 ${errMsg}`)}
                            />
                        </div>
                    </div>

                    {/* Botón Rápido: Ítem Libre / Manual */}
                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            setIsManualItemModalOpen(true);
                        }}
                        className={`h-9 px-2.5 rounded-xl border flex items-center justify-center gap-1 shrink-0 text-[11px] font-extrabold active:scale-95 transition-transform cursor-pointer ${
                            isLight
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/35'
                        }`}
                        title="Agregar ítem manual o monto rápido al ticket"
                    >
                        <Plus size={14} className="stroke-[2.5]" />
                        <span className="hidden xs:inline">Libre</span>
                    </button>

                    {/* Botón Rápido: Nuevo Producto */}
                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic(10);
                            openCreateProduct();
                        }}
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 active:scale-95 transition-transform cursor-pointer ${
                            isLight
                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-[#131924] text-emerald-400 border-[#232d3f]'
                        }`}
                        title="Crear nuevo producto en catálogo"
                    >
                        <PlusCircle size={15} />
                    </button>

                    {Array.isArray(heldSales) && heldSales.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                triggerHaptic(10);
                                setIsHeldSalesModalOpen(true);
                            }}
                            className="relative w-9 h-9 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0 active:scale-95 transition-transform cursor-pointer"
                            title={`Ventas en espera (${heldSales.length})`}
                        >
                            <PauseCircle size={15} />
                            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-slate-950 font-black text-[9px] flex items-center justify-center">
                                {heldSales.length}
                            </span>
                        </button>
                    )}
                </div>
            )}
        </header>
    );
}
