// Script to reset admin password to "admin"
const bcrypt = require('bcryptjs');

async function main() {
    const newPassword = 'admin';
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    console.log('Bcrypt hash for password "admin":');
    console.log(hashedPassword);
    console.log('\nRun this SQL command to update:');
    console.log(`UPDATE "Users" SET password = '${hashedPassword}' WHERE email = 'mrivero105@gmail.com';`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
