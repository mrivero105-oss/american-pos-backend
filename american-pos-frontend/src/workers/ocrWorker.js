/**
 * ocrWorker.js - Isaac POS
 * Hilo secundario para reconocimiento y análisis de Lotes y Fechas de Vencimiento.
 * Soporta:
 * 1. Estándar GS1 (DataMatrix / Code 128) con Application Identifiers (AI):
 *    - AI (10): Número de Lote / Batch
 *    - AI (17): Fecha de Vencimiento (YYMMDD)
 * 2. Texto Natural OCR con soporte numérico y nombres de mes (DIC 2027, NOV/26, etc.).
 * Cero dependencias pesadas (ejecución pura < 2 ms, evita Tesseract de 30 MB).
 */

self.onmessage = (e) => {
    const { type, text } = e.data;

    if (type === 'PARSE_TEXT') {
        if (!text || typeof text !== 'string') {
            self.postMessage({ type: 'PARSE_RESULT', success: false });
            return;
        }

        const raw = text.trim();
        const cleanText = raw.toUpperCase().replace(/\r\n/g, ' ').replace(/\n/g, ' ');

        let batchNumber = '';
        let expirationDate = '';

        // ==========================================
        // 1. ANÁLISIS DE CÓDIGOS GS1 (DataMatrix / GS1-128)
        // ==========================================
        
        // Vía 1A: GS1 con paréntesis legibles: (10)LOTE... y/o (17)YYMMDD
        const gs1ParenLot = cleanText.match(/\(10\)\s*([A-Z0-9\-_]{2,20})/i);
        if (gs1ParenLot && gs1ParenLot[1]) {
            batchNumber = gs1ParenLot[1].trim();
        }

        const gs1ParenExp = cleanText.match(/\(17\)\s*(\d{6})/);
        if (gs1ParenExp && gs1ParenExp[1]) {
            const yymmdd = gs1ParenExp[1];
            const year = '20' + yymmdd.substring(0, 2);
            const month = yymmdd.substring(2, 4);
            let day = yymmdd.substring(4, 6);
            if (day === '00') {
                const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
                day = String(lastDay).padStart(2, '0');
            }
            expirationDate = `${year}-${month}-${day}`;
        }

        // Vía 1B: GS1 en bruto sin paréntesis (ej: 01077020000000001726123110ABC123)
        if (!expirationDate) {
            const gs1RawExp = cleanText.match(/(?:^|\D)17(\d{2}(?:0[1-9]|1[0-2])(?:[0-2][0-9]|3[0-1]|00))/);
            if (gs1RawExp && gs1RawExp[1]) {
                const yymmdd = gs1RawExp[1];
                const year = '20' + yymmdd.substring(0, 2);
                const month = yymmdd.substring(2, 4);
                let day = yymmdd.substring(4, 6);
                if (day === '00') {
                    const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
                    day = String(lastDay).padStart(2, '0');
                }
                expirationDate = `${year}-${month}-${day}`;
            }
        }

        if (!batchNumber) {
            const gs1Normalized = cleanText.split(String.fromCharCode(29)).join(' ');
            const gs1RawLot = gs1Normalized.match(/(?:^|\D)10([A-Z0-9_-]{3,20})(?:\s|$)/i);
            if (gs1RawLot && gs1RawLot[1]) {
                batchNumber = gs1RawLot[1].trim();
            }
        }

        // ==========================================
        // 2. ANÁLISIS DE TEXTO NATURAL (OCR CONVENCIONAL)
        // ==========================================

        // Extraer Lote por etiquetas si aún no se ha obtenido
        if (!batchNumber) {
            // Ej: LOTE: A1234, LOT 9876-B, LT 4567, BATCH: ABC12, B/N: 7890, N° LOTE: 1234, L: 241005, B.NO 1234
            const lotRegex = /\b(?:LOTE|LOT|LT|BATCH|B\/N|N[°O.]*\s*LOTE|B\.NO|L[.:-])[\s:._#-]*([A-Z0-9_-]{2,20})/i;
            const lotMatch = cleanText.match(lotRegex);
            if (lotMatch && lotMatch[1]) {
                batchNumber = lotMatch[1].trim();
            }
        }

        // Extraer Fecha de Vencimiento si aún no se ha obtenido
        if (!expirationDate) {
            let rawDate = '';
            // Vía 2A: Etiquetas comunes con fecha numérica: VENC: 12/26, EXP: 10/2027, VTO: 05-2025, F.V: 11/28, V: 12/26, EXP. 10/26
            const expRegex = /\b(?:VENC(?:IMIENTO)?|VENCE|EXP(?:IRATION)?|VTO|F\.?\s*VTO?|CAD(?:UCIDAD)?|VALID(?:EZ)?|V[.:-])[\s:._#-]*([0-9]{1,2}[/.-][0-9]{2,4}|[0-9]{4}[/.-][0-9]{1,2}[/.-][0-9]{1,2})/i;
            const expMatch = cleanText.match(expRegex);

            if (expMatch && expMatch[1]) {
                rawDate = expMatch[1].trim();
            } else {
                // Vía 2B: Nombre de mes (ej: DIC 2027, NOV/26, MAY 2028, ENE-25)
                const monthNamesRegex = /\b(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|JAN|APR|AUG|DEC)[\s/._-]*([2-3][0-9]{3}|[2-3][0-9])\b/i;
                const monthMatch = cleanText.match(monthNamesRegex);
                if (monthMatch && monthMatch[1] && monthMatch[2]) {
                    const mStr = monthMatch[1].toUpperCase();
                    const monthMap = { 
                        ENE: '01', JAN: '01', FEB: '02', MAR: '03', ABR: '04', APR: '04', 
                        MAY: '05', JUN: '06', JUL: '07', AGO: '08', AUG: '08', SEP: '09', 
                        OCT: '10', NOV: '11', DIC: '12', DEC: '12' 
                    };
                    const month = monthMap[mStr] || '12';
                    let year = monthMatch[2];
                    if (year.length === 2) year = '20' + year;
                    const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
                    expirationDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
                } else {
                    // Vía 2C: Buscar patrón de fecha aislado de tipo MM/AA o MM/AAAA
                    const isolatedDateRegex = /\b(0[1-9]|1[0-2])[/.-](20[2-3][0-9]|[2-3][0-9])\b/;
                    const isoMatch = cleanText.match(isolatedDateRegex);
                    if (isoMatch) {
                        rawDate = isoMatch[0].trim();
                    }
                }
            }

            // Normalizar fecha a formato YYYY-MM-DD si se obtuvo numéricamente
            if (rawDate && !expirationDate) {
                const parts = rawDate.split(/[/.-]/);
                if (parts.length === 2) {
                    const month = parts[0].padStart(2, '0');
                    let year = parts[1];
                    if (year.length === 2) year = '20' + year;
                    const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
                    expirationDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
                } else if (parts.length === 3) {
                    let day, month, year;
                    if (parts[0].length === 4) {
                        // YYYY-MM-DD
                        year = parts[0];
                        month = parts[1].padStart(2, '0');
                        day = parts[2].padStart(2, '0');
                    } else {
                        // DD-MM-YYYY / DD-MM-YY
                        day = parts[0].padStart(2, '0');
                        month = parts[1].padStart(2, '0');
                        year = parts[2];
                        if (year.length === 2) year = '20' + year;
                    }
                    expirationDate = `${year}-${month}-${day}`;
                }
            }
        }

        const success = Boolean(batchNumber || expirationDate);

        self.postMessage({
            type: 'PARSE_RESULT',
            success,
            data: {
                batchNumber,
                expirationDate,
                rawDetected: cleanText.slice(0, 100)
            },
            raw: cleanText.slice(0, 100)
        });
    }
};
