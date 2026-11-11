import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MobileApp from './MobileApp.jsx';
import './index.css';
import { ThemeProvider } from './hooks/ThemeContext';
import { AuthProvider } from './hooks/AuthContext';
import { SocketProvider } from './hooks/SocketContext';
import { PosProvider } from './hooks/PosContext';
import { ensureStoragePersistence } from './services/storagePersistence';
import ErrorBoundary from './components/ErrorBoundary';

// 🛡️ Blindaje de Almacenamiento Persistente en Android / iOS / PWA
ensureStoragePersistence().catch(() => {});

// Redirección directa al entorno móvil
if (typeof window !== 'undefined' && window.location) {
  if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') {
    window.location.replace(window.location.origin + '/#/mobile');
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
            <PosProvider>
              <HashRouter>
                <MobileApp />
              </HashRouter>
            </PosProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
