const { Supplier } = require('../../database/models');
const BCVRateService = require('../BCVRateService');
const precision = require('../../utils/precision');

function parseSmartInvoiceNumber(rawVal) {
    if (rawVal === null || rawVal === undefined) return 0;
    if (typeof rawVal === 'number') return (isNaN(rawVal) || !isFinite(rawVal)) ? 0 : rawVal;
    return precision.parseNumericInput(
        String(rawVal)
            .replace(/^[\$BsUuSsDdVvEe\.\s]+/, '')
            .replace(/[\$BsUuSsDdVvEe\s%]+$/, '')
    );
}

function detectMimeType(buffer, defaultMime = 'application/pdf') {
    const hex = buffer.slice(0, 4).toString('hex').toLowerCase();
    const ascii = buffer.slice(0, 4).toString('ascii');
    if (hex.startsWith('ffd8ff')) return 'image/jpeg';
    if (hex.startsWith('89504e47')) return 'image/png';
    if (ascii.startsWith('RIFF')) return 'image/webp';
    if (buffer.slice(0, 4).toString('binary') === '%PDF') return 'application/pdf';
    return defaultMime;
}

async function generateProductImagePrompt(aiService, productName, category = 'General') {
    if (!aiService.initialized) aiService.init();
    if (!aiService.initialized) return `A professional product photo of ${productName}, 16k resolution, 6D`;

    try {
        const prompt = `
ERES: Un director creativo experto en fotografía publicitaria futurista e hiper-avanzada.
TAREA: Genera un PROMPT EN INGLÉS para un generador de imágenes de IA.
PRODUCTO: ${productName}
CATEGORÍA: ${category}

REGLAS DEL PROMPT (EN INGLÉS):
1. Describe el producto de forma absurdamente realista, casi palpable.
2. Fondo blanco o de estudio minimalista, iluminación cinematográfica, hyper-detailed, ultra-photorealistic, 16k resolution, 6D visual depth, impossible extreme details, octane render, unreal engine 5, ray tracing.
3. Si es comida, que se vea fresca y provocativa. Si es un artículo de limpieza o medicamento, que se vea impecable, profesional y con la caja brillante.
4. RESPONDE ÚNICAMENTE CON EL TEXTO DEL PROMPT EN INGLÉS, sin explicaciones ni comillas.

PROMPT:
`;
        const result = await aiService.model.generateContent(prompt);
        return result.response.text().trim();
    } catch (error) {
        console.error('[ISAAC AI] Error generando prompt de imagen:', error.message);
        return `Professional product photography of ${productName}, white background, high resolution`;
    }
}

async function generateProductSearchQuery(aiService, productName) {
    if (!productName || typeof productName !== 'string') return '';
    const clean = productName.replace(/lata|roja|azul|verde|paquete|caja|\b\d+(g|gr|kg|ml|l|oz)\b/gi, '').trim();
    if (!aiService.initialized) return clean || productName;
    try {
        const prompt = `Extrae el nombre de la marca y modelo del producto para buscar su fotografía comercial de empaque sobre fondo blanco en tiendas online.
            Producto: "${productName}"
            Responde ÚNICAMENTE con la marca y modelo principal del producto, sin añadir explicaciones.`;

        const result = await aiService.model.generateContent(prompt);
        const query = result.response.text().trim().replace(/"/g, '');
        return query || clean || productName;
    } catch (_error) {
        return clean || productName;
    }
}

async function generateBarcodeSearchQuery(aiService, productName, category = '') {
    try {
        const prompt = `Genera un query de búsqueda corto y preciso para encontrar el CÓDIGO DE BARRAS (EAN-13 o UPC) del siguiente producto: "${productName}" ${category ? `de la categoría ${category}` : ''}.
Solo responde con el query de búsqueda, por ejemplo: "Atun Margarita 170g EAN-13 barcode" o "Harina PAN 1kg UPC code". No añadas explicaciones.`;

        const result = await aiService.model.generateContent(prompt);
        const response = await result.response;
        const query = response.text().trim().replace(/"/g, '');
        console.log(`[ISAAC AI] Query de código de barras generado: ${query}`);
        return query;
    } catch (error) {
        console.error('[ISAAC AI] Error al generar query de código de barras:', error.message);
        return `${productName} barcode EAN-13`;
    }
}

async function estimateBarcode(aiService, productName, imageData = null) {
    try {
        const prompt = `Estás ayudando a un sistema de Punto de Venta (POS) en Venezuela. 
Tu objetivo es proporcionar ÚNICAMENTE un número de código de barras (13 dígitos EAN o 12 dígitos UPC) altamente probable y oficial para este producto: "${productName}".

REGLAS ESTRICTAS:
1. Si el producto es genérico venezolano (hecho en Venezuela), el prefijo EAN suele ser 759. 
2. Si es un producto farmacéutico importado de India, suele tener prefijo 890. Si es de China, 690-699. Colombia 770.
3. Si el usuario te envía una imagen, analízala exhaustivamente. Busca textos del laboratorio, país de origen, banderitas, marcas y, si logras VER los números del código de barras, DEVUELVE ESOS NÚMEROS EXACTAMENTE.
4. Si no puedes ver el código en la imagen o no hay imagen, utiliza tu base de datos global de supermercado/farmacia para darnos el GTIN/EAN más real que exista para esa presentación exacta.
5. NO INVENTES números aleatorios sin sentido. Si un genérico tiene varios laboratorios, escoge el más común del mercado latinoamericano.
6. RESPONDE SOLAMENTE CON LOS NÚMEROS (ej: 7591002700010). SIN LETRAS, SIN SÍMBOLOS, SIN EXPLICACIÓN.
Si definitivamente consideras imposible dar un código real o probable, responde "NULL".`;

        const contents = [prompt];
        if (imageData && imageData.mimeType && imageData.data) {
            contents.push({
                inlineData: {
                    data: imageData.data,
                    mimeType: imageData.mimeType
                }
            });
        }

        const result = await aiService.model.generateContent(contents);
        const response = await result.response;
        const text = response.text().trim();

        const match = text.match(/\d{8,14}/);
        if (match) {
            console.log(`[ISAAC AI] Código de barras estimado/leído por IA (Visual+Texto): ${match[0]}`);
            return match[0];
        }
        console.log(`[ISAAC AI] Text no contenía un código válido. Raw: ${text}`);
        return null;
    } catch (error) {
        console.error('[ISAAC AI] Error en estimación de código multimodal:', error.message);
        return null;
    }
}

async function analyzeInvoicePDF(aiService, buffer) {
    if (!aiService.initialized) aiService.init();
    if (!aiService.initialized) {
        throw new Error('El archivo requiere procesamiento multimodal/OCR. Configura GOOGLE_API_KEY en las variables del sistema para habilitar la visión por IA.');
    }

    try {
        const mime = detectMimeType(buffer, 'application/pdf');
        console.log(`[ISAAC AI] Procesando catálogo/factura multimodal (${mime}, ${buffer.length} bytes)...`);

        const prompt = `Analiza detenidamente este documento fiscal o comercial venezolano/internacional (Factura física SENIAT, Ticket de Impresora Fiscal, NOTA DE ENTREGA, Guía de Despacho o Catálogo / Lista de Precios).
Extrae con precisión contable absoluta:
1. "documentType": "INVOICE" si es una compra/recepción con cantidades despachadas o facturadas (Factura, Ticket Fiscal, Nota de Entrega, Guía), o "CATALOG" si es únicamente una lista de precios / catálogo comercial sin cantidades compradas.
2. "supplierName": Razón social o nombre comercial del proveedor emisor (null si no aparece).
3. "supplierRif": RIF del proveedor emisor ej. "J-12345678-9" (null si no aparece).
4. "referenceNumber": Número de Factura, Nota de Entrega o Control ej. "00044831" (null si no aparece).
5. "date": Fecha de emisión del documento en formato YYYY-MM-DD (null si no aparece).
6. "currency": Moneda de los precios de la tabla ("BS" para Bolívares / VES, o "USD" para Dólares).
7. "exchangeRateOnInvoice": Si el documento tiene impresa una Tasa de Cambio (ej: "TASA BCV Bs 875,6505"), extrae ese número decimal puro; si no tiene, null.
8. Totales impresos al pie del documento en la misma moneda "currency" (null si es un catálogo sin totales):
   - "docSubtotal": Subtotal antes de IVA (suma de exento + base imponible).
   - "docTaxAmount": Monto total de IVA impreso.
   - "docTotal": Monto Total General a pagar impreso en la factura (sin IGTF salvo que sea parte del total).
9. "items": Lista completa de renglones de productos (NUNCA incluyas filas de SUBTOTAL, IVA, IGTF, DESCUENTO GENERAL ni TOTAL como productos).

REGLAS CRÍTICAS DE PRECISIÓN MATEMÁTICA PARA CADA RENGLÓN:
A. CANTIDAD COMPRADA ("purchasedQuantity") vs PRECIO UNITARIO DE EMPAQUE ("price"):
   - En facturas de tabla: "purchasedQuantity" es la columna CANTIDAD facturada (ej: 3 cajas, 5 bultos, 12 unidades) y "price" es el PRECIO UNITARIO NETO ANTES DE IVA de 1 solo empaque/fila (ten en cuenta descuentos por línea si existen: subtotal_linea / purchasedQuantity).
   - En tickets fiscales SENIAT: cuando se compran N unidades, encima del producto aparece "Nx Bs PRECIO_UNITARIO" (ej: "2x Bs 8.432,51" encima de "DORITO MEGA 1X12 (G) Bs 16.865,02"). En ese caso "purchasedQuantity" es 2 y "price" es 8432.51 (NUNCA 16865.02). Si NO hay línea "Nx" encima, "purchasedQuantity" es 1.
   - Si el documento es un CATÁLOGO de precios ("CATALOG"), coloca "purchasedQuantity": 0.

B. UNIDADES DENTRO DEL EMPAQUE ("suggestedQuantity"):
   - ¡REGLA CRÍTICA EN FACTURAS Y TICKETS FISCALES VENEZOLANOS!:
     En distribuidoras venezolanas, el nombre del producto suele terminar con un número entre paréntesis como "(30)", "(60)", "(36)", "(24)", "(20)", "(16)", "(12)", "(8)" antes de (E) o (G) (ej: "30xBs 1.133,38 CAFE ARAUCA GOURMET 100 GR (30) (E)", "12xBs 1.288,77 MARIA SELECTA 250GR(36) (G)", "5x Bs 959,72 AVENA SOBERANA 400GR(20) (E)").
     Ese número entre paréntesis "(N)" indica únicamente cuántas unidades trae el bulto cerrado de fábrica como referencia en el sistema del proveedor, PERO la factura ya está cobrando por UNIDAD INDIVIDUAL ("30x" unidades a Bs 1.133,38 cada unidad, "12x" unidades a Bs 1.288,77 cada unidad).
     Por lo tanto, NUNCA uses el número entre paréntesis "(N)" como "suggestedQuantity". Para todos esos productos "suggestedQuantity" DEBE SER 1.
   - SOLO coloca un número mayor a 1 en "suggestedQuantity" cuando el artículo facturado en esa línea sea explícitamente una bolsa/display de confitería o multipack con formato "1X100", "16X100", "1X48", "24UNI", "DISPLAY 18U" (ej: en "3x Bs 1.800,62 CARAMELO DE TAMARIND 1X100 (16)" cada bolsa trae 100 caramelos por "1X100" -> "suggestedQuantity": 100, ignorando el "(16)"; en "PIN POP CHUPETA FRUTAS 24UNI(16)" cada bolsa trae 24 chupetas por "24UNI" -> "suggestedQuantity": 24, ignorando el "(16)").

C. RÉGIMEN DE IVA ("isExempt", "taxRate", "taxStatus"):
   - CASO A (Documento SIN desglose de IVA: Nota de Entrega, Guía, Pedido o Catálogo neto): Todos los renglones llevan "isExempt": true, "taxRate": 0, "taxStatus": "exento".
   - CASO B (Factura Fiscal con IVA):
     * Renglones marcados con "(E)", "EXENTO" o alícuota 0%: "isExempt": true, "taxRate": 0, "taxStatus": "exento".
     * Renglones marcados con "(G)", "16%" o gravados en la factura: "isExempt": false, "taxRate": 16, "taxStatus": "gravable".
   - ¡REGLA DE ORO!: En TODOS los casos, "price" DEBE SER el precio BASE ANTES DE IVA (SIN multiplicar por 1.16). Si un catálogo incluye IVA explícitamente en el precio único, divídelo entre 1.16 o márcalo exento según corresponda para no cobrar doble IVA.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta (usa punto decimal estándar en los números, sin separadores de miles):
{
  "documentType": "INVOICE",
  "supplierName": "PROVEEDOR C.A.",
  "supplierRif": "J-12345678-9",
  "referenceNumber": "00044831",
  "currency": "BS",
  "date": "2026-08-14",
  "exchangeRateOnInvoice": 875.6505,
  "hasDocTax": true,
  "docSubtotal": 25297.20,
  "docTaxAmount": 4047.55,
  "docTotal": 29344.75,
  "items": [
    {
      "externalName": "DORITO MEGA 1X12",
      "barcode": null,
      "purchasedQuantity": 2,
      "price": 8432.51,
      "suggestedQuantity": 12,
      "isExempt": false,
      "taxRate": 16,
      "taxStatus": "gravable"
    }
  ]
}`;

        const contents = [
            prompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: mime
                }
            }
        ];

        let result;
        const modelsToTry = [
            'gemini-3.1-flash-lite',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.6-flash',
            'gemini-flash-lite-latest',
            'gemini-3.7-flash',
            'gemini-3.5-flash',
            'gemini-3.8-flash'
        ];
        let lastErr = null;

        for (const modelName of modelsToTry) {
            try {
                const m = aiService.genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
                });
                result = await m.generateContent(contents);
                if (result && result.response) {
                    console.log(`[ISAAC AI] Extracción exitosa con modelo: ${modelName}`);
                    break;
                }
            } catch (e) {
                lastErr = e;
                console.warn(`[ISAAC AI] Falló modelo ${modelName}: ${e.message}`);
            }
        }

        if (!result) {
            throw lastErr || new Error('No se pudo conectar con los modelos de IA.');
        }

        const responseText = result.response.text().trim();
        const cleanJson = responseText.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(cleanJson);
        } catch (jsonErr) {
            const objMatch = cleanJson.match(/\{[\s\S]*\}/);
            if (!objMatch) throw jsonErr;
            parsed = JSON.parse(objMatch[0]);
        }

        let detectedCurrency = 'BS';
        let detectedDate = null;
        let rawList = [];
        let rateOnInvoice = null;
        let documentType = 'INVOICE';
        let supplierName = null;
        let supplierRif = null;
        let referenceNumber = null;
        let docSubtotal = null;
        let docTaxAmount = null;
        let docTotal = null;

        if (Array.isArray(parsed)) {
            rawList = parsed;
        } else if (parsed && typeof parsed === 'object') {
            const rawCurr = String(parsed.currency || 'BS').toUpperCase();
            detectedCurrency = (rawCurr.includes('USD') || rawCurr.includes('DOLAR') || rawCurr === '$') ? 'USD' : 'BS';
            detectedDate = parsed.date || parsed.invoiceDate || null;
            rawList = Array.isArray(parsed.items) ? parsed.items : [];
            documentType = String(parsed.documentType || '').toUpperCase() === 'CATALOG' ? 'CATALOG' : 'INVOICE';
            supplierName = parsed.supplierName ? String(parsed.supplierName).trim() : null;
            supplierRif = parsed.supplierRif ? String(parsed.supplierRif).trim() : null;
            referenceNumber = parsed.referenceNumber ? String(parsed.referenceNumber).trim() : null;

            const parsedRate = parseSmartInvoiceNumber(parsed.exchangeRateOnInvoice);
            if (parsedRate > 0) rateOnInvoice = parsedRate;

            const pSub = parseSmartInvoiceNumber(parsed.docSubtotal);
            const pTax = parseSmartInvoiceNumber(parsed.docTaxAmount);
            const pTot = parseSmartInvoiceNumber(parsed.docTotal);
            if (pSub > 0) docSubtotal = pSub;
            if (pTax >= 0 && parsed.docTaxAmount !== null && parsed.docTaxAmount !== undefined) docTaxAmount = pTax;
            if (pTot > 0) docTotal = pTot;
        }

        if (detectedDate && typeof detectedDate === 'string') {
            const cleanDate = detectedDate.trim();
            const sepMatch = cleanDate.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/);
            if (sepMatch) {
                if (sepMatch[1].length === 4) {
                    detectedDate = `${sepMatch[1]}-${sepMatch[2].padStart(2, '0')}-${sepMatch[3].padStart(2, '0')}`;
                } else if (sepMatch[3].length === 4) {
                    detectedDate = `${sepMatch[3]}-${sepMatch[2].padStart(2, '0')}-${sepMatch[1].padStart(2, '0')}`;
                }
            }
        }

        let bcvRate = rateOnInvoice;
        let bcvSource = rateOnInvoice ? 'Factura' : null;

        if (!bcvRate && detectedCurrency === 'BS') {
            try {
                const bcvRes = await BCVRateService.getOfficialRate(detectedDate);
                if (bcvRes?.rate && bcvRes.rate > 0) {
                    bcvRate = Number(bcvRes.rate);
                    bcvSource = bcvRes.source;
                    console.log(`[ISAAC AI] ✅ Tasa oficial BCV de la fecha ${detectedDate || 'vigente'}: ${bcvRate} Bs/$ (Fuente: ${bcvSource})`);
                }
            } catch (rateErr) {
                console.warn(`[ISAAC AI] Aviso: No se pudo obtener tasa BCV para la fecha ${detectedDate}:`, rateErr.message);
            }
        } else if (bcvRate) {
            console.log(`[ISAAC AI] ✅ Tasa de cambio extraída directamente de la factura: ${bcvRate} Bs/$`);
        }

        const hasDocTax = parsed?.hasDocTax !== false;

        const formattedItems = rawList
            .map((item) => {
                const rawPrice = parseSmartInvoiceNumber(item.price ?? item.cost ?? 0);
                const nameStr = String(item.externalName || item.name || '').trim();
                if (!nameStr || rawPrice <= 0) return null;

                if (/^(sub[\s\-]?total|total\s*(general|factura|a\s*pagar|bs|usd)?|monto\s*iva|i\.?v\.?a\.?\s*16%?|base\s*imponible|igtf\b)/i.test(nameStr)) {
                    return null;
                }

                const isExempt = !hasDocTax || item.isExempt === true || item.taxStatus === 'exento' || Number(item.taxRate) === 0 || /\(E\)|\bEXENTO\b/i.test(nameStr);
                const rawPurchasedQty = parseSmartInvoiceNumber(item.purchasedQuantity ?? item.quantityBultos ?? (documentType === 'CATALOG' ? 0 : 1));
                const purchasedQuantity = documentType === 'CATALOG' ? 0 : Math.max(0, rawPurchasedQty);
                let suggestedQty = Math.max(1, parseInt(item.suggestedQuantity || item.unitsPerBulk || 1, 10) || 1);

                // Corrección determinista de unidades por empaque en facturas venezolanas:
                // 1) Si el nombre indica un multipack explícito tipo "1X100", "16X100", "1X48" o "24UNI", prevalece ese conteo sobre cualquier "(16)" o "(8)" final.
                const explicitPackMatch =
                    nameStr.match(/\b\d{1,2}\s*[xX]\s*(\d{2,4})\b/) ||
                    nameStr.match(/\b(\d{2,4})\s*UNI(?:D|DADES)?\b/i) ||
                    nameStr.match(/\b(?:DISPLAY|DISP|TIRA)\s*(?:DE\s*|X\s*)?(\d{1,4})\b/i);
                if (explicitPackMatch && explicitPackMatch[1]) {
                    const packUnits = parseInt(explicitPackMatch[1], 10);
                    if (packUnits > 1 && packUnits <= 2000) {
                        suggestedQty = packUnits;
                    }
                } else if (documentType === 'INVOICE') {
                    // 2) En facturas, si el nombre NO dice explícitamente BULTO/CAJA/FARDO/DISPLAY/1X, un "(30)" o "(36)" al final
                    // es solo la referencia de empaque maestro del proveedor mientras la línea se factura por unidad individual.
                    const hasExplicitBulkWord = /\b(?:BULTO|BULT|CAJA|CJ|FARDO|FDO|DISPLAY|DISP|TIRA)\b/i.test(nameStr) || /\b\d+\s*[xX]\s*\d+\b/.test(nameStr);
                    const parenMatches = [...nameStr.matchAll(/\(\s*(\d{1,4})\s*\)/g)];
                    const parenNumbers = parenMatches.map((m) => parseInt(m[1], 10)).filter((n) => n > 1);
                    if (!hasExplicitBulkWord && (parenNumbers.includes(suggestedQty) || purchasedQuantity > 1)) {
                        suggestedQty = 1;
                    }
                }

                const rawBarcode = item.barcode ? String(item.barcode).replace(/\s+/g, '').trim() : null;
                const validBarcode = (rawBarcode && /^\d{8,14}$/.test(rawBarcode)) ? rawBarcode : null;

                return {
                    externalName: nameStr.substring(0, 120),
                    barcode: validBarcode,
                    purchasedQuantity,
                    price: Math.max(0, rawPrice),
                    suggestedQuantity: suggestedQty,
                    isExempt,
                    taxRate: isExempt ? 0 : 16,
                    taxStatus: isExempt ? 'exento' : 'gravable'
                };
            })
            .filter(Boolean);

        const hasAnyPurchaseQty = formattedItems.some((i) => i.purchasedQuantity > 0);
        if (!hasAnyPurchaseQty && !docTotal) {
            documentType = 'CATALOG';
        }

        return {
            documentType,
            supplierName,
            supplierRif,
            referenceNumber,
            currency: detectedCurrency,
            invoiceDate: detectedDate,
            exchangeRate: bcvRate,
            rateSource: bcvSource,
            docSubtotal,
            docTaxAmount,
            docTotal,
            items: formattedItems
        };
    } catch (error) {
        console.error('[ISAAC AI] Error analizando catálogo con IA:', error.message);
        throw new Error(`Error en motor de visión por IA: ${error.message}`);
    }
}

async function extractSupplierInvoiceMetadata(aiService, buffer, companyId = 'default') {
    if (!aiService.initialized) aiService.init();
    if (!aiService.initialized) {
        throw new Error('El servicio de reconocimiento de facturas no está configurado (Falta GOOGLE_API_KEY).');
    }

    try {
        const mime = detectMimeType(buffer, 'image/jpeg');
        const prompt = `Eres el Asistente Experto en Facturación, Cuentas por Pagar y Auditoría Fiscal de Isaac POS.
Analiza detenidamente este comprobante fiscal (Factura, Nota de Entrega, Ticket de Caja, Guía o Comprobante).
Extrae los siguientes datos clave con máxima fidelidad:

1. Razón Social o Nombre Comercial del Proveedor ("supplierName")
2. RIF o Identificación Fiscal del Proveedor ("supplierRif") (ej: J-412945874 o V-12345678)
3. Número de Factura o Número de Control ("referenceNumber") (ej: 00044831, FACT-1029, 00-1284)
4. Monto Total Final de la Factura ("totalAmount") (número decimal puro, ej: 302515.47)
5. Moneda del Documento ("currency") ("BS" para Bolívares o "USD" para Dólares)
6. Fecha de Emisión ("date") en formato YYYY-MM-DD (ej: si dice 14-08-2026, poner "2026-08-14")
7. Tasa de cambio reflejada en el documento si existe ("exchangeRateOnInvoice"), o null si no aparece
8. Concepto o resumen breve de productos ("concept") (ej: "Compra según factura de víveres y mercancía")

Responde ÚNICAMENTE con un objeto JSON válido con este formato:
{
  "supplierName": "DISTRIBUIDORA SOL DE UCHIRE C.A",
  "supplierRif": "J-412945874",
  "referenceNumber": "00044831",
  "totalAmount": 302515.47,
  "currency": "BS",
  "date": "2026-08-14",
  "exchangeRateOnInvoice": null,
  "concept": "Compra según factura fiscal"
}`;

        const contents = [
            prompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: mime
                }
            }
        ];

        const modelsToTry = [
            'gemini-3.1-flash-lite',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.6-flash',
            'gemini-flash-lite-latest',
            'gemini-3.7-flash',
            'gemini-3.5-flash',
            'gemini-3.8-flash'
        ];
        let rawText = '';
        for (const modelName of modelsToTry) {
            try {
                const m = aiService.genAI.getGenerativeModel({ model: modelName });
                const result = await m.generateContent(contents);
                rawText = result.response.text();
                if (rawText) {
                    console.log(`[ISAAC AI] Metadata extraction successful with model: ${modelName}`);
                    break;
                }
            } catch (e) {
                console.warn(`[ISAAC AI] Model ${modelName} extraction warning:`, e.message);
            }
        }

        if (!rawText) {
            throw new Error('No se pudo obtener respuesta del motor de reconocimiento.');
        }

        const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const extracted = JSON.parse(cleanJson);

        let matchedSupplier = null;
        if (extracted.supplierRif) {
            const cleanRif = extracted.supplierRif.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const allSuppliers = await Supplier.findAll({ where: { companyId } });
            matchedSupplier = allSuppliers.find((s) => {
                const sRif = (s.rif || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                return sRif && cleanRif && (sRif.includes(cleanRif) || cleanRif.includes(sRif));
            });
        }

        if (!matchedSupplier && extracted.supplierName) {
            const cleanName = extracted.supplierName.toLowerCase().trim();
            const allSuppliers = await Supplier.findAll({ where: { companyId } });
            matchedSupplier = allSuppliers.find((s) => {
                const sName = (s.name || '').toLowerCase().trim();
                return sName && (sName.includes(cleanName) || cleanName.includes(sName));
            });
        }

        let bcvRate = Number(aiService.getSettings()?.exchangeRate) || 1;
        let bcvSource = 'Sistema';
        try {
            const bcvResult = await BCVRateService.getOfficialRate(extracted.date);
            if (bcvResult && bcvResult.rate > 0) {
                bcvRate = bcvResult.rate;
                bcvSource = bcvResult.source;
            }
        } catch (rateErr) {
            console.warn('[ISAAC AI] Fallback a tasa activa:', rateErr.message);
        }

        const appliedRate = extracted.exchangeRateOnInvoice && extracted.exchangeRateOnInvoice > 0
            ? Number(extracted.exchangeRateOnInvoice)
            : bcvRate;

        const rawAmount = parseFloat(extracted.totalAmount) || 0;
        const currency = (extracted.currency || 'USD').toUpperCase();

        let totalUsd = rawAmount;
        let totalVes = rawAmount * appliedRate;

        if (currency === 'BS') {
            totalUsd = appliedRate > 0 ? (rawAmount / appliedRate) : rawAmount;
            totalVes = rawAmount;
        }

        return {
            supplierName: extracted.supplierName || '',
            supplierRif: extracted.supplierRif || '',
            referenceNumber: extracted.referenceNumber || '',
            rawTotalAmount: rawAmount,
            currency,
            totalUsd: Number(totalUsd.toFixed(2)),
            totalVes: Number(totalVes.toFixed(2)),
            date: extracted.date || new Date().toISOString().split('T')[0],
            bcvRate: Number(bcvRate.toFixed(4)),
            appliedRate: Number(appliedRate.toFixed(4)),
            bcvSource,
            concept: extracted.concept || `Compra según factura ${extracted.referenceNumber || ''}`,
            matchedSupplierId: matchedSupplier ? matchedSupplier.id : null,
            matchedSupplierName: matchedSupplier ? matchedSupplier.name : null
        };
    } catch (err) {
        console.error('[ISAAC AI] Error extrayendo metadatos de factura:', err);
        throw err;
    }
}

async function reconcilePurchaseOrderWithInvoice(aiService, buffer, currentOrderItems = []) {
    if (!aiService.initialized) aiService.init();
    if (!aiService.initialized) {
        throw new Error('El servicio de Visión por IA no está configurado (Falta GOOGLE_API_KEY).');
    }

    try {
        const mime = detectMimeType(buffer, 'image/jpeg');
        const itemsContext = currentOrderItems.map((i) => ({
            productId: i.productId,
            name: i.name,
            barcode: i.barcode || '',
            quantityOrdered: i.quantityOrdered || i.quantity || 1,
            unitsPerBulk: i.unitsPerBulk || 1,
            bulkUnitName: i.bulkUnitName || 'Bulto'
        }));

        const prompt = `Eres el Auditor Fiscal y Gerente de Compras Inteligente de Isaac POS.
Analiza detenidamente esta FACTURA FÍSICA / NOTA DE ENTREGA / COMPROBANTE DE COMPRA de un proveedor.

TAREA CRÍTICA:
1. Extrae los datos fiscales generales:
   - "invoiceNumber": Número de Factura o Control (ej: "0151892", "00044831", etc.).
   - "invoiceDate": Fecha de emisión (YYYY-MM-DD).
   - "supplierName": Razón Social del proveedor.
   - "supplierRif": RIF del proveedor.
   - "bcvRate": Tasa oficial de cambio BCV indicada en el pie de la factura (número flotante, ej: 787.5196). Si no tiene, null.
   - "currency": Moneda de la tabla de precios ("BS" o "USD").
   - "hasTax": True si aplica IVA (ej: 16%), False si es 0%.
   - "taxRate": Porcentaje de IVA (ej: 16).
   - "subtotalBs": Base imponible en Bolívares.
   - "taxAmountBs": Monto del IVA en Bolívares.
   - "totalBs": Monto total de la factura en Bolívares (ej: 68325.16).
   - "totalUsd": Monto total de la factura en Dólares (si viene explícito en la factura, ej: 86.76; o calculado como totalBs / bcvRate).

2. Extrae todas las líneas de productos facturados en la tabla:
   - "code": Código del artículo (ej: "222", "223", "250", "92", "101", "1055").
   - "description": Nombre o descripción comercial (ej: "COCA COLA 2 LTS (6 UND)", "AGUA NEVADA PET-1.5 LTS (06 UNID)").
   - "quantityBultos": Cantidad de bultos/cajas facturados (ej: 3, 5, 1, 2, 1, 1).
   - "unitsPerBulk": Cantidad de unidades individuales que contiene cada bulto/paquete/caja (ej: 6, 12, 16, 24).
   - "totalUnits": quantityBultos * unitsPerBulk (ej: 3 * 6 = 18).
   - "pricePerBulk": Precio unitario por bulto/paquete en la tabla de la factura (sin IVA o con IVA según la tabla).
   - "isExempt": True si dice (E) o Exento, False si es gravable (ej: gaseosas/jugos llevan 16% de IVA).

3. CONCILIACIÓN CON LA LISTA DE PRODUCTOS DE LA ORDEN DEL SISTEMA:
Esta es la lista de productos que el usuario esperaba recibir en su orden:
${JSON.stringify(itemsContext, null, 2)}

Para CADA producto de la orden del sistema:
- Determina si APARECE en la factura física (por coincidencia de nombre o código).
- SI APARECE EN LA FACTURA (Llegó):
  - "isReceived": true
  - "receivedQuantity": Cantidad total de unidades que llegaron (totalUnits).
  - "unitsPerBulk": Cantidad de unidades por bulto según la factura (ej: 6, 16, 24).
  - "bulkCostUsd": Costo en DÓLARES por Bulto/Caja CON IVA INCLUIDO.
    * Si la factura está en Bolívares: (pricePerBulk * (isExempt ? 1 : 1 + (taxRate / 100))) / bcvRate
    * Si la factura está en Dólares: pricePerBulk * (isExempt ? 1 : 1 + (taxRate / 100))
  - "unitCostUsd": bulkCostUsd / unitsPerBulk (costo por unidad individual en USD).
- SI NO APARECE EN LA FACTURA (NO llegó / no fue despachado por el proveedor):
  - "isReceived": false
  - "receivedQuantity": 0
  - "reason": "No despachado por el proveedor en esta factura"

RESPONDE ESTRICTAMENTE EN FORMATO JSON (SIN TEXTO EXTRA):
{
  "invoiceNumber": "0151892",
  "invoiceDate": "2026-08-26",
  "supplierName": "GASEOSAS DE VENEZUELA, C.A.",
  "supplierRif": "J-40816407-8",
  "bcvRate": 787.5196,
  "currency": "BS",
  "hasTax": true,
  "taxRate": 16,
  "subtotalBs": 58901.00,
  "taxAmountBs": 9424.16,
  "totalBs": 68325.16,
  "totalUsd": 86.76,
  "matchedProducts": [
    {
      "productId": "id_del_producto",
      "matchedDescription": "COCA COLA 2 LTS (6 UND)",
      "isReceived": true,
      "quantityBultos": 3,
      "unitsPerBulk": 6,
      "receivedQuantity": 18,
      "bulkCostUsd": 8.01,
      "unitCostUsd": 1.335,
      "isExempt": false
    }
  ],
  "unmatchedProducts": [
    {
      "productId": "id_del_producto_que_no_llego",
      "isReceived": false,
      "receivedQuantity": 0,
      "reason": "No despachado en la factura"
    }
  ]
}`;

        const contents = [
            prompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: mime
                }
            }
        ];

        const modelsToTry = [
            'gemini-3.1-flash-lite',
            'gemini-3.5-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.6-flash',
            'gemini-flash-lite-latest',
            'gemini-3.7-flash',
            'gemini-3.5-flash',
            'gemini-3.8-flash'
        ];
        let rawText = '';
        for (const modelName of modelsToTry) {
            try {
                const m = aiService.genAI.getGenerativeModel({ model: modelName });
                const result = await m.generateContent(contents);
                rawText = result.response.text();
                if (rawText) {
                    console.log(`[ISAAC AI] Reconcile successfully completed with model: ${modelName}`);
                    break;
                }
            } catch (e) {
                console.warn(`[ISAAC AI] Reconcile model ${modelName} warning:`, e.message);
            }
        }

        let extracted = null;
        if (rawText) {
            try {
                const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
                extracted = JSON.parse(cleanJson);
            } catch (e) {
                console.warn('[ISAAC AI] Error parseando JSON de Gemini:', e.message);
            }
        }

        if (!extracted) {
            throw new Error('No fue posible extraer ni conciliar los datos de la factura con IA en este momento. Verifique la legibilidad del documento o su clave GEMINI_API_KEY e intente nuevamente.');
        }

        let appliedRate = extracted.bcvRate && extracted.bcvRate > 0 ? extracted.bcvRate : null;
        if (!appliedRate) {
            try {
                const bcvRes = await BCVRateService.getOfficialRate(extracted.invoiceDate);
                if (bcvRes?.rate > 0) appliedRate = bcvRes.rate;
            } catch (e) {
                console.warn('[ISAAC AI] Fallback a tasa local en conciliación:', e.message);
            }
        }
        if (!appliedRate) appliedRate = Number(aiService.getSettings()?.exchangeRate) || 1;

        const reconciledItems = currentOrderItems.map((originalItem) => {
            const matched = (extracted.matchedProducts || []).find((m) => String(m.productId) === String(originalItem.productId));
            const unmatched = (extracted.unmatchedProducts || []).find((u) => String(u.productId) === String(originalItem.productId));

            if (matched && matched.isReceived !== false) {
                const unitsPerBulk = Math.max(1, Number(matched.unitsPerBulk || originalItem.unitsPerBulk || 1));
                const rawBulkCost = Number(matched.bulkCostUsd || (matched.unitCostUsd * unitsPerBulk) || 0);
                const bulkCost = Number((isNaN(rawBulkCost) ? 0 : rawBulkCost).toFixed(2));
                const rawUnitCost = Number(matched.unitCostUsd || (bulkCost / unitsPerBulk) || 0);
                const unitCost = Number((isNaN(rawUnitCost) ? 0 : rawUnitCost).toFixed(2));
                const receivedQty = Number(matched.receivedQuantity || (matched.quantityBultos * unitsPerBulk) || originalItem.quantityOrdered || 1);

                const margin = Number(originalItem.margin || 30);
                let sellPrice = Number(originalItem.price || 0);
                if (unitCost > 0) {
                    sellPrice = Number((unitCost * (1 + margin / 100)).toFixed(2));
                }

                const itemIsExempt = matched.isExempt === true || !extracted.hasTax || Number(extracted.taxRate) === 0;
                const resolvedTaxStatus = itemIsExempt ? 'exento' : 'gravable';

                return {
                    ...originalItem,
                    isReceived: true,
                    receivedQuantity: receivedQty,
                    unitsPerBulk,
                    bulkCost,
                    cost: unitCost,
                    margin,
                    price: sellPrice,
                    matchedDescription: matched.matchedDescription || originalItem.name,
                    isExempt: itemIsExempt,
                    taxStatus: resolvedTaxStatus
                };
            }

            if (unmatched || (matched && matched.isReceived === false)) {
                return {
                    ...originalItem,
                    isReceived: false,
                    receivedQuantity: 0,
                    unreceivedReason: unmatched?.reason || 'No despachado en la factura'
                };
            }

            return {
                ...originalItem,
                isReceived: false,
                receivedQuantity: 0,
                unreceivedReason: 'No presente en la factura física'
            };
        });

        const matchedCount = reconciledItems.filter((i) => i.isReceived).length;
        const unreceivedCount = reconciledItems.filter((i) => !i.isReceived).length;

        return {
            success: true,
            invoiceNumber: extracted.invoiceNumber || '',
            invoiceDate: extracted.invoiceDate || '',
            supplierName: extracted.supplierName || '',
            supplierRif: extracted.supplierRif || '',
            bcvRate: Number(appliedRate.toFixed(4)),
            currency: extracted.currency || 'BS',
            hasTax: Boolean(extracted.hasTax),
            taxRate: Number(extracted.taxRate || 16),
            subtotalBs: Number((extracted.subtotalBs || 0).toFixed(2)),
            taxAmountBs: Number((extracted.taxAmountBs || 0).toFixed(2)),
            totalBs: Number((extracted.totalBs || 0).toFixed(2)),
            totalUsd: Number((extracted.totalUsd || 0).toFixed(2)),
            reconciledItems,
            matchedCount,
            unreceivedCount,
            summary: `Factura Nº ${extracted.invoiceNumber || 'S/N'} conciliada: ${matchedCount} productos confirmados con IVA (${extracted.taxRate || 16}%), ${unreceivedCount} desmarcados (no llegaron). Total: $${(extracted.totalUsd || 0).toFixed(2)} USD (Bs. ${(extracted.totalBs || 0).toLocaleString('es-VE')}).`
        };
    } catch (err) {
        console.error('[ISAAC AI] Error conciliando orden con factura:', err);
        throw err;
    }
}

module.exports = {
    parseSmartInvoiceNumber,
    generateProductImagePrompt,
    generateProductSearchQuery,
    generateBarcodeSearchQuery,
    estimateBarcode,
    analyzeInvoicePDF,
    extractSupplierInvoiceMetadata,
    reconcilePurchaseOrderWithInvoice
};
