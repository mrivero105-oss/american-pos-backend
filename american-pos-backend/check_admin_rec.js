const { Client } = require('pg');

async function checkAdminRecords() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'americanpos'
  });
  try {
    await client.connect();
    const tables = ['Sales', 'Products', 'CashShifts', 'Expenses', 'AuditLogs', 'Customers'];
    for (const t of tables) {
      try {
        const byUser = await client.query(`SELECT count(*) FROM "${t}" WHERE "userId" = 'admin'`);
        const byComp = await client.query(`SELECT count(*) FROM "${t}" WHERE "companyId" = 'admin'`);
        console.log(`${t} with userId='admin':`, byUser.rows[0].count, `with companyId='admin':`, byComp.rows[0].count);
      } catch (e) {
        console.log(t, e.message);
      }
    }
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
}

checkAdminRecords();
