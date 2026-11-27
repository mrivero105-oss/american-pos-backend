const TAILWIND_BREAKPOINTS = [
    ['2xl', 1536],
    ['xl', 1280],
    ['lg', 1024],
    ['md', 768],
    ['sm', 640],
    ['xs', 480]
];

export function resolveVirtualColumns(columnsConfig, width) {
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 1024;
    if (typeof columnsConfig === 'number') {
        return Math.max(1, Math.floor(columnsConfig));
    }
    if (typeof columnsConfig === 'function') {
        return Math.max(1, Math.floor(Number(columnsConfig(safeWidth)) || 1));
    }
    if (columnsConfig && typeof columnsConfig === 'object') {
        if (typeof columnsConfig.minItemWidth === 'number' && columnsConfig.minItemWidth > 0) {
            const gap = Number(columnsConfig.gap ?? 12);
            const padX = Number(columnsConfig.padX ?? 0);
            const usable = Math.max(columnsConfig.minItemWidth, safeWidth - padX);
            const rawCols = Math.max(1, Math.floor((usable + gap) / (columnsConfig.minItemWidth + gap)));
            const maxCols = Number(columnsConfig.maxColumns);
            return Number.isFinite(maxCols) && maxCols > 0 ? Math.min(rawCols, maxCols) : rawCols;
        }
        for (let i = 0; i < TAILWIND_BREAKPOINTS.length; i++) {
            const [key, minW] = TAILWIND_BREAKPOINTS[i];
            if (safeWidth >= minW && typeof columnsConfig[key] === 'number') {
                return Math.max(1, Math.floor(columnsConfig[key]));
            }
        }
        if (typeof columnsConfig.default === 'number') {
            return Math.max(1, Math.floor(columnsConfig.default));
        }
    }
    return 1;
}
