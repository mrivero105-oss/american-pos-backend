const { sequelize, Sale, SaleItem } = require('../database/models');

async function migrateSalesData() {
    try {
        console.log('🔄 Connecting to database for migration...');
        await sequelize.authenticate();

        console.log('📦 Syncing new Schema (creating SaleItems table)...');
        // Use alter:true to ensure SaleItem table is created without dropping Sales
        await sequelize.sync({ alter: true });

        console.log('🔍 Fetching all completed sales to migrate...');
        // We fetch all sales, even if they have been migrated previously
        // We will check if SaleItems already exist for a sale before migrating
        const sales = await Sale.findAll();
        console.log(`📊 Found ${sales.length} total sales in the database.`);

        let migratedCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const sale of sales) {
            try {
                // Check if items already exist for this sale to make migration idempotent
                const existingItems = await SaleItem.count({ where: { saleId: sale.id } });

                if (existingItems > 0) {
                    skipCount++;
                    continue;
                }

                if (!sale.items) {
                    continue; // Skip sales with no items data
                }

                let itemsArray = [];
                // Handle cases where items might be a stringified JSON instead of a true JSON object
                if (typeof sale.items === 'string') {
                    try {
                        itemsArray = JSON.parse(sale.items);
                    } catch (e) {
                        console.error(`⚠️ Could not parse items for sale ${sale.id}: ${e.message}`);
                        errorCount++;
                        continue;
                    }
                } else if (Array.isArray(sale.items)) {
                    itemsArray = sale.items;
                }

                if (itemsArray.length === 0) continue;

                const saleItemsToInsert = itemsArray.map(item => ({
                    saleId: sale.id,
                    productId: item.productId || item.id, // Fallback for differing frontend structures
                    name: item.name || 'Producto Desconocido',
                    quantity: item.quantity || 1,
                    price: item.price || 0,
                    subtotal: item.subtotal || ((item.price || 0) * (item.quantity || 1)),
                    category: item.category || 'General'
                }));

                await SaleItem.bulkCreate(saleItemsToInsert);
                migratedCount++;

                if (migratedCount % 100 === 0) {
                    console.log(`✅ Processed ${migratedCount} sales...`);
                }

            } catch (err) {
                console.error(`❌ Error migrating sale ${sale.id}:`, err);
                errorCount++;
            }
        }

        console.log('\n=======================================');
        console.log('🎉 MIGRATION COMPLETE 🎉');
        console.log(`🛒 Sales Migrated Successfully: ${migratedCount}`);
        console.log(`⏭️ Sales Skipped (Already Migrated): ${skipCount}`);
        console.log(`⚠️ Sales with Errors: ${errorCount}`);
        console.log('=======================================\n');

    } catch (error) {
        console.error('💥 CRITICAL MIGRATION ERROR:', error);
    } finally {
        await sequelize.close();
    }
}

migrateSalesData();
