let cachedWebPSupport = null;

/**
 * Detecta una única vez si el motor Canvas del navegador/WebView soporta codificación WebP.
 */
export function supportsWebP() {
    if (cachedWebPSupport !== null) return cachedWebPSupport;
    try {
        if (typeof document === 'undefined') {
            cachedWebPSupport = false;
            return false;
        }
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const dataUrl = probe.toDataURL('image/webp');
        cachedWebPSupport = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/webp');
    } catch {
        cachedWebPSupport = false;
    }
    return cachedWebPSupport;
}

/**
 * Normalizador y optimizador universal de imágenes para catálogo de productos.
 * Estandariza cualquier imagen a una proporción 1:1 cuadrada uniforme (500x500 px)
 * con fondo blanco limpio de estudio y compresión WebP automática (fallback JPEG),
 * garantizando alineación visual perfecta y mínimo consumo de RAM/red en el POS.
 */
export async function normalizeProductImage(fileOrBase64, options = {}) {
    const {
        size = 500,               // Resolución cuadrada estándar 500x500 px
        quality = 0.85,           // Calidad óptima WebP/JPEG (peso típico < 35 KB)
        mode = 'contain',         // 'contain' (centrado con margen) o 'cover' (recorte centrado)
        backgroundColor = '#ffffff',
        format = 'auto'           // 'auto' (WebP si hay soporte, fallback JPEG), 'image/webp' o 'image/jpeg'
    } = options;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');

                // 1. Fondo blanco puro de estudio
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, 0, size, size);

                // 2. Renderizado con preservación de suavizado bicúbico
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                if (mode === 'cover') {
                    // Modo COVER: Llena el recuadro 1:1 recortando los excesos
                    const scale = Math.max(size / img.width, size / img.height);
                    const drawW = img.width * scale;
                    const drawH = img.height * scale;
                    const x = (size - drawW) / 2;
                    const y = (size - drawH) / 2;
                    ctx.drawImage(img, x, y, drawW, drawH);
                } else {
                    // Modo CONTAIN: Centra el producto completo con un 5% de margen estético
                    const margin = size * 0.05;
                    const available = size - (margin * 2);
                    const scale = Math.min(available / img.width, available / img.height);
                    const drawW = img.width * scale;
                    const drawH = img.height * scale;
                    const x = (size - drawW) / 2;
                    const y = (size - drawH) / 2;
                    ctx.drawImage(img, x, y, drawW, drawH);
                }

                // 3. Exportar como WebP cuando esté disponible (25-40% menor peso), con fallback seguro a JPEG
                const targetMime = format === 'auto'
                    ? (supportsWebP() ? 'image/webp' : 'image/jpeg')
                    : format;
                let standardizedBase64 = canvas.toDataURL(targetMime, quality);
                if (targetMime === 'image/webp' && !standardizedBase64.startsWith('data:image/webp')) {
                    standardizedBase64 = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(standardizedBase64);
            } catch (err) {
                console.error('[normalizeProductImage] Error en canvas:', err);
                reject(err);
            }
        };

        img.onerror = (err) => {
            console.error('[normalizeProductImage] Error cargando imagen para procesar:', err);
            reject(err);
        };

        if (typeof fileOrBase64 === 'string') {
            img.src = fileOrBase64;
        } else if (fileOrBase64 instanceof Blob || fileOrBase64 instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
            };
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(fileOrBase64);
        } else {
            reject(new Error('Tipo de archivo o imagen no válido'));
        }
    });
}
