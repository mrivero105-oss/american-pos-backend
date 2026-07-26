const https = require('https');
const axios = require('axios');

class BCVRateService {
    /**
     * Obtiene la tasa oficial del Banco Central de Venezuela (BCV) directamente de bcv.org.ve.
     * En caso de fallo o bloqueo de firewall, recurre a APIs de respaldo.
     */
    static async getOfficialRate() {
        // Intento 1: Scraping directo a la web oficial bcv.org.ve (Fuente Oficial)
        try {
            const bcvRate = await this.scrapeDirectBCV();
            if (bcvRate && bcvRate > 0) {
                console.log(`✅ Tasa BCV obtenida directamente de bcv.org.ve: ${bcvRate} Bs/$`);
                return { success: true, rate: bcvRate, source: 'bcv.org.ve' };
            }
        } catch (err) {
            console.warn(`⚠️ Aviso: No se pudo conectar a bcv.org.ve directamente (${err.message}). Probando API de respaldo...`);
        }

        // Intento 2: API PyDolarVenezuela
        try {
            const res = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar?page=bcv', { timeout: 5000 });
            const price = res.data?.monitors?.bcv?.price;
            if (price && !isNaN(price) && price > 0) {
                console.log(`✅ Tasa BCV obtenida vía PyDolarVenezuela API: ${price} Bs/$`);
                return { success: true, rate: Number(price), source: 'pydolarvenezuela' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en PyDolarVenezuela API: ${err.message}`);
        }

        // Intento 3: DolarAPI Venezuela
        try {
            const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 5000 });
            const promedio = res.data?.promedio;
            if (promedio && !isNaN(promedio) && promedio > 0) {
                console.log(`✅ Tasa BCV obtenida vía DolarAPI: ${promedio} Bs/$`);
                return { success: true, rate: Number(promedio), source: 'dolarapi' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en DolarAPI: ${err.message}`);
        }

        throw new Error('No se pudo obtener la tasa BCV de ninguna fuente oficial ni de respaldo.');
    }

    /**
     * Petición HTTP nativa a https://www.bcv.org.ve extrayendo la tasa del contenedor #dolar
     */
    static scrapeDirectBCV() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'www.bcv.org.ve',
                port: 443,
                path: '/',
                method: 'GET',
                rejectUnauthorized: false, // Omitir errores de certificado SSL caducado/legado del BCV
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'es-ES,es;q=0.9'
                },
                timeout: 8000
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const dolarIdx = data.indexOf('id="dolar"');
                    if (dolarIdx !== -1) {
                        const snippet = data.substring(dolarIdx, dolarIdx + 500);
                        const match = snippet.match(/<strong>\s*([\d.,]+)\s*<\/strong>/i);
                        if (match && match[1]) {
                            // Formato BCV es ej. "742,22920000" -> reemplazar punto de miles por vacio, coma por punto
                            const cleanStr = match[1].replace(/\./g, '').replace(',', '.');
                            const rateVal = parseFloat(cleanStr);
                            if (!isNaN(rateVal) && rateVal > 0) {
                                return resolve(rateVal);
                            }
                        }
                    }
                    reject(new Error('Estructura HTML de bcv.org.ve cambió o no contiene id="dolar"'));
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Tiempo de espera agotado al conectar con bcv.org.ve (Timeout)'));
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.end();
        });
    }
}

module.exports = BCVRateService;
