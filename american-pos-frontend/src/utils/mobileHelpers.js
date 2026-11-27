import { isDollarOnlyCountry } from './format';

/**
 * Utilidades consolidadas para módulos móviles (POS, Ventas, Gastos, Inventario y Clientes).
 * Evita duplicar normalizaciones de IDs, métodos de pago y moneda país a lo largo de múltiples vistas.
 */

/**
 * Remueve sufijos compuestos de presentaciones/variantes (`::var_...`, `::bulk`, `__bulk`, etc.)
 * para obtener el ID real del producto en base de datos.
 */
export function stripProductSuffix(rawId) {
  if (rawId === null || rawId === undefined) return '';
  return String(rawId)
    .split('::')[0]
    .replace(/(__bulk|__half_bulk|-bulk|-half-bulk|-unit)$/i, '')
    .trim();
}

/**
 * Normaliza nombres de métodos de pago provenientes de offline/LAN/servidor
 * a identificadores canónicos consistentes entre móvil y PC.
 */
export function canonicalizePaymentMethod(rawMethod) {
  const s = String(rawMethod || '').trim().toLowerCase();
  if (!s) return 'cash_usd';
  if (s.includes('mixto') || s.includes('mixed') || s.includes('split')) return 'mixed';
  if (s.includes('fiado') || s.includes('credit') || s.includes('crédito')) return 'credit';
  if (s.includes('pago') && (s.includes('movil') || s.includes('móvil'))) return 'pago_movil';
  if (s.includes('binance') || s.includes('usdt') || s.includes('cripto')) return 'binance';
  if (s.includes('zelle')) return 'zelle';
  if (s.includes('eur') || s.includes('euro')) return 'cash_eur';
  if (s.includes('punto') || s.includes('tarj') || s.includes('card') || s.includes('debit') || s.includes('débit')) return 'tarjeta';
  if (s.includes('transfer')) return 'transferencia';
  if (s.includes('bs') || s.includes('ves') || s.includes('boliv') || s.includes('bolív')) return 'cash_bs';
  if (s.includes('usd') || s.includes('dolar') || s.includes('dólar') || s.includes('divisa') || s.includes('efectivo') || s.includes('cash')) return 'cash_usd';
  return s;
}

/**
 * Determina si el país configurado opera en moneda única USD (oculta tasa y montos en Bs.).
 */
export function isDollarCountry(countryOverride = null) {
  const country = countryOverride ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_country') : null);
  return isDollarOnlyCountry(country);
}
