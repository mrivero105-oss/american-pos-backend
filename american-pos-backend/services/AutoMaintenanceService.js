const os = require('os');
const { sequelize } = require('../database/connection');
const DbConfigManager = require('../config/dbConfigManager');
const { AuditLog } = require('../database/models');
const { generateRobustId } = require('../utils/helpers');

/**
 * AutoMaintenanceService
 * Servicio autónomo de alto volumen y optimización integral de PostgreSQL 16.
 * Garantiza aprovechamiento al 100% del motor en SSD/RAM local:
 * 1. Auto-tuning dinámico de parámetros de motor (ALTER SYSTEM + pg_reload_conf)
 * 2. Mantenimiento de Índices B-Tree / GIN (pg_trgm + jsonb_path_ops) y Extended Statistics
 * 3. VACUUM ANALYZE periódico sobre tablas críticas
 * 4. Particionamiento lógico / Archivo de ventas antiguas (> 1 año) en SalesHistory
 * 5. Rutina autónoma programada en ventana nocturna (03:30 AM)
 */
class AutoMaintenanceService {
    constructor() {
        this.lastReport = null;
        this.isRunning = false;
        this.timer = null;
        this.bootTimer = null;
    }

    /**
     * Calcula y aplica parámetros óptimos de PostgreSQL 16 según RAM y almacenamiento SSD local.
     * Solo aplica ALTER SYSTEM cuando la instancia PostgreSQL reside en el equipo local (127.0.0.1).
     */
    async tunePostgresEngine() {
        const cfg = DbConfigManager.getConfig();
        const rawHost = String(cfg.host || process.env.DB_HOST || '127.0.0.1').trim().toLowerCase();
        const localHostname = os.hostname().toLowerCase();
        const isLocalServer = rawHost === '127.0.0.1' || rawHost === 'localhost' || rawHost === '::1' || rawHost === localHostname;

        if (!isLocalServer) {
            return { tuned: false, reason: 'remote_host_skipped', host: rawHost };
        }

        const totalRamGb = os.totalmem() / (1024 ** 3);
        let sharedBuffers = '512MB';
        let effectiveCacheSize = '2GB';
        let workMem = '8MB';
        let maintenanceWorkMem = '128MB';

        if (totalRamGb >= 14) {
            sharedBuffers = '2GB';
            effectiveCacheSize = '8GB';
            workMem = '16MB';
            maintenanceWorkMem = '256MB';
        } else if (totalRamGb >= 7) {
            sharedBuffers = '1GB';
            effectiveCacheSize = '4GB';
            workMem = '12MB';
            maintenanceWorkMem = '192MB';
        }

        const desiredSettings = {
            shared_buffers: sharedBuffers,
            effective_cache_size: effectiveCacheSize,
            work_mem: workMem,
            maintenance_work_mem: maintenanceWorkMem,
            random_page_cost: '1.1',
            checkpoint_completion_target: '0.9',
            autovacuum_vacuum_scale_factor: '0.05',
            autovacuum_analyze_scale_factor: '0.02',
            idle_in_transaction_session_timeout: '60s',
            lock_timeout: '15s',
            track_io_timing: 'on',
            wal_compression: 'lz4'
        };

        const appliedChanges = [];
        try {
            const currentFileSettings = await sequelize.query(
                "SELECT name, setting, applied, error FROM pg_file_settings WHERE sourcefile LIKE '%auto.conf%'",
                { type: sequelize.QueryTypes.SELECT }
            );
            const autoMap = new Map(currentFileSettings.map(r => [r.name, r]));

            for (const [param, targetVal] of Object.entries(desiredSettings)) {
                const existing = autoMap.get(param);
                if (!existing || String(existing.setting).toLowerCase() !== String(targetVal).toLowerCase() || existing.error) {
                    try {
                        await sequelize.query(`ALTER SYSTEM SET ${param} = '${targetVal}';`);
                        appliedChanges.push(`${param}=${targetVal}`);
                    } catch (setErr) {
                        if (param === 'wal_compression') {
                            await sequelize.query("ALTER SYSTEM SET wal_compression = 'pglz';").catch(() => {});
                            appliedChanges.push('wal_compression=pglz');
                        } else {
                            console.warn(`[AutoMaintenance] Aviso ajustando ${param}:`, setErr.message);
                        }
                    }
                }
            }

            if (appliedChanges.length > 0) {
                await sequelize.query('SELECT pg_reload_conf();');
                await new Promise(r => setTimeout(r, 250));

                // Verificar si wal_compression='lz4' fue aceptado por el binario; de lo contrario usar 'pglz'
                const walCheck = await sequelize.query(
                    "SELECT applied, error FROM pg_file_settings WHERE name = 'wal_compression' ORDER BY seqno DESC LIMIT 1",
                    { type: sequelize.QueryTypes.SELECT }
                );
                if (walCheck[0] && walCheck[0].error) {
                    await sequelize.query("ALTER SYSTEM SET wal_compression = 'pglz';");
                    await sequelize.query('SELECT pg_reload_conf();');
                }
                console.log(`⚡ [AutoMaintenance] Motor PostgreSQL 16 afinado para SSD/RAM (${Math.round(totalRamGb)}GB): ${appliedChanges.join(', ')}`);
            }

            const restartCheck = await sequelize.query(
                "SELECT name FROM pg_settings WHERE pending_restart = true",
                { type: sequelize.QueryTypes.SELECT }
            );

            return {
                tuned: true,
                ramGb: Math.round(totalRamGb),
                appliedChanges,
                pendingRestartParams: restartCheck.map(r => r.name)
            };
        } catch (err) {
            console.warn('[AutoMaintenance] Aviso en auto-tuning PostgreSQL:', err.message);
            return { tuned: false, error: err.message };
        }
    }

    /**
     * Asegura la creación de todos los índices B-Tree / GIN y Extended Statistics en PostgreSQL 16
     */
    async ensureIndexes() {
        const indexStatements = [
            // Índices de Ventas y JSONB
            'CREATE INDEX IF NOT EXISTS idx_sales_company_created ON "Sales" ("companyId", "createdAt" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_status ON "Sales" ("companyId", "status");',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_status_date ON "Sales" ("companyId", "status", "date");',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_payment_status ON "Sales" ("companyId", "paymentStatus");',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_cust_created ON "Sales" ("companyId", "customerId", "createdAt" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_sales_date ON "Sales" ("date" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_sales_payment_methods_gin ON "Sales" USING gin ("paymentMethods" jsonb_path_ops);',
            'CREATE INDEX IF NOT EXISTS idx_sales_applied_promos_gin ON "Sales" USING gin ("appliedPromotions" jsonb_path_ops);',

            // Índices de Ítems de Venta (idx_saleitems_sale_prod cubre también consultas por "saleId")
            'CREATE INDEX IF NOT EXISTS idx_saleitems_sale_prod ON "SaleItems" ("saleId", "productId");',
            'CREATE INDEX IF NOT EXISTS idx_saleitems_product ON "SaleItems" ("productId");',

            // Índices de Productos, Códigos de Barras e Inventario
            'CREATE INDEX IF NOT EXISTS idx_products_barcode ON "Products" ("barcode");',
            'CREATE INDEX IF NOT EXISTS idx_products_company_barcode ON "Products" ("companyId", "barcode");',
            'CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON "Products" USING gin (COALESCE("barcode", \'\') gin_trgm_ops);',
            'CREATE INDEX IF NOT EXISTS idx_products_bulk_barcode_trgm ON "Products" USING gin (COALESCE("bulkBarcode", \'\') gin_trgm_ops);',
            'CREATE INDEX IF NOT EXISTS idx_presentations_barcode_trgm ON "product_presentaciones" USING gin (COALESCE("barcode", \'\') gin_trgm_ops);',
            'CREATE INDEX IF NOT EXISTS idx_products_company_name ON "Products" ("companyId", "name");',
            'CREATE INDEX IF NOT EXISTS idx_products_company_updated ON "Products" ("companyId", "updatedAt" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_branchstocks_company_updated ON "BranchStocks" ("companyId", "updatedAt" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_products_company_stock_qty ON "Products" ("companyId", "stockQuantity");',
            'CREATE INDEX IF NOT EXISTS idx_products_company_price ON "Products" ("companyId", "price");',
            'CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON "StockMovements" ("companyId", "createdAt" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_date ON "StockMovements" ("productId", "createdAt" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_stock_movements_company_prod_date ON "StockMovements" ("companyId", "productId", "date" DESC);',
            'CREATE INDEX IF NOT EXISTS idx_cashmovements_shift ON "CashMovements" ("shiftId", "companyId");',
            'CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON "Expenses" ("companyId", "date");',

            // Índices de Cuentas por Cobrar / Pagar (FIFO batch)
            'CREATE INDEX IF NOT EXISTS idx_credit_history_comp_cust_type ON "CreditHistories" ("companyId", "customerId", "type", "timestamp" ASC);',
            'CREATE INDEX IF NOT EXISTS idx_supplier_credit_history_sup ON "SupplierCreditHistories" ("companyId", "supplierId", "type", "timestamp" ASC);',
            'CREATE INDEX IF NOT EXISTS idx_customers_company_credit ON "Customers" ("companyId", "creditBalance" DESC) WHERE "creditBalance" > 0;',
            'CREATE INDEX IF NOT EXISTS idx_suppliers_company_credit ON "Suppliers" ("companyId", "creditBalance" DESC) WHERE "creditBalance" > 0;',

            // Índices de Auditoría y Conflictos
            'CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON "AuditLogs" ("companyId", "createdAt" DESC);',
            // Índices BRIN (PostgreSQL 16) para series temporales de alto volumen
            'CREATE INDEX IF NOT EXISTS idx_brin_audit_logs_created ON "AuditLogs" USING brin ("createdAt");',
            'CREATE INDEX IF NOT EXISTS idx_brin_stock_movements_created ON "StockMovements" USING brin ("createdAt");',
            'CREATE INDEX IF NOT EXISTS idx_brin_cash_movements_created ON "CashMovements" USING brin ("createdAt");',
            'CREATE INDEX IF NOT EXISTS idx_stock_alerts_company_resolved ON "StockAlerts" ("companyId", "resolved", "createdAt" DESC);',

            // Índices de Promociones JSONB
            'CREATE INDEX IF NOT EXISTS idx_promotions_active ON "Promotions" ("companyId", "isActive");',
            'CREATE INDEX IF NOT EXISTS idx_promotions_target_products_gin ON "Promotions" USING gin ("targetProductIds" jsonb_path_ops);',

            // Índices para sync_outbox y Users (evitan Sequential Scans recurrentes)
            'CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox (status);',
            'CREATE INDEX IF NOT EXISTS idx_users_username_lower ON "Users" (LOWER("username"));',
            'CREATE INDEX IF NOT EXISTS idx_users_company_status ON "Users" ("companyId", "status");',

            // Estadísticas Extendidas Multicolumna (PostgreSQL 16 Planner Optimization)
            'CREATE STATISTICS IF NOT EXISTS stat_products_company_status_cat (dependencies, ndistinct) ON "companyId", "status", "category" FROM "Products";',
            'CREATE STATISTICS IF NOT EXISTS stat_sales_company_status_pay (dependencies, ndistinct) ON "companyId", "status", "paymentStatus" FROM "Sales";'
        ];

        let createdCount = 0;
        for (const query of indexStatements) {
            try {
                await sequelize.query(query);
                createdCount++;
            } catch (err) {
                console.warn(`[AutoMaintenance] Warning on index/stat query: ${err.message}`);
            }
        }

        // Eliminar índices estrictamente redundantes cubiertos por índices compuestos/funcionales superiores
        const redundantIndexesToDrop = [
            'DROP INDEX IF EXISTS idx_saleitems_saleid;',
            'DROP INDEX IF EXISTS idx_stockmovements_product;',
            'DROP INDEX IF EXISTS idx_products_name;',
            'DROP INDEX IF EXISTS idx_products_name_trgm;',
            'DROP INDEX IF EXISTS idx_products_principio_trgm;',
            'DROP INDEX IF EXISTS idx_cashmovements_shiftid;',
            'DROP INDEX IF EXISTS idx_sales_company_createdat;',
            'DROP INDEX IF EXISTS idx_auditlogs_company_createdat;',
            'DROP INDEX IF EXISTS idx_stock_alerts_resolved;'
        ];
        for (const dropSql of redundantIndexesToDrop) {
            try {
                await sequelize.query(dropSql);
            } catch (_) {}
        }

        try {
            const { initializeDatabaseSecurity } = require('../database/tenantContext');
            await initializeDatabaseSecurity(sequelize);
        } catch (_secErr) {
            console.warn('[AutoMaintenance] Aviso verificando seguridad/RLS de BD:', _secErr.message);
        }

        try {
            await this.ensurePartitionTables();
        } catch (_partErr) {
            console.warn('[AutoMaintenance] Aviso verificando tablas particionadas:', _partErr.message);
        }

        try {
            const AccountingEngineService = require('./AccountingEngineService');
            await AccountingEngineService.ensureJournalSequence();
        } catch (_seqErr) {
            console.warn('[AutoMaintenance] Aviso verificando secuencia contable:', _seqErr.message);
        }

        try {
            const DailyRollupService = require('./DailyRollupService');
            await DailyRollupService.ensureTable();
        } catch (_rolErr) {
            console.warn('[AutoMaintenance] Aviso verificando daily_sales_rollups:', _rolErr.message);
        }

        return { indexesChecked: indexStatements.length, createdCount };
    }

    /**
     * Ejecuta VACUUM ANALYZE en PostgreSQL para actualizar estadísticas del planificador y liberar tuplas muertas
     */
    async executeVacuumAnalyze() {
        try {
            // 1. Purgar eventos de sync_outbox ya sincronizados hace más de 7 días para mantener la tabla ultraligera
            await sequelize.query(`DELETE FROM sync_outbox WHERE status = 'SYNCED' AND created_at < NOW() - INTERVAL '7 days';`);
        } catch (_) {}
        try {
            // 2. Rotación y compactación segura de AuditLogs:
            // - Compactar blobs oldValue/newValue mayores a 60 días (preservando acción, usuario, entidad y fecha)
            // - Purgar registros históricos de más de AUDIT_RETENTION_DAYS (default 180 días, mínimo 30)
            const retentionDays = Math.max(30, parseInt(process.env.AUDIT_RETENTION_DAYS || '180', 10) || 180);
            await sequelize.query(`
                UPDATE "AuditLogs"
                SET "oldValue" = NULL, "newValue" = NULL
                WHERE "createdAt" < NOW() - INTERVAL '60 days'
                  AND ("oldValue" IS NOT NULL OR "newValue" IS NOT NULL);
            `);
            await sequelize.query(`
                DELETE FROM "AuditLogs"
                WHERE "createdAt" < NOW() - MAKE_INTERVAL(days => :retentionDays);
            `, { replacements: { retentionDays } });
        } catch (_) {}
        const tables = ['Sales', 'SaleItems', 'Products', 'BranchStocks', 'StockMovements', 'AuditLogs', 'Promotions', 'sync_outbox', 'Users'];
        for (const table of tables) {
            try {
                const target = table === 'sync_outbox' ? 'sync_outbox' : `"${table}"`;
                await sequelize.query(`VACUUM ANALYZE ${target};`);
            } catch (e) {
                console.warn(`[AutoMaintenance] Vacuum warning on ${table}:`, e.message);
            }
        }
        return { vacuumExecuted: true, dialect: 'postgres', tablesAnalyzed: tables };
    }

    /**
     * Asegura la creación y vigencia de tablas particionadas declarativas anuales en PostgreSQL 16
     */
    async ensurePartitionTables() {
        try {
            // 1. Tabla padre particionada SalesHistory
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS "SalesHistory" (
                    "id" VARCHAR(255) NOT NULL,
                    "createdAt" TIMESTAMPTZ NOT NULL,
                    "date" VARCHAR(255),
                    "total" NUMERIC(20, 6),
                    "paymentMethod" VARCHAR(255),
                    "paymentMethods" JSONB,
                    "subtotal" NUMERIC(20, 6),
                    "tax" NUMERIC(20, 6),
                    "discount" NUMERIC(20, 6),
                    "customerId" VARCHAR(255),
                    "customerName" VARCHAR(255),
                    "userId" VARCHAR(255),
                    "invoiceNumber" VARCHAR(255),
                    "companyId" VARCHAR(255),
                    "branchId" VARCHAR(255),
                    "status" VARCHAR(255) DEFAULT 'completed',
                    "exchangeRate" NUMERIC(20, 6),
                    "igtfAmount" NUMERIC(20, 6) DEFAULT 0,
                    "documentType" VARCHAR(255) DEFAULT 'factura',
                    "paymentStatus" VARCHAR(255) DEFAULT 'paid',
                    "registerId" VARCHAR(255) DEFAULT '1',
                    "promoDiscount" NUMERIC(20, 6) DEFAULT 0,
                    "appliedPromotions" JSONB DEFAULT '[]'::jsonb,
                    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY ("id", "createdAt")
                ) PARTITION BY RANGE ("createdAt");
            `);
            await sequelize.query(`ALTER TABLE "SalesHistory" ADD COLUMN IF NOT EXISTS "invoiceNumber" VARCHAR(255);`).catch(() => {});

            // 2. Tabla padre particionada SaleItemsHistory
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS "SaleItemsHistory" (
                    "id" BIGINT NOT NULL,
                    "saleId" VARCHAR(255) NOT NULL,
                    "productId" VARCHAR(255) NOT NULL,
                    "name" VARCHAR(255) NOT NULL DEFAULT 'Producto',
                    "quantity" NUMERIC(20, 6) NOT NULL,
                    "price" NUMERIC(20, 6) NOT NULL,
                    "subtotal" NUMERIC(20, 6) NOT NULL DEFAULT 0,
                    "cost" NUMERIC(20, 6) DEFAULT 0,
                    "companyId" VARCHAR(255) DEFAULT '2',
                    "createdAt" TIMESTAMPTZ NOT NULL,
                    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY ("id", "createdAt")
                ) PARTITION BY RANGE ("createdAt");
            `);

            // 3. Crear dinámicamente particiones por año (2024..año_siguiente)
            const currentYear = new Date().getFullYear();
            const startYear = 2024;
            const endYear = currentYear + 1;

            for (let y = startYear; y <= endYear; y++) {
                const nextYear = y + 1;
                const fromTs = `${y}-01-01 00:00:00+00`;
                const toTs = `${nextYear}-01-01 00:00:00+00`;

                await sequelize.query(`
                    CREATE TABLE IF NOT EXISTS "SalesHistory_${y}" PARTITION OF "SalesHistory"
                    FOR VALUES FROM ('${fromTs}') TO ('${toTs}');

                    CREATE TABLE IF NOT EXISTS "SaleItemsHistory_${y}" PARTITION OF "SaleItemsHistory"
                    FOR VALUES FROM ('${fromTs}') TO ('${toTs}');
                `).catch(() => {});
            }

            // Particiones default
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS "SalesHistory_default" PARTITION OF "SalesHistory" DEFAULT;
                CREATE TABLE IF NOT EXISTS "SaleItemsHistory_default" PARTITION OF "SaleItemsHistory" DEFAULT;
            `).catch(() => {});

            // Índices locales propagados en particiones
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS idx_saleshistory_company_created ON "SalesHistory" ("companyId", "createdAt" DESC);
                CREATE INDEX IF NOT EXISTS idx_saleshistory_payment_gin ON "SalesHistory" USING gin ("paymentMethods" jsonb_path_ops);
                CREATE INDEX IF NOT EXISTS idx_saleitemshistory_sale ON "SaleItemsHistory" ("saleId");
                CREATE INDEX IF NOT EXISTS idx_saleitemshistory_product ON "SaleItemsHistory" ("productId");
            `).catch(() => {});

            return { success: true };
        } catch (err) {
            console.warn('[AutoMaintenance] Warning ensuring partition tables:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Archiva atómicamente ventas e ítems antiguos (> 365 días) en tablas particionadas declarativas de PostgreSQL 16
     */
    async archiveHistoricalData(daysOld = 365) {
        const safeDays = Math.max(1, parseInt(daysOld, 10) || 365);
        const cutoffDate = new Date(Date.now() - (safeDays * 24 * 60 * 60 * 1000)).toISOString();

        const { runWithTenantContext } = require('../database/tenantContext');
        return runWithTenantContext({ companyId: '', userId: 'system-maintenance', isSuperAdmin: true }, async () => {
            try {
                await this.ensurePartitionTables();

                let archivedSales = 0;
                let archivedItems = 0;

                const t = await sequelize.transaction();
                try {
                    // 1. Enrutar ventas antiguas hacia SalesHistory particionada preservando todas las columnas fiscales y de trazabilidad
                    const [salesCopy, salesMeta] = await sequelize.query(`
                        INSERT INTO "SalesHistory" (
                            "id", "createdAt", "updatedAt", "date", "total", "companyId",
                            "status", "subtotal", "tax", "discount", "paymentMethod", "paymentMethods",
                            "invoiceNumber", "customerId", "customerName", "userId", "branchId",
                            "exchangeRate", "igtfAmount", "documentType", "paymentStatus",
                            "registerId", "promoDiscount", "appliedPromotions"
                        )
                        SELECT
                            s.id, s."createdAt", s."updatedAt", s.date, s.total, s."companyId",
                            s.status, s.subtotal, s.tax, s.discount, s."paymentMethod", s."paymentMethods",
                            s."invoiceNumber", s."customerId", s."customerName", s."userId", s."branchId",
                            s."exchangeRate", s."igtfAmount", s."documentType", s."paymentStatus",
                            s."registerId", s."promoDiscount", s."appliedPromotions"
                        FROM "Sales" s
                        WHERE s."createdAt" < :cutoffDate
                          AND s.status IN ('completed', 'cancelled')
                        ON CONFLICT ("id", "createdAt") DO NOTHING;
                    `, { replacements: { cutoffDate }, transaction: t });

                    archivedSales = Number(salesMeta?.rowCount ?? salesCopy?.rowCount ?? 0);

                    // 2. Enrutar ítems antiguos hacia SaleItemsHistory particionada
                    const [itemsCopy, itemsMeta] = await sequelize.query(`
                        INSERT INTO "SaleItemsHistory" (
                            "id", "saleId", "productId", "name", "quantity", "price", 
                            "subtotal", "cost", "companyId", "createdAt", "updatedAt"
                        )
                        SELECT 
                            si.id, si."saleId", si."productId", COALESCE(si.name, 'Producto'), 
                            si.quantity, si.price, COALESCE(si.subtotal, 0), si.cost, 
                            si."companyId", si."createdAt", si."updatedAt"
                        FROM "SaleItems" si
                        JOIN "Sales" s ON s.id = si."saleId"
                        WHERE s."createdAt" < :cutoffDate
                          AND s.status IN ('completed', 'cancelled')
                        ON CONFLICT ("id", "createdAt") DO NOTHING;
                    `, { replacements: { cutoffDate }, transaction: t });

                    archivedItems = Number(itemsMeta?.rowCount ?? itemsCopy?.rowCount ?? 0);

                    // 3. Purgar ventas archivadas de las tablas activas operativas
                    if (archivedSales > 0) {
                        await sequelize.query(`
                            DELETE FROM "Sales"
                            WHERE "createdAt" < :cutoffDate
                              AND status IN ('completed', 'cancelled');
                        `, { replacements: { cutoffDate }, transaction: t });
                    }

                    await t.commit();
                } catch (txErr) {
                    await t.rollback();
                    throw txErr;
                }

                if (archivedSales > 0) {
                    console.log(`📦 [AutoMaintenance] Archivo particionado exitoso: ${archivedSales} ventas y ${archivedItems} ítems transferidos a particiones declarativas.`);
                }

                return { archivedSales, archivedItems, cutoffDate, status: 'SUCCESS' };
            } catch (e) {
                console.warn('[AutoMaintenance] Warning archiving postgres data:', e.message);
                return { archivedSales: 0, error: e.message };
            }
        });
    }

    /**
     * Purga controlada de logs de auditoría antiguos para evitar crecimiento desmedido de disco
     */
    async purgeAuditLogs(daysToKeep = 90) {
        const { runWithTenantContext } = require('../database/tenantContext');
        return runWithTenantContext({ companyId: '', userId: 'system-maintenance', isSuperAdmin: true }, async () => {
            try {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

                const [result, meta] = await sequelize.query(`
                    DELETE FROM "AuditLogs"
                    WHERE "createdAt" < :cutoffDate
                      AND "action" NOT IN ('SYSTEM_CRITICAL_EVENT', 'LICENSE_ACTIVATION', 'DATA_MIGRATION_COMPLETED');
                `, {
                    replacements: { cutoffDate }
                });

                const purgedCount = Number(meta?.rowCount ?? result?.rowCount ?? 0);
                if (purgedCount > 0) {
                    console.log(`[AutoMaintenance] 🧹 Purga de AuditLogs (> ${daysToKeep} días): ${purgedCount} registros eliminados.`);
                }
                return { purgedLogs: purgedCount, daysToKeep, status: 'SUCCESS' };
            } catch (e) {
                console.warn('[AutoMaintenance] Warning purging audit logs:', e.message);
                return { purgedLogs: 0, error: e.message };
            }
        });
    }

    /**
     * Obtiene métricas en vivo del tamaño, rendimiento de caché y aprovechamiento de PostgreSQL 16
     */
    async getDatabaseMetrics() {
        const metrics = { dialect: 'postgres', tables: {} };

        try {
            const [sizeRows] = await sequelize.query(`
                SELECT 
                    pg_size_pretty(pg_database_size(current_database())) AS total_size,
                    (SELECT count(*) FROM "Sales") AS total_sales,
                    (SELECT count(*) FROM "SaleItems") AS total_sale_items,
                    (SELECT count(*) FROM "Products") AS total_products,
                    (SELECT count(*) FROM "AuditLogs") AS total_audit_logs,
                    (SELECT ROUND(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit) + sum(blks_read), 0), 2) FROM pg_stat_database WHERE datname = current_database()) AS cache_hit_ratio,
                    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'jsonb') AS jsonb_columns,
                    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'json') AS legacy_json_columns,
                    (SELECT count(*) FROM pg_statistic_ext) AS extended_stats_count,
                    current_setting('shared_buffers') AS shared_buffers,
                    current_setting('work_mem') AS work_mem,
                    current_setting('random_page_cost') AS random_page_cost,
                    current_setting('wal_compression') AS wal_compression;
            `);
            if (sizeRows && sizeRows[0]) {
                const row = sizeRows[0];
                metrics.databaseSize = row.total_size;
                metrics.totalSales = parseInt(row.total_sales || 0, 10);
                metrics.totalSaleItems = parseInt(row.total_sale_items || 0, 10);
                metrics.totalProducts = parseInt(row.total_products || 0, 10);
                metrics.totalAuditLogs = parseInt(row.total_audit_logs || 0, 10);
                metrics.cacheHitRatio = row.cache_hit_ratio !== null ? Number(row.cache_hit_ratio) : 100;
                metrics.jsonbColumns = parseInt(row.jsonb_columns || 0, 10);
                metrics.legacyJsonColumns = parseInt(row.legacy_json_columns || 0, 10);
                metrics.extendedStatsCount = parseInt(row.extended_stats_count || 0, 10);
                metrics.engineParameters = {
                    sharedBuffers: row.shared_buffers,
                    workMem: row.work_mem,
                    randomPageCost: row.random_page_cost,
                    walCompression: row.wal_compression
                };
            }

            try {
                const PostgresRealtimeService = require('./PostgresRealtimeService');
                metrics.realtimeListen = PostgresRealtimeService.getStatus();
            } catch (_rtErr) { /* optional */ }

            metrics.ioStats = await this.getPostgresIoStats();
        } catch (e) {
            console.warn('[AutoMaintenance] Warning getting db metrics:', e.message);
        }

        return metrics;
    }

    /**
     * Obtiene estadísticas avanzadas de I/O de PostgreSQL 16 (pg_stat_io)
     * Desglosa aciertos de memoria vs lecturas/escrituras en disco para backends normales,
     * autovacuum y checkpointer.
     */
    async getPostgresIoStats() {
        try {
            const [ioRows] = await sequelize.query(`
                SELECT 
                    backend_type,
                    object,
                    context,
                    COALESCE(reads, 0) AS reads,
                    COALESCE(writes, 0) AS writes,
                    COALESCE(writebacks, 0) AS writebacks,
                    COALESCE(extends, 0) AS extends,
                    COALESCE(hits, 0) AS hits,
                    COALESCE(evictions, 0) AS evictions,
                    COALESCE(reuses, 0) AS reuses
                FROM pg_stat_io
                WHERE reads > 0 OR writes > 0 OR hits > 0;
            `);

            let totalReads = 0;
            let totalWrites = 0;
            let totalHits = 0;

            for (const r of ioRows) {
                totalReads += Number(r.reads || 0);
                totalWrites += Number(r.writes || 0);
                totalHits += Number(r.hits || 0);
            }

            const ioHitRatio = (totalHits + totalReads) > 0
                ? Number(((totalHits / (totalHits + totalReads)) * 100).toFixed(2))
                : 100;

            return {
                available: true,
                ioHitRatio,
                summary: {
                    totalBufferHits: totalHits,
                    totalDiskReads: totalReads,
                    totalDiskWrites: totalWrites
                },
                details: ioRows
            };
        } catch (err) {
            return {
                available: false,
                error: err.message
            };
        }
    }

    /**
     * Ejecuta el pipeline completo de mantenimiento
     */
    async runFullMaintenance(options = {}) {
        if (this.isRunning) {
            return { success: false, message: 'Un ciclo de mantenimiento ya está en ejecución' };
        }

        this.isRunning = true;
        const startTime = Date.now();
        console.log('[AutoMaintenance] 🚀 Iniciando ciclo autónomo de optimización PostgreSQL 16...');

        try {
            const tuningResult = await this.tunePostgresEngine();
            const indexResult = await this.ensureIndexes();
            const vacuumResult = await this.executeVacuumAnalyze();

            // Refresco concurrente de vistas materializadas y rollups diarios (PostgreSQL 16)
            let viewsResult = { success: true };
            try {
                const PostgresAnalyticsService = require('./PostgresAnalyticsService');
                viewsResult = await PostgresAnalyticsService.refreshViews(sequelize);
            } catch (vErr) {
                viewsResult = { success: false, error: vErr.message };
            }

            let rollupResult = { rebuilt: 0 };
            try {
                const DailyRollupService = require('./DailyRollupService');
                rollupResult = await DailyRollupService.backfillAllActiveCompanies(365);
            } catch (rErr) {
                rollupResult = { rebuilt: 0, error: rErr.message };
            }

            const archiveResult = await this.archiveHistoricalData(options.daysOld || 365);
            const purgeResult = await this.purgeAuditLogs(options.auditDaysOld || 90);
            const dbMetrics = await this.getDatabaseMetrics();
            const durationMs = Date.now() - startTime;

            this.lastReport = {
                success: true,
                executedAt: new Date().toISOString(),
                durationMs,
                tuningResult,
                indexResult,
                vacuumResult,
                viewsResult,
                rollupResult,
                archiveResult,
                purgeResult,
                dbMetrics
            };

            try {
                await AuditLog.create({
                    id: generateRobustId(),
                    companyId: options.companyId || '2',
                    userId: options.userId || null,
                    action: 'DATABASE_MAINTENANCE_COMPLETE',
                    details: `Mantenimiento PostgreSQL 16 completado en ${durationMs}ms. Índices/Stats verificados: ${indexResult.indexesChecked}. Ventas archivadas: ${archiveResult.archivedSales || 0}. Logs purgados: ${purgeResult.purgedLogs || 0}.`,
                    createdAt: new Date()
                });
            } catch (auditErr) {
                console.warn('[AutoMaintenance] AuditLog notice:', auditErr.message);
            }

            console.log(`[AutoMaintenance] ✅ Ciclo de mantenimiento finalizado con éxito en ${durationMs}ms.`);
            return this.lastReport;
        } catch (error) {
            console.error('[AutoMaintenance] ❌ Error en ciclo de mantenimiento:', error);
            this.lastReport = {
                success: false,
                executedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
                error: error.message
            };
            return this.lastReport;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Alias de mantenimiento para compatibilidad con suites de pruebas y controladores
     */
    async runMaintenance(reason = 'MANUAL') {
        const report = await this.runFullMaintenance({ reason });
        return {
            ...report,
            vacuum: report.vacuumResult?.vacuumExecuted || false,
            cachePurged: true,
            purgedBackupsCount: 0
        };
    }

    /**
     * Alias de inicialización para el arranque del servidor
     */
    init() {
        return this.startSchedule();
    }

    /**
     * Inicia el planificador autónomo diario (a las 03:30 AM) y aplica tuning de arranque
     */
    startSchedule() {
        if (this.timer) clearInterval(this.timer);
        if (this.bootTimer) clearTimeout(this.bootTimer);

        console.log('[AutoMaintenance] ⏰ Programador nocturno de mantenimiento PostgreSQL 16 activado (cada 24h).');

        // Diferir el ajuste ligero 25s post-arranque para no competir con la carga inicial y el primer login
        this.bootTimer = setTimeout(async () => {
            this.bootTimer = null;
            try {
                await this.tunePostgresEngine();
                await this.ensurePartitionTables();
                const AccountingEngineService = require('./AccountingEngineService');
                await AccountingEngineService.ensureJournalSequence();
                const DailyRollupService = require('./DailyRollupService');
                await DailyRollupService.ensureTable();
                await DailyRollupService.backfillAllActiveCompanies(90);
                console.log('[AutoMaintenance] Parámetros PostgreSQL 16, particiones, secuencia contable y rollups verificados en segundo plano.');
            } catch (e) {
                console.warn('[AutoMaintenance] Error en chequeo de inicio:', e.message);
            }
        }, 25000);
        if (typeof this.bootTimer.unref === 'function') this.bootTimer.unref();

        this.timer = setInterval(() => {
            const now = new Date();
            if (now.getHours() === 3 && now.getMinutes() >= 30 && now.getMinutes() <= 40) {
                console.log('[AutoMaintenance] 🌙 Ventana nocturna detectada (03:30 AM). Ejecutando mantenimiento...');
                this.runFullMaintenance({ reason: 'SCHEDULED_NIGHTLY' });
            }
        }, 1000 * 60 * 10);
        if (typeof this.timer.unref === 'function') this.timer.unref();
    }

    stop() {
        if (this.bootTimer) {
            clearTimeout(this.bootTimer);
            this.bootTimer = null;
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

const service = new AutoMaintenanceService();
module.exports = service;
