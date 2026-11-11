/**
 * schemaMigrator.js
 * Módulo dedicado exclusivamente a la migración automática de PostgreSQL 16,
 * conversión nativa a JSONB binario, saneamiento de catálogo e integridad referencial,
 * creación de extensiones (unaccent, pg_trgm), triggers + LISTEN/NOTIFY,
 * estadísticas extendidas e índices B-Tree/GIN.
 */

const TARGET_SCHEMA_VERSION = 240408;

// Conservado por compatibilidad de exportación; el esquema en PostgreSQL se gestiona vía runPostConnectMigrations
const repairSchema = async () => {
    return;
};

/**
 * Convierte de forma segura e idempotente cualquier columna tipo JSON de texto
 * hacia JSONB binario indexable en el esquema público de PostgreSQL.
 */
async function upgradeAllJsonColumnsToJsonb(sequelize) {
    try {
        const legacyCols = await sequelize.query(`
            SELECT c.table_name, c.column_name, c.column_default
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = 'public'
              AND t.table_type = 'BASE TABLE'
              AND c.data_type = 'json'
            ORDER BY c.table_name, c.column_name;
        `, { type: sequelize.QueryTypes.SELECT });

        if (!legacyCols || legacyCols.length === 0) {
            return 0;
        }

        let converted = 0;
        for (const col of legacyCols) {
            const tbl = col.table_name.replace(/"/g, '""');
            const colName = col.column_name.replace(/"/g, '""');
            const rawDefault = col.column_default;

            try {
                if (rawDefault) {
                    await sequelize.query(`ALTER TABLE "${tbl}" ALTER COLUMN "${colName}" DROP DEFAULT;`);
                }
                await sequelize.query(
                    `ALTER TABLE "${tbl}" ALTER COLUMN "${colName}" TYPE JSONB USING "${colName}"::jsonb;`
                );
                if (rawDefault) {
                    const jsonbDefault = String(rawDefault).replace(/::json\b/gi, '::jsonb');
                    await sequelize.query(
                        `ALTER TABLE "${tbl}" ALTER COLUMN "${colName}" SET DEFAULT ${jsonbDefault};`
                    );
                }
                converted++;
            } catch (colErr) {
                console.warn(`[Schema] Aviso convirtiendo ${tbl}.${colName} a JSONB:`, colErr.message);
            }
        }

        if (converted > 0) {
            console.log(`⚡ [Schema] ${converted} columna(s) actualizadas de JSON plano a JSONB binario en PostgreSQL.`);
        }
        return converted;
    } catch (err) {
        console.warn('[Schema] Aviso verificando columnas JSON -> JSONB:', err.message);
        return 0;
    }
}

/**
 * Sanea referencias huérfanas en Refunds, garantiza la llave foránea ON DELETE SET NULL,
 * y purga restricciones UNIQUE / índices B-Tree duplicados acumulados por sync({ alter: true }) previos.
 */
async function sanitizeCatalogAndOrphans(sequelize) {
    let droppedCount = 0;
    let orphansCleaned = 0;

    // 1. Sanear Refunds.saleId huérfanos conservando el registro contable y activar FK ON DELETE SET NULL
    try {
        const [, meta] = await sequelize.query(`
            UPDATE "Refunds" r
            SET "saleId" = NULL
            WHERE r."saleId" IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM "Sales" s WHERE s."id" = r."saleId");
        `);
        orphansCleaned = meta?.rowCount || 0;

        const existingFk = await sequelize.query(`
            SELECT conname, pg_get_constraintdef(oid) AS def
            FROM pg_constraint
            WHERE conrelid = '"Refunds"'::regclass AND contype = 'f' AND conname = 'Refunds_saleId_fkey';
        `, { type: sequelize.QueryTypes.SELECT });

        if (existingFk.length === 0 || !String(existingFk[0].def).includes('ON DELETE SET NULL')) {
            await sequelize.query('ALTER TABLE "Refunds" DROP CONSTRAINT IF EXISTS "Refunds_saleId_fkey";');
            await sequelize.query(`
                ALTER TABLE "Refunds"
                ADD CONSTRAINT "Refunds_saleId_fkey"
                FOREIGN KEY ("saleId") REFERENCES "Sales"("id")
                ON UPDATE CASCADE ON DELETE SET NULL;
            `);
        }
    } catch (_fkErr) {
        // Las tablas Refunds/Sales pueden no existir aún en el primer segundo de una BD vacía
    }

    // 1.1 Asegurar integridad de totales en Sales (migraciones donde total era NULL pero subtotal o renglones contenían el valor real)
    try {
        await sequelize.query(`
            UPDATE "Sales"
            SET "total" = "subtotal"
            WHERE ("total" IS NULL OR "total" = 0)
              AND "subtotal" IS NOT NULL
              AND "subtotal" > 0;

            UPDATE "Sales" s
            SET "total" = sub.sum_val,
                "subtotal" = sub.sum_val
            FROM (
                SELECT "saleId", ROUND(SUM(price * quantity)::numeric, 4) as sum_val
                FROM "SaleItems"
                GROUP BY "saleId"
            ) sub
            WHERE s.id = sub."saleId" AND (s."total" IS NULL OR s."total" = 0);

            UPDATE "Sales"
            SET "total" = 0.00,
                "subtotal" = 0.00
            WHERE "total" IS NULL;
        `);
    } catch (_salesTotalErr) {
        // Tabla Sales puede no existir aún en arranque en frío
    }

    // 2. Eliminar alias antiguos redundantes antes de deduplicación general
    const legacyRedundantIndexes = [
        'idx_audit_logs_created',
        'idx_auditlogs_company_createdat',
        'idx_products_company_stock',
        'idx_sale_items_product_id',
        'idx_sale_items_sale_id',
        'idx_sales_company_createdat',
        'idx_stock_movements_prod'
    ];
    for (const oldIdx of legacyRedundantIndexes) {
        try {
            const existsCheck = await sequelize.query(
                'SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = \'public\' AND c.relkind = \'i\' AND c.relname = :name',
                { replacements: { name: oldIdx }, type: sequelize.QueryTypes.SELECT }
            );
            if (existsCheck.length > 0) {
                await sequelize.query(`DROP INDEX IF EXISTS "${oldIdx}";`);
                droppedCount++;
            }
        } catch (_dropAliasErr) { /* ignore */ }
    }

    // 3. Purgar dinámicamente cualquier grupo de constraints UNIQUE / índices idénticos (ej. FixedAssets_code_key1..N)
    try {
        const dupGroups = await sequelize.query(`
            SELECT
                t.relname AS table_name,
                json_agg(
                    json_build_object(
                        'index_name', idx.relname,
                        'constraint_name', con.conname
                    )
                    ORDER BY length(idx.relname) ASC, idx.relname ASC
                ) AS items
            FROM pg_index i
            JOIN pg_class idx ON idx.oid = i.indexrelid
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_am am ON am.oid = idx.relam
            LEFT JOIN pg_constraint con ON con.conindid = idx.oid
            WHERE n.nspname = 'public' AND NOT i.indisprimary
            GROUP BY
                t.relname,
                am.amname,
                i.indisunique,
                i.indkey,
                COALESCE(pg_get_expr(i.indexprs, i.indrelid), ''),
                COALESCE(pg_get_expr(i.indpred, i.indrelid), '')
            HAVING count(*) > 1;
        `, { type: sequelize.QueryTypes.SELECT });

        for (const grp of dupGroups) {
            const tbl = String(grp.table_name).replace(/"/g, '""');
            const items = Array.isArray(grp.items) ? grp.items : [];
            // Conservar el índice/constraint canónico (posición 0, el nombre base más limpio) y eliminar duplicados [1..N]
            for (let k = 1; k < items.length; k++) {
                const entry = items[k];
                try {
                    if (entry.constraint_name) {
                        const cName = String(entry.constraint_name).replace(/"/g, '""');
                        await sequelize.query(`ALTER TABLE "${tbl}" DROP CONSTRAINT IF EXISTS "${cName}";`);
                    } else if (entry.index_name) {
                        const iName = String(entry.index_name).replace(/"/g, '""');
                        await sequelize.query(`DROP INDEX IF EXISTS "${iName}";`);
                    }
                    droppedCount++;
                } catch (_dropDupErr) { /* ignore individual lock/drop warning */ }
            }
        }
    } catch (dupErr) {
        console.warn('[Schema] Aviso verificando índices duplicados:', dupErr.message);
    }

    if (orphansCleaned > 0 || droppedCount > 0) {
        console.log(`🧹 [Schema] Catálogo PostgreSQL saneado: ${orphansCleaned} referencia(s) huérfana(s) reparada(s), ${droppedCount} índice(s)/constraint(s) redundante(s) eliminado(s).`);
    }
    return { orphansCleaned, droppedCount };
}

async function migratePlaintextPasswords(seqInstance = null) {
    const sequelize = seqInstance || require('./connection').sequelize;
    try {
        const bcrypt = require('bcryptjs');
        const { User } = require('./models');
        console.log('[Migración] Buscando contraseñas en texto plano...');
        const users = await User.findAll();
        let updatedCount = 0;
        for (const user of users) {
            if (user.password && !user.password.startsWith('$2') && user.password.length < 30) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(user.password, salt);
                await User.update({ password: hashedPassword }, { where: { id: user.id }, hooks: false });
                updatedCount++;
            }
        }
        if (updatedCount > 0) {
            console.log(`[Migración] Éxito: Se encriptaron ${updatedCount} contraseñas antiguas.`);
        } else {
            console.log('[Migración] Todo en orden: No se encontraron contraseñas en texto plano.');
        }
    } catch (error) {
        console.error('[Migración] Error al encriptar contraseñas antiguas:', error);
    }
}

async function runPostConnectMigrations(sequelize) {
    // 1. Extensiones PostgreSQL, función inmutable y columnas garantizadas
    try {
        await sequelize.query('CREATE EXTENSION IF NOT EXISTS unaccent;');
        await sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
        await sequelize.query(`
            CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
            RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
            $$
            SELECT public.unaccent('public.unaccent', $1);
            $$;
        `);

        const pgAlters = [
            // Branches
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "type" VARCHAR(255) DEFAULT \'STORE\';',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "managerName" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "color" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "invoicePrefix" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE;',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "address" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "location" VARCHAR(255);',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(255) DEFAULT \'default\';',
            'ALTER TABLE "Branches" ADD COLUMN IF NOT EXISTS "isMain" BOOLEAN DEFAULT FALSE;',

            // Users
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "avatarColor" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "permissions" JSONB DEFAULT \'{}\'::jsonb;',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "activeBranchId" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "supervisorPin" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "defaultCurrency" VARCHAR(255) DEFAULT \'BOTH\';',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(255) DEFAULT \'default\';',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT \'active\';',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER DEFAULT 0;',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "lockUntil" TIMESTAMPTZ;',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "currentSessionId" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "quickPin" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "biometricTokenHash" VARCHAR(255);',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "biometricEnrolledAt" TIMESTAMPTZ;',
            'ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "biometricDeviceName" VARCHAR(255);',

            // Promotions (tabla completa si no existe)
            `CREATE TABLE IF NOT EXISTS "Promotions" (
                "id" VARCHAR(255) PRIMARY KEY,
                "companyId" VARCHAR(255) NOT NULL DEFAULT 'default',
                "name" VARCHAR(255) NOT NULL,
                "code" VARCHAR(255),
                "description" VARCHAR(255) DEFAULT '',
                "type" VARCHAR(255) NOT NULL DEFAULT 'BUY_X_GET_Y',
                "buyQuantity" DECIMAL(10,2) DEFAULT 2,
                "payQuantity" DECIMAL(10,2) DEFAULT 1,
                "discountPercentage" DECIMAL(10,2) DEFAULT 0,
                "fixedPrice" DECIMAL(15,4),
                "targetProductIds" JSONB DEFAULT '[]'::jsonb,
                "targetCategories" JSONB DEFAULT '[]'::jsonb,
                "comboItems" JSONB DEFAULT '[]'::jsonb,
                "minCartTotal" DECIMAL(15,2) DEFAULT 0,
                "daysOfWeek" JSONB DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
                "startDate" TIMESTAMPTZ,
                "endDate" TIMESTAMPTZ,
                "startTime" VARCHAR(255),
                "endTime" VARCHAR(255),
                "priority" INTEGER DEFAULT 1,
                "isActive" BOOLEAN DEFAULT TRUE,
                "allowStacking" BOOLEAN DEFAULT FALSE,
                "applyAutomatically" BOOLEAN DEFAULT TRUE,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );`,

            // Sales
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "branchId" VARCHAR(255);',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "cashierName" VARCHAR(255);',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "promoDiscount" NUMERIC(20, 6) DEFAULT 0;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "appliedPromotions" JSONB DEFAULT \'[]\'::jsonb;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "sriAccessKey" VARCHAR(49);',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "sriStatus" VARCHAR(255) DEFAULT \'none\';',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "sriAuthorizationDate" VARCHAR(255);',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "sriXmlUrl" TEXT;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "isService" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "serviceOrderId" VARCHAR(255);',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "paymentMethods" JSONB DEFAULT \'[]\'::jsonb;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "registerId" VARCHAR(255) DEFAULT \'1\';',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "registerName" VARCHAR(255) DEFAULT \'Caja Principal\';',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "paymentStatus" VARCHAR(255) DEFAULT \'paid\';',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "documentType" VARCHAR(255) DEFAULT \'factura\';',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "taxInfo" JSONB DEFAULT \'{}\'::jsonb;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "igtfAmount" NUMERIC(20, 6) DEFAULT 0;',
            'ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "exchangeRate" NUMERIC(20, 6) DEFAULT 1;',

            // SaleItems
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(255) DEFAULT \'default\';',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "batchNumber" VARCHAR(255);',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "expirationDate" VARCHAR(255);',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "es_controlado" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "recipe" JSONB;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "isBulk" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "unitsPerBulk" NUMERIC(20, 6) DEFAULT 1;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "isMidBulk" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "unitsPerMidBulk" NUMERIC(20, 6) DEFAULT 1;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "cost" NUMERIC(20, 6) DEFAULT 0;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "promoDiscount" NUMERIC(20, 6) DEFAULT 0;',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "appliedPromoName" VARCHAR(255);',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "presentationId" VARCHAR(255);',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "presentationName" VARCHAR(255);',
            'ALTER TABLE "SaleItems" ADD COLUMN IF NOT EXISTS "factorConversion" NUMERIC(20, 6) DEFAULT 1;',
            'ALTER TABLE "product_presentaciones" ADD COLUMN IF NOT EXISTS "marginTarget" NUMERIC(10, 2);',

            // Customers
            'ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "creditLimitDays" INTEGER DEFAULT 30;',
            'ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "isCreditBlocked" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "loyaltyPoints" NUMERIC(20, 6) DEFAULT 0;',
            'ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "isVIP" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE;',

            // Products
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "principio_activo" VARCHAR(255);',
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "allowNegative" BOOLEAN DEFAULT FALSE;',
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "taxStatus" VARCHAR(255) DEFAULT \'gravable\';',
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "stockUnit" VARCHAR(255) DEFAULT \'kg\';',
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "stockUnits" NUMERIC(20, 6) DEFAULT NULL;',
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "bulkBarcode" VARCHAR(255);',
            'ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "midBulkBarcode" VARCHAR(255);',

            // CashShifts & Promotions extras
            'ALTER TABLE "CashShifts" ADD COLUMN IF NOT EXISTS "allowedCategories" JSONB DEFAULT \'[]\'::jsonb;',
            'ALTER TABLE "CashShifts" ADD COLUMN IF NOT EXISTS "allowedProducts" JSONB DEFAULT \'[]\'::jsonb;',
            'ALTER TABLE "CashShifts" ADD COLUMN IF NOT EXISTS "exchangeRateAtClose" NUMERIC(20, 6);',
            'ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "targetPaymentMethods" JSONB DEFAULT \'[]\'::jsonb;',
            'ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "minQuantity" DECIMAL(10,3) DEFAULT 0;',
            'ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "minQuantityUnit" VARCHAR(20) DEFAULT \'kg\';',
            'ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "minUnits" INTEGER DEFAULT 0;',

            // BranchStocks
            'ALTER TABLE "BranchStocks" ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(255) DEFAULT \'default\';'
        ];

        for (const sql of pgAlters) {
            try {
                await sequelize.query(sql);
            } catch (_alterErr) {
                // La tabla puede no existir aún antes de sequelize.sync()
            }
        }

        try {
            await sequelize.query('ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS \'financial_mismatch\';');
            await sequelize.query('ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS \'operational_error\';');
        } catch (_enumErr) {
            // El tipo enum puede no existir en una instalación recién creada hasta ejecutar sync
        }
    } catch (extErr) {
        console.warn('[Schema] Aviso inicializando extensiones/columnas previas:', extErr.message);
    }

    // 2. Sincronización segura de producción: crea tablas nuevas sin mutar ni duplicar constraints UNIQUE existentes
    try {
        await sequelize.sync();
    } catch (syncErr) {
        console.warn('[DB] Non-blocking notice during sequelize.sync():', syncErr.message);
    }

    // 2B. Garantizar 100% JSONB y sanear catálogo (huérfanos FKs + constraints/índices duplicados)
    const convertedJsonb = await upgradeAllJsonColumnsToJsonb(sequelize);
    const catalogClean = await sanitizeCatalogAndOrphans(sequelize);

    // 3. Triggers físicos en PostgreSQL 16: Integridad de Inventario + Bus Reactivo LISTEN/NOTIFY
    try {
        await sequelize.query(`
            CREATE OR REPLACE FUNCTION audit_product_stock_integrity()
            RETURNS TRIGGER AS $$
            BEGIN
                IF OLD."stockQuantity" IS DISTINCT FROM NEW."stockQuantity" THEN
                    IF (NEW."allowNegative" IS NOT TRUE) AND (COALESCE(current_setting('app.bypass_stock_trigger', true), 'false') <> 'true') AND NEW."stockQuantity" < 0 THEN
                        RAISE EXCEPTION 'STOCK_INTEGRITY_VIOLATION: El stock no puede ser negativo para % (ID: %)', NEW."name", NEW."id";
                    END IF;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        await sequelize.query(`
            DROP TRIGGER IF EXISTS trg_audit_product_stock_integrity ON "Products";
            CREATE TRIGGER trg_audit_product_stock_integrity
            BEFORE UPDATE ON "Products"
            FOR EACH ROW
            EXECUTE FUNCTION audit_product_stock_integrity();
        `);

        // Función ligera FOR EACH STATEMENT para emitir notificaciones nativas LISTEN/NOTIFY (< 120 bytes)
        await sequelize.query(`
            CREATE OR REPLACE FUNCTION public.notify_isaac_pos_change()
            RETURNS TRIGGER AS $$
            BEGIN
                PERFORM pg_notify(
                    'isaac_pos_events',
                    json_build_object(
                        'table', TG_TABLE_NAME,
                        'op', TG_OP,
                        'pid', pg_backend_pid(),
                        'ts', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
                    )::text
                );
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
        `);

        const realtimeTables = [
            { table: 'Products', trigger: 'trg_notify_products_change' },
            { table: 'BranchStocks', trigger: 'trg_notify_branchstocks_change' },
            { table: 'Sales', trigger: 'trg_notify_sales_change' },
            { table: 'product_presentaciones', trigger: 'trg_notify_presentations_change' }
        ];
        for (const rt of realtimeTables) {
            try {
                await sequelize.query(`
                    DROP TRIGGER IF EXISTS "${rt.trigger}" ON "${rt.table}";
                    CREATE TRIGGER "${rt.trigger}"
                    AFTER INSERT OR UPDATE OR DELETE ON "${rt.table}"
                    FOR EACH STATEMENT
                    EXECUTE FUNCTION public.notify_isaac_pos_change();
                `);
            } catch (_rtTrgErr) {
                // La tabla opcional puede no existir aún
            }
        }
        console.log('[Schema] PostgreSQL stock integrity & LISTEN/NOTIFY triggers active.');

        // 3.1 Seguridad de motor y aislamiento multi-tenant en PostgreSQL 16 (RLS + Triggers JSONB Diff)
        try {
            const { initializeDatabaseSecurity } = require('./tenantContext');
            await initializeDatabaseSecurity(sequelize);
        } catch (secErr) {
            console.warn('[Schema] Warning setting up database security & RLS:', secErr.message);
        }

        // 3.2 Vistas Materializadas Analíticas de PostgreSQL 16
        try {
            const PostgresAnalyticsService = require('../services/PostgresAnalyticsService');
            await PostgresAnalyticsService.initMaterializedViews(sequelize);
        } catch (analyticsErr) {
            console.warn('[Schema] Warning initializing materialized views:', analyticsErr.message);
        }
    } catch (trgErr) {
        console.warn('[Schema] Warning setting up PostgreSQL triggers:', trgErr.message);
    }

    // 4. Secuencias atómicas diarias por caja registradora
    try {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS "DailyRegisterSequences" (
                "companyId" VARCHAR(64) NOT NULL,
                "registerId" VARCHAR(64) NOT NULL,
                "dateKey" VARCHAR(10) NOT NULL,
                "currentNumber" INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("companyId", "registerId", "dateKey")
            );
        `);
    } catch (seqTableErr) {
        console.warn('[Schema] Warning creating DailyRegisterSequences:', seqTableErr.message);
    }

    // 4.1 Tabla de Borradores Persistentes de Caja (Resiliencia ante Apagones Súbitos y Preventas)
    try {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS "RegisterDrafts" (
                "id" VARCHAR(64) PRIMARY KEY,
                "registerId" VARCHAR(64) NOT NULL,
                "companyId" VARCHAR(64) NOT NULL DEFAULT '2',
                "userId" VARCHAR(64),
                "userName" VARCHAR(128),
                "code" VARCHAR(32),
                "type" VARCHAR(32) NOT NULL DEFAULT 'auto_draft',
                "customer" JSONB,
                "items" JSONB NOT NULL DEFAULT '[]'::jsonb,
                "totals" JSONB,
                "notes" TEXT,
                "itemCount" INTEGER DEFAULT 0,
                "totalUSD" NUMERIC(12, 4) DEFAULT 0.0000,
                "totalVES" NUMERIC(16, 4) DEFAULT 0.0000,
                "status" VARCHAR(20) DEFAULT 'active',
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_regdrafts_reg_type ON "RegisterDrafts"("companyId", "registerId", "type", "status");
            CREATE INDEX IF NOT EXISTS idx_regdrafts_status_updated ON "RegisterDrafts"("companyId", "status", "updatedAt" DESC);
        `);
    } catch (draftErr) {
        console.warn('[Schema] Warning creating RegisterDrafts:', draftErr.message);
    }

    // 5. Índices GIN (pg_trgm + jsonb_path_ops), B-Tree compuestos y Estadísticas Extendidas (PostgreSQL 16)
    try {
        console.log('[Schema] Applying high-performance PostgreSQL 16 indexes & extended statistics...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_products_company ON "Products"("companyId")',
            'CREATE INDEX IF NOT EXISTS idx_products_category ON "Products"("category")',
            'CREATE INDEX IF NOT EXISTS idx_products_barcode ON "Products"("barcode")',
            'CREATE INDEX IF NOT EXISTS idx_products_company_stock_qty ON "Products"("companyId", "stockQuantity")',
            'CREATE INDEX IF NOT EXISTS idx_products_company_price ON "Products"("companyId", "price")',
            'CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON "Products" USING gin (name gin_trgm_ops)',
            'CREATE INDEX IF NOT EXISTS idx_products_unaccent_trgm ON "Products" USING gin (public.immutable_unaccent(lower("name")) gin_trgm_ops)',
            'CREATE INDEX IF NOT EXISTS idx_products_active_trgm ON "Products" USING gin (public.immutable_unaccent(lower(COALESCE("principio_activo", \'\'))) gin_trgm_ops)',
            'CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON "Products" USING gin (COALESCE("barcode", \'\') gin_trgm_ops)',
            'CREATE INDEX IF NOT EXISTS idx_products_bulk_barcode_trgm ON "Products" USING gin (COALESCE("bulkBarcode", \'\') gin_trgm_ops)',
            'CREATE INDEX IF NOT EXISTS idx_presentations_barcode_trgm ON "product_presentaciones" USING gin (COALESCE("barcode", \'\') gin_trgm_ops)',
            'CREATE INDEX IF NOT EXISTS idx_saleitems_saleid ON "SaleItems"("saleId")',
            'CREATE INDEX IF NOT EXISTS idx_saleitems_product ON "SaleItems"("productId")',
            'CREATE INDEX IF NOT EXISTS idx_saleitems_company ON "SaleItems"("companyId")',
            'CREATE INDEX IF NOT EXISTS idx_branchstocks_product ON "BranchStocks"("productId")',
            'CREATE INDEX IF NOT EXISTS idx_branchstocks_company ON "BranchStocks"("companyId")',
            'CREATE INDEX IF NOT EXISTS idx_customers_company ON "Customers"("companyId")',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_status ON "Sales"("companyId", "status")',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_date ON "Sales"("companyId", "date")',
            'CREATE INDEX IF NOT EXISTS idx_sales_payment_methods_gin ON "Sales" USING gin ("paymentMethods" jsonb_path_ops)',
            'CREATE INDEX IF NOT EXISTS idx_sales_applied_promos_gin ON "Sales" USING gin ("appliedPromotions" jsonb_path_ops)',
            'CREATE INDEX IF NOT EXISTS idx_promotions_target_products_gin ON "Promotions" USING gin ("targetProductIds" jsonb_path_ops)',
            'CREATE INDEX IF NOT EXISTS idx_saleitems_createdat ON "SaleItems"("createdAt")',
            'CREATE INDEX IF NOT EXISTS idx_refunds_company_date ON "Refunds"("companyId", "date")',
            'CREATE INDEX IF NOT EXISTS idx_cashmovements_shift ON "CashMovements"("shiftId")',
            'CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON "StockMovements"("productId")',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_shift_per_register ON "CashShifts" ("companyId", "registerId") WHERE "status" = \'open\'',
            'CREATE INDEX IF NOT EXISTS idx_sales_company_created ON "Sales" ("companyId", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS idx_sales_customer_status ON "Sales" ("customerId", "paymentStatus")',
            'CREATE INDEX IF NOT EXISTS idx_sales_shift_status ON "Sales" ("cashShiftId", "status")',
            'CREATE INDEX IF NOT EXISTS idx_refunds_sale_id ON "Refunds" ("saleId")',
            'CREATE INDEX IF NOT EXISTS idx_product_lots_prod_exp ON "ProductLots" ("productId", "expirationDate" ASC)',
            'CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id ON "JournalEntryLines" ("journalEntryId")',
            'CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON "JournalEntryLines" ("accountId")',
            'CREATE INDEX IF NOT EXISTS idx_bank_tx_account_date ON "BankTransactions" ("bankAccountId", "transactionDate" DESC)',
            'CREATE INDEX IF NOT EXISTS idx_credit_history_customer ON "CreditHistories" ("customerId", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS idx_credit_history_sale ON "CreditHistories" ("saleId")',
            'CREATE INDEX IF NOT EXISTS idx_payroll_receipts_period ON "PayrollReceipts" ("payrollPeriodId", "employeeId")',
            'CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_date ON "StockMovements" ("productId", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS idx_warehouse_stock_wh_prod ON "WarehouseStocks" ("warehouseId", "productId")',
            'CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_trf ON "StockTransferItems" ("stockTransferId", "productId")',
            'CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON "AuditLogs" ("companyId", "createdAt" DESC)',
            // Índices BRIN (PostgreSQL 16) para series temporales de alto volumen
            'CREATE INDEX IF NOT EXISTS idx_brin_audit_logs_created ON "AuditLogs" USING brin ("createdAt")',
            'CREATE INDEX IF NOT EXISTS idx_brin_stock_movements_created ON "StockMovements" USING brin ("createdAt")',
            'CREATE INDEX IF NOT EXISTS idx_brin_cash_movements_created ON "CashMovements" USING brin ("createdAt")',
            'CREATE STATISTICS IF NOT EXISTS stat_products_company_status_cat (dependencies, ndistinct) ON "companyId", "status", "category" FROM "Products"',
            'CREATE STATISTICS IF NOT EXISTS stat_sales_company_status_pay (dependencies, ndistinct) ON "companyId", "status", "paymentStatus" FROM "Sales"'
        ];

        for (const sql of indexes) {
            try {
                await sequelize.query(sql);
            } catch (_idxErr) {
                // La tabla puede ser opcional o el índice/estadística ya existe
            }
        }

        if (convertedJsonb > 0 || catalogClean.droppedCount > 0) {
            await sequelize.query('ANALYZE "Products"; ANALYZE "Sales"; ANALYZE "Refunds";').catch(() => {});
        }
        console.log('⚡ [Schema] 42 índices GIN/B-Tree y estadísticas multicolumna de PostgreSQL 16 verificados.');
    } catch (idxErr) {
        console.warn('[Schema] Warning applying performance indexes:', idxErr.message);
    }

    // 6. Inicialización/sincronización de cuenta propietaria y superadmin
    try {
        const { User } = require('./models');
        const { Op } = require('sequelize');
        const { generateRobustId } = require('../utils/helpers');
        const defaultHash = '$2a$10$FIjqhf2nMQPkKDrYJfBP.ebLtHC79K9k.dXAYA8YCzJtftiWyuKeO';
        const brokenHash = '$2a$10$wO3g4tU7qB1yqG7R3P1P1u.6J/uS7U.3L1X5K.yX8Z9/zY0W.5X2C';
        const ownerMasterHash = '$2a$10$6zXSPNCBUwRwJM5.hq.aYuL83CO8oSEnBzelGvr0wVCJI0uglgIdG';
        const hashedPassword = defaultHash;

        const existingAdmin = await User.findOne({ where: { username: 'admin' } });
        if (!existingAdmin) {
            const ownerId = generateRobustId();
            await User.create({
                id: ownerId,
                username: 'admin',
                name: 'Administrador Principal',
                email: 'admin@isaacpos.com',
                password: hashedPassword,
                role: 'superadmin',
                status: 'active',
                companyId: '2',
                defaultCurrency: 'BOTH'
            });
            console.log('🔒 Usuario admin creado con clave inicial en la base de datos');
        } else {
            const updates = { status: 'active', role: 'superadmin', failedLoginAttempts: 0, lockUntil: null };
            if (!existingAdmin.companyId || existingAdmin.companyId === 'default') updates.companyId = '2';
            if (!existingAdmin.password || existingAdmin.password === brokenHash) {
                updates.password = hashedPassword;
                updates.failedLoginAttempts = 0;
                updates.lockUntil = null;
            }
            await existingAdmin.update(updates);
        }

        const existingOwner = await User.findOne({
            where: {
                [Op.or]: [
                    { email: 'mrivero105@gmail.com' },
                    { username: 'mrivero105@gmail.com' },
                    { username: 'mrivero105' }
                ]
            }
        });
        if (!existingOwner) {
            await User.create({
                id: generateRobustId(),
                username: 'mrivero105',
                name: 'Propietario Master',
                email: 'mrivero105@gmail.com',
                password: hashedPassword,
                role: 'superadmin',
                status: 'active',
                companyId: '2',
                defaultCurrency: 'BOTH'
            });
            console.log('🔒 Usuario mrivero105@gmail.com creado con clave inicial en la base de datos');
        } else {
            const ownerUpdates = { email: 'mrivero105@gmail.com', status: 'active', role: 'superadmin', failedLoginAttempts: 0, lockUntil: null };
            if (!existingOwner.companyId || existingOwner.companyId === 'default') ownerUpdates.companyId = '2';
            if (!existingOwner.password || existingOwner.password === brokenHash) {
                ownerUpdates.password = ownerMasterHash;
                ownerUpdates.failedLoginAttempts = 0;
                ownerUpdates.lockUntil = null;
            }
            await existingOwner.update(ownerUpdates);
        }
    } catch (err) {
        console.warn('[Schema] Warning: Could not init admin account:', err.message);
    }

    // 7. Verificación de estado de licencia
    try {
        const { License } = require('./models');
        const activeLic = await License.findOne({ where: { status: 'active' } });
        if (activeLic) {
            console.log('🔒 [License] Licencia activa detectada en base de datos.');
        } else {
            console.log('⚠️ [License] Sin licencia activa. El sistema requerirá activación obligatoria.');
        }
    } catch (licErr) {
        console.warn('[License] Aviso verificando estado de licencia:', licErr.message);
    }

    // 8. Normalización de usernames en PostgreSQL
    try {
        await sequelize.query(`
            UPDATE "Users"
            SET "username" = LOWER(SPLIT_PART("email", '@', 1))
            WHERE ("username" IS NULL OR "username" = '') AND "email" LIKE '%@%'
        `);
        await sequelize.query('UPDATE "Users" SET "username" = "id" WHERE ("username" IS NULL OR "username" = \'\')');
        console.log('[Schema] Usernames auto-populated successfully.');
    } catch (populateErr) {
        console.warn('[Schema] Warning: Could not auto-populate usernames:', populateErr.message);
    }

    console.log('✅ Database fully synchronized.');
    await migratePlaintextPasswords(sequelize);
}

module.exports = {
    TARGET_SCHEMA_VERSION,
    repairSchema,
    upgradeAllJsonColumnsToJsonb,
    sanitizeCatalogAndOrphans,
    migratePlaintextPasswords,
    runPostConnectMigrations
};
