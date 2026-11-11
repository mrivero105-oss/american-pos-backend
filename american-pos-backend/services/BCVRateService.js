const https = require('https');
const axios = require('axios');

class BCVRateService {
    static historyCache = null;
    static historyCacheTime = 0;

    /**
     * Obtiene la tasa oficial del Banco Central de Venezuela (BCV).
     * Si se proporciona una fecha (ej: '2026-08-14'), busca la tasa histórica exacta o del último día hábil para esa fecha.
     * Si no se proporciona fecha o es la fecha actual, obtiene la tasa vigente de bcv.org.ve / DolarAPI.
     */
    static async getOfficialRate(targetDateStr = null) {
        const todayStr = new Date().toISOString().substring(0, 10);
        const targetDate = targetDateStr ? targetDateStr.substring(0, 10) : todayStr;

        // Si es la fecha de hoy o no se especificó fecha, buscar tasa actual activa
        if (!targetDateStr || targetDate >= todayStr) {
            return await this.getCurrentRate();
        }

        // Si es una fecha pasada, consultar histórico oficial del BCV
        return await this.getHistoricalRate(targetDate);
    }

    /**
     * Consulta la tasa activa actual vigente de bcv.org.ve o APIs de respaldo
     */
    static async getCurrentRate() {
        // Intento 1: Scraping directo a la web oficial bcv.org.ve
        try {
            const bcvRate = await this.scrapeDirectBCV();
            if (bcvRate && bcvRate > 0) {
                console.log(`✅ Tasa BCV obtenida directamente de bcv.org.ve: ${bcvRate} Bs/$`);
                return { success: true, rate: bcvRate, source: 'bcv.org.ve' };
            }
        } catch (err) {
            console.warn(`⚠️ Aviso: No se pudo conectar a bcv.org.ve directamente (${err.message}). Probando API de respaldo...`);
        }

        // Intento 2: DolarAPI Venezuela
        try {
            const res = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 5000 });
            const promedio = res.data?.promedio;
            if (promedio && !isNaN(promedio) && promedio > 0) {
                console.log(`✅ Tasa BCV actual obtenida vía DolarAPI: ${promedio} Bs/$`);
                return { success: true, rate: Number(promedio), source: 'dolarapi' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en DolarAPI: ${err.message}`);
        }

        // Intento 3: API PyDolarVenezuela
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

        throw new Error('No se pudo obtener la tasa BCV actual de ninguna fuente oficial ni de respaldo.');
    }

    /**
     * Consulta el historial oficial de tasas del BCV por fecha
     */
    static async getHistoricalRate(targetDate) {
        try {
            const now = Date.now();
            if (!this.historyCache || now - this.historyCacheTime > 60 * 60 * 1000) {
                const histRes = await axios.get('https://ve.dolarapi.com/v1/historicos/dolares/oficial', { timeout: 10000 });
                if (Array.isArray(histRes.data)) {
                    this.historyCache = histRes.data;
                    this.historyCacheTime = now;
                }
            }

            if (Array.isArray(this.historyCache) && this.historyCache.length > 0) {
                // 1. Coincidencia exacta de fecha
                const exact = this.historyCache.find(d => d.fecha === targetDate);
                if (exact && exact.promedio > 0) {
                    console.log(`✅ Tasa histórica BCV para ${targetDate}: ${exact.promedio} Bs/$ (Coincidencia exacta)`);
                    return {
                        success: true,
                        rate: Number(exact.promedio),
                        date: exact.fecha,
                        source: 'bcv_oficial_historico'
                    };
                }

                // 2. Si cayó en fin de semana o feriado, tomar el último día hábil bancario anterior
                const priorRates = this.historyCache
                    .filter(d => d.fecha <= targetDate && d.promedio > 0)
                    .sort((a, b) => b.fecha.localeCompare(a.fecha));

                if (priorRates.length > 0) {
                    const matched = priorRates[0];
                    console.log(`✅ Tasa histórica BCV para ${targetDate} (tomando día hábil ${matched.fecha}): ${matched.promedio} Bs/$`);
                    return {
                        success: true,
                        rate: Number(matched.promedio),
                        date: matched.fecha,
                        originalRequestedDate: targetDate,
                        source: 'bcv_oficial_historico_habil'
                    };
                }
            }
        } catch (err) {
            console.warn(`⚠️ Error consultando histórico BCV (${err.message}). Recurriendo a tasa actual.`);
        }

        // Si falla la consulta histórica, recurrir a la tasa actual
        const current = await this.getCurrentRate();
        return {
            ...current,
            date: targetDate,
            source: current.source + '_fallback'
        };
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
                rejectUnauthorized: false,
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
                            let s = match[1].trim();
                            if (s.includes(',') && s.includes('.')) {
                                if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
                                    s = s.replace(/\./g, '').replace(/,/g, '.');
                                } else {
                                    s = s.replace(/,/g, '');
                                }
                            } else if (s.includes(',')) {
                                s = s.replace(/,/g, '.');
                            }
                            const rateVal = parseFloat(s);
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
