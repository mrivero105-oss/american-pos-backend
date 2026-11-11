/**
 * Normalizador y optimizador universal de imágenes para catálogo de productos.
 * Estandariza cualquier imagen a una proporción 1:1 cuadrada uniforme (500x500 px)
 * con fondo blanco limpio de estudio, garantizando alineación visual perfecta en el POS.
 */
export async function normalizeProductImage(fileOrBase64, options = {}) {
    const {
        size = 500,               // Resolución cuadrada estándar 500x500 px
        quality = 0.88,            // Calidad óptima (peso < 50 KB)
        mode = 'contain',          // 'contain' (centrado con margen) o 'cover' (recorte centrado)
        backgroundColor = '#ffffff'
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

                // 3. Exportar como JPEG estándar
                const standardizedBase64 = canvas.toDataURL('image/jpeg', quality);
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
