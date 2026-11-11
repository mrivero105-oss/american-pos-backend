const { sequelize } = require('../database/connection');

async function addExchangeRateColumn() {
    try {
        await sequelize.sync();

        console.log('Adding exchangeRate column to Sales table...');

        await sequelize.getQueryInterface().addColumn('Sales', 'exchangeRate', {
            type: sequelize.Sequelize.FLOAT,
            allowNull: true,
            defaultValue: null
        });

        console.log('✅ Column added successfully!');

        await sequelize.close();
        process.exit(0);
    } catch (error) {
        if (error.message && error.message.includes('duplicate column name')) {
            console.log('⚠️  Column already exists, skipping...');
            await sequelize.close();
            process.exit(0);
        } else {
            console.error('❌ Error:', error);
            await sequelize.close();
            process.exit(1);
        }
    }
}

addExchangeRateColumn();
