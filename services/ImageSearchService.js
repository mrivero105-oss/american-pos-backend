class ImageSearchService {
    static async findProductImageUrl(query) {
        console.log(`[IMAGE SEARCH] Buscando imagen ultra-precisa para: "${query}"...`);
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
        const urls = [];

        // ESTRATEGIA 1: Bing Images (Ultra rápido y con mayor tasa de éxito en imágenes de alta resolución)
        try {
            const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query + ' producto')}&form=HDRSC2`;
            const res = await fetch(bingUrl, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                }
            });

            if (res.ok) {
                const html = await res.text();
                
                // Patrón 1: &quot;murl&quot;:&quot;URL&quot;
                const murlRegex = /&quot;murl&quot;:&quot;(https?:\/\/[^&"]+)&quot;/gi;
                let m;
                while ((m = murlRegex.exec(html)) !== null) {
                    let imgUrl = m[1].replace(/\\u0026/g, '&');
                    if (imgUrl.startsWith('http') && !urls.includes(imgUrl)) {
                        urls.push(imgUrl);
                    }
                    if (urls.length >= 15) break;
                }

                // Patrón 2: m="{...}" JSON en atributo m
                if (urls.length < 10) {
                    const mAttrRegex = /m="([^"]+)"/g;
                    while ((m = mAttrRegex.exec(html)) !== null) {
                        try {
                            const jsonStr = m[1].replace(/&quot;/g, '"');
                            const parsed = JSON.parse(jsonStr);
                            if (parsed.murl && typeof parsed.murl === 'string' && !urls.includes(parsed.murl)) {
                                urls.push(parsed.murl);
                            }
                        } catch (e) {}
                        if (urls.length >= 20) break;
                    }
                }

                // Patrón 3: iusc JSON legacy fallback
                if (urls.length < 10) {
                    const iuscRegex = /iusc="([^"]+)"/g;
                    while ((m = iuscRegex.exec(html)) !== null) {
                        try {
                            const jsonStr = m[1].replace(/&quot;/g, '"');
                            const parsed = JSON.parse(jsonStr);
                            if (parsed.murl && typeof parsed.murl === 'string' && !urls.includes(parsed.murl)) {
                                urls.push(parsed.murl);
                            }
                        } catch (err) {}
                        if (urls.length >= 20) break;
                    }
                }
            }
        } catch (e) {
            console.warn('[IMAGE SEARCH] Fallo en Bing Images:', e.message);
        }

        // ESTRATEGIA 2: Open Food Facts API (Imágenes oficiales de productos de supermercado/alimentos)
        if (urls.length < 5) {
            try {
                const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1`;
                const res = await fetch(offUrl, { headers: { 'User-Agent': userAgent } });
                if (res.ok) {
                    const data = await res.json();
                    if (data.products && Array.isArray(data.products)) {
                        data.products.forEach(p => {
                            const img = p.image_front_url || p.image_url || p.image_front_small_url;
                            if (img && typeof img === 'string' && img.startsWith('http') && !urls.includes(img)) {
                                urls.push(img);
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('[IMAGE SEARCH] Fallo en OpenFoodFacts:', e.message);
            }
        }

        // ESTRATEGIA 3: DuckDuckGo Image API (Fallback adicional)
        if (urls.length < 5) {
            try {
                const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
                    headers: { 'User-Agent': userAgent }
                });
                if (tokenRes.ok) {
                    const tokenHtml = await tokenRes.text();
                    const vqdMatch = /vqd=['"]([^'"]+)['"]/.exec(tokenHtml) || /vqd=([\d-]+)/.exec(tokenHtml);
                    if (vqdMatch) {
                        const vqd = vqdMatch[1];
                        const ddgImgUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`;
                        const ddgRes = await fetch(ddgImgUrl, { headers: { 'User-Agent': userAgent } });
                        if (ddgRes.ok) {
                            const ddgData = await ddgRes.json();
                            if (ddgData.results && Array.isArray(ddgData.results)) {
                                ddgData.results.forEach(r => {
                                    const img = r.image || r.thumbnail;
                                    if (img && typeof img === 'string' && img.startsWith('http') && !urls.includes(img)) {
                                        urls.push(img);
                                    }
                                });
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[IMAGE SEARCH] Fallo en DuckDuckGo API:', e.message);
            }
        }

        if (urls.length > 0) {
            console.log(`[IMAGE SEARCH] ${urls.length} imágenes ultra-precisas encontradas.`);
            return [...new Set(urls)];
        }

        console.warn('[IMAGE SEARCH] No se encontraron candidatos.');
        return null;
    }
}

module.exports = ImageSearchService;
