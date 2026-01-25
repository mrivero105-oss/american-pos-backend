const { sequelize } = require('../database/connection');
const { Product } = require('../database/models');

async function updateProductCosts() {
    try {
        console.log('🔄 Iniciando actualización de costos de productos...\n');

        // Obtener todos los productos
        const products = await Product.findAll();
        console.log(`📦 Total de productos encontrados: ${products.length}\n`);

        let updatedCount = 0;
        let skippedCount = 0;

        for (const product of products) {
            // Validar que el producto tenga precio válido
            if (!product.price || isNaN(product.price) || product.price <= 0) {
                console.log(`⚠️  ${product.name} - Sin precio válido (Precio: ${product.price}), omitiendo...`);
                skippedCount++;
                continue;
            }

            // Si el producto no tiene costo o el costo es 0, calcularlo
            if (!product.cost || product.cost === 0) {
                const calculatedCost = product.price * 0.70; // 30% de margen

                await product.update({
                    cost: calculatedCost
                });

                console.log(`✅ ${product.name}`);
                console.log(`   Precio: $${product.price.toFixed(2)} → Costo calculado: $${calculatedCost.toFixed(2)} (Margen: 30%)`);
                updatedCount++;
            } else {
                console.log(`⏭️  ${product.name} - Ya tiene costo: $${product.cost.toFixed(2)}`);
                skippedCount++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`📊 RESUMEN:`);
        console.log(`   ✅ Productos actualizados: ${updatedCount}`);
        console.log(`   ⏭️  Productos omitidos (ya tenían costo): ${skippedCount}`);
        console.log(`   📦 Total procesado: ${products.length}`);
        console.log('='.repeat(60));

        await sequelize.close();
        console.log('\n✨ Proceso completado exitosamente.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error actualizando costos:', error);
        await sequelize.close();
        process.exit(1);
    }
}

updateProductCosts();
