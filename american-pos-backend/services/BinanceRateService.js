const axios = require('axios');

class BinanceRateService {
    static cache = null;
    static cacheTime = 0;
    static CACHE_TTL_MS = 60000; // 1 minuto de caché para evitar sobrecargar APIs

    /**
     * Obtiene la tasa de referencia USDT/VES del mercado Binance P2P.
     * Consulta primero CriptoYa (Binance P2P directo) y tiene respaldo con DolarAPI.
     */
    static async getRate() {
        const now = Date.now();
        if (this.cache && (now - this.cacheTime) < this.CACHE_TTL_MS) {
            return { ...this.cache, cached: true };
        }

        // Intento 1: CriptoYa - Binance P2P (USDT/VES)
        try {
            const res = await axios.get('https://criptoya.com/api/binancep2p/usdt/ves/10', { timeout: 6000 });
            const { ask, bid } = res.data || {};
            // Promedio entre compra y venta del libro P2P
            const rate = (ask && bid) ? ((Number(ask) + Number(bid)) / 2) : (Number(ask) || Number(bid));
            if (rate && !isNaN(rate) && rate > 0) {
                const roundedRate = Math.round(rate * 100) / 100;
                this.cache = {
                    success: true,
                    rate: roundedRate,
                    ask: Number(ask) || roundedRate,
                    bid: Number(bid) || roundedRate,
                    source: 'binance_p2p_criptoya',
                    timestamp: new Date().toISOString()
                };
                this.cacheTime = now;
                console.log(`[BINANCE-RATE] Tasa P2P obtenida vía CriptoYa: ${roundedRate} Bs/USDT`);
                return { ...this.cache, cached: false };
            }
        } catch (err) {
            console.warn(`[BINANCE-RATE] Aviso: Falló consulta a CriptoYa (${err.message}). Probando DolarAPI...`);
        }

        // Intento 2: DolarAPI Venezuela (Tasa Paralelo de Respaldo)
        try {
            const res = await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo', { timeout: 5000 });
            const promedio = res.data?.promedio;
            if (promedio && !isNaN(promedio) && promedio > 0) {
                const roundedRate = Math.round(Number(promedio) * 100) / 100;
                this.cache = {
                    success: true,
                    rate: roundedRate,
                    ask: roundedRate,
                    bid: roundedRate,
                    source: 'dolarapi_paralelo_fallback',
                    timestamp: new Date().toISOString()
                };
                this.cacheTime = now;
                console.log(`[BINANCE-RATE] Tasa obtenida vía DolarAPI Fallback: ${roundedRate} Bs/USDT`);
                return { ...this.cache, cached: false };
            }
        } catch (err) {
            console.warn(`[BINANCE-RATE] Falló DolarAPI de respaldo: ${err.message}`);
        }

        // Si ya había una tasa previa en caché aunque sea antigua, retornarla
        if (this.cache) {
            console.warn('[BINANCE-RATE] Usando última tasa almacenada en caché por falla de red externa.');
            return { ...this.cache, cached: true, warning: 'Servicio en modo offline, usando último valor conocido' };
        }

        throw new Error('No se pudo conectar a los proveedores de tasa Binance P2P. Verifique su conexión a internet.');
    }
}

module.exports = BinanceRateService;
