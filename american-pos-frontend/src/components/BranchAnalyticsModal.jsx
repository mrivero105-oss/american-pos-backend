import { useState, useEffect } from 'react';
import { 
    X, Building2, MapPin, Phone, Mail, DollarSign, Package, 
    Users, ShoppingCart, TrendingUp, RefreshCcw, Star, CheckCircle2,
    Calendar, ArrowRight, ShieldCheck, Tag, ExternalLink
} from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function BranchAnalyticsModal({ isOpen, onClose, branch, onSwitchBranch }) {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOpen && branch?.id) {
            fetchAnalytics();
        }
    }, [isOpen, branch]);

    const fetchAnalytics = async () => {
        try {
            setLoading(true);
            const { data } = await api.get(`/branches/${branch.id}/analytics`);
            setAnalytics(data);
        } catch (error) {
            console.error('Error fetching branch analytics:', error);
            toast.error('Error al cargar analíticas de la sucursal');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !branch) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-2xl"
            className="p-6 sm:p-8 font-sans overflow-hidden"
        >
            {/* Modal Header */}
            <div className="flex justify-between items-start pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${branch.color || 'from-primary-600 to-indigo-700'} text-white flex items-center justify-center font-black text-2xl shadow-lg border border-white/20 shrink-0`}>
                        <Building2 size={28} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                {branch.name}
                            </h2>
                            {branch.isMain && (
                                <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-lg border border-amber-500/20 uppercase flex items-center gap-1">
                                    <Star size={10} className="fill-amber-500" /> Matriz
                                </span>
                            )}
                        </div>
                        <p className="text-xs font-mono text-slate-400 mt-0.5">
                            Cód: <strong className="text-primary-500">{branch.code || branch.id}</strong> • {branch.managerName ? `Encargado: ${branch.managerName}` : 'Sin encargado'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 text-slate-400 hover:text-red-500 rounded-xl transition-colors cursor-pointer"
                >
                    <X size={20} />
                </button>
            </div>

            {loading ? (
                <div className="py-20 text-center">
                    <RefreshCcw className="animate-spin mx-auto mb-3 text-primary-500" size={36} />
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Calculando métricas de la sede...</p>
                </div>
            ) : analytics ? (
                <div className="space-y-6 pt-6 max-h-[580px] overflow-y-auto custom-scrollbar pr-1">
                    {/* KPI Highlights Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Facturado Total</span>
                            <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1">
                                ${Number(analytics.totalSalesUSD || 0).toFixed(2)}
                            </p>
                            <span className="text-[9px] text-slate-400 mt-0.5 block">{analytics.salesCount} ventas</span>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Stock Valorizado</span>
                            <p className="text-xl font-black text-primary-600 dark:text-primary-400 font-mono mt-1">
                                ${Number(analytics.inventoryValuationUSD || 0).toFixed(2)}
                            </p>
                            <span className="text-[9px] text-slate-400 mt-0.5 block">{analytics.totalUnitsInStock} unidades</span>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Ítems con Stock</span>
                            <p className="text-xl font-black text-slate-900 dark:text-white font-mono mt-1">
                                {analytics.totalItemsInStock}
                            </p>
                            <span className="text-[9px] text-slate-400 mt-0.5 block">Productos activos</span>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Equipo Asignado</span>
                            <p className="text-xl font-black text-indigo-600 dark:text-indigo-400 font-mono mt-1">
                                {analytics.staff.length}
                            </p>
                            <span className="text-[9px] text-slate-400 mt-0.5 block">Operadores</span>
                        </div>
                    </div>

                    {/* Staff Assigned to this Branch */}
                    <div className="space-y-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                            Operadores y Cajeros Asignados ({analytics.staff.length})
                        </span>
                        {analytics.staff.length === 0 ? (
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                                No hay operadores asignados exclusivamente a esta sede. Los administradores globales pueden operarla.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {analytics.staff.map(s => (
                                    <div key={s.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.avatarColor || 'from-primary-600 to-indigo-700'} text-white flex items-center justify-center font-black text-xs shrink-0`}>
                                            {(s.name || s.username || 'U').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-black text-slate-900 dark:text-white uppercase truncate">{s.name || s.username}</p>
                                            <p className="text-[10px] text-slate-400 truncate">@{s.username} • <span className="uppercase text-primary-500 font-bold">{s.role}</span></p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Recent Transactions in this Branch */}
                    <div className="space-y-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">
                            Últimas Ventas Emitidas en esta Sede
                        </span>
                        {analytics.recentSales.length === 0 ? (
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                                No se registran facturas emitidas en esta sede todavía.
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {analytics.recentSales.map(sale => (
                                    <div key={sale.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs">
                                        <div>
                                            <p className="font-black text-slate-900 dark:text-white uppercase font-mono">
                                                Ticket #{sale.invoiceNumber || sale.id.substring(0, 8)}
                                            </p>
                                            <p className="text-[10px] text-slate-400">
                                                {new Date(sale.createdAt).toLocaleString()} • {sale.paymentMethod || 'Efectivo'}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm block">
                                                ${Number(sale.totalAmount || 0).toFixed(2)}
                                            </span>
                                            <span className="text-[9px] font-black text-emerald-500 uppercase">
                                                {sale.status || 'Completada'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Quick Context Switch Button */}
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-1/3 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-black rounded-2xl uppercase tracking-wider text-xs transition-all cursor-pointer"
                        >
                            Cerrar
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                onSwitchBranch(branch.id);
                                onClose();
                            }}
                            className="w-2/3 py-3.5 bg-primary-600 hover:bg-primary-700 text-white font-black rounded-2xl uppercase tracking-wider text-xs shadow-lg shadow-primary-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                            <ExternalLink size={16} /> Entrar y Trabajar en esta Sede
                        </button>
                    </div>
                </div>
            ) : null}
        </BaseModal>
    );
}
