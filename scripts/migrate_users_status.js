const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../db.json');

try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(data);

    if (!db.users) {
        console.log('No users found in db.json');
        process.exit(0);
    }

    let updatedCount = 0;
    db.users = db.users.map(user => {
        let changed = false;
        if (!user.status) {
            user.status = 'active';
            changed = true;
        }
        // No default for trial_expires_at means infinite/admin
        if (changed) updatedCount++;
        return user;
    });

    if (updatedCount > 0) {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        console.log(`Successfully migrated ${updatedCount} users to status='active'.`);
    } else {
        console.log('All users already have a status.');
    }

} catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
}
