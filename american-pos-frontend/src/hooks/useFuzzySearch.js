import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../services/api';

// Helper to remove accents, lowercase and trim text for ultra-fast matching
const normalizeText = (text) => {
    if (!text) return '';
    return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
};

export const useFuzzySearch = (data, searchTerm) => {
    const [workerResults, setWorkerResults] = useState(null);
    const [semanticResults, setSemanticResults] = useState(null);
    const semanticDebounceRef = useRef(null);
    const workerRef = useRef(null);
    const queryIdRef = useRef(0);
    const hasWorkerRef = useRef(false);

    // Mapeo rápido de productos locales por ID para enriquecer respuestas del backend
    const dataMap = useMemo(() => {
        const map = new Map();
        if (Array.isArray(data)) {
            data.forEach(p => {
                if (p && p.id) map.set(String(p.id), p);
            });
        }
        return map;
    }, [data]);

    // 1. Initialize Web Worker once in background thread
    useEffect(() => {
        let workerInstance = null;
        try {
            if (typeof window !== 'undefined' && window.Worker) {
                workerInstance = new Worker(
                    new URL('../workers/searchWorker.js', import.meta.url),
                    { type: 'module' }
                );

                workerInstance.onmessage = (e) => {
                    const { type, queryId, results } = e.data || {};
                    if (type === 'SEARCH_RESULTS' && queryId === queryIdRef.current) {
                        setWorkerResults(results);
                    }
                };

                workerRef.current = workerInstance;
                hasWorkerRef.current = true;
            }
        } catch (_err) {
            console.warn('[useFuzzySearch] Web Worker not supported in this runtime, using main thread fallback');
            workerRef.current = null;
            hasWorkerRef.current = false;
        }

        return () => {
            if (workerInstance) {
                workerInstance.terminate();
                workerRef.current = null;
                hasWorkerRef.current = false;
            }
        };
    }, []);

    const searchTermRef = useRef(searchTerm);
    useEffect(() => {
        searchTermRef.current = searchTerm;
    }, [searchTerm]);

    // 2. Dispatch updated catalog to Worker whenever data changes and re-run active search
    useEffect(() => {
        if (workerRef.current && Array.isArray(data)) {
            workerRef.current.postMessage({
                type: 'INDEX_CATALOG',
                payload: data
            });

            // Si el usuario tiene una búsqueda activa, re-ejecutarla inmediatamente con el catálogo actualizado
            const activeQuery = searchTermRef.current;
            if (activeQuery && typeof activeQuery === 'string' && activeQuery.trim()) {
                queryIdRef.current += 1;
                workerRef.current.postMessage({
                    type: 'SEARCH',
                    queryId: queryIdRef.current,
                    searchTerm: activeQuery,
                    maxResults: 60
                });
            }
        }
    }, [data]);

    // 3. Dispatch search query to Worker when user types
    useEffect(() => {
        if (!searchTerm || typeof searchTerm !== 'string' || !searchTerm.trim()) {
            setWorkerResults(null);
            return;
        }

        if (workerRef.current) {
            queryIdRef.current += 1;
            workerRef.current.postMessage({
                type: 'SEARCH',
                queryId: queryIdRef.current,
                searchTerm,
                maxResults: 60
            });
        }
    }, [searchTerm]);

    // 3.1 Integración de Búsqueda Semántica Vectorial con IA (pgvector en PostgreSQL 16)
    // Solo se invoca como fallback cuando el Web Worker local devuelve menos de 3 coincidencias directas.
    useEffect(() => {
        if (semanticDebounceRef.current) {
            clearTimeout(semanticDebounceRef.current);
        }

        const trimmed = (searchTerm || '').trim();
        if (!trimmed || trimmed.length < 3 || (Array.isArray(workerResults) && workerResults.length >= 3)) {
            setSemanticResults(null);
            return;
        }

        semanticDebounceRef.current = setTimeout(async () => {
            try {
                const res = await api.get('/products/semantic-search', {
                    params: { q: trimmed, limit: 30 }
                });

                if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
                    const mapped = res.data.data.map(sp => {
                        const local = dataMap.get(String(sp.id));
                        return local ? { ...local, _semanticScore: sp.score, _matchType: sp.matchType } : sp;
                    }).filter(Boolean);
                    setSemanticResults(mapped);
                }
            } catch (_err) {
                // Silencioso ante offline para no perturbar al cajero
            }
        }, 280);

        return () => {
            if (semanticDebounceRef.current) {
                clearTimeout(semanticDebounceRef.current);
            }
        };
    }, [searchTerm, dataMap, workerResults]);

    // 4. Fallback Synchronous Search (only when Worker is unavailable AND there is an active search term)
    const indexedData = useMemo(() => {
        if (!searchTerm || typeof searchTerm !== 'string' || !searchTerm.trim()) return [];
        if (hasWorkerRef.current) return [];
        if (!Array.isArray(data) || data.length === 0) return [];
        return data.map(item => {
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

            return {
                original: item,
                name,
                barcode,
                allBarcodes,
                sku,
                category,
                activePrinciple,
                words
            };
        });
    }, [data, searchTerm]);

    const fallbackResults = useMemo(() => {
        if (!searchTerm || typeof searchTerm !== 'string') return data || [];
        const cleanSearch = normalizeText(searchTerm);
        if (!cleanSearch || !indexedData.length) return data || [];

        // Direct Exact Match (Barcode / SKU Scanner): O(1) Instant Return
        for (let i = 0; i < indexedData.length; i++) {
            const item = indexedData[i];
            if ((item.allBarcodes && item.allBarcodes.includes(cleanSearch)) || item.barcode === cleanSearch || item.sku === cleanSearch) {
                return [item.original];
            }
        }

        const searchTokens = cleanSearch.split(/\s+/).filter(Boolean);
        const len = cleanSearch.length;
        const matchesWithScore = [];
        const MAX_MATCHES_TO_COLLECT = 60;

        for (let i = 0; i < indexedData.length; i++) {
            const item = indexedData[i];
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
                if (matchesWithScore.length >= MAX_MATCHES_TO_COLLECT && score >= 700) {
                    break;
                }
            }
        }

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

            for (let i = 0; i < indexedData.length; i++) {
                const item = indexedData[i];
                const hasTypoMatch = item.words.some(w => isSimilar(w, cleanSearch));
                if (hasTypoMatch) {
                    matchesWithScore.push({ item: item.original, score: 250 });
                    if (matchesWithScore.length >= 15) break;
                }
            }
        }

        matchesWithScore.sort((a, b) => b.score - a.score);
        return matchesWithScore.map(m => m.item);
    }, [searchTerm, indexedData, data]);

    // Return worker results if available, otherwise return fallback
    if (!searchTerm || !searchTerm.trim()) {
        return data || [];
    }

    const localMatches = workerResults !== null ? workerResults : fallbackResults;

    // Si la búsqueda sintáctica local no encontró resultados pero la búsqueda semántica sí:
    if ((!localMatches || localMatches.length === 0) && semanticResults && semanticResults.length > 0) {
        return semanticResults;
    }

    // Si ambos tienen resultados y los locales son pocos, complementar con los semánticos sin duplicar
    if (localMatches && localMatches.length > 0 && semanticResults && semanticResults.length > 0 && localMatches.length < 15) {
        const seenIds = new Set(localMatches.map(p => String(p.id)));
        const additional = semanticResults.filter(p => !seenIds.has(String(p.id)));
        return [...localMatches, ...additional];
    }

    return localMatches;
};
