// Off-Main-Thread Product Search Worker for Isaac POS
// Executes normalization, O(1) category/barcode/SKU lookup, token filtering, and typo-tolerant search in a background OS thread.
import { createCatalogIndex, searchCatalogIndex } from '../utils/catalogSearchEngine';

let catalogIndex = createCatalogIndex([]);

self.onmessage = (e) => {
    const { type, payload, queryId, searchTerm, maxResults, category } = e.data || {};

    if (type === 'INDEX_CATALOG') {
        catalogIndex = createCatalogIndex(payload);
        self.postMessage({ type: 'INDEXED_ACK', count: catalogIndex.indexedProducts.length });
    } else if (type === 'SEARCH') {
        const results = searchCatalogIndex(catalogIndex, searchTerm, {
            maxResults: maxResults ?? 250,
            category
        });
        self.postMessage({ type: 'SEARCH_RESULTS', queryId, results });
    }
};
