const { CashShift, Sale, SaleItem, Product, CashMovement, AuditLog, CashDeclaration, Alert, User, Refund } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const { Op } = require('sequelize');
const precision = require('../utils/precision');
const AlertService = require('./AlertService');

// Helper to canonicalize payment method IDs across the system
function canonicalizePaymentMethodId(methodId) {
    if (!methodId) return 'cash';
    const key = String(methodId).toLowerCase().trim();
    if (['efectivo_bs', 'cash_bs', 'cash_ves', 'ves', 'bs'].includes(key)) return 'cash_bs';
    if (['efectivo_usd', 'cash_usd', 'cash'].includes(key)) return 'cash';
    if (['card', 'tarjeta', 'punto', 'punto_de_venta', 'debito', 'debit'].includes(key)) return 'debit';
    if (['pagomovil', 'mobile', 'pago_movil'].includes(key)) return 'pago_movil';
    if (['binance', 'binance_pay', 'binance_usdt', 'usdt'].includes(key)) return 'binance_usdt';
    if (['transferencia', 'transfer_bs', 'transfer'].includes(key)) return 'transfer';
    if (['credito', 'credit', 'fiado'].includes(key)) return 'fiado';
    return key;
}

// Helper to robustly detect if a payment method operates in VES (Bolívares)
function isVesPaymentMethod(methodId, pMethods = []) {
    if (!methodId) return false;
    const key = String(methodId).toLowerCase().trim();
    
    if (Array.isArray(pMethods) && pMethods.length > 0) {
        // Direct match
        let method = pMethods.find(pm => pm && String(pm.id).toLowerCase().trim() === key);
        
        // Alias match against configured payment methods
        if (!method) {
            if (['card', 'tarjeta', 'punto', 'debito', 'debit'].includes(key)) {
                method = pMethods.find(pm => pm && ['debit', 'debito', 'card', 'punto', 'tarjeta'].includes(String(pm.id).toLowerCase().trim()));
            } else if (['pagomovil', 'mobile', 'pago_movil'].includes(key)) {
                method = pMethods.find(pm => pm && ['pago_movil', 'pagomovil', 'mobile'].includes(String(pm.id).toLowerCase().trim()));
            } else if (['cash_ves', 'efectivo_bs', 'cash_bs'].includes(key)) {
                method = pMethods.find(pm => pm && ['cash_bs', 'cash_ves', 'efectivo_bs'].includes(String(pm.id).toLowerCase().trim()));
            }
        }

        if (method) {
            if (method.currency === 'USD' || method.currency === 'COP' || method.currency === '$') return false;
            if (method.currency === 'VES' || method.currency === 'BS' || method.defaultCurrency === 'VES' || method.defaultCurrency === 'BS') {
                return true;
            }
        }
    }

    const strictlyVesKeys = ['pago_movil', 'pagomovil', 'cash_bs', 'efectivo_bs', 'transfer_bs', 'biopago', 'ves', 'bs'];
    if (strictlyVesKeys.includes(key) || key.includes('_bs') || key.endsWith('bs') || key.includes('ves') || key.includes('movil')) {
        return true;
    }
    
    return false;
}

// Helper to safely and robustly apply cash movements to expectedBreakdown by currency and payment method
function applyMovementToBreakdown(m, expectedBreakdown, pMethods = []) {
    if (!m || (m.id && m.id.startsWith('OPEN-'))) return;

    const mCurrency = (m.currency || 'USD').toUpperCase();
    const isVes = (mCurrency === 'VES' || mCurrency === 'BS');
    let methodId = m.paymentMethodId;

    if (isVes) {
        if (!methodId || methodId === 'cash' || !isVesPaymentMethod(methodId, pMethods)) {
            methodId = expectedBreakdown['cash_bs'] !== undefined ? 'cash_bs' : (expectedBreakdown['efectivo_bs'] !== undefined ? 'efectivo_bs' : 'cash_bs');
        }
    } else {
        if (!methodId || isVesPaymentMethod(methodId, pMethods)) {
            methodId = 'cash';
        }
    }

    const amt = Number(m.amount) || 0;
    const normalizedType = String(m.type || '').toLowerCase();
    const isAdditive = (normalizedType === 'in' || normalizedType === 'income');
    
    if (expectedBreakdown[methodId] === undefined) {
        expectedBreakdown[methodId] = 0;
    }

    expectedBreakdown[methodId] = precision.round(
        isAdditive 
            ? precision.add([expectedBreakdown[methodId], amt]) 
            : precision.subtract(expectedBreakdown[methodId], amt)
    );
}


class CashService {
    /**
     * Get the currently open shift for a user, including recalculated stats.
     */
    async getCurrentShift(userId, companyId, registerId = '1') {
        let currentShift = null;

        // 1. Buscar por usuario específico si tiene un ID válido
        if (userId && userId !== 'sync-node' && userId !== 'lan-mobile-node' && userId !== 'offline-admin') {
            currentShift = await CashShift.findOne({
                where: { userId: String(userId), status: 'open', registerId: String(registerId) },
                order: [['openedAt', 'DESC']],
                include: [{ model: CashMovement, as: 'CashMovements' }]
            });

            if (!currentShift) {
                currentShift = await CashShift.findOne({
                    where: { userId: String(userId), status: 'open' },
                    order: [['openedAt', 'DESC']],
                    include: [{ model: CashMovement, as: 'CashMovements' }]
                });
            }
        }

        // 2. Si no se encontró por usuario, buscar por el registro físico de esta caja (Caja 1, terminal móvil, etc.)
        if (!currentShift && registerId) {
            const whereClause = { registerId: String(registerId), status: 'open' };
            if (companyId) whereClause.companyId = companyId;
            currentShift = await CashShift.findOne({
                where: whereClause,
                order: [['openedAt', 'DESC']],
                include: [{ model: CashMovement, as: 'CashMovements' }]
            });
        }

        if (!currentShift) return null;
        
        // ROBUST PARSE: Ensure JSON fields are objects (SQLite double-encoding protection)
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

        const stats = await this.getShiftStats(userId, currentShift.openedAt, companyId, registerId, null, null, currentShift.id, currentShift.branchId);
        const movements = currentShift.CashMovements || [];
        
        // RECONSTRUCTION: Start with initial breakdown (or 0 if missing)
        const rawInitial = safeParse(currentShift.initialBreakdown);
        const expectedBreakdown = {};
        Object.entries(rawInitial).forEach(([methodId, amt]) => {
            const canon = canonicalizePaymentMethodId(methodId);
            expectedBreakdown[canon] = precision.round(precision.add([expectedBreakdown[canon] || 0, Number(amt) || 0]));
        });
        
        // Add Sales from breakdown
        Object.entries(stats.paymentBreakdownNative || {}).forEach(([methodId, amount]) => {
            const canon = canonicalizePaymentMethodId(methodId);
            expectedBreakdown[canon] = precision.round(precision.add([expectedBreakdown[canon] || 0, Number(amount) || 0]));
        });

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const pMethods = userSettings.paymentMethods || [];

        // Add Movements safely using currency-aware helper
        movements.forEach(m => {
            applyMovementToBreakdown(m, expectedBreakdown, pMethods);
        });

        // Calculate expectedAmount total in USD for generic reference
        const exchangeRate = Number(userSettings.exchangeRate) || 1.0;
        const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());

        if (isSingleMode) {
            const isLegacyVesKey = (key) => isVesPaymentMethod(key, pMethods) || ['cash_bs', 'efectivo_bs', 'pago_movil', 'pagomovil', 'biopago', 'ves', 'bs'].includes(key) || (key === 'debit' && !pMethods.some(m => m.id === 'debit'));
            
            Object.keys(expectedBreakdown).forEach(key => {
                if (isLegacyVesKey(key)) {
                    delete expectedBreakdown[key];
                }
            });
            if (Object.keys(expectedBreakdown).length === 0 && currentShift.initialAmount > 0) {
                expectedBreakdown['cash'] = currentShift.initialAmount;
            }
            if (currentShift.initialBreakdown) {
                const cleanedInitial = { ...currentShift.initialBreakdown };
                let modified = false;
                Object.keys(cleanedInitial).forEach(key => {
                    if (isLegacyVesKey(key)) {
                        delete cleanedInitial[key];
                        modified = true;
                    }
                });
                if (Object.keys(cleanedInitial).length === 0 && currentShift.initialAmount > 0) {
                    cleanedInitial['cash'] = currentShift.initialAmount;
                    modified = true;
                }
                if (modified) {
                    currentShift.initialBreakdown = cleanedInitial;
                    currentShift.changed('initialBreakdown', true);
                    await currentShift.save();
                }
            }
        }

        const expectedAmountTotalUsd = precision.add(
            Object.entries(expectedBreakdown).map(([id, val]) => {
                const isLegacyVes = isSingleMode && (isVesPaymentMethod(id, pMethods) || (id === 'debit' && !pMethods.some(m => m.id === 'debit')));
                if (isLegacyVes) return 0;
                const isVes = isVesPaymentMethod(id, pMethods);
                return isVes ? precision.divide(val, exchangeRate) : val;
            })
        );

        // EXTRA CONTROLS: Calculate physical cash in drawer
        const expectedCashUsd = precision.add(
            Object.entries(expectedBreakdown).map(([id, val]) => {
                const method = pMethods.find(pm => pm.id === id);
                const isCash = method?.type === 'CASH' || id === 'cash' || id.includes('cash_usd') || id.includes('efectivo_usd');
                const isVes = isVesPaymentMethod(id, pMethods);
                if (isSingleMode && isVes) return 0;
                if (!isCash || isVes) return 0;
                return val;
            })
        );

        const expectedCashBs = isSingleMode ? 0 : precision.add(
            Object.entries(expectedBreakdown).map(([id, val]) => {
                const method = pMethods.find(pm => pm.id === id);
                const isCash = method?.type === 'CASH' || id === 'cash_bs' || id.includes('cash_bs') || id.includes('efectivo_bs');
                const isVes = isVesPaymentMethod(id, pMethods);
                if (isCash && isVes) return val;
                return 0;
            })
        );

        const drawerCashLimitUsd = Number(userSettings.maxCashDrawerThresholdUsd) || 100.0;
        const roundedCashUsd = precision.round(expectedCashUsd);
        const isDrawerLimitExceeded = roundedCashUsd >= drawerCashLimitUsd;
        const suggestedWithdrawalAmount = isDrawerLimitExceeded ? Math.max(0, precision.round(roundedCashUsd - (Number(currentShift.initialAmount) || 20.0), 2)) : 0;

        return {
            ...currentShift.toJSON(),
            cashSalesTotal: stats.cashSalesTotal,
            totalSalesAmount: stats.totalSalesAmount,
            totalSalesAmountNative: stats.totalSalesAmountNative,
            salesCount: stats.salesCount,
            expectedAmount: precision.round(expectedAmountTotalUsd),
            theoreticalTotalUsd: precision.round(expectedAmountTotalUsd),
            expectedCashUsd: roundedCashUsd,
            expectedCashBs: precision.round(expectedCashBs),
            drawerCashLimitUsd,
            isDrawerLimitExceeded,
            suggestedWithdrawalAmount,
            paymentBreakdown: stats.paymentBreakdown, // USD breakdown
            paymentBreakdownNative: stats.paymentBreakdownNative, // Native breakdown
            expectedBreakdown, // Native breakdown
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Get all active (open) shifts across the company for Admin live monitoring.
     */
    async getActiveShifts(companyId) {
        const openShifts = await CashShift.findAll({
            where: { status: 'open', companyId },
            order: [['openedAt', 'DESC']],
            include: [{ model: CashMovement, as: 'CashMovements' }]
        });

        const results = [];
        for (const shift of openShifts) {
            const stats = await this.getShiftStats(shift.userId, shift.openedAt, companyId, shift.registerId);
            const expectedAmountTotalUsd = precision.add([Number(shift.initialAmount) || 0, Number(stats.cashSalesTotal) || 0, Number(stats.movementsNetUsd) || 0]);
            
            results.push({
                id: shift.id,
                userId: shift.userId,
                userName: shift.userName,
                registerId: shift.registerId,
                registerName: shift.registerName || 'Caja Principal',
                openedAt: shift.openedAt,
                initialAmount: Number(shift.initialAmount) || 0,
                totalSalesAmount: stats.totalSalesAmount,
                cashSalesTotal: stats.cashSalesTotal,
                salesCount: stats.salesCount,
                expectedAmount: precision.round(expectedAmountTotalUsd),
                movementsCount: (shift.CashMovements || []).length
            });
        }

        const getRegisterSortRank = (reg) => {
            const name = (reg.registerName || '').toLowerCase();
            const user = (reg.userName || '').toLowerCase();
            if (name.includes('caja 1') || name === '1' || user.includes('manuel')) return 1;
            if (name.includes('caja 2') || name === '2' || user.includes('carmen')) return 2;
            if (name.includes('caja 3') || name === '3' || user.includes('adrian')) return 3;
            const match = name.match(/\d+/);
            if (match) return 10 + parseInt(match[0], 10);
            return 100;
        };

        results.sort((a, b) => {
            const rankA = getRegisterSortRank(a);
            const rankB = getRegisterSortRank(b);
            if (rankA !== rankB) return rankA - rankB;
            return (a.registerName || '').localeCompare(b.registerName || '', undefined, { numeric: true, sensitivity: 'base' });
        });

        return results;
    }

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
            const name = (reg.registerName || '').toLowerCase();
            const user = (reg.userName || '').toLowerCase();
            if (name.includes('caja 1') || name === '1' || user.includes('manuel')) return 1;
            if (name.includes('caja 2') || name === '2' || user.includes('carmen')) return 2;
            if (name.includes('caja 3') || name === '3' || user.includes('adrian')) return 3;
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
    }

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

        const totalWithdrawals = movements
            .filter(m => m.type === 'out' || m.type === 'expense')
            .reduce((acc, m) => acc + (Number(m.amount) || 0), 0);

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
    }

    /**
     * Cierre Forzado Remoto de Turno (Acción Administrativa)
     */
    async forceCloseShift(adminUser, shiftId, reason = 'Cierre administrativo forzado') {
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

            const currentShiftData = await this.getCurrentShift(shift.userId, adminUser.companyId, shift.registerId);
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
    }

    /**
     * Open a new shift.
     */
    async openShift(reqUser, openingData) {
        let { id: userId, companyId, name: userName } = reqUser || {};
        const initialAmountUsd = Number(openingData.amount) || 0;
        let rawInitialBreakdown = openingData.initialBreakdown || {};
        let initialBreakdown = {};
        Object.entries(rawInitialBreakdown).forEach(([k, v]) => {
            const canon = canonicalizePaymentMethodId(k);
            initialBreakdown[canon] = precision.round(precision.add([initialBreakdown[canon] || 0, Number(v) || 0]));
        });

        // 🛡️ ULTRA-DEFENSIVE USER RESOLUTION FOR POSTGRESQL FOREIGN KEY (CashShifts_userId_fkey)
        let resolvedUser = null;
        const candidateName = (openingData.userName || '').trim();
        const effectiveCompanyId = companyId || reqUser?.companyId || '2';

        // 1. Prioridad: Verificar primero el usuario autenticado (reqUser) en su empresa
        if (userId && !reqUser?.isSyncNode && userId !== 'sync-node' && userId !== 'lan-mobile-node' && userId !== 'offline-admin') {
            resolvedUser = await User.findOne({
                where: { id: String(userId), companyId: effectiveCompanyId }
            }) || await User.findByPk(String(userId));
        }

        // 2. Si se indicó un cajero responsable por nombre en pantalla distinto al usuario autenticado (ej: cambio de cajero)
        const isSameAsResolved = resolvedUser && candidateName && (
            String(resolvedUser.name || '').trim().toLowerCase() === candidateName.toLowerCase() ||
            String(resolvedUser.username || '').trim().toLowerCase() === candidateName.toLowerCase()
        );
        if (!isSameAsResolved && candidateName && candidateName !== 'sync-node' && candidateName !== 'Desconocido' && candidateName !== 'Terminal Móvil Sincronizada') {
            const userInCompany = await User.findOne({
                where: {
                    companyId: effectiveCompanyId,
                    [Op.or]: [
                        { name: candidateName },
                        { username: candidateName }
                    ]
                }
            });
            if (userInCompany) {
                resolvedUser = userInCompany;
            } else if (!resolvedUser) {
                resolvedUser = await User.findOne({
                    where: {
                        [Op.or]: [
                            { name: candidateName },
                            { username: candidateName }
                        ]
                    }
                });
            }
        }

        // 3. Si openingData especificó un userId explícito
        if (!resolvedUser && openingData.userId && openingData.userId !== 'sync-node' && openingData.userId !== 'lan-mobile-node') {
            resolvedUser = await User.findOne({
                where: { id: String(openingData.userId), companyId: effectiveCompanyId }
            }) || await User.findByPk(String(openingData.userId));
        }

        if (!resolvedUser && effectiveCompanyId && effectiveCompanyId !== 'default') {
            resolvedUser = await User.findOne({
                where: { companyId: effectiveCompanyId, status: 'active' }
            });
        }

        if (!resolvedUser) {
            resolvedUser = await User.findOne({ order: [['createdAt', 'ASC']] });
        }

        if (resolvedUser) {
            userId = resolvedUser.id;
            companyId = resolvedUser.companyId || companyId || '2';
            userName = openingData.userName || resolvedUser.name || resolvedUser.username || userName;
        } else {
            userId = '2';
            companyId = '2';
        }

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const pMethods = userSettings.paymentMethods || [];
        const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());

        if (isSingleMode) {
            initialBreakdown = { ...initialBreakdown };
            Object.keys(initialBreakdown).forEach(key => {
                if (isVesPaymentMethod(key, pMethods) || ['cash_bs', 'efectivo_bs', 'pago_movil', 'pagomovil', 'biopago', 'ves', 'bs'].includes(key) || (key === 'debit' && !pMethods.some(m => m.id === 'debit'))) {
                    delete initialBreakdown[key];
                }
            });
            if (Object.keys(initialBreakdown).length === 0 && initialAmountUsd > 0) {
                initialBreakdown['cash'] = initialAmountUsd;
            }
        }

        const registerId = openingData.registerId || '1';
        let registerName = (openingData.registerName || openingData.registerDisplayName || '').trim();
        if (!registerName) {
            const uName = (userName || '').toLowerCase();
            if (uName.includes('manuel') || userId === '2' || userId === 'admin') registerName = 'Caja 1';
            else if (uName.includes('carmen')) registerName = 'Caja 2';
            else if (uName.includes('adrian')) registerName = 'Caja 3';
            else registerName = `Caja ${registerId || '1'}`;
        }

        // 🛡️ TRANSACCIÓN ATÓMICA DE APERTURA CON BLOQUEO ANTI-DUPLICADOS
        try {
            return await sequelize.transaction(async (t) => {
                // 1. Validar que la caja física no esté ya en uso por otro cajero o el mismo usuario
                const activeRegisterShift = await CashShift.findOne({
                    where: { registerId: String(registerId), status: 'open', companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (activeRegisterShift) {
                    const shiftAgeHours = (Date.now() - new Date(activeRegisterShift.openedAt).getTime()) / (1000 * 60 * 60);
                    if (shiftAgeHours > 12) {
                        console.log(`[CASH] Auto-closing stale shift ${activeRegisterShift.id} on register ${registerId} (${shiftAgeHours.toFixed(1)}h old)`);
                        await activeRegisterShift.update({
                            status: 'closed',
                            closedAt: new Date().toISOString(),
                            closingNotes: '[AUTO-CIERRE] Cierre automático de turno anterior (>12h)'
                        }, { transaction: t });
                    } else if (String(activeRegisterShift.userId) === String(userId)) {
                        throw new Error(`Ya tienes un turno de caja abierto en esta caja (${registerName})`);
                    } else {
                        throw new Error(`La caja "${registerName}" (#${registerId}) ya se encuentra abierta por el cajero ${activeRegisterShift.userName || 'otro usuario'}. Debe realizarse el cierre de ese turno antes de abrir uno nuevo.`);
                    }
                }

                // 2. Validar que este cajero no tenga otro turno abierto en otra caja
                const userActiveShift = await CashShift.findOne({
                    where: { userId: String(userId), registerId: String(registerId), status: 'open', companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (userActiveShift) {
                    const shiftAgeHours = (Date.now() - new Date(userActiveShift.openedAt).getTime()) / (1000 * 60 * 60);
                    if (shiftAgeHours > 12) {
                        console.log(`[CASH] Auto-closing stale shift ${userActiveShift.id} for user ${userId} (${shiftAgeHours.toFixed(1)}h old)`);
                        await userActiveShift.update({
                            status: 'closed',
                            closedAt: new Date().toISOString(),
                            closingNotes: '[AUTO-CIERRE] Cierre automático de turno anterior (>12h)'
                        }, { transaction: t });
                    } else {
                        throw new Error(`Ya tienes un turno de caja abierto en "${userActiveShift.registerName || `Caja ${userActiveShift.registerId}`}". Debes cerrarlo antes de abrir otra caja.`);
                    }
                }

                let allowedCategories = [];
                if (Array.isArray(openingData.allowedCategories)) {
                    allowedCategories = openingData.allowedCategories.map(c => String(c).trim()).filter(Boolean);
                } else if (typeof openingData.allowedCategories === 'string' && openingData.allowedCategories.trim()) {
                    try {
                        const parsed = JSON.parse(openingData.allowedCategories);
                        if (Array.isArray(parsed)) allowedCategories = parsed.map(c => String(c).trim()).filter(Boolean);
                        else allowedCategories = [openingData.allowedCategories.trim()];
                    } catch {
                        allowedCategories = [openingData.allowedCategories.trim()];
                    }
                }

                let allowedProducts = [];
                if (Array.isArray(openingData.allowedProducts)) {
                    allowedProducts = openingData.allowedProducts;
                } else if (typeof openingData.allowedProducts === 'string' && openingData.allowedProducts.trim()) {
                    try {
                        const parsed = JSON.parse(openingData.allowedProducts);
                        if (Array.isArray(parsed)) allowedProducts = parsed;
                    } catch {}
                }

                const newShift = await CashShift.create({
                    id: generateRobustId(),
                    openedAt: new Date().toISOString(),
                    status: 'open',
                    userId: String(userId),
                    companyId,
                    userName: openingData.userName || userName || 'Desconocido',
                    initialAmount: initialAmountUsd,
                    initialBreakdown,
                    expectedAmount: initialAmountUsd,
                    finalAmount: 0,
                    openingNotes: openingData.notes || '',
                    movements: [],
                    salesSummary: {},
                    registerId: openingData.registerId || '1',
                    registerName: registerName,
                    allowedCategories,
                    allowedProducts
                }, { transaction: t });

                await this._logAudit({ id: userId, companyId }, 'CASH_OPEN', `Caja abierta con base de ${initialAmountUsd}`, newShift.id, null, { initialAmount: initialAmountUsd, initialBreakdown }, t);

                // VORTEX V2: Create an atomic movement for the auditor
                try {
                    await CashMovement.create({
                        id: `OPEN-${newShift.id}`,
                        companyId,
                        userId: String(userId),
                        userName: newShift.userName,
                        amount: initialAmountUsd,
                        currency: 'USD',
                        type: 'in',
                        category: 'OPENING',
                        reason: `Apertura de Turno - Caja ${newShift.registerId || '1'}`,
                        timestamp: newShift.openedAt,
                        shiftId: newShift.id
                    }, { transaction: t });
                } catch (e) {
                    console.error('[VORTEX] Failed to log opening movement:', e.message);
                }

                return newShift;
            });
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError' || (error.message && (error.message.includes('idx_unique_open_shift_per_register') || error.message.includes('unique constraint') || error.message.includes('UNIQUE constraint')))) {
                throw new Error(`La caja "${registerName}" (#${registerId}) ya tiene un turno abierto. Por favor, actualiza la pantalla.`);
            }
            throw error;
        }
    }

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
                if (approvalIdToVerify) {
                    const { SupervisorApproval } = require('../database/models');
                    verifiedApproval = await SupervisorApproval.findOne({
                        where: { id: String(approvalIdToVerify), companyId: companyId || 'default' },
                        transaction: t
                    });
                }
                if (!verifiedApproval || verifiedApproval.used) {
                    const err = new Error(`El descuadre ($${diff}) supera el umbral de tolerancia permitido ($${tolerance}). Se requiere autorización verificada de Supervisor.`);
                    err.code = 'SUPERVISOR_AUTH_REQUIRED';
                    err.difference = diff;
                    err.tolerance = tolerance;
                    throw err;
                }
                await verifiedApproval.update({ used: true }, { transaction: t });
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

            try {
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
                    notes
                }, { transaction: t });
            } catch (declErr) {
                console.warn('[CASH] CashDeclaration creation failed or model uninitialized:', declErr.message);
            }

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
                    auditStatus: (diff === 0 && diffVES === 0) ? 'MATCH' : 'MISMATCH',
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
                const SupabaseSyncService = require('./SupabaseSyncService');
                const cierrePayload = {
                    id: String(currentShift.id),
                    sucursal_id: String(currentShift.branchId || 'principal'),
                    cajero_nombre: String(reqUser.name || reqUser.username || currentShift.userName || 'Cajero'),
                    monto_apertura: Number(currentShift.openingAmount || 0),
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
            await this._logAudit(reqUser, 'CASH_CLOSE', logMsg, currentShift.id, { expectedAmountTotal }, { finalAmountInput, authorizedBy: closingData.supervisorName || closingData.supervisorId || null }, t);

            // VORTEX V2: Create an atomic movement for the auditor
            try {
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
            } catch (e) {
                console.error('[VORTEX] Failed to log closure movement:', e.message);
            }

            if (Math.abs(diff) > tolerance) {
                try {
                    AlertService.triggerAlert({
                        type: 'financial_mismatch',
                        severity: 'high',
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
                status: (diff === 0 && diffVES === 0) ? 'match' : 'mismatch',
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
                const { autoBackupOnShiftClose } = require('../utils/backupHelper');
                autoBackupOnShiftClose(closedShift.id);
            } catch (bErr) {}
        }

        // 📱 Alerta Ejecutiva WhatsApp al Dueño (Cierre de Caja Z)
        if (closedShift) {
            try {
                const OwnerNotificationService = require('./OwnerNotificationService');
                OwnerNotificationService.notifyShiftClose(reqUser.companyId, closedShift);
            } catch (notifErr) {
                console.warn('[NOTIF] Failed to send owner shift close alert:', notifErr.message);
            }
        }

        return closedShift;
    }

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

            // 3. Diferencias
            const differenceUSD = precision.round(precision.subtract(declaredCashUSD, expectedCashUSD));
            const differenceVES = isSingleMode ? 0 : precision.round(precision.subtract(declaredCashVES, expectedCashVES));

            const rawTolerance = userSettings.cashDifferenceToleranceUsd;
            const tolerance = (rawTolerance !== undefined && rawTolerance !== null && !isNaN(Number(rawTolerance))) ? Number(rawTolerance) : 1.0;

            const isUserAdminOrSupervisor = ['admin', 'superadmin', 'owner', 'supervisor'].includes(String(reqUser?.role || '').toLowerCase());

            // Normalizar diferencia de Bolívares a USD para evaluar tolerancia global
            const diffVesInUsd = isSingleMode ? 0 : precision.normalizeToUsd(Math.abs(differenceVES), exchangeRate);
            const totalDifferenceUsdEquiv = precision.add([Math.abs(differenceUSD), diffVesInUsd]);

            if (totalDifferenceUsdEquiv > tolerance && !isUserAdminOrSupervisor) {
                const approvalIdToVerify = closingData.supervisorApprovalId || closingData.supervisorAuthToken;
                let verifiedApproval = null;
                if (approvalIdToVerify) {
                    const { SupervisorApproval } = require('../database/models');
                    verifiedApproval = await SupervisorApproval.findOne({
                        where: { id: String(approvalIdToVerify), companyId: companyId || 'default' },
                        transaction: t
                    });
                }
                if (!verifiedApproval || verifiedApproval.used) {
                    const vesMsg = !isSingleMode && Math.abs(differenceVES) > 0 ? ` y Bs ${Math.abs(differenceVES).toFixed(2)}` : '';
                    const err = new Error(`El descuadre en cierre ciego ($${Math.abs(differenceUSD).toFixed(2)}${vesMsg}) equivale a $${totalDifferenceUsdEquiv.toFixed(2)} USD y supera el umbral permitido ($${tolerance}). Se requiere autorización verificada de Supervisor.`);
                    err.code = 'SUPERVISOR_AUTH_REQUIRED';
                    err.difference = differenceUSD;
                    err.differenceVES = differenceVES;
                    err.totalDifferenceUsdEquiv = totalDifferenceUsdEquiv;
                    err.tolerance = tolerance;
                    throw err;
                }
                await verifiedApproval.update({ used: true }, { transaction: t });
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

            // 5. Guardar Declaración
            await CashDeclaration.create({
                id: generateRobustId(),
                shiftId,
                userId: String(reqUser.id),
                companyId,
                declaredCashUSD, declaredCashVES, declaredZelle, declaredCard, declaredMobile,
                expectedCashUSD, expectedCashVES, expectedZelle, expectedCard, expectedMobile,
                differenceUSD, differenceVES,
                hash,
                notes
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

            const rateAtClosure = Number(userSettings.exchangeRate) || 1.0;

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

            await this._logAudit(reqUser, 'CASH_CLOSE_BLIND', `Cierre Ciego. Diff USD: ${differenceUSD}, Diff VES: ${differenceVES}`, currentShift.id, null, { hash, differences: { usd: differenceUSD, ves: differenceVES } }, t);

            // VORTEX V2: Create an atomic movement for the auditor
            try {
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
            } catch (e) {
                console.error('[VORTEX] Failed to log blind closure movement:', e.message);
            }

            // 7. Auditoría Inteligente: Descuadre Real vs Error de Clasificación
            const diffZelle = precision.subtract(declaredZelle, expectedZelle);
            const diffCard = precision.subtract(declaredCard, expectedCard);
            const diffMobile = precision.subtract(declaredMobile, expectedMobile);
            
            // Suma de valores absolutos para detectar CUALQUIER discrepancia
            const totalAbsoluteError = precision.add([
                Math.abs(differenceUSD),
                Math.abs(differenceVES),
                Math.abs(diffZelle),
                Math.abs(diffCard),
                Math.abs(diffMobile)
            ]);

            let auditStatus = 'MATCH';
            let isMisclassification = false;
            let netDifferenceUsd = 0;

            if (totalAbsoluteError > 0) {
                // Calculamos la diferencia neta total (normalizada a USD)
                netDifferenceUsd = precision.add([
                    differenceUSD,
                    precision.divide(differenceVES, rateAtClosure),
                    diffZelle,
                    diffCard,
                    diffMobile
                ]);

                // Si la suma neta es 0 (o casi 0), es un error de clasificación
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
                const { autoBackupOnShiftClose } = require('../utils/backupHelper');
                autoBackupOnShiftClose(result.currentShift.id);
            } catch (bErr) {}
        }

        // 📱 Alerta Ejecutiva WhatsApp al Dueño (Cierre Ciego Z)
        if (result?.currentShift) {
            try {
                const OwnerNotificationService = require('./OwnerNotificationService');
                OwnerNotificationService.notifyShiftClose(companyId, result);
            } catch (notifErr) {
                console.warn('[NOTIF] Failed to send owner blind shift close alert:', notifErr.message);
            }
        }

        return {
            shift: result.currentShift,
            status: (result.differenceUSD === 0 && result.differenceVES === 0) ? 'match' : 'mismatch',
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
    }

    /**
     * Extrae el resumen de productos vendidos en el turno con sus existencias restantes en inventario.
     * Soporta tanto presentaciones (cartones, cajas, bultos) como unidades base.
     */
    async getShiftProductsSummary(shiftOrId, companyId, transaction = null) {
        try {
            let shift = shiftOrId;
            if (typeof shiftOrId === 'string' || typeof shiftOrId === 'number') {
                shift = await CashShift.findOne({
                    where: { id: String(shiftOrId), companyId: String(companyId) },
                    transaction
                });
            }
            if (!shift) return [];

            // Si ya tiene el resumen persistido en salesSummary y el turno está cerrado, devolverlo
            const safeParse = (val) => {
                if (!val) return null;
                if (typeof val === 'string') {
                    try { return JSON.parse(val); } catch (_) { return null; }
                }
                return typeof val === 'object' ? val : null;
            };
            const parsedSummary = safeParse(shift.salesSummary);
            if (shift.status === 'closed' && Array.isArray(parsedSummary?.itemsSummary) && parsedSummary.itemsSummary.length > 0) {
                return parsedSummary.itemsSummary;
            }

            const salesWhere = {
                companyId: String(companyId),
                status: { [Op.notIn]: ['cancelled'] }
            };

            if (shift.registerId && shift.userId) {
                salesWhere[Op.or] = [
                    { registerId: String(shift.registerId) },
                    { userId: String(shift.userId), registerId: { [Op.or]: [String(shift.registerId), null, ''] } }
                ];
            } else if (shift.registerId) {
                salesWhere.registerId = String(shift.registerId);
            } else if (shift.userId) {
                salesWhere.userId = String(shift.userId);
            }

            if (shift.closedAt) {
                salesWhere.date = { [Op.between]: [shift.openedAt, shift.closedAt] };
            } else {
                salesWhere.date = { [Op.gte]: shift.openedAt };
            }

            const sales = await Sale.findAll({
                where: salesWhere,
                attributes: ['id'],
                transaction,
                raw: true
            });

            if (!sales || sales.length === 0) return [];
            const saleIds = sales.map(s => s.id);

            const saleItems = await SaleItem.findAll({
                where: { saleId: { [Op.in]: saleIds } },
                transaction,
                raw: true
            });

            if (!saleItems || saleItems.length === 0) return [];

            // Agrupar por producto y presentación
            const grouped = new Map();
            for (const item of saleItems) {
                const pId = item.productId || item.name;
                const pres = item.presentationName ? item.presentationName.trim() : null;
                const key = `${pId}___${pres || 'BASE'}`;
                const qty = Number(item.quantity) || 0;
                const subtotal = Number(item.subtotal) || 0;

                if (!grouped.has(key)) {
                    grouped.set(key, {
                        productId: item.productId,
                        name: item.name,
                        presentationName: pres,
                        category: item.category || 'General',
                        factorConversion: Number(item.factorConversion) || 1,
                        quantitySold: 0,
                        totalAmount: 0,
                        currentStock: 0,
                        stockInPresentations: 0
                    });
                }
                const g = grouped.get(key);
                g.quantitySold = precision.round(precision.add([g.quantitySold, qty]), 2);
                g.totalAmount = precision.round(precision.add([g.totalAmount, subtotal]), 2);
            }

            // Consultar existencias actuales de cada producto
            const productIds = [...new Set([...grouped.values()].map(g => g.productId).filter(Boolean))];
            if (productIds.length > 0) {
                const products = await Product.findAll({
                    where: { id: { [Op.in]: productIds }, companyId: String(companyId) },
                    attributes: ['id', 'name', 'stock', 'stockQuantity', 'category', 'isSoldByWeight'],
                    transaction,
                    raw: true
                });

                const productMap = new Map();
                products.forEach(p => productMap.set(p.id, p));

                for (const g of grouped.values()) {
                    if (g.productId && productMap.has(g.productId)) {
                        const p = productMap.get(g.productId);
                        const rawStock = Number(p.stockQuantity ?? p.stock ?? 0);
                        g.currentStock = precision.round(rawStock, 2);
                        if (g.factorConversion > 1) {
                            g.stockInPresentations = precision.round(rawStock / g.factorConversion, 2);
                        } else {
                            g.stockInPresentations = precision.round(rawStock, 2);
                        }
                    }
                }
            }

            const result = Array.from(grouped.values()).sort((a, b) => {
                if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '');
                return (a.name || '').localeCompare(b.name || '');
            });

            return result;
        } catch (err) {
            console.error('[CashService] Error in getShiftProductsSummary:', err);
            return [];
        }
    }

    /**
     * Genera la estructura visual del reporte Z en texto plano (ESC/POS compatible)
     */
    generateZReportText(shift, data) {
        const { userName, declared, expected, differences, stats, totalExpenses, hash, auditStatus, itemsSummary } = data;
        const now = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
        
        const line = (label, value) => `${label.padEnd(22)}${String(value).padStart(10)}`;
        const separator = "--------------------------------";
        const doubleSeparator = "================================";

        let t = "";
        t += `${doubleSeparator}\n`;
        t += "        CIERRE DE CAJA        \n";
        t += `${doubleSeparator}\n\n`;

        t += `Caja:    ${shift.registerId || '01'}\n`;
        t += `Cajero:  ${userName}\n`;
        t += `Turno:   ${shift.id.substring(0, 8)}\n`;
        t += `Fecha:   ${now}\n\n`;

        t += `${separator}\n`;
        t += "APERTURA\n";
        t += `${separator}\n`;
        t += line("Fondo Inicial:", `$${Number(shift.initialAmount || 0).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "VENTAS DEL TURNO\n";
        t += `${separator}\n`;
        t += line("Efectivo USD:", `$${Number(stats.cashSalesTotal || 0).toFixed(2)}\n`);
        
        // Desglose digital si aplica
        Object.entries(expected).forEach(([method, val]) => {
            if (method === 'usd' || method === 'ves') return;
            if (val === 0) return;
            const label = method.charAt(0).toUpperCase() + method.slice(1);
            const prefix = (method === 'zelle') ? '$' : 'Bs';
            t += line(`${label}:`, `${prefix} ${Number(val).toFixed(2)}\n`);
        });
        t += "\n";

        t += `${separator}\n`;
        t += "GASTOS DE CAJA\n";
        t += `${separator}\n`;
        t += line("Total Gastos:", `$${Number(totalExpenses).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "MONTO ESPERADO\n";
        t += `${separator}\n`;
        t += line("USD Esperado:", `$${Number(expected.usd).toFixed(2)}\n`);
        t += line("VES Esperado:", `Bs ${Number(expected.ves).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "DECLARACIÓN CAJERO\n";
        t += `${separator}\n`;
        t += line("USD Declarado:", `$${Number(declared.usd).toFixed(2)}\n`);
        t += line("VES Declarado:", `Bs ${Number(declared.ves).toFixed(2)}\n\n`);

        t += `${separator}\n`;
        t += "DIFERENCIA\n";
        t += `${separator}\n`;
        const diffUSD = differences.usd;
        const diffVES = differences.ves;
        t += line("USD:", `${diffUSD >= 0 ? '+' : ''}${diffUSD.toFixed(2)}\n`);
        t += line("VES:", `${diffVES >= 0 ? '+' : ''}Bs ${diffVES.toFixed(2)}\n\n`);

        if (auditStatus === 'MISCLASSIFICATION') {
            t += `${doubleSeparator}\n`;
            t += "  ! ERROR DE CLASIFICACIÓN !  \n";
            t += " Dinero completo, métodos mal  \n";
            t += " seleccionados durante el día. \n";
            t += `${doubleSeparator}\n\n`;
        } else if (auditStatus === 'MISMATCH') {
            t += `${doubleSeparator}\n`;
            t += "  ! DIFERENCIA DETECTADA !  \n";
            t += `${doubleSeparator}\n\n`;
        } else {
            t += `${doubleSeparator}\n`;
            t += "      CUADRE PERFECTO       \n";
            t += `${doubleSeparator}\n\n`;
        }

        t += `${separator}\n`;
        t += "HASH DE AUDITORÍA\n";
        t += `${separator}\n`;
        t += `${hash.substring(0, 32)}...\n\n`;

        if (Array.isArray(itemsSummary) && itemsSummary.length > 0) {
            t += `${separator}\n`;
            t += "MERCANCÍA VENDIDA Y STOCK\n";
            t += `${separator}\n`;
            let totalSold = 0;
            itemsSummary.forEach(item => {
                const pres = item.presentationName ? ` (${item.presentationName})` : '';
                const nameStr = `${item.name}${pres}`.substring(0, 32);
                const sold = Number(item.quantitySold || 0).toFixed(2);
                const stock = Number(item.stockInPresentations !== undefined ? item.stockInPresentations : (item.currentStock || 0)).toFixed(2);
                totalSold += Number(item.quantitySold || 0);

                t += `${nameStr}\n`;
                t += `    Vend: ${sold.padEnd(8)} | Quedan: ${stock}\n`;
            });
            t += `${separator}\n`;
            t += `Total Renglones: ${itemsSummary.length}\n`;
            t += `Total Unidades: ${totalSold.toFixed(2)}\n\n`;
        }

        t += `${separator}\n`;
        t += "FIRMA CAJERO: _______________\n\n";
        t += "FIRMA SUPERVISOR: ___________\n\n";

        t += `${doubleSeparator}\n`;
        t += "    FIN DEL REPORTE (Z)       \n";
        t += `${doubleSeparator}\n`;

        return t;
    }

    /**
     * Centralized logic to calculate statistics for a given shift.
     */
    async getShiftStats(userId, openedAt, companyId, registerId = '1', transaction = null, closedAt = null, shiftId = null, branchId = null) {
        const salesWhere = {
            companyId: String(companyId),
            status: { [Op.notIn]: ['cancelled'] }
        };

        if (registerId && userId) {
            salesWhere[Op.or] = [
                { registerId: String(registerId) },
                { userId: String(userId), registerId: { [Op.or]: [String(registerId), null, ''] } }
            ];
        } else if (registerId) {
            salesWhere.registerId = String(registerId);
        } else if (userId) {
            salesWhere.userId = String(userId);
        }

        if (closedAt) {
            salesWhere.date = { [Op.between]: [openedAt, closedAt] };
        } else {
            salesWhere.date = { [Op.gte]: openedAt };
        }

        const sales = await Sale.findAll({
            where: salesWhere,
            attributes: ['id', 'total', 'paymentMethods', 'paymentMethod', 'exchangeRate'],
            transaction
        });

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const pMethods = userSettings.paymentMethods || [];

        let cashSalesTotalUsd = 0;
        let totalSalesAmountUsd = 0;
        const paymentBreakdownUsd = {};
        const paymentBreakdownNative = {}; // NEW: Native currency tracking

        sales.forEach((s) => {
            if (!s) return;
            totalSalesAmountUsd = precision.round(precision.add([totalSalesAmountUsd, s.total || 0]));

            const pms = s.paymentMethods && Array.isArray(s.paymentMethods) && s.paymentMethods.length > 0
                ? s.paymentMethods
                : [{ method: s.paymentMethod || 'cash', amount: s.total, currency: 'USD' }];

            pms.forEach(pm => {
                const methodRaw = (pm.method || 'cash').toLowerCase().trim();
                const foundMethod = pMethods.find(m => 
                    m.id.toLowerCase() === methodRaw || m.name.toLowerCase() === methodRaw ||
                    (methodRaw === 'efectivo' && m.id === 'cash')
                );
                
                const methodKey = foundMethod ? foundMethod.id : methodRaw;
                let amountNative = Number(pm.amount) || 0;
                
                const pmCurrency = String(pm.currency || foundMethod?.currency || '').toUpperCase();

                // Detección exhaustiva por código de moneda, helpers y nomenclaturas habituales
                const isVes = pmCurrency === 'VES' || 
                              pmCurrency === 'BS' ||
                              (typeof isVesPaymentMethod === 'function' && (
                                  isVesPaymentMethod(pm.id || pm.method, pMethods) || 
                                  isVesPaymentMethod(methodKey, pMethods)
                              )) ||
                              methodKey.includes('ves') || 
                              methodKey.includes('_bs') ||
                              methodKey.includes('bolivar') ||
                              methodKey.includes('pago_movil') ||
                              methodKey.includes('pagomovil') ||
                              methodKey.includes('punto') ||
                              methodKey.includes('biopago');

                const rate = Number(s.exchangeRate) > 0 ? Number(s.exchangeRate) : 1.0;

                // Conversión segura con motor de precisión decimal
                const isUsdt = pmCurrency === 'USDT' || methodKey === 'binance_usdt' || methodRaw.includes('binance') || methodRaw.includes('usdt');
                let amountInUsd = 0;
                if (isUsdt) {
                    if (Number(pm.convertedAmountUsd) > 0) {
                        amountInUsd = Number(pm.convertedAmountUsd);
                    } else {
                        const cryptoRate = Number(pm.cryptoRate || userSettings.binanceRate || 0);
                        if (cryptoRate > 0 && rate > 0) {
                            amountInUsd = precision.divide(precision.multiply(amountNative, cryptoRate), rate);
                        } else {
                            amountInUsd = amountNative;
                        }
                    }
                } else if (isVes) {
                    amountInUsd = precision.divide(amountNative, rate);
                } else {
                    amountInUsd = amountNative;
                }

                paymentBreakdownUsd[methodKey] = precision.round(precision.add([paymentBreakdownUsd[methodKey] || 0, amountInUsd]), 4);
                paymentBreakdownNative[methodKey] = precision.round(precision.add([paymentBreakdownNative[methodKey] || 0, amountNative]), 4);

                // CASH SALES TRACKING: Only methods of type 'CASH' or known cash patterns
                if (foundMethod?.type === 'CASH' || foundMethod?.id.includes('cash') || foundMethod?.name?.toLowerCase().includes('efectivo') || methodRaw.includes('cash') || methodRaw.includes('efectivo')) {
                    cashSalesTotalUsd = precision.round(precision.add([cashSalesTotalUsd, amountInUsd]), 4);
                }
            });
        });

        // DEDUCIR DEVOLUCIONES ESTRICTAMENTE VINCULADAS A ESTA CAJA / TURNO (ANTI-DESCUADRE)
        try {
            const refundsWhere = {
                companyId: String(companyId),
                status: 'completed'
            };
            if (closedAt) {
                refundsWhere.createdAt = { [Op.between]: [openedAt, closedAt] };
            } else {
                refundsWhere.createdAt = { [Op.gte]: openedAt };
            }

            const refunds = await Refund.findAll({
                where: refundsWhere,
                include: [{
                    model: Sale,
                    as: 'Sale',
                    required: false,
                    attributes: ['id', 'registerId', 'branchId', 'userId']
                }],
                attributes: ['id', 'amount', 'paymentMethods', 'userId', 'createdAt'],
                transaction
            }).catch(() => []);

            const matchedRefunds = refunds.filter(rf => {
                if (rf.Sale) {
                    if (registerId && String(rf.Sale.registerId) !== String(registerId)) return false;
                    if (branchId && String(rf.Sale.branchId) !== String(branchId)) return false;
                    return true;
                }
                return userId ? String(rf.userId) === String(userId) : true;
            });

            matchedRefunds.forEach(rf => {
                const rfTotal = Number(rf.amount) || 0;
                totalSalesAmountUsd = precision.round(precision.subtract(totalSalesAmountUsd, rfTotal));
                const rfMethods = Array.isArray(rf.paymentMethods) && rf.paymentMethods.length > 0 
                    ? rf.paymentMethods 
                    : [{ method: 'cash', amount: rfTotal, currency: 'USD' }];

                rfMethods.forEach(rpm => {
                    const methodRaw = (rpm.method || 'cash').toLowerCase().trim();
                    const foundMethod = pMethods.find(m => 
                        m.id.toLowerCase() === methodRaw || 
                        m.name.toLowerCase() === methodRaw || 
                        (methodRaw === 'efectivo' && m.id === 'cash')
                    );
                    const methodKey = foundMethod ? foundMethod.id : canonicalizePaymentMethodId(methodRaw);
                    const amt = Number(rpm.amount) || 0;
                    const isVes = rpm.currency === 'VES' || rpm.currency === 'BS' || isVesPaymentMethod(methodKey, pMethods);
                    const amtUsd = isVes 
                        ? (Number(userSettings.exchangeRate) > 0 ? precision.divide(amt, Number(userSettings.exchangeRate)) : amt)
                        : amt;

                    paymentBreakdownUsd[methodKey] = precision.round(precision.subtract(paymentBreakdownUsd[methodKey] || 0, amtUsd), 4);
                    paymentBreakdownNative[methodKey] = precision.round(precision.subtract(paymentBreakdownNative[methodKey] || 0, amt), 4);

                    if (foundMethod?.type === 'CASH' || methodKey === 'cash' || methodKey.includes('cash_usd') || methodRaw.includes('efectivo')) {
                        cashSalesTotalUsd = precision.round(precision.subtract(cashSalesTotalUsd, amtUsd), 4);
                    }
                });
            });
        } catch (_refundErr) {
            console.warn('[CashService] Aviso al deducir devoluciones en turno:', _refundErr.message);
        }

        const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());
        if (isSingleMode) {
            const isLegacyVesKey = (k) => isVesPaymentMethod(k, pMethods) || ['cash_bs', 'efectivo_bs', 'pago_movil', 'pagomovil', 'biopago', 'ves', 'bs'].includes(k) || (k === 'debit' && !pMethods.some(m => m.id === 'debit'));
            Object.keys(paymentBreakdownUsd).forEach(k => {
                if (isLegacyVesKey(k)) delete paymentBreakdownUsd[k];
            });
            Object.keys(paymentBreakdownNative).forEach(k => {
                if (isLegacyVesKey(k)) delete paymentBreakdownNative[k];
            });
        }

        const totalSalesAmountNative = precision.round(precision.add(Object.values(paymentBreakdownNative)));

        return {
            salesCount: sales.length,
            totalSalesAmount: precision.round(totalSalesAmountUsd),
            totalSalesAmountNative,
            cashSalesTotal: precision.round(cashSalesTotalUsd),
            paymentBreakdown: Object.fromEntries(
                Object.entries(paymentBreakdownUsd).map(([k, v]) => [k, precision.round(v)])
            ),
            paymentBreakdownNative: Object.fromEntries(
                Object.entries(paymentBreakdownNative).map(([k, v]) => [k, precision.round(v)])
            )
        };
    }

    /**
     * Get summary of the last closed shift for a register/company
     * (used to suggest initial cash fund when opening a new shift)
     */
    async getLastClosedShift(companyId, registerId = '1') {
        const lastShift = await CashShift.findOne({
            where: { companyId, registerId: String(registerId), status: 'closed' },
            order: [['closedAt', 'DESC']]
        });
        if (!lastShift) return null;

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

        const salesSummary = safeParse(lastShift.salesSummary);
        const physicalBreakdown = salesSummary.physicalBreakdown || {};

        return {
            id: lastShift.id,
            userName: lastShift.userName,
            closedAt: lastShift.closedAt,
            finalAmount: Number(lastShift.finalAmount) || 0,
            difference: Number(lastShift.difference) || 0,
            physicalBreakdown,
            exchangeRateAtClose: Number(lastShift.exchangeRateAtClose) || 1
        };
    }

    /**
     * Add a cash movement (in/out/expense/drop).
     */
    async addMovement(reqUser, movementData) {
        const { type, amount, reason, paymentMethodId, currency, category } = movementData;
        const cleanAmount = precision.round(Number(amount) || 0, 4);

        if (cleanAmount <= 0) {
            throw new Error('El monto del movimiento debe ser un valor numérico estrictamente mayor a cero.');
        }

        const registerId = movementData.registerId || '1';
        return await sequelize.transaction(async (t) => {
            let currentShift = null;

            // 1. Si se proveyó shiftId explícito, buscar y bloquear por id directo
            if (movementData.shiftId) {
                currentShift = await CashShift.findOne({
                    where: { id: String(movementData.shiftId), status: 'open', companyId: reqUser.companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            // 2. Buscar por usuario y caja
            if (!currentShift) {
                currentShift = await CashShift.findOne({
                    where: { userId: String(reqUser.id), status: 'open', companyId: reqUser.companyId, registerId: String(registerId) },
                    order: [['openedAt', 'DESC']],
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            // 3. Fallback: buscar cualquier turno abierto del usuario
            if (!currentShift && (!registerId || registerId === '1' || registerId === 'default')) {
                currentShift = await CashShift.findOne({
                    where: { userId: String(reqUser.id), status: 'open', companyId: reqUser.companyId },
                    order: [['openedAt', 'DESC']],
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });
            }

            if (!currentShift) throw new Error('No hay turno de caja abierto');

            const assignedCategory = category || (type === 'in' ? 'INCOME' : type === 'expense' ? 'EXPENSE' : 'DRAWER_DROP');
            const userName = reqUser.name || reqUser.username || 'Usuario';
            const mCurrency = (currency || 'USD').toUpperCase();

            let finalPaymentMethodId = paymentMethodId;
            if (!finalPaymentMethodId || finalPaymentMethodId === 'cash') {
                if (mCurrency === 'VES' || mCurrency === 'BS') {
                    finalPaymentMethodId = 'cash_bs';
                } else {
                    finalPaymentMethodId = 'cash';
                }
            }

            const movement = await CashMovement.create({
                id: generateRobustId(),
                shiftId: currentShift.id,
                userId: String(reqUser.id),
                userName: userName,
                companyId: reqUser.companyId,
                type: type || 'out',
                category: assignedCategory,
                amount: precision.round(Number(amount) || 0, 4),
                currency: mCurrency,
                paymentMethodId: finalPaymentMethodId,
                reason: reason || '',
                timestamp: new Date().toISOString()
            }, { transaction: t });

            if (assignedCategory === 'DRAWER_DROP' || type === 'out') {
                await this._logAudit(reqUser, 'CASH_DROP', `Retiro de efectivo (${mCurrency} ${amount}) de caja ${currentShift.registerId || '1'}: ${reason}`, currentShift.id, null, { amount, currency: mCurrency, category: assignedCategory, reason }, t);
            }

            return movement;
        });
    }

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
    }
    /**
     * Obtiene el resumen de auditoría para el dueño (Alertas + Rankings)
     */
    async getAuditSummary(reqUser) {
        const { companyId } = reqUser;
        const { CashDeclaration, CashShift, User } = require('../database/models');

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
            const riskInfo = await require('./AlertService').calculateUserRisk(stat.userId, companyId);
            
            return {
                ...stat,
                userName: user ? (user.name || user.username) : 'Desconocido',
                purityScore: precision.round(100 - (stat.mismatchCount / stat.totalShifts * 100)),
                risk: riskInfo
            };
        }));
        
        ranking.sort((a, b) => b.totalDiffUSD - a.totalDiffUSD); // Ordenar por quien "pierde" más

        // 3. Patrones y Insights
        const insights = this._detectAuditPatterns(alerts, ranking);

        return {
            alerts,
            ranking,
            insights
        };
    }

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
    }

    /**
     * Historial completo de auditoría paginado
     */
    async getAuditHistory(reqUser, page = 1, limit = 20) {
        const { companyId } = reqUser;
        const { CashDeclaration, CashShift } = require('../database/models');
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
    }
    /**
     * Genera el Reporte Diario de Auditoría (Resumen para el Dueño)
     */
    async generateDailyAuditReport(reqUser, dateStr) {
        const { companyId } = reqUser;
        const { CashDeclaration, CashShift, User } = require('../database/models');
        const { Op } = require('sequelize');
        const puppeteer = require('puppeteer');

        const baseDate = dateStr ? new Date(`${String(dateStr).slice(0, 10)}T00:00:00`) : new Date();
        const startOfDay = new Date(new Date(baseDate).setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(new Date(baseDate).setHours(23, 59, 59, 999)).toISOString();

        // 1. Obtener todas las declaraciones del día
        const declarations = await CashDeclaration.findAll({
            where: {
                companyId,
                createdAt: { [Op.between]: [startOfDay, endOfDay] }
            },
            include: [{ model: CashShift, as: 'Shift' }],
            order: [['createdAt', 'ASC']]
        });

        if (declarations.length === 0) {
            throw new Error('No hay cierres registrados para la fecha seleccionada.');
        }

        // Resolver nombres de cajeros para el reporte PDF
        const userIds = [...new Set(declarations.map(d => d.userId).filter(Boolean))];
        const usersList = userIds.length > 0
            ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name', 'username'] })
            : [];
        const userNameById = new Map(usersList.map(u => [String(u.id), u.name || u.username || `Cajero ${u.id}`]));

        // 2. Calcular Métricas Agregadas
        const totalLossUSD = precision.add(declarations.map(d => Number(d.differenceUSD) < 0 ? Number(d.differenceUSD) : 0));
        const totalOverageUSD = precision.add(declarations.map(d => Number(d.differenceUSD) > 0 ? Number(d.differenceUSD) : 0));
        const netBalanceUSD = precision.add([totalLossUSD, totalOverageUSD]);

        // 3. Agrupar por Cajero
        const cashierMap = {};
        declarations.forEach(d => {
            if (!cashierMap[d.userId]) {
                const resolvedName = d.userName || d.Shift?.cashierName || userNameById.get(String(d.userId)) || `Cajero #${d.userId}`;
                cashierMap[d.userId] = { name: resolvedName, loss: 0, shifts: 0, matches: 0 };
            }
            cashierMap[d.userId].loss = precision.add([cashierMap[d.userId].loss, d.differenceUSD]);
            cashierMap[d.userId].shifts++;
            if (Number(d.differenceUSD) === 0 && Number(d.differenceVES) === 0) {
                cashierMap[d.userId].matches++;
            }
        });

        // 4. Determinar Semáforo
        let statusColor = '#10b981'; // Green
        let statusText = 'OPERACIÓN LIMPIA';
        if (netBalanceUSD < 0) {
            statusColor = '#ef4444'; // Red
            statusText = 'PÉRDIDA DETECTADA';
        } else if (netBalanceUSD > 0 || declarations.some(d => d.Shift?.status === 'forced_closed')) {
            statusColor = '#f59e0b'; // Amber
            statusText = 'RIESGO OPERATIVO';
        }

        // 5. Construir HTML para Puppeteer
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; color: #1e293b; padding: 40px; }
                .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; }
                .status-badge { 
                    display: inline-block; padding: 10px 20px; border-radius: 12px; 
                    color: white; font-weight: 900; text-transform: uppercase; letter-spacing: 2px;
                    background-color: ${statusColor};
                }
                .section { margin-bottom: 30px; }
                .section-title { font-size: 10px; font-weight: 900; color: #64748b; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px; border-left: 4px solid #3b82f6; padding-left: 10px; }
                .metric-card { background: #f8fafc; padding: 20px; border-radius: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
                .metric-label { font-weight: 700; color: #475569; }
                .metric-value { font-size: 20px; font-weight: 900; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th { text-align: left; font-size: 10px; text-transform: uppercase; color: #64748b; padding: 10px; border-bottom: 1px solid #e2e8f0; }
                td { padding: 12px 10px; font-size: 13px; border-bottom: 1px solid #f1f5f9; font-weight: 600; }
                .loss { color: #ef4444; }
                .match { color: #10b981; }
                .footer { margin-top: 50px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 20px; }
                .insight { background: #fffbeb; border: 1px solid #fef3c7; padding: 15px; border-radius: 12px; margin-bottom: 10px; font-size: 13px; color: #92400e; font-weight: 600; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="status-badge">${statusText}</div>
                <h1 style="margin-top: 20px; font-weight: 900; letter-spacing: -1px;">REPORTE DIARIO DE AUDITORÍA</h1>
                <p style="font-weight: 700; color: #64748b;">${new Date(startOfDay).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

            <div class="section">
                <div class="section-title">Resultado General</div>
                <div class="metric-card">
                    <span class="metric-label">Balance Neto del Día</span>
                    <span class="metric-value ${netBalanceUSD < 0 ? 'loss' : 'match'}">${netBalanceUSD < 0 ? '-' : ''}$${Math.abs(netBalanceUSD).toFixed(2)}</span>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Análisis de Cajeros</div>
                <table>
                    <thead>
                        <tr>
                            <th>Cajero</th>
                            <th>Turnos</th>
                            <th>Precisión</th>
                            <th style="text-align: right;">Diferencia</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.values(cashierMap).map(c => `
                            <tr>
                                <td>${c.name}</td>
                                <td>${c.shifts}</td>
                                <td>${Math.round((c.matches / c.shifts) * 100)}%</td>
                                <td style="text-align: right;" class="${c.loss < 0 ? 'loss' : c.loss > 0 ? 'match' : ''}">
                                    ${c.loss > 0 ? '+' : ''}$${c.loss.toFixed(2)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <div class="section-title">Historial de Cierres</div>
                <table>
                    <thead>
                        <tr>
                            <th>Hora</th>
                            <th>Turno</th>
                            <th>Estado</th>
                            <th style="text-align: right;">Diferencia</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${declarations.map(d => `
                            <tr>
                                <td>${new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                <td>#${d.shiftId.substring(0, 8)}</td>
                                <td>${d.Shift?.status === 'forced_closed' ? '⚠️ FORZADO' : 'CERRADO'}</td>
                                <td style="text-align: right;" class="${Number(d.differenceUSD) < 0 ? 'loss' : Number(d.differenceUSD) > 0 ? 'match' : ''}">
                                    $${Number(d.differenceUSD).toFixed(2)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="footer">
                <p>Generado automáticamente por Isaac POS - Capa de Auditoría Antifraude</p>
                <p>Hash de Integridad del Día: ${(declarations[declarations.length - 1].hash || 'IMMUTABLE-LEDGER-SEAL').substring(0, 32)}</p>
            </div>
        </body>
        </html>
        `;

        // 6. Generar PDF con Puppeteer utilizando Chrome/Edge disponible
        const fs = require('fs');
        const candidatePaths = [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        ].filter(Boolean);

        let execPath = null;
        for (const p of candidatePaths) {
            try {
                if (fs.existsSync(p)) {
                    execPath = p;
                    break;
                }
            } catch (e) {}
        }

        const launchOptions = { 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
        };
        if (execPath) {
            launchOptions.executablePath = execPath;
        }

        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await browser.close();

        return Buffer.from(pdfBuffer);
    }
}

module.exports = new CashService();
