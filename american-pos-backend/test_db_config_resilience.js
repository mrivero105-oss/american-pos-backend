const fs = require('fs');
const path = require('path');
const DbConfigManager = require('./config/dbConfigManager');

async function runResilienceTests() {
    console.log('🧪 ========================================================');
    console.log('🧪 ISAAC POS: TEST DE RESILIENCIA Y CONEXIÓN DINÁMICA');
    console.log('🧪 ========================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, testName, extra = '') {
        if (condition) {
            console.log(`✅ [PASS] ${testName} ${extra}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${testName} ${extra}`);
            failed++;
        }
    }

    // TEST 1: Carga de Configuración
    try {
        const config = DbConfigManager.getConfig();
        assert(config && config.dialect && config.host, 'Test 1: DbConfigManager.getConfig() devuelve configuración válida', `(${config.host}:${config.port})`);
    } catch (e) {
        assert(false, 'Test 1: DbConfigManager.getConfig() falló con excepción', e.message);
    }

    // TEST 2: Guardado Atómico en AppData
    try {
        const testPayload = {
            mode: 'server',
            dialect: 'postgres',
            host: '127.0.0.1',
            port: 5432,
            database: 'americanpos',
            user: 'postgres',
            password: 'postgres'
        };
        const saveRes = DbConfigManager.saveConfig(testPayload);
        assert(saveRes.success === true, 'Test 2: DbConfigManager.saveConfig() guardó correctamente');

        const reloaded = DbConfigManager.getConfig();
        assert(reloaded.host === '127.0.0.1' && reloaded.port === 5432, 'Test 2.1: Configuración recargada coincide con lo guardado');
        assert(process.env.DB_HOST === '127.0.0.1', 'Test 2.2: process.env.DB_HOST sincronizado');
    } catch (e) {
        assert(false, 'Test 2: Guardado en AppData falló con excepción', e.message);
    }

    // TEST 3: Prueba de Conexión a Servidor Local PostgreSQL Activo
    try {
        const tStart = Date.now();
        const testRes = await DbConfigManager.testConnection({ host: '127.0.0.1', port: 5432 });
        const elapsed = Date.now() - tStart;
        assert(testRes.success === true, 'Test 3: testConnection(127.0.0.1:5432) exitosa', `(en ${elapsed}ms: ${testRes.message})`);
    } catch (e) {
        assert(false, 'Test 3: testConnection(127.0.0.1) arrojó excepción no controlada', e.message);
    }

    // TEST 4: Prueba Resiliente de Timeout ante Servidor Inaccesible
    try {
        const tStart = Date.now();
        console.log('⏳ Test 4: Verificando timeout corto ante IP inalcanzable (192.168.254.254:5432)...');
        const testRes = await DbConfigManager.testConnection({ host: '192.168.254.254', port: 5432 });
        const elapsed = Date.now() - tStart;
        assert(testRes.success === false, 'Test 4: testConnection() detectó fallo limpiamente sin colapsar', `(Código: ${testRes.code}, tiempo: ${elapsed}ms)`);
        assert(elapsed <= 4500, 'Test 4.1: Timeout controlado en menos de 4.5 segundos');
    } catch (e) {
        assert(false, 'Test 4: testConnection() arrojó excepción no controlada en vez de objeto seguro', e.message);
    }

    // TEST 5: Existencia de Vista server-setup.html
    const setupHtmlPath = path.join(__dirname, 'public', 'server-setup.html');
    assert(fs.existsSync(setupHtmlPath), 'Test 5: public/server-setup.html existe físicamente en el backend');

    if (fs.existsSync(setupHtmlPath)) {
        const content = fs.readFileSync(setupHtmlPath, 'utf8');
        assert(content.includes('testDbConnection') && content.includes('saveDbConfigAndRestart'), 'Test 5.1: server-setup.html contiene llamadas IPC correspondientes');
        assert(content.includes('btnRoleServer') && content.includes('btnRoleClient'), 'Test 5.2: server-setup.html soporta roles Servidor y Terminal');
    }

    // TEST 6: Verificación de Preload.js
    const preloadPath = path.join(__dirname, 'preload.js');
    if (fs.existsSync(preloadPath)) {
        const pContent = fs.readFileSync(preloadPath, 'utf8');
        assert(pContent.includes('getDbConfig') && pContent.includes('testDbConnection') && pContent.includes('saveDbConfigAndRestart'), 'Test 6: preload.js expone todas las APIs de configuración al frontend');
    }

    console.log('\n========================================================');
    console.log(`RESULTADO DE TESTS: ${passed} PASADOS, ${failed} FALLIDOS`);
    console.log('========================================================');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runResilienceTests();
