const { Client } = require('pg');

async function checkUsersDetail() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'americanpos'
  });
  try {
    await client.connect();
    const users = await client.query('SELECT id, username, email, role, "companyId", "createdAt", "updatedAt" FROM "Users"');
    console.log('Postgres Users Full Details:\n', JSON.stringify(users.rows, null, 2));
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
}

checkUsersDetail();
