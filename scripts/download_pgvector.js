const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function download() {
    const url = 'https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/0.8.7/vector.v0.8.7-pg16.zip';
    const tempDir = path.join(__dirname, '..', 'build_temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const zipPath = path.join(tempDir, 'pgvector_pg16.zip');
    const extractDir = path.join(tempDir, 'pgvector_extracted');
    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });

    console.log('Descargando pgvector para PostgreSQL 16 desde GitHub...');
    
    // Función para seguir redirects de GitHub Releases
    function getFile(fileUrl, dest) {
        return new Promise((resolve, reject) => {
            https.get(fileUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return getFile(res.headers.location, dest).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`Error HTTP: ${res.statusCode}`));
                }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', reject);
        });
    }

    await getFile(url, zipPath);
    console.log('✅ Descarga completada:', zipPath);

    console.log('Extrayendo archivo...');
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`);
    console.log('✅ Extracción completada en:', extractDir);

    const files = [];
    function scan(dir) {
        for (const item of fs.readdirSync(dir)) {
            const full = path.join(dir, item);
            if (fs.statSync(full).isDirectory()) scan(full);
            else files.push(full);
        }
    }
    scan(extractDir);
    console.log('Archivos extraídos:', files);
}

download().catch(console.error);
