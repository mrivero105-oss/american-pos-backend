import { useState, useEffect, useCallback } from 'react';
import {
    Search, 
    TrendingUp, 
    AlertTriangle, 
    CheckCircle2, 
    ShoppingCart, 
    Clock, 
    Package
} from 'lucide-react';
import api from '../services/api';
import { formatStock } from '../utils/format';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/AuthContext';

export default function SmartInventory() {
    const { user } = useAuth();
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('ALL'); // ALL, CRITICAL, WARNING

    const fetchSuggestions = useCallback(async () => {
        if (!user) return;
        try {
            setLoading(true);
            const { data } = await api.get(`/stock-intelligence/suggestions?companyId=${user.companyId}`);

            // Fortify: Ensure we only set an array
            if (Array.isArray(data)) {
                setSuggestions(data);
            } else {
                console.error('API did not return an array:', data);
                setSuggestions([]);
            }
        } catch (error) {
            console.error('Error fetching suggestions:', error);
            toast.error('Error al cargar analítica de inventario');
            setSuggestions([]);
        } finally {
            setLoading(true); // Small delay for effect
            setTimeout(() => setLoading(false), 500);
        }
    }, [user]);

    useEffect(() => {
        if (user) {
            fetchSuggestions();
        }
    }, [user, fetchSuggestions]);

    const filteredData = Array.isArray(suggestions)
        ? suggestions.filter(item => {
            const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase());
            if (filter === 'ALL') return matchesSearch;
            return matchesSearch && item.status === filter;
        })
        : [];


    return (
        <div className="space-y-6 animate-in fade-in duration-500 p-1 sm:p-0 pb-28 sm:pb-20 pb-safe">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                            <TrendingUp size={24} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Analítica de Reabastecimiento
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Sugerencias de compra calculadas por rotación y velocidad de venta (30 días).</p>
                </div>

                <div className="flex bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-x-auto no-scrollbar w-full sm:w-auto">
                    <button
                        onClick={() => setFilter('ALL')}
                        className={`px-4 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] flex-1 sm:flex-none text-xs font-bold rounded-lg transition-all ${filter === 'ALL' ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800'}`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => setFilter('CRITICAL')}
                        className={`px-4 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] flex-1 sm:flex-none text-xs font-bold rounded-lg transition-all ${filter === 'CRITICAL' ? 'bg-red-500 text-white shadow-md shadow-red-500/20' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800'}`}
                    >
                        Crítico
                    </button>
                    <button
                        onClick={() => setFilter('WARNING')}
                        className={`px-4 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] flex-1 sm:flex-none text-xs font-bold rounded-lg transition-all ${filter === 'WARNING' ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800'}`}
                    >
                        Atención
                    </button>
                </div>
            </div>

            {/* Smart Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center gap-3.5">
                        <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-lg text-rose-600 dark:text-rose-400">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Existencia Crítica</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                                {Array.isArray(suggestions) && suggestions.filter(s => s.status === 'CRITICAL' || s.currentStock <= 0).length} Productos
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center gap-3.5">
                        <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg text-indigo-600 dark:text-indigo-400">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Alta Velocidad</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                                {Array.isArray(suggestions) && suggestions.filter(s => parseFloat(s.dailyVelocity) > 0.1).length} Moviéndose
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center gap-3.5">
                        <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Sugerencias Nuevas</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                                {Array.isArray(suggestions) && suggestions.filter(s => s.suggestedPurchase > 0 || s.currentStock <= 0).length} Pendientes
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Search and Table / Mobile Cards */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-slate-50 dark:border-slate-800">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Filtrar por nombre de producto..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-10 py-3 text-base sm:text-sm min-h-[44px] border border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>

                {/* Mobile Cards View (block md:hidden) */}
                <div className="block md:hidden p-3 space-y-3">
                    {loading ? (
                        Array(3).fill(0).map((_, i) => (
                            <div key={i} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl animate-pulse space-y-3">
                                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3"></div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
                                    <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
                                </div>
                            </div>
                        ))
                    ) : filteredData.length === 0 ? (
                        <div className="py-12 text-center">
                            <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
                                <Package size={40} className="opacity-20" />
                                <p className="font-bold text-sm">Sin alertas pendientes</p>
                                <p className="text-xs">Tu inventario parece estar balanceado según las ventas.</p>
                            </div>
                        </div>
                    ) : (
                        Array.isArray(filteredData) && filteredData.map((item) => {
                            const isOutOfStock = Number(item.currentStock) <= 0;
                            const statusLabel = isOutOfStock ? 'AGOTADO' : item.status === 'CRITICAL' ? 'CRÍTICO' : item.status === 'WARNING' ? 'ALERTA' : 'ÓPTIMO';
                            const badgeStyle = isOutOfStock || item.status === 'CRITICAL'
                                ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20'
                                : item.status === 'WARNING'
                                    ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
                                    : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';

                            return (
                                <div key={item.id} className="p-4 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{item.name}</p>
                                            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black border mt-1 ${badgeStyle}`}>
                                                {statusLabel}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Stock Actual</span>
                                            <span className={`text-sm font-black ${isOutOfStock ? 'text-red-500' : item.currentStock <= item.minStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-300'}`}>
                                                {formatStock(item.currentStock)}
                                            </span>
                                        </div>
                                        <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Ventas (30d)</span>
                                            <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatStock(item.totalSold30d)}</span>
                                        </div>
                                        <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Velocidad</span>
                                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-bold mt-0.5">
                                                <TrendingUp size={12} className="text-indigo-500" />
                                                <span>{item.dailyVelocity}/d</span>
                                            </div>
                                        </div>
                                        <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                                            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Días Stock</span>
                                            <div className="flex items-center gap-1 font-black mt-0.5">
                                                <Clock size={12} className="opacity-40" />
                                                <span className={isOutOfStock || Number(item.daysRemaining) === 0 ? 'text-red-500' : Number(item.daysRemaining) < 3 ? 'text-red-500' : Number(item.daysRemaining) < 7 ? 'text-amber-500' : 'text-emerald-500'}>
                                                    {isOutOfStock ? '0d (Agotado)' : item.daysRemaining === '∞' ? 'Sin rot.' : `${item.daysRemaining}d`}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Sugerencia de compra en móvil */}
                                    {item.suggestedPurchase > 0 ? (
                                        <div className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30 rounded-xl min-h-[44px]">
                                            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">Sugerencia de Compra:</span>
                                            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-black">
                                                <span className="text-base">+{item.suggestedPurchase}</span>
                                                <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg">
                                                    <ShoppingCart size={16} />
                                                </div>
                                            </div>
                                        </div>
                                    ) : isOutOfStock ? (
                                        <div className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-500/10 p-2.5 rounded-xl border border-red-200 dark:border-red-500/20 text-center min-h-[40px] flex items-center justify-center">
                                            Reponer Stock Urgente
                                        </div>
                                    ) : (
                                        <div className="text-xs font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 p-2.5 rounded-xl text-center min-h-[40px] flex items-center justify-center">
                                            Abastecido
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Desktop Table View (hidden md:block) */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider">Producto</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Stock Actual</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Ventas (30d)</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Velocidad</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-center">Días Stock</th>
                                <th className="px-6 py-4 text-xs font-black uppercase tracking-wider text-right">Sugerencia Compra</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                Array(5).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan="6" className="px-6 py-4">
                                            <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-full"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : filteredData.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4 text-slate-500 dark:text-slate-400">
                                            <Package size={48} className="opacity-20" />
                                            <p className="text-lg font-bold">Sin alertas pendientes</p>
                                            <p className="text-sm">Tu inventario parece estar balanceado según las ventas.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                Array.isArray(filteredData) && filteredData.map((item) => {
                                    const isOutOfStock = Number(item.currentStock) <= 0;
                                    const statusLabel = isOutOfStock ? 'AGOTADO' : item.status === 'CRITICAL' ? 'CRÍTICO' : item.status === 'WARNING' ? 'ALERTA' : 'ÓPTIMO';
                                    const badgeStyle = isOutOfStock || item.status === 'CRITICAL'
                                        ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20'
                                        : item.status === 'WARNING'
                                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
                                            : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';

                                    return (
                                        <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800 dark:bg-slate-800/30 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div>
                                                    <p className="font-bold text-slate-800 dark:text-slate-100">{item.name}</p>
                                                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border mt-1 ${badgeStyle}`}>
                                                        {statusLabel}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`text-sm font-bold ${isOutOfStock ? 'text-red-500 font-black' : item.currentStock <= item.minStock ? 'text-amber-500' : 'text-slate-600 dark:text-slate-400'}`}>
                                                    {formatStock(item.currentStock)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatStock(item.totalSold30d)}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex items-center justify-center gap-1.5 text-slate-500 dark:text-slate-400">
                                                    <TrendingUp size={14} className="text-indigo-500" />
                                                    <span className="text-xs font-bold">{item.dailyVelocity} / día</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className={`text-sm font-black ${isOutOfStock || Number(item.daysRemaining) === 0 ? 'text-red-500' : Number(item.daysRemaining) < 3 ? 'text-red-500' : Number(item.daysRemaining) < 7 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                                        {isOutOfStock ? '0 días (Agotado)' : item.daysRemaining === '∞' ? 'Sin rotación' : `${item.daysRemaining} días`}
                                                    </span>
                                                    <Clock size={12} className="opacity-30" />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {item.suggestedPurchase > 0 ? (
                                                    <div className="flex items-center justify-end gap-2 text-indigo-600 dark:text-indigo-400 font-black">
                                                        <span className="text-lg">+{item.suggestedPurchase}</span>
                                                        <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl">
                                                            <ShoppingCart size={18} />
                                                        </div>
                                                    </div>
                                                ) : isOutOfStock ? (
                                                    <span className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-500/20">Reponer Stock</span>
                                                ) : (
                                                    <span className="text-xs font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 rounded-xl">Abastecido</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Restock Criteria Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-white shadow-xs">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                    <div className="bg-white/10 p-3 rounded-lg text-sky-400 shrink-0">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white mb-1">Criterio de Reabastecimiento</h3>
                        <p className="text-slate-300 text-xs leading-relaxed max-w-2xl">
                            Las sugerencias de compra se calculan de acuerdo con la rotación y ritmo de venta de los últimos <strong>30 días</strong>, garantizando cobertura operativa y previniendo quiebres de inventario.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
