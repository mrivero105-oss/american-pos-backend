import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Op } from 'sequelize';

const require = createRequire(import.meta.url);

process.env.ISAAC_TEST_ISOLATED = '1';
process.env.USER_DATA_PATH = process.env.USER_DATA_PATH || fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-audit-reg-'));
process.env.DB_NAME_FORCE = process.env.DB_NAME_FORCE || 'americanpos_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_audit_remediation_2026_safe';
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'test_sync_secret_audit_remediation_2026_safe';

const {
    isPlatformSuperAdminRole,
    isCompanyOwnerRole,
    isCompanyAdminRole,
    isSupervisorOrAboveRole
} = require('../constants/roles.js');
const SecurityHelper = require('../services/SecurityHelper.js');
const { verifyToken, isAdmin, isSuperAdmin } = require('../middleware/auth.js');
const SaleService = require('../services/SaleService.js');
const FiscalService = require('../services/FiscalService.js');
const SupabaseSyncService = require('../services/SupabaseSyncService.js');
const { sequelize } = require('../database/connection.js');
const models = require('../database/models/index.js');

const runMiddleware = (mw, req) => new Promise((resolve) => {
    const out = { nextCalled: false, statusCode: 200, body: null, req };
    const res = {
        status(code) { out.statusCode = code; return this; },
        json(payload) { out.body = payload; resolve(out); return this; }
    };
    Promise.resolve(mw(req, res, () => { out.nextCalled = true; resolve(out); })).catch((err) => {
        out.error = err;
        resolve(out);
    });
});

test('R1. constants/roles diferencia Superadmin de plataforma vs Owner/Dueño/Admin de empresa', () => {
    assert.equal(isPlatformSuperAdminRole('superadmin'), true);
    assert.equal(isPlatformSuperAdminRole('owner'), false);
    assert.equal(isPlatformSuperAdminRole('dueño'), false);

    for (const r of ['superadmin', 'owner', 'dueño', 'dueno', 'master', 'DUEÑO']) {
        assert.equal(isCompanyOwnerRole(r), true, `${r} debe ser owner`);
        assert.equal(isCompanyAdminRole(r), true, `${r} debe ser admin`);
        assert.equal(isSupervisorOrAboveRole(r), true, `${r} debe ser supervisor o superior`);
    }
    assert.equal(isCompanyAdminRole('admin'), true);
    assert.equal(isCompanyAdminRole('supervisor'), false);
    assert.equal(isSupervisorOrAboveRole('supervisor'), true);
    assert.equal(isSupervisorOrAboveRole('cashier'), false);
});

test('R2. SecurityHelper rechaza timestamps futuros, expirados y firmas no hexadecimales', () => {
    const payload = { saleId: 's-1', total: 10 };
    const signed = SecurityHelper.signPayload(payload, 'branch-1', 'comp-1');
    assert.equal(SecurityHelper.verifySignature(payload, 'comp-1', 'branch-1', signed.timestamp, signed.signature), true);

    const futureTs = String(Date.now() + 10 * 60 * 1000);
    assert.equal(SecurityHelper.verifySignature(payload, 'comp-1', 'branch-1', futureTs, signed.signature), false);

    const pastTs = String(Date.now() - 10 * 60 * 1000);
    assert.equal(SecurityHelper.verifySignature(payload, 'comp-1', 'branch-1', pastTs, signed.signature), false);

    assert.equal(SecurityHelper.verifySignature(payload, 'comp-1', 'branch-1', signed.timestamp, 'not-hex!!'), false);
});

test('R3. Auth: public-cashiers bloquea enumeración cross-tenant y RBAC acepta dueño/dueno', async () => {
    const pubCashierRes = await runMiddleware(verifyToken, {
        method: 'GET',
        path: '/auth/public-cashiers',
        ip: '192.168.1.20',
        headers: { 'x-company-id': 'empresa-ajena-999' },
        query: { companyId: 'empresa-ajena-999' }
    });
    assert.equal(pubCashierRes.nextCalled, true);
    assert.equal(pubCashierRes.req.user.companyId, process.env.DEFAULT_COMPANY_ID || '2');

    for (const alias of ['owner', 'dueño', 'dueno', 'master']) {
        const admRes = await runMiddleware(isAdmin, { user: { id: 'u1', role: alias } });
        assert.equal(admRes.nextCalled, true, `isAdmin debe aceptar ${alias}`);
        const supRes = await runMiddleware(isSuperAdmin, { user: { id: 'u1', role: alias } });
        assert.equal(supRes.nextCalled, true, `isSuperAdmin debe aceptar ${alias}`);
    }
});

test('R4. SaleService._normalizePayments alinea Binance P2P vs BCV y preserva paridad 1:1 por defecto', () => {
    // Caso A: Paridad 1:1 (cryptoRate === exchangeRate = 50)
    const eqCase = SaleService._normalizePayments({
        paymentMethods: [{ method: 'binance_usdt', amount: 10, currency: 'USDT', cryptoRate: 50 }]
    }, 10, 50, {});
    assert.equal(eqCase[0].convertedAmountUsd, 10);
    assert.equal(eqCase[0].convertedAmountBs, 500);

    // Caso B: Tasa P2P diferenciada (cryptoRate = 60, exchangeRate = 50 -> 8.33 USDT * 60 = 499.80 Bs / 50 = $10.00)
    const p2pCase = SaleService._normalizePayments({
        paymentMethods: [{ method: 'binance_usdt', amount: 8.33, currency: 'USDT', cryptoRate: 60 }]
    }, 10, 50, {});
    assert.equal(p2pCase[0].convertedAmountBs, 499.8);
    assert.equal(p2pCase[0].convertedAmountUsd, 10);
});

test('R5. FiscalService usa rango semiabierto [startDate, nextStartDate) en Sales y PurchaseOrders', async () => {
    const origFiscal = models.FiscalBookRecord.findAll;
    const origSale = models.Sale.findAll;
    const origCN = models.CreditNote.findAll;
    const origPO = models.PurchaseOrder.findAll;
    const origRet = models.TaxRetention.findAll;

    let capturedSaleWhere = null;
    let capturedPoWhere = null;

    models.FiscalBookRecord.findAll = async () => [];
    models.CreditNote.findAll = async () => [];
    models.TaxRetention.findAll = async () => [];
    models.Sale.findAll = async (opts) => { capturedSaleWhere = opts.where; return []; };
    models.PurchaseOrder.findAll = async (opts) => { capturedPoWhere = opts.where; return []; };

    try {
        await FiscalService.getSalesBook('default', 2026, 12);
        assert.equal(capturedSaleWhere[Op.or][0].date[Op.gte], '2026-12-01');
        assert.equal(capturedSaleWhere[Op.or][0].date[Op.lt], '2027-01-01');

        await FiscalService.getPurchasesBook('default', 2026, 12);
        assert.equal(capturedPoWhere.date[Op.gte], '2026-12-01');
        assert.equal(capturedPoWhere.date[Op.lt], '2027-01-01');
    } finally {
        models.FiscalBookRecord.findAll = origFiscal;
        models.Sale.findAll = origSale;
        models.CreditNote.findAll = origCN;
        models.PurchaseOrder.findAll = origPO;
        models.TaxRetention.findAll = origRet;
    }
});

test('R6. SupabaseSyncService marca entidades desconocidas como FAILED en vez de dejarlas en PROCESSING', async () => {
    const origTx = sequelize.transaction;
    const origQuery = sequelize.query;
    const origUrl = SupabaseSyncService.supabaseUrl;
    const origKey = SupabaseSyncService.serviceKey;
    let markedFailed = false;

    SupabaseSyncService.supabaseUrl = 'https://mock.supabase.local';
    SupabaseSyncService.serviceKey = 'mock-service-key';
    SupabaseSyncService.isSyncing = false;
    const origIsolCheck = SupabaseSyncService._isRealCloudTargetInIsolatedEnv;
    SupabaseSyncService._isRealCloudTargetInIsolatedEnv = () => false;

    sequelize.transaction = async () => ({
        LOCK: { UPDATE: 'UPDATE' },
        commit: async () => {},
        rollback: async () => {}
    });
    sequelize.query = async (sql, opts) => {
        if (sql.includes('FROM sync_outbox')) {
            return [[{ id: 999, entity_name: 'EntidadDesconocida', entity_id: 'x1', operation: 'INSERT', payload: {} }], {}];
        }
        if (sql.includes("SET status = 'FAILED'") && opts?.replacements?.unknownIds?.includes(999)) {
            markedFailed = true;
        }
        return [[], {}];
    };

    try {
        await SupabaseSyncService.processBatch(10);
        assert.equal(markedFailed, true, 'Entidad sin mapeo debe marcarse FAILED para no quedar en bucle PROCESSING');
    } finally {
        sequelize.transaction = origTx;
        sequelize.query = origQuery;
        SupabaseSyncService.supabaseUrl = origUrl;
        SupabaseSyncService.serviceKey = origKey;
        SupabaseSyncService.isSyncing = false;
        SupabaseSyncService._isRealCloudTargetInIsolatedEnv = origIsolCheck;
    }
});

const invokeRouter = (router, reqOverrides = {}) => new Promise((resolve, reject) => {
    const out = { handled: false, statusCode: 200, body: null };
    const req = {
        method: 'GET',
        url: '/',
        originalUrl: '/',
        headers: {},
        query: {},
        body: {},
        params: {},
        ...reqOverrides
    };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; out.statusCode = code; return this; },
        json(payload) { out.handled = true; out.body = payload; resolve(out); return this; },
        send(payload) { out.handled = true; out.body = payload; resolve(out); return this; },
        setHeader() { return this; },
        getHeader() { return undefined; }
    };
    router.handle(req, res, (err) => {
        if (err) return reject(err);
        resolve(out);
    });
});

test('R7. /sync/stats lee sync_outbox real y /recharges exige canAccessPOS, aisla tenant y clasifica binance_usdt en USD', async () => {
    const syncRouter = require('../routes/sync.js');
    const rechargesRouter = require('../routes/recharges.js');

    const origQuery = sequelize.query;
    const origUrl = SupabaseSyncService.supabaseUrl;
    const origKey = SupabaseSyncService.serviceKey;
    SupabaseSyncService.supabaseUrl = 'https://mock.supabase.local';
    SupabaseSyncService.serviceKey = 'mock-key';

    sequelize.query = async (sql) => {
        if (sql.includes('FROM sync_outbox')) {
            return [[
                { status: 'PENDING', cnt: 3 },
                { status: 'FAILED', cnt: 2 }
            ], {}];
        }
        return [[], {}];
    };

    try {
        const statsRes = await invokeRouter(syncRouter, { method: 'GET', url: '/stats' });
        assert.equal(statsRes.handled, true);
        assert.equal(statsRes.statusCode, 200);
        assert.equal(statsRes.body?.success, true);
        assert.equal(statsRes.body?.stats?.PENDING, 3);
        assert.equal(statsRes.body?.stats?.FAILED, 2);
        assert.equal(statsRes.body?.stats?.SYNCED, 0);
        assert.equal(statsRes.body?.isOnline, true);
    } finally {
        sequelize.query = origQuery;
        SupabaseSyncService.supabaseUrl = origUrl;
        SupabaseSyncService.serviceKey = origKey;
    }

    const deniedRes = await invokeRouter(rechargesRouter, {
        method: 'GET',
        url: '/',
        user: { id: 'u-denied', role: 'cashier', companyId: 'comp-77', permissions: { canAccessPOS: false } }
    });
    assert.equal(deniedRes.statusCode, 403, '/recharges debe bloquear usuarios sin permiso canAccessPOS');

    const { TelecomRecharge, CashShift, CashMovement } = models;
    const origSync = TelecomRecharge.sync;
    const origFindAll = TelecomRecharge.findAll;
    const origFindOne = TelecomRecharge.findOne;
    const origFindByPk = TelecomRecharge.findByPk;
    const origCreate = TelecomRecharge.create;
    const origShiftFindOne = CashShift.findOne;
    const origMoveCreate = CashMovement.create;

    let capturedLatestWhere = null;
    let capturedCashMovement = null;

    TelecomRecharge.sync = async () => {};
    TelecomRecharge.findAll = async () => [];
    TelecomRecharge.findOne = async (opts) => {
        capturedLatestWhere = opts?.where || null;
        return { remainingWalletBalanceBs: 500 };
    };
    TelecomRecharge.findByPk = async () => null;
    TelecomRecharge.create = async (data) => ({
        ...data,
        async update() { return this; }
    });
    CashShift.findOne = async () => ({ id: 'shift-77', userId: 'u-pos', userName: 'Cajero POS' });
    CashMovement.create = async (data) => {
        capturedCashMovement = data;
        return { id: data.id, ...data };
    };

    try {
        const listRes = await invokeRouter(rechargesRouter, {
            method: 'GET',
            url: '/',
            user: { id: 'u-pos', role: 'admin', companyId: 'comp-77', permissions: { canAccessPOS: true } }
        });
        assert.equal(listRes.statusCode, 200);
        assert.equal(capturedLatestWhere?.companyId, 'comp-77', 'latestWithBalance debe filtrar por companyId del tenant');

        const postRes = await invokeRouter(rechargesRouter, {
            method: 'POST',
            url: '/',
            user: { id: 'u-pos', role: 'admin', name: 'Cajero POS', companyId: 'comp-77', permissions: { canAccessPOS: true } },
            body: {
                id: 'rec-binance-1',
                operator: 'MOVILNET',
                phoneNumber: '04161234567',
                nominalAmountBs: 100,
                serviceFeePercent: 20,
                totalChargedBs: 120,
                exchangeRate: 60,
                paymentMethod: 'binance',
                status: 'COMPLETADA'
            }
        });
        assert.equal(postRes.statusCode, 200);
        assert.equal(postRes.body?.ok, true);
        assert.equal(capturedCashMovement?.currency, 'USD', 'binance_usdt debe clasificarse como USD');
        assert.equal(capturedCashMovement?.paymentMethodId, 'binance_usdt');
        assert.equal(capturedCashMovement?.amount, 2);
    } finally {
        TelecomRecharge.sync = origSync;
        TelecomRecharge.findAll = origFindAll;
        TelecomRecharge.findOne = origFindOne;
        TelecomRecharge.findByPk = origFindByPk;
        TelecomRecharge.create = origCreate;
        CashShift.findOne = origShiftFindOne;
        CashMovement.create = origMoveCreate;
    }
});

test('R8. SecretVault migra secretos desde .env hacia bóveda cifrada, limpia texto plano y recarga exactamente', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const SecretVault = require('../config/secretVault.js');

    const tmpVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-vault-r8-'));
    const envFile = path.join(tmpVaultDir, '.env');
    const managedKeys = [
        'JWT_SECRET',
        'SYNC_SECRET_KEY',
        'BACKUP_ENCRYPTION_KEY',
        'AUDIT_HMAC_SECRET',
        'GOOGLE_API_KEY',
        'SUPABASE_SERVICE_KEY',
        'SUPABASE_URL',
        'PORT'
    ];
    const savedEnv = {};
    for (const k of managedKeys) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }

    try {
        fs.writeFileSync(
            envFile,
            [
                '# Config heredada',
                'PORT=3005',
                'SUPABASE_URL=https://demo.supabase.local',
                'JWT_SECRET=migrated_jwt_secret_123456',
                'GOOGLE_API_KEY=migrated_ai_key_abcdef',
                'SUPABASE_SERVICE_KEY=migrated_supa_key_xyz'
            ].join('\n') + '\n',
            'utf8'
        );

        const firstRun = SecretVault.provisionAndLoadSecrets({
            baseDir: tmpVaultDir,
            requiredKeys: ['JWT_SECRET', 'SYNC_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'AUDIT_HMAC_SECRET'],
            candidateEnvPaths: [envFile],
            migrateEnvPaths: [envFile],
            stripMigratedEnv: true
        });

        assert.equal(firstRun.strippedFiles.length, 1);
        assert.equal(process.env.JWT_SECRET, 'migrated_jwt_secret_123456');
        assert.equal(process.env.GOOGLE_API_KEY, 'migrated_ai_key_abcdef');
        assert.equal(process.env.SUPABASE_SERVICE_KEY, 'migrated_supa_key_xyz');
        assert.equal(process.env.PORT, '3005');
        assert.equal(process.env.SUPABASE_URL, 'https://demo.supabase.local');
        assert.ok(process.env.SYNC_SECRET_KEY && process.env.SYNC_SECRET_KEY.length >= 64);

        const rawVault = fs.readFileSync(firstRun.vaultPath, 'utf8');
        const vaultJson = JSON.parse(rawVault);
        assert.equal(vaultJson.encrypted, true);
        assert.equal(rawVault.includes('migrated_jwt_secret_123456'), false, 'El secreto no debe aparecer en claro dentro de secrets.vault.json');
        assert.equal(rawVault.includes('migrated_ai_key_abcdef'), false);

        const strippedEnvText = fs.readFileSync(envFile, 'utf8');
        assert.equal(strippedEnvText.includes('JWT_SECRET'), false, 'JWT_SECRET debe eliminarse del .env en disco');
        assert.equal(strippedEnvText.includes('GOOGLE_API_KEY'), false, 'GOOGLE_API_KEY debe eliminarse del .env en disco');
        assert.equal(strippedEnvText.includes('SUPABASE_SERVICE_KEY'), false);
        assert.equal(strippedEnvText.includes('PORT=3005'), true, 'Variables no secretas deben conservarse en .env');
        assert.equal(strippedEnvText.includes('SUPABASE_URL=https://demo.supabase.local'), true);

        // Simular reinicio limpio en memoria y verificar carga desde bóveda cifrada
        const genSyncKey = process.env.SYNC_SECRET_KEY;
        for (const k of managedKeys) delete process.env[k];

        SecretVault.provisionAndLoadSecrets({
            baseDir: tmpVaultDir,
            requiredKeys: ['JWT_SECRET', 'SYNC_SECRET_KEY', 'BACKUP_ENCRYPTION_KEY', 'AUDIT_HMAC_SECRET'],
            candidateEnvPaths: [envFile],
            migrateEnvPaths: [envFile],
            stripMigratedEnv: true
        });

        assert.equal(process.env.JWT_SECRET, 'migrated_jwt_secret_123456');
        assert.equal(process.env.GOOGLE_API_KEY, 'migrated_ai_key_abcdef');
        assert.equal(process.env.SYNC_SECRET_KEY, genSyncKey);
        assert.equal(process.env.PORT, '3005');
    } finally {
        for (const k of managedKeys) {
            if (savedEnv[k] === undefined) delete process.env[k];
            else process.env[k] = savedEnv[k];
        }
        try { fs.rmSync(tmpVaultDir, { recursive: true, force: true }); } catch (_) {}
    }
});

test('R9. DbConfigManager migra esquema dpapi legado sin ReferenceError y routes/products carga con generateRobustId', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const Module = (await import('node:module')).default;
    const { spawnSync } = await import('node:child_process');

    // Cargar routes/products.js para verificar ausencia de errores de referencia al inicializar
    const productsRouter = require('../routes/products.js');
    assert.ok(productsRouter, 'routes/products debe cargar correctamente con generateRobustId importado');

    // Probar en subproceso aislado que DbConfigManager.getConfig() en modo no-test migra esquema 'dpapi' -> 'aes256gcm_dpapi'
    const tmpCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-dpapi-mig-'));
    const cfgPath = path.join(tmpCfgDir, 'db-config.json');
    fs.writeFileSync(
        cfgPath,
        JSON.stringify({
            mode: 'server',
            dialect: 'postgres',
            host: '127.0.0.1',
            port: 5432,
            database: 'americanpos_test',
            user: 'postgres',
            passwordEncrypted: true,
            passwordEncScheme: 'dpapi',
            passwordCipher: Buffer.from('LegacySecret#2026', 'utf8').toString('base64')
        }),
        'utf8'
    );

    const script = `
      const Module = require('module');
      const origLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'electron') {
          return {
            safeStorage: {
              isEncryptionAvailable: () => true,
              decryptString: (buf) => buf.toString('utf8'),
              encryptString: (s) => Buffer.from(s, 'utf8')
            }
          };
        }
        return origLoad.apply(this, arguments);
      };
      Object.defineProperty(process.versions, 'electron', { value: '31.4.0', configurable: true });
      const DbConfigManager = require(${JSON.stringify(path.resolve('config/dbConfigManager.js'))});
      const cfg = DbConfigManager.getConfig();
      console.log('MIGRATED_PASS_OK=' + (cfg.password === 'LegacySecret#2026'));
    `;

    try {
        const res = spawnSync(process.execPath, ['-e', script], {
            env: {
                ...process.env,
                USER_DATA_PATH: tmpCfgDir,
                ISAAC_TEST_ISOLATED: '',
                NODE_ENV: 'production',
                DB_CONFIG_KEY: '',
                FORCE_DPAPI_IN_TEST: '1'
            },
            encoding: 'utf8'
        });
        assert.equal(res.status, 0, `Subproceso de migración DPAPI falló: ${res.stderr || res.stdout}`);
        assert.match(res.stdout, /MIGRATED_PASS_OK=true/);
        const migratedJson = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (process.platform === 'win32') {
            assert.equal(migratedJson.passwordEncScheme, 'aes256gcm_dpapi', 'db-config.json legado dpapi debe migrar a aes256gcm_dpapi');
            assert.equal(fs.existsSync(path.join(tmpCfgDir, '.dbcfg.key.dpapi')), true, 'Debe generarse .dbcfg.key.dpapi al migrar');
        } else {
            assert.equal(migratedJson.passwordEncScheme, 'dpapi', 'Fuera de Windows no existe DPAPI nativo y debe preservarse sin corrupción');
        }
    } finally {
        try { fs.rmSync(tmpCfgDir, { recursive: true, force: true }); } catch (_) {}
    }
});
