const { CashShift, Sale, CashMovement, AuditLog, CashDeclaration, Alert } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId, readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const { Op } = require('sequelize');
const precision = require('../utils/precision');
const AlertService = require('./AlertService');

// Helper to robustly detect if a payment method operates in VES (Bolívares)
function isVesPaymentMethod(methodId, pMethods = []) {
    if (!methodId) return false;
    const key = String(methodId).toLowerCase().trim();
    
    if (Array.isArray(pMethods)) {
        const method = pMethods.find(pm => pm && String(pm.id).toLowerCase().trim() === key);
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


class CashService {
    /**
     * Get the currently open shift for a user, including recalculated stats.
     */
    async getCurrentShift(userId, companyId, registerId = '1') {
        let currentShift = await CashShift.findOne({
            where: { userId: String(userId), status: 'open', companyId, registerId: String(registerId) },
            order: [['openedAt', 'DESC']],
            include: [{ model: CashMovement, as: 'CashMovements' }]
        });

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

        const stats = await this.getShiftStats(userId, currentShift.openedAt, companyId, registerId);
        const movements = currentShift.CashMovements || [];
        
        // RECONSTRUCTION: Start with initial breakdown (or 0 if missing)
        const expectedBreakdown = { ...safeParse(currentShift.initialBreakdown) };
        
        // Add Sales from breakdown
        Object.entries(stats.paymentBreakdownNative || {}).forEach(([methodId, amount]) => {
            expectedBreakdown[methodId] = precision.round(precision.add([expectedBreakdown[methodId] || 0, amount]));
        });

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const pMethods = userSettings.paymentMethods || [];

        // Add Movements
        movements.forEach(m => {
            if (m.id && m.id.startsWith('OPEN-')) return;

            const methodId = m.paymentMethodId;
            if (methodId && expectedBreakdown[methodId] !== undefined) {
                 expectedBreakdown[methodId] = precision.round(m.type === 'in' ? precision.add([expectedBreakdown[methodId] || 0, m.amount]) : precision.subtract(expectedBreakdown[methodId] || 0, m.amount));
            } else {
                // Fallback: If no methodId, use currency trait to guess (old logic)
                const mCurrency = m.currency || 'USD';
                const targetMethod = pMethods.find(pm => 
                    (pm.id.toLowerCase().includes('cash') || pm.id.toLowerCase().includes('efectivo')) &&
                    (mCurrency === 'VES' ? isVesPaymentMethod(pm.id, pMethods) : !isVesPaymentMethod(pm.id, pMethods))
                ) || { id: 'cash' };

                expectedBreakdown[targetMethod.id] = precision.round(m.type === 'in' ? precision.add([expectedBreakdown[targetMethod.id] || 0, m.amount]) : precision.subtract(expectedBreakdown[targetMethod.id] || 0, m.amount));
            }
        });

        // Calculate expectedAmount total in USD for generic reference
        const exchangeRate = Number(userSettings.exchangeRate) || 1.0;
        const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama', 'colombia'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());

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
                const isCash = method?.type === 'CASH' || id.includes('cash') || id === 'cash';
                const isVes = isVesPaymentMethod(id, pMethods);
                if (isSingleMode && isVes) return 0;
                if (!isCash || isVes) return 0;
                return val;
            })
        );

        const expectedCashBs = isSingleMode ? 0 : precision.add(
            Object.entries(expectedBreakdown).map(([id, val]) => {
                const method = pMethods.find(pm => pm.id === id);
                const isCash = method?.type === 'CASH' || id.includes('cash');
                const isVes = isVesPaymentMethod(id, pMethods);
                if (isCash && isVes) return val;
                return 0;
            })
        );

        return {
            ...currentShift.toJSON(),
            cashSalesTotal: stats.cashSalesTotal,
            totalSalesAmount: stats.totalSalesAmount,
            salesCount: stats.salesCount,
            expectedAmount: precision.round(expectedAmountTotalUsd),
            expectedCashUsd: precision.round(expectedCashUsd),
            expectedCashBs: precision.round(expectedCashBs),
            paymentBreakdown: stats.paymentBreakdown, // USD breakdown
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
            const expectedAmountTotalUsd = precision.add([Number(shift.initialAmount) || 0, stats.cashSalesTotal, stats.movementsNetUsd]);
            
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
        return results;
    }

    /**
     * Open a new shift.
     */
    async openShift(reqUser, openingData) {
        const { id: userId, companyId, name: userName } = reqUser;
        const initialAmountUsd = Number(openingData.amount) || 0;
        let initialBreakdown = openingData.initialBreakdown || {}; // NEW: { cash_usd: 10, cash_bs: 500 }

        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const pMethods = userSettings.paymentMethods || [];
        const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama', 'colombia'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());

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
        const registerName = openingData.registerName || openingData.registerDisplayName || 'Caja Principal';

        const existingShift = await CashShift.findOne({
            where: { userId: String(userId), status: 'open', companyId, registerId: String(registerId) }
        });

        if (existingShift) {
            throw new Error(`Ya tienes un turno de caja abierto en esta caja (${registerName})`);
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
            registerName: registerName
        });

        await this._logAudit(reqUser, 'CASH_OPEN', `Caja abierta con base de ${initialAmountUsd}`, newShift.id, null, { initialAmount: initialAmountUsd, initialBreakdown });

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
            });
        } catch (e) {
            console.error('[VORTEX] Failed to log opening movement:', e.message);
        }



        return newShift;
    }

    /**
     * Close an open shift.
     */
    async closeShift(reqUser, closingData) {
        const { id: userId, companyId } = reqUser;
        const { finalBreakdown = {}, notes = '' } = closingData;

        const registerId = closingData.registerId || '1';

        return await sequelize.transaction(async (t) => {
            let currentShift = await CashShift.findOne({
                where: { userId: String(userId), status: 'open', companyId, registerId: String(registerId) },
                order: [['openedAt', 'DESC']],
                include: [{ model: CashMovement, as: 'CashMovements' }],
                transaction: t
            });

            if (!currentShift) {
                // FALLBACK: User has an open shift but registerId (device ID) mismatched
                currentShift = await CashShift.findOne({
                    where: { userId: String(userId), status: 'open', companyId },
                    order: [['openedAt', 'DESC']],
                    include: [{ model: CashMovement, as: 'CashMovements' }],
                    transaction: t
                });

                if (currentShift) {
                    console.log(`[CASH] Recovered shift ${currentShift.id} from register ${currentShift.registerId} for CLOSURE session ${registerId}`);
                }
            }

            if (!currentShift) throw new Error('No hay caja abierta para cerrar');

            const stats = await this.getShiftStats(userId, currentShift.openedAt, companyId, registerId, t);
            const movements = currentShift.CashMovements || [];
            
            const activeMovements = movements.filter(m => !m.id || !m.id.startsWith('OPEN-'));
            const tIn = precision.add(activeMovements.filter(m => m.type === 'in').map(m => Number(m.amount)));
            const tOut = precision.add(activeMovements.filter(m => m.type === 'out').map(m => Number(m.amount)));
            const tExp = precision.add(activeMovements.filter(m => m.type === 'expense').map(m => Number(m.amount)));

            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const pMethods = userSettings.paymentMethods || [];

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
                expectedBreakdown[methodId] = precision.round(precision.add([expectedBreakdown[methodId] || 0, amount]));
            });

            activeMovements.forEach(m => {
                const methodId = m.paymentMethodId;
                if (methodId && expectedBreakdown[methodId] !== undefined) {
                     expectedBreakdown[methodId] = precision.round(m.type === 'in' ? precision.add([expectedBreakdown[methodId] || 0, m.amount]) : precision.subtract(expectedBreakdown[methodId] || 0, m.amount));
                } else {
                    // Fallback for legacy data
                    const mCurrency = m.currency || 'USD';
                    const targetMethod = pMethods.find(pm => 
                        (pm.id.toLowerCase().includes('cash') || pm.id.toLowerCase().includes('efectivo')) &&
                        (mCurrency === 'VES' ? isVesPaymentMethod(pm.id, pMethods) : !isVesPaymentMethod(pm.id, pMethods))
                    ) || { id: 'cash' };
                    expectedBreakdown[targetMethod.id] = precision.round(m.type === 'in' ? precision.add([expectedBreakdown[targetMethod.id] || 0, m.amount]) : precision.subtract(expectedBreakdown[targetMethod.id] || 0, m.amount));
                }
            });

            const exchangeRate = Number(userSettings.exchangeRate) || 1.0;
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

            const finalAmountInputUsd = precision.add(
                Object.entries(finalBreakdown).map(([id, val]) => {
                    const isVes = isVesPaymentMethod(id, pMethods);
                    if (isSingleMode && isVes) return 0;
                    return isVes ? precision.divide(Number(val), exchangeRate) : Number(val);
                })
            );
            const finalAmountInput = precision.round(finalAmountInputUsd);

            const diff = precision.round(precision.subtract(finalAmountInput, expectedAmountTotalUsd));
            const tolerance = Number(userSettings.cashDifferenceToleranceUsd) ?? 1.0;

            if (Math.abs(diff) > tolerance && !closingData.supervisorId && !closingData.supervisorAuthToken && !closingData.overrideBySupervisor && !closingData.supervisorApprovalId) {
                const err = new Error(`El descuadre ($${diff}) supera el umbral de tolerancia permitido ($${tolerance}). Se requiere autorización de Supervisor.`);
                err.code = 'SUPERVISOR_AUTH_REQUIRED';
                err.difference = diff;
                err.tolerance = tolerance;
                throw err;
            }

            const salesSummary = {
                totalSales: stats.totalSalesAmount,
                cashSales: stats.cashSalesTotal,
                salesCount: stats.salesCount,
                totalIn: tIn,
                totalOut: tOut,
                totalExpenses: tExp,
                expectedBreakdown,
                physicalBreakdown: finalBreakdown,
                authorizedBySupervisor: closingData.supervisorName || closingData.supervisorId || null
            };

            await currentShift.update({
                status: 'closed',
                closedAt: new Date().toISOString(),
                finalAmount: finalAmountInput,
                expectedAmount: precision.round(expectedAmountTotalUsd),
                expectedBreakdown, // RECONSTRUCTION: Save the native snapshot
                difference: diff,
                closingNotes: notes,
                salesSummary
            }, { transaction: t });

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



            return currentShift;
        });
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

        return await sequelize.transaction(async (t) => {
            const currentShift = await CashShift.findOne({
                where: { id: String(shiftId), companyId },
                include: [{ model: CashMovement, as: 'CashMovements' }],
                transaction: t
            });

            if (!currentShift) throw new Error('Turno de caja no encontrado.');
            if (currentShift.status !== 'open') throw new Error('El turno ya se encuentra cerrado.');

            // 2. Calcular el ESPERADO usando el Ledger Inmutable
            const stats = await this.getShiftStats(currentShift.userId, currentShift.openedAt, companyId, currentShift.registerId, t);
            const movements = currentShift.CashMovements || [];
            
            const activeMovements = movements.filter(m => !m.id || !m.id.startsWith('OPEN-'));
            const tIn = precision.add(activeMovements.filter(m => m.type === 'in').map(m => Number(m.amount)));
            const tOut = precision.add(activeMovements.filter(m => m.type === 'out').map(m => Number(m.amount)));
            const tExp = precision.add(activeMovements.filter(m => m.type === 'expense').map(m => Number(m.amount)));

            // Reconstruir desglose esperado desde los métodos de pago nativos
            const safeParse = (val) => {
                if (!val) return {};
                if (typeof val === 'string') {
                    try { return JSON.parse(val); } catch (e) { return {}; }
                }
                return val;
            };

            const expectedBreakdown = { ...safeParse(currentShift.initialBreakdown) };
            
            Object.entries(stats.paymentBreakdownNative || {}).forEach(([methodId, amount]) => {
                expectedBreakdown[methodId] = precision.round(precision.add([expectedBreakdown[methodId] || 0, amount]));
            });

            activeMovements.forEach(m => {
                const methodId = m.paymentMethodId;
                if (methodId && expectedBreakdown[methodId] !== undefined) {
                     expectedBreakdown[methodId] = precision.round(m.type === 'in' ? precision.add([expectedBreakdown[methodId] || 0, m.amount]) : precision.subtract(expectedBreakdown[methodId] || 0, m.amount));
                } else {
                    // Fallback inferencia si falla paymentMethodId
                    const mCurrency = m.currency || 'USD';
                    const fallbackMethod = (mCurrency === 'VES') ? 'efectivo_bs' : 'cash';
                    expectedBreakdown[fallbackMethod] = precision.round(m.type === 'in' ? precision.add([expectedBreakdown[fallbackMethod] || 0, m.amount]) : precision.subtract(expectedBreakdown[fallbackMethod] || 0, m.amount));
                }
            });

            const allSettings = readJson(SETTINGS_FILE);
            const userSettings = getUserSettings(allSettings, companyId);
            const pMethods = userSettings.paymentMethods || [];
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
                const methodRaw = id.toLowerCase();
                if (methodRaw.includes('zelle')) expectedZelle = precision.add([expectedZelle, val]);
                else if (methodRaw.includes('pago_movil') || methodRaw.includes('pagomovil') || methodRaw.includes('movil')) expectedMobile = precision.add([expectedMobile, val]);
                else if (methodRaw === 'debit' || methodRaw.includes('punto') || methodRaw.includes('tarjeta') || methodRaw.includes('card') || methodRaw.includes('debito')) expectedCard = precision.add([expectedCard, val]);
                else if (isVesPaymentMethod(id, pMethods)) expectedCashVES = precision.add([expectedCashVES, val]);
                else if (methodRaw === 'cash' || methodRaw.includes('efectivo')) expectedCashUSD = precision.add([expectedCashUSD, val]);
                // Ignorar fiado / credit en efectivo fisico
            });

            expectedCashUSD = precision.round(expectedCashUSD);
            expectedCashVES = isSingleMode ? 0 : precision.round(expectedCashVES);
            expectedZelle = precision.round(expectedZelle);
            expectedCard = precision.round(expectedCard);
            expectedMobile = isSingleMode ? 0 : precision.round(expectedMobile);

            // 3. Diferencias
            const differenceUSD = precision.round(precision.subtract(declaredCashUSD, expectedCashUSD));
            const differenceVES = isSingleMode ? 0 : precision.round(precision.subtract(declaredCashVES, expectedCashVES));

            const tolerance = Number(userSettings.cashDifferenceToleranceUsd) ?? 1.0;

            if (Math.abs(differenceUSD) > tolerance && !closingData.supervisorId && !closingData.supervisorAuthToken && !closingData.overrideBySupervisor && !closingData.supervisorApprovalId) {
                const err = new Error(`El descuadre en cierre ciego ($${differenceUSD}) supera el umbral de tolerancia permitido ($${tolerance}). Se requiere autorización de Supervisor.`);
                err.code = 'SUPERVISOR_AUTH_REQUIRED';
                err.difference = differenceUSD;
                err.tolerance = tolerance;
                throw err;
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

            // 6. Cerrar Turno
            const salesSummary = {
                totalSales: stats.totalSalesAmount,
                cashSales: stats.cashSalesTotal,
                salesCount: stats.salesCount,
                totalIn: tIn,
                totalOut: tOut,
                totalExpenses: tExp,
                expectedBreakdown,
                declarationHash: hash
            };

            await currentShift.update({
                status: 'closed',
                closedAt: new Date().toISOString(),
                finalAmount: declaredCashUSD, // Referencial en USD
                expectedAmount: expectedCashUSD,
                difference: differenceUSD, // Solo guardamos USD base en Shift
                closingNotes: notes,
                salesSummary
            }, { transaction: t });

            await this._logAudit(reqUser, 'CASH_CLOSE_BLIND', `Cierre Ciego. Diff USD: ${differenceUSD}, Diff VES: ${differenceVES}`, currentShift.id, null, { hash, differences: { usd: differenceUSD, ves: differenceVES } }, t);

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
            let rateAtClosure = 1.0;

            if (totalAbsoluteError > 0) {
                // Capturar tasa actual para el reporte inmutable
                const allSettings = readJson(SETTINGS_FILE);
                const userSettings = getUserSettings(allSettings, companyId);
                rateAtClosure = Number(userSettings.exchangeRate) || 1.0;

                // Calculamos la diferencia neta total (normalizada a USD)
                const netDifferenceUsd = precision.add([
                    differenceUSD,
                    precision.divide(differenceVES, rateAtClosure),
                    diffZelle,
                    diffCard,
                    diffMobile
                ]);

                // Si la suma neta es 0 (o casi 0), es un error de clasificación
                isMisclassification = Math.abs(netDifferenceUsd) < 0.01;
                auditStatus = isMisclassification ? 'MISCLASSIFICATION' : 'MISMATCH';

                await AlertService.triggerAlert({
                    type: isMisclassification ? 'operational_error' : 'financial_mismatch',
                    severity: isMisclassification ? 'medium' : 'high',
                    message: isMisclassification 
                        ? `Error de Clasificación en Caja ${currentShift.registerId}: El total cuadra pero los métodos están cruzados.`
                        : `Descuadre Financiero en Caja ${currentShift.registerId}: Diferencia neta de $${netDifferenceUsd.toFixed(2)}`,
                    userId: reqUser.id,
                    companyId,
                    metadata: { 
                        shiftId, 
                        isMisclassification, 
                        netDifferenceUsd,
                        details: { usd: differenceUSD, ves: differenceVES, zelle: diffZelle, card: diffCard, mobile: diffMobile }
                    }
                });

                // Guardar la tasa del "snapshot" en el turno
                await currentShift.update({ exchangeRateAtClose: rateAtClosure }, { transaction: t });
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
                hash
            });

            return {
                shift: currentShift,
                status: (differenceUSD === 0 && differenceVES === 0) ? 'match' : 'mismatch',
                differences: {
                    usd: differenceUSD,
                    ves: differenceVES,
                    zelle: precision.round(declaredZelle - expectedZelle),
                    card: precision.round(declaredCard - expectedCard),
                    mobile: precision.round(declaredMobile - expectedMobile)
                },
                zReportText
            };
        });
    }

    /**
     * Genera la estructura visual del reporte Z en texto plano (ESC/POS compatible)
     */
    generateZReportText(shift, data) {
        const { userName, declared, expected, differences, stats, totalExpenses, hash, auditStatus } = data;
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
    async getShiftStats(userId, openedAt, companyId, registerId = '1', transaction = null) {
        const sales = await Sale.findAll({
            where: {
                userId: String(userId),
                date: { [Op.gte]: openedAt },
                companyId: String(companyId),
                registerId: String(registerId)
            },
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
                
                // ROBUST DETECTION: Check specific currency from PM record OR the method's default currency OR helper
                const isVes = isVesPaymentMethod(pm.id, pMethods) || isVesPaymentMethod(methodKey, pMethods);
                
                let amountInUsd = isVes 
                    ? precision.normalizeToUsd(amountNative, Number(s.exchangeRate))
                    : amountNative;

                paymentBreakdownUsd[methodKey] = precision.round(precision.add([paymentBreakdownUsd[methodKey] || 0, amountInUsd]), 4);
                paymentBreakdownNative[methodKey] = precision.round(precision.add([paymentBreakdownNative[methodKey] || 0, amountNative]), 4);

                // CASH SALES TRACKING: Only methods of type 'CASH' or known cash patterns
                if (foundMethod?.type === 'CASH' || foundMethod?.id.includes('cash') || foundMethod?.name?.toLowerCase().includes('efectivo') || methodRaw.includes('cash') || methodRaw.includes('efectivo')) {
                    cashSalesTotalUsd = precision.round(precision.add([cashSalesTotalUsd, amountInUsd]), 4);
                }
            });
        });

        const isSingleMode = userSettings.currencyMode === 'SINGLE' || ['ecuador', 'usa', 'panama', 'colombia'].includes(userSettings.businessInfo?.country?.toLowerCase()?.trim());
        if (isSingleMode) {
            const isLegacyVesKey = (k) => isVesPaymentMethod(k, pMethods) || ['cash_bs', 'efectivo_bs', 'pago_movil', 'pagomovil', 'biopago', 'ves', 'bs'].includes(k) || (k === 'debit' && !pMethods.some(m => m.id === 'debit'));
            Object.keys(paymentBreakdownUsd).forEach(k => {
                if (isLegacyVesKey(k)) delete paymentBreakdownUsd[k];
            });
            Object.keys(paymentBreakdownNative).forEach(k => {
                if (isLegacyVesKey(k)) delete paymentBreakdownNative[k];
            });
        }

        return {
            salesCount: sales.length,
            totalSalesAmount: precision.round(totalSalesAmountUsd),
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
     * Add a cash movement (in/out/expense).
     */
    async addMovement(reqUser, movementData) {
        const { type, amount, reason, paymentMethodId, currency } = movementData;
        const registerId = movementData.registerId || '1';
        const currentShift = await CashShift.findOne({
            where: { userId: String(reqUser.id), status: 'open', companyId: reqUser.companyId },
            order: [['openedAt', 'DESC']]
        });

        if (!currentShift) throw new Error('No hay turno de caja abierto');

        const movement = await CashMovement.create({
            id: generateRobustId(),
            shiftId: currentShift.id,
            userId: String(reqUser.id),
            companyId: reqUser.companyId,
            type,
            amount: precision.round(Number(amount) || 0, 4),
            currency: currency || 'USD',
            paymentMethodId, // NEW: Explicit link
            reason,
            timestamp: new Date().toISOString()
        });



        return movement;
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
                [sequelize.literal("SUM(CASE WHEN differenceUSD != 0 OR differenceVES != 0 THEN 1 ELSE 0 END)"), 'mismatchCount']
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

        const date = dateStr ? new Date(dateStr) : new Date();
        const startOfDay = new Date(date.setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(date.setHours(23, 59, 59, 999)).toISOString();

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

        // 2. Calcular Métricas Agregadas
        const totalLossUSD = precision.add(declarations.map(d => Number(d.differenceUSD) < 0 ? Number(d.differenceUSD) : 0));
        const totalOverageUSD = precision.add(declarations.map(d => Number(d.differenceUSD) > 0 ? Number(d.differenceUSD) : 0));
        const netBalanceUSD = precision.add([totalLossUSD, totalOverageUSD]);

        // 3. Agrupar por Cajero
        const cashierMap = {};
        declarations.forEach(d => {
            if (!cashierMap[d.userId]) {
                cashierMap[d.userId] = { name: d.userName, loss: 0, shifts: 0, matches: 0 };
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
                <p>Generado automáticamente por American POS - Capa de Auditoría Antifraude</p>
                <p>Hash de Integridad del Día: ${declarations[declarations.length - 1].hash.substring(0, 32)}</p>
            </div>
        </body>
        </html>
        `;

        // 6. Generar PDF con Puppeteer
        const browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await browser.close();

        return pdfBuffer;
    }
}

module.exports = new CashService();
