const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'public', 'assets');
const activeFiles = new Set();

function trace(file) {
    if (!file || activeFiles.has(file)) return;
    activeFiles.add(file);
    const full = path.join(assetsDir, file);
    if (!fs.existsSync(full)) return;
    const content = fs.readFileSync(full, 'utf8');

    // Match chunk filenames: e.g. "CashRegister-B1234567.js"
    const regex = /([a-zA-Z0-9_\-]+\-[a-zA-Z0-9_\-]{8}\.(?:js|css))/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const candidate = match[1];
        if (fs.existsSync(path.join(assetsDir, candidate))) {
            trace(candidate);
        }
    }
}

// Initial files in index.html
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const regexHtml = /assets\/([a-zA-Z0-9_\-]+\-[a-zA-Z0-9_\-]{8}\.(?:js|css))/g;
let m;
while ((m = regexHtml.exec(indexHtml)) !== null) {
    trace(m[1]);
}

console.log('Archivos ACTIVOS reales requeridos por el frontend:', activeFiles.size);
let activeBytes = 0;
for (const f of activeFiles) {
    activeBytes += fs.statSync(path.join(assetsDir, f)).size;
}
console.log('Tamaño total del frontend REAL ACTIVO:', (activeBytes / (1024 * 1024)).toFixed(2), 'MB');
console.log('Archivos OBSOLETOS en public/assets:', fs.readdirSync(assetsDir).length - activeFiles.size);
