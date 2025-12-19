export async function onRequest(context) {
    try {
        const db = context.env.DB;
        if (!db) return new Response("DB missing", { status: 500 });

        // Disable FKs for restoration
        await db.prepare("PRAGMA foreign_keys = OFF").run();

        // 1. Fetch backup
        const backupUrl = "http://localhost:8080/products_backup.json";
        const response = await fetch(backupUrl);
        if (!response.ok) {
            return new Response(`Failed to fetch backup: ${response.statusText}`, { status: 500 });
        }
        const backupData = await response.json();
        const customers = backupData.db?.customers || [];
        const sales = backupData.db?.sales || [];
        const settings = backupData.settings;

        // 2. Find User
        const email = "mrivero105@gmail.com";
        const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
        if (!user) {
            return new Response("User mrivero105@gmail.com not found", { status: 404 });
        }
        const userId = user.id;

        // 3. Clear existing data 
        await db.prepare("DELETE FROM sale_items").run();
        await db.prepare("DELETE FROM sales").run();
        await db.prepare("DELETE FROM customers").run();

        // 4. Restore Customers
        let customerSuccess = 0;
        const customerStmt = db.prepare(
            "INSERT INTO customers (id, name, idDocument, phone, email, address, userId) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );

        if (customers.length > 0) {
            const batch = [];
            for (const c of customers) {
                batch.push(customerStmt.bind(
                    c.id,
                    c.name,
                    c.idDocument || '',
                    c.phone || '',
                    c.email || '',
                    c.address || '',
                    userId
                ));
            }
            const CHUNK = 50;
            for (let i = 0; i < batch.length; i += CHUNK) {
                await db.batch(batch.slice(i, i + CHUNK));
            }
            customerSuccess = customers.length;
        }

        // 4b. Insert Placeholder Products for Sales (Fix Broken FKs)
        const referencedProductIds = new Set();
        sales.forEach(s => {
            if (s.items) {
                s.items.forEach(i => {
                    const pid = i.id || i.productId;
                    if (pid) referencedProductIds.add(pid);
                });
            }
        });

        if (referencedProductIds.size > 0) {
            const productPlaceholderStmt = db.prepare(
                `INSERT OR IGNORE INTO products (id, name, price, stock, userId, category, barcode, imageUri, isCustom, isSoldByWeight) 
                 VALUES (?, 'Producto (Restaurado)', 0, 0, ?, 'General', '', '', 0, 0)`
            );
            const batch = [];
            for (const pid of referencedProductIds) {
                batch.push(productPlaceholderStmt.bind(pid, userId));
            }
            const CHUNK = 50;
            for (let i = 0; i < batch.length; i += CHUNK) {
                await db.batch(batch.slice(i, i + CHUNK));
            }
        }

        // 5. Restore Sales
        let salesSuccess = 0;
        let itemsSuccess = 0;
        const salesErrors = [];

        const exchangeRate = settings?.exchangeRate || 1;

        for (const s of sales) {
            try {
                await db.prepare(
                    "INSERT INTO sales (id, timestamp, total, paymentMethod, customerId, userId, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).bind(
                    s.id,
                    s.timestamp,
                    s.total,
                    s.paymentMethod || 'cash',
                    s.customerId || null,
                    userId,
                    s.exchangeRate || exchangeRate
                ).run();
                salesSuccess++;

                // Insert Items
                if (s.items && s.items.length > 0) {
                    const itemStmts = s.items.map(item => {
                        return db.prepare(
                            "INSERT INTO sale_items (saleId, productId, name, price, quantity) VALUES (?, ?, ?, ?, ?)"
                        ).bind(
                            s.id,
                            item.id || item.productId,
                            item.name,
                            item.price,
                            item.quantity
                        );
                    });
                    await db.batch(itemStmts);
                    itemsSuccess += s.items.length;
                }
            } catch (err) {
                salesErrors.push({ id: s.id, error: err.message });
                console.error(`Failed sale ${s.id}:`, err);
            }
        }

        // Restore Settings (Business Info)
        if (settings && settings.businessInfo) {
            await db.prepare("UPDATE users SET businessInfo = ? WHERE id = ?").bind(
                JSON.stringify(settings.businessInfo),
                userId
            ).run();
        }

        return new Response(JSON.stringify({
            message: "Restore Full Completed",
            customers: customerSuccess,
            sales: salesSuccess,
            saleItems: itemsSuccess,
            userId: userId,
            salesErrors: salesErrors
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
    }
}
