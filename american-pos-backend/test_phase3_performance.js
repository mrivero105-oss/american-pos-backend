/**
 * TEST SUITE: FASE 3 - OPTIMIZACIÓN DE HARDWARE Y RENDIMIENTO
 * 1. Verificación de binario RawPrinter.exe y latencia ultrabaja.
 * 2. Simulación bidireccional ESC/POS y drenado de red en NetworkPrinterService.
 * 3. Verificación de índices compuestos estratégicos en PostgreSQL.
 * 4. Mitigación de forking en la cadena HMAC de AuditLog ante concurrencia.
 */

const net = require('net');
const path = require('path');
const fs = require('fs');
const { sequelize } = require('./database/connection');
const { AuditLog, User } = require('./database/models');
const LocalPrinterService = require('./services/LocalPrinterService');
const NetworkPrinterService = require('./services/NetworkPrinterService');
const { generateRobustId } = require('./utils/helpers');

async function runPhase3Tests() {
    console.log('====================================================');
    console.log(' INICIANDO VERIFICACIÓN DE FASE 3: HARDWARE Y RENDIMIENTO');
    console.log('====================================================\n');

    await sequelize.authenticate();
    let passedTests = 0;
    let totalTests = 0;

    // ----------------------------------------------------
    // TEST 1: Verificación de binario compilado RawPrinter.exe
    // ----------------------------------------------------
    totalTests++;
    console.log('[TEST 1] Existencia y verificación de binario nativo RawPrinter.exe');
    try {
        const binPath = path.resolve(__dirname, './bin/RawPrinter.exe');
        if (!fs.existsSync(binPath)) {
            throw new Error(`No se encontró el ejecutable nativo en ${binPath}`);
        }
        const stat = fs.statSync(binPath);
        console.log(`  -> Binario presente en: ${binPath} (${stat.size} bytes)`);

        // Test timeout / error handling en printRaw sin impresora válida
        const startTime = Date.now();
        let caughtErr = null;
        try {
            await LocalPrinterService.printRaw(Buffer.from([27, 64]), 'NON_EXISTENT_PRINTER_9999');
        } catch (err) {
            caughtErr = err;
        }
        const duration = Date.now() - startTime;
        console.log(`  -> Ejecución completada en ${duration}ms (Respuesta de error Win32 sin bloquear Node.js)`);

        if (stat.size > 0 && caughtErr && duration < 3500) {
            console.log('  -> PASS: Binario nativo operativo con latencia de fallo controlada (< 3.5s).');
            passedTests++;
        } else {
            throw new Error('Fallo en verificación de RawPrinter.exe o duración excesiva.');
        }
    } catch (err) {
        console.error('  -> FAIL en Test 1:', err.message);
    }

    // ----------------------------------------------------
    // TEST 2: NetworkPrinterService - DLE EOT Bidireccional & Drenado
    // ----------------------------------------------------
    totalTests++;
    console.log('\n[TEST 2] NetworkPrinterService - Detección de falta de papel (DLE EOT 4: 0x60)');
    try {
        // Crear un mock de impresora de red que simula papel agotado (0x60)
        const mockPort = 9198;
        const mockServer = net.createServer((socket) => {
            socket.on('data', (data) => {
                // Si recibe DLE EOT 4 (0x10, 0x04, 0x04), responder con 0x60 (PAPER_OUT)
                if (data.length >= 3 && data[0] === 0x10 && data[1] === 0x04 && data[2] === 0x04) {
                    socket.write(Buffer.from([0x60]));
                }
            });
        });

        await new Promise(r => mockServer.listen(mockPort, '127.0.0.1', r));

        let paperOutDetected = false;
        try {
            await NetworkPrinterService.printNetwork('127.0.0.1', mockPort, Buffer.from('TEST TICKET'));
        } catch (printErr) {
            if (printErr.message.includes('PAPER_OUT')) {
                paperOutDetected = true;
            } else {
                throw printErr;
            }
        } finally {
            mockServer.close();
        }

        if (paperOutDetected) {
            console.log('  -> PASS: Estado de falta de papel (PAPER_OUT) detectado e interceptado antes de imprimir.');
            passedTests++;
        } else {
            throw new Error('NetworkPrinterService no detectó la condición PAPER_OUT');
        }
    } catch (err) {
        console.error('  -> FAIL en Test 2:', err.message);
    }

    totalTests++;
    console.log('\n[TEST 3] NetworkPrinterService - Transmisión exitosa con drenado de red');
    try {
        // Mock de impresora normal (responde 0x00 OK a DLE EOT)
        const mockPortOk = 9197;
        let bytesReceived = 0;
        const mockServerOk = net.createServer((socket) => {
            socket.on('data', (data) => {
                if (data.length >= 3 && data[0] === 0x10 && data[1] === 0x04 && data[2] === 0x04) {
                    socket.write(Buffer.from([0x00])); // Papel OK
                } else {
                    bytesReceived += data.length;
                }
            });
        });

        await new Promise(r => mockServerOk.listen(mockPortOk, '127.0.0.1', r));

        const testTicket = Buffer.from('--- RECIBO FISCAL PRUEBA DE RED ---\nTOTAL: $50.00\nGRACIAS POR SU COMPRA\n');
        const printResult = await NetworkPrinterService.printNetwork('127.0.0.1', mockPortOk, testTicket);
        mockServerOk.close();

        if (printResult.success && bytesReceived >= testTicket.length) {
            console.log(`  -> PASS: Ticket transmitido con éxito (${bytesReceived} bytes drenados sin cortes).`);
            passedTests++;
        } else {
            throw new Error(`Fallo en transmisión de ticket. Resultado: ${JSON.stringify(printResult)}`);
        }
    } catch (err) {
        console.error('  -> FAIL en Test 3:', err.message);
    }

    // ----------------------------------------------------
    // TEST 4: Mitigación de Forking en la Cadena HMAC de AuditLog
    // ----------------------------------------------------
    totalTests++;
    console.log('\n[TEST 4] Integridad de la cadena HMAC de AuditLog bajo operaciones transaccionales');
    try {
        const companyId = 'AUDIT_CHAIN_CO_' + Date.now();
        const testUser = await User.create({
            id: generateRobustId(),
            username: 'chain_auditor_' + Date.now(),
            companyId,
            role: 'admin'
        });

        // Generar 3 registros secuenciales en transacciones separadas
        const logs = [];
        for (let i = 1; i <= 3; i++) {
            const log = await sequelize.transaction(async (t) => {
                return await AuditLog.create({
                    id: generateRobustId(),
                    userId: testUser.id,
                    companyId,
                    action: `ACTION_STEP_${i}`,
                    description: `Transacción auditada #${i}`,
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            });
            logs.push(log);
        }

        console.log('  Bloque 1 Hash:', logs[0].recordHash.slice(0, 16) + '... (Prev: ' + logs[0].previousHash.slice(0, 13) + ')');
        console.log('  Bloque 2 Hash:', logs[1].recordHash.slice(0, 16) + '... (Prev: ' + logs[1].previousHash.slice(0, 16) + '...)');
        console.log('  Bloque 3 Hash:', logs[2].recordHash.slice(0, 16) + '... (Prev: ' + logs[2].previousHash.slice(0, 16) + '...)');

        const block2PointsToBlock1 = logs[1].previousHash === logs[0].recordHash;
        const block3PointsToBlock2 = logs[2].previousHash === logs[1].recordHash;

        if (block2PointsToBlock1 && block3PointsToBlock2) {
            console.log('  -> PASS: Encadenamiento criptográfico continuo sin bifurcaciones (anti-forking verificado).');
            passedTests++;
        } else {
            throw new Error('Bifurcación en la cadena de auditoría detectada.');
        }
    } catch (err) {
        console.error('  -> FAIL en Test 4:', err.message);
    }

    // ----------------------------------------------------
    // TEST 5: Índices Compuestos Estratégicos en PostgreSQL
    // ----------------------------------------------------
    totalTests++;
    console.log('\n[TEST 5] Verificación de Índices Compuestos en Catálogo de PostgreSQL');
    try {
        const [rows] = await sequelize.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE schemaname = 'public' 
              AND indexname IN (
                  'idx_products_company_barcode',
                  'idx_sales_company_createdat',
                  'idx_saleitems_saleid',
                  'idx_cashmovements_shiftid',
                  'idx_auditlogs_company_createdat'
              );
        `);

        const foundIndexes = rows.map(r => r.indexname);
        console.log('  Índices estratégicos encontrados en PostgreSQL:', foundIndexes);

        if (foundIndexes.length === 5) {
            console.log('  -> PASS: Los 5 índices compuestos estratégicos están activos y verificados en PostgreSQL.');
            passedTests++;
        } else {
            throw new Error(`Se esperaban 5 índices, se encontraron ${foundIndexes.length}: ${JSON.stringify(foundIndexes)}`);
        }
    } catch (err) {
        console.error('  -> FAIL en Test 5:', err.message);
    }

    console.log('\n====================================================');
    console.log(` RESULTADOS FINALES: ${passedTests}/${totalTests} PRUEBAS SUPERADAS`);
    console.log('====================================================\n');

    process.exit(passedTests === totalTests ? 0 : 1);
}

runPhase3Tests().catch(err => {
    console.error('FATAL TEST ERROR:', err);
    process.exit(1);
});
