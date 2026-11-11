const { Product, Customer, Sale, PurchaseOrder, CashShift, Refund } = require('../database/models');
const { sequelize } = require('../database/connection');

const targetUserId = '1765079165259';

(async () => {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB. Starting ownership fix...');

        console.log(`Target User ID: ${targetUserId}`);

        const resultProduct = await Product.update({ userId: targetUserId }, { where: {} });
        console.log(`Products updated: ${resultProduct}`);

        const resultCustomer = await Customer.update({ userId: targetUserId }, { where: {} });
        console.log(`Customers updated: ${resultCustomer}`);

        const resultSale = await Sale.update({ userId: targetUserId }, { where: {} });
        console.log(`Sales updated: ${resultSale}`);

        const resultPO = await PurchaseOrder.update({ userId: targetUserId }, { where: {} });
        console.log(`PurchaseOrders updated: ${resultPO}`);

        const resultShift = await CashShift.update({ userId: targetUserId }, { where: {} });
        console.log(`CashShifts updated: ${resultShift}`);

        // Refund matches too
        const resultRefund = await Refund.update({ userId: targetUserId }, { where: {} });
        console.log(`Refunds updated: ${resultRefund}`);

        console.log('Ownership fix completed successfully.');
    } catch (error) {
        console.error('Error fixing ownership:', error);
    } finally {
        await sequelize.close();
    }
})();
