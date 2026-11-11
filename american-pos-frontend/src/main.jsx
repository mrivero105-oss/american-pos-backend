import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './win7.css'
import { ThemeProvider } from './hooks/ThemeContext'
import { AuthProvider } from './hooks/AuthContext'
import { SocketProvider } from './hooks/SocketContext'
import { PosProvider } from './hooks/PosContext'

// Fallback legacy desactivado en Windows 10/11 para preservar diseño UHD y paletas vibrantes
// document.documentElement.classList.remove('win7');


// 🖥️ Soporte para Visor de Cliente y Terminal Móvil (Redirección automática de pathname a HashRouter)
if (typeof window !== 'undefined' && window.location) {
  const pName = window.location.pathname.toLowerCase();
  const isMobileOS = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const isNativeApp = Boolean(
    window.location.protocol === 'capacitor:' || 
    (typeof window.Capacitor !== 'undefined' && window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) ||
    (isMobileOS && window.innerWidth <= 768 && (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#'))
  );

  if (pName.includes('/display') || pName.includes('/customer-display')) {
    if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') {
      window.location.replace(window.location.origin + '/#/display');
    }
  } else if (pName.includes('/mobile') || pName.includes('/mobile-pos') || (isNativeApp && isMobileOS) || window.location.port === '5174') {
    if (!window.location.hash || window.location.hash === '#/' || window.location.hash === '#') {
      window.location.replace(window.location.origin + '/#/mobile');
    }
  }
}

import { ensureStoragePersistence } from './services/storagePersistence'

// 🛡️ Blindaje de Almacenamiento Persistente para evitar evicción de IndexedDB por parte del SO Android
ensureStoragePersistence().catch(() => {});

// 🚫 Bloqueo Integral de Herramientas de Desarrollador (DevTools) y Menús Contextuales en Modo POS / Kiosk
if (typeof window !== 'undefined') {
  // 1. Bloquear Menú Contextual ordinario del Navegador (Clic Derecho común), pero PERMITIR en inputs/textareas
  window.addEventListener('contextmenu', (e) => {
    // Si un técnico o desarrollador mantiene presionado Ctrl o Shift al hacer clic derecho,
    // se permite el menú nativo para poder seleccionar "Inspeccionar"
    if (e.ctrlKey || e.shiftKey) return;
    
    // CRÍTICO: Permitir menú contextual nativo (Cortar / Copiar / Pegar) en inputs y textareas
    // En dispositivos móviles (Android / iOS), el toque prolongado (long-press) dispara el evento contextmenu.
    // Si se bloquea, el usuario NO puede pegar texto desde el portapapeles.
    const target = e.target;
    if (target) {
      const tagName = target.tagName ? target.tagName.toUpperCase() : '';
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable || target.closest('input') || target.closest('textarea') || target.closest('[contenteditable="true"]')) {
        return; // Permitir menú nativo de pegado/copiado
      }
    }

    // Para el resto de la interfaz (botones, tablas, fondos), anularlo para evitar menú de inspeccionar
    e.preventDefault();
    e.stopPropagation();
    return false;
  }, { capture: true });

  // 2. Bloquear Atajos comunes que abren la consola por accidente
  window.addEventListener('keydown', (e) => {
    // Bloquear tecla F12 (la tecla que tocan los cajeros por error)
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Bloquear F7 nativo del navegador para evitar activar "Caret Browsing" (cursor de escritura | en todo el POS)
    if (e.key === 'F7' || e.keyCode === 118) {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
      if (!isInput) {
        // Prevenir el Caret Browsing nativo de Chromium sin frenar los atajos del POS
        e.preventDefault();
      }
    }

    // Bloquear Ctrl + U (Ver código fuente HTML)
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const k = (e.key || '').toUpperCase();
      const code = e.keyCode;
      if (k === 'U' || code === 85) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, { capture: true });

  // 3. Eliminar cursor de texto parpadeante si Caret Browsing quedó activo en el perfil de Edge/Chrome
  const clearUnwantedCaret = () => {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (!isInput) {
      const sel = window.getSelection();
      if (sel && sel.type === 'Caret') {
        sel.removeAllRanges();
      }
    }
  };

  document.addEventListener('selectionchange', clearUnwantedCaret);
  document.addEventListener('click', clearUnwantedCaret);
}

// 🔄 Detección y auto-recarga ante actualización de módulos / chunks de Vite (evita 404 al abrir modales lazy)
window.addEventListener('vite:preloadError', (event) => {
  event?.preventDefault?.();
  const lastReload = sessionStorage.getItem('pos_preload_reload');
  const now = Date.now();
  if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
    sessionStorage.setItem('pos_preload_reload', String(now));
    console.warn('[Vite] Módulo dinámico desactualizado detectado. Recargando aplicación...');
    window.location.reload();
  }
});

window.addEventListener('error', (event) => {
  // Si no es un ErrorEvent (ej: error 404 al cargar una imagen, icono o recurso en el DOM), evitar loguear 'undefined'
  if (!event.message && !event.error) {
    return;
  }
  // Silenciar definitivamente los errores de React DevTools/Chrome Extensions que no afectan al POS
  if (event.message?.includes('React is running in production mode') || 
      event.filename?.includes('chrome-extension') ||
      event.message?.includes('__REACT_DEVTOOLS_GLOBAL_HOOK__')) {
    event.preventDefault();
    return;
  }
  console.error('Error Crítico:', event.message, 'En:', event.filename, 'Línea:', event.lineno);
}, true);

// Capturar también errores de consola directos del plugin
const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && (
      args[0].includes('React is running in production mode') || 
      args[0].includes('__REACT_DEVTOOLS_GLOBAL_HOOK__'))) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// Suppress known Recharts false-positive warning in React 18 StrictMode
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('The width(-1) and height(-1) of chart should be greater than 0')) {
    return;
  }
  originalConsoleWarn(...args);
};

import ErrorBoundary from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <PosProvider>
              <HashRouter>
                <Routes>
                  <Route path="/*" element={<App />} />
                </Routes>
              </HashRouter>
            </PosProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
