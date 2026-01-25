/**
 * Script para unificar campos de stock
 * - Mantiene solo el campo 'stock'
 * - Elimina el campo 'stockQuantity'
 * - Para productos por peso, asegura que tenga stockUnit
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'db.json');

function cleanupStock() {
    console.log('📦 Iniciando limpieza de campos de stock...\n');

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    if (!db.products || db.products.length === 0) {
        console.log('❌ No hay productos en la base de datos');
        return;
    }

    let cleanedCount = 0;
    let weightedCount = 0;

    db.products = db.products.map(product => {
        const changes = [];

        // Si tiene stockQuantity, decidir qué valor usar
        if (product.stockQuantity !== undefined) {
            // Si stockQuantity es válido y positivo, usarlo
            // Si no, mantener stock original
            if (product.stockQuantity !== null && product.stockQuantity >= 0) {
                if (product.stock !== product.stockQuantity) {
                    changes.push(`stock: ${product.stock} → ${product.stockQuantity}`);
                    product.stock = product.stockQuantity;
                }
            }
            // Eliminar stockQuantity
            delete product.stockQuantity;
            changes.push('eliminado stockQuantity');
            cleanedCount++;
        }

        // Para productos por peso, asegurar que tenga stockUnit
        const isWeighted = product.isSoldByWeight === 1 || product.isSoldByWeight === '1' || product.isSoldByWeight === true;
        if (isWeighted) {
            if (!product.stockUnit) {
                product.stockUnit = 'kg'; // Default a kg
                changes.push('agregado stockUnit: kg');
            }
            weightedCount++;
        }

        // Asegurar que stock sea número
        if (typeof product.stock === 'string') {
            product.stock = parseFloat(product.stock) || 0;
            changes.push('stock convertido a número');
        }

        if (changes.length > 0) {
            console.log(`  ${product.name}: ${changes.join(', ')}`);
        }

        return product;
    });

    // Crear backup antes de guardar
    const backupFile = DB_FILE + '.bak_stock_cleanup_' + Date.now();
    fs.copyFileSync(DB_FILE, backupFile);
    console.log(`\n💾 Backup creado: ${path.basename(backupFile)}`);

    // Guardar cambios
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

    console.log(`\n✅ Limpieza completada!`);
    console.log(`   - Productos procesados: ${db.products.length}`);
    console.log(`   - Campos stockQuantity eliminados: ${cleanedCount}`);
    console.log(`   - Productos por peso: ${weightedCount}`);
}

cleanupStock();
