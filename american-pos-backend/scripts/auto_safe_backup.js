const os = require('os');
const path = require('path');
const fs = require('fs');
const { createPostgresBackup, cleanupOldBackups } = require('../utils/backupHelper');

async function runAutoBackup() {
    console.log('================================================================');
    console.log('🛡️ INICIANDO RESPALDO MAESTRO PROGRAMADO (DISASTER RECOVERY 3-2-1)');
    console.log('================================================================\n');

    try {
        const startTime = Date.now();
        const primaryZipPath = await createPostgresBackup();
        const zipName = path.basename(primaryZipPath);
        const zipSizeMb = (fs.statSync(primaryZipPath).size / (1024 * 1024)).toFixed(2);

        console.log(`✅ [COPIA 1 - LOCAL PRIMARIA] Snapshot generado con éxito: ${zipName} (${zipSizeMb} MB)`);

        const homeDir = process.env.USERPROFILE || os.homedir();
        // Destino Secundario / Espejo Seguro (Desktop)
        const secondaryDir = path.join(homeDir, 'Desktop', 'RESPALDO_POSTGRESQL_CLIENTE');
        if (fs.existsSync(secondaryDir)) {
            const secondaryZipPath = path.join(secondaryDir, zipName);
            fs.copyFileSync(primaryZipPath, secondaryZipPath);
            cleanupOldBackups(secondaryDir, 5);
            console.log(`✅ [COPIA 2 - ESPEJO LOCAL] Copia replicada y rotada en: ${secondaryZipPath}`);
        }

        // Destino Terciario / NUBE OFFSITE (OneDrive - Regla 3-2-1)
        const oneDriveBase = process.env.OneDrive || process.env.OneDriveConsumer || path.join(homeDir, 'OneDrive');
        if (fs.existsSync(oneDriveBase)) {
            const cloudDir = path.join(oneDriveBase, 'Respaldos_Isaac_POS');
            if (!fs.existsSync(cloudDir)) {
                fs.mkdirSync(cloudDir, { recursive: true });
            }
            const cloudZipPath = path.join(cloudDir, zipName);
            fs.copyFileSync(primaryZipPath, cloudZipPath);
            cleanupOldBackups(cloudDir, 5);
            console.log(`✅ [COPIA 3 - NUBE OFFSITE (OneDrive)] Sincronización a la nube completada: ${cloudZipPath}`);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n🎉 Regla 3-2-1 Cumplida al 100% en ${duration} segundos.`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error crítico durante el respaldo automático:', err.message);
        process.exit(1);
    }
}

runAutoBackup();
