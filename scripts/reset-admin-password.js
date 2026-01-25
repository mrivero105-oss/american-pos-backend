// Script to reset admin password to "admin"
import bcrypt from 'bcryptjs';

const newPassword = 'admin';
const hashedPassword = await bcrypt.hash(newPassword, 10);

console.log('Bcrypt hash for password "admin":');
console.log(hashedPassword);
console.log('\nRun this SQL command to update:');
console.log(`UPDATE users SET password = '${hashedPassword}' WHERE email = 'mrivero105@gmail.com';`);
