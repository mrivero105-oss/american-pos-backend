import { motion } from 'framer-motion';
import { Clock, Zap, Moon, Sunrise, Sun, Sunset } from 'lucide-react';
import { formatMoney } from '../../utils/format';

const PerformanceHeatmap = ({ hourlySales = [], settings }) => {
  // Ensure we have 24 hours
  const fullHours = Array(24).fill(0).map((_, i) => {
    const found = hourlySales.find(h => h.hour === i);
    return found || { hour: i, count: 0, total: 0 };
  });

  const maxTotal = Math.max(...fullHours.map(h => h.total), 1);

  const shifts = [
    {
      name: 'Madrugada',
      hours: fullHours.slice(0, 6),
      icon: Moon,
      desc: '12:00 AM - 5:59 AM',
      badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/40'
    },
    {
      name: 'Mañana',
      hours: fullHours.slice(6, 12),
      icon: Sunrise,
      desc: '6:00 AM - 11:59 AM',
      badgeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/40'
    },
    {
      name: 'Tarde',
      hours: fullHours.slice(12, 18),
      icon: Sun,
      desc: '12:00 PM - 5:59 PM',
      badgeBg: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800/40'
    },
    {
      name: 'Noche',
      hours: fullHours.slice(18, 24),
      icon: Sunset,
      desc: '6:00 PM - 11:59 PM',
      badgeBg: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800/40'
    }
  ];

  return (
    <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs relative">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Intensidad Horaria</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Distribución de ventas por turnos de operación</p>
        </div>
        <div className="h-9 w-9 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center border border-amber-200 dark:border-amber-800/40 shrink-0">
          <Clock size={18} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {shifts.map((shift, sIdx) => {
          const shiftTotal = shift.hours.reduce((acc, curr) => acc + curr.total, 0);
          const shiftCount = shift.hours.reduce((acc, curr) => acc + curr.count, 0);
          const hasSales = shiftTotal > 0;
          const ShiftIcon = shift.icon;

          return (
            <div 
              key={sIdx} 
              className="p-3.5 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <ShiftIcon size={14} className="text-slate-500 dark:text-slate-400" />
                    <span>{shift.name}</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{shift.desc}</p>
                </div>
                {hasSales && (
                  <div className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${shift.badgeBg}`}>
                    {shiftCount} ventas ({formatMoney(shiftTotal, null, settings)})
                  </div>
                )}
              </div>

              <div className="grid grid-cols-6 gap-1.5">
                {shift.hours.map((data, i) => {
                  const intensity = data.total / maxTotal;
                  const bgOpacity = Math.max(0.12, intensity);
                  const isHourActive = data.total > 0;
                  
                  return (
                    <motion.div 
                      key={i}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: (sIdx * 6 + i) * 0.01 }}
                      className="relative group/hour"
                    >
                      <div 
                        className={`h-10 sm:h-11 rounded-lg transition-colors border flex flex-col items-center justify-center cursor-help ${
                          intensity > 0.5 
                            ? 'border-amber-400 dark:border-amber-500' 
                            : 'border-slate-200 dark:border-slate-700/60'
                        }`}
                        style={{ 
                          backgroundColor: isHourActive 
                            ? `rgba(245, 158, 11, ${bgOpacity})` 
                            : 'transparent'
                        }}
                      >
                        <span className={`text-[10px] font-semibold ${
                          intensity > 0.6 
                            ? 'text-white font-bold' 
                            : 'text-slate-700 dark:text-slate-300'
                        }`}>
                          {data.hour}h
                        </span>
                        {intensity > 0.3 && <Zap size={8} className="text-slate-800 dark:text-white mt-0.5" />}
                      </div>

                      {/* Tooltip Overlay */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-36 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg p-2.5 text-center opacity-0 group-hover/hour:opacity-100 transition-opacity pointer-events-none z-[100] shadow-md border border-slate-200 dark:border-slate-700 text-xs">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Hora: {data.hour}:00</p>
                        <p className="font-bold text-xs mt-0.5">
                          {formatMoney(data.total, null, settings)}
                        </p>
                        {settings?.currencyMode === 'BOTH' && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Ref: {formatMoney(data.total, 'USD', settings)}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-500 mt-0.5">{data.count} Ventas</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PerformanceHeatmap;
