import { useState, useEffect, useRef, useMemo } from 'react';
import api from '../services/api';
import {
    createCatalogIndex,
    searchCatalogIndex,
    isWildcardCategory
} from '../utils/catalogSearchEngine';

/**
 * useFuzzySearch(data, searchTerm, options?)
 * - 100% compatible con llamadas legacy de 2 argumentos: useFuzzySearch(data, searchTerm)
 * - Opciones opcionales:
 *   - category: categoría seleccionada para pre-filtrado O(1) dentro del Web Worker
 *   - maxResults: máximo de resultados a retornar (por defecto 250 para catálogos 5.000+ SKUs)
 *   - enableSemantic: habilita fallback vectorial pgvector (por defecto true)
 */
export const useFuzzySearch = (data, searchTerm, options = {}) => {
    const category = options?.category ?? '';
    const maxResults = options?.maxResults ?? 250;
    const enableSemantic = options?.enableSemantic ?? true;

    const hasCategoryFilter = !isWildcardCategory(category);
    const hasSearchQuery = typeof searchTerm === 'string' && searchTerm.trim().length > 0;
    const shouldQuery = hasSearchQuery || hasCategoryFilter;

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
            for (let i = 0; i < data.length; i++) {
                const p = data[i];
                if (p && p.id) map.set(String(p.id), p);
            }
        }
        return map;
    }, [data]);

    // 1. Initialize Web Worker once in background thread
    useEffect(() => {
        let workerInstance = null;
        try {
            if (typeof window !== 'undefined' && typeof window.Worker === 'function') {
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

    const activeQueryRef = useRef({ searchTerm, category, maxResults, shouldQuery });
    useEffect(() => {
        activeQueryRef.current = { searchTerm, category, maxResults, shouldQuery };
    }, [searchTerm, category, maxResults, shouldQuery]);

    // 2. Dispatch updated catalog to Worker whenever data changes and re-run active search/category
    useEffect(() => {
        if (workerRef.current && Array.isArray(data)) {
            workerRef.current.postMessage({
                type: 'INDEX_CATALOG',
                payload: data
            });

            const current = activeQueryRef.current;
            if (current.shouldQuery) {
                queryIdRef.current += 1;
                workerRef.current.postMessage({
                    type: 'SEARCH',
                    queryId: queryIdRef.current,
                    searchTerm: current.searchTerm || '',
                    category: current.category || '',
                    maxResults: current.maxResults
                });
            }
        }
    }, [data]);

    // 3. Dispatch search query / category filter to Worker when user types or switches category
    useEffect(() => {
        if (!shouldQuery) {
            setWorkerResults(null);
            return;
        }

        if (workerRef.current) {
            queryIdRef.current += 1;
            workerRef.current.postMessage({
                type: 'SEARCH',
                queryId: queryIdRef.current,
                searchTerm: searchTerm || '',
                category: category || '',
                maxResults
            });
        }
    }, [searchTerm, category, maxResults, shouldQuery]);

    // 3.1 Integración de Búsqueda Semántica Vectorial con IA (pgvector en PostgreSQL 16)
    // Solo se invoca como fallback cuando el Web Worker local devuelve menos de 3 coincidencias directas.
    useEffect(() => {
        if (semanticDebounceRef.current) {
            clearTimeout(semanticDebounceRef.current);
        }

        const trimmed = (searchTerm || '').trim();
        if (!enableSemantic || !trimmed || trimmed.length < 3 || (Array.isArray(workerResults) && workerResults.length >= 3)) {
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
    }, [searchTerm, dataMap, workerResults, enableSemantic]);

    // 4. Fallback Synchronous Index & Search (cuando Worker no está disponible o antes del primer ACK)
    const fallbackIndex = useMemo(() => {
        if (!shouldQuery) return null;
        if (hasWorkerRef.current && workerResults !== null) return null;
        if (!Array.isArray(data) || data.length === 0) return null;
        return createCatalogIndex(data);
    }, [data, shouldQuery, workerResults]);

    const fallbackResults = useMemo(() => {
        if (!shouldQuery) return data || [];
        if (!fallbackIndex) return data || [];
        return searchCatalogIndex(fallbackIndex, searchTerm || '', {
            category: category || '',
            maxResults
        });
    }, [shouldQuery, fallbackIndex, searchTerm, category, maxResults, data]);

    // Sin filtro activo ni búsqueda: retornar catálogo original sin copias
    if (!shouldQuery) {
        return data || [];
    }

    const localMatches = workerResults !== null ? workerResults : fallbackResults;

    if (!enableSemantic || !hasSearchQuery) {
        return localMatches;
    }

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
