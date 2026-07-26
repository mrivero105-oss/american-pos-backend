class ImageSearchService {
    static async findProductImageUrl(query) {
        if (!query || typeof query !== 'string' || !query.trim()) return null;
        const cleanQuery = query.trim();
        console.log(`[IMAGE SEARCH] Buscando imágenes para: "${cleanQuery}"...`);
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        const urls = [];

        const addUrl = (url) => {
            if (!url || typeof url !== 'string') return;
            let clean = url.trim().replace(/\\u0026/g, '&');
            if (clean.startsWith('//')) clean = 'https:' + clean;
            if (!clean.startsWith('http')) return;
            // Exclude icons, spacers, tracking pixels
            if (clean.includes('favicon') || clean.includes('1x1') || clean.includes('pixel') || clean.includes('logo_small')) return;
            if (!urls.includes(clean)) {
                urls.push(clean);
            }
        };

        // ESTRATEGIA 1: Bing Images
        try {
            const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(cleanQuery)}&form=HDRSC2`;
            const res = await fetch(bingUrl, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                }
            });

            if (res.ok) {
                const html = await res.text();
                
                // Patrón 1: murl (Media URL)
                const murlRegex = /&quot;murl&quot;:&quot;(https?:\/\/[^&"]+)&quot;/gi;
                let m;
                while ((m = murlRegex.exec(html)) !== null) {
                    addUrl(m[1]);
                    if (urls.length >= 15) break;
                }

                // Patrón 2: m="{...}" JSON
                if (urls.length < 10) {
                    const mAttrRegex = /m="([^"]+)"/g;
                    while ((m = mAttrRegex.exec(html)) !== null) {
                        try {
                            const jsonStr = m[1].replace(/&quot;/g, '"');
                            const parsed = JSON.parse(jsonStr);
                            if (parsed.murl) addUrl(parsed.murl);
                            if (parsed.turl) addUrl(parsed.turl);
                        } catch (e) {}
                        if (urls.length >= 20) break;
                    }
                }

                // Patrón 3: Direct URL in HTML
                if (urls.length < 5) {
                    const directRegex = /"(https?:\/\/[^"]+?\.(?:jpg|jpeg|png|webp))"/gi;
                    while ((m = directRegex.exec(html)) !== null) {
                        if (!m[1].includes('bing.com') && !m[1].includes('microsoft.com')) {
                            addUrl(m[1]);
                        }
                        if (urls.length >= 20) break;
                    }
                }
            }
        } catch (e) {
            console.warn('[IMAGE SEARCH] Aviso en Bing Images:', e.message);
        }

        // ESTRATEGIA 2: Open Food Facts API
        if (urls.length < 5) {
            try {
                const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanQuery)}&search_simple=1&action=process&json=1`;
                const res = await fetch(offUrl, { headers: { 'User-Agent': userAgent } });
                if (res.ok) {
                    const data = await res.json();
                    if (data.products && Array.isArray(data.products)) {
                        data.products.forEach(p => {
                            const img = p.image_front_url || p.image_url || p.image_front_small_url;
                            if (img) addUrl(img);
                        });
                    }
                }
            } catch (e) {
                console.warn('[IMAGE SEARCH] Aviso en OpenFoodFacts:', e.message);
            }
        }

        // ESTRATEGIA 3: DuckDuckGo Images API
        if (urls.length < 5) {
            try {
                const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}`, {
                    headers: { 'User-Agent': userAgent }
                });
                if (tokenRes.ok) {
                    const tokenHtml = await tokenRes.text();
                    const vqdMatch = /vqd=['"]([^'"]+)['"]/.exec(tokenHtml) || /vqd=([\d-]+)/.exec(tokenHtml);
                    if (vqdMatch) {
                        const vqd = vqdMatch[1];
                        const ddgImgUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(cleanQuery)}&vqd=${vqd}&f=,,,`;
                        const ddgRes = await fetch(ddgImgUrl, { headers: { 'User-Agent': userAgent } });
                        if (ddgRes.ok) {
                            const ddgData = await ddgRes.json();
                            if (ddgData.results && Array.isArray(ddgData.results)) {
                                ddgData.results.forEach(r => {
                                    if (r.image) addUrl(r.image);
                                    else if (r.thumbnail) addUrl(r.thumbnail);
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[IMAGE SEARCH] Aviso en DuckDuckGo API:', e.message);
            }
        }

        // ESTRATEGIA 4: Wikimedia Commons API
        if (urls.length < 5) {
            try {
                const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrlimit=10&prop=imageinfo&iiprop=url&format=json`;
                const res = await fetch(wikiUrl, { headers: { 'User-Agent': userAgent } });
                if (res.ok) {
                    const data = await res.json();
                    if (data.query && data.query.pages) {
                        Object.values(data.query.pages).forEach(page => {
                            if (page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) {
                                addUrl(page.imageinfo[0].url);
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('[IMAGE SEARCH] Aviso en Wikimedia Commons:', e.message);
            }
        }

        if (urls.length > 0) {
            console.log(`[IMAGE SEARCH] ${urls.length} imágenes encontradas para "${cleanQuery}".`);
            return urls;
        }

        console.warn(`[IMAGE SEARCH] No se encontraron candidatos para "${cleanQuery}".`);
        return null;
    }
}

module.exports = ImageSearchService;
