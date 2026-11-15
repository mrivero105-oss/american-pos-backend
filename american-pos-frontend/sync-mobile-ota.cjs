const fs = require('fs');
const path = require('path');
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

// 2. Comprimir dist-mobile/ para paquete OTA (.zip) excluyendo archivos .apk
console.log('[MOBILE OTA SYNC] Empaquetando dist-mobile en dist.zip para actualizaciones OTA...');
const zip = new AdmZip();
zip.addLocalFolder(srcDir, '', (filename) => !filename.toLowerCase().endsWith('.apk'));
const zipBuffer = zip.toBuffer();
const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');

const versionPayload = {
  version: fullVersion,
  buildTime: buildTimeIso,
  bundleUrl: '/dist.zip',
  checksum: checksum,
  apkUrl: '/Isaac-POS-Mobile.apk'
};

// Guardar version.json dentro de dist-mobile para que el APK nativo conozca su versión exacta
fs.writeFileSync(path.join(srcDir, 'version.json'), JSON.stringify(versionPayload, null, 2), 'utf8');

console.log(
  `[MOBILE OTA SYNC] Paquete OTA móvil listo: v${fullVersion} (${(zipBuffer.length / (1024 * 1024)).toFixed(2)} MB) | SHA-256: ${checksum.slice(0, 10)}...`
);

// 3. Publicar únicamente dist.zip y version.json en el servidor (CERO impacto en los archivos web de Desktop)
const targetDirs = [
  path.resolve(__dirname, '../american-pos-backend/public'),
  'C:\\Users\\mrive\\AppData\\Local\\Temp\\isaac_asar_extracted\\public'
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

// 4. Publicar automáticamente en Supabase Storage (para actualizaciones 24/7 en Internet con datos móviles)
(async () => {
  const dns = require('dns');
  if (dns.setDefaultResultOrder) {
    try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_KEY deben definirse en variables de entorno.');
  }

  try {
    const axios = require('../american-pos-backend/node_modules/axios');
    console.log('[MOBILE OTA SYNC] ☁️ Publicando dist.zip y version.json en Supabase Storage (Internet 24/7)...');
    
    // Subir dist.zip
    await axios.post(
      `${supabaseUrl}/storage/v1/object/app-updates/dist.zip`,
      zipBuffer,
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
          'Content-Type': 'application/zip',
          'x-upsert': 'true',
          'User-Agent': 'IsaacPOS-PC-Server/1.0'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 90000
      }
    );

    // Manifiesto con URL pública de Supabase
    const cloudVersionPayload = {
      ...versionPayload,
      bundleUrl: `${supabaseUrl}/storage/v1/object/public/app-updates/dist.zip`
    };

    // Subir version.json
    await axios.post(
      `${supabaseUrl}/storage/v1/object/app-updates/version.json`,
      JSON.stringify(cloudVersionPayload, null, 2),
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
          'User-Agent': 'IsaacPOS-PC-Server/1.0'
        },
        timeout: 20000
      }
    );

    console.log('[MOBILE OTA SYNC] ✅ Actualización OTA publicada exitosamente en Supabase Storage.');
    console.log(`[MOBILE OTA SYNC] 🌐 URL Manifiesto: ${supabaseUrl}/storage/v1/object/public/app-updates/version.json`);
  } catch (err) {
    console.warn('[MOBILE OTA SYNC] ⚠️ No se pudo publicar en Supabase Storage:', err.response?.data || err.message);
  }
})();
