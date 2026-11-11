import React, { useState, useEffect, useCallback } from 'react';
import { 
    Sparkles, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, 
    TrendingUp, PackageCheck, Lightbulb, Compass, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';

export default function AIPredictiveAnalytics({ range = 'today' }) {
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchAnalytics = useCallback(async (forceRefresh = false) => {
        try {
            setLoading(true);
            setError(null);
            const res = await api.get(`/reports/ai/predictive-analytics?range=${range}${forceRefresh ? '&forceRefresh=true' : ''}`);
            setAnalytics(res.data);
        } catch (err) {
            console.error('[AIPredictiveAnalytics] Error fetching data:', err);
            setError('No se pudo cargar el análisis predictivo. Revisa la conexión.');
        } finally {
            setLoading(false);
        }
    }, [range]);

    useEffect(() => {
        fetchAnalytics(false);
    }, [fetchAnalytics]);

    const getScoreColor = (score = 0) => {
        if (score >= 80) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
        if (score >= 60) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
        return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-cyan-500/30 bg-slate-900/90 shadow-2xl backdrop-blur-xl p-5 sm:p-6 mb-6 overflow-hidden relative"
        >
            {/* Background Glow */}
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header with Read-Only Badge */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-lg shadow-cyan-500/20">
                        <Sparkles className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-white tracking-wide">
                                Inteligencia Predictiva de Negocio
                            </h3>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Estricto Solo Lectura
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Proyecciones de demanda, detección de anomalías y sugerencias de rentabilidad con Gemini AI
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    {analytics?.isCached && (
                        <span className="text-[11px] text-cyan-400 bg-cyan-950/60 border border-cyan-800/50 px-2 py-1 rounded-lg">
                            ⚡ En caché (0 consumo de cuota)
                        </span>
                    )}
                    <button
                        onClick={() => fetchAnalytics(true)}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition border border-slate-700 hover:border-cyan-500/50 disabled:opacity-50"
                        title="Recalcular análisis con IA consumiendo 1 consulta"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
                        <span>{loading ? 'Analizando...' : 'Recalcular'}</span>
                    </button>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                </div>
            )}

            {/* Content Body */}
            {loading && !analytics ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-cyan-500/20 border-t-cyan-500 animate-spin" />
                    <p className="text-xs text-slate-400">Procesando métricas financieras e inventario...</p>
                </div>
            ) : analytics ? (
                <div className="mt-5 space-y-5">
                    {/* Top Row: Score + Executive Summary */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Score Card */}
                        <div className={`p-4 rounded-xl border flex flex-col items-center justify-center text-center ${getScoreColor(analytics.healthScore)}`}>
                            <span className="text-xs uppercase font-bold tracking-wider opacity-80">
                                Salud del Negocio
                            </span>
                            <div className="text-4xl font-extrabold tracking-tight mt-1">
                                {analytics.healthScore || 80}
                                <span className="text-base font-normal opacity-60">/100</span>
                            </div>
                            <span className="text-xs font-semibold mt-1 px-2.5 py-0.5 rounded-full bg-black/20">
                                {analytics.healthStatus || 'Saludable'}
                            </span>
                        </div>

                        {/* Executive Summary */}
                        <div className="md:col-span-3 p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 flex flex-col justify-center">
                            <span className="text-xs font-semibold uppercase text-cyan-400 tracking-wider flex items-center gap-1.5 mb-1.5">
                                <Zap className="w-3.5 h-3.5" />
                                Diagnóstico Ejecutivo
                            </span>
                            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-normal">
                                {analytics.executiveSummary}
                            </p>
                        </div>
                    </div>

                    {/* Middle Row: Demand Predictions & Profit Opportunities */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Demand Predictions */}
                        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 mb-3">
                                <PackageCheck className="w-4 h-4 text-emerald-400" />
                                Proyección de Demanda y Reposición
                            </h4>
                            <div className="space-y-2.5">
                                {analytics.demandPredictions && analytics.demandPredictions.length > 0 ? (
                                    analytics.demandPredictions.slice(0, 4).map((p, idx) => (
                                        <div key={idx} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-start justify-between gap-3 text-xs">
                                            <div className="space-y-0.5">
                                                <div className="font-semibold text-slate-200">{p.product}</div>
                                                <div className="text-[11px] text-slate-400">{p.action}</div>
                                            </div>
                                            <span className="shrink-0 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px] font-medium">
                                                {p.estimatedDaysLeft !== undefined ? `${p.estimatedDaysLeft}d rest.` : p.runRate}
                                            </span>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-slate-500 italic">Sin alertas urgentes de agotamiento de stock.</p>
                                )}
                            </div>
                        </div>

                        {/* Profit Opportunities */}
                        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 mb-3">
                                <Lightbulb className="w-4 h-4 text-cyan-400" />
                                Oportunidades de Rentabilidad
                            </h4>
                            <div className="space-y-2.5">
                                {analytics.profitOpportunities && analytics.profitOpportunities.length > 0 ? (
                                    analytics.profitOpportunities.slice(0, 4).map((op, idx) => (
                                        <div key={idx} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs space-y-1">
                                            <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                                                <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                                                {op.title}
                                            </div>
                                            <p className="text-slate-300 text-[11px] leading-relaxed">
                                                {op.description}
                                            </p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-slate-500 italic">Márgenes y combos estables en este período.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Bottom Row: Anomalies & Strategic Advice */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Anomalies & Key Points */}
                        <div className="md:col-span-2 p-3.5 rounded-xl bg-slate-800/30 border border-slate-800/80">
                            <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5 mb-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                Alertas & Puntos Clave
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {(analytics.anomalyAlerts || []).map((al, idx) => (
                                    <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/40 text-slate-300 text-[11px]">
                                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${al.type === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                                        <span>{al.message}</span>
                                    </div>
                                ))}
                                {(analytics.keyStrengths || []).slice(0, 2).map((st, idx) => (
                                    <div key={`st-${idx}`} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/40 text-emerald-300 text-[11px]">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                        <span>{st}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Strategic Advice Card */}
                        <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-800/30 flex flex-col justify-between">
                            <div>
                                <span className="text-[11px] font-bold uppercase text-indigo-300 tracking-wider flex items-center gap-1.5 mb-1.5">
                                    <Compass className="w-3.5 h-3.5 text-indigo-400" />
                                    Consejo Estratégico
                                </span>
                                <p className="text-xs text-slate-200 leading-relaxed italic">
                                    "{analytics.strategicAdvice || 'Mantener la disciplina de reposición en base a la rotación diaria.'}"
                                </p>
                            </div>
                            <div className="mt-3 text-[10px] text-slate-500 text-right">
                                Generado: {new Date(analytics.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </motion.div>
    );
}
