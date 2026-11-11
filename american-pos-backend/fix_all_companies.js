const { Client } = require('pg');
const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'americanpos' });

(async () => {
  await client.connect();
  const u = await client.query('UPDATE "Users" SET "companyId" = \'2\' WHERE "companyId" != \'2\' OR "companyId" IS NULL');
  console.log('Updated Users count:', u.rowCount);
  const a = await client.query('UPDATE "AuditLogs" SET "companyId" = \'2\' WHERE "companyId" != \'2\' OR "companyId" IS NULL');
  console.log('Updated AuditLogs count:', a.rowCount);
  const b = await client.query('UPDATE "Branches" SET "companyId" = \'2\' WHERE "companyId" != \'2\' OR "companyId" IS NULL');
  console.log('Updated Branches count:', b.rowCount);
  const m = await client.query('UPDATE "CashMovements" SET "companyId" = \'2\' WHERE "companyId" != \'2\' OR "companyId" IS NULL');
  console.log('Updated CashMovements count:', m.rowCount);
  const s = await client.query('UPDATE "CashShifts" SET "companyId" = \'2\' WHERE "companyId" != \'2\' OR "companyId" IS NULL');
  console.log('Updated CashShifts count:', s.rowCount);
  
  const users = await client.query('SELECT id, username, name, role, "companyId" FROM "Users"');
  console.log('All Users now:');
  console.table(users.rows);
  await client.end();
})();
