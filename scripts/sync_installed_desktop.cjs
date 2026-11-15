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

    // 0. Unificar y asegurar todos los activos de marca oficiales (emblemas, logotipos, .ico)
    console.log('🎨 [0/4] Sincronizando y unificando activos visuales de marca oficiales...');
    const brandScript = path.join(PROJECT_ROOT, 'scripts', 'unify_brand_assets.py');
    if (fs.existsSync(brandScript)) {
        try {
            execSync(`python "${brandScript}"`, { stdio: 'inherit' });
        } catch (brandErr) {
            console.warn(`⚠ Aviso sincronizando activos de marca: ${brandErr.message}`);
        }
    }

    // 1. Compilar Frontend
    console.log('📦 [1/4] Compilando frontend (Vite)...');
    execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });

    // 2. Sincronizar fuentes con la carpeta de staging
    console.log('🔄 [2/4] Sincronizando bundle, backend y splash en área de staging...');
    if (!fs.existsSync(TEMP_EXTRACTED)) {
        fs.mkdirSync(TEMP_EXTRACTED, { recursive: true });
    }

    // Copiar public desde dist
    const distDir = path.join(FRONTEND_DIR, 'dist');
    const stagingPublic = path.join(TEMP_EXTRACTED, 'public');
    const stagingAssets = path.join(stagingPublic, 'assets');

    // Limpiar imágenes obsoletas o con nombres antiguos en assets de staging
    if (fs.existsSync(stagingAssets)) {
        const obsoletePatterns = [
            /RH5LqTe5/,
            /Gi0wQ7b8/,
            /CLAUhV0B/,
            /DmyQGpc3/,
            /logo-x_2IkhiP/,
            /logo-Bq2dXes1/
        ];
        const existingFiles = fs.readdirSync(stagingAssets);
        for (const f of existingFiles) {
            if (obsoletePatterns.some(p => p.test(f))) {
                try {
                    fs.unlinkSync(path.join(stagingAssets, f));
                    console.log(`  - Eliminado asset obsoleto en staging: ${f}`);
                } catch (_) {}
            }
        }
    }

    // Copiar dist compilado a staging/public
    fs.cpSync(distDir, stagingPublic, { recursive: true, force: true });

    // Copiar assets directos de backend/public (splash.html, etc.) a staging/public
    const backendPublic = path.join(BACKEND_DIR, 'public');
    if (fs.existsSync(backendPublic)) {
        fs.cpSync(backendPublic, stagingPublic, { recursive: true, force: true });
    }

    // Copiar carpetas clave del backend
    const backendFolders = ['routes', 'services', 'database', 'utils', 'middleware', 'controllers', 'config', 'build', 'schemas', 'static', 'migrations'];
    for (const folder of backendFolders) {
        const srcFolder = path.join(BACKEND_DIR, folder);
        const destFolder = path.join(TEMP_EXTRACTED, folder);
        if (fs.existsSync(srcFolder)) {
            fs.cpSync(srcFolder, destFolder, { recursive: true, force: true });
        }
    }

    // Copiar archivos raíz del backend esenciales (excluyendo .env por seguridad: main.js gestiona .env en UserData)
    const backendRootFiles = ['main.js', 'index.js', 'preload.js', 'paths.js', 'package.json', 'payment_methods.json', 'settings.json'];
    try {
        const leftoverEnv = path.join(TEMP_EXTRACTED, '.env');
        if (fs.existsSync(leftoverEnv)) fs.unlinkSync(leftoverEnv);
    } catch (_) {}
    for (const file of backendRootFiles) {
        const srcFile = path.join(BACKEND_DIR, file);
        const destFile = path.join(TEMP_EXTRACTED, file);
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, destFile);
        }
    }

    // Garantizar que node_modules exista en staging (si se limpió Temp, copiar desde backend)
    const stagingNodeModules = path.join(TEMP_EXTRACTED, 'node_modules');
    const backendNodeModules = path.join(BACKEND_DIR, 'node_modules');
    if (!fs.existsSync(path.join(stagingNodeModules, 'express'))) {
        if (fs.existsSync(path.join(backendNodeModules, 'express'))) {
            console.log('📂 Copiando node_modules del backend hacia staging (no estaba en caché temporal)...');
            fs.cpSync(backendNodeModules, stagingNodeModules, { recursive: true, force: true });
        }
    }

    if (!fs.existsSync(path.join(stagingNodeModules, 'express'))) {
        throw new Error('Abortando empaquetado: falta node_modules/express en staging y en american-pos-backend.');
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
        if (fs.existsSync(targetAsar)) {
            try {
                fs.unlinkSync(targetAsar);
            } catch (_) {
                const tempOld = path.join(INSTALLED_DIR, `app.asar.old_${Date.now()}`);
                fs.renameSync(targetAsar, tempOld);
                try { fs.unlinkSync(tempOld); } catch (_) {}
            }
        }
        fs.renameSync(targetNewAsar, targetAsar);
        const tempUnpacked = `${targetNewAsar}.unpacked`;
        const targetUnpacked = `${targetAsar}.unpacked`;
        if (fs.existsSync(tempUnpacked)) {
            if (fs.existsSync(targetUnpacked)) {
                try { fs.rmSync(targetUnpacked, { recursive: true, force: true }); } catch (_) {}
            }
            try { fs.renameSync(tempUnpacked, targetUnpacked); } catch (_) {
                fs.cpSync(tempUnpacked, targetUnpacked, { recursive: true, force: true });
                fs.rmSync(tempUnpacked, { recursive: true, force: true });
            }
        }
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

    // 5. Mantener actualizado el icono oficial en el acceso directo del escritorio
    const updateIconScript = path.join(PROJECT_ROOT, 'scripts', 'update_desktop_icon.ps1');
    if (fs.existsSync(updateIconScript)) {
        try {
            execSync(`powershell -ExecutionPolicy Bypass -File "${updateIconScript}"`, { stdio: 'inherit' });
        } catch (_e) {}
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 [DEPLOY COMPLETADO EXITOSAMENTE en ${elapsed}s]`);
    console.log(`✔ Aplicación instalada actualizada en: ${targetAsar}`);
}

main().catch(err => {
    console.error('❌ Error durante el despliegue:', err.message);
    process.exit(1);
});
