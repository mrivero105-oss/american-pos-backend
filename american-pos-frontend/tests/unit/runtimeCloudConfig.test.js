import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    hasSupabaseConfig,
    getSupabaseUrl,
    getSupabaseAnonKey,
    getSupabaseRestUrl,
    getSupabaseRealtimeWsUrl,
    getSupabaseStoragePublicUrl,
    setRuntimeCloudConfig,
    clearRuntimeCloudConfig,
    syncRuntimeCloudConfigFromServer,
    subscribeCloudConfigChange
} from '../../src/config/supabaseConfig';
import { getImageCandidateUrls } from '../../src/utils/imageUtils';
import api, {
    getRemoteServerUrl,
    setRemoteServerUrl,
    getLoginTimeoutMs,
    updateApiBaseUrl,
    autoDiscoverServer
} from '../../src/services/api';
import axios from 'axios';

describe('Nivel 2A — Aislamiento Multi-Cliente de Supabase en Runtime', () => {
    beforeEach(() => {
        localStorage.clear();
        clearRuntimeCloudConfig();
        vi.restoreAllMocks();
    });

    it('sin configuración runtime del servidor, desactiva Supabase de datos (aislamiento entre clientes)', () => {
        expect(hasSupabaseConfig()).toBe(false);
        expect(getSupabaseUrl()).toBe('');
        expect(getSupabaseAnonKey()).toBe('');
        expect(getSupabaseRestUrl('cloud_configuracion')).toBe('');
        expect(getSupabaseRealtimeWsUrl()).toBe('');
        expect(getSupabaseStoragePublicUrl('product-images', 'harina.jpg')).toBe('');
    });

    it('activa dinámicamente URL, REST, Realtime e imágenes al recibir la nube propia de un comercio', () => {
        const listener = vi.fn();
        const unsub = subscribeCloudConfigChange(listener);

        setRuntimeCloudConfig(
            {
                configured: true,
                supabaseUrl: 'https://cliente-a.supabase.co/',
                anonKey: 'anon-key-cliente-a',
                branchId: 'sucursal-1'
            },
            'http://192.168.1.50:3005'
        );

        expect(hasSupabaseConfig()).toBe(true);
        expect(getSupabaseUrl()).toBe('https://cliente-a.supabase.co');
        expect(getSupabaseRestUrl('cloud_configuracion?id=eq.general')).toBe(
            'https://cliente-a.supabase.co/rest/v1/cloud_configuracion?id=eq.general'
        );
        expect(getSupabaseRealtimeWsUrl()).toBe(
            'wss://cliente-a.supabase.co/realtime/v1/websocket?apikey=anon-key-cliente-a&vsn=1.0.0'
        );
        expect(getSupabaseStoragePublicUrl('product-images', 'cafe.png')).toBe(
            'https://cliente-a.supabase.co/storage/v1/object/public/product-images/cafe.png'
        );

        const imgUrls = getImageCandidateUrls('product_images/cafe.png');
        expect(imgUrls).toContain('https://cliente-a.supabase.co/storage/v1/object/public/product-images/cafe.png');
        expect(listener).toHaveBeenCalledTimes(1);

        unsub();
    });

    it('al cambiar de PC servidor (Cliente A -> Cliente B sin nube), purga inmediatamente la nube del Cliente A', async () => {
        setRuntimeCloudConfig(
            {
                configured: true,
                supabaseUrl: 'https://cliente-a.supabase.co',
                anonKey: 'anon-key-cliente-a',
                branchId: 'principal'
            },
            'http://192.168.1.50:3005'
        );
        expect(hasSupabaseConfig()).toBe(true);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                configured: false,
                supabaseUrl: '',
                anonKey: '',
                branchId: 'principal'
            })
        });

        await syncRuntimeCloudConfigFromServer('http://192.168.1.99:3005');

        expect(fetchSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^http:\/\/192\.168\.1\.99:3005\/sync\/cloud-client-config\?_t=/),
            expect.objectContaining({ method: 'GET' })
        );
        expect(hasSupabaseConfig()).toBe(false);
        expect(getSupabaseUrl()).toBe('');

        // Las imágenes ya no deben intentar caer en el bucket del Cliente A
        const imgUrls = getImageCandidateUrls('product_images/cafe.png');
        expect(imgUrls.some((u) => u.includes('cliente-a.supabase.co'))).toBe(false);
    });

    it('al conectar a Cliente B con su propio Supabase, reemplaza la nube del Cliente A sin cruce', async () => {
        setRuntimeCloudConfig(
            {
                configured: true,
                supabaseUrl: 'https://cliente-a.supabase.co',
                anonKey: 'anon-a'
            },
            'http://192.168.1.50:3005'
        );

        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                configured: true,
                supabaseUrl: 'https://cliente-b.supabase.co',
                anonKey: 'anon-b',
                branchId: 'sucursal-b'
            })
        });

        await syncRuntimeCloudConfigFromServer('http://10.0.0.20:3005');

        expect(hasSupabaseConfig()).toBe(true);
        expect(getSupabaseUrl()).toBe('https://cliente-b.supabase.co');
        expect(getSupabaseAnonKey()).toBe('anon-b');
        const imgUrls = getImageCandidateUrls('product_images/agua.webp');
        expect(imgUrls.some((u) => u.includes('cliente-b.supabase.co'))).toBe(true);
        expect(imgUrls.some((u) => u.includes('cliente-a.supabase.co'))).toBe(false);
    });
});

describe('Tailscale Funnel — Timeout 4G y Failover Automático Dual (LAN ↔ HTTPS)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        updateApiBaseUrl('');
        localStorage.removeItem('isaac_pos_server_ip_explicitly_cleared');
        localStorage.setItem('isaac_pos_node_role', 'client');
    });

    it('exige HTTPS público en setRemoteServerUrl y adapta timeout de login (6000ms remoto vs 1800ms LAN)', () => {
        expect(() => setRemoteServerUrl('http://192.168.1.30:3005')).toThrow(/Tailscale Funnel/);

        const saved = setRemoteServerUrl('mi-tienda.tail1234.ts.net');
        expect(saved).toBe('https://mi-tienda.tail1234.ts.net');
        expect(getRemoteServerUrl()).toBe('https://mi-tienda.tail1234.ts.net');

        expect(getLoginTimeoutMs('http://192.168.1.30:3005')).toBe(1800);
        expect(getLoginTimeoutMs('https://mi-tienda.tail1234.ts.net')).toBe(6000);
    });

    it('conmuta automáticamente de IP LAN a Tailscale Funnel HTTPS en 4G y regresa a LAN al volver al local', async () => {
        updateApiBaseUrl('192.168.1.30:3005');
        setRemoteServerUrl('https://mi-tienda.tail1234.ts.net');

        // 1. Fuera del negocio (4G): todas las IPs LAN fallan, solo responde Tailscale Funnel HTTPS
        const getSpy = vi.spyOn(axios, 'get').mockImplementation(async (url) => {
            if (String(url).startsWith('https://mi-tienda.tail1234.ts.net/hello')) {
                return { status: 200, data: { dbReady: true, role: 'MASTER_CLOUD_HUB', serverFingerprint: 'fp-tienda-1' } };
            }
            throw new Error('Network Error');
        });

        const failoverUrl = await autoDiscoverServer();
        expect(failoverUrl).toBe('https://mi-tienda.tail1234.ts.net');
        expect(api.defaults.baseURL).toBe('https://mi-tienda.tail1234.ts.net');
        expect(localStorage.getItem('isaac_pos_lan_server_ip')).toBe('192.168.1.30:3005');

        // 2. De vuelta en el Wi-Fi de la tienda: la IP LAN vuelve a responder -> regresa a LAN automáticamente
        getSpy.mockImplementation(async (url) => {
            if (String(url).startsWith('http://192.168.1.30:3005/hello')) {
                return { status: 200, data: { dbReady: true, role: 'MASTER_CLOUD_HUB', serverFingerprint: 'fp-tienda-1' } };
            }
            return { status: 200, data: { dbReady: true, role: 'MASTER_CLOUD_HUB', serverFingerprint: 'fp-tienda-1' } };
        });

        const returnedLanUrl = await autoDiscoverServer();
        expect(returnedLanUrl).toBe('http://192.168.1.30:3005');
        expect(api.defaults.baseURL).toBe('http://192.168.1.30:3005');
    });
});
