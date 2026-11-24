const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const pkgPath = path.resolve(__dirname, 'package.json');
let baseVersion = '24.4.3';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.version) {
    baseVersion = pkg.version.replace(/^(\d+)\.0*(\d+)/, '$1.$2');
  }
} catch (_) {}

const buildTimestamp = Math.floor(Date.now() / 1000);
const fullVersion = `${baseVersion}.${buildTimestamp}`;
const buildTimeIso = new Date().toISOString();

const srcDir = path.resolve(__dirname, 'dist-mobile');
if (!fs.existsSync(srcDir)) {
  console.error('[MOBILE OTA SYNC] Error: No existe el directorio dist-mobile. Ejecute vite build --config vite.mobile.config.js primero.');
  process.exit(1);
}

// 1. Actualizar versión de caché en dist-mobile/sw.js
try {
  const swPath = path.join(srcDir, 'sw.js');
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'isaac-pos-mobile-${fullVersion}';`);
    fs.writeFileSync(swPath, swContent, 'utf8');
  }
} catch (swErr) {
  console.warn('[MOBILE OTA SYNC] Aviso actualizando sw.js:', swErr.message);
}

// 2. Comprimir dist-mobile/ para paquete OTA (.zip) excluyendo .apk y version.json (evita desfase de checksum)
console.log('[MOBILE OTA SYNC] Empaquetando dist-mobile en dist.zip para actualizaciones OTA...');
const zip = new AdmZip();
zip.addLocalFolder(srcDir, '', (filename) => {
  const lower = filename.toLowerCase();
  const base = path.basename(lower);
  return !lower.endsWith('.apk') && base !== 'version.json';
});
const zipBuffer = zip.toBuffer();
const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');

// 3. Firma digital RSA-SHA256 obligatoria con clave dedicada fuera del repo Git
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
  const manifestCanonical = `${fullVersion}|${checksum}|${buildTimeIso}`;
  otaManifestSignature = crypto.sign('sha256', Buffer.from(manifestCanonical, 'utf8'), otaPrivKeyPem).toString('base64');
} else if (process.env.ALLOW_UNSIGNED_OTA_DEV !== 'true') {
  throw new Error(
    'OTA_SIGNING_PRIVATE_KEY_PEM / OTA_SIGNING_PRIVATE_KEY_PATH es obligatorio para publicar paquetes OTA firmados (o define ALLOW_UNSIGNED_OTA_DEV=true solo en desarrollo).'
  );
}

const versionPayload = {
  version: fullVersion,
  buildTime: buildTimeIso,
  bundleUrl: '/dist.zip',
  checksum,
  ...(otaSignature ? { otaSignature, otaManifestSignature, otaSignatureAlg: 'RSA-SHA256' } : {}),
  apkUrl: '/Isaac-POS-Mobile.apk'
};

// Guardar version.json en dist-mobile (fuera del dist.zip) para referencia del APK nativo
fs.writeFileSync(path.join(srcDir, 'version.json'), JSON.stringify(versionPayload, null, 2), 'utf8');

console.log(
  `[MOBILE OTA SYNC] Paquete OTA móvil listo: v${fullVersion} (${(zipBuffer.length / (1024 * 1024)).toFixed(2)} MB) | SHA-256: ${checksum.slice(0, 12)}... | Firmado RSA-SHA256: ${otaSignature ? 'SÍ' : 'NO'}`
);

// 4. Publicar dist.zip, version.json y APK en el servidor backend
const targetDirs = [
  path.resolve(__dirname, '../american-pos-backend/public'),
  ...(process.env.ISAAC_EXTRA_PUBLIC_DIR ? [path.resolve(process.env.ISAAC_EXTRA_PUBLIC_DIR)] : [])
];

const apkReleasePath = path.resolve(__dirname, 'android/app/build/outputs/apk/release/app-release.apk');

for (const targetDir of targetDirs) {
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (_) {}
  }
  if (fs.existsSync(targetDir)) {
    fs.writeFileSync(path.join(targetDir, 'dist.zip'), zipBuffer);
    fs.writeFileSync(path.join(targetDir, 'version.json'), JSON.stringify(versionPayload, null, 2), 'utf8');
    if (fs.existsSync(apkReleasePath)) {
      fs.copyFileSync(apkReleasePath, path.join(targetDir, 'Isaac-POS-Mobile.apk'));
    }
    const backendIndexHtml = path.resolve(__dirname, '../american-pos-backend/public/index.html');
    if (fs.existsSync(backendIndexHtml) && !fs.existsSync(path.join(targetDir, 'index.html'))) {
      try {
        fs.copyFileSync(backendIndexHtml, path.join(targetDir, 'index.html'));
      } catch (_) {}
    }
    console.log(`[MOBILE OTA SYNC] Actualizado dist.zip + version.json + APK en: ${targetDir}`);
  }
}

// 5. Publicación automática en Supabase Storage usando fetch nativo (Node 20+/24)
(async () => {
  const dns = require('dns');
  if (dns.setDefaultResultOrder) {
    try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    if (process.env.REQUIRE_OTA_CLOUD_PUBLISH === 'true') {
      throw new Error('SUPABASE_URL y SUPABASE_SERVICE_KEY deben definirse cuando REQUIRE_OTA_CLOUD_PUBLISH=true.');
    }
    console.log('[MOBILE OTA SYNC] ℹ️ Paquete OTA local generado. Subida a Supabase Storage omitida (define SUPABASE_URL y SUPABASE_SERVICE_KEY para publicar en nube).');
    return;
  }

  try {
    console.log('[MOBILE OTA SYNC] ☁️ Publicando dist.zip y version.json en Supabase Storage (Internet 24/7)...');

    const zipUploadRes = await fetch(`${supabaseUrl}/storage/v1/object/app-updates/dist.zip`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': 'application/zip',
        'x-upsert': 'true'
      },
      body: zipBuffer
    });
    if (!zipUploadRes.ok) {
      throw new Error(`HTTP ${zipUploadRes.status} subiendo dist.zip: ${await zipUploadRes.text()}`);
    }

    const cloudVersionPayload = {
      ...versionPayload,
      bundleUrl: `${supabaseUrl}/storage/v1/object/public/app-updates/dist.zip`
    };
    const verUploadRes = await fetch(`${supabaseUrl}/storage/v1/object/app-updates/version.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
        'x-upsert': 'true'
      },
      body: JSON.stringify(cloudVersionPayload, null, 2)
    });
    if (!verUploadRes.ok) {
      throw new Error(`HTTP ${verUploadRes.status} subiendo version.json: ${await verUploadRes.text()}`);
    }

    console.log('[MOBILE OTA SYNC] ✅ ¡dist.zip y version.json firmados publicados en Supabase Storage!');
  } catch (cloudErr) {
    console.warn('[MOBILE OTA SYNC] ⚠️ No se pudo subir a Supabase Storage:', cloudErr.message);
    if (process.env.REQUIRE_OTA_CLOUD_PUBLISH === 'true') {
      process.exit(1);
    }
  }
})();
