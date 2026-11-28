import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-cloud-l2-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.POS_BRANCH_ID;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'cl2-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || 'cl2-owner-' + crypto.randomBytes(16).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'cl2-backup-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'cl2-audit-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'cl2-sync-' + crypto.randomBytes(24).toString('hex');

const { publicKey: rsaPub, privateKey: rsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
process.env.LICENSE_PUBLIC_KEY_PEM = rsaPub;
process.env.LICENSE_PRIVATE_KEY_PEM = rsaPriv;

const DbConfigManager = require('../config/dbConfigManager');
const { startServer } = require('../index');
const bcrypt = require('bcryptjs');
const licenseUtils = require('../utils/licenseUtils');
const { runWithTenantContext } = require('../database/tenantContext');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const CloudStorageService = require('../services/CloudStorageService');

let srvHandle = null;
const cleanup = { users: [], licenses: [] };

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    assert.equal(res.status, 200, `Login falló para ${username}: status=${res.status}`);
    return await res.json();
}

test.after(async () => {
    try {
        SupabaseSyncService.clearClientConfig();
    } catch (_) {}
    try {
        const models = require('../database/models');
        await runWithTenantContext({ companyId: '', userId: 'cl2-cleanup', isSuperAdmin: true }, async () => {
            if (cleanup.licenses.length && models.License) {
                await models.License.destroy({ where: { id: cleanup.licenses } }).catch(() => {});
            }
            if (cleanup.users.length && models.User) {
                await models.User.destroy({ where: { id: cleanup.users } }).catch(() => {});
            }
        });
    } catch (_) {}

    if (srvHandle && typeof srvHandle.stopServer === 'function') {
        await srvHandle.stopServer();
    }
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('Nivel 2A: Nube independiente por cliente en runtime (RBAC, anti-SSRF, SecretVault y sin fuga de serviceKey)', async () => {
    assert.equal(DbConfigManager.getConfig().database, 'americanpos_test');
    srvHandle = await startServer([0], isolatedUserDataDir);
    const dbReady = await srvHandle.dbInitPromise;
    assert.equal(dbReady, true);
    const baseUrl = `http://127.0.0.1:${srvHandle.mainPort}`;

    // Limpiar estado inicial en el vault temporal del test
    SupabaseSyncService.clearClientConfig();

    const mid = await licenseUtils.getMachineId();
    const { License, User } = require('../database/models');
    const licKey = licenseUtils.generateKeyV2(mid, 365);
    const ts = Date.now();
    const licId = `cl2-lic-${ts}`;
    cleanup.licenses.push(licId);

    const compId = `cl2_comp_${ts}`;
    const pwd = 'CL2_Strong_' + crypto.randomBytes(8).toString('hex');
    const pwdHash = bcrypt.hashSync(pwd, 8);
    const adminId = `cl2-admin-${ts}`;
    const cashierId = `cl2-cashier-${ts}`;
    cleanup.users.push(adminId, cashierId);

    await runWithTenantContext({ companyId: '', userId: 'cl2-seed', isSuperAdmin: true }, async () => {
        await License.update({ status: 'revoked' }, { where: { machineId: mid, status: 'active' } });
        await License.create({
            id: licId,
            licenseKey: licKey,
            machineId: mid,
            status: 'active',
            activatedAt: new Date().toISOString()
        });
        await User.create({
            id: adminId,
            username: `cl2_admin_${ts}`,
            email: `cl2_admin_${ts}@test.local`,
            name: 'Admin Nube L2',
            password: pwdHash,
            role: 'admin',
            status: 'active',
            companyId: compId,
            permissions: { canManageSettings: true, canAccessPOS: true }
        });
        await User.create({
            id: cashierId,
            username: `cl2_cashier_${ts}`,
            email: `cl2_cashier_${ts}@test.local`,
            name: 'Cajero Nube L2',
            password: pwdHash,
            role: 'user',
            status: 'active',
            companyId: compId,
            permissions: { canAccessPOS: true }
        });
    });

    // 1. Endpoint público /sync/cloud-client-config sin configurar devuelve configured=false y cero secretos
    const pubEmptyRes = await fetch(`${baseUrl}/sync/cloud-client-config`);
    assert.equal(pubEmptyRes.status, 200);
    const pubEmpty = await pubEmptyRes.json();
    assert.equal(pubEmpty.configured, false);
    assert.equal(pubEmpty.supabaseUrl, '');
    assert.equal(pubEmpty.anonKey, '');
    assert.equal('serviceKey' in pubEmpty, false, 'Nunca debe existir el campo serviceKey en la config pública');

    const authAdmin = await login(baseUrl, `cl2_admin_${ts}`, pwd);
    const authCashier = await login(baseUrl, `cl2_cashier_${ts}`, pwd);

    // 2. RBAC fail-closed: un cajero recibe 403 en todos los endpoints administrativos de nube
    for (const [method, endpoint] of [
        ['GET', '/sync/cloud-config'],
        ['PUT', '/sync/cloud-config'],
        ['DELETE', '/sync/cloud-config'],
        ['POST', '/sync/cloud-config/test'],
        ['GET', '/sync/cloud-schema-sql']
    ]) {
        const res = await fetch(`${baseUrl}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authCashier.token}`
            },
            body: ['PUT', 'POST'].includes(method) ? JSON.stringify({}) : undefined
        });
        assert.equal(res.status, 403, `Cajero debe recibir 403 en ${method} ${endpoint}`);
    }

    // 3. Anti-SSRF: rechazar HTTP, loopback, RFC1918 y metadata cloud
    for (const badUrl of [
        'http://cliente-demo.supabase.co',
        'https://127.0.0.1:8443',
        'https://169.254.169.254',
        'https://192.168.1.50',
        'https://localhost:3005'
    ]) {
        const badRes = await fetch(`${baseUrl}/sync/cloud-config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authAdmin.token}`
            },
            body: JSON.stringify({
                supabaseUrl: badUrl,
                anonKey: 'sb_publishable_demo_anon',
                serviceKey: 'sb_secret_demo_service_123456789'
            })
        });
        assert.equal(badRes.status, 400, `URL insegura/SSRF debe ser rechazada: ${badUrl}`);
    }

    // 4. Guardar configuración válida de un cliente independiente -> persiste cifrada y actualiza runtime
    const demoUrl = 'https://cliente-independiente-demo.supabase.co';
    const demoAnon = 'sb_publishable_cliente_demo_anon_key';
    const demoService = 'sb_secret_cliente_demo_private_key_9999';

    const saveRes = await fetch(`${baseUrl}/sync/cloud-config`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authAdmin.token}`
        },
        body: JSON.stringify({
            supabaseUrl: `${demoUrl}/`,
            anonKey: demoAnon,
            serviceKey: demoService,
            branchId: 'sucursal-valencia'
        })
    });
    assert.equal(saveRes.status, 200);
    const saveBody = await saveRes.json();
    assert.equal(saveBody.configured, true);
    assert.equal(saveBody.supabaseUrl, demoUrl);
    assert.equal(saveBody.hasServiceKey, true);
    assert.equal(saveBody.branchId, 'sucursal-valencia');
    assert.ok(!JSON.stringify(saveBody).includes(demoService), 'La serviceKey completa nunca debe devolverse en JSON');

    // Verificar que CloudStorageService resuelve dinámicamente el nuevo Supabase sin reiniciar el servidor
    assert.equal(CloudStorageService.getActiveCloudStorageConfig().supabaseUrl, demoUrl);
    assert.equal(CloudStorageService.getActiveCloudStorageConfig().serviceKey, demoService);

    // Verificar que el endpoint público entrega URL + Anon Key (sin serviceKey) al APK y Desktop
    const pubLiveRes = await fetch(`${baseUrl}/sync/cloud-client-config`);
    assert.equal(pubLiveRes.status, 200);
    const pubLive = await pubLiveRes.json();
    assert.equal(pubLive.configured, true);
    assert.equal(pubLive.supabaseUrl, demoUrl);
    assert.equal(pubLive.anonKey, demoAnon);
    assert.equal(pubLive.branchId, 'sucursal-valencia');
    assert.ok(!JSON.stringify(pubLive).includes(demoService), 'serviceKey jamás debe filtrarse al cliente móvil');

    // 5. Endpoint de SQL de inicialización entrega esquema completo e idempotente con RLS
    const sqlRes = await fetch(`${baseUrl}/sync/cloud-schema-sql`, {
        headers: { Authorization: `Bearer ${authAdmin.token}` }
    });
    assert.equal(sqlRes.status, 200);
    const sqlBody = await sqlRes.json();
    assert.ok(sqlBody.sql.includes('CREATE TABLE IF NOT EXISTS public.cloud_configuracion'));
    assert.ok(sqlBody.sql.includes('CREATE TABLE IF NOT EXISTS public.cloud_ventas'));
    assert.ok(sqlBody.sql.includes('ENABLE ROW LEVEL SECURITY'));

    // 6. Desconectar nube -> vuelve a modo local limpio sin restos en memoria ni en client-config
    const delRes = await fetch(`${baseUrl}/sync/cloud-config`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authAdmin.token}` }
    });
    assert.equal(delRes.status, 200);

    const pubAfterDel = await (await fetch(`${baseUrl}/sync/cloud-client-config`)).json();
    assert.equal(pubAfterDel.configured, false);
    assert.equal(pubAfterDel.supabaseUrl, '');
    assert.equal(pubAfterDel.anonKey, '');
    assert.equal(CloudStorageService.getActiveCloudStorageConfig().supabaseUrl, '');

    // 7. Tailscale Funnel: CORS permite same-origin https://*.ts.net y rechaza otro dominio .ts.net
    const tsOwnOrigin = 'https://tienda-clienta.tail1234.ts.net';
    const tsOwnRes = await fetch(`${baseUrl}/hello`, {
        headers: {
            Origin: tsOwnOrigin,
            'X-Forwarded-Host': 'tienda-clienta.tail1234.ts.net'
        }
    });
    assert.equal(tsOwnRes.status, 200);
    assert.equal(tsOwnRes.headers.get('access-control-allow-origin'), tsOwnOrigin);

    const tsForeignRes = await fetch(`${baseUrl}/hello`, {
        headers: {
            Origin: 'https://otro-atacante.tail9999.ts.net',
            'X-Forwarded-Host': 'tienda-clienta.tail1234.ts.net'
        }
    });
    assert.equal(tsForeignRes.headers.get('access-control-allow-origin'), null, 'CORS no debe abrir otros dominios .ts.net');

    // 8. Tailscale Funnel: authLimiter aplica encabezados RateLimit al tráfico con X-Forwarded-For desde loopback
    //    y NO los aplica al loopback directo de Electron sin X-Forwarded-For
    const directLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'no_existe_direct', password: 'bad' })
    });
    assert.equal(directLoginRes.headers.get('ratelimit-limit'), null, 'Loopback directo sin proxy sigue exento');

    const funnelLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '198.51.100.42'
        },
        body: JSON.stringify({ username: 'no_existe_funnel', password: 'bad' })
    });
    assert.equal(funnelLoginRes.headers.get('ratelimit-limit'), '100', 'Tráfico Tailscale Funnel debe aplicar authLimiter por IP real');
});
