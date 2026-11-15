const fs = require('fs');
const path = require('path');
const axios = require('../american-pos-backend/node_modules/axios');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Define SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno.');
    process.exit(1);
}

async function uploadCurrentOTA() {
  const distZipPath = path.resolve(__dirname, '../american-pos-backend/public/dist.zip');
  const versionPath = path.resolve(__dirname, '../american-pos-backend/public/version.json');

  const zipBuffer = fs.readFileSync(distZipPath);
  const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

  console.log('Zip size:', (zipBuffer.length / (1024 * 1024)).toFixed(2), 'MB');

  // 1. Subir dist.zip a Supabase Storage
  console.log('Subiendo dist.zip a Supabase Storage...');
  const upZip = await axios.post(
    `${supabaseUrl}/storage/v1/object/app-updates/dist.zip`,
    zipBuffer,
    {
      headers: {
        Authorization: 'Bearer ' + supabaseKey,
        apikey: supabaseKey,
        'Content-Type': 'application/zip',
        'x-upsert': 'true'
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000
    }
  );
  console.log('dist.zip subido exitosamente:', upZip.data);

  // 2. Subir version.json con URL pública absoluta de Supabase
  const cloudVersion = {
    ...versionData,
    bundleUrl: `${supabaseUrl}/storage/v1/object/public/app-updates/dist.zip`
  };
  console.log('Subiendo version.json a Supabase Storage...');
  const upVer = await axios.post(
    `${supabaseUrl}/storage/v1/object/app-updates/version.json`,
    JSON.stringify(cloudVersion, null, 2),
    {
      headers: {
        Authorization: 'Bearer ' + supabaseKey,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
        'x-upsert': 'true'
      },
      timeout: 10000
    }
  );
  console.log('version.json subido exitosamente:', upVer.data);

  // 3. Probar lectura pública desde internet
  const testRes = await axios.get(`${supabaseUrl}/storage/v1/object/public/app-updates/version.json`);
  console.log('TEST_PUBLIC_VERSION:', testRes.data);
  console.log('✅ Éxito total: Actualizaciones móviles OTA ahora están 24/7 en Supabase Storage.');
}

uploadCurrentOTA().catch(e => {
  console.error('ERROR:', e.response?.data || e.message);
  process.exit(1);
});
