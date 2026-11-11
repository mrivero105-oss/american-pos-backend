const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

let sharedBrowser = null;
let browserCloseTimer = null;
let browserLaunchPromise = null;

const BLACKLIST_DOMAINS = [
    'shutterstock.com',
    'gettyimages.com',
    'istockphoto.com',
    'depositphotos.com',
    '123rf.com',
    'dreamstime.com',
    'freepik.com',
    'flaticon.com',
    'vector',
    'placeholder',
    'coloring',
    'colorear'
];

const JUNK_KEYWORDS = [
    'colorear',
    'dibujo para colorear',
    'coloring page',
    'clipart',
    'vector gratis',
    'cumpleaños infantil',
    'dibujos animados',
    'para pintar',
    'pngtree',
    'dibujo animado'
];

function getSystemChromePath() {
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : '',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        localAppData ? `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe` : '',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
}

async function getBrowserInstance() {
    if (browserCloseTimer) {
        clearTimeout(browserCloseTimer);
        browserCloseTimer = null;
    }

    if (sharedBrowser && sharedBrowser.isConnected()) {
        resetIdleTimer();
        return sharedBrowser;
    }

    if (browserLaunchPromise) {
        return browserLaunchPromise;
    }

    browserLaunchPromise = (async () => {
        try {
            const execPath = getSystemChromePath();
            sharedBrowser = await puppeteer.launch({
                headless: 'new',
                executablePath: execPath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1280,800'
                ]
            });
            resetIdleTimer();
            return sharedBrowser;
        } finally {
            browserLaunchPromise = null;
        }
    })();

    return browserLaunchPromise;
}

function resetIdleTimer() {
    if (browserCloseTimer) {
        clearTimeout(browserCloseTimer);
    }
    browserCloseTimer = setTimeout(async () => {
        if (sharedBrowser && sharedBrowser.isConnected()) {
            try {
                await sharedBrowser.close();
            } catch (e) {}
            sharedBrowser = null;
        }
    }, 45000);
}

function sanitizeProductQuery(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string') return '';
    return rawQuery
        .replace(/#\[.*?\]#/g, '')
        .replace(/\(.*?x\s*\d+.*?\)/gi, '')
        .replace(/\b\d+\s*(?:und|unds|unidades|unid|pcs|piezas)\b/gi, '')
        .replace(/\b(?:bulto|caja|display|pack|paquete|fardo|paca)\b/gi, '')
        .replace(/PET-/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isGoodProductImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (!lower.startsWith('http')) return false;
    if (BLACKLIST_DOMAINS.some(b => lower.includes(b))) return false;
    return true;
}

function isJunkTitle(title, queryKeywords) {
    if (!title || typeof title !== 'string') return false;
    const titleLower = title.toLowerCase();
    for (const junk of JUNK_KEYWORDS) {
        if (titleLower.includes(junk)) {
            // Permitir solo si la búsqueda explícitamente pedía esa palabra
            const askedForIt = queryKeywords.some(kw => junk.includes(kw));
            if (!askedForIt) return true;
        }
    }
    return false;
}

class ImageSearchService {
    /**
     * Búsqueda de alta fidelidad y máxima precisión para empaques comerciales de productos.
     * Prioriza fotos directas de catálogo y tiendas de comercio electrónico (que por estándar
     * ya vienen aisladas en fondo blanco o limpio de estudio).
     */
    static async findProductImageUrl(query, options = {}) {
        if (!query || typeof query !== 'string' || !query.trim()) return [];

        const cleanQuery = sanitizeProductQuery(query) || query.trim();
        console.log(`[IMAGE SEARCH] Buscando imagen comercial de alta precisión para: "${cleanQuery}"...`);

        let results = [];
        const seen = new Set();

        const addUnique = (items) => {
            if (!Array.isArray(items)) return;
            for (const item of items) {
                if (item && !seen.has(item)) {
                    seen.add(item);
                    results.push(item);
                }
            }
        };

        // PASO 1: Búsqueda exacta y limpia mediante Puppeteer (DuckDuckGo Images)
        // La consulta limpia encuentra empaques reales de supermercados y farmacias
        try {
            const puppetImgs = await ImageSearchService._searchPuppeteer(cleanQuery);
            addUnique(puppetImgs);
        } catch (e) {
            console.warn('[IMAGE SEARCH] Error en motor Puppeteer:', e.message);
        }

        // PASO 2: Si no hubo suficientes, intentar simplificando marcas o medidas
        if (results.length < 4) {
            const simplifiedQuery = cleanQuery.replace(/\b\d+(?:g|gr|kg|ml|l|oz|cm|mm)\b/gi, '').trim();
            if (simplifiedQuery && simplifiedQuery !== cleanQuery && simplifiedQuery.length >= 3) {
                try {
                    const fallbackImgs = await ImageSearchService._searchPuppeteer(simplifiedQuery);
                    addUnique(fallbackImgs);
                } catch (e) {}
            }
        }

        // PASO 3: OpenFoodFacts como respaldo opcional
        if (results.length === 0) {
            try {
                const offImgs = await ImageSearchService._searchOpenFoodFacts(cleanQuery);
                addUnique(offImgs);
            } catch (e) {}
        }

        console.log(`[IMAGE SEARCH] Encontradas ${results.length} imágenes de alta precisión para: "${cleanQuery}"`);
        return results;
    }

    /**
     * Motor principal vía Puppeteer con scoring semántico estricto y descarte de cliparts/vectores
     */
    static async _searchPuppeteer(cleanQuery) {
        let page = null;
        try {
            const browser = await getBrowserInstance();
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

            // Búsqueda limpia y directa sin ensuciar la consulta
            const url = `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&iax=images&ia=images`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
            await page.waitForSelector('img[src*="duckduckgo.com/iu/?u="], .tile--img__img', { timeout: 6000 }).catch(() => {});

            const rawResults = await page.evaluate(() => {
                const list = [];
                const imgEls = document.querySelectorAll('img');
                for (const img of imgEls) {
                    const src = img.src || img.getAttribute('src');
                    if (src && src.includes('duckduckgo.com/iu/?u=')) {
                        try {
                            const urlParam = new URL(src).searchParams.get('u');
                            if (urlParam) {
                                list.push({
                                    title: img.alt || '',
                                    url: decodeURIComponent(urlParam),
                                    thumb: src
                                });
                            }
                        } catch (e) {}
                    }
                }
                return list;
            });

            await page.close();
            page = null;
            resetIdleTimer();

            // Desglosar palabras clave de la consulta del producto
            const keywords = cleanQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
            const scored = [];
            const seen = new Set();

            for (const item of rawResults) {
                const candidateUrl = item.thumb || item.url;
                if (!candidateUrl || !isGoodProductImageUrl(candidateUrl) || seen.has(candidateUrl)) continue;

                // Descartar resultados basura (colorear, cliparts infantiles, etc.)
                if (isJunkTitle(item.title, keywords)) continue;

                seen.add(candidateUrl);

                // Calificar la relevancia según las palabras del producto
                const titleLower = (item.title || '').toLowerCase();
                let score = 0;
                for (const kw of keywords) {
                    if (titleLower.includes(kw)) {
                        score += 3;
                    }
                }

                // Bonificación si el título incluye palabras típicas de producto comercial
                if (titleLower.includes('tostado') || titleLower.includes('molido') || titleLower.includes('gourmet') ||
                    titleLower.includes('tienda') || titleLower.includes('mercadolibre') || titleLower.includes('supermercado') ||
                    titleLower.includes('market') || titleLower.includes('farmacia') || titleLower.includes('original')) {
                    score += 1;
                }

                scored.push({ url: candidateUrl, title: item.title, score });
            }

            // Ordenar: primero los de mayor puntuación y relevancia comprobada
            scored.sort((a, b) => b.score - a.score);

            return scored.slice(0, 20).map(s => s.url);
        } catch (e) {
            if (page) await page.close().catch(() => {});
            throw e;
        }
    }

    /**
     * Respaldo vía OpenFoodFacts
     */
    static async _searchOpenFoodFacts(cleanQuery) {
        try {
            const headers = {
                'User-Agent': 'IsaacPOS-Desktop-App/1.0 (support@isaacpos.com)',
                'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8'
            };

            const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanQuery)}&search_simple=1&action=process&json=1&page_size=8`;
            const res = await axios.get(offUrl, { headers, timeout: 4000 });
            const products = res.data?.products || [];
            const results = [];

            for (const p of products) {
                const img = p.image_front_url || p.image_url || p.selected_images?.front?.display?.es || p.selected_images?.front?.display?.en;
                if (img && isGoodProductImageUrl(img) && !results.includes(img)) {
                    results.push(img);
                }
            }
            return results;
        } catch (e) {
            return [];
        }
    }
}

module.exports = ImageSearchService;
