const { CashShift, Sale, SaleItem, Product, CashMovement, User, Refund } = require('../../database/models');
const { sequelize } = require('../../database/connection');
const { generateRobustId, readJson, getUserSettings } = require('../../utils/helpers');
const { SETTINGS_FILE } = require('../../config/paths');
const { Op } = require('sequelize');
const precision = require('../../utils/precision');
const { canonicalizePaymentMethodId, isVesPaymentMethod, applyMovementToBreakdown } = require('./cashHelpers');

module.exports = {
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
    },

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
            const stats = await this.getShiftStats(shift.userId, shift.openedAt, companyId, shift.registerId, null, null, shift.id, shift.branchId || null);
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
            const name = (reg.registerName || '').toLowerCase().trim();
            if (name.includes('caja 1') || name === '1' || name.includes('principal')) return 1;
            if (name.includes('caja 2') || name === '2') return 2;
            if (name.includes('caja 3') || name === '3') return 3;
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
    },

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
            registerName = `Caja ${registerId || '1'}`;
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
                        let staleExpected = activeRegisterShift.expectedAmount ?? activeRegisterShift.initialAmount ?? 0;
                        try {
                            const staleStats = await this.getShiftStats(activeRegisterShift.userId, activeRegisterShift.openedAt, companyId, activeRegisterShift.registerId, t, null, activeRegisterShift.id, activeRegisterShift.branchId);
                            if (staleStats) staleExpected = precision.round((Number(activeRegisterShift.initialAmount) || 0) + (Number(staleStats.totalSalesAmount) || 0));
                        } catch (_) {}
                        await activeRegisterShift.update({
                            status: 'closed',
                            closedAt: new Date().toISOString(),
                            expectedAmount: staleExpected,
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
                    where: { userId: String(userId), status: 'open', companyId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (userActiveShift) {
                    const shiftAgeHours = (Date.now() - new Date(userActiveShift.openedAt).getTime()) / (1000 * 60 * 60);
                    if (shiftAgeHours > 12) {
                        console.log(`[CASH] Auto-closing stale shift ${userActiveShift.id} for user ${userId} (${shiftAgeHours.toFixed(1)}h old)`);
                        let staleExpected = userActiveShift.expectedAmount ?? userActiveShift.initialAmount ?? 0;
                        try {
                            const staleStats = await this.getShiftStats(userActiveShift.userId, userActiveShift.openedAt, companyId, userActiveShift.registerId, t, null, userActiveShift.id, userActiveShift.branchId);
                            if (staleStats) staleExpected = precision.round((Number(userActiveShift.initialAmount) || 0) + (Number(staleStats.totalSalesAmount) || 0));
                        } catch (_) {}
                        await userActiveShift.update({
                            status: 'closed',
                            closedAt: new Date().toISOString(),
                            expectedAmount: staleExpected,
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
    },

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
    },

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
                    attributes: ['id', 'registerId', 'branchId', 'userId', 'paymentMethod', 'paymentMethods', 'exchangeRate', 'total', 'subtotal']
                }],
                attributes: ['id', 'saleId', 'amount', 'paymentMethods', 'userId', 'createdAt'],
                transaction
            });

            const matchedRefunds = (refunds || []).filter(rf => {
                if (rf.Sale) {
                    if (registerId && String(rf.Sale.registerId) !== String(registerId)) return false;
                    if (branchId && String(rf.Sale.branchId) !== String(branchId)) return false;
                    return true;
                }
                return userId ? String(rf.userId) === String(userId) : true;
            });

            const parseJsonArray = (val) => {
                if (Array.isArray(val)) return val;
                if (typeof val === 'string') {
                    try {
                        const parsed = JSON.parse(val);
                        return Array.isArray(parsed) ? parsed : [];
                    } catch (_) {
                        return [];
                    }
                }
                return [];
            };

            const fallbackRate = Number(userSettings.exchangeRate) > 0 ? Number(userSettings.exchangeRate) : 1.0;

            matchedRefunds.forEach(rf => {
                const rfTotal = Number(rf.amount) || 0;
                totalSalesAmountUsd = precision.round(precision.subtract(totalSalesAmountUsd, rfTotal));
                const saleRate = Number(rf.Sale?.exchangeRate) > 0 ? Number(rf.Sale.exchangeRate) : fallbackRate;

                let rfMethods = parseJsonArray(rf.paymentMethods);
                if (rfMethods.length === 0 && rf.Sale) {
                    const origSalePms = parseJsonArray(rf.Sale.paymentMethods);
                    if (origSalePms.length > 0) {
                        const mappedOrig = origSalePms.map(pm => {
                            const rawId = String(pm.method || pm.id || 'cash').toLowerCase().trim();
                            const cur = String(pm.currency || '').toUpperCase().trim() ||
                                (isVesPaymentMethod(rawId, pMethods) || rawId.includes('ves') || rawId.includes('_bs') || rawId.includes('pago_movil') || rawId.includes('pagomovil') || rawId.includes('punto') || rawId.includes('debit') || rawId.includes('biopago') ? 'VES' : 'USD');
                            const rawAmt = Number(pm.amount) || 0;
                            const eqUsd = Number(pm.convertedAmountUsd) > 0
                                ? Number(pm.convertedAmountUsd)
                                : ((cur === 'VES' || cur === 'BS') && saleRate > 0 ? precision.divide(rawAmt, saleRate) : rawAmt);
                            return { method: pm.method || pm.id || 'cash', currency: cur === 'BS' ? 'VES' : cur, eqUsd };
                        });
                        const totalOrigUsd = mappedOrig.reduce((acc, m) => precision.add([acc, m.eqUsd]), 0);
                        let assignedUsd = 0;
                        rfMethods = mappedOrig.map((m, idx) => {
                            const isLast = idx === mappedOrig.length - 1;
                            const shareUsd = isLast
                                ? precision.round(precision.subtract(rfTotal, assignedUsd), 2)
                                : (totalOrigUsd > 0
                                    ? precision.round(precision.multiply(rfTotal, precision.divide(m.eqUsd, totalOrigUsd)), 2)
                                    : precision.round(precision.divide(rfTotal, mappedOrig.length), 2));
                            assignedUsd = precision.add([assignedUsd, shareUsd]);
                            const nativeAmt = m.currency === 'VES' ? precision.round(precision.multiply(shareUsd, saleRate), 2) : shareUsd;
                            return { method: m.method, amount: nativeAmt, currency: m.currency, convertedAmountUsd: shareUsd };
                        }).filter(x => x.amount > 0);
                    } else if (rf.Sale.paymentMethod) {
                        const rawM = String(rf.Sale.paymentMethod).toLowerCase().trim();
                        const isVesOrig = isVesPaymentMethod(rawM, pMethods) || rawM.includes('ves') || rawM.includes('_bs') || rawM.includes('pago_movil') || rawM.includes('pagomovil') || rawM.includes('punto') || rawM.includes('debit') || rawM.includes('biopago');
                        const cur = isVesOrig ? 'VES' : 'USD';
                        const nativeAmt = cur === 'VES' ? precision.round(precision.multiply(rfTotal, saleRate), 2) : rfTotal;
                        rfMethods = [{ method: rf.Sale.paymentMethod, amount: nativeAmt, currency: cur, convertedAmountUsd: rfTotal }];
                    }
                }

                if (rfMethods.length === 0) {
                    rfMethods = [{ method: 'cash', amount: rfTotal, currency: 'USD', convertedAmountUsd: rfTotal }];
                }

                rfMethods.forEach(rpm => {
                    const methodRaw = String(rpm.method || rpm.id || 'cash').toLowerCase().trim();
                    const foundMethod = pMethods.find(m =>
                        m.id.toLowerCase() === methodRaw ||
                        m.name.toLowerCase() === methodRaw ||
                        (methodRaw === 'efectivo' && m.id === 'cash')
                    );
                    const methodKey = foundMethod ? foundMethod.id : canonicalizePaymentMethodId(methodRaw);
                    const amt = Number(rpm.amount) || 0;
                    const rpmCur = String(rpm.currency || '').toUpperCase().trim();
                    const isVes = rpmCur === 'VES' || rpmCur === 'BS' || (rpmCur !== 'USD' && isVesPaymentMethod(methodKey, pMethods));
                    const amtUsd = Number(rpm.convertedAmountUsd) > 0
                        ? Number(rpm.convertedAmountUsd)
                        : (isVes ? (saleRate > 0 ? precision.divide(amt, saleRate) : amt) : amt);

                    paymentBreakdownUsd[methodKey] = precision.round(precision.subtract(paymentBreakdownUsd[methodKey] || 0, amtUsd), 4);
                    paymentBreakdownNative[methodKey] = precision.round(precision.subtract(paymentBreakdownNative[methodKey] || 0, amt), 4);

                    if (foundMethod?.type === 'CASH' || methodKey === 'cash' || methodKey.includes('cash_usd') || methodRaw === 'efectivo') {
                        cashSalesTotalUsd = precision.round(precision.subtract(cashSalesTotalUsd, amtUsd), 4);
                    }
                });
            });
        } catch (_refundErr) {
            console.warn('[CashService] Aviso al deducir devoluciones en turno:', _refundErr.message);
        }

        let movementsNetUsd = 0;
        if (shiftId) {
            try {
                const shiftMovements = await CashMovement.findAll({
                    where: { shiftId: String(shiftId), companyId: String(companyId) },
                    transaction
                });
                const statsRate = Number(userSettings.exchangeRate) > 0 ? Number(userSettings.exchangeRate) : 1.0;
                for (const m of (shiftMovements || [])) {
                    const mIdStr = String(m.id || '');
                    if (mIdStr.startsWith('OPEN-') || mIdStr.startsWith('CLOSE-')) continue;
                    const movCat = String(m.category || '').toUpperCase().trim();
                    const movReason = String(m.reason || '').trim();
                    if (movCat === 'REFUND' || /^Devoluci[oó]n Venta #/i.test(movReason)) continue;

                    const mType = String(m.type || '').toLowerCase().trim();
                    const mCur = String(m.currency || 'USD').toUpperCase().trim();
                    const rawAmt = Number(m.amount) || 0;
                    const usdVal = (mCur === 'VES' || mCur === 'BS') ? precision.divide(rawAmt, statsRate) : rawAmt;
                    if (mType === 'in') {
                        movementsNetUsd = precision.add([movementsNetUsd, usdVal]);
                    } else if (mType === 'out' || mType === 'expense' || mType === 'out_expense') {
                        movementsNetUsd = precision.subtract(movementsNetUsd, usdVal);
                    }
                }
            } catch (movErr) {
                console.warn('[CashService] Aviso calculando movimientos netos del turno:', movErr.message);
            }
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
            movementsNetUsd: precision.round(movementsNetUsd),
            paymentBreakdown: Object.fromEntries(
                Object.entries(paymentBreakdownUsd).map(([k, v]) => [k, precision.round(v)])
            ),
            paymentBreakdownNative: Object.fromEntries(
                Object.entries(paymentBreakdownNative).map(([k, v]) => [k, precision.round(v)])
            )
        };
    },

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
    },

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

            // 3. Fallback: buscar cualquier turno abierto del usuario en la misma empresa (ej. cambio de estación o reconexión)
            if (!currentShift) {
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
    },
};
