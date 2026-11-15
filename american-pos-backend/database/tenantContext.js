/**
 * tenantContext.js
 * Módulo de seguridad y aislamiento multi-empresa (Row-Level Security - RLS)
 * y contexto de auditoría nativo para PostgreSQL 16.
 */

/**
 * Configura las variables de sesión locales de PostgreSQL 16 en una transacción específica.
 * Asume el rol de menor privilegio `isaac_app` (NOBYPASSRLS) y aplica la regla de hierro de tenant.
 *
 * @param {object} sequelizeInstance Instancia de Sequelize
 * @param {object} transaction Transacción activa de Sequelize
 * @param {object} context Objeto con companyId, userId, isSuperAdmin
 */
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

/**
 * Ejecuta una función/middleware dentro del contexto aislado de tenant/usuario.
 * Propaga el companyId, userId e isSuperAdmin a través de AsyncLocalStorage
 * hacia el pool de conexiones PostgreSQL para activar RLS real.
 */
function runWithTenantContext(context, fn) {
    if (!context || typeof fn !== 'function') {
        return typeof fn === 'function' ? fn() : undefined;
    }
    const normalized = {
        companyId: context.companyId != null ? String(context.companyId) : '',
        userId: context.userId != null ? String(context.userId) : '',
        isSuperAdmin: Boolean(context.isSuperAdmin)
    };
    return tenantStorage.run(normalized, fn);
}

function getCurrentTenantContext() {
    return tenantStorage.getStore() || null;
}

async function setTenantContext(sequelizeInstance, transaction, { companyId, userId, isSuperAdmin = false } = {}) {
    if (!transaction) {
        throw new Error('[TenantContext] Se requiere una transacción activa para aplicar SET LOCAL en PostgreSQL.');
    }

    try {
        // Asumir rol no-superusuario para forzar evaluación estricta de políticas RLS
        await sequelizeInstance.query('SET LOCAL ROLE isaac_app;', { transaction });

        if (companyId) {
            await sequelizeInstance.query('SET LOCAL app.current_company_id = :companyId;', {
                replacements: { companyId: String(companyId) },
                transaction
            });
        }

        if (userId) {
            await sequelizeInstance.query('SET LOCAL app.current_user_id = :userId;', {
                replacements: { userId: String(userId) },
                transaction
            });
        }

        if (isSuperAdmin) {
            await sequelizeInstance.query("SET LOCAL app.is_superadmin = 'true';", { transaction });
        }
    } catch (err) {
        console.warn('[TenantContext] Aviso configurando contexto de sesión en PostgreSQL:', err.message);
        throw err;
    }
}

/**
 * Ejecuta una operación atómica dentro de una transacción con aislamiento estricto de empresa
 */
async function withTenantTransaction(sequelizeInstance, context, callback) {
    return await sequelizeInstance.transaction(async (t) => {
        await setTenantContext(sequelizeInstance, t, context);
        return await callback(t);
    });
}

/**
 * Asegura e inicializa de forma idempotente las políticas RLS y triggers de auditoría en PostgreSQL 16
 */
async function initializeDatabaseSecurity(sequelizeInstance) {
    try {
        // 1. Rol de aplicación no-superusuario para RLS estricto
        await sequelizeInstance.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'isaac_app') THEN
                    CREATE ROLE isaac_app WITH LOGIN NOSUPERUSER NOBYPASSRLS INHERIT;
                END IF;
                GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO isaac_app;
                GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO isaac_app;
                GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO isaac_app;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO isaac_app;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO isaac_app;
                GRANT isaac_app TO postgres;
            END
            $$;
        `);

        // 2. Función PL/pgSQL de Auditoría Automática con JSONB Diff
        await sequelizeInstance.query(`
            CREATE OR REPLACE FUNCTION public.audit_row_change_trigger()
            RETURNS TRIGGER AS $$
            DECLARE
                v_old_json JSONB;
                v_new_json JSONB;
                v_old_diff JSONB;
                v_new_diff JSONB;
                v_action VARCHAR(64);
                v_entity_id VARCHAR(255);
                v_company_id VARCHAR(255);
                v_user_id VARCHAR(255) := NULL;
                v_raw_user TEXT;
                v_desc TEXT;
            BEGIN
                -- Permitir bypass seguro para tareas de importación masiva o mantenimiento
                IF COALESCE(current_setting('app.bypass_audit_trigger', true), 'false') = 'true' THEN
                    RETURN COALESCE(NEW, OLD);
                END IF;

                -- Resolver usuario auditado garantizando integridad referencial con tabla Users
                v_raw_user := NULLIF(current_setting('app.current_user_id', true), '');
                IF v_raw_user IS NOT NULL THEN
                    IF EXISTS (SELECT 1 FROM "Users" WHERE id = v_raw_user) THEN
                        v_user_id := v_raw_user;
                    END IF;
                END IF;

                IF TG_OP = 'INSERT' THEN
                    v_new_json := to_jsonb(NEW);
                    v_action := TG_TABLE_NAME || '_CREATED';
                    v_entity_id := COALESCE(v_new_json->>'id', 'N/A');
                    v_company_id := COALESCE(v_new_json->>'companyId', 'default');
                    v_desc := 'Creación en ' || TG_TABLE_NAME || ' (ID: ' || v_entity_id || ')';

                    INSERT INTO "AuditLogs" (
                        "id", "userId", "companyId", "action", "description", 
                        "entityId", "oldValue", "newValue", "timestamp", "createdAt", "updatedAt"
                    ) VALUES (
                        gen_random_uuid()::text,
                        v_user_id,
                        v_company_id,
                        v_action,
                        v_desc,
                        v_entity_id,
                        NULL,
                        v_new_json::text,
                        to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                        clock_timestamp(),
                        clock_timestamp()
                    );
                    RETURN NEW;

                ELSIF TG_OP = 'UPDATE' THEN
                    v_old_json := to_jsonb(OLD);
                    v_new_json := to_jsonb(NEW);

                    -- Extraer exclusivamente los campos que tuvieron mutación real
                    SELECT jsonb_object_agg(key, value) INTO v_old_diff
                    FROM jsonb_each(v_old_json)
                    WHERE key NOT IN ('updatedAt', 'lastModified')
                      AND (v_new_json->key) IS DISTINCT FROM value;

                    SELECT jsonb_object_agg(key, value) INTO v_new_diff
                    FROM jsonb_each(v_new_json)
                    WHERE key NOT IN ('updatedAt', 'lastModified')
                      AND (v_old_json->key) IS DISTINCT FROM value;

                    -- Si solo cambiaron timestamps internos, no generar ruido en auditoría
                    IF v_new_diff IS NULL OR v_new_diff = '{}'::jsonb THEN
                        RETURN NEW;
                    END IF;

                    v_action := TG_TABLE_NAME || '_UPDATED';
                    v_entity_id := COALESCE(v_new_json->>'id', v_old_json->>'id', 'N/A');
                    v_company_id := COALESCE(v_new_json->>'companyId', v_old_json->>'companyId', 'default');
                    v_desc := 'Modificación en ' || TG_TABLE_NAME || ' (ID: ' || v_entity_id || ')';

                    INSERT INTO "AuditLogs" (
                        "id", "userId", "companyId", "action", "description", 
                        "entityId", "oldValue", "newValue", "timestamp", "createdAt", "updatedAt"
                    ) VALUES (
                        gen_random_uuid()::text,
                        v_user_id,
                        v_company_id,
                        v_action,
                        v_desc,
                        v_entity_id,
                        v_old_diff::text,
                        v_new_diff::text,
                        to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                        clock_timestamp(),
                        clock_timestamp()
                    );
                    RETURN NEW;

                ELSIF TG_OP = 'DELETE' THEN
                    v_old_json := to_jsonb(OLD);
                    v_action := TG_TABLE_NAME || '_DELETED';
                    v_entity_id := COALESCE(v_old_json->>'id', 'N/A');
                    v_company_id := COALESCE(v_old_json->>'companyId', 'default');
                    v_desc := 'Eliminación en ' || TG_TABLE_NAME || ' (ID: ' || v_entity_id || ')';

                    INSERT INTO "AuditLogs" (
                        "id", "userId", "companyId", "action", "description", 
                        "entityId", "oldValue", "newValue", "timestamp", "createdAt", "updatedAt"
                    ) VALUES (
                        gen_random_uuid()::text,
                        v_user_id,
                        v_company_id,
                        v_action,
                        v_desc,
                        v_entity_id,
                        v_old_json::text,
                        NULL,
                        to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                        clock_timestamp(),
                        clock_timestamp()
                    );
                    RETURN OLD;
                END IF;

                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
        `);

        // 3. Triggers en tablas de negocio críticas
        const auditTables = ['Products', 'Sales', 'Customers', 'FixedAssets'];
        for (const tbl of auditTables) {
            try {
                const trgName = `trg_audit_${tbl.toLowerCase()}_diff`;
                await sequelizeInstance.query(`
                    DROP TRIGGER IF EXISTS "${trgName}" ON "${tbl}";
                    CREATE TRIGGER "${trgName}"
                    AFTER INSERT OR UPDATE OR DELETE ON "${tbl}"
                    FOR EACH ROW
                    EXECUTE FUNCTION public.audit_row_change_trigger();
                `);
            } catch (trgErr) {
                // La tabla puede ser opcional
            }
        }

        try {
            await sequelizeInstance.query('GRANT USAGE ON SCHEMA public TO isaac_app;');
            await sequelizeInstance.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO isaac_app;');
            await sequelizeInstance.query('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO isaac_app;');
            await sequelizeInstance.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO isaac_app;');
            await sequelizeInstance.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO isaac_app;');
        } catch (grantErr) {
            console.warn('[Security] Aviso asignando permisos base a isaac_app:', grantErr.message);
        }

        // 4. Políticas de Row-Level Security (RLS) reales y fail-closed por tenant
        const excludedGlobalTables = new Set([
            'Companies',
            'Licenses',
            'AuditLogs',
            'SequelizeMeta',
            'Roles'
        ]);
        const [tenantColRows] = await sequelizeInstance.query(`
            SELECT table_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_name = 'companyId'
            ORDER BY table_name
        `);
        const typeByTable = new Map();
        const baseRlsTables = ['Products', 'Sales', 'Customers', 'Branches', 'CashShifts', 'Users'];
        const discoveredTables = [];
        for (const r of (tenantColRows || [])) {
            if (!r || !r.table_name || excludedGlobalTables.has(r.table_name)) continue;
            discoveredTables.push(r.table_name);
            typeByTable.set(r.table_name, r.udt_name || r.data_type || 'text');
        }
        const rlsTables = Array.from(new Set([...baseRlsTables, ...discoveredTables]));
        for (const tbl of rlsTables) {
            try {
                const colType = String(typeByTable.get(tbl) || 'text').toLowerCase();
                let settingExpr = "NULLIF(current_setting('app.current_company_id', true), '')";
                if (colType === 'uuid') {
                    settingExpr = "NULLIF(current_setting('app.current_company_id', true), '')::uuid";
                } else if (colType === 'int4' || colType === 'integer') {
                    settingExpr = "NULLIF(current_setting('app.current_company_id', true), '')::integer";
                } else if (colType === 'int8' || colType === 'bigint') {
                    settingExpr = "NULLIF(current_setting('app.current_company_id', true), '')::bigint";
                }

                await sequelizeInstance.query(`ALTER TABLE "${tbl}" ENABLE ROW LEVEL SECURITY;`);
                await sequelizeInstance.query(`ALTER TABLE "${tbl}" FORCE ROW LEVEL SECURITY;`);

                const polName = `rls_tenant_isolation_${tbl.toLowerCase()}`;
                await sequelizeInstance.query(`DROP POLICY IF EXISTS "${polName}" ON "${tbl}";`);
                await sequelizeInstance.query(`
                    CREATE POLICY "${polName}" ON "${tbl}"
                    FOR ALL
                    USING (
                        "companyId" = ${settingExpr}
                        OR current_setting('app.is_superadmin', true) = 'true'
                    )
                    WITH CHECK (
                        "companyId" = ${settingExpr}
                        OR current_setting('app.is_superadmin', true) = 'true'
                    );
                `);
            } catch (rlsErr) {
                if (!/does not exist/i.test(String(rlsErr.message || ''))) {
                    console.warn(`[Security] Error aplicando política RLS en "${tbl}":`, rlsErr.message);
                }
            }
        }

        console.log('🛡️ [Security] Triggers de auditoría con JSONB Diff y políticas RLS activas en PostgreSQL 16.');
        return { success: true };
    } catch (err) {
        console.warn('[Security] Aviso inicializando seguridad de base de datos:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    tenantStorage,
    runWithTenantContext,
    getCurrentTenantContext,
    setTenantContext,
    withTenantTransaction,
    initializeDatabaseSecurity
};
