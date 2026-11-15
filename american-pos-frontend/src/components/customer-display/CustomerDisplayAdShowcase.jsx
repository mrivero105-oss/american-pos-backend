import { Tag, ChevronLeft, ChevronRight, Pause, Play, CreditCard, Package } from 'lucide-react';
import { formatBs, formatUSD } from '../../utils/format';

export default function CustomerDisplayAdShowcase({
    displayConfig,
    activeSlide,
    playlist,
    currentSlideIdx,
    setCurrentSlideIdx,
    setProgressPct,
    isPaused,
    setIsPaused,
    goPrevSlide,
    goNextSlide,
    progressPct,
    resolvedBizLogo,
    bizSettings,
    cartData,
    isUsdOnly,
    displayRate,
    rateFormattedClean,
    visiblePaymentLabels,
    upcomingSlides,
    tokens
}) {
    const { isSwiss, isTitanium, stagePanelStyle, railPanelStyle, railMuted } = tokens;

    return (
        <main className={`flex-1 min-h-0 grid grid-cols-1 ${
            displayConfig.layoutMode === 'fullscreen' ? 'lg:grid-cols-12 p-0' : 'lg:grid-cols-12 p-3 sm:p-4 gap-3 sm:gap-4'
        } overflow-hidden`}>
            {/* ESCENARIO PRINCIPAL PUBLICITARIO */}
            <section className={`${
                displayConfig.layoutMode === 'fullscreen'
                    ? 'lg:col-span-12 border-0 rounded-none'
                    : 'lg:col-span-8 border rounded-md'
            } relative flex flex-col min-h-0 overflow-hidden ${stagePanelStyle}`}>
                {activeSlide ? (
                    activeSlide.kind === 'poster' ? (
                        /* MODO FLYER / POSTER GRÁFICO PURO A SANGRE */
                        <div className={`flex-1 min-h-0 relative flex items-center justify-center overflow-hidden ${
                            isTitanium ? 'bg-[#090B0E]' : 'bg-[#0F131A]'
                        }`}>
                            <img
                                key={activeSlide.id}
                                src={activeSlide.imageUrl}
                                alt={activeSlide.badge || bizSettings.name}
                                className={`absolute inset-0 w-full h-full ${
                                    activeSlide.imageFit === 'cover' ? 'object-cover' : 'object-contain'
                                }`}
                            />
                            {activeSlide.badge && (
                                <div className="absolute top-5 left-5 px-3 py-1 bg-[#0A0D12]/90 text-white border border-white/15 text-[11px] font-mono font-bold uppercase tracking-[0.14em]">
                                    {activeSlide.badge}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* MODO VITRINA EDITORIAL SUIZA (PRODUCTO / OFERTA / CAMPAÑA CON PRECIO DINÁMICO) */
                        <div key={activeSlide.id} className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
                            {/* Marco Visual / Fotográfico */}
                            <div className={`md:col-span-6 h-full min-h-0 flex flex-col p-4 sm:p-6 overflow-hidden border-b md:border-b-0 md:border-r ${
                                isTitanium
                                    ? 'bg-[#0B0E13] border-[#212834]'
                                    : isSwiss
                                        ? 'bg-[#F7F8FA] border-[#C8D0DC]'
                                        : 'bg-[#F6F8FA] border-[#E2E8F0]'
                            }`}>
                                {/* Índice Editorial Superior Izquierdo */}
                                <div className="shrink-0 mb-3 flex items-center gap-2">
                                    <span className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest border ${
                                        isTitanium
                                            ? 'bg-[#141A23] border-[#283242] text-[#CBD5E1]'
                                            : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                                    }`}>
                                        {String(currentSlideIdx + 1).padStart(2, '0')} / {String(playlist.length).padStart(2, '0')}
                                    </span>
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#64748B]">
                                        {activeSlide.sourceLabel}
                                    </span>
                                </div>

                                {activeSlide.imageUrl ? (
                                    <div className={`relative flex-1 min-h-[220px] w-full rounded-md border overflow-hidden bg-white ${
                                        isTitanium ? 'border-[#212834]' : 'border-[#CBD5E1]'
                                    }`}>
                                        <img
                                            src={activeSlide.imageUrl}
                                            alt={activeSlide.title}
                                            className="absolute inset-0 w-full h-full object-contain p-4 sm:p-6 select-none"
                                        />
                                    </div>
                                ) : (
                                    <div className={`flex-1 min-h-[220px] w-full flex flex-col items-center justify-center p-6 border border-dashed rounded-md ${
                                        isTitanium ? 'border-[#252E3D]' : 'border-[#CBD5E1]'
                                    }`}>
                                        <Tag size={44} strokeWidth={1.5} className={isTitanium ? 'text-blue-400 mb-3' : 'text-blue-700 mb-3'} />
                                        <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-center">
                                            {activeSlide.badge}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Ficha Tipográfica y Bloque Monetario */}
                            <div className="md:col-span-6 p-6 sm:p-8 lg:p-10 flex flex-col justify-between overflow-hidden">
                                <div className="space-y-4">
                                    {activeSlide.badge && (
                                        <div className="inline-flex items-center gap-2">
                                            <span className={`px-2.5 py-1 text-[10.5px] font-mono font-bold uppercase tracking-[0.14em] rounded-xs ${
                                                activeSlide.kind === 'promo'
                                                    ? 'bg-blue-600 text-white'
                                                    : isTitanium
                                                        ? 'bg-[#1A222E] text-blue-400 border border-[#2B374A]'
                                                        : 'bg-[#0B0F17] text-white'
                                            }`}>
                                                {activeSlide.badge}
                                            </span>
                                        </div>
                                    )}

                                    <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-[1.08] line-clamp-3">
                                        {activeSlide.title}
                                    </h2>

                                    {activeSlide.subtitle && (
                                        <p className={`text-xs sm:text-sm leading-relaxed line-clamp-2 ${
                                            isTitanium ? 'text-[#94A3B8]' : 'text-[#526075]'
                                        }`}>
                                            {activeSlide.subtitle}
                                        </p>
                                    )}

                                    {/* Tabla de Presentaciones / Empaques si el producto las posee */}
                                    {Array.isArray(activeSlide.presentations) && activeSlide.presentations.length > 0 && (
                                        <div className="pt-2 space-y-1.5">
                                            <span className={`text-[9.5px] font-mono font-bold uppercase tracking-[0.14em] block ${
                                                isTitanium ? 'text-[#8B96A8]' : 'text-[#64748B]'
                                            }`}>
                                                Formatos & Presentaciones Disponibles
                                            </span>
                                            <div className="grid grid-cols-1 gap-1.5">
                                                {activeSlide.presentations.map(pres => (
                                                    <div
                                                        key={pres.id}
                                                        className={`px-3 py-1.5 rounded-xs border flex items-center justify-between text-xs font-mono ${
                                                            isTitanium
                                                                ? 'bg-[#141922] border-[#242D3C] text-[#E2E8F0]'
                                                                : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#0F172A]'
                                                        }`}
                                                    >
                                                        <span className="font-bold uppercase truncate pr-2">{pres.name}</span>
                                                        <div className="flex items-baseline gap-2 shrink-0 tabular-nums">
                                                            {!isUsdOnly ? (
                                                                <>
                                                                    <span className="font-extrabold">
                                                                        {formatBs(pres.price * displayRate)}
                                                                    </span>
                                                                    <span className="text-[10.5px] opacity-65">
                                                                        {formatUSD(pres.price)}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <span className="font-extrabold">{formatUSD(pres.price)}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Bloque Monumental de Precio */}
                                {activeSlide.priceUSD !== null && activeSlide.priceUSD > 0 ? (
                                    <div className={`mt-6 pt-5 border-t ${
                                        isTitanium ? 'border-[#212834]' : 'border-[#D4DCE6]'
                                    }`}>
                                        <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-1 ${
                                            isTitanium ? 'text-[#8B96A8]' : 'text-[#64748B]'
                                        }`}>
                                            {activeSlide.unitLabel || 'PRECIO DE VENTA'}
                                        </span>

                                        {!isUsdOnly ? (
                                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                <div className="text-3xl sm:text-4xl lg:text-[42px] font-black font-mono tabular-nums tracking-tight leading-none">
                                                    {formatBs(activeSlide.priceUSD * displayRate)}
                                                </div>
                                                <span className={`px-2.5 py-1 rounded-xs font-mono text-sm font-bold tabular-nums border ${
                                                    isTitanium
                                                        ? 'bg-[#141A23] border-[#283242] text-emerald-400'
                                                        : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#0F172A]'
                                                }`}>
                                                    Ref. {formatUSD(activeSlide.priceUSD)}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="text-3xl sm:text-4xl lg:text-[42px] font-black font-mono tabular-nums tracking-tight leading-none">
                                                {formatUSD(activeSlide.priceUSD)}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className={`mt-6 pt-4 border-t flex items-center justify-between text-xs font-mono ${
                                        isTitanium ? 'border-[#212834] text-[#8B96A8]' : 'border-[#D4DCE6] text-[#64748B]'
                                    }`}>
                                        <span>CONSULTE EN ESTACIÓN DE COBRO</span>
                                        <span className="font-bold uppercase">{bizSettings.name}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                ) : (
                    /* FALLBACK INSTITUCIONAL SOBRIO (SI NO HAY SLIDES NI PRODUCTOS CON FOTO) */
                    <div className="flex-1 flex flex-col justify-between p-8 sm:p-12">
                        <div className="flex items-center justify-between border-b pb-4 border-current/10">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] opacity-60">
                                ESTACIÓN DE ATENCIÓN AL CLIENTE
                            </span>
                            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] opacity-60">
                                {cartData.registerName || 'CAJA 1'}
                            </span>
                        </div>

                        <div className="my-auto py-8 max-w-2xl">
                            {resolvedBizLogo && (
                                <img
                                    src={resolvedBizLogo}
                                    alt={bizSettings.name}
                                    className="h-24 w-auto object-contain mb-6"
                                />
                            )}
                            <h2 className="text-3xl sm:text-5xl font-black tracking-tight uppercase leading-none mb-4">
                                {bizSettings.name}
                            </h2>
                            <p className={`text-sm sm:text-base leading-relaxed ${
                                isTitanium ? 'text-[#94A3B8]' : 'text-[#526075]'
                            }`}>
                                Estación habilitada para facturación inmediata. Todos los importes y conversiones se auditan en pantalla en tiempo real.
                            </p>
                        </div>

                        <div className="text-[11px] font-mono uppercase tracking-wider opacity-60">
                            {displayConfig.institutionalTagline}
                        </div>
                    </div>
                )}

                {/* Barra Inferior de Control de Carrusel y Progreso Lineal Milimétrico */}
                {playlist.length > 0 && (
                    <div className={`shrink-0 border-t ${
                        isTitanium
                            ? 'bg-[#0B0E13] border-[#212834] text-[#CBD5E1]'
                            : 'bg-[#F8FAFC] border-[#D4DCE6] text-[#0F172A]'
                    }`}>
                        <div className="h-10 px-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                                <span className="text-[11px] font-mono font-bold tabular-nums mr-2 shrink-0">
                                    {String(currentSlideIdx + 1).padStart(2, '0')} / {String(playlist.length).padStart(2, '0')}
                                </span>
                                <div className="hidden sm:flex items-center gap-1">
                                    {playlist.slice(0, 14).map((sl, i) => (
                                        <button
                                            key={sl.id}
                                            type="button"
                                            onClick={() => {
                                                setCurrentSlideIdx(i);
                                                setProgressPct(0);
                                            }}
                                            className={`h-1.5 transition-all cursor-pointer ${
                                                i === currentSlideIdx
                                                    ? 'w-6 bg-blue-600'
                                                    : isTitanium
                                                        ? 'w-2 bg-[#283242] hover:bg-[#3B495E]'
                                                        : 'w-2 bg-[#CBD5E1] hover:bg-[#94A3B8]'
                                            }`}
                                            aria-label={`Ir a diapositiva ${i + 1}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            {playlist.length > 1 && (
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={goPrevSlide}
                                        className={`w-7 h-7 rounded-xs border flex items-center justify-center transition-colors cursor-pointer ${
                                            isTitanium
                                                ? 'border-[#263040] hover:bg-[#18202C]'
                                                : 'border-[#CBD5E1] bg-white hover:bg-slate-100'
                                        }`}
                                        title="Anterior"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsPaused(p => !p)}
                                        className={`w-7 h-7 rounded-xs border flex items-center justify-center transition-colors cursor-pointer ${
                                            isTitanium
                                                ? 'border-[#263040] hover:bg-[#18202C]'
                                                : 'border-[#CBD5E1] bg-white hover:bg-slate-100'
                                        }`}
                                        title={isPaused ? 'Reanudar rotación' : 'Pausar rotación'}
                                    >
                                        {isPaused ? <Play size={12} /> : <Pause size={12} />}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={goNextSlide}
                                        className={`w-7 h-7 rounded-xs border flex items-center justify-center transition-colors cursor-pointer ${
                                            isTitanium
                                                ? 'border-[#263040] hover:bg-[#18202C]'
                                                : 'border-[#CBD5E1] bg-white hover:bg-slate-100'
                                        }`}
                                        title="Siguiente"
                                    >
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Línea de tiempo continua de 2px */}
                        <div className={`h-[2px] w-full ${isTitanium ? 'bg-[#18202B]' : 'bg-[#E2E8F0]'}`}>
                            <div
                                className="h-full bg-blue-600 transition-none"
                                style={{ width: `${isPaused || playlist.length <= 1 ? 100 : progressPct}%` }}
                            />
                        </div>
                    </div>
                )}
            </section>

            {/* RAIL INSTITUCIONAL DERECHO (VISIBLE EN MODO SPLIT) */}
            {displayConfig.layoutMode !== 'fullscreen' && (
                <aside className={`lg:col-span-4 border rounded-md flex flex-col divide-y overflow-hidden ${railPanelStyle}`}>
                    {!isUsdOnly && displayRate > 1 ? (
                        <div className="p-5 shrink-0">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] ${railMuted}`}>
                                    Tipo de Cambio Oficial
                                </span>
                                <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                    BCV Vigente
                                </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight">
                                    Bs {rateFormattedClean}
                                </span>
                                <span className={`text-xs font-mono font-semibold ${railMuted}`}>
                                    por 1,00 USD
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="p-5 shrink-0">
                            <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-1 ${railMuted}`}>
                                Estación Habilitada
                            </span>
                            <div className="text-xl font-extrabold tracking-tight">
                                {cartData.registerName || 'Caja Principal'}
                            </div>
                        </div>
                    )}

                    {/* Celda 2: Canales de Pago Habilitados */}
                    <div className="p-5 shrink-0">
                        <div className="flex items-center gap-2 mb-3">
                            <CreditCard size={13} className={railMuted} />
                            <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] ${railMuted}`}>
                                Canales de Pago Aceptados
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {visiblePaymentLabels.map((label) => (
                                <span
                                    key={label}
                                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-xs border ${
                                        isSwiss
                                            ? 'bg-white border-[#C8D0DC] text-[#090D14]'
                                            : 'bg-[#151B24] border-[#263040] text-slate-200'
                                    }`}
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Celda 3: Cola de Señalización ("A continuación") */}
                    <div className="p-5 flex-1 flex flex-col justify-between overflow-hidden">
                        {upcomingSlides.length > 0 ? (
                            <div className="space-y-2.5 overflow-hidden">
                                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block ${railMuted}`}>
                                    Siguiente en Vitrina
                                </span>
                                <div className="space-y-2">
                                    {upcomingSlides.map(({ slide, index }) => (
                                        <button
                                            key={slide.id}
                                            type="button"
                                            onClick={() => {
                                                setCurrentSlideIdx(index);
                                                setProgressPct(0);
                                            }}
                                            className={`w-full p-2.5 rounded-xs border flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer ${
                                                isSwiss
                                                    ? 'bg-white border-[#C8D0DC] hover:bg-[#EFF2F6]'
                                                    : 'bg-[#141A23] border-[#242E3D] hover:bg-[#1A222E]'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span className={`text-[10px] font-mono font-bold shrink-0 ${railMuted}`}>
                                                    {String(index + 1).padStart(2, '0')}
                                                </span>
                                                {slide.imageUrl ? (
                                                    <div className="w-9 h-9 rounded-xs bg-white p-0.5 border border-black/10 shrink-0 flex items-center justify-center overflow-hidden">
                                                        <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" />
                                                    </div>
                                                ) : (
                                                    <div className={`w-9 h-9 rounded-xs border shrink-0 flex items-center justify-center ${
                                                        isSwiss ? 'border-[#C8D0DC]' : 'border-[#2A3547]'
                                                    }`}>
                                                        <Package size={14} className={railMuted} />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <div className="text-xs font-bold truncate">
                                                        {slide.title || slide.badge || 'Anuncio Comercial'}
                                                    </div>
                                                    <div className={`text-[10px] font-mono uppercase truncate ${railMuted}`}>
                                                        {slide.badge || slide.sourceLabel}
                                                    </div>
                                                </div>
                                            </div>

                                            {slide.priceUSD !== null && slide.priceUSD > 0 && (
                                                <div className="text-right font-mono shrink-0 tabular-nums">
                                                    <div className="text-xs font-extrabold">
                                                        {!isUsdOnly ? formatBs(slide.priceUSD * displayRate) : formatUSD(slide.priceUSD)}
                                                    </div>
                                                    {!isUsdOnly && (
                                                        <div className={`text-[10px] ${railMuted}`}>
                                                            {formatUSD(slide.priceUSD)}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="my-auto">
                                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-1.5 ${railMuted}`}>
                                    Atención en Mostrador
                                </span>
                                <p className={`text-xs leading-relaxed ${railMuted}`}>
                                    Al iniciar el escaneo de sus productos, verá el detalle línea por línea junto al código QR exacto para su pago.
                                </p>
                            </div>
                        )}

                        <div className={`pt-3 mt-3 border-t text-[10.5px] font-mono flex items-center justify-between ${
                            isSwiss ? 'border-[#C8D0DC] text-[#5A6577]' : 'border-[#1E2530] text-[#8E9BAE]'
                        }`}>
                            <span>AUDITORÍA DE PRECIOS EN VIVO</span>
                            <span className="font-bold">{playlist.length} ÍTEMS</span>
                        </div>
                    </div>
                </aside>
            )}
        </main>
    );
}
