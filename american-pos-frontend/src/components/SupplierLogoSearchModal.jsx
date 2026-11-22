import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
    Search, 
    X, 
    Download, 
    Check, 
    Globe, 
    RefreshCw, 
    Image as ImageIcon, 
    Link2
} from 'lucide-react';
import api from '../services/api';
import BaseModal from './BaseModal';
import { getImageUrl } from '../utils/imageUtils';

export default function SupplierLogoSearchModal({ 
    isOpen, 
    onClose, 
    supplierName = '', 
    supplierId = null, 
    onSelectLogo 
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [downloadingUrl, setDownloadingUrl] = useState(null);
    const [customUrl, setCustomUrl] = useState('');
    const [showCustomUrl, setShowCustomUrl] = useState(false);

    // Clean brand name helper (removes C.A., S.A., S.R.L., etc. for better search accuracy)
    const cleanBrandName = (name) => {
        if (!name) return '';
        return name
            .replace(/\b(c\.?a\.?|s\.?a\.?|s\.?r\.?l\.?|c\.?v\.?|llc|inc|corp|distribuidora|distribuidor|comercializadora|comercial|inversiones|grupo|alimentos|empresa|empresas|de|del|la|los|las|y)\b/gi, ' ')
            .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const queryRef = useRef(query);
    useEffect(() => {
        queryRef.current = query;
    }, [query]);

    const performSearch = useCallback(async (searchTerm) => {
        const q = (searchTerm || queryRef.current).trim();
        if (!q) return;

        try {
            setLoading(true);
            const res = await api.get(`/suppliers/search-logos?q=${encodeURIComponent(q)}`);
            if (typeof res.data === 'string' || !res.data || !Array.isArray(res.data.results)) {
                console.warn('Invalid logo search response from backend:', res.data);
                toast.error('El servidor aún no ha recargado los módulos. Reinicia la aplicación Isaac POS.');
                setResults([]);
                return;
            }
            let found = res.data.results || [];
            if (found.length === 0 && q !== supplierName && supplierName?.trim()) {
                const fallbackRes = await api.get(`/suppliers/search-logos?q=${encodeURIComponent(supplierName.trim())}`);
                if (Array.isArray(fallbackRes.data?.results)) {
                    found = fallbackRes.data.results;
                }
            }
            setResults(found);
        } catch (error) {
            console.error('Error searching logos:', error);
            toast.error('Error al buscar logotipos en línea');
        } finally {
            setLoading(false);
        }
    }, [supplierName]);

    useEffect(() => {
        if (isOpen) {
            const initialQuery = cleanBrandName(supplierName) || supplierName || '';
            setQuery(initialQuery);
            if (initialQuery) {
                performSearch(initialQuery);
            } else {
                setResults([]);
            }
            setCustomUrl('');
            setShowCustomUrl(false);
        }
    }, [isOpen, supplierName, performSearch]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        performSearch(query);
    };

    const handleSelectLogo = async (itemUrl) => {
        try {
            setDownloadingUrl(itemUrl);
            const res = await api.post('/suppliers/download-logo', {
                imageUrl: itemUrl,
                supplierId: supplierId || undefined
            });

            if (res.data?.success && res.data.logoUri) {
                toast.success('Logotipo descargado y asignado exitosamente');
                if (onSelectLogo) {
                    onSelectLogo(res.data.logoUri, getImageUrl(res.data.logoUri));
                }
                onClose();
            } else {
                toast.error('No se pudo procesar el logotipo');
            }
        } catch (error) {
            console.error('Error downloading logo:', error);
            toast.error(error.response?.data?.error || 'Error al descargar logotipo');
        } finally {
            setDownloadingUrl(null);
        }
    };

    const handleCustomUrlSubmit = (e) => {
        e.preventDefault();
        if (!customUrl.trim()) return;
        handleSelectLogo(customUrl.trim());
    };

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-4xl"
            className="overflow-hidden flex flex-col max-h-[90dvh]"
        >
            {/* Header */}
            <div className="relative px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-500 border border-sky-500/20 flex items-center justify-center shrink-0">
                        <Globe size={20} />
                    </div>
                    <div>
                        <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                            <span>Buscador de Logos Online</span>
                        </h2>
                        <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium">
                            Encuentra logotipos oficiales de alta resolución para tus proveedores
                        </p>
                    </div>
                </div>

                <button
                    onClick={onClose}
                    className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-all"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Search Controls */}
            <div className="p-4 sm:p-6 space-y-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10">
                <form onSubmit={handleSearchSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Nombre de la marca o empresa (ej: Polar, Nestle, Pepsi, Bimbo)..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full pl-10 pr-9 py-2.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs sm:text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500 transition-all"
                            autoFocus
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    <button
                        type="submit"
                        disabled={loading || !query.trim()}
                        className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md shadow-primary-500/20 active:scale-95 shrink-0"
                    >
                        {loading ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
                        <span>Buscar</span>
                    </button>
                </form>

                {/* Suggestions / Direct URL Toggle */}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-[11px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-400 font-bold uppercase text-[9.5px]">Sugerencias:</span>
                        {['Sol de Uchire', 'Servicpan', 'Polar', 'Harina PAN', 'Pepsi', 'Nestle', 'Bimbo', 'Coca-Cola', 'Mavesa', 'Alimentos Mary'].map(b => (
                            <button
                                key={b}
                                type="button"
                                onClick={() => { setQuery(b); performSearch(b); }}
                                className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-bold transition-colors cursor-pointer active:scale-95"
                            >
                                {b}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowCustomUrl(!showCustomUrl)}
                        className="text-primary-600 dark:text-primary-400 font-bold hover:underline flex items-center gap-1 ml-auto"
                    >
                        <Link2 size={12} />
                        <span>{showCustomUrl ? 'Ocultar enlace directo' : 'Pegar enlace de imagen (URL)'}</span>
                    </button>
                </div>

                {/* Custom URL Input Accordion */}
                {showCustomUrl && (
                    <form onSubmit={handleCustomUrlSubmit} className="pt-2 flex gap-2 animate-in slide-in-from-top-1 duration-200">
                        <input
                            type="url"
                            placeholder="https://ejemplo.com/logo-proveedor.png"
                            value={customUrl}
                            onChange={(e) => setCustomUrl(e.target.value)}
                            className="flex-1 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <button
                            type="submit"
                            disabled={!customUrl.trim() || !!downloadingUrl}
                            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 shrink-0 flex items-center gap-1"
                        >
                            <Download size={14} /> <span>Asignar</span>
                        </button>
                    </form>
                )}
            </div>

            {/* Results Grid */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 custom-scrollbar min-h-[300px]">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400 animate-pulse">
                        <RefreshCw size={32} className="animate-spin text-primary-500" />
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                            Buscando logotipos vectoriales y transparentes...
                        </p>
                    </div>
                ) : results.length === 0 ? (
                    <div className="py-16 text-center max-w-sm mx-auto space-y-3">
                        <ImageIcon size={44} className="mx-auto text-slate-400 opacity-40" />
                        <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">
                            No se encontraron logotipos
                        </h3>
                        <p className="text-xs text-slate-500">
                            Intenta buscar con un término más corto (ej: el nombre comercial de la marca) o pega un enlace directo de imagen.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                        {results.map((logo, idx) => {
                            const isDownloading = downloadingUrl === logo.url;

                            return (
                                <div
                                    key={idx}
                                    onClick={() => !downloadingUrl && handleSelectLogo(logo.url)}
                                    className={`group relative rounded-2xl border p-3 flex flex-col items-center justify-between gap-2.5 transition-all duration-200 cursor-pointer overflow-hidden shadow-sm hover:shadow-xl ${
                                        isDownloading
                                            ? 'border-primary-500 ring-2 ring-primary-500/50 bg-primary-500/5'
                                            : 'border-slate-200 dark:border-white/10 hover:border-primary-500/50 bg-white dark:bg-slate-800/80 hover:-translate-y-1'
                                    }`}
                                >
                                    {/* Preview Box with subtle transparent pattern */}
                                    <div className="w-full h-24 rounded-xl flex items-center justify-center p-2 relative overflow-hidden bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-white/5">
                                        <img
                                            src={logo.thumbnail || logo.url}
                                            alt={logo.title}
                                            className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                                            loading="lazy"
                                            onError={(e) => {
                                                if (logo.thumbnail && e.currentTarget.src !== logo.thumbnail) {
                                                    e.currentTarget.src = logo.thumbnail;
                                                }
                                            }}
                                        />
                                        {isDownloading && (
                                            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center gap-1.5 text-white">
                                                <RefreshCw size={20} className="animate-spin text-primary-400" />
                                                <span className="text-[9px] font-black uppercase tracking-wider">Descargando...</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Logo Title & Source */}
                                    <div className="w-full text-center">
                                        <p className="text-[11px] font-black text-slate-800 dark:text-white uppercase truncate tracking-tight" title={logo.title}>
                                            {logo.title}
                                        </p>
                                        <span className="text-[9px] font-bold text-slate-400 block truncate">
                                            {logo.source}
                                        </span>
                                    </div>

                                    {/* Action Button */}
                                    <button
                                        type="button"
                                        disabled={!!downloadingUrl}
                                        className="w-full py-1.5 bg-primary-500/10 hover:bg-primary-500 text-primary-600 dark:text-primary-400 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all duration-200 border border-primary-500/20 flex items-center justify-center gap-1"
                                    >
                                        <Check size={12} />
                                        <span>Seleccionar</span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] flex items-center justify-between text-xs text-slate-400">
                <span>{results.length} logotipos encontrados</span>
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-1.5 rounded-xl border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-bold transition-all"
                >
                    Cerrar
                </button>
            </div>
        </BaseModal>
    );
}
