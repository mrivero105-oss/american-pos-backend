const express = require('express');
const router = express.Router();
const { Message, User } = require('../database/models');
const { Op } = require('sequelize');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configurar directorio de subida
const baseDir = process.env.USER_DATA_PATH || require('os').tmpdir();
const uploadDir = path.join(baseDir, 'public', 'uploads', 'messages');

try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (e) {
    console.error('No se pudo crear uploadDir para messages:', e.message);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no permitido. Solo imágenes y PDFs son aceptados.'));
        }
    }
});

// Obtener mensajes recientes (historial)
router.get('/', async (req, res) => {
    try {
        let whereClause = {};

        // Si no es superadmin, filtramos los mensajes privados
        if (req.user?.role !== 'superadmin') {
            whereClause = {
                [Op.or]: [
                    { targetRole: 'all' },
                    { senderId: req.user?.id },
                    { targetRole: `role:${(req.user?.role || '').toLowerCase()}` },
                    { targetRole: `user:${req.user?.id}` }
                ]
            };
        }

        const messages = await Message.findAll({
            where: whereClause,
            include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'username', 'role', 'companyId'] }],
            order: [['createdAt', 'ASC']],
            limit: 200 // último historial
        });
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Error al obtener mensajes' });
    }
});

// Enviar un mensaje
router.post('/', async (req, res) => {
    try {
        const { senderId, content, targetRole, type, fileUrl } = req.body;
        
        if (!content || !senderId) {
            return res.status(400).json({ error: 'SenderId y Content son obligatorios' });
        }

        const newMessage = await Message.create({
            id: crypto.randomUUID(),
            senderId,
            content,
            targetRole: targetRole || 'all',
            type: type || 'text',
            fileUrl: fileUrl || null,
            readBy: [senderId] // El remitente ya lo leyó
        });

        const messageWithSender = await Message.findByPk(newMessage.id, {
            include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'username', 'role', 'companyId'] }]
        });

        const io = req.app.get('io');
        if (io) {
            io.emit('new_internal_chat_message', messageWithSender);
        }

        res.status(201).json(messageWithSender);
    } catch (error) {
        console.error('Error saving message:', error);
        res.status(500).json({ error: 'Error al guardar mensaje' });
    }
});

// Subir archivo adjunto (imagen)
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se subió ningún archivo' });
        }
        
        const fileUrl = `/uploads/${req.file.filename}`;
        res.status(201).json({ url: fileUrl });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Error al subir archivo' });
    }
});

// Marcar mensajes como leídos por el usuario
router.put('/read', async (req, res) => {
    try {
        // En el nuevo modelo le pasaremos userId (quién lee). 
        // Para compatibilidad hacia atrás si no mandan userId no hacemos nada o guardamos el de la sesión.
        const userId = req.body.userId || req.user?.id;
        
        if (!userId) {
            return res.json({ success: true, note: 'No userId provided' });
        }

        // Buscar mensajes donde el usuario no esté en readBy
        const messages = await Message.findAll();
        let updatedCount = 0;

        for (const msg of messages) {
            const readArray = Array.isArray(msg.readBy) ? msg.readBy : [];
            if (!readArray.includes(userId)) {
                readArray.push(userId);
                msg.readBy = readArray;
                // Esto es necesario para que Sequelize detecte cambios en JSON
                msg.changed('readBy', true); 
                await msg.save();
                updatedCount++;
            }
        }
        
        if (updatedCount > 0) {
            const io = req.app.get('io');
            if (io) {
                // Notificar a todos que hubo una actualización de lecturas
                io.emit('internal_chat_read_update');
            }
        }

        res.json({ success: true, updated: updatedCount });
    } catch (error) {
        console.error('Error updating messages:', error);
        res.status(500).json({ error: 'Error al actualizar mensajes' });
    }
});

// Vaciar el chat interno (solo superadmins o todos dependiendo de reglas)
router.delete('/clear', async (req, res) => {
    try {
        await Message.destroy({
            where: {},
            truncate: true
        });

        const io = req.app.get('io');
        if (io) {
            io.emit('internal_chat_cleared');
        }

        res.json({ success: true, message: 'Chat limpiado correctamente' });
    } catch (error) {
        console.error('Error clearing messages:', error);
        res.status(500).json({ error: 'Error al vaciar chat' });
    }
});

module.exports = router;
