import QRCode from 'qrcode';

/**
 * Genera la cadena de datos o deeplink para Binance Pay
 */
export function buildBinancePayString({ payId = '', email = '', amountUsdt = 0 }) {
    const cleanId = String(payId || '').trim();
    const cleanEmail = String(email || '').trim();
    const amt = Number(amountUsdt) || 0;

    if (cleanId) {
        if (amt > 0) {
            return `binance://pay?payId=${cleanId}&amount=${amt.toFixed(2)}&currency=USDT`;
        }
        return `binance://pay?payId=${cleanId}`;
    }

    if (cleanEmail) {
        if (amt > 0) {
            return `binance://pay?email=${cleanEmail}&amount=${amt.toFixed(2)}&currency=USDT`;
        }
        return `binance://pay?email=${cleanEmail}`;
    }

    return '';
}

/**
 * Genera el DataURL en formato PNG del Código QR de Binance Pay
 */
export async function generateBinanceQR({ payId = '', email = '', amountUsdt = 0, customImage = '', mode = 'AUTO' }) {
    if (mode === 'IMAGE' && customImage) {
        return customImage;
    }

    if (customImage && !payId && !email) {
        return customImage;
    }

    const payload = buildBinancePayString({ payId, email, amountUsdt }) || String(payId || email || '');
    if (!payload) {
        return customImage || null;
    }

    try {
        const qrDataUrl = await QRCode.toDataURL(payload, {
            width: 360,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        });
        return qrDataUrl;
    } catch (err) {
        console.error('[BinanceQR] Error generando QR:', err);
        return customImage || null;
    }
}
