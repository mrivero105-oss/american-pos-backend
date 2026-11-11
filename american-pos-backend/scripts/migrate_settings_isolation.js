const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../settings.json');
const PAYMENT_METHODS_FILE = path.join(__dirname, '../payment_methods.json');
const ADMIN_ID = 'admin-1';

// Migrate Settings
try {
    if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(data);

        // Check if already migrated (if keys look like user IDs or if it has 'admin-1')
        // Heuristic: valid settings has 'exchangeRate', migrated has user keys.
        // Or check if 'admin-1' exists.

        if (!settings[ADMIN_ID] && settings.exchangeRate !== undefined) {
            console.log('Migrating settings.json to multi-tenant structure...');
            const newSettings = {
                [ADMIN_ID]: settings
            };
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
            console.log('Settings migrated.');
        } else {
            console.log('Settings already migrated or empty.');
        }
    }
} catch (e) {
    console.error('Settings migration failed:', e);
}

// Migrate Payment Methods
try {
    if (fs.existsSync(PAYMENT_METHODS_FILE)) {
        const data = fs.readFileSync(PAYMENT_METHODS_FILE, 'utf8');
        let methods = JSON.parse(data);

        let updatedCount = 0;
        methods = methods.map(m => {
            if (!m.userId) {
                m.userId = ADMIN_ID;
                updatedCount++;
            }
            return m;
        });

        if (updatedCount > 0) {
            console.log(`Migrating ${updatedCount} payment methods to admin...`);
            fs.writeFileSync(PAYMENT_METHODS_FILE, JSON.stringify(methods, null, 2));
            console.log('Payment methods migrated.');
        } else {
            console.log('Payment methods already have userId.');
        }
    }
} catch (e) {
    console.error('Payment methods migration failed:', e);
}
