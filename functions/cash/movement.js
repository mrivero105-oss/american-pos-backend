export async function onRequestPost(context) {
    try {
        if (!context.env.DB) {
            return new Response(JSON.stringify({ error: "DB binding missing" }), { status: 500 });
        }

        const body = await context.request.json();

        // Check if shift is open
        const currentShift = await context.env.DB.prepare(
            "SELECT id FROM cash_shifts WHERE status = 'open' LIMIT 1"
        ).first();

        if (!currentShift) {
            return new Response(JSON.stringify({ message: 'Debe abrir la caja primero' }), { status: 400 });
        }

        const newMovement = {
            id: Date.now().toString(),
            shiftId: currentShift.id,
            type: body.type, // 'in' or 'out'
            amount: parseFloat(body.amount),
            reason: body.reason,
            timestamp: new Date().toISOString()
        };

        await context.env.DB.prepare(
            `INSERT INTO cash_movements (id, shiftId, type, amount, reason, timestamp) 
         VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
            newMovement.id,
            newMovement.shiftId,
            newMovement.type,
            newMovement.amount,
            newMovement.reason,
            newMovement.timestamp
        ).run();

        return new Response(JSON.stringify(newMovement), {
            status: 201,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
