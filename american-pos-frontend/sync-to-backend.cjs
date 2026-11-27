const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const pkgPath = path.resolve(__dirname, 'package.json');
let baseVersion = '24.4.0';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.version) {
    baseVersion = pkg.version.replace(/^(\d+)\.0*(\d+)/, '$1.$2');
  }
} catch (e) {
  console.warn('[BUILD SYNC] No se pudo leer package.json, usando versión base por defecto.');
}

// Semver timestamp format compatible con Capacitor Updater
const buildTimestamp = Math.floor(Date.now() / 1000);
const fullVersion = `${baseVersion}.${buildTimestamp}`;
const buildTimeIso = new Date().toISOString();

const srcDir = path.resolve(__dirname, 'dist');
const mobileDistDir = path.resolve(__dirname, 'dist-mobile');
const os = require('os');
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const extraUltraPublicDir = process.env.ISAAC_ULTRA_PUBLIC_DIR || path.join(localAppData, 'Programs', 'Isaac POS Ultra', 'public');
const targetDirs = [
  path.resolve(__dirname, '../american-pos-backend/public'),
  extraUltraPublicDir
].filter(Boolean);

const crypto = require('crypto');

// 1. Empaquetar OTA móvil desde dist-mobile/ si existe (para no contaminar Android con el bundle de Escritorio PC)
const otaSourceDir = fs.existsSync(path.join(mobileDistDir, 'index.html')) ? mobileDistDir : srcDir;
console.log(`[BUILD SYNC] Empaquetando dist.zip para actualizaciones OTA desde ${path.basename(otaSourceDir)}/...`);
const zip = new AdmZip();
zip.addLocalFolder(otaSourceDir, '', (filename) => {
  const lower = filename.toLowerCase();
  const base = path.basename(lower);
  return !lower.endsWith('.apk') && !lower.endsWith('dist.zip') && base !== 'version.json';
});
const zipBuffer = zip.toBuffer();
const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');
console.log(`[BUILD SYNC] dist.zip generado exitosamente (${(zipBuffer.length / (1024 * 1024)).toFixed(2)} MB), checksum: ${checksum.slice(0, 8)}...`);

// 2. Preservar versión móvil si proviene de dist-mobile/version.json, o usar fullVersion
let otaVersion = fullVersion;
let otaBuildTime = buildTimeIso;
if (otaSourceDir === mobileDistDir && fs.existsSync(path.join(mobileDistDir, 'version.json'))) {
  try {
    const mobileVer = JSON.parse(fs.readFileSync(path.join(mobileDistDir, 'version.json'), 'utf8'));
    if (mobileVer.version) otaVersion = mobileVer.version;
    if (mobileVer.buildTime) otaBuildTime = mobileVer.buildTime;
  } catch (_) {}
}

// 2.1 Firma digital RSA-SHA256 del paquete OTA (misma clave dedicada que sync-mobile-ota.cjs)
const defaultLocalKeyPath = path.join(os.homedir(), '.isaac-pos-secrets', 'ota_signing_private.pem');
const otaPrivKeyInline = process.env.OTA_SIGNING_PRIVATE_KEY_PEM;
const otaPrivKeyPath = process.env.OTA_SIGNING_PRIVATE_KEY_PATH || (fs.existsSync(defaultLocalKeyPath) ? defaultLocalKeyPath : null);
let otaPrivKeyPem = otaPrivKeyInline ? otaPrivKeyInline.replace(/\\n/g, '\n') : null;
if (!otaPrivKeyPem && otaPrivKeyPath && fs.existsSync(path.resolve(otaPrivKeyPath))) {
  otaPrivKeyPem = fs.readFileSync(path.resolve(otaPrivKeyPath), 'utf8');
}

let otaSignature = null;
let otaManifestSignature = null;
if (otaPrivKeyPem) {
  otaSignature = crypto.sign('sha256', zipBuffer, otaPrivKeyPem).toString('base64');
  const manifestCanonical = `${otaVersion}|${checksum}|${otaBuildTime}`;
  otaManifestSignature = crypto.sign('sha256', Buffer.from(manifestCanonical, 'utf8'), otaPrivKeyPem).toString('base64');
}

const versionPayload = {
  version: otaVersion,
  buildTime: otaBuildTime,
  bundleUrl: '/dist.zip',
  checksum: checksum,
  ...(otaSignature ? { otaSignature, otaManifestSignature, otaSignatureAlg: 'RSA-SHA256' } : {}),
  apkUrl: '/Isaac-POS-Mobile.apk'
};
console.log(`[BUILD SYNC] Versión Desktop: ${fullVersion} | Versión OTA Móvil preservada: ${otaVersion} | Firmado RSA-SHA256: ${otaSignature ? 'SÍ' : 'NO'}`);

// 2.5 Actualizar versión de caché en dist/sw.js para invalidar index.html antiguos
try {
  const swPath = path.join(srcDir, 'sw.js');
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'isaac-pos-${fullVersion}';`);
    fs.writeFileSync(swPath, swContent, 'utf8');
  }
} catch (swErr) {
  console.warn('[BUILD SYNC] Aviso actualizando sw.js:', swErr.message);
}

function copyRecursive(src, target) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, targetPath);
    } else {
      const srcBuf = fs.readFileSync(srcPath);
      fs.writeFileSync(targetPath, srcBuf);
    }
  }
}

// 3. Sincronizar a destinos (backend / electron app)
for (const targetDir of targetDirs) {
  if (fs.existsSync(path.dirname(targetDir))) {
    console.log(`[BUILD SYNC] Sincronizando bundle de dist/ hacia ${targetDir}...`);
    // Purgar chunks obsoletos en assets/ y artefactos públicos retirados para evitar exponer builds previos
    const srcAssetsDir = path.join(srcDir, 'assets');
    const currentAssetFiles = new Set(fs.existsSync(srcAssetsDir) ? fs.readdirSync(srcAssetsDir) : []);
    const assetsDir = path.join(targetDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      try {
        const files = fs.readdirSync(assetsDir);
        for (const f of files) {
          if (!currentAssetFiles.has(f)) {
            const fPath = path.join(assetsDir, f);
            fs.rmSync(fPath, { recursive: true, force: true });
          }
        }
      } catch (rmErr) {
        console.warn(`[BUILD SYNC] Limpieza de assets antiguos omitida:`, rmErr.message);
      }
    }
    const srcFontsDir = path.join(srcDir, 'fonts');
    const currentFontFiles = new Set(fs.existsSync(srcFontsDir) ? fs.readdirSync(srcFontsDir) : []);
    const targetFontsDir = path.join(targetDir, 'fonts');
    if (fs.existsSync(targetFontsDir) && currentFontFiles.size > 0) {
      try {
        for (const f of fs.readdirSync(targetFontsDir)) {
          if (!currentFontFiles.has(f)) {
            fs.rmSync(path.join(targetFontsDir, f), { recursive: true, force: true });
          }
        }
      } catch (rmFontErr) {
        console.warn(`[BUILD SYNC] Limpieza de fuentes antiguas omitida:`, rmFontErr.message);
      }
    }
    const legacyPocketLicense = path.join(targetDir, 'pocket-license.html');
    if (fs.existsSync(legacyPocketLicense)) {
      try {
        fs.unlinkSync(legacyPocketLicense);
      } catch (unlinkErr) {
        console.warn(`[BUILD SYNC] No se pudo eliminar pocket-license.html obsoleto:`, unlinkErr.message);
      }
    }
    copyRecursive(srcDir, targetDir);
    // Garantizar dist.zip y version.json en la raíz pública
    fs.writeFileSync(path.join(targetDir, 'dist.zip'), zipBuffer);
    fs.writeFileSync(path.join(targetDir, 'version.json'), JSON.stringify(versionPayload, null, 2), 'utf8');
  }
}

// 4. Sincronizar binarios y servicios de impresión del backend hacia la instalación local de Isaac POS Ultra
const ultraRoot = path.join(localAppData, 'Programs', 'Isaac POS Ultra');
const backendRoot = path.resolve(__dirname, '../american-pos-backend');
if (fs.existsSync(ultraRoot) && fs.existsSync(backendRoot)) {
  const backendFilesToSync = [
    'bin/RawPrinter.exe',
    'bin/RawPrinter.cs',
    'services/LocalPrinterService.js',
    'services/CashService.js',
    'services/ImageSearchService.js',
    'services/AIService.js',
    'services/PDFService.js',
    'services/ProductService.js',
    'services/WhatsappBotService.js',
    'services/SaleService.js',
    'services/RefundService.js',
    'middleware/auth.js',
    'routes/auth.js',
    'routes/products.js',
    'routes/sales.js',
    'routes/settings.js',
    'routes/backup.js',
    'routes/system.js',
    'routes/whatsapp.js',
    'routes/branches.js',
    'routes/cash.js',
    'routes/reports.js',
    'routes/users.js',
    'routes/recharges.js',
    'routes/publicAi.js',
    'services/StockIntelligenceService.js',
    'services/product/productMediaService.js',
    'config/dbConfigManager.js',
    'config/secretVault.js',
    'utils/dpapiCrypto.js',
    'utils/hardware-id.js',
    'database/connection.js',
    'database/models/User.js',
    'database/models/TelecomRecharge.js',
    'database/models/index.js',
    'database/schemaMigrator.js',
    'database/migrate.js',
    'services/AutoMaintenanceService.js',
    'services/CloudMirrorService.js',
    'services/ReportService.js',
    'scripts/cifrar_backup.js',
    'utils/sqliteBackupHelper.js',
    'utils/snapshotHelper.js',
    'utils/backupHelper.js',
    'utils/postgresLauncher.js',
    'package.json',
    'index.js',
    'main.js'
  ];
  for (const relFile of backendFilesToSync) {
    try {
      const sFile = path.join(backendRoot, relFile);
      const tFile = path.join(ultraRoot, relFile);
      if (fs.existsSync(sFile)) {
        fs.mkdirSync(path.dirname(tFile), { recursive: true });
        fs.copyFileSync(sFile, tFile);
      }
    } catch (syncErr) {
      console.warn(`[BUILD SYNC] Aviso copiando ${relFile}:`, syncErr.message);
    }
  }
}

console.log('[BUILD SYNC] Sincronización y paquete OTA listos para distribución.');
