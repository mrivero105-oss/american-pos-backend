const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { TelecomRecharge, CashShift, CashMovement } = require('../database/models');
const { requirePermission } = require('../middleware/auth');
const { generateRobustId, readJson, writeJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');

router.use(requirePermission('canAccessPOS'));

let tableSynced = false;
async function ensureTableReady() {
    if (tableSynced) return;
    try {
        await TelecomRecharge.sync();
        tableSynced = true;
    } catch (err) {
        console.warn('[Recharges] Notice syncing pos_recargas_movilway:', err.message);
    }
}

function normalizePaymentMethodKey(rawMethod) {
    const m = String(rawMethod || 'pago_movil').toLowerCase().trim();
    if (m === 'efectivo_bs' || m === 'cash_bs' || m === 'cash_ves' || m === 'bs') return 'cash_bs';
    if (m === 'pago_movil' || m === 'pagomovil' || m.includes('movil')) return 'pago_movil';
    if (m === 'punto_venta' || m === 'punto_de_venta' || m === 'debit' || m === 'debito' || m === 'card' || m.includes('punto')) return 'debit';
    if (m === 'biopago') return 'biopago';
    if (m === 'divisas' || m === 'cash_usd' || m === 'efectivo_usd' || m === 'cash' || m === 'usd') return 'cash';
    if (m === 'zelle') return 'zelle';
    if (m === 'binance' || m === 'binance_usdt' || m === 'usdt') return 'binance_usdt';
    return m;
}

function isUsdMethod(methodKey) {
    return ['cash', 'cash_usd', 'efectivo_usd', 'divisas', 'zelle', 'binance_usdt'].includes(methodKey);
}

async function registerCashMovementForRecharge(recharge, user, req) {
    if (!recharge || recharge.cashMovementId) return null;

    const compId = String(user?.companyId || recharge.companyId || '2');
    const regId = String(recharge.registerId || req.headers['x-station-id'] || '1');
    const userId = String(user?.id || recharge.userId || '');

    // Buscar turno de caja abierto para este cajero o estación dentro de la misma empresa
    let openShift = null;
    if (userId) {
        openShift = await CashShift.findOne({
            where: { userId, companyId: compId, status: 'open', registerId: regId },
            order: [['openedAt', 'DESC']]
        });
        if (!openShift) {
            openShift = await CashShift.findOne({
                where: { userId, companyId: compId, status: 'open' },
                order: [['openedAt', 'DESC']]
            });
        }
    }
    if (!openShift) {
        openShift = await CashShift.findOne({
            where: { registerId: regId, companyId: compId, status: 'open' },
            order: [['openedAt', 'DESC']]
        });
    }

    if (!openShift) {
        return null;
    }

    const canonMethod = normalizePaymentMethodKey(recharge.paymentMethod);
    const useUsd = isUsdMethod(canonMethod);
    const movementCurrency = useUsd ? 'USD' : 'VES';
    const movementAmount = useUsd
        ? Number(recharge.totalChargedUsd || (Number(recharge.totalChargedBs) / (Number(recharge.exchangeRate) || 1)) || 0)
        : Number(recharge.totalChargedBs || 0);

    if (movementAmount <= 0) return null;

    const movId = `REC-${String(recharge.id).split('-')[0].toUpperCase()}-${Date.now().toString().slice(-4)}`;
    const reasonParts = [
        `Recarga ${recharge.operator} ${recharge.phoneNumber}`,
        `(Nominal: Bs.${Number(recharge.nominalAmountBs || 0).toFixed(2)} + Serv: Bs.${Number(recharge.serviceFeeBs || 0).toFixed(2)})`
    ];
    if (recharge.providerRef) reasonParts.push(`[Ref MW: #${recharge.providerRef}]`);
    if (recharge.customerPaymentRef) reasonParts.push(`[Ref Pago: #${recharge.customerPaymentRef}]`);

    const movement = await CashMovement.create({
        id: movId,
        shiftId: openShift.id,
        userId: userId || openShift.userId,
        userName: user?.name || user?.username || recharge.userName || openShift.userName || 'Cajero',
        companyId: compId,
        type: 'in',
        amount: Number(movementAmount.toFixed(2)),
        currency: movementCurrency,
        paymentMethodId: canonMethod,
        category: 'RECARGA_MOVILWAY',
        reason: reasonParts.join(' '),
        timestamp: new Date().toISOString()
    });

    await recharge.update({
        shiftId: openShift.id,
        cashMovementId: movement.id
    });

    const io = req.app?.get('io') || global.io;
    if (io) {
        io.to(compId).emit('cash_register_activity', {
            type: 'movement',
            movementType: 'in',
            registerId: openShift.registerId || regId,
            registerName: openShift.registerName || recharge.registerName || `Caja ${regId}`,
            userId: movement.userId,
            userName: movement.userName,
            amount: Number(movement.amount) || 0,
            currency: movement.currency,
            reason: movement.reason,
            timestamp: movement.timestamp
        });
    }

    return movement;
}

/**
 * GET / - Obtener historial de recargas, estadísticas del día y saldo de bolsa Movilway
 */
router.get('/', async (req, res) => {
    try {
        await ensureTableReady();
        const compId = String(req.user?.companyId || '2');
        const { startDate, endDate, operator, status, search, limit = 100 } = req.query;

        const whereClause = {
            companyId: (compId === '2' || compId === 'default')
                ? { [Op.or]: ['2', 'default', null] }
                : compId
        };

        if (startDate || endDate) {
            whereClause.createdAt = {};
            if (startDate) {
                const s = startDate.includes('T') ? new Date(startDate) : new Date(`${startDate}T00:00:00.000`);
                whereClause.createdAt[Op.gte] = s;
            }
            if (endDate) {
                const e = endDate.includes('T') ? new Date(endDate) : new Date(`${endDate}T23:59:59.999`);
                whereClause.createdAt[Op.lte] = e;
            }
        }

        if (operator && operator !== 'ALL' && operator !== 'TODOS') {
            whereClause.operator = String(operator).toUpperCase();
        }

        if (status && status !== 'ALL' && status !== 'TODOS') {
            whereClause.status = String(status).toUpperCase();
        }

        if (search && String(search).trim()) {
            const q = `%${String(search).trim()}%`;
            whereClause[Op.and] = [
                {
                    [Op.or]: [
                        { phoneNumber: { [Op.like]: q } },
                        { customerPaymentRef: { [Op.like]: q } },
                        { providerRef: { [Op.like]: q } },
                        { operator: { [Op.like]: q } }
                    ]
                }
            ];
        }

        const rows = await TelecomRecharge.findAll({
            where: whereClause,
            order: [['createdAt', 'DESC']],
            limit: Math.min(Number(limit) || 100, 500)
        });

        let totalNominalBs = 0;
        let totalServiceFeeBs = 0;
        let totalChargedBs = 0;
        let completedCount = 0;
        let pendingCount = 0;

        rows.forEach(r => {
            if (r.status === 'COMPLETADA') {
                completedCount++;
                totalNominalBs += Number(r.nominalAmountBs) || 0;
                totalServiceFeeBs += Number(r.serviceFeeBs) || 0;
                totalChargedBs += Number(r.totalChargedBs) || 0;
            } else if (r.status === 'PENDIENTE') {
                pendingCount++;
            }
        });

        // Obtener último saldo de bolsa conocido (de ajustes o de la última recarga con saldo > 0)
        let lastWalletBalanceBs = null;
        try {
            const allSettings = readJson(SETTINGS_FILE) || {};
            const userSettings = getUserSettings(allSettings, compId);
            if (userSettings?.movilwayWalletBalanceBs !== undefined && userSettings?.movilwayWalletBalanceBs !== null) {
                lastWalletBalanceBs = Number(userSettings.movilwayWalletBalanceBs);
            }
        } catch (_) {}

        if (lastWalletBalanceBs === null) {
            const latestWithBalance = await TelecomRecharge.findOne({
                where: {
                    companyId: compId,
                    remainingWalletBalanceBs: { [Op.not]: null, [Op.gt]: 0 }
                },
                order: [['updatedAt', 'DESC']]
            });
            if (latestWithBalance) {
                lastWalletBalanceBs = Number(latestWithBalance.remainingWalletBalanceBs);
            }
        }

        res.json({
            data: rows,
            stats: {
                totalNominalBs: Number(totalNominalBs.toFixed(2)),
                totalServiceFeeBs: Number(totalServiceFeeBs.toFixed(2)),
                totalChargedBs: Number(totalChargedBs.toFixed(2)),
                completedCount,
                pendingCount,
                lastWalletBalanceBs
            }
        });
    } catch (error) {
        console.error('[GET /recharges] Error:', error);
        res.status(500).json({ error: 'Error al obtener historial de recargas: ' + error.message });
    }
});

/**
 * POST / - Crear o actualizar una recarga con llave de idempotencia
 */
router.post('/', async (req, res) => {
    try {
        await ensureTableReady();
        const compId = String(req.user?.companyId || '2');
        const body = req.body || {};

        const id = String(body.id || generateRobustId()).trim();
        const operator = String(body.operator || body.operadora || 'MOVISTAR').toUpperCase().trim();
        const phoneNumber = String(body.phoneNumber || body.telefono || '').replace(/\D/g, '').slice(0, 15);

        if (!phoneNumber || phoneNumber.length < 10) {
            return res.status(400).json({ error: 'El número telefónico debe tener al menos 10 u 11 dígitos.' });
        }

        const nominalAmountBs = Number(body.nominalAmountBs ?? body.montoNominal ?? 0);
        if (nominalAmountBs <= 0) {
            return res.status(400).json({ error: 'El monto nominal de la recarga debe ser mayor a 0.' });
        }

        const serviceFeePercent = Number(body.serviceFeePercent ?? body.porcentajeComision ?? 20);
        const serviceFeeBs = body.serviceFeeBs !== undefined
            ? Number(body.serviceFeeBs)
            : Number(((nominalAmountBs * serviceFeePercent) / 100).toFixed(2));
        const totalChargedBs = body.totalChargedBs !== undefined
            ? Number(body.totalChargedBs)
            : Number((nominalAmountBs + serviceFeeBs).toFixed(2));

        const exchangeRate = Number(body.exchangeRate || 1) || 1;
        const totalChargedUsd = Number((totalChargedBs / exchangeRate).toFixed(2));

        const paymentMethod = normalizePaymentMethodKey(body.paymentMethod || body.metodoPago || 'pago_movil');
        const customerPaymentRef = String(body.customerPaymentRef ?? body.refCliente ?? '').trim();
        const providerRef = String(body.providerRef ?? body.refMovilway ?? '').trim();
        const remainingWalletBalanceBs = (body.remainingWalletBalanceBs !== undefined && body.remainingWalletBalanceBs !== null && body.remainingWalletBalanceBs !== '')
            ? Number(body.remainingWalletBalanceBs)
            : (body.saldoRestante !== undefined && body.saldoRestante !== null && body.saldoRestante !== '' ? Number(body.saldoRestante) : null);

        const status = String(body.status || body.estado || 'PENDIENTE').toUpperCase().trim();
        const registerId = String(body.registerId || req.headers['x-station-id'] || '1');
        const registerName = String(body.registerName || `Caja ${registerId}`);

        const userRole = String(req.user?.role || '').toLowerCase();
        let recharge = await TelecomRecharge.findByPk(id);
        if (recharge) {
            if (userRole !== 'superadmin' && String(recharge.companyId || '2') !== compId) {
                return res.status(403).json({ error: 'Acceso denegado: esta recarga pertenece a otra empresa.' });
            }
            await recharge.update({
                operator,
                phoneNumber,
                nominalAmountBs,
                serviceFeePercent,
                serviceFeeBs,
                totalChargedBs,
                totalChargedUsd,
                exchangeRate,
                paymentMethod,
                customerPaymentRef: customerPaymentRef || recharge.customerPaymentRef,
                providerRef: providerRef || recharge.providerRef,
                remainingWalletBalanceBs: remainingWalletBalanceBs !== null ? remainingWalletBalanceBs : recharge.remainingWalletBalanceBs,
                status,
                notes: body.notes ?? recharge.notes
            });
        } else {
            recharge = await TelecomRecharge.create({
                id,
                operator,
                phoneNumber,
                nominalAmountBs,
                serviceFeePercent,
                serviceFeeBs,
                totalChargedBs,
                totalChargedUsd,
                exchangeRate,
                paymentMethod,
                customerPaymentRef,
                providerRef,
                remainingWalletBalanceBs,
                status,
                registerId,
                registerName,
                userId: String(req.user?.id || ''),
                userName: req.user?.name || req.user?.username || 'Cajero',
                companyId: compId,
                notes: body.notes || null
            });
        }

        // Si el saldo de bolsa fue reportado, persistirlo también en ajustes para mostrarlo al instante
        if (remainingWalletBalanceBs !== null && !isNaN(remainingWalletBalanceBs) && remainingWalletBalanceBs >= 0) {
            try {
                const allSettings = readJson(SETTINGS_FILE) || {};
                if (!allSettings[compId]) allSettings[compId] = {};
                allSettings[compId].movilwayWalletBalanceBs = Number(remainingWalletBalanceBs);
                writeJson(SETTINGS_FILE, allSettings);
            } catch (_) {}
        }

        let cashMovement = null;
        if (status === 'COMPLETADA' && !recharge.cashMovementId) {
            cashMovement = await registerCashMovementForRecharge(recharge, req.user, req);
        }

        res.json({
            ok: true,
            recharge,
            cashMovement
        });
    } catch (error) {
        console.error('[POST /recharges] Error:', error);
        res.status(500).json({ ok: false, error: 'Error al registrar recarga: ' + error.message });
    }
});

/**
 * PUT /:id/complete - Confirmar recarga exitosa, registrar referencia Movilway y sumar a Caja
 */
router.put('/:id/complete', async (req, res) => {
    try {
        await ensureTableReady();
        const { id } = req.params;
        const body = req.body || {};
        const compId = String(req.user?.companyId || '2');
        const userRole = String(req.user?.role || '').toLowerCase();

        const recharge = await TelecomRecharge.findByPk(id);
        if (!recharge) {
            return res.status(404).json({ error: 'Registro de recarga no encontrado.' });
        }
        if (userRole !== 'superadmin' && String(recharge.companyId || '2') !== compId) {
            return res.status(403).json({ error: 'Acceso denegado: esta recarga pertenece a otra empresa.' });
        }

        const providerRef = String(body.providerRef || body.refMovilway || recharge.providerRef || `MW-${Date.now().toString().slice(-6)}`).trim();
        let remainingBalance = recharge.remainingWalletBalanceBs;

        if (body.remainingWalletBalanceBs !== undefined && body.remainingWalletBalanceBs !== null && body.remainingWalletBalanceBs !== '') {
            remainingBalance = Number(body.remainingWalletBalanceBs);
        } else if (body.saldoRestante !== undefined && body.saldoRestante !== null && body.saldoRestante !== '') {
            remainingBalance = Number(body.saldoRestante);
        } else {
            // Si no se detectó automáticamente del DOM, descontar el monto nominal del último saldo conocido
            try {
                const allSettings = readJson(SETTINGS_FILE) || {};
                const currentSaved = Number(allSettings[compId]?.movilwayWalletBalanceBs);
                if (!isNaN(currentSaved) && currentSaved > 0) {
                    remainingBalance = Math.max(0, Number((currentSaved - Number(recharge.nominalAmountBs || 0)).toFixed(2)));
                }
            } catch (_) {}
        }

        await recharge.update({
            providerRef,
            remainingWalletBalanceBs: remainingBalance,
            customerPaymentRef: body.customerPaymentRef ? String(body.customerPaymentRef).trim() : recharge.customerPaymentRef,
            status: 'COMPLETADA'
        });

        if (remainingBalance !== null && !isNaN(remainingBalance)) {
            try {
                const allSettings = readJson(SETTINGS_FILE) || {};
                if (!allSettings[compId]) allSettings[compId] = {};
                allSettings[compId].movilwayWalletBalanceBs = Number(remainingBalance);
                writeJson(SETTINGS_FILE, allSettings);
            } catch (_) {}
        }

        const cashMovement = await registerCashMovementForRecharge(recharge, req.user, req);

        res.json({
            ok: true,
            recharge,
            cashMovement
        });
    } catch (error) {
        console.error('[PUT /recharges/:id/complete] Error:', error);
        res.status(500).json({ ok: false, error: 'Error al completar recarga: ' + error.message });
    }
});

/**
 * PUT /:id/cancel - Anular recarga y revertir ingreso de caja si existía
 */
router.put('/:id/cancel', async (req, res) => {
    try {
        await ensureTableReady();
        const { id } = req.params;
        const compId = String(req.user?.companyId || '2');
        const userRole = String(req.user?.role || '').toLowerCase();
        const recharge = await TelecomRecharge.findByPk(id);
        if (!recharge) {
            return res.status(404).json({ error: 'Registro de recarga no encontrado.' });
        }
        if (userRole !== 'superadmin' && String(recharge.companyId || '2') !== compId) {
            return res.status(403).json({ error: 'Acceso denegado: esta recarga pertenece a otra empresa.' });
        }

        if (recharge.cashMovementId) {
            try {
                await CashMovement.destroy({ where: { id: recharge.cashMovementId, companyId: String(recharge.companyId || compId) } });
            } catch (e) {
                console.warn('[Recharges] Notice removing cash movement on cancel:', e.message);
            }
        }

        await recharge.update({
            status: 'ANULADA',
            cashMovementId: null,
            notes: req.body?.reason || 'Operación anulada por el operador'
        });

        res.json({ ok: true, recharge });
    } catch (error) {
        console.error('[PUT /recharges/:id/cancel] Error:', error);
        res.status(500).json({ ok: false, error: 'Error al anular recarga: ' + error.message });
    }
});

/**
 * POST /wallet-balance - Actualizar saldo disponible en bolsa Movilway
 */
router.post('/wallet-balance', async (req, res) => {
    try {
        const compId = String(req.user?.companyId || '2');
        const balance = Number(req.body?.balanceBs ?? req.body?.saldo ?? 0);
        if (isNaN(balance) || balance < 0) {
            return res.status(400).json({ error: 'Monto de bolsa inválido' });
        }

        const allSettings = readJson(SETTINGS_FILE) || {};
        if (!allSettings[compId]) allSettings[compId] = {};
        allSettings[compId].movilwayWalletBalanceBs = Number(balance.toFixed(2));
        writeJson(SETTINGS_FILE, allSettings);

        res.json({
            ok: true,
            movilwayWalletBalanceBs: allSettings[compId].movilwayWalletBalanceBs
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;
