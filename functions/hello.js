export async function onRequest(context) {
    try {
        const db = context.env.DB;
        const tables = ['products', 'sales', 'sale_items', 'sales_items', 'customers'];
        const schema = {};

        for (const table of tables) {
            try {
                const info = await db.prepare(`PRAGMA table_info(${table})`).all();
                schema[table] = info.results;
            } catch (e) {
                schema[table] = { error: e.message };
            }
        }

        return new Response(JSON.stringify(schema, null, 2), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(e.message, { status: 500 });
    }
}
