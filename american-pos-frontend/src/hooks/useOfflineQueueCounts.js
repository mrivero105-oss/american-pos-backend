import { useCallback, useEffect, useState } from 'react';
import { db as primaryDb } from '../services/db';
import localDb from '../db/localDb';

const INITIAL_COUNTS = {
  cash: 0,
  expenses: 0,
  customers: 0,
  inventory: 0,
  sales: 0,
  total: 0
};

/**
 * Clasifica registros pendientes en la cola offline (`syncQueue` + almacenamiento local)
 * para exponer badges precisos por módulo (Caja, Gastos, Clientes, Inventario, Ventas).
 */
export function useOfflineQueueCounts({ enabled = true } = {}) {
  const [counts, setCounts] = useState(INITIAL_COUNTS);

  const refreshCounts = useCallback(async () => {
    if (!enabled) return;
    try {
      const [queueItems, localSales, localExpenses] = await Promise.all([
        primaryDb.getAll('syncQueue').catch(() => []),
        localDb?.sales
          ? localDb.sales.where('status').equals('pending_sync').toArray().catch(() => [])
          : primaryDb.getByIndex('sales', 'status', 'pending_sync').catch(() => []),
        localDb?.expenses
          ? localDb.expenses.toArray().catch(() => [])
          : Promise.resolve([])
      ]);

      const activeQueue = Array.isArray(queueItems)
        ? queueItems.filter((item) => item && item.status !== 'synced')
        : [];

      let cashQueue = 0;
      let expensesQueue = 0;
      let customersQueue = 0;
      let inventoryQueue = 0;
      let otherQueue = 0;

      for (const item of activeQueue) {
        const ep = String(item.endpoint || '').toLowerCase();
        const idStr = String(item.id || '').toLowerCase();
        if (ep.includes('/cash') || idStr.startsWith('cash_')) {
          cashQueue++;
        } else if (ep.includes('/expenses') || idStr.startsWith('exp_')) {
          expensesQueue++;
        } else if (ep.includes('/customers') || idStr.startsWith('cust_')) {
          customersQueue++;
        } else if (ep.includes('/products') || idStr.startsWith('audit_') || idStr.startsWith('prod_')) {
          inventoryQueue++;
        } else {
          otherQueue++;
        }
      }

      const pendingSalesCount = Array.isArray(localSales) ? localSales.length : 0;
      const pendingLocalExpenses = Array.isArray(localExpenses)
        ? localExpenses.filter((e) => e && (e.status === 'pending_sync' || String(e.id || '').startsWith('exp_'))).length
        : 0;

      const expensesCount = Math.max(expensesQueue, pendingLocalExpenses);
      const cashCount = cashQueue + pendingSalesCount;
      const total = activeQueue.length + pendingSalesCount + Math.max(0, pendingLocalExpenses - expensesQueue);

      setCounts({
        cash: cashCount,
        expenses: expensesCount,
        customers: customersQueue,
        inventory: inventoryQueue,
        sales: pendingSalesCount,
        total: total || (cashQueue + expensesCount + customersQueue + inventoryQueue + otherQueue + pendingSalesCount)
      });
    } catch {
      // Silencioso en caso de almacenamiento no inicializado
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refreshCounts();

    const handleRefresh = () => {
      refreshCounts();
    };

    window.addEventListener('sync-queue-updated', handleRefresh);
    window.addEventListener('offline-sales-synced', handleRefresh);
    window.addEventListener('sync-queue-conflict', handleRefresh);
    window.addEventListener('sync-queue-error', handleRefresh);
    window.addEventListener('online', handleRefresh);

    const intervalId = setInterval(refreshCounts, 15000);

    return () => {
      window.removeEventListener('sync-queue-updated', handleRefresh);
      window.removeEventListener('offline-sales-synced', handleRefresh);
      window.removeEventListener('sync-queue-conflict', handleRefresh);
      window.removeEventListener('sync-queue-error', handleRefresh);
      window.removeEventListener('online', handleRefresh);
      clearInterval(intervalId);
    };
  }, [enabled, refreshCounts]);

  return { counts, refreshCounts };
}

export default useOfflineQueueCounts;
