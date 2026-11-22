import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import api from '../../src/services/api';
import { db } from '../../src/services/db';
import {
    getImageCandidateUrls,
    normalizeImageCacheKey
} from '../../src/utils/imageUtils';
import {
    cacheImage,
    getCachedImage,
    cacheAllProductImages,
    resetImageCacheRuntimeForTests
} from '../../src/services/imageCache';
import { CachedImage } from '../../src/components/CachedImage';

describe('Offline Image Pipeline (imageUtils + imageCache + CachedImage)', () => {
    const originalFetch = globalThis.fetch;
    const originalBaseUrl = api.defaults.baseURL;

    beforeEach(async () => {
        resetImageCacheRuntimeForTests();
        await db.clear('imageCache');
        api.defaults.baseURL = 'http://192.168.1.30:3005';
        window.Capacitor = { isNativePlatform: () => true };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        api.defaults.baseURL = originalBaseUrl;
        delete window.Capacitor;
        vi.restoreAllMocks();
    });

    it('normaliza claves de imagen de forma independiente a IP, protocolo o dominio CDN', () => {
        expect(normalizeImageCacheKey('harina.jpg')).toBe('product_images/harina.jpg');
        expect(normalizeImageCacheKey('/product_images/harina.jpg')).toBe('product_images/harina.jpg');
        expect(normalizeImageCacheKey('http://192.168.1.30:3005/product_images/harina.jpg?t=99')).toBe('product_images/harina.jpg');
        expect(normalizeImageCacheKey('http://192.168.1.99:3005/product_images/harina.jpg')).toBe('product_images/harina.jpg');
        expect(normalizeImageCacheKey('https://demo.supabase.co/storage/v1/object/public/product-images/harina.jpg')).toBe('product_images/harina.jpg');
    });

    it('en móvil sin VITE_SUPABASE_URL (APK comercial) resuelve al servidor PC LAN y nunca devuelve cadena vacía, y con Supabase incluye fallback LAN', async () => {
        // Caso 1: Con configuración del entorno actual (incluye fallback LAN siempre)
        const candidatesWithEnv = getImageCandidateUrls('aceite.jpg');
        expect(candidatesWithEnv).toContain('http://192.168.1.30:3005/product_images/aceite.jpg');

        // Caso 2: Simular build comercial APK donde VITE_SUPABASE_URL es ""
        vi.resetModules();
        vi.doMock('../../src/config/supabaseConfig', () => ({
            SUPABASE_URL: '',
            SUPABASE_ANON_KEY: '',
            hasSupabaseConfig: () => false,
            getSupabaseStoragePublicUrl: () => ''
        }));
        const freshApiMod = await import('../../src/services/api');
        freshApiMod.default.defaults.baseURL = 'http://192.168.1.30:3005';
        const freshUtils = await import('../../src/utils/imageUtils');

        expect(freshUtils.getImageUrl('product_images/aceite.jpg')).toBe('http://192.168.1.30:3005/product_images/aceite.jpg');
        expect(freshUtils.getImageCandidateUrls('aceite.jpg')).toEqual(['http://192.168.1.30:3005/product_images/aceite.jpg']);
        vi.doUnmock('../../src/config/supabaseConfig');
        vi.resetModules();
    });

    it('cacheImage persiste en DB local (SQLite/IndexedDB) y recupera la imagen tras cambiar IP y apagar la PC', async () => {
        // 1x1 PNG válido en bytes
        const pngBytes = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
        ]);
        const mockBlob = new Blob([pngBytes], { type: 'image/png' });

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'image/png' },
            blob: async () => mockBlob
        });

        const storedDataUrl = await cacheImage('product_images/cafe.png');
        expect(storedDataUrl).toMatch(/^data:image\/png;base64,/);

        // Verificar persistencia real en store imageCache de db
        const persistedRow = await db.getById('imageCache', 'product_images/cafe.png');
        expect(persistedRow?.data).toBe(storedDataUrl);

        // Simular reinicio de app (memoria limpia) + cambio de IP + PC APAGADA (fetch falla)
        resetImageCacheRuntimeForTests();
        api.defaults.baseURL = 'http://192.168.1.77:3005';
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));

        const offlineDataUrl = await getCachedImage('http://192.168.1.77:3005/product_images/cafe.png');
        expect(offlineDataUrl).toBe(storedDataUrl);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('CachedImage renderiza desde caché local inmediatamente con PC apagada aunque navigator.onLine sea true', async () => {
        const fakeDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';
        await db.put('imageCache', {
            uri: 'product_images/arroz.jpg',
            data: fakeDataUrl,
            updatedAt: Date.now()
        });

        // Simular Wi-Fi encendido (navigator.onLine = true) pero PC servidor apagada
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        render(<CachedImage src="product_images/arroz.jpg" alt="Arroz Premium" />);

        await waitFor(() => {
            const img = screen.getByRole('img', { name: 'Arroz Premium' });
            expect(img).toHaveAttribute('src', fakeDataUrl);
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('cacheAllProductImages descarga imágenes nuevas y omite las ya guardadas', async () => {
        const mockBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'image/jpeg' },
            blob: async () => mockBlob
        });

        const products = [
            { id: '1', imageUri: 'product_images/p1.jpg' },
            { id: '2', imageUri: 'product_images/p2.jpg' },
            { id: '3', imageUri: '/product_images/p1.jpg' } // duplicado normalizado
        ];

        const firstRun = await cacheAllProductImages(products, { concurrency: 2 });
        expect(firstRun.total).toBe(2);
        expect(firstRun.cached).toBe(2);
        expect(firstRun.failed).toBe(0);

        // Segunda corrida debe detectar ambas en caché sin volver a llamar a fetch
        resetImageCacheRuntimeForTests();
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('PC Apagada'));
        const secondRun = await cacheAllProductImages(products, { concurrency: 2 });
        expect(secondRun.alreadyCached).toBe(2);
        expect(secondRun.failed).toBe(0);
    });
});
