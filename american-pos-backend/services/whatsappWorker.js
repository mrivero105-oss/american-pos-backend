const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const {
    cleanLockFiles,
    pruneChromeBloatCache,
    getExecutablePath,
    writeSessionState
} = require('./whatsappUtils');

/**
 * Proceso hijo aislado para WhatsApp Web + Puppeteer.
 * Mantiene whatsapp-web.js, qrcode y Chromium completamente fuera del event loop
 * del servidor principal Express/Sequelize de Isaac POS.
 */
class WhatsappWorkerRuntime {
    constructor() {
        this.client = null;
        this.status = 'DISCONNECTED';
        this.qrCodeUrl = null;
        this.lastError = null;
        this.companyId = 'default';
        this.authDataPath = null;
        this.qrAttempts = 0;
        this.maxQrAttempts = 4;
        this._isAutoStartRun = false;
        this._activeInitToken = null;
        this._initInFlight = null;
        this.initTimeout = null;
        this.pendingBursts = new Map();
        this.recentMessages = new Map(); // msgRefId -> { msg, createdAt }
        this._seq = 0;
    }

    _sendIpc(payload) {
        if (typeof process.send === 'function' && process.connected !== false) {
            try {
                process.send(payload);
            } catch (_e) {}
        }
    }

    getStatus() {
        return {
            status: this.status,
            qrCodeUrl: this.qrCodeUrl,
            lastError: this.lastError,
            qrAttempts: this.qrAttempts,
            maxQrAttempts: this.maxQrAttempts,
            _isAutoStartRun: this._isAutoStartRun,
            companyId: this.companyId
        };
    }

    _emitStatus() {
        this._sendIpc({ type: 'status_update', ...this.getStatus() });
    }

    _storeRecentMessage(msg) {
        const now = Date.now();
        if (this.recentMessages.size > 200) {
            for (const [k, v] of this.recentMessages.entries()) {
                if (now - v.createdAt > 5 * 60 * 1000) {
                    this.recentMessages.delete(k);
                }
            }
        }
        this._seq += 1;
        const msgRefId = `m_${now}_${this._seq}`;
        this.recentMessages.set(msgRefId, { msg, createdAt: now });
        return msgRefId;
    }

    async _teardownStaleClient(authDataPath, { nextStatus = 'DISCONNECTED', lastError = null, pruneCache = false, includeServiceWorkerCache = false } = {}) {
        this._activeInitToken = null;
        if (this.initTimeout) {
            clearTimeout(this.initTimeout);
            this.initTimeout = null;
        }
        const staleClient = this.client;
        this.client = null;
        this.status = nextStatus;
        this.qrCodeUrl = null;
        this.lastError = lastError;
        this._emitStatus();

        if (staleClient) {
            try {
                await Promise.race([
                    staleClient.destroy(),
                    new Promise((resolve) => setTimeout(resolve, 2500))
                ]);
            } catch (_e) {}
        }
        if (authDataPath) {
            cleanLockFiles(authDataPath);
            if (pruneCache) {
                pruneChromeBloatCache(authDataPath, { includeServiceWorkerCache });
            }
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
            console.warn('[WHATSAPP-WORKER] Aviso al redimensionar imagen (usando original):', e.message);
        }
        return media;
    }

    async init({ companyId = 'default', authDataPath, options = {} }) {
        const isAutoStart = Boolean(options?.autoStart);
        const forceRestart = Boolean(options?.forceRestart);
        this.authDataPath = authDataPath;

        if (!forceRestart) {
            if (this._initInFlight) {
                if (!isAutoStart) {
                    this._isAutoStartRun = false;
                    this.maxQrAttempts = 12;
                }
                return this._initInFlight;
            }
            if (this.client) {
                if (this.status === 'CONNECTED') {
                    this._emitStatus();
                    return this.getStatus();
                }
                if (this.status === 'QR_READY' && this.qrCodeUrl) {
                    this._isAutoStartRun = false;
                    this.maxQrAttempts = 12;
                    this._emitStatus();
                    return this.getStatus();
                }
                if (this.status === 'INITIALIZING') {
                    if (!isAutoStart) {
                        this._isAutoStartRun = false;
                        this.maxQrAttempts = 12;
                        this._emitStatus();
                    }
                    return this.getStatus();
                }
            }
        } else if (this._initInFlight) {
            try { await this._initInFlight; } catch (_e) {}
        }

        const runSetup = async () => {
            await this._teardownStaleClient(authDataPath, {
                nextStatus: 'INITIALIZING',
                pruneCache: true,
                includeServiceWorkerCache: false
            });

            this._isAutoStartRun = isAutoStart;
            this.qrAttempts = 0;
            this.maxQrAttempts = isAutoStart ? 4 : 12;

            const currentInitToken = Symbol('wa_init');
            this._activeInitToken = currentInitToken;

            this.companyId = (!companyId || companyId === 'DEFAULT_COMPANY') ? 'default' : companyId;
            this.status = 'INITIALIZING';
            this.qrCodeUrl = null;
            this.lastError = null;
            this._emitStatus();
            console.log(`[WHATSAPP-WORKER] Inicializando cliente para empresa "${this.companyId}"...`);

            const execPath = getExecutablePath();
            if (!execPath) {
                console.log('[WHATSAPP-WORKER] ℹ️ Navegador Chromium/Edge no detectado en el host. Bot en modo pasivo.');
                this._activeInitToken = null;
                this.status = 'DISCONNECTED';
                this.lastError = 'No se detectó Google Chrome ni Microsoft Edge instalado en este equipo.';
                this._emitStatus();
                return this.getStatus();
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
                    '--no-default-browser-check',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--disable-component-update',
                    '--disable-sync',
                    '--disable-background-networking',
                    '--metrics-recording-only',
                    '--disk-cache-size=20971520',
                    '--media-cache-size=20971520',
                    '--mute-audio',
                    '--js-flags=--max-old-space-size=256'
                ]
            };

            cleanLockFiles(authDataPath);
            pruneChromeBloatCache(authDataPath, { includeServiceWorkerCache: false });

            if (this.initTimeout) clearTimeout(this.initTimeout);
            this.initTimeout = setTimeout(() => {
                if (this._activeInitToken === currentInitToken && this.status === 'INITIALIZING') {
                    console.warn('[WHATSAPP-WORKER] ⚠️ Timeout de inicialización (65s). Restableciendo a DISCONNECTED para permitir reintento.');
                    this._teardownStaleClient(authDataPath, {
                        nextStatus: 'DISCONNECTED',
                        lastError: 'La conexión tardó demasiado (65s). Verifica tu acceso a internet y presiona Reintentar.'
                    });
                }
            }, 65000);

            try {
                const webCachePath = path.join(path.dirname(authDataPath), '.wwebjs_cache');
                this.client = new Client({
                    authStrategy: new LocalAuth({ dataPath: authDataPath }),
                    webVersionCache: { type: 'local', path: webCachePath },
                    puppeteer: puppeteerOptions,
                    authTimeoutMs: 60000,
                    qrMaxRetries: 0
                });
            } catch (instErr) {
                console.warn('[WHATSAPP-WORKER] No se pudo instanciar cliente WhatsApp:', instErr.message);
                await this._teardownStaleClient(authDataPath, {
                    nextStatus: 'DISCONNECTED',
                    lastError: `Error iniciando el navegador de WhatsApp: ${instErr.message}`
                });
                return this.getStatus();
            }

            return { currentInitToken };
        };

        let setupResult;
        this._initInFlight = runSetup();
        try {
            setupResult = await this._initInFlight;
        } finally {
            this._initInFlight = null;
        }

        if (!setupResult || !setupResult.currentInitToken) {
            return this.getStatus();
        }
        const { currentInitToken } = setupResult;

        this.client.on('qr', async (qr) => {
            if (this._activeInitToken !== currentInitToken) return;
            if (this.initTimeout) {
                clearTimeout(this.initTimeout);
                this.initTimeout = null;
            }
            this.qrAttempts += 1;
            if (this._isAutoStartRun) {
                console.log('[WHATSAPP-WORKER] ℹ️ Sesión no vinculada (WhatsApp solicita QR); pausando auto-inicio hasta vinculación manual.');
                writeSessionState(authDataPath, { linked: false, reason: 'qr_required' });
                await this._teardownStaleClient(authDataPath, {
                    nextStatus: 'DISCONNECTED',
                    pruneCache: true,
                    includeServiceWorkerCache: false
                });
                return;
            }
            if (this.qrAttempts > this.maxQrAttempts) {
                console.log(`[WHATSAPP-WORKER] ⏸️ Sin escaneo tras ${this.maxQrAttempts} códigos QR; pausando cliente en segundo plano hasta vinculación manual.`);
                await this._teardownStaleClient(authDataPath, {
                    nextStatus: 'DISCONNECTED',
                    lastError: 'Tiempo de espera del código QR agotado. Presiona Iniciar para generar un nuevo código.'
                });
                return;
            }
            console.log(`[WHATSAPP-WORKER] QR Code generado (${this.qrAttempts}/${this.maxQrAttempts})`);
            try {
                const qrDataUrl = await qrcode.toDataURL(qr, { width: 280, margin: 1 });
                if (this._activeInitToken !== currentInitToken) return;
                this.qrCodeUrl = qrDataUrl;
                this.lastError = null;
                this.status = 'QR_READY';
                this._emitStatus();
            } catch (err) {
                console.error('[WHATSAPP-WORKER] Error generando DataURL del QR:', err);
            }
        });

        this.client.on('ready', () => {
            if (this._activeInitToken !== currentInitToken) return;
            if (this.initTimeout) {
                clearTimeout(this.initTimeout);
                this.initTimeout = null;
            }
            this.qrAttempts = 0;
            this._isAutoStartRun = false;
            writeSessionState(authDataPath, { linked: true, companyId: this.companyId });
            console.log('[WHATSAPP-WORKER] ¡Cliente conectado y listo!');
            this.status = 'CONNECTED';
            this.qrCodeUrl = null;
            this.lastError = null;
            this._emitStatus();
        });

        this.client.on('auth_failure', (msg) => {
            if (this._activeInitToken !== currentInitToken) return;
            if (this.initTimeout) {
                clearTimeout(this.initTimeout);
                this.initTimeout = null;
            }
            writeSessionState(authDataPath, { linked: false, reason: 'auth_failure' });
            console.error('[WHATSAPP-WORKER] Fallo en autenticación', msg);
            this.status = 'AUTH_FAILED';
            this.qrCodeUrl = null;
            this.lastError = 'No se pudo autenticar la sesión de WhatsApp. Intenta vincular nuevamente.';
            this._emitStatus();
        });

        this.client.on('disconnected', async (reason) => {
            if (this._activeInitToken !== currentInitToken) return;
            console.log('[WHATSAPP-WORKER] Cliente desconectado', reason);
            if (/logout|unpaired|conflict/i.test(String(reason || ''))) {
                writeSessionState(authDataPath, { linked: false, reason: String(reason) });
            }
            await this._teardownStaleClient(authDataPath, {
                nextStatus: 'DISCONNECTED',
                lastError: reason ? `Sesión desconectada (${reason})` : null
            });
        });

        const forwardConsolidatedToParent = async (senderChat, msg, combinedBodyText) => {
            let audioMedia = null;
            let imageMedia = null;
            if (msg && msg.hasMedia) {
                try {
                    const downloaded = await msg.downloadMedia();
                    if (downloaded) {
                        const serialized = {
                            mimetype: downloaded.mimetype,
                            data: downloaded.data,
                            filename: downloaded.filename || null
                        };
                        if (msg.type === 'ptt' || msg.type === 'audio') {
                            audioMedia = serialized;
                        } else if (msg.type === 'image') {
                            imageMedia = serialized;
                        }
                    }
                } catch (mediaErr) {
                    console.warn('[WHATSAPP-WORKER] Error descargando multimedia:', mediaErr.message);
                }
            }
            const msgRefId = this._storeRecentMessage(msg);
            this._sendIpc({
                type: 'incoming_consolidated',
                msgRefId,
                senderChat,
                bodyText: (combinedBodyText || '').trim(),
                hasMedia: Boolean(msg?.hasMedia),
                msgType: msg?.type || 'chat',
                audioMedia,
                imageMedia
            });
        };

        this.client.on('message', async (msg) => {
            try {
                if (!msg || msg.from === 'status@broadcast' || msg.isGroupMsg || msg.fromMe) return;
                const senderChat = msg.from;
                const bodyText = (msg.body || '').trim();

                if (msg.hasMedia) {
                    const existingBurst = this.pendingBursts.get(senderChat);
                    if (existingBurst) {
                        clearTimeout(existingBurst.timer);
                        this.pendingBursts.delete(senderChat);
                        const merged = [...existingBurst.texts, bodyText].filter(Boolean).join('\n');
                        await forwardConsolidatedToParent(senderChat, msg, merged);
                    } else {
                        await forwardConsolidatedToParent(senderChat, msg, bodyText);
                    }
                    return;
                }

                const existing = this.pendingBursts.get(senderChat);
                if (existing) {
                    clearTimeout(existing.timer);
                    if (bodyText) existing.texts.push(bodyText);
                    existing.lastMsg = msg;
                    existing.timer = setTimeout(() => {
                        const finalBurst = this.pendingBursts.get(senderChat);
                        this.pendingBursts.delete(senderChat);
                        if (finalBurst) {
                            forwardConsolidatedToParent(senderChat, finalBurst.lastMsg, finalBurst.texts.join('\n')).catch(() => {});
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
                                forwardConsolidatedToParent(senderChat, finalBurst.lastMsg, finalBurst.texts.join('\n')).catch(() => {});
                            }
                        }, 1800)
                    };
                    this.pendingBursts.set(senderChat, burst);
                }
            } catch (err) {
                console.error('[WHATSAPP-WORKER] Error en message:', err.message || err);
            }
        });

        try {
            this.client.initialize().catch(async (err) => {
                if (this._activeInitToken !== currentInitToken) return;
                const errMsg = err?.message || String(err || '');
                console.warn('[WHATSAPP-WORKER] Error en initialize:', errMsg);
                if (!this._isAutoStartRun && !options?._retried && /reading 'Socket'|WAWebSocketModel/i.test(errMsg)) {
                    await this._teardownStaleClient(authDataPath, {
                        nextStatus: 'INITIALIZING',
                        lastError: null
                    });
                    setTimeout(() => {
                        this.init({
                            companyId: this.companyId,
                            authDataPath,
                            options: { ...options, forceRestart: true, _retried: true }
                        }).catch(() => {});
                    }, 400);
                    return;
                }
                await this._teardownStaleClient(authDataPath, {
                    nextStatus: 'DISCONNECTED',
                    lastError: `Error iniciando sesión de WhatsApp: ${errMsg}`
                });
            });
        } catch (initErr) {
            console.warn('[WHATSAPP-WORKER] WhatsApp Bot init error:', initErr.message);
            await this._teardownStaleClient(authDataPath, {
                nextStatus: 'DISCONNECTED',
                lastError: `Error iniciando sesión de WhatsApp: ${initErr.message}`
            });
        }

        return this.getStatus();
    }

    async executeBotReply({ msgRefId, senderChat, mode, text, reaction, mediaPath, mediaUrl, mediaBase64 }) {
        const entry = msgRefId ? this.recentMessages.get(msgRefId) : null;
        const msg = entry?.msg || null;
        const sentIds = [];
        const recordSent = (sentObj) => {
            if (sentObj?.id?.id) sentIds.push(sentObj.id.id);
            if (sentObj?.id?._serialized) sentIds.push(sentObj.id._serialized);
        };

        if (reaction && msg && typeof msg.react === 'function') {
            try { await msg.react(reaction); } catch (_e) {}
        }

        if (mode === 'react_only') {
            return { sent: true, sentIds };
        }

        let mediaToSend = null;
        if (mediaBase64) {
            try {
                const rawB64 = mediaBase64.includes('base64,') ? mediaBase64.split('base64,')[1] : mediaBase64;
                mediaToSend = new MessageMedia('image/jpeg', rawB64, 'imagen.jpg');
            } catch (b64Err) {
                console.warn('[WHATSAPP-WORKER] Error preparando imagen base64:', b64Err.message);
            }
        } else if (mediaPath && fs.existsSync(mediaPath)) {
            try {
                mediaToSend = MessageMedia.fromFilePath(mediaPath);
            } catch (mediaErr) {
                console.warn('[WHATSAPP-WORKER] Error cargando imagen local:', mediaErr.message);
            }
        } else if (mediaUrl) {
            try {
                mediaToSend = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
            } catch (mediaErr) {
                console.warn('[WHATSAPP-WORKER] Error descargando imagen remota:', mediaErr.message);
            }
        }

        let sent = false;
        if (mediaToSend && this.client) {
            try {
                mediaToSend = await this.resizeMedia(mediaToSend, 360, 0.85);
            } catch (_e) {}
            try {
                const sentMsg = await this.client.sendMessage(senderChat, mediaToSend, { caption: text, sendSeen: false });
                recordSent(sentMsg);
                sent = true;
            } catch (sendMediaErr) {
                console.warn('[WHATSAPP-WORKER] Falló envío con imagen, procediendo con texto:', sendMediaErr.message);
            }
        }

        if (!sent && text) {
            if (msg && typeof msg.reply === 'function') {
                try {
                    const replyMsg = await msg.reply(text, undefined, { sendSeen: false });
                    recordSent(replyMsg);
                    sent = true;
                } catch (replyErr) {
                    console.warn('[WHATSAPP-WORKER] msg.reply falló, intentando client.sendMessage:', replyErr.message);
                }
            }
            if (!sent && this.client) {
                try {
                    const sendMsg = await this.client.sendMessage(senderChat, text, { sendSeen: false });
                    recordSent(sendMsg);
                    sent = true;
                } catch (sendErr) {
                    console.error('[WHATSAPP-WORKER] Error crítico al enviar mensaje:', sendErr.message);
                }
            }
        }

        return { sent, sentIds };
    }

    async sendDirectMessage({ cleanPhone, chatId, messageText, whatsappUrl }) {
        const sentIds = [];
        if (this.status === 'CONNECTED' && this.client) {
            try {
                console.log(`[WHATSAPP-WORKER] 📤 Enviando mensaje a ${chatId}...`);
                const sentMsg = await this.client.sendMessage(chatId, messageText);
                if (sentMsg?.id?.id) sentIds.push(sentMsg.id.id);
                if (sentMsg?.id?._serialized) sentIds.push(sentMsg.id._serialized);
                return {
                    sentIds,
                    response: {
                        success: true,
                        botSent: true,
                        phone: cleanPhone,
                        chatId,
                        whatsappUrl,
                        message: 'Pedido enviado exitosamente al WhatsApp del proveedor'
                    }
                };
            } catch (err) {
                console.warn(`[WHATSAPP-WORKER] Error enviando vía bot a ${chatId}:`, err.message);
                return {
                    sentIds,
                    response: {
                        success: true,
                        botSent: false,
                        botError: err.message,
                        phone: cleanPhone,
                        chatId,
                        whatsappUrl,
                        message: 'Bot ocupado o error de conexión. Se generó el enlace directo a WhatsApp.'
                    }
                };
            }
        }
        return {
            sentIds,
            response: {
                success: true,
                botSent: false,
                botConnected: false,
                phone: cleanPhone,
                chatId,
                whatsappUrl,
                message: 'Bot de WhatsApp no conectado. Se generó el enlace directo a WhatsApp.'
            }
        };
    }

    async sendMediaMessage({ cleanPhone, base64Data, mimeType = 'image/png', caption = '', filename = 'ticket.png', whatsappUrl }) {
        let chatId = `${cleanPhone}@c.us`;
        const sentIds = [];
        if (this.status !== 'CONNECTED' || !this.client) {
            return {
                sentIds,
                response: {
                    success: false,
                    botSent: false,
                    botConnected: false,
                    phone: cleanPhone,
                    chatId,
                    whatsappUrl,
                    message: 'El Bot de WhatsApp no está conectado actualmente en el sistema.'
                }
            };
        }

        try {
            const numberId = await this.client.getNumberId(cleanPhone);
            if (numberId?._serialized) {
                chatId = numberId._serialized;
            }
        } catch (numErr) {
            console.warn('[WHATSAPP-WORKER] Aviso al validar número en WhatsApp:', numErr.message);
        }

        try {
            const rawBase64 = base64Data.includes('base64,') ? base64Data.split('base64,')[1] : base64Data;
            const media = new MessageMedia(mimeType, rawBase64, filename);
            const options = caption ? { caption } : {};
            const sentMsg = await this.client.sendMessage(chatId, media, options);
            if (sentMsg?.id?.id) sentIds.push(sentMsg.id.id);
            if (sentMsg?.id?._serialized) sentIds.push(sentMsg.id._serialized);
            return {
                sentIds,
                response: {
                    success: true,
                    botSent: true,
                    botConnected: true,
                    phone: cleanPhone,
                    chatId,
                    message: 'Factura enviada exitosamente como imagen por WhatsApp'
                }
            };
        } catch (err) {
            console.warn(`[WHATSAPP-WORKER] Error enviando imagen vía bot a ${chatId}:`, err.message);
            if (caption) {
                try {
                    const sentTextMsg = await this.client.sendMessage(chatId, caption);
                    if (sentTextMsg?.id?.id) sentIds.push(sentTextMsg.id.id);
                    if (sentTextMsg?.id?._serialized) sentIds.push(sentTextMsg.id._serialized);
                    return {
                        sentIds,
                        response: {
                            success: true,
                            botSent: true,
                            botConnected: true,
                            mediaFailed: true,
                            phone: cleanPhone,
                            chatId,
                            message: 'Factura enviada como texto por WhatsApp (el cliente ya tiene su detalle completo).'
                        }
                    };
                } catch (textFallbackErr) {
                    console.error('[WHATSAPP-WORKER] Error en envío alternativo de texto:', textFallbackErr.message);
                }
            }
            return {
                sentIds,
                response: {
                    success: false,
                    botSent: false,
                    botConnected: true,
                    botError: err.message,
                    phone: cleanPhone,
                    chatId,
                    whatsappUrl,
                    message: `Error al enviar con el bot: ${err.message}`
                }
            };
        }
    }

    async shutdown() {
        for (const entry of this.pendingBursts.values()) {
            if (entry?.timer) clearTimeout(entry.timer);
        }
        this.pendingBursts.clear();
        await this._teardownStaleClient(this.authDataPath, {
            nextStatus: 'DISCONNECTED',
            pruneCache: true,
            includeServiceWorkerCache: false
        });
    }

    async logout({ authDataPath }) {
        const targetPath = authDataPath || this.authDataPath;
        const wasConnected = this.status === 'CONNECTED';
        if (targetPath) {
            writeSessionState(targetPath, { linked: false, reason: 'manual_logout' });
        }
        if (wasConnected && this.client) {
            try {
                await Promise.race([
                    this.client.logout(),
                    new Promise((resolve) => setTimeout(resolve, 2500))
                ]);
            } catch (e) {
                console.error('[WHATSAPP-WORKER] Error en logout', e.message);
            }
        }
        await this._teardownStaleClient(targetPath, {
            nextStatus: 'DISCONNECTED',
            pruneCache: true,
            includeServiceWorkerCache: true
        });
    }
}

if (require.main === module) {
    const runtime = new WhatsappWorkerRuntime();

    process.on('message', async (msg) => {
        if (!msg || typeof msg !== 'object') return;
        const reply = (ok, data, error) => {
            if (msg.reqId !== undefined) {
                runtime._sendIpc({ type: 'rpc_result', reqId: msg.reqId, ok, data, error });
            }
        };

        try {
            switch (msg.type) {
                case 'init': {
                    const data = await runtime.init(msg);
                    reply(true, data);
                    break;
                }
                case 'promote_manual': {
                    runtime._isAutoStartRun = false;
                    runtime.maxQrAttempts = Number(msg.maxQrAttempts) || 12;
                    runtime._emitStatus();
                    reply(true, runtime.getStatus());
                    break;
                }
                case 'ai_reply_command': {
                    const res = await runtime.executeBotReply(msg);
                    reply(true, res);
                    break;
                }
                case 'send_direct': {
                    const res = await runtime.sendDirectMessage(msg);
                    reply(true, res);
                    break;
                }
                case 'send_media': {
                    const res = await runtime.sendMediaMessage(msg);
                    reply(true, res);
                    break;
                }
                case 'logout': {
                    await runtime.logout(msg);
                    reply(true, runtime.getStatus());
                    break;
                }
                case 'shutdown': {
                    await runtime.shutdown();
                    reply(true, { ok: true });
                    setTimeout(() => process.exit(0), 25);
                    break;
                }
                default:
                    reply(false, null, `Unknown worker message type: ${msg.type}`);
            }
        } catch (err) {
            reply(false, null, err?.message || String(err));
        }
    });

    process.on('disconnect', async () => {
        try { await runtime.shutdown(); } catch (_e) {}
        process.exit(0);
    });

    runtime._sendIpc({ type: 'worker_ready' });
}

module.exports = { WhatsappWorkerRuntime };
