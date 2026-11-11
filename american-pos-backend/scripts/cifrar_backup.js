// scripts/cifrar_backup.js
// Herramienta CLI para Cifrar Copias de Seguridad con AES-256-GCM Grado Bancario
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const backupEncryptionService = require('../services/BackupEncryptionService');

async function main() {
    console.log('\n================================================================================');
    console.log('🔐 HERRAMIENTA DE CIFRADO CRIPTOGRÁFICO DE RESPALDOS (AES-256-GCM)');
    console.log('================================================================================\n');

    const userDataPath = process.env.USER_DATA_PATH;
    const backupDirs = [
        userDataPath ? path.join(userDataPath, 'backups') : null,
        userDataPath ? path.join(userDataPath, 'auto-backups') : null,
        path.join(process.cwd(), 'backups'),
        path.join(process.cwd(), 'auto-backups')
    ].filter(d => d && fs.existsSync(d));

    // Obtener todos los archivos de respaldo
    let availableFiles = [];
    for (const dir of backupDirs) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (['.zip', '.sql', '.json'].includes(ext)) {
                const fullPath = path.join(dir, file);
                const stats = fs.statSync(fullPath);
                const isEncrypted = fs.existsSync(fullPath + '.enc') || backupEncryptionService.isEncrypted(fullPath);
                availableFiles.push({
                    name: file,
                    fullPath,
                    sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                    mtime: stats.mtime,
                    isEncrypted
                });
            }
        }
    }

    if (availableFiles.length === 0) {
        console.log('ℹ️ No se encontraron archivos de respaldo PostgreSQL (.zip, .sql, .json) en las carpetas de backups.');
        process.exit(0);
    }

    // Ordenar del más reciente al más antiguo
    availableFiles.sort((a, b) => b.mtime - a.mtime);

    const targetArg = process.argv[2];

    if (!targetArg) {
        console.log('📋 RESPALDOS ENCONTRADOS:\n');
        availableFiles.forEach((f, idx) => {
            const status = f.isEncrypted ? '🔐 [Ya Cifrado .enc]' : '🔓 [Sin Cifrar]';
            console.log(`  [${idx + 1}] ${f.name} (${f.sizeMB} MB) - ${status}`);
        });

        console.log('\n💡 CÓMO USAR:');
        console.log('   Para cifrar el respaldo más reciente:');
        console.log(`   node scripts/cifrar_backup.js "${availableFiles[0].name}"\n`);
        console.log('   O especifica el nombre de cualquiera de la lista anterior.');
        console.log('================================================================================\n');
        process.exit(0);
    }

    // Buscar el archivo especificado
    const selected = availableFiles.find(f => f.name.toLowerCase() === targetArg.toLowerCase() || f.name.toLowerCase().includes(targetArg.toLowerCase()));

    if (!selected) {
        console.error(`❌ No se encontró ningún respaldo que coincida con "${targetArg}".`);
        console.log('Ejecuta "node scripts/cifrar_backup.js" para ver la lista de archivos disponibles.');
        process.exit(1);
    }

    const outputPath = selected.fullPath + '.enc';
    console.log(`🔒 Cifrando archivo:  ${selected.name}`);
    console.log(`📁 Ruta de origen:    ${selected.fullPath}`);
    console.log(`🛡️  Ruta de destino:   ${outputPath}`);
    console.log(`⏳ Aplicando AES-256-GCM (PBKDF2 100,000 iteraciones + AuthTag 128-bit)...`);

    try {
        const result = backupEncryptionService.encryptFile(selected.fullPath, outputPath);
        console.log('\n✅ ¡RESPALDO CIFRADO CON ÉXITO!');
        console.log(`   Archivo Cifrado:   ${path.basename(result.outputPath)}`);
        console.log(`   Tamaño Cifrado:    ${(result.encryptedSize / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`   Algoritmo:         AES-256-GCM`);
        console.log(`   Firma de Header:   ISAAC_SEC_BK1`);
        console.log('   Nota: Este archivo no podrá ser leído ni restaurado sin la clave maestra de seguridad.\n');
        console.log('================================================================================\n');
    } catch (err) {
        console.error('❌ Error al cifrar el archivo:', err.message);
        process.exit(1);
    }
}

main();
