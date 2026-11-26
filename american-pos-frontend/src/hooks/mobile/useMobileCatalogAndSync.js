import { useState, useEffect, useRef, useCallback } from 'react';
import api, { updateApiBaseUrl, checkServerHealth, formatServerUrl, autoDiscoverServer } from '../../services/api';
import localDb from '../../db/localDb';
import { db as primaryDb } from '../../services/db';
import lanSyncService from '../../services/lanSyncService';
import syncManager from '../../services/syncManager';
import cloudRateSyncService from '../../services/cloudRateSyncService';
import mobilePrinterService from '../../services/mobilePrinterService';
import { cacheAllProductImages } from '../../services/imageCache';
import { getSupabaseHeaders, getSupabaseRestUrl, hasSupabaseConfig } from '../../config/supabaseConfig';
import { isSoundMuted } from '../../utils/sounds';

export const getCleanProductId = (rawId) =>
  String(rawId || '').replace(/__bulk$|__mid$|__pres_.*$|__wpres_.*$|__srv_.*$/, '');

export const getProductUnitsMultiplier = (prod) => {
  if (!prod) return 1;
  const explicitFactor = Number(prod.factorConversion || prod.unitsMultiplier || 0);
  if (explicitFactor > 1) return explicitFactor;
  if (prod.isBulk) return Math.max(1, Number(prod.unitsPerBulk || prod.unidadesPorBulto) || 1);
  if (prod.isMidBulk) return Math.max(1, Number(prod.unitsPerMidBulk || prod.unidadesPorEmpaque) || 1);
  return 1;
};

const computeCatalogSignature = (list) => {
  if (!Array.isArray(list) || list.length === 0) return '0';
  let sum = 0;
  const len = list.length;
  for (let i = 0; i < len; i++) {
    const p = list[i];
    sum += (Number(p.price || p.precio || 0) * 100) + Number(p.stockQuantity ?? p.stock ?? 0);
  }
  const first = list[0];
  const last = list[len - 1];
  return `${len}:${Math.round(sum)}:${first?.id || ''}:${last?.id || ''}:${last?.updatedAt || ''}`;
};

/**
 * Hook de dominio para catálogo, tasas, clientes, historial de ventas, salud de servidor PC,
 * sincronización offline/Delta Sync y suscripciones en tiempo real (Socket.IO / LAN P2P / Cloud Rate).
 */
export function useMobileCatalogAndSync({
  user,
  socketContext,
  activeModule,
  setHeldSales,
  setShowServerModal,
  showToast
}) {
  const socket = socketContext?.socket;
  const isRealtimeConnected = Boolean(socketContext?.isConnected || socket?.connected);

  // Red, Socket Espejo y Cola Offline
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [lanSocketConnected, setLanSocketConnected] = useState(() => Boolean(
    lanSyncService?.socket?.connected ||
    lanSyncService?.status?.state === 'CLOUD_ONLINE' ||
    lanSyncService?.status?.state === 'LAN_P2P_ACTIVE'
  ));
  const socketConnected = Boolean(
    isRealtimeConnected ||
    lanSocketConnected ||
    lanSyncService?.socket?.connected ||
    (lanSyncService?.status?.state && lanSyncService.status.state !== 'OFFLINE_ISOLATED')
  );

  const [pendingSalesCount, setPendingSalesCount] = useState(0);
  const [isSyncingSales, setIsSyncingSales] = useState(false);
  const [salesHistory, setSalesHistory] = useState([]);

  // Configuración de servidor PC
  const [mobileServerIp, setMobileServerIp] = useState(() =>
    localStorage.getItem('isaac_pos_server_ip') ||
    localStorage.getItem('american_pos_server_ip') ||
    ''
  );
  const [serverHealth, setServerHealth] = useState(null);
  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverFeedback, setServerFeedback] = useState(null);

  // Negocio, tasa y modo
  const [businessInfo, setBusinessInfo] = useState(() => {
    try {
      const cached = localStorage.getItem('pos_cached_business_info');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (caughtErr) {
      console.warn('[MobileCatalogSync] Error parseando JSON local:', caughtErr?.message || caughtErr);
    }
    return {
      name: 'Mi Negocio POS',
      rif: '',
      phone: '',
      address: '',
      pagoMovilBank: '',
      pagoMovilPhone: '',
      pagoMovilId: ''
    };
  });

  const [exchangeRate, setExchangeRate] = useState(() => {
    try {
      const cached = localStorage.getItem('pos_cached_exchange_rate') || localStorage.getItem('pos_exchange_rate');
      const parsed = parseFloat(cached);
      if (parsed && !isNaN(parsed) && parsed > 0) return parsed;
    } catch (caughtErr) {
      console.warn('[MobileCatalogSync] Error leyendo tasa local:', caughtErr?.message || caughtErr);
    }
    return 1000.0;
  });

  const [businessMode, setBusinessMode] = useState(() =>
    (localStorage.getItem('pos_business_mode') || 'STANDARD').toUpperCase()
  );

  // Datos principales
  const [products, setProducts] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [isAudioMuted, setIsAudioMuted] = useState(() => isSoundMuted());
  const [printerSpoolerStatus, setPrinterSpoolerStatus] = useState(() => mobilePrinterService.getQueueStatus());

  // Health check inicial
  useEffect(() => {
    let isMounted = true;
    checkServerHealth().then((ok) => {
      if (isMounted) setServerHealth(ok);
    });
    return () => { isMounted = false; };
  }, []);

  const handleTestAndSaveServer = useCallback(async (ipToTest) => {
    const target = ipToTest || mobileServerIp;
    setIsTestingServer(true);
    setServerFeedback(null);
    try {
      const formatted = formatServerUrl(target);
      const ok = await checkServerHealth(formatted);
      if (ok) {
        updateApiBaseUrl(target);
        setMobileServerIp(target);
        setServerHealth(true);
        setServerFeedback({ ok: true, msg: '¡Conectado exitosamente al servidor PC!' });
        setTimeout(() => setShowServerModal(false), 1200);
      } else {
        setServerHealth(false);
        setServerFeedback({ ok: false, msg: 'No se pudo conectar. Verifica que la PC esté en la misma red Wi-Fi.' });
      }
    } catch {
      setServerHealth(false);
      setServerFeedback({ ok: false, msg: 'Error de red al conectar.' });
    } finally {
      setIsTestingServer(false);
    }
  }, [mobileServerIp, setShowServerModal]);

  const handleAutoDiscoverServer = useCallback(async () => {
    setIsTestingServer(true);
    setServerFeedback({ ok: true, msg: 'Buscando servidor en la red Wi-Fi...' });
    try {
      const found = await autoDiscoverServer();
      if (found) {
        setMobileServerIp(found);
        setServerHealth(true);
        setServerFeedback({ ok: true, msg: `¡Servidor detectado en ${found}!` });
        setTimeout(() => setShowServerModal(false), 1200);
      } else {
        setServerFeedback({ ok: false, msg: 'No se encontró el servidor automáticamente. Escribe la IP manualmente.' });
      }
    } catch {
      setServerFeedback({ ok: false, msg: 'Error buscando servidor.' });
    } finally {
      setIsTestingServer(false);
    }
  }, [setShowServerModal]);

  // WakeLock + Auto-Healing IP DHCP
  useEffect(() => {
    let wakeLockSentinel = null;
    const requestWakeLock = async () => {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
        } catch { /* Screen Wake Lock opcional */ }
      }
    };
    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    };
    const handleServerDiscovered = (e) => {
      const discoveredUrl = e?.detail?.url;
      if (discoveredUrl) {
        setMobileServerIp(discoveredUrl.replace(/^https?:\/\//, ''));
        setServerHealth(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('server-discovered', handleServerDiscovered);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('server-discovered', handleServerDiscovered);
      if (wakeLockSentinel) wakeLockSentinel.release().catch(() => {});
    };
  }, []);

  const activeModuleRef = useRef(activeModule);
  useEffect(() => { activeModuleRef.current = activeModule; }, [activeModule]);

  const catalogSignatureRef = useRef('');
  const loadProductsRetryTimerRef = useRef(null);
  const loadProductsRef = useRef(null);
  const loadSettingsRef = useRef(null);
  const loadCustomersRef = useRef(null);
  const loadPromotionsRef = useRef(null);
  const loadSalesHistoryRef = useRef(null);
  const syncOfflineSalesQueueRef = useRef(null);

  const countPendingOfflineSales = useCallback(async () => {
    try {
      const counts = await syncManager.getPendingCount();
      setPendingSalesCount(counts.total);
    } catch (caughtErr) {
      console.warn('[MobileCatalogSync] Error consultando cola offline:', caughtErr?.message || caughtErr);
    }
  }, []);

  const loadSalesHistory = useCallback(async () => {
    let localItems = [];
    try {
      if (localDb && localDb.sales) {
        const orderedLocal = await localDb.sales.orderBy('created_at').reverse().limit(100).toArray();
        localItems = Array.isArray(orderedLocal) ? orderedLocal : [];
      }
    } catch (localErr) {
      console.warn('[MobilePOS] Error ordenando ventas locales, usando respaldo:', localErr?.message || localErr);
      try {
        const rawLocal = await localDb.sales.toArray();
        const sortedFallback = Array.isArray(rawLocal)
          ? [...rawLocal].sort((a, b) => {
              const ta = new Date(a?.created_at || a?.createdAt || a?.date || 0).getTime() || 0;
              const tb = new Date(b?.created_at || b?.createdAt || b?.date || 0).getTime() || 0;
              return tb - ta;
            })
          : [];
        localItems = sortedFallback.slice(0, 100);
      } catch (fallbackErr) {
        console.warn('[MobilePOS] Error leyendo ventas locales:', fallbackErr?.message || fallbackErr);
      }
    }

    let remoteItems = [];
    try {
      const res = await api.get('/sales?limit=100', { timeout: 8000 });
      const rawList = Array.isArray(res.data)
        ? res.data
        : (res.data?.data || res.data?.sales || res.data?.rows || []);
      remoteItems = Array.isArray(rawList) ? rawList : [];
    } catch (_e) {
      console.warn('[MobilePOS] Error al cargar ventas del servidor:', _e);
    }

    const map = new Map();
    localItems.forEach((s) => map.set(String(s.id), s));
    remoteItems.forEach((s) => {
      if (!map.has(String(s.id))) {
        map.set(String(s.id), { ...s, status: s.status || 'synced', isOffline: false });
      }
    });

    const getSortableTime = (saleObj) => {
      const candidate = saleObj?.created_at || saleObj?.createdAt || saleObj?.timestamp || saleObj?.date;
      const ms = candidate ? new Date(candidate).getTime() : 0;
      return Number.isFinite(ms) ? ms : 0;
    };

    const merged = Array.from(map.values()).sort((a, b) => getSortableTime(b) - getSortableTime(a));
    setSalesHistory(merged);
    await countPendingOfflineSales();
  }, [countPendingOfflineSales]);

  const loadSettings = useCallback(async () => {
    try {
      const cachedBiz = localStorage.getItem('pos_cached_business_info');
      if (cachedBiz) setBusinessInfo((prev) => ({ ...prev, ...JSON.parse(cachedBiz) }));
      const cachedRate = localStorage.getItem('pos_cached_exchange_rate');
      if (cachedRate) {
        const parsedRate = parseFloat(cachedRate);
        if (parsedRate && !isNaN(parsedRate)) setExchangeRate(parsedRate);
      }
    } catch (caughtErr) {
      console.warn('[MobileCatalogSync] Error leyendo caché local de ajustes:', caughtErr?.message || caughtErr);
    }

    try {
      const [bizRes, rateRes] = await Promise.allSettled([
        api.get('/settings/business', { timeout: 3500 }),
        api.get('/settings/rate', { timeout: 3500 })
      ]);

      if (bizRes.status === 'fulfilled' && bizRes.value.data) {
        setBusinessInfo((prev) => {
          const updated = { ...prev, ...bizRes.value.data };
          try { localStorage.setItem('pos_cached_business_info', JSON.stringify(updated)); } catch { /* noop */ }
          return updated;
        });
        if (bizRes.value.data.businessMode) {
          const modeUpper = bizRes.value.data.businessMode.toUpperCase();
          setBusinessMode(modeUpper);
          localStorage.setItem('pos_business_mode', modeUpper);
        }
      }

      let rateLoaded = false;
      if (rateRes.status === 'fulfilled' && rateRes.value.data?.rate) {
        const rateVal = parseFloat(rateRes.value.data.rate);
        if (rateVal && !isNaN(rateVal)) {
          setExchangeRate(rateVal);
          try { localStorage.setItem('pos_cached_exchange_rate', String(rateVal)); } catch { /* noop */ }
          rateLoaded = true;
        }
      }

      if (!rateLoaded && hasSupabaseConfig()) {
        try {
          const cloudRes = await fetch(getSupabaseRestUrl('cloud_configuracion?id=eq.general&select=*'), {
            headers: getSupabaseHeaders()
          });
          if (cloudRes.ok) {
            const rows = await cloudRes.json();
            if (Array.isArray(rows) && rows.length > 0 && rows[0].tasa_cambio) {
              const cloudRate = parseFloat(rows[0].tasa_cambio);
              if (cloudRate && !isNaN(cloudRate) && cloudRate > 0) {
                setExchangeRate((prev) => {
                  if (prev !== cloudRate) {
                    showToast('💱 Tasa oficial desde la Nube: Bs. ' + cloudRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                  }
                  return cloudRate;
                });
                try {
                  localStorage.setItem('pos_cached_exchange_rate', String(cloudRate));
                  localStorage.setItem('pos_exchange_rate', String(cloudRate));
                } catch { /* noop */ }
              }
            }
          }
        } catch (caughtErr) {
          console.warn('[MobileCatalogSync] Error consultando tasa nube:', caughtErr?.message || caughtErr);
        }
      }
    } catch (e) {
      console.warn('Notice loading business settings:', e);
    }
  }, [showToast]);

  const loadPromotions = useCallback(async () => {
    try {
      if (localDb && localDb.promotions) {
        const cachedPromos = await localDb.promotions.toArray();
        if (Array.isArray(cachedPromos) && cachedPromos.length > 0) {
          setPromotions(cachedPromos.filter((p) => p.isActive));
        }
      }
    } catch { /* noop */ }

    try {
      const res = await api.get('/promotions', { timeout: 3500 });
      const raw = Array.isArray(res.data) ? res.data : (res.data?.promotions || []);
      const active = raw.filter((p) => p.isActive);
      setPromotions(active);
      if (localDb && localDb.promotions) {
        localDb.promotions.clear().then(() => localDb.promotions.bulkPut(active)).catch(() => {});
      }
    } catch {
      // Preservar promociones locales offline
    }
  }, []);

  const loadProducts = useCallback(async (isRetry = false, forceFull = false) => {
    const isForceFull = forceFull === true;
    const isRetryRun = isRetry === true;

    let localCount = 0;
    let localItems = [];
    try {
      if (localDb && localDb.products) {
        localItems = await localDb.products.toArray();
      }
      if ((!localItems || localItems.length === 0) && primaryDb) {
        localItems = await primaryDb.getAll('products');
      }
      if (localItems && localItems.length > 0) {
        localCount = localItems.length;
        const localSig = computeCatalogSignature(localItems);
        if (catalogSignatureRef.current !== localSig) {
          catalogSignatureRef.current = localSig;
          setProducts(localItems);
        }
      }
    } catch (caughtErr) {
      console.warn('[MobileCatalogSync] Error leyendo catálogo local:', caughtErr?.message || caughtErr);
    }

    const computePendingDeductions = async () => {
      const pendingDeductions = new Map();
      try {
        if (localDb && localDb.sales) {
          const pendSales = await localDb.sales.where('status').equals('pending_sync').toArray();
          for (const s of pendSales) {
            const items = Array.isArray(s.items) ? s.items : [];
            for (const it of items) {
              const pid = getCleanProductId(it.productId || it.id || '');
              const qty = Number(it.quantity || 0);
              const mult = Math.max(1, Number(it.factorConversion || it.unitsMultiplier || (it.isBulk ? it.unitsPerBulk : (it.isMidBulk ? it.unitsPerMidBulk : 1)) || 1));
              if (pid && qty > 0) {
                pendingDeductions.set(pid, (pendingDeductions.get(pid) || 0) + (qty * mult));
              }
            }
          }
        }
      } catch (caughtErr) {
        console.warn('[MobileCatalogSync] Error leyendo ventas pendientes:', caughtErr?.message || caughtErr);
      }
      return pendingDeductions;
    };

    const applyPendingStockAdjustments = (list, pendingDeductions) => {
      if (!pendingDeductions || pendingDeductions.size === 0) return list;
      return list.map((p) => {
        const deduct = pendingDeductions.get(String(p.id).trim()) || 0;
        if (deduct <= 0) return p;
        const curStock = Number(p.stockQuantity ?? p.stock ?? 0);
        const nextStock = Math.max(0, Number((curStock - deduct).toFixed(3)));
        return { ...p, stockQuantity: nextStock, stock: nextStock };
      });
    };

    const PRODUCTS_LAST_SYNC_KEY = 'pos_mobile_products_last_sync';
    try {
      const lastSyncIso = !isForceFull && localCount > 0 ? localStorage.getItem(PRODUCTS_LAST_SYNC_KEY) : null;
      if (lastSyncIso) {
        const deltaRes = await api.get(`/products?minimal=true&limit=0&since=${encodeURIComponent(lastSyncIso)}`, { timeout: 10000 });
        const deltaPayload = deltaRes?.data;
        if (deltaPayload && deltaPayload.delta === true && deltaPayload.fullSyncRequired !== true) {
          if (loadProductsRetryTimerRef.current) {
            clearTimeout(loadProductsRetryTimerRef.current);
            loadProductsRetryTimerRef.current = null;
          }
          const changedProducts = Array.isArray(deltaPayload.products) ? deltaPayload.products : [];
          const deletedIds = Array.isArray(deltaPayload.deletedIds) ? deltaPayload.deletedIds.map(String) : [];
          if (deltaPayload.serverTime) {
            try { localStorage.setItem(PRODUCTS_LAST_SYNC_KEY, deltaPayload.serverTime); } catch { /* noop */ }
          }

          if (changedProducts.length > 0 || deletedIds.length > 0) {
            const pendingDeductions = await computePendingDeductions();
            const adjustedDelta = applyPendingStockAdjustments(changedProducts, pendingDeductions);
            const catalogMap = new Map();
            for (const p of localItems) {
              if (p && p.id != null) catalogMap.set(String(p.id), p);
            }
            for (const delId of deletedIds) {
              if (!delId.startsWith('off_prod_')) catalogMap.delete(delId);
            }
            for (const prod of adjustedDelta) {
              if (prod && prod.id != null) catalogMap.set(String(prod.id), prod);
            }
            const nextCatalog = Array.from(catalogMap.values());
            catalogSignatureRef.current = computeCatalogSignature(nextCatalog);
            setProducts(nextCatalog);

            setTimeout(async () => {
              try {
                if (adjustedDelta.length > 0 && primaryDb?.putBatch) {
                  await primaryDb.putBatch('products', adjustedDelta).catch(() => {});
                }
                for (const delId of deletedIds) {
                  if (!delId.startsWith('off_prod_')) {
                    await primaryDb.delete('products', delId).catch(() => {});
                  }
                }
                if (adjustedDelta.length > 0) {
                  cacheAllProductImages(adjustedDelta, { concurrency: 2, yieldMs: 25 }).catch(() => {});
                }
              } catch { /* noop */ }
            }, 150);
          }
          return;
        }
      }
    } catch (deltaErr) {
      console.warn('[MobilePOSSimulator] Delta sync no disponible, continuando con carga completa:', deltaErr?.message || deltaErr);
    }

    try {
      const [activeRes, inactiveRes] = await Promise.allSettled([
        api.get('/products?minimal=true&limit=0&delta=true', { timeout: 15000 }),
        api.get('/products?minimal=true&limit=0&status=inactive', { timeout: 15000 })
      ]);

      const extractList = (settled) => {
        if (settled.status !== 'fulfilled' || !settled.value?.data) return [];
        const d = settled.value.data;
        return Array.isArray(d) ? d : (d.products || []);
      };

      const activeServerTime = activeRes.status === 'fulfilled' ? activeRes.value?.data?.serverTime : null;
      const activeList = extractList(activeRes);
      const inactiveList = extractList(inactiveRes);

      const mergedMap = new Map();
      activeList.forEach((p) => { if (p && p.id != null) mergedMap.set(String(p.id), p); });
      inactiveList.forEach((p) => {
        if (p && p.id != null && !mergedMap.has(String(p.id))) mergedMap.set(String(p.id), p);
      });
      const raw = Array.from(mergedMap.values());

      if (raw.length > 0) {
        if (loadProductsRetryTimerRef.current) {
          clearTimeout(loadProductsRetryTimerRef.current);
          loadProductsRetryTimerRef.current = null;
        }
        try {
          localStorage.setItem(PRODUCTS_LAST_SYNC_KEY, activeServerTime || new Date().toISOString());
        } catch { /* noop */ }

        const pendingDeductions = await computePendingDeductions();
        const adjustedRaw = applyPendingStockAdjustments(raw, pendingDeductions);

        const remoteSig = computeCatalogSignature(adjustedRaw);
        if (isForceFull || catalogSignatureRef.current !== remoteSig || adjustedRaw.length !== localCount) {
          let mergedCatalog = adjustedRaw;
          try {
            const existingAll = await primaryDb.getAll('products').catch(() => []);
            const incomingIds = new Set(adjustedRaw.map((p) => String(p.id)).filter(Boolean));
            const offlineOnly = (existingAll || []).filter(
              (p) => p?.id && String(p.id).startsWith('off_prod_') && !incomingIds.has(String(p.id))
            );
            if (offlineOnly.length > 0) mergedCatalog = [...offlineOnly, ...adjustedRaw];
          } catch { /* mantener catálogo remoto */ }

          catalogSignatureRef.current = remoteSig;
          setProducts(mergedCatalog);
          setTimeout(async () => {
            try {
              await primaryDb.replaceAllAtomic('products', mergedCatalog, 'id').catch(() => {});
              cacheAllProductImages(adjustedRaw, { concurrency: 2, yieldMs: 25 }).catch(() => {});
            } catch { /* noop */ }
          }, 400);
        }
      } else if (!isRetryRun) {
        loadProductsRetryTimerRef.current = setTimeout(() => {
          loadProductsRef.current?.(true);
        }, 2200);
      }
    } catch (netErr) {
      console.warn('[MobilePOSSimulator] Error cargando productos:', netErr?.message || netErr);
      if (!isRetryRun) {
        loadProductsRetryTimerRef.current = setTimeout(() => {
          loadProductsRef.current?.(true);
        }, 2200);
      }
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    if (localDb && localDb.customers) {
      try {
        const localC = await localDb.customers.toArray();
        if (localC && localC.length > 0) setCustomers(localC);
      } catch { /* noop */ }
    }
    try {
      const res = await api.get('/customers?limit=100', { timeout: 3500 });
      const raw = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
      if (raw.length > 0) {
        setCustomers(raw);
        if (localDb && localDb.customers) {
          localDb.customers.bulkPut(raw).catch(() => {});
        }
      }
    } catch { /* Modo offline */ }
  }, []);

  const syncOfflineSalesQueue = useCallback(async () => {
    if (isSyncingSales || syncManager.isSyncing || window.__posOfflineSalesSyncLock) return;
    try {
      const countsBefore = await syncManager.getPendingCount();
      if (countsBefore.total === 0) {
        setPendingSalesCount((prev) => (prev !== 0 ? 0 : prev));
        return;
      }

      setIsSyncingSales(true);
      const result = await syncManager.executeBatchSync();
      const totalSynced = (result?.syncedSales || 0) + (result?.syncedQueue || 0);
      await countPendingOfflineSales();

      if (totalSynced > 0) {
        showToast(`✅ ${totalSynced} operación(es) offline sincronizada(s) con el servidor PC`);
        loadSalesHistoryRef.current?.();
        loadProductsRef.current?.();
        loadCustomersRef.current?.();
        if (lanSyncService && lanSyncService.socket) {
          lanSyncService.socket.emit('inventory_changed', { timestamp: Date.now() });
        }
      }
    } catch (syncErr) {
      console.warn('[MOBILE SYNC] Servidor PC no respondió durante sincronización:', syncErr.message);
    } finally {
      setIsSyncingSales(false);
    }
  }, [isSyncingSales, countPendingOfflineSales, showToast]);

  useEffect(() => {
    loadProductsRef.current = loadProducts;
    loadSettingsRef.current = loadSettings;
    loadCustomersRef.current = loadCustomers;
    loadPromotionsRef.current = loadPromotions;
    loadSalesHistoryRef.current = loadSalesHistory;
    syncOfflineSalesQueueRef.current = syncOfflineSalesQueue;
  });

  useEffect(() => {
    if (activeModule === 'sales' || activeModule === 'cash') {
      loadSalesHistoryRef.current?.();
    }
  }, [activeModule]);

  // Carga inicial escalonada y enlace espejo en tiempo real
  useEffect(() => {
    if (!user) return;

    loadSettingsRef.current?.();
    loadProductsRef.current?.();

    const secondaryInitTimer = setTimeout(() => {
      loadCustomersRef.current?.();
      loadPromotionsRef.current?.();
      countPendingOfflineSales();
    }, 800);

    lanSyncService.init();
    if (lanSyncService.socket?.connected || lanSyncService.status?.state === 'CLOUD_ONLINE' || lanSyncService.status?.state === 'LAN_P2P_ACTIVE') {
      setLanSocketConnected(true);
      setIsOnline(true);
    }

    const unsubscribeLAN = lanSyncService.subscribe((status) => {
      const isLive = status?.state === 'CLOUD_ONLINE' || status?.state === 'LAN_P2P_ACTIVE' || Boolean(lanSyncService?.socket?.connected);
      setLanSocketConnected(isLive);
      if (isLive) setIsOnline(true);
    });

    const handleConnect = () => {
      setLanSocketConnected(true);
      setIsOnline(true);
      loadProductsRef.current?.();
      loadSettingsRef.current?.();
      syncOfflineSalesQueueRef.current?.();
    };
    const handleDisconnect = () => setLanSocketConnected(false);
    const handleNetworkOnline = () => {
      setIsOnline(true);
      loadProductsRef.current?.();
      loadSettingsRef.current?.();
      syncOfflineSalesQueueRef.current?.();
    };
    const handleNetworkOffline = () => {
      setIsOnline(false);
      setLanSocketConnected(false);
    };
    const handleRemoteInventoryChange = () => loadProductsRef.current?.();
    const handleRemoteProductUpdate = (updatedProduct) => {
      if (!updatedProduct) return;
      setProducts((prev) => prev.map((p) => (String(p.id) === String(updatedProduct.id) ? { ...p, ...updatedProduct } : p)));
      if (localDb && localDb.products) localDb.products.put(updatedProduct).catch(() => {});
    };
    const handleStockUpdate = (evt) => {
      const items = evt.detail || [];
      if (Array.isArray(items) && items.length > 0) {
        setProducts((prev) => prev.map((p) => {
          const match = items.find((it) => String(it.productId || it.id) === String(p.id));
          if (match) {
            const cur = Number(p.stockQuantity ?? p.stock ?? 0);
            const next = Math.max(0, cur - Number(match.quantity || 1));
            return { ...p, stockQuantity: next, stock: next };
          }
          return p;
        }));
      }
    };
    const handleServerDiscovered = () => {
      loadProductsRef.current?.();
      loadSettingsRef.current?.();
      syncOfflineSalesQueueRef.current?.();
      syncManager.executeBatchSync();
    };
    const handleSyncQueueUpdated = () => countPendingOfflineSales();
    const handleLanSyncTrigger = () => syncOfflineSalesQueueRef.current?.();
    const handleSettingsChanged = (payload) => {
      if (payload?.rate) {
        const newRate = parseFloat(payload.rate);
        if (!isNaN(newRate) && newRate > 0) {
          setExchangeRate(newRate);
          try { localStorage.setItem('pos_cached_exchange_rate', String(newRate)); } catch { /* noop */ }
          showToast(`💱 Tasa oficial actualizada en tiempo real: Bs. ${newRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        }
      }
      loadSettingsRef.current?.();
    };
    const handleRemoteCustomersChanged = () => loadCustomersRef.current?.();
    const handleRemotePromotionsChanged = () => loadPromotionsRef.current?.();
    const handleRemoteSaleCompleted = () => {
      loadProductsRef.current?.();
      if (activeModuleRef.current === 'sales' || activeModuleRef.current === 'cash') {
        loadSalesHistoryRef.current?.();
      }
    };
    const handleRemoteHeldSaleClaimed = (claimPayload) => {
      const claimedId = String(claimPayload?.id || claimPayload?.code || '');
      if (!claimedId) return;
      setHeldSales((prev) => prev.filter((s) => String(s.id) !== claimedId && String(s.code || '') !== claimedId));
    };

    window.addEventListener('online', handleNetworkOnline);
    window.addEventListener('offline', handleNetworkOffline);
    window.addEventListener('lan-sync-trigger', handleLanSyncTrigger);
    window.addEventListener('lan-stock-update-received', handleStockUpdate);
    window.addEventListener('server-discovered', handleServerDiscovered);
    window.addEventListener('offline-sales-synced', handleSyncQueueUpdated);
    window.addEventListener('sync-queue-updated', handleSyncQueueUpdated);

    const primarySocket = lanSyncService.socket || socketContext?.socket || null;
    if (primarySocket) {
      primarySocket.on('connect', handleConnect);
      primarySocket.on('disconnect', handleDisconnect);
      primarySocket.on('inventory_changed', handleRemoteInventoryChange);
      primarySocket.on('product_updated', handleRemoteProductUpdate);
      primarySocket.on('settings_changed', handleSettingsChanged);
      primarySocket.on('customers_changed', handleRemoteCustomersChanged);
      primarySocket.on('promotions_updated', handleRemotePromotionsChanged);
      primarySocket.on('promotions_changed', handleRemotePromotionsChanged);
      primarySocket.on('sale_completed', handleRemoteSaleCompleted);
      primarySocket.on('remote_held_sale_claimed', handleRemoteHeldSaleClaimed);
    }

    const stopAutoSyncDaemon = syncManager.startAutoSync(15000);
    cloudRateSyncService.init();
    const unsubCloudRate = cloudRateSyncService.subscribe((data) => {
      if (data?.rate && !isNaN(data.rate) && data.rate > 0) {
        setExchangeRate((prev) => {
          if (prev !== data.rate) {
            showToast('⚡ Tasa oficial actualizada: Bs. ' + data.rate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          }
          return data.rate;
        });
      }
    });

    const handleRateUpdatedEvent = (e) => {
      if (e?.detail?.rate) {
        const val = Number(e.detail.rate);
        if (!isNaN(val) && val > 0) {
          setExchangeRate((prev) => {
            if (prev !== val) {
              showToast('⚡ Tasa oficial actualizada: Bs. ' + val.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            }
            return val;
          });
        }
      }
    };
    window.addEventListener('pos-exchange-rate-updated', handleRateUpdatedEvent);

    const unsubSpooler = mobilePrinterService.subscribeQueue((status) => setPrinterSpoolerStatus(status));
    const handleMuteChange = (e) => {
      if (e.detail?.muted !== undefined) setIsAudioMuted(e.detail.muted);
    };
    window.addEventListener('pos-sound-mute-changed', handleMuteChange);

    const syncInterval = setInterval(() => {
      syncOfflineSalesQueueRef.current?.();
    }, 30000);

    return () => {
      if (primarySocket) {
        primarySocket.off('connect', handleConnect);
        primarySocket.off('disconnect', handleDisconnect);
        primarySocket.off('inventory_changed', handleRemoteInventoryChange);
        primarySocket.off('product_updated', handleRemoteProductUpdate);
        primarySocket.off('settings_changed', handleSettingsChanged);
        primarySocket.off('customers_changed', handleRemoteCustomersChanged);
        primarySocket.off('promotions_updated', handleRemotePromotionsChanged);
        primarySocket.off('promotions_changed', handleRemotePromotionsChanged);
        primarySocket.off('sale_completed', handleRemoteSaleCompleted);
        primarySocket.off('remote_held_sale_claimed', handleRemoteHeldSaleClaimed);
      }
      if (typeof stopAutoSyncDaemon === 'function') stopAutoSyncDaemon();
      if (typeof unsubCloudRate === 'function') unsubCloudRate();
      window.removeEventListener('pos-exchange-rate-updated', handleRateUpdatedEvent);
      unsubSpooler();
      unsubscribeLAN();
      window.removeEventListener('pos-sound-mute-changed', handleMuteChange);
      window.removeEventListener('online', handleNetworkOnline);
      window.removeEventListener('offline', handleNetworkOffline);
      window.removeEventListener('lan-sync-trigger', handleLanSyncTrigger);
      window.removeEventListener('lan-stock-update-received', handleStockUpdate);
      window.removeEventListener('server-discovered', handleServerDiscovered);
      window.removeEventListener('offline-sales-synced', handleSyncQueueUpdated);
      window.removeEventListener('sync-queue-updated', handleSyncQueueUpdated);
      clearInterval(syncInterval);
      clearTimeout(secondaryInitTimer);
      if (loadProductsRetryTimerRef.current) clearTimeout(loadProductsRetryTimerRef.current);
    };
  }, [user, socketContext?.socket, showToast, setHeldSales, countPendingOfflineSales]);

  return {
    socket,
    isOnline,
    socketConnected,
    pendingSalesCount,
    setPendingSalesCount,
    isSyncingSales,
    salesHistory,
    setSalesHistory,
    mobileServerIp,
    setMobileServerIp,
    serverHealth,
    isTestingServer,
    serverFeedback,
    setServerFeedback,
    handleTestAndSaveServer,
    handleAutoDiscoverServer,
    businessInfo,
    setBusinessInfo,
    exchangeRate,
    setExchangeRate,
    businessMode,
    products,
    setProducts,
    promotions,
    customers,
    setCustomers,
    isAudioMuted,
    setIsAudioMuted,
    printerSpoolerStatus,
    countPendingOfflineSales,
    loadSalesHistory,
    syncOfflineSalesQueue,
    loadSettings,
    loadPromotions,
    loadProducts,
    loadCustomers
  };
}
