export async function onRequestGet(context) {
    try {
        const users = await context.env.DB.prepare("SELECT * FROM users").all();
        const products = await context.env.DB.prepare("SELECT * FROM products").all();

        // Check table info
        const tableInfo = await context.env.DB.prepare("PRAGMA table_info(users)").all();

        return new Response(JSON.stringify({
            users: users.results,
            products: products.results,
            user_columns: tableInfo.results,
            db_binding: "OK"
        }, null, 2), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestPost(context) {
    try {
        const db = context.env.DB;

        // 1. Ensure schema (Fix missing columns)
        const tables = ['users', 'products', 'sales', 'sale_items', 'customers']; // Add others as needed

        try {
            await db.prepare("ALTER TABLE users ADD COLUMN businessInfo TEXT").run();
        } catch (e) { }

        try {
            await db.prepare("ALTER TABLE users ADD COLUMN status TEXT").run();
        } catch (e) { }

        try {
            // PRODUCTS needs userId
            await db.prepare("ALTER TABLE products ADD COLUMN userId TEXT").run();
            // Backfill attempts
            const admin = await db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").first();
            if (admin) {
                await db.prepare("UPDATE products SET userId = ? WHERE userId IS NULL").bind(admin.id).run();
            }
        } catch (e) {
            // Might exist, ensuring backfill anyway
            const admin = await db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").first();
            if (admin) {
                await db.prepare("UPDATE products SET userId = ? WHERE userId IS NULL").bind(admin.id).run();
            }
        }

        try {
            // SALES needs userId (it likely has it, but good to ensure)
            await db.prepare("ALTER TABLE sales ADD COLUMN userId TEXT").run();
            const admin = await db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").first();
            if (admin) {
                await db.prepare("UPDATE sales SET userId = ? WHERE userId IS NULL").bind(admin.id).run();
            }
        } catch (e) { }

        try {
            // CUSTOMERS needs userId
            await db.prepare("ALTER TABLE customers ADD COLUMN userId TEXT").run();
        } catch (e) { }

        // SUPPLIERS & PURCHASE ORDERS - Create if not exist
        try {
            await db.prepare(`CREATE TABLE IF NOT EXISTS suppliers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                contact TEXT,
                phone TEXT,
                email TEXT,
                address TEXT,
                userId TEXT
            )`).run();

            await db.prepare(`CREATE TABLE IF NOT EXISTS purchase_orders (
                id TEXT PRIMARY KEY,
                supplierId TEXT NOT NULL,
                date TEXT NOT NULL, /* ISO string */
                status TEXT NOT NULL, /* pending, completed, cancelled */
                total REAL NOT NULL,
                items TEXT, /* JSON string of items */
                userId TEXT
            )`).run();
        } catch (e) {
            console.error("Error creating tables:", e);
        }

        try {
            // PRODUCTS needs userId - CRITICAL FOR DASHBOARD
            await db.prepare("ALTER TABLE products ADD COLUMN userId TEXT").run();
        } catch (e) { }

        // MIGRATION: Re-assign all data from 'admin-id-123' to 'user-1' (mrivero105)
        // This fixes the "empty view" issue where data exists but belongs to the wrong user
        try {
            await db.prepare("UPDATE sales SET userId = 'user-1' WHERE userId = 'admin-id-123'").run();
            await db.prepare("UPDATE customers SET userId = 'user-1' WHERE userId = 'admin-id-123'").run();
            await db.prepare("UPDATE products SET userId = 'user-1' WHERE userId = 'admin-id-123'").run();
        } catch (e) {
            console.log("Error reassigning data", e);
        }

        // Backfill remaining NULLs just in case
        const admin = await db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").first();
        if (admin) {
            await db.prepare("UPDATE customers SET userId = ? WHERE userId IS NULL").bind(admin.id).run();
            await db.prepare("UPDATE sales SET userId = ? WHERE userId IS NULL").bind(admin.id).run();
        }

        // 2. Seed Admin User
        // Check if exists first
        const existingAdmin = await db.prepare("SELECT * FROM users WHERE email = 'admin@test.com'").first();
        if (!existingAdmin) {
            await db.prepare(
                `INSERT INTO users (id, email, password, role, businessInfo) 
                 VALUES (?, ?, ?, ?, ?)`
            ).bind(
                'admin-id-123',
                'admin@test.com',
                '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', // '123456' hashed
                'admin',
                JSON.stringify({ currency: 'USD' })
            ).run();
        }

        // 3. Seed Products
        const count = await db.prepare("SELECT COUNT(*) as c FROM products").first();
        if (count.c === 0) {
            await db.batch([
                db.prepare("INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, userId) VALUES ('prod-1', 'Harina PAN', 1.5, 60.0, 100, 'Alimentos', '7591001', '', 'admin-id-123')"),
                db.prepare("INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, userId) VALUES ('prod-2', 'Arroz Mary', 1.2, 48.0, 50, 'Alimentos', '7591002', '', 'admin-id-123')"),
                db.prepare("INSERT INTO products (id, name, price, priceBs, stockQuantity, category, barcode, imageUri, userId) VALUES ('prod-3', 'Pasta Primor', 1.8, 72.0, 80, 'Alimentos', '7591003', '', 'admin-id-123')")
            ]);
        }

        return new Response(JSON.stringify({ message: "Seeding completed" }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
