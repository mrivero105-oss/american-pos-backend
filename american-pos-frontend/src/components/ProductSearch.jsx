import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { usePos } from '../hooks/PosContext';
import { db } from '../services/db';
import localDb from '../db/localDb';
import { isUsdOnlyMode } from '../utils/format';
import useScanner from '../hooks/useScanner';

export default function ProductSearch({ onSelectProduct }) {
  const posContext = usePos() || {};
  const exchangeRate = posContext.exchangeRate || 650;
  const currencyMode = posContext.currencyMode || 'BOTH';
  const showDual = !isUsdOnlyMode({ currencyMode }) && (currencyMode === 'BOTH' || currencyMode === 'DUAL' || currencyMode === 'VES');

  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [filtered, setFiltered] = useState([]);

  useEffect(() => {
    const loadLocalProducts = async () => {
      try {
        let localList = await db.getAll('products');
        if (!localList || localList.length === 0) {
          if (localDb && localDb.products) {
            localList = await localDb.products.toArray();
          }
        }
        if (localList && localList.length > 0) {
          const normalized = localList.map(p => ({
            ...p,
            id: p.id,
            nombre: p.name || p.nombre || 'Producto sin nombre',
            precio: p.price ?? p.precio ?? p.priceBs ?? 0,
            stock_total: p.stockQuantity ?? p.stock ?? p.stock_total ?? 0,
            codigo_barras: p.barcode || p.codigo_barras || '',
            es_controlado: Boolean(p.es_controlado)
          }));
          normalized.sort((a, b) => {
            const stockA = Number(a.stock_total ?? a.stockQuantity ?? a.stock ?? 0);
            const stockB = Number(b.stock_total ?? b.stockQuantity ?? b.stock ?? 0);
            const outA = stockA <= 0 ? 1 : 0;
            const outB = stockB <= 0 ? 1 : 0;
            if (outA !== outB) return outA - outB;
            return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base', numeric: true });
          });
          setProducts(normalized);
        }
      } catch (caughtErr) { console.warn('[ProductSearch] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
    };

    loadLocalProducts();

    // Attempt to load from API if online
    api.get('/products')
      .then(res => {
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          const normalized = res.data.map(p => ({
            ...p,
            id: p.id,
            nombre: p.name || p.nombre || 'Producto sin nombre',
            precio: p.price ?? p.precio ?? p.priceBs ?? 0,
            stock_total: p.stockQuantity ?? p.stock ?? p.stock_total ?? 0,
            codigo_barras: p.barcode || p.codigo_barras || '',
            es_controlado: Boolean(p.es_controlado)
          }));
          normalized.sort((a, b) => {
            const stockA = Number(a.stock_total ?? a.stockQuantity ?? a.stock ?? 0);
            const stockB = Number(b.stock_total ?? b.stockQuantity ?? b.stock ?? 0);
            const outA = stockA <= 0 ? 1 : 0;
            const outB = stockB <= 0 ? 1 : 0;
            if (outA !== outB) return outA - outB;
            return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base', numeric: true });
          });
          setProducts(normalized);
        }
      })
      .catch(() => {
        loadLocalProducts();
      });
  }, []);

  useEffect(() => {
    if (!query || !query.trim()) {
      setFiltered([]);
      return;
    }
    const normalize = (str) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const q = normalize(query);
    // GS1 DataMatrix Parser (01 GTIN + 17 Expiration + 10 Lot)
    let parsedQ = q;
    if (q.startsWith('01') && q.length >= 16) {
      parsedQ = q.slice(2, 16).replace(/^0+/, '');
    }

    const results = products.filter(p => {
      const nom = normalize(p.name || p.nombre);
      const cod = normalize(p.barcode || p.codigo_barras);
      const principio = normalize(p.principio_activo);
      return nom.includes(q) || cod.includes(q) || cod === parsedQ || cod.includes(parsedQ) || principio.includes(q);
    });
    setFiltered(results);
  }, [query, products]);

  const getExpirationStatus = (expDate) => {
    if (!expDate || expDate === 'N/A') return null;
    const today = new Date();
    today.setHours(0,0,0,0);
    const exp = new Date(expDate);
    if (isNaN(exp.getTime())) return null;
    const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return { label: '🔴 VENCIDO', color: 'bg-red-500/20 text-red-400 border-red-500/50' };
    if (diffDays <= 90) return { label: `🟡 Vence: ${expDate}`, color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' };
    return { label: `🟢 Vence: ${expDate}`, color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' };
  };

  const handleBarcodeMatch = useCallback((rawCode) => {
    const clean = String(rawCode || '').trim().toLowerCase();
    if (!clean) return false;
    let parsedQ = clean;
    if (clean.startsWith('01') && clean.length >= 16) {
      parsedQ = clean.slice(2, 16).replace(/^0+/, '');
    }
    const exact = products.find(p => {
      const cod = String(p.barcode || p.codigo_barras || p.sku || '').trim().toLowerCase();
      return cod && (cod === clean || cod === parsedQ || (clean.length >= 4 && cod.endsWith(clean)));
    });
    const target = exact || (filtered.length === 1 ? filtered[0] : null);
    if (target) {
      onSelectProduct(target);
      setQuery('');
      setFiltered([]);
      return true;
    }
    return false;
  }, [products, filtered, onSelectProduct]);

  useScanner(handleBarcodeMatch, { timeout: 120, minLength: 3 });

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          type="text"
          data-pos-search="true"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'NumpadEnter') {
              if (handleBarcodeMatch(query)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }
          }}
          placeholder="🔍 Buscar o escanear GS1 DataMatrix / Código de barras (ej. 0107501001001)..."
          className="w-full px-5 py-4 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-2xl shadow-sm text-base font-semibold text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
        />
        {query && (
          <button 
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold p-1"
          >
            ✕
          </button>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
          {filtered.map(product => {
            const expStatus = getExpirationStatus(product.expirationDate);
            return (
              <div
                key={product.id}
                className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center justify-between transition-colors"
              >
                <div 
                  className="flex-1 cursor-pointer pr-4"
                  onClick={() => {
                    onSelectProduct(product);
                    setQuery('');
                    setFiltered([]);
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900 dark:text-white">{product.nombre || product.name || 'Sin nombre'}</span>
                    {product.es_controlado && (
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 rounded border border-purple-300 dark:border-purple-800">
                        Controlado
                      </span>
                    )}
                    {expStatus && (
                      <span className={`px-2 py-0.5 text-[10px] font-black rounded border ${expStatus.color}`}>
                        {expStatus.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Código: {product.codigo_barras || product.barcode || 'S/C'} | Stock: {product.stock_total ?? product.stockQuantity ?? product.stock ?? 0}
                  </div>
                </div>
                
                <div className="flex items-center gap-3 shrink-0">
                  {onSelectProduct.onOpenEquivalents && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProduct.onOpenEquivalents(product);
                      }}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-cyan-500 hover:text-white text-cyan-600 dark:text-cyan-400 rounded-xl text-xs font-black transition-all border border-slate-200 dark:border-slate-700"
                    >
                      🧪 Equivalentes
                    </button>
                  )}
                  <div 
                    className="text-right cursor-pointer"
                    onClick={() => {
                      onSelectProduct(product);
                      setQuery('');
                      setFiltered([]);
                    }}
                  >
                    <div className="font-black text-lg text-emerald-600 dark:text-emerald-400">
                      ${Number(product.precio ?? product.price ?? product.priceBs ?? 0).toFixed(2)}
                    </div>
                    {showDual && (
                      <div className="text-xs font-bold text-cyan-600 dark:text-cyan-400 font-mono">
                        Bs {(Number(product.precio ?? product.price ?? product.priceBs ?? 0) * exchangeRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
