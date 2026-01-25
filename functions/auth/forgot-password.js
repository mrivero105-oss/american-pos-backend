// POST /auth/forgot-password
// Generates a password reset token and sends email via Resend

export async function onRequestPost(context) {
    // Fallback while Cloudflare env vars propagate
    const RESEND_API_KEY = context.env.RESEND_API_KEY || 're_jNoKENNw_GuprZeDypnSJL9b8SuC4mJjm';
    const FRONTEND_URL = context.env.FRONTEND_URL || 'https://american-pos.pages.dev';

    try {
        const { email } = await context.request.json();

        if (!email) {
            return new Response(JSON.stringify({ error: "Email is required" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check if user exists
        const { results } = await context.env.DB.prepare(
            "SELECT id, name, email FROM users WHERE email = ?"
        ).bind(email).all();

        const user = results[0];

        // Always return success to prevent email enumeration attacks
        if (!user) {
            return new Response(JSON.stringify({
                success: true,
                message: "Si el correo existe, recibirás instrucciones para restablecer tu contraseña."
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Generate reset token (random 32 bytes as hex)
        const resetToken = generateRandomToken();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

        // Check if password_resets table exists, if not create it
        try {
            await context.env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS password_resets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    expires_at TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `).run();
        } catch (e) {
            // Table might already exist, continue
        }

        // Delete any existing tokens for this user
        await context.env.DB.prepare(
            "DELETE FROM password_resets WHERE user_id = ?"
        ).bind(user.id).run();

        // Insert new reset token
        await context.env.DB.prepare(
            "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)"
        ).bind(user.id, resetToken, expiresAt).run();

        // Build reset URL
        const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${resetToken}`;

        // Send email via Resend
        if (RESEND_API_KEY) {
            try {
                const emailResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'American POS <onboarding@resend.dev>',
                        to: [email],
                        subject: 'Restablecer Contraseña - American POS',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                                <div style="text-align: center; margin-bottom: 30px;">
                                    <h1 style="color: #4F46E5; margin: 0;">American POS</h1>
                                </div>
                                
                                <h2 style="color: #1F2937;">Hola ${user.name || 'Usuario'},</h2>
                                
                                <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">
                                    Recibimos una solicitud para restablecer la contraseña de tu cuenta.
                                    Si no realizaste esta solicitud, puedes ignorar este mensaje.
                                </p>
                                
                                <div style="text-align: center; margin: 30px 0;">
                                    <a href="${resetUrl}" 
                                       style="background-color: #4F46E5; color: white; padding: 14px 28px; 
                                              text-decoration: none; border-radius: 8px; font-weight: bold;
                                              display: inline-block;">
                                        Restablecer Contraseña
                                    </a>
                                </div>
                                
                                <p style="color: #6B7280; font-size: 14px;">
                                    O copia y pega este enlace en tu navegador:<br>
                                    <a href="${resetUrl}" style="color: #4F46E5; word-break: break-all;">${resetUrl}</a>
                                </p>
                                
                                <p style="color: #9CA3AF; font-size: 12px; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 20px;">
                                    Este enlace expirará en 1 hora por seguridad.<br>
                                    Si no solicitaste este cambio, ignora este correo.
                                </p>
                            </div>
                        `
                    })
                });

                const emailResult = await emailResponse.json();
                console.log('Email sent:', emailResult);

                if (!emailResponse.ok) {
                    console.error('Resend API error:', emailResult);
                }
            } catch (emailError) {
                console.error('Error sending email:', emailError);
                // Don't expose email errors to the user
            }
        } else {
            console.warn('RESEND_API_KEY not configured, email not sent');
            console.log('Reset URL would be:', resetUrl);
        }

        return new Response(JSON.stringify({
            success: true,
            message: "Si el correo existe, recibirás instrucciones para restablecer tu contraseña."
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        return new Response(JSON.stringify({ error: "Error processing request" }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Generate a random token
function generateRandomToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
