import { useState, useEffect, useRef, useCallback } from 'react';
import { triggerHaptic } from '../../utils/haptics';
import { useMobilePosStore } from '../../store/useMobilePosStore';
import { useMobileModalStore, selectHasActiveOverlay } from '../../store/useMobileModalStore';

/**
 * Hook de navegación Atrás (Android/PWA LIFO), gestos táctiles (Pull-to-Refresh 0-rerender + Edge Swipe)
 * y preservación automática de posición de scroll al alternar entre módulos (Venta, Stock, Caja, etc.).
 */
export function useMobileBackAndGestures({
  activeModule,
  setActiveModule,
  catalogScrollRef,
  selectedCategory,
  deferredSearchQuery,
  isSideNavOpen,
  setIsSideNavOpen,
  onPullRefresh,
  showToast
}) {
  const hasModalOverlay = useMobileModalStore(selectHasActiveOverlay);
  const isAnyOverlayActive = Boolean(hasModalOverlay || (activeModule && activeModule !== 'pos'));

  const backNavigationHandlerRef = useRef(null);
  const pushedHistoryCountRef = useRef(0);
  const isAnyOverlayActiveRef = useRef(false);
  isAnyOverlayActiveRef.current = isAnyOverlayActive;

  backNavigationHandlerRef.current = () => {
    // 1. Cerrar modal/overlay superior en orden LIFO desde Zustand
    if (useMobileModalStore.getState().closeTopOverlay()) {
      return 'handled';
    }

    // 2. Si algún submódulo embebido tiene un diálogo ARIA explícito abierto, cerrarlo sin DOM scraping de SVG
    if (typeof document !== 'undefined') {
      const subDialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      if (subDialogs.length > 0) {
        const topDialog = subDialogs[subDialogs.length - 1];
        const closeBtn = topDialog.querySelector('[data-modal-close], button[aria-label*="Cerrar" i], button[aria-label*="Close" i]');
        if (closeBtn && typeof closeBtn.click === 'function') {
          closeBtn.click();
          return 'handled';
        }
      }
    }

    // 3. Volver al terminal POS si está en otro módulo
    if (activeModule !== 'pos') {
      setActiveModule('pos');
      return 'handled';
    }
    return 'unhandled';
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isAnyOverlayActive) {
      if (pushedHistoryCountRef.current === 0) {
        window.history.pushState({ isaacModalBarrier: true }, '');
        pushedHistoryCountRef.current = 1;
      }
    } else {
      pushedHistoryCountRef.current = 0;
    }
  }, [isAnyOverlayActive]);

  useEffect(() => {
    const invokeBackNavigation = () => backNavigationHandlerRef.current?.() || 'unhandled';
    if (typeof window !== 'undefined') {
      window.__handleMobileBackButton = invokeBackNavigation;
    }

    let capacitorListener = null;
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App) {
      try {
        capacitorListener = window.Capacitor.Plugins.App.addListener('backButton', () => {
          invokeBackNavigation();
        });
      } catch (caughtErr) {
        console.warn('[MobileGestures] Error registrando backButton nativo:', caughtErr?.message || caughtErr);
      }
    }

    const onPopState = () => {
      pushedHistoryCountRef.current = 0;
      const res = invokeBackNavigation();
      if (res === 'handled') {
        setTimeout(() => {
          if (isAnyOverlayActiveRef.current && pushedHistoryCountRef.current === 0) {
            window.history.pushState({ isaacModalBarrier: true }, '');
            pushedHistoryCountRef.current = 1;
          }
        }, 60);
      }
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      if (typeof window !== 'undefined' && window.__handleMobileBackButton === invokeBackNavigation) {
        delete window.__handleMobileBackButton;
      }
      if (capacitorListener?.remove) capacitorListener.remove();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Preservación y restauración de scroll del catálogo POS al cambiar de pestaña
  useEffect(() => {
    if (activeModule !== 'pos') return;
    const el = catalogScrollRef.current;
    if (!el) return;

    const savedTop = useMobilePosStore.getState().getModuleScrollPosition('pos');
    if (savedTop > 0) {
      requestAnimationFrame(() => {
        if (catalogScrollRef.current) {
          catalogScrollRef.current.scrollTop = savedTop;
        }
      });
    }

    let scrollRafId = null;
    const onScroll = () => {
      if (scrollRafId !== null) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        if (catalogScrollRef.current) {
          useMobilePosStore.getState().setModuleScrollPosition('pos', catalogScrollRef.current.scrollTop);
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }
      if (el) {
        useMobilePosStore.getState().setModuleScrollPosition('pos', el.scrollTop);
        el.removeEventListener('scroll', onScroll);
      }
    };
  }, [activeModule, catalogScrollRef]);

  // Reset de scroll solo cuando el usuario cambia categoría o búsqueda
  const prevFilterKeyRef = useRef(`${selectedCategory}||${deferredSearchQuery}`);
  useEffect(() => {
    const key = `${selectedCategory}||${deferredSearchQuery}`;
    if (prevFilterKeyRef.current !== key) {
      prevFilterKeyRef.current = key;
      useMobilePosStore.getState().setModuleScrollPosition('pos', 0);
      if (catalogScrollRef.current) {
        catalogScrollRef.current.scrollTop = 0;
      }
    }
  }, [selectedCategory, deferredSearchQuery, catalogScrollRef]);

  // Pull-to-refresh de alto rendimiento (0 re-renders durante drag)
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const pullDistanceRef = useRef(0);
  const pullIndicatorRef = useRef(null);
  const pullThresholdHapticRef = useRef(false);
  const pullStartYRef = useRef(0);
  const pullRafIdRef = useRef(null);
  const edgeSwipeStartXRef = useRef(null);
  const edgeSwipeStartYRef = useRef(null);

  const handleCatalogTouchStart = useCallback((e) => {
    const target = e.currentTarget;
    if (target.scrollTop <= 0) {
      pullStartYRef.current = e.touches[0].clientY;
      pullDistanceRef.current = 0;
      pullThresholdHapticRef.current = false;
    } else {
      pullStartYRef.current = 0;
    }
  }, []);

  const handleCatalogTouchMove = useCallback((e) => {
    if (pullStartYRef.current <= 0 || isPullRefreshing) return;
    const target = e.currentTarget;
    if (target.scrollTop <= 0) {
      const currentY = e.touches[0].clientY;
      const diff = (currentY - pullStartYRef.current) * 0.45;
      if (diff > 0) {
        const clamped = Math.min(diff, 85);
        pullDistanceRef.current = clamped;
        if (!pullRafIdRef.current) {
          pullRafIdRef.current = requestAnimationFrame(() => {
            if (pullIndicatorRef.current) {
              pullIndicatorRef.current.style.height = `${clamped}px`;
              pullIndicatorRef.current.style.opacity = `${Math.min(1, clamped / 35)}`;
            }
            pullRafIdRef.current = null;
          });
        }
        if (clamped >= 60 && !pullThresholdHapticRef.current) {
          pullThresholdHapticRef.current = true;
          triggerHaptic(15);
        } else if (clamped < 60) {
          pullThresholdHapticRef.current = false;
        }
      }
    }
  }, [isPullRefreshing]);

  const handleCatalogTouchEnd = useCallback(async () => {
    if (pullRafIdRef.current) {
      cancelAnimationFrame(pullRafIdRef.current);
      pullRafIdRef.current = null;
    }
    const currentPull = pullDistanceRef.current;
    pullDistanceRef.current = 0;
    pullThresholdHapticRef.current = false;
    pullStartYRef.current = 0;

    if (currentPull >= 60 && !isPullRefreshing) {
      setIsPullRefreshing(true);
      if (pullIndicatorRef.current) {
        pullIndicatorRef.current.style.height = '44px';
        pullIndicatorRef.current.style.opacity = '1';
      }
      triggerHaptic(25);
      try {
        await onPullRefresh?.();
        showToast('✅ Catálogo y tasas actualizados');
      } catch (refreshErr) {
        console.warn('[MobileGestures] Falló pull-to-refresh:', refreshErr?.message || refreshErr);
        showToast('⚠️ No se pudo actualizar el catálogo. Verifica la conexión con la PC.');
      } finally {
        setTimeout(() => {
          if (pullIndicatorRef.current) {
            pullIndicatorRef.current.style.height = '0px';
            pullIndicatorRef.current.style.opacity = '0';
          }
          setIsPullRefreshing(false);
        }, 400);
      }
    } else if (pullIndicatorRef.current) {
      pullIndicatorRef.current.style.height = '0px';
      pullIndicatorRef.current.style.opacity = '0';
    }
  }, [isPullRefreshing, onPullRefresh, showToast]);

  const handleEdgeTouchStart = useCallback((e) => {
    const touch = e.touches && e.touches[0];
    if (!touch) {
      edgeSwipeStartXRef.current = null;
      return;
    }
    // Respetar zona reservada del gesto Atrás del sistema Android 10+ (clientX < 28px en app nativa)
    const isNativeAndroid = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
    const inSafeSwipeZone = isNativeAndroid
      ? (touch.clientX >= 28 && touch.clientX <= 72)
      : (touch.clientX >= 0 && touch.clientX < 36);
    if (inSafeSwipeZone) {
      edgeSwipeStartXRef.current = touch.clientX;
      edgeSwipeStartYRef.current = touch.clientY;
    } else {
      edgeSwipeStartXRef.current = null;
    }
  }, []);

  const handleEdgeTouchMove = useCallback((e) => {
    if (edgeSwipeStartXRef.current !== null && !isSideNavOpen && e.touches && e.touches[0]) {
      const dx = e.touches[0].clientX - edgeSwipeStartXRef.current;
      const dy = Math.abs(e.touches[0].clientY - edgeSwipeStartYRef.current);
      if (dx > 45 && dy < 40) {
        triggerHaptic(15);
        setIsSideNavOpen(true);
        edgeSwipeStartXRef.current = null;
      }
    }
  }, [isSideNavOpen, setIsSideNavOpen]);

  const handleEdgeTouchEnd = useCallback(() => {
    edgeSwipeStartXRef.current = null;
  }, []);

  return {
    isPullRefreshing,
    pullIndicatorRef,
    handleCatalogTouchStart,
    handleCatalogTouchMove,
    handleCatalogTouchEnd,
    handleEdgeTouchStart,
    handleEdgeTouchMove,
    handleEdgeTouchEnd
  };
}
