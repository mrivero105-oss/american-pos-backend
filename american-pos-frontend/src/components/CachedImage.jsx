import React, { useState, useEffect, memo } from 'react';
import { Package } from 'lucide-react';
import { getCachedImage, getMemoryCachedImage } from '../services/imageCache';
import { getImageUrl } from '../utils/imageUtils';

/**
 * CachedImage React Component
 * Ultra-lightweight native hardware-accelerated image renderer:
 * - Zero main-thread / IndexedDB overhead during scroll when online (uses native browser HTTP/ServiceWorker cache).
 * - Instant synchronous L1 memory lookup or L2 CacheStorage fallback when offline or on network error.
 */
export const CachedImage = memo(({
    src,
    alt = '',
    className = '',
    fallback = null,
    loading = 'lazy',
    ...props
}) => {
    const [imageSrc, setImageSrc] = useState(() => {
        if (!src) return null;
        if (src.startsWith('data:') || src.startsWith('blob:')) return src;
        const mem = getMemoryCachedImage(src);
        if (mem) return mem;
        return getImageUrl(src) || null;
    });
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
        if (!src) {
            setImageSrc(null);
            return;
        }
        if (src.startsWith('data:') || src.startsWith('blob:')) {
            setImageSrc(src);
            return;
        }
        const mem = getMemoryCachedImage(src);
        if (mem) {
            setImageSrc(mem);
            return;
        }
        const directUrl = getImageUrl(src);
        // Si estamos sin conexión, consultar la caché local de inmediato
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            let active = true;
            getCachedImage(src).then((cached) => {
                if (active) setImageSrc(cached || directUrl || null);
            }).catch(() => {
                if (active) setImageSrc(directUrl || null);
            });
            return () => { active = false; };
        }
        setImageSrc(directUrl || null);
    }, [src]);

    const handleError = () => {
        if (!hasError && src && !src.startsWith('data:')) {
            getCachedImage(src).then((cached) => {
                if (cached && cached !== imageSrc) {
                    setImageSrc(cached);
                } else {
                    setHasError(true);
                    setImageSrc(null);
                }
            }).catch(() => {
                setHasError(true);
                setImageSrc(null);
            });
        } else {
            setHasError(true);
            setImageSrc(null);
        }
    };

    if (!src || hasError || !imageSrc) {
        if (fallback) return fallback;
        return (
            <div className={`flex items-center justify-center text-slate-300 dark:text-slate-600 ${className}`}>
                <Package size={28} strokeWidth={1.5} className="opacity-40" />
            </div>
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
