import { useState, useEffect, useCallback } from 'react';
import {
    X, 
    Star, 
    Award, 
    TrendingUp, 
    ShoppingBag, 
    Clock, 
    DollarSign, 
    ShieldCheck, 
    Zap, 
    History, 
    Banknote, 
    FileText
} from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import { formatMoney } from '../utils/format';

export default function Customer360Modal({
    isOpen,
    onClose,
    customerId,
    onOpenAbono,
    onOpenHistory,
    onOpenStatement,
    onOpenRedeem
}) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchProfile = useCallback(async () => {
        if (!customerId) return;
        try {
            setLoading(true);
            const res = await api.get(`/customers/${customerId}/profile360`);
            setData(res.data);
        } catch (error) {
            console.error('Error fetching Customer 360 profile:', error);
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        if (isOpen && customerId) {
            fetchProfile();
        } else {
            setData(null);
        }
    }, [isOpen, customerId, fetchProfile]);

    if (!isOpen) return null;

    const customer = data?.customer || {};
    const metrics = data?.metrics || {};
    const topProducts = data?.topProducts || [];

    const getTierBadge = (tier) => {
        switch (tier) {
            case 'DIAMOND':
                return { label: 'Diamante VIP', bg: 'from-cyan-500 to-blue-600', text: 'text-cyan-400', border: 'border-cyan-500/30' };
            case 'GOLD':
                return { label: 'Oro', bg: 'from-amber-400 to-amber-600', text: 'text-amber-400', border: 'border-amber-500/30' };
            case 'SILVER':
                return { label: 'Plata', bg: 'from-slate-300 to-slate-500', text: 'text-slate-300', border: 'border-slate-400/30' };
            default:
                return { label: 'Bronce', bg: 'from-amber-700 to-amber-900', text: 'text-amber-600', border: 'border-amber-700/30' };
        }
    };

    const tierInfo = getTierBadge(metrics.tier);

    return (
        <BaseModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-5xl">
            <div className="relative bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90dvh] overflow-y-auto custom-scrollbar pb-safe">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-lg bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 flex items-center justify-center font-bold text-lg shrink-0">
                            {(customer.name || 'C').charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight uppercase">
                                    {customer.name}
                                </h2>
                                <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border ${tierInfo.border} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300`}>
                                    ⭐ {tierInfo.label}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                                <span>Doc: <b className="text-slate-700 dark:text-slate-300">{customer.idDocument || '---'}</b></span>
                                <span>•</span>
                                <span>Tel: <b className="text-slate-700 dark:text-slate-300">{customer.phone || '---'}</b></span>
                                <span>•</span>
                                <span>Email: <b className="text-slate-700 dark:text-slate-300">{customer.email || '---'}</b></span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    >
                        <X size={18} />
                    </button>
                </div>

                {loading ? (
                    <div className="py-20 text-center">
                        <div className="inline-flex items-center gap-2.5 text-sky-600 dark:text-sky-400 font-bold text-xs uppercase tracking-wider">
                            <div className="w-2.5 h-2.5 bg-sky-600 dark:bg-sky-400 rounded-full animate-pulse"></div>
                            Calculando Perfil 360° y Métricas LTV...
                        </div>
                    </div>
                ) : (
                    <div className="space-y-5 pt-5">
                        {/* KPI Cards Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {/* LTV */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                    <span>LTV Histórico</span>
                                    <TrendingUp size={14} className="text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div className="text-xl font-bold text-slate-900 dark:text-white tracking-tight tabular-nums">
                                    {formatMoney(metrics.lifetimeValue || 0, 'USD')}
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">Total acumulado</span>
                            </div>

                            {/* Ticket Promedio */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                    <span>Ticket Promedio</span>
                                    <ShoppingBag size={14} className="text-sky-600 dark:text-sky-400" />
                                </div>
                                <div className="text-xl font-bold text-slate-900 dark:text-white tracking-tight tabular-nums">
                                    {formatMoney(metrics.averageTicket || 0, 'USD')}
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">{metrics.salesCount || 0} visitas realizadas</span>
                            </div>

                            {/* Saldo Deudor */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                    <span>Saldo Deudor</span>
                                    <DollarSign size={14} className={metrics.creditBalance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"} />
                                </div>
                                <div className={`text-xl font-bold tracking-tight tabular-nums ${metrics.creditBalance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                    {formatMoney(metrics.creditBalance || 0, 'USD')}
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">Límite: {formatMoney(metrics.creditLimit || 0, 'USD')}</span>
                            </div>

                            {/* Puntos Fidelidad */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3.5 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                                    <span>Puntos Acumulados</span>
                                    <Zap size={14} className="text-amber-500 dark:text-amber-400" />
                                </div>
                                <div className="text-xl font-bold text-amber-600 dark:text-amber-400 tracking-tight tabular-nums">
                                    {(metrics.loyaltyPoints || 0).toFixed(2)} pts
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">Equivale a ${metrics.loyaltyPoints || 0} USD</span>
                            </div>
                        </div>

                        {/* Customer Tier Progress Bar & Credit Score */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Tier Progress */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Award size={16} className={tierInfo.text} />
                                        <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">Nivel y Fidelización</h3>
                                    </div>
                                    <span className="text-xs font-bold text-sky-600 dark:text-sky-400">{metrics.tierProgress}%</span>
                                </div>
                                <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                                    <div 
                                        className="h-full rounded-full bg-sky-600 dark:bg-sky-500 transition-all duration-500" 
                                        style={{ width: `${metrics.tierProgress}%` }}
                                    ></div>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                    {metrics.tier === 'DIAMOND' 
                                        ? '¡Máximo nivel alcanzado! Cliente VIP preferencial con beneficios máximos.'
                                        : `Gasta ${formatMoney(metrics.nextTierThreshold - (metrics.lifetimeValue || 0), 'USD')} más para subir de nivel.`
                                    }
                                </p>
                            </div>

                            {/* Credit Score & Visit Frequency */}
                            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-4 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
                                            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">Score Crediticio</h3>
                                        </div>
                                        <div className="flex items-center gap-1 text-amber-500">
                                            {[...Array(5)].map((_, i) => (
                                                <Star 
                                                    key={i} 
                                                    size={13} 
                                                    fill={i < (metrics.creditScore || 5) ? "currentColor" : "none"} 
                                                    className={i < (metrics.creditScore || 5) ? "text-amber-500" : "text-slate-300 dark:text-slate-600"}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                        {metrics.creditScore >= 4 
                                            ? 'Excelente historial: Cumple puntualmente con la cancelación de fiados.' 
                                            : 'Historial moderado: Mantener seguimiento de límites de crédito.'
                                        }
                                    </p>
                                </div>

                                <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1.5 font-medium">
                                        <Clock size={13} className="text-sky-600 dark:text-sky-400" /> Última visita:
                                    </span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                        {metrics.lastVisit 
                                            ? `${new Date(metrics.lastVisit).toLocaleDateString()} (${metrics.daysSinceLastVisit} días atrás)`
                                            : 'Sin compras recientes'
                                        }
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Top Favorite Products */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2 mb-3">
                                <Award size={16} className="text-amber-500" />
                                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">Top Productos Favoritos</h3>
                            </div>
                            {topProducts.length === 0 ? (
                                <p className="text-xs text-slate-400 font-medium py-3 text-center">Aún no hay historial de productos para este cliente</p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                                    {topProducts.map((p, idx) => (
                                        <div key={idx} className="bg-white dark:bg-slate-800 rounded-lg p-2.5 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800 flex items-center justify-center font-bold text-xs shrink-0">
                                                #{idx + 1}
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate uppercase">{p.name}</h4>
                                                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                                                    <span>{p.quantity} unids</span>
                                                    <span>•</span>
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{formatMoney(p.totalSpent, 'USD')}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Action Buttons Hub */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
                            {/* Canjear Puntos */}
                            <button
                                onClick={() => { onClose(); onOpenRedeem(customer); }}
                                disabled={(metrics.loyaltyPoints || 0) <= 0}
                                className="min-h-[40px] py-2.5 px-3.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <Zap size={14} /> Canjear Puntos
                            </button>

                            {/* Estado de Cuenta PDF */}
                            <button
                                onClick={() => { onClose(); onOpenStatement(customer); }}
                                className="min-h-[40px] py-2.5 px-3.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <FileText size={14} /> Estado de Cuenta
                            </button>

                            {/* Historial */}
                            <button
                                onClick={() => { onClose(); onOpenHistory(customer); }}
                                className="min-h-[40px] py-2.5 px-3.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <History size={14} /> Ver Historial
                            </button>

                            {/* Abonar */}
                            <button
                                onClick={() => { onClose(); onOpenAbono(customer); }}
                                disabled={(metrics.creditBalance || 0) <= 0}
                                className="min-h-[40px] py-2.5 px-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <Banknote size={14} /> Registrar Abono
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </BaseModal>
    );
}
