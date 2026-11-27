import { describe, it, expect, beforeEach } from 'vitest';
import { isPrivateLanOrLocalHost, formatServerUrl } from '../../src/services/api';
import biometricService from '../../src/services/biometricService';

describe('Fase M2 — Seguridad de Red LAN/HTTPS y Biometría v2', () => {
    beforeEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
    });

    it('isPrivateLanOrLocalHost permite solo RFC1918, loopback, link-local y .local', () => {
        expect(isPrivateLanOrLocalHost('192.168.1.30')).toBe(true);
        expect(isPrivateLanOrLocalHost('10.0.0.5')).toBe(true);
        expect(isPrivateLanOrLocalHost('172.16.4.2')).toBe(true);
        expect(isPrivateLanOrLocalHost('172.31.255.1')).toBe(true);
        expect(isPrivateLanOrLocalHost('127.0.0.1')).toBe(true);
        expect(isPrivateLanOrLocalHost('localhost')).toBe(true);
        expect(isPrivateLanOrLocalHost('caja-principal.local')).toBe(true);

        expect(isPrivateLanOrLocalHost('172.32.0.1')).toBe(false);
        expect(isPrivateLanOrLocalHost('8.8.8.8')).toBe(false);
        expect(isPrivateLanOrLocalHost('api.isaacpos.com')).toBe(false);
        expect(isPrivateLanOrLocalHost('mi-servidor.railway.app')).toBe(false);
    });

    it('formatServerUrl conserva HTTP:3005 para LAN privada y fuerza HTTPS en dominios/IPs públicos', () => {
        expect(formatServerUrl('192.168.1.50')).toBe('http://192.168.1.50:3005');
        expect(formatServerUrl('http://10.0.0.12:4000')).toBe('http://10.0.0.12:4000');
        expect(formatServerUrl('localhost')).toBe('http://localhost:3005');

        expect(formatServerUrl('http://api.isaacpos.com')).toBe('https://api.isaacpos.com');
        expect(formatServerUrl('api.isaacpos.com')).toBe('https://api.isaacpos.com');
        expect(formatServerUrl('http://8.8.8.8')).toBe('https://8.8.8.8');
    });

    it('biometricService.getEnrolledCredential purga credenciales v1 legacy con biometricToken plano', () => {
        localStorage.setItem('isaac_pos_biometric_credential', JSON.stringify({
            userId: 'u1',
            username: 'cajero',
            biometricToken: 'legacy-secret-token-should-be-purged'
        }));

        const res = biometricService.getEnrolledCredential();
        expect(res).toBeNull();
        expect(localStorage.getItem('isaac_pos_biometric_credential')).toBeNull();
    });

    it('biometricService.getEnrolledCredential acepta metadatos públicos v2 con keyAlias y sin secretos', () => {
        const v2Meta = {
            version: 2,
            keyAlias: 'isaac_pos_bio_v2_u1',
            userId: 'u1',
            username: 'cajero',
            name: 'Cajero Uno',
            role: 'cashier'
        };
        localStorage.setItem('isaac_pos_biometric_credential', JSON.stringify(v2Meta));

        const res = biometricService.getEnrolledCredential();
        expect(res).toEqual(v2Meta);
        expect(res.biometricToken).toBeUndefined();
    });
});
