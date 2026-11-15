import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePos } from '../../hooks/PosContext';
import VariantSelectionModal from './VariantSelectionModal';
import CheckoutModal from '../CheckoutModal';
import ReceiptModal from '../ReceiptModal';
import api from '../../services/api';
import localDb from '../../db/localDb';
import { Search, ShoppingBag, Trash2, CreditCard, Tag, Shirt } from 'lucide-react';
import precision from '../../utils/precision';
import POSActionButtons from '../common/POSActionButtons';
import HeldSalesModal from '../HeldSalesModal';
import { useFuzzySearch } from '../../hooks/useFuzzySearch';
import { isUsdOnlyMode } from '../../utils/format';

const MOCK_BOUTIQUE_PRODUCTS = [
  {
    id: 201,
    nombre: 'Blusa de Seda Estampada',
    precio: 35.00,
    codigo_barras: 'BOU-BLU-001',
    categoria: 'Damas',
    Variantes: [
      { id: 2011, talla: 'S', color: 'Rosa', stock: 5, precio_adicional: 0, sku_variante: 'BOU-BLU-001-S-PNK' },
      { id: 2012, talla: 'M', color: 'Rosa', stock: 8, precio_adicional: 0, sku_variante: 'BOU-BLU-001-M-PNK' },
      { id: 2013, talla: 'L', color: 'Blanco', stock: 3, precio_adicional: 2.50, sku_variante: 'BOU-BLU-001-L-WHT' }
    ]
  },
  {
    id: 202,
    nombre: 'Pantalón Jean Slim Fit',
    precio: 48.50,
    codigo_barras: 'BOU-JEA-002',
    categoria: 'Caballeros',
    Variantes: [
      { id: 2021, talla: '30', color: 'Azul', stock: 10, precio_adicional: 0, sku_variante: 'BOU-JEA-002-30-BLU' },
      { id: 2022, talla: '32', color: 'Azul', stock: 14, precio_adicional: 0, sku_variante: 'BOU-JEA-002-32-BLU' },
      { id: 2023, talla: '34', color: 'Negro', stock: 6, precio_adicional: 1.50, sku_variante: 'BOU-JEA-002-34-BLK' }
    ]
  },
  {
    id: 203,
    nombre: 'Vestido de Noche Gala',
    precio: 120.00,
    codigo_barras: 'BOU-VES-003',
    categoria: 'Damas',
    Variantes: [
      { id: 2031, talla: 'S', color: 'Negro', stock: 4, precio_adicional: 0, sku_variante: 'BOU-VES-003-S-BLK' },
      { id: 2032, talla: 'M', color: 'Rojo', stock: 2, precio_adicional: 10.00, sku_variante: 'BOU-VES-003-M-RED' }
    ]
  },
  {
    id: 204,
    nombre: 'Chaqueta Cuero Premium',
    precio: 85.00,
    codigo_barras: 'BOU-CHA-004',
    categoria: 'Unisex',
    Variantes: [
      { id: 2041, talla: 'M', color: 'Marron', stock: 5, precio_adicional: 0, sku_variante: 'BOU-CHA-004-M-BRN' },
      { id: 2042, talla: 'L', color: 'Negro', stock: 7, precio_adicional: 5.00, sku_variante: 'BOU-CHA-004-L-BLK' }
    ]
  },
  {
    id: 205,
    nombre: 'Zapatillas Urbanas',
    precio: 65.00,
    codigo_barras: 'BOU-ZAP-005',
    categoria: 'Calzado',
    Variantes: [
      { id: 2051, talla: '38', color: 'Blanco', stock: 9, precio_adicional: 0, sku_variante: 'BOU-ZAP-005-38-WHT' },
      { id: 2052, talla: '40', color: 'Blanco', stock: 12, precio_adicional: 0, sku_variante: 'BOU-ZAP-005-40-WHT' },
      { id: 2053, talla: '42', color: 'Negro', stock: 4, precio_adicional: 0, sku_variante: 'BOU-ZAP-005-42-BLK' }
    ]
  }
];

export default function ClothingPOSView() {
  const posContext = usePos() || {};
  const exchangeRate = posContext.exchangeRate || 650;
  const currencyMode = posContext.currencyMode || 'BOTH';
  const showDual = !isUsdOnlyMode({ currencyMode }) && (currencyMode === 'BOTH' || currencyMode === 'DUAL' || currencyMode === 'VES');

  const [products, setProducts] = useState(MOCK_BOUTIQUE_PRODUCTS);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [cart, setCart] = useState([]);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  
  const [heldSales, setHeldSales] = useState(() => {
      const local = localStorage.getItem('pos_held_sales');
      return local ? JSON.parse(local) : [];
  });
  const [isHeldModalOpen, setIsHeldModalOpen] = useState(false);

  useEffect(() => {
      localStorage.setItem('pos_held_sales', JSON.stringify(heldSales));
  }, [heldSales]);

  const [businessSettings, setBusinessSettings] = useState({});
  const [processing, setProcessing] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    api.get('/settings/business').then(r => setBusinessSettings(r.data)).catch(() => {});
  }, []);

  const showNotification = useCallback((msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await api.get('/products');
        const rawProducts = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.products) ? res.data.products : []);
        if (rawProducts.length > 0) {
          const formatted = rawProducts.map(p => ({
            ...p,
            nombre: p.nombre || p.name,
            precio: Number(p.precio || p.price || 0)
          }));
          setProducts(formatted);
          await localDb.products.bulkPut(formatted);
        }
      } catch (err) {
        console.warn('Modo offline o error al cargar productos:', err);
        const local = await localDb.products.toArray();
        if (local && local.length > 0) setProducts(local);
      }
    };
    fetchProducts();
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.categoria || 'General'));
    return ['Todos', ...Array.from(cats)];
  }, [products]);

  const fuzzyProducts = useFuzzySearch(products, search);

  const filteredProducts = useMemo(() => {
    let list = fuzzyProducts;
    if (selectedCategory !== 'Todos') {
      list = fuzzyProducts.filter(p => (p.categoria || p.category || 'General') === selectedCategory);
    }
    return [...list].sort((a, b) => {
      const hasVariantsA = Array.isArray(a.Variantes) && a.Variantes.length > 0;
      const stockA = hasVariantsA ? a.Variantes.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(a.stockQuantity || a.stock || 0);
      const hasVariantsB = Array.isArray(b.Variantes) && b.Variantes.length > 0;
      const stockB = hasVariantsB ? b.Variantes.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(b.stockQuantity || b.stock || 0);
      const outA = stockA <= 0 ? 1 : 0;
      const outB = stockB <= 0 ? 1 : 0;
      if (outA !== outB) return outA - outB;
      const nameA = String(a.nombre || a.name || '').trim();
      const nameB = String(b.nombre || b.name || '').trim();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base', numeric: true });
    });
  }, [fuzzyProducts, selectedCategory]);

  const handleProductClick = (product) => {
    setSelectedProductForVariant(product);
  };

  const handleAddToCart = (variantItem) => {
    setCart(prev => {
      const existingIdx = prev.findIndex(item => item.id === variantItem.id);
      if (existingIdx > -1) {
        const updated = [...prev];
        const newQty = updated[existingIdx].quantity + variantItem.quantity;
        if (newQty <= (variantItem.stock || 999)) {
          updated[existingIdx].quantity = newQty;
        } else {
          showNotification('Stock máximo de variante alcanzado', 'error');
        }
        return updated;
      }
      return [...prev, variantItem];
    });
    showNotification(`Añadido al carrito: ${variantItem.nombre}`, 'success');
  };

  const updateQuantity = (id, delta) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: Math.min(newQty, item.stock || 999) } : null;
      }
      return item;
    }).filter(Boolean));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const totalUSD = useMemo(() => cart.reduce((acc, item) => 
    precision.add([acc, precision.multiply(Number(item.precio), item.quantity)]), 0
  ), [cart]);
  const totalVES = useMemo(() => precision.multiply(totalUSD, exchangeRate), [totalUSD, exchangeRate]);

  const handleOpenCheckout = () => {
    if (cart.length === 0 || processing) return;
    setIsCheckoutOpen(true);
  };

  const handleConfirmSale = async (checkoutData) => {
    setProcessing(true);
    const txId = checkoutData?.clientTransactionId || `SALE-BOUTIQUE-${crypto.randomUUID()}`;
    const salePayload = {
      ...checkoutData,
      id: txId,
      clientTransactionId: txId,
      total: Number(checkoutData?.total ?? totalUSD),
      subtotal: Number(checkoutData?.subtotal ?? totalUSD),
      items: cart.map(item => ({
        id: item.producto_id || item.id,
        productId: item.producto_id || item.id,
        producto_id: item.producto_id || item.id,
        variante_id: item.variante_id,
        variantId: item.variante_id,
        nombre: item.nombre,
        name: item.nombre,
        precio: item.precio,
        price: item.precio,
        quantity: item.quantity
      }))
    };

    try {
      const response = await api.post('/sales', salePayload);
      const finalSale = response.data || salePayload;
      showNotification('¡Venta de Boutique registrada con éxito!', 'success');
      setLastSale(finalSale);
      setIsCheckoutOpen(false);
      setIsReceiptOpen(true);
      setCart([]);
    } catch (_err) {
      const isNetworkError = !_err.response || _err.code === 'ECONNABORTED' || _err.message?.includes('Network');
      if (isNetworkError) {
        console.warn('Guardando venta de boutique en cola offline Dexie...');
        try {
          await localDb.sales.add({
            ...salePayload,
            status: 'pending_sync',
            created_at: new Date().toISOString()
          });
          showNotification('Venta guardada localmente (Modo Offline)', 'success');
          setLastSale(salePayload);
          setIsCheckoutOpen(false);
          setIsReceiptOpen(true);
          setCart([]);
        } catch (_dbErr) {
          showNotification('Error al procesar la venta offline', 'error');
          throw _dbErr;
        }
      } else {
        const serverError = _err.response?.data?.error || _err.response?.data?.message || _err.message || 'Error al procesar la venta en servidor';
        console.error('[POS-BOUTIQUE] Error de validación en servidor:', serverError);
        showNotification(`Error en venta: ${serverError}`, 'error');
        throw _err;
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-full w-full flex-1 min-h-0 bg-slate-950 text-slate-800 dark:text-slate-100 overflow-hidden font-sans">
      {notification && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-2xl shadow-2xl font-black text-sm flex items-center gap-3 border animate-fade-in ${
          notification.type === 'error'
            ? 'bg-red-950/90 text-red-300 border-red-800'
            : 'bg-pink-950/90 text-pink-200 border-pink-800'
        }`}>
          <Shirt className="text-pink-400 shrink-0" size={18} />
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Left Column: Catalog Gallery */}
      <div className="flex-1 flex flex-col min-w-0 p-4 lg:p-6 overflow-hidden border-r border-slate-900">
        {/* Top Bar */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-600 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-600/20">
              <Shirt className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                BOUTIQUE & ROPA <span className="px-2 py-0.5 rounded-md bg-pink-500/20 text-pink-400 text-[10px] font-black uppercase">POS</span>
              </h1>
              <p className="text-xs text-slate-400 font-medium">Selección rápida por Tallas y Colores</p>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar prenda o código..."
              className="w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-800 rounded-2xl text-sm font-bold text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/50 transition-all"
            />
          </div>
        </div>

        {/* Categories Chips */}
        <div className="flex gap-2 overflow-x-auto pb-4 mb-2 shrink-0 scrollbar-none">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all border ${
                selectedCategory === cat
                  ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white border-pink-500 shadow-lg shadow-pink-600/20 scale-102'
                  : 'bg-slate-900/80 hover:bg-slate-900 text-slate-400 border-slate-800/80'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">
          {filteredProducts.map(product => {
            const variantCount = product?.Variantes?.length || product?.variants?.length || 6;
            return (
              <div
                key={product.id}
                onClick={() => handleProductClick(product)}
                className="group relative bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-pink-500/50 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-all duration-200 hover:shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-black text-[10px] uppercase tracking-wider">
                      {product.categoria || 'Moda'}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-bold text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded-full border border-pink-500/20">
                      <Tag size={12} /> {variantCount} vars
                    </span>
                  </div>
                  <h3 className="font-black text-base text-white group-hover:text-pink-300 transition-colors line-clamp-2 leading-snug">
                    {product.nombre}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mt-1">{product.codigo_barras}</p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-baseline justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">Precio Desde</span>
                    <div className="font-black text-xl text-emerald-400">
                      ${Number(product.precio).toFixed(2)}
                    </div>
                  </div>
                  {showDual && (
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase text-slate-500 block">Ref. Bs</span>
                      <div className="font-mono font-bold text-sm text-cyan-400">
                        {(Number(product.precio) * exchangeRate).toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Shopping Cart */}
      <div className="w-full lg:w-96 flex flex-col bg-slate-900/90 border-t lg:border-t-0 lg:border-l border-slate-900 shrink-0 p-6">
        <div className="flex items-center justify-between pb-6 border-b border-slate-800/80 mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <ShoppingBag className="text-pink-500" size={24} />
            <h2 className="text-lg font-black tracking-tight text-white uppercase">Bolsa de Compra</h2>
          </div>
          <span className="px-3 py-1 rounded-full bg-slate-800 text-xs font-black text-slate-300">
            {cart.reduce((a, b) => a + b.quantity, 0)} ítems
          </span>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 my-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-600">
              <Shirt size={48} className="mb-3 opacity-20" />
              <p className="font-bold text-sm text-slate-500">Bolsa vacía</p>
              <p className="text-xs mt-1">Haz clic en una prenda para seleccionar talla y color</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3 group">
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-sm text-white truncate">{item.nombre}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-black text-emerald-400 text-sm">${Number(item.precio).toFixed(2)}</span>
                    {showDual && (
                      <span className="font-mono text-xs text-cyan-400">Bs {(Number(item.precio) * exchangeRate).toFixed(2)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 rounded-lg hover:bg-slate-800 text-slate-300 font-bold flex items-center justify-center">-</button>
                    <span className="w-8 text-center font-black text-xs text-white">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 rounded-lg hover:bg-slate-800 text-slate-300 font-bold flex items-center justify-center">+</button>
                  </div>
                  <button onClick={() => removeFromCart(item.id)} className="p-2 text-slate-600 hover:text-red-400 transition-colors rounded-xl hover:bg-red-500/10">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-2">
            <POSActionButtons 
                cartItems={cart}
                setCartItems={setCart}
                heldSales={heldSales}
                setHeldSales={setHeldSales}
                setIsHeldModalOpen={setIsHeldModalOpen}
            />
        </div>

        {/* Totals & Pay */}
        <div className="pt-6 border-t border-slate-800/80 mt-2 shrink-0 space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Total a Pagar</span>
            <span className="text-3xl font-black text-emerald-400">${totalUSD.toFixed(2)}</span>
          </div>

          {showDual && (
            <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-800/30 flex items-center justify-between">
              <div>
                <span className="text-xs font-black uppercase text-cyan-400 tracking-widest block">Total Bs</span>
              </div>
              <span className="text-2xl font-mono font-black text-cyan-300">
                Bs {totalVES.toFixed(2)}
              </span>
            </div>
          )}

          <button
            onClick={handleOpenCheckout}
            disabled={cart.length === 0 || processing}
            className="w-full py-5 rounded-2xl font-black text-base uppercase tracking-wider transition-all flex items-center justify-center gap-3 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white shadow-xl shadow-pink-600/20 disabled:opacity-40 disabled:cursor-not-allowed active:scale-98"
          >
            <CreditCard size={20} />
            {processing ? 'Procesando...' : 'Facturar Venta'}
          </button>
        </div>
      </div>

      {/* Variant Selection Modal */}
      {selectedProductForVariant && (
        <VariantSelectionModal
          product={selectedProductForVariant}
          onClose={() => setSelectedProductForVariant(null)}
          onAddToCart={handleAddToCart}
          exchangeRate={exchangeRate}
          showDual={showDual}
        />
      )}

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirm={handleConfirmSale}
        total={totalUSD}
        subtotal={totalUSD}
        taxableBase={0}
        exemptBase={totalUSD}
        taxAmount={0}
        ivaRate={16}
        igtfRate={3}
        igtfEnabled={true}
        discountAmount={0}
        discountPercent={0}
        exchangeRate={exchangeRate}
        currencyMode={currencyMode}
        processing={processing}
        registerId={posContext.registerId || '1'}
        registerDisplayName={posContext.registerDisplayName || 'Caja Boutique'}
        businessSettings={businessSettings}
      />

      <HeldSalesModal 
          isOpen={isHeldModalOpen} 
          onClose={() => setIsHeldModalOpen(false)}
          heldSales={heldSales}
          exchangeRate={exchangeRate}
          currencyMode={currencyMode}
          formatMoney={(val) => `$${val.toFixed(2)}`}
          onResume={(held) => {
              setCart(held.items);
              setHeldSales(prev => prev.filter(h => h.id !== held.id));
              setIsHeldModalOpen(false);
          }}
          onRemove={(id) => setHeldSales(prev => prev.filter(h => h.id !== id))}
      />

      <ReceiptModal
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        sale={lastSale}
        businessSettings={businessSettings}
        exchangeRate={exchangeRate}
        currencyMode={currencyMode}
      />
    </div>
  );
}
