// Refunds endpoint - Handle product returns and restore stock

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();
        const { saleId, items, reason } = body;

        if (!saleId || !items || !Array.isArray(items) || items.length === 0) {
            return new Response(JSON.stringify({ error: 'Invalid refund data' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get user from context (set by middleware)
        const userId = context.userId;

        // Calculate total refund amount
        let totalRefund = 0;
        for (const item of items) {
            totalRefund += (item.price || 0) * (item.quantity || 0);
        }

        // Create refund record
        const refundId = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await env.DB.prepare(`
            INSERT INTO refunds (id, saleId, items, reason, totalAmount, userId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            refundId,
            saleId,
            JSON.stringify(items),
            reason || 'No especificado',
            totalRefund,
            userId || 'system'
        ).run();

        // Restore stock for each refunded item
        for (const item of items) {
            if (item.id && item.quantity) {
                await env.DB.prepare(`
                    UPDATE products 
                    SET stockQuantity = stockQuantity + ?
                    WHERE id = ?
                `).bind(item.quantity, item.id).run();
            }
        }

        return new Response(JSON.stringify({
            success: true,
            refundId,
            totalRefund,
            message: 'Devolución procesada correctamente'
        }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Refund error:', error);
        return new Response(JSON.stringify({ error: 'Error processing refund: ' + error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Get all refunds
export async function onRequestGet(context) {
    try {
        const { env } = context;
        const userId = context.userId;

        const result = await env.DB.prepare(`
            SELECT * FROM refunds 
            WHERE userId = ? 
            ORDER BY createdAt DESC
        `).bind(userId).all();

        return new Response(JSON.stringify(result.results || []), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Get refunds error:', error);
        return new Response(JSON.stringify({ error: 'Error fetching refunds' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
