import { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Plus, X } from 'lucide-react';
import api from '../services/api';
import { formatMoney } from '../utils/format';

export default function CrossSelling({ cartItems, onAddToCart, exchangeRate, currencyMode }) {
    const [suggestions, setSuggestions] = useState([]);
    const [speech, setSpeech] = useState('');
    const [dismissed, setDismissed] = useState(false);

    const fetchSuggestions = useCallback(async () => {
        try {
            const response = await api.post('/ai/cross-selling', { cartItems });
            if (response.data && response.data.items && response.data.items.length > 0) {
                setSuggestions(response.data.items);
                setSpeech(response.data.speech);
                setDismissed(false); // Resetear dismiss al tener nuevas sugerencias
            } else {
                setSuggestions([]);
            }
        } catch (error) {
            console.error('Cross selling error:', error);
        }
    }, [cartItems]);

    useEffect(() => {
        if (!cartItems || cartItems.length === 0) {
            setSuggestions([]);
            setSpeech('');
            return;
        }

        // Debounce para no quemar la API con cada tecla
        const timer = setTimeout(() => {
            fetchSuggestions();
        }, 1500);

        return () => clearTimeout(timer);
    }, [cartItems, fetchSuggestions]);

    if (dismissed || suggestions.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[100] w-80 bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-bottom-8">
            <button 
                onClick={() => setDismissed(true)}
                className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
            >
                <X size={16} />
            </button>
            
            <div className="flex items-center gap-2 mb-3 pr-6">
                <div className="bg-sky-100 dark:bg-sky-900/40 p-1.5 rounded-xl text-sky-600 dark:text-sky-400 shrink-0">
                    <ShoppingBag size={16} />
                </div>
                <p className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide leading-tight">
                    {speech || "Sugerencias de Venta:"}
                </p>
            </div>

            <div className="space-y-2">
                {suggestions.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2.5 border border-slate-100 dark:border-slate-700/50 group hover:border-primary-300 dark:hover:border-primary-500/50 transition-colors">
                        <div className="flex flex-col min-w-0 flex-1 mr-3">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{item.name}</span>
                            <span className="text-xs font-black text-primary-600 dark:text-primary-400 mt-0.5">
                                {formatMoney(item.price, null, { rate: exchangeRate, currencyMode })}
                            </span>
                        </div>
                        <button 
                            onClick={() => onAddToCart(item)}
                            className="shrink-0 flex items-center gap-1 text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg transition-transform active:scale-95 shadow-sm font-bold text-xs"
                            title="Añadir sugerencia"
                        >
                            <Plus size={14} /> Añadir
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
