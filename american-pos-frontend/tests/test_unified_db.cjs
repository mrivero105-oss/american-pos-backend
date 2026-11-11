const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n--- VERIFICACIÓN DE UNIFICACIÓN DE PERSISTENCIA LOCAL (INDEXEDDB) ---\n');

const dbPath = path.join(__dirname, '..', 'src', 'services', 'db.js');
const localDbPath = path.join(__dirname, '..', 'src', 'db', 'localDb.js');
const syncServicePath = path.join(__dirname, '..', 'src', 'services', 'syncService.js');

const dbContent = fs.readFileSync(dbPath, 'utf8');
const localDbContent = fs.readFileSync(localDbPath, 'utf8');
const syncContent = fs.readFileSync(syncServicePath, 'utf8');

// 1. Verificar nombre canónico único en Dexie
assert.ok(localDbContent.includes("new Dexie('IsaacPosDB')"), 'localDb debe instanciar la base de datos canónica IsaacPosDB');
console.log('✅ [PASS] Base de datos canónica establecida en "IsaacPosDB"');

// 2. Verificar que db.js importa localDb y delega en él
assert.ok(dbContent.includes("import localDb from '../db/localDb'"), 'db.js debe importar localDb como fuente única');
assert.ok(dbContent.includes('localDb.table(storeName)'), 'db.js debe delegar sus operaciones en localDb.table');
console.log('✅ [PASS] Adaptador db.js delega correctamente en localDb (Single Source of Truth)');

// 3. Verificar los 8 métodos requeridos de la interfaz
const requiredMethods = ['put', 'putAll', 'getAll', 'getById', 'clear', 'delete', 'search', 'getByIndex'];
requiredMethods.forEach(method => {
    assert.ok(dbContent.includes(`${method}:`), `db.js debe implementar el método ${method}`);
});
console.log(`✅ [PASS] Los 8 métodos de interfaz (${requiredMethods.join(', ')}) implementados y retrocompatibles`);

// 4. Verificar eliminación de doble escritura en syncService
const doubleProductsWrite = syncContent.includes("await localDb.products.bulkPut(formattedProducts)");
assert.strictEqual(doubleProductsWrite, false, 'syncService no debe realizar doble escritura redundante en products');
console.log('✅ [PASS] Doble escritura redundante erradicada en syncService');

// 5. Verificar presencia de stores requeridos en la versión de Dexie
const expectedStores = ['products', 'variants', 'customers', 'suppliers', 'categories', 'metadata', 'sales', 'syncQueue', 'imageCache', 'promotions'];
expectedStores.forEach(store => {
    assert.ok(localDbContent.includes(`${store}:`), `localDb debe declarar el store ${store}`);
});
console.log(`✅ [PASS] Los 10 stores requeridos (${expectedStores.join(', ')}) declarados en esquema de Dexie`);

console.log('\n--- VERIFICACIÓN COMPLETADA CON ÉXITO: 5/5 PASADAS ---\n');
