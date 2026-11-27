import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, 
  Wallet, 
  DollarSign, 
  CreditCard, 
  Smartphone, 
  RefreshCw, 
  Share2, 
  Lock, 
  Unlock, 
  ArrowDownRight, 
  ArrowUpRight, 
  FileText, 
  Printer, 
  Coins, 
  Check, 
  X,
  Clock
} from 'lucide-react';
import api from '../../services/api';
import localDb from '../../db/localDb';
import { db as primaryDb } from '../../services/db';
import mobilePrinterService from '../../services/mobilePrinterService';
import { encodeEscPosCp858, ESC_INIT_CP858 } from '../../utils/escposFormatter';
import SupervisorAuthModal from './SupervisorAuthModal';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';
import { useOfflineQueueCounts } from '../../hooks/useOfflineQueueCounts';
import { getMobileRegisterId, getActiveMobileRegisterId } from '../../utils/terminalIdentity';

const PRIVILEGED_CASH_ROLES = new Set(['admin', 'superadmin', 'owner', 'dueño', 'dueno', 'master', 'supervisor']);
const isPrivilegedCashRole = (userObj) => PRIVILEGED_CASH_ROLES.has(String(userObj?.role || '').trim().toLowerCase());

// Helper para normalizar el nombre del método de pago proveniente de la base de datos
const normalizePaymentMethod = (rawMethod) => {
  if (!rawMethod) return 'Otros';
  const str = String(rawMethod).toLowerCase().trim();
  
  if (str.includes('pago_movil') || str.includes('pagomovil') || str.includes('movil') || str.includes('pm')) {
    return 'Pago Móvil';
  }
  if (str.includes('cash_bs') || str.includes('efectivo_bs') || str.includes('bolivares') || str.includes('bs')) {
    return 'Efectivo Bs';
  }
  if (str.includes('cash_usd') || str.includes('efectivo_usd') || str.includes('dolares') || str.includes('usd') || str === 'cash' || str === 'efectivo') {
    return 'Efectivo USD';
  }
  if (str.includes('debit') || str.includes('debito') || str.includes('tarjeta') || str.includes('card') || str.includes('punto')) {
    return 'Tarjeta';
  }
  if (str.includes('zelle')) {
    return 'Zelle';
  }
  if (str.includes('transfer') || str.includes('transf')) {
    return 'Transferencia';
  }
  if (str.includes('credit') || str.includes('credito') || str.includes('fiado')) {
    return 'Crédito';
  }
  if (str.includes('mix') || str.includes('split') || str.includes('multiple')) {
    return 'Mixto';
  }
  return 'Otros';
};

// Helper para obtener icono y paleta visual por método de pago
const getMethodMeta = (methodName) => {
  switch (methodName) {
    case 'Efectivo USD':
      return { icon: DollarSign, color: 'text-emerald-500 bg-emerald-500/10' };
    case 'Efectivo Bs':
      return { icon: Coins, color: 'text-amber-500 bg-amber-500/10' };
    case 'Pago Móvil':
      return { icon: Smartphone, color: 'text-purple-500 bg-purple-500/10' };
    case 'Tarjeta':
      return { icon: CreditCard, color: 'text-blue-500 bg-blue-500/10' };
    case 'Zelle':
      return { icon: ArrowUpRight, color: 'text-indigo-500 bg-indigo-500/10' };
    case 'Transferencia':
      return { icon: ArrowDownRight, color: 'text-cyan-500 bg-cyan-500/10' };
    case 'Mixto':
      return { icon: RefreshCw, color: 'text-teal-500 bg-teal-500/10' };
    case 'Crédito':
      return { icon: FileText, color: 'text-orange-500 bg-orange-500/10' };
    default:
      return { icon: Wallet, color: 'text-gray-500 bg-gray-500/10' };
  }
};

export default function MobileCashView({
  sales = [],
  user,
  exchangeRate = 1,
  businessInfo = null,
  T,
  isLight,
  onBackToPOS,
  onOpenSyncCenter = null,
  showToast
}) {
  const safeExchangeRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;
  const terminalRegisterId = useMemo(() => getMobileRegisterId(), []);
  const isPrivileged = useMemo(() => isPrivilegedCashRole(user), [user]);
  const [currentShift, setCurrentShift] = useState(null);
  const [isLoadingShift, setIsLoadingShift] = useState(true);
  const { counts: offlineCounts } = useOfflineQueueCounts();

  const isBlindCloseEnforced = useMemo(() => {
    if (isPrivileged) return false;
    const configuredMode = String(businessInfo?.cashClosureMode || '').trim().toUpperCase();
    return configuredMode === 'BLIND' || currentShift?.isBlindClose === true;
  }, [isPrivileged, businessInfo?.cashClosureMode, currentShift?.isBlindClose]);

  // Modales
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    handleFieldFocusCapture,
    handleFormKeyDown
  } = useMobileKeyboardViewport({
    enabled: isOpenShiftModalOpen || isMovementModalOpen || isCloseShiftModalOpen
  });
  const [reportType, setReportType] = useState('X'); // 'X' o 'Z'
  const [lastZReportData, setLastZReportData] = useState(null);

  // Formulario Apertura de Turno
  const [openFloatUSD, setOpenFloatUSD] = useState('0.00');
  const [openFloatBS, setOpenFloatBS] = useState('0.00');
  const [openNotes, setOpenNotes] = useState('');
  const [isSubmittingOpen, setIsSubmittingOpen] = useState(false);

  // Formulario Movimiento de Efectivo (Caja Chica)
  const [movementType, setMovementType] = useState('expense'); // 'in' | 'expense' | 'out'
  const [movementCurrency, setMovementCurrency] = useState('USD');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [isSubmittingMovement, setIsSubmittingMovement] = useState(false);

  // Formulario Cierre de Turno (Corte Z / Cierre Ciego)
  const [countedUSD, setCountedUSD] = useState('');
  const [countedBS, setCountedBS] = useState('');
  const [countedCard, setCountedCard] = useState('');
  const [countedZelle, setCountedZelle] = useState('');
  const [countedMobile, setCountedMobile] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);
  const [supervisorAuthRequest, setSupervisorAuthRequest] = useState(null);

  // Cargar Turno Actual desde el Servidor PC (registerId único del dispositivo con fallback a 'Caja Móvil' legado)
  const fetchCurrentShift = useCallback(async () => {
    setIsLoadingShift(true);
    try {
      let shiftResp = await api.get(`/cash/current?registerId=${encodeURIComponent(terminalRegisterId)}`, { timeout: 3500 });
      if (!shiftResp?.data?.id) {
        const legacyResp = await api.get(`/cash/current?registerId=${encodeURIComponent('Caja Móvil')}`, { timeout: 3500 }).catch(() => null);
        if (legacyResp?.data?.id) {
          shiftResp = legacyResp;
        }
      }
      if (shiftResp?.data && shiftResp.data.id) {
        setCurrentShift(shiftResp.data);
        try { localStorage.setItem('pos_mobile_current_shift', JSON.stringify(shiftResp.data)); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      } else {
        setCurrentShift(null);
        try { localStorage.removeItem('pos_mobile_current_shift'); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      }
    } catch (_err) {
      // Fallback a almacenamiento local / offline
      try {
        const cached = localStorage.getItem('pos_mobile_current_shift');
        if (cached) {
          setCurrentShift(JSON.parse(cached));
        } else {
          setCurrentShift(null);
        }
      } catch (_) {
        setCurrentShift(null);
      }
    } finally {
      setIsLoadingShift(false);
    }
  }, [terminalRegisterId]);

  useEffect(() => {
    fetchCurrentShift();
  }, [fetchCurrentShift]);

  // Desglose financiero por método de pago de las ventas del turno
  const metrics = useMemo(() => {
    let totalUSD = 0;
    let totalBS = 0;
    const methods = {
      'Efectivo USD': { count: 0, usd: 0, bs: 0 },
      'Efectivo Bs': { count: 0, usd: 0, bs: 0 },
      'Pago Móvil': { count: 0, usd: 0, bs: 0 },
      'Tarjeta': { count: 0, usd: 0, bs: 0 },
      'Zelle': { count: 0, usd: 0, bs: 0 },
      'Transferencia': { count: 0, usd: 0, bs: 0 },
      'Mixto': { count: 0, usd: 0, bs: 0 },
      'Crédito': { count: 0, usd: 0, bs: 0 },
      'Otros': { count: 0, usd: 0, bs: 0 }
    };

    let offlineCount = 0;

    // Solo computar ventas que pertenezcan al turno actualmente abierto
    const isOpen = currentShift && (!currentShift.status || currentShift.status === 'open') && !currentShift.closedAt;
    const shiftStartTime = currentShift?.openedAt ? new Date(currentShift.openedAt).getTime() : 0;

    const shiftSales = isOpen && shiftStartTime > 0
      ? (sales || []).filter(s => {
          if (!s) return false;
          // Ignorar ventas canceladas o reembolsadas para no distorsionar el efectivo teórico ni generar falsos faltantes
          if (s.status === 'cancelled' || s.status === 'refunded') return false;
          // Ventas pendientes offline en este dispositivo siempre pertenecen a la sesión activa
          if (s.isOffline || s.status === 'pending_sync') return true;
          // Si tiene asignado explícitamente el ID de este turno
          if (s.cashShiftId && String(s.cashShiftId) === String(currentShift.id)) return true;
          if (s.shiftId && String(s.shiftId) === String(currentShift.id)) return true;
          // Si su fecha/hora es mayor o igual a la fecha de apertura del turno (con 30s de margen por sincronización de reloj)
          const sTime = new Date(s.date || s.createdAt || s.timestamp || 0).getTime();
          if (isNaN(sTime) || sTime === 0) return false;
          return sTime >= (shiftStartTime - 30000);
        })
      : [];

    shiftSales.forEach(s => {
      const u = Number(s.totalUSD || s.total || 0);
      const b = Number(s.totalBS || (u * (s.exchangeRate || safeExchangeRate)));
      totalUSD += u;
      totalBS += b;

      if (s.isOffline || s.status === 'pending_sync') {
        offlineCount++;
      }

      // Procesar métodos múltiples si la venta fue dividida (Split Payment)
      let splitMethods = null;
      if (Array.isArray(s.paymentMethods)) {
        splitMethods = s.paymentMethods;
      } else if (typeof s.paymentMethods === 'string' && s.paymentMethods.trim().startsWith('[')) {
        try { splitMethods = JSON.parse(s.paymentMethods); } catch (caughtErr) { console.warn('[MobileCashView] Error parseando JSON local:', caughtErr?.message || caughtErr); }
      }

      if (splitMethods && splitMethods.length > 0) {
        splitMethods.forEach(part => {
          const partKey = normalizePaymentMethod(part.method || part.type || part.name || part.paymentMethod);
          const pCurrency = String(part.currency || '').toUpperCase();
          const isVes = pCurrency === 'VES' || pCurrency === 'BS' || partKey === 'Efectivo Bs' || partKey === 'Pago Móvil';
          const pAmt = Number(part.amount || 0);
          const pUsd = Number(part.amountUSD || (isVes ? pAmt / (s.exchangeRate || safeExchangeRate) : pAmt));
          const pBs = Number(part.amountBS || (isVes ? pAmt : pUsd * (s.exchangeRate || safeExchangeRate)));

          if (methods[partKey]) {
            methods[partKey].count++;
            methods[partKey].usd += pUsd;
            methods[partKey].bs += pBs;
          } else {
            methods['Otros'].count++;
            methods['Otros'].usd += pUsd;
            methods['Otros'].bs += pBs;
          }
        });
      } else {
        const mKey = normalizePaymentMethod(s.method || s.paymentMethod);
        if (methods[mKey]) {
          methods[mKey].count++;
          methods[mKey].usd += u;
          methods[mKey].bs += b;
        } else {
          methods['Otros'].count++;
          methods['Otros'].usd += u;
          methods['Otros'].bs += b;
        }
      }
    });

    const hasBreakdown = currentShift?.initialBreakdown && typeof currentShift.initialBreakdown === 'object';
    const initialUsd = hasBreakdown
      ? Number(currentShift.initialBreakdown.cash_usd || 0)
      : Number(currentShift?.initialAmountUsd ?? (currentShift?.currency === 'USD' ? currentShift?.initialAmount : 0) ?? 0);

    const initialBs = hasBreakdown
      ? Number(currentShift.initialBreakdown.cash_bs || 0)
      : Number(currentShift?.initialAmountBs ?? (currentShift?.currency === 'VES' || currentShift?.currency === 'BS' ? currentShift?.initialAmount : 0) ?? 0);

    let movementsUsd = 0;
    let movementsBs = 0;
    const movements = currentShift?.CashMovements || currentShift?.movements || [];
    if (Array.isArray(movements)) {
      movements.forEach(m => {
        // Ignorar apertura y cierre porque ya componen el fondo inicial
        const cat = String(m.category || '').toUpperCase();
        const mId = String(m.id || '');
        if (cat === 'OPENING' || cat === 'CLOSURE' || mId.startsWith('OPEN-') || mId.startsWith('CLOSE-')) {
          return;
        }
        // Solo computar movimientos que afecten el efectivo físico en gaveta
        const pMethod = String(m.paymentMethodId || m.method || '').toLowerCase();
        const isDigital = pMethod.includes('movil') || pMethod.includes('zelle') || pMethod.includes('tarjeta') || pMethod.includes('card') || pMethod.includes('transf') || pMethod.includes('debit') || pMethod.includes('credit') || pMethod.includes('fiado');
        if (isDigital) {
          return;
        }
        const amt = Number(m.amount || 0);
        const isVes = (m.currency === 'VES' || m.currency === 'BS');
        const sign = (m.type === 'in' || m.type === 'INGRESO') ? 1 : -1;
        if (isVes) {
          movementsBs += (amt * sign);
        } else {
          movementsUsd += (amt * sign);
        }
      });
    }

    const cashUsdCollected = methods['Efectivo USD'].usd;
    const cashBsCollected = methods['Efectivo Bs'].bs;
    const theoreticalCashUsd = Math.max(0, initialUsd + cashUsdCollected + movementsUsd);
    const theoreticalCashBs = Math.max(0, initialBs + cashBsCollected + movementsBs);

    return { 
      totalUSD, 
      totalBS, 
      methods, 
      offlineCount, 
      count: shiftSales.length,
      initialUsd,
      initialBs,
      theoreticalCashUsd,
      theoreticalCashBs
    };
  }, [sales, safeExchangeRate, currentShift]);

  // Manejador: Abrir Turno de Caja
  const handleOpenShift = async (e) => {
    e.preventDefault();
    setIsSubmittingOpen(true);
    const parsedUsd = parseFloat(openFloatUSD) || 0;
    const parsedBs = parseFloat(openFloatBS) || 0;
    const payload = {
      amount: parsedUsd,
      initialBreakdown: {
        cash: parsedUsd,
        cash_usd: parsedUsd,
        cash_bs: parsedBs
      },
      initialAmountUsd: parsedUsd,
      initialAmountBs: parsedBs,
      initialAmount: parsedUsd,
      registerId: terminalRegisterId,
      registerName: `Terminal ${terminalRegisterId}`,
      notes: openNotes.trim() || 'Apertura desde POS Móvil'
    };

    try {
      const res = await api.post('/cash/open', payload, { timeout: 4000 });
      const created = res.data?.shift || res.data || { ...payload, id: Date.now(), openedAt: new Date().toISOString(), movements: [] };
      setCurrentShift(created);
      try { localStorage.setItem('pos_mobile_current_shift', JSON.stringify(created)); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      setIsOpenShiftModalOpen(false);
      showToast('✅ ¡Turno de caja abierto exitosamente!');
    } catch (err) {
      const httpStatus = err?.response?.status;
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.error || err?.response?.data?.message || 'No tienes permiso o no es posible abrir turno';
        showToast(`⚠️ ${msg}`);
        return;
      }
      // Fallback offline con encolado automático hacia el servidor PC
      const tempShiftId = `shift_off_${Date.now()}`;
      const offlineShift = {
        id: tempShiftId,
        ...payload,
        openedAt: new Date().toISOString(),
        movements: [],
        isOffline: true
      };
      setCurrentShift(offlineShift);
      try { localStorage.setItem('pos_mobile_current_shift', JSON.stringify(offlineShift)); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      try {
        await primaryDb.put('syncQueue', {
          id: `cash_open_${Date.now()}`,
          tempLocalId: tempShiftId,
          endpoint: '/cash/open',
          method: 'POST',
          payload,
          createdAt: new Date().toISOString()
        });
      } catch (caughtErr) { console.warn('[MobileCashView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
      setIsOpenShiftModalOpen(false);
      showToast('⚡ Turno abierto offline (se sincronizará al conectar con PC).');
    } finally {
      setIsSubmittingOpen(false);
    }
  };

  // Manejador: Registrar Movimiento de Caja
  const handleRecordMovement = async (e) => {
    e.preventDefault();
    const amountNum = parseFloat(movementAmount);
    if (!amountNum || amountNum <= 0) {
      showToast('⚠️ Ingresa un monto válido mayor a 0');
      return;
    }
    if (!movementReason.trim()) {
      showToast('⚠️ Ingresa el motivo del movimiento');
      return;
    }

    setIsSubmittingMovement(true);
    const payload = {
      type: movementType, // 'in' o 'expense'
      category: movementType === 'in' ? 'INGRESO' : 'GASTO_OPERATIVO',
      amount: amountNum,
      currency: movementCurrency,
      reason: movementReason.trim(),
      registerId: currentShift?.registerId || getActiveMobileRegisterId()
    };

    const localMovObj = {
      id: `mov_${Date.now()}`,
      ...payload,
      createdAt: new Date().toISOString()
    };

    try {
      await api.post('/cash/movement', payload, { timeout: 4000 });
      setCurrentShift(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          movements: [localMovObj, ...(Array.isArray(prev.movements) ? prev.movements : [])]
        };
        try { localStorage.setItem('pos_mobile_current_shift', JSON.stringify(updated)); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
        return updated;
      });
      showToast(`✅ Movimiento registrado: ${movementType === 'in' ? 'Entrada' : 'Salida'} de ${movementCurrency} ${amountNum}`);
      setIsMovementModalOpen(false);
      setMovementAmount('');
      setMovementReason('');
      fetchCurrentShift();
    } catch (err) {
      const httpStatus = err?.response?.status;
      if (httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.message || err?.response?.data?.error || `Operación rechazada por el servidor (${httpStatus})`;
        showToast(`⛔ ${msg}`);
        return;
      }
      // Offline fallback: solo ante fallo de red / 5xx actualizar turno en curso e insertar en cola de sincronización
      setCurrentShift(prev => {
        const baseShift = prev || {
          id: `shift_off_${Date.now()}`,
          initialAmountUsd: 0,
          initialAmountBs: 0,
          openedAt: new Date().toISOString(),
          movements: [],
          isOffline: true
        };
        const updated = {
          ...baseShift,
          movements: [localMovObj, ...(Array.isArray(baseShift.movements) ? baseShift.movements : [])]
        };
        try { localStorage.setItem('pos_mobile_current_shift', JSON.stringify(updated)); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
        return updated;
      });
      try {
        await primaryDb.put('syncQueue', {
          id: `cash_mov_${Date.now()}`,
          endpoint: '/cash/movement',
          method: 'POST',
          payload,
          createdAt: new Date().toISOString()
        });
        if (localDb && localDb.expenses && movementType !== 'in') {
          await localDb.expenses.put({
            id: localMovObj.id,
            ...payload,
            description: payload.reason,
            date: localMovObj.createdAt,
            status: 'pending_sync'
          });
        }
      } catch (caughtErr) { console.warn('[MobileCashView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
      showToast('⚡ Movimiento aplicado en caja local (pendiente de sincronizar).');
      setIsMovementModalOpen(false);
      setMovementAmount('');
      setMovementReason('');
    } finally {
      setIsSubmittingMovement(false);
    }
  };

  const executeCloseShift = async (payload, cUSD, cBS, { isBlind = false } = {}) => {
    setIsSubmittingClose(true);
    const endpoint = isBlind ? '/cash/close-blind' : '/cash/close';
    try {
      const res = await api.post(endpoint, payload, { timeout: 4500 });
      const closed = res.data?.shift || res.data || { ...payload, closedAt: new Date().toISOString() };
      setLastZReportData({
        ...closed,
        countedUSD: cUSD,
        countedBS: cBS,
        declaration: payload.declaration || null,
        isBlindClose: isBlind,
        metrics: isBlind ? null : metrics,
        user: user?.name || user?.username || 'Cajero Móvil'
      });
      setCurrentShift(null);
      try { localStorage.removeItem('pos_mobile_current_shift'); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      setIsCloseShiftModalOpen(false);
      setReportType('Z');
      setIsReportModalOpen(true);
      showToast(isBlind ? '✅ ¡Declaración ciega registrada y turno cerrado!' : '✅ ¡Caja cerrada exitosamente! Generando Corte Z.');
    } catch (err) {
      const httpStatus = err?.response?.status;
      const errCode = err?.response?.data?.code;
      if (isBlind && httpStatus === 403 && errCode === 'SUPERVISOR_AUTH_REQUIRED') {
        setSupervisorAuthRequest({
          title: 'Autorizar Cierre Ciego',
          reason: 'La declaración de cierre ciego supera la tolerancia de caja. Un supervisor debe autorizar el cierre.',
          actionType: 'cash_discrepancy',
          referenceId: String(currentShift?.id || terminalRegisterId),
          onAuthorized: (approvalData) => executeCloseShift({
            ...payload,
            supervisorApprovalId: approvalData?.id || null
          }, cUSD, cBS, { isBlind: true })
        });
        return;
      }
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.error || err?.response?.data?.message || 'Cierre de caja rechazado por el servidor';
        showToast(`⚠️ ${msg}`);
        return;
      }
      // Fallback offline con sincronización diferida
      try {
        await primaryDb.put('syncQueue', {
          id: `cash_close_${Date.now()}`,
          endpoint,
          method: 'POST',
          payload,
          createdAt: new Date().toISOString()
        });
      } catch (caughtErr) { console.warn('[MobileCashView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
      setLastZReportData({
        ...payload,
        countedUSD: cUSD,
        countedBS: cBS,
        declaration: payload.declaration || null,
        isBlindClose: isBlind,
        closedAt: new Date().toISOString(),
        isOffline: true,
        metrics: isBlind ? null : metrics,
        user: user?.name || user?.username || 'Cajero Móvil'
      });
      setCurrentShift(null);
      try { localStorage.removeItem('pos_mobile_current_shift'); } catch (caughtErr) { console.warn('[MobileCashView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
      setIsCloseShiftModalOpen(false);
      setReportType('Z');
      setIsReportModalOpen(true);
      showToast('⚡ Caja cerrada en modo local (se sincronizará al reconectar).');
    } finally {
      setIsSubmittingClose(false);
    }
  };

  // Manejador: Cierre de Turno (Corte Z o Cierre Ciego estricto)
  const handleCloseShift = async (e) => {
    e.preventDefault();

    const cUSD = parseFloat(countedUSD) || 0;
    const cBS = parseFloat(countedBS) || 0;
    const activeRegId = currentShift?.registerId || getActiveMobileRegisterId();

    if (isBlindCloseEnforced) {
      const blindPayload = {
        shiftId: currentShift?.id || null,
        registerId: activeRegId,
        declaration: {
          usd: cUSD,
          ves: cBS,
          card: parseFloat(countedCard) || 0,
          zelle: parseFloat(countedZelle) || 0,
          mobile: parseFloat(countedMobile) || 0
        },
        notes: closeNotes.trim() || 'Cierre ciego desde POS Móvil'
      };
      await executeCloseShift(blindPayload, cUSD, cBS, { isBlind: true });
      return;
    }

    const diffUSD = cUSD - metrics.theoreticalCashUsd;
    const diffBS = cBS - metrics.theoreticalCashBs;

    const finalBreakdown = {
      cash: cUSD,
      cash_bs: cBS
    };
    Object.entries(metrics.methods)
      .filter(([mName]) => mName !== 'Efectivo USD' && mName !== 'Efectivo Bs')
      .forEach(([mName, data]) => {
        let canon = 'otros';
        if (mName === 'Pago Móvil') canon = 'pago_movil';
        else if (mName === 'Tarjeta') canon = 'debit';
        else if (mName === 'Zelle') canon = 'zelle';
        else if (mName === 'Transferencia') canon = 'transfer';
        else if (mName === 'Crédito') canon = 'fiado';
        else if (mName === 'Mixto') canon = 'mixto';
        const isVes = mName === 'Pago Móvil' || mName === 'Tarjeta';
        const val = isVes ? data.bs : data.usd;
        finalBreakdown[canon] = Number(((finalBreakdown[canon] || 0) + val).toFixed(2));
      });

    const payload = {
      shiftId: currentShift?.id || null,
      declaredAmountUsd: cUSD,
      declaredAmountBs: cBS,
      finalBreakdown,
      notes: closeNotes.trim() || 'Cierre desde POS Móvil',
      registerId: activeRegId,
      theoreticalUsd: metrics.theoreticalCashUsd,
      theoreticalBs: metrics.theoreticalCashBs,
      differenceUsd: diffUSD,
      differenceBs: diffBS
    };

    // Tolerancia alineada con CashReconciliationService (por defecto $1.0 USD)
    const configuredTolerance = Number(businessInfo?.cashDifferenceToleranceUsd ?? 1);
    const toleranceUsd = Number.isFinite(configuredTolerance) && configuredTolerance >= 0 ? configuredTolerance : 1;
    if (Math.abs(diffUSD) > toleranceUsd && !isPrivileged) {
      setSupervisorAuthRequest({
        title: 'Autorizar Cierre con Diferencia',
        reason: `Discrepancia detectada: $${diffUSD.toFixed(2)} USD (tolerancia $${toleranceUsd.toFixed(2)})`,
        actionType: 'cash_discrepancy',
        referenceId: String(currentShift?.id || activeRegId),
        onAuthorized: (approvalData) => executeCloseShift({
          ...payload,
          supervisorApprovalId: approvalData?.id || null
        }, cUSD, cBS, { isBlind: false })
      });
      return;
    }

    await executeCloseShift(payload, cUSD, cBS, { isBlind: false });
  };

  // Fuente de métricas activa para Reporte X vs Corte Z (preserva snapshot del turno recién cerrado)
  const getReportMetrics = (type = 'X') => {
    if (type === 'Z' && lastZReportData?.metrics) {
      return lastZReportData.metrics;
    }
    return metrics;
  };

  // Generar texto para WhatsApp (Corte X o Z)
  const generateReportText = (type = 'X') => {
    const isZ = type === 'Z';
    const isBlindReceipt = isZ && Boolean(lastZReportData?.isBlindClose);
    const activeRegLabel = currentShift?.registerId || lastZReportData?.registerId || terminalRegisterId;
    if (isBlindReceipt) {
      const decl = lastZReportData?.declaration || {};
      return [
        `🔒 *DECLARACIÓN DE CIERRE CIEGO (CORTE Z)*`,
        `Terminal: *${activeRegLabel}*`,
        `Cajero: *${user?.name || user?.username || 'Cajero Móvil'}*`,
        `Fecha: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        `--------------------------------`,
        `*CONTEO FÍSICO DECLARADO:*`,
        `• Efectivo USD: $${Number(decl.usd ?? lastZReportData?.countedUSD ?? 0).toFixed(2)}`,
        `• Efectivo Bs: Bs. ${Number(decl.ves ?? lastZReportData?.countedBS ?? 0).toFixed(2)}`,
        ...(Number(decl.card) > 0 ? [`• Punto/Tarjeta: ${Number(decl.card).toFixed(2)}`] : []),
        ...(Number(decl.zelle) > 0 ? [`• Zelle: $${Number(decl.zelle).toFixed(2)}`] : []),
        ...(Number(decl.mobile) > 0 ? [`• Pago Móvil: Bs. ${Number(decl.mobile).toFixed(2)}`] : []),
        `--------------------------------`,
        `Auditoría sellada. Los totales teóricos se concilian en gerencia.`,
        `Isaac POS Ultra Móvil • Sistema Seguro`
      ].join('\n');
    }
    const rMetrics = getReportMetrics(type);
    const lines = [
      `📊 *${isZ ? 'CORTE Z (CIERRE DEFINITIVO)' : 'CORTE X (ARQUEO PARCIAL)'}*`,
      `Terminal: *${activeRegLabel}*`,
      `Cajero: *${user?.name || user?.username || 'Cajero Móvil'}*`,
      `Fecha: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      `Tasa Oficial: Bs. ${safeExchangeRate.toFixed(2)}`,
      `--------------------------------`,
      `*FONDO INICIAL DE APERTURA:*`,
      `• USD: $${rMetrics.initialUsd.toFixed(2)}`,
      `• Bs: Bs. ${rMetrics.initialBs.toFixed(2)}`,
      `--------------------------------`,
      `*VENTAS TOTALES DEL TURNO:*`,
      `• Total USD: *$${rMetrics.totalUSD.toFixed(2)}*`,
      `• Total BS: *Bs. ${rMetrics.totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`,
      `• Tickets emitidos: *${rMetrics.count}*`,
      `--------------------------------`,
      `*DESGLOSE POR FORMA DE PAGO:*`,
      ...Object.entries(rMetrics.methods)
        .filter(([_, data]) => data.count > 0)
        .map(([name, data]) => `• ${name} (${data.count}): $${data.usd.toFixed(2)} / Bs. ${data.bs.toFixed(2)}`),
      `--------------------------------`,
      `*EFECTIVO TEÓRICO EN CAJA:*`,
      `• Efectivo USD Esperado: *$${rMetrics.theoreticalCashUsd.toFixed(2)}*`,
      `• Efectivo Bs Esperado: *Bs. ${rMetrics.theoreticalCashBs.toFixed(2)}*`,
      ...(isZ && lastZReportData ? [
        `--------------------------------`,
        `*CONTEO FÍSICO ARQUEADO:*`,
        `• Conteo USD: $${Number(lastZReportData.countedUSD || 0).toFixed(2)}`,
        `• Conteo Bs: Bs. ${Number(lastZReportData.countedBS || 0).toFixed(2)}`,
        `• Diferencia USD: $${Number(lastZReportData.differenceUsd || 0).toFixed(2)}`,
        `• Diferencia Bs: Bs. ${Number(lastZReportData.differenceBs || 0).toFixed(2)}`
      ] : []),
      `--------------------------------`,
      rMetrics.offlineCount > 0 ? `⚠️ Ventas offline por sincronizar: ${rMetrics.offlineCount}` : `✅ Todo sincronizado en red LAN`,
      `--------------------------------`,
      `Isaac POS Ultra Móvil • Sistema Seguro`
    ];
    return lines.join('\n');
  };

  const handleShareWhatsApp = (type = 'X') => {
    const text = generateReportText(type);
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  const handlePrintBluetooth = async (type = 'X') => {
    try {
      const isZ = type === 'Z';
      const isBlindReceipt = isZ && Boolean(lastZReportData?.isBlindClose);
      const activeRegLabel = currentShift?.registerId || lastZReportData?.registerId || terminalRegisterId;
      const ESC = '\x1B';
      const GS = '\x1D';
      const divider = '--------------------------------\n';
      let receipt = '';
      receipt += ESC_INIT_CP858; // Init + CP858 Español real (ñ, Ñ, tildes)
      receipt += `${ESC}a\x01`; // Center
      receipt += `${ESC}!\x30${isBlindReceipt ? 'CIERRE CIEGO (Z)' : (isZ ? 'CORTE Z (CIERRE)' : 'CORTE X (ARQUEO)')}${ESC}!\x00\n`;
      receipt += `Terminal: ${activeRegLabel}\n`;
      receipt += `Cajero: ${String(user?.name || user?.username || 'Cajero Móvil')}\n`;
      receipt += `${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
      receipt += `${ESC}a\x00`; // Left
      receipt += divider;
      if (isBlindReceipt) {
        const decl = lastZReportData?.declaration || {};
        receipt += `${ESC}E\x01DECLARACION FISICA SELLADA:${ESC}E\x00\n`;
        receipt += `Efectivo USD: $${Number(decl.usd ?? lastZReportData?.countedUSD ?? 0).toFixed(2)}\n`;
        receipt += `Efectivo Bs:  Bs. ${Number(decl.ves ?? lastZReportData?.countedBS ?? 0).toFixed(2)}\n`;
        if (Number(decl.card) > 0) receipt += `Punto/Tarjeta: ${Number(decl.card).toFixed(2)}\n`;
        if (Number(decl.zelle) > 0) receipt += `Zelle:         $${Number(decl.zelle).toFixed(2)}\n`;
        if (Number(decl.mobile) > 0) receipt += `Pago Movil:    Bs. ${Number(decl.mobile).toFixed(2)}\n`;
        receipt += divider;
        receipt += `Auditoria reservada en gerencia.\n`;
      } else {
        const rMetrics = getReportMetrics(type);
        receipt += `Tasa BCV: Bs. ${safeExchangeRate.toFixed(2)}\n`;
        receipt += divider;
        receipt += `${ESC}E\x01FONDO INICIAL DE APERTURA:${ESC}E\x00\n`;
        receipt += `USD: $${rMetrics.initialUsd.toFixed(2)}\n`;
        receipt += `Bs:  Bs. ${rMetrics.initialBs.toFixed(2)}\n`;
        receipt += divider;
        receipt += `${ESC}E\x01VENTAS TOTALES DEL TURNO:${ESC}E\x00\n`;
        receipt += `Total USD: $${rMetrics.totalUSD.toFixed(2)}\n`;
        receipt += `Total BS:  Bs. ${rMetrics.totalBS.toFixed(2)}\n`;
        receipt += `Tickets:   ${rMetrics.count}\n`;
        receipt += divider;
        receipt += `${ESC}E\x01DESGLOSE POR PAGO:${ESC}E\x00\n`;
        Object.entries(rMetrics.methods)
          .filter(([_, data]) => data.count > 0)
          .forEach(([name, data]) => {
            receipt += `${String(name)} (${data.count}): $${data.usd.toFixed(2)}\n`;
          });
        receipt += divider;
        receipt += `${ESC}E\x01EFECTIVO ESPERADO EN CAJA:${ESC}E\x00\n`;
        receipt += `USD Esperado: $${rMetrics.theoreticalCashUsd.toFixed(2)}\n`;
        receipt += `Bs Esperado:  Bs. ${rMetrics.theoreticalCashBs.toFixed(2)}\n`;
        if (isZ && lastZReportData) {
          receipt += divider;
          receipt += `${ESC}E\x01CONTEO FÍSICO ARQUEADO:${ESC}E\x00\n`;
          receipt += `Conteo USD: $${Number(lastZReportData.countedUSD || 0).toFixed(2)}\n`;
          receipt += `Conteo Bs:  Bs. ${Number(lastZReportData.countedBS || 0).toFixed(2)}\n`;
          receipt += `Dif. USD:   $${Number(lastZReportData.differenceUsd || 0).toFixed(2)}\n`;
          receipt += `Dif. Bs:    Bs. ${Number(lastZReportData.differenceBs || 0).toFixed(2)}\n`;
        }
      }
      receipt += divider;
      receipt += `${ESC}a\x01Isaac POS Ultra Móvil\n\n\n\n${GS}V\x41\x00`;

      const escposData = encodeEscPosCp858(receipt);
      const base64 = mobilePrinterService.toBase64(escposData);

      let printerCfg = {};
      try {
        printerCfg = JSON.parse(localStorage.getItem('pos_printer_config') || '{}');
      } catch (caughtErr) { console.warn('[MobileCashView] Error parseando JSON local:', caughtErr?.message || caughtErr); }

      if (printerCfg.type === 'network' && printerCfg.ip) {
        await mobilePrinterService.printNetwork(printerCfg.ip, printerCfg.port || 9100, escposData);
        showToast('🖨️ Reporte impreso por Red Wi-Fi/LAN');
        return;
      }

      if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware) {
        const btAddress = printerCfg.btAddress ||
          printerCfg.address ||
          localStorage.getItem('pos_mobile_bt_printer') ||
          localStorage.getItem('pos_mobile_bt_printer_last') || '';
        await window.Capacitor.Plugins.PosNativeHardware.printBluetooth({
          address: btAddress,
          data: base64
        });
        showToast('🖨️ Reporte impreso en impresora térmica Bluetooth');
        return;
      }

      // Soporte directo Web Bluetooth para Android Chrome / PWA
      if (mobilePrinterService.isBluetoothSupported()) {
        try {
          await mobilePrinterService.printBluetooth(escposData);
          showToast('🖨️ Reporte impreso vía Web Bluetooth');
          return;
        } catch (wbErr) {
          console.warn('[CashView] Web Bluetooth no disponible, probando RawBT:', wbErr);
        }
      }

      // Android RawBT Protocol
      if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
        mobilePrinterService.printRawBT(escposData);
        showToast('🖨️ Reporte enviado a RawBT');
        return;
      }

      window.print();
    } catch (printErr) {
      showToast(`❌ Error al imprimir: ${printErr.message || 'Verifica la impresora'}`);
    }
  };

  return (
    <div className={`flex flex-col h-full ${T.cardBg} animate-fadeIn`}>
      {/* 1. HEADER DE CAJA */}
      <div className={`p-3.5 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
        <div className="flex items-center gap-2.5">
          <button 
            onClick={onBackToPOS}
            className={`p-1.5 rounded-xl ${T.btnGhost} flex items-center gap-1 text-xs font-bold cursor-pointer active:scale-95`}
            title="Volver a Terminal POS"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">POS</span>
          </button>
          <div>
            <h2 className={`font-black text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5`}>
              <Wallet size={16} className="text-amber-500 shrink-0" />
              <span>Caja y Turno</span>
            </h2>
            <p className={`text-[10px] ${T.textMuted}`}>
              {currentShift ? `Turno Activo • ${currentShift.registerId || terminalRegisterId}` : 'Caja Cerrada • Sin turno activo'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {offlineCounts.cash > 0 && (
            <button
              type="button"
              onClick={() => onOpenSyncCenter?.()}
              className="px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-500 text-[10px] font-black flex items-center gap-1 cursor-pointer active:scale-95"
              title="Registros de caja/ventas pendientes por sincronizar"
            >
              <Clock size={11} />
              <span>{offlineCounts.cash} pend.</span>
            </button>
          )}
          <button
            onClick={() => fetchCurrentShift()}
            className={`p-2 rounded-xl ${T.btnGhost} text-slate-400 hover:text-white cursor-pointer active:scale-95`}
            title="Recargar estado"
          >
            <RefreshCw size={14} className={isLoadingShift ? 'animate-spin' : ''} />
          </button>

          {currentShift ? (
            !isBlindCloseEnforced ? (
              <button
                onClick={() => handleShareWhatsApp('X')}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1 transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
                title="Compartir Arqueo por WhatsApp"
              >
                <Share2 size={13} />
                <span>Arqueo</span>
              </button>
            ) : (
              <span className="px-2 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-amber-400 text-[10px] font-black flex items-center gap-1">
                <Lock size={11} />
                <span>Ciego</span>
              </span>
            )
          ) : (
            <button
              onClick={() => setIsOpenShiftModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
            >
              <Unlock size={13} />
              <span>Abrir Turno</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. CONTENIDO PRINCIPAL */}
      <div className="p-3 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
        {/* BANNER PRINCIPAL DE ESTADO */}
        {currentShift ? (
          <div className={`${T.modalSubCard} p-4 rounded-xl border ${T.border} space-y-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>
                  Turno en Curso
                </span>
              </div>
              <span className={`text-[11px] ${T.textMuted}`}>
                Cajero: <b className={T.textPrimary}>{user?.name || user?.username || 'Cajero Móvil'}</b>
              </span>
            </div>

            {/* Fondo Inicial */}
            {(metrics.initialUsd > 0 || metrics.initialBs > 0) && (
              <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-between text-xs">
                <span className="text-blue-600 dark:text-blue-400 font-bold">Fondo Inicial de Caja:</span>
                <span className={`font-black ${T.textPrimary}`}>
                  ${metrics.initialUsd.toFixed(2)} / Bs. {metrics.initialBs.toFixed(2)}
                </span>
              </div>
            )}

            {isBlindCloseEnforced ? (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1 text-xs">
                <div className="flex items-center gap-1.5 text-amber-500 font-black uppercase text-[10px]">
                  <Lock size={13} />
                  <span>Arqueo Ciego Activo (Auditoría Antifraude)</span>
                </div>
                <p className={`text-[11px] ${T.textSecondary}`}>
                  Los montos esperados y el Corte X están ocultos durante el turno. Al finalizar, declara tu conteo físico real en el Cierre Z.
                </p>
              </div>
            ) : (
              <>
                {/* Recaudación Total */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/20">
                  <div>
                    <span className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider`}>
                      Recaudación USD
                    </span>
                    <p className="font-black text-xl text-emerald-600 dark:text-emerald-400 mt-0.5">
                      ${metrics.totalUSD.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <span className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider`}>
                      Recaudación Bs
                    </span>
                    <p className="font-black text-base text-amber-600 dark:text-amber-400 mt-0.5 truncate">
                      Bs. {metrics.totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {/* Efectivo Teórico Esperado en Caja */}
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold block text-[10px] uppercase">Efectivo Teórico en Cajón:</span>
                    <span className={`font-black ${T.textPrimary} text-sm`}>
                      ${metrics.theoreticalCashUsd.toFixed(2)} USD
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-amber-700 dark:text-amber-400 font-bold block text-[10px] uppercase">En Bolívares:</span>
                    <span className="font-black text-amber-700 dark:text-amber-400 text-xs">
                      Bs. {metrics.theoreticalCashBs.toFixed(2)}
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-between pt-1 text-xs">
              <span className={T.textSecondary}>Ventas realizadas en turno:</span>
              <span className={`font-black ${T.textPrimary}`}>{metrics.count} tickets</span>
            </div>

            {metrics.offlineCount > 0 && (
              <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 font-bold">
                <span>Pendientes de sincronizar con servidor:</span>
                <span>{metrics.offlineCount} tickets en teléfono</span>
              </div>
            )}

            {/* BOTONES DE ACCIÓN DE TURNO */}
            <div className={`grid ${isBlindCloseEnforced ? 'grid-cols-2' : 'grid-cols-3'} gap-2 pt-2`}>
              <button
                onClick={() => setIsMovementModalOpen(true)}
                className="py-2.5 px-2 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 hover:bg-amber-500/25 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-bold text-[11px] flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
              >
                <Coins size={16} />
                <span>Movimiento</span>
              </button>

              {!isBlindCloseEnforced && (
                <button
                  onClick={() => {
                    setReportType('X');
                    setIsReportModalOpen(true);
                  }}
                  className="py-2.5 px-2 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 hover:bg-blue-500/25 border border-blue-500/30 text-blue-700 dark:text-blue-300 font-bold text-[11px] flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                >
                  <FileText size={16} />
                  <span>Corte X</span>
                </button>
              )}

              <button
                onClick={() => {
                  setCountedUSD(isPrivileged ? metrics.theoreticalCashUsd.toFixed(2) : '');
                  setCountedBS(isPrivileged ? metrics.theoreticalCashBs.toFixed(2) : '');
                  setCountedCard('');
                  setCountedZelle('');
                  setCountedMobile('');
                  setIsCloseShiftModalOpen(true);
                }}
                className="py-2.5 px-2 rounded-lg bg-rose-500/10 dark:bg-rose-500/20 hover:bg-rose-500/25 border border-rose-500/30 text-rose-700 dark:text-rose-300 font-bold text-[11px] flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
              >
                <Lock size={16} />
                <span>{isBlindCloseEnforced ? 'Cierre Ciego (Z)' : 'Cerrar Turno (Z)'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className={`${T.modalSubCard} p-6 rounded-xl border border-slate-200 dark:border-slate-800 text-center space-y-3`}>
            <div className="w-12 h-12 mx-auto rounded-xl bg-amber-500/15 text-amber-500 dark:text-amber-400 border border-amber-500/25 flex items-center justify-center">
              <Lock size={22} />
            </div>
            <div>
              <h3 className={`font-black text-sm ${T.textPrimary}`}>No hay turno de caja abierto</h3>
              <p className={`text-xs ${T.textMuted} mt-1 max-w-xs mx-auto`}>
                Debes abrir un turno para iniciar el registro formal de ventas, fondo de cambio y arqueo de caja.
              </p>
            </div>
            <button
              onClick={() => setIsOpenShiftModalOpen(true)}
              className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 mx-auto shadow-xs cursor-pointer active:scale-95 transition-all"
            >
              <Unlock size={15} />
              <span>Abrir Turno de Caja Ahora</span>
            </button>
          </div>
        )}

        {/* 3. DESGLOSE POR FORMAS DE PAGO (Oculto en Modo Ciego estricto para cajeros) */}
        {!isBlindCloseEnforced && (
        <div className="space-y-1.5">
          <h3 className={`text-xs font-black uppercase tracking-wider ${T.textMuted} px-1`}>
            Desglose por Formas de Pago
          </h3>

          {metrics.count === 0 ? (
            <div className={`p-4 rounded-xl border ${T.border} ${T.ticketItemBg} text-center`}>
              <p className={`text-xs ${T.textMuted} font-medium`}>
                No se han registrado ventas en el turno actual todavía.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {Object.entries(metrics.methods).map(([methodName, data]) => {
                if (data.count === 0) return null;
                const meta = getMethodMeta(methodName);
                const MethodIcon = meta.icon;
                return (
                  <div 
                    key={methodName}
                    className={`${T.ticketItemBg} p-3 rounded-xl border ${T.border} flex items-center justify-between gap-3`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-lg ${meta.color}`}>
                        <MethodIcon size={15} />
                      </div>
                      <div>
                        <h4 className={`font-bold text-xs ${T.textPrimary}`}>
                          {methodName}
                        </h4>
                        <p className={`text-[10px] ${T.textMuted}`}>
                          {data.count} {data.count === 1 ? 'operación' : 'operaciones'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="font-extrabold text-xs text-emerald-600 dark:text-emerald-400">
                        ${data.usd.toFixed(2)}
                      </p>
                      <p className={`text-[10px] font-semibold ${T.textSecondary}`}>
                        Bs. {data.bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>

      {/* MODAL: APERTURA DE TURNO */}
      {isOpenShiftModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80"
          style={modalOverlayStyle}
        >
          <div
            className={`w-full max-w-md ${T.modalCard} rounded-t-xl sm:rounded-xl p-4 sm:p-5 shadow-xl border-t sm:border ${T.border} space-y-4 max-h-[92dvh] overflow-y-auto`}
            style={modalCardMaxHeightStyle}
          >
            <div className={`flex items-center justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2">
                <Unlock size={18} className="text-emerald-500" />
                <h3 className={`font-black text-sm ${T.textPrimary}`}>Apertura de Turno de Caja</h3>
              </div>
              <button onClick={() => setIsOpenShiftModalOpen(false)} className={`${T.textMuted} hover:opacity-100 p-2 cursor-pointer`}>
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleOpenShift}
              onKeyDown={handleFormKeyDown}
              onFocusCapture={handleFieldFocusCapture}
              className="space-y-3"
            >
              <p className={`text-xs ${T.textSecondary}`}>
                Indica el fondo inicial de cambio recibido en caja al comenzar el turno.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block mb-1">
                    Fondo Inicial USD ($)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    step="0.01"
                    value={openFloatUSD}
                    onChange={(e) => setOpenFloatUSD(e.target.value)}
                    placeholder="0.00"
                    className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-black ${T.textPrimary} outline-none focus:border-emerald-500`}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-amber-600 dark:text-amber-400 block mb-1">
                    Fondo Inicial Bs
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    step="0.1"
                    value={openFloatBS}
                    onChange={(e) => setOpenFloatBS(e.target.value)}
                    placeholder="0.00"
                    className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-black ${T.textPrimary} outline-none focus:border-amber-500`}
                  />
                </div>
              </div>

              <div>
                <label className={`text-[10px] font-bold ${T.textMuted} block mb-1`}>
                  Notas / Observaciones (Opcional)
                </label>
                <input
                  type="text"
                  enterKeyHint="done"
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                  placeholder="Ej: Turno mañana, billetes de $1 y $5 para cambio"
                  className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-bold ${T.textPrimary} outline-none`}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingOpen}
                className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-95 transition-all mt-2"
              >
                {isSubmittingOpen ? <RefreshCw size={15} className="animate-spin" /> : <Check size={16} />}
                <span>Confirmar e Iniciar Turno</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MOVIMIENTO DE CAJA CHICA (ENTRADA / SALIDA) */}
      {isMovementModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80"
          style={modalOverlayStyle}
        >
          <div
            className={`w-full max-w-md ${T.modalCard} rounded-t-xl sm:rounded-xl p-4 sm:p-5 shadow-xl border-t sm:border ${T.border} space-y-4 max-h-[92dvh] overflow-y-auto`}
            style={modalCardMaxHeightStyle}
          >
            <div className={`flex items-center justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-amber-500" />
                <h3 className={`font-black text-sm ${T.textPrimary}`}>Movimiento de Caja Chica</h3>
              </div>
              <button onClick={() => setIsMovementModalOpen(false)} className={`${T.textMuted} hover:opacity-100 p-2 cursor-pointer`}>
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleRecordMovement}
              onKeyDown={handleFormKeyDown}
              onFocusCapture={handleFieldFocusCapture}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMovementType('in')}
                  className={`py-2 rounded-lg text-xs font-black border flex items-center justify-center gap-1.5 cursor-pointer ${
                    movementType === 'in' 
                      ? 'bg-emerald-600 border-emerald-400 text-white shadow-xs' 
                      : `${T.inputBg} ${T.border} ${T.textSecondary}`
                  }`}
                >
                  <ArrowDownRight size={15} />
                  <span>Entrada / Depósito</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMovementType('expense')}
                  className={`py-2 rounded-lg text-xs font-black border flex items-center justify-center gap-1.5 cursor-pointer ${
                    movementType === 'expense' 
                      ? 'bg-rose-600 border-rose-400 text-white shadow-xs' 
                      : `${T.inputBg} ${T.border} ${T.textSecondary}`
                  }`}
                >
                  <ArrowUpRight size={15} />
                  <span>Salida / Gasto</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={`text-[10px] font-bold ${T.textSecondary} block mb-1`}>Moneda</label>
                  <select
                    value={movementCurrency}
                    onChange={(e) => setMovementCurrency(e.target.value)}
                    className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-bold ${T.textPrimary} outline-none`}
                  >
                    <option value="USD">Dólares ($ USD)</option>
                    <option value="VES">Bolívares (Bs)</option>
                  </select>
                </div>

                <div>
                  <label className={`text-[10px] font-bold ${T.textSecondary} block mb-1`}>Monto *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    step="0.01"
                    required
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                    placeholder="0.00"
                    className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-black ${T.textPrimary} outline-none focus:border-amber-500`}
                  />
                </div>
              </div>

              <div>
                <label className={`text-[10px] font-bold ${T.textSecondary} block mb-1`}>Motivo / Concepto *</label>
                <input
                  type="text"
                  enterKeyHint="done"
                  required
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  placeholder="Ej: Pago de hielo, compras menores, cambio"
                  className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-bold ${T.textPrimary} outline-none`}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingMovement}
                className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-95 transition-all mt-2"
              >
                {isSubmittingMovement ? <RefreshCw size={15} className="animate-spin" /> : <Check size={16} />}
                <span>Registrar Movimiento de Caja</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CIERRE DE TURNO (CORTE Z) */}
      {isCloseShiftModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80"
          style={modalOverlayStyle}
        >
          <div
            className={`w-full max-w-md ${T.modalCard} rounded-t-xl sm:rounded-xl p-4 sm:p-5 shadow-xl border-t sm:border border-rose-500/30 space-y-4 max-h-[92dvh] overflow-y-auto`}
            style={modalCardMaxHeightStyle}
          >
            <div className={`flex items-center justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2">
                <Lock size={18} className="text-rose-500" />
                <h3 className={`font-black text-sm ${T.textPrimary}`}>Cierre de Turno (Corte Z)</h3>
              </div>
              <button onClick={() => setIsCloseShiftModalOpen(false)} className={`${T.textMuted} hover:opacity-100 p-2 cursor-pointer`}>
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleCloseShift}
              onKeyDown={handleFormKeyDown}
              onFocusCapture={handleFieldFocusCapture}
              className="space-y-3"
            >
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 space-y-1">
                <p className="text-[11px] font-black uppercase text-rose-600 dark:text-rose-400">
                  Arqueo y Cierre Definitivo
                </p>
                <p className={`text-[10px] ${T.textSecondary}`}>
                  Ingresa el conteo físico de dinero que tienes en la mano. El sistema comparará con el teórico esperado.
                </p>
              </div>

              {/* Conteo físico */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block mb-1">
                    Conteo Físico USD ($) *
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    step="0.01"
                    required
                    value={countedUSD}
                    onChange={(e) => setCountedUSD(e.target.value)}
                    className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-black ${T.textPrimary} outline-none focus:border-emerald-500`}
                  />
                  {isPrivileged ? (
                    <p className={`text-[9px] ${T.textMuted} mt-1`}>
                      Esperado: ${metrics.theoreticalCashUsd.toFixed(2)}
                    </p>
                  ) : (
                    <p className={`text-[9px] ${T.textMuted} mt-1 font-medium italic`}>
                      🔒 Arqueo ciego protegido
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold text-amber-600 dark:text-amber-400 block mb-1">
                    Conteo Físico Bs *
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    step="0.1"
                    required
                    value={countedBS}
                    onChange={(e) => setCountedBS(e.target.value)}
                    className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-black ${T.textPrimary} outline-none focus:border-amber-500`}
                  />
                  {isPrivileged ? (
                    <p className={`text-[9px] ${T.textMuted} mt-1`}>
                      Esperado: Bs. {metrics.theoreticalCashBs.toFixed(2)}
                    </p>
                  ) : (
                    <p className={`text-[9px] ${T.textMuted} mt-1 font-medium italic`}>
                      🔒 Arqueo ciego protegido
                    </p>
                  )}
                </div>
              </div>

              {isBlindCloseEnforced && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-blue-500 block mb-1">
                      Lote Punto
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      value={countedCard}
                      onChange={(e) => setCountedCard(e.target.value)}
                      className={`w-full min-h-[42px] ${T.inputBg} border ${T.border} rounded-lg p-2 text-xs font-black ${T.textPrimary} outline-none`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-indigo-400 block mb-1">
                      Zelle ($)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      value={countedZelle}
                      onChange={(e) => setCountedZelle(e.target.value)}
                      className={`w-full min-h-[42px] ${T.inputBg} border ${T.border} rounded-lg p-2 text-xs font-black ${T.textPrimary} outline-none`}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-purple-400 block mb-1">
                      Pago Móvil (Bs)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      placeholder="0.00"
                      value={countedMobile}
                      onChange={(e) => setCountedMobile(e.target.value)}
                      className={`w-full min-h-[42px] ${T.inputBg} border ${T.border} rounded-lg p-2 text-xs font-black ${T.textPrimary} outline-none`}
                    />
                  </div>
                </div>
              )}

              {/* Indicador de Diferencia (Sólo visible para Administrador/Supervisor) */}
              {isPrivileged && countedUSD !== '' && (
                <div className={`p-2.5 rounded-lg border text-xs flex justify-between items-center ${
                  (parseFloat(countedUSD) || 0) >= metrics.theoreticalCashUsd 
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                }`}>
                  <span className="font-bold">Diferencia USD:</span>
                  <span className="font-black text-sm">
                    {((parseFloat(countedUSD) || 0) - metrics.theoreticalCashUsd >= 0 ? '+' : '')}
                    {((parseFloat(countedUSD) || 0) - metrics.theoreticalCashUsd).toFixed(2)} USD
                  </span>
                </div>
              )}

              <div>
                <label className={`text-[10px] font-bold ${T.textMuted} block mb-1`}>
                  Observaciones de Cierre (Opcional)
                </label>
                <input
                  type="text"
                  enterKeyHint="done"
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Ej: Todo cuadrado sin faltantes"
                  className={`w-full min-h-[44px] ${T.inputBg} border ${T.border} rounded-lg p-2.5 text-base sm:text-sm font-bold ${T.textPrimary} outline-none`}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingClose}
                className="w-full py-3 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-95 transition-all mt-2"
              >
                {isSubmittingClose ? <RefreshCw size={15} className="animate-spin" /> : <Lock size={16} />}
                <span>Confirmar y Cerrar Caja Definitivamente</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VISOR DE REPORTE TÉRMICO (CORTE X o CORTE Z) */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85">
          <div className="w-full max-w-xs bg-white text-slate-950 font-mono text-[11px] p-5 rounded-xl shadow-xl space-y-3 border border-slate-200 max-h-[92dvh] overflow-y-auto">
            <div className="text-center border-b border-dashed pb-2.5">
              <h2 className="font-black text-base tracking-tight">ISAAC POS ULTRA</h2>
              <p className="text-[10px] font-sans font-bold text-slate-700">
                {reportType === 'Z' ? 'REPORTE CORTE Z (CIERRE)' : 'REPORTE CORTE X (PARCIAL)'}
              </p>
              <p className="text-[9px] text-slate-500 font-sans mt-0.5">Terminal: Caja Móvil</p>
            </div>

            <div className="text-[10px] space-y-0.5">
              <div className="flex justify-between"><span>Fecha:</span><span>{new Date().toLocaleDateString('es-VE')}</span></div>
              <div className="flex justify-between"><span>Hora:</span><span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
              <div className="flex justify-between"><span>Cajero:</span><span>{user?.name || user?.username || 'Cajero Móvil'}</span></div>
            </div>

            {(() => {
              const isBlindReceipt = reportType === 'Z' && Boolean(lastZReportData?.isBlindClose);
              if (isBlindReceipt) {
                const decl = lastZReportData?.declaration || {};
                return (
                  <div className="border-t border-b border-dashed py-2 space-y-1 text-[10px]">
                    <p className="font-bold font-sans uppercase text-center text-slate-800">Declaración Ciega Sellada</p>
                    <div className="flex justify-between font-bold">
                      <span>Efectivo USD Declarado:</span>
                      <span>${Number(decl.usd ?? lastZReportData?.countedUSD ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Efectivo Bs Declarado:</span>
                      <span>Bs. {Number(decl.ves ?? lastZReportData?.countedBS ?? 0).toFixed(2)}</span>
                    </div>
                    {Number(decl.card) > 0 && (
                      <div className="flex justify-between">
                        <span>Punto / Tarjeta:</span>
                        <span>{Number(decl.card).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(decl.zelle) > 0 && (
                      <div className="flex justify-between">
                        <span>Zelle:</span>
                        <span>${Number(decl.zelle).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(decl.mobile) > 0 && (
                      <div className="flex justify-between">
                        <span>Pago Móvil:</span>
                        <span>Bs. {Number(decl.mobile).toFixed(2)}</span>
                      </div>
                    )}
                    <p className="text-[9px] text-slate-500 font-sans pt-1 text-center">
                      Los totales teóricos y diferencias son auditados exclusivamente en gerencia.
                    </p>
                  </div>
                );
              }
              const modalMetrics = getReportMetrics(reportType);
              return (
                <>
                  <div className="border-t border-b border-dashed py-2 space-y-1">
                    <div className="flex justify-between font-bold">
                      <span>Fondo Inicial ($):</span>
                      <span>${modalMetrics.initialUsd.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Fondo Inicial (Bs):</span>
                      <span>Bs. {modalMetrics.initialBs.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-emerald-800">
                      <span>Total Ventas USD:</span>
                      <span>${modalMetrics.totalUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Total Ventas Bs:</span>
                      <span>Bs. {modalMetrics.totalBS.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tickets Emitidos:</span>
                      <span>{modalMetrics.count}</span>
                    </div>
                  </div>

                  {/* Desglose métodos */}
                  <div className="space-y-0.5 text-[9px]">
                    <p className="font-bold font-sans uppercase">Desglose por Método:</p>
                    {Object.entries(modalMetrics.methods).map(([mName, data]) => {
                      if (data.count === 0) return null;
                      return (
                        <div key={mName} className="flex justify-between">
                          <span>{mName} ({data.count}):</span>
                          <span>${data.usd.toFixed(2)} / Bs. {data.bs.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-dashed pt-2 space-y-1 font-bold text-[10px]">
                    <div className="flex justify-between text-blue-900">
                      <span>Efectivo Teórico USD:</span>
                      <span>${modalMetrics.theoreticalCashUsd.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Efectivo Teórico Bs:</span>
                      <span>Bs. {modalMetrics.theoreticalCashBs.toFixed(2)}</span>
                    </div>
                  </div>
                </>
              );
            })()}

            <div className="space-y-2 pt-2 border-t border-dashed font-sans">
              <button
                onClick={() => handlePrintBluetooth(reportType)}
                className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
              >
                <Printer size={14} />
                <span>Imprimir Térmica BT</span>
              </button>

              <button
                onClick={() => handleShareWhatsApp(reportType)}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
              >
                <Share2 size={14} />
                <span>Enviar por WhatsApp</span>
              </button>

              <button
                onClick={() => setIsReportModalOpen(false)}
                className="w-full py-2 rounded-lg bg-slate-200 text-slate-800 font-bold text-xs hover:bg-slate-300 cursor-pointer"
              >
                Cerrar Reporte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AUTORIZACIÓN BIOMÉTRICA O PIN DE SUPERVISOR */}
      {supervisorAuthRequest && (
        <SupervisorAuthModal
          isOpen={Boolean(supervisorAuthRequest)}
          onClose={() => setSupervisorAuthRequest(null)}
          onAuthorized={(approvalData) => {
            const cb = supervisorAuthRequest.onAuthorized;
            setSupervisorAuthRequest(null);
            cb?.(approvalData);
          }}
          title={supervisorAuthRequest.title}
          reason={supervisorAuthRequest.reason}
          actionType={supervisorAuthRequest.actionType || 'cash_discrepancy'}
          referenceId={supervisorAuthRequest.referenceId || null}
          isLight={isLight}
          T={T}
        />
      )}
    </div>
  );
}
