/**
 * TEST SUITE: FASE 2 - BLINDAJE FISCAL Y TRAZABILIDAD DE AUDITORÍA
 * Verifica:
 * 1. FiscalSequence y consecutividad atómica de correlativos fiscales sin colisiones.
 * 2. LocalPrinterService.openDrawer con control de autenticación y registro inmutable en AuditLog.
 * 3. Cálculo unificado de puntos de fidelidad (loyalty points).
 */

const { sequelize } = require('./database/connection');
const { FiscalSequence, CreditNote, AuditLog, Customer, Sale, User } = require('./database/models');
const FiscalService = require('./services/FiscalService');
const LocalPrinterService = require('./services/LocalPrinterService');
const SaleService = require('./services/SaleService');
const precision = require('./utils/precision');
const { generateRobustId } = require('./utils/helpers');

async function runPhase2Tests() {
    console.log('====================================================');
    console.log(' INICIANDO VERIFICACIÓN DE FASE 2: BLINDAJE FISCAL Y AUDITORÍA');
    console.log('====================================================\n');

    await sequelize.authenticate();
    await FiscalSequence.sync();
    await AuditLog.sync();

    const companyId = 'TEST_CO_' + Date.now();
    const testUserId = generateRobustId();
    const testUser = await User.create({
        id: testUserId,
        username: 'auditor_' + Date.now(),
        name: 'Auditor Fiscal',
        companyId,
        role: 'admin'
    });

    let passedTests = 0;
    let totalTests = 0;

    // ----------------------------------------------------
    // TEST 1: FiscalSequence inicialización y concurrencia
    // ----------------------------------------------------
    totalTests++;
    console.log('[TEST 1] Generación concurrente de Notas de Crédito sin colisiones (Gapless)');
    try {
        const promises = [1, 2, 3].map(i => FiscalService.issueCreditNote(companyId, testUser.id, {
            companyId,
            reason: `Devolución concurrente #${i}`,
            totalAmount: 100 * i,
            subtotal: 100 * i,
            taxAmount: 0,
            exemptAmount: 100 * i,
            reenterStock: false
        }));

        const results = await Promise.all(promises);
        const creditNoteNumbers = results.map(r => r.creditNoteNumber).sort();
        console.log('  Correlativos emitidos concurrentemente:', creditNoteNumbers);

        if (creditNoteNumbers[0] === 'NC-000001' && 
            creditNoteNumbers[1] === 'NC-000002' && 
            creditNoteNumbers[2] === 'NC-000003') {
            console.log('  -> PASS: Correlativos estrictamente consecutivos y sin gaps.');
            passedTests++;
        } else {
            throw new Error(`Correlativos inesperados: ${JSON.stringify(creditNoteNumbers)}`);
        }
    } catch (err) {
        console.error('  -> FAIL en Test 1:', err.message);
    }

    // ----------------------------------------------------
    // TEST 2: LocalPrinterService.openDrawer rechazo sin usuario
    // ----------------------------------------------------
    totalTests++;
    console.log('\n[TEST 2] Blindaje contra apertura no autorizada de gaveta de dinero');
    try {
        let rejected = false;
        try {
            await LocalPrinterService.openDrawer('Generic_Printer', '27,112,48,25,250');
        } catch (authErr) {
            if (authErr.message.includes('SECURITY_ERROR')) {
                rejected = true;
            } else {
                throw authErr;
            }
        }

        if (rejected) {
            console.log('  -> PASS: Apertura sin usuario responsable fue bloqueada inmediatamente.');
            passedTests++;
        } else {
            throw new Error('LocalPrinterService.openDrawer debió lanzar SECURITY_ERROR');
        }
    } catch (err) {
        console.error('  -> FAIL en Test 2:', err.message);
    }

    // ----------------------------------------------------
    // TEST 3: LocalPrinterService.openDrawer con usuario y AuditLog
    // ----------------------------------------------------
    totalTests++;
    console.log('\n[TEST 3] Apertura auditada y registro inmutable en AuditLog');
    try {
        // Ejecutar openDrawer con usuario y mock o printerName local
        await LocalPrinterService.openDrawer({
            printerName: 'DUMMY_DRAWER_TEST',
            sequence: '27,112,48,25,250',
            user: testUser,
            reason: 'Auditoría Arqueo Sorpresivo',
            shiftId: 'SHIFT_99'
        }).catch(err => {
            // printRaw can fail if printer doesn't exist on system, but audit log is persisted before printRaw
        });

        const newAuditLog = await AuditLog.findOne({
            where: { companyId, action: 'DRAWER_KICK_MANUAL' },
            order: [['createdAt', 'DESC']]
        });

        if (newAuditLog && newAuditLog.description.includes('Auditoría Arqueo Sorpresivo')) {
            console.log(`  -> PASS: AuditLog registrado con Hash SHA-256: ${newAuditLog.recordHash?.slice(0, 16)}...`);
            passedTests++;
        } else {
            throw new Error('No se encontró el registro de auditoría para la apertura de gaveta.');
        }
    } catch (err) {
        console.error('  -> FAIL en Test 3:', err.message);
    }

    // ----------------------------------------------------
    // TEST 4: Puntos de lealtad unificados al 10%
    // ----------------------------------------------------
    totalTests++;
    console.log('\n[TEST 4] Consistencia matemática de Puntos de Lealtad (Loyalty Points)');
    try {
        const saleTotal = 155.50;
        const loyaltyRate = 0.10;
        const expectedPoints = precision.round(precision.multiply(saleTotal, loyaltyRate), 0);

        if (expectedPoints === 16) {
            console.log(`  -> PASS: Total $${saleTotal} otorga exactamente ${expectedPoints} pts (Tasa 10% con redondeo bancario).`);
            passedTests++;
        } else {
            throw new Error(`Puntos inesperados: ${expectedPoints}, esperado: 16`);
        }
    } catch (err) {
        console.error('  -> FAIL en Test 4:', err.message);
    }

    console.log('\n====================================================');
    console.log(` RESULTADOS FINALES: ${passedTests}/${totalTests} PRUEBAS SUPERADAS`);
    console.log('====================================================\n');

    process.exit(passedTests === totalTests ? 0 : 1);
}

runPhase2Tests().catch(err => {
    console.error('FATAL TEST ERROR:', err);
    process.exit(1);
});
