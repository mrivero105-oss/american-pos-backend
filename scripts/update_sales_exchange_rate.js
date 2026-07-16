const { sequelize } = require('../database/connection');
const { Sale } = require('../database/models');
const fs = require('fs');
const path = require('path');

async function updateExistingSalesWithExchangeRate() {
    try {
        await sequelize.sync();

        // Read settings to get exchange rate
        const settingsPath = path.join(__dirname, '../data/settings.json');
        let exchangeRate = 354.8; // Default fallback

        try {
            const settingsData = fs.readFileSync(settingsPath, 'utf-8');
            const settings = JSON.parse(settingsData);
            // Assuming settings structure, try to get rate for user "2"
            if (settings['2'] && settings['2'].exchangeRate) {
                exchangeRate = settings['2'].exchangeRate;
            }
        } catch (e) {
            console.log('Could not read settings, using default exchange rate:', exchangeRate);
        }

        console.log(`Using exchange rate: ${exchangeRate}`);

        // Find all sales without exchangeRate
        const sales = await Sale.findAll();

        let updatedCount = 0;
        let skippedCount = 0;

        for (const sale of sales) {
            if (!sale.exchangeRate || sale.exchangeRate === null) {
                await sale.update({ exchangeRate: exchangeRate });
                console.log(`✅ Updated sale ${sale.id} with exchangeRate=${exchangeRate}`);
                updatedCount++;
            } else {
                skippedCount++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`📊 RESUMEN:`);
        console.log(`   ✅ Ventas actualizadas: ${updatedCount}`);
        console.log(`   ⏭️  Ventas omitidas (ya tenían exchangeRate): ${skippedCount}`);
        console.log(`   📦 Total procesado: ${sales.length}`);
        console.log('='.repeat(60));

        await sequelize.close();
        console.log('\n✨ Proceso completado exitosamente.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error actualizando ventas:', error);
        await sequelize.close();
        process.exit(1);
    }
}

updateExistingSalesWithExchangeRate();
