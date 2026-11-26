import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import MobileApp from './MobileApp.jsx';
import './index.css';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from './providers/AuthProvider';
import { SocketProvider } from './providers/SocketProvider';
import { ensureStoragePersistence } from './services/storagePersistence';
import { installGlobalErrorHooks } from './services/mobileDiagnosticsService';
import { otaUpdateService } from './services/otaUpdateService';
import ErrorBoundary from './components/ErrorBoundary';

// 🖤 Instalar Caja Negra de diagnóstico sanitizada desde el milisegundo 0
installGlobalErrorHooks();

// 🚀 Confirmar notifyAppReady() ante CapacitorUpdater desde el milisegundo 0,
// desacoplado de AuthProvider (/auth/me) para evitar Semaphore timeout y rollbacks en arranque offline.
otaUpdateService.init().catch(() => {});

// 🛡️ Blindaje de Almacenamiento Persistente en Android / iOS / PWA
ensureStoragePersistence().catch(() => {});

// Redirección directa al entorno móvil (in-place sin recargar el documento ni romper Capgo notifyAppReady)
if (typeof window !== 'undefined' && window.location) {
  if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') {
    window.location.hash = '#/mobile';
  }
}

// Permitir menú contextual nativo (Cortar / Copiar / Pegar) en inputs y textareas en Android/iOS
if (typeof window !== 'undefined') {
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (e.ctrlKey || e.shiftKey) return;
      const target = e.target;
      if (target) {
        const tagName = target.tagName ? target.tagName.toUpperCase() : '';
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('input') ||
          target.closest('textarea') ||
          target.closest('[contenteditable="true"]')
        ) {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    },
    { capture: true }
  );
}

// Auto-recarga ante actualización de chunks dinámicos
window.addEventListener('vite:preloadError', (event) => {
  event?.preventDefault?.();
  const lastReload = sessionStorage.getItem('pos_preload_reload');
  const now = Date.now();
  if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
    sessionStorage.setItem('pos_preload_reload', String(now));
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <HashRouter>
              <MobileApp />
            </HashRouter>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
