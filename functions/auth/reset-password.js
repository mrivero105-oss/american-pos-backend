// POST /auth/reset-password
// Verifies token and updates password

import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

export async function onRequestPost(context) {
    try {
        const { token, password } = await context.request.json();

        if (!token || !password) {
            return new Response(JSON.stringify({ error: "Token y contraseña son requeridos" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return new Response(JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Find valid reset token
        const { results } = await context.env.DB.prepare(`
            SELECT pr.*, u.email, u.name 
            FROM password_resets pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.token = ? AND pr.used = 0 AND pr.expires_at > datetime('now')
        `).bind(token).all();

        const resetRequest = results[0];

        if (!resetRequest) {
            return new Response(JSON.stringify({
                error: "El enlace de recuperación ha expirado o ya fue utilizado. Por favor solicita uno nuevo."
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Hash new password with bcrypt
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // Update user password
        await context.env.DB.prepare(
            "UPDATE users SET password = ? WHERE id = ?"
        ).bind(hashedPassword, resetRequest.user_id).run();

        // Mark token as used
        await context.env.DB.prepare(
            "UPDATE password_resets SET used = 1 WHERE id = ?"
        ).bind(resetRequest.id).run();

        // Clean up old tokens for this user
        await context.env.DB.prepare(
            "DELETE FROM password_resets WHERE user_id = ? AND id != ?"
        ).bind(resetRequest.user_id, resetRequest.id).run();

        console.log(`Password reset successful for user: ${resetRequest.email}`);

        return new Response(JSON.stringify({
            success: true,
            message: "Contraseña actualizada correctamente. Ya puedes iniciar sesión."
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Reset password error:', error);
        return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
