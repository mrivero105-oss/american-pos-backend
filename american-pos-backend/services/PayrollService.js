const { 
    sequelize, Employee, PayrollPeriod, PayrollReceipt, SellerCommission, Sale 
} = require('../database/models');
const AccountingEngineService = require('./AccountingEngineService');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');

class PayrollService {
    /**
     * Calcula o recalcula la nómina de un período
     */
    static async calculatePeriod(periodId) {
        const period = await PayrollPeriod.findByPk(periodId);
        if (!period) throw new Error('Período de nómina no encontrado');
        if (period.status === 'CLOSED') throw new Error('Este período ya se encuentra cerrado y pagado.');

        const employees = await Employee.findAll({
            where: {
                companyId: period.companyId,
                status: 'ACTIVE'
            }
        });

        const isBiweekly = period.frequency === 'QUINCENAL';
        const isWeekly = period.frequency === 'SEMANAL';
        const daysInPeriod = isBiweekly ? 15 : (isWeekly ? 7 : 30);
        const periodRate = parseFloat(period.exchangeRate) > 0 ? parseFloat(period.exchangeRate) : 1;

        let sumEarnings = 0;
        let sumDeductions = 0;
        let sumNet = 0;

        const receipts = [];

        await sequelize.transaction(async (t) => {
            for (const emp of employees) {
                // Cálculo de Sueldo Base según frecuencia y moneda
                let base = parseFloat(emp.baseSalary) || 0;
                const sType = String(emp.salaryType || 'MONTHLY_USD').toUpperCase();
                if (sType.endsWith('_VES') && periodRate > 1) {
                    base = base / periodRate;
                }
                if (sType.startsWith('MONTHLY')) {
                    if (isBiweekly) base = base / 2;
                    else if (isWeekly) base = base / 4;
                } else if (sType.startsWith('WEEKLY')) {
                    if (isBiweekly) base = base * 2;
                    else if (!isWeekly) base = base * 4;
                }
                base = Math.round(base * 100) / 100;

                // Bono de Alimentación (Cestaticket)
                let food = parseFloat(emp.foodAllowance) || 0;
                if (isBiweekly) {
                    food = food / 2;
                } else if (isWeekly) {
                    food = food / 4;
                }
                food = Math.round(food * 100) / 100;

                // Comisiones ganadas si está vinculado a un usuario vendedor
                let comm = 0;
                if (emp.userId) {
                    const startDt = new Date(`${period.startDate}T00:00:00`);
                    const endDt = new Date(`${period.endDate}T23:59:59.999`);
                    const startYear = startDt.getFullYear();
                    const startMonth = startDt.getMonth() + 1;

                    const sellerCommissions = await SellerCommission.findAll({
                        where: {
                            companyId: period.companyId,
                            userId: String(emp.userId),
                            status: { [Op.in]: ['pending', 'approved', 'CALCULADO', 'LIQUIDADO'] },
                            [Op.or]: [
                                { periodYear: startYear, periodMonth: startMonth },
                                { createdAt: { [Op.between]: [startDt, endDt] } }
                            ]
                        },
                        transaction: t
                    });

                    // Si existe tasa de comisión configurada para el vendedor, calcular sobre las ventas reales del rango del período
                    const configuredRate = sellerCommissions.length > 0
                        ? (parseFloat(sellerCommissions[0].commissionRate) || 0)
                        : 0;

                    if (configuredRate > 0) {
                        const periodSalesSum = await Sale.sum('total', {
                            where: {
                                companyId: period.companyId,
                                userId: String(emp.userId),
                                status: 'completed',
                                createdAt: { [Op.between]: [startDt, endDt] }
                            },
                            transaction: t
                        }) || 0;
                        comm = Math.round(((parseFloat(periodSalesSum) * configuredRate) / 100) * 100) / 100;
                    } else if (sellerCommissions.length > 0) {
                        comm = sellerCommissions.reduce((acc, c) => acc + (parseFloat(c.commissionAmount) || 0), 0);
                        comm = Math.round(comm * 100) / 100;
                    }
                }

                // Deducciones parafiscales estándar de ley (Venezuela / IVSS 4%, FAOV 1%, RPE 0.5%)
                const ivss = Math.round(base * 0.04 * 100) / 100;
                const faov = Math.round(base * 0.01 * 100) / 100;
                const rpe = Math.round(base * 0.005 * 100) / 100;

                const totalEarn = base + food + comm;
                const totalDed = ivss + faov + rpe;
                const net = totalEarn - totalDed;

                sumEarnings += totalEarn;
                sumDeductions += totalDed;
                sumNet += net;

                // Crear o actualizar recibo
                let receipt = await PayrollReceipt.findOne({
                    where: { payrollPeriodId: period.id, employeeId: emp.id },
                    transaction: t
                });

                const receiptData = {
                    daysWorked: daysInPeriod,
                    baseEarnings: base,
                    foodAllowance: food,
                    overtimeAmount: 0,
                    commissionsAmount: comm,
                    otherBonuses: 0,
                    deductionIvss: ivss,
                    deductionFaov: faov,
                    deductionRpe: rpe,
                    deductionAdvances: 0,
                    netAmount: net,
                    currency: 'USD',
                    receiptHash: `NOM-${period.periodName}-${emp.idCard}-${Date.now().toString(36)}`
                };

                if (receipt) {
                    await receipt.update(receiptData, { transaction: t });
                } else {
                    receipt = await PayrollReceipt.create({
                        id: generateRobustId(),
                        companyId: period.companyId,
                        payrollPeriodId: period.id,
                        employeeId: emp.id,
                        ...receiptData
                    }, { transaction: t });
                }

                receipts.push(receipt);
            }

            // Actualizar resumen del período
            await period.update({
                totalEarnings: sumEarnings,
                totalDeductions: sumDeductions,
                totalNet: sumNet,
                status: 'CALCULATED'
            }, { transaction: t });
        });

        return {
            period,
            totalEmployees: employees.length,
            totalEarnings: sumEarnings,
            totalDeductions: sumDeductions,
            totalNet: sumNet,
            receiptsCount: receipts.length
        };
    }

    /**
     * Cierra y desembolsa la nómina: genera asiento contable automático
     */
    static async closeAndDisbursePeriod(periodId, { userId = 'admin', companyId = 'default' } = {}) {
        return await sequelize.transaction(async (t) => {
            const period = await PayrollPeriod.findOne({
                where: { id: periodId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (!period) throw new Error('Período de nómina no encontrado');
            if (period.status === 'CLOSED') throw new Error('El período ya está cerrado.');

            const receipts = await PayrollReceipt.findAll({
                where: { payrollPeriodId: period.id },
                transaction: t
            });
            if (!receipts || receipts.length === 0) {
                throw new Error('Debe calcular la nómina antes de cerrarla.');
            }

            const totalNet = parseFloat(period.totalNet) || 0;

            // Sumatorias desglosadas para el asiento contable
            let totalBase = 0;
            let totalFood = 0;
            let totalComm = 0;
            let totalIvss = 0;
            let totalFaov = 0;

            for (const r of receipts) {
                totalBase += parseFloat(r.baseEarnings) || 0;
                totalFood += parseFloat(r.foodAllowance) || 0;
                totalComm += parseFloat(r.commissionsAmount) || 0;
                totalIvss += (parseFloat(r.deductionIvss) || 0) + (parseFloat(r.deductionRpe) || 0);
                totalFaov += parseFloat(r.deductionFaov) || 0;
            }

            // 1. Generar Asiento Contable Automático en AccountingEngineService
            let journalEntry = null;
            try {
                const accSueldos = await AccountingEngineService.findAccountByCode('6.1.1.01.001', companyId);
                const accCestaticket = await AccountingEngineService.findAccountByCode('6.1.1.02.001', companyId);
                const accComisiones = await AccountingEngineService.findAccountByCode('6.1.1.03.001', companyId);
                const accRetIvss = await AccountingEngineService.findAccountByCode('2.1.3.02.001', companyId);
                const accRetFaov = await AccountingEngineService.findAccountByCode('2.1.3.03.001', companyId);
                const accBanco = await AccountingEngineService.findAccountByCode('1.1.1.02.001', companyId) || await AccountingEngineService.findAccountByCode('1.1.1.01.001', companyId);

                if (accSueldos && accBanco) {
                    const lines = [];

                    // Cargos (Gastos al Debe)
                    if (totalBase > 0) {
                        lines.push({
                            accountId: accSueldos.id,
                            description: `Gasto de Sueldos y Salarios - ${period.periodName}`,
                            debit: totalBase,
                            credit: 0
                        });
                    }
                    if (totalFood > 0 && accCestaticket) {
                        lines.push({
                            accountId: accCestaticket.id,
                            description: `Gasto Beneficio de Alimentación - ${period.periodName}`,
                            debit: totalFood,
                            credit: 0
                        });
                    }
                    if (totalComm > 0 && accComisiones) {
                        lines.push({
                            accountId: accComisiones.id,
                            description: `Gasto Comisiones de Venta - ${period.periodName}`,
                            debit: totalComm,
                            credit: 0
                        });
                    }

                    // Abonos (Retenciones al Haber)
                    if (totalIvss > 0 && accRetIvss) {
                        lines.push({
                            accountId: accRetIvss.id,
                            description: `Retenciones IVSS / Paro Forzoso por Enterar - ${period.periodName}`,
                            debit: 0,
                            credit: totalIvss
                        });
                    }
                    if (totalFaov > 0 && accRetFaov) {
                        lines.push({
                            accountId: accRetFaov.id,
                            description: `Retenciones FAOV por Enterar - ${period.periodName}`,
                            debit: 0,
                            credit: totalFaov
                        });
                    }

                    // Abono: Banco o Caja por el Neto Pagado
                    lines.push({
                        accountId: accBanco.id,
                        description: `Desembolso Neto de Nómina - ${period.periodName}`,
                        debit: 0,
                        credit: totalNet
                    });

                    journalEntry = await AccountingEngineService.createEntry({
                        companyId,
                        entryDate: period.paymentDate || new Date().toISOString().split('T')[0],
                        description: `Contabilización de Nómina: ${period.periodName}`,
                        entryType: 'AUTOMATIC',
                        currency: 'USD',
                        exchangeRate: period.exchangeRate || 1,
                        referenceType: 'PAYROLL',
                        referenceId: period.id,
                        userId,
                        lines,
                        transaction: t
                    });
                }
            } catch (accErr) {
                console.warn('[Payroll] Aviso al generar asiento contable de nómina:', accErr.message);
            }

            // 3. Cerrar el período dentro de la misma transacción
            await period.update({
                status: 'CLOSED',
                closedAt: new Date(),
                closedBy: userId,
                journalEntryId: journalEntry?.id || null
            }, { transaction: t });

            return {
                success: true,
                message: `Nómina ${period.periodName} cerrada y desembolsada exitosamente.`,
                totalDisbursed: totalNet,
                journalEntryNumber: journalEntry?.entryNumber || null
            };
        });
    }

    /**
     * Generador de Archivo TXT para pago masivo de nómina bancaria (Banesco / BDV)
     */
    static async generateBankTxt(periodId, bankCode = 'BANESCO') {
        const period = await PayrollPeriod.findByPk(periodId, {
            include: [
                {
                    model: PayrollReceipt,
                    as: 'Receipts',
                    include: [{ model: Employee, as: 'Employee' }]
                }
            ]
        });

        if (!period) throw new Error('Período no encontrado');

        const lines = [];
        // Encabezado estándar para transferencias
        lines.push(`HEADER|PAGO_NOMINA|${period.periodName}|${period.paymentDate}|TOTAL_RECIBOS=${period.Receipts.length}`);

        for (const receipt of period.Receipts) {
            const emp = receipt.Employee;
            if (!emp) continue;

            const accountNum = (emp.bankAccountNumber || '').replace(/\D/g, '').padEnd(20, '0').substring(0, 20);
            const cleanId = (emp.idCard || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const fullName = `${emp.firstName} ${emp.lastName}`.trim().substring(0, 40);
            const netAmount = parseFloat(receipt.netAmount).toFixed(2);

            if (bankCode === 'BANESCO') {
                // Formato Banesco Pago Masivo: TipoCuenta,NumCuenta,Monto,Cedula,Nombre
                lines.push(`${accountNum};${netAmount};${cleanId};${fullName};NOMINA_${period.startDate}`);
            } else if (bankCode === 'BDV') {
                // Formato Banco de Venezuela: CtaDestino(20), Monto(13 con 2 dec), TipoDoc(1), Cedula(10), Nombre(40)
                const docType = cleanId.charAt(0) || 'V';
                const idNum = cleanId.substring(1).padStart(10, '0');
                const amtFormatted = netAmount.replace('.', '').padStart(13, '0');
                lines.push(`${accountNum}${amtFormatted}${docType}${idNum}${fullName.padEnd(40, ' ')}`);
            } else {
                // Formato CSV estándar
                lines.push(`${cleanId},"${fullName}",${accountNum},${netAmount},"${period.periodName}"`);
            }
        }

        return {
            filename: `Nomina_${period.periodName.replace(/\s+/g, '_')}_${bankCode}.txt`,
            content: lines.join('\r\n'),
            recordsCount: period.Receipts.length,
            totalNet: period.totalNet
        };
    }
}

module.exports = PayrollService;
