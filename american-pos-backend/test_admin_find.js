const { User } = require('./database/models');

async function testAdmin() {
  const adminUser = await User.findOne({ where: { role: 'superadmin' } });
  console.log('adminUser without order:', adminUser ? { id: adminUser.id, username: adminUser.username, companyId: adminUser.companyId } : null);
}

testAdmin().then(() => process.exit(0));
