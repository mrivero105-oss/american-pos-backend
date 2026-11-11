import QRCode from 'qrcode';

// Catálogo oficial de bancos de Venezuela (Códigos SUDEBAN)
export const VENEZUELAN_BANKS = [
    { code: '0102', name: 'Banco de Venezuela (BDV)', shortName: 'BDV' },
    { code: '0134', name: 'Banesco Banco Universal', shortName: 'Banesco' },
    { code: '0105', name: 'Banco Mercantil', shortName: 'Mercantil' },
    { code: '0108', name: 'BBVA Banco Provincial', shortName: 'Provincial' },
    { code: '0172', name: 'Bancamiga Banco Universal', shortName: 'Bancamiga' },
    { code: '0191', name: 'Banco Nacional de Crédito (BNC)', shortName: 'BNC' },
    { code: '0114', name: 'Bancaribe', shortName: 'Bancaribe' },
    { code: '0115', name: 'Banco Exterior', shortName: 'Exterior' },
    { code: '0174', name: 'Banplus Banco Universal', shortName: 'Banplus' },
    { code: '0138', name: 'Banco Plaza', shortName: 'Plaza' },
    { code: '0163', name: 'Banco del Tesoro', shortName: 'Tesoro' },
    { code: '0166', name: 'Banco Agrícola de Venezuela', shortName: 'Agrícola' },
    { code: '0151', name: 'BFC Banco Fondo Común', shortName: 'BFC' },
    { code: '0156', name: '100% Banco', shortName: '100% Banco' },
    { code: '0175', name: 'Banco Bicentenario', shortName: 'Bicentenario' },
    { code: '0104', name: 'Banco Venezolano de Crédito', shortName: 'BVC' },
    { code: '0128', name: 'Banco Caroní', shortName: 'Caroní' },
    { code: '0137', name: 'Banco Sofitasa', shortName: 'Sofitasa' },
    { code: '0168', name: 'Bancrecer', shortName: 'Bancrecer' },
    { code: '0171', name: 'Banco Activo', shortName: 'Activo' },
    { code: '0177', name: 'Banfanb', shortName: 'Banfanb' },
    { code: '0157', name: 'DelSur Banco Universal', shortName: 'DelSur' },
    { code: '0169', name: 'Mi Banco', shortName: 'Mi Banco' }
];

export function cleanPhone(phone) {
    if (!phone) return '';
    // Si viene más de un teléfono separado por /, , o ;, tomar el primero
    const firstPart = String(phone).split(/[/,;]/)[0].trim();
    // Extraer solo dígitos
    let digits = firstPart.replace(/\D/g, '');
    
    // Si empieza por 58 (código país) y tiene 12 dígitos, reemplazar 58 por 0
    if (digits.startsWith('58') && digits.length === 12) {
        digits = '0' + digits.slice(2);
    } else if (digits.length === 10 && (digits.startsWith('414') || digits.startsWith('424') || digits.startsWith('412') || digits.startsWith('416') || digits.startsWith('426'))) {
        // Le falta el cero inicial
        digits = '0' + digits;
    }
    return digits;
}

export function cleanIdNumber(id) {
    if (!id) return '';
    let cleaned = String(id).toUpperCase().replace(/[^VJEG0-9]/g, '');
    if (!cleaned) return '';
    // Si empieza directamente con dígitos, asumir V (persona natural venezolana)
    if (/^[0-9]/.test(cleaned)) {
        cleaned = 'V' + cleaned;
    }
    return cleaned;
}

export function formatPhoneDisplay(phone) {
    const cleaned = cleanPhone(phone);
    if (!cleaned) return phone || '';
    if (cleaned.length === 11) {
        return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    }
    return cleaned;
}

export function formatIdDisplay(id) {
    const cleaned = cleanIdNumber(id);
    if (!cleaned) return id || '';
    const prefix = cleaned[0];
    const number = cleaned.slice(1);
    if (number.length > 3) {
        return `${prefix}-${number.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
    }
    return `${prefix}-${number}`;
}

export function getBankNameByCode(code) {
    if (!code) return '';
    const cleanCode = String(code).trim().slice(0, 4);
    const found = VENEZUELAN_BANKS.find(b => b.code === cleanCode || b.name.includes(cleanCode));
    return found ? found.name : code;
}

/**
 * Genera el payload de texto estandarizado para Pago Móvil (Estándar Suiche 7B)
 * Compatible con apps bancarias y lectores de cámara estándar.
 */
export function buildPagoMovilString({ bankCode = '', phone = '', idNumber = '', amountBs = 0, includeAmount = true }) {
    const bCode = String(bankCode || '').slice(0, 4);
    const tel = cleanPhone(phone);
    const doc = cleanIdNumber(idNumber);
    const monto = (includeAmount && Number(amountBs || 0) > 0) ? Number(amountBs).toFixed(2) : '';

    if (!bCode || !tel || !doc) return '';

    if (monto) {
        return `PAGOMOVIL;BANCO=${bCode};TEL=${tel};RIF=${doc};MONTO=${monto};`;
    }
    return `PAGOMOVIL;BANCO=${bCode};TEL=${tel};RIF=${doc};`;
}

/**
 * Genera el DataURL en formato PNG del Código QR
 */
export async function generatePagoMovilQR({ bankCode = '', phone = '', idNumber = '', amountBs = 0, customImage = '', mode = 'AUTO', includeAmount = true }) {
    if (mode === 'IMAGE' && customImage) {
        return customImage;
    }

    const payload = buildPagoMovilString({ bankCode, phone, idNumber, amountBs, includeAmount });
    if (!payload || payload.length < 15) {
        return null;
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
        console.error('[PagoMovilQR] Error generando QR:', err);
        return null;
    }
}
