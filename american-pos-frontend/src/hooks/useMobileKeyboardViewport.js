import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const FOCUSABLE_FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled]):not([readonly])',
  'select:not([disabled])',
  'textarea:not([disabled]):not([readonly])'
].join(', ');

/**
 * Desplaza suavemente un campo de formulario al centro visible del contenedor
 * para que el teclado virtual de Android/iOS nunca tape el input activo.
 */
export function scrollElementIntoComfortView(targetEl, delayMs = 110) {
  if (!targetEl || typeof targetEl.scrollIntoView !== 'function') return () => {};
  const timerId = setTimeout(() => {
    try {
      targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      try {
        targetEl.scrollIntoView();
      } catch {
        // Entornos jsdom/antiguos sin scrollIntoView completo
      }
    }
  }, delayMs);
  return () => clearTimeout(timerId);
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
    return {
      imeExtraBottomPx: 0,
      isKeyboardOpen: false,
      visibleViewportHeight: initialHeight
    };
  });

  const pendingScrollCleanupsRef = useRef([]);

  const clearPendingScrolls = useCallback(() => {
    pendingScrollCleanupsRef.current.forEach((cancel) => cancel());
    pendingScrollCleanupsRef.current = [];
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return undefined;
    }

    const vv = window.visualViewport;
    let baselineHeight = window.innerHeight || 0;

    const updateMetrics = () => {
      const innerH = window.innerHeight || 0;
      if (innerH > baselineHeight) baselineHeight = innerH;
      const visibleH = vv ? vv.height : innerH;
      const offsetTop = vv ? vv.offsetTop : 0;
      const occludedBottom = Math.max(0, Math.round(innerH - visibleH - offsetTop));
      const keyboardLikelyOpen =
        occludedBottom > 90 ||
        (baselineHeight - visibleH > 120) ||
        (visibleH > 0 && visibleH < compactThresholdPx);

      setViewportState((prev) => {
        const roundedVisible = Math.round(visibleH);
        if (
          prev.imeExtraBottomPx === occludedBottom &&
          prev.isKeyboardOpen === keyboardLikelyOpen &&
          prev.visibleViewportHeight === roundedVisible
        ) {
          return prev;
        }
        return {
          imeExtraBottomPx: occludedBottom,
          isKeyboardOpen: keyboardLikelyOpen,
          visibleViewportHeight: roundedVisible
        };
      });
    };

    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    vv?.addEventListener('resize', updateMetrics);
    vv?.addEventListener('scroll', updateMetrics);

    return () => {
      window.removeEventListener('resize', updateMetrics);
      vv?.removeEventListener('resize', updateMetrics);
      vv?.removeEventListener('scroll', updateMetrics);
      clearPendingScrolls();
    };
  }, [enabled, compactThresholdPx, clearPendingScrolls]);

  const scrollFieldIntoView = useCallback((targetEl, delayMs = 110) => {
    const cancel = scrollElementIntoComfortView(targetEl, delayMs);
    pendingScrollCleanupsRef.current.push(cancel);
  }, []);

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
    visibleViewportHeight: viewportState.visibleViewportHeight,
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    scrollFieldIntoView,
    handleFieldFocusCapture,
    handleFormKeyDown
  };
}

export default useMobileKeyboardViewport;
