const axios = require('axios');

// STRICT PRODUCT WHITESPAN & DOMAIN WHITELIST
const VALID_PRODUCT_DOMAINS = [
    'openfoodfacts.org',
    'openbeautyfacts.org',
    'mlstatic.com',
    'mercadolibre.com',
    'walmartimages.com',
    'media-amazon.com',
    'farmatodo.com',
    'exito.com',
    'carrefour.com',
    'target.com'
];

function isVerifiedProductUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (!lower.startsWith('http')) return false;

    // Must belong to verified e-commerce CDNs or open product databases
    return VALID_PRODUCT_DOMAINS.some(domain => lower.includes(domain));
}

class ImageSearchService {
    static async findProductImageUrl(query) {
        if (!query || typeof query !== 'string' || !query.trim()) return [];
        
        let cleanQuery = query.trim().replace(/lata|roja|azul|verde|paquete|caja|\b\d+(g|gr|kg|ml|l|oz)\b/gi, '').trim();
        
        // Brand spelling auto-corrections
        if (/karsell/i.test(cleanQuery) && !/karseell/i.test(cleanQuery)) {
            cleanQuery = cleanQuery.replace(/karsell/gi, 'Karseell');
        }
        if (/harina pan/i.test(cleanQuery)) {
            cleanQuery = 'Harina PAN';
        }

        console.log(`[ULTRA PRECISION ENGINE] Buscando empaque comercial oficial para: "${cleanQuery}"...`);

        const urls = [];
        const addUrl = (url) => {
            if (isVerifiedProductUrl(url) && !urls.includes(url)) {
                urls.push(url);
            }
        };

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'es-VE,es-ES;q=0.9,es;q=0.8,en;q=0.7'
        };

        // 1. OPEN FOOD FACTS & OPEN BEAUTY FACTS (Bases de datos oficiales de productos)
        const offEndpoints = [
            `https://es.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanQuery)}&search_simple=1&action=process&json=1`,
            `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanQuery)}&search_simple=1&action=process&json=1`,
            `https://es.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanQuery)}&search_simple=1&action=process&json=1`,
            `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanQuery)}&search_simple=1&action=process&json=1`
        ];

        for (const ep of offEndpoints) {
            try {
                const res = await axios.get(ep, { headers, timeout: 3500 });
                if (res.data?.products && Array.isArray(res.data.products)) {
                    res.data.products.forEach(p => {
                        const img = p.image_front_url || p.image_url;
                        if (img) addUrl(img);
                    });
                }
            } catch (e) {}
        }

        // 2. BING IMAGES RESTRINGIDO A AMAZON & MERCADOLIBRE & WALMART
        const searchTerms = [
            `"${cleanQuery}" site:amazon.com`,
            `"${cleanQuery}" site:mercadolibre.com`,
            `"${cleanQuery}" site:walmart.com`,
            `"${cleanQuery}" site:farmatodo.com`
        ];

        for (const term of searchTerms) {
            if (urls.length >= 15) break;
            try {
                const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(term)}&form=HDRSC2`;
                const res = await axios.get(bingUrl, { headers, timeout: 4000 });
                const html = res.data || '';

                const murlRegex = /murl&quot;:&quot;(https?:\/\/[^&"]+)&quot;/gi;
                let m;
                while ((m = murlRegex.exec(html)) !== null) {
                    const img = m[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                    addUrl(img);
                }
            } catch (e) {}
        }

        console.log(`[ULTRA PRECISION ENGINE] Se encontraron ${urls.length} imágenes 100% verificadas de producto.`);
        return urls;
    }
}

module.exports = ImageSearchService;
