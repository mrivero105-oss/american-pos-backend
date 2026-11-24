import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, AlertCircle, RefreshCw, Link2, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { hapticTap, hapticSuccess } from '../../utils/haptics';

export default function MobileImageSearchModal({
  isOpen,
  onClose,
  productName = '',
  productCategory = 'General',
  productId = 'new',
  onImageSelected
}) {
  const [searchTerm, setSearchTerm] = useState(productName || '');
  const [activeTab, setActiveTab] = useState('web'); // 'web' | 'url'
  const [customUrl, setCustomUrl] = useState('');
  const [previewCustomUrl, setPreviewCustomUrl] = useState('');
  
  const [candidates, setCandidates] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  const performSearch = useCallback(async (termToSearch) => {
    const query = (termToSearch || searchTermRef.current || '').trim();
    if (!query) {
      setSearchError('Ingresa el nombre del producto para buscar su imagen comercial.');
      return;
    }

    try {
      setIsSearching(true);
      setSearchError('');
      setCandidates([]);
      hapticTap();

      const prodId = productId && productId !== 'new' ? productId : 'new';
      const res = await api.post(`/products/${prodId}/search-images-ia`, {
        name: query,
        category: productCategory || 'General'
      }, { timeout: 15000 });

      const rawImages = res.data?.images || [];
      if (Array.isArray(rawImages) && rawImages.length > 0) {
        setCandidates(rawImages);
        hapticSuccess();
      } else {
        setSearchError('No se encontraron imágenes comerciales claras. Prueba especificando la marca o tamaño.');
      }
    } catch (err) {
      console.warn('Error buscando imágenes web:', err);
      const msg = err.response?.data?.error || err.message || 'Error de conexión al buscar imágenes';
      setSearchError(msg);
    } finally {
      setIsSearching(false);
    }
  }, [productId, productCategory]);

  // Iniciar búsqueda automática al abrir si hay término
  useEffect(() => {
    if (isOpen) {
      const term = (productName || '').trim();
      setSearchTerm(term);
      setSelectedCandidate(null);
      setSearchError('');
      setCustomUrl('');
      setPreviewCustomUrl('');
      setActiveTab('web');

      if (term) {
        performSearch(term);
      } else {
        setCandidates([]);
      }
    }
  }, [isOpen, productName, performSearch]);

  const handleSelectImage = async (imgUrl) => {
    if (!imgUrl) return;
    try {
      setSelectedCandidate(imgUrl);
      setIsDownloading(true);
      hapticTap();

      const prodId = productId && productId !== 'new' ? productId : 'new';
      let finalUri = imgUrl;

      try {
        const res = await api.post(`/products/${prodId}/select-image-ia`, {
          imageUrl: imgUrl,
          name: searchTerm,
          category: productCategory
        }, { timeout: 12000 });

        finalUri = res.data?.imageUri || res.data?.imageUrl || imgUrl;
      } catch (dlErr) {
        console.warn('Descarga en servidor falló, usando URL directa:', dlErr);
        // Fallback a URL directa si el servidor local no pudo persistir
        finalUri = imgUrl;
      }

      hapticSuccess();
      onImageSelected?.(finalUri);
      onClose();
    } catch (err) {
      console.error('Error seleccionando imagen:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleApplyCustomUrl = () => {
    const url = customUrl.trim();
    if (!url || !url.startsWith('http')) {
      return;
    }
    handleSelectImage(url);
  };

  if (!isOpen) return null;

  const content = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[210000] flex items-end sm:items-center justify-center bg-black/90 p-0 sm:p-4 pb-safe">
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-lg max-h-[92dvh] bg-slate-950 border border-white/15 rounded-t-xl sm:rounded-xl shadow-xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 flex items-center justify-between border-b border-white/10 bg-slate-900/90 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
                <Globe size={18} />
              </div>
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  Buscador de Fotos
                </h3>
                <p className="text-[10px] font-bold text-slate-400">
                  Catálogo comercial en alta definición
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              disabled={isDownloading}
              className="p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Selector de Pestaña */}
          <div className="flex items-center border-b border-white/10 bg-slate-900/60 p-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('web')}
              className={`flex-1 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'web'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white bg-transparent'
              }`}
            >
              <Search size={13} />
              <span>Búsqueda Web</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('url')}
              className={`flex-1 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'url'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white bg-transparent'
              }`}
            >
              <Link2 size={13} />
              <span>Pegar Enlace</span>
            </button>
          </div>

          {/* Barra de Búsqueda para Modo Web */}
          {activeTab === 'web' && (
            <div className="p-3 bg-slate-900/40 border-b border-white/10 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  performSearch();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Nombre, marca o presentación..."
                    className="w-full pl-8 pr-8 py-2 bg-slate-900 border border-white/15 rounded-xl text-xs text-white placeholder-slate-500 font-bold outline-none focus:border-blue-500"
                  />
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSearching || isDownloading}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all shrink-0"
                >
                  {isSearching ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
                  <span>Buscar</span>
                </button>
              </form>
            </div>
          )}

          {/* Contenido Principal */}
          <div className="flex-1 overflow-y-auto p-3.5 custom-scrollbar min-h-[260px] max-h-[55dvh]">
            {activeTab === 'web' ? (
              <>
                {/* Cargando */}
                {isSearching && (
                  <div className="py-14 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <RefreshCw size={24} className="animate-spin text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-white">Localizando fotos oficiales...</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Buscando en catálogos comerciales</p>
                    </div>
                  </div>
                )}

                {/* Error o Sin Resultados */}
                {!isSearching && searchError && (
                  <div className="py-10 px-4 flex flex-col items-center justify-center text-center space-y-2.5">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                      <AlertCircle size={20} />
                    </div>
                    <p className="text-xs font-bold text-slate-300 max-w-xs">{searchError}</p>
                    <button
                      type="button"
                      onClick={() => performSearch()}
                      className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[11px] font-black uppercase tracking-wider cursor-pointer"
                    >
                      Reintentar
                    </button>
                  </div>
                )}

                {/* Cuadrícula de Candidatas */}
                {!isSearching && !searchError && candidates.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {candidates.length} Fotos Encontradas:
                      </span>
                      <span className="text-[10px] font-bold text-blue-400">
                        Toca una foto para asignarla
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {candidates.map((imgUrl, idx) => {
                        const isThisSelected = selectedCandidate === imgUrl;
                        return (
                          <div
                            key={idx}
                            onClick={() => handleSelectImage(imgUrl)}
                            className={`group relative aspect-square rounded-2xl bg-slate-900 border overflow-hidden cursor-pointer transition-all active:scale-95 flex items-center justify-center p-2 ${
                              isThisSelected
                                ? 'border-blue-500 ring-2 ring-blue-500/30'
                                : 'border-white/10 hover:border-blue-500/50 hover:bg-slate-800/80'
                            }`}
                          >
                            <img
                              src={imgUrl}
                              alt={`Opción ${idx + 1}`}
                              className="w-full h-full object-contain transition-transform group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => {
                                e.target.style.display = 'none';
                              }}
                            />

                            {/* Overlay de descarga */}
                            {isThisSelected && isDownloading && (
                              <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-2 text-center">
                                <RefreshCw size={20} className="animate-spin text-blue-400 mb-1" />
                                <span className="text-[10px] font-black text-white">Guardando...</span>
                              </div>
                            )}

                            {/* Badge de Selección */}
                            {isThisSelected && !isDownloading && (
                              <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg">
                                <Check size={14} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Modo Pegar Enlace */
              <div className="p-2 space-y-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1.5">
                    URL de la Imagen (HTTPS)
                  </label>
                  <input
                    type="url"
                    value={customUrl}
                    onChange={(e) => {
                      setCustomUrl(e.target.value);
                      setPreviewCustomUrl(e.target.value);
                    }}
                    placeholder="https://ejemplo.com/producto.jpg"
                    className="w-full px-3 py-2.5 bg-slate-900 border border-white/15 rounded-xl text-xs text-white placeholder-slate-500 font-mono outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Pega el enlace directo a una imagen PNG, JPG o WEBP.
                  </p>
                </div>

                {previewCustomUrl && (
                  <div className="p-3 bg-slate-900 rounded-2xl border border-white/10 flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                      <img
                        src={previewCustomUrl}
                        alt="Previsualización"
                        className="w-full h-full object-contain"
                        onError={() => setPreviewCustomUrl('')}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate">Previsualización</p>
                      <p className="text-[10px] text-slate-400 truncate">{customUrl}</p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleApplyCustomUrl}
                  disabled={!customUrl.startsWith('http') || isDownloading}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md"
                >
                  {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>Aplicar esta Foto</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/10 bg-slate-900/90 flex items-center justify-between shrink-0">
            <span className="text-[10px] text-slate-400 font-mono truncate max-w-[240px]">
              {searchTerm ? `Búsqueda: "${searchTerm}"` : 'Sin búsqueda'}
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={isDownloading}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-black uppercase tracking-wider cursor-pointer active:scale-95"
            >
              Cerrar
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
