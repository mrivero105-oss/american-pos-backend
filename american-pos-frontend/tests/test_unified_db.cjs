#!/usr/bin/env node
/**
 * Runner funcional real de persistencia local Isaac POS (IsaacPosUnifiedDB + localDb).
 * Ejecuta pruebas reales con Vitest + fake-indexeddb en lugar de validar texto estático.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const frontendDir = path.resolve(__dirname, '..');
const vitestBin = path.join(frontendDir, 'node_modules', 'vitest', 'vitest.mjs');

console.log('\n--- VERIFICACIÓN FUNCIONAL REAL: IsaacPosUnifiedDB + localDb (fake-indexeddb) ---\n');
execFileSync(process.execPath, [vitestBin, 'run', 'tests/unit/unifiedDb.test.js'], {
    cwd: frontendDir,
    stdio: 'inherit'
});
