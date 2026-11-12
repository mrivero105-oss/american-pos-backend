const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const asar = require('../american-pos-backend/node_modules/@electron/asar');

async function main() {
    console.log('🚀 [DEPLOY] Iniciando empaquetado directo de Isaac POS Modern...');
    const startTime = Date.now();

    // 1. Cerrar cualquier instancia previa
    try { execSync('taskkill /F /IM "Isaac POS Modern.exe" /T', { stdio: 'ignore' }); } catch (_) {}
    try { execSync('taskkill /F /IM "Isaac POS.exe" /T', { stdio: 'ignore' }); } catch (_) {}
    try { execSync('taskkill /F /IM "electron.exe" /T', { stdio: 'ignore' }); } catch (_) {}

    const ROOT = path.resolve(__dirname, '..');
    const FRONTEND_DIST = path.join(ROOT, 'american-pos-frontend', 'dist');
    const BACKEND_DIR = path.join(ROOT, 'american-pos-backend');
    const STAGING = path.join(ROOT, 'build-temp', 'asar_staging');
    const INSTALLED_DIR = 'C:\\Users\\mrive\\AppData\\Local\\Programs\\Isaac POS Modern\\resources';
    const TARGET_ASAR = path.join(INSTALLED_DIR, 'app.asar');
    const TEMP_ASAR = path.join(INSTALLED_DIR, 'app.asar.new');

    if (!fs.existsSync(FRONTEND_DIST)) {
        throw new Error('No existe la carpeta dist del frontend');
    }

    // 2. Preparar staging limpio
    console.log('📦 [1/3] Preparando directorio de staging...');
    if (fs.existsSync(STAGING)) {
        fs.rmSync(STAGING, { recursive: true, force: true });
    }
    fs.mkdirSync(STAGING, { recursive: true });

    // Copiar backend completo excepto node_modules/cache/logs pesados
    const backendFolders = ['routes', 'controllers', 'services', 'database', 'middleware', 'utils', 'config', 'schemas', 'static', 'migrations', 'scripts'];
    for (const folder of backendFolders) {
        const src = path.join(BACKEND_DIR, folder);
        const dest = path.join(STAGING, folder);
        if (fs.existsSync(src)) {
            fs.cpSync(src, dest, { recursive: true });
        }
    }

    // Copiar node_modules del backend
    const srcNm = path.join(BACKEND_DIR, 'node_modules');
    const destNm = path.join(STAGING, 'node_modules');
    if (fs.existsSync(srcNm)) {
        console.log('📂 Copiando node_modules de backend...');
        fs.cpSync(srcNm, destNm, { recursive: true });
    }

    // Copiar archivos raíz del backend
    const backendRootFiles = ['main.js', 'index.js', 'preload.js', 'paths.js', 'package.json', 'payment_methods.json', 'settings.json', '.env'];
    for (const f of backendRootFiles) {
        const srcF = path.join(BACKEND_DIR, f);
        const destF = path.join(STAGING, f);
        if (fs.existsSync(srcF)) {
            fs.copyFileSync(srcF, destF);
        }
    }

    // Copiar frontend compilado a public
    const stagingPublic = path.join(STAGING, 'public');
    fs.cpSync(FRONTEND_DIST, stagingPublic, { recursive: true });

    // 3. Empaquetar asar
    console.log('🗜️ [2/3] Empaquetando nuevo app.asar...');
    if (fs.existsSync(TEMP_ASAR)) {
        try { fs.unlinkSync(TEMP_ASAR); } catch (_) {}
    }

    await asar.createPackageWithOptions(STAGING, TEMP_ASAR, {
        unpack: '{**/*.node,**/bin/**,**/scripts/**}'
    });

    const newStat = fs.statSync(TEMP_ASAR);
    console.log(`✔ Paquete app.asar.new generado exitosamente (${(newStat.size / (1024 * 1024)).toFixed(2)} MB)`);

    // 4. Reemplazo atómico
    console.log('🛡️ [3/3] Aplicando nuevo app.asar...');
    try {
        if (fs.existsSync(TARGET_ASAR)) {
            try {
                fs.unlinkSync(TARGET_ASAR);
            } catch (_) {
                const old = path.join(INSTALLED_DIR, `app.asar.old_${Date.now()}`);
                fs.renameSync(TARGET_ASAR, old);
                try { fs.unlinkSync(old); } catch (_) {}
            }
        }
        fs.renameSync(TEMP_ASAR, TARGET_ASAR);
    } catch (e) {
        console.error('Error durante el reemplazo:', e.message);
        throw e;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 [DEPLOY COMPLETADO en ${elapsed}s]`);
    console.log(`✔ Isaac POS Modern actualizado en: ${TARGET_ASAR}`);
}

main().catch(err => {
    console.error('❌ Error en fast_deploy:', err);
    process.exit(1);
});
