const { sequelize } = require('../database/connection');
const { Sale } = require('../database/models');

async function verifyExchangeRates() {
    try {
        await sequelize.sync();

        const today = new Date().toISOString().split('T')[0];

        const sales = await Sale.findAll({
            where: { userId: '2' },
            order: [['date', 'DESC']],
            limit: 5,
            raw: true
        });

        console.log('📊 Sample sales with exchangeRate:');
        console.log('='.repeat(70));

        sales.forEach((sale, i) => {
            const totalBs = sale.total * (sale.exchangeRate || 1);
            console.log(`\n${i + 1}. Sale ${sale.id.substring(0, 20)}...`);
            console.log(`   Date: ${sale.date}`);
            console.log(`   Total USD: $${sale.total.toFixed(2)}`);
            console.log(`   Exchange Rate: ${sale.exchangeRate || 'NOT SET'}`);
            console.log(`   Total Bs: Bs.${totalBs.toFixed(2)}`);
        });

        //Calculate today's total
        const todaySales = sales.filter(s => s.date && s.date.startsWith(today));
        if (todaySales.length > 0) {
            const totalUSDToday = todaySales.reduce((sum, s) => sum + s.total, 0);
            const totalBsToday = todaySales.reduce((sum, s) => sum + (s.total * (s.exchangeRate || 1)), 0);

            console.log('\n' + '='.repeat(70));
            console.log('📅 TODAY\'S TOTALS:');
            console.log(`   Sales: ${todaySales.length}`);
            console.log(`   Total USD: $${totalUSDToday.toFixed(2)}`);
            console.log(`   Total Bs: Bs.${totalBsToday.toFixed(2)}`);
            console.log(`   (Expected dashboard to show: Bs.S ${totalBsToday.toFixed(2).replace('.', ',')})`);
        }

        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        await sequelize.close();
        process.exit(1);
    }
}

verifyExchangeRates();
