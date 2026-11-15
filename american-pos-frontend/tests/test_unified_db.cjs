const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n--- VERIFICACIÓN DE UNIFICACIÓN DE PERSISTENCIA LOCAL (UNIFIED DB + SQLITE) ---\n');

const dbPath = path.join(__dirname, '..', 'src', 'services', 'db.js');
const localDbPath = path.join(__dirname, '..', 'src', 'db', 'localDb.js');
const syncServicePath = path.join(__dirname, '..', 'src', 'services', 'syncService.js');
const syncManagerPath = path.join(__dirname, '..', 'src', 'services', 'syncManager.js');
const posContextPath = path.join(__dirname, '..', 'src', 'hooks', 'PosContext.jsx');
const checkoutModalPath = path.join(__dirname, '..', 'src', 'components', 'CheckoutModal.jsx');
const inventoryPagePath = path.join(__dirname, '..', 'src', 'pages', 'Inventory.jsx');
const mobilePosPath = path.join(__dirname, '..', 'src', 'pages', 'MobilePOSSimulator.jsx');

const dbContent = fs.readFileSync(dbPath, 'utf8');
const localDbContent = fs.readFileSync(localDbPath, 'utf8');
const syncContent = fs.readFileSync(syncServicePath, 'utf8');
const syncManagerContent = fs.readFileSync(syncManagerPath, 'utf8');
const posContextContent = fs.readFileSync(posContextPath, 'utf8');
const checkoutModalContent = fs.readFileSync(checkoutModalPath, 'utf8');
const inventoryPageContent = fs.readFileSync(inventoryPagePath, 'utf8');
const mobilePosContent = fs.readFileSync(mobilePosPath, 'utf8');

// 1. Verificar nombre canónico único en db.js (IsaacPosUnifiedDB)
assert.ok(dbContent.includes("const UNIFIED_DB_NAME = 'IsaacPosUnifiedDB'"), 'db.js debe declarar la base de datos canónica IsaacPosUnifiedDB');
console.log('✅ [PASS] Base de datos unificada establecida en "IsaacPosUnifiedDB"');

// 2. Verificar que localDb.js delega en unifiedDb (../services/db) como fuente única
assert.ok(localDbContent.includes("import { db as unifiedDb } from '../services/db'"), 'localDb.js debe delegar en unifiedDb como fuente única');
assert.ok(localDbContent.includes('unifiedDb.getAll(storeName)'), 'localDb.js debe delegar lecturas en unifiedDb');
assert.ok(localDbContent.includes('unifiedDb.replaceAllAtomic'), 'localDb.js debe soportar rollback atómico de transacciones');
console.log('✅ [PASS] Adaptador localDb.js delega en unifiedDb (Single Source of Truth)');

// 3. Verificar los métodos requeridos de interfaz en db.js
const requiredMethods = ['put', 'putAll', 'getAll', 'getById', 'clear', 'delete', 'search', 'getByIndex'];
requiredMethods.forEach(method => {
    assert.ok(dbContent.includes(`${method}:`), `db.js debe implementar el método ${method}`);
});
console.log(`✅ [PASS] Los ${requiredMethods.length} métodos de interfaz (${requiredMethods.join(', ')}) implementados en db.js`);

// 4. Verificar eliminación de doble escritura redundante en syncService
const doubleProductsWrite = syncContent.includes('await localDb.products.bulkPut(formattedProducts)');
assert.strictEqual(doubleProductsWrite, false, 'syncService no debe realizar doble escritura redundante en products');
console.log('✅ [PASS] Doble escritura redundante erradicada en syncService');

// 5. Verificar presencia de los stores requeridos en STORE_KEY_PATHS de db.js
const expectedStores = ['products', 'variants', 'customers', 'suppliers', 'categories', 'metadata', 'sales', 'syncQueue', 'imageCache', 'promotions', 'expenses', 'cashShifts'];
expectedStores.forEach(store => {
    assert.ok(dbContent.includes(`${store}:`), `db.js debe declarar el store ${store}`);
});
console.log(`✅ [PASS] Los ${expectedStores.length} stores requeridos (${expectedStores.join(', ')}) declarados en db.js`);

// 6. Verificar cuarentena 4xx en syncManager y separación de conteo pendiente vs errores
assert.ok(syncManagerContent.includes("status: 'sync_error'"), 'syncManager debe enviar a cuarentena los 4xx tras agotar reintentos');
assert.ok(syncManagerContent.includes('failedPermanent: true'), 'syncManager debe marcar failedPermanent en cuarentena');
assert.ok(syncManagerContent.includes("'sync-queue-error'"), 'syncManager debe emitir evento sync-queue-error');
assert.ok(syncManagerContent.includes('syncErrorCount') && syncManagerContent.includes('quarantinedCount'), 'getPendingCount debe reportar syncErrorCount y quarantinedCount');

// 7. Verificar guard de autenticación pre-login en PosContext para evitar 401 en /cash/current
assert.ok(
    posContextContent.includes("if (!user || !localStorage.getItem('auth_token'))") &&
    posContextContent.includes('if (user && localStorage.getItem(\'auth_token\')) {\n                fetchShiftStatus();') || posContextContent.includes("if (user && localStorage.getItem('auth_token')) {\r\n                fetchShiftStatus();"),
    'PosContext debe proteger fetchShiftStatus y handlePosDataSynced contra llamadas sin sesión activa'
);

// 8. Verificar compatibilidad UnifiedDB/PosContext en Inventory, CheckoutModal y MobilePOSSimulator
assert.ok(!inventoryPageContent.includes('db.products.toArray()'), 'Inventory.jsx no debe usar API Dexie obsoleta db.products.toArray()');
assert.ok(inventoryPageContent.includes("db.getAll('products')"), 'Inventory.jsx debe usar UnifiedDB db.getAll("products")');
assert.ok(checkoutModalContent.includes('posContext?.cart || posContext?.posState?.cart'), 'CheckoutModal.jsx debe leer cart de PosContext con respaldo posState.cart');
assert.ok(!mobilePosContent.includes('localDb.sales.reverse().limit('), 'MobilePOSSimulator.jsx no debe encadenar .reverse().limit() directo sobre TableWrapper');

console.log('✅ [PASS] Integridad de SyncManager (cuarentena 4xx), PosContext auth guard y vistas UnifiedDB verificada');
console.log('\n--- VERIFICACIÓN COMPLETADA CON ÉXITO: 8/8 PASADAS ---\n');
