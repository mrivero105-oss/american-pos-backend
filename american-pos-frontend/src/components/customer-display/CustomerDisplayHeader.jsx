import { Columns2, Grid2x2, Cpu, Maximize2, Minimize2 } from 'lucide-react';
import { getBusinessInitials } from './displayHelpers';

export default function CustomerDisplayHeader({
    bizSettings,
    resolvedBizLogo,
    cartData,
    tokens,
    isUsdOnly,
    displayRate,
    rateFormattedClean,
    formattedDate,
    displayTime,
    isConnected,
    setArchTheme,
    isFullscreen,
    toggleFullscreen
}) {
    const { isStudio, isSwiss, isTitanium, headerStyle, headerMuted } = tokens;

    return (
        <header className={`h-[62px] border-b flex items-stretch justify-between shrink-0 ${headerStyle}`}>
            {/* Identidad del Comercio y Estación */}
            <div className="px-4 sm:px-6 flex items-center gap-3.5 min-w-0">
                {resolvedBizLogo ? (
                    <div className={`w-10 h-10 rounded-md border p-1 flex items-center justify-center shrink-0 overflow-hidden ${
                        isSwiss ? 'bg-[#F7F8FA] border-[#C8D0DC]' : 'bg-white border-white/15'
                    }`}>
                        <img
                            src={resolvedBizLogo}
                            alt={bizSettings.name}
                            className="w-full h-full object-contain"
                        />
                    </div>
                ) : (
                    <div className={`w-10 h-10 rounded-md border flex items-center justify-center font-mono font-black text-sm tracking-tight shrink-0 ${
                        isSwiss
                            ? 'bg-[#090D14] text-white border-[#090D14]'
                            : 'bg-[#161D27] text-white border-[#2A3444]'
                    }`}>
                        {getBusinessInitials(bizSettings.name)}
                    </div>
                )}

                <div className="min-w-0">
                    <h1 className="text-sm sm:text-base font-extrabold uppercase tracking-tight leading-none truncate">
                        {bizSettings.name}
                    </h1>
                    <div className={`text-[11px] font-mono mt-1 flex items-center gap-2 truncate ${headerMuted}`}>
                        <span className="font-bold uppercase">{cartData.registerName || 'CAJA 1'}</span>
                        <span>/</span>
                        <span className="truncate">
                            OPERADOR: <strong className={isSwiss ? 'text-[#090D14]' : 'text-white'}>{cartData.cashierName || 'ESTACIÓN ACTIVA'}</strong>
                        </span>
                    </div>
                </div>
            </div>

            {/* Celdas Tabulares Derechas */}
            <div className={`flex items-stretch divide-x border-l ${
                isTitanium ? 'border-[#212834] divide-[#212834]' : isSwiss ? 'border-[#C8D0DC] divide-[#C8D0DC]' : 'border-[#1E2530] divide-[#1E2530]'
            }`}>
                {/* Tasa BCV */}
                {!isUsdOnly && displayRate > 1 && (
                    <div className="hidden md:flex flex-col justify-center px-4 lg:px-5">
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-[0.14em] ${headerMuted}`}>
                            Tasa Oficial BCV
                        </span>
                        <span className={`text-xs lg:text-sm font-mono font-bold tabular-nums mt-0.5 ${
                            isSwiss ? 'text-[#047857]' : 'text-emerald-400'
                        }`}>
                            Bs {rateFormattedClean} / USD
                        </span>
                    </div>
                )}

                {/* Cronómetro */}
                <div className="hidden sm:flex flex-col justify-center px-4 lg:px-5">
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-[0.14em] ${headerMuted}`}>
                        {formattedDate}
                    </span>
                    <span className="text-xs lg:text-sm font-mono font-bold tabular-nums mt-0.5">
                        {displayTime}
                    </span>
                </div>

                {/* Estado de Sincronización */}
                <div className="flex items-center gap-2 px-3.5 lg:px-4">
                    <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
                        {isConnected ? 'En Línea' : 'Local'}
                    </span>
                </div>

                {/* Conmutador de las 3 Arquitecturas + Pantalla Completa */}
                <div className="flex items-center gap-1 px-3">
                    <div className={`flex items-center p-0.5 rounded border ${
                        isSwiss ? 'bg-[#EFF2F6] border-[#C8D0DC]' : 'bg-[#141A23] border-[#263040]'
                    }`}>
                        <button
                            type="button"
                            onClick={() => setArchTheme('studio')}
                            title="Arquitectura Studio Bimodal"
                            className={`w-7 h-7 rounded-xs flex items-center justify-center transition-colors cursor-pointer ${
                                isStudio
                                    ? 'bg-blue-600 text-white'
                                    : isSwiss ? 'text-[#5A6577] hover:text-[#090D14]' : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Columns2 size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setArchTheme('swiss')}
                            title="Arquitectura Swiss Grid"
                            className={`w-7 h-7 rounded-xs flex items-center justify-center transition-colors cursor-pointer ${
                                isSwiss
                                    ? 'bg-[#090D14] text-white'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Grid2x2 size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setArchTheme('titanium')}
                            title="Arquitectura Titanium Console"
                            className={`w-7 h-7 rounded-xs flex items-center justify-center transition-colors cursor-pointer ${
                                isTitanium
                                    ? 'bg-[#2B3544] text-white'
                                    : isSwiss ? 'text-[#5A6577] hover:text-[#090D14]' : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Cpu size={13} />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa (F11)'}
                        className={`w-8 h-8 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                            isSwiss
                                ? 'bg-[#F7F8FA] border-[#C8D0DC] text-[#090D14] hover:bg-[#EAECEF]'
                                : 'bg-[#141A23] border-[#263040] text-slate-300 hover:text-white'
                        }`}
                    >
                        {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </button>
                </div>
            </div>
        </header>
    );
}
