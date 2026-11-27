import api from './api';
import { db as primaryDb } from './db';
import db from '../db/localDb';
import { recordDiagnosticEvent } from './mobileDiagnosticsService';

const SYNC_ALERTS_STORAGE_KEY = 'pos_mobile_sync_alerts_v1';

const pushSyncAlertRecord = (alertObj) => {
  if (typeof window === 'undefined' || !alertObj) return;
  try {
    const raw = localStorage.getItem(SYNC_ALERTS_STORAGE_KEY) || sessionStorage.getItem(SYNC_ALERTS_STORAGE_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev) ? prev : [];
    list.unshift({
      id: alertObj.id || `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...alertObj
    });
    const serialized = JSON.stringify(list.slice(0, 50));
    localStorage.setItem(SYNC_ALERTS_STORAGE_KEY, serialized);
  } catch {
    // Ignorar si almacenamiento local no está disponible
  }
};

const normalizeQueueEndpoint = (ep) => String(ep || '').trim().toLowerCase();

const getPreSalesPriority = (item) => {
  const ep = normalizeQueueEndpoint(item?.endpoint);
  const method = String(item?.method || 'POST').toLowerCase();
  if (ep === '/customers' || ep.startsWith('/customers/')) return method === 'post' ? 10 : 15;
  if (ep === '/products' || (ep.startsWith('/products/') && !ep.endsWith('/stock-count'))) return method === 'post' ? 20 : 25;
  if (ep === '/cash/open') return 30;
  return null;
};

const getPostSalesPriority = (item) => {
  const ep = normalizeQueueEndpoint(item?.endpoint);
  if (ep === '/cash/close' || ep === '/cash/close-blind') return 90;
  if (ep === '/refunds' || ep.startsWith('/refunds/')) return 70;
  if (ep === '/cash/movement') return 40;
  if (ep === '/expenses' || ep.startsWith('/expenses/')) return 50;
  if (ep.endsWith('/stock-count')) return 55;
  return 60;
};

class SyncManager {
  constructor() {
    this.syncInterval = null;
    this.retryTimer = null;
    this.isSyncing = false;
    this.batchSize = 50;
    this.syncEndpoint = '/sales/public-sync';
    this.retryDelay = 5000;
    this.maxRetryDelay = 60000;
    this.consecutiveFailures = 0;
  }

  canAttemptNetworkSync() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Permitir intento únicamente si el endpoint apunta a un servidor LAN local (Wi-Fi sin salida WAN)
      const baseUrl = String(api?.defaults?.baseURL || '');
      const isLocalLan = /localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\./i.test(baseUrl);
      return isLocalLan;
    }
    return true;
  }

  clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  scheduleBackoffRetry() {
    this.clearRetryTimer();
    if (!this.canAttemptNetworkSync()) return;

    const expDelay = Math.min(
      this.maxRetryDelay,
      this.retryDelay * Math.pow(2, Math.min(this.consecutiveFailures, 4))
    );
    const jitter = Math.floor(Math.random() * 1000);
    const nextDelay = expDelay + jitter;
    this.consecutiveFailures += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.executeBatchSync();
    }, nextDelay);
  }

  /**
   * Obtiene el conteo total real de operaciones offline pendientes (Ventas + Cola de Acciones + Clientes).
   */
  async getPendingCount() {
    let salesCount = 0;
    let queueCount = 0;
    let quarantinedCount = 0;

    try {
      if (db && db.sales) {
        salesCount = await db.sales.where('status').equals('pending_sync').count();
        quarantinedCount = await db.sales.where('status').equals('quarantined').count();
      } else {
        const byPending = await primaryDb.getByIndex('sales', 'status', 'pending_sync').catch(() => []);
        salesCount = Array.isArray(byPending) ? byPending.length : 0;
        const byQuarantined = await primaryDb.getByIndex('sales', 'status', 'quarantined').catch(() => []);
        quarantinedCount = Array.isArray(byQuarantined) ? byQuarantined.length : 0;
      }
    } catch (_salesErr) {
      console.warn('[SyncManager] Error leyendo ventas pendientes locales:', _salesErr?.message || _salesErr);
    }

    let syncErrorCount = 0;
    try {
      const queueItems = await primaryDb.getAll('syncQueue').catch(() => []);
      if (Array.isArray(queueItems)) {
        const activeItems = queueItems.filter(i => !i?.failedPermanent && i?.status !== 'sync_error');
        queueCount = activeItems.length;
        syncErrorCount = queueItems.length - activeItems.length;
      }
    } catch (_queueErr) {
      console.warn('[SyncManager] Error leyendo cola syncQueue local:', _queueErr?.message || _queueErr);
    }

    return {
      total: salesCount + queueCount,
      salesCount,
      queueCount,
      quarantinedCount: quarantinedCount + syncErrorCount,
      syncErrorCount
    };
  }

  /**
   * Reconcilia un cliente creado offline (cust_off_...) reemplazándolo por su registro oficial del servidor
   * y actualizando cualquier venta offline pendiente que apuntara al ID temporal.
   */
  async reconcileOfflineCustomer(tempPayload, serverCustomer, explicitTempId = null) {
    if (!serverCustomer || !serverCustomer.id) return;
    const realId = String(serverCustomer.id);
    const tempIdsToPurge = new Set();
    if (explicitTempId && String(explicitTempId) !== realId) {
      tempIdsToPurge.add(String(explicitTempId));
    }

    try {
      if (db && db.customers) {
        const allLocal = await db.customers.toArray();
        const targetName = String(tempPayload?.name || serverCustomer.name || '').trim().toLowerCase();
        const targetDoc = String(tempPayload?.idDocument || serverCustomer.idDocument || '').trim().toLowerCase();

        for (const c of allLocal) {
          const cid = String(c.id || '');
          if (cid === realId) continue;
          const isTemp = cid.startsWith('cust_off_') || cid.startsWith('cust_offline_') || cid.startsWith('CUST-') || c.status === 'pending_sync';
          if (!isTemp) continue;

          const cName = String(c.name || c.nombre || '').trim().toLowerCase();
          const cDoc = String(c.idDocument || c.identification || '').trim().toLowerCase();
          if ((targetName && cName === targetName) || (targetDoc && targetDoc !== 'v-00000000' && cDoc === targetDoc)) {
            tempIdsToPurge.add(cid);
          }
        }

        for (const oldId of tempIdsToPurge) {
          await db.customers.delete(oldId).catch((e) => console.warn('[SyncManager] Error eliminando cliente temporal local:', oldId, e?.message || e));
          await primaryDb.delete('customers', oldId).catch((e) => console.warn('[SyncManager] Error eliminando cliente temporal primaryDb:', oldId, e?.message || e));
        }

        const syncedRecord = { ...serverCustomer, status: 'synced', syncedAt: new Date().toISOString() };
        await db.customers.put(syncedRecord).catch((e) => console.warn('[SyncManager] Error guardando cliente reconciliado:', e?.message || e));
        await primaryDb.put('customers', syncedRecord).catch((e) => console.warn('[SyncManager] Error guardando cliente primaryDb:', e?.message || e));
      }
    } catch (_recErr) {
      console.warn('[SyncManager] Error purgando ID temporal de cliente:', _recErr?.message || _recErr);
    }

    // Actualizar ventas pendientes que referenciaban el ID temporal del cliente
    if (tempIdsToPurge.size > 0) {
      try {
        if (db && db.sales) {
          const pendingSales = await db.sales.where('status').equals('pending_sync').toArray();
          for (const sale of pendingSales) {
            if (sale.customerId && tempIdsToPurge.has(String(sale.customerId))) {
              await db.sales.update(sale.id, { customerId: realId });
              const pSale = await primaryDb.getById('sales', sale.id).catch((e) => {
                console.warn('[SyncManager] Error leyendo venta pendiente para actualizar cliente:', sale.id, e?.message || e);
                return null;
              });
              if (pSale) {
                await primaryDb.put('sales', { ...pSale, customerId: realId }).catch((e) => console.warn('[SyncManager] Error actualizando venta primaryDb:', sale.id, e?.message || e));
              }
            }
          }
        }
      } catch (_updCustErr) {
        console.warn('[SyncManager] Error actualizando customerId en ventas pendientes:', _updCustErr?.message || _updCustErr);
      }
    }
  }

  /**
   * Reconcilia un producto creado offline (off_prod_...) reemplazándolo por su registro oficial del servidor
   * y actualizando cualquier venta offline pendiente que apuntara al ID temporal.
   */
  async reconcileOfflineProduct(tempPayload, serverProduct, explicitTempId = null) {
    if (!serverProduct || !serverProduct.id) return;
    const realId = String(serverProduct.id);
    const tempIdsToPurge = new Set();
    if (explicitTempId && String(explicitTempId) !== realId) {
      tempIdsToPurge.add(String(explicitTempId));
    }

    try {
      if (db && db.products) {
        const allLocal = await db.products.toArray();
        const targetName = String(tempPayload?.name || serverProduct.name || '').trim().toLowerCase();
        const targetBarcode = String(tempPayload?.barcode || serverProduct.barcode || '').trim();

        for (const p of allLocal) {
          const pid = String(p.id || '');
          if (pid === realId || (!pid.startsWith('off_prod_') && !pid.startsWith('offline_'))) continue;
          const pName = String(p.name || p.nombre || '').trim().toLowerCase();
          const pBarcode = String(p.barcode || p.codigo_barras || '').trim();
          if ((targetName && pName === targetName) || (targetBarcode && pBarcode === targetBarcode)) {
            tempIdsToPurge.add(pid);
          }
        }

        for (const oldId of tempIdsToPurge) {
          await db.products.delete(oldId).catch((e) => console.warn('[SyncManager] Error eliminando producto temporal local:', oldId, e?.message || e));
          await primaryDb.delete('products', oldId).catch((e) => console.warn('[SyncManager] Error eliminando producto temporal primaryDb:', oldId, e?.message || e));
        }

        await db.products.put(serverProduct).catch((e) => console.warn('[SyncManager] Error guardando producto reconciliado:', e?.message || e));
        await primaryDb.put('products', serverProduct).catch((e) => console.warn('[SyncManager] Error guardando producto primaryDb:', e?.message || e));
      }
    } catch (_recProdErr) {
      console.warn('[SyncManager] Error purgando ID temporal de producto:', _recProdErr?.message || _recProdErr);
    }

    // Actualizar ítems en ventas pendientes que referenciaban el producto temporal
    if (tempIdsToPurge.size > 0) {
      try {
        if (db && db.sales) {
          const pendingSales = await db.sales.where('status').equals('pending_sync').toArray();
          for (const sale of pendingSales) {
            if (!Array.isArray(sale.items)) continue;
            let touched = false;
            const updatedItems = sale.items.map(it => {
              const itId = String(it.productId || it.id || '');
              if (tempIdsToPurge.has(itId)) {
                touched = true;
                return { ...it, id: realId, productId: realId, producto_id: realId };
              }
              return it;
            });
            if (touched) {
              await db.sales.update(sale.id, { items: updatedItems });
              const pSale = await primaryDb.getById('sales', sale.id).catch(() => null);
              if (pSale) {
                await primaryDb.put('sales', { ...pSale, items: updatedItems }).catch(() => {});
              }
            }
          }
        }
      } catch (_updProdErr) {
        console.warn('[SyncManager] Error actualizando productId en ventas pendientes:', _updProdErr?.message || _updProdErr);
      }
    }
  }

  startAutoSync(intervalMs = 15000) {
    if (this.syncInterval) return () => this.stopAutoSync();

    window.addEventListener('online', this.handleOnlineEvent);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('lan-sync-trigger', this.handleSyncTrigger);
    window.addEventListener('server-discovered', this.handleSyncTrigger);

    this.syncInterval = setInterval(() => {
      if (this.canAttemptNetworkSync()) {
        this.executeBatchSync();
      }
    }, intervalMs);
    return () => this.stopAutoSync();
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.clearRetryTimer();
    window.removeEventListener('online', this.handleOnlineEvent);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('lan-sync-trigger', this.handleSyncTrigger);
    window.removeEventListener('server-discovered', this.handleSyncTrigger);
  }

  handleOnlineEvent = () => {
    this.consecutiveFailures = 0;
    this.clearRetryTimer();
    setTimeout(() => this.executeBatchSync(), 600);
  };

  handleSyncTrigger = () => {
    console.log('[SyncManager] ⚡ Disparador de sincronización LAN recibido');
    this.consecutiveFailures = 0;
    this.clearRetryTimer();
    setTimeout(() => this.executeBatchSync(), 350);
  };

  handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.canAttemptNetworkSync()) {
      this.executeBatchSync();
    }
  };

  /**
   * Reconcilia un turno de caja abierto offline (shift_off_...) reemplazando su ID temporal
   * en almacenamiento local, localStorage, syncQueue (movimientos/cierres) y ventas pendientes.
   */
  async reconcileOfflineShift(tempShiftId, serverShift) {
    if (!serverShift?.id || !tempShiftId || String(tempShiftId) === String(serverShift.id)) return;
    const oldId = String(tempShiftId);
    const realId = String(serverShift.id);

    try {
      await primaryDb.delete('cashShifts', oldId).catch(() => {});
      await primaryDb.put('cashShifts', { ...serverShift, status: serverShift.status || 'open', isOffline: false }).catch(() => {});
    } catch (_shiftErr) {
      console.warn('[SyncManager] Error actualizando cashShift local tras sync:', _shiftErr?.message || _shiftErr);
    }

    try {
      const rawCurrent = localStorage.getItem('pos_mobile_current_shift');
      if (rawCurrent) {
        const parsed = JSON.parse(rawCurrent);
        if (parsed && String(parsed.id) === oldId) {
          localStorage.setItem('pos_mobile_current_shift', JSON.stringify({
            ...parsed,
            ...serverShift,
            id: realId,
            isOffline: false
          }));
        }
      }
    } catch (_lsErr) {
      console.warn('[SyncManager] Error reconciliando pos_mobile_current_shift:', _lsErr?.message || _lsErr);
    }

    try {
      const queueItems = await primaryDb.getAll('syncQueue').catch(() => []);
      if (Array.isArray(queueItems)) {
        for (const qi of queueItems) {
          if (qi?.payload && String(qi.payload.shiftId || '') === oldId) {
            await primaryDb.put('syncQueue', {
              ...qi,
              payload: { ...qi.payload, shiftId: realId }
            }).catch(() => {});
          }
        }
      }
    } catch (_qErr) {
      console.warn('[SyncManager] Error actualizando shiftId en syncQueue:', _qErr?.message || _qErr);
    }

    try {
      if (db && db.sales) {
        const pendingSales = await db.sales.where('status').equals('pending_sync').toArray();
        for (const sale of pendingSales) {
          if (String(sale.cashShiftId || '') === oldId || String(sale.shiftId || '') === oldId) {
            await db.sales.update(sale.id, { cashShiftId: realId, shiftId: realId });
            const pSale = await primaryDb.getById('sales', sale.id).catch(() => null);
            if (pSale) {
              await primaryDb.put('sales', { ...pSale, cashShiftId: realId, shiftId: realId }).catch(() => {});
            }
          }
        }
      }
    } catch (_sErr) {
      console.warn('[SyncManager] Error actualizando shiftId en ventas pendientes:', _sErr?.message || _sErr);
    }
  }

  /**
   * Reconcilia un gasto creado offline (exp_...) actualizando registros locales y endpoints en syncQueue.
   */
  async reconcileOfflineExpense(tempExpId, serverExpense) {
    if (!serverExpense?.id || !tempExpId || String(tempExpId) === String(serverExpense.id)) return;
    const oldId = String(tempExpId);
    const realId = String(serverExpense.id);

    try {
      if (db && db.expenses) {
        await db.expenses.delete(oldId).catch(() => {});
        await db.expenses.put({ ...serverExpense, id: realId, status: 'synced', isOffline: false }).catch(() => {});
      }
      await primaryDb.delete('expenses', oldId).catch(() => {});
      await primaryDb.put('expenses', { ...serverExpense, id: realId, status: 'synced', isOffline: false }).catch(() => {});
    } catch (_expErr) {
      console.warn('[SyncManager] Error reconciliando gasto offline:', _expErr?.message || _expErr);
    }

    try {
      const queueItems = await primaryDb.getAll('syncQueue').catch(() => []);
      if (Array.isArray(queueItems)) {
        for (const qi of queueItems) {
          const ep = String(qi?.endpoint || '');
          if (ep.includes(oldId)) {
            await primaryDb.put('syncQueue', {
              ...qi,
              endpoint: ep.replace(oldId, realId)
            }).catch(() => {});
          }
        }
      }
    } catch (_qErr) {
      console.warn('[SyncManager] Error actualizando endpoint de gasto en syncQueue:', _qErr?.message || _qErr);
    }
  }

  /**
   * Procesa un subconjunto ordenado de syncQueue respetando cortocircuito ante fallos de red/5xx.
   */
  async _processQueueItems(items) {
    let syncedCount = 0;
    let abortedByNetwork = false;

    for (const rawItem of items) {
      // Re-leer desde primaryDb por si un paso previo reconcilió shiftId/endpoint
      const item = (await primaryDb.getById('syncQueue', rawItem.id).catch(() => null)) || rawItem;
      if (!item || item.failedPermanent || item.status === 'sync_error') continue;

      try {
        const method = (item.method || 'POST').toLowerCase();
        const endpoint = String(item.endpoint || '');
        let res;
        if (method === 'put') {
          res = await api.put(endpoint, item.payload, { timeout: 6000 });
        } else if (method === 'patch') {
          res = await api.patch(endpoint, item.payload, { timeout: 6000 });
        } else if (method === 'post') {
          res = await api.post(endpoint, item.payload, { timeout: 6000 });
        } else if (method === 'delete') {
          res = await api.delete(endpoint, { timeout: 6000 });
        }

        if (res && res.status >= 200 && res.status < 300) {
          const tempIdRef = item.tempLocalId || item.tempId || null;
          if (method === 'post' && endpoint === '/customers') {
            const createdCust = res.data?.customer || res.data;
            await this.reconcileOfflineCustomer(item.payload, createdCust, tempIdRef);
          } else if (method === 'post' && endpoint === '/products') {
            const createdProd = res.data?.product || res.data;
            await this.reconcileOfflineProduct(item.payload, createdProd, tempIdRef);
          } else if (method === 'post' && endpoint === '/cash/open') {
            const createdShift = res.data?.shift || res.data;
            if (createdShift?.id && tempIdRef && String(tempIdRef).startsWith('shift_off_')) {
              await this.reconcileOfflineShift(tempIdRef, createdShift);
            }
          } else if (method === 'post' && endpoint === '/expenses') {
            const createdExp = res.data?.expense || res.data;
            if (createdExp?.id && tempIdRef) {
              await this.reconcileOfflineExpense(tempIdRef, createdExp);
            }
          }

          await primaryDb.delete('syncQueue', item.id);
          syncedCount++;
        }
      } catch (itemErr) {
        const status = itemErr.response?.status;
        if (status === 401) {
          throw itemErr;
        }

        const isNetworkOrServerDown = !itemErr.response || itemErr.code === 'ECONNABORTED' || status >= 500 || status === 408 || status === 429;
        if (isNetworkOrServerDown) {
          console.warn(`[SyncManager] Interrumpiendo lote de syncQueue por indisponibilidad (${status || itemErr.code || 'NET'}):`, itemErr.message);
          recordDiagnosticEvent('sync', 'warn', `Lote syncQueue pausado por red/servidor (${status || itemErr.code || 'NET'})`, {
            endpoint: item.endpoint,
            error: itemErr.message
          });
          abortedByNetwork = true;
          this.scheduleBackoffRetry();
          break;
        }

        console.warn('[SyncManager] Error al procesar item en syncQueue:', itemErr.message);
        const retries = (Number(item.retryCount) || 0) + 1;
        if (status === 409) {
          const existingEntity = itemErr.response?.data?.product || itemErr.response?.data?.customer || itemErr.response?.data?.expense || itemErr.response?.data?.existing;
          const tempIdRef = item.tempLocalId || item.tempId || null;
          if (item.endpoint === '/products' && existingEntity?.id && tempIdRef) {
            await this.reconcileOfflineProduct(item.payload, existingEntity, tempIdRef);
          } else if (item.endpoint === '/customers' && existingEntity?.id && tempIdRef) {
            await this.reconcileOfflineCustomer(item.payload, existingEntity, tempIdRef);
          } else if (item.endpoint === '/expenses' && existingEntity?.id && tempIdRef) {
            await this.reconcileOfflineExpense(tempIdRef, existingEntity);
          }
          const conflictDetail = { itemId: item.id, endpoint: item.endpoint, tempLocalId: tempIdRef, error: itemErr.response?.data?.error || itemErr.message };
          pushSyncAlertRecord({
            kind: 'conflict',
            title: `Conflicto en ${item.endpoint || 'operación'}`,
            message: conflictDetail.error || 'Registro duplicado o en conflicto'
          });
          recordDiagnosticEvent('sync', 'warn', `Conflicto 409 en ${item.endpoint}`, conflictDetail);
          window.dispatchEvent(new CustomEvent('sync-queue-conflict', { detail: conflictDetail }));
          await primaryDb.delete('syncQueue', item.id);
        } else if (status === 403) {
          const errDetail = itemErr.response?.data?.error || itemErr.response?.data?.message || 'Sin permisos o licencia inactiva para esta operación';
          if (retries >= 2) {
            await primaryDb.put('syncQueue', {
              ...item,
              status: 'sync_error',
              failedPermanent: true,
              retryCount: retries,
              lastError: errDetail,
              lastHttpStatus: 403,
              failedAt: new Date().toISOString()
            });
            pushSyncAlertRecord({
              kind: 'error',
              title: `Permiso denegado (403) en ${item.endpoint || 'cola'}`,
              message: errDetail
            });
            recordDiagnosticEvent('sync', 'error', `Operación rechazada permanentemente (403) en ${item.endpoint}`, {
              itemId: item.id,
              error: errDetail
            });
            window.dispatchEvent(new CustomEvent('sync-queue-error', {
              detail: { itemId: item.id, endpoint: item.endpoint, status: 403, error: errDetail }
            }));
          } else {
            await primaryDb.put('syncQueue', { ...item, retryCount: retries, lastError: errDetail, lastHttpStatus: 403 });
          }
        } else if (status && status >= 400 && status < 500) {
          const errDetail = itemErr.response?.data?.error || itemErr.response?.data?.message || itemErr.message;
          if (retries >= 3) {
            await primaryDb.put('syncQueue', {
              ...item,
              status: 'sync_error',
              failedPermanent: true,
              retryCount: retries,
              lastError: errDetail,
              lastHttpStatus: status,
              failedAt: new Date().toISOString()
            });
            pushSyncAlertRecord({
              kind: 'error',
              title: `Error permanente (${status}) en ${item.endpoint || 'cola'}`,
              message: errDetail || 'La operación fue rechazada por el servidor'
            });
            recordDiagnosticEvent('sync', 'error', `Operación rechazada permanentemente (${status}) en ${item.endpoint}`, {
              itemId: item.id,
              error: errDetail
            });
            window.dispatchEvent(new CustomEvent('sync-queue-error', {
              detail: { itemId: item.id, endpoint: item.endpoint, status, error: errDetail }
            }));
          } else {
            await primaryDb.put('syncQueue', { ...item, retryCount: retries, lastError: errDetail, lastHttpStatus: status });
          }
        }
      }
    }

    return { syncedCount, abortedByNetwork };
  }

  async executeBatchSync() {
    if (this.isSyncing || window.__posOfflineSalesSyncLock) {
      return { syncedSales: 0, syncedQueue: 0, busy: true };
    }
    if (!this.canAttemptNetworkSync()) {
      return { syncedSales: 0, syncedQueue: 0, offline: true };
    }

    this.isSyncing = true;
    window.__posOfflineSalesSyncLock = true;
    this.clearRetryTimer();

    let queueSyncedCount = 0;
    let salesSyncedCount = 0;

    try {
      const sortByPriorityAndTime = (list, priorityFn) => [...list].sort((a, b) => {
        const pa = priorityFn(a);
        const pb = priorityFn(b);
        if (pa !== pb) return pa - pb;
        return new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime();
      });

      const rawQueueItems = await primaryDb.getAll('syncQueue').catch(() => []);
      const activeQueueItems = Array.isArray(rawQueueItems)
        ? rawQueueItems.filter(i => !i?.failedPermanent && i?.status !== 'sync_error')
        : [];

      const preSalesQueue = sortByPriorityAndTime(
        activeQueueItems.filter(i => getPreSalesPriority(i) !== null),
        getPreSalesPriority
      );
      const postSalesQueue = sortByPriorityAndTime(
        activeQueueItems.filter(i => getPreSalesPriority(i) === null),
        getPostSalesPriority
      );

      // FASE 1 DAG: Prerrequisitos (Clientes -> Productos -> Apertura de Caja)
      if (preSalesQueue.length > 0) {
        console.log(`[SyncManager] DAG Fase 1: Sincronizando ${preSalesQueue.length} prerrequisitos (clientes/productos/apertura)...`);
        const preRes = await this._processQueueItems(preSalesQueue);
        queueSyncedCount += preRes.syncedCount;
        if (preRes.abortedByNetwork) {
          return { syncedSales: 0, syncedQueue: queueSyncedCount, pausedByNetwork: true };
        }
      }

      // FASE 2 DAG: Clientes en tabla local db.customers (pending_sync) antes de subir ventas
      if (db.customers) {
        const pendingCustomers = await db.customers.where('status').equals('pending_sync').limit(this.batchSize).toArray();
        if (pendingCustomers.length > 0) {
          const custRes = await api.post('/customers/public-sync', { customers: pendingCustomers }, { timeout: 10000 }).catch((err) => {
            if (err?.response?.status === 401) throw err;
            return null;
          });
          if (custRes && custRes.status >= 200 && custRes.status < 300) {
            const serverCustomers = Array.isArray(custRes.data?.customers) ? custRes.data.customers : [];
            const idMap = custRes.data?.idMap || {};

            for (const pendingCust of pendingCustomers) {
              const oldId = String(pendingCust.id);
              const mappedId = idMap[oldId];
              const matchedServer = serverCustomers.find(sc => String(sc.id) === String(mappedId || oldId)) || {
                ...pendingCust,
                id: mappedId || oldId
              };
              await this.reconcileOfflineCustomer(pendingCust, matchedServer, oldId);
            }
          }
        }
      }

      // FASE 3 DAG: Puente de ventas offline desde primaryDb a Dexie localDb y envío de Ventas
      try {
        let pendingPrimary = [];
        try {
          const byPendingSync = await primaryDb.getByIndex('sales', 'status', 'pending_sync');
          const byPending = await primaryDb.getByIndex('sales', 'status', 'pending');
          pendingPrimary = [
            ...(Array.isArray(byPendingSync) ? byPendingSync : []),
            ...(Array.isArray(byPending) ? byPending : [])
          ];
        } catch {
          const allSales = await primaryDb.getAll('sales');
          if (Array.isArray(allSales)) {
            pendingPrimary = allSales.filter(s => s.status === 'pending_sync' || s.status === 'pending' || s.isOffline);
          }
        }

        if (pendingPrimary.length > 0 && db.sales) {
          for (const ps of pendingPrimary) {
            const existsInDexie = await db.sales.get(ps.id);
            if (!existsInDexie) {
              await db.sales.put({ ...ps, status: 'pending_sync' });
            }
          }
        }
      } catch (e) {
        console.warn('[SyncManager] Error migrando ventas pendientes desde primaryDb:', e?.message || e);
      }

      const pendingSales = await db.sales
        .where('status')
        .equals('pending_sync')
        .limit(this.batchSize)
        .toArray();

      if (pendingSales.length > 0) {
        console.log(`[SyncManager] DAG Fase 3: Sincronizando ${pendingSales.length} ventas offline hacia el servidor...`);

        const preparedSales = pendingSales.map(sale => ({
          ...sale,
          hmacTimestamp: sale.hmacTimestamp || Date.now().toString(),
          hmacBranchId: sale.branchId || '1'
        }));

        const response = await api.post(
          this.syncEndpoint,
          { sales: preparedSales },
          { timeout: 15000 }
        );

        if (response.status >= 200 && response.status < 300) {
          this.consecutiveFailures = 0;
          const details = response.data?.details || {};
          const syncedIds = Array.isArray(details.success) ? details.success.map((item) => item.id).filter(Boolean) : [];
          const errorItems = details.errors || [];
          salesSyncedCount = syncedIds.length;

          await db.transaction('rw', db.sales, async () => {
            if (syncedIds && syncedIds.length > 0) {
              await db.sales
                .where('id')
                .anyOf(syncedIds)
                .modify({ status: 'synced', isOffline: false, syncedAt: new Date().toISOString() });

              for (const sId of syncedIds) {
                try {
                  const sItem = await primaryDb.getById('sales', sId);
                  if (sItem) {
                    await primaryDb.put('sales', { ...sItem, status: 'synced', isOffline: false, syncedAt: new Date().toISOString() });
                  }
                } catch (_pUpdErr) {
                  console.warn('[SyncManager] Error marcando venta sincronizada en primaryDb:', _pUpdErr?.message || _pUpdErr);
                }
              }
            }

            for (const errItem of errorItems) {
              if (!errItem?.id) continue;
              const isImmediateQuarantine = Boolean(
                errItem.quarantined ||
                errItem.error?.includes('INTEGRITY_ERROR') ||
                errItem.error?.includes('HMAC') ||
                errItem.error?.includes('FRAUDE_')
              );
              const currentSaleRec = await primaryDb.getById('sales', errItem.id).catch(() => null);
              const nextRetries = (Number(currentSaleRec?.syncRetryCount) || 0) + 1;

              if (isImmediateQuarantine || nextRetries >= 3) {
                console.warn(`[OutboxDaemon] Venta ${errItem.id} desviada a cuarentena local en IndexedDB (${nextRetries} intento(s)): ${errItem.error}`);
                recordDiagnosticEvent('sync', 'error', `Venta ${errItem.id} desviada a cuarentena`, {
                  saleId: errItem.id,
                  reason: errItem.error
                });
                await db.sales
                  .where('id')
                  .equals(errItem.id)
                  .modify({
                    status: 'quarantined',
                    syncRetryCount: nextRetries,
                    quarantineReason: errItem.error || 'Error permanente al sincronizar venta',
                    quarantinedAt: new Date().toISOString()
                  });
              } else {
                await db.sales
                  .where('id')
                  .equals(errItem.id)
                  .modify({
                    syncRetryCount: nextRetries,
                    lastSyncError: errItem.error || 'Error temporal al sincronizar venta'
                  });
              }
            }
          });

          if (syncedIds.length > 0) {
            console.log(`[SyncManager] ✅ ${syncedIds.length} venta(s) sincronizada(s) con éxito en el servidor.`);
            window.dispatchEvent(new CustomEvent('offline-sales-synced', { detail: { count: syncedIds.length } }));
            window.dispatchEvent(new CustomEvent('sync-queue-updated', { detail: { count: syncedIds.length } }));

            try {
              const serverWarnings = response.data?.inventoryWarnings || response.data?.stockDeficits || [];
              if (Array.isArray(serverWarnings) && serverWarnings.length > 0) {
                console.warn('[SyncManager] ⚠️ Se detectaron advertencias de inventario diferido tras sincronizar:', serverWarnings);
                for (const w of serverWarnings) {
                  pushSyncAlertRecord({
                    kind: 'stock_deficit',
                    title: `Déficit de stock: ${w.productName || w.productId || 'Producto'}`,
                    message: w.type === 'missing_product'
                      ? `Producto eliminado en PC durante venta offline (${w.soldQuantity || 1} un).`
                      : `Stock esperado: ${w.expectedStock ?? 0}, vendido: ${w.soldQuantity ?? 0}, sobregiro: ${w.overdraftAmount ?? 0}.`
                  });
                }
                window.dispatchEvent(new CustomEvent('lan-stock-deficit-detected', { detail: { warnings: serverWarnings } }));
              }
            } catch (_wErr) {
              console.warn('[SyncManager] Error procesando alertas de inventario diferido:', _wErr?.message || _wErr);
            }
          }
        }
      }

      // FASE 4 DAG: Operaciones dependientes de ventas (Movimientos, Gastos, Conteo, Devoluciones y Cierre Z al final)
      if (postSalesQueue.length > 0) {
        const remainingPendingSales = await db.sales.where('status').equals('pending_sync').count().catch(() => 0);
        // No subir /cash/close ni /cash/close-blind si todavía quedan ventas pendientes sin sincronizar
        const eligiblePostItems = remainingPendingSales > 0
          ? postSalesQueue.filter(i => {
              const ep = normalizeQueueEndpoint(i.endpoint);
              return ep !== '/cash/close' && ep !== '/cash/close-blind';
            })
          : postSalesQueue;

        if (eligiblePostItems.length > 0) {
          console.log(`[SyncManager] DAG Fase 4: Sincronizando ${eligiblePostItems.length} operaciones post-venta (movimientos/gastos/devoluciones/cierre)...`);
          const postRes = await this._processQueueItems(eligiblePostItems);
          queueSyncedCount += postRes.syncedCount;
          if (postRes.abortedByNetwork) {
            return { syncedSales: salesSyncedCount, syncedQueue: queueSyncedCount, pausedByNetwork: true };
          }
        }
      }

      if (queueSyncedCount > 0) {
        window.dispatchEvent(new CustomEvent('sync-queue-updated', { detail: { count: queueSyncedCount } }));
      }

      this.consecutiveFailures = 0;
      return { syncedSales: salesSyncedCount, syncedQueue: queueSyncedCount };
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.warn('[SyncManager] 401 Unauthorized: Sincronización pausada para proteger ventas locales en IndexedDB.');
        this.stopAutoSync();
        window.dispatchEvent(new CustomEvent('auth-unauthorized', {
          detail: { reason: 'Tu sesión ha expirado mientras estabas sin conexión. Inicia sesión nuevamente para sincronizar tus ventas guardadas.' }
        }));
        return { syncedSales: salesSyncedCount, syncedQueue: queueSyncedCount, unauthorized: true };
      }
      const isNetworkError = !error.response || error.code === 'ECONNABORTED';
      if (isNetworkError) {
        this.scheduleBackoffRetry();
      }
      return { syncedSales: salesSyncedCount, syncedQueue: queueSyncedCount, error: error.message };
    } finally {
      this.isSyncing = false;
      window.__posOfflineSalesSyncLock = false;
    }
  }
}

const syncManagerInstance = new SyncManager();
export const syncManager = syncManagerInstance;
export default syncManagerInstance;
