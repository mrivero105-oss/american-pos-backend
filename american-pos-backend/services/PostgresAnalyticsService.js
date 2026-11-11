/**
 * PostgresAnalyticsService.js
 * Servicio de Inteligencia de Negocios y Analítica Acelerada en PostgreSQL 16.
 * Aprovecha Vistas Materializadas con refresco concurrente y funciones nativas
 * SQL/JSON para cortes de caja y dashboards en tiempo récord (< 3ms).
 */

const { sequelize } = require('../database/connection');

class PostgresAnalyticsService {
    /**
     * Inicializa las vistas materializadas e índices únicos necesarios para REFRESH CONCURRENTLY
     */
    static async initMaterializedViews(sequelizeInstance = sequelize) {
        try {
            // 1. Resumen Diario de Ventas Multimoneda, Descuentos e IGTF
            await sequelizeInstance.query(`
                CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_sales_summary AS
                SELECT 
                    "companyId",
                    ("createdAt"::date) AS sale_date,
                    COUNT(id)::int AS total_orders,
                    ROUND(COALESCE(SUM(total), 0)::numeric, 4) AS gross_sales_usd,
                    ROUND(COALESCE(SUM(subtotal), 0)::numeric, 4) AS total_subtotal_usd,
                    ROUND(COALESCE(SUM(tax), 0)::numeric, 4) AS total_tax_usd,
                    ROUND(COALESCE(SUM("promoDiscount"), 0)::numeric, 4) AS total_discount_usd,
                    ROUND(COALESCE(SUM("igtfAmount"), 0)::numeric, 4) AS total_igtf_usd,
                    COUNT(CASE WHEN "paymentStatus" = 'paid' THEN 1 END)::int AS paid_orders,
                    COUNT(CASE WHEN "paymentStatus" = 'credit' THEN 1 END)::int AS credit_orders
                FROM "Sales"
                WHERE status NOT IN ('cancelled')
                GROUP BY "companyId", ("createdAt"::date);

                CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_sales_summary_uidx 
                ON mv_daily_sales_summary ("companyId", sale_date);
            `);

            // 2. Analítica de Rotación y Rendimiento de Productos
            await sequelizeInstance.query(`
                CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_sales_stats AS
                SELECT 
                    si."companyId",
                    si."productId",
                    COUNT(DISTINCT si."saleId")::int AS transaction_count,
                    ROUND(COALESCE(SUM(si.quantity), 0)::numeric, 4) AS units_sold,
                    ROUND(COALESCE(SUM(si.quantity * si.price), 0)::numeric, 4) AS revenue_usd,
                    MAX(si."createdAt") AS last_sold_at
                FROM "SaleItems" si
                JOIN "Sales" s ON s.id = si."saleId"
                WHERE s.status NOT IN ('cancelled')
                GROUP BY si."companyId", si."productId";

                CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_product_sales_stats_uidx 
                ON mv_product_sales_stats ("companyId", "productId");
            `);

            console.log('⚡ [PostgresAnalytics] Vistas materializadas e índices de concurrencia PG 16 verificados.');
            return { success: true };
        } catch (err) {
            console.warn('[PostgresAnalytics] Aviso inicializando vistas materializadas:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Refresca concurrentemente las vistas materializadas sin bloquear operaciones de lectura o escritura en vivo
     */
    static async refreshViews(sequelizeInstance = sequelize) {
        try {
            await sequelizeInstance.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales_summary;');
            await sequelizeInstance.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_sales_stats;');
            return { success: true, refreshedAt: new Date().toISOString() };
        } catch (err) {
            console.warn('[PostgresAnalytics] Aviso refrescando vistas materializadas:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene el desglose financiero nativo por métodos de pago y monedas usando SQL/JSON (PostgreSQL 16)
     */
    static async getShiftPaymentBreakdownNative({
        companyId = '2',
        openedAt = null,
        closedAt = null,
        registerId = null,
        userId = null
    } = {}, sequelizeInstance = sequelize) {
        const conditions = [
            `s."companyId" = :companyId`,
            `s.status NOT IN ('cancelled')`
        ];
        const replacements = { companyId: String(companyId) };

        if (openedAt) {
            conditions.push(`s."createdAt" >= :openedAt`);
            replacements.openedAt = openedAt;
        }

        if (closedAt) {
            conditions.push(`s."createdAt" <= :closedAt`);
            replacements.closedAt = closedAt;
        }

        if (registerId) {
            conditions.push(`s."registerId" = :registerId`);
            replacements.registerId = String(registerId);
        }

        if (userId) {
            conditions.push(`s."userId" = :userId`);
            replacements.userId = String(userId);
        }

        const sql = `
            SELECT 
                COALESCE(pm.method, 'cash') AS method,
                UPPER(COALESCE(pm.currency, 'USD')) AS currency,
                COUNT(DISTINCT s.id)::int AS count_transactions,
                ROUND(SUM(COALESCE(pm.amount, 0))::numeric, 4) AS total_native,
                ROUND(SUM(
                    CASE 
                        WHEN UPPER(COALESCE(pm.currency, 'USD')) IN ('VES', 'BS') AND COALESCE(s."exchangeRate", 1) > 0
                            THEN COALESCE(pm.amount, 0) / s."exchangeRate"
                        ELSE COALESCE(pm.amount, 0)
                    END
                )::numeric, 4) AS total_usd
            FROM "Sales" s
            CROSS JOIN LATERAL jsonb_to_recordset(
                CASE 
                    WHEN jsonb_typeof(s."paymentMethods") = 'array' AND jsonb_array_length(s."paymentMethods") > 0 
                        THEN s."paymentMethods"
                    ELSE jsonb_build_array(jsonb_build_object('method', COALESCE(s."paymentMethod", 'cash'), 'amount', s.total, 'currency', 'USD'))
                END
            ) AS pm(method text, amount numeric, currency text)
            WHERE ${conditions.join(' AND ')}
            GROUP BY pm.method, UPPER(COALESCE(pm.currency, 'USD'))
            ORDER BY total_usd DESC;
        `;

        const [rows] = await sequelizeInstance.query(sql, { replacements });
        return rows || [];
    }

    /**
     * Consulta histórica ultrarrápida desde la vista materializada de ventas diarias
     */
    static async getDailySalesSummary(companyId = '2', { startDate = null, endDate = null, limit = 30 } = {}, sequelizeInstance = sequelize) {
        const conditions = [`"companyId" = :companyId`];
        const replacements = { companyId: String(companyId), limit: parseInt(limit, 10) || 30 };

        if (startDate) {
            conditions.push(`sale_date >= :startDate::date`);
            replacements.startDate = startDate;
        }

        if (endDate) {
            conditions.push(`sale_date <= :endDate::date`);
            replacements.endDate = endDate;
        }

        const sql = `
            SELECT 
                sale_date,
                total_orders,
                gross_sales_usd,
                total_subtotal_usd,
                total_tax_usd,
                total_discount_usd,
                total_igtf_usd,
                paid_orders,
                credit_orders
            FROM mv_daily_sales_summary
            WHERE ${conditions.join(' AND ')}
            ORDER BY sale_date DESC
            LIMIT :limit;
        `;

        const [rows] = await sequelizeInstance.query(sql, { replacements });
        return rows || [];
    }

    /**
     * Consulta de productos más vendidos / rotación desde la vista materializada
     */
    static async getTopProducts(companyId = '2', { limit = 20 } = {}, sequelizeInstance = sequelize) {
        const sql = `
            SELECT 
                mv."productId",
                p.name AS product_name,
                p.barcode,
                p.category,
                mv.transaction_count,
                mv.units_sold,
                mv.revenue_usd,
                mv.last_sold_at
            FROM mv_product_sales_stats mv
            LEFT JOIN "Products" p ON p.id = mv."productId"
            WHERE mv."companyId" = :companyId
            ORDER BY mv.revenue_usd DESC
            LIMIT :limit;
        `;

        const [rows] = await sequelizeInstance.query(sql, {
            replacements: { companyId: String(companyId), limit: parseInt(limit, 10) || 20 }
        });
        return rows || [];
    }
}

module.exports = PostgresAnalyticsService;
