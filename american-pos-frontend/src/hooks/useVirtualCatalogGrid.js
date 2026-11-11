import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

/**
 * useVirtualCatalogGrid
 * Hook de renderizado progresivo de alto rendimiento para cuadrículas móviles.
 * - Garantiza que el 100% de los productos del catálogo se puedan recorrer sin saltos
 *   de scroll, sin huecos en blanco por diferencias de altura y sin perder el listener
 *   al cambiar entre módulos (POS <-> Inventario/Caja).
 * - Renderiza un bloque inicial inmediato (72 ítems) y amplía automáticamente en bloques
 *   de +64 ítems conforme el usuario desliza hacia abajo (vía onScroll directo + listener).
 */
export function useVirtualCatalogGrid(items = [], options = {}) {
  const {
    initialBatchSize = 24,
    batchIncrement = 20,
    containerRef = null
  } = options;

  const [columns, setColumns] = useState(2);
  const [visibleLimit, setVisibleLimit] = useState(initialBatchSize);
  const scrollTickingRef = useRef(false);
  const totalCountRef = useRef(items.length);
  totalCountRef.current = items.length;

  // Reiniciar límite inicial solo cuando cambia el filtro/categoría o llega un catálogo mayor
  useEffect(() => {
    setVisibleLimit(prev => {
      if (items.length <= initialBatchSize) return Math.max(initialBatchSize, items.length);
      return Math.max(initialBatchSize, Math.min(prev, items.length));
    });
  }, [items.length, initialBatchSize]);

  // 1. Detección responsiva de columnas según ancho real del contenedor o ventana
  useEffect(() => {
    const computeColumns = (width) => {
      if (width >= 1220) return 6;
      if (width >= 960) return 5;
      if (width >= 720) return 4;
      if (width >= 480) return 3;
      return 2;
    };

    const updateDimensions = () => {
      const containerEl = containerRef?.current;
      const rawWidth = containerEl?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 360);
      const nextCols = computeColumns(rawWidth);
      setColumns(prev => (prev !== nextCols ? nextCols : prev));
    };

    updateDimensions();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef?.current) {
      resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', updateDimensions, { passive: true });
    window.addEventListener('orientationchange', updateDimensions, { passive: true });
    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateDimensions);
      window.removeEventListener('orientationchange', updateDimensions);
    };
  }, [containerRef]);

  // 2. Función de chequeo de proximidad al borde inferior para ampliar el lote visible
  const checkAndExpand = useCallback((targetEl) => {
    const el = targetEl || containerRef?.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 750) {
      setVisibleLimit(prev => {
        const total = totalCountRef.current;
        if (prev >= total) return prev;
        return Math.min(prev + batchIncrement, total);
      });
    }
  }, [containerRef, batchIncrement]);

  const handleScroll = useCallback((e) => {
    const targetEl = e?.currentTarget || containerRef?.current;
    if (scrollTickingRef.current) return;
    scrollTickingRef.current = true;
    requestAnimationFrame(() => {
      scrollTickingRef.current = false;
      checkAndExpand(targetEl);
    });
  }, [checkAndExpand, containerRef]);

  const loadMore = useCallback(() => {
    setVisibleLimit(prev => Math.min(prev + batchIncrement * 2, totalCountRef.current));
  }, [batchIncrement]);

  const showAll = useCallback(() => {
    setVisibleLimit(totalCountRef.current);
  }, []);

  // 3. Listener de respaldo en el ref además del onScroll directo
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const onContainerScroll = () => handleScroll({ currentTarget: container });
    container.addEventListener('scroll', onContainerScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onContainerScroll);
    };
  }, [containerRef, handleScroll]);

  // 4. Resultado memoizado
  return useMemo(() => {
    const totalCount = items.length;
    const effectiveLimit = Math.min(totalCount, Math.max(initialBatchSize, visibleLimit));
    const visibleItems = totalCount <= effectiveLimit ? items : items.slice(0, effectiveLimit);

    return {
      visibleItems,
      topPadding: 0,
      bottomPadding: 0,
      totalHeight: 0,
      startIndex: 0,
      columns,
      hasMore: visibleItems.length < totalCount,
      remainingCount: Math.max(0, totalCount - visibleItems.length),
      handleScroll,
      loadMore,
      showAll
    };
  }, [items, visibleLimit, initialBatchSize, columns, handleScroll, loadMore, showAll]);
}
