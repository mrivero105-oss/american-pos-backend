class ImageSearchService {
    static async findProductImageUrl(query) {
        console.log(`[IMAGE SEARCH] Buscando imagen via fetch nativo: "${query}"...`);
        try {
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            const urls = [];

            // 1. Intentar con Bing (Es el más fiable para scrapping ligero)
            try {
                const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
                const bingResponse = await fetch(bingUrl, { 
                    headers: { 
                        'User-Agent': userAgent,
                        'Accept-Language': 'en-US,en;q=0.9'
                    } 
                });

                if (bingResponse.ok) {
                    const bingHtml = await bingResponse.text();
                    
                    // Estrategia A: Buscar en el JSON de metadatos de Bing (contiene la URL original 'murl')
                    // Las comillas pueden venir como " o como &quot;. Permitimos & dentro de la URL.
                    const murlRegex = /(?:"murl"|&quot;murl&quot;)\s*[:=]\s*(?:"|&quot;)(https?:\/\/[^"\s<>]+?)(?=(?:"|&quot;))/g;
                    let murlMatch;
                    while ((murlMatch = murlRegex.exec(bingHtml)) !== null) {
                        urls.push(murlMatch[1].replace(/\\/g, ''));
                        if (urls.length >= 7) break;
                    }

                    // Estrategia B: Fallback a miniaturas de Bing si no hay murls
                    if (urls.length < 3) {
                        const thumbRegex = /src="(https:\/\/th\.bing\.com\/th\/id\/[^"]+)"/g;
                        let thumbMatch;
                        while ((thumbMatch = thumbRegex.exec(bingHtml)) !== null) {
                            const cleanThumb = thumbMatch[1].replace(/&amp;/g, '&');
                            if (!urls.includes(cleanThumb)) urls.push(cleanThumb);
                            if (urls.length >= 8) break;
                        }
                    }
                }
            } catch (e) {
                console.warn("[IMAGE SEARCH] Fallo en Bing:", e.message);
            }

            // 2. Intentar con DuckDuckGo (como respaldo secundario)
            if (urls.length === 0) {
                try {
                    const ddgUrl = `https://lite.duckduckgo.com/lite/`;
                    const ddgRes = await fetch(ddgUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': userAgent
                        },
                        body: `q=${encodeURIComponent(query)}` // Sin 'amazon' para evitar protecciones extremas
                    });

                    if (ddgRes.ok) {
                        const ddgHtml = await ddgRes.text();
                        const fallbackRegex = /(https:\/\/[^"'\s]+?\.(?:jpg|jpeg|png|webp))/gi;
                        let match;
                        while ((match = fallbackRegex.exec(ddgHtml)) !== null) {
                            if (!urls.includes(match[1])) urls.push(match[1]);
                            if (urls.length >= 5) break;
                        }
                    }
                } catch (e) {
                    console.warn("[IMAGE SEARCH] Fallo en DDG:", e.message);
                }
            }

            if (urls.length > 0) {
                console.log(`[IMAGE SEARCH] ${urls.length} candidatos encontrados.`);
                return [...new Set(urls)]; // Eliminar duplicados
            }

            return null;

        } catch (error) {
            console.error("[IMAGE SEARCH] Error crítico en búsqueda:", error.message);
            return null;
        }
    }
}

module.exports = ImageSearchService;
