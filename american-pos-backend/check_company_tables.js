const { Client } = require('pg');
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'americanpos' });

(async () => {
  await client.connect();
  const res = await client.query("SELECT table_name FROM information_schema.columns WHERE column_name = 'companyId' AND table_schema = 'public'");
  console.log('Tables with companyId:', res.rows.map(r => r.table_name));
  for (const row of res.rows) {
    const t = row.table_name;
    const c = await client.query(`SELECT count(*) FROM "${t}" WHERE "companyId" = $1`, ['b319a408-a6cb-4b78-9ed8-5048afd875ea']);
    if (parseInt(c.rows[0].count) > 0) {
      console.log(`Table "${t}" has ${c.rows[0].count} records with companyId b319a408...`);
    }
  }
  await client.end();
})();
