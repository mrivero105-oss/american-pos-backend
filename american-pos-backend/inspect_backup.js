const fs = require('fs');

const f = 'C:/Users/mrive/AppData/Roaming/isaac-pos/auto-backups/backup_pg_2026-09-19T03-40-43.json';
const data = JSON.parse(fs.readFileSync(f, 'utf8'));

console.log('Tables in backup:', Object.keys(data));
if (data.Products) {
  console.log('Products count in backup:', data.Products.length);
  console.log('Products sample in backup:', data.Products.slice(0, 3));
}
if (data.Settings) {
  console.log('Settings in backup:', data.Settings);
}
