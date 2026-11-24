const precision = require('../../utils/precision');

// Helper to canonicalize payment method IDs across the system
function canonicalizePaymentMethodId(methodId) {
    if (!methodId) return 'cash';
    const key = String(methodId)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_');
    if (['efectivo_bs', 'cash_bs', 'cash_ves', 'ves', 'bs'].includes(key)) return 'cash_bs';
    if (['efectivo_usd', 'cash_usd', 'cash', 'efectivo'].includes(key)) return 'cash';
    if (['card', 'tarjeta', 'punto', 'punto_de_venta', 'debito', 'debit'].includes(key)) return 'debit';
    if (['pagomovil', 'mobile', 'pago_movil'].includes(key)) return 'pago_movil';
    if (['binance', 'binance_pay', 'binance_usdt', 'usdt'].includes(key)) return 'binance_usdt';
    if (['transferencia', 'transfer_bs', 'transfer'].includes(key)) return 'transfer';
    if (['credito', 'credit', 'fiado'].includes(key)) return 'fiado';
    if (['biopago'].includes(key)) return 'biopago';
    return key;
}

// Helper to robustly detect if a payment method operates in VES (Bolívares)
function isVesPaymentMethod(methodId, pMethods = []) {
    if (!methodId) return false;
    const key = String(methodId)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_');
    
    if (Array.isArray(pMethods) && pMethods.length > 0) {
        // Direct match
        let method = pMethods.find(pm => pm && String(pm.id).toLowerCase().trim() === key);
        
        // Alias match against configured payment methods
        if (!method) {
            if (['card', 'tarjeta', 'punto', 'debito', 'debit'].includes(key)) {
                method = pMethods.find(pm => pm && ['debit', 'debito', 'card', 'punto', 'tarjeta'].includes(String(pm.id).toLowerCase().trim()));
            } else if (['pagomovil', 'mobile', 'pago_movil'].includes(key)) {
                method = pMethods.find(pm => pm && ['pago_movil', 'pagomovil', 'mobile'].includes(String(pm.id).toLowerCase().trim()));
            } else if (['cash_ves', 'efectivo_bs', 'cash_bs'].includes(key)) {
                method = pMethods.find(pm => pm && ['cash_bs', 'cash_ves', 'efectivo_bs'].includes(String(pm.id).toLowerCase().trim()));
            }
        }

        if (method) {
            if (method.currency === 'USD' || method.currency === 'COP' || method.currency === '$') return false;
            if (method.currency === 'VES' || method.currency === 'BS' || method.defaultCurrency === 'VES' || method.defaultCurrency === 'BS') {
                return true;
            }
        }
    }

    const strictlyVesKeys = ['pago_movil', 'pagomovil', 'cash_bs', 'efectivo_bs', 'transfer_bs', 'biopago', 'ves', 'bs'];
    if (strictlyVesKeys.includes(key) || key.includes('_bs') || key.endsWith('bs') || key.includes('ves') || key.includes('movil')) {
        return true;
    }
    
    return false;
}

// Helper to safely and robustly apply cash movements to expectedBreakdown by currency and payment method
function applyMovementToBreakdown(m, expectedBreakdown, pMethods = []) {
    if (!m || (m.id && m.id.startsWith('OPEN-'))) return;
    // Evitar doble deducción de devoluciones: RefundService registra tanto un Refund como un CashMovement(category='REFUND'),
    // y getShiftStats ya descuenta todos los Refunds directamente de paymentBreakdownNative.
    const movCat = String(m.category || '').trim().toUpperCase();
    const movReason = String(m.reason || '').trim();
    if (movCat === 'REFUND' || /^Devoluci[oó]n Venta #/i.test(movReason)) return;

    const mCurrency = (m.currency || 'USD').toUpperCase();
    const isVes = (mCurrency === 'VES' || mCurrency === 'BS');
    let methodId = m.paymentMethodId;

    if (isVes) {
        if (!methodId || methodId === 'cash' || !isVesPaymentMethod(methodId, pMethods)) {
            methodId = expectedBreakdown['cash_bs'] !== undefined ? 'cash_bs' : (expectedBreakdown['efectivo_bs'] !== undefined ? 'efectivo_bs' : 'cash_bs');
        }
    } else {
        if (!methodId || isVesPaymentMethod(methodId, pMethods)) {
            methodId = 'cash';
        }
    }

    const amt = Number(m.amount) || 0;
    const normalizedType = String(m.type || '').toLowerCase();
    const isAdditive = (normalizedType === 'in' || normalizedType === 'income');
    
    if (expectedBreakdown[methodId] === undefined) {
        expectedBreakdown[methodId] = 0;
    }

    expectedBreakdown[methodId] = precision.round(
        isAdditive 
            ? precision.add([expectedBreakdown[methodId], amt]) 
            : precision.subtract(expectedBreakdown[methodId], amt)
    );
}

module.exports = {
    canonicalizePaymentMethodId,
    isVesPaymentMethod,
    applyMovementToBreakdown
};
