const { 
    FixedAsset, AssetDepreciationLog, JournalEntry, sequelize 
} = require('../database/models');
const AccountingEngineService = require('./AccountingEngineService');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');

class FixedAssetService {
    /**
     * Da de alta un nuevo activo fijo
     */
    static async registerAsset({
        companyId = 'default',
        code = null,
        name,
        category = 'MACHINERY',
        purchaseDate,
        purchaseCost,
        salvageValue = 0,
        usefulLifeMonths = 60,
        location = '',
        serialNumber = ''
    }) {
        if (!name || !purchaseCost || !purchaseDate) {
            throw new Error('El nombre, costo de compra y fecha de adquisición son obligatorios.');
        }

        const cost = parseFloat(purchaseCost) || 0;
        const salvage = parseFloat(salvageValue) || 0;
        const lifeMonths = parseInt(usefulLifeMonths) || 60;

        let assetCode = code;
        if (!assetCode) {
            const count = await FixedAsset.count({ where: { companyId } });
            const prefix = (category || 'ACT').substring(0, 3).toUpperCase();
            assetCode = `AF-${prefix}-${String(count + 1).padStart(4, '0')}`;
        }

        return await FixedAsset.create({
            id: generateRobustId(),
            code: assetCode,
            name,
            category,
            purchaseDate,
            purchaseCost: cost,
            salvageValue: salvage,
            usefulLifeMonths: lifeMonths,
            accumulatedDepreciation: 0,
            currentBookValue: cost,
            location: location || '',
            serialNumber: serialNumber || '',
            status: 'ACTIVE',
            companyId
        });
    }

    static buildCompanyWhere(companyId) {
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
     * Lista todos los activos fijos con métricas de vida útil y valor residual
     */
    static async getAssets(companyId = 'default') {
        const assets = await FixedAsset.findAll({
            where: this.buildCompanyWhere(companyId),
            order: [['createdAt', 'DESC']]
        });

        return assets.map(a => {
            const cost = parseFloat(a.purchaseCost) || 0;
            const accum = parseFloat(a.accumulatedDepreciation) || 0;
            const salvage = parseFloat(a.salvageValue) || 0;
            const depreciableBase = Math.max(0, cost - salvage);
            const percentDepreciated = depreciableBase > 0 ? Math.min(100, (accum / depreciableBase) * 100) : 100;
            const monthlyDepreciation = (a.usefulLifeMonths > 0 && depreciableBase > 0) 
                ? (depreciableBase / a.usefulLifeMonths) 
                : 0;

            return {
                ...a.toJSON(),
                monthlyDepreciation,
                percentDepreciated: Math.round(percentDepreciated * 100) / 100
            };
        });
    }

    /**
     * Corrida mensual de depreciación lineal con asiento contable automático
     * Period format: YYYY-MM (ej. "2026-09")
     */
    static async runMonthlyDepreciation(companyId = 'default', period, userId = null) {
        if (!period || !/^\d{4}-\d{2}$/.test(period)) {
            throw new Error('El formato del período debe ser YYYY-MM (ej. 2026-09).');
        }

        // 1. Verificar si ya se corrió la depreciación para este período
        const existingLogs = await AssetDepreciationLog.count({
            where: { companyId, period }
        });

        if (existingLogs > 0) {
            throw new Error(`La depreciación para el período ${period} ya fue ejecutada previamente.`);
        }

        // 2. Buscar activos fijos activos
        const activeAssets = await FixedAsset.findAll({
            where: {
                ...this.buildCompanyWhere(companyId),
                status: 'ACTIVE'
            }
        });

        if (activeAssets.length === 0) {
            return {
                success: true,
                message: 'No existen activos fijos activos sujetos a depreciación.',
                depreciatedCount: 0,
                totalDepreciation: 0
            };
        }

        return await sequelize.transaction(async (t) => {
            let totalMonthlyDepreciation = 0;
            const logEntries = [];
            const updatedAssetIds = [];

            for (const asset of activeAssets) {
                const cost = parseFloat(asset.purchaseCost) || 0;
                const salvage = parseFloat(asset.salvageValue) || 0;
                const accum = parseFloat(asset.accumulatedDepreciation) || 0;
                const currentBook = parseFloat(asset.currentBookValue) || cost;
                const months = parseInt(asset.usefulLifeMonths) || 60;

                const depreciableBase = Math.max(0, cost - salvage);
                const remainingDepreciable = Math.max(0, depreciableBase - accum);

                if (remainingDepreciable <= 0.001) {
                    await asset.update({ status: 'FULLY_DEPRECIATED' }, { transaction: t });
                    continue;
                }

                const monthlyQuota = depreciableBase / (months > 0 ? months : 1);
                const effectiveAmount = Math.min(monthlyQuota, remainingDepreciable);

                const newAccum = accum + effectiveAmount;
                const newBook = Math.max(salvage, cost - newAccum);
                const isFullyDepreciated = newAccum >= (depreciableBase - 0.005);

                await asset.update({
                    accumulatedDepreciation: newAccum,
                    currentBookValue: newBook,
                    status: isFullyDepreciated ? 'FULLY_DEPRECIATED' : 'ACTIVE'
                }, { transaction: t });

                totalMonthlyDepreciation += effectiveAmount;
                updatedAssetIds.push(asset.id);

                const logId = generateRobustId();
                logEntries.push({
                    id: logId,
                    assetId: asset.id,
                    period,
                    depreciationAmount: effectiveAmount,
                    accumulatedAfter: newAccum,
                    bookValueAfter: newBook,
                    companyId
                });
            }

            if (logEntries.length === 0 || totalMonthlyDepreciation <= 0) {
                return {
                    success: true,
                    message: 'Los activos ya se encuentran totalmente depreciados.',
                    depreciatedCount: 0,
                    totalDepreciation: 0
                };
            }

            // 3. Generar Asiento Contable Automático
            let journalEntry = null;
            try {
                // Cuenta de Gasto por Depreciación (Gasto Operativo 6.1.6.01.001 o 6.1.4.01.001)
                const accGastoDeprec = await AccountingEngineService.findAccountByCode('6.1.6.01.001', companyId) ||
                    await AccountingEngineService.findAccountByCode('6.1.4.01.001', companyId) ||
                    await AccountingEngineService.findAccountByCode('6.1.1.01.001', companyId);

                // Cuenta de Depreciación Acumulada (Contracuenta de Activo No Corriente 1.2.9.01.001 o 1.2.1.01.001)
                const accDeprecAcum = await AccountingEngineService.findAccountByCode('1.2.9.01.001', companyId) ||
                    await AccountingEngineService.findAccountByCode('1.2.1.01.001', companyId);

                if (accGastoDeprec && accDeprecAcum) {
                    journalEntry = await AccountingEngineService.createEntry({
                        companyId,
                        entryDate: `${period}-28`,
                        description: `Depreciación Mensual Activos Fijos - Período ${period}`,
                        entryType: 'AUTOMATIC',
                        currency: 'USD',
                        referenceType: 'DEPRECIATION',
                        referenceId: period,
                        userId,
                        lines: [
                            {
                                accountId: accGastoDeprec.id,
                                description: `Gasto por Depreciación de Activos Fijos ${period}`,
                                debit: totalMonthlyDepreciation,
                                credit: 0
                            },
                            {
                                accountId: accDeprecAcum.id,
                                description: `Depreciación Acumulada de Activos Fijos ${period}`,
                                debit: 0,
                                credit: totalMonthlyDepreciation
                            }
                        ],
                        transaction: t
                    });
                }
            } catch (accErr) {
                console.warn('[FixedAssets] Aviso al generar asiento contable de depreciación:', accErr.message);
            }

            // 4. Guardar logs con referencia al asiento contable
            for (const log of logEntries) {
                log.journalEntryId = journalEntry?.id || null;
                await AssetDepreciationLog.create(log, { transaction: t });
            }

            return {
                success: true,
                period,
                depreciatedCount: logEntries.length,
                totalDepreciation: totalMonthlyDepreciation,
                journalEntryNumber: journalEntry?.entryNumber || null
            };
        });
    }

    /**
     * Historial de depreciación de un activo específico
     */
    static async getAssetDepreciationHistory(assetId) {
        return await AssetDepreciationLog.findAll({
            where: { assetId },
            include: [{ model: JournalEntry, as: 'JournalEntry' }],
            order: [['period', 'DESC']]
        });
    }
}

module.exports = FixedAssetService;
