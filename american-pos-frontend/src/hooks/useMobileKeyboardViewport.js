import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const FOCUSABLE_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled]):not([readonly])',
  'select:not([disabled])',
  'textarea:not([disabled]):not([readonly])'
].join(', ');

const NATIVE_KEYBOARD_EVENT = 'isaac-native-keyboard';

function readNativeKeyboardSnapshot() {
  if (typeof window === 'undefined') {
    return { visible: false, heightPx: 0 };
  }
  const snap = window.__ISAAC_NATIVE_KEYBOARD__;
  if (!snap || typeof snap !== 'object') {
    return { visible: false, heightPx: 0 };
  }
  const heightPx = Math.max(0, Math.round(Number(snap.heightPx) || 0));
  return {
    visible: Boolean(snap.visible) && heightPx > 0,
    heightPx
  };
}

/**
 * Desplaza suavemente un campo de formulario al área visible del contenedor
 * en doble pulso (110ms + 360ms) para sobrevivir a la animación de subida del teclado Android/iOS.
 */
export function scrollElementIntoComfortView(targetEl, delayMs = 110) {
  if (!targetEl || typeof targetEl.scrollIntoView !== 'function') return () => {};
  const runScroll = () => {
    try {
      targetEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
      try {
        targetEl.scrollIntoView();
      } catch {
        // Entornos jsdom/antiguos sin scrollIntoView completo
      }
    }
  };
  const firstTimer = setTimeout(runScroll, delayMs);
  const secondTimer = setTimeout(runScroll, Math.max(360, delayMs + 240));
  return () => {
    clearTimeout(firstTimer);
    clearTimeout(secondTimer);
  };
}

/**
 * Obtiene los controles editables visibles dentro de un formulario o contenedor.
 */
export function getFocusableFormFields(containerEl) {
  if (!containerEl || typeof containerEl.querySelectorAll !== 'function') return [];
  return Array.from(containerEl.querySelectorAll(FOCUSABLE_FIELD_SELECTOR)).filter((el) => {
    if (el.getAttribute('tabindex') === '-1') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    // En jsdom offsetParent es null; solo excluir si explícitamente está oculto por display/hidden
    if (el.hidden) return false;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}

/**
 * Manejador reutilizable para `onKeyDown` en `<form>` o contenedores móviles:
 * - Al presionar Enter (o Next / keyCode 13) en un campo intermedio, avanza foco al siguiente campo editable.
 * - Respeta `<textarea>` (salvo que tenga `data-enter-advance="true"`) y `<button>`.
 * - En el último campo (o si tiene `data-enter-submit="true"`), ejecuta `onSubmitLastField` si se proporciona
 *   o deja correr el submit nativo del `<form>`.
 */
export function handleMobileFormEnterAdvance(event, options = {}) {
  const isEnter = event.key === 'Enter' || event.key === 'Next' || event.keyCode === 13;
  if (!isEnter || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return false;
  }

  const target = event.target;
  if (!target || !target.tagName) return false;

  const tag = target.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'A') return false;
  if (tag === 'TEXTAREA' && target.dataset?.enterAdvance !== 'true') {
    return false;
  }

  const { containerEl = null, onSubmitLastField = null, delayMs = 110 } = options;

  // Permitir que un input indique explícitamente que Enter debe enviar de inmediato
  if (target.dataset?.enterSubmit === 'true') {
    if (typeof onSubmitLastField === 'function') {
      event.preventDefault();
      onSubmitLastField(event);
      return true;
    }
    return false;
  }

  const scope = containerEl || event.currentTarget || target.closest('form');
  if (!scope) return false;

  const fields = getFocusableFormFields(scope);
  const currentIdx = fields.indexOf(target);
  if (currentIdx === -1) return false;

  const nextField = fields[currentIdx + 1];
  if (nextField) {
    event.preventDefault();
    event.stopPropagation();
    nextField.focus();
    scrollElementIntoComfortView(nextField, delayMs);
    return true;
  }

  if (typeof onSubmitLastField === 'function') {
    event.preventDefault();
    onSubmitLastField(event);
    return true;
  }

  return false;
}

/**
 * Hook unificado de teclado virtual y viewport móvil (Android WebView Edge-to-Edge API 35+, iOS Safari, Chrome Mobile).
 * Calcula dinámicamente el espacio ocupado por el IME (VisualViewport API) y expone:
 * - `imeExtraBottomPx`: píxeles extra inferiores cuando el contenedor nativo no achica `innerHeight`.
 * - `isKeyboardOpen`: booleano confiable cuando el teclado está desplegado.
 * - `visibleViewportHeight`: alto visible real en píxeles.
 * - `modalOverlayStyle`: estilo listo para aplicar al overlay `fixed inset-0` de modales.
 * - `modalCardMaxHeightStyle`: altura máxima segura de la tarjeta modal para nunca quedar tapada por el teclado.
 * - `scrollFieldIntoView`: helper cancelable para centrar un campo enfocado.
 * - `handleFieldFocusCapture`: handler para `onFocusCapture` en contenedores/formularios.
 * - `handleFormKeyDown`: handler listo para `onKeyDown` en `<form>` que avanza con Enter campo a campo.
 */
export function useMobileKeyboardViewport({ enabled = true, compactThresholdPx = 520 } = {}) {
  const [viewportState, setViewportState] = useState(() => {
    const initialHeight = typeof window !== 'undefined' ? (window.visualViewport?.height || window.innerHeight || 0) : 0;
    const nativeSnap = readNativeKeyboardSnapshot();
    return {
      imeExtraBottomPx: nativeSnap.visible ? nativeSnap.heightPx : 0,
      isKeyboardOpen: nativeSnap.visible,
      nativeKeyboardVisible: nativeSnap.visible,
      keyboardHeightPx: nativeSnap.heightPx,
      visibleViewportHeight: Math.max(200, Math.round(initialHeight - (nativeSnap.visible ? nativeSnap.heightPx : 0)))
    };
  });

  const pendingScrollCleanupsRef = useRef([]);

  const clearPendingScrolls = useCallback(() => {
    pendingScrollCleanupsRef.current.forEach((cancel) => cancel());
    pendingScrollCleanupsRef.current = [];
  }, []);

  const scrollFieldIntoView = useCallback((targetEl, delayMs = 110) => {
    const cancel = scrollElementIntoComfortView(targetEl, delayMs);
    pendingScrollCleanupsRef.current.push(cancel);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return undefined;
    }

    const vv = window.visualViewport;
    let baselineHeight = window.innerHeight || 0;
    let nativeKb = readNativeKeyboardSnapshot();

    const applyRootOverlapVar = (overlapPx) => {
      try {
        document.documentElement.style.setProperty('--isaac-keyboard-overlap', `${Math.max(0, Math.round(overlapPx))}px`);
      } catch {
        // Entornos sin documentElement.style
      }
    };

    const updateMetrics = () => {
      const innerH = window.innerHeight || 0;
      if (!nativeKb.visible && innerH > baselineHeight) {
        baselineHeight = innerH;
      }
      const visibleH = vv ? vv.height : innerH;
      const offsetTop = vv ? vv.offsetTop : 0;

      // Cuánto ya encogió nativamente el WebView (adjustResize / SystemBars)
      const windowResizedDelta = Math.max(0, baselineHeight - innerH);
      // Porción del teclado nativo que NO fue absorbida por el redimensionamiento del WebView
      const nativeUnabsorbedOverlap = nativeKb.visible
        ? Math.max(0, Math.round(nativeKb.heightPx - windowResizedDelta))
        : 0;
      const vvOccludedBottom = Math.max(0, Math.round(innerH - visibleH - offsetTop));
      const occludedBottom = Math.max(vvOccludedBottom, nativeUnabsorbedOverlap);

      const effectiveVisible = Math.max(
        200,
        Math.round(Math.min(visibleH || innerH, Math.max(0, innerH - nativeUnabsorbedOverlap)))
      );
      const keyboardLikelyOpen =
        nativeKb.visible ||
        occludedBottom > 80 ||
        windowResizedDelta > 110 ||
        (effectiveVisible > 0 && effectiveVisible < compactThresholdPx);

      const estimatedKeyboardHeight = nativeKb.visible
        ? nativeKb.heightPx
        : Math.max(occludedBottom, windowResizedDelta);

      applyRootOverlapVar(occludedBottom);

      setViewportState((prev) => {
        if (
          prev.imeExtraBottomPx === occludedBottom &&
          prev.isKeyboardOpen === keyboardLikelyOpen &&
          prev.nativeKeyboardVisible === nativeKb.visible &&
          prev.keyboardHeightPx === estimatedKeyboardHeight &&
          prev.visibleViewportHeight === effectiveVisible
        ) {
          return prev;
        }
        return {
          imeExtraBottomPx: occludedBottom,
          isKeyboardOpen: keyboardLikelyOpen,
          nativeKeyboardVisible: nativeKb.visible,
          keyboardHeightPx: estimatedKeyboardHeight,
          visibleViewportHeight: effectiveVisible
        };
      });
    };

    const handleNativeKeyboardEvent = (evt) => {
      const detail = evt?.detail || readNativeKeyboardSnapshot();
      const heightPx = Math.max(0, Math.round(Number(detail.heightPx) || 0));
      const visible = Boolean(detail.visible) && heightPx > 0;
      const wasVisible = nativeKb.visible;
      nativeKb = { visible, heightPx };
      updateMetrics();

      if (visible && !wasVisible && typeof document !== 'undefined') {
        const active = document.activeElement;
        const tag = active?.tagName?.toUpperCase?.();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          scrollFieldIntoView(active, 70);
        }
      }
    };

    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    window.addEventListener(NATIVE_KEYBOARD_EVENT, handleNativeKeyboardEvent);
    vv?.addEventListener('resize', updateMetrics);
    vv?.addEventListener('scroll', updateMetrics);

    return () => {
      window.removeEventListener('resize', updateMetrics);
      window.removeEventListener(NATIVE_KEYBOARD_EVENT, handleNativeKeyboardEvent);
      vv?.removeEventListener('resize', updateMetrics);
      vv?.removeEventListener('scroll', updateMetrics);
      applyRootOverlapVar(0);
      clearPendingScrolls();
    };
  }, [enabled, compactThresholdPx, clearPendingScrolls, scrollFieldIntoView]);

  const handleFieldFocusCapture = useCallback((e) => {
    const tag = e?.target?.tagName?.toUpperCase?.();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      scrollFieldIntoView(e.target, 120);
    }
  }, [scrollFieldIntoView]);

  const handleFormKeyDown = useCallback((e) => {
    handleMobileFormEnterAdvance(e);
  }, []);

  const modalOverlayStyle = useMemo(() => ({
    paddingBottom: viewportState.imeExtraBottomPx > 0
      ? `calc(max(0.5rem, env(safe-area-inset-bottom, 0px)) + ${viewportState.imeExtraBottomPx}px)`
      : undefined
  }), [viewportState.imeExtraBottomPx]);

  const modalCardMaxHeightStyle = useMemo(() => {
    if (viewportState.isKeyboardOpen && viewportState.visibleViewportHeight > 220) {
      return { maxHeight: `${Math.max(220, viewportState.visibleViewportHeight - 20)}px` };
    }
    return undefined;
  }, [viewportState.isKeyboardOpen, viewportState.visibleViewportHeight]);

  return {
    imeExtraBottomPx: viewportState.imeExtraBottomPx,
    isKeyboardOpen: viewportState.isKeyboardOpen,
    nativeKeyboardVisible: viewportState.nativeKeyboardVisible,
    keyboardHeightPx: viewportState.keyboardHeightPx,
    visibleViewportHeight: viewportState.visibleViewportHeight,
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    scrollFieldIntoView,
    handleFieldFocusCapture,
    handleFormKeyDown
  };
}

export default useMobileKeyboardViewport;
