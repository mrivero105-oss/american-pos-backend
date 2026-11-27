import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, 
  FileText, 
  Search, 
  RefreshCw, 
  Share2, 
  Receipt, 
  CheckCircle, 
  Clock, 
  X, 
  Printer, 
  Eye, 
  RotateCcw, 
  Calendar, 
  Package, 
  ShieldAlert, 
  SlidersHorizontal, 
  ChevronDown, 
  ChevronUp, 
  Percent, 
  Handshake, 
  Utensils, 
  Send
} from 'lucide-react';
import api from '../../services/api';
import localDb from '../../db/localDb';
import { db as primaryDb } from '../../services/db';
import mobilePrinterService from '../../services/mobilePrinterService';
import SupervisorAuthModal from './SupervisorAuthModal';
import { VoiceMicButton } from '../../utils/voiceSearch';

export default function MobileSalesView({
  sales = [],
  pendingSalesCount = 0,
  isSyncing = false,
  onSyncNow,
  onRefresh,
  onShareWhatsApp,
  onPrintTicket,
  onSaleCancelled,
  user,
  showToast,
  T,
  isLight,
  exchangeRate = 950,
  onBackToPOS
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'synced' | 'offline' | 'cancelled'
  const [methodFilter, setMethodFilter] = useState('all'); // 'all' | 'Efectivo' | 'Pago Móvil' | 'Zelle' | 'Tarjeta' | 'Crédito' | 'Mixto'
  const [dateFilter, setDateFilter] = useState('today'); // 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isCustomDateModalOpen, setIsCustomDateModalOpen] = useState(false);
  
  const [showFinancialBreakdown, setShowFinancialBreakdown] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // Modales de detalle y anulación
  const [selectedSaleDetail, setSelectedSaleDetail] = useState(null);
  const [saleToCancel, setSaleToCancel] = useState(null);
  const [cancelReason, setCancelReason] = useState('Error de cobro / digitación');
  const [cancelNotes, setCancelNotes] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSupervisorAuthOpen, setIsSupervisorAuthOpen] = useState(false);

  // Rol del usuario para funciones ejecutivas
  const userRole = (user?.role || '').toLowerCase();
  const isAdminOrSupervisor = ['admin', 'superadmin', 'supervisor', 'owner'].includes(userRole);

  // Métodos para chips de filtro
  const paymentMethodsList = ['Todos', 'Efectivo', 'Pago Móvil', 'Tarjeta', 'Zelle', 'Crédito', 'Mixto'];

  // Razones predefinidas de anulación
  const cancelReasonsList = [
    'Error de cobro / digitación',
    'Cliente devolvió la compra',
    'Cancelación por cambio de método de pago',
    'Producto defectuoso / devuelto',
    'Otro motivo'
  ];

  // Formateador amigable de método de pago
  const formatPaymentMethodLabel = useCallback((m, isCredit = false) => {
    if (isCredit) return 'Crédito (Fiado)';
    if (!m) return 'Efectivo';
    const low = String(m).toLowerCase();
    if (low.includes('fiado') || low.includes('credito') || low.includes('credit')) return 'Crédito (Fiado)';
    if (low.includes('pago_movil') || low.includes('movil') || low.includes('pm')) return 'Pago Móvil';
    if (low.includes('debit') || low.includes('debito')) return 'Tarjeta Débito';
    if (low.includes('credit_card') || low.includes('credito_banco')) return 'Tarjeta Crédito';
    if (low.includes('tarjeta') || low.includes('card') || low.includes('punto')) return 'Punto de Venta';
    if (low.includes('zelle')) return 'Zelle';
    if (low.includes('binance')) return 'Binance Pay';
    if (low.includes('cash_bs')) return 'Efectivo Bs';
    if (low.includes('cash_usd') || low.includes('cash') || low.includes('efectivo')) return 'Efectivo USD';
    if (low.includes('transfer') || low.includes('transf')) return 'Transferencia';
    if (low.includes('mixed') || low.includes('mixto') || low.includes('multiple')) return 'Pago Mixto';
    return m;
  }, []);

  // Formateador de fecha/hora de venta
  const formatDateLabel = useCallback((dateStr) => {
    if (!dateStr || dateStr === 'Hoy') return 'Hoy';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const yesterday = new Date(now.getTime() - 86400000);
        const isYesterday = d.toDateString() === yesterday.toDateString();
        
        const timePart = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
        if (isToday) return `Hoy, ${timePart}`;
        if (isYesterday) return `Ayer, ${timePart}`;

        return `${d.getDate()}/${d.getMonth() + 1}, ${timePart}`;
      }
    } catch { /* Timestamp inválido, manteniendo cadena vacía */ }
    return String(dateStr);
  }, []);

  // Filtrar ventas por fecha, estado, método y búsqueda
  const filteredSales = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    return sales.filter(s => {
      const saleDate = new Date(s.date || s.created_at || s.timestamp || 0);
      const isDateValid = !isNaN(saleDate.getTime());

      // 0. Filtro temporal
      if (dateFilter !== 'all' && isDateValid) {
        if (dateFilter === 'today') {
          if (saleDate < startOfToday || saleDate > endOfToday) return false;
        } else if (dateFilter === 'yesterday') {
          const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
          const endOfYesterday = new Date(endOfToday.getTime() - 86400000);
          if (saleDate < startOfYesterday || saleDate > endOfYesterday) return false;
        } else if (dateFilter === 'week') {
          const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);
          if (saleDate < startOfWeek || saleDate > endOfToday) return false;
        } else if (dateFilter === 'month') {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
          if (saleDate < startOfMonth || saleDate > endOfToday) return false;
        } else if (dateFilter === 'custom') {
          if (customStartDate) {
            const start = new Date(`${customStartDate}T00:00:00`);
            if (saleDate < start) return false;
          }
          if (customEndDate) {
            const end = new Date(`${customEndDate}T23:59:59.999`);
            if (saleDate > end) return false;
          }
        }
      }

      // 1. Filtro de estado
      const isOffline = s.status === 'pending_sync' || s.isOffline;
      const isCancelled = s.status === 'refunded' || s.status === 'cancelled';
      const isSynced = !isOffline && !isCancelled;

      if (statusFilter === 'synced' && !isSynced) return false;
      if (statusFilter === 'offline' && !isOffline) return false;
      if (statusFilter === 'cancelled' && !isCancelled) return false;

      // 2. Filtro de método de pago
      const currentMethod = (s.method || s.paymentMethod || '').toLowerCase();
      const isCredit = Boolean(
        s.isCredit || 
        s.credit || 
        currentMethod.includes('fiado') || 
        currentMethod.includes('credito') || 
        currentMethod.includes('credit')
      );

      if (methodFilter !== 'all') {
        if (methodFilter === 'Crédito') {
          if (!isCredit) return false;
        } else if (methodFilter === 'Efectivo') {
          if (isCredit || (!currentMethod.includes('efectivo') && !currentMethod.includes('cash'))) return false;
        } else if (methodFilter === 'Pago Móvil') {
          if (!currentMethod.includes('pago_movil') && !currentMethod.includes('movil') && !currentMethod.includes('pm')) return false;
        } else if (methodFilter === 'Tarjeta') {
          if (!currentMethod.includes('tarjeta') && !currentMethod.includes('debit') && !currentMethod.includes('card') && !currentMethod.includes('punto')) return false;
        } else if (methodFilter === 'Zelle') {
          if (!currentMethod.includes('zelle')) return false;
        } else if (methodFilter === 'Mixto') {
          if (!currentMethod.includes('mixto') && !currentMethod.includes('split') && !currentMethod.includes('multiple')) return false;
        } else {
          if (!currentMethod.includes(methodFilter.toLowerCase())) return false;
        }
      }

      // 3. Filtro de búsqueda
      if (q) {
        const inv = (s.invoiceNumber || s.id || '').toLowerCase();
        const cli = (s.customerName || '').toLowerCase();
        const doc = (s.customerDoc || '').toLowerCase();
        const cashier = (s.cashierName || s.userName || '').toLowerCase();
        const notes = (s.notes || '').toLowerCase();
        const table = (s.table || s.mesa || '').toLowerCase();
        return inv.includes(q) || cli.includes(q) || doc.includes(q) || cashier.includes(q) || notes.includes(q) || table.includes(q);
      }

      return true;
    });
  }, [sales, searchQuery, statusFilter, methodFilter, dateFilter, customStartDate, customEndDate]);

  const [displayLimit, setDisplayLimit] = useState(30);

  useEffect(() => {
    setDisplayLimit(30);
  }, [searchQuery, statusFilter, methodFilter, dateFilter]);

  const visibleSales = useMemo(() => {
    return filteredSales.slice(0, displayLimit);
  }, [filteredSales, displayLimit]);

  // Totales y desglose financiero de alto nivel
  const totals = useMemo(() => {
    let usd = 0;
    let bs = 0;
    let cashCount = 0;
    let creditCount = 0;
    let creditUsd = 0;
    let creditBs = 0;

    let cashUsd = 0;
    let cashBs = 0;
    let pagoMovilBs = 0;
    let cardBs = 0;
    let zelleUsd = 0;
    let mixedUsd = 0;

    let cancelledCount = 0;
    let cancelledUsd = 0;
    let validCount = 0;
    let totalItemsSold = 0;
    let estimatedCostUsd = 0;

    filteredSales.forEach(s => {
      const isCancelled = s.status === 'refunded' || s.status === 'cancelled';
      const sUsd = Number(s.total || s.totalUSD || 0);
      const sRate = Number(s.exchangeRate || exchangeRate) || exchangeRate;
      const sBs = Number(s.totalBS || (sUsd * sRate));
      const method = (s.method || s.paymentMethod || '').toLowerCase();
      const isCredit = Boolean(
        s.isCredit || 
        s.credit || 
        method.includes('fiado') || 
        method.includes('credito') || 
        method.includes('credit')
      );

      if (isCancelled) {
        cancelledCount++;
        cancelledUsd += sUsd;
      } else {
        validCount++;
        usd += sUsd;
        bs += sBs;

        // Suma de unidades de productos
        const items = s.items || s.SaleItems || [];
        if (Array.isArray(items)) {
          items.forEach(it => {
            const qty = Number(it.quantity || 1);
            totalItemsSold += qty;
            const cost = Number(it.cost || it.product?.cost || 0);
            if (cost > 0) estimatedCostUsd += (cost * qty);
          });
        }

        // Segmentación Contado vs Crédito
        if (isCredit) {
          creditCount++;
          creditUsd += sUsd;
          creditBs += sBs;
        } else {
          cashCount++;
          // Desglose de ingresos reales liquidados
          if (method.includes('zelle')) zelleUsd += sUsd;
          else if (method.includes('pago_movil') || method.includes('movil') || method.includes('pm')) pagoMovilBs += sBs;
          else if (method.includes('tarjeta') || method.includes('debit') || method.includes('card') || method.includes('punto')) cardBs += sBs;
          else if (method.includes('cash_bs') || method.includes('efectivo bs')) cashBs += sBs;
          else if (method.includes('mixto') || method.includes('split') || method.includes('multiple')) mixedUsd += sUsd;
          else cashUsd += sUsd; // Efectivo USD por defecto
        }
      }
    });

    const avgUsd = validCount > 0 ? usd / validCount : 0;
    const realCobradoUsd = usd - creditUsd;
    const realCobradoBs = bs - creditBs;
    const grossProfitUsd = (realCobradoUsd > 0 && estimatedCostUsd > 0) ? (realCobradoUsd - estimatedCostUsd) : 0;
    const grossProfitMargin = (realCobradoUsd > 0 && estimatedCostUsd > 0) ? ((grossProfitUsd / realCobradoUsd) * 100) : 0;

    return { 
      totalUsd: usd, 
      totalBs: bs, 
      realCobradoUsd,
      realCobradoBs,
      count: validCount, 
      avgUsd,
      totalItemsSold,
      cashCount, 
      creditCount, 
      creditUsd, 
      creditBs,
      cashUsd, 
      cashBs, 
      pagoMovilBs, 
      cardBs, 
      zelleUsd, 
      mixedUsd,
      cancelledCount, 
      cancelledUsd,
      grossProfitUsd,
      grossProfitMargin
    };
  }, [filteredSales, exchangeRate]);

  // Contadores para pestañas de estado
  const statusCounts = useMemo(() => {
    let synced = 0;
    let offline = 0;
    let cancelled = 0;
    sales.forEach(s => {
      if (s.status === 'refunded' || s.status === 'cancelled') cancelled++;
      else if (s.status === 'pending_sync' || s.isOffline) offline++;
      else synced++;
    });
    return { all: sales.length, synced, offline, cancelled };
  }, [sales]);

  // Abrir modal de detalles y cargar items si no vienen en la lista
  const handleOpenDetail = async (sale) => {
    setSelectedSaleDetail(sale);
    if ((!sale.items || sale.items.length === 0) && (!sale.SaleItems || sale.SaleItems.length === 0) && sale.id) {
      try {
        const res = await api.get(`/sales/${sale.id}`, { timeout: 4000 });
        if (res.data) {
          setSelectedSaleDetail(prev => ({
            ...prev,
            ...res.data,
            items: res.data.SaleItems || res.data.items || prev.items
          }));
        }
      } catch (_err) {
        // Modo offline
      }
    }
  };

  // Solicitar anulación de una venta
  const handleInitiateCancel = (sale) => {
    if (sale.status === 'refunded' || sale.status === 'cancelled') {
      showToast?.('ℹ️ Esta venta ya fue anulada previamente');
      return;
    }
    setSaleToCancel(sale);
    setCancelReason('Error de cobro / digitación');
    setCancelNotes('');
  };

  const handleConfirmCancelClick = () => {
    const role = (user?.role || '').toLowerCase();
    const canVoidDirectly = ['admin', 'superadmin', 'supervisor', 'owner'].includes(role) || user?.permissions?.canVoidSales === true;

    if (canVoidDirectly) {
      executeCancelSale();
    } else {
      setIsSupervisorAuthOpen(true);
    }
  };

  const executeCancelSale = async (supervisorApprovalId = null) => {
    if (!saleToCancel) return;
    setIsCancelling(true);

    try {
      const isOfflineSale = saleToCancel.status === 'pending_sync' || saleToCancel.isOffline;
      const saleId = saleToCancel.id;
      const itemsList = saleToCancel.items || saleToCancel.SaleItems || [];

      if (isOfflineSale) {
        const updated = { ...saleToCancel, status: 'cancelled', isOffline: false };
        try {
          if (localDb && localDb.sales) await localDb.sales.put(updated);
          await primaryDb.put('sales', updated);
        } catch (_dbErr) {
          console.warn('[Sales] Error actualizando localDb:', _dbErr);
        }

        onSaleCancelled?.(saleId, updated);
        showToast?.('✅ Venta offline anulada y stock devuelto al catálogo');
      } else {
        const payload = {
          saleId: saleToCancel.id,
          reason: `${cancelReason}${cancelNotes ? ` - ${cancelNotes}` : ''}`,
          items: itemsList.map(item => ({
            productId: item.productId || item.product?.id || item.id,
            name: item.name || item.product?.name || 'Producto',
            price: item.price || item.unitPrice || 0,
            quantity: item.quantity || 1
          })),
          paymentMethods: saleToCancel.paymentMethod || saleToCancel.method || 'Efectivo',
          supervisorApprovalId
        };

        try {
          await api.post('/refunds', payload, { timeout: 6000 });
          const updated = { ...saleToCancel, status: 'refunded' };
          try {
            if (localDb && localDb.sales) await localDb.sales.put(updated);
            await primaryDb.put('sales', updated);
          } catch (caughtErr) { console.warn('[MobileSalesView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
          onSaleCancelled?.(saleId, updated);
          showToast?.('✅ Venta anulada exitosamente en el servidor');
        } catch (apiErr) {
          const errMsg = apiErr.response?.data?.message || apiErr.response?.data?.error || apiErr.message;
          if (!apiErr.response || apiErr.code === 'ECONNABORTED' || !navigator.onLine) {
            const updated = { ...saleToCancel, status: 'cancelled' };
            try {
              if (localDb && localDb.sales) await localDb.sales.put(updated);
              await primaryDb.put('sales', updated);
              await primaryDb.put('syncQueue', {
                id: `refund_${Date.now()}_${saleId}`,
                endpoint: '/refunds',
                method: 'POST',
                payload,
                createdAt: new Date().toISOString()
              });
            } catch (caughtErr) { console.warn('[MobileSalesView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
            onSaleCancelled?.(saleId, updated);
            showToast?.('⚡ Venta anulada offline (se sincronizará con la PC al reconectar)');
          } else {
            showToast?.(`❌ No se pudo anular: ${errMsg}`);
            setIsCancelling(false);
            return;
          }
        }
      }

      if (selectedSaleDetail && String(selectedSaleDetail.id) === String(saleToCancel.id)) {
        setSelectedSaleDetail(prev => ({ ...prev, status: isOfflineSale ? 'cancelled' : 'refunded' }));
      }
      setSaleToCancel(null);
    } catch (err) {
      console.error('[Sales] Error inesperado en anulación:', err);
      showToast?.('❌ Error al procesar la anulación');
    } finally {
      setIsCancelling(false);
    }
  };

  const handlePrint = (sale) => {
    if (!sale) return;
    if (onPrintTicket) {
      onPrintTicket(sale);
    } else {
      try {
        mobilePrinterService.enqueueSalePrint({
          sale,
          businessSettings: {
            receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm'
          },
          exchangeRate,
          currencyMode: 'BOTH'
        });
        showToast?.('🖨️ Enviado a la impresora térmica Bluetooth');
      } catch (err) {
        showToast?.('❌ Error al imprimir: ' + err.message);
      }
    }
  };

  // Generador de Reporte X / Cierre en Texto para WhatsApp y Térmica
  const generateXReportText = useCallback(() => {
    const periodName = dateFilter === 'today' ? 'HOY' : dateFilter === 'yesterday' ? 'AYER' : dateFilter === 'week' ? 'ÚLTIMOS 7 DÍAS' : dateFilter === 'month' ? 'ESTE MES' : 'PERÍODO';
    const lines = [
      `📊 *REPORTE X DE VENTAS - ${periodName}*`,
      `🏢 *${(localStorage.getItem('company_name') || 'ISAAC POS').toUpperCase()}*`,
      `📅 Generado: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
      `👤 Operador: ${user?.name || user?.username || 'Cajero Móvil'}`,
      `--------------------------------`,
      `💰 *VENTAS TOTALES:* $${totals.totalUsd.toFixed(2)}`,
      `🇻🇪 *Equivalente Bs:* Bs. ${totals.totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `🧾 Transacciones: ${totals.count} ventas (${totals.totalItemsSold} artículos)`,
      `🎯 Ticket Promedio: $${totals.avgUsd.toFixed(2)}`,
      `--------------------------------`,
      `💵 *DESGLOSE DE COBRANZA:*`,
      `• Contado Real: $${totals.realCobradoUsd.toFixed(2)} (${totals.cashCount} ventas)`,
      `• Crédito / Fiado: $${totals.creditUsd.toFixed(2)} (${totals.creditCount} ventas)`,
      `--------------------------------`,
      `💳 *DETALLE POR FORMA DE PAGO:*`,
      totals.cashUsd > 0 ? `• Efectivo USD: $${totals.cashUsd.toFixed(2)}` : null,
      totals.cashBs > 0 ? `• Efectivo Bs: Bs. ${totals.cashBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
      totals.pagoMovilBs > 0 ? `• Pago Móvil: Bs. ${totals.pagoMovilBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
      totals.cardBs > 0 ? `• Punto / Débito: Bs. ${totals.cardBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
      totals.zelleUsd > 0 ? `• Zelle: $${totals.zelleUsd.toFixed(2)}` : null,
      totals.mixedUsd > 0 ? `• Pago Mixto: $${totals.mixedUsd.toFixed(2)}` : null,
      `--------------------------------`,
      totals.cancelledCount > 0 ? `⚠️ Ventas Anuladas: ${totals.cancelledCount} ($${totals.cancelledUsd.toFixed(2)})` : `✅ Ventas Anuladas: 0`,
      isAdminOrSupervisor && totals.grossProfitUsd > 0 ? `📈 Ganancia Bruta Est.: $${totals.grossProfitUsd.toFixed(2)} (${totals.grossProfitMargin.toFixed(1)}%)` : null,
      `--------------------------------`,
      `🔒 Cierre auditado por sistema Isaac POS`
    ].filter(Boolean);

    return lines.join('\n');
  }, [dateFilter, totals, user, isAdminOrSupervisor]);

  // Enviar Reporte X por WhatsApp al Dueño / Gerente
  const handleShareXReportWhatsApp = () => {
    const text = generateXReportText();
    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  return (
    <div className={`flex flex-col h-full ${T.cardBg} animate-fadeIn`}>
      
      {/* 1. HEADER SUPERIOR TÁCTICO */}
      <div className={`p-3 sm:p-3.5 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={onBackToPOS}
            className={`p-2 rounded-xl ${T.btnGhost} border ${T.border} flex items-center gap-1.5 text-xs font-bold cursor-pointer active:scale-95 transition-transform`}
            title="Volver al mostrador POS"
          >
            <ArrowLeft size={16} />
            <span className="font-extrabold">POS</span>
          </button>
          <div>
            <h2 className={`font-black text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5 leading-tight`}>
              <FileText size={17} className="text-emerald-500 shrink-0" />
              <span>Ventas & Auditoría</span>
            </h2>
            <p className={`text-[10px] ${T.textMuted} font-semibold`}>
              {dateFilter === 'today' ? 'Ventas de Hoy' : dateFilter === 'yesterday' ? 'Ventas de Ayer' : dateFilter === 'week' ? 'Últimos 7 días' : dateFilter === 'month' ? 'Este Mes' : 'Historial Completo'}
            </p>
          </div>
        </div>

        {/* Acciones Rápidas: Reporte X + Sincronización */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsReportModalOpen(true)}
            className="px-2.5 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-xs font-black flex items-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
            title="Generar Reporte X de Cierre"
          >
            <Receipt size={14} />
            <span className="hidden sm:inline">Reporte X</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              if (pendingSalesCount > 0) {
                onSyncNow?.();
              } else if (onRefresh) {
                setIsManualRefreshing(true);
                try {
                  await onRefresh();
                  showToast?.('✨ Ventas sincronizadas con la PC');
                } catch (_) {
                  showToast?.('⚠️ Error al conectar con PC');
                } finally {
                  setIsManualRefreshing(false);
                }
              } else {
                onSyncNow?.();
              }
            }}
            disabled={isSyncing || isManualRefreshing}
            className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer ${
              pendingSalesCount > 0
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md animate-pulse'
                : `${T.btnGhost} border ${T.border} ${T.textSecondary} hover:opacity-100`
            }`}
            title="Sincronizar ventas con el servidor"
          >
            <RefreshCw size={13} className={isSyncing || isManualRefreshing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Subiendo...' : isManualRefreshing ? 'Cargando...' : pendingSalesCount > 0 ? `Subir (${pendingSalesCount})` : 'Al Día'}</span>
          </button>
        </div>
      </div>

      {/* 2. SELECTOR DE PERÍODOS Y RANGOS TEMPORALES */}
      <div className={`px-3 py-2 border-b ${T.border} flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 ${isLight ? 'bg-slate-50' : 'bg-[#0a0d12]'}`}>
        {[
          { id: 'today', label: 'Hoy' },
          { id: 'yesterday', label: 'Ayer' },
          { id: 'week', label: '7 días' },
          { id: 'month', label: 'Mes' },
          { id: 'all', label: 'Todo' },
          { id: 'custom', label: customStartDate ? `${customStartDate.slice(5)} - ${customEndDate.slice(5)}` : 'Rango...' }
        ].map(p => (
          <button
            type="button"
            key={p.id}
            onClick={() => {
              if (p.id === 'custom') {
                setIsCustomDateModalOpen(true);
              } else {
                setDateFilter(p.id);
              }
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
              dateFilter === p.id
                ? 'bg-blue-600 text-white shadow-2xs'
                : `${T.btnGhost} border ${T.border} ${T.textSecondary} hover:opacity-100`
            }`}
          >
            {p.id === 'custom' && <Calendar size={12} />}
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* 3. TARJETAS DE RESUMEN FINANCIERO Y COBRANZA */}
      <div className={`p-3 border-b ${T.border} shrink-0 space-y-2.5 ${T.subPanelBg}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Card Cobrado de Contado */}
          <div className={`${T.modalSubCard} p-2.5 rounded-xl border ${T.border} relative overflow-hidden`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                Cobrado Contado
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="font-black text-base sm:text-lg text-emerald-600 dark:text-emerald-400 mt-0.5">
              ${totals.realCobradoUsd.toFixed(2)}
            </div>
            <span className={`text-[10px] ${T.textMuted} font-semibold block truncate`}>
              Bs. {totals.realCobradoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Card Ventas a Crédito (Fiado) */}
          <div className={`${T.modalSubCard} p-2.5 rounded-xl border ${totals.creditUsd > 0 ? 'border-amber-500/40' : T.border} relative overflow-hidden`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
                Crédito (Fiado)
              </span>
              <Handshake size={13} className="text-amber-500" />
            </div>
            <div className="font-black text-base sm:text-lg text-amber-500 dark:text-amber-400 mt-0.5">
              ${totals.creditUsd.toFixed(2)}
            </div>
            <span className={`text-[10px] ${T.textMuted} font-semibold block`}>
              {totals.creditCount} {totals.creditCount === 1 ? 'cuenta por cobrar' : 'cuentas por cobrar'}
            </span>
          </div>

          {/* Card Ventas Totales Facturadas */}
          <div className={`${T.modalSubCard} p-2.5 rounded-xl border ${T.border} col-span-1`}>
            <span className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
              Total Facturado
            </span>
            <div className="font-black text-base sm:text-lg text-blue-600 dark:text-blue-400 mt-0.5">
              ${totals.totalUsd.toFixed(2)}
            </div>
            <span className={`text-[10px] ${T.textMuted} font-semibold block`}>
              {totals.count} ventas ({totals.totalItemsSold} arts)
            </span>
          </div>

          {/* Card Ticket Promedio */}
          <div className={`${T.modalSubCard} p-2.5 rounded-xl border ${T.border} col-span-1 flex flex-col justify-center`}>
            <span className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
              Ticket Promedio
            </span>
            <div className="font-black text-base text-slate-800 dark:text-slate-200 mt-0.5">
              ${totals.avgUsd.toFixed(2)}
            </div>
            <span className={`text-[10px] ${T.textMuted} font-semibold block truncate`}>
              Tasa: Bs. {exchangeRate.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Botón y Panel Desplegable de Desglose de Caja por Método */}
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setShowFinancialBreakdown(prev => !prev)}
            className={`w-full py-1.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition-colors cursor-pointer ${
              showFinancialBreakdown
                ? (isLight ? 'bg-slate-200/80 border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-700 text-white')
                : (isLight ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700' : 'bg-slate-900/60 hover:bg-slate-800 text-slate-300 border-slate-800')
            }`}
          >
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal size={13} className="text-blue-500" />
              <span>Desglose de Caja por Forma de Cobro</span>
            </span>
            {showFinancialBreakdown ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showFinancialBreakdown && (
            <div className={`p-3 rounded-xl border mt-2 space-y-2 animate-fadeIn text-xs ${isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-[#0f141d] border-[#1e242e]'}`}>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={`p-2 rounded-lg border ${T.border} flex items-center justify-between`}>
                  <span className={`${T.textSecondary} font-semibold`}>💵 Efectivo USD:</span>
                  <span className="font-black text-emerald-500">${totals.cashUsd.toFixed(2)}</span>
                </div>
                <div className={`p-2 rounded-lg border ${T.border} flex items-center justify-between`}>
                  <span className={`${T.textSecondary} font-semibold`}>🇻🇪 Efectivo Bs:</span>
                  <span className="font-black text-amber-500">Bs. {totals.cashBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className={`p-2 rounded-lg border ${T.border} flex items-center justify-between`}>
                  <span className={`${T.textSecondary} font-semibold`}>📲 Pago Móvil:</span>
                  <span className="font-black text-blue-500">Bs. {totals.pagoMovilBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className={`p-2 rounded-lg border ${T.border} flex items-center justify-between`}>
                  <span className={`${T.textSecondary} font-semibold`}>💳 Punto Débito:</span>
                  <span className="font-black text-indigo-500">Bs. {totals.cardBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className={`p-2 rounded-lg border ${T.border} flex items-center justify-between`}>
                  <span className={`${T.textSecondary} font-semibold`}>⚡ Zelle:</span>
                  <span className="font-black text-violet-500">${totals.zelleUsd.toFixed(2)}</span>
                </div>
                <div className={`p-2 rounded-lg border ${T.border} flex items-center justify-between`}>
                  <span className={`${T.textSecondary} font-semibold`}>🤝 Crédito / Fiado:</span>
                  <span className="font-black text-amber-500">${totals.creditUsd.toFixed(2)}</span>
                </div>
              </div>

              {isAdminOrSupervisor && totals.grossProfitUsd > 0 && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs pt-1.5">
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1">
                    <Percent size={13} />
                    <span>Ganancia Bruta Estimada:</span>
                  </span>
                  <span className="font-black text-emerald-600 dark:text-emerald-400">
                    ${totals.grossProfitUsd.toFixed(2)} ({totals.grossProfitMargin.toFixed(1)}%)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PESTAÑAS DE FILTRO POR ESTADO */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-blue-600 text-white shadow-2xs'
                : `${T.btnGhost} border ${T.border} ${T.textSecondary}`
            }`}
          >
            <span>Todas</span>
            <span className="text-[10px] opacity-80 font-bold">({statusCounts.all})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('synced')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'synced'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : `${T.btnGhost} border ${T.border} ${T.textSecondary}`
            }`}
          >
            <CheckCircle size={12} />
            <span>En PC</span>
            <span className="text-[10px] opacity-80 font-bold">({statusCounts.synced})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('offline')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'offline'
                ? 'bg-amber-500 text-slate-950 shadow-2xs'
                : `${T.btnGhost} border ${T.border} ${T.textSecondary}`
            }`}
          >
            <Clock size={12} />
            <span>Offline</span>
            <span className="text-[10px] opacity-80 font-bold">({statusCounts.offline})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('cancelled')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'cancelled'
                ? 'bg-rose-600 text-white shadow-2xs'
                : `${T.btnGhost} border ${T.border} ${T.textSecondary}`
            }`}
          >
            <RotateCcw size={12} />
            <span>Anuladas</span>
            <span className="text-[10px] opacity-80 font-bold">({statusCounts.cancelled})</span>
          </button>
        </div>

        {/* Buscador de Ventas */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${T.inputBg} border ${T.border}`}>
          <Search size={14} className={T.textMuted} />
          <input 
            type="text"
            placeholder="Buscar por # factura, cliente, cédula, mesa o cajero..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`bg-transparent flex-1 text-xs outline-none ${T.textPrimary} font-medium`}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className={`${T.textMuted} cursor-pointer p-0.5`}>
              <X size={13} />
            </button>
          )}
          <VoiceMicButton
            size={14}
            prompt="Di el número de factura o nombre del cliente..."
            onResult={(spokenText) => setSearchQuery(spokenText)}
            onError={(errMsg) => showToast?.(`🎤 ${errMsg}`)}
          />
        </div>

        {/* CHIPS DE FILTRO POR MÉTODO DE PAGO */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar text-[11px]">
          {paymentMethodsList.map(method => {
            const isSelected = method === 'Todos' ? methodFilter === 'all' : methodFilter.toLowerCase() === method.toLowerCase();
            return (
              <button
                key={method}
                type="button"
                onClick={() => setMethodFilter(method === 'Todos' ? 'all' : method)}
                className={`px-2.5 py-1 rounded-lg font-bold shrink-0 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
                    : `${T.btnGhost} border ${T.border} ${T.textMuted}`
                }`}
              >
                {method}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. LISTADO DE VENTAS CRONOLÓGICAS PROFESIONAL */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {filteredSales.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-xs space-y-2">
            <Receipt size={38} className={T.textMuted} />
            <p className={`font-black text-sm ${T.textPrimary}`}>No hay ventas registradas</p>
            <p className={`text-[11px] ${T.textMuted} max-w-xs`}>
              {searchQuery || statusFilter !== 'all' || methodFilter !== 'all' || dateFilter !== 'all'
                ? 'No se encontraron ventas para los filtros o rango seleccionado'
                : 'Las ventas cobradas desde esta terminal aparecerán aquí en tiempo real'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {visibleSales.map((sale, index) => {
              const isOffline = sale.status === 'pending_sync' || sale.isOffline;
              const isCancelled = sale.status === 'refunded' || sale.status === 'cancelled';
              const saleTotalUSD = Number(sale.totalUSD || sale.total || 0);
              const saleRate = Number(sale.exchangeRate || exchangeRate) || exchangeRate;
              const saleTotalBS = Number(sale.totalBS || (saleTotalUSD * saleRate));
              const dateStr = sale.date || sale.created_at || 'Hoy';
              
              const rawMethod = (sale.method || sale.paymentMethod || '').toLowerCase();
              const isCredit = Boolean(
                sale.isCredit || 
                sale.credit || 
                rawMethod.includes('fiado') || 
                rawMethod.includes('credito') || 
                rawMethod.includes('credit')
              );

              const itemsList = Array.isArray(sale.items) ? sale.items : Array.isArray(sale.SaleItems) ? sale.SaleItems : [];

              return (
                <div 
                  key={sale.id || index}
                  className={`${T.ticketItemBg} p-3 rounded-2xl border ${
                    isCancelled 
                      ? 'border-rose-500/30 opacity-75' 
                      : isCredit 
                      ? 'border-amber-500/40 shadow-2xs' 
                      : T.border
                  } space-y-2.5 hover:border-emerald-500/30 transition-all flex flex-col justify-between`}
                >
                  {/* Encabezado de la Tarjeta */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-xs font-black text-blue-500 truncate">
                        {sale.invoiceNumber || `#${String(sale.id).slice(-6)}`}
                      </span>

                      {/* Badge de Contado vs Crédito */}
                      {isCredit ? (
                        <span className="px-2 py-0.5 rounded-md text-[9.5px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0 flex items-center gap-1">
                          <Handshake size={10} />
                          <span>Crédito</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[9.5px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                          Contado
                        </span>
                      )}

                      {/* Badge de Estado Sync */}
                      {isCancelled ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-rose-500/20 text-rose-500 border border-rose-500/30 shrink-0">
                          Anulada
                        </span>
                      ) : isOffline ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-500 border border-amber-500/30 shrink-0">
                          Offline
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/10 text-emerald-500 shrink-0">
                          En PC
                        </span>
                      )}
                    </div>

                    <span className={`text-[10px] font-bold ${T.textMuted} shrink-0`}>
                      {formatDateLabel(dateStr)}
                    </span>
                  </div>

                  {/* Cliente y Monto */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`font-black text-xs sm:text-sm ${T.textPrimary} truncate leading-tight`}>
                        {sale.customerName || 'Consumidor Final'}
                      </p>
                      
                      <div className="flex items-center gap-2 mt-1 text-[11px]">
                        <span className={`${T.textMuted} font-semibold truncate`}>
                          {formatPaymentMethodLabel(sale.method || sale.paymentMethod, isCredit)}
                        </span>
                        
                        {(sale.table || sale.mesa) && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">
                            <Utensils size={10} />
                            <span>{sale.table || sale.mesa}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`font-black text-sm sm:text-base ${isCancelled ? 'text-rose-500 line-through' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        ${saleTotalUSD.toFixed(2)}
                      </div>
                      <div className={`text-[10px] font-bold ${T.textMuted}`}>
                        Bs. {saleTotalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  {/* Vista Rápida de Artículos en la Tarjeta */}
                  {itemsList.length > 0 && (
                    <div className={`p-2 rounded-xl ${isLight ? 'bg-slate-50' : 'bg-slate-900/60'} border ${T.border} text-[11px]`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-extrabold uppercase text-slate-400 flex items-center gap-1">
                          <Package size={11} />
                          <span>Artículos ({itemsList.length})</span>
                        </span>
                        {sale.cashierName && (
                          <span className="text-[10px] text-slate-400 font-semibold truncate max-w-[120px]">
                            Cajero: {sale.cashierName}
                          </span>
                        )}
                      </div>
                      <p className={`line-clamp-2 text-[11px] font-semibold leading-relaxed ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                        {itemsList.map(it => `${Number(it.quantity || 1)}x ${it.name || it.product?.name || 'Producto'}`).join(' • ')}
                      </p>
                    </div>
                  )}

                  {/* Acciones de la Tarjeta */}
                  <div className={`flex items-center justify-between pt-2 border-t ${T.border}`}>
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(sale)}
                      className={`px-2.5 py-1.5 rounded-xl ${T.btnGhost} border ${T.border} font-bold text-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all`}
                    >
                      <Eye size={13} className="text-blue-500" />
                      <span>Detalle</span>
                    </button>

                    <div className="flex items-center gap-1">
                      {/* Botón Reimprimir Térmico Bluetooth */}
                      <button
                        type="button"
                        onClick={() => handlePrint(sale)}
                        className={`p-2 rounded-xl ${T.btnGhost} border ${T.border} text-blue-500 hover:text-blue-400 text-xs font-bold flex items-center gap-1 cursor-pointer active:scale-95`}
                        title="Reimprimir en ticketera térmica"
                      >
                        <Printer size={13} />
                      </button>

                      {/* Botón WhatsApp */}
                      <button
                        type="button"
                        onClick={() => onShareWhatsApp?.(sale)}
                        className="p-2 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-500 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                        title="Enviar comprobante por WhatsApp"
                      >
                        <Share2 size={13} />
                      </button>

                      {/* Botón Anular Venta */}
                      {!isCancelled ? (
                        <button
                          type="button"
                          onClick={() => handleInitiateCancel(sale)}
                          className="p-2 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 text-rose-500 text-xs font-bold flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                          title="Anular venta y retornar inventario"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : (
                        <span className="text-[10px] font-black text-rose-400 px-2 py-1 bg-rose-500/10 rounded-lg">
                          Anulada
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {visibleSales.length < filteredSales.length && (
              <div className="py-4 col-span-full flex justify-center">
                <button
                  type="button"
                  onClick={() => setDisplayLimit(prev => prev + 30)}
                  className={`px-5 py-2.5 rounded-xl ${T.btnGhost} border ${T.border} text-xs font-bold flex items-center gap-2 active:scale-95 transition-all shadow-2xs cursor-pointer`}
                >
                  <span>Cargar más ventas ({filteredSales.length - visibleSales.length} restantes)</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. MODAL DETALLE COMPLETO DE VENTA */}
      {selectedSaleDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-md sm:max-w-lg rounded-2xl ${T.modalCard} border ${T.border} shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden`}>
            
            {/* Cabecera del Detalle */}
            <div className={`p-4 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 rounded-xl bg-blue-600/15 text-blue-500 border border-blue-500/20 shrink-0">
                  <Receipt size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-black text-sm sm:text-base ${T.textPrimary} truncate font-mono`}>
                      {selectedSaleDetail.invoiceNumber || `#${String(selectedSaleDetail.id).slice(-6)}`}
                    </h3>
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${
                      selectedSaleDetail.status === 'refunded' || selectedSaleDetail.status === 'cancelled'
                        ? 'bg-rose-500/20 text-rose-500'
                        : selectedSaleDetail.status === 'pending_sync' || selectedSaleDetail.isOffline
                        ? 'bg-amber-500/20 text-amber-500'
                        : 'bg-emerald-500/20 text-emerald-500'
                    }`}>
                      {selectedSaleDetail.status === 'refunded' || selectedSaleDetail.status === 'cancelled'
                        ? 'Anulada'
                        : selectedSaleDetail.status === 'pending_sync' || selectedSaleDetail.isOffline
                        ? 'Offline'
                        : 'En PC'}
                    </span>
                  </div>
                  <p className={`text-[10px] ${T.textMuted} font-semibold truncate`}>
                    {formatDateLabel(selectedSaleDetail.date || selectedSaleDetail.created_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSaleDetail(null)}
                className={`p-1.5 rounded-lg ${T.btnGhost} cursor-pointer active:scale-90 transition-transform`}
              >
                <X size={18} />
              </button>
            </div>

            {/* Contenido del Detalle */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 custom-scrollbar text-xs">
              
              {/* Información de Cliente y Forma de Cobro */}
              <div className={`p-3 rounded-xl ${T.modalSubCard} border ${T.border} space-y-2`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] uppercase font-bold ${T.textSecondary}`}>Cliente:</span>
                  <span className={`font-black ${T.textPrimary}`}>
                    {selectedSaleDetail.customerName || 'Consumidor Final'}
                  </span>
                </div>
                {selectedSaleDetail.customerDoc && (
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] uppercase font-bold ${T.textSecondary}`}>Doc / RIF:</span>
                    <span className={`font-mono font-bold ${T.textPrimary}`}>
                      {selectedSaleDetail.customerDoc}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] uppercase font-bold ${T.textSecondary}`}>Cajero:</span>
                  <span className={`font-bold ${T.textPrimary}`}>
                    {selectedSaleDetail.cashierName || selectedSaleDetail.userName || user?.name || 'Terminal Móvil'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] uppercase font-bold ${T.textSecondary}`}>Forma de Cobro:</span>
                  <span className="font-black text-blue-500">
                    {formatPaymentMethodLabel(selectedSaleDetail.method || selectedSaleDetail.paymentMethod, selectedSaleDetail.isCredit)}
                  </span>
                </div>
                {selectedSaleDetail.notes && (
                  <div className="pt-1.5 border-t border-slate-700/20">
                    <span className={`text-[10px] uppercase font-bold ${T.textSecondary} block mb-0.5`}>Notas:</span>
                    <p className={`text-[11px] ${T.textMuted}`}>{selectedSaleDetail.notes}</p>
                  </div>
                )}
              </div>

              {/* Lista de Artículos de la Venta */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className={`font-black text-xs ${T.textPrimary} uppercase tracking-wider flex items-center gap-1.5`}>
                    <Package size={13} className="text-emerald-500" />
                    <span>Productos Facturados</span>
                  </h4>
                  <span className={`text-[10px] ${T.textMuted} font-bold`}>
                    {(selectedSaleDetail.items || selectedSaleDetail.SaleItems || []).length} items
                  </span>
                </div>

                <div className={`rounded-xl border ${T.border} overflow-hidden divide-y ${isLight ? 'divide-slate-200' : 'divide-slate-800'}`}>
                  {(selectedSaleDetail.items || selectedSaleDetail.SaleItems || []).map((item, idx) => {
                    const price = Number(item.price || item.unitPrice || 0);
                    const qty = Number(item.quantity || 1);
                    const subtotal = price * qty;
                    return (
                      <div key={idx} className={`p-2.5 flex items-center justify-between gap-2 ${isLight ? 'bg-white' : 'bg-slate-900/40'}`}>
                        <div className="min-w-0 flex-1">
                          <p className={`font-black text-xs ${T.textPrimary} truncate`}>
                            {item.name || item.product?.name || 'Producto'}
                          </p>
                          <span className={`text-[10px] ${T.textMuted}`}>
                            {qty} x ${price.toFixed(2)}
                          </span>
                        </div>
                        <span className="font-black text-xs text-emerald-500 shrink-0">
                          ${subtotal.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Totales y Liquidación */}
              <div className={`p-3 rounded-xl ${isLight ? 'bg-slate-100' : 'bg-slate-950'} border ${T.border} space-y-1.5 text-xs`}>
                <div className="flex items-center justify-between font-bold">
                  <span className={T.textSecondary}>Subtotal USD:</span>
                  <span className={T.textPrimary}>${Number(selectedSaleDetail.totalUSD || selectedSaleDetail.total || 0).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between font-black text-sm pt-1 border-t border-slate-700/20">
                  <span className="text-blue-500">TOTAL USD:</span>
                  <span className="text-emerald-500">${Number(selectedSaleDetail.totalUSD || selectedSaleDetail.total || 0).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between font-bold text-xs">
                  <span className={T.textMuted}>TOTAL BS:</span>
                  <span className="text-amber-500 font-mono">
                    Bs. {Number(selectedSaleDetail.totalBS || (Number(selectedSaleDetail.totalUSD || selectedSaleDetail.total || 0) * (selectedSaleDetail.exchangeRate || exchangeRate))).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Acciones del Modal de Detalle */}
            <div className={`p-3.5 border-t ${T.border} flex items-center gap-2 ${T.subPanelBg}`}>
              <button
                type="button"
                onClick={() => handlePrint(selectedSaleDetail)}
                className="flex-1 h-9.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all shadow-sm"
              >
                <Printer size={14} />
                <span>Imprimir Ticket</span>
              </button>

              <button
                type="button"
                onClick={() => onShareWhatsApp?.(selectedSaleDetail)}
                className="h-9.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all shadow-sm"
                title="Compartir por WhatsApp"
              >
                <Share2 size={14} />
              </button>

              {!(selectedSaleDetail.status === 'refunded' || selectedSaleDetail.status === 'cancelled') && (
                <button
                  type="button"
                  onClick={() => {
                    handleInitiateCancel(selectedSaleDetail);
                  }}
                  className="h-9.5 px-3 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 text-rose-500 border border-rose-500/30 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                  title="Anular venta"
                >
                  <RotateCcw size={14} />
                  <span>Anular</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL REPORTE X DE CIERRE / TURNO */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-md rounded-2xl ${T.modalCard} border ${T.border} shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden`}>
            <div className={`p-4 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
              <div className="flex items-center gap-2">
                <Receipt size={17} className="text-blue-500" />
                <h3 className={`font-black text-sm sm:text-base ${T.textPrimary}`}>
                  Reporte X / Cierre de Ventas
                </h3>
              </div>
              <button type="button" onClick={() => setIsReportModalOpen(false)} className={`p-1 rounded-lg ${T.btnGhost} cursor-pointer`}>
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar space-y-3 font-mono text-xs">
              <pre className={`p-3 rounded-xl border leading-relaxed whitespace-pre-wrap ${isLight ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-slate-950 text-slate-200 border-slate-800'}`}>
                {generateXReportText()}
              </pre>
            </div>

            <div className={`p-3.5 border-t ${T.border} flex items-center gap-2 ${T.subPanelBg}`}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await mobilePrinterService.printRawEscPosText(generateXReportText());
                    showToast?.('🖨️ Reporte enviado a la impresora');
                  } catch (e) {
                    showToast?.('⚠️ Error al imprimir: ' + (e?.message || 'Verifica la impresora'));
                  }
                }}
                className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
              >
                <Printer size={14} />
                <span>Imprimir Térmico</span>
              </button>

              <button
                type="button"
                onClick={handleShareXReportWhatsApp}
                className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
              >
                <Send size={14} />
                <span>Enviar WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL DE RANGO PERSONALIZADO DE FECHAS */}
      {isCustomDateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm rounded-2xl ${T.modalCard} border ${T.border} shadow-2xl p-4 space-y-3.5`}>
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className={`font-black text-sm ${T.textPrimary} flex items-center gap-1.5`}>
                <Calendar size={15} className="text-blue-500" />
                <span>Filtrar por Rango de Fechas</span>
              </h3>
              <button type="button" onClick={() => setIsCustomDateModalOpen(false)} className={`p-1 rounded-lg ${T.btnGhost} cursor-pointer`}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>Desde (Fecha inicial):</label>
                <input 
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-2.5 font-bold outline-none`}
                />
              </div>

              <div>
                <label className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>Hasta (Fecha final):</label>
                <input 
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className={`w-full h-9.5 ${T.inputBg} border rounded-lg px-2.5 font-bold outline-none`}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!customStartDate && !customEndDate) {
                  showToast?.('Selecciona al menos una fecha');
                  return;
                }
                setDateFilter('custom');
                setIsCustomDateModalOpen(false);
              }}
              className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs cursor-pointer active:scale-95 shadow-sm mt-1"
            >
              Aplicar Rango
            </button>
          </div>
        </div>
      )}

      {/* 8. MODAL DE CONFIRMACIÓN DE ANULACIÓN */}
      {saleToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm rounded-2xl ${T.modalCard} border border-rose-500/40 shadow-2xl p-4 space-y-3.5`}>
            <div className="flex items-center gap-2 text-rose-500">
              <ShieldAlert size={20} />
              <h3 className="font-black text-sm">Anulación de Venta</h3>
            </div>

            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs space-y-1">
              <p className="font-black text-rose-600 dark:text-rose-400">
                Ticket: {saleToCancel.invoiceNumber || `#${String(saleToCancel.id).slice(-6)}`}
              </p>
              <p className={T.textSecondary}>
                Monto: <b>${Number(saleToCancel.total || saleToCancel.totalUSD || 0).toFixed(2)}</b> • Cliente: <b>{saleToCancel.customerName || 'Consumidor Final'}</b>
              </p>
              <p className="text-[10px] text-slate-400 pt-1">
                Los artículos se reincorporarán automáticamente al inventario.
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <label className={`text-[11px] font-bold ${T.textSecondary} block`}>Motivo de la anulación:</label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className={`w-full h-9 ${T.inputBg} border rounded-lg px-2 text-xs font-bold outline-none cursor-pointer`}
              >
                {cancelReasonsList.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              <input 
                type="text"
                placeholder="Observación o nota adicional..."
                value={cancelNotes}
                onChange={(e) => setCancelNotes(e.target.value)}
                className={`w-full h-9 ${T.inputBg} border rounded-lg px-2.5 text-xs outline-none`}
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSaleToCancel(null)}
                className={`flex-1 h-9.5 rounded-xl ${T.btnGhost} border ${T.border} font-bold text-xs cursor-pointer`}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmCancelClick}
                disabled={isCancelling}
                className="flex-1 h-9.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
              >
                {isCancelling ? <RefreshCw size={13} className="animate-spin" /> : <span>Confirmar</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Autorización de Supervisor si el cajero no tiene permiso directo */}
      {isSupervisorAuthOpen && (
        <SupervisorAuthModal
          isOpen={isSupervisorAuthOpen}
          onClose={() => setIsSupervisorAuthOpen(false)}
          onAuthorized={(authData) => {
            setIsSupervisorAuthOpen(false);
            executeCancelSale(authData?.approvalId || authData?.id || authData?.supervisorId);
          }}
          title="Anulación de Venta"
          reason={`Autorización requerida para anular venta #${saleToCancel?.invoiceNumber || saleToCancel?.id}`}
          actionType="VOID_SALE"
          referenceId={saleToCancel?.id ? String(saleToCancel.id) : null}
          isLight={isLight}
        />
      )}
    </div>
  );
}
