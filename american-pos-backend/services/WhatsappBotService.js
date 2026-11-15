const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const AIService = require('./AIService');
const path = require('path');
const fs = require('fs');
const { BASE_PATH } = require('../config/paths');

const cleanLockFiles = (dir) => {
    try {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                cleanLockFiles(fullPath);
            } else if (entry.isFile() && (entry.name === 'LOCK' || entry.name.toLowerCase().includes('singletonlock'))) {
                try {
                    fs.unlinkSync(fullPath);
                    console.log(`[WHATSAPP] Removed stale lock: ${fullPath}`);
                } catch (e) {}
            }
        }
    } catch (e) {}
};

const getExecutablePath = () => {
    const localAppData = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const possiblePaths = [
        path.join(progFiles, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(progFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(progFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(progFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe'),
        process.env.CHROME_BIN
    ].filter(Boolean);

    for (const p of possiblePaths) {
        try {
            if (fs.existsSync(p)) return p;
        } catch (e) {}
    }
    return undefined;
};

class WhatsappBotService {
    constructor() {
        this.client = null;
        this.qrCodeUrl = null;
        this.status = 'DISCONNECTED';
        this.companyId = null;
        this.humanInterventionChats = new Map(); // chatId -> timestamp expiración de pausa
        this.botSentMessageIds = new Set(); // Para no pausar el bot por sus propios mensajes
        this.botSendingToChat = new Map(); // chatId -> timestamp ventana activa de envío del bot
        this.chatHistory = new Map(); // chatId -> Array<{ role: 'user'|'model', content: string, timestamp: number }>
        this.pendingBursts = new Map(); // chatId -> { texts: string[], lastMsg: Message, timer: Timeout }
        this.initTimeout = null;
        this.qrAttempts = 0;
        this.maxQrAttempts = 4;
    }

    _recordChatTurn(chatId, role, content) {
        if (!chatId || !content || !content.trim()) return;
        let list = this.chatHistory.get(chatId) || [];
        // Limpiar historial si tiene más de 45 minutos de inactividad
        const now = Date.now();
        if (list.length > 0 && (now - (list[list.length - 1].timestamp || 0) > 45 * 60 * 1000)) {
            list = [];
        }
        list.push({ role, content: content.trim(), timestamp: now });
        if (list.length > 14) {
            list = list.slice(list.length - 14);
        }
        this.chatHistory.set(chatId, list);
    }

    _getChatHistory(chatId) {
        const list = this.chatHistory.get(chatId) || [];
        const now = Date.now();
        if (list.length > 0 && (now - (list[list.length - 1].timestamp || 0) > 45 * 60 * 1000)) {
            this.chatHistory.delete(chatId);
            return [];
        }
        return list.map(item => ({ role: item.role, content: item.content }));
    }

    async init(companyId = 'default', options = {}) {
        const isAutoStart = Boolean(options?.autoStart);
        this.qrAttempts = 0;
        this.maxQrAttempts = isAutoStart ? 4 : 12;

        if (this.client) {
            try {
                await this.client.destroy();
            } catch (_) {}
            this.client = null;
        }

        const currentInitToken = Symbol('wa_init');
        this._activeInitToken = currentInitToken;

        this.companyId = (!companyId || companyId === 'DEFAULT_COMPANY') ? 'default' : companyId;
        this.status = 'INITIALIZING';
        console.log(`[WHATSAPP] Inicializando cliente para empresa "${this.companyId}"...`);

        const execPath = getExecutablePath();
        if (!execPath) {
            console.log('[WHATSAPP] ℹ️ Navegador Chromium/Edge no detectado en el host. Bot en modo pasivo.');
            this.status = 'DISCONNECTED';
            return;
        }

        const puppeteerOptions = {
            headless: true,
            executablePath: execPath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-background-networking',
                '--mute-audio',
                '--js-flags=--max-old-space-size=256'
            ]
        };

        const authDataPath = process.env.USER_DATA_PATH 
            ? path.join(process.env.USER_DATA_PATH, '.wwebjs_auth') 
            : path.join(BASE_PATH, '.wwebjs_auth');

        // Eliminar posibles bloqueos huérfanos de Chrome
        cleanLockFiles(authDataPath);

        // Timeout preventivo para no quedar en INITIALIZING infinito
        if (this.initTimeout) clearTimeout(this.initTimeout);
        this.initTimeout = setTimeout(() => {
            if (this.status === 'INITIALIZING') {
                console.warn('[WHATSAPP] ⚠️ Timeout de inicialización (45s). Restableciendo a DISCONNECTED para permitir reintento.');
                this.status = 'DISCONNECTED';
                if (this.client) {
                    try { this.client.destroy(); } catch (_) {}
                    this.client = null;
                }
            }
        }, 45000);

        try {
            this.client = new Client({
                authStrategy: new LocalAuth({ dataPath: authDataPath }),
                puppeteer: puppeteerOptions
            });
        } catch (instErr) {
            console.warn('[WHATSAPP] No se pudo instanciar cliente WhatsApp:', instErr.message);
            if (this.initTimeout) clearTimeout(this.initTimeout);
            this.status = 'DISCONNECTED';
            this.client = null;
            return;
        }

        this.client.on('qr', async (qr) => {
            if (this._activeInitToken !== currentInitToken) return;
            if (this.initTimeout) clearTimeout(this.initTimeout);
            this.qrAttempts += 1;
            if (this.qrAttempts > this.maxQrAttempts) {
                console.log(`[WHATSAPP] ⏸️ Sin escaneo tras ${this.maxQrAttempts} códigos QR; pausando cliente en segundo plano hasta vinculación manual.`);
                const staleClient = this.client;
                this.client = null;
                this.status = 'DISCONNECTED';
                this.qrCodeUrl = null;
                if (staleClient) {
                    try { await staleClient.destroy(); } catch (_) {}
                }
                return;
            }
            console.log(`[WHATSAPP] QR Code generado (${this.qrAttempts}/${this.maxQrAttempts})`);
            this.status = 'QR_READY';
            try {
                this.qrCodeUrl = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('[WHATSAPP] Error generando DataURL del QR:', err);
            }
        });

        this.client.on('ready', () => {
            if (this._activeInitToken !== currentInitToken) return;
            if (this.initTimeout) clearTimeout(this.initTimeout);
            this.qrAttempts = 0;
            console.log('[WHATSAPP] ¡Cliente conectado y listo!');
            this.status = 'CONNECTED';
            this.qrCodeUrl = null;
            this.humanInterventionChats.clear();
        });

        this.client.on('auth_failure', msg => {
            if (this.initTimeout) clearTimeout(this.initTimeout);
            console.error('[WHATSAPP] Fallo en autenticación', msg);
            this.status = 'AUTH_FAILED';
            this.qrCodeUrl = null;
        });

        this.client.on('disconnected', async (reason) => {
            if (this.initTimeout) clearTimeout(this.initTimeout);
            console.log('[WHATSAPP] Cliente desconectado', reason);
            if (this.client) {
                try { await this.client.destroy(); } catch (e) { console.error('[WHATSAPP] Error destroy:', e); }
            }
            this.status = 'DISCONNECTED';
            this.client = null;
            this.qrCodeUrl = null;
        });

        const processConsolidatedMessage = async (senderChat, msg, combinedBodyText) => {
            try {
                const bodyText = (combinedBodyText || '').trim();

                // 2. Comprobar si hay intervención humana activa en este chat
                const humanExpiry = this.humanInterventionChats.get(senderChat);
                if (humanExpiry && Date.now() < humanExpiry) {
                    console.log(`[WHATSAPP] 👤 Chat ${senderChat} está siendo atendido manualmente por el cajero/dueño. Bot en pausa.`);
                    return;
                }

                // 3. Comprobar si el cliente solicita explícitamente atención humana
                const isAskingForHuman = /(quiero\s+hablar\s+con\s+(?:una\s+persona|alguien|el\s+due[nñ]o|un\s+humano|asesor)|atenci[oó]n\s+humana|p[aá]same\s+con\s+(?:alguien|un\s+humano|el\s+due[nñ]o)|comunicar(?:me)?\s+con\s+(?:un\s+humano|una\s+persona))/i.test(bodyText);
                if (isAskingForHuman) {
                    this.humanInterventionChats.set(senderChat, Date.now() + 30 * 60 * 1000); // 30 min de pausa
                    this.botSendingToChat.set(senderChat, Date.now() + 12000);
                    const humanReplyText = '¡Con gusto! 👤 Te estoy transfiriendo con nuestro equipo de atención humana. En unos momentos uno de nuestros encargados te responderá directamente por aquí. ¡Gracias por tu paciencia! 😊';
                    this._recordChatTurn(senderChat, 'user', bodyText);
                    this._recordChatTurn(senderChat, 'model', humanReplyText);
                    const humanMsg = await msg.reply(humanReplyText, undefined, { sendSeen: false });
                    if (humanMsg?.id?.id) this.botSentMessageIds.add(humanMsg.id.id);
                    if (humanMsg?.id?._serialized) this.botSentMessageIds.add(humanMsg.id._serialized);
                    return;
                }

                // 4. Filtrar mensajes automáticos de operadores o bancos que no sean comprobantes
                const isAutomatedServiceMsg = /(recarga\s+exitosa|saldo\s+(?:actual|disponible)|pagomovil\s+bdv\s+informa|notificaci[oó]n\s+de\s+d[eé]bito|clave\s+din[aá]mica|c[oó]digo\s+de\s+verificaci[oó]n|transferencia\s+recibida\s+de\s+un\s+banco)/i.test(bodyText);
                if (isAutomatedServiceMsg && !bodyText.toLowerCase().includes('comprobante') && !bodyText.toLowerCase().includes('pago') && !bodyText.toLowerCase().includes('ref')) {
                    console.log(`[WHATSAPP] 🚫 Mensaje automático de servicio/banco ignorado.`);
                    return;
                }

                // Obtener el historial propio en RAM (100% inmune a errores @lid de WhatsApp Web)
                const history = this._getChatHistory(senderChat);
                const hadRecentBotActivity = history.some(h => h.role === 'model');

                // 5. Agradecimientos, despedidas y confirmaciones simples
                const isGratitudeOrFarewell = /^(gracias|muchas\s+gracias|much[ií]simas\s+gracias|grx|mil\s+gracias|gracias\s+amigo|gracias\s+amiga|chao|adios|adi[oó]s|hasta\s+luego|feliz\s+(?:d[ií]a|tarde|noche)|buen\s+d[ií]a|que\s+tengas?\s+buen\s+d[ií]a|que\s+pase\s+buen\s+d[ií]a|igualmente)$/i.test(bodyText.trim());
                if (isGratitudeOrFarewell) {
                    if (!hadRecentBotActivity && history.length > 0) {
                        console.log(`[WHATSAPP] 🚫 Despedida/agradecimiento en chat personal sin contexto del bot ignorado.`);
                        return;
                    }
                    console.log(`[WHATSAPP] 💬 Mensaje de agradecimiento/despedida ("${bodyText}"). Respondiendo amablemente...`);
                    if (msg && typeof msg.react === 'function') {
                        try { await msg.react('❤️'); } catch (e) {}
                    }
                    try {
                        this.botSendingToChat.set(senderChat, Date.now() + 12000);
                        const bizName = this.companyName || process.env.BUSINESS_NAME || 'nuestra tienda';
                        const farewellText = `¡Siempre a tu orden! 😊 Ha sido un verdadero placer atenderte. En *${bizName}* estamos a tu servicio cuando lo necesites. ¡Que tengas un excelente día! ✨`;
                        this._recordChatTurn(senderChat, 'user', bodyText);
                        this._recordChatTurn(senderChat, 'model', farewellText);
                        const farewellMsg = await msg.reply(farewellText, undefined, { sendSeen: false });
                        if (farewellMsg?.id?.id) this.botSentMessageIds.add(farewellMsg.id.id);
                        if (farewellMsg?.id?._serialized) this.botSentMessageIds.add(farewellMsg.id._serialized);
                    } catch (e) {
                        console.warn('[WHATSAPP] Error al responder despedida:', e.message);
                    }
                    return;
                }

                const isShortAck = /^(ok|okay|dale|listo|perfecto|chevere|ch[eé]vere|fino|entendido|am[eé]n|amen|jaja|jajaja|bueno|ya|👍|👌|👏|🙏|❤️|😊|🙌)$/i.test(bodyText.trim());
                if (isShortAck) {
                    if (hadRecentBotActivity && msg && typeof msg.react === 'function') {
                        console.log(`[WHATSAPP] 💬 Confirmación corta recibida ("${bodyText}"). Reaccionando con 👍...`);
                        try { await msg.react('👍'); } catch (e) {}
                    }
                    return;
                }

                console.log(`[WHATSAPP] 📩 Mensaje entrante de ${senderChat}: "${bodyText.replace(/\n/g, ' | ')}"`);

                let audioMedia = null;
                let imageMedia = null;

                if (msg.hasMedia) {
                    try {
                        const downloaded = await msg.downloadMedia();
                        if (downloaded) {
                            if (msg.type === 'ptt' || msg.type === 'audio') {
                                audioMedia = downloaded;
                                console.log(`[WHATSAPP] 🎙️ Audio recibido, procesando con Gemini...`);
                            } else if (msg.type === 'image') {
                                imageMedia = downloaded;
                                console.log(`[WHATSAPP] 📷 Imagen recibida, analizando con Gemini...`);
                            }
                        }
                    } catch (mediaErr) {
                        console.warn('[WHATSAPP] Error descargando multimedia:', mediaErr.message);
                    }
                }

                if (!bodyText && !audioMedia && !imageMedia) {
                    console.log('[WHATSAPP] Mensaje sin texto ni contenido multimedia legible, omitiendo.');
                    return;
                }

                // 6. Consultar el Motor Comercial / Inteligencia Artificial con sesión individual por cliente
                console.log(`[WHATSAPP] 🤖 Consultando IA para cliente ${senderChat}...`);
                const aiResult = await AIService.askCustomerBot(this.companyId || 'default', bodyText, history, true, audioMedia, imageMedia, senderChat);

                let aiResponseText = '';
                let mediaPath = null;
                let mediaUrl = null;
                let mediaBase64 = null;

                if (aiResult && typeof aiResult === 'object') {
                    aiResponseText = (aiResult.text || '').trim();
                    mediaPath = aiResult.mediaPath || null;
                    mediaUrl = aiResult.mediaUrl || null;
                    mediaBase64 = aiResult.mediaBase64 || null;
                } else if (typeof aiResult === 'string') {
                    aiResponseText = aiResult.trim();
                }

                // 7. Si la IA decide que el mensaje tiene relevancia comercial, responder
                if (aiResponseText && !aiResponseText.includes('IGNORE_MESSAGE')) {
                    this._recordChatTurn(senderChat, 'user', bodyText || '[Media]');
                    this._recordChatTurn(senderChat, 'model', aiResponseText);

                    // Pausa humana natural (700ms) para evitar comportamiento robótico
                    await new Promise(r => setTimeout(r, 700));

                    let mediaToSend = null;

                    if (mediaBase64) {
                        try {
                            const rawB64 = mediaBase64.includes('base64,') ? mediaBase64.split('base64,')[1] : mediaBase64;
                            mediaToSend = new MessageMedia('image/jpeg', rawB64, 'imagen.jpg');
                        } catch (b64Err) {
                            console.warn('[WHATSAPP] Error preparando imagen base64:', b64Err.message);
                        }
                    } else if (mediaPath && fs.existsSync(mediaPath)) {
                        try {
                            mediaToSend = MessageMedia.fromFilePath(mediaPath);
                            console.log(`[WHATSAPP] 🖼️ Foto del producto cargada: ${path.basename(mediaPath)}`);
                        } catch (mediaErr) {
                            console.warn('[WHATSAPP] Error cargando imagen local:', mediaErr.message);
                        }
                    } else if (mediaUrl) {
                        try {
                            mediaToSend = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                            console.log(`[WHATSAPP] 🌐 Foto remota descargada: ${mediaUrl.substring(0, 50)}...`);
                        } catch (mediaErr) {
                            console.warn('[WHATSAPP] Error descargando imagen remota:', mediaErr.message);
                        }
                    }

                    let sent = false;

                    // Intentar enviar primero como foto compacta con precio en el caption
                    if (mediaToSend && this.client) {
                        try {
                            mediaToSend = await this.resizeMedia(mediaToSend, 360, 0.85);
                        } catch (resErr) {
                            console.warn('[WHATSAPP] Error optimizando tamaño de imagen:', resErr.message);
                        }

                        console.log(`[WHATSAPP] 📸 Enviando foto compacta con precio y descripción a ${senderChat}...`);
                        try {
                            this.botSendingToChat.set(senderChat, Date.now() + 12000);
                            const sentMsg = await this.client.sendMessage(senderChat, mediaToSend, { caption: aiResponseText, sendSeen: false });
                            if (sentMsg?.id?.id) this.botSentMessageIds.add(sentMsg.id.id);
                            if (sentMsg?.id?._serialized) this.botSentMessageIds.add(sentMsg.id._serialized);
                            sent = true;
                            console.log(`[WHATSAPP] ✅ Foto con precio enviada exitosamente.`);
                        } catch (sendMediaErr) {
                            console.warn('[WHATSAPP] Falló envío con imagen, procediendo con texto:', sendMediaErr.message);
                        }
                    }

                    // Si no había imagen o falló el envío de foto, enviar como mensaje de texto estándar
                    if (!sent) {
                        console.log(`[WHATSAPP] 📤 Enviando respuesta a ${senderChat}: "${aiResponseText.substring(0, 80)}..."`);
                        try {
                            this.botSendingToChat.set(senderChat, Date.now() + 12000);
                            const replyMsg = await msg.reply(aiResponseText, undefined, { sendSeen: false });
                            if (replyMsg?.id?.id) this.botSentMessageIds.add(replyMsg.id.id);
                            if (replyMsg?.id?._serialized) this.botSentMessageIds.add(replyMsg.id._serialized);
                            sent = true;
                        } catch (replyErr) {
                            console.warn('[WHATSAPP] msg.reply falló, intentando client.sendMessage fallback:', replyErr.message);
                        }

                        if (!sent && this.client) {
                            try {
                                this.botSendingToChat.set(senderChat, Date.now() + 12000);
                                const sendMsg = await this.client.sendMessage(senderChat, aiResponseText, { sendSeen: false });
                                if (sendMsg?.id?.id) this.botSentMessageIds.add(sendMsg.id.id);
                                if (sendMsg?.id?._serialized) this.botSentMessageIds.add(sendMsg.id._serialized);
                                sent = true;
                            } catch (sendErr) {
                                console.error('[WHATSAPP] Error crítico al enviar mensaje:', sendErr.message);
                            }
                        }

                        if (sent) {
                            console.log(`[WHATSAPP] ✅ Respuesta de texto entregada a ${senderChat}`);
                        }
                    }

                } else {
                    console.log(`[WHATSAPP] 🚫 Mensaje fuera de contexto o spam ignorado.`);
                }

            } catch (error) {
                console.error('[WHATSAPP] Error en procesamiento de mensaje:', error.message || error);
            }
        };

        const handleIncomingMessage = async (msg) => {
            try {
                // 1. Solo responder a chats válidos (no estados, no grupos, no mensajes propios)
                if (!msg || msg.from === 'status@broadcast' || msg.isGroupMsg || msg.fromMe) return;

                const senderChat = msg.from;
                const bodyText = (msg.body || '').trim();

                // Si el mensaje trae audio o imagen, procesar de inmediato (con lo que hubiera en buffer si existía)
                if (msg.hasMedia) {
                    const existingBurst = this.pendingBursts.get(senderChat);
                    if (existingBurst) {
                        clearTimeout(existingBurst.timer);
                        this.pendingBursts.delete(senderChat);
                        const merged = [...existingBurst.texts, bodyText].filter(Boolean).join('\n');
                        await processConsolidatedMessage(senderChat, msg, merged);
                    } else {
                        await processConsolidatedMessage(senderChat, msg, bodyText);
                    }
                    return;
                }

                // Agrupador de ráfagas de mensajes de texto (Message Debouncer de 1.8s)
                // Si el cliente escribe en 2 o 3 mensajes seguidos ("Hola" / "Tienes mostaza"), responde 1 sola vez
                const existing = this.pendingBursts.get(senderChat);
                if (existing) {
                    clearTimeout(existing.timer);
                    if (bodyText) existing.texts.push(bodyText);
                    existing.lastMsg = msg;
                    existing.timer = setTimeout(() => {
                        const finalBurst = this.pendingBursts.get(senderChat);
                        this.pendingBursts.delete(senderChat);
                        if (finalBurst) {
                            processConsolidatedMessage(senderChat, finalBurst.lastMsg, finalBurst.texts.join('\n'));
                        }
                    }, 1800);
                } else {
                    const burst = {
                        texts: bodyText ? [bodyText] : [],
                        lastMsg: msg,
                        timer: setTimeout(() => {
                            const finalBurst = this.pendingBursts.get(senderChat);
                            this.pendingBursts.delete(senderChat);
                            if (finalBurst) {
                                processConsolidatedMessage(senderChat, finalBurst.lastMsg, finalBurst.texts.join('\n'));
                            }
                        }, 1800)
                    };
                    this.pendingBursts.set(senderChat, burst);
                }
            } catch (err) {
                console.error('[WHATSAPP] Error en handleIncomingMessage:', err.message || err);
            }
        };

        this.client.on('message', handleIncomingMessage);

        try {
            this.client.initialize().catch(async (err) => {
                console.warn('[WHATSAPP] Error en initialize:', err.message);
                if (this.client) {
                    try { await this.client.destroy(); } catch (e) {}
                }
                this.status = 'DISCONNECTED';
                this.client = null;
                this.qrCodeUrl = null;
            });
        } catch (initErr) {
            console.warn('[WHATSAPP] WhatsApp Bot init error:', initErr.message);
            this.status = 'DISCONNECTED';
            this.client = null;
            this.qrCodeUrl = null;
        }
    }

    async resizeMedia(media, maxDimension = 360, quality = 0.85) {
        if (!media || !media.data || !this.client || !this.client.pupPage) return media;
        try {
            const mime = media.mimetype || 'image/jpeg';
            const dataUri = `data:${mime};base64,${media.data}`;

            const resizedBase64 = await this.client.pupPage.evaluate(async (src, maxDim, q) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        let w = img.naturalWidth || img.width;
                        let h = img.naturalHeight || img.height;

                        if (w <= 0 || h <= 0) return resolve(null);

                        if (w > maxDim || h > maxDim) {
                            if (w >= h) {
                                h = Math.round((h * maxDim) / w);
                                w = maxDim;
                            } else {
                                w = Math.round((w * maxDim) / h);
                                h = maxDim;
                            }
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        const res = canvas.toDataURL('image/jpeg', q);
                        resolve(res.replace(/^data:image\/jpeg;base64,/, ''));
                    };
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }, dataUri, maxDimension, quality);

            if (resizedBase64) {
                const filename = media.filename ? media.filename.replace(/\.[^.]+$/, '.jpg') : 'product.jpg';
                return new MessageMedia('image/jpeg', resizedBase64, filename);
            }
        } catch (e) {
            console.warn('[WHATSAPP] Aviso al redimensionar imagen (usando original):', e.message);
        }
        return media;
    }

    /**
     * Limpia y formatea un número telefónico para WhatsApp (ej: 04121234567 -> 584121234567)
     */
    cleanPhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') return '';
        let cleaned = phone.replace(/\D/g, '');
        if (!cleaned) return '';
        
        // Si comienza con 0 (ej: 0412, 0424, 0414, 0416, 0426)
        if (cleaned.startsWith('0') && cleaned.length >= 10) {
            cleaned = '58' + cleaned.substring(1);
        }
        // Si no tiene código de país y son 10 dígitos (ej: 4121234567)
        if (cleaned.length === 10 && (cleaned.startsWith('412') || cleaned.startsWith('414') || cleaned.startsWith('424') || cleaned.startsWith('416') || cleaned.startsWith('426'))) {
            cleaned = '58' + cleaned;
        }
        return cleaned;
    }

    /**
     * Formatea una orden de compra en un mensaje profesional de WhatsApp
     */
    formatPurchaseOrderMessage({ orderId, businessName, supplierName, supplierContact, orderDate, items, total, notes, referenceNumber }) {
        const orderShort = orderId ? `#${orderId.slice(0, 8).toUpperCase()}` : '#NUEVO';
        const dateStr = orderDate || new Date().toLocaleDateString('es-VE');
        const store = businessName || 'Isaac POS';
        
        let itemsList = '';
        if (Array.isArray(items)) {
            itemsList = items.map((item, idx) => {
                const qty = item.quantity || 1;
                const unitName = item.bulkUnitName ? ` (${item.bulkUnitName})` : '';
                const costStr = item.cost ? ` | Est: $${Number(item.cost).toFixed(2)}` : '';
                return `  ${idx + 1}. *${qty}* x ${item.name}${unitName}${costStr}`;
            }).join('\n');
        } else {
            itemsList = '  • Sin items especificados';
        }

        const totalFormatted = total ? `\n💵 *TOTAL ESTIMADO:* $${Number(total).toFixed(2)}` : '';
        const refFormatted = referenceNumber ? `\n🔖 *REFERENCIA / CONTROL:* ${referenceNumber}` : '';
        const notesFormatted = notes ? `\n📌 *NOTAS:* ${notes}` : '\n📌 *INDICACIONES:* Por favor confirmar disponibilidad, recepción y tiempo estimado de entrega.';

        return `📦 *ORDEN DE COMPRA - ${store.toUpperCase()}*\n` +
               `🔢 *Nº ORDEN:* ${orderShort}\n` +
               `👤 *PROVEEDOR:* ${supplierName || 'Proveedor'}${supplierContact ? ` (Atenc: ${supplierContact})` : ''}\n` +
               `📅 *FECHA:* ${dateStr}` +
               `${refFormatted}\n\n` +
               `🛒 *DETALLE DE PRODUCTOS:* \n${itemsList}\n` +
               `${totalFormatted}\n` +
               `${notesFormatted}\n\n` +
               `_Mensaje generado automáticamente desde Isaac POS_`;
    }

    /**
     * Envía un mensaje directo a un número de teléfono usando el bot conectado
     */
    async sendDirectMessage(phone, messageText) {
        const cleanPhone = this.cleanPhoneNumber(phone);
        if (!cleanPhone) {
            throw new Error('El proveedor no tiene un número de teléfono válido registrado');
        }

        const chatId = `${cleanPhone}@c.us`;
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageText)}`;

        if (this.status === 'CONNECTED' && this.client) {
            try {
                console.log(`[WHATSAPP] 📤 Enviando mensaje a ${chatId}...`);
                this.botSendingToChat.set(chatId, Date.now() + 12000);
                const sentMsg = await this.client.sendMessage(chatId, messageText);
                if (sentMsg?.id?.id) this.botSentMessageIds.add(sentMsg.id.id);
                if (sentMsg?.id?._serialized) {
                    this.botSentMessageIds.add(sentMsg.id._serialized);
                }
                return {
                    success: true,
                    botSent: true,
                    phone: cleanPhone,
                    chatId,
                    whatsappUrl,
                    message: 'Pedido enviado exitosamente al WhatsApp del proveedor'
                };
            } catch (err) {
                console.warn(`[WHATSAPP] Error enviando vía bot a ${chatId}:`, err.message);
                return {
                    success: true,
                    botSent: false,
                    botError: err.message,
                    phone: cleanPhone,
                    chatId,
                    whatsappUrl,
                    message: 'Bot ocupado o error de conexión. Se generó el enlace directo a WhatsApp.'
                };
            }
        }

        return {
            success: true,
            botSent: false,
            botConnected: false,
            phone: cleanPhone,
            chatId,
            whatsappUrl,
            message: 'Bot de WhatsApp no conectado. Se generó el enlace directo a WhatsApp.'
        };
    }

    /**
     * Envía un archivo multimedia (imagen de factura/ticket) a un teléfono mediante el bot
     */
    async sendMediaMessage(phone, base64Data, mimeType = 'image/png', caption = '', filename = 'ticket.png') {
        const cleanPhone = this.cleanPhoneNumber(phone);
        if (!cleanPhone) {
            throw new Error('Número de teléfono no válido o sin formato');
        }

        let chatId = `${cleanPhone}@c.us`;
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}`;

        if (this.status !== 'CONNECTED' || !this.client) {
            return {
                success: false,
                botSent: false,
                botConnected: false,
                phone: cleanPhone,
                chatId,
                whatsappUrl,
                message: 'El Bot de WhatsApp no está conectado actualmente en el sistema.'
            };
        }

        // 1. Resolver el JID real de WhatsApp (soporta formatos LID y verificación de existencia)
        try {
            const numberId = await this.client.getNumberId(cleanPhone);
            if (numberId?._serialized) {
                chatId = numberId._serialized;
                console.log(`[WHATSAPP] 📍 JID resuelto para ${cleanPhone}: ${chatId}`);
            }
        } catch (numErr) {
            console.warn('[WHATSAPP] Aviso al validar número en WhatsApp:', numErr.message);
        }

        try {
            console.log(`[WHATSAPP] 📤 Enviando imagen de factura a ${chatId}...`);
            // Limpiar encabezado data:image/... si viene incluido
            const rawBase64 = base64Data.includes('base64,') ? base64Data.split('base64,')[1] : base64Data;
            const media = new MessageMedia(mimeType, rawBase64, filename);
            
            const options = caption ? { caption } : {};
            this.botSendingToChat.set(chatId, Date.now() + 12000);
            const sentMsg = await this.client.sendMessage(chatId, media, options);
            if (sentMsg?.id?.id) this.botSentMessageIds.add(sentMsg.id.id);
            if (sentMsg?.id?._serialized) {
                this.botSentMessageIds.add(sentMsg.id._serialized);
            }
            return {
                success: true,
                botSent: true,
                botConnected: true,
                phone: cleanPhone,
                chatId,
                message: 'Factura enviada exitosamente como imagen por WhatsApp'
            };
        } catch (err) {
            console.warn(`[WHATSAPP] Error enviando imagen vía bot a ${chatId}:`, err.message);

            // Fallback inmediato: Si WhatsApp Web rechaza la imagen, enviar el comprobante en formato texto
            if (caption) {
                try {
                    console.log(`[WHATSAPP] ⚠️ Intentando enviar factura en texto como alternativa a ${chatId}...`);
                    this.botSendingToChat.set(chatId, Date.now() + 12000);
                    const sentTextMsg = await this.client.sendMessage(chatId, caption);
                    if (sentTextMsg?.id?.id) this.botSentMessageIds.add(sentTextMsg.id.id);
                    if (sentTextMsg?.id?._serialized) {
                        this.botSentMessageIds.add(sentTextMsg.id._serialized);
                    }
                    return {
                        success: true,
                        botSent: true,
                        botConnected: true,
                        mediaFailed: true,
                        phone: cleanPhone,
                        chatId,
                        message: 'Factura enviada como texto por WhatsApp (el cliente ya tiene su detalle completo).'
                    };
                } catch (textFallbackErr) {
                    console.error('[WHATSAPP] Error en envío alternativo de texto:', textFallbackErr.message);
                }
            }

            return {
                success: false,
                botSent: false,
                botConnected: true,
                botError: err.message,
                phone: cleanPhone,
                chatId,
                whatsappUrl,
                message: `Error al enviar con el bot: ${err.message}`
            };
        }
    }

    getStatus() {
        return {
            status: this.status,
            qrCodeUrl: this.qrCodeUrl
        };
    }

    async logout() {
        if (this.client) {
            try {
                await this.client.logout();
            } catch (e) {
                console.error('[WHATSAPP] Error en logout', e.message);
            }
            try {
                await this.client.destroy();
            } catch (e) {
                console.error('[WHATSAPP] Error en destroy', e.message);
            }
            this.client = null;
        }
        this.status = 'DISCONNECTED';
        this.qrCodeUrl = null;
    }
}

module.exports = new WhatsappBotService();
