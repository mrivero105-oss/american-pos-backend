const { sequelize } = require('./connection');
const models = require('./models/index');

if (models && models.Product && typeof models.Product.addHook === 'function') {
    models.Product.addHook('afterSync', async () => {
        try {
            const isPg = sequelize.getDialect() === 'postgres';
            const table = isPg ? '"Products"' : 'Products';
            const colCompany = isPg ? '"companyId"' : 'companyId';
            const colName = isPg ? '"name"' : 'name';
            const colBarcode = isPg ? '"barcode"' : 'barcode';
            await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_company ON ${table}(${colCompany})`);
            await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_name ON ${table}(${colName})`);
            await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON ${table}(${colBarcode})`);
        } catch (e) {
            // Index creation skipped or already exists
        }
    });
}

module.exports = {
    sequelize,
    ...models
};
