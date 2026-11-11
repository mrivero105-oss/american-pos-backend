const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const EXCEL_FILE = 'productos_exportacion_20251210.xlsx';
const DB_FILE = 'db.json';
const DB_BACKUP = 'db.json.bak_update_' + Date.now();

try {
    console.log(`=== INICIO DE ACTUALIZACIÓN ===`);

    // 1. Backup DB
    if (fs.existsSync(DB_FILE)) {
        fs.copyFileSync(DB_FILE, DB_BACKUP);
        console.log(`✅ Respaldo creado: ${DB_BACKUP}`);
    } else {
        console.error('❌ No se encontró db.json');
        process.exit(1);
    }

    // 2. Read DB
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    let products = db.products || [];
    console.log(`📊 Productos actuales en base de datos: ${products.length}`);

    // 3. Read Excel
    console.log(`📖 Leyendo Excel: ${EXCEL_FILE}...`);
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet);
    console.log(`📥 Filas en Excel: ${rawData.length}`);

    // Helper to map columns loosely
    const mapColumn = (row, possibleNames) => {
        for (const name of possibleNames) {
            const key = Object.keys(row).find(k => k.toLowerCase().includes(name.toLowerCase()));
            if (key) return row[key];
        }
        return null;
    };

    let updatedCount = 0;
    let createdCount = 0;

    // 4. Process Rows
    rawData.forEach((row, index) => {
        const name = mapColumn(row, ['nombre', 'name', 'producto', 'product', 'descripcion']);
        const price = parseFloat(mapColumn(row, ['precio', 'price', 'costo', 'venta', 'pvp']) || 0);
        const stock = parseInt(mapColumn(row, ['stock', 'cantidad', 'existencia', 'inventory']) || 0);
        const category = mapColumn(row, ['categoria', 'category', 'grupo']) || 'General';

        if (!name) return; // Skip empty rows

        // Normalize name for comparison
        const normalizedName = String(name).trim().toLowerCase();

        // Find existing
        const existingProduct = products.find(p => p.name.trim().toLowerCase() === normalizedName);

        if (existingProduct) {
            // UPDATE
            existingProduct.price = price;
            // Only update stock if explicitly provided in Excel (and not 0 if you want to keep current stock?)
            // Assumption: If stock is in Excel, user wants to overwrite it.
            if (!isNaN(stock)) existingProduct.stock = stock;

            // Should we update category?
            if (category && category !== 'General') existingProduct.category = category;

            updatedCount++;
        } else {
            // CREATE NEW
            const newProduct = {
                id: `prod_${Date.now()}_${index}`,
                name: String(name).trim(),
                price: price,
                stock: isNaN(stock) ? 0 : stock,
                category: String(category).trim(),
                imageUri: '', // No image for new imports
                barcode: '',
                userId: 'admin-import'
            };
            products.push(newProduct);
            createdCount++;
        }
    });

    // 5. Save DB
    db.products = products;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

    console.log(`\n=== RESUMEN ===`);
    console.log(`✅ Productos Actualizados: ${updatedCount}`);
    console.log(`✅ Productos Nuevos: ${createdCount}`);
    console.log(`📊 Total Productos Final: ${products.length}`);
    console.log(`💾 Base de datos guardada.`);

} catch (error) {
    console.error('❌ Error fatal:', error);
}
