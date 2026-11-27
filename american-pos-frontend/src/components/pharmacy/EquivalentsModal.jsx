import { useState, useEffect, useCallback } from 'react';
import { Layers, X, Plus } from 'lucide-react';
import api from '../../services/api';

export default function EquivalentsModal({ isOpen, onClose, product, onSelectSubstitute }) {
  const [equivalents, setEquivalents] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchEquivalents = useCallback(async () => {
    if (!product) return;
    setLoading(true);
    try {
      const response = await api.get('/products', { params: { limit: 200 } });
      const allProducts = Array.isArray(response.data) ? response.data : (response.data?.products || []);
      
      // Filter products with same principio_activo or category, excluding the current product, and having stock > 0
      const filtered = allProducts.filter(p => {
        if (p.id === product.id) return false;
        if (Number(p.stockQuantity) <= 0) return false;
        
        const samePrincipio = p.principio_activo && product.principio_activo && 
          p.principio_activo.trim().toLowerCase() === product.principio_activo.trim().toLowerCase();
        
        const sameCategory = p.category && product.category && 
          p.category.trim().toLowerCase() === product.category.trim().toLowerCase();

        return samePrincipio || sameCategory;
      });

      setEquivalents(filtered);
    } catch (err) {
      console.error('Error fetching equivalents:', err);
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    if (isOpen && product) {
      fetchEquivalents();
    }
  }, [isOpen, product, fetchEquivalents]);

  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-md">
              <Layers size={13} /> Asistente Genérico / Sustitutos
            </span>
            <h3 className="text-xl font-bold text-white mt-2">
              Equivalentes para: <span className="text-cyan-300">{product.nombre || product.name}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Principio Activo: <span className="font-semibold text-slate-200">{product.principio_activo || product.category || 'General'}</span>
            </p>
          </div>
          <button 
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-400 font-semibold animate-pulse">
              Buscando sustitutos en inventario activo...
            </div>
          ) : equivalents.length === 0 ? (
            <div className="py-12 text-center bg-slate-950/50 rounded-xl border border-slate-800 p-6">
              <p className="text-amber-400 font-semibold text-base mb-1">No hay sustitutos en stock</p>
              <p className="text-xs text-slate-500">No se encontraron fármacos activos con la categoría o principio activo de este ítem.</p>
            </div>
          ) : (
            equivalents.map(eq => (
              <div 
                key={eq.id}
                className="flex items-center justify-between p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-colors group"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-white text-base group-hover:text-cyan-300 transition-colors">
                    {eq.name}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                    <span>Categoría: <strong className="text-slate-300">{eq.category || 'N/A'}</strong></span>
                    <span>•</span>
                    <span className="text-emerald-400 font-semibold">Stock: {eq.stockQuantity}</span>
                    {eq.expirationDate && (
                      <>
                        <span>•</span>
                        <span>Vence: <strong className="text-slate-300">{eq.expirationDate}</strong></span>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-xs text-slate-500 uppercase block font-semibold">Precio</span>
                    <span className="text-lg font-bold text-emerald-400 font-mono">${Number(eq.price).toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => {
                      onSelectSubstitute(eq);
                      onClose();
                    }}
                    className="h-9 px-4 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-xs rounded-lg transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                  >
                    <Plus size={14} /> Despachar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
}
