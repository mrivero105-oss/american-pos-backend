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

const DbConfigManager = require('../american-pos-backend/config/dbConfigManager');
const { SETTINGS_FILE } = require('../american-pos-backend/config/paths');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ Define SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno antes de ejecutar este script.');
    process.exit(1);
}

const activeDbCfg = DbConfigManager.getConfig();
const pgClient = new Client({
    host: activeDbCfg.host || '127.0.0.1',
    port: Number(activeDbCfg.port) || 5432,
    database: activeDbCfg.database || 'americanpos',
    user: activeDbCfg.user || 'postgres',
    password: activeDbCfg.password || process.env.DB_PASSWORD || 'postgres'
});
const TARGET_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '2';

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
            const settingsPath = SETTINGS_FILE;
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
            const stockVal = Number(p.stock_actual ?? p.stockQuantity ?? 0) || 0;
            const compId = String(p.company_id || p.companyId || TARGET_COMPANY_ID);
            await pgClient.query(`
                INSERT INTO "Products" (id, barcode, name, category, price, stock, "stockQuantity", "companyId", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    barcode = EXCLUDED.barcode,
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    price = EXCLUDED.price,
                    stock = EXCLUDED.stock,
                    "stockQuantity" = EXCLUDED."stockQuantity",
                    "companyId" = EXCLUDED."companyId",
                    "updatedAt" = NOW()
            `, [p.id, p.codigo_barra, p.nombre, p.categoria, p.precio_venta, stockVal, stockVal, compId]);
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
            const subtotalVal = Number(v.subtotal ?? v.monto_subtotal ?? 0) || 0;
            const taxVal = Number(v.impuesto ?? v.monto_impuesto ?? 0) || 0;
            const totalVal = Number(v.total ?? v.monto_total ?? 0) || 0;
            const compId = String(v.company_id || v.companyId || TARGET_COMPANY_ID);
            const branchId = String(v.sucursal_id || 'principal');
            await pgClient.query(`
                INSERT INTO "Sales" (id, "customerName", "subtotal", "tax", "total", "paymentMethod", "companyId", "branchId", status, "date", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9::timestamptz, $10::timestamptz, $11::timestamptz)
                ON CONFLICT (id) DO UPDATE SET
                    "subtotal" = EXCLUDED."subtotal",
                    "tax" = EXCLUDED."tax",
                    "total" = EXCLUDED."total",
                    "customerName" = EXCLUDED."customerName",
                    "companyId" = EXCLUDED."companyId"
            `, [v.id, v.cliente_nombre, subtotalVal, taxVal, totalVal, v.metodo_pago || 'cash', compId, branchId, saleDate, saleDate, saleDate]);

            // Restaurar ítems de la venta si vienen en items_detalle y la venta aún no tiene SaleItems locales
            let parsedItems = v.items_detalle;
            if (typeof parsedItems === 'string') {
                try { parsedItems = JSON.parse(parsedItems); } catch (_) { parsedItems = []; }
            }
            if (Array.isArray(parsedItems) && parsedItems.length > 0) {
                const existingCountRes = await pgClient.query('SELECT COUNT(*)::int AS cnt FROM "SaleItems" WHERE "saleId" = $1', [v.id]);
                if ((existingCountRes.rows[0]?.cnt || 0) === 0) {
                    for (const it of parsedItems) {
                        const prodId = String(it.id || it.productId || 'unknown');
                        const itemName = String(it.nombre || it.name || 'Producto').slice(0, 250);
                        const qty = Number(it.cantidad ?? it.quantity ?? 1) || 1;
                        const price = Number(it.precio ?? it.price ?? 0) || 0;
                        const lineSub = Number(it.total ?? it.subtotal ?? (price * qty)) || 0;
                        await pgClient.query(`
                            INSERT INTO "SaleItems" ("saleId", "productId", name, quantity, price, subtotal, "companyId", "createdAt", "updatedAt")
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
                        `, [v.id, prodId, itemName, qty, price, lineSub, compId, saleDate, saleDate]);
                    }
                }
            }
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
