const { sequelize } = require('./connection');
const models = require('./models/index');

// ADD INDEXES FOR PERFORMANCE
// Note: We define these after the models are initialized
models.Product.addHook('afterSync', async () => {
    try {
        await sequelize.query('CREATE INDEX IF NOT EXISTS idx_products_company ON Products(companyId)');
        await sequelize.query('CREATE INDEX IF NOT EXISTS idx_products_name ON Products(name)');
        await sequelize.query('CREATE INDEX IF NOT EXISTS idx_products_barcode ON Products(barcode)');
    } catch (e) {
        // console.warn('Index creation skipped or already exists');
    }
});

module.exports = {
    sequelize,
    ...models
};
