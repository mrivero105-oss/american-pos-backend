import api from './api';
import { db as primaryDb } from './db';
import db from '../db/localDb';

const SYNC_ALERTS_STORAGE_KEY = 'pos_mobile_sync_alerts_v1';

const pushSyncAlertRecord = (alertObj) => {
  if (typeof window === 'undefined' || !alertObj) return;
  try {
    const raw = sessionStorage.getItem(SYNC_ALERTS_STORAGE_KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev) ? prev : [];
    list.unshift({
      id: alertObj.id || `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...alertObj
    });
    sessionStorage.setItem(SYNC_ALERTS_STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // Ignorar si sessionStorage no está disponible
  }
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
      // 1. Sincronizar cola genérica de acciones (productos, clientes, caja, gastos y anulaciones en modo offline)
      try {
        const rawQueueItems = await primaryDb.getAll('syncQueue');
        const queueItems = Array.isArray(rawQueueItems)
          ? rawQueueItems.filter(i => !i?.failedPermanent && i?.status !== 'sync_error')
          : [];
        if (queueItems.length > 0) {
          console.log(`[SyncManager] Sincronizando ${queueItems.length} acciones pendientes en syncQueue...`);
          for (const item of queueItems) {
            try {
              const method = (item.method || 'POST').toLowerCase();
              const endpoint = String(item.endpoint || '');
              let res;
              if (method === 'put') {
                res = await api.put(endpoint, item.payload, { timeout: 6000 });
              } else if (method === 'post') {
                res = await api.post(endpoint, item.payload, { timeout: 6000 });
              } else if (method === 'delete') {
                res = await api.delete(endpoint, { timeout: 6000 });
              }
              if (res && res.status >= 200 && res.status < 300) {
                const tempIdRef = item.tempLocalId || item.tempId || null;
                // Reconciliar IDs temporales de clientes, productos o turnos creados en modo offline
                if (method === 'post' && endpoint === '/customers') {
                  const createdCust = res.data?.customer || res.data;
                  await this.reconcileOfflineCustomer(item.payload, createdCust, tempIdRef);
                } else if (method === 'post' && endpoint === '/products') {
                  const createdProd = res.data?.product || res.data;
                  await this.reconcileOfflineProduct(item.payload, createdProd, tempIdRef);
                } else if (method === 'post' && endpoint === '/cash/open') {
                  const createdShift = res.data?.shift || res.data;
                  if (createdShift?.id && tempIdRef && String(tempIdRef).startsWith('shift_off_')) {
                    try {
                      await primaryDb.delete('cashShifts', tempIdRef).catch(() => {});
                      await primaryDb.put('cashShifts', { ...createdShift, status: 'open', isOffline: false }).catch(() => {});
                    } catch (_shiftErr) {
                      console.warn('[SyncManager] Error actualizando cashShift local tras sync:', _shiftErr?.message || _shiftErr);
                    }
                  }
                }

                await primaryDb.delete('syncQueue', item.id);
                queueSyncedCount++;
              }
            } catch (itemErr) {
              console.warn(`[SyncManager] Error al procesar item en syncQueue:`, itemErr.message);
              const status = itemErr.response?.status;
              const retries = (Number(item.retryCount) || 0) + 1;
              if (status === 409) {
                // Conflicto / duplicado: intentar reconciliar si el servidor devolvió el registro existente y notificar
                const existingEntity = itemErr.response?.data?.product || itemErr.response?.data?.customer || itemErr.response?.data?.existing;
                if (item.endpoint === '/products' && existingEntity?.id && item.tempLocalId) {
                  await this.reconcileOfflineProduct(item.payload, existingEntity, item.tempLocalId);
                }
                const conflictDetail = { itemId: item.id, endpoint: item.endpoint, tempLocalId: item.tempLocalId, error: itemErr.response?.data?.error || itemErr.message };
                pushSyncAlertRecord({
                  kind: 'conflict',
                  title: `Conflicto en ${item.endpoint || 'operación'}`,
                  message: conflictDetail.error || 'Registro duplicado o en conflicto'
                });
                window.dispatchEvent(new CustomEvent('sync-queue-conflict', {
                  detail: conflictDetail
                }));
                await primaryDb.delete('syncQueue', item.id);
              } else if (status && status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)) {
                const errDetail = itemErr.response?.data?.error || itemErr.message;
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
                  window.dispatchEvent(new CustomEvent('sync-queue-error', {
                    detail: { itemId: item.id, endpoint: item.endpoint, status, error: errDetail }
                  }));
                } else {
                  await primaryDb.put('syncQueue', { ...item, retryCount: retries, lastError: errDetail, lastHttpStatus: status });
                }
              }
            }
          }
          if (queueSyncedCount > 0) {
            window.dispatchEvent(new CustomEvent('sync-queue-updated', { detail: { count: queueSyncedCount } }));
          }
        }
      } catch (queueErr) {
        console.warn('[SyncManager] Error en syncQueue:', queueErr);
      }

      // 2. DAG Dependency Priority: Sync Customers first before processing Sales
      if (db.customers) {
        const pendingCustomers = await db.customers.where('status').equals('pending_sync').limit(this.batchSize).toArray();
        if (pendingCustomers.length > 0) {
          const custRes = await api.post('/customers/public-sync', { customers: pendingCustomers }, { timeout: 10000 }).catch(() => null);
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

      // 3. Puente de ventas offline desde primaryDb a Dexie localDb (usando índice por estado para evitar escaneo completo)
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

      // 4. Process Sales queue only after dependencies are verified
      const pendingSales = await db.sales
        .where('status')
        .equals('pending_sync')
        .limit(this.batchSize)
        .toArray();

      if (pendingSales.length === 0) {
        this.consecutiveFailures = 0;
        return { syncedSales: 0, syncedQueue: queueSyncedCount };
      }

      console.log(`[SyncManager] Sincronizando ${pendingSales.length} ventas offline hacia el servidor...`);

      // Attach HMAC timestamp metadata to ensure integrity against replay attacks
      const preparedSales = pendingSales.map(sale => ({
        ...sale,
        hmacTimestamp: sale.hmacTimestamp || Date.now().toString(),
        hmacBranchId: sale.branchId || '1'
      }));

      const response = await api.post(
        this.syncEndpoint,
        { sales: preparedSales },
        {
          timeout: 15000
        }
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

            // También actualizar en primaryDb
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

          // Desvío a cuarentena ante errores de integridad/HMAC inmediatos o tras 3 rechazos repetidos de negocio (evita saturar cola de 50)
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

          // Detección y auditoría de posibles déficits de stock post-offline
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
