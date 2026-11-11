import React, { useState, useEffect } from 'react';
import lanSyncService from '../services/lanSyncService';
import db from '../db/localDb';
import { getStorageMetrics } from '../services/storagePersistence';

const NetworkStatusIndicator = () => {
  const [status, setStatus] = useState(lanSyncService.getStatus());
  const [showPopover, setShowPopover] = useState(false);
  const [pendingOfflineSales, setPendingOfflineSales] = useState(0);
  const [storageMetrics, setStorageMetrics] = useState(null);

  useEffect(() => {
    lanSyncService.init();
    const unsubscribe = lanSyncService.subscribe((newStatus) => {
      setStatus({ ...newStatus });
    });

    // Check pending offline sales count in IndexedDB and storage metrics
    const checkStatusAndStorage = async () => {
      try {
        if (db && db.sales) {
          const count = await db.sales.where('status').equals('pending').count();
          setPendingOfflineSales(count);
        }
      } catch (e) {}

      try {
        const metrics = await getStorageMetrics();
        setStorageMetrics(metrics);
      } catch (e) {}
    };

    checkStatusAndStorage();
    const interval = setInterval(checkStatusAndStorage, 30000); // Check every 30s

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const getBadgeConfig = () => {
    switch (status.state) {
      case 'CLOUD_ONLINE':
        return {
          bgColor: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
          dotColor: 'bg-emerald-500 animate-pulse',
          title: 'Nube Conectada',
          subtitle: status.peers.length > 0 ? `${status.peers.length} Caja(s) en LAN P2P` : 'Nodo Único'
        };
      case 'LAN_P2P_ACTIVE':
        return {
          bgColor: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
          dotColor: 'bg-amber-400 animate-ping',
          title: 'Modo LAN P2P',
          subtitle: `${status.peers.length} Caja(s) sincronizando sin internet`
        };
      case 'OFFLINE_ISOLATED':
      default:
        return {
          bgColor: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
          dotColor: 'bg-rose-500',
          title: 'Modo Offline',
          subtitle: pendingOfflineSales > 0 ? `${pendingOfflineSales} venta(s) en cola local` : 'Terminal Aislada'
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <div className="relative inline-block select-none z-40">
      {/* Botón Semáforo */}
      <button
        onClick={() => setShowPopover(!showPopover)}
        className={`flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-full border text-xs font-semibold shadow-sm transition-all hover:opacity-90 active:scale-95 cursor-pointer ${config.bgColor}`}
        title="Haz clic para ver el mapa del clúster LAN y estado de sincronización P2P"
      >
        <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
        <span>{config.title}</span>
        {status.peers.length > 0 && (
          <span className="ml-1 px-1.5 py-0.2 rounded bg-black/20 text-[10px]">
            🖥️ {status.clusterSize}
          </span>
        )}
      </button>

      {/* Popover Desplegable de Mapa LAN */}
      {showPopover && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setShowPopover(false)} />
          <div className="fixed sm:absolute right-2 sm:right-0 top-16 sm:top-auto sm:mt-2 w-[calc(100vw-1rem)] sm:w-80 max-w-sm rounded-xl bg-slate-900 border border-slate-700 p-4 shadow-2xl text-slate-200 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <span>🌐 Clúster LAN Mesh P2P</span>
              </h4>
              <button
                onClick={() => {
                  lanSyncService.fetchLANPeers();
                }}
                className="text-xs px-2.5 py-1 min-h-[32px] rounded bg-blue-600/30 text-blue-300 border border-blue-500/40 hover:bg-blue-600/50 cursor-pointer"
              >
                Refrescar
              </button>
            </div>

          {/* Nodo Local */}
          <div className="mb-3 p-2.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
            <div className="text-slate-400 font-semibold mb-1 flex items-center justify-between">
              <span>📍 Mi Terminal (Local):</span>
              <span className="text-emerald-400 font-bold">{status.localNode?.role || 'LAN_SPOKE'}</span>
            </div>
            <div className="font-mono text-[11px] text-slate-300">
              {status.localNode?.nodeName || 'POS Terminal'} ({status.localNode?.ip || '127.0.0.1'})
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              ID: {status.localNode?.nodeId || 'Desconocido'}
            </div>
          </div>

          {/* Nodos Descubiertos en LAN */}
          <div className="mb-3">
            <h5 className="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
              <span>Terminales Hermanas en Red ({status.peers.length}):</span>
            </h5>
            {status.peers.length === 0 ? (
              <div className="text-center py-3 text-xs text-slate-500 bg-slate-950/40 rounded border border-dashed border-slate-800">
                No hay otras cajas encendidas en la red local.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {status.peers.map((peer, i) => (
                  <div key={peer.nodeId || i} className="p-2 rounded bg-slate-950/60 border border-slate-800 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-200">{peer.nodeName}</div>
                      <div className="font-mono text-[10px] text-slate-400">{peer.ip}:{peer.httpPort}</div>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold">
                      {peer.status || 'ONLINE'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Estado de Base de Datos y Persistencia Blindada */}
          <div className="mb-3 p-2.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
            <div className="text-slate-400 font-semibold mb-1 flex items-center justify-between">
              <span>🛡️ Base de Datos Local:</span>
              <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                storageMetrics?.persisted ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {storageMetrics?.persisted ? 'BLINDADA (Inmune al SO)' : 'Estándar'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-300 mt-1.5">
              <span>Uso en disco:</span>
              <span className="font-mono text-slate-200">
                {storageMetrics ? `${storageMetrics.usageMB} MB` : 'Calculando...'}
              </span>
            </div>
            {storageMetrics?.quotaMB > 0 && (
              <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                <span>Cuota garantizada:</span>
                <span className="font-mono">{(storageMetrics.quotaMB / 1024).toFixed(1)} GB</span>
              </div>
            )}
          </div>

          {/* Estado de Cola Offline */}
          {pendingOfflineSales > 0 && (
            <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-200 mb-2 flex items-center justify-between">
              <span>⏳ Ventas en cola local: <strong>{pendingOfflineSales}</strong></span>
              <span className="text-[10px] text-rose-400">Pendiente de sincronizar</span>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800 flex justify-end">
            <button
              onClick={() => setShowPopover(false)}
              className="text-xs px-4 py-2 min-h-[38px] rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
        </>
      )}
    </div>
  );
};

export default NetworkStatusIndicator;
