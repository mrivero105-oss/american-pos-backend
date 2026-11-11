const { Client } = require('pg');

async function fixPostgresCompanyId() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'americanpos'
  });
  try {
    await client.connect();
    console.log('Connected to PG');
    
    // Update Users where companyId = 'admin' to '2'
    const resUsers = await client.query(`UPDATE "Users" SET "companyId" = '2' WHERE "companyId" = 'admin'`);
    console.log('Updated Users:', resUsers.rowCount);

    // Update AuditLogs where companyId = 'admin' to '2'
    const resAudit = await client.query(`UPDATE "AuditLogs" SET "companyId" = '2' WHERE "companyId" = 'admin'`);
    console.log('Updated AuditLogs:', resAudit.rowCount);

    // Verify Users
    const users = await client.query('SELECT id, username, email, role, "companyId" FROM "Users"');
    console.log('Users now:', users.rows);

    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
}

fixPostgresCompanyId();
