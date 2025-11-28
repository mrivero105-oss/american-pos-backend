const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'migration.sql');
const outputDir = path.join(__dirname, 'migration_chunks');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

const content = fs.readFileSync(inputFile, 'utf8');
const lines = content.split('\n').filter(line => line.trim() !== '');

const CHUNK_SIZE = 100; // Number of lines per chunk
let chunkIndex = 1;

for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunk = lines.slice(i, i + CHUNK_SIZE).join('\n');
    const chunkFile = path.join(outputDir, `chunk_${chunkIndex}.sql`);
    fs.writeFileSync(chunkFile, chunk);
    console.log(`Created ${chunkFile}`);
    chunkIndex++;
}

console.log(`Split into ${chunkIndex - 1} chunks.`);
