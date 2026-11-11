/**
 * sync_installed_desktop.cjs
 * Script atómico y automatizado para compilar y desplegar Isaac POS hacia la aplicación instalada en Windows.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'american-pos-frontend');
const BACKEND_DIR = path.join(PROJECT_ROOT, 'american-pos-backend');
const INSTALLED_DIR = 'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS Modern\\resources';
const TEMP_EXTRACTED = 'C:\\Users\\mrive\\AppData\\Local\\Temp\\isaac_asar_extracted';

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

    // Copiar archivos clave del backend
    const backendFiles = ['routes', 'services', 'database', 'utils', 'middleware', 'controllers'];
    for (const folder of backendFiles) {
        const srcFolder = path.join(BACKEND_DIR, folder);
        const destFolder = path.join(TEMP_EXTRACTED, folder);
        if (fs.existsSync(srcFolder)) {
            fs.cpSync(srcFolder, destFolder, { recursive: true, force: true });
        }
    }

    // 3. Empaquetar asar en archivo temporal .new
    console.log('🗜️ [3/4] Empaquetando nuevo app.asar con @electron/asar...');
    const targetAsar = path.join(INSTALLED_DIR, 'app.asar');
    const targetNewAsar = path.join(INSTALLED_DIR, 'app.asar.new');

    const asarCmd = `npx --yes @electron/asar pack "${TEMP_EXTRACTED}" "${targetNewAsar}" --unpack "{**/*.node,**/bin/**,**/scripts/**}"`;
    execSync(asarCmd, { stdio: 'inherit' });

    // 4. Reemplazo atómico con backup
    console.log('🛡️ [4/4] Aplicando nuevo app.asar de forma atómica...');
    if (fs.existsSync(targetAsar)) {
        const backupPath = path.join(INSTALLED_DIR, `app.asar.bak_deploy_${Date.now()}`);
        fs.copyFileSync(targetAsar, backupPath);
        console.log(`✔ Respaldo generado: ${path.basename(backupPath)}`);
    }

    fs.renameSync(targetNewAsar, targetAsar);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 [DEPLOY COMPLETADO EXITOSAMENTE en ${elapsed}s]`);
    console.log(`✔ Aplicación instalada actualizada en: ${targetAsar}`);
}

main().catch(err => {
    console.error('❌ Error durante el despliegue:', err.message);
    process.exit(1);
});
