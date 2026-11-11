import { useState } from 'react';
import { 
    format, 
    addMonths, 
    subMonths, 
    startOfMonth, 
    endOfMonth, 
    startOfWeek, 
    endOfWeek, 
    isSameMonth, 
    isSameDay, 
    addDays, 
    eachDayOfInterval, 
    isWithinInterval,
    parseISO
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X } from 'lucide-react';

export default function MiniCalendar({ startDate, endDate, onSelectRange, onClose }) {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    
    const start = startDate ? parseISO(startDate) : null;
    const end = endDate ? parseISO(endDate) : null;

    const renderHeader = () => {
        return (
            <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <CalendarIcon size={16} className="text-primary-500 shrink-0" />
                    <span className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 capitalize">
                        {format(currentMonth, 'MMMM yyyy', { locale: es })}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                        className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 active:scale-95 transition-all"
                        aria-label="Mes anterior"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                        className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 active:scale-95 transition-all"
                        aria-label="Mes siguiente"
                    >
                        <ChevronRight size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-slate-400 hover:text-red-500 active:scale-95 transition-all ml-1"
                        aria-label="Cerrar calendario"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>
        );
    };

    const renderDays = () => {
        const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        return (
            <div className="grid grid-cols-7 mb-1 bg-slate-50 dark:bg-slate-800/30 py-1.5">
                {days.map((day, i) => (
                    <div key={i} className="text-[10px] font-black text-slate-500 dark:text-slate-400 text-center uppercase tracking-tighter">
                        {day}
                    </div>
                ))}
            </div>
        );
    };

    const [selectingStart, setSelectingStart] = useState(null);

    const onDateClick = (day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        
        if (!selectingStart) {
            // First click: hold it locally
            setSelectingStart(day);
            // Optionally update parent to show the single day preview
            onSelectRange(dateStr, null);
        } else {
            // Second click: complete range (even if it's the same day)
            if (day < selectingStart) {
                onSelectRange(dateStr, format(selectingStart, 'yyyy-MM-dd'));
            } else {
                onSelectRange(format(selectingStart, 'yyyy-MM-dd'), dateStr);
            }
            setSelectingStart(null);
        }
    };

    const renderCells = () => {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(monthStart);
        const startDate_ = startOfWeek(monthStart);
        const endDate_ = endOfWeek(monthEnd);

        const rows = [];
        let days = [];
        let day = startDate_;
        let formattedDate = "";

        while (day <= endDate_) {
            for (let i = 0; i < 7; i++) {
                formattedDate = format(day, "d");
                const cloneDay = day;
                
                const isSelected = (start && isSameDay(day, start)) || (end && isSameDay(day, end)) || (selectingStart && isSameDay(day, selectingStart));
                const isInRange = start && end && isWithinInterval(day, { start, end });

                const isCurrentMonth = isSameMonth(day, monthStart);

                days.push(
                    <div
                        key={day.toString()}
                        className={`relative h-10 sm:h-9 flex items-center justify-center cursor-pointer transition-all active:scale-95 select-none
                            ${!isCurrentMonth ? 'text-slate-300 dark:text-slate-700' : 'text-slate-700 dark:text-slate-300'}
                            ${(isInRange && !isSelected) ? 'bg-primary-50 dark:bg-primary-900/10' : ''}
                            ${isSelected ? 'z-10' : ''}
                        `}
                        onClick={() => onDateClick(cloneDay)}
                    >
                        {isSelected && (
                            <div className="absolute inset-1 bg-primary-600 rounded-lg shadow-md shadow-primary-500/30 animate-in zoom-in-50 duration-200"></div>
                        )}
                        <span className={`relative text-xs sm:text-[11px] font-bold ${isSelected ? 'text-white' : ''}`}>
                            {formattedDate}
                        </span>
                        
                        {isSameDay(day, new Date()) && !isSelected && (
                            <div className="absolute bottom-1 w-1 h-1 bg-primary-500 rounded-full"></div>
                        )}
                    </div>
                );
                day = addDays(day, 1);
            }
            rows.push(
                <div className="grid grid-cols-7" key={day.toString()}>
                    {days}
                </div>
            );
            days = [];
        }
        return <div className="p-1">{rows}</div>;
    };

    return (
        <div className="absolute top-full right-0 mt-2 w-[calc(100vw-2rem)] sm:w-72 max-w-[300px] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden z-[200] animate-in fade-in slide-in-from-top-2 duration-150">
            {renderHeader()}
            {renderDays()}
            {renderCells()}
            
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center gap-2">
                <div className="text-[11px] sm:text-[10px] text-slate-500 font-medium truncate">
                    {selectingStart ? '1 día seleccionado' : (start && !end ? 'Selecciona fin...' : 'Rango personalizado')}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button 
                        type="button"
                        onClick={() => {
                            const today = format(new Date(), 'yyyy-MM-dd');
                            onSelectRange(today, today);
                        }}
                        className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg text-xs sm:text-[10px] font-black text-slate-700 dark:text-slate-200 uppercase active:scale-95 transition-all"
                    >
                        Hoy
                    </button>
                    {(selectingStart || start) && (
                        <button 
                            type="button"
                            onClick={() => {
                                if (selectingStart) {
                                    const dStr = format(selectingStart, 'yyyy-MM-dd');
                                    onSelectRange(dStr, dStr);
                                } else if (start && !end) {
                                    const dStr = format(start, 'yyyy-MM-dd');
                                    onSelectRange(dStr, dStr);
                                } else {
                                    onClose();
                                }
                            }}
                            className="px-2.5 py-1 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs sm:text-[10px] font-black text-white uppercase active:scale-95 transition-all shadow-sm shadow-primary-500/30"
                        >
                            Aplicar
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
