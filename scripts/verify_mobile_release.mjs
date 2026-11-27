import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'american-pos-frontend');
const BACKEND_PUBLIC = path.join(ROOT, 'american-pos-backend', 'public');
const DIST_MOBILE = path.join(FRONTEND, 'dist-mobile');
const APK_PATH = path.join(ROOT, 'dist_installers', 'Isaac-POS-Mobile.apk');
const LOCAL_OTA_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Isaac POS', 'resources', 'mobile-ota')
  : '';

const require = createRequire(import.meta.url);
const AdmZip = require(path.join(FRONTEND, 'node_modules', 'adm-zip'));

const SKIP_BUILD_CHECKS = process.argv.includes('--artifacts-only');
const MAX_APK_MB = Number(process.env.MOBILE_MAX_APK_MB || 16);
const MAX_OTA_MB = Number(process.env.MOBILE_MAX_OTA_MB || 3.8);

const results = [];

function pass(gate, detail) {
  results.push({ gate, status: 'PASS', detail });
  console.log(`✅ [${gate}] ${detail}`);
}

function fail(gate, detail) {
  results.push({ gate, status: 'FAIL', detail });
  console.error(`❌ [${gate}] ${detail}`);
}

function runShell(cmd, args, cwd, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    const tail = `${res.stdout || ''}\n${res.stderr || ''}`.trim().slice(-1200);
    throw new Error(`Exit ${res.status}: ${tail}`);
  }
  return res.stdout || '';
}

function checkElf16KbAlignment(elfBuf) {
  if (elfBuf.length < 64) return { ok: false, reason: 'ELF demasiado corto' };
  if (elfBuf[0] !== 0x7f || elfBuf[1] !== 0x45 || elfBuf[2] !== 0x4c || elfBuf[3] !== 0x46) {
    return { ok: false, reason: 'Magic ELF inválido' };
  }
  const elfClass = elfBuf[4];
  if (elfClass !== 2) return { ok: true, reason: 'No ELF64' };
  const ePhoff = Number(elfBuf.readBigUInt64LE(32));
  const ePhentsize = elfBuf.readUInt16LE(54);
  const ePhnum = elfBuf.readUInt16LE(56);
  let loadSegments = 0;
  for (let i = 0; i < ePhnum; i++) {
    const off = ePhoff + i * ePhentsize;
    if (off + 56 > elfBuf.length) break;
    const pType = elfBuf.readUInt32LE(off);
    if (pType === 1) { // PT_LOAD
      loadSegments++;
      const pAlign = Number(elfBuf.readBigUInt64LE(off + 48));
      if (pAlign < 16384) {
        return { ok: false, reason: `PT_LOAD p_align=${pAlign} < 16384` };
      }
    }
  }
  return { ok: true, loadSegments };
}

function findApkSigner() {
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    process.env.HOME ? path.join(process.env.HOME, 'Android', 'Sdk') : null,
    process.env.HOME ? path.join(process.env.HOME, 'Library', 'Android', 'sdk') : null
  ].filter(Boolean);

  for (const sdkBase of sdkCandidates) {
    const sdkRoot = path.join(sdkBase, 'build-tools');
    if (!fs.existsSync(sdkRoot)) continue;
    const dirs = fs.readdirSync(sdkRoot).sort().reverse();
    for (const d of dirs) {
      const preferred = process.platform === 'win32'
        ? [path.join(sdkRoot, d, 'apksigner.bat'), path.join(sdkRoot, d, 'apksigner')]
        : [path.join(sdkRoot, d, 'apksigner'), path.join(sdkRoot, d, 'apksigner.bat')];
      for (const candidate of preferred) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

async function main() {
  console.log('=== ISAAC POS MOBILE RELEASE GATE (8 COMPUERTAS) ===\n');

  // Gate 1: ESLint strict
  if (!SKIP_BUILD_CHECKS) {
    try {
      runShell('npx', ['eslint', '.', '--max-warnings=0'], FRONTEND);
      pass('Gate 1/8 ESLint', '0 errores, 0 warnings');
    } catch (err) {
      fail('Gate 1/8 ESLint', err.message);
    }

    // Gate 2: Vitest unit tests
    try {
      const out = runShell('npm', ['run', 'test:unit'], FRONTEND);
      const m = out.match(/Tests\s+([^\n]+)/);
      pass('Gate 2/8 Vitest', m ? m[1].trim() : 'Suite PASS');
    } catch (err) {
      fail('Gate 2/8 Vitest', err.message);
    }

    // Gate 3: Gradle JUnit + Lint Release (JDK 21 multiplataforma)
    try {
      const winJdk21 = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.13.10002-hotspot';
      const javaHome = (process.platform === 'win32' && fs.existsSync(winJdk21))
        ? winJdk21
        : process.env.JAVA_HOME;
      const envPatch = javaHome
        ? { JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}` }
        : {};
      const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
      runShell(gradleCmd, ['testDebugUnitTest', 'lintRelease'], path.join(FRONTEND, 'android'), envPatch);
      pass('Gate 3/8 Gradle JUnit + lintRelease', 'BUILD SUCCESSFUL (0 errores Lint)');
    } catch (err) {
      fail('Gate 3/8 Gradle JUnit + lintRelease', err.message);
    }
  } else {
    pass('Gate 1-3/8 (modo --artifacts-only)', 'Omitidos en modo validación rápida de artefactos');
  }

  // Gate 4: capacitor.config.json sincronizado en Android assets
  try {
    const assetCfgPath = path.join(FRONTEND, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
    const cfg = JSON.parse(fs.readFileSync(assetCfgPath, 'utf8'));
    const updater = cfg?.plugins?.CapacitorUpdater || {};
    if (updater.httpsOnly !== false || updater.statsUrl !== '' || updater.resetWhenUpdate !== true) {
      throw new Error(`Configuración inválida en assets/capacitor.config.json: ${JSON.stringify(updater)}`);
    }
    pass('Gate 4/8 CapacitorUpdater Config', 'httpsOnly=false, statsUrl="", resetWhenUpdate=true');
  } catch (err) {
    fail('Gate 4/8 CapacitorUpdater Config', err.message);
  }

  // Gate 5: Alineación 16 KB ELF64 en arm64-v8a dentro del APK
  try {
    if (!fs.existsSync(APK_PATH)) throw new Error(`No existe APK en ${APK_PATH}`);
    const apkZip = new AdmZip(APK_PATH);
    const arm64Libs = apkZip.getEntries().filter((e) => e.entryName.startsWith('lib/arm64-v8a/') && e.entryName.endsWith('.so'));
    const badLibs = [];
    for (const entry of arm64Libs) {
      const check = checkElf16KbAlignment(entry.getData());
      if (!check.ok) badLibs.push(`${entry.entryName} (${check.reason})`);
    }
    if (badLibs.length > 0) {
      throw new Error(`Librerías sin alineación 16 KB: ${badLibs.join(', ')}`);
    }
    pass('Gate 5/8 ELF64 16 KB', `${arm64Libs.length}/${arm64Libs.length} librerías arm64-v8a alineadas a >=16 KB`);
  } catch (err) {
    fail('Gate 5/8 ELF64 16 KB', err.message);
  }

  // Gate 6: Paridad estricta VITE_MOBILE_BUILD_VERSION === version.json.version
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(DIST_MOBILE, '.build-version'), 'utf8'));
    const backendManifest = JSON.parse(fs.readFileSync(path.join(BACKEND_PUBLIC, 'version.json'), 'utf8'));
    if (!marker.version || marker.version !== backendManifest.version) {
      throw new Error(`Desfase: .build-version=${marker.version} vs backend version.json=${backendManifest.version}`);
    }
    if (LOCAL_OTA_DIR && fs.existsSync(path.join(LOCAL_OTA_DIR, 'version.json'))) {
      const localManifest = JSON.parse(fs.readFileSync(path.join(LOCAL_OTA_DIR, 'version.json'), 'utf8'));
      if (localManifest.version !== marker.version) {
        throw new Error(`Desfase con PC local: local=${localManifest.version} vs build=${marker.version}`);
      }
    }
    pass('Gate 6/8 Paridad Build/OTA', `Versión exacta sincronizada: ${marker.version}`);
  } catch (err) {
    fail('Gate 6/8 Paridad Build/OTA', err.message);
  }

  // Gate 7: Firma RSA-SHA256 + SHA-256 de OTA y firma APK con apksigner
  try {
    const { OTA_PUBLIC_KEY_PEM } = await import(new URL('../american-pos-frontend/src/config/otaPublicKey.js', import.meta.url));
    const dirsToVerify = [BACKEND_PUBLIC, ...(LOCAL_OTA_DIR && fs.existsSync(path.join(LOCAL_OTA_DIR, 'version.json')) ? [LOCAL_OTA_DIR] : [])];
    for (const dir of dirsToVerify) {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
      const zipBuf = fs.readFileSync(path.join(dir, 'dist.zip'));
      const actualSha = crypto.createHash('sha256').update(zipBuf).digest('hex');
      if (actualSha !== manifest.checksum) throw new Error(`SHA-256 inválido en ${dir}`);
      const zipSigOk = crypto.verify('RSA-SHA256', zipBuf, OTA_PUBLIC_KEY_PEM, Buffer.from(manifest.otaSignature, 'base64'));
      const canonical = `${manifest.version}|${manifest.checksum}|${manifest.buildTime}`;
      const manSigOk = crypto.verify('RSA-SHA256', Buffer.from(canonical, 'utf8'), OTA_PUBLIC_KEY_PEM, Buffer.from(manifest.otaManifestSignature, 'base64'));
      if (!zipSigOk || !manSigOk) throw new Error(`Firma RSA-SHA256 inválida en ${dir}`);
    }
    const apksigner = findApkSigner();
    if (!apksigner) throw new Error('apksigner no encontrado en Android SDK build-tools');
    if (process.platform === 'win32') {
      const cmdLine = `""${apksigner}" verify --print-certs "${APK_PATH}""`;
      const res = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine], {
        stdio: 'pipe',
        encoding: 'utf8',
        windowsVerbatimArguments: true
      });
      if (res.status !== 0) {
        throw new Error(`apksigner falló (${res.status}): ${(res.stderr || res.stdout || '').trim()}`);
      }
    } else {
      execFileSync(apksigner, ['verify', '--print-certs', APK_PATH], { stdio: 'pipe' });
    }
    pass('Gate 7/8 Criptografía OTA + APK', `RSA-SHA256 + SHA-256 verificados en ${dirsToVerify.length} destino(s) y apksigner OK`);
  } catch (err) {
    fail('Gate 7/8 Criptografía OTA + APK', err.message);
  }

  // Gate 8: Presupuesto de tamaño y ausencia de chunks pesados en modulepreload inicial
  try {
    const apkMB = fs.statSync(APK_PATH).size / 1048576;
    const otaMB = fs.statSync(path.join(BACKEND_PUBLIC, 'dist.zip')).size / 1048576;
    const html = fs.readFileSync(path.join(DIST_MOBILE, 'index.html'), 'utf8');
    const preloads = html.match(/<link[^>]+rel="modulepreload"[^>]*>/g) || [];
    const forbiddenPreloads = preloads.filter((tag) => /vendor-charts|vendor-zxing|vendor-docs/i.test(tag));
    if (forbiddenPreloads.length > 0) {
      throw new Error(`Chunks pesados precargados en arranque: ${forbiddenPreloads.join(', ')}`);
    }
    if (apkMB > MAX_APK_MB) {
      throw new Error(`APK excede presupuesto: ${apkMB.toFixed(2)} MB > ${MAX_APK_MB} MB`);
    }
    if (otaMB > MAX_OTA_MB) {
      throw new Error(`OTA dist.zip excede presupuesto: ${otaMB.toFixed(2)} MB > ${MAX_OTA_MB} MB`);
    }
    pass('Gate 8/8 Presupuesto y Preload', `APK=${apkMB.toFixed(2)} MB (<= ${MAX_APK_MB} MB) | OTA=${otaMB.toFixed(2)} MB (<= ${MAX_OTA_MB} MB) | 0 chunks pesados en preload`);
  } catch (err) {
    fail('Gate 8/8 Presupuesto y Preload', err.message);
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n=== RESUMEN GATE: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal en verify_mobile_release:', err);
  process.exit(1);
});
