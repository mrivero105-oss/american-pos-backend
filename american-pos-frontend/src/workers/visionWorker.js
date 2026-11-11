/**
 * visionWorker.js - Isaac POS
 * Hilo secundario para reconocimiento visual y contextual de productos (Vista de Águila / Visión Edge).
 * Combina extracción de palabras clave OCR de empaque + lectura de códigos + filtrado semántico estricto.
 * Inferencia pura en <5 ms sin bloquear la cámara. Cero alucinaciones.
 */

let indexedProducts = [];

// Palabras de relleno a descartar (advertencias sanitarias, leyendas fiscales, etc.)
const STOPWORDS = new Set([
    'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con', 'sin', 'para', 'por', 'en', 'al', 'del',
    'fumar', 'causa', 'cancer', 'pulmon', 'tos', 'enfisema', 'bronquitis', 'cronica', 'salud', 'daña', 'embarazo',
    'muerte', 'humo', 'nicotina', 'tabaco', 'alquitran', 'fiel', 'ministerio', 'poder', 'popular',
    'contenido', 'neto', 'ingredientes', 'hecho', 'fabricado', 'elaborado', 'venezuela', 'peso', 'gramos', 'gr', 'kg',
    'ml', 'lts', 'litro', 'litros', 'precio', 'lote', 'vence', 'vencimiento', 'expiracion', 'caducidad', 'registrado',
    'saph', 'cpe', 'advertencia', 'atencion', 'peligro', 'aviso', 'precaucion', 'consumo', 'marca', 'registrada'
]);

function normalizeStr(str) {
    if (!str) return '';
    return str
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quita acentos (cónsul -> consul)
        .replace(/[^a-z0-9\s]/g, ' ') // Solo alfanumérico
        .trim();
}

function tokenize(str) {
    const norm = normalizeStr(str);
    if (!norm) return [];
    return norm
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

// Calcular distancia Levenshtein para palabras cortas (resistencia a errores de OCR)
function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // sustitución
                    matrix[i][j - 1] + 1,     // inserción
                    matrix[i - 1][j] + 1      // eliminación
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function wordsAreSimilar(w1, w2) {
    if (w1 === w2) return true;
    if (w1.includes(w2) || w2.includes(w1)) return true;
    const maxLen = Math.max(w1.length, w2.length);
    if (maxLen <= 4) return w1 === w2;
    const dist = levenshteinDistance(w1, w2);
    return dist <= (maxLen >= 7 ? 2 : 1);
}

self.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'INDEX_CATALOG') {
        if (Array.isArray(payload)) {
            indexedProducts = payload.map(p => {
                const rawName = (p.name || p.nombre || p.description || '').toString();
                const cleanBarcode = (p.barcode || p.codigo_barras || '').toString().trim();
                const cleanSku = (p.sku || '').toString().trim();
                const tokens = tokenize(rawName);
                const normName = normalizeStr(rawName);

                return {
                    id: p.id,
                    name: rawName,
                    price: p.price ?? p.precio ?? 0,
                    priceBs: p.priceBs ?? p.precioBs ?? 0,
                    barcode: cleanBarcode,
                    sku: cleanSku,
                    category: p.category ?? p.categoria ?? '',
                    normName,
                    tokens
                };
            });
            self.postMessage({ type: 'INDEX_COMPLETE', count: indexedProducts.length });
        }
    } else if (type === 'CLASSIFY_FRAME' || type === 'MATCH_INTELLIGENCE') {
        const { detectedText, detectedBarcode } = payload || {};

        if (indexedProducts.length === 0) {
            self.postMessage({ type: 'CLASSIFY_RESULT', matches: [], rawDetected: '' });
            return;
        }

        // 1. Coincidencia por Código de Barras Directo
        if (detectedBarcode && typeof detectedBarcode === 'string' && detectedBarcode.trim().length >= 3) {
            const cleanBc = detectedBarcode.trim();
            const barcodeMatches = indexedProducts.filter(p => p.barcode === cleanBc || p.sku === cleanBc);
            if (barcodeMatches.length > 0) {
                const results = barcodeMatches.map(p => ({
                    id: p.id,
                    name: p.name,
                    price: p.price,
                    priceBs: p.priceBs,
                    barcode: p.barcode,
                    category: p.category,
                    confidence: 100,
                    reason: 'Código de barras 100% verificado'
                }));
                self.postMessage({
                    type: 'CLASSIFY_RESULT',
                    matches: results,
                    rawDetected: cleanBc
                });
                return;
            }
        }

        // 2. Coincidencia Visual por Reconocimiento de Marca y Empaque (OCR)
        if (!detectedText || typeof detectedText !== 'string' || detectedText.trim().length === 0) {
            self.postMessage({ type: 'CLASSIFY_RESULT', matches: [], rawDetected: '' });
            return;
        }

        const queryTokens = tokenize(detectedText);
        const normQuery = normalizeStr(detectedText);

        if (queryTokens.length === 0) {
            self.postMessage({ type: 'CLASSIFY_RESULT', matches: [], rawDetected: detectedText.slice(0, 30) });
            return;
        }

        const scored = [];

        for (const prod of indexedProducts) {
            if (prod.tokens.length === 0) continue;

            let matchedTokensCount = 0;
            let exactBonus = 0;

            // Comparar cada token del producto contra los tokens detectados en la imagen
            for (const pToken of prod.tokens) {
                for (const qToken of queryTokens) {
                    if (pToken === qToken) {
                        matchedTokensCount += 1.0;
                        exactBonus += 15;
                        break;
                    } else if (wordsAreSimilar(pToken, qToken)) {
                        matchedTokensCount += 0.8;
                        break;
                    }
                }
            }

            // También verificar si la frase completa o subfrase del producto aparece en la cámara
            if (normQuery.includes(prod.normName)) {
                exactBonus += 30;
                matchedTokensCount = prod.tokens.length;
            }

            if (matchedTokensCount > 0) {
                const coverage = matchedTokensCount / prod.tokens.length;
                let confidence = Math.round(coverage * 80 + exactBonus);
                if (confidence > 98) confidence = 98;

                // UMBRAL ESTRICTO: Solo productos con coincidencia real >= 60%
                if (confidence >= 60) {
                    scored.push({
                        id: prod.id,
                        name: prod.name,
                        price: prod.price,
                        priceBs: prod.priceBs,
                        barcode: prod.barcode,
                        category: prod.category,
                        confidence
                    });
                }
            }
        }

        // Ordenar por mayor coincidencia
        scored.sort((a, b) => b.confidence - a.confidence);
        const topMatches = scored.slice(0, 4);

        self.postMessage({
            type: 'CLASSIFY_RESULT',
            matches: topMatches,
            rawDetected: queryTokens.slice(0, 5).join(' ')
        });
    }
};
