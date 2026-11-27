import { formatMoney, formatBs, formatUSD, formatStock, formatDate, isDollarOnlyCountry, isUsdOnlyMode, getTaxIdLabel, getCustomerDocLabel } from './format';

// ESC/POS Commands (Decimal equivalents, but represented as strings for Buffer UTF-8 translation)
// Note: Since main.js does Buffer.from(content, 'utf8'), raw binary bytes 0x00-0x7F translate 1:1.
const ESC = '\x1b';
const FS = '\x1c';
const GS = '\x1d';

// ESC @ (Init) + FS . (Desactiva modo chino/Kanji de fábrica) + ESC t 19 (CP858 / PC858 Español + Euro)
export const ESC_INIT_CP858 = ESC + '@' + FS + '.' + ESC + 't\x13';
// ESC @ (Init) + FS . (Desactiva modo chino/Kanji de fábrica) + ESC t 0 (Selecciona tabla PC437 estándar)
export const ESC_INIT = ESC + '@' + FS + '.' + ESC + 't\x00';
export const ESC_ALIGN_LEFT = ESC + 'a\x00';
export const ESC_ALIGN_CENTER = ESC + 'a\x01';
export const ESC_ALIGN_RIGHT = ESC + 'a\x02';
export const ESC_BOLD_ON = ESC + 'E\x01';
export const ESC_BOLD_OFF = ESC + 'E\x00';
export const GS_TEXT_DOUBLE = GS + '!\x11'; // Double height + Double width
export const GS_TEXT_NORMAL = GS + '!\x00'; // Normal size
export const GS_CUT = GS + 'V\x01';         // Partial cut

// Mapa de caracteres hispanos/europeos a bytes CP858 (Code Page 19 en Epson/Xprinter/Rongta/Pos58/80)
const CP858_CHAR_MAP = {
    'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
    'ê': 0x88, 'ë': 0x89, 'è': 0x8A, 'ï': 0x8B, 'î': 0x8C, 'ì': 0x8D, 'Ä': 0x8E, 'Å': 0x8F,
    'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
    'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9A, '£': 0x9C, '×': 0x9E,
    'á': 0xA0, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5, 'ª': 0xA6, 'º': 0xA7,
    '¿': 0xA8, '¡': 0xAD, '«': 0xAE, '»': 0xAF,
    'Á': 0xB5, 'Â': 0xB6, 'À': 0xB7, '©': 0xB8, '¢': 0xBD, '¥': 0xBE,
    'ã': 0xC6, 'Ã': 0xC7, '€': 0xD5, 'Í': 0xD6, 'Î': 0xD7, 'Ï': 0xD8,
    'Ó': 0xE0, 'ß': 0xE1, 'Ô': 0xE2, 'Ò': 0xE3, 'õ': 0xE4, 'Õ': 0xE5,
    'Ú': 0xE9, 'Û': 0xEA, 'Ù': 0xEB, 'ý': 0xEC, 'Ý': 0xED, '°': 0xF8, '·': 0xFA, '²': 0xFD
};

/**
 * Codifica texto + secuencias de control ESC/POS en bytes CP858 reales (preservando ñ, Ñ, tildes y ¿¡).
 * Evita el mojibake de enviar UTF-8 a impresoras térmicas de 58mm/80mm.
 */
export function encodeEscPosCp858(input) {
    if (input instanceof Uint8Array) return input;
    const str = String(input ?? '');
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const code = str.charCodeAt(i);
        // Preservar bytes de control ESC/POS y ASCII imprimible 0x00..0x7F intactos
        if (code <= 0x7F) {
            bytes.push(code);
            continue;
        }
        // Espacios Unicode no separables -> espacio ASCII estándar
        if (/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/.test(ch)) {
            bytes.push(0x20);
            continue;
        }
        // Tipografía común
        if (ch === '“' || ch === '”') { bytes.push(0x22); continue; }
        if (ch === '‘' || ch === '’') { bytes.push(0x27); continue; }
        if (ch === '—' || ch === '–') { bytes.push(0x2D); continue; }
        if (ch === '•') { bytes.push(0x2A); continue; }

        if (CP858_CHAR_MAP[ch] !== undefined) {
            bytes.push(CP858_CHAR_MAP[ch]);
            continue;
        }
        // Fallback seguro: remover diacrítico si no existe en CP858
        const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        for (let j = 0; j < stripped.length; j++) {
            const c2 = stripped.charCodeAt(j);
            if (c2 <= 0x7F) bytes.push(c2);
        }
    }
    return new Uint8Array(bytes);
}

/**
 * Cleans a string to contain only basic, print-safe ASCII characters.
 * Essential for thermal printers which crash or print mojibake/garbage when receiving UTF-8 characters.
 */
export function cleanAscii(str) {
    if (!str) return '';
    return String(str)
        // 1. Convertir espacios de no separación (NBSP / Narrow NBSP) generados por Intl.NumberFormat a espacio estándar
        .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
        // 2. Reemplazar símbolos hispanos y tipográficos antes de normalizar
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
        // 3. Descomponer acentos y diacríticos (á -> a, é -> e, etc.)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        // 4. Remover cualquier carácter restante fuera de ASCII 7-bit seguro (> 0x7F)
        .replace(/[\u0080-\uFFFF]/g, '');
}

/**
 * Limpia texto preservando caracteres hispanos soportados por CP858 (ñ, Ñ, tildes, ¿¡, €),
 * eliminando NBSP, emojis y caracteres fuera de CP858 para que `encodeEscPosCp858` los imprima limpios.
 */
export function cleanCp858Text(str) {
    if (!str) return '';
    let out = '';
    const normalized = String(str)
        .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–]/g, '-')
        .replace(/•/g, '*');
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        const code = normalized.charCodeAt(i);
        if (code <= 0x7F || CP858_CHAR_MAP[ch] !== undefined) {
            out += ch;
        } else {
            const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            for (let j = 0; j < stripped.length; j++) {
                if (stripped.charCodeAt(j) <= 0x7F) out += stripped[j];
            }
        }
    }
    return out;
}

/**
 * Formats a single line with left-aligned and right-aligned text.
 */
export function formatLine(left, right, width, options = {}) {
    const cleaner = options?.preserveCp858 ? cleanCp858Text : cleanAscii;
    const cleanLeft = cleaner(left);
    const cleanRight = cleaner(right);
    const spaceCount = width - cleanLeft.length - cleanRight.length;
    
    if (spaceCount > 0) {
        return cleanLeft + ' '.repeat(spaceCount) + cleanRight;
    }
    
    // If combined length is too long, truncate the left text
    if (cleanLeft.length + cleanRight.length > width) {
        const allowedLeftWidth = width - cleanRight.length - 1;
        const truncatedLeft = cleanLeft.substring(0, allowedLeftWidth);
        return truncatedLeft + ' ' + cleanRight;
    }
    
    return cleanLeft + cleanRight;
}

/**
 * Centers text on a line of a specific column width.
 */
export function formatCenter(text, width, options = {}) {
    const cleaner = options?.preserveCp858 ? cleanCp858Text : cleanAscii;
    const cleanText = cleaner(text);
    if (cleanText.length >= width) {
        return cleanText.substring(0, width);
    }
    const spaces = Math.floor((width - cleanText.length) / 2);
    return ' '.repeat(spaces) + cleanText;
}

/**
 * Standardizes multi-line paragraphs (like footers or headers) to fit a specific width.
 */
export function formatParagraph(text, width, align = 'center') {
    if (!text) return '';
    return String(text)
        .split('\n')
        .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '';
            if (align === 'center') return formatCenter(trimmed, width);
            if (align === 'right') return trimmed.substring(0, width).padStart(width, ' ');
            return trimmed.substring(0, width);
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * Translates a complete sale record into raw ESC/POS text command sequences.
 * Soporta emisión de 1 o 2 copias físicas consecutivas con corte independiente de guillotina.
 */
export function formatSaleToEscPos(sale, business = {}, exchangeRate = 1, currencyMode = 'BOTH', paymentMethods = [], options = {}) {
    const is80mm = business.receiptWidth === '80mm';
    const cols = is80mm ? 48 : 32;

    const effectiveCountry = business.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = Boolean(business.isUsdOnly) || isDollarCountry || isUsdOnlyMode({ currencyMode, country: effectiveCountry, ...business });

    const effectiveExchangeRate = isUsdOnly ? 1 : exchangeRate;
    const effectiveCurrencyMode = isUsdOnly ? 'USD' : currencyMode;
    const isOnlyBs = !isUsdOnly && Boolean(business.receiptOnlyBs || currencyMode === 'VES');

    const formattedDate = formatDate(sale.createdAt || Date.now(), { dateStyle: 'short' });
    const formattedTime = new Date(sale.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const docTitle = sale.documentType === 'nota_entrega' ? 'NOTA DE ENTREGA' : 'FACTURA';
    const dailyTicketNum = sale?.dailyTicketNumber || sale?.taxInfo?.dailyTicketNumber || null;
    const receiptNum = String(sale?.id || '').split('-')[0].toUpperCase();
    
    const moneyConfig = { rate: effectiveExchangeRate, currencyMode: effectiveCurrencyMode };
    const formatMoneyLocal = (val, force = null) => formatMoney(val, isUsdOnly ? 'USD' : force, moneyConfig);

    const buildSingleTicket = (ticketRole = 'STANDARD') => {
        let ticket = '';
        
        // 1. Initialize Printer
        ticket += ESC_INIT;
        
        // 2. Business Header (Bold and Centered)
        ticket += ESC_ALIGN_CENTER + ESC_BOLD_ON;
        if (business.name) {
            ticket += GS_TEXT_DOUBLE + cleanAscii(business.name).toUpperCase() + '\n' + GS_TEXT_NORMAL;
        } else {
            ticket += GS_TEXT_DOUBLE + 'ISAAC POS\n' + GS_TEXT_NORMAL;
        }
        ticket += ESC_BOLD_OFF;
        
        // 3. Tax / Contact Information (Centered)
        const taxIdLabel = getTaxIdLabel(effectiveCountry);
        const clientDocLabel = getCustomerDocLabel(effectiveCountry);
        if (business.rif) ticket += `${taxIdLabel}: ${cleanAscii(business.rif).toUpperCase()}\n`;
        if (business.address) ticket += formatParagraph(business.address, cols, 'center') + '\n';
        if (business.phone) ticket += `TEL: ${cleanAscii(business.phone)}\n`;
        
        // 4. Custom Header (if configured)
        if (business.receiptHeader) {
            let headerParsed = String(business.receiptHeader)
                .replace(/\{\{nombre_empresa\}\}/gi, business.name || 'Isaac POS')
                .replace(/\{\{rif\}\}/gi, business.rif || '')
                .replace(/\{\{ruc\}\}/gi, business.rif || '')
                .replace(/\{\{nit\}\}/gi, business.rif || '')
                .replace(/\{\{direccion\}\}/gi, business.address || '')
                .replace(/\{\{telefono\}\}/gi, business.phone || '')
                .replace(/\{\{cliente_nombre\}\}/gi, sale.customerName || 'Cliente Ocasional')
                .replace(/\{\{documento_cliente\}\}/gi, sale.customerDoc || '')
                .replace(/\{\{fecha\}\}/gi, formattedDate)
                .replace(/\{\{hora\}\}/gi, formattedTime)
                .replace(/\{\{nro_recibo\}\}/gi, receiptNum);
                
            ticket += formatParagraph(headerParsed, cols, 'center') + '\n';
        }
        
        ticket += ESC_ALIGN_LEFT;
        ticket += '-'.repeat(cols) + '\n';

        // 4B. Distintivo de Copia o Reimpresión Antifraude
        if (sale.isReprint || sale.reprintCount > 0) {
            ticket += ESC_ALIGN_CENTER + ESC_BOLD_ON;
            ticket += GS_TEXT_DOUBLE + '*** COPIA / REIMPRESION ***\n' + GS_TEXT_NORMAL;
            ticket += formatCenter('NO VALIDO COMO COMPROBANTE ORIGINAL', cols) + '\n';
            ticket += ESC_BOLD_OFF + ESC_ALIGN_LEFT;
            ticket += '-'.repeat(cols) + '\n';
        } else if (ticketRole === 'CONTROL') {
            ticket += ESC_ALIGN_CENTER + ESC_BOLD_ON;
            ticket += GS_TEXT_DOUBLE + '*** COPIA / CONTROL ***\n' + GS_TEXT_NORMAL;
            ticket += formatCenter('USO INTERNO DEL COMERCIO', cols) + '\n';
            ticket += ESC_BOLD_OFF + ESC_ALIGN_LEFT;
            ticket += '-'.repeat(cols) + '\n';
        } else if (ticketRole === 'ORIGINAL') {
            ticket += ESC_ALIGN_CENTER + ESC_BOLD_ON;
            ticket += formatCenter('*** ORIGINAL - CLIENTE ***', cols) + '\n';
            ticket += ESC_BOLD_OFF + ESC_ALIGN_LEFT;
            ticket += '-'.repeat(cols) + '\n';
        }
        
        // 5. Transaction Metadata (Left aligned)
        ticket += ESC_BOLD_ON;
        if (dailyTicketNum) {
            ticket += formatLine('NUMERO DE TICKET:', `#${dailyTicketNum}`, cols) + '\n';
        }
        ticket += formatLine('DOCUMENTO:', docTitle, cols) + '\n';
        ticket += formatLine('RECIBO:', dailyTicketNum ? `#${dailyTicketNum} (${receiptNum})` : `#${receiptNum}`, cols) + '\n';
        ticket += ESC_BOLD_OFF;
        ticket += formatLine('FECHA/HORA:', `${formattedDate} ${formattedTime}`, cols) + '\n';
        
        const cashier = sale.cashierName || sale.userName || sale.User?.name || business.cashierName;
        if (cashier) {
            ticket += formatLine('CAJERO:', cleanAscii(cashier).toUpperCase(), cols) + '\n';
        }
        
        if (!isUsdOnly && currencyMode === 'BOTH' && !isOnlyBs) {
            ticket += formatLine('TASA DE CAMBIO:', `${formatBs(effectiveExchangeRate).replace('Bs.S ', '').replace('Bs. ', '').replace('Bs.', '').trim()} BS/$`, cols) + '\n';
        }

        ticket += formatLine('CLIENTE:', (sale.customerName || 'CLIENTE OCASIONAL').toUpperCase(), cols) + '\n';
        if (sale.customerDoc) {
            ticket += formatLine(`${clientDocLabel}:`, cleanAscii(sale.customerDoc).toUpperCase(), cols) + '\n';
        }
        
        ticket += '-'.repeat(cols) + '\n';
        
        // 6. Item List
        const items = Array.isArray(sale.SaleItems) ? sale.SaleItems : (Array.isArray(sale.items) ? sale.items : []);
        const totalUnits = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

        items.forEach(item => {
            let nameClean = cleanAscii(item.name).toUpperCase();
            if (item.isBulk) {
                const bulkLabel = cleanAscii(item.bulkUnitName || 'PAQ').toUpperCase();
                nameClean = `[${bulkLabel}${item.unitsPerBulk ? ' x' + item.unitsPerBulk : ''}] ${nameClean}`;
            } else if (item.isMidBulk) {
                const midLabel = cleanAscii(item.midBulkUnitName || 'MEDIA').toUpperCase();
                nameClean = `[${midLabel}${item.unitsPerMidBulk ? ' x' + item.unitsPerMidBulk : ''}] ${nameClean}`;
            }
            const priceClean = formatMoneyLocal(item.price);
            const subtotalClean = formatMoneyLocal(item.subtotal || item.price * item.quantity);
            
            // Linea 1: Nombre del producto (izq) y Subtotal (der) en negrita
            const itemLine = formatLine(nameClean, subtotalClean, cols);
            ticket += ESC_BOLD_ON + itemLine + ESC_BOLD_OFF + '\n';
            
            // Linea 2: Detalle de Cantidad x Precio unitario (izq)
            const unitTag = item.isBulk 
                ? ` ${cleanAscii(item.bulkUnitName || 'Paq')}` 
                : item.isMidBulk 
                    ? ` ${cleanAscii(item.midBulkUnitName || 'Med')}` 
                    : '';
            const qtyPart = cleanAscii(`  ${formatStock(item.quantity)}${unitTag} x ${priceClean}`);
            ticket += qtyPart.substring(0, cols) + '\n';
            
            // Linea 3: Lote y Vencimiento (opcional)
            if (item.batchNumber || item.expirationDate) {
                let lotInfo = '  ';
                if (item.batchNumber) lotInfo += `Lote: ${cleanAscii(item.batchNumber)} `;
                if (item.expirationDate) lotInfo += `Venc: ${cleanAscii(item.expirationDate)}`;
                ticket += lotInfo.substring(0, cols) + '\n';
            }

            // Linea 4: Detalle de Promocion / Oferta Aplicada (2x1, Volumen)
            if (item.appliedPromoName || item.promoDiscount > 0) {
                const promoTag = `  * PROMO: ${cleanAscii(item.appliedPromoName || 'OFERTA')}`;
                const saveTag = item.promoDiscount ? ` (-${cleanAscii(formatMoneyLocal(item.promoDiscount))})` : '';
                ticket += cleanAscii(promoTag + saveTag).substring(0, cols) + '\n';
            }
        });
        
        ticket += '-'.repeat(cols) + '\n';
        
        // 7. Financial Totals
        ticket += formatLine('TOTAL ITEMS:', `${items.length} (${totalUnits} unids)`, cols) + '\n';
        ticket += formatLine('SUB-TOTAL:', formatMoneyLocal(sale.subtotal), cols) + '\n';
        
        if (sale.totalPromoSavings > 0 || sale.promoSavings > 0) {
            ticket += ESC_BOLD_ON + formatLine('AHORRO PROMO:', `-${formatMoneyLocal(sale.totalPromoSavings || sale.promoSavings)}`, cols) + ESC_BOLD_OFF + '\n';
        }

        if (sale.taxInfo?.exemptBase > 0) {
            ticket += formatLine('EXENTO:', formatMoneyLocal(sale.taxInfo.exemptBase), cols) + '\n';
        }
        
        if (sale.taxInfo?.taxableBase > 0) {
            ticket += formatLine(`IVA (${sale.taxRate || 16}%):`, formatMoneyLocal(sale.tax), cols) + '\n';
        }
        
        if (sale.igtfAmount > 0) {
            ticket += formatLine('IGTF (3%):', formatMoneyLocal(sale.igtfAmount), cols) + '\n';
        }

        if (sale.discountAmount > 0 || sale.discount > 0) {
            ticket += formatLine('DESCUENTO:', `-${formatMoneyLocal(sale.discountAmount || sale.discount)}`, cols) + '\n';
        }
        
        // Grand Total (Bold)
        ticket += ESC_BOLD_ON;
        const finalTotalText = 'TOTAL:';
        const finalTotalVal = formatMoneyLocal(sale.total, isUsdOnly ? 'USD' : (currencyMode === 'BOTH' ? 'VES' : null));
        ticket += formatLine(finalTotalText, finalTotalVal, cols) + '\n';
        ticket += ESC_BOLD_OFF;
        
        // Multi-currency Reference (if Venezuela dual pricing is active and not only Bs)
        if (!isUsdOnly && currencyMode === 'BOTH' && !isOnlyBs) {
            ticket += formatLine('REF. USD ($):', formatMoneyLocal(sale.total, 'USD'), cols) + '\n';
        }
        
        ticket += '-'.repeat(cols) + '\n';
        
        // 8. Payment Method Metadata
        const resolveMethodName = (methodKey, currency) => {
            if (!methodKey) {
                return (currency === 'VES' || currency === 'BS') ? 'EFECTIVO BS' : 'EFECTIVO';
            }
            const key = String(methodKey).toLowerCase().trim();
            const curr = String(currency || '').toUpperCase().trim();
            const isVes = curr === 'VES' || curr === 'BS';

            if (isUsdOnly) {
                if (key.includes('cash') || key.includes('efectivo')) return 'EFECTIVO';
                if (key === 'biopago') return 'PAGO DIGITAL';
                if (key === 'debit' || key === 'debito' || key === 'punto_de_venta' || key.includes('punto') || key === 'card' || key === 'tarjeta') return 'TARJETA / DEBITO';
                if (key === 'pago_movil' || key.includes('movil') || key === 'transfer' || key === 'transferencia' || key === 'transfer_bs') return 'TRANSFERENCIA';
                if (key === 'zelle') return 'ZELLE';
                if (key === 'credit' || key === 'credito' || key === 'fiado') return 'CREDITO';
            }

            // Blindaje Fiscal Venezuela / Internacional: Criptoactivos en tickets impresos
            if (key === 'binance_usdt' || key === 'binance' || key.includes('binance') || key === 'usdt') {
                const dynCrypto = Array.isArray(paymentMethods) && paymentMethods.find(pm => 
                    pm.id === methodKey || String(pm.id).toLowerCase() === key || (pm.name && pm.name.toLowerCase().includes('binance'))
                );
                return String(dynCrypto?.receiptLabel || 'PAGO ELECTRONICO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
            }

            const dynamic = Array.isArray(paymentMethods) && paymentMethods.find(pm => 
                pm.id === methodKey || String(pm.id).toLowerCase() === key
            );
            if (dynamic && dynamic.name) {
                let n = dynamic.name.toUpperCase();
                if (dynamic.id === 'binance_usdt' || n.includes('BINANCE') || n.includes('USDT')) {
                    return String(dynamic.receiptLabel || 'PAGO ELECTRONICO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
                }
                if (isUsdOnly && (n.includes('EFECTIVO BS') || n.includes('EFECTIVO $') || n.includes('EFECTIVO USD'))) return 'EFECTIVO';
                return n;
            }

            const names = {
                'cash': isUsdOnly ? 'EFECTIVO' : (isVes ? 'EFECTIVO BS' : 'EFECTIVO $'),
                'efectivo_usd': isUsdOnly ? 'EFECTIVO' : 'EFECTIVO $',
                'cash_usd': isUsdOnly ? 'EFECTIVO' : 'EFECTIVO $',
                'cash_bs': isUsdOnly ? 'EFECTIVO' : 'EFECTIVO BS',
                'efectivo_bs': isUsdOnly ? 'EFECTIVO' : 'EFECTIVO BS',
                'cash_ves': isUsdOnly ? 'EFECTIVO' : 'EFECTIVO BS',
                'pago_movil': isUsdOnly ? 'TRANSFERENCIA' : 'PAGO MOVIL',
                'biopago': isUsdOnly ? 'PAGO DIGITAL' : 'BIOPAGO (BDV)',
                'zelle': 'ZELLE',
                'debit': isUsdOnly ? 'TARJETA / DEBITO' : 'PUNTO VENTA',
                'debito': isUsdOnly ? 'TARJETA / DEBITO' : 'PUNTO VENTA',
                'credit': 'CREDITO',
                'credito': 'CREDITO',
                'fiado': 'CREDITO',
                'transfer': 'TRANSFERENCIA',
                'transferencia': 'TRANSFERENCIA'
            };
            if (names[key]) return names[key];

            return String(methodKey).replace(/_/g, ' ').toUpperCase();
        };

        const normalizedMethods = (() => {
            let raw = sale.paymentMethods || sale.PaymentDetails || sale.splitDetails;
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch (_) { raw = []; }
            }
            return Array.isArray(raw) ? raw : [];
        })();

        const fallbackRef = (() => {
            const direct = String(sale.paymentReference || sale.reference || sale.taxInfo?.reference || '').trim();
            if (direct) return direct;
            if (typeof sale.notes === 'string' && sale.notes.toLowerCase().startsWith('ref:')) {
                return sale.notes.substring(4).trim();
            }
            return '';
        })();

        const paymentMethodsDetails = (() => {
            if (normalizedMethods.length > 0) {
                return normalizedMethods.map(m => {
                    const isCrypto = m.method === 'binance_usdt' || String(m.method).toLowerCase().includes('binance') || (m.currency || '').toUpperCase() === 'USDT';
                    const name = resolveMethodName(m.method, m.currency);
                    const isVes = !isUsdOnly && (isCrypto || m.currency === 'VES' || m.currency === 'BS' || m.method === 'cash_bs' || m.method === 'efectivo_bs');
                    let amt = m.amount;
                    if (isCrypto && !isUsdOnly) {
                        amt = m.convertedAmountBs || (m.amount && m.cryptoRate ? Number(m.amount) * Number(m.cryptoRate) : (sale.totalBs || (sale.total * exchangeRate)));
                    }
                    const formattedAmt = isVes ? formatBs(amt) : formatUSD(amt);
                    return `${name}: ${formattedAmt}`;
                }).join(' | ');
            }
            
            const method = sale.paymentMethod || 'cash';
            const fallbackCurr = sale.currency || (method === 'cash_bs' ? 'VES' : 'USD');
            return resolveMethodName(method, fallbackCurr);
        })();
        
        ticket += formatLine('PAGO:', paymentMethodsDetails, cols) + '\n';

        if (normalizedMethods.length > 0) {
            normalizedMethods.forEach((m, idx) => {
                const refVal = String(m.reference || m.ref || m.paymentReference || (normalizedMethods.length === 1 && idx === 0 ? fallbackRef : '') || '').trim();
                if (refVal) {
                    const label = normalizedMethods.length > 1
                        ? `REF. ${resolveMethodName(m.method, m.currency)}:`
                        : 'REF. OPERACION:';
                    ticket += formatLine(label, `#${cleanAscii(refVal)}`, cols) + '\n';
                }
            });
        } else if (fallbackRef) {
            ticket += formatLine('REF. OPERACION:', `#${cleanAscii(fallbackRef)}`, cols) + '\n';
        }

        if (sale.change > 0 || sale.changeUsd > 0 || sale.changeBs > 0) {
            const chVal = (!isUsdOnly && sale.changeBs > 0) ? formatBs(sale.changeBs) : formatUSD(sale.changeUsd || sale.change || sale.changeBs);
            ticket += formatLine('CAMBIO/VUELTO:', chVal, cols) + '\n';
        }
        ticket += '-'.repeat(cols) + '\n';
        
        // 9. Footer & Thank you (Centered)
        ticket += ESC_ALIGN_CENTER;
        if (business.receiptFooter) {
            let footerParsed = String(business.receiptFooter)
                .replace(/\{\{nombre_empresa\}\}/gi, business.name || 'Isaac POS')
                .replace(/\{\{rif\}\}/gi, business.rif || '')
                .replace(/\{\{direccion\}\}/gi, business.address || '')
                .replace(/\{\{telefono\}\}/gi, business.phone || '')
                .replace(/\{\{cliente_nombre\}\}/gi, sale.customerName || 'Cliente Ocasional')
                .replace(/\{\{documento_cliente\}\}/gi, sale.customerDoc || '')
                .replace(/\{\{fecha\}\}/gi, formattedDate)
                .replace(/\{\{hora\}\}/gi, formattedTime)
                .replace(/\{\{nro_recibo\}\}/gi, receiptNum);
                
            ticket += formatParagraph(footerParsed, cols, 'center') + '\n';
        } else {
            ticket += 'GRACIAS POR SU COMPRA!\n';
        }
        
        ticket += formatParagraph('Isaac POS', cols, 'center') + '\n';
        
        // 10. Feed & Paper Cut (feed some lines so it exits the printer head, then cut)
        ticket += '\n\n\n\n\n' + GS_CUT;

        return ticket;
    };

    const targetCopies = Number(options.copies || business.receiptCopies) || 1;
    let fullTicket = '';

    if (targetCopies === 2) {
        // Emisión de 2 copias consecutivas: Original Cliente + Copia Control Interno
        fullTicket += buildSingleTicket('ORIGINAL');
        fullTicket += buildSingleTicket('CONTROL');
    } else {
        // Emisión estándar de 1 sola copia
        fullTicket += buildSingleTicket('STANDARD');
    }

    // 11. Opcional: Generar Vale de Despacho de Depósito si hay bultos/cajas
    if (business.enableWarehouseDispatchSlip || options.includeWarehouseDispatch) {
        const dispatchSlip = formatWarehouseDispatchSlip(sale, business);
        if (dispatchSlip) fullTicket += dispatchSlip;
    }
    
    return fullTicket;
}

/**
 * Genera el Talón de Retiro en Depósito / Almacén para mercancía mayorista o bultos pesados.
 * Diseñado con filtro inteligente: detecta palabras clave (caja, bulto, saco, fardo, paca, paleta),
 * factores de empaque mayores (>= 100) o flags de bulto.
 * NO incluye corte inicial para evitar doble corte con la guillotina al unirse al recibo del cliente.
 */
export function formatWarehouseDispatchSlip(sale, business = {}) {
    if (!sale) return '';
    const is80mm = business.receiptWidth === '80mm';
    const cols = is80mm ? 48 : 32;

    const items = sale.items || sale.SaleItems || [];
    const bulkItems = items.filter(item => {
        const factor = Number(item.factorConversion || item.unitsMultiplier || item.unitsPerBulk || 1);
        const presName = String(item.presentationName || item.packName || '').trim();
        const itemName = String(item.name || item.nombre || '').trim();

        const isWholesaleName = /caja|bulto|saco|fardo|paca|paleta|canasta/i.test(presName) ||
                                /caja|bulto|saco|fardo|paca|paleta|canasta/i.test(itemName);

        return isWholesaleName || factor >= 100 || Boolean(item.isBulk) || Boolean(item.dispatchFromWarehouse);
    });

    if (bulkItems.length === 0) return '';

    let slip = '';
    // Inicializar estilos limpios para el talón
    slip += ESC_INIT;
    slip += ESC_ALIGN_CENTER;
    slip += GS_TEXT_DOUBLE;
    slip += cleanAscii('VALE DE DESPACHO') + '\n';
    slip += cleanAscii('RETIRO EN DEPOSITO') + '\n';
    slip += GS_TEXT_NORMAL;
    slip += ESC_BOLD_ON;
    slip += cleanAscii(business.name || 'DEPOSITO PRINCIPAL') + '\n';
    slip += ESC_BOLD_OFF;

    const dateVal = sale.date || sale.timestamp || sale.createdAt || new Date();
    const formattedDate = formatDate(dateVal);
    const dailyTicketNum = sale?.dailyTicketNumber || sale?.taxInfo?.dailyTicketNumber || null;
    const receiptNum = sale.invoiceNumber || String(sale.id).slice(-8);

    slip += '-'.repeat(cols) + '\n';
    if (dailyTicketNum) {
        slip += ESC_BOLD_ON + `NUMERO DE TICKET: #${dailyTicketNum}\n` + ESC_BOLD_OFF;
    }
    slip += formatLine(`Numero de Ticket: ${dailyTicketNum ? `#${dailyTicketNum} (${receiptNum})` : receiptNum}`, formattedDate, cols) + '\n';
    slip += formatLine(`Cliente: ${cleanAscii(sale.customerName || 'Cliente Ocasional')}`, `Caja: ${cleanAscii(sale.cashierName || '1')}`, cols) + '\n';
    slip += '-'.repeat(cols) + '\n';
    slip += ESC_ALIGN_LEFT;
    slip += ESC_BOLD_ON;
    slip += cleanAscii('MERCANCIA A RETIRAR / DESPACHAR:') + '\n';
    slip += '-'.repeat(cols) + '\n';

    for (const item of bulkItems) {
        const factor = Number(item.factorConversion || item.unitsMultiplier || item.unitsPerBulk || 1);
        const qty = Number(item.quantity) || 1;
        const pName = cleanAscii(item.name || item.nombre || 'Producto');
        const packLabel = cleanAscii(item.presentationName || (item.isBulk ? 'BULTO CERRADO' : 'EMPAQUE'));

        slip += `${qty}x [${packLabel}] ${pName}\n`;
        if (factor > 1) {
            slip += `   --> Entregar: ${qty * factor} Unidades base\n`;
        }
    }

    slip += ESC_BOLD_OFF;
    slip += '-'.repeat(cols) + '\n';
    slip += ESC_ALIGN_CENTER;
    slip += '\n\n';
    slip += cleanAscii('Firma Almacenero: ___________________') + '\n';
    slip += cleanAscii('Firma Cliente:    ___________________') + '\n\n\n\n';
    slip += GS_CUT;

    return slip;
}

/**
 * Genera el comando ESC/POS para imprimir un código de barras CODE128 centrado.
 * Adaptativo para impresoras de 58 mm (32 cols / 384 dots) y 80 mm (48 cols / 576 dots).
 */
export function formatBarcodeEscPos(code, is58mm = false) {
    if (!code) return '';
    const cleanCode = cleanAscii(String(code).trim());
    if (!cleanCode) return '';

    // Altura: 42 dots en 58mm (evita comerse el papel), 55 dots en 80mm
    const heightDot = is58mm ? 42 : 55;
    // Ancho de módulo: en 58mm usamos 1 si el código tiene más de 9 dígitos para evitar desborde del cabezal
    const moduleWidth = is58mm && cleanCode.length > 9 ? 1 : 2;

    // En CODE128 (GS k 73 / 0x49): prefijo {B para conjunto de caracteres B (ASCII imprimible estándar)
    const payload = '{B' + cleanCode;
    const len = payload.length;

    let res = '';
    res += ESC_ALIGN_CENTER;
    // Configurar altura del código de barras: GS h n
    res += GS + 'h' + String.fromCharCode(heightDot);
    // Configurar ancho de módulo del código de barras: GS w n
    res += GS + 'w' + String.fromCharCode(moduleWidth);
    // Configurar posición de texto HRI: GS H 2 (abajo)
    res += GS + 'H\x02';
    // Configurar fuente HRI: GS f 1 (fuente pequeña B)
    res += GS + 'f\x01';
    // Enviar código de barras: GS k 73 len payload
    res += GS + 'k\x49' + String.fromCharCode(len) + payload + '\n';

    return res;
}

/**
 * Genera el comando ESC/POS para un rótulo o etiqueta de producto individual.
 * Compatible al 100% tanto con POS-58 (58mm / 32 columnas) como con POS-80 (80mm / 48 columnas).
 */
export function formatProductLabelToEscPos(product, config = {}, exchangeRate = 1, is58mm = false) {
    if (!product) return '';
    const cols = is58mm ? 32 : 48;
    const separator = '-'.repeat(cols);

    let label = '';
    label += ESC_ALIGN_CENTER;

    // 1. Nombre del producto
    if (config.showName !== false && product.name) {
        label += ESC_BOLD_ON;
        const cleanName = cleanAscii(product.name).toUpperCase();
        if (cleanName.length <= cols) {
            label += cleanName + '\n';
        } else {
            // Dividir en palabras para salto de línea limpio
            const words = cleanName.split(' ');
            let currentLine = '';
            for (const word of words) {
                if ((currentLine + ' ' + word).trim().length <= cols) {
                    currentLine = (currentLine + ' ' + word).trim();
                } else {
                    if (currentLine) label += currentLine + '\n';
                    currentLine = word;
                }
            }
            if (currentLine) label += currentLine + '\n';
        }
        label += ESC_BOLD_OFF;
    }

    // 2. Precios
    const priceUsd = Number(product.price) || 0;
    const priceBs = (priceUsd * (exchangeRate || 1)).toFixed(2);
    const showUsd = config.showPrice !== false;
    const showBs = config.showPriceBs !== false;

    if (showUsd || showBs) {
        label += ESC_BOLD_ON;
        if (showUsd && showBs) {
            label += GS_TEXT_DOUBLE;
            label += `$${priceUsd.toFixed(2)}` + '\n';
            label += GS_TEXT_NORMAL;
            label += `Ref: ${priceBs} Bs` + '\n';
        } else if (showUsd) {
            label += GS_TEXT_DOUBLE;
            label += `$${priceUsd.toFixed(2)}` + '\n';
            label += GS_TEXT_NORMAL;
        } else {
            label += GS_TEXT_DOUBLE;
            label += `${priceBs} Bs` + '\n';
            label += GS_TEXT_NORMAL;
        }
        label += ESC_BOLD_OFF;
    }

    // 3. Código de barras CODE128
    if (config.showBarcode !== false && product.barcode) {
        try {
            label += formatBarcodeEscPos(product.barcode, is58mm);
        } catch (e) {
            console.warn('Error formateando código de barras ESC/POS:', e);
            label += cleanAscii(`* ${product.barcode} *`) + '\n';
        }
    }

    // 4. Separador visual de corte/rasgado
    label += ESC_ALIGN_CENTER;
    label += separator + '\n';

    // 5. Avance de papel adaptativo
    if (is58mm) {
        // En POS-58 (corte manual), requiere 3 saltos de línea para que la etiqueta
        // supere el cabezal térmico y la cuchilla de corte sin rasgar el código
        label += '\n\n\n';
    } else {
        // En POS-80, 2 saltos son suficientes
        label += '\n\n';
    }

    return label;
}

/**
 * Empaqueta un lote completo de etiquetas para impresión continua en tickera térmica.
 */
export function formatBatchProductLabelsToEscPos(products = [], config = {}, exchangeRate = 1, is58mm = false) {
    if (!Array.isArray(products) || products.length === 0) return '';

    let batch = '';
    // Inicializar impresora limpia
    batch += ESC_INIT;

    for (const item of products) {
        const copies = Number(item.labelCopies) || 1;
        for (let i = 0; i < copies; i++) {
            batch += formatProductLabelToEscPos(item, config, exchangeRate, is58mm);
        }
    }

    // Al final del lote completo:
    if (!is58mm) {
        // En 80mm ejecutamos corte automático al terminar todo el lote
        batch += '\n\n' + GS_CUT;
    } else {
        // En 58mm damos 2 saltos finales para dejar margen limpio
        batch += '\n\n';
    }

    return batch;
}
