import { useCallback } from 'react';
import api from '../../services/api';
import { db as primaryDb } from '../../services/db';
import lanSyncService from '../../services/lanSyncService';
import { triggerHaptic } from '../../utils/haptics';
import { playSuccessSound } from '../../utils/sounds';
import { getTerminalId } from '../../utils/terminalIdentity';
import { normalizeMobileCartItems } from '../../store/useMobilePosStore';

/**
 * useMobileHeldSales
 * Hook modularizado para gestión de ventas en espera (PC + Móvil) y despacho de preventas a caja.
 * Usa persistencia unificada vía store (sin doble escritura síncrona en localStorage) y encola preventas offline.
 */
export function useMobileHeldSales({
  cart,
  setCart,
  setCartDiscountPercent,
  setDiscountSupervisorApprovalId,
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
  }, [setHeldSales]);

  const handleHoldSale = useCallback(() => {
    if (cart.length === 0) return;
    const newHeldSale = {
      id: `held_${Date.now()}`,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      items: [...cart],
      customerName,
      customerDoc,
      customerPhone,
      customer: selectedCustomer || null,
      customerId: selectedCustomer?.id || null,
      totalUSD,
      totalBS,
      itemCount: totalItemsCount
    };
    const updated = [newHeldSale, ...heldSales];
    persistHeldSales(updated);
    setCart([]);
    if (typeof setCartDiscountPercent === 'function') setCartDiscountPercent(0);
    if (typeof setDiscountSupervisorApprovalId === 'function') setDiscountSupervisorApprovalId(null);
    setIsMobileCartOpen(false);
    showToast(`⏸️ Venta pausada (${totalItemsCount} productos guardados en espera)`);
  }, [
    cart, customerName, customerDoc, customerPhone, selectedCustomer,
    totalUSD, totalBS, totalItemsCount, heldSales, persistHeldSales,
    setCart, setCartDiscountPercent, setDiscountSupervisorApprovalId,
    setIsMobileCartOpen, showToast
  ]);

  const handleSendPreSaleToMainRegister = useCallback(async () => {
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

    const sellerDisplayName = user?.name || user?.username || 'Vendedor Móvil';
    const composedNotes = selectedTable
      ? `🍽️ ${selectedTable}${orderNotes ? ` - ${orderNotes.trim()}` : ''}`
      : (orderNotes ? orderNotes.trim() : '');

    const preSalePayload = {
      id: `presale_${Date.now()}`,
      code: preSaleCode,
      type: 'remote_preventa',
      source: 'Móvil',
      sellerName: sellerDisplayName,
      waiterName: sellerDisplayName,
      userName: sellerDisplayName,
      terminalId: getTerminalId() || 'terminal_mobile',
      table: selectedTable || null,
      tableNumber: selectedTable || null,
      orderNotes: orderNotes ? orderNotes.trim() : '',
      notes: composedNotes,
      note: composedNotes,
      customerId: activeCust?.id || null,
      customerName: activeCust?.name || customerName || 'Consumidor Final',
      customerDoc: activeCust?.idDocument || activeCust?.identification || customerDoc || '',
      customerPhone: activeCust?.phone || customerPhone || '',
      customer: activeCust,
      totalUSD,
      totalBS,
      totalVES: totalBS,
      exchangeRate,
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      itemCount: totalItemsCount,
      items: [...cart],
      companyId: user?.companyId || '2'
    };

    // 1. Envío REST autoritativo + broadcast único por socket (sin duplicar en dos sockets)
    let deliveredOnline = false;
    try {
      await api.post('/sales/remote-held-sale', preSalePayload, { timeout: 3500 });
      deliveredOnline = true;
    } catch (err) {
      const httpStatus = err?.response?.status;
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.error || 'Preventa rechazada por la caja principal';
        showToast(`⚠️ ${msg}`);
        return;
      }
      // Fallback: intentar por socket si está vivo y encolar en syncQueue para entrega garantizada
      try {
        const activeSocket = (lanSyncService.socket && lanSyncService.socket.connected)
          ? lanSyncService.socket
          : ((socket && socket.connected) ? socket : null);
        if (activeSocket) {
          activeSocket.emit('remote_held_sale', preSalePayload);
        }
      } catch (sockErr) {
        console.warn('[useMobileHeldSales] Error propagando preventa por socket:', sockErr?.message || sockErr);
      }
      try {
        await primaryDb.put('syncQueue', {
          id: `presale_sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tempLocalId: preSalePayload.id,
          endpoint: '/sales/remote-held-sale',
          method: 'POST',
          payload: preSalePayload,
          createdAt: new Date().toISOString()
        });
      } catch (queueErr) {
        console.warn('[useMobileHeldSales] Error encolando preventa offline:', queueErr?.message || queueErr);
      }
    }

    const enrichedPreSale = {
      ...preSalePayload,
      isOfflinePending: !deliveredOnline
    };

    const updated = [enrichedPreSale, ...heldSales];
    persistHeldSales(updated);

    setCart([]);
    if (typeof setCartDiscountPercent === 'function') setCartDiscountPercent(0);
    if (typeof setDiscountSupervisorApprovalId === 'function') setDiscountSupervisorApprovalId(null);
    setSelectedCustomer(null);
    setSelectedTable(null);
    setOrderNotes('');
    setCustomerName('Consumidor Final');
    setCustomerDoc(isDollarCountry ? '0000000000' : 'V-00000000');
    setCustomerPhone('');
    setIsMobileCartOpen(false);
    triggerHaptic(30);
    playSuccessSound();

    if (!deliveredOnline) {
      showToast(`⚡ Preventa ${preSaleCode} encolada offline. Se enviará a caja al reconectar.`);
    }
    setPreSaleSentModal(enrichedPreSale);
  }, [
    cart, selectedCustomer, customerName, customerDoc, customerPhone, user,
    selectedTable, orderNotes, totalUSD, totalBS, exchangeRate, totalItemsCount,
    socket, heldSales, persistHeldSales, setCart, setCartDiscountPercent,
    setDiscountSupervisorApprovalId, setSelectedCustomer,
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
        customerPhone: customerPhone || '',
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
    if (sale.customerPhone) setCustomerPhone(sale.customerPhone);
    if (sale.customer) {
      setSelectedCustomer(sale.customer);
    } else if (sale.customerName && sale.customerName !== 'Consumidor Final') {
      setSelectedCustomer({
        id: sale.customerId || null,
        name: sale.customerName,
        idDocument: sale.customerDoc || '',
        doc: sale.customerDoc || '',
        phone: sale.customerPhone || ''
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
    heldSales, cart, customerName, customerDoc, customerPhone, selectedCustomer, totalUSD, totalBS,
    productsMap, setCart, setCustomerName, setCustomerDoc, setCustomerPhone, setSelectedCustomer,
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
