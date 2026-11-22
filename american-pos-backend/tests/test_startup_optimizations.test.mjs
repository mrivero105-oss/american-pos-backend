import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-startup-test-'));
process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';
process.env.USER_DATA_PATH = isolatedUserDataDir;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'st-jwt-' + crypto.randomBytes(24).toString('hex');
process.env.SYNC_SECRET_KEY = process.env.SYNC_SECRET_KEY || 'st-sync-' + crypto.randomBytes(24).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'st-bk-' + crypto.randomBytes(24).toString('hex');
process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'st-aud-' + crypto.randomBytes(24).toString('hex');

const require = createRequire(import.meta.url);
const axios = require('axios');
const { sequelize, connectDB } = require('../database/connection');
const { runPostConnectMigrations } = require('../database/schemaMigrator');
const { ensurePostgresRunning } = require('../utils/postgresLauncher');
const WhatsappBotService = require('../services/WhatsappBotService');
const SupabaseSyncService = require('../services/SupabaseSyncService');
const SyncOutbox = require('../database/models/SyncOutbox');
const { startServer } = require('../index');
const autoLaunchManager = require('../utils/autoLaunchManager');

after(async () => {
    try {
        await WhatsappBotService.shutdown();
    } catch (_) {}
    try {
        await sequelize.close();
    } catch (_) {}
    try {
        fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('Startup 1 — ensurePostgresRunning cachea verificación reciente en local', async () => {
    const ok1 = await ensurePostgresRunning();
    assert.equal(ok1, true);
    const t0 = Date.now();
    const ok2 = await ensurePostgresRunning();
    const elapsedMs = Date.now() - t0;
    assert.equal(ok2, true);
    assert.ok(elapsedMs < 50, `La verificación cacheada debe resolver rápido (${elapsedMs}ms)`);
});

test('Startup 2 — schemaMigrator usa fast-path verificado en arranques posteriores', async () => {
    await connectDB();
    const t0 = Date.now();
    await runPostConnectMigrations(sequelize, 'postgres');
    const elapsedMs = Date.now() - t0;
    assert.ok(elapsedMs < 1500, `El fast-path de runPostConnectMigrations debe completar rápido (${elapsedMs}ms)`);
});

test('Startup 3 — WhatsappBotService omite auto-inicio si nunca se vinculó sesión', async () => {
    await WhatsappBotService.init('2', { autoStart: true });
    assert.equal(WhatsappBotService.status, 'DISCONNECTED');
    assert.equal(WhatsappBotService.client, null);
    const stateFile = path.join(isolatedUserDataDir, '.wwebjs_auth', '.session_state.json');
    assert.equal(fs.existsSync(stateFile), true);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.linked, false);
});

test('Startup 4 — SupabaseSyncService consolida mutaciones duplicadas en el lote para evitar error 21000', async () => {
    const origUrl = SupabaseSyncService.supabaseUrl;
    const origKey = SupabaseSyncService.serviceKey;
    const origIsoCheck = SupabaseSyncService._isRealCloudTargetInIsolatedEnv;
    const origPost = axios.post;

    const sentPayloads = [];
    const prodId = `startup-dedup-${Date.now()}`;
    try {
        SupabaseSyncService.supabaseUrl = 'http://mock.supabase.local';
        SupabaseSyncService.serviceKey = 'mock-key';
        SupabaseSyncService._isRealCloudTargetInIsolatedEnv = () => false;
        axios.post = async (url, body) => {
            sentPayloads.push({ url, body });
            return { status: 201, data: [] };
        };

        await SyncOutbox.bulkCreate([
            { entity_name: 'products', entity_id: prodId, operation: 'UPSERT', payload: { id: prodId, nombre: 'P-1', precio_venta: 1 }, status: 'PENDING' },
            { entity_name: 'products', entity_id: prodId, operation: 'UPSERT', payload: { id: prodId, nombre: 'P-2', precio_venta: 2 }, status: 'PENDING' }
        ]);

        const res = await SupabaseSyncService.processBatch(50);
        assert.equal(res.success, true);

        const cloudProdCalls = sentPayloads.filter((p) => p.url.endsWith('/cloud_productos'));
        assert.equal(cloudProdCalls.length, 1);
        const targetEntries = cloudProdCalls[0].body.filter((r) => r.id === prodId);
        assert.equal(targetEntries.length, 1);
        assert.equal(targetEntries[0].nombre, 'P-2');

        const syncedRows = await SyncOutbox.findAll({ where: { entity_id: prodId } });
        assert.equal(syncedRows.length, 2);
        assert.ok(syncedRows.every((r) => r.status === 'SYNCED'));
    } finally {
        axios.post = origPost;
        SupabaseSyncService.supabaseUrl = origUrl;
        SupabaseSyncService.serviceKey = origKey;
        SupabaseSyncService._isRealCloudTargetInIsolatedEnv = origIsoCheck;
        await SyncOutbox.destroy({ where: { entity_id: prodId } }).catch(() => {});
    }
});

test('Startup 5 — startServer y stopServer completan el ciclo de vida sin errores', async () => {
    const handle = await startServer([0], isolatedUserDataDir);
    assert.ok(handle.mainPort > 0);
    await handle.dbInitPromise;
    await handle.stopServer();
});

test('Startup 6 — WhatsappBotService promueve sesión INITIALIZING de autoStart sin reiniciar Chrome ni emitir QR sin DataURL', async () => {
    let destroyCalls = 0;
    const emittedStatuses = [];
    const origIo = global.io;
    global.io = {
        to: () => ({
            emit: (event, payload) => {
                if (event === 'whatsapp_status') emittedStatuses.push(payload);
            }
        })
    };

    try {
        WhatsappBotService.client = {
            destroy: async () => { destroyCalls += 1; }
        };
        WhatsappBotService.companyId = '2';
        WhatsappBotService.status = 'INITIALIZING';
        WhatsappBotService._isAutoStartRun = true;
        WhatsappBotService.maxQrAttempts = 4;

        const res = await WhatsappBotService.init('2');
        assert.equal(destroyCalls, 0, 'No debe destruir un Chrome que ya está inicializando cuando el usuario presiona Conectar');
        assert.equal(WhatsappBotService._isAutoStartRun, false, 'Debe promover _isAutoStartRun a false para entregar el QR al usuario');
        assert.equal(WhatsappBotService.maxQrAttempts, 12);
        assert.equal(res.status, 'INITIALIZING');
        assert.ok(emittedStatuses.length >= 1);

        // Simulando QR listo: si llega status QR_READY debe traer su qrCodeUrl si se usa init completo, o limpiarse en logout
        await WhatsappBotService.logout();
        assert.equal(destroyCalls, 1);
        assert.equal(WhatsappBotService.status, 'DISCONNECTED');
        assert.equal(WhatsappBotService.qrCodeUrl, null);
    } finally {
        global.io = origIo;
    }
});

test('Startup 7 — _pruneChromeBloatCache elimina cachés pesados de Chromium pero conserva IndexedDB y Local Storage', () => {
    const authRoot = path.join(isolatedUserDataDir, '.wwebjs_auth');
    const codeCacheFile = path.join(authRoot, 'session', 'Default', 'Code Cache', 'js', 'dummy.bin');
    const crxFile = path.join(authRoot, 'session', 'component_crx_cache', 'crx.bin');
    const indexedDbFile = path.join(authRoot, 'session', 'Default', 'IndexedDB', 'wa.ldb');
    const localStorageFile = path.join(authRoot, 'session', 'Default', 'Local Storage', 'leveldb', '000003.log');

    for (const f of [codeCacheFile, crxFile, indexedDbFile, localStorageFile]) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'test-data', 'utf8');
    }

    WhatsappBotService._pruneChromeBloatCache(authRoot, { includeServiceWorkerCache: false });

    assert.equal(fs.existsSync(codeCacheFile), false, 'Code Cache debe podarse');
    assert.equal(fs.existsSync(crxFile), false, 'component_crx_cache debe podarse');
    assert.equal(fs.existsSync(indexedDbFile), true, 'IndexedDB de WhatsApp Web debe preservarse');
    assert.equal(fs.existsSync(localStorageFile), true, 'Local Storage de WhatsApp Web debe preservarse');
});

test('Startup 8 — autoLaunchManager elevado usa Tarea Programada HighestAvailable idempotente y limpia Run PID 0', async () => {
    const exePath = 'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS Modern\\Isaac POS Modern.exe';
    const calls = [];
    let createdXml = '';
    const fakeExec = async (cmd, args) => {
        calls.push({ cmd, args: [...args] });
        if (cmd === 'reg.exe' && args[0] === 'query' && args[1] === autoLaunchManager.RUN_REG_KEY) {
            return {
                ok: true,
                stdout: `    Isaac POS    REG_SZ    "${exePath}"\r\n    American POS    REG_SZ    "C:\\Old\\app.exe"\r\n`,
                stderr: ''
            };
        }
        if (cmd === 'schtasks.exe' && args[0] === '/Query' && args.includes('/XML')) {
            if (!createdXml) return { ok: false, stdout: '', stderr: 'not found' };
            return { ok: true, stdout: createdXml, stderr: '' };
        }
        if (cmd === 'whoami.exe') {
            return { ok: true, stdout: 'SID\r\nS-1-5-21-1000-1001\r\n', stderr: '' };
        }
        if (cmd === 'schtasks.exe' && args[0] === '/Create') {
            const xmlPath = args[args.indexOf('/XML') + 1];
            createdXml = fs.readFileSync(xmlPath, 'utf16le').replace(/^\uFEFF/, '');
            return { ok: true, stdout: 'OK', stderr: '' };
        }
        return { ok: true, stdout: '', stderr: '' };
    };

    const res1 = await autoLaunchManager.configureWindowsAutoLaunch(true, {
        userDataPath: isolatedUserDataDir,
        isPackaged: true,
        processExecPath: exePath,
        isElevatedOverride: true,
        execFn: fakeExec
    });
    assert.equal(res1.success, true);
    assert.equal(res1.mechanism, 'scheduled_task');
    assert.ok(createdXml.includes('<LogonTrigger>'));
    assert.ok(createdXml.includes('<RunLevel>HighestAvailable</RunLevel>'));
    assert.ok(createdXml.includes('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'));
    assert.ok(createdXml.includes(`<Command>${exePath}</Command>`));

    // Verificar que limpió tanto American POS como Isaac POS del registro HKCU\Run
    assert.ok(calls.some(c => c.cmd === 'reg.exe' && c.args[0] === 'delete' && c.args.includes('American POS')));
    assert.ok(calls.some(c => c.cmd === 'reg.exe' && c.args[0] === 'delete' && c.args.includes('Isaac POS')));

    // Segunda llamada debe ser idempotente (no recrear tarea si el XML ya coincide)
    const createCountBefore = calls.filter(c => c.cmd === 'schtasks.exe' && c.args[0] === '/Create').length;
    const res2 = await autoLaunchManager.configureWindowsAutoLaunch(true, {
        userDataPath: isolatedUserDataDir,
        isPackaged: true,
        processExecPath: exePath,
        isElevatedOverride: true,
        execFn: fakeExec
    });
    assert.equal(res2.mechanism, 'scheduled_task');
    const createCountAfter = calls.filter(c => c.cmd === 'schtasks.exe' && c.args[0] === '/Create').length;
    assert.equal(createCountAfter, createCountBefore);

    // Estado leído debe reportar true gracias a la tarea programada
    const active = await autoLaunchManager.getWindowsAutoLaunchStatus({
        userDataPath: isolatedUserDataDir,
        execFn: fakeExec
    });
    assert.equal(active, true);
});

test('Startup 9 — autoLaunchManager sin elevación usa HKCU Run y desactivar elimina tarea y registro', async () => {
    const exePath = 'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS\\Isaac POS.exe';
    const calls = [];
    let hasTask = true;
    let hasRun = false;

    const fakeExec = async (cmd, args) => {
        calls.push({ cmd, args: [...args] });
        if (cmd === 'reg.exe' && args[0] === 'query' && args[1] === autoLaunchManager.RUN_REG_KEY) {
            return {
                ok: hasRun,
                stdout: hasRun ? `    Isaac POS    REG_SZ    "${exePath}"\r\n` : '',
                stderr: ''
            };
        }
        if (cmd === 'reg.exe' && args[0] === 'add') {
            hasRun = true;
            return { ok: true, stdout: 'OK', stderr: '' };
        }
        if (cmd === 'reg.exe' && args[0] === 'delete') {
            hasRun = false;
            return { ok: true, stdout: 'OK', stderr: '' };
        }
        if (cmd === 'schtasks.exe' && args[0] === '/Query') {
            return hasTask ? { ok: true, stdout: '<LogonTrigger></LogonTrigger>', stderr: '' } : { ok: false, stdout: '', stderr: '' };
        }
        if (cmd === 'schtasks.exe' && args[0] === '/Delete') {
            hasTask = false;
            return { ok: true, stdout: 'OK', stderr: '' };
        }
        return { ok: true, stdout: '', stderr: '' };
    };

    const resEnable = await autoLaunchManager.configureWindowsAutoLaunch(true, {
        userDataPath: isolatedUserDataDir,
        isPackaged: true,
        processExecPath: exePath,
        isElevatedOverride: false,
        execFn: fakeExec
    });
    assert.equal(resEnable.success, true);
    assert.equal(resEnable.mechanism, 'hkcu_run');
    assert.equal(hasRun, true);

    const resDisable = await autoLaunchManager.configureWindowsAutoLaunch(false, {
        userDataPath: isolatedUserDataDir,
        isPackaged: true,
        processExecPath: exePath,
        execFn: fakeExec
    });
    assert.equal(resDisable.success, true);
    assert.equal(resDisable.enabled, false);
    assert.equal(hasTask, false);
    assert.equal(hasRun, false);
});

test('Startup 10 — WhatsappBotService aísla whatsapp-web.js en proceso worker IPC con crash-recovery acotado', async () => {
    // 1. Verificar que whatsapp-web.js NO está cargado en el proceso principal
    const loadedWwebjs = Object.keys(require.cache).some((k) => k.includes('whatsapp-web.js') || k.includes(`${path.sep}puppeteer`));
    assert.equal(loadedWwebjs, false, 'whatsapp-web.js/puppeteer no debe cargarse en el proceso Express principal');

    // 2. Verificar que whatsappWorker.js carga correctamente como módulo (sintaxis e imports válidos)
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const workerModulePath = path.resolve(__dirname, '../services/whatsappWorker.js');
    assert.equal(fs.existsSync(workerModulePath), true);

    // 3. Crear script worker IPC de prueba en directorio aislado para ejercitar ciclo completo y crash recovery
    const fakeWorkerPath = path.join(isolatedUserDataDir, 'fake_wa_worker.cjs');
    const spawnLogPath = path.join(isolatedUserDataDir, 'fake_wa_spawns.log');
    fs.writeFileSync(fakeWorkerPath, `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(spawnLogPath)}, 'spawn\\n');
process.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'init') {
        process.send({ type: 'status_update', status: 'CONNECTED', qrCodeUrl: null, lastError: null, companyId: msg.companyId });
        process.send({ type: 'rpc_result', reqId: msg.reqId, ok: true, data: { status: 'CONNECTED' } });
        setTimeout(() => {
            process.send({
                type: 'incoming_consolidated',
                msgRefId: 'ref-1',
                senderChat: '584121234567@c.us',
                bodyText: 'quiero hablar con un humano',
                hasMedia: false,
                msgType: 'chat'
            });
        }, 40);
        return;
    }
    if (msg.type === 'ai_reply_command') {
        fs.appendFileSync(${JSON.stringify(spawnLogPath)}, 'ai_reply:' + msg.senderChat + '\\n');
        process.send({ type: 'rpc_result', reqId: msg.reqId, ok: true, data: { sent: true, sentIds: ['id-ai-1'] } });
        return;
    }
    if (msg.type === 'send_direct') {
        process.send({
            type: 'rpc_result',
            reqId: msg.reqId,
            ok: true,
            data: { sentIds: ['id-dir-1'], response: { success: true, botSent: true, phone: msg.cleanPhone, chatId: msg.chatId } }
        });
        return;
    }
    if (msg.type === 'send_media') {
        process.send({
            type: 'rpc_result',
            reqId: msg.reqId,
            ok: true,
            data: { sentIds: ['id-med-1'], response: { success: true, botSent: true, botConnected: true, phone: msg.cleanPhone } }
        });
        // Simular caída abrupta tras responder para probar crash-recovery
        setTimeout(() => process.exit(1), 40);
        return;
    }
    if (msg.type === 'shutdown' || msg.type === 'logout') {
        process.send({ type: 'rpc_result', reqId: msg.reqId, ok: true, data: { status: 'DISCONNECTED' } });
        setTimeout(() => process.exit(0), 10);
    }
});
process.send({ type: 'worker_ready' });
`, 'utf8');

    const origBackoff = WhatsappBotService.crashBackoffStepsMs;
    const origMaxRestarts = WhatsappBotService.maxCrashRestarts;
    try {
        WhatsappBotService.crashBackoffStepsMs = [50, 80, 100];
        WhatsappBotService.maxCrashRestarts = 2;

        const initRes = await WhatsappBotService.init('2', { forceRestart: true, workerScriptPath: fakeWorkerPath });
        assert.equal(initRes.status, 'CONNECTED');

        const directRes = await WhatsappBotService.sendDirectMessage('04121234567', 'Hola proveedor');
        assert.equal(directRes.botSent, true);
        assert.equal(WhatsappBotService.botSentMessageIds.has('id-dir-1'), true);

        const mediaRes = await WhatsappBotService.sendMediaMessage('04121234567', 'AAAA', 'image/png', 'Factura');
        assert.equal(mediaRes.botSent, true);
        assert.equal(WhatsappBotService.botSentMessageIds.has('id-med-1'), true);

        // Esperar a que procese incoming_consolidated, caiga por exit(1) y se recupere en nuevo worker
        await new Promise((r) => setTimeout(r, 350));
        const logContent = fs.readFileSync(spawnLogPath, 'utf8');
        const spawns = logContent.split('\n').filter((l) => l === 'spawn');
        assert.ok(spawns.length >= 2, `El supervisor debe haber reiniciado el worker tras el crash (${spawns.length} spawns)`);
        assert.ok(logContent.includes('ai_reply:584121234567@c.us'), 'El mensaje entrante debe manejarse en el padre y enviarse por IPC al worker');
    } finally {
        await WhatsappBotService.shutdown();
        WhatsappBotService.crashBackoffStepsMs = origBackoff;
        WhatsappBotService.maxCrashRestarts = origMaxRestarts;
    }
});

test('Startup 11 — cleanStalePid jamás elimina postmaster.pid cuando Windows devuelve EPERM o tasklist detecta postgres.exe', () => {
    const { cleanStalePid } = require('../utils/postgresLauncher');
    const fakePgDir = path.join(isolatedUserDataDir, 'fake_pg_data');
    fs.mkdirSync(fakePgDir, { recursive: true });
    const pidPath = path.join(fakePgDir, 'postmaster.pid');

    // Caso A: tasklist muestra postgres.exe vivo (p.ej. servicio NetworkService) -> no borrar aunque kill lance EPERM
    fs.writeFileSync(pidPath, '11996\nC:/Program Files/PostgreSQL/16/data\n', 'utf8');
    const removedLive = cleanStalePid(fakePgDir, {
        platform: 'win32',
        killFn: () => { const err = new Error('EPERM'); err.code = 'EPERM'; throw err; },
        execFileSyncFn: () => '"postgres.exe","11996","Services","0","25,000 K"'
    });
    assert.equal(removedLive, false);
    assert.equal(fs.existsSync(pidPath), true, 'postmaster.pid activo bajo otro usuario no debe eliminarse');

    // Caso B: tasklist falla y killFn devuelve EPERM -> fail-safe conservando postmaster.pid
    const removedEperm = cleanStalePid(fakePgDir, {
        platform: 'win32',
        killFn: () => { const err = new Error('EPERM'); err.code = 'EPERM'; throw err; },
        execFileSyncFn: () => { throw new Error('tasklist timeout'); }
    });
    assert.equal(removedEperm, false);
    assert.equal(fs.existsSync(pidPath), true, 'EPERM en process.kill indica proceso vivo en el kernel');

    // Caso C: PID muerto real (no está en tasklist y killFn devuelve ESRCH) -> sí limpia pidfile huérfano
    const removedDead = cleanStalePid(fakePgDir, {
        platform: 'win32',
        killFn: () => { const err = new Error('ESRCH'); err.code = 'ESRCH'; throw err; },
        execFileSyncFn: () => 'INFO: No tasks are running which match the specified criteria.'
    });
    assert.equal(removedDead, true);
    assert.equal(fs.existsSync(pidPath), false, 'postmaster.pid huérfano muerto sí debe limpiarse');
});

test('Startup 12 — dpapiCrypto usa sidecar Electron safeStorage sin lanzar PowerShell en arranques repetidos', () => {
    const dpapiCrypto = require('../utils/dpapiCrypto');
    const Module = require('node:module');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-dpapi-ess-'));
    const keyPath = path.join(tmpDir, '.secrets.key.dpapi');
    const sidecarPath = `${keyPath}.ess`;
    const sampleKeyHex = crypto.randomBytes(32).toString('hex');
    const fakeDpapiBlob = Buffer.from('FAKE_DPAPI_BLOB_V1').toString('base64');
    fs.writeFileSync(keyPath, fakeDpapiBlob, 'utf8');

    const dpapiSha256 = crypto.createHash('sha256').update(fakeDpapiBlob, 'utf8').digest('hex');
    let decryptCalls = 0;

    const origLoad = Module._load;
    const origElectronVer = Object.getOwnPropertyDescriptor(process.versions, 'electron');
    try {
        Object.defineProperty(process.versions, 'electron', { value: '31.4.0', configurable: true });
        Module._load = function (request, parent, isMain) {
            if (request === 'electron') {
                return {
                    safeStorage: {
                        isEncryptionAvailable: () => true,
                        encryptString: (s) => Buffer.from(`ESS:${s}`, 'utf8'),
                        decryptString: (buf) => {
                            decryptCalls += 1;
                            const raw = Buffer.from(buf).toString('utf8');
                            return raw.startsWith('ESS:') ? raw.slice(4) : raw;
                        }
                    }
                };
            }
            return origLoad.apply(this, arguments);
        };

        fs.writeFileSync(sidecarPath, JSON.stringify({
            v: 1,
            dpapiSha256,
            essB64: Buffer.from(`ESS:${sampleKeyHex}`, 'utf8').toString('base64')
        }), 'utf8');

        dpapiCrypto.resetDpapiCacheForTests();
        const t0 = Date.now();
        const loaded = dpapiCrypto.getOrCreateSharedDpapiAesKey(keyPath, { allowCreate: false });
        const elapsedMs = Date.now() - t0;

        assert.ok(loaded && loaded.length === 32);
        assert.equal(loaded.toString('hex'), sampleKeyHex);
        assert.equal(decryptCalls, 1, 'Debe leer vía Electron safeStorage sidecar sin invocar PowerShell');
        assert.ok(elapsedMs < 100, `Sidecar DPAPI debe resolver en < 100ms (tomó ${elapsedMs}ms)`);
    } finally {
        Module._load = origLoad;
        if (origElectronVer) {
            Object.defineProperty(process.versions, 'electron', origElectronVer);
        } else {
            delete process.versions.electron;
        }
        dpapiCrypto.resetDpapiCacheForTests();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Startup 13 — hardwareIdentity deduplica llamadas concurrentes y usa sello rápido .hwid_sticky.fast sin PowerShell', async () => {
    const HardwareIdentityCtor = require('../utils/hardware-id').constructor;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-hwid-fast-'));
    const prevUd = process.env.USER_DATA_PATH;
    try {
        process.env.USER_DATA_PATH = tmpDir;
        const instance = new HardwareIdentityCtor();
        const fakeHwid = 'POS-12345678-ABCD-EF01-2345-6789ABCDEF01';
        const fakeGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        fs.writeFileSync(instance.hwidPath, fakeHwid, 'utf8');
        fs.writeFileSync(instance.sigPath, instance.computeSealSignature(fakeHwid, 'REAL-SMBIOS-UUID'), 'utf8');
        fs.writeFileSync(instance.fastSigPath, instance.computeFastSealSignature(fakeHwid, fakeGuid), 'utf8');

        let wmiCalls = 0;
        let regCalls = 0;
        instance._getMachineUUIDDetailed = async () => {
            wmiCalls += 1;
            return { uuid: 'REAL-SMBIOS-UUID', isReliable: true, timedOut: false };
        };
        instance.getFastMachineGuid = async () => {
            regCalls += 1;
            await new Promise((r) => setTimeout(r, 15));
            return fakeGuid;
        };

        const results = await Promise.all([
            instance.getStableNetId(),
            instance.getStableNetId(),
            instance.getStableNetId()
        ]);

        assert.deepEqual(results, [fakeHwid, fakeHwid, fakeHwid]);
        assert.equal(wmiCalls, 0, 'Con sello rápido válido no debe invocar PowerShell/WMI');
        assert.equal(regCalls, 1, 'Llamadas concurrentes deben deduplicarse en una sola consulta en vuelo');
    } finally {
        process.env.USER_DATA_PATH = prevUd;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('Startup 14 — index.js, routes/publicAi y routes/products mantienen lazy loading de exceljs, puppeteer y @google/generative-ai', () => {
    const { spawnSync } = require('node:child_process');
    const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const probeScript = `
        const path = require('path');
        require(${JSON.stringify(path.join(backendRoot, 'index.js'))});
        require(${JSON.stringify(path.join(backendRoot, 'routes/publicAi.js'))});
        require(${JSON.stringify(path.join(backendRoot, 'routes/products.js'))});
        const keys = Object.keys(require.cache);
        console.log('__PROBE_JSON__=' + JSON.stringify({
            hasExcel: keys.some((k) => k.includes(path.sep + 'exceljs' + path.sep)),
            hasPuppeteer: keys.some((k) => k.includes(path.sep + 'puppeteer')),
            hasGenAi: keys.some((k) => k.includes('@google' + path.sep + 'generative-ai'))
        }));
    `;
    const res = spawnSync(process.execPath, ['-e', probeScript], {
        env: { ...process.env, ISAAC_TEST_ISOLATED: '1', NODE_ENV: 'test', DISABLE_BACKGROUND_WORKERS: 'true' },
        encoding: 'utf8'
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const probeLine = String(res.stdout || '').split(/\r?\n/).find((l) => l.startsWith('__PROBE_JSON__='));
    assert.ok(probeLine, `Salida inesperada sin __PROBE_JSON__: ${res.stdout}`);
    const parsed = JSON.parse(probeLine.slice('__PROBE_JSON__='.length));
    assert.equal(parsed.hasExcel, false, 'exceljs no debe cargarse al importar index/products');
    assert.equal(parsed.hasPuppeteer, false, 'puppeteer no debe cargarse al importar index/products');
    assert.equal(parsed.hasGenAi, false, '@google/generative-ai no debe cargarse al importar index/publicAi/products');
});
