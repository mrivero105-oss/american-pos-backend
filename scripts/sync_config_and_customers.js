const { Client } = require('../american-pos-backend/node_modules/pg');
const axios = require('../american-pos-backend/node_modules/axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('../american-pos-backend/node_modules/dotenv');

dotenv.config({ path: path.join(__dirname, '../american-pos-backend/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Define SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno.');
    process.exit(1);
}

const pgClient = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/americanpos' });

async function run() {
    await pgClient.connect();
    console.log('[CONFIG & CUSTOMERS SYNC] Conectado a PostgreSQL local.');

    // 1. Cargar Configuración de settings.json (Bodega Sigfrido, Tasa 1000)
    let settingsData = {};
    const settingsPath = 'C:\\Users\\mrive\\AppData\\Roaming\\isaac-pos\\settings.json';
    if (fs.existsSync(settingsPath)) {
        try {
            settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (e) {
            console.error('Error leyendo settings.json:', e.message);
        }
    }

    const companyConfig = settingsData['2'] || settingsData['default'] || {};
    const exchangeRate = Number(companyConfig.exchangeRate || 1000);
    const businessInfo = companyConfig.businessInfo || {};

    const cloudConfig = {
        id: 'general',
        tasa_cambio: exchangeRate,
        ultima_actualizacion_tasa: companyConfig.lastRateSyncAt || new Date().toISOString(),
        nombre_negocio: businessInfo.name || companyConfig.businessName || 'Bodega Sigfrido',
        rif_cedula: businessInfo.taxId || 'R-123456789-0',
        direccion: businessInfo.address || 'Boca de Uchire, Anzoategui',
        modo_moneda: companyConfig.currencyMode || 'BOTH',
        iva_porcentaje: Number(companyConfig.taxConfig?.ivaRate || 16.0),
        igtf_porcentaje: Number(companyConfig.taxConfig?.igtfRate || 3.0),
        actualizado_el: new Date().toISOString()
    };

    console.log('[CONFIG & CUSTOMERS SYNC] Subiendo configuración y tasa a cloud_configuracion:', cloudConfig);
    try {
        await axios.post(
            `${SUPABASE_URL}/rest/v1/cloud_configuracion`,
            [cloudConfig],
            {
                headers: {
                    'apikey': SERVICE_KEY,
                    'Authorization': `Bearer ${SERVICE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                }
            }
        );
        console.log('✅ Configuración y tasa de cambio subida con éxito a Supabase.');
    } catch (err) {
        console.error('❌ Error subiendo configuración:', err.response?.data || err.message);
    }

    // 2. Cargar Clientes de PostgreSQL
    console.log('[CONFIG & CUSTOMERS SYNC] Leyendo clientes locales...');
    const custRes = await pgClient.query(`
        SELECT 
            id,
            COALESCE(name, 'Cliente Sin Nombre') as nombre,
            COALESCE("idDocument", '') as identificacion,
            COALESCE(phone, '') as telefono,
            COALESCE(address, '') as direccion,
            COALESCE("creditLimit", 0) as limite_credito,
            COALESCE("creditBalance", 0) as saldo_pendiente,
            COALESCE("updatedAt", NOW()) as actualizado_el
        FROM "Customers"
    `);

    const formattedCustomers = custRes.rows.map(c => ({
        id: String(c.id),
        nombre: String(c.nombre).substring(0, 255),
        identificacion: String(c.identificacion || '').substring(0, 50),
        telefono: String(c.telefono || '').substring(0, 50),
        direccion: c.direccion || '',
        limite_credito: Number(Number(c.limite_credito || 0).toFixed(2)),
        saldo_pendiente: Number(Number(c.saldo_pendiente || 0).toFixed(2)),
        actualizado_el: c.actualizado_el
    }));

    console.log(`[CONFIG & CUSTOMERS SYNC] Subiendo ${formattedCustomers.length} clientes a cloud_clientes...`);
    try {
        await axios.post(
            `${SUPABASE_URL}/rest/v1/cloud_clientes`,
            formattedCustomers,
            {
                headers: {
                    'apikey': SERVICE_KEY,
                    'Authorization': `Bearer ${SERVICE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                }
            }
        );
        console.log(`✅ ${formattedCustomers.length} clientes subidos con éxito a Supabase.`);
    } catch (err) {
        console.error('❌ Error subiendo clientes:', err.response?.data || err.message);
    }

    await pgClient.end();
}

run().catch(console.error);
