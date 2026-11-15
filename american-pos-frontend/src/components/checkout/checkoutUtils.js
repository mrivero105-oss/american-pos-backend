export const cleanMethodName = (name) => {
    if (!name || typeof name !== 'string') return '';
    return name
        .replace(/CrÃ©dito/gi, 'Crédito')
        .replace(/DÃ©bito/gi, 'Débito')
        .replace(/MÃ³vil/gi, 'Móvil')
        .replace(/Ã©/g, 'é')
        .replace(/Ã¡/g, 'á')
        .replace(/Ã­/g, 'í')
        .replace(/Ã³/g, 'ó')
        .replace(/Ãº/g, 'ú')
        .replace(/Ã±/g, 'ñ')
        .replace(/Ã‰/g, 'É')
        .replace(/Ã“/g, 'Ó')
        .replace(/Ã/g, 'Á')
        .trim();
};

export const DEFAULT_PAYMENT_METHODS = [
    { id: 'cash_usd', name: 'Efectivo USD', currency: 'USD', isCash: true, active: true },
    { id: 'cash_bs', name: 'Efectivo Bs', currency: 'VES', isCash: true, active: true },
    { id: 'debit', name: 'Punto de Venta', currency: 'VES', isCash: false, active: true },
    { id: 'pago_movil', name: 'Pago Móvil', currency: 'VES', isCash: false, active: true },
    { id: 'binance_usdt', name: 'Binance Pay (USDT)', currency: 'USDT', isCash: false, active: true },
    { id: 'zelle', name: 'Zelle', currency: 'USD', isCash: false, active: true },
    { id: 'biopago', name: 'Biopago BDV', currency: 'VES', isCash: false, active: true },
    { id: 'transfer', name: 'Transferencia Bancaria', currency: 'VES', isCash: false, active: true },
    { id: 'fiado', name: 'Crédito / Fiado', currency: 'USD', type: 'CREDIT', active: true }
];
