/**
 * Enterprise Storage Persistence Service for Isaac POS Mobile & Web
 * 
 * Ensures IndexedDB / LocalStorage cannot be evicted or wiped by Android OS
 * or browser storage cleanup daemons during low-disk-space conditions.
 */

let isPersistenceGranted = false;
let persistencePromise = null;

/**
 * Checks if persistent storage is already granted.
 * @returns {Promise<boolean>}
 */
export async function isStoragePersisted() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
    try {
      return await navigator.storage.persisted();
    } catch (e) {
      console.debug('[StoragePersistence] Comprobación de persistencia diferida:', e);
    }
  }
  return false;
}

/**
 * Requests persistent storage from the browser / Android WebView.
 * Once granted, the storage is elevated to "Persistent" (never evicted by the OS).
 * @returns {Promise<boolean>}
 */
export async function ensureStoragePersistence() {
  if (persistencePromise) return persistencePromise;

  persistencePromise = (async () => {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
      return false;
    }

    try {
      const alreadyPersisted = await navigator.storage.persisted();
      if (alreadyPersisted) {
        isPersistenceGranted = true;
        console.debug('🛡️ [StoragePersistence] Blindaje de almacenamiento activo: Persistencia confirmada.');
        return true;
      }

      const granted = await navigator.storage.persist();
      isPersistenceGranted = granted;

      if (granted) {
        console.debug('🛡️ [StoragePersistence] Permiso de persistencia concedido.');
      } else {
        // En navegadores Chromium (Edge/Chrome), StorageManager requiere interacción previa del usuario
        attachGestureRetry();
      }
      return granted;
    } catch (error) {
      console.debug('[StoragePersistence] Solicitud de persistencia aplazada:', error);
      return false;
    }
  })();

  return persistencePromise;
}

/**
 * Attaches a one-time gesture listener in case Android WebView requires
 * user interaction context to grant the permission.
 */
function attachGestureRetry() {
  if (typeof window === 'undefined') return;

  const retryOnInteraction = async () => {
    window.removeEventListener('click', retryOnInteraction);
    window.removeEventListener('touchstart', retryOnInteraction);
    window.removeEventListener('keydown', retryOnInteraction);

    try {
      const isNow = await isStoragePersisted();
      if (!isNow && navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        if (granted) {
          isPersistenceGranted = true;
          console.debug('🛡️ [StoragePersistence] Persistencia concedida tras interacción del usuario.');
        }
      }
    } catch (err) {
      console.debug('[StoragePersistence] Reintento tras interacción falló:', err?.message);
    }
  };

  window.addEventListener('click', retryOnInteraction, { once: true, passive: true });
  window.addEventListener('touchstart', retryOnInteraction, { once: true, passive: true });
  window.addEventListener('keydown', retryOnInteraction, { once: true, passive: true });
}

/**
 * Retrieves storage usage and quota metrics (in MB/GB).
 * @returns {Promise<{supported: boolean, persisted: boolean, quotaMB: number, usageMB: number, percentUsed: number}>}
 */
export async function getStorageMetrics() {
  const defaultMetrics = {
    supported: false,
    persisted: isPersistenceGranted,
    quotaMB: 0,
    usageMB: 0,
    percentUsed: 0
  };

  if (typeof navigator === 'undefined' || !navigator.storage) {
    return defaultMetrics;
  }

  try {
    const persisted = await isStoragePersisted();
    isPersistenceGranted = persisted;

    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      const usage = estimate.usage || 0;
      const quotaMB = Number((quota / (1024 * 1024)).toFixed(1));
      const usageMB = Number((usage / (1024 * 1024)).toFixed(2));
      const percentUsed = quota > 0 ? Number(((usage / quota) * 100).toFixed(2)) : 0;

      return {
        supported: true,
        persisted,
        quotaMB,
        usageMB,
        percentUsed
      };
    }

    return {
      ...defaultMetrics,
      supported: true,
      persisted
    };
  } catch (error) {
    console.debug('[StoragePersistence] Error obteniendo métricas de almacenamiento:', error);
    return defaultMetrics;
  }
}

// Auto-run when module is loaded in browser/WebView environment
if (typeof window !== 'undefined') {
  ensureStoragePersistence().catch(() => {});
}

export default {
  ensureStoragePersistence,
  isStoragePersisted,
  getStorageMetrics
};
