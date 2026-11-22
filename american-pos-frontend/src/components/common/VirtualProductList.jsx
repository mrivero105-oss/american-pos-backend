import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer, observeElementRect } from '@tanstack/react-virtual';
import { resolveVirtualColumns } from '../../utils/virtualColumns';

/**
 * VirtualProductList
 * Wrapper reutilizable sobre @tanstack/react-virtual para listas y grillas responsivas
 * de gran volumen (5.000+ SKUs), virtualizando por filas completas con alturas dinámicas.
 */
export default function VirtualProductList({
    items = [],
    renderItem,
    getItemKey,
    columns = 1,
    estimateSize = 140,
    gap = 12,
    columnGap,
    overscan = 4,
    scrollElementRef = null,
    className = '',
    innerClassName = '',
    rowClassName = '',
    itemWrapperClassName = '',
    style,
    breakpointSource = 'container',
    onEndReached = null,
    endReachedThreshold = 4,
    scrollToIndex = -1,
    layoutKey = '',
    initialHeight = 640,
    initialWidth = 1024,
    testId
}) {
    'use no memo';
    const internalScrollRef = useRef(null);
    const activeScrollRef = scrollElementRef || internalScrollRef;
    const isExternalScroll = Boolean(scrollElementRef);

    const [measuredWidth, setMeasuredWidth] = useState(() => {
        if (typeof window !== 'undefined' && breakpointSource === 'window') {
            return window.innerWidth || initialWidth;
        }
        return initialWidth;
    });

    useEffect(() => {
        const updateWidth = () => {
            if (breakpointSource === 'window') {
                const w = typeof window !== 'undefined' ? window.innerWidth : initialWidth;
                if (w > 0) setMeasuredWidth(prev => (prev === w ? prev : w));
                return;
            }
            const el = activeScrollRef.current;
            const w = el?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : initialWidth);
            if (w > 0) {
                setMeasuredWidth(prev => (Math.abs(prev - w) <= 1 ? prev : w));
            }
        };

        updateWidth();

        let ro = null;
        if (breakpointSource !== 'window' && typeof ResizeObserver !== 'undefined' && activeScrollRef.current) {
            ro = new ResizeObserver(updateWidth);
            ro.observe(activeScrollRef.current);
        }

        window.addEventListener('resize', updateWidth, { passive: true });
        return () => {
            if (ro) ro.disconnect();
            window.removeEventListener('resize', updateWidth);
        };
    }, [activeScrollRef, breakpointSource, initialWidth]);

    const resolvedColumns = useMemo(
        () => resolveVirtualColumns(columns, measuredWidth),
        [columns, measuredWidth]
    );

    const rowCount = useMemo(
        () => Math.ceil((Array.isArray(items) ? items.length : 0) / resolvedColumns),
        [items, resolvedColumns]
    );

    const estimateRowHeight = useCallback((rowIndex) => {
        const base = typeof estimateSize === 'function'
            ? Number(estimateSize(rowIndex, resolvedColumns, measuredWidth))
            : Number(estimateSize);
        const safeBase = Number.isFinite(base) && base > 0 ? base : 140;
        return safeBase;
    }, [estimateSize, resolvedColumns, measuredWidth]);

    const measureRowElement = useCallback((el, _entry, instance) => {
        if (!el) return estimateRowHeight(0);
        const rectHeight = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0;
        if (rectHeight > 0) return rectHeight;
        const idx = Number(el.getAttribute?.('data-index') ?? 0);
        return instance?.options?.estimateSize ? instance.options.estimateSize(idx) : estimateRowHeight(idx);
    }, [estimateRowHeight]);

    const safeObserveElementRect = useCallback((instance, cb) => {
        return observeElementRect(instance, (rect) => {
            if (rect && rect.height > 0) {
                cb(rect);
            } else {
                cb({
                    width: rect?.width > 0 ? rect.width : (measuredWidth || initialWidth),
                    height: initialHeight
                });
            }
        });
    }, [measuredWidth, initialWidth, initialHeight]);

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => activeScrollRef.current,
        observeElementRect: safeObserveElementRect,
        estimateSize: estimateRowHeight,
        measureElement: measureRowElement,
        overscan,
        gap,
        initialRect: { width: measuredWidth || initialWidth, height: initialHeight }
    });

    // Recalcular medidas cuando cambia el layout o cantidad de columnas
    useEffect(() => {
        virtualizer.measure();
    }, [virtualizer, resolvedColumns, layoutKey, gap]);

    // Auto-scroll por índice absoluto (p. ej. navegación por teclado en POS)
    useEffect(() => {
        if (typeof scrollToIndex !== 'number' || scrollToIndex < 0 || rowCount <= 0) return;
        const targetRow = Math.min(rowCount - 1, Math.floor(scrollToIndex / resolvedColumns));
        try {
            virtualizer.scrollToIndex(targetRow, { align: 'auto' });
        } catch (_err) {
            // Ignorar si el scrollElement aún no está montado
        }
    }, [scrollToIndex, resolvedColumns, rowCount, virtualizer]);

    const virtualRows = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    // Disparador de carga incremental (onEndReached)
    const lastEndTriggerCountRef = useRef(-1);
    useEffect(() => {
        if (!onEndReached || rowCount === 0 || virtualRows.length === 0) return;
        const lastVirtualRow = virtualRows[virtualRows.length - 1];
        if (lastVirtualRow && lastVirtualRow.index >= rowCount - 1 - endReachedThreshold) {
            if (lastEndTriggerCountRef.current !== items.length) {
                lastEndTriggerCountRef.current = items.length;
                onEndReached();
            }
        }
    }, [virtualRows, rowCount, endReachedThreshold, onEndReached, items.length]);

    const effectiveColGap = columnGap ?? gap;

    const content = (
        <div
            data-testid={testId}
            data-virtual-columns={resolvedColumns}
            data-virtual-total-items={items.length}
            className={innerClassName}
            style={{
                height: `${totalSize}px`,
                width: '100%',
                position: 'relative'
            }}
        >
            {virtualRows.map((virtualRow) => {
                const startIndex = virtualRow.index * resolvedColumns;
                const endIndex = Math.min(items.length, startIndex + resolvedColumns);
                const rowItems = items.slice(startIndex, endIndex);

                return (
                    <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        className={rowClassName}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                            display: resolvedColumns > 1 ? 'grid' : 'block',
                            gridTemplateColumns: resolvedColumns > 1
                                ? `repeat(${resolvedColumns}, minmax(0, 1fr))`
                                : undefined,
                            columnGap: resolvedColumns > 1 ? `${effectiveColGap}px` : undefined
                        }}
                    >
                        {rowItems.map((item, colIdx) => {
                            const absIndex = startIndex + colIdx;
                            const key = getItemKey ? getItemKey(item, absIndex) : (item?.id ?? absIndex);
                            return (
                                <div key={key} className={itemWrapperClassName || 'min-w-0'}>
                                    {renderItem(item, absIndex, {
                                        columns: resolvedColumns,
                                        rowIndex: virtualRow.index,
                                        colIndex: colIdx
                                    })}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );

    if (isExternalScroll) {
        return content;
    }

    return (
        <div
            ref={internalScrollRef}
            className={className}
            style={style}
        >
            {content}
        </div>
    );
}

/**
 * VirtualProductTableBody
 * Virtualización oficial para <tbody> en tablas HTML (preserva columnas <thead>/<td> sin position:absolute).
 */
export function VirtualProductTableBody({
    items = [],
    colSpan = 7,
    scrollElementRef,
    estimateSize = 76,
    overscan = 4,
    renderRow,
    onEndReached = null,
    endReachedThreshold = 6,
    className = '',
    initialHeight = 600
}) {
    'use no memo';
    const measureTableRow = useCallback((el) => {
        if (!el) return estimateSize;
        const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0;
        return h > 0 ? h : estimateSize;
    }, [estimateSize]);

    const safeObserveTableRect = useCallback((instance, cb) => {
        return observeElementRect(instance, (rect) => {
            if (rect && rect.height > 0) {
                cb(rect);
            } else {
                cb({ width: rect?.width > 0 ? rect.width : 1024, height: initialHeight });
            }
        });
    }, [initialHeight]);

    const virtualizer = useVirtualizer({
        count: Array.isArray(items) ? items.length : 0,
        getScrollElement: () => scrollElementRef?.current ?? null,
        observeElementRect: safeObserveTableRect,
        estimateSize: () => estimateSize,
        measureElement: measureTableRow,
        overscan,
        initialRect: { width: 1024, height: initialHeight }
    });

    const virtualRows = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
    const paddingBottom = virtualRows.length > 0
        ? Math.max(0, totalSize - virtualRows[virtualRows.length - 1].end)
        : 0;

    const lastEndTriggerCountRef = useRef(-1);
    useEffect(() => {
        if (!onEndReached || items.length === 0 || virtualRows.length === 0) return;
        const lastRow = virtualRows[virtualRows.length - 1];
        if (lastRow && lastRow.index >= items.length - 1 - endReachedThreshold) {
            if (lastEndTriggerCountRef.current !== items.length) {
                lastEndTriggerCountRef.current = items.length;
                onEndReached();
            }
        }
    }, [virtualRows, items.length, endReachedThreshold, onEndReached]);

    return (
        <tbody className={className}>
            {paddingTop > 0 && (
                <tr aria-hidden="true">
                    <td colSpan={colSpan} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
                </tr>
            )}
            {virtualRows.map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) return null;
                return renderRow(item, virtualRow.index, virtualizer.measureElement, virtualRow);
            })}
            {paddingBottom > 0 && (
                <tr aria-hidden="true">
                    <td colSpan={colSpan} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
                </tr>
            )}
        </tbody>
    );
}
