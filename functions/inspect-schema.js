export async function onRequest(context) {
    try {
        const db = context.env.DB;
        const saleItemsInfo = await db.prepare("PRAGMA table_info(sale_items)").all();

        return new Response(JSON.stringify({
            sale_items: saleItemsInfo.results
        }, null, 2), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e) {
        return new Response(e.message, { status: 500 });
    }
}
