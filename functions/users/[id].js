import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

export async function onRequest(context) {
    const { request, env, params } = context;

    // CORS
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    const { id } = params;
    if (!id) {
        return new Response(JSON.stringify({ error: 'User ID required' }), { status: 400 });
    }

    // AUTH CHECK
    const user = context.data.user;
    if (!user || user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
    }

    if (request.method === 'DELETE') {
        try {
            const res = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
            if (res.success) {
                return new Response(JSON.stringify({ success: true }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } else {
                return new Response(JSON.stringify({ error: 'Failed to delete user' }), { status: 500 });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (request.method === 'PUT') {
        try {
            const data = await request.json();
            const updates = [];
            const values = [];

            if (data.email) { updates.push('email = ?'); values.push(data.email); }

            // Hash password with bcrypt if provided
            if (data.password) {
                const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
                updates.push('password = ?');
                values.push(hashedPassword);
            }

            if (data.role) { updates.push('role = ?'); values.push(data.role); }
            if (data.businessInfo) { updates.push('businessInfo = ?'); values.push(JSON.stringify(data.businessInfo)); }
            if (data.status) { updates.push('status = ?'); values.push(data.status); }
            if (data.trialExpiresAt !== undefined) { updates.push('trial_expires_at = ?'); values.push(data.trialExpiresAt); }

            if (updates.length === 0) {
                return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400 });
            }

            values.push(id);
            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;

            const res = await env.DB.prepare(query).bind(...values).run();

            if (res.success) {
                return new Response(JSON.stringify({ success: true }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            } else {
                return new Response(JSON.stringify({ error: 'Failed to update user' }), { status: 500 });
            }
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
