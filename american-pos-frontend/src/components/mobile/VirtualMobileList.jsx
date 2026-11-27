import { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Lista/grid virtualizada responsive sobre @tanstack/react-virtual para vistas móviles
 * con cientos o miles de filas (clientes, ventas, egresos) sin degradar FPS ni memoria.
 */
export default function VirtualMobileList({
  items = [],
  estimateSize = 110,
  gap = 10,
  overscan = 6,
  columnsMd = 1,
  columnsXl = 1,
  className = '',
  paddingClass = 'p-3',
  renderItem,
  getItemKey,
  footer = null
}) {
  const scrollParentRef = useRef(null);
  const [cols, setCols] = useState(1);

  useEffect(() => {
    const updateCols = () => {
      if (typeof window === 'undefined') return;
      const w = window.innerWidth;
      if (w >= 1280 && columnsXl > 1) setCols(columnsXl);
      else if (w >= 768 && columnsMd > 1) setCols(columnsMd);
      else setCols(1);
    };
    updateCols();
    window.addEventListener('resize', updateCols, { passive: true });
    return () => window.removeEventListener('resize', updateCols);
  }, [columnsMd, columnsXl]);

  const rowCount = Math.ceil(items.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => estimateSize + gap,
    overscan
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollParentRef}
      className={`overflow-y-auto custom-scrollbar ${paddingClass} ${className}`}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualRows.map((virtualRow) => {
          const startIdx = virtualRow.index * cols;
          const rowItems = items.slice(startIdx, startIdx + cols);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: `${gap}px`
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: `${gap}px`
                }}
              >
                {rowItems.map((item, offset) => {
                  const idx = startIdx + offset;
                  const key = getItemKey ? getItemKey(item, idx) : (item?.id ?? idx);
                  return (
                    <div key={key} className="min-w-0">
                      {renderItem(item, idx)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
