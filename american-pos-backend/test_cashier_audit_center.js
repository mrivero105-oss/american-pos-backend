/**
 * test_cashier_audit_center.js
 * Certificación técnica del Centro de Control de Cajas y Auditoría de Cajeros
 */

const { sequelize } = require('./database/connection');
const { User, CashShift, CashMovement, CashDeclaration, Alert, AuditLog, Sale } = require('./database/models');
const CashService = require('./services/CashService');
const AlertService = require('./services/AlertService');

async function runCertification() {
    console.log('================================================================');
    console.log('🚀 INICIANDO CERTIFICACIÓN DE CONTROL DE CAJAS Y AUDITORÍA');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition, title, detail = '') => {
        if (condition) {
            passed++;
            console.log(`  ✅ [PASS] ${title} ${detail ? '(' + detail + ')' : ''}`);
        } else {
            failed++;
            console.error(`  ❌ [FAIL] ${title} ${detail ? '(' + detail + ')' : ''}`);
        }
    };

    try {
        // 1. Setup y Usuario de prueba
        console.log('--- 1. Verificación de Modelos y Datos de Prueba ---');
        let adminUser = await User.findOne({ where: { role: ['admin', 'superadmin'] } });
        if (!adminUser) {
            adminUser = await User.create({
                id: 'test-admin-audit',
                name: 'Gerente Auditor',
                username: 'gerente_audit',
                role: 'admin',
                companyId: 'default'
            });
        }
        const companyId = adminUser.companyId || 'default';

        let cashierUser = await User.findOne({ where: { username: 'test_cajero_1' } });
        if (!cashierUser) {
            cashierUser = await User.create({
                id: 'test-cajero-audit-1',
                name: 'Cajero Prueba 1',
                username: 'test_cajero_1',
                role: 'user',
                companyId
            });
        }
        assert(!!adminUser && !!cashierUser, 'Usuarios de prueba listos');

        // 2. Simulación de Apertura de Múltiples Cajas
        console.log('\n--- 2. Simulación de Apertura de Cajas Concurrentes ---');
        const testRegisterId = '99';
        // Limpiar turnos previos de prueba respetando llaves foráneas de PostgreSQL
        const oldShifts = await CashShift.findAll({ where: { registerId: testRegisterId, companyId }, attributes: ['id'] });
        const oldShiftIds = oldShifts.map(s => s.id);
        if (oldShiftIds.length > 0) {
            await CashMovement.destroy({ where: { shiftId: oldShiftIds } });
            await CashDeclaration.destroy({ where: { shiftId: oldShiftIds } });
            await CashShift.destroy({ where: { id: oldShiftIds } });
        }

        const openedShift = await CashService.openShift(cashierUser, {
            amount: 50.00,
            registerId: testRegisterId,
            registerName: 'Caja 99 - Auditoría',
            initialBreakdown: { cash: 50.00 }
        });
        assert(openedShift && openedShift.status === 'open', 'Apertura de turno en Caja 99 exitosa', `ID: ${openedShift.id}`);

        // 3. Simulación de Movimientos y Ventas
        console.log('\n--- 3. Registro de Movimientos de Caja (Retiro de Efectivo) ---');
        const withdrawal = await CashService.addMovement(cashierUser, {
            type: 'out',
            amount: 20.00,
            currency: 'USD',
            reason: 'Traspaso a Bóveda Central',
            shiftId: openedShift.id
        });
        assert(withdrawal && Number(withdrawal.amount) === 20.00, 'Retiro de efectivo registrado correctamente');

        // 4. Certificación del Dashboard Administrativo en Vivo
        console.log('\n--- 4. Certificación de getAdminLiveCashDashboard ---');
        const startTime = Date.now();
        const dashboard = await CashService.getAdminLiveCashDashboard(companyId);
        const queryDuration = Date.now() - startTime;

        assert(queryDuration < 500, 'Tiempo de respuesta del Dashboard ultrarrápido', `${queryDuration} ms`);
        assert(dashboard && dashboard.kpis, 'KPIs consolidados presentes en respuesta');
        assert(dashboard.kpis.openRegistersCount >= 1, 'Contador de cajas abiertas detecta Caja 99', `Total abiertas: ${dashboard.kpis.openRegistersCount}`);
        
        const register99 = dashboard.activeRegisters.find(r => r.registerId === testRegisterId);
        assert(!!register99, 'Caja 99 listada en la cuadrícula de terminales en vivo');
        if (register99) {
            assert(register99.userName === cashierUser.name, 'Cajero asignado verificado', register99.userName);
            assert(Number(register99.initialAmount) === 50, 'Base inicial correcta', `$${register99.initialAmount}`);
            assert(Number(register99.totalOut) === 20, 'Retiros detectados en tiempo real', `$${register99.totalOut}`);
            assert(Number(register99.expectedCashUsd) === 30, 'Dinero físico en gaveta calculado exactamente ($50 - $20)', `$${register99.expectedCashUsd}`);
        }

        assert(Array.isArray(dashboard.recentActivity), 'Feed de actividad en vivo generado');
        const movInFeed = dashboard.recentActivity.find(a => a.detail === 'Traspaso a Bóveda Central');
        assert(!!movInFeed, 'Retiro de Caja 99 aparece en el Live Stream de actividad');

        // 5. Certificación del Expediente 360° de Auditoría por Cajero
        console.log('\n--- 5. Certificación de getCashierAuditFile ---');
        // Crear una declaración con descuadre para verificar el cálculo de pureza y riesgo
        await CashDeclaration.create({
            id: 'decl-test-1',
            shiftId: openedShift.id,
            userId: cashierUser.id,
            companyId,
            declaredCashUSD: 28.00,
            expectedCashUSD: 30.00,
            differenceUSD: -2.00,
            differenceVES: 0.00,
            hash: 'hash-test-audit-123456'
        });

        const auditFile = await CashService.getCashierAuditFile(cashierUser.id, companyId);
        assert(auditFile && auditFile.cashier, 'Expediente del cajero obtenido correctamente');
        assert(auditFile.risk && auditFile.risk.level, 'Nivel de riesgo calculado para el cajero', `Nivel: ${auditFile.risk.level}`);
        assert(auditFile.summary && auditFile.summary.totalShifts >= 1, 'Total de turnos auditados contabilizado', `Turnos: ${auditFile.summary.totalShifts}`);
        assert(auditFile.summary.totalLossUsd >= 2.00, 'Pérdidas/faltantes acumulados registrados', `Faltante: $${auditFile.summary.totalLossUsd}`);
        assert(Array.isArray(auditFile.movements) && auditFile.movements.length >= 1, 'Historial de retiros del cajero incluido en expediente');
        assert(Array.isArray(auditFile.declarations) && auditFile.declarations.length >= 1, 'Declaraciones de cierre incluidas en expediente');

        // 6. Certificación de Cierre Forzado Remoto
        console.log('\n--- 6. Certificación de forceCloseShift ---');
        const forcedShift = await CashService.forceCloseShift(adminUser, openedShift.id, 'Prueba de abandono de puesto');
        assert(forcedShift.status === 'forced_closed', 'Turno cerrado con estado forced_closed');
        
        const auditLog = await AuditLog.findOne({
            where: { action: 'FORCE_CLOSE_SHIFT', entityId: openedShift.id }
        });
        assert(!!auditLog, 'Acción registrada en tabla AuditLog');

        const forcedAlert = await Alert.findOne({
            where: { type: 'forced_closed', userId: cashierUser.id }
        });
        assert(!!forcedAlert, 'Alerta de seguridad disparada y registrada en Alert table');

        // Limpieza
        await CashDeclaration.destroy({ where: { shiftId: openedShift.id } });
        await CashMovement.destroy({ where: { shiftId: openedShift.id } });
        await CashShift.destroy({ where: { id: openedShift.id } });
        if (forcedAlert) await Alert.destroy({ where: { id: forcedAlert.id } });
        if (auditLog) await AuditLog.destroy({ where: { id: auditLog.id } });

        console.log('\n================================================================');
        console.log(`📊 RESULTADO DE CERTIFICACIÓN:`);
        console.log(`   Pruebas Exitosas: ${passed}`);
        console.log(`   Pruebas Fallidas: ${failed}`);
        console.log('================================================================\n');

        if (failed === 0) {
            console.log('🏆 ¡BACKEND Y AUDITORÍA DE CAJAS 100% OPERATIVO Y CERTIFICADO!\n');
            process.exit(0);
        } else {
            console.error('❌ HUBO ERRORES EN LA CERTIFICACIÓN\n');
            process.exit(1);
        }

    } catch (err) {
        console.error('Error fatal en suite de pruebas:', err);
        process.exit(1);
    }
}

runCertification();
