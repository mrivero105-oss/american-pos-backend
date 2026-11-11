/**
 * cloudRateSyncService.js
 * Servicio de sincronización en tiempo real 24/7 de la Tasa de Cambio desde Supabase.
 * Combina WebSocket Phoenix Realtime (notificación instantánea) con polling de respaldo (cada 6s)
 * para garantizar que la tasa se actualice AUTOMÁTICAMENTE al detectarse cualquier cambio en la nube,
 * sin requerir que el usuario pulse ningún botón.
 */

const SUPABASE_URL = 'https://puvqiipussyktfmgafgv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qphH7VeJGgcTsgMp6NZjDw_zmGnOAi6';

class CloudRateSyncService {
  constructor() {
    this.ws = null;
    this.pollingTimer = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.lastRate = null;
    this.lastUpdatedAt = null;
    this.isChecking = false;
    this.listeners = new Set();
    this.isConnected = false;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // 1. Cargar valor inicial desde localStorage si existe
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('pos_exchange_rate') || localStorage.getItem('pos_cached_exchange_rate');
      if (cached) {
        const parsed = parseFloat(cached);
        if (!isNaN(parsed) && parsed > 0) {
          this.lastRate = parsed;
        }
      }
      const savedDate = localStorage.getItem('pos_rate_updated_at');
      if (savedDate) this.lastUpdatedAt = savedDate;
    }

    // 2. Consulta inmediata al arrancar
    this.checkRate();

    // 3. Iniciar WebSocket Realtime con Supabase
    this.connectRealtimeWs();

    // 4. Iniciar sondeo de respaldo cada 6 segundos
    this.startPolling();

    // 5. Escuchar cambios de visibilidad / foco de la app
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => this.checkRate());
      window.addEventListener('online', () => {
        this.checkRate();
        this.connectRealtimeWs();
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.checkRate();
            if (!this.isConnected) this.connectRealtimeWs();
          }
        });
      }
    }

    console.log('[CloudRateSync] ⚡ Servicio de Tasa en Tiempo Real 24/7 activado.');
  }

  connectRealtimeWs() {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const wsUrl = `wss://puvqiipussyktfmgafgv.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        // Enviar unión al topic del canal de postgres_changes para cloud_configuracion
        const joinMsg = {
          topic: 'realtime:public:cloud_configuracion',
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { self: false },
              presence: { key: '' },
              postgres_changes: [{ event: '*', schema: 'public', table: 'cloud_configuracion' }]
            }
          },
          ref: 'rate_join_' + Date.now()
        };
        this.ws.send(JSON.stringify(joinMsg));

        // Phoenix heartbeat cada 25 segundos para mantener la conexión viva
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              topic: 'phoenix',
              event: 'heartbeat',
              payload: {},
              ref: 'hb_' + Date.now()
            }));
          }
        }, 25000);

        this.notifyStatus(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Si el mensaje es de postgres_changes sobre cloud_configuracion
          if (msg.event === 'postgres_changes' || (msg.topic && msg.topic.includes('cloud_configuracion') && msg.payload?.data)) {
            const record = msg.payload?.data?.record || msg.payload?.record || msg.payload?.new;
            if (record && record.tasa_cambio) {
              this.applyNewRate(Number(record.tasa_cambio), record.modo_moneda, record.actualizado_el, 'websocket');
            } else {
              // Si el formato del payload varía, consultar de inmediato
              this.checkRate();
            }
          }
        } catch (_e) {}
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.notifyStatus(false);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyStatus(false);
        clearInterval(this.heartbeatTimer);
        // Reintentar en 5 segundos si la app sigue visible
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            this.connectRealtimeWs();
          }
        }, 5000);
      };
    } catch (_err) {
      this.isConnected = false;
    }
  }

  startPolling() {
    clearInterval(this.pollingTimer);
    // Polling ligero cada 6 segundos
    this.pollingTimer = setInterval(() => {
      this.checkRate();
    }, 6000);
  }

  async checkRate() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      let signal = undefined;
      let timeoutId = null;
      if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 4000);
        signal = controller.signal;
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/cloud_configuracion?id=eq.general&select=tasa_cambio,modo_moneda,actualizado_el`, {
        signal,
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      if (timeoutId) clearTimeout(timeoutId);

      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].tasa_cambio) {
          const cfg = rows[0];
          this.applyNewRate(Number(cfg.tasa_cambio), cfg.modo_moneda, cfg.actualizado_el, 'http');
        }
      }
    } catch (_e) {
      // Ignorar errores transitorios de red móvil
    } finally {
      this.isChecking = false;
    }
  }

  applyNewRate(newRate, mode = 'BOTH', updatedAt = null, source = 'http') {
    if (!newRate || isNaN(newRate) || newRate <= 0) return;

    const rateChanged = this.lastRate !== newRate;
    this.lastRate = newRate;
    if (updatedAt) this.lastUpdatedAt = updatedAt;

    // Guardar en almacenamiento local persistente
    try {
      localStorage.setItem('pos_exchange_rate', String(newRate));
      localStorage.setItem('pos_cached_exchange_rate', String(newRate));
      if (mode) localStorage.setItem('pos_currency_mode', mode);
      if (this.lastUpdatedAt) localStorage.setItem('pos_rate_updated_at', this.lastUpdatedAt);
    } catch (_e) {}

    // Notificar a observadores si hubo cambio
    if (rateChanged) {
      console.log(`[CloudRateSync] ⚡ Tasa de cambio actualizada automáticamente: ${newRate} Bs/$ (origen: ${source})`);
      
      if (typeof window !== 'undefined') {
        const detail = {
          rate: newRate,
          mode: mode || 'BOTH',
          updatedAt: this.lastUpdatedAt,
          source
        };
        window.dispatchEvent(new CustomEvent('pos-exchange-rate-updated', { detail }));
        window.dispatchEvent(new CustomEvent('pos-data-synced'));
      }
    }

    // Notificar a listeners registrados directamente en el servicio
    this.listeners.forEach((fn) => {
      try {
        fn({ rate: newRate, mode, updatedAt: this.lastUpdatedAt, rateChanged, isConnected: this.isConnected });
      } catch (_e) {}
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    // Notificación inmediata del estado actual
    try {
      listener({
        rate: this.lastRate,
        updatedAt: this.lastUpdatedAt,
        isConnected: this.isConnected,
        rateChanged: false
      });
    } catch (_e) {}
    return () => this.listeners.delete(listener);
  }

  notifyStatus(connected) {
    this.listeners.forEach((fn) => {
      try {
        fn({ isConnected: connected, rate: this.lastRate, updatedAt: this.lastUpdatedAt });
      } catch (_e) {}
    });
  }
}

export const cloudRateSyncService = new CloudRateSyncService();
export default cloudRateSyncService;
