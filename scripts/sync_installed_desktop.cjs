/**
 * sync_installed_desktop.cjs
 * Script atómico y automatizado para compilar y desplegar Isaac POS hacia la aplicación instalada en Windows.
 * Utiliza el API nativo de @electron/asar directamente en Node.js.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'american-pos-frontend');
const BACKEND_DIR = path.join(PROJECT_ROOT, 'american-pos-backend');
const INSTALLED_DIR = 'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS Modern\\resources';
const TEMP_EXTRACTED = 'C:\\Users\\mrive\\AppData\\Local\\Temp\\isaac_asar_extracted';

const asar = require(path.join(BACKEND_DIR, 'node_modules/@electron/asar'));

async function main() {
    console.log('🚀 [DEPLOY] Iniciando despliegue atómico a Isaac POS Modern...');
    const startTime = Date.now();

    // 1. Compilar Frontend
    console.log('📦 [1/4] Compilando frontend (Vite)...');
    execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });

    // 2. Sincronizar fuentes con la carpeta de staging
    console.log('🔄 [2/4] Sincronizando bundle y backend en área de staging...');
    if (!fs.existsSync(TEMP_EXTRACTED)) {
        fs.mkdirSync(TEMP_EXTRACTED, { recursive: true });
    }

    // Copiar public desde dist
    const distDir = path.join(FRONTEND_DIR, 'dist');
    const stagingPublic = path.join(TEMP_EXTRACTED, 'public');
    fs.cpSync(distDir, stagingPublic, { recursive: true, force: true });

    // Copiar carpetas clave del backend
    const backendFiles = ['routes', 'services', 'database', 'utils', 'middleware', 'controllers'];
    for (const folder of backendFiles) {
        const srcFolder = path.join(BACKEND_DIR, folder);
        const destFolder = path.join(TEMP_EXTRACTED, folder);
        if (fs.existsSync(srcFolder)) {
            fs.cpSync(srcFolder, destFolder, { recursive: true, force: true });
        }
    }

    // 3. Empaquetar asar en archivo temporal .new usando API nativa
    console.log('🗜️ [3/4] Empaquetando nuevo app.asar con @electron/asar (API Nativa)...');
    const targetAsar = path.join(INSTALLED_DIR, 'app.asar');
    const targetNewAsar = path.join(INSTALLED_DIR, 'app.asar.new');

    await asar.createPackageWithOptions(TEMP_EXTRACTED, targetNewAsar, {
        unpack: '{**/*.node,**/bin/**,**/scripts/**}'
    });

    // 4. Reemplazo atómico con backup
    console.log('🛡️ [4/4] Aplicando nuevo app.asar de forma atómica...');
    if (fs.existsSync(targetAsar)) {
        const backupPath = path.join(INSTALLED_DIR, `app.asar.bak_deploy_${Date.now()}`);
        try {
            fs.copyFileSync(targetAsar, backupPath);
            console.log(`✔ Respaldo generado: ${path.basename(backupPath)}`);
        } catch (copyErr) {
            console.warn(`⚠ No se pudo generar copia previa (posible archivo en uso): ${copyErr.message}`);
        }
    }

    try {
        fs.renameSync(targetNewAsar, targetAsar);
    } catch (renameErr) {
        if (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY') {
            console.error('\n⚠️ [AVISO DE BLOQUEO DE ARCHIVO]');
            console.error('La aplicación "Isaac POS Modern" está abierta en este momento.');
            console.error('El paquete actualizado ya está listo en: "resources/app.asar.new".');
            console.error('Por favor cierra la aplicación en pantalla para que se pueda reemplazar el archivo "app.asar".');
            throw new Error('APLICACION_EN_EJECUCION: Cierra "Isaac POS Modern" para finalizar la inyección del paquete.');
        }
        throw renameErr;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 [DEPLOY COMPLETADO EXITOSAMENTE en ${elapsed}s]`);
    console.log(`✔ Aplicación instalada actualizada en: ${targetAsar}`);
}

main().catch(err => {
    console.error('❌ Error durante el despliegue:', err.message);
    process.exit(1);
});
