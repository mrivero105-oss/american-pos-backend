#!/usr/bin/env node
/**
 * Suite unificada de verificación de Isaac POS (test:all).
 * Garantiza ejecución 100% aislada sobre PostgreSQL `americanpos_test` sin tocar `americanpos`,
 * carpetas de respaldo reales ni sincronización externa a Supabase.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(backendDir, '..', 'american-pos-frontend');
const useShell = process.platform === 'win32';
const cliArgs = new Set(process.argv.slice(2));
const skipSlowE2E = cliArgs.has('--quick') || cliArgs.has('--no-e2e');

const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-test-all-'));

const isolatedEnv = {
  ...process.env,
  ISAAC_TEST_ISOLATED: '1',
  NODE_ENV: 'test',
  DB_NAME_FORCE: 'americanpos_test',
  DISABLE_BACKGROUND_WORKERS: 'true',
  USER_DATA_PATH: tmpUserDataDir,
};

const steps = [
  {
    name: '[FE] ESLint strict (--max-warnings=0)',
    cwd: frontendDir,
    cmd: 'npx',
    args: ['eslint', '.', '--max-warnings=0'],
  },
  {
    name: '[FE] ESLint no-undef check',
    cwd: frontendDir,
    cmd: 'npx',
    args: ['eslint', 'src', '-c', 'eslint.undef-check.config.js'],
  },
  {
    name: '[FE] Vitest Unit & Component Suite (fake-indexeddb + RTL)',
    cwd: frontendDir,
    cmd: 'npm',
    args: ['run', 'test:unit'],
  },
  {
    name: '[FE] UnifiedDB functional verification',
    cwd: frontendDir,
    cmd: 'node',
    args: ['tests/test_unified_db.cjs'],
  },
  {
    name: '[BE] Blocks 1-4, PosIntegrity & Audit Regressions (R1-R8)',
    cwd: backendDir,
    cmd: 'node',
    args: [
      '--test',
      'tests/test_block1_security_fixes.test.mjs',
      'tests/test_block1_integrity_remediation.test.mjs',
      'tests/test_block2_financial_integrity.test.mjs',
      'tests/test_block3_associations_and_routes.test.mjs',
      'tests/test_block4_offline_sync_and_resilience.test.mjs',
      'tests/pos-integrity.test.mjs',
      'tests/test_audit_remediation_regressions.test.mjs',
      'tests/test_phase1_security_and_integrity.test.mjs',
      'tests/test_performance_999_pillars.test.mjs',
    ],
  },
  {
    name: '[BE] Security Audit Remediation',
    cwd: backendDir,
    cmd: 'node',
    args: ['tests/test_security_audit_remediation.js'],
  },
  {
    name: '[BE] Auth & Zero-Trust LAN Security',
    cwd: backendDir,
    cmd: 'node',
    args: ['tests/test_auth_security.js'],
  },
  {
    name: '[BE] Vortex Math BigInt Engine',
    cwd: backendDir,
    cmd: 'node',
    args: ['test_vortex_engine.js'],
  },
  {
    name: '[BE] Block 2 Security Hardening (RSA, DPAPI, RLS, Auth, Socket, ExcelJS)',
    cwd: backendDir,
    cmd: 'node',
    args: ['--test', 'tests/test_block2_security_hardening.test.mjs'],
  },
  {
    name: '[BE+GW] Online Licensing E2E (Heartbeat RSA, Gracia Offline, Suspensión Remota)',
    cwd: backendDir,
    cmd: 'node',
    args: ['--test', 'tests/test_online_licensing.test.mjs'],
  },
  {
    name: '[BE+GW] Hardening 10/10 Suite (RCE, SSRF, Zod v4, Zero-Trust, Arqueo, Audit HMAC, Variantes, Licencias)',
    cwd: backendDir,
    cmd: 'node',
    args: ['--test', '--test-concurrency=1', 'tests/test_hardening_10_of_10.test.mjs', 'tests/test_phase3_modern_stack.test.mjs'],
  },
  {
    name: '[BE] Mobile Audit Remediation Suite (Biometría ECDSA v2, RBAC, Modo Ciego, Gastos VES, Delta Sync, Sobregiro)',
    cwd: backendDir,
    cmd: 'node',
    args: ['--test', '--test-concurrency=1', 'tests/test_mobile_audit_remediation.test.mjs'],
  },
];

if (!skipSlowE2E) {
  steps.push(
    {
      name: '[BE] Real E2E Integration (Express + PG Test + Socket.IO JWT)',
      cwd: backendDir,
      cmd: 'node',
      args: ['--test', 'tests/test_e2e_api_and_socket.test.mjs'],
    },
    {
      name: '[FE+BE] Playwright Real Chrome E2E UI',
      cwd: frontendDir,
      cmd: 'npx',
      args: ['playwright', 'test'],
    }
  );
}

const results = [];
const totalStart = Date.now();

console.log('====================================================================');
console.log('🧪 ISAAC POS — SUITE UNIFICADA DE VERIFICACIÓN (DB: americanpos_test)');
console.log('====================================================================');

try {
  for (const step of steps) {
    const start = Date.now();
    console.log(`\n▶ Ejecutando: ${step.name}`);
    const proc = spawnSync(step.cmd, step.args, {
      cwd: step.cwd,
      env: isolatedEnv,
      stdio: 'inherit',
      shell: useShell,
    });
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(2);
    const ok = proc.status === 0 && !proc.error;
    results.push({ name: step.name, ok, code: proc.status, elapsedSec });

    if (!ok) {
      console.error(`\n❌ FALLÓ: ${step.name} (código ${proc.status}${proc.error ? `, ${proc.error.message}` : ''}) tras ${elapsedSec}s`);
      process.exitCode = proc.status || 1;
      break;
    }
    console.log(`✅ OK: ${step.name} (${elapsedSec}s)`);
  }
} finally {
  try {
    fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
  } catch (_) {}
}

if (!process.exitCode) {
  const totalSec = ((Date.now() - totalStart) / 1000).toFixed(2);
  console.log('\n====================================================================');
  console.log(`🎉 TODAS LAS SUITES PASARON (${results.length}/${results.length}) en ${totalSec}s`);
  console.log('====================================================================');
  for (const r of results) {
    console.log(`  ✔ ${r.name} (${r.elapsedSec}s)`);
  }
}
