const { sequelize } = require('../database/connection');
const { Sale, Product } = require('../database/models');
const { Op } = require('sequelize');

async function testProfitCalculation() {
    try {
        await sequelize.sync();

        const userId = '2'; // From the sale we saw
        const now = new Date();
        const monthStr = now.toISOString().slice(0, 7);
        const dateFilter = { [Op.like]: `${monthStr}%` };

        console.log('Testing profit calculation with:');
        console.log('  Month:', monthStr);
        console.log('  Date filter:', dateFilter);

        const sales = await Sale.findAll({
            where: {
                userId: userId,
                date: dateFilter
            }
        });

        console.log(`\nFound ${sales.length} sales`);

        let totalRevenue = 0;
        let totalCost = 0;

        for (const sale of sales) {
            console.log(`\n--- Sale ${sale.id} ---`);
            console.log('Date:', sale.date);
            console.log('Revenue: $', sale.total);

            let saleCost = 0;
            if (sale.items && Array.isArray(sale.items)) {
                console.log(`Items (${sale.items.length}):`);
                for (const item of sale.items) {
                    const product = await Product.findOne({ where: { id: item.id } });
                    const cost = product && product.cost ? product.cost : 0;
                    const itemCost = cost * (item.quantity || 0);

                    console.log(`  - ${item.name}: qty=${item.quantity}, cost=$${cost}, total=$${itemCost}`);
                    saleCost += itemCost;
                }
            }
            console.log(`Sale cost: $${saleCost}`);

            totalRevenue += sale.total || 0;
            totalCost += saleCost;
        }

        const totalProfit = totalRevenue - totalCost;
        const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

        console.log('\n=== FINAL RESULTS ===');
        console.log('Total Revenue: $', totalRevenue.toFixed(2));
        console.log('Total Cost: $', totalCost.toFixed(2));
        console.log('Total Profit: $', totalProfit.toFixed(2));
        console.log('Margin: ', margin.toFixed(2), '%');

        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        await sequelize.close();
        process.exit(1);
    }
}

testProfitCalculation();
