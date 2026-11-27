const { Customer, Sale, CreditHistory, AuditLog, CashShift } = require('../database/models');
const { sequelize } = require('../database/connection');
const { generateRobustId } = require('../utils/helpers');
const { Op } = require('sequelize');
const precision = require('../utils/precision');


class CustomerService {
    /**
     * Get all customers with search and pagination.
     */
    async getAllCustomers(reqUser, queryParams) {
        let companyId = reqUser?.companyId || '2';
        if (!companyId || companyId === 'default' || companyId === 'admin') {
            companyId = '2';
        }
        const { search, filter = 'active', page = 1, limit = 0 } = queryParams;

        const companyCondition = (companyId === '2' || companyId === 'default')
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }, { companyId: null }] }
            : { companyId };
        const whereClause = { ...companyCondition };

        if (filter === 'active') {
            whereClause.isActive = { [Op.ne]: false };
        } else if (filter === 'inactive') {
            whereClause.isActive = false;
        } else if (filter === 'debt' || filter === 'with_balance') {
            whereClause.creditBalance = { [Op.gt]: 0 };
        } else if (filter === 'vip') {
            whereClause.isVIP = true;
        }

        if (search) {
            const searchTerm = search.trim();
            const cleanDigits = searchTerm.replace(/\D/g, '');
            const isPg = sequelize.getDialect() === 'postgres';
            const likeOp = isPg ? Op.iLike : Op.like;

            const orConditions = [
                { name: { [likeOp]: `%${searchTerm}%` } },
                { idDocument: { [likeOp]: `%${searchTerm}%` } },
                { email: { [likeOp]: `%${searchTerm}%` } },
                { phone: { [likeOp]: `%${searchTerm}%` } }
            ];

            // Búsqueda tolerante de Cédula y RIF ignorando puntos, guiones y espacios (ej: 22650692 encuentra V-22.650.692)
            if (cleanDigits.length >= 3) {
                if (isPg) {
                    orConditions.push(
                        sequelize.where(
                            sequelize.fn('regexp_replace', sequelize.col('idDocument'), '[^0-9]', '', 'g'),
                            { [Op.iLike]: `%${cleanDigits}%` }
                        )
                    );
                } else {
                    orConditions.push(
                        sequelize.where(
                            sequelize.fn('replace', sequelize.fn('replace', sequelize.fn('replace', sequelize.col('idDocument'), '.', ''), '-', ''), ' ', ''),
                            { [Op.like]: `%${cleanDigits}%` }
                        )
                    );
                }
            }

            if (isPg) {
                orConditions.push(
                    sequelize.literal(`similarity(LOWER("Customer"."name"), LOWER(${sequelize.escape(searchTerm)})) > 0.15`),
                    sequelize.literal(`word_similarity(LOWER("Customer"."name"), LOWER(${sequelize.escape(searchTerm)})) > 0.3`)
                );
            }

            whereClause[Op.or] = orConditions;
        }

        if (parseInt(limit) === 0) {
            return await Customer.findAll({
                where: whereClause,
                order: [['updatedAt', 'DESC']],
                raw: true
            });
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { count, rows } = await Customer.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset,
            order: [['updatedAt', 'DESC']],
            raw: true
        });

        return {
            customers: rows,
            total: count,
            page: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit))
        };
    }

    /**
     * Get a single customer by ID.
     */
    async getCustomerById(id, companyId) {
        const compCondition = (companyId === '2' || companyId === 'default' || !companyId)
            ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }, { companyId: null }] }
            : { companyId };
        return await Customer.findOne({
            where: { id, ...compCondition }
        });
    }

    /**
     * Create a new customer with audit log.
     */
    async createCustomer(reqUser, customerData) {
        const { id: userId, companyId } = reqUser;
        const {
            name,
            idDocument,
            email,
            phone,
            address,
            creditLimit,
            creditLimitDays,
            isCreditBlocked,
            allowOverdueCredit,
            notes
        } = customerData;

        const normalizedBlocked = Boolean(isCreditBlocked);
        const normalizedAllowOverdue = normalizedBlocked ? false : Boolean(allowOverdueCredit);

        const newCustomer = await Customer.create({
            id: generateRobustId(),
            userId,
            companyId,
            name,
            idDocument,
            email,
            phone,
            address,
            creditLimit: Number(creditLimit) || 0,
            creditLimitDays: creditLimitDays !== undefined ? Math.max(0, parseInt(creditLimitDays, 10) || 0) : 30,
            isCreditBlocked: normalizedBlocked,
            allowOverdueCredit: normalizedAllowOverdue,
            notes,
            creditBalance: 0
        });

        await this._logAudit(reqUser, 'CUSTOMER_CREATE', `Nuevo cliente registrado: ${newCustomer.name}`, newCustomer.id, null, newCustomer);



        return newCustomer;
    }

    /**
     * Update an existing customer with diff auditing.
     */
    async updateCustomer(reqUser, id, updateData) {
        const { companyId } = reqUser;
        const customer = await Customer.findOne({ where: { id, companyId } });
        if (!customer) throw new Error('Cliente no encontrado');

        const oldValues = customer.toJSON();
        
        // Sanitize update data to prevent overwriting protected fields
        const {
            name,
            idDocument,
            email,
            phone,
            address,
            creditLimit,
            creditLimitDays,
            isCreditBlocked,
            allowOverdueCredit,
            notes,
            isVIP,
            isActive,
            loyaltyPoints
        } = updateData;
        const sanitizedUpdate = {};
        if (name !== undefined) sanitizedUpdate.name = name;
        if (idDocument !== undefined) sanitizedUpdate.idDocument = idDocument;
        if (email !== undefined) sanitizedUpdate.email = email;
        if (phone !== undefined) sanitizedUpdate.phone = phone;
        if (address !== undefined) sanitizedUpdate.address = address;
        if (creditLimit !== undefined) sanitizedUpdate.creditLimit = Number(creditLimit);
        if (creditLimitDays !== undefined) sanitizedUpdate.creditLimitDays = Math.max(0, parseInt(creditLimitDays, 10) || 0);
        if (isCreditBlocked !== undefined) {
            sanitizedUpdate.isCreditBlocked = Boolean(isCreditBlocked);
            if (sanitizedUpdate.isCreditBlocked) {
                sanitizedUpdate.allowOverdueCredit = false;
            }
        }
        if (allowOverdueCredit !== undefined && !sanitizedUpdate.isCreditBlocked) {
            sanitizedUpdate.allowOverdueCredit = Boolean(allowOverdueCredit);
            if (sanitizedUpdate.allowOverdueCredit) {
                sanitizedUpdate.isCreditBlocked = false;
            }
        }
        if (notes !== undefined) sanitizedUpdate.notes = notes;
        if (isVIP !== undefined) sanitizedUpdate.isVIP = Boolean(isVIP);
        if (isActive !== undefined) sanitizedUpdate.isActive = Boolean(isActive);
        if (loyaltyPoints !== undefined) sanitizedUpdate.loyaltyPoints = Number(loyaltyPoints);

        const [updated] = await Customer.update(sanitizedUpdate, { where: { id, companyId } });

        if (updated) {
            const updatedCustomer = await Customer.findOne({ where: { id, companyId } });
            const changes = this._getDiff(oldValues, updatedCustomer.toJSON());
            
            if (changes.length > 0) {
                await this._logAudit(
                    reqUser, 
                    'CUSTOMER_UPDATE', 
                    `Actualizado cliente ${customer.name}: ${changes.join(', ')}`, 
                    id, 
                    oldValues, 
                    updatedCustomer
                );
            }



            return updatedCustomer;
        }
        return null;
    }

    /**
     * Register a payment towards credit balance (Abono) with robust multi-currency cash drawer tracking.
     */
    async registerPayment(reqUser, customerId, paymentData) {
        const { id: userId, companyId } = reqUser;
        const { amount, currency = 'USD', exchangeRate = 1, method, notes, saleIds } = paymentData;

        if (!amount || Number(amount) <= 0) throw new Error('El monto debe ser mayor a 0');

        return await sequelize.transaction(async (t) => {
            const customer = await Customer.findOne({
                where: { id: customerId, companyId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });
            if (!customer) throw new Error('Cliente no encontrado');

            const oldBalance = Number(customer.creditBalance) || 0;
            const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;

            // Detección robusta de si el instrumento de pago opera en Bolívares (VES), Binance (USDT) o USD
            const methodKey = String(method || 'cash').toLowerCase().trim();
            const isBinanceMethod = methodKey === 'binance_usdt' || methodKey === 'binance' || methodKey.includes('binance') || methodKey === 'usdt';
            const isVesMethod = !isBinanceMethod && (['cash_bs', 'efectivo_bs', 'pago_movil', 'pagomovil', 'biopago', 'transfer_bs', 'ves', 'bs'].includes(methodKey) ||
                                methodKey.includes('_bs') || methodKey.endsWith('bs') || methodKey.includes('ves') || methodKey.includes('movil'));
            const isVesInputCurrency = String(currency).toUpperCase() === 'VES';

            let amountInUsd = 0;
            let physicalMovementAmount = 0;
            let physicalMovementCurrency = 'USD';

            if (isBinanceMethod) {
                amountInUsd = precision.round(Number(amount), 2);
                const cryptoRate = Number(paymentData.cryptoRate || paymentData.binanceRate || 0);
                if (cryptoRate > 0 && rate > 0) {
                    const amountInBs = precision.multiply(amountInUsd, rate);
                    physicalMovementAmount = precision.round(precision.divide(amountInBs, cryptoRate), 2);
                } else {
                    physicalMovementAmount = amountInUsd;
                }
                physicalMovementCurrency = 'USDT';
            } else if (isVesInputCurrency) {
                // El cajero ingresó el monto nativo en Bolívares (ej: 500 Bs)
                const numVes = precision.round(Number(amount), 2);
                amountInUsd = rate > 0 ? precision.round(precision.divide(numVes, rate), 2) : numVes;
                physicalMovementAmount = numVes;
                physicalMovementCurrency = 'VES';
            } else if (isVesMethod) {
                // El cajero ingresó el monto en USD a amortizar (ej: $10), pagado con efectivo en Bs o Pago Móvil
                amountInUsd = precision.round(Number(amount), 2);
                physicalMovementAmount = precision.round(precision.multiply(amountInUsd, rate), 2);
                physicalMovementCurrency = 'VES';
            } else {
                // El pago es en USD físico o digital (Cash USD, Zelle, Tarjeta internacional)
                amountInUsd = precision.round(Number(amount), 2);
                physicalMovementAmount = amountInUsd;
                physicalMovementCurrency = 'USD';
            }

            // Permite saldo negativo que representa contablemente "Saldo a Favor / Anticipo"
            const newBalance = precision.round(precision.subtract(oldBalance, amountInUsd), 2);

            await customer.update({ creditBalance: newBalance }, { transaction: t });

            // Update individual sales if specified (FIFO waterfall coverage) or if customer is now fully paid off (<= 0)
            if (Array.isArray(saleIds) && saleIds.length > 0) {
                const candidateSales = await Sale.findAll({
                    where: {
                        id: { [Op.in]: saleIds },
                        customerId,
                        companyId
                    },
                    order: [['createdAt', 'ASC']],
                    transaction: t
                });
                let remainingForSales = amountInUsd;
                const fullyPaidIds = [];
                const partialIds = [];
                for (const s of candidateSales) {
                    const saleTotal = Number(s.total) || 0;
                    if (newBalance <= 0.01 || remainingForSales >= saleTotal - 0.01) {
                        fullyPaidIds.push(s.id);
                        remainingForSales = Math.max(0, precision.subtract(remainingForSales, saleTotal));
                    } else if (remainingForSales > 0) {
                        partialIds.push(s.id);
                        remainingForSales = 0;
                    }
                }
                if (fullyPaidIds.length > 0) {
                    await Sale.update({ paymentStatus: 'paid' }, {
                        where: { id: { [Op.in]: fullyPaidIds }, customerId, companyId },
                        transaction: t
                    });
                }
                if (partialIds.length > 0) {
                    await Sale.update({ paymentStatus: 'partial' }, {
                        where: { id: { [Op.in]: partialIds }, customerId, companyId },
                        transaction: t
                    });
                }
            } else if (newBalance <= 0.01) {
                await Sale.update({ paymentStatus: 'paid' }, {
                    where: {
                        customerId,
                        companyId,
                        paymentStatus: { [Op.in]: ['unpaid', 'partial', 'pending', 'credit'] }
                    },
                    transaction: t
                });
            }

            const isAdvance = newBalance < 0;
            const advanceTag = isAdvance ? ` [Saldo a favor: ${Math.abs(newBalance).toFixed(2)}]` : '';
            const refTag = paymentData.reference ? ` [Ref: ${paymentData.reference}]` : '';
            const paymentDetailsStr = physicalMovementCurrency === 'VES' 
                ? ` (${physicalMovementAmount} Bs @ ${rate} Bs/$)` 
                : (physicalMovementCurrency === 'USDT' ? ` (${physicalMovementAmount} USDT)` : '');
            const paymentDesc = `${notes || (isAdvance && oldBalance <= 0 ? 'Anticipo de cliente' : 'Abono a cuenta')}${paymentDetailsStr}${refTag}${advanceTag}`;

            // Record in Credit History
            const historyEntry = await CreditHistory.create({
                id: generateRobustId(),
                customerId,
                userId: String(userId),
                companyId,
                timestamp: new Date().toISOString(),
                type: 'payment',
                amount: parseFloat(amountInUsd),
                balanceAfter: newBalance,
                description: paymentDesc,
                paymentMethod: method || (physicalMovementCurrency === 'VES' ? 'cash_bs' : 'cash')
            }, { transaction: t });

            // Add to Cash Shift (if open for this cashier)
            const currentShift = await CashShift.findOne({
                where: { userId: String(userId), status: 'open', companyId },
                order: [['openedAt', 'DESC']],
                transaction: t
            });

            if (currentShift) {
                const { CashMovement } = require('../database/models');
                await CashMovement.create({
                    id: generateRobustId(),
                    shiftId: currentShift.id,
                    userId: String(userId),
                    companyId: companyId,
                    type: 'in',
                    amount: parseFloat(physicalMovementAmount),
                    currency: physicalMovementCurrency,
                    paymentMethodId: isBinanceMethod ? 'binance_usdt' : (method || (physicalMovementCurrency === 'VES' ? 'cash_bs' : 'cash')),
                    category: 'PAYMENT',
                    reason: `Abono de cliente: ${customer.name} (${physicalMovementCurrency === 'VES' ? `${physicalMovementAmount} Bs` : (physicalMovementCurrency === 'USDT' ? `${physicalMovementAmount} USDT` : `${physicalMovementAmount}`)})` + (paymentData.reference ? ` [Ref: ${paymentData.reference}]` : ''),
                    timestamp: new Date().toISOString()
                }, { transaction: t });
            }

            await this._logAudit(reqUser, 'CUSTOMER_PAYMENT', `Abono registrado para ${customer.name}: $${amountInUsd} USD (${physicalMovementAmount} ${physicalMovementCurrency})`, customerId, { oldBalance }, { newBalance }, t);

            return { 
                success: true, 
                newBalance, 
                amountInUsd, 
                physicalMovementAmount, 
                physicalMovementCurrency, 
                historyEntry 
            };
        });
    }

    /**
     * Delete a customer.
     */
    async deleteCustomer(reqUser, id) {
        const { companyId } = reqUser;
        const customer = await Customer.findOne({ where: { id, companyId } });
        if (!customer) return false;

        const { Sale, CreditHistory } = require('../database/models');
        const salesCount = await Sale.count({ where: { customerId: id, companyId } });
        if (salesCount > 0) {
            const err = new Error('No se puede eliminar el cliente porque tiene ventas asociadas.');
            err.code = 'ENTITY_HAS_DEPENDENCIES';
            err.status = 409;
            throw err;
        }

        return await sequelize.transaction(async (t) => {
            await CreditHistory.destroy({ where: { customerId: id, companyId }, transaction: t });
            
            const deleted = await Customer.destroy({ where: { id, companyId }, transaction: t });
            if (deleted) {
                await this._logAudit(reqUser, 'CUSTOMER_DELETE', `Eliminado cliente: ${customer.name}`, id, customer, null, t);
                return true;
            }
            return false;
        });
    }

    /**
     * Get Customer 360 Analytics Profile (LTV, Avg Ticket, Favorite Products, Credit Score, Tier).
     */
    async getCustomerProfile360(reqUser, customerId) {
        const { companyId } = reqUser;
        const customer = await Customer.findOne({ where: { id: customerId, companyId } });
        if (!customer) throw new Error('Cliente no encontrado');

        const { Sale, SaleItem, CreditHistory } = require('../database/models');

        // 1. Sales metrics
        const sales = await Sale.findAll({
            where: { customerId, companyId, status: { [Op.notIn]: ['cancelled'] } },
            order: [['date', 'DESC']],
            include: [{ model: SaleItem, as: 'SaleItems' }]
        });

        const salesCount = sales.length;
        const lifetimeValue = precision.round(sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0), 2);
        const averageTicket = salesCount > 0 ? precision.round(precision.divide(lifetimeValue, salesCount), 2) : 0;
        const lastSale = sales[0];
        const lastVisit = lastSale ? (lastSale.date || lastSale.createdAt) : null;
        
        let daysSinceLastVisit = null;
        if (lastVisit) {
            const diffMs = Date.now() - new Date(lastVisit).getTime();
            daysSinceLastVisit = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        }

        // 2. Favorite products ranking
        const productStats = {};
        sales.forEach(sale => {
            const items = sale.SaleItems || [];
            items.forEach(it => {
                const pId = it.productId || it.name;
                if (!productStats[pId]) {
                    productStats[pId] = {
                        productId: it.productId,
                        name: it.name || 'Producto',
                        quantity: 0,
                        totalSpent: 0
                    };
                }
                productStats[pId].quantity = precision.round(productStats[pId].quantity + (Number(it.quantity) || 0), 2);
                productStats[pId].totalSpent = precision.round(productStats[pId].totalSpent + (Number(it.subtotal || it.price * it.quantity) || 0), 2);
            });
        });

        const topProducts = Object.values(productStats)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 4);

        // 3. Customer Tier calculation
        let tier = 'BRONZE';
        let tierName = 'Bronce';
        let nextTierThreshold = 100;
        let tierProgress = 0;

        if (customer.isVIP || lifetimeValue >= 2000) {
            tier = 'DIAMOND';
            tierName = 'Diamante VIP';
            nextTierThreshold = 2000;
            tierProgress = 100;
        } else if (lifetimeValue >= 500) {
            tier = 'GOLD';
            tierName = 'Oro';
            nextTierThreshold = 2000;
            tierProgress = Math.min(100, Math.round(((lifetimeValue - 500) / 1500) * 100));
        } else if (lifetimeValue >= 100) {
            tier = 'SILVER';
            tierName = 'Plata';
            nextTierThreshold = 500;
            tierProgress = Math.min(100, Math.round(((lifetimeValue - 100) / 400) * 100));
        } else {
            tier = 'BRONZE';
            tierName = 'Bronce';
            nextTierThreshold = 100;
            tierProgress = Math.min(100, Math.round((lifetimeValue / 100) * 100));
        }

        // 4. Credit score (1 to 5 stars)
        const creditHistories = await CreditHistory.findAll({
            where: { customerId, companyId }
        });
        const totalCharges = creditHistories.filter(h => h.type === 'charge' || h.type === 'debit').reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
        
        let creditScore = 5;
        if (totalCharges > 0) {
            const currentDebt = Number(customer.creditBalance) || 0;
            if (currentDebt === 0) creditScore = 5;
            else if (currentDebt <= totalCharges * 0.3) creditScore = 4;
            else if (currentDebt <= totalCharges * 0.6) creditScore = 3;
            else if (currentDebt <= totalCharges * 0.9) creditScore = 2;
            else creditScore = 1;
        }

        return {
            customer,
            metrics: {
                lifetimeValue,
                salesCount,
                averageTicket,
                lastVisit,
                daysSinceLastVisit,
                tier,
                tierName,
                tierProgress,
                nextTierThreshold,
                creditScore,
                loyaltyPoints: Number(customer.loyaltyPoints) || 0,
                creditLimit: Number(customer.creditLimit) || 0,
                creditBalance: Number(customer.creditBalance) || 0
            },
            topProducts,
            recentSales: sales.slice(0, 5)
        };
    }

    /**
     * Redeem loyalty points for debt reduction or coupon balance.
     */
    async redeemLoyaltyPoints(reqUser, customerId, data) {
        const { companyId } = reqUser;
        const { pointsToRedeem, mode = 'debt_reduction', pointValueUsd = 1.0 } = data;
        const pts = Number(pointsToRedeem);

        if (!pts || pts <= 0) throw new Error('La cantidad de puntos debe ser mayor a 0');

        return await sequelize.transaction(async (t) => {
            const customer = await Customer.findOne({
                where: { id: customerId, companyId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });
            if (!customer) throw new Error('Cliente no encontrado');

            const currentPoints = Number(customer.loyaltyPoints) || 0;
            if (pts > currentPoints) {
                throw new Error(`Puntos insuficientes. El cliente posee ${currentPoints} puntos y solicitó ${pts}.`);
            }

            let newBalance = Number(customer.creditBalance) || 0;
            if (mode === 'debt_reduction' && newBalance <= 0) {
                throw new Error('El cliente no posee deuda pendiente para amortizar con puntos.');
            }

            const pVal = Number(pointValueUsd) > 0 ? Number(pointValueUsd) : 1.0;
            const requestedUsd = precision.round(precision.multiply(pts, pVal), 2);
            const effectivePts = (mode === 'debt_reduction' && requestedUsd > newBalance)
                ? Math.min(pts, Math.ceil(precision.divide(newBalance, pVal)))
                : pts;
            const valueInUsd = precision.round(precision.multiply(effectivePts, pVal), 2);
            const remainingPoints = precision.round(precision.subtract(currentPoints, effectivePts), 2);

            let description = `Canje de ${effectivePts} puntos por $${valueInUsd} USD`;

            if (mode === 'debt_reduction' && newBalance > 0) {
                const deductionAmount = Math.min(newBalance, valueInUsd);
                newBalance = precision.round(precision.subtract(newBalance, deductionAmount), 2);
                description = `Canje de ${effectivePts} puntos: Abono de $${deductionAmount} a deuda`;

                // Registrar en CreditHistory
                await CreditHistory.create({
                    id: generateRobustId(),
                    customerId,
                    userId: reqUser.id,
                    companyId,
                    timestamp: new Date().toISOString(),
                    type: 'credit',
                    amount: deductionAmount,
                    balanceAfter: newBalance,
                    description,
                    paymentMethod: 'puntos_fidelidad'
                }, { transaction: t });
            }

            await customer.update({
                loyaltyPoints: remainingPoints,
                creditBalance: newBalance
            }, { transaction: t });

            await this._logAudit(reqUser, 'CUSTOMER_REDEEM_POINTS', description, customerId, { points: currentPoints }, { points: remainingPoints, newBalance }, t);

            return {
                success: true,
                redeemedPoints: effectivePts,
                valueInUsd,
                remainingPoints,
                newBalance,
                message: 'Puntos canjeados exitosamente'
            };
        });
    }

    /**
     * Bulk import customers from Excel / CSV with deduplication by idDocument.
     */
    async importCustomersBulk(reqUser, customersArray) {
        const { id: userId, companyId } = reqUser;
        if (!Array.isArray(customersArray) || customersArray.length === 0) {
            throw new Error('No se proporcionaron datos válidos para la importación');
        }

        let imported = 0;
        let updated = 0;
        const errors = [];

        for (let i = 0; i < customersArray.length; i++) {
            const raw = customersArray[i];
            const name = (raw.name || raw.Nombre || raw.cliente || '').trim();
            const idDocument = (raw.idDocument || raw.documento || raw.Documento || raw.cedula || raw.Cedula || raw.rif || raw.RIF || '').trim();
            const phone = (raw.phone || raw.telefono || raw.Telefono || '').trim();
            const email = (raw.email || raw.correo || raw.Email || '').trim();
            const address = (raw.address || raw.direccion || raw.Direccion || '').trim();
            const creditLimit = Number(raw.creditLimit || raw.limite || raw.Limite || 0) || 0;
            const isVIP = Boolean(raw.isVIP || raw.vip || raw.VIP === 'SI' || raw.VIP === 'true');

            if (!name) {
                errors.push({ row: i + 1, error: 'El nombre es obligatorio' });
                continue;
            }

            try {
                let existing = null;
                if (idDocument && idDocument !== '---' && idDocument !== '') {
                    existing = await Customer.findOne({ where: { idDocument, companyId } });
                }
                if (!existing) {
                    existing = await Customer.findOne({ where: { name, companyId } });
                }

                if (existing) {
                    await existing.update({
                        idDocument: idDocument || existing.idDocument,
                        phone: phone || existing.phone,
                        email: email || existing.email,
                        address: address || existing.address,
                        creditLimit: creditLimit > 0 ? creditLimit : existing.creditLimit,
                        isVIP: isVIP || existing.isVIP
                    });
                    updated++;
                } else {
                    await Customer.create({
                        id: generateRobustId(),
                        userId,
                        companyId,
                        name,
                        idDocument: idDocument || null,
                        phone: phone || null,
                        email: email || null,
                        address: address || null,
                        creditLimit,
                        creditBalance: 0,
                        loyaltyPoints: 0,
                        isVIP,
                        isActive: true
                    });
                    imported++;
                }
            } catch (err) {
                errors.push({ row: i + 1, name, error: err.message });
            }
        }

        await this._logAudit(reqUser, 'CUSTOMER_BULK_IMPORT', `Importación masiva: ${imported} creados, ${updated} actualizados`, companyId, null, { imported, updated, total: customersArray.length });

        return {
            success: true,
            totalRows: customersArray.length,
            imported,
            updated,
            errors
        };
    }

    /**
     * Get official account statement data for PDF/Print (Invoice breakdown, payments, balance).
     */
    async getCustomerStatement(reqUser, customerId) {
        const { companyId } = reqUser;
        const customer = await Customer.findOne({ where: { id: customerId, companyId } });
        if (!customer) throw new Error('Cliente no encontrado');

        const { Sale, CreditHistory } = require('../database/models');

        const histories = await CreditHistory.findAll({
            where: { customerId, companyId },
            order: [['timestamp', 'ASC']]
        });

        const sales = await Sale.findAll({
            where: { customerId, companyId },
            order: [['date', 'DESC']],
            limit: 50
        });

        const totalCharges = histories.filter(h => h.type === 'charge' || h.type === 'debit').reduce((s, h) => s + (Number(h.amount) || 0), 0);
        const totalPayments = histories.filter(h => h.type === 'payment' || h.type === 'credit').reduce((s, h) => s + (Number(h.amount) || 0), 0);

        return {
            customer,
            summary: {
                creditLimit: Number(customer.creditLimit) || 0,
                currentBalance: Number(customer.creditBalance) || 0,
                totalCharges: precision.round(totalCharges, 2),
                totalPayments: precision.round(totalPayments, 2)
            },
            history: histories,
            recentSales: sales
        };
    }

    /**
     * Helper to get diff between objects.
     */
    _getDiff(oldObj, newObj) {
        const changes = [];
        const ignoreFields = ['updatedAt', 'createdAt'];
        const fieldsToAudit = ['name', 'idDocument', 'phone', 'email', 'address', 'creditLimit', 'isVIP', 'isActive'];

        fieldsToAudit.forEach(field => {
            if (newObj[field] !== undefined && String(oldObj[field]) !== String(newObj[field])) {
                changes.push(`${field}: ${oldObj[field] || 'N/A'} -> ${newObj[field]}`);
            }
        });
        return changes;
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
            }, transaction ? { transaction } : undefined);
        } catch (error) {
            console.error('Audit log error:', error);
        }
    }
}

module.exports = new CustomerService();
