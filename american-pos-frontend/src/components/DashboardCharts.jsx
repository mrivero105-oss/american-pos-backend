import { useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { TrendingUp, Layers } from 'lucide-react';
import { formatMoney } from '../utils/format';

const formatCompact = (value, settings) => {
  if (!value || value === 0) return '0';
  const prefix = settings?.currencyMode === 'USD' ? '$' : 'Bs';
  const num = Number(value);
  if (Math.abs(num) >= 1000000) {
    return `${prefix} ${(num / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(num) >= 1000) {
    const k = num / 1000;
    return `${prefix} ${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${prefix} ${num.toFixed(0)}`;
};

const DashboardCharts = ({ data = [], categorySales = [], settings, isHourly = false }) => {
  // Format and prioritize categories with actual sales
  const categoryData = useMemo(() => {
    if (!categorySales || !Array.isArray(categorySales)) return [];
    
    // Filter active categories first
    const active = categorySales
      .filter(c => Number(c.total || 0) > 0 || Number(c.profit || 0) > 0)
      .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
      .slice(0, 5);

    if (active.length > 0) {
      return active.map(c => ({
        category: c.category || 'General',
        total: Number(c.total) || 0,
        profit: Number(c.profit) || 0
      }));
    }

    // Fallback: show first categories even if 0
    return categorySales.slice(0, 5).map(c => ({
      category: c.category || 'General',
      total: Number(c.total) || 0,
      profit: Number(c.profit) || 0
    }));
  }, [categorySales]);

  const hasTimelineData = data && data.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {/* 1. Area Chart: Revenue & Profit Timeline */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              Ventas vs Utilidad
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isHourly ? 'Evolución horaria de ventas y margen neto hoy' : 'Comparativa de volumen facturado y margen neto'}
            </p>
          </div>
          <div className="h-9 w-9 bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-400 rounded-lg flex items-center justify-center border border-primary-200 dark:border-primary-800/40 shrink-0">
            <TrendingUp size={18} />
          </div>
        </div>
        
        <div className="h-64 sm:h-72">
          {!hasTimelineData ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
              <TrendingUp size={32} className="mb-2 opacity-30 text-primary-400" />
              <span className="font-semibold">Sin datos de tendencia en este período</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 15, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" strokeOpacity={0.15} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 600 }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  width={75}
                  tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 600 }}
                  tickFormatter={(val) => formatCompact(val, settings)}
                />
                <Tooltip 
                  formatter={(value, name) => {
                    const label = name === 'total' ? 'Ventas' : 'Utilidad';
                    const main = formatMoney(value, null, settings);
                    if (settings?.currencyMode === 'BOTH') {
                      return [`${main} (${formatMoney(value, 'USD', settings)})`, label];
                    }
                    return [main, label];
                  }}
                  contentStyle={{ 
                    backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                    color: 'white'
                  }}
                  itemStyle={{ color: 'white', fontSize: '12px', fontWeight: '600' }}
                  labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', fontWeight: '700' }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right" 
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontWeight: 700 }}
                  formatter={(val) => val === 'total' ? 'Ventas' : 'Utilidad'}
                />
                <Area 
                  type="monotone" 
                  dataKey="total" 
                  stroke="#3b82f6" 
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#3b82f6', strokeWidth: 1 }}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                  fillOpacity={1} 
                  fill="url(#colorTotal)" 
                  name="total"
                />
                <Area 
                  type="monotone" 
                  dataKey="profit" 
                  stroke="#10b981" 
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#10b981', strokeWidth: 1 }}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                  fillOpacity={1} 
                  fill="url(#colorProfit)" 
                  name="profit"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 2. Horizontal Bar Chart: Category Profitability */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              Rentabilidad por Rubro
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Distribución de volumen y margen por categoría
            </p>
          </div>
          <div className="h-9 w-9 bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400 rounded-lg flex items-center justify-center border border-purple-200 dark:border-purple-800/40 shrink-0">
            <Layers size={18} />
          </div>
        </div>
        
        <div className="h-64 sm:h-72">
          {categoryData.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
              <Layers size={32} className="mb-2 opacity-30 text-purple-400" />
              <span className="font-semibold">Sin categorías registradas en este período</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={categoryData}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 10, bottom: 0 }}
                barGap={4}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" strokeOpacity={0.15} />
                <XAxis 
                  type="number"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 600 }}
                  tickFormatter={(val) => formatCompact(val, settings)}
                />
                <YAxis 
                  type="category"
                  dataKey="category"
                  axisLine={false} 
                  tickLine={false} 
                  width={80}
                  tick={{ fill: '#9CA3AF', fontSize: 11, fontWeight: 700 }}
                  tickFormatter={(val) => (val && val.length > 11 ? `${val.substring(0, 10)}…` : val)}
                />
                <Tooltip 
                  formatter={(value, name) => {
                    const label = name === 'total' ? 'Ventas' : 'Utilidad';
                    const main = formatMoney(value, null, settings);
                    if (settings?.currencyMode === 'BOTH') {
                      return [`${main} (${formatMoney(value, 'USD', settings)})`, label];
                    }
                    return [main, label];
                  }}
                  contentStyle={{ 
                    backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                    color: 'white'
                  }}
                  itemStyle={{ color: 'white', fontSize: '12px', fontWeight: '600' }}
                  labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', fontWeight: '700' }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right" 
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontWeight: 700 }}
                  formatter={(val) => val === 'total' ? 'Ventas' : 'Utilidad'}
                />
                <Bar 
                  dataKey="total" 
                  name="total" 
                  fill="#3b82f6" 
                  radius={[0, 6, 6, 0]} 
                  barSize={12} 
                />
                <Bar 
                  dataKey="profit" 
                  name="profit" 
                  fill="#10b981" 
                  radius={[0, 6, 6, 0]} 
                  barSize={12} 
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardCharts;
