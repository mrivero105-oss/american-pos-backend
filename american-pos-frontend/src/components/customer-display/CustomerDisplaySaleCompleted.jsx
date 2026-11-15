import { Check } from 'lucide-react';
import { formatBs, formatUSD } from '../../utils/format';

export default function CustomerDisplaySaleCompleted({
    completedSale,
    cartData,
    bizSettings,
    isUsdOnly,
    tokens
}) {
    const { isStudio, isSwiss, isTitanium, headerMuted, stagePanelStyle } = tokens;

    return (
        <main className="flex-1 flex items-center justify-center p-6 sm:p-10 overflow-hidden">
            <div className={`w-full max-w-3xl border rounded-md overflow-hidden shadow-lg ${stagePanelStyle}`}>
                {/* Cabecera del Comprobante */}
                <div className={`px-6 sm:px-8 py-5 border-b flex items-center justify-between ${
                    isTitanium ? 'bg-[#131922] border-[#212834]' : isSwiss ? 'bg-[#F7F8FA] border-[#C8D0DC]' : 'bg-[#0A0D12] text-white border-[#1E2530]'
                }`}>
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
                            <Check size={22} strokeWidth={2.8} />
                        </div>
                        <div>
                            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-emerald-500 block">
                                Transacción Registrada
                            </span>
                            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                                {(completedSale.customerName || cartData.customerName)
                                    ? `Gracias por su compra, ${completedSale.customerName || cartData.customerName}`
                                    : 'Gracias por su compra'}
                            </h2>
                        </div>
                    </div>

                    <div className="text-right font-mono">
                        <span className={`text-[10px] uppercase tracking-wider block ${isStudio ? 'text-slate-400' : headerMuted}`}>
                            Estación
                        </span>
                        <span className="text-xs font-bold uppercase">
                            {cartData.registerName || 'CAJA 1'}
                        </span>
                    </div>
                </div>

                {/* Celdas Contables: Total Facturado vs Cambio / Vuelto */}
                <div className={`grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x ${
                    isTitanium ? 'divide-[#212834]' : isSwiss ? 'divide-[#C8D0DC]' : 'divide-[#D4DCE6]'
                }`}>
                    <div className="p-6 sm:p-8">
                        <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.15em] block mb-2 ${
                            isTitanium ? 'text-[#8B96A8]' : 'text-[#5A6577]'
                        }`}>
                            Total Facturado
                        </span>
                        {!isUsdOnly && (completedSale.totalBs || 0) > 0 ? (
                            <>
                                <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight">
                                    {formatBs(completedSale.totalBs)}
                                </div>
                                <div className={`text-sm font-mono font-semibold tabular-nums mt-1.5 ${
                                    isTitanium ? 'text-[#94A3B8]' : 'text-[#5A6577]'
                                }`}>
                                    Ref. {formatUSD(completedSale.totalUSD || 0)}
                                </div>
                            </>
                        ) : (
                            <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight">
                                {formatUSD(completedSale.totalUSD || 0)}
                            </div>
                        )}
                    </div>

                    <div className={`p-6 sm:p-8 ${
                        isTitanium ? 'bg-emerald-950/20' : 'bg-emerald-50/60'
                    }`}>
                        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400 block mb-2">
                            Su Cambio / Vuelto
                        </span>
                        {!isUsdOnly && (completedSale.changeBs || 0) > 0 ? (
                            <>
                                <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                                    {formatBs(completedSale.changeBs)}
                                </div>
                                <div className="text-sm font-mono font-semibold tabular-nums mt-1.5 text-emerald-700/80 dark:text-emerald-300/80">
                                    Ref. {formatUSD(completedSale.changeUSD || 0)}
                                </div>
                            </>
                        ) : (
                            <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                                {formatUSD(completedSale.changeUSD || 0)}
                            </div>
                        )}
                    </div>
                </div>

                {/* Pie del Comprobante */}
                <div className={`px-6 sm:px-8 py-3.5 border-t flex items-center justify-between text-xs ${
                    isTitanium ? 'bg-[#0B0E13] border-[#212834] text-[#8B96A8]' : 'bg-slate-50 border-[#D4DCE6] text-[#5A6577]'
                }`}>
                    <span>Verifique su comprobante antes de retirarse de la estación.</span>
                    <span className="font-mono font-bold uppercase">{bizSettings.name}</span>
                </div>
            </div>
        </main>
    );
}
