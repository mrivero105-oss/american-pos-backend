import { TrendingUp, DollarSign, ShoppingCart, Percent } from 'lucide-react';
import { formatMoney } from '../../utils/format';

const StatCard = ({ title, value, subtitle, icon: Icon, color, settings, isPercentage = false }) => {
  const isBoth = settings?.currencyMode === 'BOTH';
  
  const displayValue = isPercentage ? `${value}%` : formatMoney(value, null, settings);
  const secondaryValue = (isBoth && !isPercentage) ? formatMoney(value, 'USD', settings) : null;

  return (
    <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
          {title}
        </span>
        <div className={`p-2 rounded-lg border shrink-0 ${color}`}>
          <Icon size={16} />
        </div>
      </div>

      <div>
        <div 
          className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight tabular-nums"
          title={displayValue}
        >
          {displayValue}
        </div>
        {secondaryValue && (
          <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5">
            Ref: {secondaryValue}
          </p>
        )}
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {subtitle}
        </p>
      </div>
    </div>
  );
};

const ExecutiveStats = ({ summary = {}, settings }) => {
  const stats = [
    {
      title: "Ingresos Totales",
      value: summary.totalRevenue || 0,
      subtitle: "Ventas brutas del periodo",
      icon: DollarSign,
      color: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/40",
      settings
    },
    {
      title: "Ganancia Neta",
      value: summary.netProfit || 0,
      subtitle: "Utilidad tras deducciones",
      icon: TrendingUp,
      color: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/40",
      settings
    },
    {
      title: "Ticket Promedio",
      value: summary.ticketPromedio || 0,
      subtitle: "Valor medio por venta",
      icon: ShoppingCart,
      color: "bg-primary-50 text-primary-600 border-primary-200 dark:bg-primary-950/40 dark:text-primary-400 dark:border-primary-800/40",
      settings
    },
    {
      title: "Margen Bruto",
      value: (summary.avgMargin || 0).toFixed(1),
      subtitle: "Rentabilidad porcentual",
      icon: Percent,
      color: "bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800/40",
      settings,
      isPercentage: true
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} />
      ))}
    </div>
  );
};

export default ExecutiveStats;
