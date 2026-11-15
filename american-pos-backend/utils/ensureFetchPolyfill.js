/**
 * Aplica el polyfill de node-fetch únicamente en runtimes sin fetch nativo (Node < 18 / Electron 22).
 * Evita sobrescribir globalThis.fetch en Node 18+/20+ donde destruiría la compatibilidad con FormData/Blob nativos.
 */
function ensureFetchPolyfill() {
    if (typeof globalThis.fetch === 'function') {
        return;
    }
    try {
        const nodeFetch = require('node-fetch');
        globalThis.fetch = nodeFetch;
        global.fetch = nodeFetch;
        if (nodeFetch.Headers && typeof globalThis.Headers === 'undefined') {
            globalThis.Headers = nodeFetch.Headers;
            global.Headers = nodeFetch.Headers;
        }
        if (nodeFetch.Request && typeof globalThis.Request === 'undefined') {
            globalThis.Request = nodeFetch.Request;
            global.Request = nodeFetch.Request;
        }
        if (nodeFetch.Response && typeof globalThis.Response === 'undefined') {
            globalThis.Response = nodeFetch.Response;
            global.Response = nodeFetch.Response;
        }
    } catch (_e) {}
}

module.exports = { ensureFetchPolyfill };
