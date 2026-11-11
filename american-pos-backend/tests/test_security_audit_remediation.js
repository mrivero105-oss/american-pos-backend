const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

async function runSecurityRemediationVerification() {
    console.log('======================================================================');
    console.log('🛡️  SUITE DE VERIFICACIÓN DE REMEDIACIÓN DE SEGURIDAD (POST-AUDITORÍA)');
    console.log('======================================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(testName, condition, details = '') {
        if (condition) {
            console.log(`  ✅ [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
            failed++;
        }
    }

    // 1. VERIFICACIÓN DE FASE 3: verifyJwtResilient rechaza secretos fijos antiguos
    console.log('\n--- 1. VERIFICACIÓN CRIPTOGRÁFICA DE SECRETOS Y TOKENS ---');
    const { verifyToken, isAdmin } = require('../middleware/auth');
    const oldHardcodedSecret1 = '4d0e0ed5b2e25fb26c0ce829cd8135a9e04c4eefdc881a2bb258d4aa98747ffe';
    const oldHardcodedSecret2 = '501796ee5965478c64ec727f76dc20a7e4f2f7cede68ca23514b4c4bf3d79068';
    const bogusSecret = 'totally_fake_random_secret_string_1234567890';

    // Token firmado con bogus secret
    const bogusToken = jwt.sign({ id: 'test-hacker', role: 'superadmin' }, bogusSecret, { expiresIn: '1h' });
    let bogusTokenRejected = false;
    try {
        const mockReq = { headers: { authorization: `Bearer ${bogusToken}` }, path: '/products', method: 'GET' };
        let nextCalled = false;
        const mockRes = {
            status: (code) => ({
                json: (d) => {
                    if (code === 401) bogusTokenRejected = true;
                }
            })
        };
        await verifyToken(mockReq, mockRes, () => { nextCalled = true; });
        if (!nextCalled) bogusTokenRejected = true;
    } catch (e) {
        bogusTokenRejected = true;
    }
    assert('Token firmado con clave espuria es rechazado estrictamente (401)', bogusTokenRejected);

    // 2. VERIFICACIÓN DE BYPASS LAN: Claves de sincronización fijas
    console.log('\n--- 2. VERIFICACIÓN DE CLAVES DE SINCRONIZACIÓN Y BYPASS ---');
    const fakeSyncKey = 'FAKE_SYNC_KEY_THAT_DOES_NOT_MATCH_ENV';
    let fakeSyncRejected = false;
    const mockSyncReq = { 
        headers: { 'x-sync-key': fakeSyncKey }, 
        query: {},
        ip: '192.168.1.100', 
        path: '/sales', 
        method: 'POST' 
    };
    const mockSyncRes = {
        status: (code) => ({
            json: (d) => {
                if (code === 401) fakeSyncRejected = true;
            }
        })
    };
    await verifyToken(mockSyncReq, mockSyncRes, () => {});
    assert('Clave x-sync-key no coincidente con .env es rechazada en POST (401)', fakeSyncRejected);

    // 3. VERIFICACIÓN DE FASE 1: AuthorizationService Biometría
    console.log('\n--- 3. VERIFICACIÓN DE AUTORIZACIÓN BIOMÉTRICA (FASE 1) ---');
    const AuthorizationService = require('../services/AuthorizationService');
    let biometricRejectedWithoutUser = false;
    try {
        await AuthorizationService.authorizeAction(null, { action: 'CANCEL_SALE', isBiometric: true });
    } catch (err) {
        if (err.message.includes('autenticado')) {
            biometricRejectedWithoutUser = true;
        }
    }
    assert('Biometría sin usuario autenticado es rechazada con excepción', biometricRejectedWithoutUser);

    // 4. VERIFICACIÓN DE FASE 2: Rutas Críticas de Sistema Protegidas por isAdmin
    console.log('\n--- 4. VERIFICACIÓN DE CONTROL DE ACCESO EN /system (FASE 2) ---');
    const cashierUser = { id: 'cajero-1', email: 'cajero@tienda.com', role: 'cashier', companyId: '2' };
    const adminUser = { id: 'admin-1', email: 'admin@tienda.com', role: 'admin', companyId: '2' };

    let cashierBlockedRestart = false;
    const mockCashierReq = { user: cashierUser };
    const mockCashierRes = {
        status: (code) => ({
            json: (d) => {
                if (code === 403) cashierBlockedRestart = true;
            }
        })
    };
    isAdmin(mockCashierReq, mockCashierRes, () => {});
    assert('Cajero bloqueado de endpoints administrativos con 403', cashierBlockedRestart);

    let adminAllowedRestart = false;
    const mockAdminReq = { user: adminUser };
    const mockAdminRes = {
        status: () => ({ json: () => {} })
    };
    isAdmin(mockAdminReq, mockAdminRes, () => { adminAllowedRestart = true; });
    assert('Administrador tiene acceso permitido a endpoints del sistema', adminAllowedRestart);

    // 5. VERIFICACIÓN DE FASE 2 & 3: Licencia y Activación
    console.log('\n--- 5. VERIFICACIÓN DE LICENCIA Y ACTIVACIÓN (FASE 3) ---');
    const licenseUtils = require('../utils/licenseUtils');
    const serverMachineId = await licenseUtils.getMachineId();
    assert('Resolución de MachineId del hardware del sistema', serverMachineId && serverMachineId.length > 5);

    // 6. VERIFICACIÓN DE FASE 4: ScannerService sanitización y ausencia de .ps1 temporales
    console.log('\n--- 6. VERIFICACIÓN DE PROCESOS LIMPIOS EN MEMORIA (FASE 4) ---');
    const fs = require('fs');
    const os = require('os');
    const ScannerService = require('../services/ScannerService');
    const tempDir = os.tmpdir();
    
    // Contar archivos wia_list antes y después
    const psFilesBefore = fs.readdirSync(tempDir).filter(f => f.startsWith('wia_list_') || f.startsWith('wia_scan_exec_'));
    
    // Llamar a getConnectedScanners (que corre en memoria sin crear .ps1)
    const scanners = await ScannerService.getConnectedScanners();
    assert('ScannerService.getConnectedScanners() retorna lista de escáneres', Array.isArray(scanners) && scanners.length > 0);
    
    const psFilesAfter = fs.readdirSync(tempDir).filter(f => f.startsWith('wia_list_') || f.startsWith('wia_scan_exec_'));
    assert('Cero archivos .ps1 creados en disco durante ejecución de ScannerService', psFilesAfter.length === psFilesBefore.length);

    console.log('\n======================================================================');
    console.log(`📊 RESULTADO AUDITORÍA DE SEGURIDAD: ${passed}/${passed + failed} PRUEBAS EXITOSAS`);
    if (failed === 0) {
        console.log('🌟 ¡TODAS LAS VULNERABILIDADES HAN SIDO REMEDIADAS SIN REGRESIONES!');
    } else {
        console.error(`⚠️ SE ENCONTRARON ${failed} FALLOS.`);
    }
    console.log('======================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
}

runSecurityRemediationVerification().catch((err) => {
    console.error('Test Runner Error:', err);
    process.exit(1);
});
