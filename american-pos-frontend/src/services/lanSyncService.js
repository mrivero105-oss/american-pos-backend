import { io } from 'socket.io-client';
import api from './api';
import db from '../db/localDb';
import { fetchGlobalSettings } from '../utils/format';
import secureMobileStorage from '../utils/secureMobileStorage';

class LANSyncService {
  constructor() {
    this.socket = null;
    this.listeners = new Set();
    this.status = {
      state: navigator.onLine ? 'CLOUD_ONLINE' : 'OFFLINE_ISOLATED',
      clusterSize: 1,
      peers: [],
      localNode: null,
      lastSyncTime: Date.now()
    };
    this.pollInterval = null;
    this.isListeningNetwork = false;
    this.printedSaleIds = new Set();
    this._socketBaseUrl = null;
    this._socketAuthToken = null;
    this.isActive = false;
    this.consecutivePeerFailures = 0;
    this.lastPeerErrorMsg = null;
  }

  getPeerPollBackoffMs() {
    const baseMs = 45000;
    const maxMs = 300000;
    const exp = Math.min(4, Math.max(0, this.consecutivePeerFailures));
    return Math.min(maxMs, baseMs * (2 ** exp));
  }

  _clearPeerPollTimer() {
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }
  }

  scheduleNextPeerPoll() {
    this._clearPeerPollTimer();
    if (!this.isActive) return;
    const delayMs = this.getPeerPollBackoffMs();
    this.pollInterval = setTimeout(async () => {
      if (!this.isActive) return;
      const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (!isHidden && (!this.socket || !this.socket.connected)) {
        await this.fetchLANPeers();
      }
      this.scheduleNextPeerPoll();
    }, delayMs);
  }

  handleVisibilityChange = () => {
    if (!this.isActive) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.consecutivePeerFailures = 0;
      this.lastPeerErrorMsg = null;
      if (!this.socket || !this.socket.connected) {
        if (!this.socket?.active && !this.isConnecting) {
          this.connectSocket();
        }
        this.fetchLANPeers();
      }
      this.scheduleNextPeerPoll();
    }
  };

  _resolveBaseUrl() {
    const isAndroidCap = typeof window !== 'undefined' && ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || window.location.protocol === 'capacitor:');
    const isLocalLoopback = typeof window !== 'undefined' && !isAndroidCap && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && localStorage.getItem('isaac_pos_node_role') !== 'client';
    const localHost = (typeof window !== 'undefined' && window.location.hostname === 'localhost') ? 'localhost' : '127.0.0.1';
    const currentPort = typeof window !== 'undefined' ? window.location.port : '';
    const devPorts = ['5173', '5174', '5175'];
    const targetLocalPort = (devPorts.includes(currentPort) || !currentPort) ? '3005' : currentPort;
    return isLocalLoopback
      ? `http://${localHost}:${targetLocalPort}`
      : (api.defaults.baseURL || (isAndroidCap ? '' : `${window.location.protocol}//${window.location.hostname}:${targetLocalPort}`));
  }

  handleServerUrlChange = () => {
    const nextUrl = this._resolveBaseUrl();
    if (!nextUrl) {
      if (this.socket) {
        try { this.socket.disconnect(); } catch { /* Canal o socket ya cerrado previamente */ }
        this.socket = null;
        this.isConnecting = false;
        this._socketBaseUrl = null;
      }
      return;
    }
    if (this._socketBaseUrl !== nextUrl || !this.socket) {
      if (this.socket) {
        try { this.socket.disconnect(); } catch { /* Canal o socket ya cerrado previamente */ }
        this.socket = null;
        this.isConnecting = false;
      }
      this.connectSocket();
    }
  };

  markSalePrintedLocally(saleId) {
    if (!saleId) return;
    const key = String(saleId);
    this.printedSaleIds.add(key);
    try {
      sessionStorage.setItem('last_local_printed_sale_id', key);
    } catch (caughtErr) { console.warn('[lanSyncService] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
  }

  /**
   * Conecta al clúster LAN por WebSockets y activa el monitoreo continuo de red.
   */
  init() {
    const currentAuthToken = typeof window !== 'undefined' ? (secureMobileStorage.getToken() || null) : null;
    const currentSyncKey = typeof window !== 'undefined' ? (localStorage.getItem('sync_secret_key') || null) : null;
    if (!currentAuthToken && !currentSyncKey) {
      return;
    }

    const nextBaseUrl = this._resolveBaseUrl();
    const tokenChanged = this.socket && this._socketAuthToken !== currentAuthToken;
    const urlChanged = this.socket && this._socketBaseUrl !== nextBaseUrl;
    if (this.socket && (this.socket.connected || this.socket.active || this.isConnecting) && !tokenChanged && !urlChanged) return;

    if (tokenChanged || urlChanged) {
      try { this.socket.disconnect(); } catch { /* Canal o socket ya cerrado previamente */ }
      this.socket = null;
      this.isConnecting = false;
    }

    this.isActive = true;
    this.consecutivePeerFailures = 0;
    this.lastPeerErrorMsg = null;

    if (!this.isListeningNetwork) {
      window.addEventListener('online', this.handleNetworkChange);
      window.addEventListener('offline', this.handleNetworkChange);
      window.addEventListener('server-discovered', this.handleServerUrlChange);
      window.addEventListener('api-base-url-changed', this.handleServerUrlChange);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }
      this.isListeningNetwork = true;
    }

    this.connectSocket();
    this.scheduleNextPeerPoll();
    this.fetchLANPeers();
  }

  handleNetworkChange = () => {
    const isOnline = navigator.onLine;
    if (isOnline) {
      this.consecutivePeerFailures = 0;
      this.lastPeerErrorMsg = null;
      this.status.state = 'CLOUD_ONLINE';
      if (!this.socket?.connected && !this.socket?.active && !this.isConnecting) {
        this.connectSocket();
      }
      this.scheduleNextPeerPoll();
    } else {
      this.status.state = this.status.peers.length > 0 ? 'LAN_P2P_ACTIVE' : 'OFFLINE_ISOLATED';
    }
    this.notifyListeners();
  };

  connectSocket() {
    try {
      if (this.socket) {
        if (this.socket.connected || this.socket.active || this.isConnecting) return;
        try { this.socket.disconnect(); } catch { /* Canal o socket ya cerrado previamente */ }
        this.socket = null;
      }
      this.isConnecting = true;
      const baseUrl = this._resolveBaseUrl();
      if (!baseUrl) {
        this.isConnecting = false;
        return;
      }
      const authToken = typeof window !== 'undefined' ? secureMobileStorage.getToken() : null;
      const syncKey = typeof window !== 'undefined' ? localStorage.getItem('sync_secret_key') : null;
      if (!authToken && !syncKey) {
        this.isConnecting = false;
        return;
      }
      this._socketAuthToken = authToken || null;
      this._socketBaseUrl = baseUrl;
      this.socket = io(baseUrl, {
        auth: {
          token: authToken || undefined,
          syncKey: syncKey || undefined
        },
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: Infinity,
        timeout: 10000
      });

      this.socket.on('connect', () => {
        this.isConnecting = false;
        this.consecutivePeerFailures = 0;
        this.lastPeerErrorMsg = null;
        console.log('[LAN_SYNC] 🌐 Socket P2P conectado al servidor LAN:', baseUrl);
        this.status.state = navigator.onLine ? 'CLOUD_ONLINE' : 'LAN_P2P_ACTIVE';

        try {
          const cachedProfile = secureMobileStorage.getUserProfile();
          const legacyStr = !cachedProfile ? (localStorage.getItem('pos_user') || sessionStorage.getItem('pos_user')) : null;
          const parsedUser = cachedProfile || (legacyStr ? JSON.parse(legacyStr) : null);
          if (parsedUser?.companyId) {
            this.socket.emit('join_company', parsedUser.companyId);
          }
        } catch (e) {
          console.warn('[LAN_SYNC] No se pudo leer compañía de usuario al conectar:', e?.message);
        }

        this.fetchLANPeers();
        this.notifyListeners();

        // ⚡ Disparar sincronización inmediata de ventas y operaciones offline
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lan-sync-trigger'));
        }
      });

      this.socket.on('disconnect', () => {
        this.isConnecting = false;
        console.warn('[LAN_SYNC] ⚠️ Socket P2P desconectado.');
        this.status.state = navigator.onLine ? 'CLOUD_ONLINE' : 'OFFLINE_ISOLATED';
        this.notifyListeners();
      });

      this.socket.on('connect_error', () => {
        this.isConnecting = false;
      });

      // Escuchar cambios de topología LAN
      this.socket.on('lan_peer_list_changed', (clusterData) => {
        if (clusterData) {
          this.status.clusterSize = clusterData.clusterSize || 1;
          this.status.peers = clusterData.peers || [];
          this.status.localNode = clusterData.localNode || this.status.localNode;
          if (!navigator.onLine && this.status.peers.length > 0) {
            this.status.state = 'LAN_P2P_ACTIVE';
          }
          this.notifyListeners();
        }
      });

      // Escuchar actualizaciones de stock instantáneas propagadas por otras cajas (ignorando eco propio para evitar descuento 2x)
      this.socket.on('lan_stock_update', async (payload) => {
        if (!payload || !Array.isArray(payload.items)) return;
        const myTerminalId = typeof window !== 'undefined' ? (localStorage.getItem('pos_terminal_id') || 'Caja 1') : 'Caja 1';
        if (
          (payload.sourceSocketId && this.socket?.id && payload.sourceSocketId === this.socket.id) ||
          (payload.sourceTerminalId && payload.sourceTerminalId === myTerminalId)
        ) {
          return;
        }
        console.log('[LAN_SYNC] 📦 Actualización P2P de stock recibida:', payload.items.length, 'ítems');
        await this.applyLocalStockUpdate(payload.items);
        window.dispatchEvent(new CustomEvent('lan-stock-update-received', { detail: payload.items }));
      });

      // Escuchar notificación de cuarentena resuelta
      this.socket.on('lan_quarantine_resolved', (data) => {
        window.dispatchEvent(new CustomEvent('lan-quarantine-resolved', { detail: data }));
      });

      // 💸 Escuchar ventas registradas por otros nodos del Clúster P2P
      this.socket.on('lan_sale_sync', async (payload) => {
        try {
          if (!payload || !payload.sale) return;
          const incomingSale = payload.sale;
          const myTerminalId = localStorage.getItem('pos_terminal_id') || 'Caja 1';
          if (incomingSale.terminalId && incomingSale.terminalId === myTerminalId) return;

          console.log('[LAN_SYNC] 💸 Venta P2P sincronizada desde nodo remoto:', incomingSale.id);

          if (db && db.sales) {
            await db.sales.put({
              ...incomingSale,
              synced_p2p: true,
              receivedAt: Date.now()
            }).catch(() => {});
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('lan-sale-synced-peer', { detail: incomingSale }));
          }
        } catch (saleErr) {
          console.warn('[LAN_SYNC] Error procesando venta P2P:', saleErr);
        }
      });

      // Escuchar cambios de configuración de impresión en tiempo real
      this.socket.on('business_settings_updated', (cfg) => {
        if (!cfg) return;
        try {
          if (cfg.broadcastPrintingEnabled !== undefined) {
            localStorage.setItem('pos_broadcast_print_enabled', String(cfg.broadcastPrintingEnabled === true));
          }
          const savedBiz = JSON.parse(localStorage.getItem('pos_business_settings') || '{}');
          const updatedBiz = { ...savedBiz, ...cfg };
          localStorage.setItem('pos_business_settings', JSON.stringify(updatedBiz));
        } catch (err) {
          console.warn('[LAN_SYNC] Error guardando configuración local:', err?.message);
        }
      });

      // 🖨️ Escuchar réplica de impresión en tiempo real (Modo Multicaja 3 Impresoras)
      this.socket.on('lan_print_sale', async (data) => {
        try {
          if (!data || !data.sale) return;
          const saleIdStr = String(data.sale.id || '');
          const isClusterTest = data.originStationId === 'cluster-test-trigger';

          // Verificar si la réplica simultánea está explícitamente habilitada (por defecto DESACTIVADA)
          if (!isClusterTest) {
            let isBroadcastEnabled = localStorage.getItem('pos_broadcast_print_enabled') === 'true';
            if (!isBroadcastEnabled) {
              try {
                const savedBiz = JSON.parse(localStorage.getItem('pos_business_settings') || '{}');
                isBroadcastEnabled = savedBiz.broadcastPrintingEnabled === true;
              } catch (err) {
                console.warn('[LAN_SYNC] Error leyendo configuración local de impresión:', err?.message);
              }
            }
            if (!isBroadcastEnabled) return;
          }

          // Evitar duplicar en la terminal que ya ejecutó o inició la impresión local inmediata
          const lastLocalSaleId = sessionStorage.getItem('last_local_printed_sale_id');
          if (
            (saleIdStr && this.printedSaleIds.has(saleIdStr)) ||
            (lastLocalSaleId && String(lastLocalSaleId) === saleIdStr)
          ) {
            console.log('[LAN_SYNC] 🖨️ Venta ya impresa localmente en esta terminal, omitiendo duplicado.');
            return;
          }

          // Proceder a imprimir en la impresora local de esta estación
          if (window.electronAPI) {
            const stationPrinter = localStorage.getItem('pos_station_printer');
            if (!stationPrinter) {
              console.log('[LAN_SYNC] 🖨️ No hay impresora local asignada en este equipo para réplica.');
              return;
            }

            // Marcar inmediatamente para prevenir duplicidad ante posibles retransmisiones
            if (saleIdStr) {
              this.markSalePrintedLocally(saleIdStr);
            }

            let bizSettings = {};
            try {
              const res = await api.get('/settings/business');
              bizSettings = res.data || {};
              if (!isClusterTest && bizSettings.broadcastPrintingEnabled !== true) {
                localStorage.setItem('pos_broadcast_print_enabled', 'false');
                return;
              }
            } catch (e) {
              console.warn('[LAN_SYNC] No se pudo consultar /settings/business para réplica:', e?.message);
            }

            console.log(`[LAN_SYNC] 🖨️ Imprimiendo réplica simultánea de venta #${data.sale.invoiceNumber || data.sale.id} en ${stationPrinter}`);

            const { formatSaleToEscPos } = await import('../utils/escposFormatter');
            const globalSettings = await fetchGlobalSettings();

            let payMethods = [];
            try {
              const res = await api.get('/settings/payment-methods');
              payMethods = res.data || [];
            } catch (e) {
              console.warn('[LAN_SYNC] No se pudo consultar /settings/business para réplica:', e?.message);
            }

            const escPosContent = formatSaleToEscPos(
              data.sale,
              { ...bizSettings, printerName: stationPrinter },
              globalSettings.rate || 1,
              globalSettings.currencyMode || 'BOTH',
              payMethods
            );

            await window.electronAPI.printRaw(escPosContent, stationPrinter);
          }
        } catch (printErr) {
          console.error('[LAN_SYNC] Error en réplica de impresión:', printErr);
        }
      });
    } catch (err) {
      console.error('[LAN_SYNC] Error iniciando socket P2P:', err);
    }
  }

  async fetchLANPeers() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const authToken = typeof window !== 'undefined' ? secureMobileStorage.getToken() : null;
    const syncKey = typeof window !== 'undefined' ? localStorage.getItem('sync_secret_key') : null;
    if (!authToken && !syncKey) return;
    try {
      const res = await api.get('/lan/peers');
      if (res.data && res.data.success) {
        this.consecutivePeerFailures = 0;
        this.lastPeerErrorMsg = null;
        this.status.clusterSize = res.data.clusterSize || 1;
        this.status.peers = res.data.peers || [];
        this.status.localNode = res.data.localNode || null;
        if (!navigator.onLine && this.status.peers.length > 0) {
          this.status.state = 'LAN_P2P_ACTIVE';
        } else if (navigator.onLine) {
          this.status.state = 'CLOUD_ONLINE';
        }
        this.notifyListeners();
      }
    } catch (e) {
      this.consecutivePeerFailures += 1;
      const errMsg = e?.message || 'error desconocido';
      const shouldLogWarn =
        navigator.onLine &&
        (errMsg !== this.lastPeerErrorMsg || this.consecutivePeerFailures === 1 || this.consecutivePeerFailures % 4 === 0);
      this.lastPeerErrorMsg = errMsg;
      if (shouldLogWarn) {
        console.warn('[LAN_SYNC] Error consultando pares LAN:', errMsg);
      }
      if (!navigator.onLine && this.status.peers.length === 0) {
        this.status.state = 'OFFLINE_ISOLATED';
        this.notifyListeners();
      }
    }
  }

  /**
   * Aplica descuentos de inventario directamente en IndexedDB (localDb y primaryDb)
   */
  async applyLocalStockUpdate(items) {
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      try {
        const rawId = item.productId || item.producto_id || item.id;
        const qty = Number(item.quantity || item.qty || 0);
        const factor = Math.max(1, Number(item.factorConversion || item.unitsMultiplier || 1));
        const deductUnits = qty * factor;
        if (!rawId || deductUnits <= 0) continue;

        const strId = String(rawId).trim();
        const numId = Number(strId);
        const hasValidNumId = !isNaN(numId) && numId > 0;

        // 1. Actualizar Dexie (IsaacPOSPharmacyDB) si está disponible
        if (db && db.products) {
          let prod = null;

          // Primero buscar por string (UUID estándar)
          if (strId) {
            try {
              prod = await db.products.get(strId);
            } catch { /* Fallback al siguiente índice en Dexie */ }
          }

          // Si no se encontró y es un número válido, buscar por clave numérica
          if (!prod && hasValidNumId) {
            try {
              prod = await db.products.get(numId);
            } catch { /* Fallback al siguiente índice en Dexie */ }
          }

          // Búsqueda alternativa por atributo 'id'
          if (!prod && strId) {
            try {
              prod = await db.products.where('id').equals(strId).first();
            } catch { /* Fallback al siguiente índice en Dexie */ }
          }

          // Búsqueda por código de barras si viene en el ítem
          if (!prod && (item.barcode || item.codigo_barras)) {
            const bc = String(item.barcode || item.codigo_barras).trim();
            try {
              prod = await db.products.where('codigo_barras').equals(bc).first();
            } catch { /* Sin coincidencia en índice codigo_barras */ }
          }

          if (prod) {
            const prodKey = prod.id !== undefined && prod.id !== null ? prod.id : (hasValidNumId ? numId : strId);
            const currentStock = Number(prod.stockQuantity ?? prod.stock ?? 0);
            const updatedStock = Math.max(0, Number((currentStock - deductUnits).toFixed(3)));
            try {
              // localDb delega a primaryDb (UnifiedDB); actualizar una sola vez para evitar doble descuento 2x
              await db.products.update(prodKey, {
                stockQuantity: String(updatedStock),
                stock: updatedStock
              });
            } catch (updErr) {
              console.warn('[LAN_SYNC] Advertencia al actualizar producto en UnifiedDB:', updErr?.message);
            }
          }
        }
      } catch (itemErr) {
        console.warn('[LAN_SYNC] Error procesando ítem de stock:', itemErr?.message);
      }
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.status);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach(cb => {
      try { cb(this.status); } catch (e) { console.warn('[LAN_SYNC] Error en listener:', e?.message); }
    });
  }

  /**
   * Propaga una venta local a todos los pares del clúster P2P
   */
  broadcastSale(sale) {
    if (!this.socket || !this.socket.connected || !sale) return;
    try {
      const cachedProfile = secureMobileStorage.getUserProfile();
      const userStr = !cachedProfile ? (localStorage.getItem('pos_user') || sessionStorage.getItem('pos_user')) : null;
      let companyId = cachedProfile?.companyId || null;
      if (!companyId && userStr) {
        try { companyId = JSON.parse(userStr)?.companyId; } catch (err) { console.warn('[LAN_SYNC] Error leyendo companyId:', err?.message); }
      }
      const sourceTerminalId = localStorage.getItem('pos_terminal_id') || 'Caja 1';

      this.socket.emit('lan_sale_sync', {
        companyId,
        sourceTerminalId,
        sale
      });

      // También emitir actualización de stock para ítems vendidos con factor de conversión (bultos/presentaciones) y marca de origen
      const items = Array.isArray(sale.items) ? sale.items : (Array.isArray(sale.SaleItems) ? sale.SaleItems : []);
      if (items.length > 0) {
        this.socket.emit('lan_stock_update', {
          companyId,
          sourceTerminalId,
          sourceSocketId: this.socket.id || null,
          items: items.map(it => ({
            productId: String(it.productId || it.id || '').replace(/__bulk$|__mid$|__pres_.*$/, ''),
            barcode: it.barcode || it.codigo_barras || undefined,
            quantity: Number(it.quantity || 1),
            factorConversion: Math.max(1, Number(it.factorConversion || it.unitsMultiplier || (it.isBulk ? it.unitsPerBulk : (it.isMidBulk ? it.unitsPerMidBulk : 1)) || 1))
          }))
        });
      }
    } catch (e) {
      console.warn('[LAN_SYNC] No se pudo propagar venta P2P:', e);
    }
  }

  stop() {
    this.isActive = false;
    this.consecutivePeerFailures = 0;
    this.lastPeerErrorMsg = null;
    window.removeEventListener('online', this.handleNetworkChange);
    window.removeEventListener('offline', this.handleNetworkChange);
    window.removeEventListener('server-discovered', this.handleServerUrlChange);
    window.removeEventListener('api-base-url-changed', this.handleServerUrlChange);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.isListeningNetwork = false;
    this._clearPeerPollTimer();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this._socketBaseUrl = null;
    this.listeners.clear();
  }
}

export default new LANSyncService();
