import { useState, useEffect, Suspense, lazy } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Routes, Route } from 'react-router-dom';
import toast, { Toaster, ToastBar } from 'react-hot-toast';
import LockScreen from './components/LockScreen';
import ActivationPortal from './components/ActivationPortal';
import SplashScreen from './components/SplashScreen';
import { syncManager } from './services/syncManager';
import { useAuth } from './hooks/AuthContext';
import { useTheme } from './hooks/ThemeContext';
import { otaUpdateService } from './services/otaUpdateService';
import lanSyncService from './services/lanSyncService';

const MobilePOSSimulator = lazy(() => import('./pages/MobilePOSSimulator'));

function AutoDismissToast({ toast: t }) {
  useEffect(() => {
    const dur = t.duration || (t.type === 'error' ? 4000 : 3000);
    if (dur !== Infinity) {
      const timer = setTimeout(() => {
        toast.dismiss(t.id);
        setTimeout(() => toast.remove(t.id), 350);
      }, dur);
      return () => clearTimeout(timer);
    }
  }, [t.id, t.duration, t.type]);

  const handleDismiss = (e) => {
    if (e) e.stopPropagation();
    toast.dismiss(t.id);
    setTimeout(() => toast.remove(t.id), 250);
  };

  return (
    <ToastBar toast={t} style={{ ...t.style }}>
      {({ icon, message }) => (
        <div
          className="flex items-center gap-2.5 w-full cursor-pointer select-none"
          onClick={handleDismiss}
          title="Toca para descartar"
        >
          <div className="shrink-0">{icon}</div>
          <div className="flex-1 text-xs font-bold leading-snug">{message}</div>
          {t.type !== 'loading' && (
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 active:scale-90 transition-all cursor-pointer shrink-0"
              title="Cerrar notificación"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
    </ToastBar>
  );
}

/**
 * Contenedor raíz exclusivo para la versión móvil nativa (Android APK / OTA).
 * 100% aislado de POS.jsx y de la arquitectura Desktop para lograr arranque instantáneo
 * y menor huella de memoria RAM en dispositivos móviles.
 */
export default function MobileApp() {
  const { theme } = useTheme();
  const isDark = theme === 'dark' || theme === '2025' || theme === 'glass' || theme === 'oled' || theme === 'titanium';
  const {
    isLocked,
    user,
    appUnlock,
    logout,
    isActivated,
    machineId,
    licenseInfo,
    licenseLoading,
    setIsActivated,
    checkLicense
  } = useAuth();

  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    otaUpdateService.init();

    // Garantizar una única interfaz en Online y Offline dentro del APK nativo:
    // Desregistrar cualquier Service Worker heredado que sirva shells antiguos en modo sin red.
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      caches.keys().then((names) => {
        for (const name of names) {
          if (!name.includes('isaac-pos-img')) {
            caches.delete(name).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (user) {
      try {
        lanSyncService.init();
      } catch (err) {
        console.warn('[MobileApp] Error al inicializar lanSyncService:', err);
      }
    } else {
      try {
        lanSyncService.stop();
      } catch (err) {
        console.warn('[MobileApp] Error al detener lanSyncService:', err);
      }
    }
  }, [user]);

  useEffect(() => {
    const handleOfflineSalesSynced = (e) => {
      const count = e.detail?.count || 1;
      toast.success(`⚡ ¡${count} venta(s) fuera de línea sincronizada(s) con éxito!`, {
        id: 'offline-synced-toast',
        duration: 4500
      });
    };
    window.addEventListener('offline-sales-synced', handleOfflineSalesSynced);

    let stopSync = () => {};
    if (!isLocked) {
      stopSync = syncManager.startAutoSync(20000);
    }

    return () => {
      window.removeEventListener('offline-sales-synced', handleOfflineSalesSynced);
      stopSync();
    };
  }, [isLocked]);

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          left: 12,
          right: 12,
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          zIndex: 2147483647
        }}
        toastOptions={{
          duration: 3500,
          success: { duration: 3000 },
          error: { duration: 4000 },
          style: {
            background: isDark ? '#1e293b' : '#ffffff',
            color: isDark ? '#ffffff' : '#0f172a',
            borderRadius: '1rem',
            border: isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid #e2e8f0',
            fontSize: '13px',
            fontWeight: '600',
            boxShadow: isDark
              ? '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3)'
              : '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            maxWidth: '420px',
            cursor: 'pointer'
          }
        }}
      >
        {(t) => <AutoDismissToast toast={t} />}
      </Toaster>

      {showSplash && <SplashScreen onFinished={() => setShowSplash(false)} minDuration={650} />}

      {licenseLoading ? (
        <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center gap-4">
          <RefreshCw className="animate-spin text-blue-500" size={40} />
          <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px]">Verificando Licencia...</p>
        </div>
      ) : !isActivated ? (
        <ActivationPortal
          machineId={machineId}
          licenseInfo={licenseInfo}
          onActivated={async () => {
            setIsActivated(true);
            if (checkLicense) await checkLicense();
          }}
        />
      ) : isLocked && user ? (
        <LockScreen user={user} onUnlock={appUnlock} onLogout={logout} />
      ) : (
        <Suspense
          fallback={
            <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="animate-spin text-blue-500" size={32} />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Iniciando Terminal Móvil...
              </span>
            </div>
          }
        >
          <Routes>
            <Route path="/mobile" element={<MobilePOSSimulator />} />
            <Route path="/mobile-pos" element={<MobilePOSSimulator />} />
            <Route path="/login" element={<MobilePOSSimulator />} />
            <Route path="*" element={<MobilePOSSimulator />} />
          </Routes>
        </Suspense>
      )}
    </>
  );
}
