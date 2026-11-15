#!/usr/bin/env node
/**
 * Suite unificada de verificación de Isaac POS (test:all).
 * Garantiza ejecución 100% aislada sobre PostgreSQL `americanpos_test` sin tocar `americanpos`,
 * carpetas de respaldo reales ni sincronización externa a Supabase.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(backendDir, '..', 'american-pos-frontend');
const useShell = process.platform === 'win32';

const isolatedEnv = {
  ...process.env,
  ISAAC_TEST_ISOLATED: '1',
  NODE_ENV: 'test',
  DB_NAME_FORCE: 'americanpos_test',
  DISABLE_BACKGROUND_WORKERS: 'true',
};

const steps = [
  {
    name: '[FE] ESLint src --quiet',
    cwd: frontendDir,
    cmd: 'npx',
    args: ['eslint', 'src', '--quiet'],
  },
  {
    name: '[FE] ESLint no-undef check',
    cwd: frontendDir,
    cmd: 'npx',
    args: ['eslint', 'src', '-c', 'eslint.undef-check.config.js'],
  },
  {
    name: '[FE] UnifiedDB local tests',
    cwd: frontendDir,
    cmd: 'node',
    args: ['tests/test_unified_db.cjs'],
  },
  {
    name: '[BE] Blocks 1-4 & PosIntegrity',
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
    name: '[BE] Real E2E Integration (Express + PG Test + Socket.IO JWT)',
    cwd: backendDir,
    cmd: 'node',
    args: ['--test', 'tests/test_e2e_api_and_socket.test.mjs'],
  },
  {
    name: '[BE] Block 2 Security Hardening (RSA, DPAPI, RLS, Auth, Socket, ExcelJS)',
    cwd: backendDir,
    cmd: 'node',
    args: ['--test', 'tests/test_block2_security_hardening.test.mjs'],
  },
  {
    name: '[FE+BE] Playwright Real Chrome E2E UI',
    cwd: frontendDir,
    cmd: 'npx',
    args: ['playwright', 'test'],
  },
];

const results = [];
const totalStart = Date.now();

console.log('====================================================================');
console.log('🧪 ISAAC POS — SUITE UNIFICADA DE VERIFICACIÓN (DB: americanpos_test)');
console.log('====================================================================');

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
    process.exit(proc.status || 1);
  }
  console.log(`✅ OK: ${step.name} (${elapsedSec}s)`);
}

const totalSec = ((Date.now() - totalStart) / 1000).toFixed(2);
console.log('\n====================================================================');
console.log(`🎉 TODAS LAS SUITES PASARON (${results.length}/${results.length}) en ${totalSec}s`);
console.log('====================================================================');
for (const r of results) {
  console.log(`  ✔ ${r.name} (${r.elapsedSec}s)`);
}
