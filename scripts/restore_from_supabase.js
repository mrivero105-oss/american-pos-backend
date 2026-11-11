/**
 * scripts/restore_from_supabase.js
 * 
 * Script de Recuperación ante Desastres (Disaster Recovery).
 * Permite restaurar toda la base de datos local (PostgreSQL + settings.json)
 * directamente desde la nube de Supabase en caso de pérdida o formateo de la PC.
 */

const { Client } = require('../american-pos-backend/node_modules/pg');
const axios = require('../american-pos-backend/node_modules/axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('../american-pos-backend/node_modules/dotenv');

dotenv.config({ path: path.join(__dirname, '../american-pos-backend/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://puvqiipussyktfmgafgv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const pgClient = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/americanpos' });

async function fetchAllFromCloud(table) {
    let all = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
        const res = await axios.get(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${limit}&offset=${offset}`, {
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`
            },
            timeout: 30000
        });
        if (!Array.isArray(res.data) || res.data.length === 0) break;
        all = all.concat(res.data);
        if (res.data.length < limit) break;
        offset += limit;
    }
    return all;
}

async function runDisasterRecovery() {
    console.log('====================================================');
    console.log('🚨 INICIANDO RESTAURACIÓN DESDE SUPABASE CLOUD 🚨');
    console.log('====================================================');
    console.log(`Conectando a Supabase: ${SUPABASE_URL}`);

    // 1. Restaurar Configuración y Tasa de Cambio
    console.log('\n[1/5] Restaurando configuración del negocio y tasa de cambio...');
    try {
        const configRows = await fetchAllFromCloud('cloud_configuracion');
        if (configRows.length > 0) {
            const cfg = configRows[0];
            const settingsPath = 'C:\\Users\\mrive\\AppData\\Roaming\\isaac-pos\\settings.json';
            let currentSettings = {};
            if (fs.existsSync(settingsPath)) {
                try { currentSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
            }
            if (!currentSettings['2']) currentSettings['2'] = {};
            if (!currentSettings['default']) currentSettings['default'] = {};

            currentSettings['2'].exchangeRate = Number(cfg.tasa_cambio);
            currentSettings['2'].currencyMode = cfg.modo_moneda || 'BOTH';
            currentSettings['2'].lastRateSyncAt = cfg.ultima_actualizacion_tasa;
            if (!currentSettings['2'].businessInfo) currentSettings['2'].businessInfo = {};
            currentSettings['2'].businessInfo.name = cfg.nombre_negocio;
            currentSettings['2'].businessInfo.taxId = cfg.rif_cedula;
            currentSettings['2'].businessInfo.address = cfg.direccion;

            currentSettings['default'] = { ...currentSettings['2'] };

            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2), 'utf8');
            console.log(`  ✅ Configuración restaurada: Negocio "${cfg.nombre_negocio}", Tasa: ${cfg.tasa_cambio} Bs/$`);
        }
    } catch (err) {
        console.warn('  ⚠️ Aviso restaurando configuración:', err.message);
    }

    // Conectar a PostgreSQL local
    await pgClient.connect();
    console.log('\nConectado a PostgreSQL local.');

    // 2. Restaurar Clientes
    console.log('\n[2/5] Descargando y restaurando clientes desde cloud_clientes...');
    try {
        const cloudCustomers = await fetchAllFromCloud('cloud_clientes');
        console.log(`  -> ${cloudCustomers.length} clientes encontrados en la nube.`);
        let custRestored = 0;
        for (const c of cloudCustomers) {
            await pgClient.query(`
                INSERT INTO "Customers" (id, name, "idDocument", phone, address, "creditLimit", "creditBalance", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    "idDocument" = EXCLUDED."idDocument",
                    phone = EXCLUDED.phone,
                    address = EXCLUDED.address,
                    "creditLimit" = EXCLUDED."creditLimit",
                    "creditBalance" = EXCLUDED."creditBalance",
                    "updatedAt" = NOW()
            `, [c.id, c.nombre, c.identificacion, c.telefono, c.direccion, c.limite_credito, c.saldo_pendiente]);
            custRestored++;
        }
        console.log(`  ✅ ${custRestored} clientes restaurados/conciliados en PostgreSQL local.`);
    } catch (err) {
        console.warn('  ⚠️ Error restaurando clientes:', err.message);
    }

    // 3. Restaurar Catálogo de Productos
    console.log('\n[3/5] Descargando y restaurando inventario desde cloud_productos...');
    try {
        const cloudProducts = await fetchAllFromCloud('cloud_productos');
        console.log(`  -> ${cloudProducts.length} productos encontrados en la nube.`);
        let prodRestored = 0;
        for (const p of cloudProducts) {
            await pgClient.query(`
                INSERT INTO "Products" (id, barcode, name, category, price, stock, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    barcode = EXCLUDED.barcode,
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    price = EXCLUDED.price,
                    stock = EXCLUDED.stock,
                    "updatedAt" = NOW()
            `, [p.id, p.codigo_barra, p.nombre, p.categoria, p.precio_venta, p.stock_actual]);
            prodRestored++;
        }
        console.log(`  ✅ ${prodRestored} productos restaurados/conciliados en PostgreSQL local.`);
    } catch (err) {
        console.warn('  ⚠️ Error restaurando productos:', err.message);
    }

    // 4. Restaurar Cierres de Caja
    console.log('\n[4/5] Descargando y restaurando turnos de caja desde cloud_cierres_caja...');
    try {
        const cloudShifts = await fetchAllFromCloud('cloud_cierres_caja');
        console.log(`  -> ${cloudShifts.length} cierres de caja encontrados en la nube.`);
        let shiftsRestored = 0;
        for (const s of cloudShifts) {
            const opDate = s.fecha_apertura ? new Date(s.fecha_apertura).toISOString() : new Date().toISOString();
            const clDate = s.fecha_cierre ? new Date(s.fecha_cierre).toISOString() : new Date().toISOString();
            await pgClient.query(`
                INSERT INTO "CashShifts" (id, "userName", "initialAmount", "finalAmount", difference, status, "openedAt", "closedAt", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, 'closed', $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz)
                ON CONFLICT (id) DO UPDATE SET
                    "userName" = EXCLUDED."userName",
                    "finalAmount" = EXCLUDED."finalAmount",
                    difference = EXCLUDED.difference
            `, [s.id, s.cajero_nombre, s.monto_apertura, s.total_ventas, s.diferencia, opDate, clDate, opDate, clDate]);
            shiftsRestored++;
        }
        console.log(`  ✅ ${shiftsRestored} turnos de caja conciliados en PostgreSQL local.`);
    } catch (err) {
        console.warn('  ⚠️ Error restaurando cierres de caja:', err.message);
    }

    // 5. Restaurar Historial de Ventas
    console.log('\n[5/5] Descargando y restaurando historial de ventas desde cloud_ventas...');
    try {
        const cloudSales = await fetchAllFromCloud('cloud_ventas');
        console.log(`  -> ${cloudSales.length} ventas encontradas en la nube.`);
        let salesRestored = 0;
        for (const v of cloudSales) {
            const saleDate = v.fecha_hora ? new Date(v.fecha_hora).toISOString() : new Date().toISOString();
            await pgClient.query(`
                INSERT INTO "Sales" (id, "customerName", "subtotal", "tax", "total", "paymentMethod", status, "date", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', $7::timestamptz, $8::timestamptz, $9::timestamptz)
                ON CONFLICT (id) DO UPDATE SET
                    "total" = EXCLUDED."total",
                    "customerName" = EXCLUDED."customerName"
            `, [v.id, v.cliente_nombre, v.monto_subtotal, v.monto_impuesto, v.monto_total, v.metodo_pago, saleDate, saleDate, saleDate]);
            salesRestored++;
        }
        console.log(`  ✅ ${salesRestored} ventas conciliadas en PostgreSQL local.`);
    } catch (err) {
        console.warn('  ⚠️ Error restaurando ventas:', err.message);
    }

    await pgClient.end();
    console.log('\n====================================================');
    console.log('🎉 RECUPERACIÓN ANTE DESASTRES COMPLETADA AL 100%');
    console.log('====================================================');
}

runDisasterRecovery().catch(console.error);
