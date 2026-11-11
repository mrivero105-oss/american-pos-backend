const fs = require('fs');
const path = require('path');
const dns = require('dns');
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

const SUPABASE_URL = 'https://puvqiipussyktfmgafgv.supabase.co';
const SECRET_KEY = '';
const BUCKET = 'product-images';
const IMAGES_DIR = 'C:/Users/mrive/AppData/Roaming/isaac-pos/product_images';

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function getMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function uploadFile(filename) {
  const filePath = path.join(IMAGES_DIR, filename);
  const fileBuffer = fs.readFileSync(filePath);
  const mime = getMime(filename);

  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(filename)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SECRET_KEY,
      'Authorization': `Bearer ${SECRET_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
      'User-Agent': 'IsaacPOS-PC-Server/1.0'
    },
    body: fileBuffer
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed for ${filename} (${res.status}): ${errText}`);
  }
}

async function run() {
  console.log('🚀 Iniciando subida masiva de imágenes a Supabase Storage...');
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error('Directorio de imágenes no encontrado:', IMAGES_DIR);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(IMAGES_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'].includes(ext);
  });

  console.log(`Total archivos a subir: ${allFiles.length}`);

  let completed = 0;
  let failed = 0;
  const CONCURRENCY = 10;
  const queue = [...allFiles];

  async function worker(workerId) {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      try {
        await uploadFile(file);
        completed++;
        if (completed % 50 === 0 || completed === allFiles.length) {
          console.log(`[Worker ${workerId}] Progreso: ${completed}/${allFiles.length} (${((completed / allFiles.length) * 100).toFixed(1)}%)`);
        }
      } catch (err) {
        failed++;
        console.error(`[Worker ${workerId}] Error con ${file}:`, err.message);
      }
    }
  }

  const startTime = Date.now();
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================================================================');
  console.log(`✅ Subida concluida en ${durationSec}s`);
  console.log(`Exitosos: ${completed} | Fallidos: ${failed}`);
  console.log(`Bucket público: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`);
  console.log('================================================================');
}

run().catch(console.error);
