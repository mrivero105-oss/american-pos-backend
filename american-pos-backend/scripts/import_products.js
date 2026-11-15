const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const EXCEL_FILE = 'productos_exportacion_20251125.xlsx';
const DB_FILE = 'db.json';

async function readExcelRows(filePath) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) return [];
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => {
        headers[col] = String(c?.text ?? c?.value ?? '').trim();
    });
    const rows = [];
    for (let r = 2; r <= ws.rowCount; r++) {
        const obj = {};
        let anyVal = false;
        ws.getRow(r).eachCell({ includeEmpty: false }, (c, col) => {
            const h = headers[col];
            if (!h || h === '__proto__' || h === 'constructor' || h === 'prototype') return;
            obj[h] = (c.value && typeof c.value === 'object' && 'result' in c.value) ? c.value.result : c.value;
            anyVal = true;
        });
        if (anyVal) rows.push(obj);
    }
    return rows;
}

(async () => {
try {
    console.log(`Leyendo archivo Excel: ${EXCEL_FILE}...`);
    const rawData = await readExcelRows(EXCEL_FILE);
    console.log(`Filas encontradas: ${rawData.length}`);

    if (rawData.length === 0) {
        console.error('El archivo Excel está vacío o no se pudo leer.');
        process.exit(1);
    }

    // Detect columns
    const firstRow = rawData[0];
    console.log('Columnas detectadas:', Object.keys(firstRow));

    const mapColumn = (row, possibleNames) => {
        for (const name of possibleNames) {
            // Case insensitive search
            const key = Object.keys(row).find(k => k.toLowerCase().includes(name.toLowerCase()));
            if (key) return row[key];
        }
        return null;
    };

    const products = rawData.map((row, index) => {
        const name = mapColumn(row, ['nombre', 'name', 'producto', 'product', 'descripcion', 'description']) || `Producto ${index + 1}`;
        const price = parseFloat(mapColumn(row, ['precio', 'price', 'costo', 'venta', 'pvp']) || 0);
        const stock = parseInt(mapColumn(row, ['stock', 'cantidad', 'existencia', 'inventory', 'qty']) || 0);
        const barcode = mapColumn(row, ['codigo', 'code', 'barcode', 'sku', 'id']) || `GEN-${Date.now()}-${index}`;
        const category = mapColumn(row, ['categoria', 'category', 'grupo', 'departamento']) || 'General';

        return {
            id: `prod_${Date.now()}_${index}`,
            name: String(name).trim(),
            price: isNaN(price) ? 0 : price,
            stock: isNaN(stock) ? 0 : stock,
            category: String(category).trim(),
            imageUri: '', // Default empty
            barcode: String(barcode).trim()
        };
    });

    console.log(`Procesados ${products.length} productos.`);

    // Read existing DB
    let db = { products: [], customers: [], sales: [] };
    if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }

    // Update products (replace or append? Let's replace to be clean as requested)
    // User said "borrar los productos de prueba", so replace is safer.
    db.products = products;

    // Write DB
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    console.log('Base de datos actualizada correctamente.');

} catch (error) {
    console.error('Error al importar:', error);
    process.exitCode = 1;
}
})();
