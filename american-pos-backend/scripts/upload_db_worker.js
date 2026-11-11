let db;
try {
    db = require('../db.json');
} catch (e) {
    db = {};
}

module.exports = {
    async fetch(request, env) {
        if (!env.DB) return new Response('DB binding not found', { status: 500 });

        try {
            const value = JSON.stringify(db);
            const stmt = env.DB.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').bind('db', value);
            await stmt.run();
            return new Response('Database uploaded successfully!');
        } catch (e) {
            return new Response('Error: ' + e.message, { status: 500 });
        }
    }
};
