import { useState, useEffect } from 'react';
import {
  ArrowLeft, 
  RefreshCw, 
  ShieldCheck, 
  Database, 
  Layers, 
  Activity, 
  ArrowDownCircle, 
  Zap, 
  Sparkles, 
  DownloadCloud, 
  Check, 
  Landmark
} from 'lucide-react';
import api from '../../services/api';
import otaUpdateService from '../../services/otaUpdateService';
import cloudRateSyncService from '../../services/cloudRateSyncService';

export default function MobileSyncCenterView({
  socketConnected = true,
  pendingSalesCount = 0,
  productsCount = 0,
  isSyncing = false,
  onSyncNow,
  onRefreshCatalog,
  T,
  onBackToPOS,
  showToast,
  onOpenServerConfig
}) {
  const [latencyMs, setLatencyMs] = useState(null);
  const [isTestingPing, setIsTestingPing] = useState(false);
  const [appVersion, setAppVersion] = useState('Consultando...');
  const [isUpdatingOta, setIsUpdatingOta] = useState(false);
  const [otaProgress, setOtaProgress] = useState(0);
  const [otaUpdateReady, setOtaUpdateReady] = useState(false);
  const [currentRate, setCurrentRate] = useState(() => localStorage.getItem('pos_exchange_rate') || '1.0');
  const [isUpdatingRate, setIsUpdatingRate] = useState(false);
  const [rateUpdatedAt, setRateUpdatedAt] = useState(() => {
    const saved = localStorage.getItem('pos_rate_updated_at');
    return saved ? new Date(saved).toLocaleTimeString() : null;
  });

  const handleRefreshCloudRate = async () => {
    setIsUpdatingRate(true);
    try {
      await cloudRateSyncService.checkRate();
      const current = cloudRateSyncService.lastRate;
      if (current) {
        setCurrentRate(String(current));
        if (showToast) showToast(`Tasa sincronizada desde la Nube: ${current} Bs/$`, 'success');
      }
    } catch (err) {
      if (showToast) showToast(`Error al consultar nube: ${err.message}`, 'error');
    } finally {
      setIsUpdatingRate(false);
    }
  };

  useEffect(() => {
    otaUpdateService.getCurrentVersion().then((v) => setAppVersion(v));
    setOtaUpdateReady(otaUpdateService.isUpdateReady());

    // Iniciar y suscribirse al servicio de sincronización automática 24/7 en tiempo real
    cloudRateSyncService.init();
    const unsub = cloudRateSyncService.subscribe((data) => {
      if (data?.rate) {
        setCurrentRate(String(data.rate));
      }
      if (data?.updatedAt) {
        setRateUpdatedAt(new Date(data.updatedAt).toLocaleTimeString());
      }
      if (data?.rateChanged && showToast) {
        showToast(`⚡ Tasa actualizada automáticamente: ${data.rate} Bs/$`, 'success');
      }
    });

    return () => unsub();
  }, [showToast]);

  const handleCheckOtaUpdate = async () => {
    setIsUpdatingOta(true);
    setOtaProgress(0);
    try {
      const res = await otaUpdateService.checkForUpdates({
        silent: false,
        immediate: false,
        onProgress: (p) => setOtaProgress(p)
      });
      if (res?.updateAvailable) {
        setOtaUpdateReady(true);
      }
      const v = await otaUpdateService.getCurrentVersion();
      setAppVersion(v);
    } catch (_e) {
      // Ignored
    } finally {
      setIsUpdatingOta(false);
    }
  };

  const handleApplyReload = async () => {
    await otaUpdateService.applyAndReload();
  };

  const handleTestPing = async () => {
    setIsTestingPing(true);
    const start = performance.now();
    try {
      await api.get('/hello', { timeout: 2500 });
      const duration = Math.round(performance.now() - start);
      setLatencyMs(duration);
      showToast?.(`✅ Servidor PC en línea • Latencia: ${duration} ms`);
    } catch (_e) {
      setLatencyMs('offline');
      showToast?.(`⚠️ Sin respuesta del servidor PC. Modo Offline Activo.`);
    } finally {
      setIsTestingPing(false);
    }
  };

  const serverUrl = api.defaults.baseURL || `${window.location.protocol}//${window.location.hostname}:3005`;

  return (
    <div className={`flex flex-col h-full ${T.cardBg} animate-fadeIn`}>
      {/* 1. HEADER DEL CENTRO DE SINCRONIZACIÓN */}
      <div className={`p-3.5 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
        <div className="flex items-center gap-2.5">
          <button 
            onClick={onBackToPOS}
            className={`p-1.5 rounded-xl ${T.btnGhost} flex items-center gap-1 text-xs font-bold`}
            title="Volver a Terminal POS"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">POS</span>
          </button>
          <div>
            <h2 className={`font-black text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5`}>
              <RefreshCw size={16} className="text-blue-500 shrink-0" />
              <span>Conexión PC</span>
            </h2>
            <p className={`text-[10px] ${T.textMuted}`}>Sincronización en tiempo real</p>
          </div>
        </div>

        <button
          onClick={handleTestPing}
          disabled={isTestingPing}
          className={`px-3 py-1.5 rounded-xl ${T.btnGhost} border ${T.border} text-xs font-bold flex items-center gap-1.5 ${T.textSecondary} hover:opacity-100`}
        >
          <Activity size={13} className={isTestingPing ? 'animate-pulse text-blue-500' : ''} />
          <span>{isTestingPing ? 'Probando...' : 'Test Ping'}</span>
        </button>
      </div>

      {/* 2. CONTENIDO PRINCIPAL */}
      <div className="p-3 sm:p-5 overflow-y-auto flex-1">
        <div className="max-w-4xl mx-auto space-y-3">
        {/* BANNER PRINCIPAL DE ESTADO */}
        <div className={`${T.modalSubCard} p-4 rounded-xl border ${T.border} space-y-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
              <span className={`text-xs font-bold uppercase tracking-wider ${T.textPrimary}`}>
                {socketConnected ? 'Espejo en Tiempo Real Activo' : 'Operando en Modo Offline'}
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
              socketConnected ? 'bg-emerald-500/20 text-emerald-500' : 'bg-amber-500/20 text-amber-500'
            }`}>
              {socketConnected ? 'Conectado a PC' : 'Sin Conexión a PC'}
            </span>
          </div>

          <p className={`text-[11px] ${T.textSecondary} leading-relaxed`}>
            {socketConnected 
              ? 'Cualquier modificación de precios, productos o ventas realizada en la PC principal se refleja inmediatamente en este teléfono, y viceversa.'
              : 'El teléfono sigue cobrando y registrando ventas de forma 100% autónoma. Al encender la PC o reconectar la red, todas las ventas se subirán sin sobreescribir nada.'}
          </p>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/20 text-xs">
            <div 
              onClick={onOpenServerConfig}
              className={onOpenServerConfig ? "cursor-pointer group hover:opacity-80 transition-opacity" : ""}
              title="Toca para configurar IP de la PC"
            >
              <div className="flex items-center gap-1">
                <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Servidor PC</span>
                {onOpenServerConfig && <span className="text-[9px] text-blue-500 font-bold underline">Cambiar</span>}
              </div>
              <span className={`font-mono font-bold text-[11px] ${T.textPrimary} truncate block`}>
                {serverUrl}
              </span>
            </div>
            <div>
              <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Latencia LAN</span>
              <span className={`font-bold text-[11px] ${latencyMs === 'offline' ? 'text-rose-500' : latencyMs ? 'text-emerald-500' : T.textPrimary}`}>
                {latencyMs === 'offline' ? 'Inaccesible' : latencyMs ? `${latencyMs} ms` : 'Normal (~1-3 ms)'}
              </span>
            </div>
          </div>
        </div>

        {/* MÉTRICAS DE LA BASE DE DATOS LOCAL */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className={`${T.modalSubCard} p-3 rounded-xl border ${T.border}`}>
            <div className="flex items-center gap-2 text-blue-500 mb-1">
              <Database size={15} />
              <span className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider`}>
                Catálogo Local
              </span>
            </div>
            <div className="font-bold text-lg text-blue-500">
              {productsCount}
            </div>
            <span className={`text-[10px] ${T.textMuted} block`}>
              Productos disponibles offline
            </span>
          </div>

          <div className={`${T.modalSubCard} p-3 rounded-xl border ${T.border}`}>
            <div className="flex items-center gap-2 text-amber-500 mb-1">
              <Layers size={15} />
              <span className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider`}>
                Ventas en Cola
              </span>
            </div>
            <div className={`font-bold text-lg ${pendingSalesCount > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
              {pendingSalesCount}
            </div>
            <span className={`text-[10px] ${T.textMuted} block`}>
              {pendingSalesCount > 0 ? 'Pendientes de subir a PC' : 'Todas sincronizadas'}
            </span>
          </div>
        </div>

        {/* BOTONES DE ACCIÓN */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
          <button
            onClick={onSyncNow}
            disabled={isSyncing || pendingSalesCount === 0}
            className={`w-full min-h-[44px] rounded-lg font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              pendingSalesCount > 0
                ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm active:scale-95'
                : 'bg-slate-800 text-slate-400 opacity-60 cursor-not-allowed'
            }`}
          >
            <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Sincronizando con PC...' : `Subir ${pendingSalesCount} Ventas a la PC`}</span>
          </button>

          <button
            onClick={onRefreshCatalog}
            className={`w-full min-h-[44px] rounded-lg ${T.btnGhost} border ${T.border} font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${T.textPrimary} hover:border-blue-500/40 active:scale-95 transition-colors cursor-pointer`}
          >
            <ArrowDownCircle size={15} className="text-blue-500" />
            <span>Descargar Catálogo Fresco</span>
          </button>
        </div>

        {/* SECCIÓN TASA DE CAMBIO 24/7 EN LA NUBE */}
        <div className={`p-4 rounded-xl ${T.subPanelBg} border ${T.border} space-y-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-600/15 text-emerald-500 border border-emerald-500/20">
                <Landmark size={16} />
              </div>
              <div>
                <h3 className={`text-xs font-bold ${T.textPrimary}`}>Tasa de Cambio en la Nube (24/7)</h3>
                <p className={`text-[10px] ${T.textMuted}`}>
                  Valor móvil: <span className="font-mono text-emerald-400 font-bold">{currentRate} Bs/$</span>
                  {rateUpdatedAt && <span className="ml-1 text-[9px] text-slate-400">({rateUpdatedAt})</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>En Vivo 24/7</span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-[11px] text-emerald-300 leading-relaxed flex items-start gap-2">
            <Zap size={15} className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-200">Actualización Automática Instantánea</p>
              <p className="text-[10px] text-emerald-300/80 mt-0.5">
                Al cambiar la tasa en la PC o en Supabase, tu teléfono la actualiza automáticamente al segundo mediante Supabase Realtime, sin que tengas que presionar ningún botón.
              </p>
            </div>
          </div>

          <button
            onClick={handleRefreshCloudRate}
            disabled={isUpdatingRate}
            className={`w-full min-h-[44px] rounded-lg ${T.btnGhost} border ${T.border} font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${T.textMuted} hover:opacity-100 hover:border-emerald-500/40 active:scale-95 transition-colors cursor-pointer`}
          >
            <RefreshCw size={14} className={isUpdatingRate ? 'animate-spin text-emerald-400' : 'text-slate-400'} />
            <span>{isUpdatingRate ? 'Consultando en Supabase...' : 'Verificar Tasa Manualmente (Opcional)'}</span>
          </button>
        </div>

        {/* SECCIÓN DE ACTUALIZACIONES EN CALIENTE (OTA) */}
        <div className={`p-4 rounded-xl ${T.subPanelBg} border ${T.border} space-y-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-violet-600/15 text-violet-500 border border-violet-500/20">
                <Sparkles size={16} />
              </div>
              <div>
                <h3 className={`text-xs font-bold ${T.textPrimary}`}>Actualizaciones Automáticas (OTA)</h3>
                <p className={`text-[10px] ${T.textMuted}`}>Versión actual instalada: <span className="font-mono text-emerald-400 font-bold">{appVersion}</span></p>
              </div>
            </div>
            {otaUpdateReady && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-500 animate-pulse">
                Lista para aplicar
              </span>
            )}
          </div>

          <p className={`text-[11px] ${T.textSecondary} leading-relaxed`}>
            Esta tecnología descarga los cambios del sistema en segundo plano directo desde la PC principal. No necesitas volver a pasar ni instalar archivos APK manualmente.
          </p>

          {otaProgress > 0 && otaProgress < 100 && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-bold text-slate-300">
                <span>Descargando nuevo paquete...</span>
                <span>{otaProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${otaProgress}%` }}
                />
              </div>
            </div>
          )}

          {otaUpdateReady ? (
            <button
              onClick={handleApplyReload}
              className="w-full min-h-[44px] rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-colors cursor-pointer"
            >
              <Check size={16} />
              <span>Reiniciar App y Aplicar Actualización</span>
            </button>
          ) : (
            <button
              onClick={handleCheckOtaUpdate}
              disabled={isUpdatingOta}
              className={`w-full min-h-[44px] rounded-lg ${T.btnGhost} border ${T.border} font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${T.textPrimary} hover:border-violet-500/40 active:scale-95 transition-colors cursor-pointer`}
            >
              <DownloadCloud size={16} className={isUpdatingOta ? 'animate-bounce text-violet-400' : 'text-violet-400'} />
              <span>{isUpdatingOta ? 'Buscando en Servidor PC...' : 'Buscar Actualizaciones del Sistema'}</span>
            </button>
          )}
        </div>

        {/* GARANTÍAS DE SEGURIDAD Y RENDIMIENTO */}
        <div className={`p-3.5 rounded-xl ${T.subPanelBg} border ${T.border} space-y-2`}>
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-500">
            <ShieldCheck size={16} />
            <span>Seguridad & Integridad Contable</span>
          </div>
          <ul className={`text-[11px] ${T.textSecondary} space-y-1.5 list-disc pl-4`}>
            <li><b>Zero-Overwrite:</b> Las ventas se reconcilian mediante claves criptográficas únicas UUID v4. Jamás se sobrescribe ninguna venta previa del servidor.</li>
            <li><b>Autonomía de Turno:</b> La caja móvil no se bloquea si el servidor se apaga o la red Wi-Fi se desconecta.</li>
            <li><b>Doble Motor Local:</b> IndexedDB de alta velocidad (Dexie) resiste reinicios del dispositivo o cierres del navegador.</li>
          </ul>
        </div>
        </div>
      </div>
    </div>
  );
}
