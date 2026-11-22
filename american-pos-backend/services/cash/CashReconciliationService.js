const { CashShift, Sale, CashMovement, AuditLog, CashDeclaration, Alert, User, Refund } = require('../../database/models');
const { sequelize } = require('../../database/connection');
const { generateRobustId, readJson, getUserSettings } = require('../../utils/helpers');
const { SETTINGS_FILE } = require('../../config/paths');
const { Op } = require('sequelize');
const precision = require('../../utils/precision');
const AlertService = require('../AlertService');
const { canonicalizePaymentMethodId, isVesPaymentMethod, applyMovementToBreakdown } = require('./cashHelpers');

module.exports = {
    /**
     * Get Admin Live Cash Dashboard (Control Room for multiple simultaneous cashiers)
     * Real-time metrics for all open registers, drawer physical cash, digital totals & live activity feed.
     */
    async getAdminLiveCashDashboard(companyId, requestingUser = null) {
        const reqRole = String(requestingUser?.role || '').toLowerCase();
        const isManagerOrAdmin = !requestingUser || ['admin', 'superadmin', 'owner', 'dueño', 'gerente', 'administrador'].includes(reqRole);

        // 1. Obtener todos los turnos actualmente abiertos con datos de usuario y movimientos
        const openShifts = await CashShift.findAll({
            where: { status: 'open', companyId },
            order: [['openedAt', 'DESC']],
            include: [
                { model: CashMovement, as: 'CashMovements' },
                { model: User, as: 'user', attributes: ['id', 'name', 'username', 'role'] }
            ]
        });

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const exchangeRate = Number(userSettings.exchangeRate) || 1.0;

        let totalCashInDrawersUsd = 0;
        let totalCashInDrawersBs = 0;
        let totalSalesActiveRegistersUsd = 0;
        let totalDigitalSalesActiveRegistersUsd = 0;
        let totalWithdrawalsTodayUsd = 0;

        const activeRegisters = [];

        for (const shift of openShifts) {
            const fullShiftData = await this.getCurrentShift(shift.userId, companyId, shift.registerId);
            if (!fullShiftData) continue;

            const expectedCashUsd = Number(fullShiftData.expectedCashUsd) || 0;
            const expectedCashBs = Number(fullShiftData.expectedCashBs) || 0;
            const totalSalesAmount = Number(fullShiftData.totalSalesAmount) || 0;
            const salesCount = Number(fullShiftData.salesCount) || 0;
            const initialAmount = Number(shift.initialAmount) || 0;

            // Calcular retiros de este turno
            const movements = shift.CashMovements || [];
            const totalOut = movements
                .filter(m => m.type === 'out' || m.type === 'expense')
                .reduce((acc, m) => {
                    const amt = Number(m.amount) || 0;
                    const mCur = (m.currency || 'USD').toUpperCase();
                    return acc + ((mCur === 'VES' || mCur === 'BS') ? precision.divide(amt, exchangeRate) : amt);
                }, 0);
            const totalIn = movements
                .filter(m => m.type === 'in' && !(m.id && m.id.startsWith('OPEN-')))
                .reduce((acc, m) => {
                    const amt = Number(m.amount) || 0;
                    const mCur = (m.currency || 'USD').toUpperCase();
                    return acc + ((mCur === 'VES' || mCur === 'BS') ? precision.divide(amt, exchangeRate) : amt);
                }, 0);

            // Ventas digitales = Total ventas - Ventas en efectivo
            const cashSalesTotal = Number(fullShiftData.cashSalesTotal) || 0;
            const digitalSalesUsd = Math.max(0, precision.subtract(totalSalesAmount, cashSalesTotal));

            totalCashInDrawersUsd = precision.add([totalCashInDrawersUsd, expectedCashUsd]);
            totalCashInDrawersBs = precision.add([totalCashInDrawersBs, expectedCashBs]);
            totalSalesActiveRegistersUsd = precision.add([totalSalesActiveRegistersUsd, totalSalesAmount]);
            totalDigitalSalesActiveRegistersUsd = precision.add([totalDigitalSalesActiveRegistersUsd, digitalSalesUsd]);
            totalWithdrawalsTodayUsd = precision.add([totalWithdrawalsTodayUsd, totalOut]);

            // Minutos abierto
            const openedTime = new Date(shift.openedAt).getTime();
            const durationMinutes = Math.max(0, Math.floor((Date.now() - openedTime) / 60000));

            // Última actividad para semáforo (excluyendo ventas canceladas)
            const lastSale = await Sale.findOne({
                where: { userId: shift.userId, companyId, registerId: shift.registerId, status: { [Op.ne]: 'cancelled' } },
                order: [['date', 'DESC']],
                attributes: ['date']
            });
            const lastMovement = movements.length > 0 ? movements[movements.length - 1] : null;

            let lastActivityDate = shift.openedAt;
            if (lastSale?.date && new Date(lastSale.date) > new Date(lastActivityDate)) {
                lastActivityDate = lastSale.date;
            }
            if (lastMovement?.timestamp && new Date(lastMovement.timestamp) > new Date(lastActivityDate)) {
                lastActivityDate = lastMovement.timestamp;
            }

            const minutesSinceLastActivity = Math.max(0, Math.floor((Date.now() - new Date(lastActivityDate).getTime()) / 60000));
            
            // Estado operativo en tiempo real:
            // - 'active' (Facturando): si ha registrado ventas en los últimos 30 minutos
            // - 'standby' (Operativa • En Espera): si el turno está abierto y listo sin ventas aún
            // - 'idle' (En Reposo): si ya tuvo ventas pero lleva más de 30 minutos sin movimiento
            let activityStatus = 'standby';
            let statusLabel = 'Operativa • En Espera';

            if (salesCount > 0) {
                if (minutesSinceLastActivity <= 30) {
                    activityStatus = 'active';
                    statusLabel = 'Facturando';
                } else {
                    activityStatus = 'idle';
                    statusLabel = `En Reposo (${minutesSinceLastActivity}m)`;
                }
            } else {
                activityStatus = 'standby';
                statusLabel = 'Operativa • En Espera';
            }

            const actualUserName = shift.userName || shift.user?.name || shift.user?.username || 'Cajero';
            const actualUserRole = shift.user?.role || 'user';

            activeRegisters.push({
                shiftId: shift.id,
                registerId: shift.registerId || '1',
                registerName: shift.registerName || `Caja ${shift.registerId || '1'}`,
                userId: isManagerOrAdmin ? shift.userId : null,
                userName: isManagerOrAdmin ? actualUserName : 'Usuario Protegido',
                userRole: isManagerOrAdmin ? actualUserRole : 'cajero',
                isUserProtected: !isManagerOrAdmin,
                openedAt: shift.openedAt,
                durationMinutes,
                initialAmount,
                totalSalesAmount,
                salesCount,
                expectedCashUsd,
                expectedCashBs,
                digitalSalesUsd,
                totalOut,
                totalIn,
                expectedAmountTotal: fullShiftData.expectedAmount,
                paymentBreakdown: fullShiftData.paymentBreakdown || {},
                paymentBreakdownNative: fullShiftData.paymentBreakdownNative || {},
                expectedBreakdown: fullShiftData.expectedBreakdown || {},
                lastActivityDate,
                minutesSinceLastActivity,
                activityStatus,
                statusLabel
            });
        }

        const getRegisterSortRank = (reg) => {
            const name = (reg.registerName || '').toLowerCase().trim();
            if (name.includes('caja 1') || name === '1' || name.includes('principal')) return 1;
            if (name.includes('caja 2') || name === '2') return 2;
            if (name.includes('caja 3') || name === '3') return 3;
            const match = name.match(/\d+/);
            if (match) return 10 + parseInt(match[0], 10);
            return 100;
        };

        activeRegisters.sort((a, b) => {
            const rankA = getRegisterSortRank(a);
            const rankB = getRegisterSortRank(b);
            if (rankA !== rankB) return rankA - rankB;
            return (a.registerName || '').localeCompare(b.registerName || '', undefined, { numeric: true, sensitivity: 'base' });
        });

        // 2. Ventas globales de hoy (usando hora local para evitar desfase UTC en turnos nocturnos)
        const now = new Date();
        const localYear = now.getFullYear();
        const localMonth = String(now.getMonth() + 1).padStart(2, '0');
        const localDay = String(now.getDate()).padStart(2, '0');
        const todayStr = `${localYear}-${localMonth}-${localDay}`;
        const utcTodayStr = now.toISOString().split('T')[0];

        const likeOp = sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
        const dateFilter = todayStr === utcTodayStr 
            ? { [likeOp]: `${todayStr}%` }
            : { [Op.or]: [{ [likeOp]: `${todayStr}%` }, { [likeOp]: `${utcTodayStr}%` }] };

        const salesToday = await Sale.findAll({
            where: {
                companyId,
                date: dateFilter,
                status: { [Op.ne]: 'cancelled' }
            },
            attributes: ['id', 'total', 'paymentMethod', 'paymentMethods', 'exchangeRate']
        });

        const totalSalesToday = precision.add(salesToday.map(s => Number(s.total) || 0));

        // Calcular cobros digitales globales de hoy (para que no caigan a $0 al cerrar turno a mediodía)
        let totalDigitalSalesTodayUsd = 0;
        salesToday.forEach(s => {
            const pms = s.paymentMethods && Array.isArray(s.paymentMethods) && s.paymentMethods.length > 0
                ? s.paymentMethods
                : [{ method: s.paymentMethod || 'cash', amount: s.total, currency: 'USD' }];

            pms.forEach(pm => {
                const methodRaw = (pm.method || 'cash').toLowerCase().trim();
                const foundMethod = (userSettings.paymentMethods || []).find(m => 
                    m.id.toLowerCase() === methodRaw || m.name.toLowerCase() === methodRaw ||
                    (methodRaw === 'efectivo' && m.id === 'cash')
                );
                const isCash = foundMethod?.type === 'CASH' || foundMethod?.id?.includes('cash') || methodRaw.includes('cash') || methodRaw.includes('efectivo');
                if (!isCash) {
                    const isVes = pm.currency === 'VES' || (foundMethod && isVesPaymentMethod(foundMethod.id, userSettings.paymentMethods));
                    const amountUsd = isVes 
                        ? precision.normalizeToUsd(Number(pm.amount) || 0, Number(s.exchangeRate || exchangeRate))
                        : (Number(pm.amount) || 0);
                    totalDigitalSalesTodayUsd = precision.add([totalDigitalSalesTodayUsd, amountUsd]);
                }
            });
        });

        // 3. Actividad reciente combinada (Últimas 40 transacciones de cualquier caja)
        const recentSales = await Sale.findAll({
            where: { companyId },
            order: [['date', 'DESC']],
            limit: 25,
            attributes: ['id', 'date', 'total', 'paymentMethod', 'registerId', 'registerName', 'userId', 'customerName']
        });

        const recentMovements = await CashMovement.findAll({
            where: { companyId },
            order: [['timestamp', 'DESC']],
            limit: 20,
            attributes: ['id', 'type', 'amount', 'currency', 'reason', 'timestamp', 'userName', 'userId']
        });

        const recentActivity = [];
        recentSales.forEach(s => {
            recentActivity.push({
                id: `sale-${s.id}`,
                eventType: 'sale',
                timestamp: s.date,
                registerId: s.registerId || '1',
                registerName: s.registerName || `Caja ${s.registerId || '1'}`,
                userName: s.customerName ? `${s.customerName}` : 'Cliente',
                userId: s.userId,
                amount: Number(s.total) || 0,
                detail: `Venta cobrada (${s.paymentMethod || 'Múltiple'})`
            });
        });

        recentMovements.forEach(m => {
            let regName = 'Caja Principal';
            let regId = '1';
            if (m.reason && m.reason.includes('Caja ')) {
                const match = m.reason.match(/Caja\s+([\w-]+)/);
                if (match) {
                    regName = `Caja ${match[1]}`;
                    regId = match[1];
                }
            }
            recentActivity.push({
                id: `mov-${m.id}`,
                eventType: m.type === 'out' ? 'withdrawal' : m.type === 'expense' ? 'expense' : 'deposit',
                timestamp: m.timestamp,
                registerId: regId,
                registerName: regName,
                userName: isManagerOrAdmin ? (m.userName || 'Usuario') : 'Operador',
                userId: isManagerOrAdmin ? m.userId : null,
                amount: Number(m.amount) || 0,
                currency: m.currency || 'USD',
                detail: m.reason || (m.type === 'out' ? 'Retiro de efectivo' : 'Ingreso de efectivo')
            });
        });

        recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const slicedActivity = recentActivity.slice(0, 40);

        return {
            kpis: {
                openRegistersCount: activeRegisters.length,
                totalSalesTodayUsd: precision.round(totalSalesToday),
                totalCashInDrawersUsd: precision.round(totalCashInDrawersUsd),
                totalCashInDrawersBs: precision.round(totalCashInDrawersBs),
                totalDigitalSalesTodayUsd: precision.round(totalDigitalSalesTodayUsd),
                totalDigitalSalesActiveRegistersUsd: precision.round(totalDigitalSalesTodayUsd),
                totalWithdrawalsTodayUsd: precision.round(totalWithdrawalsTodayUsd),
                exchangeRate
            },
            activeRegisters,
            recentActivity: slicedActivity,
            serverTime: new Date().toISOString()
        };
    },

    /**
     * Get Cashier 360° Audit File (Expediente de Auditoría Integral del Cajero)
     */
    async getCashierAuditFile(userId, companyId) {
        // 1. Obtener datos del cajero
        const cashier = await User.findOne({
            where: { id: userId, companyId },
            attributes: ['id', 'name', 'username', 'email', 'role', 'status', 'createdAt']
        });
        if (!cashier) {
            throw new Error('Cajero no encontrado');
        }

        // 2. Nivel de Riesgo (AlertService)
        const risk = await AlertService.calculateUserRisk(userId, companyId);

        // 3. Declaraciones de cierre del cajero (auditorías y cierres ciegos)
        const declarations = await CashDeclaration.findAll({
            where: { userId, companyId },
            include: [{ 
                model: CashShift, 
                as: 'Shift',
                attributes: ['id', 'registerId', 'registerName', 'openedAt', 'closedAt', 'status'] 
            }],
            order: [['createdAt', 'DESC']],
            limit: 30
        });

        // 4. Estadísticas acumuladas
        const allDeclarations = await CashDeclaration.findAll({
            where: { userId, companyId },
            attributes: ['differenceUSD', 'differenceVES']
        });

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const exchangeRate = Number(userSettings.exchangeRate) || 1.0;

        const totalShifts = allDeclarations.length;
        let totalLossUsd = 0;
        let totalLossVes = 0;
        let totalSurplusUsd = 0;
        let totalSurplusVes = 0;
        let totalDiffUsd = 0;
        let totalDiffVes = 0;
        let exactMatchesCount = 0;

        allDeclarations.forEach(d => {
            const diffU = Number(d.differenceUSD) || 0;
            const diffV = Number(d.differenceVES) || 0;
            totalDiffUsd = precision.add([totalDiffUsd, diffU]);
            totalDiffVes = precision.add([totalDiffVes, diffV]);

            if (diffU === 0 && diffV === 0) {
                exactMatchesCount++;
            } else {
                if (diffU < 0) {
                    totalLossUsd = precision.add([totalLossUsd, Math.abs(diffU)]);
                } else if (diffU > 0) {
                    totalSurplusUsd = precision.add([totalSurplusUsd, diffU]);
                }

                if (diffV < 0) {
                    totalLossVes = precision.add([totalLossVes, Math.abs(diffV)]);
                    const lossVesInUsd = precision.normalizeToUsd(Math.abs(diffV), exchangeRate);
                    totalLossUsd = precision.add([totalLossUsd, lossVesInUsd]);
                } else if (diffV > 0) {
                    totalSurplusVes = precision.add([totalSurplusVes, diffV]);
                    const surplusVesInUsd = precision.normalizeToUsd(diffV, exchangeRate);
                    totalSurplusUsd = precision.add([totalSurplusUsd, surplusVesInUsd]);
                }
            }
        });

        const purityScore = totalShifts > 0 
            ? precision.round((exactMatchesCount / totalShifts) * 100) 
            : 100;

        // 5. Total de ventas realizadas por el cajero
        const salesCount = await Sale.count({
            where: { userId, companyId, status: { [Op.ne]: 'cancelled' } }
        });
        const salesVolumeRaw = await Sale.sum('total', {
            where: { userId, companyId, status: { [Op.ne]: 'cancelled' } }
        });
        const totalSalesVolumeUsd = precision.round(Number(salesVolumeRaw) || 0);
        const averageTicketUsd = salesCount > 0 ? precision.round(totalSalesVolumeUsd / salesCount) : 0;

        // 6. Retiros / Movimientos de caja registrados por este cajero
        const movements = await CashMovement.findAll({
            where: { userId, companyId },
            order: [['timestamp', 'DESC']],
            limit: 30
        });

        const allSettingsForAudit = readJson(SETTINGS_FILE) || {};
        const auditUserSettings = getUserSettings(allSettingsForAudit, companyId) || {};
        const auditRate = Number(auditUserSettings.exchangeRate) > 0 ? Number(auditUserSettings.exchangeRate) : 1;
        const totalWithdrawals = movements
            .filter(m => m.type === 'out' || m.type === 'expense')
            .reduce((acc, m) => {
                const rawAmt = Number(m.amount) || 0;
                const cur = String(m.currency || '').toUpperCase().trim();
                const isVes = cur === 'VES' || cur === 'BS';
                const amtUsd = (isVes && auditRate > 0) ? precision.divide(rawAmt, auditRate) : rawAmt;
                return precision.add([acc, amtUsd]);
            }, 0);

        // 7. Alertas asociadas
        const alerts = await Alert.findAll({
            where: { userId, companyId },
            order: [['createdAt', 'DESC']],
            limit: 15
        });

        // 8. Devoluciones o cancelaciones asociadas
        let refunds = [];
        try {
            refunds = await Refund.findAll({
                where: { companyId },
                include: [{
                    model: Sale,
                    as: 'Sale',
                    where: { userId }
                }],
                order: [['createdAt', 'DESC']],
                limit: 15
            });
        } catch (e) {
            // Relación opcional
            console.warn('[CashService] Aviso consultando devoluciones de cajero:', e.message);
        }

        return {
            cashier: cashier.toJSON(),
            risk,
            summary: {
                totalShifts,
                exactMatchesCount,
                mismatchCount: totalShifts - exactMatchesCount,
                purityScore,
                totalDiffUsd: precision.round(totalDiffUsd),
                totalDiffVes: precision.round(totalDiffVes),
                totalLossUsd: precision.round(totalLossUsd),
                totalLossVes: precision.round(totalLossVes),
                totalSurplusUsd: precision.round(totalSurplusUsd),
                totalSurplusVes: precision.round(totalSurplusVes),
                totalSalesVolumeUsd,
                salesCount,
                averageTicketUsd,
                totalWithdrawalsUsd: precision.round(totalWithdrawals)
            },
            declarations,
            movements,
            alerts,
            refunds
        };
    },

    /**
     * Cierre Forzado Remoto de Turno (Acción Administrativa)
     */
    async forceCloseShift(adminUser, shiftId, reason = 'Cierre administrativo forzado') {
        // Precalcular estadísticas fuera de la transacción con LOCK.UPDATE para evitar deadlock si getCurrentShift actualiza el turno
        const preShift = await CashShift.findOne({
            where: { id: shiftId, companyId: adminUser.companyId }
        });
        if (!preShift) {
            throw new Error('Turno de caja no encontrado');
        }
        if (preShift.status === 'closed' || preShift.status === 'forced_closed') {
            throw new Error('El turno ya se encuentra cerrado');
        }
        const currentShiftData = await this.getCurrentShift(preShift.userId, adminUser.companyId, preShift.registerId);

        const closedShift = await sequelize.transaction(async (t) => {
            const shift = await CashShift.findOne({
                where: { id: shiftId, companyId: adminUser.companyId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });
            if (!shift) {
                throw new Error('Turno de caja no encontrado');
            }
            if (shift.status === 'closed' || shift.status === 'forced_closed') {
                throw new Error('El turno ya se encuentra cerrado');
            }

            const expectedAmount = currentShiftData?.expectedAmount || Number(shift.initialAmount) || 0;

            shift.status = 'forced_closed';
            shift.closedAt = new Date().toISOString();
            shift.finalAmount = expectedAmount;
            shift.difference = 0;
            shift.closingNotes = `[CIERRE FORZADO REMOTO] Administrador: ${adminUser.name || adminUser.username}. Motivo: ${reason}`;
            shift.salesSummary = {
                totalSales: currentShiftData?.totalSalesAmount || 0,
                salesCount: currentShiftData?.salesCount || 0,
                forcedBy: adminUser.id,
                forcedAt: shift.closedAt
            };
            await shift.save({ transaction: t });

            // Crear declaración administrativa para registrar el cierre forzado en el libro inmutable
            try {
                const crypto = require('crypto');
                const expectedCashUSD = currentShiftData?.expectedCashUsd || 0;
                const expectedCashVES = currentShiftData?.expectedCashBs || 0;
                const hash = crypto.createHash('sha256').update(shiftId + 'FORCED_CLOSE' + Date.now()).digest('hex');
                await CashDeclaration.create({
                    id: generateRobustId(),
                    shiftId: shift.id,
                    userId: String(shift.userId || adminUser.id),
                    companyId: adminUser.companyId,
                    declaredCashUSD: expectedCashUSD,
                    declaredCashVES: expectedCashVES,
                    expectedCashUSD,
                    expectedCashVES,
                    differenceUSD: 0,
                    differenceVES: 0,
                    hash,
                    notes: `[CIERRE FORZADO REMOTO] Administrador: ${adminUser.name || adminUser.username}. Motivo: ${reason}`
                }, { transaction: t });
            } catch (decErr) {
                console.warn('[CASH] Error al registrar CashDeclaration de cierre forzado:', decErr.message);
            }

            // Registrar en AuditLog
            try {
                await AuditLog.create({
                    id: generateRobustId(),
                    userId: adminUser.id,
                    companyId: adminUser.companyId,
                    action: 'FORCE_CLOSE_SHIFT',
                    description: `Turno ${shiftId} en Caja ${shift.registerId} cerrado forzosamente por administrador`,
                    entityId: shiftId,
                    oldValue: JSON.stringify({ status: 'open' }),
                    newValue: JSON.stringify({ status: 'forced_closed', reason }),
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            } catch (auditErr) {
                console.warn('[CASH] Error al registrar AuditLog de cierre forzado:', auditErr.message);
            }

            return shift;
        });

        // Disparar Alerta de Seguridad (después del commit para evitar lecturas inconsistentes)
        await AlertService.triggerAlert({
            type: 'forced_closed',
            severity: 'high',
            message: `Turno de ${closedShift.userName || 'Cajero'} en Caja ${closedShift.registerId} cerrado forzosamente por ${adminUser.name || adminUser.username}. Motivo: ${reason}`,
            userId: closedShift.userId,
            companyId: adminUser.companyId,
            metadata: { shiftId, forcedBy: adminUser.id, reason }
        });

        return closedShift;
    },

    /**
     * Close an open shift.
     */
    async closeShift(reqUser, closingData) {
        const { id: userId, companyId } = reqUser;
        const { finalBreakdown = {}, notes = '' } = closingData;

        const registerId = closingData.registerId || '1';

        const closedShift = await sequelize.transaction(async (t) => {
            let currentShift = null;

            // 1. Si viene shiftId explícito (ej: terminal móvil o reconexión)
            if (closingData.shiftId) {
                currentShift = await CashShift.findOne({
                    where: { id: String(closingData.shiftId), status: 'open', companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            // 2. Buscar por usuario y caja física
            if (!currentShift) {
                currentShift = await CashShift.findOne({
                    where: { userId: String(userId), status: 'open', companyId, registerId: String(registerId) },
                    order: [['openedAt', 'DESC']],
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            // 3. Fallback: Buscar turno abierto por el usuario sin importar el nombre de terminal (ej: 'Caja Móvil' vs 'DEV-...')
            if (!currentShift) {
                currentShift = await CashShift.findOne({
                    where: { userId: String(userId), status: 'open', companyId },
                    order: [['openedAt', 'DESC']],
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (currentShift) {
                    console.log(`[CASH] Turno ${currentShift.id} de caja ${currentShift.registerId} recuperado por usuario para cierre desde ${registerId}`);
                }
            }

            // 4. Fallback: Buscar por registerId si el usuario fue registrado con ID genérico o nodo de sincronización
            if (!currentShift && registerId) {
                const fallbackWhere = { registerId: String(registerId), status: 'open' };
                if (companyId) fallbackWhere.companyId = companyId;
                currentShift = await CashShift.findOne({
                    where: fallbackWhere,
                    order: [['openedAt', 'DESC']],
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            // 5. Fallback Administrativo: Si el usuario es admin o supervisor, recuperar el turno abierto de la sucursal/empresa
            if (!currentShift) {
                const userRole = (reqUser.role || '').toLowerCase();
                if (['admin', 'superadmin', 'owner', 'supervisor'].includes(userRole)) {
                    currentShift = await CashShift.findOne({
                        where: { status: 'open', companyId },
                        order: [['openedAt', 'DESC']],
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                }
            }

            if (!currentShift) throw new Error('No hay caja abierta para cerrar');

            // 🛡️ Load movements in separate query under the same transaction (avoids PostgreSQL outer join lock error)
            const movements = await CashMovement.findAll({
                where: { shiftId: currentShift.id },
                order: [['timestamp', 'ASC']],
                transaction: t
            });
            currentShift.CashMovements = movements;
            
            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const pMethods = userSettings.paymentMethods || [];
            const exchangeRate = Number(userSettings.exchangeRate) || 1.0;

            // Compute or retrieve shift stats under transaction
            const stats = await this.getShiftStats(
                currentShift.userId,
                currentShift.openedAt,
                companyId,
                currentShift.registerId,
                t
            );

            const activeMovements = movements.filter(m => !m.id || !m.id.startsWith('OPEN-'));
            const convertMovToUsd = (m) => {
                const amt = Number(m.amount) || 0;
                const mCurrency = (m.currency || 'USD').toUpperCase();
                return (mCurrency === 'VES' || mCurrency === 'BS') ? precision.divide(amt, exchangeRate) : amt;
            };
            const tIn = precision.add(activeMovements.filter(m => ['in', 'income'].includes(String(m.type || '').toLowerCase())).map(convertMovToUsd));
            const tOut = precision.add(activeMovements.filter(m => ['out'].includes(String(m.type || '').toLowerCase())).map(convertMovToUsd));
            const tExp = precision.add(activeMovements.filter(m => ['expense', 'out_expense'].includes(String(m.type || '').toLowerCase())).map(convertMovToUsd));

            const safeParse = (val) => {
                if (!val) return {};
                if (typeof val === 'string') {
                    try {
                        const parsed = JSON.parse(val);
                        return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
                    } catch (e) { return {}; }
                }
                return val;
            };

            const expectedBreakdown = { ...safeParse(currentShift.initialBreakdown) };
            
            // Re-apply same logic for standardized native breakdown
            Object.entries(stats.paymentBreakdownNative || {}).forEach(([methodId, amount]) => {
                const canon = canonicalizePaymentMethodId(methodId);
                expectedBreakdown[canon] = precision.round(precision.add([expectedBreakdown[canon] || 0, amount]));
            });

            activeMovements.forEach(m => {
                applyMovementToBreakdown(m, expectedBreakdown, pMethods);
            });

            const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());

            if (isSingleMode) {
                Object.keys(expectedBreakdown).forEach(key => {
                    if (isVesPaymentMethod(key, pMethods)) {
                        delete expectedBreakdown[key];
                    }
                });
                if (Object.keys(expectedBreakdown).length === 0 && currentShift.initialAmount > 0) {
                    expectedBreakdown['cash'] = currentShift.initialAmount;
                }
            }

            const expectedAmountTotalUsd = precision.add(
                Object.entries(expectedBreakdown).map(([id, val]) => {
                    const isVes = isVesPaymentMethod(id, pMethods);
                    if (isSingleMode && isVes) return 0;
                    return isVes ? precision.divide(val, exchangeRate) : val;
                })
            );

            const expectedAmountTotal = precision.add(Object.values(expectedBreakdown).map(v => Number(v)));

            // Support declaration object or finalBreakdown mapping
            let normalizedFinalBreakdown = { ...finalBreakdown };
            if (closingData.declaration && Object.keys(normalizedFinalBreakdown).length === 0) {
                const dec = closingData.declaration;
                const usdCash = typeof dec.usd === 'object' 
                    ? Object.entries(dec.usd).reduce((acc, [b, q]) => precision.add([acc, precision.multiply(Number(b), Number(q) || 0)]), 0)
                    : Number(dec.usd || dec.cash || 0);
                const totalUsdCash = precision.add([usdCash, Number(dec.looseCoins || 0)]);
                normalizedFinalBreakdown['cash'] = totalUsdCash;
                if (dec.ves !== undefined) normalizedFinalBreakdown['cash_ves'] = Number(dec.ves || 0);
                if (dec.card !== undefined) normalizedFinalBreakdown['card'] = Number(dec.card || 0);
                if (dec.mobile !== undefined) normalizedFinalBreakdown['pagomovil'] = Number(dec.mobile || 0);
                if (dec.zelle !== undefined) normalizedFinalBreakdown['zelle'] = Number(dec.zelle || 0);
            }

            // Soportar montos declarados desde terminal móvil (declaredAmountUsd y declaredAmountBs)
            if (Object.keys(normalizedFinalBreakdown).length === 0) {
                if (closingData.declaredAmountUsd !== undefined || closingData.declaredAmountBs !== undefined) {
                    normalizedFinalBreakdown['cash'] = Number(closingData.declaredAmountUsd || 0);
                    if (closingData.declaredAmountBs !== undefined) {
                        normalizedFinalBreakdown['cash_bs'] = Number(closingData.declaredAmountBs || 0);
                    }
                    // Para métodos electrónicos/bancarios no efectivos, imputar el valor esperado para evitar falsos faltantes
                    Object.entries(expectedBreakdown).forEach(([mId, expectedVal]) => {
                        const canon = canonicalizePaymentMethodId(mId);
                        if (!['cash', 'cash_bs', 'cash_usd', 'cash_ves'].includes(canon) && normalizedFinalBreakdown[canon] === undefined) {
                            normalizedFinalBreakdown[canon] = expectedVal;
                        }
                    });
                }
            }

            // Deduplicate and normalize aliases to prevent duplicate keys and double-counting
            const aliasMap = {
                card: 'debit',
                punto: 'debit',
                tarjeta: 'debit',
                debito: 'debit',
                cash_ves: 'cash_bs',
                efectivo_bs: 'cash_bs',
                pagomovil: 'pago_movil',
                mobile: 'pago_movil',
                usd: 'cash'
            };

            Object.entries(aliasMap).forEach(([alias, canonical]) => {
                if (normalizedFinalBreakdown[canonical] !== undefined && normalizedFinalBreakdown[alias] !== undefined) {
                    delete normalizedFinalBreakdown[alias];
                } else if (normalizedFinalBreakdown[canonical] === undefined && normalizedFinalBreakdown[alias] !== undefined) {
                    if (expectedBreakdown[canonical] !== undefined || (Array.isArray(pMethods) && pMethods.some(pm => pm && pm.id === canonical))) {
                        normalizedFinalBreakdown[canonical] = normalizedFinalBreakdown[alias];
                        delete normalizedFinalBreakdown[alias];
                    }
                }
            });

            const finalAmountInputUsd = precision.add(
                Object.entries(normalizedFinalBreakdown).map(([id, val]) => {
                    const isVes = isVesPaymentMethod(id, pMethods);
                    if (isSingleMode && isVes) return 0;
                    return isVes ? precision.divide(Number(val), exchangeRate) : Number(val);
                })
            );
            const finalAmountInput = precision.round(finalAmountInputUsd);

            const diff = precision.round(precision.subtract(finalAmountInput, expectedAmountTotalUsd));
            const rawTolerance = userSettings.cashDifferenceToleranceUsd;
            const tolerance = (rawTolerance !== undefined && rawTolerance !== null && !isNaN(Number(rawTolerance))) ? Number(rawTolerance) : 1.0;

            const isUserAdminOrSupervisor = ['admin', 'superadmin', 'owner', 'supervisor'].includes(String(reqUser?.role || '').toLowerCase());

            if (Math.abs(diff) > tolerance && !isUserAdminOrSupervisor) {
                const approvalIdToVerify = closingData.supervisorApprovalId || closingData.supervisorAuthToken;
                let verifiedApproval = null;
                const now = new Date();
                if (approvalIdToVerify) {
                    const { SupervisorApproval } = require('../../database/models');
                    verifiedApproval = await SupervisorApproval.findOne({
                        where: {
                            id: String(approvalIdToVerify),
                            companyId: companyId || 'default',
                            used: false,
                            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                        },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                }
                const normalizedCashAct = String(verifiedApproval?.actionType || '').trim().toUpperCase();
                const allowedCashCloseActions = new Set([
                    'CLOSE_SHIFT',
                    'CASH_CLOSE_OVERRIDE',
                    'CASH_DISCREPANCY',
                    'POS_OVERRIDE',
                    'MOBILE_AUTHORIZATION',
                    'GENERAL_ACTION'
                ]);
                if (!verifiedApproval || !allowedCashCloseActions.has(normalizedCashAct)) {
                    const err = new Error(`El descuadre ($${diff}) supera el umbral de tolerancia permitido ($${tolerance}). Se requiere autorización verificada de Supervisor.`);
                    err.code = 'SUPERVISOR_AUTH_REQUIRED';
                    err.difference = diff;
                    err.tolerance = tolerance;
                    throw err;
                }
                const { SupervisorApproval } = require('../../database/models');
                const [consumedCount] = await SupervisorApproval.update(
                    { used: true, usedAt: now },
                    {
                        where: {
                            id: verifiedApproval.id,
                            companyId: companyId || 'default',
                            used: false,
                            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                        },
                        transaction: t
                    }
                );
                if (consumedCount !== 1) {
                    const err = new Error(`La aprobación de supervisor ya fue utilizada o expiró ($${diff}).`);
                    err.code = 'SUPERVISOR_AUTH_REQUIRED';
                    err.difference = diff;
                    err.tolerance = tolerance;
                    throw err;
                }
                closingData.supervisorId = verifiedApproval.approvedBy;
                closingData.supervisorName = verifiedApproval.metadata?.approverName || closingData.supervisorName;
                closingData.overrideBySupervisor = true;
            }

            if (isUserAdminOrSupervisor && !closingData.supervisorId) {
                closingData.supervisorId = reqUser.id;
                closingData.supervisorName = reqUser.name || reqUser.username;
                closingData.overrideBySupervisor = true;
            }

            let declaredCashUSD = 0;
            let declaredCashVES = 0;
            let declaredZelle = 0;
            let declaredCard = 0;
            let declaredMobile = 0;
            let declaredOtherUSD = 0;
            let declaredOtherVES = 0;

            Object.entries(normalizedFinalBreakdown).forEach(([id, val]) => {
                const k = id.toLowerCase();
                const isVes = isVesPaymentMethod(id, pMethods);
                const num = Number(val) || 0;
                if (k.includes('cash') || k === 'efectivo') {
                    if (isVes) declaredCashVES = precision.add([declaredCashVES, num]);
                    else declaredCashUSD = precision.add([declaredCashUSD, num]);
                } else if (k.includes('zelle')) {
                    declaredZelle = precision.add([declaredZelle, num]);
                } else if (k.includes('card') || k.includes('debit') || k.includes('debito') || k.includes('punto')) {
                    declaredCard = precision.add([declaredCard, num]);
                } else if (k.includes('mobile') || k.includes('movil') || k.includes('pago_movil') || k.includes('pagomovil')) {
                    declaredMobile = precision.add([declaredMobile, num]);
                } else {
                    // Métodos electrónicos/bancarios no efectivos (transferencias, biopago, fiado/crédito, binance, etc.)
                    if (isVes) declaredOtherVES = precision.add([declaredOtherVES, num]);
                    else declaredOtherUSD = precision.add([declaredOtherUSD, num]);
                }
            });

            let expectedCashUSD = 0;
            let expectedCashVES = 0;
            let expectedZelle = 0;
            let expectedCard = 0;
            let expectedMobile = 0;
            let expectedOtherUSD = 0;
            let expectedOtherVES = 0;

            Object.entries(expectedBreakdown).forEach(([id, val]) => {
                const k = id.toLowerCase();
                const isVes = isVesPaymentMethod(id, pMethods);
                const num = Number(val) || 0;
                if (k.includes('cash') || k === 'efectivo') {
                    if (isVes) expectedCashVES = precision.add([expectedCashVES, num]);
                    else expectedCashUSD = precision.add([expectedCashUSD, num]);
                } else if (k.includes('zelle')) {
                    expectedZelle = precision.add([expectedZelle, num]);
                } else if (k.includes('card') || k.includes('debit') || k.includes('debito') || k.includes('punto')) {
                    expectedCard = precision.add([expectedCard, num]);
                } else if (k.includes('mobile') || k.includes('movil') || k.includes('pago_movil') || k.includes('pagomovil')) {
                    expectedMobile = precision.add([expectedMobile, num]);
                } else {
                    if (isVes) expectedOtherVES = precision.add([expectedOtherVES, num]);
                    else expectedOtherUSD = precision.add([expectedOtherUSD, num]);
                }
            });

            const diffUSD = precision.round(precision.subtract(declaredCashUSD, expectedCashUSD));
            const diffVES = precision.round(precision.subtract(declaredCashVES, expectedCashVES));
            const diffZelle = precision.round(precision.subtract(declaredZelle, expectedZelle));
            const diffCard = precision.round(precision.subtract(declaredCard, expectedCard));
            const diffMobile = precision.round(precision.subtract(declaredMobile, expectedMobile));

            // Generate cryptographic hash and audit declaration
            const crypto = require('crypto');
            const payloadString = JSON.stringify({
                shiftId: currentShift.id, declaredCashUSD, declaredCashVES, declaredZelle, declaredCard, declaredMobile,
                expectedCashUSD, expectedCashVES, expectedZelle, expectedCard, expectedMobile
            });
            const hash = crypto.createHash('sha256').update(payloadString + Date.now().toString()).digest('hex');

            const allBucketsMatched = (
                Math.abs(diff) < 0.01 &&
                Math.abs(diffUSD) < 0.01 &&
                Math.abs(diffVES) < 0.01 &&
                Math.abs(diffZelle) < 0.01 &&
                Math.abs(diffCard) < 0.01 &&
                Math.abs(diffMobile) < 0.01
            );
            const closeAuditStatus = allBucketsMatched
                ? 'MATCH'
                : (Math.abs(diff) < 0.01 ? 'MISCLASSIFICATION' : 'MISMATCH');

            const digitalAuditNote = `[AUDIT: Zelle:${diffZelle.toFixed(2)}|Card:${diffCard.toFixed(2)}|MobileBs:${diffMobile.toFixed(2)}]`;
            const storedDeclarationNotes = notes ? `${notes} ${digitalAuditNote}` : digitalAuditNote;

            await CashDeclaration.create({
                id: generateRobustId(),
                shiftId: currentShift.id,
                userId: String(reqUser.id),
                companyId,
                declaredCashUSD,
                declaredCashVES,
                declaredZelle,
                declaredCard,
                declaredMobile,
                expectedCashUSD,
                expectedCashVES,
                expectedZelle,
                expectedCard,
                expectedMobile,
                differenceUSD: diffUSD,
                differenceVES: diffVES,
                hash,
                notes: storedDeclarationNotes
            }, { transaction: t });

            let itemsSummary = [];
            try {
                itemsSummary = await this.getShiftProductsSummary(currentShift, companyId, t);
            } catch (itErr) {
                console.warn('[CASH] itemsSummary calculation error:', itErr.message);
            }

            let zReportText = '';
            try {
                zReportText = this.generateZReportText(currentShift, {
                    userName: reqUser.name || reqUser.username,
                    auditStatus: closeAuditStatus,
                    declared: {
                        usd: declaredCashUSD,
                        ves: declaredCashVES,
                        zelle: declaredZelle,
                        card: declaredCard,
                        mobile: declaredMobile
                    },
                    expected: {
                        usd: expectedCashUSD,
                        ves: expectedCashVES,
                        zelle: expectedZelle,
                        card: expectedCard,
                        mobile: expectedMobile
                    },
                    differences: {
                        usd: diffUSD,
                        ves: diffVES,
                        zelle: diffZelle,
                        card: diffCard,
                        mobile: diffMobile
                    },
                    stats,
                    totalExpenses: tExp,
                    hash,
                    itemsSummary
                });
            } catch (zErr) {
                console.warn('[CASH] generateZReportText error:', zErr.message);
            }

            const salesSummary = {
                totalSales: stats.totalSalesAmount,
                cashSales: stats.cashSalesTotal,
                salesCount: stats.salesCount,
                totalIn: tIn,
                totalOut: tOut,
                totalExpenses: tExp,
                expectedBreakdown,
                physicalBreakdown: normalizedFinalBreakdown,
                declarationHash: hash,
                authorizedBySupervisor: closingData.supervisorName || closingData.supervisorId || null,
                itemsSummary
            };

            await currentShift.update({
                status: 'closed',
                closedAt: new Date().toISOString(),
                finalAmount: finalAmountInput,
                expectedAmount: precision.round(expectedAmountTotalUsd),
                expectedBreakdown, // RECONSTRUCTION: Save the native snapshot
                difference: diff,
                closingNotes: notes,
                exchangeRateAtClose: exchangeRate,
                salesSummary
            }, { transaction: t });

            // Sincronización Nube (Supabase 24/7): Encolar Cierre de Caja
            try {
                const SupabaseSyncService = require('../SupabaseSyncService');
                const cierrePayload = {
                    id: String(currentShift.id),
                    sucursal_id: String(currentShift.branchId || 'principal'),
                    cajero_nombre: String(reqUser.name || reqUser.username || currentShift.userName || 'Cajero'),
                    monto_apertura: Number(currentShift.initialAmount ?? currentShift.openingAmount ?? 0),
                    total_ventas: Number(expectedAmountTotalUsd || 0),
                    total_efectivo: Number(stats?.cashSalesTotal || 0),
                    total_electronico: Number(stats?.digitalSalesTotal || 0),
                    diferencia: Number(diff || 0),
                    fecha_apertura: currentShift.createdAt || new Date(),
                    fecha_cierre: new Date()
                };
                await SupabaseSyncService.queueEvent('cierres', currentShift.id, 'INSERT', cierrePayload, t);
            } catch (cierreSyncErr) {
                console.warn('[SyncOutbox] Advertencia encolando cierre de caja:', cierreSyncErr.message);
            }

            const logMsg = (closingData.supervisorId || closingData.supervisorAuthToken || closingData.overrideBySupervisor)
                ? `Caja cerrada con autorización de Supervisor (${closingData.supervisorName || closingData.supervisorId}). Diferencia: ${diff}`
                : `Caja cerrada. Diferencia: ${diff}`;
            await this._logAudit(reqUser, 'CASH_CLOSE', logMsg, currentShift.id, { expectedAmountTotal }, { finalAmountInput, authorizedBy: closingData.supervisorName || closingData.supervisorId || null, differences: { usd: diffUSD, ves: diffVES, zelle: diffZelle, card: diffCard, mobile: diffMobile } }, t);

            // VORTEX V2: Create an atomic movement for the auditor
            await CashMovement.create({
                id: `CLOSE-${currentShift.id}`,
                companyId,
                userId: String(userId),
                userName: currentShift.userName,
                amount: finalAmountInput,
                currency: 'USD',
                type: 'OUT',
                category: 'CLOSURE',
                reason: `Cierre de Turno - Caja ${currentShift.registerId || '1'}`,
                timestamp: new Date().toISOString(),
                shiftId: currentShift.id
            }, { transaction: t });

            if (Math.abs(diff) > tolerance || !allBucketsMatched) {
                try {
                    AlertService.triggerAlert({
                        type: allBucketsMatched ? 'financial_mismatch' : (Math.abs(diff) < 0.01 ? 'operational_error' : 'financial_mismatch'),
                        severity: Math.abs(diff) > tolerance ? 'high' : 'medium',
                        message: `Descuadre Financiero en Caja ${currentShift.registerId}: Diferencia neta de $${diff.toFixed(2)}`,
                        userId: reqUser.id,
                        companyId,
                        metadata: { 
                            shiftId: currentShift.id, 
                            netDifferenceUsd: diff,
                            details: { usd: diffUSD, ves: diffVES, zelle: diffZelle, card: diffCard, mobile: diffMobile }
                        }
                    }).catch(() => {});
                } catch (e) {}
            }

            return {
                shift: currentShift,
                ...currentShift.toJSON(),
                status: allBucketsMatched ? 'match' : (Math.abs(diff) < 0.01 ? 'misclassification' : 'mismatch'),
                difference: diff,
                differenceUSD: diffUSD,
                differenceVES: diffVES,
                differences: {
                    usd: diffUSD,
                    ves: diffVES,
                    zelle: diffZelle,
                    card: diffCard,
                    mobile: diffMobile
                },
                netDifferenceUsd: diff,
                zReportText,
                itemsSummary
            };
        });

        // 🛡️ Auto-Respaldo en Caliente con pg_dump (Asíncrono en background)
        if (sequelize.getDialect() === 'postgres' && closedShift) {
            try {
                const { autoBackupOnShiftClose } = require('../../utils/backupHelper');
                autoBackupOnShiftClose(closedShift.id);
            } catch (bErr) {}
        }

        // 📱 Alerta Ejecutiva WhatsApp al Dueño (Cierre de Caja Z)
        if (closedShift) {
            try {
                const OwnerNotificationService = require('../OwnerNotificationService');
                OwnerNotificationService.notifyShiftClose(reqUser.companyId, closedShift);
            } catch (notifErr) {
                console.warn('[NOTIF] Failed to send owner shift close alert:', notifErr.message);
            }
        }

        return closedShift;
    },

    /**
     * Cierre Ciego de Turno (Blind Closure)
     * VORTEX V2: Auditoría antifraude. Calcula diferencias contra el ledger y sella la declaración.
     */
    async closeShiftBlind(reqUser, closingData) {
        const { id: userId, companyId } = reqUser;
        const { shiftId, declaration = {}, notes = '' } = closingData;
        
        // 1. Calcular el total declarado por el cajero
        // Efectivo USD desde denominaciones
        const usdDenoms = declaration.usd || {};
        let declaredCashUSD = 0;
        ['100', '50', '20', '10', '5', '1', '0.50', '0.25', '0.10', '0.05', '0.01'].forEach(bill => {
            if (usdDenoms[bill]) {
                const subtotal = precision.multiply(Number(bill), Number(usdDenoms[bill]));
                declaredCashUSD = precision.add([declaredCashUSD, subtotal]);
            }
        });
        if (declaration.looseCoins) {
            declaredCashUSD = precision.add([declaredCashUSD, Number(declaration.looseCoins)]);
        }
        declaredCashUSD = precision.round(declaredCashUSD);

        const declaredCashVES = precision.round(Number(declaration.ves) || 0);
        const declaredZelle = precision.round(Number(declaration.zelle) || 0);
        const declaredCard = precision.round(Number(declaration.card) || 0);
        const declaredMobile = precision.round(Number(declaration.mobile) || 0);

        const result = await sequelize.transaction(async (t) => {
            const currentShift = await CashShift.findOne({
                where: { id: String(shiftId), companyId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (!currentShift) throw new Error('Turno de caja no encontrado.');
            if (currentShift.status !== 'open') throw new Error('El turno ya se encuentra cerrado.');

            // 🛡️ Load movements in separate query under the same transaction (avoids PostgreSQL outer join lock error)
            const movements = await CashMovement.findAll({
                where: { shiftId: currentShift.id },
                order: [['timestamp', 'ASC']],
                transaction: t
            });
            currentShift.CashMovements = movements;
            
            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const pMethods = userSettings.paymentMethods || [];
            const exchangeRate = Number(userSettings.exchangeRate) || 1.0;

            // Compute or retrieve shift stats under transaction
            const stats = await this.getShiftStats(
                currentShift.userId,
                currentShift.openedAt,
                companyId,
                currentShift.registerId,
                t
            );

            const activeMovements = movements.filter(m => !m.id || !m.id.startsWith('OPEN-'));
            const convertMovToUsd = (m) => {
                const amt = Number(m.amount) || 0;
                const mCurrency = (m.currency || 'USD').toUpperCase();
                return (mCurrency === 'VES' || mCurrency === 'BS') ? precision.divide(amt, exchangeRate) : amt;
            };
            const tIn = precision.add(activeMovements.filter(m => ['in', 'income'].includes(String(m.type || '').toLowerCase())).map(convertMovToUsd));
            const tOut = precision.add(activeMovements.filter(m => ['out'].includes(String(m.type || '').toLowerCase())).map(convertMovToUsd));
            const tExp = precision.add(activeMovements.filter(m => ['expense', 'out_expense'].includes(String(m.type || '').toLowerCase())).map(convertMovToUsd));

            // Reconstruir desglose esperado desde los métodos de pago nativos
            const safeParse = (val) => {
                if (!val) return {};
                if (typeof val === 'string') {
                    try {
                        const parsed = JSON.parse(val);
                        return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
                    } catch (e) { return {}; }
                }
                return val;
            };

            const expectedBreakdown = { ...safeParse(currentShift.initialBreakdown) };
            
            Object.entries(stats.paymentBreakdownNative || {}).forEach(([methodId, amount]) => {
                const canon = canonicalizePaymentMethodId(methodId);
                expectedBreakdown[canon] = precision.round(precision.add([expectedBreakdown[canon] || 0, amount]));
            });

            activeMovements.forEach(m => {
                applyMovementToBreakdown(m, expectedBreakdown, pMethods);
            });

            const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());

            if (isSingleMode) {
                Object.keys(expectedBreakdown).forEach(key => {
                    if (isVesPaymentMethod(key, pMethods)) {
                        delete expectedBreakdown[key];
                    }
                });
                if (Object.keys(expectedBreakdown).length === 0 && currentShift.initialAmount > 0) {
                    expectedBreakdown['cash'] = currentShift.initialAmount;
                }
            }

            // Agrupar el esperado por los "buckets" principales de la declaración
            let expectedCashUSD = 0;
            let expectedCashVES = 0;
            let expectedZelle = 0;
            let expectedCard = 0;
            let expectedMobile = 0;

            Object.entries(expectedBreakdown).forEach(([id, val]) => {
                const methodRaw = String(id || '').toLowerCase().trim();
                const methodObj = pMethods.find(pm => pm && String(pm.id).toLowerCase().trim() === methodRaw);
                const isMethodCash = methodObj?.type === 'CASH' || methodRaw.includes('cash') || methodRaw.includes('efectivo');
                const isMethodVes = isVesPaymentMethod(id, pMethods);

                if (isSingleMode && isMethodVes) return;

                if (methodRaw.includes('zelle') || (methodRaw.includes('transfer') && !isMethodVes)) {
                    expectedZelle = precision.add([expectedZelle, val]);
                } else if (methodRaw.includes('pago_movil') || methodRaw.includes('pagomovil') || methodRaw.includes('movil') || (methodRaw.includes('transfer') && isMethodVes)) {
                    expectedMobile = precision.add([expectedMobile, val]);
                } else if (methodObj?.type === 'DIGITAL' && (methodRaw === 'debit' || methodRaw.includes('punto') || methodRaw.includes('tarjeta') || methodRaw.includes('card') || methodRaw.includes('debito'))) {
                    expectedCard = precision.add([expectedCard, val]);
                } else if (isMethodCash) {
                    if (isMethodVes) {
                        expectedCashVES = precision.add([expectedCashVES, val]);
                    } else {
                        expectedCashUSD = precision.add([expectedCashUSD, val]);
                    }
                } else if (methodRaw === 'debit' || methodRaw.includes('punto') || methodRaw.includes('tarjeta') || methodRaw.includes('card') || methodRaw.includes('debito')) {
                    expectedCard = precision.add([expectedCard, val]);
                } else if (isMethodVes) {
                    expectedCashVES = precision.add([expectedCashVES, val]);
                } else if (methodRaw.includes('fiado') || methodRaw.includes('credit') || methodRaw.includes('credito') || methodObj?.type === 'CREDIT') {
                    // Ignorar fiado / credit en conteo de efectivo físico de gaveta
                } else {
                    expectedCashUSD = precision.add([expectedCashUSD, val]);
                }
            });

            expectedCashUSD = precision.round(expectedCashUSD);
            expectedCashVES = isSingleMode ? 0 : precision.round(expectedCashVES);
            expectedZelle = precision.round(expectedZelle);
            expectedCard = precision.round(expectedCard);
            expectedMobile = isSingleMode ? 0 : precision.round(expectedMobile);

            // 3. Diferencias (Efectivo + Digitales)
            const differenceUSD = precision.round(precision.subtract(declaredCashUSD, expectedCashUSD));
            const differenceVES = isSingleMode ? 0 : precision.round(precision.subtract(declaredCashVES, expectedCashVES));
            const diffZelle = precision.round(precision.subtract(declaredZelle, expectedZelle));
            const diffCard = precision.round(precision.subtract(declaredCard, expectedCard));
            const diffMobile = isSingleMode ? 0 : precision.round(precision.subtract(declaredMobile, expectedMobile));

            const rawTolerance = userSettings.cashDifferenceToleranceUsd;
            const tolerance = (rawTolerance !== undefined && rawTolerance !== null && !isNaN(Number(rawTolerance))) ? Number(rawTolerance) : 1.0;

            const isUserAdminOrSupervisor = ['admin', 'superadmin', 'owner', 'supervisor'].includes(String(reqUser?.role || '').toLowerCase());

            // Normalizar todas las diferencias (efectivo y digitales) a USD para auditoría estricta
            const rateAtClosure = exchangeRate > 0 ? exchangeRate : 1.0;
            const isCardInVes = !isSingleMode && isVesPaymentMethod('debit', pMethods);
            const diffVesInUsd = isSingleMode ? 0 : precision.normalizeToUsd(Math.abs(differenceVES), rateAtClosure);
            const diffMobileInUsd = isSingleMode ? 0 : precision.normalizeToUsd(Math.abs(diffMobile), rateAtClosure);
            const diffCardAbsUsd = isCardInVes ? precision.normalizeToUsd(Math.abs(diffCard), rateAtClosure) : Math.abs(diffCard);
            const diffCardSignedUsd = isCardInVes ? precision.divide(diffCard, rateAtClosure) : diffCard;
            const totalDifferenceUsdEquiv = precision.add([
                Math.abs(differenceUSD),
                diffVesInUsd,
                Math.abs(diffZelle),
                diffCardAbsUsd,
                diffMobileInUsd
            ]);
            const netDifferenceUsd = isSingleMode
                ? precision.add([differenceUSD, diffZelle, diffCard])
                : precision.add([
                    differenceUSD,
                    precision.divide(differenceVES, rateAtClosure),
                    diffZelle,
                    diffCardSignedUsd,
                    precision.divide(diffMobile, rateAtClosure)
                ]);

            if (totalDifferenceUsdEquiv > tolerance && !isUserAdminOrSupervisor) {
                const approvalIdToVerify = closingData.supervisorApprovalId || closingData.supervisorAuthToken;
                let verifiedApproval = null;
                const now = new Date();
                if (approvalIdToVerify) {
                    const { SupervisorApproval } = require('../../database/models');
                    verifiedApproval = await SupervisorApproval.findOne({
                        where: {
                            id: String(approvalIdToVerify),
                            companyId: companyId || 'default',
                            used: false,
                            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                        },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });
                }
                const normalizedCashAct = String(verifiedApproval?.actionType || '').trim().toUpperCase();
                const allowedCashCloseActions = new Set([
                    'CLOSE_SHIFT',
                    'CASH_CLOSE_OVERRIDE',
                    'CASH_DISCREPANCY',
                    'POS_OVERRIDE',
                    'MOBILE_AUTHORIZATION',
                    'GENERAL_ACTION'
                ]);
                if (!verifiedApproval || !allowedCashCloseActions.has(normalizedCashAct)) {
                    const detailsParts = [
                        `USD: $${differenceUSD.toFixed(2)}`,
                        ...(!isSingleMode && Math.abs(differenceVES) > 0 ? [`VES: Bs ${differenceVES.toFixed(2)}`] : []),
                        ...(Math.abs(diffZelle) > 0 ? [`Zelle: $${diffZelle.toFixed(2)}`] : []),
                        ...(Math.abs(diffCard) > 0 ? [`Tarjeta: $${diffCard.toFixed(2)}`] : []),
                        ...(!isSingleMode && Math.abs(diffMobile) > 0 ? [`Pago Móvil: Bs ${diffMobile.toFixed(2)}`] : [])
                    ];
                    const err = new Error(`El descuadre en cierre ciego (${detailsParts.join(', ')}) suma un impacto absoluto de $${totalDifferenceUsdEquiv.toFixed(2)} USD y supera el umbral permitido ($${tolerance}). Se requiere autorización verificada de Supervisor.`);
                    err.code = 'SUPERVISOR_AUTH_REQUIRED';
                    err.difference = differenceUSD;
                    err.differenceVES = differenceVES;
                    err.differences = { usd: differenceUSD, ves: differenceVES, zelle: diffZelle, card: diffCard, mobile: diffMobile };
                    err.totalDifferenceUsdEquiv = totalDifferenceUsdEquiv;
                    err.tolerance = tolerance;
                    throw err;
                }
                const { SupervisorApproval } = require('../../database/models');
                const [consumedCount] = await SupervisorApproval.update(
                    { used: true, usedAt: now },
                    {
                        where: {
                            id: verifiedApproval.id,
                            companyId: companyId || 'default',
                            used: false,
                            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gte]: now } }]
                        },
                        transaction: t
                    }
                );
                if (consumedCount !== 1) {
                    const vesMsg = !isSingleMode && Math.abs(differenceVES) > 0 ? ` y Bs ${Math.abs(differenceVES).toFixed(2)}` : '';
                    const err = new Error(`La aprobación de supervisor para cierre ciego ($${Math.abs(differenceUSD).toFixed(2)}${vesMsg}) ya fue utilizada o expiró.`);
                    err.code = 'SUPERVISOR_AUTH_REQUIRED';
                    err.difference = differenceUSD;
                    err.differenceVES = differenceVES;
                    err.differences = { usd: differenceUSD, ves: differenceVES, zelle: diffZelle, card: diffCard, mobile: diffMobile };
                    err.totalDifferenceUsdEquiv = totalDifferenceUsdEquiv;
                    err.tolerance = tolerance;
                    throw err;
                }
                closingData.supervisorId = verifiedApproval.approvedBy;
                closingData.supervisorName = verifiedApproval.metadata?.approverName || closingData.supervisorName;
                closingData.overrideBySupervisor = true;
            }

            if (isUserAdminOrSupervisor && !closingData.supervisorId) {
                closingData.supervisorId = reqUser.id;
                closingData.supervisorName = reqUser.name || reqUser.username;
                closingData.overrideBySupervisor = true;
            }

            // 4. Crear firma/hash inmutable (Pseudo-hash con crypto)
            const crypto = require('crypto');
            const payloadString = JSON.stringify({
                shiftId, declaredCashUSD, declaredCashVES, declaredZelle, declaredCard, declaredMobile,
                expectedCashUSD, expectedCashVES, expectedZelle, expectedCard, expectedMobile
            });
            const hash = crypto.createHash('sha256').update(payloadString + Date.now().toString()).digest('hex');

            // 5. Guardar Declaración (incluyendo auditoría de métodos digitales en notes)
            const digitalAuditNote = `[AUDIT: Zelle:${diffZelle.toFixed(2)}|Card:${diffCard.toFixed(2)}|MobileBs:${diffMobile.toFixed(2)}]`;
            const storedDeclarationNotes = notes ? `${notes} ${digitalAuditNote}` : digitalAuditNote;
            await CashDeclaration.create({
                id: generateRobustId(),
                shiftId,
                userId: String(reqUser.id),
                companyId,
                declaredCashUSD, declaredCashVES, declaredZelle, declaredCard, declaredMobile,
                expectedCashUSD, expectedCashVES, expectedZelle, expectedCard, expectedMobile,
                differenceUSD, differenceVES,
                hash,
                notes: storedDeclarationNotes
            }, { transaction: t });

            let itemsSummary = [];
            try {
                itemsSummary = await this.getShiftProductsSummary(currentShift, companyId, t);
            } catch (itErr) {
                console.warn('[CASH] itemsSummary calculation error in closeShiftBlind:', itErr.message);
            }

            // 6. Cerrar Turno
            const salesSummary = {
                totalSales: stats.totalSalesAmount,
                cashSales: stats.cashSalesTotal,
                salesCount: stats.salesCount,
                totalIn: tIn,
                totalOut: tOut,
                totalExpenses: tExp,
                expectedBreakdown,
                physicalBreakdown: {
                    cash: declaredCashUSD,
                    cash_bs: declaredCashVES,
                    debit: declaredCard,
                    pago_movil: declaredMobile,
                    zelle: declaredZelle
                },
                declarationHash: hash,
                itemsSummary
            };

            await currentShift.update({
                status: 'closed',
                closedAt: new Date().toISOString(),
                finalAmount: declaredCashUSD, // Referencial en USD
                expectedAmount: expectedCashUSD,
                difference: differenceUSD, // Solo guardamos USD base en Shift
                closingNotes: notes,
                exchangeRateAtClose: rateAtClosure,
                salesSummary
            }, { transaction: t });

            await this._logAudit(reqUser, 'CASH_CLOSE_BLIND', `Cierre Ciego. Diff USD: ${differenceUSD}, Diff VES: ${differenceVES}, Diff Zelle: ${diffZelle}, Diff Card: ${diffCard}, Diff Mobile: ${diffMobile}`, currentShift.id, null, {
                hash,
                differences: { usd: differenceUSD, ves: differenceVES, zelle: diffZelle, card: diffCard, mobile: diffMobile },
                totalDifferenceUsdEquiv,
                netDifferenceUsd
            }, t);

            // VORTEX V2: Create an atomic movement for the auditor
            await CashMovement.create({
                id: `CLOSE-${currentShift.id}`,
                companyId,
                userId: String(userId),
                userName: currentShift.userName,
                amount: declaredCashUSD,
                currency: 'USD',
                type: 'OUT',
                category: 'CLOSURE',
                reason: `Cierre Ciego de Turno - Caja ${currentShift.registerId || '1'}`,
                timestamp: new Date().toISOString(),
                shiftId: currentShift.id
            }, { transaction: t });

            // 7. Auditoría Inteligente: Descuadre Real vs Error de Clasificación (Efectivo + Digital)
            const totalAbsoluteError = precision.add([
                Math.abs(differenceUSD),
                Math.abs(differenceVES),
                Math.abs(diffZelle),
                Math.abs(diffCard),
                Math.abs(diffMobile)
            ]);

            let auditStatus = 'MATCH';
            let isMisclassification = false;

            if (totalAbsoluteError >= 0.01) {
                // Si el impacto neto normalizado en USD tiende a 0 pero hay diferencias por método, es error de clasificación
                isMisclassification = Math.abs(netDifferenceUsd) < 0.01;
                auditStatus = isMisclassification ? 'MISCLASSIFICATION' : 'MISMATCH';
            }

            const zReportText = this.generateZReportText(currentShift, {
                userName: reqUser.name || reqUser.username,
                auditStatus,
                declared: {
                    usd: declaredCashUSD,
                    ves: declaredCashVES,
                    zelle: declaredZelle,
                    card: declaredCard,
                    mobile: declaredMobile
                },
                expected: {
                    usd: expectedCashUSD,
                    ves: expectedCashVES,
                    zelle: expectedZelle,
                    card: expectedCard,
                    mobile: expectedMobile
                },
                differences: {
                    usd: differenceUSD,
                    ves: differenceVES,
                    zelle: diffZelle,
                    card: diffCard,
                    mobile: diffMobile
                },
                stats,
                totalExpenses: tExp,
                hash,
                itemsSummary
            });

            return {
                currentShift,
                differenceUSD,
                differenceVES,
                diffZelle,
                diffCard,
                diffMobile,
                totalAbsoluteError,
                isMisclassification,
                netDifferenceUsd,
                zReportText,
                itemsSummary
            };
        });

        // 8. NOTIFICACIONES Y ALERTAS (EJECUTADAS FUERA DE LA TRANSACCIÓN PARA EVITAR DEADLOCK EN SQLITE)
        if (result && result.totalAbsoluteError > 0) {
            try {
                AlertService.triggerAlert({
                    type: result.isMisclassification ? 'operational_error' : 'financial_mismatch',
                    severity: result.isMisclassification ? 'medium' : 'high',
                    message: result.isMisclassification 
                        ? `Error de Clasificación en Caja ${result.currentShift.registerId}: El total cuadra pero los métodos están cruzados.`
                        : `Descuadre Financiero en Caja ${result.currentShift.registerId}: Diferencia neta de $${result.netDifferenceUsd.toFixed(2)}`,
                    userId: reqUser.id,
                    companyId,
                    metadata: { 
                        shiftId, 
                        isMisclassification: result.isMisclassification, 
                        netDifferenceUsd: result.netDifferenceUsd,
                        details: { 
                            usd: result.differenceUSD, 
                            ves: result.differenceVES, 
                            zelle: result.diffZelle, 
                            card: result.diffCard, 
                            mobile: result.diffMobile 
                        }
                    }
                }).catch(alertErr => console.error('[AlertService] Error triggerAlert (blind close):', alertErr.message));
            } catch (e) {
                console.error('[AlertService] Failed to schedule triggerAlert:', e.message);
            }
        }

        // 🛡️ Auto-Respaldo en Caliente con pg_dump (Asíncrono en background)
        if (sequelize.getDialect() === 'postgres' && result?.currentShift) {
            try {
                const { autoBackupOnShiftClose } = require('../../utils/backupHelper');
                autoBackupOnShiftClose(result.currentShift.id);
            } catch (bErr) {
                console.warn('[CashService] Aviso en auto-respaldo post-cierre ciego:', bErr.message);
            }
        }

        // 📱 Alerta Ejecutiva WhatsApp al Dueño (Cierre Ciego Z)
        if (result?.currentShift) {
            try {
                const OwnerNotificationService = require('../OwnerNotificationService');
                OwnerNotificationService.notifyShiftClose(companyId, result);
            } catch (notifErr) {
                console.warn('[NOTIF] Failed to send owner blind shift close alert:', notifErr.message);
            }
        }

        return {
            shift: result.currentShift,
            status: result.totalAbsoluteError < 0.01 ? 'match' : (result.isMisclassification ? 'misclassification' : 'mismatch'),
            isMisclassification: Boolean(result.isMisclassification),
            netDifferenceUsd: precision.round(result.netDifferenceUsd || 0),
            differences: {
                usd: result.differenceUSD,
                ves: result.differenceVES,
                zelle: precision.round(result.diffZelle),
                card: precision.round(result.diffCard),
                mobile: precision.round(result.diffMobile)
            },
            zReportText: result.zReportText,
            itemsSummary: result.itemsSummary || []
        };
    },

    /**
     * Helper to log audits.
     */
    async _logAudit(reqUser, action, description, entityId, oldValue, newValue, transaction = null) {
        try {
            await AuditLog.create({
                id: generateRobustId(),
                userId: reqUser.id,
                companyId: reqUser.companyId,
                action,
                description,
                entityId,
                oldValue: oldValue ? JSON.stringify(oldValue) : null,
                newValue: newValue ? JSON.stringify(newValue) : null,
                timestamp: new Date().toISOString()
            }, { transaction });
        } catch (error) {
            console.error('Audit log error:', error);
        }
    },

    /**
     * Obtiene el resumen de auditoría para el dueño (Alertas + Rankings)
     */
    async getAuditSummary(reqUser) {
        const { companyId } = reqUser;
        const { CashDeclaration, CashShift, User } = require('../../database/models');

        // 1. Alertas Recientes (Cierres con descuadre o forzados)
        const alerts = await CashDeclaration.findAll({
            where: { companyId },
            include: [{ 
                model: CashShift, 
                as: 'Shift',
                attributes: ['status', 'closedAt', 'registerId']
            }],
            order: [['createdAt', 'DESC']],
            limit: 10
        });

        // 2. Ranking de Cajeros (Performance Financiera)
        const cashierStats = await CashDeclaration.findAll({
            where: { companyId },
            attributes: [
                'userId',
                [sequelize.fn('COUNT', sequelize.col('CashDeclaration.id')), 'totalShifts'],
                [sequelize.fn('SUM', sequelize.col('differenceUSD')), 'totalDiffUSD'],
                [sequelize.fn('SUM', sequelize.col('differenceVES')), 'totalDiffVES'],
                [sequelize.literal('SUM(CASE WHEN "differenceUSD" != 0 OR "differenceVES" != 0 THEN 1 ELSE 0 END)'), 'mismatchCount']
            ],
            group: ['userId'],
            raw: true
        });

        // Hidratar con nombres de usuario
        const users = await User.findAll({ 
            where: { id: cashierStats.map(s => s.userId) },
            attributes: ['id', 'name', 'username']
        });

        const ranking = await Promise.all(cashierStats.map(async (stat) => {
            const user = users.find(u => u.id === stat.userId);
            const riskInfo = await require('../AlertService').calculateUserRisk(stat.userId, companyId);
            
            return {
                ...stat,
                userName: user ? (user.name || user.username) : 'Desconocido',
                purityScore: precision.round(100 - (stat.mismatchCount / stat.totalShifts * 100)),
                risk: riskInfo
            };
        }));
        
        ranking.sort((a, b) => (Number(a.totalDiffUSD) || 0) - (Number(b.totalDiffUSD) || 0)); // Ordenar por quien "pierde" más (valores más negativos primero)

        // 3. Patrones y Insights
        const insights = this._detectAuditPatterns(alerts, ranking);

        return {
            alerts,
            ranking,
            insights
        };
    },

    /**
     * Lógica de detección de patrones de fraude
     */
    _detectAuditPatterns(alerts, ranking) {
        const insights = [];

        // Regla 1: Cajeros con pérdidas acumuladas altas
        ranking.forEach(r => {
            if (Number(r.totalDiffUSD) < -20) {
                insights.push({
                    type: 'danger',
                    title: 'Pérdida acumulada crítica',
                    message: `El cajero ${r.userName} ha acumulado una pérdida de $${Math.abs(r.totalDiffUSD).toFixed(2)}. Se recomienda auditoría de procesos.`
                });
            }
        });

        // Regla 2: Descuadres recurrentes (Purity Score bajo)
        ranking.forEach(r => {
            if (r.purityScore < 70 && r.totalShifts > 3) {
                insights.push({
                    type: 'warning',
                    title: 'Baja precisión recurrente',
                    message: `${r.userName} tiene descuadres en el ${100 - r.purityScore}% de sus turnos. Posible falta de capacitación o manipulación.`
                });
            }
        });

        // Regla 3: Cierres forzados recientes
        const forcedCount = alerts.filter(a => a.Shift?.status === 'forced_closed').length;
        if (forcedCount > 2) {
            insights.push({
                type: 'danger',
                title: 'Alerta de Cierres Forzados',
                message: `Se han detectado ${forcedCount} cierres forzados recientemente. Esto suele indicar intentos de evadir el conteo ciego.`
            });
        }

        return insights;
    },

    /**
     * Historial completo de auditoría paginado
     */
    async getAuditHistory(reqUser, page = 1, limit = 20) {
        const { companyId } = reqUser;
        const { CashDeclaration, CashShift } = require('../../database/models');
        const offset = (page - 1) * limit;

        const { rows, count } = await CashDeclaration.findAndCountAll({
            where: { companyId },
            include: [{ model: CashShift, as: 'Shift' }],
            order: [['createdAt', 'DESC']],
            limit,
            offset
        });

        return {
            items: rows,
            total: count,
            page,
            totalPages: Math.ceil(count / limit)
        };
    },
};
