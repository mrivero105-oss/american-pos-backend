import { formatUSD, formatBs, isSingleCurrencyMode, isUsdOnlyMode, getGlobalSettings } from './format';
import { escapeHtml } from './escapeHtml';
import api from '../services/api';

const ESC = '\x1B';
const FS = '\x1C';
const GS = '\x1D';
const CMD = {
    INIT: ESC + '@' + FS + '.' + ESC + 't\x00',
    ALIGN_LEFT: ESC + 'a' + '\x00',
    ALIGN_CENTER: ESC + 'a' + '\x01',
    ALIGN_RIGHT: ESC + 'a' + '\x02',
    BOLD_ON: ESC + 'E' + '\x01',
    BOLD_OFF: ESC + 'E' + '\x00',
    DOUBLE_ON: GS + '!' + '\x11',
    NORMAL: GS + '!' + '\x00',
    CUT: GS + 'V' + '\x41' + '\x03',
    LF: '\n'
};

const cleanEscText = (str = '') => {
    return String(str || '')
        .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
        .replace(/¡/g, '')
        .replace(/¿/g, '')
        .replace(/[º°]/g, '.')
        .replace(/ª/g, 'a')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–]/g, '-')
        .replace(/•/g, '*')
        .replace(/€/g, 'E')
        .replace(/ñ/g, 'n')
        .replace(/Ñ/g, 'N')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, '');
};

const padLine = (left = '', right = '', cols = 48) => {
    const l = cleanEscText(left);
    const r = cleanEscText(right);
    const spaces = Math.max(1, cols - l.length - r.length);
    return l + ' '.repeat(spaces) + r + CMD.LF;
};

const divider = (cols = 48, char = '-') => char.repeat(cols) + CMD.LF;

const resolveEffectiveSettings = (settings = null, businessSettings = null) => {
    let storedBiz = {};
    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_business_settings');
            if (raw) storedBiz = JSON.parse(raw) || {};
        } catch (err) {
            console.warn('[Print] Error leyendo pos_business_settings:', err?.message);
        }
    }
    const globalCfg = getGlobalSettings() || {};
    const merged = {
        ...storedBiz,
        ...globalCfg,
        ...(businessSettings || {}),
        ...(settings || {})
    };
    const stationPrinter = typeof window !== 'undefined' ? (localStorage.getItem('pos_station_printer') || '') : '';
    merged.printerName = stationPrinter || merged.printerName || '';
    merged.printMode = merged.printMode || 'RAW';
    return merged;
};

const resolveWidthCols = (widthMm, effSettings) => {
    const wStr = String(widthMm || effSettings?.receiptWidth || '80');
    const is58 = wStr.includes('58') || Number(widthMm) === 58;
    return {
        is58,
        widthMm: is58 ? 58 : 80,
        cols: is58 ? 32 : 48
    };
};

/**
 * Ejecuta la impresión silenciosa en segundo plano (100% no bloqueante en Electron).
 * Prioriza modo RAW (ESC/POS directo vía RawPrinter.exe) y cae en printSilent de Electron
 * sin abrir jamás diálogos nativos de Windows (window.print).
 */
const executeReceiptPrint = async (htmlContent, printerName = '', options = {}) => {
    const { rawContent = null, settings = null, businessSettings = null, kickDrawer = false, autoPrint = false } = options;
    const effSettings = resolveEffectiveSettings(settings, businessSettings);
    const targetPrinter = printerName || effSettings.printerName || '';
    const preferRaw = (effSettings.printMode || 'RAW') !== 'HTML' && Boolean(rawContent);

    // 1. Entorno Desktop Electron (100% silencioso en segundo plano)
    if (typeof window !== 'undefined' && window.electronAPI) {
        try {
            let printed = false;
            let activePrinterUsed = targetPrinter;

            if (preferRaw && window.electronAPI.printRaw) {
                const rawRes = await window.electronAPI.printRaw(rawContent, targetPrinter);
                if (rawRes && rawRes.success) {
                    printed = true;
                    if (rawRes.printerName) activePrinterUsed = rawRes.printerName;
                } else {
                    console.warn('[PrintCashReceipts] printRaw notice, attempting printSilent:', rawRes?.error);
                }
            }

            if (!printed && window.electronAPI.printSilent) {
                const silentRes = await window.electronAPI.printSilent(htmlContent, targetPrinter);
                if (silentRes && silentRes.success) {
                    printed = true;
                    if (silentRes.printerName) activePrinterUsed = silentRes.printerName;
                } else if (!preferRaw && rawContent && window.electronAPI.printRaw) {
                    // Fallback inverso: si falló HTML, probar RAW ESC/POS
                    const rawFallback = await window.electronAPI.printRaw(rawContent, targetPrinter);
                    if (rawFallback && rawFallback.success) {
                        printed = true;
                        if (rawFallback.printerName) activePrinterUsed = rawFallback.printerName;
                    }
                }
            }

            if (kickDrawer && window.electronAPI.openDrawer) {
                await window.electronAPI.openDrawer(activePrinterUsed, effSettings.drawerSequence).catch((e) => {
                    console.warn('[PrintCashReceipts] openDrawer notice:', e?.message);
                });
            }

            return { success: printed, printerName: activePrinterUsed };
        } catch (err) {
            console.warn('[PrintCashReceipts] Error en impresión silenciosa Electron:', err?.message);
            return { success: false, error: err?.message };
        }
    }

    // 2. Entorno Navegador Web Local / Isaac POS Desktop conectado al Backend PC
    if (rawContent) {
        try {
            const { data } = await api.post('/settings/print-raw', {
                content: rawContent,
                printerName: targetPrinter,
                printMode: effSettings.printMode,
                autoPrint: Boolean(autoPrint)
            });
            if (kickDrawer && data?.success) {
                await api.post('/settings/open-drawer', {
                    printerName: data?.printerName || targetPrinter,
                    sequence: effSettings.drawerSequence,
                    autoPrint: Boolean(autoPrint)
                }).catch(() => {});
            }
            if (data && data.success) {
                return { success: true, printerName: data.printerName || targetPrinter };
            }
            if (data && data.skipped) {
                return { success: false, skipped: true };
            }
        } catch (err) {
            console.warn('[PrintCashReceipts] Backend print-raw notice:', err?.message);
        }
    }

    // 3. Fallback solo para dispositivos móviles cuando no hay backend PC local
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile && typeof window !== 'undefined' && !window.electronAPI) {
        createPrintIframe(htmlContent);
        return { success: true, mode: 'IFRAME' };
    }

    return { success: false };
};

const createPrintIframe = (htmlContent) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-modals allow-same-origin');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error('Error printing receipt:', e);
        } finally {
            setTimeout(() => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
            }, 2000);
        }
    }, 300);
};

const getBaseStyles = (widthMm = 80) => {
    const is58 = Number(widthMm) === 58 || String(widthMm).includes('58');
    const paperWidth = is58 ? '58mm' : '80mm';
    const contentWidth = is58 ? '48mm' : '72mm';
    const baseFontSize = is58 ? '10px' : '12px';
    const titleFontSize = is58 ? '12px' : '14px';

    return `
        @page { margin: 0; size: ${paperWidth} auto; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Courier New', Courier, monospace;
            width: ${contentWidth};
            margin: 0 auto;
            padding: 6px 2px;
            font-size: ${baseFontSize};
            color: #000;
            background: #fff;
            line-height: 1.25;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .title { font-size: ${titleFontSize}; font-weight: bold; text-transform: uppercase; margin: 4px 0; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        .double-divider { border-top: 2px solid #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; gap: 4px; }
        .row span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row span:last-child { white-space: nowrap; font-weight: bold; }
        .box { border: 1px solid #000; padding: 4px; margin: 5px 0; }
        .sig-line { margin-top: 26px; border-top: 1px solid #000; text-align: center; padding-top: 3px; font-size: 10px; }
        .small { font-size: ${is58 ? '9px' : '10px'}; }
    `;
};

const METHOD_LABELS = {
    cash: 'Efectivo $',
    cash_usd: 'Efectivo $',
    efectivo_usd: 'Efectivo $',
    cash_bs: 'Efectivo Bs',
    cash_ves: 'Efectivo Bs',
    efectivo_bs: 'Efectivo Bs',
    debit: 'Punto de Venta',
    punto_de_venta: 'Punto de Venta',
    card: 'Tarjeta / Punto',
    pago_movil: 'Pago Movil',
    transfer: 'Transferencia',
    transfer_bs: 'Transferencia Bs',
    biopago: 'Biopago',
    zelle: 'Zelle',
    fiado: 'Credito / Fiado',
    credit: 'Credito / Fiado'
};

const safeParseObj = (val) => {
    if (!val) return {};
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            return typeof parsed === 'string' ? JSON.parse(parsed) : (parsed || {});
        } catch (_) {
            return {};
        }
    }
    return typeof val === 'object' ? val : {};
};

const canonicalizeMethodKey = (id) => {
    if (!id) return 'cash';
    const key = String(id).toLowerCase().trim();
    if (['efectivo_bs', 'cash_bs', 'cash_ves', 'ves', 'bs'].includes(key)) return 'cash_bs';
    if (['efectivo_usd', 'cash_usd', 'cash', 'efectivo', 'usd'].includes(key)) return 'cash';
    if (['card', 'tarjeta', 'punto', 'punto_de_venta', 'debito', 'debit', 'tarjeta_debito'].includes(key)) return 'debit';
    if (['pagomovil', 'mobile', 'pago_movil', 'mobile_payment'].includes(key)) return 'pago_movil';
    if (['transferencia', 'transfer_bs', 'transfer'].includes(key)) return 'transfer';
    if (['credito', 'credit', 'fiado'].includes(key)) return 'fiado';
    return key;
};

const normalizeBreakdownMap = (rawMap = {}) => {
    const src = safeParseObj(rawMap);
    const out = {};
    Object.entries(src).forEach(([k, v]) => {
        if (k === 'total') return;
        const canon = canonicalizeMethodKey(k);
        const num = Number(v);
        if (!isNaN(num)) {
            out[canon] = Math.round(((out[canon] || 0) + num) * 100) / 100;
        }
    });
    return out;
};

const getMethodLabel = (key, singleMode = false) => {
    const k = canonicalizeMethodKey(key);
    if (singleMode && k === 'cash') return 'Efectivo';
    return METHOD_LABELS[k] || METHOD_LABELS[String(key || '').toLowerCase().trim()] || String(key || '').replace(/_/g, ' ').toUpperCase();
};

const isVesMethodKey = (key = '') => {
    const k = String(key || '').toLowerCase().trim();
    const canon = canonicalizeMethodKey(k);
    return ['cash_bs', 'pago_movil', 'debit', 'transfer', 'transfer_bs', 'biopago'].includes(canon) || k.includes('_bs') || k.includes('_ves') || k.includes('movil') || k.includes('punto') || k.includes('debito');
};

/**
 * 1. Comprobante de Apertura de Turno
 */
export const printOpeningReceipt = async ({ shift, user, settings, businessSettings, widthMm = 80, kickDrawer = false, autoPrint = false }) => {
    if (!shift) return { success: false };
    const effSettings = resolveEffectiveSettings(settings, businessSettings);
    const { widthMm: effWidth, cols } = resolveWidthCols(widthMm, effSettings);
    const single = isSingleCurrencyMode(effSettings) || isUsdOnlyMode(effSettings);
    const bizName = effSettings?.name || effSettings?.businessName || 'MI NEGOCIO POS';
    const cashier = shift.userName || shift.cashierName || user?.name || user?.username || 'Cajero';
    const regName = shift.registerName || `Caja ${shift.registerId || '1'}`;
    const shiftShortId = String(shift.id || 'N/A').slice(0, 8).toUpperCase();
    const dateStr = new Date(shift.openedAt || shift.openingTime || Date.now()).toLocaleString('es-VE');
    const rate = Number(shift.openingRate || shift.exchangeRate || effSettings?.rate || effSettings?.exchangeRate || 1) || 1;

    const initBd = normalizeBreakdownMap(shift.initialBreakdown);
    const hasInitKeys = Object.keys(initBd).length > 0;
    const openUsdVal = hasInitKeys
        ? Number(initBd.cash ?? 0)
        : Number(shift.openingAmount ?? shift.initialAmount ?? 0);
    const openVesVal = Number(initBd.cash_bs ?? shift.openingAmountVes ?? 0);
    const totalBaseUsdVal = Number(shift.initialAmount ?? shift.openingAmount ?? (openUsdVal + (rate > 0 ? openVesVal / rate : 0)));

    const openUsd = formatUSD(openUsdVal);
    const openVes = formatBs(openVesVal);
    const totalBaseUsd = formatUSD(totalBaseUsdVal);

    // Generar ESC/POS RAW
    let raw = CMD.INIT;
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + cleanEscText(bizName.toUpperCase()) + CMD.LF + CMD.BOLD_OFF;
    if (effSettings.rif) raw += cleanEscText(effSettings.rif) + CMD.LF;
    raw += CMD.BOLD_ON + 'COMPROBANTE DE APERTURA' + CMD.LF + CMD.BOLD_OFF;
    raw += divider(cols, '=');
    raw += CMD.ALIGN_LEFT;
    raw += padLine('Caja:', regName, cols);
    raw += padLine('Turno ID:', `#${shiftShortId}`, cols);
    raw += padLine('Cajero:', cashier, cols);
    raw += padLine('Fecha/Hora:', dateStr, cols);
    if (!single) {
        raw += padLine('Tasa BCV:', `Bs ${rate.toFixed(2)}`, cols);
    }
    raw += divider(cols, '-');
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + 'FONDO INICIAL EN GAVETA' + CMD.LF + CMD.BOLD_OFF;
    raw += CMD.ALIGN_LEFT;
    raw += padLine(single ? 'Efectivo Inicial:' : 'Efectivo USD ($):', openUsd, cols);
    if (!single) {
        raw += padLine('Efectivo VES (Bs):', openVes, cols);
        if (openVesVal > 0 || openUsdVal > 0) {
            raw += padLine('Base Total (Ref $):', totalBaseUsd, cols);
        }
    }

    raw += divider(cols, '=');
    raw += CMD.LF + CMD.LF;
    raw += CMD.ALIGN_CENTER + '__________________________' + CMD.LF;
    raw += cleanEscText(`Firma Cajero (${cashier})`) + CMD.LF + CMD.LF + CMD.LF;
    raw += CMD.CUT;

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>${getBaseStyles(effWidth)}</style></head>
        <body>
            <div class="center">
                <div class="bold">${escapeHtml(bizName)}</div>
                <div class="title">COMPROBANTE DE APERTURA</div>
                <div class="small">${escapeHtml(regName)}</div>
            </div>
            <div class="divider"></div>
            <div class="row"><span>Turno ID:</span><span>#${escapeHtml(shiftShortId)}</span></div>
            <div class="row"><span>Cajero:</span><span>${escapeHtml(cashier)}</span></div>
            <div class="row"><span>Fecha/Hora:</span><span>${escapeHtml(dateStr)}</span></div>
            ${!single ? `<div class="row"><span>Tasa BCV:</span><span>Bs ${rate.toFixed(2)}</span></div>` : ''}
            <div class="divider"></div>
            <div class="box">
                <div class="center bold small" style="margin-bottom:4px;">FONDO INICIAL EN GAVETA</div>
                <div class="row"><span>${single ? 'Efectivo Inicial:' : 'Efectivo USD ($):'}</span><span>${escapeHtml(openUsd)}</span></div>
                ${!single ? `<div class="row"><span>Efectivo VES (Bs):</span><span>${escapeHtml(openVes)}</span></div>` : ''}
                ${!single ? `<div class="row"><span>Base Total (Ref $):</span><span>${escapeHtml(totalBaseUsd)}</span></div>` : ''}
            </div>
            <div class="sig-line">Firma Cajero (${escapeHtml(cashier)})</div>
            <div class="center small" style="margin-top:8px;">--- Apertura Verificada ---</div>
        </body>
        </html>
    `;
    return await executeReceiptPrint(html, effSettings?.printerName, {
        rawContent: raw,
        settings: effSettings,
        kickDrawer,
        autoPrint
    });
};

/**
 * 2. Vale de Movimiento de Caja (Ingreso / Egreso / Sangría)
 */
export const printCashMovementReceipt = async ({ movement, shift, user, settings, businessSettings, widthMm = 80, kickDrawer = false, autoPrint = false }) => {
    if (!movement) return { success: false };
    const effSettings = resolveEffectiveSettings(settings, businessSettings);
    const { widthMm: effWidth, cols } = resolveWidthCols(widthMm, effSettings);
    const single = isSingleCurrencyMode(effSettings) || isUsdOnlyMode(effSettings);
    const bizName = effSettings?.name || effSettings?.businessName || 'MI NEGOCIO POS';
    const cashier = movement.userName || user?.name || user?.username || 'Cajero';
    const regName = shift?.registerName || `Caja ${shift?.registerId || '1'}`;
    const isIn = movement.type === 'in';
    const title = isIn ? 'VALE DE INGRESO A CAJA' : 'VALE DE EGRESO / SANGRIA';
    const dateStr = new Date(movement.timestamp || Date.now()).toLocaleString('es-VE');

    const catLabels = {
        SALES_CASH: 'Venta Efectivo',
        EXPENSE: 'Gasto Operativo',
        SUPPLIER_PAYMENT: 'Pago a Proveedor',
        SALARY_ADVANCE: 'Adelanto de Sueldo',
        CHANGE_SUPPLY: 'Suministro de Cambio',
        DRAWER_DROP: 'Retiro a Caja Fuerte (Sangria)',
        PETTY_CASH: 'Caja Chica',
        INCOME: 'Ingreso Extraordinario',
        OTHER: 'Otro Movimiento'
    };
    const catLabel = catLabels[movement.category] || movement.category || 'General';
    const isVes = !single && (movement.currency === 'VES' || movement.currency === 'BS');
    const amountFormatted = isVes ? formatBs(movement.amount) : formatUSD(movement.amount);

    // Generar ESC/POS RAW
    let raw = CMD.INIT;
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + cleanEscText(bizName.toUpperCase()) + CMD.LF + CMD.BOLD_OFF;
    raw += CMD.BOLD_ON + cleanEscText(title) + CMD.LF + CMD.BOLD_OFF;
    raw += divider(cols, '=');
    raw += CMD.ALIGN_LEFT;
    raw += padLine('Caja:', regName, cols);
    raw += padLine('Fecha:', dateStr, cols);
    raw += padLine('Operador:', cashier, cols);
    raw += padLine('Categoria:', catLabel, cols);
    raw += padLine('Moneda:', single ? 'USD' : (movement.currency || 'USD'), cols);
    raw += divider(cols, '-');
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + `MONTO ${isIn ? 'INGRESADO' : 'RETIRADO'}: ${cleanEscText(amountFormatted)}` + CMD.LF + CMD.BOLD_OFF;
    raw += divider(cols, '-');
    raw += CMD.ALIGN_LEFT + 'CONCEPTO / DETALLE:' + CMD.LF;
    raw += cleanEscText(movement.reason || 'Sin observacion') + CMD.LF;
    raw += CMD.LF + CMD.LF;
    raw += CMD.ALIGN_CENTER + '__________________________' + CMD.LF;
    raw += cleanEscText(`Entregado (${cashier})`) + CMD.LF + CMD.LF + CMD.LF;
    raw += CMD.CUT;

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>${getBaseStyles(effWidth)}</style></head>
        <body>
            <div class="center">
                <div class="bold">${escapeHtml(bizName)}</div>
                <div class="title">${escapeHtml(title)}</div>
                <div class="small">${escapeHtml(regName)}</div>
            </div>
            <div class="divider"></div>
            <div class="row"><span>Fecha:</span><span>${escapeHtml(dateStr)}</span></div>
            <div class="row"><span>Operador:</span><span>${escapeHtml(cashier)}</span></div>
            <div class="row"><span>Categoría:</span><span>${escapeHtml(catLabel)}</span></div>
            <div class="row"><span>Moneda:</span><span>${escapeHtml(single ? 'USD' : (movement.currency || 'USD'))}</span></div>
            <div class="divider"></div>
            <div class="box">
                <div class="row" style="font-size:13px;">
                    <span>MONTO ${isIn ? 'INGRESADO' : 'RETIRADO'}:</span>
                    <span>${escapeHtml(amountFormatted)}</span>
                </div>
            </div>
            <div style="margin: 6px 0;">
                <div class="bold small">CONCEPTO / DETALLE:</div>
                <div>${escapeHtml(movement.reason || 'Sin observación')}</div>
            </div>
            <div class="sig-line">Entregado por (${escapeHtml(cashier)})</div>
            <div class="sig-line">Recibido / Autorizado por</div>
        </body>
        </html>
    `;
    return await executeReceiptPrint(html, effSettings?.printerName, {
        rawContent: raw,
        settings: effSettings,
        kickDrawer,
        autoPrint
    });
};

/**
 * 3. Corte X (Arqueo Parcial Informativo)
 */
export const printXReportReceipt = async ({ shift, summary, stats, user, settings, businessSettings, widthMm = 80 }) => {
    if (!shift) return { success: false };
    const effSettings = resolveEffectiveSettings(settings, businessSettings);
    const { widthMm: effWidth, cols } = resolveWidthCols(widthMm, effSettings);
    const single = isSingleCurrencyMode(effSettings) || isUsdOnlyMode(effSettings);
    const bizName = effSettings?.name || effSettings?.businessName || 'MI NEGOCIO POS';
    const cashier = shift.userName || shift.cashierName || user?.name || user?.username || 'Cajero';
    const regName = shift.registerName || `Caja ${shift.registerId || '1'}`;
    const s = safeParseObj(summary || stats || shift.salesSummary || shift.summary || shift);
    const initBd = normalizeBreakdownMap(shift.initialBreakdown);
    const expectedBreakdown = normalizeBreakdownMap(shift.expectedBreakdown || s.expectedBreakdown || shift.paymentBreakdownNative || shift.paymentBreakdown);
    const rate = Number(shift.exchangeRate || effSettings?.rate || effSettings?.exchangeRate || 1) || 1;

    const dateStr = new Date().toLocaleString('es-VE');
    const openTimeStr = new Date(shift.openedAt || shift.openingTime || Date.now()).toLocaleString('es-VE');

    const hasInitKeys = Object.keys(initBd).length > 0;
    const openingUsd = hasInitKeys ? Number(initBd.cash ?? 0) : Number(shift.openingAmount ?? shift.initialAmount ?? 0);
    const openingVes = Number(initBd.cash_bs ?? shift.openingAmountVes ?? 0);
    const salesCount = Number(shift.salesCount ?? s.salesCount ?? 0);
    const salesTotalUsd = Number(shift.totalSalesAmount ?? s.totalSales ?? s.salesTotal ?? 0);
    const salesTotalVes = salesTotalUsd * rate;
    const manualInUsd = Number(shift.totalIn ?? s.totalIn ?? s.manualIn ?? 0);
    const manualOutUsd = Number(shift.totalOut ?? s.totalOut ?? s.manualOut ?? 0) + Number(shift.totalExpenses ?? s.totalExpenses ?? 0);
    const expectedCashUsd = Number(shift.expectedCashUsd ?? expectedBreakdown.cash ?? s.currentCash ?? 0);
    const expectedCashVes = Number(shift.expectedCashBs ?? expectedBreakdown.cash_bs ?? s.currentCashVes ?? 0);
    const totalSystemUsd = Number(shift.expectedAmount ?? shift.theoreticalTotalUsd ?? salesTotalUsd);

    // Generar ESC/POS RAW
    let raw = CMD.INIT;
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + cleanEscText(bizName.toUpperCase()) + CMD.LF + CMD.BOLD_OFF;
    raw += CMD.BOLD_ON + 'CORTE X (ARQUEO PARCIAL)' + CMD.LF + CMD.BOLD_OFF;
    raw += 'NO FISCAL - TURNO ABIERTO' + CMD.LF;
    raw += divider(cols, '=');
    raw += CMD.ALIGN_LEFT;
    raw += padLine('Caja:', regName, cols);
    raw += padLine('Cajero:', cashier, cols);
    raw += padLine('Apertura:', openTimeStr, cols);
    raw += padLine('Emision X:', dateStr, cols);
    if (!single) raw += padLine('Tasa BCV:', `Bs ${rate.toFixed(2)}`, cols);
    raw += padLine('Operaciones:', `${salesCount} op.`, cols);
    raw += divider(cols, '-');
    raw += CMD.BOLD_ON + 'RESUMEN DE CAJA Y VENTAS' + CMD.LF + CMD.BOLD_OFF;
    raw += padLine('Fondo Inicial $:', formatUSD(openingUsd), cols);
    if (!single) raw += padLine('Fondo Inicial Bs:', formatBs(openingVes), cols);
    raw += padLine('Ventas Totales ($):', formatUSD(salesTotalUsd), cols);
    if (!single) raw += padLine('Ventas Totales (Bs):', formatBs(salesTotalVes), cols);
    if (manualInUsd > 0) raw += padLine('Ingresos Manuales $:', `+${formatUSD(manualInUsd)}`, cols);
    if (manualOutUsd > 0) raw += padLine('Egresos / Gastos $:', `-${formatUSD(manualOutUsd)}`, cols);
    raw += padLine('Efec. en Gaveta $:', formatUSD(expectedCashUsd), cols);
    if (!single) raw += padLine('Efec. en Gaveta Bs:', formatBs(expectedCashVes), cols);

    const methodKeys = Object.keys(expectedBreakdown).filter(k => {
        if (single && isVesMethodKey(k)) return false;
        return Number(expectedBreakdown[k]) > 0;
    });
    if (methodKeys.length > 0) {
        raw += divider(cols, '-');
        raw += CMD.BOLD_ON + 'DESGLOSE POR METODO DE PAGO' + CMD.LF + CMD.BOLD_OFF;
        methodKeys.forEach(k => {
            const val = Number(expectedBreakdown[k] || 0);
            const isVes = !single && isVesMethodKey(k);
            raw += padLine(getMethodLabel(k, single) + ':', isVes ? formatBs(val) : formatUSD(val), cols);
        });
    }
    raw += divider(cols, '-');
    raw += padLine('TOTAL SISTEMA ($):', formatUSD(totalSystemUsd), cols);
    if (!single) raw += padLine('TOTAL SISTEMA (Bs):', formatBs(totalSystemUsd * rate), cols);
    raw += divider(cols, '=');
    raw += CMD.ALIGN_CENTER + '--- Fin de Corte X ---' + CMD.LF + CMD.LF + CMD.LF;
    raw += CMD.CUT;

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>${getBaseStyles(effWidth)}</style></head>
        <body>
            <div class="center">
                <div class="bold">${escapeHtml(bizName)}</div>
                <div class="title">CORTE X (ARQUEO PARCIAL)</div>
                <div class="small">NO FISCAL - TURNO CONTINÚA ABIERTO</div>
            </div>
            <div class="double-divider"></div>
            <div class="row"><span>Caja:</span><span>${escapeHtml(regName)}</span></div>
            <div class="row"><span>Cajero:</span><span>${escapeHtml(cashier)}</span></div>
            <div class="row"><span>Apertura:</span><span>${escapeHtml(openTimeStr)}</span></div>
            <div class="row"><span>Emisión X:</span><span>${escapeHtml(dateStr)}</span></div>
            ${!single ? `<div class="row"><span>Tasa BCV:</span><span>Bs ${rate.toFixed(2)}</span></div>` : ''}
            <div class="row"><span>Operaciones:</span><span>${salesCount} ventas</span></div>
            <div class="divider"></div>
            <div class="bold small">RESUMEN DE CAJA Y VENTAS</div>
            <div class="row"><span>Fondo Inicial $:</span><span>${formatUSD(openingUsd)}</span></div>
            ${!single ? `<div class="row"><span>Fondo Inicial Bs:</span><span>${formatBs(openingVes)}</span></div>` : ''}
            <div class="row"><span>Ventas Totales ($):</span><span>${formatUSD(salesTotalUsd)}</span></div>
            ${!single ? `<div class="row"><span>Ventas Totales (Bs):</span><span>${formatBs(salesTotalVes)}</span></div>` : ''}
            ${manualInUsd > 0 ? `<div class="row"><span>Ingresos Manuales $:</span><span>+${formatUSD(manualInUsd)}</span></div>` : ''}
            ${manualOutUsd > 0 ? `<div class="row"><span>Egresos / Gastos $:</span><span>-${formatUSD(manualOutUsd)}</span></div>` : ''}
            <div class="box">
                <div class="row"><span>Efectivo en Gaveta $:</span><span>${formatUSD(expectedCashUsd)}</span></div>
                ${!single ? `<div class="row"><span>Efectivo en Gaveta Bs:</span><span>${formatBs(expectedCashVes)}</span></div>` : ''}
            </div>
            ${methodKeys.length > 0 ? `
                <div class="divider"></div>
                <div class="bold small">DESGLOSE POR MÉTODO DE PAGO</div>
                ${methodKeys.map(k => {
                    const val = Number(expectedBreakdown[k] || 0);
                    const isVes = !single && isVesMethodKey(k);
                    return `<div class="row"><span>${escapeHtml(getMethodLabel(k, single))}:</span><span>${escapeHtml(isVes ? formatBs(val) : formatUSD(val))}</span></div>`;
                }).join('')}
            ` : ''}
            <div class="divider"></div>
            <div class="box">
                <div class="row"><span>TOTAL SISTEMA ($):</span><span>${formatUSD(totalSystemUsd)}</span></div>
                ${!single ? `<div class="row"><span>TOTAL SISTEMA (Bs):</span><span>${formatBs(totalSystemUsd * rate)}</span></div>` : ''}
            </div>
            <div class="center small" style="margin-top:10px;">--- Fin de Corte X ---</div>
        </body>
        </html>
    `;
    return await executeReceiptPrint(html, effSettings?.printerName, {
        rawContent: raw,
        settings: effSettings,
        kickDrawer: false
    });
};

/**
 * 4. Corte Z (Reporte de Cierre de Turno Definitivo)
 * Soporta tanto la firma de CloseShiftModal ({ shift, closureResult, user, businessSettings, currencyMode })
 * como la de BlindClosureModal ({ shift, declaration, difference, supervisorName, settings })
 * y la de ZReportModal ({ shift, businessSettings, exchangeRate, currencyMode }).
 */
export const printZReportReceipt = async ({
    shift,
    closureResult,
    declaration,
    supervisorName,
    user,
    settings,
    businessSettings,
    currencyMode,
    exchangeRate,
    widthMm = 80,
    kickDrawer = false,
    itemsSummary = null,
    autoPrint = false
}) => {
    const effSettings = resolveEffectiveSettings(settings, businessSettings);
    if (currencyMode) effSettings.currencyMode = currencyMode;
    if (exchangeRate) effSettings.rate = exchangeRate;

    const { widthMm: effWidth, cols } = resolveWidthCols(widthMm, effSettings);
    const single = isSingleCurrencyMode(effSettings) || isUsdOnlyMode(effSettings);
    const bizName = effSettings?.name || effSettings?.businessName || 'MI NEGOCIO POS';

    const mergedShift = {
        ...(shift || {}),
        ...(closureResult || {}),
        ...(closureResult?.shift || {})
    };

    const salesSummary = safeParseObj(
        mergedShift.salesSummary ||
        closureResult?.salesSummary ||
        closureResult?.shift?.salesSummary ||
        mergedShift.summary ||
        closureResult?.summary
    );

    const rate = Number(
        exchangeRate ||
        mergedShift.exchangeRateAtClose ||
        mergedShift.exchangeRate ||
        shift?.exchangeRate ||
        effSettings?.rate ||
        effSettings?.exchangeRate ||
        1
    ) || 1;

    // 1. Reconstruir Fondo Inicial (USD y VES) desde initialBreakdown e initialAmount
    const initBd = normalizeBreakdownMap(mergedShift.initialBreakdown || shift?.initialBreakdown);
    const hasInitKeys = Object.keys(initBd).length > 0;
    const openingUsd = hasInitKeys
        ? Number(initBd.cash ?? 0)
        : Number(mergedShift.openingAmount ?? mergedShift.initialAmount ?? 0);
    const openingVes = Number(initBd.cash_bs ?? mergedShift.openingAmountVes ?? 0);

    // 2. Reconstruir Expected Breakdown (combinando salesSummary.expectedBreakdown y shift.expectedBreakdown)
    const ebFromSummary = normalizeBreakdownMap(salesSummary.expectedBreakdown);
    const ebFromShift = normalizeBreakdownMap(mergedShift.expectedBreakdown || shift?.expectedBreakdown || closureResult?.expectedBreakdown);
    const expectedBreakdown = { ...ebFromShift, ...ebFromSummary };
    // Si ebFromSummary perdió métodos que sí estaban en shift?.expectedBreakdown (ej. antes de reiniciar backend), conservarlos
    Object.entries(ebFromShift).forEach(([k, v]) => {
        if ((expectedBreakdown[k] === undefined || expectedBreakdown[k] === 0) && v > 0) {
            expectedBreakdown[k] = v;
        }
    });

    // 3. Reconstruir Physical Breakdown (desde salesSummary.physicalBreakdown, finalBreakdown o declaration)
    let physicalBreakdown = normalizeBreakdownMap(
        salesSummary.physicalBreakdown ||
        mergedShift.physicalBreakdown ||
        closureResult?.physicalBreakdown ||
        closureResult?.finalBreakdown ||
        mergedShift.finalBreakdown
    );

    if (Object.keys(physicalBreakdown).length === 0 && declaration) {
        const dec = safeParseObj(declaration);
        let usdCash = 0;
        if (dec.usd && typeof dec.usd === 'object') {
            Object.entries(dec.usd).forEach(([denom, qty]) => {
                usdCash += (Number(denom) || 0) * (Number(qty) || 0);
            });
            usdCash += Number(dec.looseCoins || 0);
        } else {
            usdCash = Number(dec.usd ?? dec.declaredUsd ?? dec.cash ?? 0) + Number(dec.looseCoins || 0);
        }
        physicalBreakdown = normalizeBreakdownMap({
            cash: Math.round(usdCash * 100) / 100,
            cash_bs: Number(dec.ves ?? dec.declaredVes ?? 0),
            debit: Number(dec.card ?? dec.debit ?? 0),
            pago_movil: Number(dec.mobile ?? dec.pago_movil ?? 0),
            zelle: Number(dec.zelle ?? 0)
        });
    }

    const regName = mergedShift.registerName || `Caja ${mergedShift.registerId || '1'}`;
    const cashier = mergedShift.userName || mergedShift.user?.name || user?.name || user?.username || mergedShift.cashierName || 'Cajero';
    const resolvedSupervisor = supervisorName || salesSummary.authorizedBySupervisor || mergedShift.authorizedBySupervisor || '';
    const openTimeRaw = mergedShift.openedAt || mergedShift.openingTime || shift?.openedAt;
    const closeTimeRaw = mergedShift.closedAt || mergedShift.closingTime || Date.now();
    const openDateStr = openTimeRaw ? new Date(openTimeRaw).toLocaleString('es-VE') : 'N/A';
    const closeDateStr = new Date(closeTimeRaw).toLocaleString('es-VE');
    const shiftShortId = String(mergedShift.id || 'N/A').slice(0, 8).toUpperCase();

    // 4. Ventas y Movimientos del Turno
    const salesCount = Math.max(
        Number(salesSummary.salesCount ?? 0),
        Number(mergedShift.salesCount ?? 0),
        Number(shift?.salesCount ?? 0)
    );
    let salesTotalUsd = Math.max(
        Number(salesSummary.totalSales ?? 0),
        Number(mergedShift.totalSalesAmount ?? 0),
        Number(shift?.totalSalesAmount ?? 0),
        Number(salesSummary.salesTotal ?? 0)
    );
    const manualInUsd = Number(salesSummary.totalIn ?? mergedShift.totalIn ?? salesSummary.manualIn ?? 0);
    const manualOutUsd = Number(salesSummary.totalOut ?? mergedShift.totalOut ?? salesSummary.manualOut ?? 0) +
                         Number(salesSummary.totalExpenses ?? mergedShift.totalExpenses ?? 0);

    // 5. Efectivo en Gaveta (USD y VES por separado)
    const expectedCashUsd = Number(expectedBreakdown.cash ?? mergedShift.expectedCashUsd ?? 0);
    const declaredCashUsd = Number(
        physicalBreakdown.cash ??
        (typeof declaration?.usd === 'number' ? declaration.usd : undefined) ??
        declaration?.declaredUsd ??
        0
    );
    const diffCashUsd = Math.round((declaredCashUsd - expectedCashUsd) * 100) / 100;

    const expectedCashVes = Number(expectedBreakdown.cash_bs ?? mergedShift.expectedCashBs ?? 0);
    const declaredCashVes = Number(
        physicalBreakdown.cash_bs ??
        declaration?.ves ??
        declaration?.declaredVes ??
        0
    );
    const diffCashVes = Math.round((declaredCashVes - expectedCashVes) * 100) / 100;

    // 6. Desglose por todos los métodos de pago con actividad (esperado > 0 o declarado > 0)
    const methodOrder = ['cash', 'cash_bs', 'debit', 'pago_movil', 'zelle', 'transfer', 'biopago', 'fiado'];
    const allMethodKeys = Array.from(new Set([
        ...methodOrder,
        ...Object.keys(expectedBreakdown),
        ...Object.keys(physicalBreakdown)
    ])).filter(k => {
        if (single && isVesMethodKey(k)) return false;
        const expVal = Number(expectedBreakdown[k] ?? 0);
        const phyVal = Number(physicalBreakdown[k] ?? 0);
        return expVal > 0 || phyVal > 0;
    });

    // 7. Totales Generales Consolidados (Sistema vs Declarado vs Diferencia Neta)
    let calcExpectedTotalUsd = 0;
    let calcDeclaredTotalUsd = 0;
    allMethodKeys.forEach(k => {
        const expVal = Number(expectedBreakdown[k] ?? 0);
        const phyVal = Number(physicalBreakdown[k] ?? 0);
        const isVes = !single && isVesMethodKey(k);
        calcExpectedTotalUsd += isVes ? (expVal / rate) : expVal;
        calcDeclaredTotalUsd += isVes ? (phyVal / rate) : phyVal;
    });
    calcExpectedTotalUsd = Math.round(calcExpectedTotalUsd * 100) / 100;
    calcDeclaredTotalUsd = Math.round(calcDeclaredTotalUsd * 100) / 100;

    const totalExpectedUsd = calcExpectedTotalUsd > 0
        ? calcExpectedTotalUsd
        : Number(mergedShift.expectedAmount ?? 0);
    const totalDeclaredUsd = calcDeclaredTotalUsd > 0
        ? calcDeclaredTotalUsd
        : Number(mergedShift.finalAmount ?? 0);
    const totalDiffUsd = Math.round((totalDeclaredUsd - totalExpectedUsd) * 100) / 100;

    const totalExpectedVes = Math.round(totalExpectedUsd * rate * 100) / 100;
    const totalDeclaredVes = Math.round(totalDeclaredUsd * rate * 100) / 100;
    const totalDiffVes = Math.round(totalDiffUsd * rate * 100) / 100;

    // Si salesTotalUsd sigue en 0 pero hay métodos no-efectivo en expectedBreakdown, estimar ventas desde ahí
    if (salesTotalUsd === 0 && totalExpectedUsd > (openingUsd + (openingVes / rate))) {
        salesTotalUsd = Math.max(0, Math.round((totalExpectedUsd - (openingUsd + (openingVes / rate))) * 100) / 100);
    }
    const salesTotalVes = Math.round(salesTotalUsd * rate * 100) / 100;

    const closingNotes = mergedShift.closingNotes || mergedShift.notes || declaration?.notes || '';

    // Arqueo de Mercancía del Turno (Vendido vs. Stock Remanente)
    const resolvedItems = (Array.isArray(itemsSummary) && itemsSummary.length > 0)
        ? itemsSummary
        : (Array.isArray(salesSummary?.itemsSummary) && salesSummary.itemsSummary.length > 0)
            ? salesSummary.itemsSummary
            : (Array.isArray(mergedShift.salesSummary?.itemsSummary) && mergedShift.salesSummary.itemsSummary.length > 0)
                ? mergedShift.salesSummary.itemsSummary
                : (Array.isArray(mergedShift.itemsSummary) ? mergedShift.itemsSummary : []);

    const includeItemsInZ = effSettings.includeItemsInZReport !== false;
    const itemsPrintMode = effSettings.zReportItemsPrintMode || 'INTEGRATED';
    const shouldPrintItemsInZ = includeItemsInZ && itemsPrintMode === 'INTEGRATED' && resolvedItems.length > 0;

    // Generar ESC/POS RAW
    let raw = CMD.INIT;
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + cleanEscText(bizName.toUpperCase()) + CMD.LF + CMD.BOLD_OFF;
    if (effSettings.rif) raw += cleanEscText(effSettings.rif) + CMD.LF;
    raw += CMD.BOLD_ON + 'CORTE Z - CIERRE DE CAJA' + CMD.LF + CMD.BOLD_OFF;
    raw += divider(cols, '=');
    raw += CMD.ALIGN_LEFT;
    raw += padLine('Caja:', regName, cols);
    raw += padLine('Turno ID:', `#${shiftShortId}`, cols);
    raw += padLine('Cajero:', cashier, cols);
    raw += padLine('Apertura:', openDateStr, cols);
    raw += padLine('Cierre:', closeDateStr, cols);
    if (!single) {
        raw += padLine('Tasa BCV:', `Bs ${rate.toFixed(2)}`, cols);
    }
    raw += padLine('Ventas del Turno:', `${salesCount} op.`, cols);
    raw += divider(cols, '-');

    // Sección 1: Fondo Inicial y Ventas
    raw += CMD.BOLD_ON + 'FONDO INICIAL Y VENTAS' + CMD.LF + CMD.BOLD_OFF;
    raw += padLine('Fondo Inicial $:', formatUSD(openingUsd), cols);
    if (!single) {
        raw += padLine('Fondo Inicial Bs:', formatBs(openingVes), cols);
    }
    raw += padLine('Total Ventas ($):', formatUSD(salesTotalUsd), cols);
    if (!single) {
        raw += padLine('Total Ventas (Bs):', formatBs(salesTotalVes), cols);
    }
    if (manualInUsd > 0) raw += padLine('Ingresos Caja $:', `+${formatUSD(manualInUsd)}`, cols);
    if (manualOutUsd > 0) raw += padLine('Egresos/Gastos $:', `-${formatUSD(manualOutUsd)}`, cols);

    // Sección 2: Arqueo Efectivo en Gaveta USD
    raw += divider(cols, '-');
    raw += CMD.BOLD_ON + (single ? 'EFECTIVO EN GAVETA ($)' : 'EFECTIVO EN GAVETA USD ($)') + CMD.LF + CMD.BOLD_OFF;
    raw += padLine('Esperado Efec. $:', formatUSD(expectedCashUsd), cols);
    raw += padLine('Contado Fisico $:', formatUSD(declaredCashUsd), cols);
    raw += padLine('Diferencia Efec. $:', `${diffCashUsd > 0 ? '+' : ''}${formatUSD(diffCashUsd)}`, cols);

    // Sección 3: Arqueo Efectivo en Gaveta Bolívares
    if (!single) {
        raw += divider(cols, '-');
        raw += CMD.BOLD_ON + 'EFECTIVO EN GAVETA (Bs)' + CMD.LF + CMD.BOLD_OFF;
        raw += padLine('Esperado Efec. Bs:', formatBs(expectedCashVes), cols);
        raw += padLine('Contado Fisico Bs:', formatBs(declaredCashVes), cols);
        raw += padLine('Diferencia Efec. Bs:', `${diffCashVes > 0 ? '+' : ''}${formatBs(diffCashVes)}`, cols);
    }

    // Sección 4: Desglose completo por método de pago (Efectivo, Punto de Venta, Pago Móvil, Zelle, etc.)
    if (allMethodKeys.length > 0) {
        raw += divider(cols, '-');
        raw += CMD.BOLD_ON + 'DESGLOSE POR METODO DE PAGO' + CMD.LF + CMD.BOLD_OFF;
        allMethodKeys.forEach((k) => {
            const expVal = Number(expectedBreakdown[k] ?? 0);
            const phyVal = Number(physicalBreakdown[k] ?? 0);
            const diffVal = Math.round((phyVal - expVal) * 100) / 100;
            const isVes = !single && isVesMethodKey(k);
            const fmt = (v) => (isVes ? formatBs(v) : formatUSD(v));
            const label = getMethodLabel(k, single);
            raw += CMD.BOLD_ON + cleanEscText(`* ${label.toUpperCase()}`) + CMD.BOLD_OFF + CMD.LF;
            raw += padLine('  Sistema (Esp.):', fmt(expVal), cols);
            raw += padLine('  Declarado (Fis.):', fmt(phyVal), cols);
            raw += padLine('  Diferencia:', `${diffVal > 0 ? '+' : ''}${fmt(diffVal)}`, cols);
        });
    }

    // Sección 5: Resumen General Consolidado del Cierre
    raw += divider(cols, '=');
    raw += CMD.BOLD_ON + 'RESUMEN GENERAL DEL CIERRE' + CMD.LF + CMD.BOLD_OFF;
    raw += padLine('Total Sistema ($):', formatUSD(totalExpectedUsd), cols);
    if (!single) raw += padLine('Total Sistema (Bs):', formatBs(totalExpectedVes), cols);
    raw += padLine('Total Declarado ($):', formatUSD(totalDeclaredUsd), cols);
    if (!single) raw += padLine('Total Declarado (Bs):', formatBs(totalDeclaredVes), cols);
    raw += CMD.BOLD_ON;
    raw += padLine('DIFERENCIA FINAL ($):', `${totalDiffUsd > 0 ? '+' : ''}${formatUSD(totalDiffUsd)}`, cols);
    if (!single) {
        raw += padLine('DIFERENCIA FINAL (Bs):', `${totalDiffVes > 0 ? '+' : ''}${formatBs(totalDiffVes)}`, cols);
    }
    raw += CMD.BOLD_OFF;

    if (closingNotes) {
        raw += divider(cols, '-');
        raw += 'OBSERVACIONES:' + CMD.LF;
        raw += cleanEscText(closingNotes) + CMD.LF;
    }

    if (resolvedSupervisor) {
        raw += divider(cols, '-');
        raw += padLine('Autorizado por:', resolvedSupervisor, cols);
    }

    raw += divider(cols, '=');
    raw += CMD.LF + CMD.LF;
    raw += CMD.ALIGN_CENTER + '__________________________' + CMD.LF;
    raw += cleanEscText(`Firma Cajero (${cashier})`) + CMD.LF + CMD.LF;
    raw += '__________________________' + CMD.LF;
    raw += cleanEscText(`Firma Supervisor (${resolvedSupervisor || 'Admin'})`) + CMD.LF;
    raw += '--- Turno Cerrado ---' + CMD.LF + CMD.LF + CMD.LF;
    raw += CMD.CUT;

    const methodsHtml = allMethodKeys.length > 0 ? `
        <div class="divider"></div>
        <div class="bold small" style="margin-bottom:3px;">DESGLOSE POR MÉTODO DE PAGO</div>
        ${allMethodKeys.map(k => {
            const expVal = Number(expectedBreakdown[k] ?? 0);
            const phyVal = Number(physicalBreakdown[k] ?? 0);
            const diffVal = Math.round((phyVal - expVal) * 100) / 100;
            const isVes = !single && isVesMethodKey(k);
            const fmt = (v) => (isVes ? formatBs(v) : formatUSD(v));
            return `
                <div style="margin-bottom:4px;">
                    <div class="bold small">* ${escapeHtml(getMethodLabel(k, single).toUpperCase())}</div>
                    <div class="row small"><span>Sistema (Esp.):</span><span>${escapeHtml(fmt(expVal))}</span></div>
                    <div class="row small"><span>Declarado (Fís.):</span><span>${escapeHtml(fmt(phyVal))}</span></div>
                    <div class="row small"><span>Diferencia:</span><span>${diffVal > 0 ? '+' : ''}${escapeHtml(fmt(diffVal))}</span></div>
                </div>
            `;
        }).join('')}
    ` : '';

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>${getBaseStyles(effWidth)}</style></head>
        <body>
            <div class="center">
                <div class="bold">${escapeHtml(bizName)}</div>
                <div class="title">CORTE Z - CIERRE DE CAJA</div>
                <div class="small">${escapeHtml(regName)}</div>
            </div>
            <div class="double-divider"></div>
            <div class="row"><span>Turno ID:</span><span>#${escapeHtml(shiftShortId)}</span></div>
            <div class="row"><span>Cajero:</span><span>${escapeHtml(cashier)}</span></div>
            <div class="row"><span>Apertura:</span><span>${escapeHtml(openDateStr)}</span></div>
            <div class="row"><span>Cierre:</span><span>${escapeHtml(closeDateStr)}</span></div>
            ${!single ? `<div class="row"><span>Tasa BCV:</span><span>Bs ${rate.toFixed(2)}</span></div>` : ''}
            <div class="row"><span>Ventas del Turno:</span><span>${salesCount} op.</span></div>
            <div class="divider"></div>
            <div class="bold small">FONDO INICIAL Y VENTAS</div>
            <div class="row"><span>Fondo Inicial $:</span><span>${formatUSD(openingUsd)}</span></div>
            ${!single ? `<div class="row"><span>Fondo Inicial Bs:</span><span>${formatBs(openingVes)}</span></div>` : ''}
            <div class="row"><span>Total Ventas ($):</span><span>${formatUSD(salesTotalUsd)}</span></div>
            ${!single ? `<div class="row"><span>Total Ventas (Bs):</span><span>${formatBs(salesTotalVes)}</span></div>` : ''}
            ${manualInUsd > 0 ? `<div class="row"><span>Ingresos Caja $:</span><span>+${formatUSD(manualInUsd)}</span></div>` : ''}
            ${manualOutUsd > 0 ? `<div class="row"><span>Egresos/Gastos $:</span><span>-${formatUSD(manualOutUsd)}</span></div>` : ''}
            <div class="divider"></div>
            <div class="bold small">${single ? 'EFECTIVO EN GAVETA ($)' : 'EFECTIVO EN GAVETA USD ($)'}</div>
            <div class="row"><span>Esperado Efec. $:</span><span>${formatUSD(expectedCashUsd)}</span></div>
            <div class="row"><span>Contado Físico $:</span><span>${formatUSD(declaredCashUsd)}</span></div>
            <div class="row"><span>Diferencia Efec. $:</span><span>${diffCashUsd > 0 ? '+' : ''}${formatUSD(diffCashUsd)}</span></div>
            ${!single ? `
            <div class="divider"></div>
            <div class="bold small">EFECTIVO EN GAVETA (Bs)</div>
            <div class="row"><span>Esperado Efec. Bs:</span><span>${formatBs(expectedCashVes)}</span></div>
            <div class="row"><span>Contado Físico Bs:</span><span>${formatBs(declaredCashVes)}</span></div>
            <div class="row"><span>Diferencia Efec. Bs:</span><span>${diffCashVes > 0 ? '+' : ''}${formatBs(diffCashVes)}</span></div>
            ` : ''}
            ${methodsHtml}
            <div class="double-divider"></div>
            <div class="box">
                <div class="bold small center" style="margin-bottom:4px;">RESUMEN GENERAL DEL CIERRE</div>
                <div class="row"><span>Total Sistema ($):</span><span>${formatUSD(totalExpectedUsd)}</span></div>
                ${!single ? `<div class="row"><span>Total Sistema (Bs):</span><span>${formatBs(totalExpectedVes)}</span></div>` : ''}
                <div class="row"><span>Total Declarado ($):</span><span>${formatUSD(totalDeclaredUsd)}</span></div>
                ${!single ? `<div class="row"><span>Total Declarado (Bs):</span><span>${formatBs(totalDeclaredVes)}</span></div>` : ''}
                <div class="row"><span>DIFERENCIA FINAL ($):</span><span>${totalDiffUsd > 0 ? '+' : ''}${formatUSD(totalDiffUsd)}</span></div>
                ${!single ? `<div class="row"><span>DIFERENCIA FINAL (Bs):</span><span>${totalDiffVes > 0 ? '+' : ''}${formatBs(totalDiffVes)}</span></div>` : ''}
            </div>
            ${closingNotes ? `
                <div class="divider"></div>
                <div class="small"><span class="bold">Observaciones:</span> ${escapeHtml(closingNotes)}</div>
            ` : ''}
            ${resolvedSupervisor ? `
                <div class="divider"></div>
                <div class="small center bold">AUTORIZADO POR SUPERVISOR: ${escapeHtml(resolvedSupervisor)}</div>
            ` : ''}
            ${shouldPrintItemsInZ ? `
                <div class="divider"></div>
                <div class="bold small center" style="margin-bottom:4px;">MERCANCÍA VENDIDA Y STOCK REMANENTE</div>
                <table style="width: 100%; font-size: 10px; border-collapse: collapse; margin-bottom: 6px;">
                    <thead>
                        <tr style="border-bottom: 1px dashed #666; font-weight: bold;">
                            <th style="text-align: left; padding: 2px 0;">PRODUCTO / PRES.</th>
                            <th style="text-align: right; padding: 2px 0;">VEND.</th>
                            <th style="text-align: right; padding: 2px 0;">QUEDAN</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${resolvedItems.map(it => `
                            <tr style="border-bottom: 1px dotted #ccc;">
                                <td style="padding: 2px 0;">${escapeHtml(it.name)}${it.presentationName ? ` <span style="font-size:9px; color:#555;">(${escapeHtml(it.presentationName)})</span>` : ''}</td>
                                <td style="text-align: right; padding: 2px 0; font-weight: bold;">${Number(it.quantitySold || 0).toFixed(2)}</td>
                                <td style="text-align: right; padding: 2px 0;">${Number(it.stockInPresentations !== undefined ? it.stockInPresentations : (it.currentStock || 0)).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="row small bold">
                    <span>Total Renglones: ${resolvedItems.length}</span>
                    <span>Total Vendido: ${resolvedItems.reduce((acc, it) => acc + (Number(it.quantitySold) || 0), 0).toFixed(2)}</span>
                </div>
            ` : ''}
            <div class="sig-line">Firma Cajero (${escapeHtml(cashier)})</div>
            <div class="sig-line">Firma Supervisor (${escapeHtml(resolvedSupervisor || 'Admin')})</div>
            <div class="center small" style="margin-top:10px;">--- Turno Cerrado ---</div>
        </body>
        </html>
    `;
    return await executeReceiptPrint(html, effSettings?.printerName, {
        rawContent: raw,
        settings: effSettings,
        kickDrawer,
        autoPrint
    });
};

/**
 * Imprime un comprobante térmico exclusivo de Auditoría de Mercancía e Inventario
 * para un turno de caja (útil como Ticket Anexo independiente o reimpresión).
 */
export const printShiftInventoryReceipt = async ({
    shift,
    itemsSummary = null,
    settings = null,
    businessSettings = null,
    widthMm = 80,
    autoPrint = false
}) => {
    const effSettings = resolveEffectiveSettings(settings, businessSettings);
    const { widthMm: effWidth, cols } = resolveWidthCols(widthMm, effSettings);
    const bizName = effSettings?.name || effSettings?.businessName || 'MI NEGOCIO POS';

    const mergedShift = { ...(shift || {}) };
    const salesSummary = safeParseObj(mergedShift.salesSummary || mergedShift.summary);
    
    const resolvedItems = (Array.isArray(itemsSummary) && itemsSummary.length > 0)
        ? itemsSummary
        : (Array.isArray(salesSummary?.itemsSummary) && salesSummary.itemsSummary.length > 0)
            ? salesSummary.itemsSummary
            : (Array.isArray(mergedShift.itemsSummary) ? mergedShift.itemsSummary : []);

    const regName = mergedShift.registerName || `Caja ${mergedShift.registerId || '1'}`;
    const cashier = mergedShift.userName || mergedShift.user?.name || mergedShift.cashierName || 'Cajero';
    const shiftShortId = String(mergedShift.id || 'N/A').slice(0, 8).toUpperCase();
    const closeTimeRaw = mergedShift.closedAt || mergedShift.closingTime || Date.now();
    const closeDateStr = new Date(closeTimeRaw).toLocaleString('es-VE');

    let totalSoldUnits = 0;

    let raw = CMD.INIT;
    raw += CMD.ALIGN_CENTER + CMD.BOLD_ON + cleanEscText(bizName.toUpperCase()) + CMD.LF + CMD.BOLD_OFF;
    if (effSettings.rif) raw += cleanEscText(effSettings.rif) + CMD.LF;
    raw += CMD.BOLD_ON + 'ARQUEO DE MERCANCIA Y STOCK' + CMD.LF + CMD.BOLD_OFF;
    raw += cleanEscText(`TURNO #${shiftShortId} • ${regName}`) + CMD.LF;
    raw += cleanEscText(`Cajero: ${cashier}`) + CMD.LF;
    raw += cleanEscText(`Fecha: ${closeDateStr}`) + CMD.LF;
    raw += divider(cols, '=');
    raw += CMD.ALIGN_LEFT;

    if (cols >= 40) {
        raw += padLine('PRODUCTO / PRESENTACION', 'VEND.   QUEDAN', cols);
        raw += divider(cols, '-');
        resolvedItems.forEach(item => {
            const presText = item.presentationName ? ` (${item.presentationName})` : '';
            const label = `${item.name}${presText}`;
            const sold = Number(item.quantitySold || 0).toFixed(2);
            const stock = Number(item.stockInPresentations !== undefined ? item.stockInPresentations : (item.currentStock || 0)).toFixed(2);
            totalSoldUnits += Number(item.quantitySold || 0);

            const values = `${sold.padStart(7)}  ${stock.padStart(7)}`;
            if (label.length + values.length >= cols - 1) {
                raw += cleanEscText(label).substring(0, cols) + CMD.LF;
                raw += ' '.repeat(Math.max(0, cols - values.length)) + values + CMD.LF;
            } else {
                raw += padLine(label, values, cols);
            }
        });
    } else {
        raw += padLine('PRODUCTO / PRES.', 'CANT.', cols);
        raw += divider(cols, '-');
        resolvedItems.forEach(item => {
            const presText = item.presentationName ? ` (${item.presentationName})` : '';
            const label = `${item.name}${presText}`;
            const sold = Number(item.quantitySold || 0).toFixed(2);
            const stock = Number(item.stockInPresentations !== undefined ? item.stockInPresentations : (item.currentStock || 0)).toFixed(2);
            totalSoldUnits += Number(item.quantitySold || 0);

            raw += cleanEscText(label).substring(0, cols) + CMD.LF;
            raw += padLine('  Vend:', `${sold} | Quedan: ${stock}`, cols);
        });
    }

    raw += divider(cols, '-');
    raw += padLine(`Total Renglones: ${resolvedItems.length}`, `Tot. Vend: ${totalSoldUnits.toFixed(2)}`, cols);
    raw += divider(cols, '=');
    raw += CMD.LF + CMD.LF;
    raw += CMD.ALIGN_CENTER + '__________________________' + CMD.LF;
    raw += cleanEscText(`Firma Cajero (${cashier})`) + CMD.LF + CMD.LF;
    raw += '__________________________' + CMD.LF;
    raw += 'Firma Supervisor / Admin' + CMD.LF;
    raw += '--- Control de Mercancía ---' + CMD.LF + CMD.LF + CMD.LF;
    raw += CMD.CUT;

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>${getBaseStyles(effWidth)}</style></head>
        <body>
            <div class="center">
                <div class="bold">${escapeHtml(bizName)}</div>
                <div class="title">ARQUEO DE MERCANCÍA Y STOCK</div>
                <div class="small">Turno #${escapeHtml(shiftShortId)} • ${escapeHtml(regName)}</div>
                <div class="small">Cajero: ${escapeHtml(cashier)}</div>
                <div class="small">${escapeHtml(closeDateStr)}</div>
            </div>
            <div class="divider"></div>
            <table style="width: 100%; font-size: 10px; border-collapse: collapse; margin-bottom: 6px;">
                <thead>
                    <tr style="border-bottom: 1px dashed #666; font-weight: bold;">
                        <th style="text-align: left; padding: 2px 0;">PRODUCTO / PRES.</th>
                        <th style="text-align: right; padding: 2px 0;">VEND.</th>
                        <th style="text-align: right; padding: 2px 0;">QUEDAN</th>
                    </tr>
                </thead>
                <tbody>
                    ${resolvedItems.map(it => `
                        <tr style="border-bottom: 1px dotted #ccc;">
                            <td style="padding: 2px 0;">${escapeHtml(it.name)}${it.presentationName ? ` <span style="font-size:9px; color:#555;">(${escapeHtml(it.presentationName)})</span>` : ''}</td>
                            <td style="text-align: right; padding: 2px 0; font-weight: bold;">${Number(it.quantitySold || 0).toFixed(2)}</td>
                            <td style="text-align: right; padding: 2px 0;">${Number(it.stockInPresentations !== undefined ? it.stockInPresentations : (it.currentStock || 0)).toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="divider"></div>
            <div class="row small bold">
                <span>Total Renglones: ${resolvedItems.length}</span>
                <span>Total Vendido: ${totalSoldUnits.toFixed(2)}</span>
            </div>
            <div class="sig-line">Firma Cajero (${escapeHtml(cashier)})</div>
            <div class="sig-line">Firma Supervisor / Admin</div>
            <div class="center small" style="margin-top:10px;">--- Control de Mercancía ---</div>
        </body>
        </html>
    `;

    return await executeReceiptPrint(html, effSettings?.printerName, {
        rawContent: raw,
        settings: effSettings,
        autoPrint
    });
};
