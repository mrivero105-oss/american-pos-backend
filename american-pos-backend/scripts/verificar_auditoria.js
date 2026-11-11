// scripts/verificar_auditoria.js
// Herramienta CLI de Inspección Forense de Cadena de Bloques de Auditoría (Grado Bancario)
require('dotenv').config();
const crypto = require('crypto');
const { AuditLog } = require('../database/models');
const { sequelize } = require('../database/connection');

async function main() {
    console.log('\n================================================================================');
    console.log('🛡️  HERRAMIENTA FORENSE: VERIFICACIÓN DE AUDITORÍA CRIPTOGRÁFICA (HASH-CHAIN)');
    console.log('================================================================================\n');

    try {
        await sequelize.authenticate();
        console.log(' Conectado a la base de datos PostgreSQL exitosamente.');

        // Obtener empresas activas en los logs
        const distinctCompanies = await AuditLog.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('companyId')), 'companyId']]
        });

        const companyIds = distinctCompanies.map(c => c.companyId || 'default');

        if (companyIds.length === 0) {
            console.log('ℹ️ No existen registros de auditoría en la base de datos.');
            process.exit(0);
        }

        const secret = process.env.AUDIT_HMAC_SECRET || process.env.JWT_SECRET || 'isaac_secure_audit_ledger_2026';
        let totalAllLogs = 0;
        let totalHashedLogs = 0;
        let totalTampered = 0;

        for (const companyId of companyIds) {
            console.log(`\n🏢 Inspeccionando Empresa / Tenant ID: [${companyId}]`);
            console.log('--------------------------------------------------------------------------------');

            const logs = await AuditLog.findAll({
                where: { companyId },
                order: [['createdAt', 'ASC']]
            });

            totalAllLogs += logs.length;
            let expectedPrevHash = 'GENESIS_BLOCK_0000000000000000';
            let companyTampered = 0;
            let companyHashed = 0;
            const tamperedList = [];

            for (const log of logs) {
                if (log.recordHash) {
                    companyHashed++;
                    totalHashedLogs++;
                    let isTampered = false;
                    let reason = '';

                    if (log.previousHash !== expectedPrevHash) {
                        isTampered = true;
                        reason = `Ruptura de enlace en la cadena. Esperado: ${expectedPrevHash.substring(0, 16)}..., Encontrado: ${log.previousHash.substring(0, 16)}...`;
                    }

                    const payload = `${log.previousHash}|${log.userId || ''}|${companyId}|${log.action || ''}|${log.description || ''}|${log.entityId || ''}|${log.oldValue || ''}|${log.newValue || ''}|${log.timestamp || ''}`;
                    const recalculated = crypto.createHmac('sha256', secret).update(payload).digest('hex');

                    if (recalculated !== log.recordHash) {
                        isTampered = true;
                        reason = (reason ? reason + ' | ' : '') + 'Firma digital HMAC alterada. Registro manipulado directamente en BD.';
                    }

                    if (isTampered) {
                        companyTampered++;
                        totalTampered++;
                        tamperedList.push({ id: log.id, action: log.action, reason, createdAt: log.createdAt });
                    }

                    expectedPrevHash = log.recordHash;
                } else {
                    // Registro previo a la activación del estándar bancario
                    expectedPrevHash = 'GENESIS_BLOCK_0000000000000000';
                }
            }

            console.log(` -> Total Registros en Historial:     ${logs.length}`);
            console.log(` -> Registros Firmados con Hash-Chain: ${companyHashed}`);
            console.log(` -> Registros Alterados / Falsos:     ${companyTampered}`);

            if (companyTampered === 0) {
                console.log(' ✅ ESTADO:                           100% ÍNTEGRO (CADENA VÁLIDA)');
                if (companyHashed > 0) {
                    console.log(`    Último Hash del Ledger:          ${expectedPrevHash.substring(0, 32)}...`);
                }
            } else {
                console.log(' 🚨 ESTADO:                           ALERTA DE MANIPULACIÓN DETECTADA');
                tamperedList.forEach(t => {
                    console.log(`    ⚠️ [${t.createdAt.toISOString()}] ID: ${t.id} - ${t.action}`);
                    console.log(`       Causa: ${t.reason}`);
                });
            }
        }

        console.log('\n================================================================================');
        console.log(`📊 RESUMEN GLOBAL DEL SISTEMA:`);
        console.log(`   Total Logs Analizados:   ${totalAllLogs}`);
        console.log(`   Total Logs Certificados: ${totalHashedLogs}`);
        console.log(`   Violaciones Detectadas:  ${totalTampered}`);
        console.log(`   Certificación Forense:   ${totalTampered === 0 ? '✅ APROBADO (100% INTACTO)' : '❌ RECHAZADO'}`);
        console.log('================================================================================\n');

        process.exit(totalTampered === 0 ? 0 : 1);
    } catch (error) {
        console.error('❌ Error ejecutando verificación forense:', error);
        process.exit(1);
    }
}

main();
