const { sequelize } = require('../database/connection');
const precision = require('../utils/precision');
const cacheService = require('../utils/cacheService');

/**
 * DailyRollupService
 * Mantiene la tabla de resúmenes diarios incrementales `daily_sales_rollups` en PostgreSQL 16
 * para acelerar reportes trimestrales/anuales de ReportService a < 5 ms con paridad matemática exacta.
 */
class DailyRollupService {
    constructor() {
        this._tableEnsured = false;
        this._ensurePromise = null;
        this._pendingTimers = new Map(); // key: `${companyId}|${dayKey}` -> Timeout
        this._dirtyDays = new Set();     // key: `${companyId}|${dayKey}` marcado sucio hasta reconstruirse
        this._backfillRunning = new Set();
    }

    _isPostgres() {
        return typeof sequelize.getDialect === 'function' && sequelize.getDialect() === 'postgres';
    }

    _toDayKey(dateLike) {
        if (!dateLike) return new Date().toISOString().slice(0, 10);
        const s = String(dateLike);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(dateLike);
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
        return d.toISOString().slice(0, 10);
    }

    /**
     * Crea la tabla `daily_sales_rollups` de forma idempotente (con permisos para rol `isaac_app`).
     */
    async ensureTable() {
        if (!this._isPostgres()) return false;
        if (this._tableEnsured) return true;
        if (this._ensurePromise) return this._ensurePromise;

        this._ensurePromise = (async () => {
            try {
                await sequelize.query(`
                    CREATE TABLE IF NOT EXISTS public.daily_sales_rollups (
                        "companyId" VARCHAR(255) NOT NULL,
                        "dayKey" VARCHAR(10) NOT NULL,
                        "salesCount" INTEGER NOT NULL DEFAULT 0,
                        "grossSalesUsd" NUMERIC(20, 4) NOT NULL DEFAULT 0,
                        "discountsUsd" NUMERIC(20, 4) NOT NULL DEFAULT 0,
                        "itemsRevenueUsd" NUMERIC(20, 4) NOT NULL DEFAULT 0,
                        "itemsCostUsd" NUMERIC(20, 4) NOT NULL DEFAULT 0,
                        "expensesUsd" NUMERIC(20, 4) NOT NULL DEFAULT 0,
                        "refundsUsd" NUMERIC(20, 4) NOT NULL DEFAULT 0,
                        "hourlyJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
                        "paymentsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
                        "categoriesJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
                        "productsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
                        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY ("companyId", "dayKey")
                    );
                `);
                await sequelize.query(`
                    CREATE INDEX IF NOT EXISTS idx_daily_sales_rollups_company_day
                    ON public.daily_sales_rollups ("companyId", "dayKey" DESC);
                `);
                await sequelize.query(`
                    DO $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'isaac_app') THEN
                            GRANT ALL PRIVILEGES ON TABLE public.daily_sales_rollups TO isaac_app;
                        END IF;
                    END
                    $$;
                `).catch(() => {});
                this._tableEnsured = true;
                return true;
            } catch (err) {
                // Si el rol actual no puede hacer DDL, verificar si la tabla ya existe y es accesible
                try {
                    await sequelize.query(`SELECT 1 FROM public.daily_sales_rollups LIMIT 1;`, {
                        type: sequelize.QueryTypes.SELECT
                    });
                    this._tableEnsured = true;
                    return true;
                } catch (_e) {
                    console.warn('[DailyRollupService] Tabla daily_sales_rollups no disponible:', err.message);
                    return false;
                }
            } finally {
                this._ensurePromise = null;
            }
        })();

        return this._ensurePromise;
    }

    /**
     * Recalcula atómicamente el rollup exacto para un (companyId, dayKey = 'YYYY-MM-DD').
     * Idempotente al 100%: soporta ventas, anulaciones, devoluciones y edición de gastos.
     */
    async rebuildDay(companyId, dayKey) {
        if (!this._isPostgres()) return null;
        const ready = await this.ensureTable();
        if (!ready) return null;

        const compId = String(companyId || '2');
        const safeDay = this._toDayKey(dayKey);
        const startIso = `${safeDay}T00:00:00.000Z`;
        const endIso = `${safeDay}T23:59:59.999Z`;
        const replacements = { companyId: compId, startIso, endIso };

        const [
            saleAggRows,
            hourlyRows,
            itemAggRows,
            productRows,
            categoryRows,
            paymentSalesRows,
            expenseRows,
            refundRows
        ] = await Promise.all([
            sequelize.query(`
                SELECT COUNT(*)::int AS cnt,
                       COALESCE(SUM(s."total"), 0)::float AS total,
                       COALESCE(SUM(COALESCE(s."discount", 0) + COALESCE(s."promoDiscount", 0)), 0)::float AS discounts
                FROM "Sales" s
                WHERE s."companyId" = :companyId
                  AND s."status" <> 'cancelled'
                  AND s."date" >= :startIso AND s."date" <= :endIso
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT EXTRACT(HOUR FROM s."createdAt")::int AS hour,
                       COUNT(*)::int AS cnt,
                       COALESCE(SUM(s."total"), 0)::float AS total
                FROM "Sales" s
                WHERE s."companyId" = :companyId
                  AND s."status" <> 'cancelled'
                  AND s."date" >= :startIso AND s."date" <= :endIso
                GROUP BY 1
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT COALESCE(SUM(si."subtotal"), 0)::float AS revenue,
                       COALESCE(SUM(COALESCE(si."quantity", 0) * COALESCE(si."cost", 0)), 0)::float AS cost
                FROM "SaleItems" si
                INNER JOIN "Sales" s ON s."id" = si."saleId"
                WHERE s."companyId" = :companyId
                  AND s."status" <> 'cancelled'
                  AND s."date" >= :startIso AND s."date" <= :endIso
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT COALESCE(si."name", 'Desconocido') AS name,
                       COALESCE(SUM(si."quantity"), 0)::float AS quantity,
                       COALESCE(SUM(si."subtotal"), 0)::float AS total
                FROM "SaleItems" si
                INNER JOIN "Sales" s ON s."id" = si."saleId"
                WHERE s."companyId" = :companyId
                  AND s."status" <> 'cancelled'
                  AND s."date" >= :startIso AND s."date" <= :endIso
                GROUP BY 1
                ORDER BY quantity DESC
                LIMIT 50
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT COALESCE(NULLIF(TRIM(si."category"), ''), 'General') AS category,
                       COALESCE(SUM(si."subtotal"), 0)::float AS total,
                       COALESCE(SUM(si."quantity"), 0)::float AS quantity
                FROM "SaleItems" si
                INNER JOIN "Sales" s ON s."id" = si."saleId"
                WHERE s."companyId" = :companyId
                  AND s."status" <> 'cancelled'
                  AND s."date" >= :startIso AND s."date" <= :endIso
                GROUP BY 1
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT s."total", s."paymentMethod", s."paymentMethods", s."exchangeRate"
                FROM "Sales" s
                WHERE s."companyId" = :companyId
                  AND s."status" <> 'cancelled'
                  AND s."date" >= :startIso AND s."date" <= :endIso
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT COALESCE(SUM("amount"), 0)::float AS total
                FROM "Expenses"
                WHERE "companyId" = :companyId
                  AND "date" >= :startIso AND "date" <= :endIso
            `, { replacements, type: sequelize.QueryTypes.SELECT }),
            sequelize.query(`
                SELECT COALESCE(SUM("amount"), 0)::float AS total
                FROM "Refunds"
                WHERE "companyId" = :companyId
                  AND "date" >= :startIso AND "date" <= :endIso
            `, { replacements, type: sequelize.QueryTypes.SELECT })
        ]);

        const salesCount = Number(saleAggRows?.[0]?.cnt || 0);
        const grossSalesUsd = precision.round(Number(saleAggRows?.[0]?.total || 0), 4);
        const discountsUsd = precision.round(Number(saleAggRows?.[0]?.discounts || 0), 4);
        const itemsRevenueUsd = precision.round(Number(itemAggRows?.[0]?.revenue || 0), 4);
        const itemsCostUsd = precision.round(Number(itemAggRows?.[0]?.cost || 0), 4);
        const expensesUsd = precision.round(Number(expenseRows?.[0]?.total || 0), 4);
        const refundsUsd = precision.round(Number(refundRows?.[0]?.total || 0), 4);

        const hourlyJson = {};
        for (const h of (hourlyRows || [])) {
            const hr = Number(h.hour);
            if (hr >= 0 && hr < 24) {
                hourlyJson[String(hr)] = {
                    count: Number(h.cnt) || 0,
                    total: precision.round(Number(h.total) || 0, 2)
                };
            }
        }

        const paymentsJson = {};
        for (const s of (paymentSalesRows || [])) {
            const saleTotal = precision.round(Number(s.total) || 0, 2);
            const saleRate = Number(s.exchangeRate) > 0 ? Number(s.exchangeRate) : 1.0;
            let parsedPms = [];
            if (Array.isArray(s.paymentMethods)) parsedPms = s.paymentMethods;
            else if (typeof s.paymentMethods === 'string') {
                try { const p = JSON.parse(s.paymentMethods); if (Array.isArray(p)) parsedPms = p; } catch (_) {}
            }
            if (parsedPms.length > 0) {
                for (const pm of parsedPms) {
                    if (!pm) continue;
                    const mKey = String(pm.method || pm.id || s.paymentMethod || 'Efectivo').trim() || 'Efectivo';
                    const pmCur = String(pm.currency || '').toUpperCase().trim();
                    const isVesPm = pmCur === 'VES' || pmCur === 'BS' || ['ves', '_bs', 'pago_movil', 'pagomovil', 'biopago', 'punto', 'debit'].some(t => mKey.toLowerCase().includes(t));
                    const rawAmt = Number(pm.amount) || 0;
                    const eqUsd = Number(pm.convertedAmountUsd) > 0
                        ? Number(pm.convertedAmountUsd)
                        : (isVesPm && saleRate > 0 ? precision.divide(rawAmt, saleRate) : rawAmt);
                    paymentsJson[mKey] = precision.round(precision.add([paymentsJson[mKey] || 0, eqUsd]), 2);
                }
            } else {
                const method = String(s.paymentMethod || '').trim() || 'Efectivo';
                paymentsJson[method] = precision.round(precision.add([paymentsJson[method] || 0, saleTotal]), 2);
            }
        }

        const categoriesJson = {};
        for (const c of (categoryRows || [])) {
            categoriesJson[c.category] = {
                total: precision.round(Number(c.total) || 0, 2),
                quantity: precision.round(Number(c.quantity) || 0, 4)
            };
        }

        const productsJson = {};
        for (const p of (productRows || [])) {
            productsJson[p.name] = {
                quantity: precision.round(Number(p.quantity) || 0, 4),
                total: precision.round(Number(p.total) || 0, 2)
            };
        }

        await sequelize.query(`
            INSERT INTO public.daily_sales_rollups (
                "companyId", "dayKey", "salesCount", "grossSalesUsd", "discountsUsd",
                "itemsRevenueUsd", "itemsCostUsd", "expensesUsd", "refundsUsd",
                "hourlyJson", "paymentsJson", "categoriesJson", "productsJson", "updatedAt"
            ) VALUES (
                :companyId, :dayKey, :salesCount, :grossSalesUsd, :discountsUsd,
                :itemsRevenueUsd, :itemsCostUsd, :expensesUsd, :refundsUsd,
                CAST(:hourlyJson AS jsonb), CAST(:paymentsJson AS jsonb),
                CAST(:categoriesJson AS jsonb), CAST(:productsJson AS jsonb), NOW()
            )
            ON CONFLICT ("companyId", "dayKey")
            DO UPDATE SET
                "salesCount" = EXCLUDED."salesCount",
                "grossSalesUsd" = EXCLUDED."grossSalesUsd",
                "discountsUsd" = EXCLUDED."discountsUsd",
                "itemsRevenueUsd" = EXCLUDED."itemsRevenueUsd",
                "itemsCostUsd" = EXCLUDED."itemsCostUsd",
                "expensesUsd" = EXCLUDED."expensesUsd",
                "refundsUsd" = EXCLUDED."refundsUsd",
                "hourlyJson" = EXCLUDED."hourlyJson",
                "paymentsJson" = EXCLUDED."paymentsJson",
                "categoriesJson" = EXCLUDED."categoriesJson",
                "productsJson" = EXCLUDED."productsJson",
                "updatedAt" = NOW();
        `, {
            replacements: {
                companyId: compId,
                dayKey: safeDay,
                salesCount,
                grossSalesUsd,
                discountsUsd,
                itemsRevenueUsd,
                itemsCostUsd,
                expensesUsd,
                refundsUsd,
                hourlyJson: JSON.stringify(hourlyJson),
                paymentsJson: JSON.stringify(paymentsJson),
                categoriesJson: JSON.stringify(categoriesJson),
                productsJson: JSON.stringify(productsJson)
            }
        });

        this._dirtyDays.delete(`${compId}|${safeDay}`);
        cacheService.delPrefix(`dashboard_summary_${compId}_`);
        return { companyId: compId, dayKey: safeDay, salesCount, grossSalesUsd };
    }

    /**
     * Marca un día como sucio y programa su reconstrucción asíncrona coalescida (0 ms de impacto en caja).
     */
    scheduleDayRefresh(companyId, dateLike = null) {
        if (!this._isPostgres()) return;
        const compId = String(companyId || '2');
        const safeDay = this._toDayKey(dateLike);
        const key = `${compId}|${safeDay}`;
        this._dirtyDays.add(key);

        if (this._pendingTimers.has(key)) {
            clearTimeout(this._pendingTimers.get(key));
        }

            const timer = setTimeout(() => {
            this._pendingTimers.delete(key);
            if (!sequelize?.connectionManager?.pool) return;
            const { runWithTenantContext } = require('../database/tenantContext');
            runWithTenantContext({ companyId: compId, userId: 'system-rollup', isSuperAdmin: true }, () => {
                this.rebuildDay(compId, safeDay).catch((err) => {
                    if (/connection manager was closed/i.test(String(err?.message || ''))) return;
                    console.warn(`[DailyRollupService] Aviso actualizando rollup ${key}:`, err.message);
                });
            });
        }, 150);
        if (typeof timer.unref === 'function') timer.unref();
        this._pendingTimers.set(key, timer);
    }

    /**
     * Genera todos los rollups faltantes para una empresa en los días con actividad (o rango dado).
     */
    async backfillCompanyDays(companyId, { startDay = null, endDay = null, maxDays = 400 } = {}) {
        if (!this._isPostgres()) return { rebuilt: 0 };
        const ready = await this.ensureTable();
        if (!ready) return { rebuilt: 0 };

        const compId = String(companyId || '2');
        const lockKey = `${compId}|${startDay || 'all'}|${endDay || 'all'}`;
        if (this._backfillRunning.has(lockKey)) return { rebuilt: 0, skipped: 'in_progress' };

        this._backfillRunning.add(lockKey);
        try {
            const conds = [`"companyId" = :companyId`];
            const replacements = { companyId: compId };
            if (startDay) {
                conds.push(`LEFT(COALESCE("date", "createdAt"::text), 10) >= :startDay`);
                replacements.startDay = this._toDayKey(startDay);
            }
            if (endDay) {
                conds.push(`LEFT(COALESCE("date", "createdAt"::text), 10) <= :endDay`);
                replacements.endDay = this._toDayKey(endDay);
            }
            const whereSql = conds.join(' AND ');

            const dayRows = await sequelize.query(`
                SELECT DISTINCT day_key FROM (
                    SELECT LEFT(COALESCE("date", "createdAt"::text), 10) AS day_key FROM "Sales" WHERE ${whereSql} AND "status" <> 'cancelled'
                    UNION
                    SELECT LEFT(COALESCE("date", "createdAt"::text), 10) AS day_key FROM "Expenses" WHERE ${whereSql}
                    UNION
                    SELECT LEFT(COALESCE("date", "createdAt"::text), 10) AS day_key FROM "Refunds" WHERE ${whereSql}
                ) d
                WHERE day_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                ORDER BY day_key DESC
                LIMIT :maxDays;
            `, {
                replacements: { ...replacements, maxDays: Math.max(1, parseInt(maxDays, 10) || 400) },
                type: sequelize.QueryTypes.SELECT
            });

            let rebuilt = 0;
            for (const row of (dayRows || [])) {
                if (row.day_key) {
                    await this.rebuildDay(compId, row.day_key);
                    rebuilt++;
                }
            }
            return { rebuilt, totalCandidateDays: (dayRows || []).length };
        } finally {
            this._backfillRunning.delete(lockKey);
        }
    }

    /**
     * Rellena todos los días faltantes en `daily_sales_rollups` para todas las empresas activas.
     */
    async backfillAllActiveCompanies(daysBack = 365) {
        if (!this._isPostgres()) return { companies: 0, rebuilt: 0 };
        const ready = await this.ensureTable();
        if (!ready) return { companies: 0, rebuilt: 0 };

        const startDay = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const companies = await sequelize.query(`
            SELECT DISTINCT "companyId" FROM "Sales" WHERE "companyId" IS NOT NULL
        `, { type: sequelize.QueryTypes.SELECT }).catch(() => []);

        let totalRebuilt = 0;
        for (const c of (companies || [])) {
            const res = await this.backfillCompanyDays(c.companyId, { startDay, maxDays: daysBack + 2 });
            totalRebuilt += res.rebuilt || 0;
        }
        return { companies: (companies || []).length, rebuilt: totalRebuilt };
    }

    /**
     * Intenta resolver `getDashboardSummary` en < 5 ms usando `daily_sales_rollups`
     * para rangos completos alineados a días UTC (00:00:00.000Z .. 23:59:59.999Z).
     * Retorna `null` si algún día está pendiente de refresco o sin cobertura (fallback transparente).
     */
    async tryGetDashboardAnalytics(companyId, startIso, endIso) {
        if (!this._isPostgres() || !this._tableEnsured) return null;
        if (!String(startIso).endsWith('T00:00:00.000Z') || !String(endIso).endsWith('T23:59:59.999Z')) {
            return null;
        }

        const compId = String(companyId || '2');
        const startDay = String(startIso).slice(0, 10);
        const endDay = String(endIso).slice(0, 10);

        // Si algún día dentro del rango está marcado sucio en cola, caer al SQL en vivo para consistencia inmediata
        for (const dirtyKey of this._dirtyDays) {
            const [dComp, dDay] = dirtyKey.split('|');
            if (dComp === compId && dDay >= startDay && dDay <= endDay) {
                return null;
            }
        }

        // Verificar frescura y cobertura en 1 consulta ultraligera (< 1 ms con índices)
        const [metaRow] = await sequelize.query(`
            SELECT
                (SELECT COUNT(*)::int FROM public.daily_sales_rollups r
                 WHERE r."companyId" = :companyId AND r."dayKey" >= :startDay AND r."dayKey" <= :endDay) AS rollup_days,
                (SELECT MAX(r."updatedAt") FROM public.daily_sales_rollups r
                 WHERE r."companyId" = :companyId AND r."dayKey" >= :startDay AND r."dayKey" <= :endDay) AS last_rollup_at,
                (SELECT MAX(s."updatedAt") FROM "Sales" s
                 WHERE s."companyId" = :companyId AND s."status" <> 'cancelled' AND s."date" >= :startIso AND s."date" <= :endIso) AS last_sale_at,
                (SELECT MAX(e."updatedAt") FROM "Expenses" e
                 WHERE e."companyId" = :companyId AND e."date" >= :startIso AND e."date" <= :endIso) AS last_expense_at,
                (SELECT MAX(rf."updatedAt") FROM "Refunds" rf
                 WHERE rf."companyId" = :companyId AND rf."date" >= :startIso AND rf."date" <= :endIso) AS last_refund_at
        `, {
            replacements: { companyId: compId, startDay, endDay, startIso, endIso },
            type: sequelize.QueryTypes.SELECT
        }).catch(() => []);

        if (!metaRow) return null;
        const rollupDays = Number(metaRow.rollup_days || 0);
        const lastActivityMs = Math.max(
            metaRow.last_sale_at ? new Date(metaRow.last_sale_at).getTime() : 0,
            metaRow.last_expense_at ? new Date(metaRow.last_expense_at).getTime() : 0,
            metaRow.last_refund_at ? new Date(metaRow.last_refund_at).getTime() : 0
        );
        const lastRollupMs = metaRow.last_rollup_at ? new Date(metaRow.last_rollup_at).getTime() : 0;

        // Si hay actividad en el rango pero no hay rollups o el rollup es más viejo que el último cambio -> backfill en background (con cooldown) y fallback en vivo
        if (lastActivityMs > 0 && (rollupDays === 0 || lastRollupMs < lastActivityMs)) {
            const cooldownKey = `${compId}|${startDay}|${endDay}`;
            const nowMs = Date.now();
            const lastTriggered = this._lastBackfillTrigger?.get(cooldownKey) || 0;
            if (nowMs - lastTriggered > 30000) {
                if (!this._lastBackfillTrigger) this._lastBackfillTrigger = new Map();
                this._lastBackfillTrigger.set(cooldownKey, nowMs);
                setImmediate(() => {
                    const { runWithTenantContext } = require('../database/tenantContext');
                    runWithTenantContext({ companyId: compId, userId: 'system-rollup', isSuperAdmin: true }, () => {
                        this.backfillCompanyDays(compId, { startDay, endDay }).catch(() => {});
                    });
                });
            }
            return null;
        }

        const rows = await sequelize.query(`
            SELECT "dayKey", "salesCount", "grossSalesUsd", "discountsUsd",
                   "itemsRevenueUsd", "itemsCostUsd", "expensesUsd", "refundsUsd",
                   "hourlyJson", "paymentsJson", "categoriesJson", "productsJson"
            FROM public.daily_sales_rollups
            WHERE "companyId" = :companyId
              AND "dayKey" >= :startDay
              AND "dayKey" <= :endDay
            ORDER BY "dayKey" ASC
        `, {
            replacements: { companyId: compId, startDay, endDay },
            type: sequelize.QueryTypes.SELECT
        });

        let numberOfSales = 0;
        let totalDiscountsMicro = 0;
        let grossItemsRevenueMicro = 0;
        let rawCostMicro = 0;
        let totalExpensesMicro = 0;
        let totalRefundsMicro = 0;

        const SCALE = 10000;
        const toInt4 = (v) => Math.round((Number(v) || 0) * SCALE);
        const fromInt2 = (iv) => Math.round((iv / SCALE) * 100) / 100;
        const fromInt4 = (iv) => Math.round(iv) / SCALE;

        const hourlyCount = new Int32Array(24);
        const hourlyTotalMicro = new Float64Array(24);
        const paymentMapMicro = new Map();
        const categoryMapMicro = new Map();
        const productMapMicro = new Map();
        const trends = [];

        for (let i = 0; i < (rows ? rows.length : 0); i++) {
            const r = rows[i];
            const cnt = Number(r.salesCount || 0);
            const salesUsd = Math.round((Number(r.grossSalesUsd || 0)) * 100) / 100;
            const discMicro = toInt4(r.discountsUsd);
            const expUsd = Math.round((Number(r.expensesUsd || 0)) * 100) / 100;
            const expMicro = toInt4(expUsd);
            const refMicro = toInt4(r.refundsUsd);

            numberOfSales += cnt;
            totalDiscountsMicro += discMicro;
            grossItemsRevenueMicro += toInt4(r.itemsRevenueUsd);
            rawCostMicro += toInt4(r.itemsCostUsd);
            totalExpensesMicro += expMicro;
            totalRefundsMicro += refMicro;

            if (cnt > 0 || salesUsd > 0 || expUsd > 0) {
                trends.push({ date: r.dayKey, sales: salesUsd, profit: 0, expenses: expUsd, count: cnt });
            }

            const hj = r.hourlyJson;
            if (hj && typeof hj === 'object') {
                for (const hrStr in hj) {
                    const hr = Number(hrStr);
                    const hVal = hj[hrStr];
                    if (hr >= 0 && hr < 24 && hVal) {
                        hourlyCount[hr] += Number(hVal.count || 0);
                        hourlyTotalMicro[hr] += toInt4(hVal.total);
                    }
                }
            }

            const pj = r.paymentsJson;
            if (pj && typeof pj === 'object') {
                for (const method in pj) {
                    paymentMapMicro.set(method, (paymentMapMicro.get(method) || 0) + toInt4(pj[method]));
                }
            }

            const cj = r.categoriesJson;
            if (cj && typeof cj === 'object') {
                for (const cat in cj) {
                    const cVal = cj[cat];
                    if (!cVal) continue;
                    let acc = categoryMapMicro.get(cat);
                    if (!acc) {
                        acc = { totalMicro: 0, qtyMicro: 0 };
                        categoryMapMicro.set(cat, acc);
                    }
                    acc.totalMicro += toInt4(cVal.total);
                    acc.qtyMicro += toInt4(cVal.quantity);
                }
            }

            const prj = r.productsJson;
            if (prj && typeof prj === 'object') {
                for (const pName in prj) {
                    const pVal = prj[pName];
                    if (!pVal) continue;
                    let acc = productMapMicro.get(pName);
                    if (!acc) {
                        acc = { qtyMicro: 0, totalMicro: 0 };
                        productMapMicro.set(pName, acc);
                    }
                    acc.qtyMicro += toInt4(pVal.quantity);
                    acc.totalMicro += toInt4(pVal.total);
                }
            }
        }

        const totalDiscounts = fromInt4(totalDiscountsMicro);
        const grossItemsRevenue = fromInt4(grossItemsRevenueMicro);
        const rawCost = fromInt4(rawCostMicro);
        const totalExpenses = fromInt2(totalExpensesMicro);
        const totalRefunds = fromInt4(totalRefundsMicro);

        const rawRevenue = Math.max(0, precision.subtract(grossItemsRevenue, totalDiscounts));
        const rawGrossProfit = precision.subtract(rawRevenue, rawCost);
        const totalRevenue = Math.max(0, precision.subtract(rawRevenue, totalRefunds));
        const refundRatio = rawRevenue > 0 ? Math.min(1, totalRefunds / rawRevenue) : 0;
        const grossProfit = precision.subtract(rawGrossProfit, rawGrossProfit * refundRatio);
        const netCostAfterRefunds = Math.max(0, precision.subtract(rawCost, rawCost * refundRatio));
        const netProfit = precision.subtract(grossProfit, totalExpenses);

        const hourlySales = new Array(24);
        for (let hr = 0; hr < 24; hr++) {
            hourlySales[hr] = { hour: hr, count: hourlyCount[hr], total: fromInt2(hourlyTotalMicro[hr]) };
        }

        const topProducts = Array.from(productMapMicro.entries())
            .map(([name, acc]) => ({
                name,
                quantity: fromInt4(acc.qtyMicro),
                total: fromInt2(acc.totalMicro),
                unit: 'und'
            }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        const byCategory = Array.from(categoryMapMicro.entries())
            .map(([cat, acc]) => ({
                name: cat,
                category: cat,
                total: fromInt2(acc.totalMicro),
                quantity: fromInt4(acc.qtyMicro)
            }))
            .sort((a, b) => b.total - a.total);

        const paymentMethods = Array.from(paymentMapMicro.entries())
            .map(([method, totalMicro]) => ({ method, total: fromInt2(totalMicro) }))
            .sort((a, b) => b.total - a.total);

        return {
            summary: {
                totalSales: totalRevenue,
                numberOfSales,
                totalExpenses,
                totalRefunds,
                grossProfit,
                netProfit,
                margin: netCostAfterRefunds > 0 ? precision.round((grossProfit / netCostAfterRefunds) * 100, 2) : 0,
                avgTicket: numberOfSales > 0 ? precision.round(totalRevenue / numberOfSales, 2) : 0
            },
            topProducts,
            byCategory,
            paymentMethods,
            trends,
            hourlySales,
            _rollupAccelerated: true
        };
    }

    stop() {
        for (const timer of this._pendingTimers.values()) {
            clearTimeout(timer);
        }
        this._pendingTimers.clear();
    }
}

module.exports = new DailyRollupService();
