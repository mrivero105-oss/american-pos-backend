const fs = require('fs');

const { ensureFetchPolyfill } = require('../utils/ensureFetchPolyfill');
ensureFetchPolyfill();

const AIService = require('./AIService');
const precision = require('../utils/precision');

/**
 * Servicio encargado de la extracción y procesamiento de datos desde PDFs e imágenes de proveedores.
 */
class PDFService {
    /**
     * Parsea un string de precio admitiendo formatos venezolanos e internacionales con hasta 6 decimales:
     * - 1.250,50 (Punto mil, coma decimal) -> 1250.50
     * - 1,250.50 (Coma mil, punto decimal) -> 1250.50
     * - 1250,50 -> 1250.50
     * - 0.0350 -> 0.035
     */
    static parsePrice(rawStr) {
        if (rawStr === null || rawStr === undefined) return 0;
        if (typeof rawStr === 'number') return (isNaN(rawStr) || !isFinite(rawStr)) ? 0 : rawStr;
        const cleaned = String(rawStr)
            .trim()
            .replace(/^(?:USD|US\$|VES|VEF|BS\.?D?|BS\.?S?|\$|\s)+/i, '')
            .replace(/(?:USD|US\$|VES|VEF|BS\.?D?|BS\.?S?|\$|\s)+$/i, '')
            .trim();
        if (!cleaned) return 0;
        return precision.parseNumericInput(cleaned);
    }

    /**
     * Extrae estructura contable desde un PDF o imagen de factura/catálogo.
     * @param {string} filePath Ruta al archivo PDF o Imagen.
     */
    static async parseCatalog(filePath) {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
        } catch (e) {
            throw new Error(`El archivo no se encontró en la ruta: ${filePath}`);
        }

        let dataBuffer = await fs.promises.readFile(filePath);

        // Si el archivo es una imagen directa (JPG/PNG/WEBP) obtenida desde escáner o cámara
        const hexHeader = dataBuffer.slice(0, 4).toString('hex').toLowerCase();
        const asciiHeader = dataBuffer.slice(0, 4).toString('ascii');
        if (hexHeader.startsWith('ffd8ff') || hexHeader.startsWith('89504e47') || asciiHeader.toLowerCase().startsWith('riff')) {
            console.log('[PDFService] Archivo de imagen detectado. Procesando directamente con Visión de IA Multimodal...');
            return await this._fallbackToAI(dataBuffer);
        }

        try {
            const pdf = require('pdf-parse');

            // Renderizador por coordenadas visuales agrupando ítems en filas por tolerancia de Y
            function render_page_grouped(pageData) {
                return pageData.getTextContent().then(textContent => {
                    if (!textContent || !textContent.items || textContent.items.length === 0) return '';
                    
                    const rows = [];
                    const yTolerance = 3.5;
                    
                    for (let item of textContent.items) {
                        if (!item.str || !item.str.trim()) continue;
                        const y = item.transform[5];
                        const x = item.transform[4];
                        
                        let row = rows.find(r => Math.abs(r.y - y) <= yTolerance);
                        if (!row) {
                            row = { y: y, items: [] };
                            rows.push(row);
                        }
                        row.items.push({ x: x, str: item.str });
                    }
                    
                    rows.sort((a, b) => b.y - a.y);
                    
                    const lines = rows.map(row => {
                        row.items.sort((a, b) => a.x - b.x);
                        return row.items.map(it => it.str.trim()).filter(Boolean).join(' ');
                    });
                    
                    return lines.join('\n');
                });
            }

            // Si es una factura fiscal compleja y el motor de IA está disponible, preferimos IA para cuadrar cantidades, RIF y totales exactos
            let result = await pdf(dataBuffer, { pagerender: render_page_grouped });
            const groupedText = result ? result.text : '';
            const looksLikeFiscalInvoice = /\b(FACTURA|SENIAT|BASE\s+IMPONIBLE|NRO\.?\s*CONTROL|NOTA\s+DE\s+ENTREGA)\b/i.test(groupedText);

            if (looksLikeFiscalInvoice && AIService.initialized && dataBuffer.length <= 15 * 1024 * 1024) {
                try {
                    console.log('[PDFService] Documento fiscal detectado en PDF. Aplicando motor multimodal de alta precisión...');
                    const aiInvoice = await this._fallbackToAI(dataBuffer);
                    if (aiInvoice && Array.isArray(aiInvoice.items) && aiInvoice.items.length > 0) {
                        return aiInvoice;
                    }
                } catch (aiFiscalErr) {
                    console.warn('[PDFService] Fallback a parser determinista de texto tras aviso IA:', aiFiscalErr.message);
                }
            }

            // Extracción determinista por reglas de texto (ideal para catálogos extensos o modo offline sin IA)
            let extractedData = this._extractFromTextLines(groupedText);
            let extractedItems = extractedData.items || [];

            if (extractedItems.length < 2) {
                console.log(`[PDF] Intento visual retornó ${extractedItems.length} items. Probando motor de lectura lineal...`);
                const standardResult = await pdf(dataBuffer);
                const standardData = this._extractFromTextLines(standardResult ? standardResult.text : '');
                if (standardData.items && standardData.items.length > extractedItems.length) {
                    extractedData = standardData;
                    extractedItems = standardData.items;
                }
            }

            if (extractedItems.length < 2) {
                console.log(`[PDF] Extracción de texto insuficiente (${extractedItems.length} items). Activando Visión Artificial con IA...`);
                try {
                    const aiItems = await this._fallbackToAI(dataBuffer);
                    if (aiItems) return aiItems;
                } catch (aiErr) {
                    console.warn(`[PDF] Fallback de IA no completó: ${aiErr.message}`);
                    if (extractedItems.length > 0) {
                        return extractedData;
                    }
                    throw aiErr;
                }
            }

            console.log(`[PDF] Extracción exitosa via reglas de precisión: ${extractedItems.length} items (Moneda: ${extractedData.currency}, Tipo: ${extractedData.documentType})`);
            return extractedData;
        } catch (error) {
            console.error('CRITICAL PDF PARSE ERROR:', error);
            try {
                return await this._fallbackToAI(dataBuffer);
            } catch (aiError) {
                throw new Error(aiError.message || `Fallo técnico al leer el PDF: ${error.message}`);
            }
        } finally {
            dataBuffer = null;
        }
    }

    /**
     * Procesa líneas de texto y extrae ítems y metadatos fiscales descartando encabezados/totales.
     */
    static _extractFromTextLines(rawText) {
        if (!rawText) {
            return { documentType: 'CATALOG', currency: 'USD', items: [] };
        }
        const extractedItems = [];
        const lines = rawText.split('\n');
        const seenKeys = new Set();

        const isBsDetected = /\b(BS|BS\.|BOLIVARES|BOLÍVARES|VES|VEF|BS\.D|BS\.S)\b/i.test(rawText);
        const isUsdExplicit = /\b(USD|US\$|DOLARES|DÓLARES)\b/i.test(rawText) && !isBsDetected;
        const detectedCurrency = isBsDetected ? 'BS' : (isUsdExplicit ? 'USD' : 'USD');

        // Solo marcar gravable por defecto si el documento tiene evidencia explícita de ser Factura Fiscal con IVA
        const hasFiscalTaxEvidence = /\b(BASE\s+IMPONIBLE|AL[IÍ]CUOTA|I\.?V\.?A\.?\s*(?:16|GENERAL)|SENIAT)\b/i.test(rawText);
        const isInvoiceDoc = hasFiscalTaxEvidence || /\b(FACTURA|NOTA\s+DE\s+ENTREGA|ORDEN\s+DE\s+DESPACHO|GU[IÍ]A\s+DE\s+DESPACHO)\b/i.test(rawText);
        const documentType = isInvoiceDoc ? 'INVOICE' : 'CATALOG';

        // Extraer metadatos básicos si están presentes en texto
        let detectedDate = null;
        const dateMatch = rawText.match(/\b(?:FECHA|EMISI[OÓ]N)?[:\s]*(\d{2})[\/\-](\d{2})[\/\-](20\d{2})\b/i)
            || rawText.match(/\b(20\d{2})[\/\-](\d{2})[\/\-](\d{2})\b/);
        if (dateMatch) {
            detectedDate = dateMatch[1].length === 4
                ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
                : `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
        }

        let exchangeRate = null;
        const rateMatch = rawText.match(/(?:TASA(?:\s+BCV|\s+DE\s+CAMBIO)?|BCV)[:\s]*(?:BS\.?\s*)?(\d{1,4}[.,]\d{2,4})/i);
        if (rateMatch && rateMatch[1]) {
            const parsedR = this.parsePrice(rateMatch[1]);
            if (parsedR > 1) exchangeRate = parsedR;
        }

        let referenceNumber = null;
        const refMatch = rawText.match(/(?:FACTURA|NOTA\s+DE\s+ENTREGA|CONTROL)\s*(?:NRO\.?|N[°º]?|#)?[:\s]*([0-9\-]{4,20})/i);
        if (refMatch && refMatch[1]) {
            referenceNumber = refMatch[1].trim();
        }

        let supplierRif = null;
        const rifMatch = rawText.match(/\b([JVEG][-\s]?\d{7,9}[-\s]?\d)\b/i);
        if (rifMatch && rifMatch[1]) {
            supplierRif = rifMatch[1].toUpperCase().replace(/\s+/g, '');
        }

        let docSubtotal = null;
        let docTaxAmount = null;
        let docTotal = null;

        const units = ['CAJA', 'UND', 'UNID', 'BULT', 'BULTO', 'PAQ', 'PAC', 'KILO', 'KG', 'UNI', 'DIS', 'DS', 'LAT', 'LITRO', 'BT', 'PCS', 'CTN', 'FDO', 'FARDO', 'TIRA'];
        const unitRegex = new RegExp(`\\s(${units.join('|')})\\s`, 'i');
        const priceRegex = /(?:(?:USD|US\$|Bs\.?|VES|\$)\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2,4}/gi;

        // Patrones de líneas que NUNCA son productos (totales, impuestos, datos fiscales)
        const nonProductLineRegex = /^(?:sub[\s\-]?total|total(?:\s+general|\s+factura|\s+a\s+pagar|\s+neto|\s+bs|\s+usd|\s+operaci[oó]n)?|monto\s+(?:exento|gravable|iva|total)|base\s+imponible|exento|i\.?v\.?a\.?(?:\s+16%?)?|al[ií]cuota|igtf|retenci[oó]n|descuento(?:\s+global)?|son\s*:|tasa\s+bcv|rif\s*:|nit\s*:|direcci[oó]n\s*:|tel[eé]fono\s*:|cliente\s*:|vendedor\s*:|condici[oó]n\s+de\s+pago|p[aá]gina\s+\d+|fecha\s+de\s+(?:emisi[oó]n|vencimiento)|forma\s+de\s+pago)\b/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.length < 5) continue;

            // Capturar totales del pie antes de descartar la línea
            const linePrices = line.match(priceRegex);
            if (linePrices && linePrices.length > 0) {
                const lastVal = this.parsePrice(linePrices[linePrices.length - 1]);
                if (/^(?:sub[\s\-]?total|base\s+imponible)/i.test(line) && lastVal > 0) {
                    docSubtotal = (docSubtotal || 0) + lastVal;
                    continue;
                }
                if (/^(?:monto\s+iva|i\.?v\.?a\.?\s*(?:16%?)?\b)/i.test(line) && lastVal >= 0) {
                    docTaxAmount = lastVal;
                    continue;
                }
                if (/^total(?:\s+general|\s+factura|\s+a\s+pagar|\s+neto|\s+bs|\s+usd)?\b/i.test(line) && lastVal > 0) {
                    docTotal = lastVal;
                    continue;
                }
            }

            if (nonProductLineRegex.test(line)) continue;
            // Descartar encabezados de tabla
            if (/\b(?:DESCRIPCI[OÓ]N|ART[IÍ]CULO)\b.*\b(?:PRECIO|MONTO|CANTIDAD|TOTAL)\b/i.test(line)) continue;

            let name = null;
            let price = 0;
            let suggestedQuantity = 1;
            let purchasedQuantity = isInvoiceDoc ? 1 : 0;

            // Detectar unidades por bulto/empaque ej "1x12", "x 24", "Caja 12", "(6 UND)"
            const sqMatch = line.match(/(?:\b1?\s*[xX]\s*(\d{2,4})\b|\b[xX]\s*(\d{1,4})\b|caja\s*(?:de\s*|x\s*)?(\d+)|bulto\s*(?:de\s*|x\s*)?(\d+)|\(\s*0?(\d{1,3})\s*(?:und|unid|uni|pcs)\s*\))/i);
            if (sqMatch) {
                const qtyVal = parseInt(sqMatch[1] || sqMatch[2] || sqMatch[3] || sqMatch[4] || sqMatch[5], 10);
                if (qtyVal > 1 && qtyVal < 5000) suggestedQuantity = qtyVal;
            }

            // ESTRATEGIA 1: ANCLA POR UNIDAD COMERCIAL
            const unitMatch = line.match(unitRegex);
            if (unitMatch) {
                const unitIndex = unitMatch.index;
                const afterUnit = line.substring(unitIndex + unitMatch[0].length).trim();
                const beforeUnit = line.substring(0, unitIndex).trim();

                const afterPrices = afterUnit.match(priceRegex);
                if (afterPrices && afterPrices.length > 0) {
                    // Primer precio tras la unidad suele ser Precio Unitario (y el segundo Subtotal de línea)
                    price = this.parsePrice(afterPrices[0]);

                    // Verificar si antes de la unidad o justo después hay cantidad comprada entera/decimal
                    const qtyAfterMatch = afterUnit.match(/^(\d+(?:[.,]\d+)?)\s+/);
                    if (isInvoiceDoc && qtyAfterMatch && afterPrices.length >= 2) {
                        const qCand = this.parsePrice(qtyAfterMatch[1]);
                        if (qCand > 0 && qCand < 10000 && Math.abs(qCand - price) > 0.0001) {
                            purchasedQuantity = qCand;
                        }
                    }

                    let cleanBefore = beforeUnit;
                    const leadingQtyAndCode = cleanBefore.match(/^(\d+)\s+((?=[A-Z0-9-]*\d)[A-Z0-9-]{2,14})\s+(.+)/i);
                    const leadingQtyOnly = !leadingQtyAndCode ? cleanBefore.match(/^(\d+)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ].+)/) : null;
                    if (isInvoiceDoc && leadingQtyAndCode) {
                        purchasedQuantity = parseInt(leadingQtyAndCode[1], 10) || 1;
                        cleanBefore = leadingQtyAndCode[3].trim();
                    } else if (isInvoiceDoc && leadingQtyOnly) {
                        purchasedQuantity = parseInt(leadingQtyOnly[1], 10) || 1;
                        cleanBefore = leadingQtyOnly[2].trim();
                    } else {
                        cleanBefore = cleanBefore.replace(/^(?=[A-Z0-9-]*\d)[A-Z0-9-]{2,14}\s+/i, '').trim();
                    }
                    name = cleanBefore;
                }
            }

            // ESTRATEGIA 2: DETECCIÓN DECIMAL UNIVERSAL
            if (!price || price <= 0 || !name || name.length < 3) {
                const matches = line.match(priceRegex);
                if (matches && matches.length >= 1) {
                    // Si hay 2 precios al final (ej: Cant + PrecioUnit + TotalLinea), verificar relación Cant * PrecioUnit = TotalLinea
                    let chosenPriceStr = matches[matches.length - 1];
                    if (isInvoiceDoc && matches.length >= 2) {
                        const p1 = this.parsePrice(matches[matches.length - 2]);
                        const p2 = this.parsePrice(matches[matches.length - 1]);
                        const leadingNumMatch = line.match(/^(\d+(?:[.,]\d+)?)\s+/);
                        if (leadingNumMatch) {
                            const lQty = this.parsePrice(leadingNumMatch[1]);
                            if (lQty > 0 && p1 > 0 && Math.abs((lQty * p1) - p2) <= Math.max(0.05, p2 * 0.01)) {
                                purchasedQuantity = lQty;
                                chosenPriceStr = matches[matches.length - 2];
                            }
                        }
                    }

                    const parsedP = this.parsePrice(chosenPriceStr);
                    if (parsedP > 0) {
                        const idx = line.indexOf(chosenPriceStr);
                        let namePart = (idx > 0 ? line.substring(0, idx) : line.split(chosenPriceStr)[0]).trim();
                        namePart = namePart
                            .replace(/^\d+(?:[.,]\d+)?\s+/, '')
                            .replace(/^(?=[A-Z0-9-]*\d)[A-Z0-9-]{2,14}\s+/i, '')
                            .replace(/\s+\d+$/, '')
                            .trim();

                        if (namePart.length >= 3 && !nonProductLineRegex.test(namePart)) {
                            name = namePart;
                            price = parsedP;
                        }
                    }
                }
            }

            if (name && price > 0) {
                const hasExemptTag = /\(E\)|\bEXENTO\b|\b0%\b/i.test(line);
                const hasTaxTag = /\(G\)|\b16%\b|\bGRAV/i.test(line);
                const isExempt = hasFiscalTaxEvidence
                    ? (hasExemptTag ? true : (hasTaxTag ? false : false))
                    : (hasTaxTag ? false : true);

                const cleanName = name
                    .replace(/\((?:E|G)\)/gi, '')
                    .replace(/\s+/g, ' ')
                    .substring(0, 120)
                    .trim();

                // Permitir renglones reales en facturas y deduplicar únicamente líneas idénticas de encabezado repetido en catálogos
                const dedupeKey = isInvoiceDoc ? `row_${i}_${cleanName.toLowerCase()}_${price}` : `${cleanName.toLowerCase()}_${price}`;
                if (!seenKeys.has(dedupeKey) && cleanName.length >= 3 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(cleanName)) {
                    seenKeys.add(dedupeKey);
                    extractedItems.push({
                        externalName: cleanName,
                        purchasedQuantity: isInvoiceDoc ? purchasedQuantity : 0,
                        price: price,
                        suggestedQuantity: suggestedQuantity,
                        isExempt: isExempt,
                        taxRate: isExempt ? 0 : 16,
                        taxStatus: isExempt ? 'exento' : 'gravable'
                    });
                }
            }
        }

        return {
            documentType,
            supplierRif,
            referenceNumber,
            invoiceDate: detectedDate,
            exchangeRate,
            rateSource: exchangeRate ? 'Factura' : null,
            docSubtotal,
            docTaxAmount,
            docTotal,
            currency: detectedCurrency,
            items: extractedItems
        };
    }

    /**
     * Fallback multimodal por IA para imágenes, escaneos o facturas complejas.
     */
    static async _fallbackToAI(buffer) {
        try {
            return await AIService.analyzeInvoicePDF(buffer);
        } catch (error) {
            console.error('[PDF] Fallo en fallback de IA:', error.message);
            throw error;
        }
    }
}

module.exports = PDFService;
