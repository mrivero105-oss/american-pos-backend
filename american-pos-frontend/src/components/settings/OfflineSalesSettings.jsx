import { CloudOff, RefreshCcw, Loader2, AlertTriangle, ShieldCheck as ShieldCheckIcon } from 'lucide-react';

export default function OfflineSalesSettings({ offlineSales = [], syncing = false, onSync }) {
    const hasOfflineSales = Array.isArray(offlineSales) && offlineSales.length > 0;

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs mb-6 space-y-5 transition-all">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-100 dark:border-amber-900/30">
                        <CloudOff size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Ventas en Modo Offline
                            </h2>
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                hasOfflineSales
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40'
                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                            }`}>
                                {hasOfflineSales ? `${offlineSales.length} pendiente(s)` : 'Sincronizado'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Cola de ventas registradas localmente durante cortes de conexión o fallas de red
                        </p>
                    </div>
                </div>

                {hasOfflineSales && (
                    <button
                        type="button"
                        onClick={onSync}
                        disabled={syncing}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-medium text-xs shadow-xs flex items-center gap-2 transition-colors active:scale-98 disabled:opacity-50 cursor-pointer"
                    >
                        {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} 
                        <span>Sincronizar Ventas Ahora</span>
                    </button>
                )}
            </div>

            {hasOfflineSales ? (
                <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300">
                        <AlertTriangle size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="text-xs">
                            <span className="font-semibold">Ventas en cola local: </span>
                            <span>Existen {offlineSales.length} comprobantes guardados en el almacenamiento del navegador aguardando sincronización con la base de datos principal.</span>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left min-w-[550px]">
                                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                                    <tr>
                                        <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Identificador</th>
                                        <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Cliente</th>
                                        <th className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">Total</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {offlineSales.map(sale => (
                                        <tr key={sale.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{sale.id}</td>
                                            <td className="px-4 py-3 text-xs font-medium text-slate-900 dark:text-white">{sale.customerName || 'Cliente Ocasional'}</td>
                                            <td className="px-4 py-3 text-xs font-mono font-bold text-slate-900 dark:text-white">${Number(sale.total || 0).toFixed(2)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="inline-flex items-center px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[11px] font-semibold rounded-md border border-amber-200 dark:border-amber-800/40">
                                                    Pendiente
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center py-10 px-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 text-center">
                    <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center mb-3 border border-emerald-100 dark:border-emerald-900/30">
                        <ShieldCheckIcon size={20} />
                    </div>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-white">Cola de Ventas al Día</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">No hay ventas diferidas pendientes de sincronizar.</p>
                </div>
            )}
        </div>
    );
}
