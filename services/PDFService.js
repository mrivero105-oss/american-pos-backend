const fs = require('fs');
const AIService = require('./AIService');

/**
 * Servicio encargado de la extracción y procesamiento de datos desde PDFs de proveedores.
 */
class PDFService {
    /**
     * Extrae texto crudo de un PDF y lo convierte en una estructura de productos probable.
     * @param {string} filePath Ruta al archivo PDF.
     * @returns {Promise<Array>} Lista de objetos { name, price }.
     */
    static async parseCatalog(filePath) {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
        } catch (e) {
            throw new Error(`El archivo no se encontró en la ruta: ${filePath}`);
        }

        let dataBuffer = await fs.promises.readFile(filePath);

        try {
            const pdf = require('pdf-parse');

            // Custom page renderer to ensure spaces between columns
            function render_page(pageData) {
                return pageData.getTextContent().then(textContent => {
                    let lastY, text = '';
                    for (let item of textContent.items) {
                        if (lastY == item.transform[5] || !lastY) {
                            text += ' ' + item.str;
                        } else {
                            text += '\n' + item.str;
                        }
                        lastY = item.transform[5];
                    }
                    return text;
                });
            }

            const result = await pdf(dataBuffer, { pagerender: render_page });
            
            if (!result || !result.text) return this._fallbackToAI(dataBuffer);

            const extractedItems = [];
            const lines = result.text.split('\n');
            
            console.log(`[PDF] Procesando ${lines.length} líneas con motor de precisión...`);

            // Common units as anchors
            const units = ['CAJA', 'UND', 'BULT', 'BULTO', 'PAQ', 'PAC', 'KILO', 'KG', 'UNI', 'DIS', 'DS', 'LAT', 'LITRO', 'BT'];
            const unitRegex = new RegExp(`\\s(${units.join('|')})\\s`, 'i');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.length < 5) continue;

                // --- STRATEGY 1: ANCHOR-BASED PARSING ---
                const unitMatch = line.match(unitRegex);
                if (unitMatch) {
                    try {
                        const unitIndex = unitMatch.index;
                        const afterUnit = line.substring(unitIndex + unitMatch[0].length).trim();
                        // Find the FIRST decimal number after the unit
                        const priceMatch = afterUnit.match(/(\d+[.,]\d{2})/);
                        const beforeUnit = line.substring(0, unitIndex).trim();
                        // Extract name ignoring leading codes
                        const nameMatch = beforeUnit.match(/^([A-Z0-9-]+\s+)?(.+)/i);
                        const name = nameMatch ? nameMatch[2].trim() : beforeUnit;

                        if (priceMatch && name.length > 2) {
                            const price = parseFloat(priceMatch[1].replace(',', '.'));
                            let suggestedQuantity = 1;
                            const sqMatch = name.match(/x\s*(\d+)/i);
                            if (sqMatch) suggestedQuantity = parseInt(sqMatch[1]);

                            extractedItems.push({
                                externalName: name.substring(0, 100),
                                price: price,
                                suggestedQuantity: suggestedQuantity || 1
                            });
                            continue;
                        }
                    } catch (e) {}
                }

                // --- STRATEGY 2: UNIVERSAL DECIMAL DETECTION ---
                // We strictly look for the LAST decimal number on the line, 
                // as wholesale lists almost always put the unit price there.
                const numbers = line.match(/\d+[.,]\d{2}/g);
                if (numbers && numbers.length >= 1) {
                    // Precision improvement: Pick the very last decimal found
                    const priceStr = numbers[numbers.length - 1];
                    const price = parseFloat(priceStr.replace(',', '.'));
                    
                    if (!isNaN(price) && price > 0) {
                        const parts = line.split(priceStr);
                        const namePart = parts[0].trim();
                        // Remove common leading codes and excess numbers
                        const nameClean = namePart.replace(/^[A-Z0-9-]+\s+/, '').replace(/\s+\d+$/, '').trim();

                        if (nameClean.length > 3) {
                            extractedItems.push({
                                externalName: nameClean.substring(0, 100),
                                price: price,
                                suggestedQuantity: 1
                            });
                        }
                    }
                }
            }

            // CRITICAL: If extraction yielded nothing or very little, use AI Vision
            if (extractedItems.length < 2) {
                console.log(`[PDF] Extracción de texto insuficiente (${extractedItems.length} items). Activando Visión Artificial...`);
                return await this._fallbackToAI(dataBuffer);
            }

            console.log(`[PDF] Extracción exitosa via reglas de precisión: ${extractedItems.length} items encontrados`);
            return extractedItems;
        } catch (error) {
            console.error('CRITICAL PDF PARSE ERROR:', error);
            try {
                return await this._fallbackToAI(dataBuffer);
            } catch (aiError) {
                throw new Error(`Fallo técnico al leer el PDF: ${error.message}`);
            }
        } finally {
            dataBuffer = null;
        }
    }

    /**
     * Fallback para PDFs que son imágenes o tienen formatos imposibles de parsear por reglas.
     */
    static async _fallbackToAI(buffer) {
        try {
            const aiResults = await AIService.analyzeInvoicePDF(buffer);
            return aiResults;
        } catch (error) {
            console.error("[PDF] Fallo en fallback de IA:", error.message);
            throw error;
        }
    }
}

module.exports = PDFService;
