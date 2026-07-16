const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const destDB = new Sequelize(
    process.env.DB_NAME || 'americanpos',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false
    }
);

async function verify() {
    try {
        const [products] = await destDB.query('SELECT COUNT(*) as count FROM "Products"');
        const [sales] = await destDB.query('SELECT COUNT(*) as count FROM "Sales"');
        console.log(`VERIFICACION_EXITOSA`);
        console.log(`PRODUCTOS: ${products[0].count}`);
        console.log(`VENTAS: ${sales[0].count}`);
        process.exit(0);
    } catch (e) {
        console.error('ERROR_VERIFICACION:', e.message);
        process.exit(1);
    }
}

verify();
