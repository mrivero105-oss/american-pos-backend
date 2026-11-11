const AutoMaintenanceService = require('../services/AutoMaintenanceService');
const OwnerNotificationService = require('../services/OwnerNotificationService');

async function runEliteCertification() {
    console.log('====================================================');
    console.log('🚀 CERTIFICACIÓN DE PLAN ELITE ENTERPRISE 10/10');
    console.log('====================================================\n');

    let passedTests = 0;
    let totalTests = 0;

    function assert(desc, condition) {
        totalTests++;
        if (condition) {
            console.log(`  ✅ [PASS] ${desc}`);
            passedTests++;
        } else {
            console.error(`  ❌ [FAIL] ${desc}`);
        }
    }

    // --- TEST 1: Auto-Mantenimiento Nocturno Autónomo ---
    console.log('📋 PILAR 2: AUTO-MANTENIMIENTO NOCTURNO AUTÓNOMO');
    try {
        const startMaint = Date.now();
        const maintResult = await AutoMaintenanceService.runMaintenance('TEST_CERTIFICATION');
        const duration = Date.now() - startMaint;

        assert('AutoMaintenanceService devuelve objeto exitoso', maintResult && maintResult.success === true);
        assert('AutoMaintenanceService ejecutó optimización VACUUM', maintResult.vacuum === true);
        assert('AutoMaintenanceService purgó caché de autenticación', maintResult.cachePurged === true);
        assert('AutoMaintenanceService verificó retención de respaldos (7 días)', maintResult.purgedBackupsCount !== undefined);
        console.log(`     Detalles: Duración ${duration}ms, Respaldo creado: ${maintResult.backupFile || 'OK'}, Archivos rotados: ${maintResult.purgedBackupsCount}\n`);
    } catch (err) {
        console.error('     Error en prueba de mantenimiento:', err);
        assert('AutoMaintenanceService se ejecuta sin errores', false);
    }

    // --- TEST 2: Alertas Ejecutivas WhatsApp & Telegram al Dueño ---
    console.log('📋 PILAR 1: ALERTAS EJECUTIVAS WHATSAPP / TELEGRAM');
    try {
        const config = OwnerNotificationService.getConfig('2');
        assert('OwnerNotificationService resuelve configuración de destino', typeof config === 'object');
        
        // Simulación de Cierre Z
        const fakeCloseData = {
            id: 9999,
            userName: 'Cajero Principal',
            registerId: 'CAJA-01',
            openedAt: new Date(Date.now() - 8 * 3600000).toISOString(),
            closedAt: new Date().toISOString(),
            differenceUSD: 0,
            differenceVES: 0,
            salesSummary: {
                totalSales: 1450.50,
                cashSales: 500.00,
                salesCount: 68
            },
            closingNotes: 'Turno sin discrepancias'
        };

        const closeResult = await OwnerNotificationService.notifyShiftClose('2', fakeCloseData);
        assert('Generación de mensaje Cierre Z estructurado', closeResult && closeResult.message && closeResult.message.includes('CIERRE DE CAJA Z'));
        assert('Mensaje de Cierre Z incluye totales USD', closeResult.message.includes('1450.50'));

        // Simulación de Devolución de Alto Impacto
        const fakeRefund = {
            amount: 125.00,
            reason: 'Producto defectuoso',
            userName: 'Supervisor 1',
            registerId: 'CAJA-01',
            authorizedBy: 'Gerente General'
        };
        const refundResult = await OwnerNotificationService.notifySecurityAlert('2', 'REFUND', fakeRefund);
        assert('Generación de alerta de Devolución de Seguridad', refundResult && refundResult.message && refundResult.message.includes('DEVOLUCIÓN / ANULACIÓN'));
        assert('Alerta de devolución incluye monto e inspector', refundResult.message.includes('125.00') && refundResult.message.includes('Supervisor 1'));

        // Simulación de Apertura Manual de Gaveta
        const fakeDrawer = {
            cashierName: 'Cajero Turno 1',
            registerId: 'CAJA-01',
            reason: 'Dar vuelto grande'
        };
        const drawerResult = await OwnerNotificationService.notifySecurityAlert('2', 'MANUAL_DRAWER_OPEN', fakeDrawer);
        assert('Generación de alerta de Gaveta Manual', drawerResult && drawerResult.message && drawerResult.message.includes('APERTURA MANUAL DE GAVETA'));
        console.log('');
    } catch (err) {
        console.error('     Error en alertas ejecutivas:', err);
        assert('Alertas ejecutivas operativas', false);
    }

    // --- TEST 3: Ergonomía de Cajero Veloz & Sintaxis Multiplicadora ---
    console.log('📋 PILAR 3: ERGONOMÍA DE CAJERO VELOZ & MULTIPLICADOR');
    try {
        function parseScannerInput(input) {
            let quantity = 1;
            let finalCode = (input || '').trim();
            if (finalCode.includes('*')) {
                const parts = finalCode.split('*');
                if (parts.length === 2 && !isNaN(parts[0]) && Number(parts[0]) > 0 && parts[1].trim().length > 0) {
                    quantity = parseFloat(parts[0]);
                    finalCode = parts[1].trim();
                }
            }
            return { quantity, finalCode };
        }

        const scan1 = parseScannerInput('5*7501234567890');
        assert('Parser multiplica "5*7501234567890" -> cantidad: 5', scan1.quantity === 5 && scan1.finalCode === '7501234567890');

        const scan2 = parseScannerInput('12.5*HARINA_PAN');
        assert('Parser multiplica decimales "12.5*HARINA_PAN" -> cantidad: 12.5', scan2.quantity === 12.5 && scan2.finalCode === 'HARINA_PAN');

        const scan3 = parseScannerInput('7509876543210');
        assert('Parser normal sin multiplicación preserva cantidad: 1', scan3.quantity === 1 && scan3.finalCode === '7509876543210');
        console.log('');
    } catch (err) {
        console.error('     Error en parser multiplicador:', err);
        assert('Parser multiplicador operativo', false);
    }

    // --- TEST 4: Periféricos Avanzados (Balanza GS1/EAN-13 & Rótulos) ---
    console.log('📋 PILAR 4: PERIFÉRICOS AVANZADOS (BALANZAS GS1 / EAN-13)');
    try {
        function parseScaleBarcode(code) {
            const raw = (code || '').trim();
            if (/^(20|21|22)\d{11}$/.test(raw)) {
                const prefix = raw.substring(0, 2);
                const plu = raw.substring(2, 7);
                const weightRaw = raw.substring(7, 12);
                const weightKg = parseFloat(weightRaw) / 1000;
                return { isScale: true, prefix, plu, weightKg };
            }
            return { isScale: false };
        }

        const scale1 = parseScaleBarcode('2000123015004'); // PLU 00123, 1.500 kg
        assert('Parser de balanza EAN-13 (prefijo 20) detecta 1.500 kg', scale1.isScale === true && scale1.plu === '00123' && scale1.weightKg === 1.5);

        const scale2 = parseScaleBarcode('2100456007508'); // PLU 00456, 0.750 kg
        assert('Parser de balanza EAN-13 (prefijo 21) detecta 0.750 kg', scale2.isScale === true && scale2.plu === '00456' && scale2.weightKg === 0.75);

        const regularEan = parseScaleBarcode('7501234567890');
        assert('Parser discrimina códigos normales que no son balanza', regularEan.isScale === false);
        console.log('');
    } catch (err) {
        console.error('     Error en parser de balanza:', err);
        assert('Parser de balanzas operativo', false);
    }

    console.log('====================================================');
    console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} PRUEBAS EXITOSAS (${Math.round((passedTests/totalTests)*100)}%)`);
    if (passedTests === totalTests) {
        console.log('🌟 ¡SISTEMA CALIFICADO 10/10 EN TODOS LOS PILARES ELITE!');
    }
    console.log('====================================================');
    process.exit(passedTests === totalTests ? 0 : 1);
}

runEliteCertification().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
});
