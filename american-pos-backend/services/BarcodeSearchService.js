class BarcodeSearchService {
    static async findProductBarcode(query) {
        console.log(`[BARCODE SEARCH] Buscando código de barras via fetch nativo para: "${query}"...`);
        try {
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

            // 1. Intentar en Bing
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query + ' barcode EAN')}`;
            const bingResponse = await fetch(bingUrl, { headers: { 'User-Agent': userAgent } });
            let textContent = await bingResponse.text();

            // Regex mejorado: Busca números de 12 o 13 dígitos
            const barcodeRegex = /\b\d{12,13}\b/g;
            let matches = textContent.match(barcodeRegex) || [];

            // 2. Si falló, intentar en DuckDuckGo
            if (matches.length === 0) {
                console.log(`[BARCODE SEARCH] No se halló en Bing, intentando en DuckDuckGo...`);
                const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' barcode EAN')}`;
                const ddgResponse = await fetch(ddgUrl, { headers: { 'User-Agent': userAgent } });
                textContent = await ddgResponse.text();
                matches = textContent.match(barcodeRegex) || [];
            }

            if (matches && matches.length > 0) {
                const uniqueBarcodes = [...new Set(matches)];
                console.log(`[BARCODE SEARCH] Hallados: ${uniqueBarcodes.join(', ')}`);
                
                // Priorizar el de 13 dígitos
                const bestMatch = uniqueBarcodes.find(b => b.length === 13) || uniqueBarcodes[0];
                return bestMatch;
            }

            return null;

        } catch (error) {
            console.error("[BARCODE SEARCH] Error en la búsqueda:", error.message);
            return null;
        }
    }
}

module.exports = BarcodeSearchService;
