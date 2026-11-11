import { useState, useEffect, memo, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { usePos } from '../hooks/PosContext';

const HeaderSearch = memo(() => {
    const { searchTerm, setSearchTerm } = usePos();
    const [displaySearchTerm, setDisplaySearchTerm] = useState(searchTerm || '');
    const lastNotifiedValue = useRef(searchTerm || '');

    // Sync back ONLY if external change occurs (e.g., from POS SearchBox)
    useEffect(() => {
        if (searchTerm !== lastNotifiedValue.current) {
            setDisplaySearchTerm(searchTerm || '');
            lastNotifiedValue.current = searchTerm || '';
        }
    }, [searchTerm]);

    // Handle debounced update to global state
    useEffect(() => {
        const handler = setTimeout(() => {
            if (displaySearchTerm !== searchTerm) {
                lastNotifiedValue.current = displaySearchTerm;
                setSearchTerm(displaySearchTerm);
            }
        }, 300);

        return () => clearTimeout(handler);
    }, [displaySearchTerm, searchTerm, setSearchTerm]);

    return (
        <div className="relative w-full group">
            <div className="absolute inset-y-0 left-0 pl-3 sm:pl-3.5 flex items-center pointer-events-none">
                <Search className="size-4.5 sm:size-5 md:size-4.5 text-slate-500 dark:text-slate-400 group-focus-within:text-primary-500 transition-colors" />
            </div>
            <input
                type="text"
                placeholder="Buscar productos..."
                value={displaySearchTerm}
                onChange={(e) => setDisplaySearchTerm(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setDisplaySearchTerm('');
                        setSearchTerm('');
                    }
                }}
                className="w-full pl-8 sm:pl-11 pr-14 sm:pr-16 py-2 sm:py-2.5 bg-slate-100/50 dark:bg-slate-800/50 border border-transparent focus:bg-white dark:focus:bg-white dark:bg-slate-900 focus:border-primary-500/50 rounded-lg sm:rounded-xl focus:ring-4 focus:ring-primary-500/10 text-slate-700 dark:text-slate-100 font-bold transition-all text-base sm:text-sm placeholder:text-slate-500 dark:text-slate-400 dark:placeholder:text-slate-500 outline-none"
            />
            <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
                {displaySearchTerm && (
                    <button
                        onClick={() => {
                            setDisplaySearchTerm('');
                            setSearchTerm('');
                        }}
                        className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                        title="Borrar búsqueda"
                    >
                        <X size={16} />
                    </button>
                )}
                <div className="hidden sm:flex items-center px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded-md border border-slate-300 dark:border-white/10 opacity-40">
                    <span className="text-[9px] font-black text-slate-500 dark:text-slate-400">F4</span>
                </div>
            </div>
        </div>
    );
});

export default HeaderSearch;
