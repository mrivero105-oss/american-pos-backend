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
     * Extrae numéricamente una tasa de un contenedor HTML de bcv.org.ve (ej. id="dolar" o id="euro").
     */
    static parseBcvHtmlRate(html, containerId) {
        if (!html || typeof html !== 'string' || !containerId) return null;
        const idx = html.indexOf(`id="${containerId}"`);
        if (idx === -1) return null;
        const snippet = html.substring(idx, idx + 600);
        const match = snippet.match(/<strong>\s*([\d.,]+)\s*<\/strong>/i);
        if (!match || !match[1]) return null;
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
        return (!isNaN(rateVal) && rateVal > 0) ? rateVal : null;
    }

    /**
     * Consulta la tasa activa actual vigente de bcv.org.ve o APIs de respaldo (USD + EUR oficial BCV)
     */
    static async getCurrentRate() {
        // Intento 1: Scraping directo a la web oficial bcv.org.ve (obtiene Dólar y Euro en una sola petición)
        try {
            const direct = await this.scrapeDirectBCVRates();
            if (direct && direct.rate > 0) {
                let euroRate = direct.euroRate || null;
                if (!euroRate) {
                    try {
                        const eurFallback = await this.fetchEuroRateFromApis();
                        if (eurFallback && eurFallback.euroRate > 0) euroRate = eurFallback.euroRate;
                    } catch { /* no bloquear USD si falla fallback EUR */ }
                }
                console.log(`✅ Tasa BCV obtenida directamente de bcv.org.ve: ${direct.rate} Bs/$${euroRate ? ` | ${euroRate} Bs/€` : ''}`);
                return { success: true, rate: direct.rate, euroRate, source: 'bcv.org.ve' };
            }
        } catch (err) {
            console.warn(`⚠️ Aviso: No se pudo conectar a bcv.org.ve directamente (${err.message}). Probando API de respaldo...`);
        }

        // Intento 2: DolarAPI Venezuela (USD + EUR oficial en paralelo)
        try {
            const [usdRes, eurRes] = await Promise.allSettled([
                axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 5000 }),
                axios.get('https://ve.dolarapi.com/v1/euros/oficial', { timeout: 5000 })
            ]);
            const promedio = usdRes.status === 'fulfilled' ? usdRes.value?.data?.promedio : null;
            const eurPromedio = eurRes.status === 'fulfilled' ? eurRes.value?.data?.promedio : null;
            if (promedio && !isNaN(promedio) && promedio > 0) {
                const euroRate = (eurPromedio && !isNaN(eurPromedio) && Number(eurPromedio) > 0) ? Number(eurPromedio) : null;
                console.log(`✅ Tasa BCV actual obtenida vía DolarAPI: ${promedio} Bs/$${euroRate ? ` | ${euroRate} Bs/€` : ''}`);
                return { success: true, rate: Number(promedio), euroRate, source: 'dolarapi' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en DolarAPI: ${err.message}`);
        }

        // Intento 3: API PyDolarVenezuela
        try {
            const [usdRes, eurRes] = await Promise.allSettled([
                axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar?page=bcv', { timeout: 5000 }),
                axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/euro?page=bcv', { timeout: 5000 })
            ]);
            const price = usdRes.status === 'fulfilled' ? usdRes.value?.data?.monitors?.bcv?.price : null;
            const eurPrice = eurRes.status === 'fulfilled' ? eurRes.value?.data?.monitors?.bcv?.price : null;
            if (price && !isNaN(price) && price > 0) {
                const euroRate = (eurPrice && !isNaN(eurPrice) && Number(eurPrice) > 0) ? Number(eurPrice) : null;
                console.log(`✅ Tasa BCV obtenida vía PyDolarVenezuela API: ${price} Bs/$${euroRate ? ` | ${euroRate} Bs/€` : ''}`);
                return { success: true, rate: Number(price), euroRate, source: 'pydolarvenezuela' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en PyDolarVenezuela API: ${err.message}`);
        }

        throw new Error('No se pudo obtener la tasa BCV actual de ninguna fuente oficial ni de respaldo.');
    }

    /**
     * Respaldo externo exclusivamente para Euro oficial BCV
     */
    static async fetchEuroRateFromApis() {
        try {
            const res = await axios.get('https://ve.dolarapi.com/v1/euros/oficial', { timeout: 5000 });
            const promedio = res.data?.promedio;
            if (promedio && !isNaN(promedio) && Number(promedio) > 0) {
                return { success: true, euroRate: Number(promedio), source: 'dolarapi' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en DolarAPI Euro: ${err.message}`);
        }

        try {
            const res = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/euro?page=bcv', { timeout: 5000 });
            const price = res.data?.monitors?.bcv?.price;
            if (price && !isNaN(price) && Number(price) > 0) {
                return { success: true, euroRate: Number(price), source: 'pydolarvenezuela' };
            }
        } catch (err) {
            console.warn(`⚠️ Fallo en PyDolarVenezuela Euro: ${err.message}`);
        }

        return null;
    }

    /**
     * Consulta dedicada de la tasa oficial del Euro (EUR/Bs) del BCV
     */
    static async getCurrentEuroRate() {
        try {
            const direct = await this.scrapeDirectBCVRates();
            if (direct && direct.euroRate > 0) {
                console.log(`✅ Tasa Euro BCV obtenida directamente de bcv.org.ve: ${direct.euroRate} Bs/€`);
                return { success: true, euroRate: direct.euroRate, rate: direct.euroRate, source: 'bcv.org.ve' };
            }
        } catch (err) {
            console.warn(`⚠️ No se pudo leer Euro directo de bcv.org.ve (${err.message}). Probando APIs de respaldo...`);
        }

        const apiResult = await this.fetchEuroRateFromApis();
        if (apiResult && apiResult.euroRate > 0) {
            return { ...apiResult, rate: apiResult.euroRate };
        }

        throw new Error('No se pudo obtener la tasa oficial Euro BCV de ninguna fuente.');
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
     * Petición HTTP nativa a https://www.bcv.org.ve extrayendo #dolar y #euro en una sola petición
     */
    static scrapeDirectBCVRates() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'www.bcv.org.ve',
                port: 443,
                path: '/',
                method: 'GET',
                rejectUnauthorized: true,
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
                    const usdRate = this.parseBcvHtmlRate(data, 'dolar');
                    const eurRate = this.parseBcvHtmlRate(data, 'euro');
                    if (usdRate || eurRate) {
                        return resolve({ rate: usdRate, euroRate: eurRate });
                    }
                    reject(new Error('Estructura HTML de bcv.org.ve cambió o no contiene id="dolar" ni id="euro"'));
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

    /**
     * Compatibilidad retroactiva: retorna directamente el valor numérico de la tasa USD BCV
     */
    static async scrapeDirectBCV() {
        const rates = await this.scrapeDirectBCVRates();
        if (rates && rates.rate > 0) return rates.rate;
        throw new Error('Estructura HTML de bcv.org.ve cambió o no contiene id="dolar"');
    }
}

module.exports = BCVRateService;
