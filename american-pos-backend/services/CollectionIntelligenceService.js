const { 
    Customer, Sale, CreditHistory, CollectionActionLog, User, sequelize 
} = require('../database/models');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');

class CollectionIntelligenceService {
    static buildCompanyCondition(companyId) {
        if (!companyId || companyId === 'default' || companyId === '1' || companyId === 1 || companyId === '2') {
            return {
                [Op.or]: [
                    { companyId: String(companyId || 'default') },
                    { companyId: '1' },
                    { companyId: '2' },
                    { companyId: 'default' },
                    { companyId: null }
                ]
            };
        }
        return { companyId: String(companyId) };
    }

    /**
     * Matriz de Antigüedad de Saldos (Aging Analysis)
     * Clasifica las cuentas por cobrar en tramos: Corriente (0-15), 16-30 días, 31-60 días y +60 días.
     */
    static async getAgingAnalysis(companyId = 'default', includeZeroBalance = false) {
        const compCondition = this.buildCompanyCondition(companyId);

        const whereClause = { ...compCondition };
        if (!includeZeroBalance) {
            whereClause.creditBalance = { [Op.gt]: 0.01 };
        }

        const customers = await Customer.findAll({
            where: whereClause,
            order: [['creditBalance', 'DESC'], ['name', 'ASC']]
        });

        const today = new Date();
        const customerAgingList = [];

        let totalReceivable = 0;
        let totalCurrent = 0;      // 0 a 15 días
        let total16to30 = 0;       // 16 a 30 días
        let total31to60 = 0;       // 31 a 60 días
        let totalOver60 = 0;        // > 60 días
        let totalCreditLimit = 0;

        for (const cust of customers) {
            const balance = Math.max(0, parseFloat(cust.creditBalance) || 0);
            const creditLimit = Math.max(0, parseFloat(cust.creditLimit) || 0);
            totalCreditLimit += creditLimit;

            if (!includeZeroBalance && balance <= 0.01) continue;

            totalReceivable += balance;

            let cCurrent = 0;
            let c16to30 = 0;
            let c31to60 = 0;
            let cOver60 = 0;
            let oldestDays = 0;

            if (balance > 0.01) {
                let remainingToAllocate = balance;

                // 1. Intentar conciliar por cargos en CreditHistory (del más reciente al más antiguo para cubrir el saldo vivo)
                let charges = [];
                try {
                    charges = await CreditHistory.findAll({
                        where: {
                            customerId: cust.id,
                            type: { [Op.in]: ['charge', 'debit'] }
                        },
                        order: [['timestamp', 'DESC']]
                    });
                } catch (_e) {
                    charges = [];
                }

                if (charges.length > 0) {
                    for (const ch of charges) {
                        if (remainingToAllocate <= 0.005) break;
                        const chAmt = Math.max(0, parseFloat(ch.amount) || 0);
                        if (chAmt <= 0) continue;
                        const allocated = Math.min(remainingToAllocate, chAmt);
                        remainingToAllocate = Math.max(0, remainingToAllocate - allocated);

                        const chDate = new Date(ch.timestamp || ch.createdAt || today);
                        const diffDays = Math.floor(Math.max(0, today - chDate) / (1000 * 60 * 60 * 24));
                        if (diffDays > oldestDays) oldestDays = diffDays;

                        if (diffDays <= 15) cCurrent += allocated;
                        else if (diffDays <= 30) c16to30 += allocated;
                        else if (diffDays <= 60) c31to60 += allocated;
                        else cOver60 += allocated;
                    }
                }

                // 2. Si queda saldo por asignar, conciliar contra ventas a crédito en Sale
                if (remainingToAllocate > 0.005) {
                    const pendingSales = await Sale.findAll({
                        where: {
                            customerId: cust.id,
                            status: { [Op.ne]: 'cancelled' },
                            [Op.or]: [
                                { paymentStatus: { [Op.in]: ['unpaid', 'partial', 'pending'] } },
                                { paymentMethod: { [Op.in]: ['credit', 'fiado'] } }
                            ]
                        },
                        order: [['createdAt', 'DESC']]
                    });

                    for (const sale of pendingSales) {
                        if (remainingToAllocate <= 0.005) break;
                        const saleTotal = parseFloat(sale.total) || 0;
                        const paid = parseFloat(sale.amountPaid) || 0;
                        const rawSaleRemaining = Math.max(0, saleTotal - paid);
                        const remaining = Math.min(remainingToAllocate, rawSaleRemaining > 0 ? rawSaleRemaining : saleTotal);

                        if (remaining <= 0) continue;
                        remainingToAllocate = Math.max(0, remainingToAllocate - remaining);

                        const saleDate = new Date(sale.createdAt || sale.date || today);
                        const diffDays = Math.floor(Math.max(0, today - saleDate) / (1000 * 60 * 60 * 24));
                        if (diffDays > oldestDays) oldestDays = diffDays;

                        if (diffDays <= 15) cCurrent += remaining;
                        else if (diffDays <= 30) c16to30 += remaining;
                        else if (diffDays <= 60) c31to60 += remaining;
                        else cOver60 += remaining;
                    }
                }

                // 3. Si aún queda saldo (p.ej. saldo inicial migrado), clasificar según antigüedad de actualización de la ficha
                if (remainingToAllocate > 0.005) {
                    const fallbackDate = new Date(cust.updatedAt || cust.createdAt || today);
                    const diffDays = Math.floor(Math.max(0, today - fallbackDate) / (1000 * 60 * 60 * 24));
                    if (diffDays > oldestDays) oldestDays = diffDays;
                    if (diffDays <= 15) cCurrent += remainingToAllocate;
                    else if (diffDays <= 30) c16to30 += remainingToAllocate;
                    else if (diffDays <= 60) c31to60 += remainingToAllocate;
                    else cOver60 += remainingToAllocate;
                }
            }

            // Consultar última gestión de cobranza en CollectionActionLog
            let lastAction = null;
            try {
                const latestLog = await CollectionActionLog.findOne({
                    where: { customerId: cust.id },
                    order: [['createdAt', 'DESC']]
                });
                if (latestLog) {
                    lastAction = {
                        id: latestLog.id,
                        actionType: latestLog.actionType,
                        promisedDate: latestLog.promisedDate,
                        promisedAmount: parseFloat(latestLog.promisedAmount) || 0,
                        notes: latestLog.notes,
                        createdAt: latestLog.createdAt
                    };
                }
            } catch (_e) {}

            // Clasificación de riesgo técnico
            const creditLimitDays = Number(cust.creditLimitDays) > 0 ? Number(cust.creditLimitDays) : 30;
            const allowOverdueCredit = Boolean(cust.allowOverdueCredit);
            const hasOverdueDebt = balance > 0.01 && (c31to60 > 0 || cOver60 > 0 || oldestDays > creditLimitDays);
            const isEffectivelyBlocked = Boolean(
                cust.isCreditBlocked ||
                (!allowOverdueCredit && hasOverdueDebt)
            );

            let status = 'GREEN';
            let statusLabel = balance > 0.01 ? 'Corriente (0-15d)' : 'Solvente ($0.00)';

            if (cust.isCreditBlocked) {
                status = 'RED';
                statusLabel = 'Crédito Bloqueado';
            } else if (allowOverdueCredit && hasOverdueDebt) {
                status = 'YELLOW';
                statusLabel = 'Desbloqueado (Mora permitida)';
            } else if (cOver60 > 0 || oldestDays > 60) {
                status = 'RED';
                statusLabel = 'Mora Crítica (+60d)';
            } else if (c31to60 > 0 || oldestDays > creditLimitDays) {
                status = 'ORANGE';
                statusLabel = `Mora Preventiva (+${creditLimitDays}d)`;
            } else if (c16to30 > 0 || oldestDays > 15 || (creditLimit > 0 && balance > creditLimit * 0.85)) {
                status = 'YELLOW';
                statusLabel = 'Vencido 16-30d / En Alerta';
            }

            totalCurrent += cCurrent;
            total16to30 += c16to30;
            total31to60 += c31to60;
            totalOver60 += cOver60;

            customerAgingList.push({
                customerId: cust.id,
                name: cust.name,
                idDocument: cust.idDocument || '',
                phone: cust.phone || '',
                email: cust.email || '',
                creditLimit,
                creditLimitDays,
                totalBalance: balance,
                current0to15: cCurrent,
                days16to30: c16to30,
                days31to60: c31to60,
                daysOver60: cOver60,
                oldestDays,
                status,
                statusLabel,
                isCreditBlocked: Boolean(cust.isCreditBlocked),
                allowOverdueCredit,
                hasOverdueDebt,
                isEffectivelyBlocked,
                lastAction
            });
        }

        return {
            summary: {
                totalReceivable,
                totalCurrent,
                total16to30,
                total31to60,
                totalOver60,
                totalCreditLimit,
                customersCount: customerAgingList.filter(c => c.totalBalance > 0.01).length,
                totalListedCount: customerAgingList.length,
                criticalCount: customerAgingList.filter(c => c.status === 'RED').length,
                warningCount: customerAgingList.filter(c => c.status === 'YELLOW' || c.status === 'ORANGE').length,
                healthyCount: customerAgingList.filter(c => c.status === 'GREEN').length
            },
            customers: customerAgingList
        };
    }

    /**
     * Bloquea o desbloquea administrativamente el crédito de un cliente en el POS.
     * Al desbloquear (isBlocked === false), habilita allowOverdueCredit para permitir
     * registrar nuevas facturas aunque el cliente conserve deudas vencidas antiguas.
     */
    static async toggleCreditBlock(customerId, isBlocked, companyId = 'default', userId = null, options = {}) {
        const customer = await Customer.findByPk(customerId);
        if (!customer) throw new Error('Cliente no encontrado');

        const nextState = typeof isBlocked === 'boolean' ? isBlocked : !customer.isCreditBlocked;
        const nextAllowOverdue = nextState
            ? false
            : (typeof options.allowOverdueCredit === 'boolean' ? options.allowOverdueCredit : true);

        await customer.update({
            isCreditBlocked: nextState,
            allowOverdueCredit: nextAllowOverdue
        });

        const customNotes = typeof options.notes === 'string' && options.notes.trim() ? options.notes.trim() : null;
        await CollectionActionLog.create({
            id: generateRobustId(),
            customerId: customer.id,
            actionType: nextState ? 'CREDIT_BLOCKED' : 'CREDIT_UNBLOCKED',
            notes: customNotes || (nextState
                ? 'Suspensión preventiva de línea de crédito en POS desde Radar de Cobranza'
                : (nextAllowOverdue
                    ? 'Crédito desbloqueado: autorizado para seguir facturando con deudas vencidas'
                    : 'Rehabilitación de línea de crédito en POS')),
            userId,
            companyId: String(companyId || 'default')
        });

        return {
            customerId: customer.id,
            isCreditBlocked: nextState,
            allowOverdueCredit: nextAllowOverdue
        };
    }

    /**
     * Perfil de crédito del cliente para consulta en tiempo real desde el POS
     */
    static async getCustomerCreditProfile(customerId, companyId = 'default') {
        const customer = await Customer.findByPk(customerId);
        if (!customer) throw new Error('Cliente no encontrado');

        const balance = parseFloat(customer.creditBalance) || 0;
        const limit = parseFloat(customer.creditLimit) || 0;
        const creditLimitDays = Number(customer.creditLimitDays) > 0 ? Number(customer.creditLimitDays) : 30;
        const allowOverdueCredit = Boolean(customer.allowOverdueCredit);
        const availableCredit = Math.max(0, limit - balance);

        let maxDaysOverdue = 0;
        let overdueAmount = 0;

        if (balance > 0.01) {
            const today = new Date();
            const pendingSales = await Sale.findAll({
                where: {
                    customerId,
                    status: { [Op.ne]: 'cancelled' },
                    [Op.or]: [
                        { paymentStatus: { [Op.in]: ['unpaid', 'partial', 'pending'] } },
                        { paymentMethod: { [Op.in]: ['credit', 'fiado'] } }
                    ]
                },
                order: [['createdAt', 'DESC']]
            });

            let remainingToAllocate = balance;

            for (const sale of pendingSales) {
                if (remainingToAllocate <= 0.005) break;
                const saleTotal = parseFloat(sale.total) || 0;
                const paid = parseFloat(sale.amountPaid) || 0;
                const rawSaleRemaining = Math.max(0, saleTotal - paid);
                const remaining = Math.min(remainingToAllocate, rawSaleRemaining > 0 ? rawSaleRemaining : saleTotal);
                if (remaining <= 0) continue;

                remainingToAllocate = Math.max(0, remainingToAllocate - remaining);

                const saleDate = new Date(sale.createdAt || sale.date);
                const diffDays = Math.floor(Math.max(0, today - saleDate) / (1000 * 60 * 60 * 24));
                if (diffDays > creditLimitDays) {
                    overdueAmount += remaining;
                }
                if (diffDays > maxDaysOverdue) {
                    maxDaysOverdue = diffDays;
                }
            }
        }

        let trafficLight = 'GREEN';
        let blockReason = null;
        let blockType = null;
        let canSellCredit = true;
        let overdueBypassActive = false;

        if (customer.isCreditBlocked) {
            trafficLight = 'RED';
            blockReason = 'El crédito está administrativamente bloqueado para este cliente.';
            blockType = 'MANUAL_BLOCK';
            canSellCredit = false;
        } else if (limit > 0 && balance >= limit) {
            trafficLight = 'RED';
            blockReason = `Límite de crédito excedido ($${balance.toFixed(2)} de $${limit.toFixed(2)} permitidos).`;
            blockType = 'CREDIT_LIMIT_EXCEEDED';
            canSellCredit = false;
        } else if (balance > 0.01 && (maxDaysOverdue > creditLimitDays || overdueAmount > 0.01)) {
            if (allowOverdueCredit) {
                trafficLight = 'YELLOW';
                blockReason = `Deuda vencida (${maxDaysOverdue}d, $${overdueAmount.toFixed(2)}), pero el cliente está desbloqueado para seguir facturando.`;
                blockType = null;
                canSellCredit = true;
                overdueBypassActive = true;
            } else {
                trafficLight = 'RED';
                blockReason = `Tiene facturas vencidas con más de ${creditLimitDays} días de mora ($${overdueAmount.toFixed(2)}).`;
                blockType = 'OVERDUE_DEBT';
                canSellCredit = false;
            }
        } else if (balance > (limit * 0.8) && limit > 0) {
            trafficLight = 'YELLOW';
            blockReason = 'Cliente cercano al límite máximo de crédito (80%+ utilizado).';
        }

        return {
            customerId: customer.id,
            name: customer.name,
            idDocument: customer.idDocument,
            phone: customer.phone,
            creditLimit: limit,
            creditLimitDays,
            creditBalance: balance,
            availableCredit,
            maxDaysOverdue,
            overdueAmount,
            trafficLight,
            canSellCredit,
            blockReason,
            blockType,
            isCreditBlocked: Boolean(customer.isCreditBlocked),
            allowOverdueCredit,
            overdueBypassActive,
            isVIP: Boolean(customer.isVIP)
        };
    }

    /**
     * Construye un mensaje formal de Estado de Cuenta para WhatsApp
     */
    static async generateWhatsAppMessage(customerId, exchangeRate = null, companyId = 'default') {
        const profile = await this.getCustomerCreditProfile(customerId, companyId);
        let rate = parseFloat(exchangeRate);
        if (isNaN(rate) || rate <= 1) {
            try {
                const { readJson, getUserSettings } = require('../utils/helpers');
                const { SETTINGS_FILE } = require('../config/paths');
                const allSettings = readJson(SETTINGS_FILE);
                const userSettings = getUserSettings(allSettings, companyId);
                const sysRate = parseFloat(userSettings.exchangeRate);
                if (!isNaN(sysRate) && sysRate > 0) {
                    rate = sysRate;
                }
            } catch (_e) {}
        }
        if (isNaN(rate) || rate <= 0) {
            rate = 1;
        }
        const totalVes = profile.creditBalance * rate;

        let urgencyIntro = 'Esperamos que se encuentre muy bien. Le remitimos el corte actualizado de su cuenta comercial:';
        if (profile.trafficLight === 'RED') {
            urgencyIntro = 'Nos comunicamos del departamento de administración ya que su cuenta presenta saldo vencido pendiente de regularización:';
        } else if (profile.trafficLight === 'YELLOW') {
            urgencyIntro = 'Le escribimos cordialmente para compartir su estado de cuenta actualizado próximo a fecha de corte:';
        }

        const message =
            `Estimado(a) *${profile.name}*,\n\n` +
            `${urgencyIntro}\n\n` +
            `*ESTADO DE CUENTA COMERCIAL*\n` +
            `• Saldo Pendiente (Ref. USD): *$${profile.creditBalance.toFixed(2)}*\n` +
            `• Equivalente en Bolívares: *Bs. ${totalVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n` +
            `• Tasa Oficial BCV Aplicada: Bs. ${rate.toFixed(2)} / USD\n` +
            (profile.maxDaysOverdue > 0 ? `• Antigüedad del saldo: *${profile.maxDaysOverdue} días*\n` : '') +
            `\nAgradecemos remitir el soporte o número de referencia de su abono por esta vía para asentar el pago inmediatamente y mantener activa su línea de crédito.\n\n` +
            `Atentamente,\nAdministración y Crédito`;

        return {
            customerId,
            phone: profile.phone,
            message,
            encodedUri: `https://wa.me/${(profile.phone || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`
        };
    }

    /**
     * Registra una gestión de cobro o promesa de pago
     */
    static async logAction({
        customerId,
        actionType = 'WHATSAPP_REMINDER',
        promisedDate = null,
        promisedAmount = 0,
        notes = '',
        userId = null,
        companyId = 'default'
    }) {
        if (!customerId) throw new Error('El ID del cliente es obligatorio');

        return await CollectionActionLog.create({
            id: generateRobustId(),
            customerId,
            actionType,
            promisedDate: promisedDate || null,
            promisedAmount: parseFloat(promisedAmount) || 0,
            notes: notes || '',
            userId,
            companyId: String(companyId || 'default')
        });
    }

    /**
     * Obtiene el historial de gestiones de cobro de un cliente
     */
    static async getCustomerActionsHistory(customerId) {
        return await CollectionActionLog.findAll({
            where: { customerId },
            order: [['createdAt', 'DESC']]
        });
    }
}

module.exports = CollectionIntelligenceService;
