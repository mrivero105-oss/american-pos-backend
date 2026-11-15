import { useState, useCallback, useEffect } from 'react';
import ProductSearch from '../components/ProductSearch';
import ControlledMedsModal from '../components/ControlledMedsModal';
import CheckoutModal from '../components/CheckoutModal';
import ReceiptModal from '../components/ReceiptModal';
import EquivalentsModal from '../components/pharmacy/EquivalentsModal';
import ControlledMedsBookModal from '../components/pharmacy/ControlledMedsBookModal';
import { processOfflineFEFO } from '../utils/fefoOffline';
import { usePos } from '../hooks/PosContext';
import api from '../services/api';
import VortexMathEngine from '../utils/VortexMathEngine';
import POSActionButtons from '../components/common/POSActionButtons';
import HeldSalesModal from '../components/HeldSalesModal';
import { isUsdOnlyMode } from '../utils/format';
import { BookOpen, ShoppingCart } from 'lucide-react';

export default function PharmacyPOSView() {
  const posContext = usePos() || {};
  const exchangeRate = posContext.exchangeRate || 650;
  const currencyMode = posContext.currencyMode || 'BOTH';
  const showDual = !isUsdOnlyMode({ currencyMode }) && (currencyMode === 'BOTH' || currencyMode === 'DUAL' || currencyMode === 'VES');

  const [cartItems, setCartItems] = useState([]);
  const [pendingProduct, setPendingProduct] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [isEquivalentsOpen, setIsEquivalentsOpen] = useState(false);
  const [selectedForEquivalents, setSelectedForEquivalents] = useState(null);
  const [isBookOpen, setIsBookOpen] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [businessSettings, setBusinessSettings] = useState({});
  const [processing, setProcessing] = useState(false);
  const [notification, setNotification] = useState(null);
  const [localHeldSales, setLocalHeldSales] = useState(() => {
      const local = localStorage.getItem('pos_held_sales');
      return local ? JSON.parse(local) : [];
  });
  const heldSales = posContext.heldSales ?? localHeldSales;
  const setHeldSales = posContext.setHeldSales ?? setLocalHeldSales;
  const [isHeldModalOpen, setIsHeldModalOpen] = useState(false);

  useEffect(() => {
      if (!posContext.setHeldSales) {
          localStorage.setItem('pos_held_sales', JSON.stringify(localHeldSales));
      }
  }, [localHeldSales, posContext.setHeldSales]);

  useEffect(() => {
    api.get('/settings/business').then(r => setBusinessSettings(r.data)).catch(() => {});
  }, []);

  const playSanitaryBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (_e) {}
  }, []);

  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const addToCart = useCallback((product, recipeData = null) => {
    setCartItems((prevItems) => {
      const existingIndex = prevItems.findIndex((item) => item.id === product.id);
      if (existingIndex > -1) {
        const updatedItems = [...prevItems];
        const updatedQuantity = updatedItems[existingIndex].quantity + 1;
        
        if (updatedQuantity > product.stock_total) {
          playSanitaryBeep();
          showNotification(`Stock máximo alcanzado para "${product.nombre}"`, 'error');
          return prevItems;
        }

        updatedItems[existingIndex] = {
          ...updatedItems[existingIndex],
          quantity: updatedQuantity,
          recipe: recipeData || updatedItems[existingIndex].recipe
        };
        return updatedItems;
      } else {
        if (product.stock_total < 1) {
          playSanitaryBeep();
          showNotification(`El producto "${product.nombre}" se encuentra agotado`, 'error');
          return prevItems;
        }

        return [
          ...prevItems,
          {
            ...product,
            quantity: 1,
            recipe: recipeData || null
          }
        ];
      }
    });
  }, [showNotification, playSanitaryBeep]);

  const handleSelectProduct = useCallback((product) => {
    // SEMÁFORO SANITARIO: Bloqueo de facturación para lotes vencidos
    if (product.expirationDate && product.expirationDate !== 'N/A') {
      const exp = new Date(product.expirationDate);
      const today = new Date();
      today.setHours(0,0,0,0);
      if (!isNaN(exp.getTime()) && exp <= today) {
        playSanitaryBeep();
        showNotification(`⛔ ALERTA SANITARIA: "${product.nombre || product.name}" está VENCIDO (${product.expirationDate}). Prohibida su venta.`, 'error');
        return;
      }
    }

    if (product.es_controlado) {
      setPendingProduct(product);
      setIsModalOpen(true);
    } else {
      addToCart(product);
    }
  }, [addToCart, showNotification, playSanitaryBeep]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      const isEditable = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
      if (isEditable && e.key !== 'F4' && e.key !== 'F9') return;

      if (e.key === 'F4' && cartItems.length > 0) {
        e.preventDefault();
        setSelectedForEquivalents(cartItems[0]);
        setIsEquivalentsOpen(true);
      } else if (e.key === 'F9' && cartItems.length > 0 && !isCheckoutOpen && !isModalOpen) {
        e.preventDefault();
        const controlledWithMissingRecipe = cartItems.find(item => item.es_controlado && !item.recipe);
        if (controlledWithMissingRecipe) {
          playSanitaryBeep();
          showNotification(`Inconsistencia: "${controlledWithMissingRecipe.nombre}" no posee récipe asignado.`, 'error');
          return;
        }
        setIsCheckoutOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cartItems, isCheckoutOpen, isModalOpen, showNotification, playSanitaryBeep]);

  const handleControlledModalConfirm = useCallback((recipeData) => {
    if (pendingProduct) {
      addToCart(pendingProduct, recipeData);
      setPendingProduct(null);
      setIsModalOpen(false);
      showNotification(`Producto controlado autorizado y añadido`, 'success');
    }
  }, [pendingProduct, addToCart, showNotification]);

  const handleModalClose = useCallback(() => {
    setPendingProduct(null);
    setIsModalOpen(false);
  }, []);

  const updateQuantity = useCallback((productId, delta) => {
    setCartItems((prevItems) =>
      prevItems
        .map((item) => {
          if (item.id === productId) {
            const newQty = item.quantity + delta;
            if (newQty > item.stock_total) {
              showNotification(`Stock disponible superado (${item.stock_total})`, 'error');
              return item;
            }
            return { ...item, quantity: newQty };
          }
          return item;
        })
        .filter((item) => item.quantity > 0)
    );
  }, [showNotification]);

  const removeItem = useCallback((productId) => {
    setCartItems((prevItems) => prevItems.filter((item) => item.id !== productId));
  }, []);

  const calculateTotal = useCallback(() => {
    return cartItems.reduce((acc, item) => 
      VortexMathEngine.add(acc, VortexMathEngine.multiply(Number(item.precio), item.quantity)), 0
    );
  }, [cartItems]);

  const handleOpenCheckout = () => {
    if (cartItems.length === 0 || processing) return;
    const controlledWithMissingRecipe = cartItems.find(
      (item) => item.es_controlado && !item.recipe
    );
    if (controlledWithMissingRecipe) {
      showNotification(`Inconsistencia: "${controlledWithMissingRecipe.nombre}" no posee récipe asignado.`, 'error');
      return;
    }
    setIsCheckoutOpen(true);
  };

  const handleConfirmSale = async (checkoutData) => {
    setProcessing(true);
    try {
      const globalRecipe = cartItems.find((item) => item.recipe)?.recipe || null;
      const totalUSD = calculateTotal();
      const txId = checkoutData?.clientTransactionId || `SALE-PHARM-${crypto.randomUUID()}`;

      const salePayload = {
        ...checkoutData,
        id: txId,
        clientTransactionId: txId,
        total: Number(checkoutData?.total ?? totalUSD),
        subtotal: Number(checkoutData?.subtotal ?? totalUSD),
        items: cartItems.map(item => ({
          id: String(item.id),
          productId: String(item.id),
          name: item.nombre || item.name,
          quantity: Number(item.quantity),
          price: Number(item.precio || item.price),
          es_controlado: item.es_controlado || false,
          recipe: item.recipe || globalRecipe || null 
        }))
      };

      try {
        const response = await api.post('/sales', salePayload);
        const finalSale = response.data || salePayload;
        showNotification(`¡Venta farmacéutica registrada con éxito! (Ticket #${finalSale.id || 'OK'})`, 'success');
        setLastSale(finalSale);
        setIsCheckoutOpen(false);
        setIsReceiptOpen(true);
        setCartItems([]);
      } catch (_netErr) {
        const isNetworkError = !_netErr.response || _netErr.code === 'ECONNABORTED' || _netErr.message?.includes('Network');
        if (isNetworkError) {
          console.warn('Backend no disponible en POS Farmacia. Guardando offline en Dexie...');
          const result = await processOfflineFEFO(cartItems, globalRecipe);
          if (result.success) {
            showNotification(`Venta registrada localmente (OFF-ID: ${result.sale.id})`, 'success');
            setLastSale(result.sale || salePayload);
            setIsCheckoutOpen(false);
            setIsReceiptOpen(true);
            setCartItems([]);
          } else {
            showNotification(`Error offline: ${result.error}`, 'error');
            throw new Error(result.error || 'Error offline');
          }
        } else {
          const serverError = _netErr.response?.data?.error || _netErr.response?.data?.message || _netErr.message || 'Error al procesar la venta en servidor';
          console.error('[POS-FARMACIA] Error de validación en servidor:', serverError);
          showNotification(`Error en venta: ${serverError}`, 'error');
          throw _netErr;
        }
      }
    } catch (error) {
      showNotification(error?.response?.data?.error || error.message || 'Error al procesar la venta en POS Farmacéutico', 'error');
      throw error;
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-full w-full flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto lg:overflow-hidden">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-2xl shadow-2xl font-bold text-sm border animate-in fade-in slide-in-from-top-3 ${
          notification.type === 'error'
            ? 'bg-red-600 text-white border-red-500'
            : 'bg-emerald-600 text-white border-emerald-500'
        }`}>
          {notification.message}
        </div>
      )}

      <div className="flex-1 flex flex-col p-3 sm:p-6 overflow-visible lg:overflow-hidden">
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Punto de Venta Farmacéutico
            </h1>
            <button
              onClick={() => setIsBookOpen(true)}
              className="h-9 px-3.5 bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-500 dark:text-rose-400 font-semibold text-xs tracking-wider rounded-lg border border-rose-500/30 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <BookOpen size={14} />
              <span>Libro Psicotrópicos</span>
            </button>
          </div>
          <ProductSearch onSelectProduct={handleSelectProduct} />
        </div>

        <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-4 sm:p-6 overflow-y-auto min-h-[300px]">
          <h2 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-4 tracking-wider">
            Detalle de Artículos ({cartItems.reduce((acc, i) => acc + i.quantity, 0)})
          </h2>

          {cartItems.length === 0 ? (
            <div className="h-48 sm:h-64 flex flex-col items-center justify-center text-slate-400">
              <ShoppingCart size={32} className="mb-2 text-slate-300 dark:text-slate-600" />
              <p className="font-medium text-sm text-slate-500 dark:text-slate-400">El carrito se encuentra vacío</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {cartItems.map((item) => (
                <div key={item.id} className="py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0 pr-0 sm:pr-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-slate-900 dark:text-white truncate">
                        {item.nombre}
                      </span>
                      {item.es_controlado && (
                        <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 rounded border border-purple-300 dark:border-purple-800">
                          Controlado
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {item.codigo_barras || 'S/C'} | Precio Unitario: ${Number(item.precio).toFixed(2)}
                    </div>
                    {item.recipe && (
                      <div className="mt-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1 rounded-lg inline-block border border-purple-200 dark:border-purple-800/60">
                        📄 Récipe: Paciente {item.recipe.cedula_paciente} | Col. {item.recipe.nro_colegiatura}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0">
                    <button
                      onClick={() => {
                        setSelectedForEquivalents(item);
                        setIsEquivalentsOpen(true);
                      }}
                      className="px-2.5 sm:px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-cyan-500 hover:text-white text-cyan-600 dark:text-cyan-400 rounded-xl text-xs font-black transition-all border border-slate-200 dark:border-slate-700"
                    >
                      🧪 Equivalentes
                    </button>
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-7 sm:w-8 h-7 sm:h-8 flex items-center justify-center font-black text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        -
                      </button>
                      <span className="w-8 sm:w-10 text-center font-black text-sm text-slate-900 dark:text-white">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-7 sm:w-8 h-7 sm:h-8 flex items-center justify-center font-black text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        +
                      </button>
                    </div>

                    <div className="w-24 sm:w-28 text-right shrink-0">
                      <div className="font-black text-base sm:text-lg text-emerald-600 dark:text-emerald-400">
                        ${(Number(item.precio) * item.quantity).toFixed(2)}
                      </div>
                      {showDual && (
                        <div className="text-[11px] sm:text-xs font-bold text-cyan-600 dark:text-cyan-400 font-mono">
                          Bs {(Number(item.precio) * item.quantity * exchangeRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1.5 sm:p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-full lg:w-96 bg-white dark:bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 p-4 sm:p-6 pb-28 lg:pb-6 flex flex-col justify-between shrink-0">
        <div>
          <h2 className="text-lg font-black uppercase text-slate-900 dark:text-white mb-6 tracking-tight">
            Resumen de Facturación
          </h2>

          <POSActionButtons 
              cartItems={cartItems}
              setCartItems={setCartItems}
              heldSales={heldSales}
              setHeldSales={setHeldSales}
              setIsHeldModalOpen={setIsHeldModalOpen}
          />

          <div className="space-y-3 text-sm font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-6">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-bold text-slate-900 dark:text-white">${calculateTotal().toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Descuentos</span>
              <span className="font-bold text-slate-900 dark:text-white">$0.00</span>
            </div>
            <div className="flex justify-between">
              <span>Impuestos / Exento</span>
              <span className="font-bold text-slate-900 dark:text-white">$0.00</span>
            </div>
          </div>

          <div className="py-6 flex flex-col gap-2 border-b border-slate-100 dark:border-slate-800 mb-4">
            <div className="flex justify-between items-baseline">
              <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Total USD</span>
              <span className="text-4xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                ${calculateTotal().toFixed(2)}
              </span>
            </div>
            {showDual && (
              <div className="flex justify-between items-baseline bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <span className="text-xs font-black uppercase text-cyan-600 dark:text-cyan-400 tracking-wider">Total Bs</span>
                <span className="text-2xl font-black text-cyan-600 dark:text-cyan-400 font-mono">
                  Bs {(calculateTotal() * exchangeRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleOpenCheckout}
          disabled={cartItems.length === 0 || processing}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 disabled:pointer-events-none text-white font-bold rounded-xl shadow-xs uppercase tracking-wider text-sm transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
        >
          {processing ? 'Procesando Venta...' : 'Despachar Venta (FEFO)'}
        </button>
      </div>

      <HeldSalesModal 
          isOpen={isHeldModalOpen} 
          onClose={() => setIsHeldModalOpen(false)}
          heldSales={heldSales}
          exchangeRate={exchangeRate}
          currencyMode={currencyMode}
          formatMoney={(val) => `$${val.toFixed(2)}`}
          onResume={(held) => {
              setCartItems(held.items);
              setHeldSales(prev => prev.filter(h => h.id !== held.id));
              setIsHeldModalOpen(false);
          }}
          onRemove={(id) => setHeldSales(prev => prev.filter(h => h.id !== id))}
      />

      <ControlledMedsModal
        isOpen={isModalOpen}
        product={pendingProduct}
        onClose={handleModalClose}
        onConfirm={handleControlledModalConfirm}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        onConfirm={handleConfirmSale}
        total={calculateTotal()}
        subtotal={calculateTotal()}
        taxableBase={0}
        exemptBase={calculateTotal()}
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
        registerDisplayName={posContext.registerDisplayName || 'Caja Farmacia'}
        businessSettings={businessSettings}
      />

      <ReceiptModal
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        sale={lastSale}
        businessSettings={businessSettings}
        exchangeRate={exchangeRate}
        currencyMode={currencyMode}
      />

      <EquivalentsModal
        isOpen={isEquivalentsOpen}
        onClose={() => setIsEquivalentsOpen(false)}
        product={selectedForEquivalents}
        onSelectSubstitute={(sub) => handleSelectProduct(sub)}
      />

      <ControlledMedsBookModal
        isOpen={isBookOpen}
        onClose={() => setIsBookOpen(false)}
      />
    </div>
  );
}
