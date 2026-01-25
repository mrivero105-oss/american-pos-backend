export async function onRequestPut(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const id = context.params.id;
        const updates = await context.request.json();

        // DEBUG: Log received fields
        const receivedFields = Object.keys(updates);
        const imageUriLength = updates.imageUri ? updates.imageUri.length : 0;
        console.log(`[PUT /products/${id}] Received fields:`, receivedFields, `imageUri length: ${imageUriLength}`);

        // Map frontend field names to database column names
        const fieldMapping = {
            'stock': 'stockQuantity',  // Frontend sends 'stock', DB uses 'stockQuantity'
        };

        // Valid columns in the products table (to filter out unknown fields)
        const validColumns = [
            'name', 'price', 'priceBs', 'stockQuantity', 'category',
            'barcode', 'imageUri', 'isCustom', 'isSoldByWeight'
        ];

        // Transform updates to use correct DB column names and filter invalid fields
        const transformedUpdates = {};
        for (const [key, value] of Object.entries(updates)) {
            // Skip internal fields
            if (key === 'id' || key === 'userId') continue;

            // Map field names
            const dbKey = fieldMapping[key] || key;

            // Only include valid columns
            if (validColumns.includes(dbKey)) {
                transformedUpdates[dbKey] = value;
            }
        }

        // DEBUG: Log transformed fields
        const transformedFields = Object.keys(transformedUpdates);
        console.log(`[PUT /products/${id}] Transformed fields:`, transformedFields);

        // Construct dynamic update query
        const keys = Object.keys(transformedUpdates);
        if (keys.length === 0) return new Response("No updates provided", { status: 400 });

        const setClause = keys.map(k => `${k} = ?`).join(", ");
        const values = keys.map(k => {
            if (k === 'isCustom' || k === 'isSoldByWeight') return transformedUpdates[k] ? 1 : 0;
            return transformedUpdates[k];
        });
        values.push(id);

        const query = `UPDATE products SET ${setClause} WHERE id = ?`;
        console.log(`[PUT /products/${id}] Query: ${query}`);

        const info = await context.env.DB.prepare(query).bind(...values).run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({
                message: "Product updated",
                debug: {
                    receivedFields,
                    transformedFields,
                    imageUriLength,
                    changes: info.meta.changes
                }
            }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Product not found or unauthorized" }), { status: 404 });
        }
    } catch (err) {
        console.error(`[PUT /products] Error:`, err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}

export async function onRequestDelete(context) {
    try {
        const user = context.data.user;
        if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const id = context.params.id;
        // Verify ownership
        const info = await context.env.DB.prepare("DELETE FROM products WHERE id = ?")
            .bind(id)
            .run();

        if (info.meta.changes > 0) {
            return new Response(JSON.stringify({ message: "Product deleted" }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "Product not found or unauthorized" }), { status: 404 });
        }
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
