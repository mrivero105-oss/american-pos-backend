import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../hooks/SocketContext';
import { useAuth } from '../hooks/AuthContext';
import api from '../services/api';
import {
    TrendingUp, 
    Award, 
    ArrowUpCircle, 
    Download, 
    Calendar, 
    Activity, 
    AlertCircle, 
    Search, 
    X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatMoney, fetchGlobalSettings, formatStock, isSingleCurrencyMode } from '../utils/format';
import MiniCalendar from '../components/MiniCalendar';
import ExecutiveStats from '../components/dashboard/ExecutiveStats';
import PerformanceHeatmap from '../components/dashboard/PerformanceHeatmap';
import DashboardCharts from '../components/DashboardCharts';
import AIPredictiveAnalytics from '../components/dashboard/AIPredictiveAnalytics';

export default function Reports() {
    const { socket } = useSocket();
    const { user } = useAuth();
    const [settings, setSettings] = useState({ currencyMode: 'BOTH', rate: 1 });
     const [range, setRange] = useState('today');
    const [isCustomRange, setIsCustomRange] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lowStock, setLowStock] = useState([]);
    const [rankingMode, setRankingMode] = useState('quantity'); // 'quantity' or 'profit'
    const [rankingSearch, setRankingSearch] = useState('');
    const [selectedProductDetails, setSelectedProductDetails] = useState(null);

    const fetchSettings = useCallback(async () => {
        const s = await fetchGlobalSettings();
        setSettings(s);
    }, []);

    const fetchReport = useCallback(async (silent = false) => {
        if (!['admin', 'superadmin'].includes(user?.role?.toLowerCase())) {
            return;
        }
        try {
            if (!silent) setLoading(true);
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            
            let reportUrl = `/reports/bi/profitability`;
            if (isCustomRange) {
                reportUrl += `?startDate=${startDate}&endDate=${endDate}&start=${startOfDay.toISOString()}`;
            } else {
                reportUrl += `?range=${range}&start=${startOfDay.toISOString()}`;
            }
            
            // Fetch everything in parallel
            const [reportRes, lowStockRes] = await Promise.all([
                api.get(reportUrl),
                api.get('/reports/inventory/low-stock?limit=5').catch(() => ({ data: { items: [] } }))
            ]);

            setData(reportRes.data);
            setLowStock(lowStockRes.data?.items || []);
        } catch (error) {
            console.error('Error fetching BI reports:', error);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [user?.role, isCustomRange, startDate, endDate, range]);

    useEffect(() => {
        if (['admin', 'superadmin'].includes(user?.role?.toLowerCase())) {
            fetchSettings();
            fetchReport();
        }
    }, [user?.role, fetchSettings, fetchReport]);

    useEffect(() => {
        if (!socket) return;

        const handleUpdate = () => {
            console.log('⚡ BI Update received via Socket');
            fetchReport(true);
        };

        socket.on('sale_completed', handleUpdate);
        socket.on('inventory_changed', handleUpdate);

        return () => {
            socket.off('sale_completed', handleUpdate);
            socket.off('inventory_changed', handleUpdate);
        };
    }, [socket, fetchReport]);

    const isToday = range === 'today' || (data?.trends && data.trends.length <= 1 && (!isCustomRange || startDate === endDate));

    const chartData = useMemo(() => {
        // 1. Si es "Hoy" o rango de un solo día, desplegar la curva horaria completa
        if (isToday) {
            if (data?.hourlySales && Array.isArray(data.hourlySales)) {
                const hours = data.hourlySales.filter(h => h.hour >= 6 && h.hour <= 22);
                const marginRatio = (data.summary?.totalSales > 0 && data.summary?.grossProfit)
                    ? (data.summary.grossProfit / data.summary.totalSales)
                    : 0.3;
                return hours.map(h => {
                    const salesVal = Number(h.totalSales || h.total || 0);
                    return {
                        name: `${String(h.hour).padStart(2, '0')}:00`,
                        total: salesVal,
                        profit: Math.round(salesVal * marginRatio * 100) / 100
                    };
                });
            }
        }

        // 2. Si es rango de varios días (7d, 30d, etc.), formatear fecha legible
        if (data?.trends && Array.isArray(data.trends)) {
            return data.trends.map(t => {
                const dParts = t.date ? t.date.split('-') : null;
                let label = t.date;
                if (dParts && dParts.length === 3) {
                    const d = new Date(Number(dParts[0]), Number(dParts[1]) - 1, Number(dParts[2]));
                    label = d.toLocaleDateString('es-ES', { 
                        weekday: range === '90d' ? undefined : 'short', 
                        day: 'numeric' 
                    });
                }
                return {
                    name: label,
                    total: Number(t.sales) || 0,
                    profit: Number(t.profit) || 0
                };
            });
        }

        return [];
    }, [isToday, data, range]);

    if (user?.role === 'user') {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-6 px-6 text-center">
                <div className="p-5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl shadow-xs relative">
                   <AlertCircle size={40} className="text-red-600 dark:text-red-400" />
                </div>
                <div className="max-w-md">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Acceso Restringido</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                        Esta sección contiene indicadores financieros críticos y solo está disponible para personal administrativo.
                    </p>
                </div>
            </div>
        );
    }

    const handleExport = async () => {
        try {
            let path = '/reports/bi/export?';
            if (isCustomRange) {
                path += `startDate=${startDate}&endDate=${endDate}`;
            } else {
                path += `range=${range}`;
            }
            
            const response = await api.get(path, { responseType: 'blob' });
            
            // Get filename from response header or default
            let filename = `reporte_detallado_${isCustomRange ? `${startDate}_a_${endDate}` : range}.csv`;
            const disposition = response.headers['content-disposition'];
            if (disposition && disposition.indexOf('filename=') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                    filename = matches[1].replace(/['"]/g, '');
                }
            }
            
            const blob = new Blob([response.data], { type: response.headers['content-type'] || 'text/csv' });
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error('Error al exportar datos BI:', error);
        }
    };

    const _renderFormatMoney = (val) => formatMoney(val, null, settings);


    if (loading && !data) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Activity size={24} className="text-primary-500 animate-pulse" />
                    </div>
                </div>
                <div className="text-center">
                    <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest animate-pulse">Sincronizando Reportes de Negocio</p>
                    <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 dark:text-slate-600 uppercase tracking-tighter mt-1">Procesando Nodos Analíticos...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-24 sm:pb-16 pb-safe animate-in fade-in duration-300">
            {/* Header Section */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/40 flex items-center justify-center shrink-0">
                            <TrendingUp size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                    Inteligencia Empresarial
                                </h1>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 text-[11px] font-medium">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    En Vivo
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Indicadores financieros clave, rentabilidad por rubro y análisis de ventas
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2.5 items-center w-full lg:w-auto">
                    <button 
                        onClick={handleExport}
                        className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <Download size={14} /> <span>Exportar Datos</span>
                    </button>

                    <div className="relative">
                        <div className="flex flex-wrap items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 gap-1">
                            {[
                                { id: 'today', label: 'Hoy' },
                                { id: '7d', label: '7 Días' },
                                { id: '30d', label: '30 Días' },
                                { id: '90d', label: '90 Días' }
                            ].map((r) => (
                                <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => {
                                        setIsCustomRange(false);
                                        setRange(r.id);
                                        setIsCalendarOpen(false);
                                    }}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                        !isCustomRange && range === r.id
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' 
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}

                            <button
                                type="button"
                                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                                    isCustomRange
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' 
                                    : isCalendarOpen
                                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Calendar size={13} className={isCustomRange ? 'text-primary-600' : 'text-slate-400'} />
                                <span>{isCustomRange ? (startDate === endDate ? startDate : `${startDate} al ${endDate}`) : 'Filtrar'}</span>
                            </button>
                        </div>

                        {/* Dropdown Calendar positioned outside the overflow container */}
                        {isCalendarOpen && (
                            <>
                                <div 
                                    className="fixed inset-0 z-[150]" 
                                    onClick={() => setIsCalendarOpen(false)} 
                                />
                                <MiniCalendar 
                                    startDate={startDate}
                                    endDate={endDate}
                                    onSelectRange={(start, end) => {
                                        if (start) {
                                            setStartDate(start);
                                            setEndDate(end || start);
                                            setIsCustomRange(true);
                                            if (end) setIsCalendarOpen(false);
                                        }
                                    }}
                                    onClose={() => setIsCalendarOpen(false)}
                                />
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* AI Predictive Intelligence (Modo Estricto Solo Lectura) */}
            <div className="px-3 sm:px-6">
                <AIPredictiveAnalytics range={range} />
            </div>

            {/* Smart Metrics Grid */}
            <div className="px-3 sm:px-6">
                <ExecutiveStats 
                    settings={settings}
                    summary={{
                        totalRevenue: data?.summary?.totalSales,
                        netProfit: data?.summary?.netProfit,
                        ticketPromedio: data?.summary?.avgTicket,
                        avgMargin: data?.summary?.margin
                    }}
                />
            </div>

            {/* Visual Analytics Hub */}
            <div className="px-3 sm:px-6">
                <DashboardCharts 
                    settings={settings}
                    data={chartData}
                    categorySales={data?.byCategory}
                    isHourly={isToday}
                />
            </div>

            {/* Activity & Performance Hub */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 px-3 sm:px-6">
                <div className="lg:col-span-2">
                    <PerformanceHeatmap settings={settings} hourlySales={data?.hourlySales} />
                </div>

                {/* Status Column */}
                <div className="space-y-6 sm:space-y-8">
                    {/* Inventory Criticality */}
                    <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs relative flex flex-col h-full">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Stock Crítico</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Alertas de inventario bajo</p>
                            </div>
                            {lowStock.length > 0 && (
                                <div className="bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs font-semibold px-2.5 py-1 rounded-md border border-red-200 dark:border-red-800/50 flex items-center gap-1.5">
                                    <Activity size={13} /> {lowStock.length}
                                </div>
                            )}
                        </div>
                        <div className="space-y-2 flex-1">
                            {lowStock.length > 0 ? lowStock.slice(0, 4).map((item, i) => (
                                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shadow-2xs">
                                    <div className="h-9 w-9 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center border border-amber-200 dark:border-amber-800/40 shrink-0">
                                        <AlertCircle size={18} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{item.name}</p>
                                        <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 mt-0.5">{formatStock(item.stockQuantity)} {item.stockUnit} Restantes</p>
                                    </div>
                                </div>
                            )) : (
                                <div className="flex flex-col items-center justify-center h-36 border border-dashed border-emerald-300 dark:border-emerald-800/50 rounded-xl text-center bg-emerald-50/30 dark:bg-emerald-950/10">
                                    <Award size={28} className="text-emerald-600 dark:text-emerald-400 mb-2" />
                                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Nivel de Stock Óptimo</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="px-3 sm:px-6">
                {/* Top Performance Ranking */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-5 gap-4">
                        <div>
                            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">Rendimiento de Catálogo</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Top productos por {rankingMode === 'quantity' ? 'volumen de ventas' : 'utilidad bruta'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                            {/* Search Bar */}
                            <div className="relative flex-1 md:flex-initial">
                                <input
                                    type="text"
                                    value={rankingSearch}
                                    onChange={(e) => setRankingSearch(e.target.value)}
                                    placeholder="Buscar producto..."
                                    className="w-full md:w-60 min-h-[36px] pl-9 pr-8 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors placeholder-slate-400"
                                />
                                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                                {rankingSearch && (
                                    <button 
                                        onClick={() => setRankingSearch('')}
                                        className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-medium"
                                    >
                                        Limpiar
                                    </button>
                                )}
                            </div>

                            {/* Mode Selector */}
                            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg w-full sm:w-auto">
                                <button 
                                    onClick={() => setRankingMode('quantity')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                                        rankingMode === 'quantity' 
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' 
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    Ventas
                                </button>
                                <button 
                                    onClick={() => setRankingMode('profit')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                                        rankingMode === 'profit' 
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold' 
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    Utilidad
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {((rankingMode === 'quantity' ? data?.topProducts : data?.topProductsByProfit) || [])
                            .filter(prod => prod.name?.toLowerCase().includes(rankingSearch.toLowerCase()))
                            .slice(0, rankingSearch ? 20 : 5)
                            .map((prod, i) => (
                                <div 
                                    key={i} 
                                    onClick={() => setSelectedProductDetails(prod)}
                                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors group/prod cursor-pointer shadow-2xs w-full"
                                    title="Haga clic para ver el desglose detallado de rentabilidad"
                                >
                                    <div className="flex items-center gap-3 w-full sm:w-auto">
                                        <div className={`h-8 w-8 rounded-lg font-bold flex items-center justify-center text-xs shrink-0 border ${
                                            rankingMode === 'quantity' 
                                                ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-800/40' 
                                                : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                                        }`}>
                                            {i + 1}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-slate-900 dark:text-white text-xs truncate max-w-[220px] sm:max-w-[320px]">{prod.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{prod.quantity} {prod.unit || 'und'}</p>
                                                {prod.margin > 0 && (
                                                    <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                                                        {prod.margin}% Margen
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-left sm:text-right flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200 dark:border-slate-800">
                                        <div>
                                            <p className="font-bold text-slate-900 dark:text-white text-sm sm:text-base tabular-nums leading-none">
                                                {formatMoney(rankingMode === 'quantity' ? prod.total : prod.totalProfit, null, settings)}
                                            </p>
                                            {settings?.currencyMode === 'BOTH' && (
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                    Ref: {formatMoney(rankingMode === 'quantity' ? prod.total : prod.totalProfit, 'USD', settings)}
                                                </p>
                                            )}
                                        </div>
                                        <div className={`flex items-center justify-end gap-1 text-[10px] font-semibold ${
                                            rankingMode === 'quantity' ? 'text-primary-600 dark:text-primary-400' : 'text-emerald-600 dark:text-emerald-400'
                                        }`}>
                                            <ArrowUpCircle size={11} /> {rankingMode === 'quantity' ? 'Volumen' : 'Beneficio'}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            
                        {/* Sin Resultados */}
                        {((rankingMode === 'quantity' ? data?.topProducts : data?.topProductsByProfit) || [])
                            .filter(prod => prod.name?.toLowerCase().includes(rankingSearch.toLowerCase())).length === 0 && (
                            <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                <AlertCircle className="text-slate-400 mb-2" size={20} />
                                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    No se encontraron productos coincidentes en el periodo
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Rentabilidad Detallada */}
            <AnimatePresence>
                {selectedProductDetails && (
                    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4">
                        {/* Overlay */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedProductDetails(null)}
                            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
                        />
                        
                        {/* Modal Content */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.98, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98, y: 10 }}
                            transition={{ duration: 0.2 }}
                            className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-xl overflow-y-auto max-h-[92dvh] sm:max-h-[90vh] z-10 pb-safe"
                        >
                            {/* Close Button */}
                            <button
                                onClick={() => setSelectedProductDetails(null)}
                                className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>

                            {/* Header */}
                            <div className="mb-5 pr-8">
                                <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wider">
                                    Análisis de Rentabilidad
                                </span>
                                <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1 leading-tight">
                                    {selectedProductDetails.name}
                                </h3>
                            </div>

                            {/* Financial Stats Grid */}
                            <div className="grid grid-cols-2 gap-3 mb-5">
                                {/* Unidades Vendidas */}
                                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Volumen Vendido</span>
                                    <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                                        {selectedProductDetails.quantity} <span className="text-xs font-normal text-slate-500">und</span>
                                    </p>
                                </div>
                                
                                {/* Margen de Ganancia */}
                                <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                                    <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Margen de Retorno</span>
                                    <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                                        {selectedProductDetails.margin}%
                                    </p>
                                </div>
                            </div>

                            {/* Cashflow Breakdown */}
                            <div className="space-y-3 mb-5">
                                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Desglose de Caja</h4>
                                
                                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
                                    {/* Ingresos Brutos */}
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">Ingresos Totales (Venta)</span>
                                            {!isSingleCurrencyMode(settings) && (
                                                <p className="text-[11px] text-slate-400 mt-0.5">Ref: {formatMoney(selectedProductDetails.total, 'USD', settings)}</p>
                                            )}
                                        </div>
                                        <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tabular-nums">
                                            {formatMoney(selectedProductDetails.total, isSingleCurrencyMode(settings) ? 'USD' : 'VES', settings)}
                                        </span>
                                    </div>

                                    <div className="h-px bg-slate-200 dark:bg-slate-800" />

                                    {/* Costo de Ventas */}
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">Costo de Inversión</span>
                                            {!isSingleCurrencyMode(settings) && (
                                                <p className="text-[11px] text-slate-400 mt-0.5">Ref: {formatMoney(selectedProductDetails.total - selectedProductDetails.totalProfit, 'USD', settings)}</p>
                                            )}
                                        </div>
                                        <span className="text-sm sm:text-base font-bold text-red-600 dark:text-red-400 tabular-nums">
                                            {formatMoney(selectedProductDetails.total - selectedProductDetails.totalProfit, isSingleCurrencyMode(settings) ? 'USD' : 'VES', settings)}
                                        </span>
                                    </div>

                                    <div className="h-px bg-slate-200 dark:bg-slate-800" />

                                    {/* Utilidad Neta */}
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Ganancia Neta Obtenida</span>
                                            {!isSingleCurrencyMode(settings) && (
                                                <p className="text-[11px] text-emerald-600/70 mt-0.5">Ref: {formatMoney(selectedProductDetails.totalProfit, 'USD', settings)}</p>
                                            )}
                                        </div>
                                        <span className="text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                            {formatMoney(selectedProductDetails.totalProfit, isSingleCurrencyMode(settings) ? 'USD' : 'VES', settings)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Average price breakdown */}
                            <div className="space-y-3 mb-5">
                                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Precio y Costo Promedio</h4>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                                        <span className="text-xs text-slate-500 dark:text-slate-400">P.V.P Promedio</span>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                                            {formatMoney(Number(selectedProductDetails.quantity) > 0 ? (selectedProductDetails.total / selectedProductDetails.quantity) : 0, null, settings)}
                                        </p>
                                    </div>
                                    
                                    <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                                        <span className="text-xs text-slate-500 dark:text-slate-400">Costo Promedio</span>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
                                            {formatMoney(Number(selectedProductDetails.quantity) > 0 ? ((selectedProductDetails.total - selectedProductDetails.totalProfit) / selectedProductDetails.quantity) : 0, null, settings)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Profit Margin Visual Indicator */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-xs font-medium text-slate-600 dark:text-slate-400">
                                    <span>Eficiencia Operativa</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{selectedProductDetails.margin}% de Retorno</span>
                                </div>
                                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min(100, Math.max(0, selectedProductDetails.margin))}%` }}
                                        transition={{ duration: 0.5 }}
                                        className="h-full bg-emerald-500 rounded-full"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );

}

