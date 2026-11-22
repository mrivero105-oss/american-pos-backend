// Motor de búsqueda e indexación de catálogo de alto rendimiento (5.000+ SKUs)
// Compartido entre el Web Worker (off-main-thread) y el fallback síncrono.

export const normalizeText = (text) => {
    if (!text) return '';
    return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
};

export const isWildcardCategory = (category) => {
    if (!category || typeof category !== 'string') return true;
    const norm = normalizeText(category);
    return !norm || norm === 'todas' || norm === 'todos' || norm.includes('sin stock');
};

export function createCatalogIndex(products) {
    const indexedProducts = [];
    const barcodeMap = new Map();
    const skuMap = new Map();
    const categoryMap = new Map();

    if (!Array.isArray(products) || products.length === 0) {
        return { indexedProducts, barcodeMap, skuMap, categoryMap };
    }

    for (let i = 0; i < products.length; i++) {
        const item = products[i];
        if (!item) continue;

        const name = normalizeText(item.name || item.nombre);
        const primaryBarcode = normalizeText(item.barcode || item.codigo_barras);
        const bulkBarcode = normalizeText(item.bulkBarcode);
        const midBulkBarcode = normalizeText(item.midBulkBarcode);

        const rawPres = Array.isArray(item.Presentations)
            ? item.Presentations
            : (Array.isArray(item.presentations) ? item.presentations : []);
        const presBarcodes = rawPres.length > 0
            ? rawPres.map(p => normalizeText(p?.barcode)).filter(Boolean)
            : [];

        const rawVars = Array.isArray(item.Variantes) ? item.Variantes : [];
        const variantCodes = rawVars.length > 0
            ? rawVars.flatMap(v => [
                normalizeText(v?.sku_variante),
                normalizeText(v?.barcode),
                normalizeText(v?.codigo_barras),
                normalizeText(v?.sku)
            ]).filter(Boolean)
            : [];

        const allBarcodes = [primaryBarcode, bulkBarcode, midBulkBarcode, ...presBarcodes, ...variantCodes].filter(Boolean);
        const barcode = allBarcodes.join(' ');
        const sku = normalizeText(item.sku || item.code);
        const category = normalizeText(item.category || item.categoria || 'general');
        const activePrinciple = normalizeText(item.principio_activo);
        const supplier = normalizeText(item.Supplier?.name || item.supplierName);
        const batchNumber = normalizeText(item.batchNumber);
        const words = name ? name.split(/\s+/).filter(Boolean) : [];

        const entry = {
            original: item,
            name,
            barcode,
            allBarcodes,
            sku,
            category,
            activePrinciple,
            supplier,
            batchNumber,
            words
        };

        indexedProducts.push(entry);

        for (let b = 0; b < allBarcodes.length; b++) {
            const bc = allBarcodes[b];
            if (bc && !barcodeMap.has(bc)) {
                barcodeMap.set(bc, entry);
            }
        }
        if (sku && !skuMap.has(sku)) {
            skuMap.set(sku, entry);
        }

        if (category) {
            let bucket = categoryMap.get(category);
            if (!bucket) {
                bucket = [];
                categoryMap.set(category, bucket);
            }
            bucket.push(entry);
        }
    }

    return { indexedProducts, barcodeMap, skuMap, categoryMap };
}

const isSimilarWord = (a, b) => {
    const maxDist = a.length >= 6 ? 2 : 1;
    if (Math.abs(a.length - b.length) > maxDist) return false;
    if (a === b) return true;

    if (a.length === b.length) {
        let diff = 0;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                diff++;
                if (diff > maxDist) return false;
            }
        }
        return diff <= maxDist;
    }

    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    let i = 0;
    let j = 0;
    let diff = 0;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] !== longer[j]) {
            diff++;
            if (diff > maxDist) return false;
            j++;
        } else {
            i++;
            j++;
        }
    }
    return true;
};

export function searchCatalogIndex(index, searchTerm, optionsOrMaxResults = {}) {
    if (!index || !Array.isArray(index.indexedProducts)) return [];

    const opts = typeof optionsOrMaxResults === 'number'
        ? { maxResults: optionsOrMaxResults }
        : (optionsOrMaxResults || {});

    const maxResults = Number.isFinite(opts.maxResults) && opts.maxResults > 0 ? opts.maxResults : 250;
    const rawCategory = opts.category;
    const useCategoryFilter = !isWildcardCategory(rawCategory);
    const normCategory = useCategoryFilter ? normalizeText(rawCategory) : '';

    // 0. Universo pre-indexado en O(1) si hay categoría específica
    const pool = useCategoryFilter
        ? (index.categoryMap.get(normCategory) || [])
        : index.indexedProducts;

    if (!searchTerm || typeof searchTerm !== 'string') {
        return pool.map(p => p.original);
    }

    const cleanSearch = normalizeText(searchTerm);
    if (!cleanSearch) {
        return pool.map(p => p.original);
    }

    // 1. Direct O(1) Barcode / SKU Match
    const barcodeHit = index.barcodeMap.get(cleanSearch);
    if (barcodeHit && (!useCategoryFilter || barcodeHit.category === normCategory)) {
        return [barcodeHit.original];
    }
    const skuHit = index.skuMap.get(cleanSearch);
    if (skuHit && (!useCategoryFilter || skuHit.category === normCategory)) {
        return [skuHit.original];
    }

    const searchTokens = cleanSearch.split(/\s+/).filter(Boolean);
    const len = cleanSearch.length;
    const matchesWithScore = [];

    for (let i = 0; i < pool.length; i++) {
        const item = pool[i];
        let score = 0;

        if (len === 1) {
            if (item.name.startsWith(cleanSearch)) {
                score = 100;
            } else if (item.barcode.startsWith(cleanSearch) || item.sku.startsWith(cleanSearch)) {
                score = 90;
            } else if (item.words.some(w => w.startsWith(cleanSearch))) {
                score = 80;
            }
        } else {
            if (item.name === cleanSearch) {
                score = 950;
            } else if (item.barcode.startsWith(cleanSearch) || item.sku.startsWith(cleanSearch)) {
                score = 850;
            } else if (item.name.startsWith(cleanSearch)) {
                score = 800;
            } else if (item.words.some(w => w.startsWith(cleanSearch))) {
                score = 700;
            } else if (searchTokens.length > 1) {
                const allTokensMatch = searchTokens.every(tok =>
                    item.name.includes(tok) ||
                    item.barcode.includes(tok) ||
                    item.sku.includes(tok) ||
                    (item.category && item.category.includes(tok)) ||
                    (item.activePrinciple && item.activePrinciple.includes(tok))
                );
                if (allTokensMatch) {
                    score = 650;
                }
            } else if (item.barcode.includes(cleanSearch) || item.sku.includes(cleanSearch)) {
                score = 600;
            } else if (item.name.includes(cleanSearch)) {
                score = 500;
            } else if (item.activePrinciple && item.activePrinciple.includes(cleanSearch)) {
                score = 400;
            } else if (item.supplier && item.supplier.includes(cleanSearch)) {
                score = 350;
            } else if (item.batchNumber && item.batchNumber.includes(cleanSearch)) {
                score = 320;
            } else if (len >= 3 && item.category && item.category.includes(cleanSearch)) {
                score = 300;
            }
        }

        if (score > 0) {
            matchesWithScore.push({ item: item.original, score });
            if (matchesWithScore.length >= maxResults && score >= 700) {
                break;
            }
        }
    }

    // 2. Levenshtein Typo Tolerance Fallback (if 0 matches and query >= 3 chars)
    if (matchesWithScore.length === 0 && cleanSearch.length >= 3) {
        const typoLimit = Math.min(25, maxResults);
        for (let i = 0; i < pool.length; i++) {
            const item = pool[i];
            if (item.words.some(w => isSimilarWord(w, cleanSearch))) {
                matchesWithScore.push({ item: item.original, score: 250 });
                if (matchesWithScore.length >= typoLimit) break;
            }
        }
    }

    matchesWithScore.sort((a, b) => b.score - a.score);
    return matchesWithScore.length > maxResults
        ? matchesWithScore.slice(0, maxResults).map(m => m.item)
        : matchesWithScore.map(m => m.item);
}
