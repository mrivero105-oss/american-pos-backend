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

        // 1. Ensure schema (Fix missing column)
        try {
            await db.prepare("ALTER TABLE users ADD COLUMN businessInfo TEXT").run();
        } catch (e) {
            // Ignore if column exists
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
