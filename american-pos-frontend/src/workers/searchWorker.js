// Off-Main-Thread Product Search Worker for Isaac POS
// Executes normalization, token filtering, and typo-tolerant search in a background OS thread.

const normalizeText = (text) => {
    if (!text) return '';
    return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
};

let indexedProducts = [];
let barcodeMap = new Map();
let skuMap = new Map();

function indexCatalog(products) {
    if (!Array.isArray(products)) {
        indexedProducts = [];
        barcodeMap.clear();
        skuMap.clear();
        return;
    }

    barcodeMap.clear();
    skuMap.clear();

    indexedProducts = products.map((item) => {
        const name = normalizeText(item.name || item.nombre);
        const primaryBarcode = normalizeText(item.barcode || item.codigo_barras);
        const bulkBarcode = normalizeText(item.bulkBarcode);
        const midBulkBarcode = normalizeText(item.midBulkBarcode);
        const presBarcodes = Array.isArray(item.Presentations)
            ? item.Presentations.map(p => normalizeText(p.barcode)).filter(Boolean)
            : [];
        const variantSkus = Array.isArray(item.Variantes)
            ? item.Variantes.map(v => normalizeText(v.sku_variante || v.barcode)).filter(Boolean)
            : [];
        const allBarcodes = [primaryBarcode, bulkBarcode, midBulkBarcode, ...presBarcodes, ...variantSkus].filter(Boolean);
        const barcode = allBarcodes.join(' ');
        const sku = normalizeText(item.sku);
        const category = normalizeText(item.category || item.categoria);
        const activePrinciple = normalizeText(item.principio_activo);
        const words = name ? name.split(/\s+/).filter(Boolean) : [];

        const entry = {
            original: item,
            name,
            barcode,
            allBarcodes,
            sku,
            category,
            activePrinciple,
            words
        };

        allBarcodes.forEach(bc => {
            if (bc) barcodeMap.set(bc, item);
        });
        if (sku) skuMap.set(sku, item);

        return entry;
    });
}

function searchCatalog(searchTerm, maxResults = 60) {
    if (!searchTerm || typeof searchTerm !== 'string') {
        return indexedProducts.map(p => p.original);
    }

    const cleanSearch = normalizeText(searchTerm);
    if (!cleanSearch) {
        return indexedProducts.map(p => p.original);
    }

    // 1. Direct O(1) Barcode / SKU Match
    if (barcodeMap.has(cleanSearch)) {
        return [barcodeMap.get(cleanSearch)];
    }
    if (skuMap.has(cleanSearch)) {
        return [skuMap.get(cleanSearch)];
    }

    const searchTokens = cleanSearch.split(/\s+/).filter(Boolean);
    const len = cleanSearch.length;
    const matchesWithScore = [];

    for (let i = 0; i < indexedProducts.length; i++) {
        const item = indexedProducts[i];
        let score = 0;

        // Single character query
        if (len === 1) {
            if (item.name.startsWith(cleanSearch)) {
                score = 100;
            } else if (item.barcode.startsWith(cleanSearch) || item.sku.startsWith(cleanSearch)) {
                score = 90;
            } else if (item.words.some(w => w.startsWith(cleanSearch))) {
                score = 80;
            }
        } 
        // Multi-character query
        else {
            if (item.name === cleanSearch) {
                score = 950;
            } else if (item.barcode.startsWith(cleanSearch) || item.sku.startsWith(cleanSearch)) {
                score = 850;
            } else if (item.name.startsWith(cleanSearch)) {
                score = 800;
            } else if (item.words.some(w => w.startsWith(cleanSearch))) {
                score = 700;
            } else if (searchTokens.length > 1) {
                const allTokensInName = searchTokens.every(tok => 
                    item.name.includes(tok) || item.barcode.includes(tok) || item.sku.includes(tok)
                );
                if (allTokensInName) {
                    score = 650;
                }
            } else if (item.barcode.includes(cleanSearch) || item.sku.includes(cleanSearch)) {
                score = 600;
            } else if (item.name.includes(cleanSearch)) {
                score = 500;
            } else if (item.activePrinciple && item.activePrinciple.includes(cleanSearch)) {
                score = 400;
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
        const isSimilar = (a, b) => {
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
            let i = 0, j = 0, diff = 0;
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

        for (let i = 0; i < indexedProducts.length; i++) {
            const item = indexedProducts[i];
            const hasTypoMatch = item.words.some(w => isSimilar(w, cleanSearch));
            if (hasTypoMatch) {
                matchesWithScore.push({ item: item.original, score: 250 });
                if (matchesWithScore.length >= 15) break;
            }
        }
    }

    matchesWithScore.sort((a, b) => b.score - a.score);
    return matchesWithScore.map(m => m.item);
}

self.onmessage = (e) => {
    const { type, payload, queryId, searchTerm, maxResults } = e.data || {};

    if (type === 'INDEX_CATALOG') {
        indexCatalog(payload);
        self.postMessage({ type: 'INDEXED_ACK', count: indexedProducts.length });
    } else if (type === 'SEARCH') {
        const results = searchCatalog(searchTerm, maxResults);
        self.postMessage({ type: 'SEARCH_RESULTS', queryId, results });
    }
};
