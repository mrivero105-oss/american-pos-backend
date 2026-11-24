import { useCallback } from 'react';
import api from '../../services/api';
import lanSyncService from '../../services/lanSyncService';
import { triggerHaptic } from '../../utils/haptics';
import { playSuccessSound } from '../../utils/sounds';
import { getTerminalId } from '../../utils/terminalIdentity';
import { normalizeMobileCartItems } from '../../store/useMobilePosStore';

/**
 * useMobileHeldSales
 * Hook modularizado para gestión de ventas en espera (PC + Móvil) y despacho de preventas a caja.
 */
export function useMobileHeldSales({
  cart,
  setCart,
  heldSales,
  setHeldSales,
  setIsHeldSalesModalOpen,
  setIsMobileCartOpen,
  setPreSaleSentModal,
  customerName,
  setCustomerName,
  customerDoc,
  setCustomerDoc,
  customerPhone,
  setCustomerPhone,
  selectedCustomer,
  setSelectedCustomer,
  selectedTable,
  setSelectedTable,
  orderNotes,
  setOrderNotes,
  totalUSD,
  totalBS,
  totalItemsCount,
  exchangeRate,
  isDollarCountry,
  user,
  socket,
  productsMap,
  showToast
}) {
  const persistHeldSales = useCallback((updated) => {
    setHeldSales(updated);
    try {
      localStorage.setItem('pos_held_sales', JSON.stringify(updated));
    } catch (caughtErr) {
      console.warn('[useMobileHeldSales] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr);
    }
  }, [setHeldSales]);

  const handleHoldSale = useCallback(() => {
    if (cart.length === 0) return;
    const newHeldSale = {
      id: `held_${Date.now()}`,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      items: [...cart],
      customerName,
      customerDoc,
      totalUSD,
      totalBS,
      itemCount: totalItemsCount
    };
    const updated = [newHeldSale, ...heldSales];
    persistHeldSales(updated);
    setCart([]);
    setIsMobileCartOpen(false);
    showToast(`⏸️ Venta pausada (${totalItemsCount} productos guardados en espera)`);
  }, [cart, customerName, customerDoc, totalUSD, totalBS, totalItemsCount, heldSales, persistHeldSales, setCart, setIsMobileCartOpen, showToast]);

  const handleSendPreSaleToMainRegister = useCallback(() => {
    if (cart.length === 0) {
      showToast('⚠️ El carrito de venta está vacío');
      return;
    }
    const preSaleCode = `PV-${Math.floor(100 + Math.random() * 900)}`;
    const activeCust = selectedCustomer || (customerName && customerName !== 'Consumidor Final' ? {
      id: selectedCustomer?.id || null,
      name: customerName,
      idDocument: customerDoc,
      doc: customerDoc,
      identification: customerDoc,
      phone: customerPhone
    } : null);

    const preSalePayload = {
      id: `presale_${Date.now()}`,
      code: preSaleCode,
      type: 'remote_preventa',
      source: 'Móvil',
      sellerName: user?.name || user?.username || 'Vendedor Móvil',
      terminalId: getTerminalId() || 'terminal_mobile',
      table: selectedTable || null,
      tableNumber: selectedTable || null,
      orderNotes: orderNotes ? orderNotes.trim() : '',
      note: selectedTable ? `🍽️ ${selectedTable}${orderNotes ? ` - ${orderNotes}` : ''}` : (orderNotes ? orderNotes.trim() : ''),
      customerId: activeCust?.id || null,
      customerName: activeCust?.name || customerName || 'Consumidor Final',
      customerDoc: activeCust?.idDocument || activeCust?.identification || customerDoc || '',
      customerPhone: activeCust?.phone || customerPhone || '',
      customer: activeCust,
      totalUSD,
      totalBS,
      exchangeRate,
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      itemCount: totalItemsCount,
      items: [...cart],
      companyId: user?.companyId || '1'
    };

    try {
      if (socket && socket.connected) {
        socket.emit('remote_held_sale', preSalePayload);
      }
      if (lanSyncService.socket && lanSyncService.socket.connected) {
        lanSyncService.socket.emit('remote_held_sale', preSalePayload);
      }
    } catch (caughtErr) {
      console.warn('[useMobileHeldSales] Error propagando evento de sincronización:', caughtErr?.message || caughtErr);
    }

    try {
      api.post('/sales/remote-held-sale', preSalePayload, { timeout: 3500 })
        .catch(err => console.warn('Aviso HTTP remote-held-sale:', err?.message || err));
    } catch (caughtErr) {
      console.warn('[useMobileHeldSales] Error en operación auxiliar:', caughtErr?.message || caughtErr);
    }

    const updated = [preSalePayload, ...heldSales];
    persistHeldSales(updated);

    setCart([]);
    setSelectedCustomer(null);
    setSelectedTable(null);
    setOrderNotes('');
    setCustomerName('Consumidor Final');
    setCustomerDoc(isDollarCountry ? '0000000000' : 'V-00000000');
    setCustomerPhone('');
    setIsMobileCartOpen(false);
    triggerHaptic(30);
    playSuccessSound();
    setPreSaleSentModal(preSalePayload);
  }, [
    cart, selectedCustomer, customerName, customerDoc, customerPhone, user,
    selectedTable, orderNotes, totalUSD, totalBS, exchangeRate, totalItemsCount,
    socket, heldSales, persistHeldSales, setCart, setSelectedCustomer,
    setSelectedTable, setOrderNotes, setCustomerName, setCustomerDoc,
    setCustomerPhone, isDollarCountry, setIsMobileCartOpen, setPreSaleSentModal, showToast
  ]);

  const handleRestoreHeldSale = useCallback((saleId, options = {}) => {
    const sale = heldSales.find(s => s.id === saleId);
    if (!sale) return;

    let updatedHeld = heldSales.filter(s => s.id !== saleId);

    if (cart.length > 0 && options.swapCurrent) {
      const currentSnapshot = {
        id: `held_${Date.now()}`,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: [...cart],
        customerName: customerName || 'Consumidor Final',
        customerDoc: customerDoc || '',
        customer: selectedCustomer || null,
        customerId: selectedCustomer?.id || null,
        totalUSD,
        totalBS,
        itemCount: cart.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0)
      };
      updatedHeld = [currentSnapshot, ...updatedHeld];
    }

    const normalizedRestoredItems = normalizeMobileCartItems(sale.items, productsMap);
    setCart(normalizedRestoredItems);
    if (sale.customerName) setCustomerName(sale.customerName);
    if (sale.customerDoc) setCustomerDoc(sale.customerDoc);
    if (sale.customer) {
      setSelectedCustomer(sale.customer);
    } else if (sale.customerName && sale.customerName !== 'Consumidor Final') {
      setSelectedCustomer({
        id: sale.customerId || null,
        name: sale.customerName,
        idDocument: sale.customerDoc || '',
        doc: sale.customerDoc || ''
      });
    } else {
      setSelectedCustomer(null);
    }

    persistHeldSales(updatedHeld);
    setIsHeldSalesModalOpen(false);
    setIsMobileCartOpen(true);
    triggerHaptic(20);
    showToast(`▶️ Venta reanudada (${sale.items?.length || sale.itemCount || 0} ítems en carrito)`);
  }, [
    heldSales, cart, customerName, customerDoc, selectedCustomer, totalUSD, totalBS,
    productsMap, setCart, setCustomerName, setCustomerDoc, setSelectedCustomer,
    persistHeldSales, setIsHeldSalesModalOpen, setIsMobileCartOpen, showToast
  ]);

  const handleDeleteHeldSale = useCallback((saleId) => {
    const updated = heldSales.filter(s => s.id !== saleId);
    persistHeldSales(updated);
    showToast('Venta en espera eliminada');
  }, [heldSales, persistHeldSales, showToast]);

  return {
    handleHoldSale,
    handleSendPreSaleToMainRegister,
    handleRestoreHeldSale,
    handleDeleteHeldSale
  };
}
