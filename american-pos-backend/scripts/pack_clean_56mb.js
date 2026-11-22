const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

// 1. Obtener los 62 archivos activos de public/assets
const assetsDir = path.join(__dirname, '..', 'public', 'assets');
const activeAssets = new Set();

function trace(file) {
    if (!file || activeAssets.has(file)) return;
    activeAssets.add(file);
    const full = path.join(assetsDir, file);
    if (!fs.existsSync(full)) return;
    const content = fs.readFileSync(full, 'utf8');
    const regex = /([a-zA-Z0-9_\-]+\-[a-zA-Z0-9_\-]{8}\.(?:js|css))/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        if (fs.existsSync(path.join(assetsDir, match[1]))) {
            trace(match[1]);
        }
    }
}

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const regexHtml = /assets\/([a-zA-Z0-9_\-]+\-[a-zA-Z0-9_\-]{8}\.(?:js|css))/g;
let m;
while ((m = regexHtml.exec(indexHtml)) !== null) {
    trace(m[1]);
}

console.log(`[CleanPack] Archivos activos de frontend rastreados: ${activeAssets.size}`);

// 2. Definir lista de archivos limpios para el instalador
const rootDir = path.resolve(__dirname, '..');
const filesToPack = [];

const excludeDirs = new Set([
    'backend',
    'dist_installer',
    'dist_final_installer',
    'dist_modern',
    'dist_release',
    '.wwebjs_auth',
    '.test_wwebjs_auth',
    '.wwebjs_cache',
    'auto-backups',
    'backups',
    'invoices',
    'product_images',
    'supplier_logos',
    'scratch',
    'logs',
    '.git',
    'bin',
    'obj'
]);

const sensitiveExactFiles = new Set([
    '.env',
    'settings.json',
    'db-config.json',
    '.dbcfg.key.dpapi',
    'secrets.vault.json',
    '.secrets.key.dpapi',
    'cloud_mirror_config.json',
    'private.pem',
    'serviceAccountKey.json',
    'real_token.json'
]);

function scan(dir) {
    for (const item of fs.readdirSync(dir)) {
        if (excludeDirs.has(item)) continue;
        const full = path.join(dir, item);
        const rel = path.relative(rootDir, full);
        const stat = fs.statSync(full);

        if (stat.isDirectory()) {
            if (rel === path.join('public', 'client')) continue; // Excluir cliente duplicado
            if (rel === path.join('public', 'assets')) {
                // Solo agregar los activos
                for (const asset of activeAssets) {
                    const assetFull = path.join(assetsDir, asset);
                    if (fs.existsSync(assetFull)) {
                        filesToPack.push({ full: assetFull, rel: path.join('public', 'assets', asset) });
                    }
                }
                continue;
            }
            scan(full);
        } else {
            const lowerItem = item.toLowerCase();
            // Reglas de exclusión de secretos y residuos en cualquier directorio
            if (sensitiveExactFiles.has(lowerItem) ||
                lowerItem.startsWith('.env.') ||
                (lowerItem.includes('private') && lowerItem.endsWith('.pem')) ||
                lowerItem.endsWith('.pfx') ||
                lowerItem.endsWith('.p12') ||
                lowerItem.endsWith('.key') ||
                lowerItem.endsWith('.sqlite') ||
                lowerItem.endsWith('.sqlite-wal') ||
                lowerItem.endsWith('.sqlite-shm') ||
                item.endsWith('.apk') || 
                item.endsWith('.dev_backup') || 
                item.includes('premigration') ||
                item.endsWith('.tar.gz') ||
                full.includes(path.join('node_modules', 'fluent-ffmpeg', 'coverage'))) {
                continue;
            }

            // Reglas de exclusión en raíz
            if (dir === rootDir) {
                if (item.startsWith('test_') || item.startsWith('check_') || 
                    item.startsWith('debug_') || item.startsWith('fix_') || 
                    item.startsWith('inspect_') || item.startsWith('find_') || 
                    item.startsWith('temp_')) continue;
                if (item.endsWith('.cs') || item.endsWith('.tmp') || item.endsWith('.log')) continue;
            }
            filesToPack.push({ full, rel });
        }
    }
}

scan(rootDir);
console.log(`[CleanPack] Total de archivos seleccionados: ${filesToPack.length}`);

// Guardar lista en archivo temporal para empaquetador C#
const listFile = path.join(rootDir, 'dist_installer', 'filelist.txt');
fs.writeFileSync(listFile, filesToPack.map(f => `${f.full}\t${f.rel}`).join('\n'), 'utf8');

console.log(`[CleanPack] Lista generada en: ${listFile}`);
