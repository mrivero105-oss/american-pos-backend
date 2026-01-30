const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../database/models');

const AUTH_SECRET = process.env.JWT_SECRET || 'american-pos-secret-2025';

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const sanitizedEmail = email ? email.trim().toLowerCase() : '';

    if (!sanitizedEmail || !password) {
        return res.status(400).json({ error: 'Faltan credenciales' });
    }

    try {
        const authenticatedUser = await User.findOne({
            where: { email: sanitizedEmail }
        });

        if (authenticatedUser) {
            let isMatch = false;
            const currentPassword = authenticatedUser.password || '';

            if (currentPassword.startsWith('$2') || currentPassword.length > 30) {
                isMatch = await bcrypt.compare(password, currentPassword);
            } else {
                isMatch = (currentPassword === password);
                if (isMatch && password) {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    await authenticatedUser.update({ password: hashedPassword });
                    console.log(`Password upgraded to hash for user: ${email}`);
                }
            }

            if (isMatch) {
                const { password: _, ...userWithoutPassword } = authenticatedUser.toJSON();

                const token = jwt.sign(
                    { id: authenticatedUser.id, email: authenticatedUser.email, role: authenticatedUser.role },
                    AUTH_SECRET,
                    { expiresIn: '30d' }
                );

                res.json({
                    success: true,
                    token: token,
                    user: userWithoutPassword
                });
            } else {
                res.status(401).json({ error: 'Credenciales inválidas' });
            }
        } else {
            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
