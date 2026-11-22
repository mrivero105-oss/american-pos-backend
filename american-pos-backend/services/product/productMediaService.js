const fs = require('fs');
const path = require('path');
const { Product } = require('../../database/models');

let AIServiceRef = null;
const getAIService = () => (AIServiceRef || (AIServiceRef = require('../AIService')));
let ImageSearchServiceRef = null;
const getImageSearchService = () => (ImageSearchServiceRef || (ImageSearchServiceRef = require('../ImageSearchService')));
let BarcodeSearchServiceRef = null;
const getBarcodeSearchService = () => (BarcodeSearchServiceRef || (BarcodeSearchServiceRef = require('../BarcodeSearchService')));

/**
 * Persiste una imagen de producto en todas las rutas activas y dispara réplica a Supabase Storage.
 * @param {string} filename
 * @param {Buffer} buffer
 * @returns {string} URI pública local
 */
function saveAndReplicateProductImage(filename, buffer) {
    const candidates = [
        path.join(__dirname, '..', '..', 'product_images'),
        process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', 'product_images') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'american-pos-backend', 'product_images') : null
    ].filter(Boolean);

    const uniqueDirs = [...new Set(candidates)];
    uniqueDirs.forEach((dir) => {
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, filename), buffer);
        } catch (e) {
            console.warn(`[IMAGE SAVE] Error guardando copia en ${dir}:`, e.message);
        }
    });

    try {
        const { uploadProductImageToSupabase } = require('../CloudStorageService');
        uploadProductImageToSupabase(filename, buffer);
    } catch (e) {
        console.warn('[IMAGE SAVE] No se pudo invocar CloudStorageService:', e.message);
    }

    return `/product_images/${filename}`;
}

async function generateImageIA(productId) {
    try {
        const product = await Product.findByPk(productId);
        if (!product) throw new Error('Producto no encontrado');

        console.log(`[IA IMAGE] Buscando imagen real para: ${product.name}`);

        const searchQuery = await getAIService().generateProductSearchQuery(product.name, product.category);
        const imageUrls = await getImageSearchService().findProductImageUrl(searchQuery);

        if (!imageUrls || imageUrls.length === 0) {
            throw new Error('No se encontró ninguna imagen válida en la búsqueda');
        }

        let buffer = null;
        for (const imageUrl of imageUrls) {
            try {
                console.log(`[IA IMAGE] Intentando descargar imagen desde: ${imageUrl}`);
                const response = await fetch(imageUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                    }
                });

                if (response.ok) {
                    const contentType = response.headers.get('content-type') || '';
                    if (!contentType.toLowerCase().startsWith('image/')) {
                        console.warn(`[IA IMAGE] URL devolvió un tipo no válido (${contentType}), omitiendo: ${imageUrl}`);
                        continue;
                    }
                    const arrayBuffer = await response.arrayBuffer();
                    buffer = Buffer.from(arrayBuffer);
                    break;
                } else {
                    console.warn(`[IA IMAGE] Error ${response.status} al descargar: ${imageUrl}`);
                }
            } catch (err) {
                console.warn(`[IA IMAGE] Excepción al descargar ${imageUrl}:`, err.message);
            }
        }

        if (!buffer) {
            throw new Error('Las restricciones del servidor (ej. Error 403) bloquearon la descarga de todas las imágenes candidatas.');
        }

        const filename = `ai_product_${productId}_${Date.now()}.jpg`;
        const imageUri = saveAndReplicateProductImage(filename, buffer);
        await product.update({ imageUri, imageUrl: null });

        return { imageUri };
    } catch (error) {
        console.error('[IA IMAGE] Error fatal:', error.message);
        throw new Error('No se pudo generar la imagen con la IA: ' + error.message);
    }
}

async function searchImagesIA(productId, fallbackName = '', fallbackCategory = '') {
    try {
        let name = (fallbackName || '').trim();
        let category = (fallbackCategory || '').trim();

        if (productId && productId !== 'new' && !productId.toString().startsWith('local-')) {
            const product = await Product.findByPk(productId);
            if (product) {
                name = name || product.name;
                category = category || product.category;
            }
        }

        if (!name) {
            throw new Error('Ingresa el nombre del producto primero para buscar su imagen con IA');
        }

        console.log(`[IA IMAGE] Buscando imágenes candidatas para: "${name}" (${category || 'General'})`);

        let imageUrls = null;
        try {
            imageUrls = await getImageSearchService().findProductImageUrl(name);
        } catch (e) {
            console.warn('[IA IMAGE] Fallo búsqueda por nombre directo:', e.message);
        }

        if (!imageUrls || imageUrls.length === 0) {
            try {
                const searchQuery = await getAIService().generateProductSearchQuery(name, category);
                if (searchQuery && searchQuery !== name) {
                    console.log(`[IA IMAGE] Reintentando con query IA: "${searchQuery}"`);
                    imageUrls = await getImageSearchService().findProductImageUrl(searchQuery);
                }
            } catch (e) {
                console.warn('[IA IMAGE] Fallo búsqueda con query IA:', e.message);
            }
        }

        if (!imageUrls || imageUrls.length === 0) {
            const cleanName = name.replace(/lata|roja|azul|verde|paquete|caja|\b\d+(g|gr|kg|ml|l|oz)\b/gi, '').trim();
            if (cleanName && cleanName.length >= 3 && cleanName !== name) {
                console.log(`[IA IMAGE] Reintentando búsqueda simplificada: "${cleanName}"`);
                try {
                    imageUrls = await getImageSearchService().findProductImageUrl(cleanName);
                } catch (e) {
                    console.warn('[IA IMAGE] Fallo búsqueda simplificada:', e.message);
                }
            }
        }

        if (!imageUrls || imageUrls.length === 0) {
            throw new Error('No se encontraron imágenes candidatas para este producto en la web. Puedes subir una manualmente o colocar su URL.');
        }

        return { images: imageUrls };
    } catch (error) {
        console.error('[IA IMAGE SEARCH] Error:', error.message);
        throw new Error(error.message);
    }
}

async function downloadAndSetImage(productId, imageUrl) {
    try {
        let product = null;
        if (productId && productId !== 'new' && !productId.toString().startsWith('local-')) {
            product = await Product.findByPk(productId);
        }

        console.log(`[IA IMAGE] Intentando descargar imagen seleccionada desde: ${imageUrl}`);

        const axios = require('axios');
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            },
            timeout: 15000
        });

        const buffer = Buffer.from(response.data);
        const filename = `ai_product_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
        const imageUri = saveAndReplicateProductImage(filename, buffer);
        if (product) {
            await product.update({ imageUri, imageUrl: imageUri });
        }

        return { imageUri, imageUrl: imageUri };
    } catch (error) {
        console.error('[IA IMAGE DOWNLOAD] Error:', error.message);
        throw new Error('Fallo al descargar la imagen elegida: ' + error.message);
    }
}

async function updateBarcodeIA(productId) {
    try {
        const product = await Product.findByPk(productId);
        if (!product) throw new Error('Producto no encontrado');

        console.log(`[IA BARCODE] Buscando código para: ${product.name}`);

        const searchQuery = await getAIService().generateBarcodeSearchQuery(product.name, product.category);
        let barcode = await getBarcodeSearchService().findProductBarcode(searchQuery);

        if (!barcode) {
            console.log('[IA BARCODE] Búsqueda robótica falló. Intentando análisis visual e inferencia experta...');
            let imageData = null;
            if (product.imageUri) {
                try {
                    let userDataPath = process.env.USER_DATA_PATH;
                    if (!userDataPath && process.platform === 'win32') {
                        let appData = path.join(process.env.APPDATA || '', 'americanpos');
                        if (!fs.existsSync(appData)) appData = path.join(process.env.APPDATA || '', 'american-pos-backend');
                        if (fs.existsSync(appData)) userDataPath = appData;
                    }
                    const uploadDir = userDataPath
                        ? path.join(userDataPath, 'product_images')
                        : path.join(__dirname, '..', '..', 'product_images');
                    const filename = product.imageUri.split('/').pop();
                    const filePath = path.join(uploadDir, filename);

                    if (fs.existsSync(filePath)) {
                        const buffer = fs.readFileSync(filePath);
                        const extension = filename.split('.').pop().toLowerCase();
                        let mimeType = 'image/jpeg';
                        if (extension === 'png') mimeType = 'image/png';
                        if (extension === 'webp') mimeType = 'image/webp';
                        imageData = {
                            data: buffer.toString('base64'),
                            mimeType
                        };
                        console.log(`[IA BARCODE] Imagen cargada para análisis visual (${mimeType}).`);
                    }
                } catch (err) {
                    console.error('[IA BARCODE] Ignorando error al cargar imagen:', err.message);
                }
            }

            barcode = await getAIService().estimateBarcode(product.name, imageData);
        }

        if (!barcode) {
            throw new Error('No se encontró ningún código de barras válido en la búsqueda ni en la estimación');
        }

        console.log(`[IA BARCODE] Código encontrado/estimado: ${barcode}`);
        await product.update({ barcode });

        return { barcode };
    } catch (error) {
        console.error('[IA BARCODE] Error:', error.message);
        throw new Error('No se pudo encontrar el código de barras: ' + error.message);
    }
}

module.exports = {
    saveAndReplicateProductImage,
    generateImageIA,
    searchImagesIA,
    downloadAndSetImage,
    updateBarcodeIA
};
