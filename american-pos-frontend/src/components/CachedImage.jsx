import { useState, useEffect, useRef, memo } from 'react';
import { Package } from 'lucide-react';
import {
    getCachedImage,
    getMemoryCachedImage,
    queueBackgroundCacheImage
} from '../services/imageCache';
import { getImageCandidateUrls } from '../utils/imageUtils';

/**
 * CachedImage React Component
 * Renderizador offline-first de alta velocidad:
 * - L1 síncrono (0 ms) desde memoria.
 * - L2 Cache-First desde SQLite Nativo Android WAL / IndexedDB / CacheStorage (~1-3 ms),
 *   evitando esperas por timeout TCP cuando la PC está apagada aunque el Wi-Fi siga conectado.
 * - Cuando carga desde red online, persiste automáticamente la imagen en segundo plano
 *   y soporta fallback entre URLs candidatas (Nube / Servidor PC LAN).
 */
export const CachedImage = memo(function CachedImage({
    src,
    alt = '',
    className = '',
    fallback = null,
    loading = 'lazy',
    ...props
}) {
    const candidatesRef = useRef([]);
    const candidateIdxRef = useRef(0);

    const [imageSrc, setImageSrc] = useState(() => {
        if (!src || typeof src !== 'string') return null;
        if (src.startsWith('data:') || src.startsWith('blob:')) return src;
        const mem = getMemoryCachedImage(src);
        if (mem) return mem;
        return null;
    });
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        let active = true;
        setHasError(false);
        candidatesRef.current = [];
        candidateIdxRef.current = 0;

        if (!src || typeof src !== 'string') {
            setImageSrc(null);
            return () => { active = false; };
        }

        if (src.startsWith('data:') || src.startsWith('blob:')) {
            setImageSrc(src);
            return () => { active = false; };
        }

        const mem = getMemoryCachedImage(src);
        if (mem) {
            setImageSrc(mem);
            return () => { active = false; };
        }

        const candidates = getImageCandidateUrls(src);
        candidatesRef.current = candidates;

        // Consultar caché local persistente primero (SQLite WAL / CacheStorage)
        // Garantiza visualización instantánea con PC apagada aunque navigator.onLine sea true
        getCachedImage(src)
            .then((cached) => {
                if (!active) return;
                if (cached) {
                    setImageSrc(cached);
                    return;
                }
                const firstRemote = candidates[0] || null;
                if (firstRemote) {
                    candidateIdxRef.current = 0;
                    setImageSrc(firstRemote);
                    // Guardar automáticamente en SQLite / CacheStorage para futuros usos offline
                    queueBackgroundCacheImage(src);
                } else {
                    setHasError(true);
                    setImageSrc(null);
                }
            })
            .catch(() => {
                if (!active) return;
                const firstRemote = candidates[0] || null;
                if (firstRemote) {
                    candidateIdxRef.current = 0;
                    setImageSrc(firstRemote);
                } else {
                    setHasError(true);
                    setImageSrc(null);
                }
            });

        return () => {
            active = false;
        };
    }, [src]);

    const handleError = () => {
        if (!src || typeof src !== 'string') {
            setHasError(true);
            setImageSrc(null);
            return;
        }

        // 1. Si hay otra URL candidata (ej. falló Supabase -> probar PC LAN o viceversa), intentarla
        const nextIdx = candidateIdxRef.current + 1;
        if (nextIdx < candidatesRef.current.length) {
            candidateIdxRef.current = nextIdx;
            const nextUrl = candidatesRef.current[nextIdx];
            if (nextUrl && nextUrl !== imageSrc) {
                setImageSrc(nextUrl);
                return;
            }
        }

        // 2. Último intento contra caché local si aún no se probó el recurso actual
        if (!hasError && !src.startsWith('data:') && !String(imageSrc || '').startsWith('data:')) {
            getCachedImage(src)
                .then((cached) => {
                    if (cached && cached !== imageSrc) {
                        setImageSrc(cached);
                    } else {
                        setHasError(true);
                        setImageSrc(null);
                    }
                })
                .catch(() => {
                    setHasError(true);
                    setImageSrc(null);
                });
            return;
        }

        setHasError(true);
        setImageSrc(null);
    };

    if (!src || hasError) {
        if (fallback) return fallback;
        return (
            <div className={`flex items-center justify-center text-slate-300 dark:text-slate-600 ${className}`}>
                <Package size={28} strokeWidth={1.5} className="opacity-40" />
            </div>
        );
    }

    if (!imageSrc) {
        // Estado breve mientras resuelve SQLite local (~1-2 ms): evitar renderizar fallback prematuro
        return (
            <div className={`flex items-center justify-center ${className}`} aria-hidden="true" />
        );
    }

    return (
        <img
            src={imageSrc}
            alt={alt}
            loading={loading}
            decoding="async"
            onError={handleError}
            className={className}
            {...props}
        />
    );
});

export default CachedImage;
