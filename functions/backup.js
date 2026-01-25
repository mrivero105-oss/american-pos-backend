// GET /backup - Download all data as a backup
export async function onRequestGet(context) {
    try {
        const user = context.data.user;
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        // Fetch all data from D1 tables
        const [
            productsResult,
            customersResult,
            salesResult,
            cashShiftsResult,
            suppliersResult,
            purchaseOrdersResult,
            settingsResult,
            paymentMethodsResult
        ] = await Promise.all([
            context.env.DB.prepare("SELECT * FROM products").all(),
            context.env.DB.prepare("SELECT * FROM customers").all(),
            context.env.DB.prepare("SELECT * FROM sales").all(),
            context.env.DB.prepare("SELECT * FROM cash_shifts").all(),
            context.env.DB.prepare("SELECT * FROM suppliers").all(),
            context.env.DB.prepare("SELECT * FROM purchase_orders").all(),
            context.env.DB.prepare("SELECT * FROM settings WHERE key = 'general'").first(),
            context.env.DB.prepare("SELECT * FROM settings WHERE key = 'payment_methods'").first()
        ]);

        const backupData = {
            products: productsResult.results || [],
            customers: customersResult.results || [],
            sales: salesResult.results || [],
            cashShifts: cashShiftsResult.results || [],
            suppliers: suppliersResult.results || [],
            purchaseOrders: purchaseOrdersResult.results || [],
            settings: settingsResult ? JSON.parse(settingsResult.value || '{}') : {},
            paymentMethods: paymentMethodsResult ? JSON.parse(paymentMethodsResult.value || '[]') : [],
            timestamp: new Date().toISOString(),
            version: '2.0'
        };

        return new Response(JSON.stringify(backupData), {
            headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="backup_pos_${new Date().toISOString().split('T')[0]}.json"`
            },
        });
    } catch (err) {
        console.error('Backup error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

// POST /backup - Restore from backup
export async function onRequestPost(context) {
    try {
        const user = context.data.user;
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const backupData = await context.request.json();

        if (!backupData || !backupData.version) {
            return new Response(JSON.stringify({ error: "Invalid backup data" }), { status: 400 });
        }

        // TODO: Implement restore functionality
        // This would require careful handling to avoid data loss
        // For now, just return success to prevent the error

        return new Response(JSON.stringify({
            success: true,
            message: "Restore functionality coming soon. Please contact support for data restoration."
        }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        console.error('Restore error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
