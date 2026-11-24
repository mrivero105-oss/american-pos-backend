const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
let AIServiceRef = null;
const getAIService = () => (AIServiceRef || (AIServiceRef = require('./AIService')));
const {
    cleanLockFiles,
    pruneChromeBloatCache,
    getExecutablePath,
    getAuthDataPath,
    getSessionStatePath,
    readSessionState,
    writeSessionState,
    cleanPhoneNumber,
    formatPurchaseOrderMessage
} = require('./whatsappUtils');

const CRASH_BACKOFF_STEPS_MS = [2000, 5000, 10000];
const CRASH_WINDOW_RESET_MS = 10 * 60 * 1000;

class WhatsappBotService {
    constructor() {
        this.client = null;
        this.qrCodeUrl = null;
        this.status = 'DISCONNECTED';
        this.lastError = null;
        this.companyId = null;
        this.companyName = null;
        this.humanInterventionChats = new Map();
        this.botSentMessageIds = new Set();
        this.botSendingToChat = new Map();
        this.chatHistory = new Map();
        this.pendingBursts = new Map();
        this.initTimeout = null;
        this.qrAttempts = 0;
        this.maxQrAttempts = 4;
        this._isAutoStartRun = false;
        this._activeInitToken = null;
        this._initInFlight = null;

        // Estado del proceso hijo aislado
        this._worker = null;
        this._workerReqSeq = 0;
        this._pendingRpc = new Map();
        this._intentionalStop = false;
        this._crashCount = 0;
        this._lastCrashAt = 0;
        this._restartTimer = null;
        this.maxCrashRestarts = 3;
        this.crashBackoffStepsMs = [...CRASH_BACKOFF_STEPS_MS];
        this._activeWorkerScript = null;
    }

    _emitStatus() {
        try {
            if (!global.io) return;
            const payload = this.getStatus();
            const targetRoom = (this.companyId && this.companyId !== 'default')
                ? String(this.companyId)
                : String(process.env.DEFAULT_COMPANY_ID || '2');
            global.io.to(targetRoom).emit('whatsapp_status', payload);
        } catch (_e) {}
    }

    _getAuthDataPath() {
        return getAuthDataPath();
    }

    _getSessionStatePath(authDataPath) {
        return getSessionStatePath(authDataPath);
    }

    _readSessionState(authDataPath) {
        return readSessionState(authDataPath);
    }

    _writeSessionState(authDataPath, patch) {
        return writeSessionState(authDataPath, patch);
    }

    _recordChatTurn(chatId, role, content) {
        if (!chatId || !content || !content.trim()) return;
        let list = this.chatHistory.get(chatId) || [];
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

    _rejectAllPendingRpc(reason) {
        for (const [reqId, pending] of this._pendingRpc.entries()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
            this._pendingRpc.delete(reqId);
        }
    }

    _sendRpc(type, payload = {}, timeoutMs = 20000) {
        if (!this._worker || !this._worker.connected) {
            return Promise.reject(new Error('El proceso trabajador de WhatsApp no está activo'));
        }
        this._workerReqSeq += 1;
        const reqId = this._workerReqSeq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRpc.delete(reqId);
                reject(new Error(`Timeout IPC de WhatsApp para ${type} (${timeoutMs}ms)`));
            }, timeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
            this._pendingRpc.set(reqId, { resolve, reject, timer });
            try {
                this._worker.send({ ...payload, type, reqId });
            } catch (err) {
                clearTimeout(timer);
                this._pendingRpc.delete(reqId);
                reject(err);
            }
        });
    }

    async _teardownWorkerProcess({ sendShutdown = true } = {}) {
        const worker = this._worker;
        if (!worker) return;
        if (sendShutdown && worker.connected) {
            try {
                await Promise.race([
                    this._sendRpc('shutdown', {}, 2500),
                    new Promise((resolve) => setTimeout(resolve, 2600))
                ]);
            } catch (_e) {}
        }
        this._rejectAllPendingRpc('Proceso de WhatsApp detenido');
        if (this._worker === worker) {
            this._worker = null;
        }
        try {
            if (!worker.killed && worker.exitCode === null) {
                worker.kill('SIGTERM');
            }
        } catch (_e) {}
    }

    async _teardownStaleClient(authDataPath, { nextStatus = 'DISCONNECTED', lastError = null, pruneCache = false, includeServiceWorkerCache = false, stopWorker = true } = {}) {
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

        if (stopWorker && this._worker) {
            const prevIntentional = this._intentionalStop;
            this._intentionalStop = true;
            await this._teardownWorkerProcess({ sendShutdown: true });
            this._intentionalStop = prevIntentional;
        }

        if (authDataPath) {
            cleanLockFiles(authDataPath);
            if (pruneCache) {
                pruneChromeBloatCache(authDataPath, { includeServiceWorkerCache });
            }
        }
    }

    async _handleIncomingConsolidated({ msgRefId, senderChat, bodyText, audioMedia, imageMedia }) {
        try {
            const text = (bodyText || '').trim();

            // 1. Comprobar si hay intervención humana activa en este chat
            const humanExpiry = this.humanInterventionChats.get(senderChat);
            if (humanExpiry && Date.now() < humanExpiry) {
                console.log(`[WHATSAPP] 👤 Chat ${senderChat} atendido manualmente. Bot en pausa.`);
                return;
            }

            // 2. Solicitud explícita de atención humana
            const isAskingForHuman = /(quiero\s+hablar\s+con\s+(?:una\s+persona|alguien|el\s+due[nñ]o|un\s+humano|asesor)|atenci[oó]n\s+humana|p[aá]same\s+con\s+(?:alguien|un\s+humano|el\s+due[nñ]o)|comunicar(?:me)?\s+con\s+(?:un\s+humano|una\s+persona))/i.test(text);
            if (isAskingForHuman) {
                this.humanInterventionChats.set(senderChat, Date.now() + 30 * 60 * 1000);
                this.botSendingToChat.set(senderChat, Date.now() + 12000);
                const humanReplyText = '¡Con gusto! 👤 Te estoy transfiriendo con nuestro equipo de atención humana. En unos momentos uno de nuestros encargados te responderá directamente por aquí. ¡Gracias por tu paciencia! 😊';
                this._recordChatTurn(senderChat, 'user', text);
                this._recordChatTurn(senderChat, 'model', humanReplyText);
                const res = await this._sendRpc('ai_reply_command', {
                    msgRefId,
                    senderChat,
                    mode: 'reply_or_send',
                    text: humanReplyText
                });
                for (const id of res?.sentIds || []) this.botSentMessageIds.add(id);
                return;
            }

            // 3. Filtrar notificaciones bancarias u operadoras que no sean comprobantes
            const isAutomatedServiceMsg = /(recarga\s+exitosa|saldo\s+(?:actual|disponible)|pagomovil\s+bdv\s+informa|notificaci[oó]n\s+de\s+d[eé]bito|clave\s+din[aá]mica|c[oó]digo\s+de\s+verificaci[oó]n|transferencia\s+recibida\s+de\s+un\s+banco)/i.test(text);
            if (isAutomatedServiceMsg && !text.toLowerCase().includes('comprobante') && !text.toLowerCase().includes('pago') && !text.toLowerCase().includes('ref')) {
                console.log('[WHATSAPP] 🚫 Mensaje automático de servicio/banco ignorado.');
                return;
            }

            const history = this._getChatHistory(senderChat);
            const hadRecentBotActivity = history.some(h => h.role === 'model');

            // 4. Agradecimientos y despedidas
            const isGratitudeOrFarewell = /^(gracias|muchas\s+gracias|much[ií]simas\s+gracias|grx|mil\s+gracias|gracias\s+amigo|gracias\s+amiga|chao|adios|adi[oó]s|hasta\s+luego|feliz\s+(?:d[ií]a|tarde|noche)|buen\s+d[ií]a|que\s+tengas?\s+buen\s+d[ií]a|que\s+pase\s+buen\s+d[ií]a|igualmente)$/i.test(text);
            if (isGratitudeOrFarewell) {
                if (!hadRecentBotActivity && history.length > 0) {
                    return;
                }
                this.botSendingToChat.set(senderChat, Date.now() + 12000);
                const bizName = this.companyName || process.env.BUSINESS_NAME || 'nuestra tienda';
                const farewellText = `¡Siempre a tu orden! 😊 Ha sido un verdadero placer atenderte. En *${bizName}* estamos a tu servicio cuando lo necesites. ¡Que tengas un excelente día! ✨`;
                this._recordChatTurn(senderChat, 'user', text);
                this._recordChatTurn(senderChat, 'model', farewellText);
                const res = await this._sendRpc('ai_reply_command', {
                    msgRefId,
                    senderChat,
                    mode: 'reply_or_send',
                    text: farewellText,
                    reaction: '❤️'
                });
                for (const id of res?.sentIds || []) this.botSentMessageIds.add(id);
                return;
            }

            // 5. Confirmaciones cortas
            const isShortAck = /^(ok|okay|dale|listo|perfecto|chevere|ch[eé]vere|fino|entendido|am[eé]n|amen|jaja|jajaja|bueno|ya|👍|👌|👏|🙏|❤️|😊|🙌)$/i.test(text);
            if (isShortAck) {
                if (hadRecentBotActivity) {
                    await this._sendRpc('ai_reply_command', {
                        msgRefId,
                        senderChat,
                        mode: 'react_only',
                        reaction: '👍'
                    }).catch(() => {});
                }
                return;
            }

            if (!text && !audioMedia && !imageMedia) {
                return;
            }

            // 6. Consultar el Motor Comercial / IA usando el pool PostgreSQL del proceso principal
            console.log(`[WHATSAPP] 🤖 Consultando IA para cliente ${senderChat}...`);
            const aiResult = await getAIService().askCustomerBot(
                this.companyId || 'default',
                text,
                history,
                true,
                audioMedia || null,
                imageMedia || null,
                senderChat
            );

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

            if (aiResponseText && !aiResponseText.includes('IGNORE_MESSAGE')) {
                this._recordChatTurn(senderChat, 'user', text || '[Media]');
                this._recordChatTurn(senderChat, 'model', aiResponseText);

                await new Promise(r => setTimeout(r, 700));

                this.botSendingToChat.set(senderChat, Date.now() + 12000);
                const sendRes = await this._sendRpc('ai_reply_command', {
                    msgRefId,
                    senderChat,
                    mode: 'reply_or_send',
                    text: aiResponseText,
                    mediaPath,
                    mediaUrl,
                    mediaBase64
                }, 45000);
                for (const id of sendRes?.sentIds || []) this.botSentMessageIds.add(id);
            }
        } catch (err) {
            console.error('[WHATSAPP] Error procesando mensaje desde worker:', err?.message || err);
        }
    }

    _handleWorkerExit(worker, code, signal, { workerScriptPath }) {
        if (this._worker !== worker) return;
        this._worker = null;
        this._rejectAllPendingRpc(`Worker WhatsApp terminado (code=${code}, signal=${signal})`);

        if (this._intentionalStop) {
            this.status = 'DISCONNECTED';
            this.qrCodeUrl = null;
            this._emitStatus();
            return;
        }

        const now = Date.now();
        if (now - this._lastCrashAt > CRASH_WINDOW_RESET_MS) {
            this._crashCount = 0;
        }
        this._lastCrashAt = now;
        this._crashCount += 1;

        this.status = 'DISCONNECTED';
        this.qrCodeUrl = null;

        if (this._crashCount > this.maxCrashRestarts) {
            this.lastError = 'El proceso aislado de WhatsApp se detuvo repetidamente y fue pausado para proteger el sistema.';
            this._emitStatus();
            console.error(`[WHATSAPP] 🛑 Worker alcanzó límite de reinicios (${this.maxCrashRestarts}). Deteniendo backoff.`);
            return;
        }

        const idx = Math.min(this._crashCount - 1, this.crashBackoffStepsMs.length - 1);
        const delayMs = this.crashBackoffStepsMs[idx];
        this.lastError = `Proceso aislado de WhatsApp reiniciando en ${Math.round(delayMs / 1000)}s (intento ${this._crashCount}/${this.maxCrashRestarts})...`;
        this._emitStatus();
        console.warn(`[WHATSAPP] ⚠️ Worker finalizó inesperadamente (code=${code}, signal=${signal}). Reiniciando en ${delayMs}ms (${this._crashCount}/${this.maxCrashRestarts})...`);

        if (this._restartTimer) clearTimeout(this._restartTimer);
        this._restartTimer = setTimeout(() => {
            this._restartTimer = null;
            if (!this._intentionalStop) {
                this.init(this.companyId || 'default', {
                    forceRestart: true,
                    workerScriptPath
                }).catch((e) => {
                    console.warn('[WHATSAPP] Fallo al reiniciar worker:', e?.message || e);
                });
            }
        }, delayMs);
        if (typeof this._restartTimer.unref === 'function') {
            this._restartTimer.unref();
        }
    }

    async _spawnWorker(workerScriptPath) {
        this._activeWorkerScript = workerScriptPath;
        let worker = null;

        if (process.versions && process.versions.electron) {
            try {
                const { utilityProcess } = require('electron');
                if (utilityProcess && typeof utilityProcess.fork === 'function') {
                    const rawUtility = utilityProcess.fork(workerScriptPath, [], {
                        env: { ...process.env },
                        stdio: 'inherit',
                        serviceName: 'IsaacPOS-WhatsAppWorker'
                    });
                    let connected = true;
                    let killed = false;
                    let exitCode = null;
                    rawUtility.once('exit', (code) => {
                        connected = false;
                        exitCode = typeof code === 'number' ? code : 0;
                    });
                    worker = {
                        get connected() { return connected; },
                        get killed() { return killed; },
                        get exitCode() { return exitCode; },
                        get pid() { return rawUtility.pid; },
                        send(payload) {
                            if (!connected) throw new Error('Canal IPC de utilityProcess cerrado');
                            rawUtility.postMessage(payload);
                        },
                        kill() {
                            killed = true;
                            connected = false;
                            return rawUtility.kill();
                        },
                        on(eventName, listener) {
                            if (eventName === 'message') {
                                rawUtility.on('message', listener);
                            } else if (eventName === 'exit') {
                                rawUtility.on('exit', (code) => listener(code, null));
                            }
                            return this;
                        },
                        once(eventName, listener) {
                            if (eventName === 'exit') {
                                rawUtility.once('exit', (code) => listener(code, null));
                            } else if (eventName === 'error') {
                                // Electron utilityProcess reporta fallos mediante 'exit'
                            } else {
                                rawUtility.once(eventName, listener);
                            }
                            return this;
                        }
                    };
                }
            } catch (_utilErr) {}
        }

        if (!worker) {
            worker = fork(workerScriptPath, [], {
                env: { ...process.env },
                execArgv: [],
                stdio: ['ignore', 'inherit', 'inherit', 'ipc']
            });
        }
        this._worker = worker;

        let readyResolved = false;
        const readyPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!readyResolved) {
                    readyResolved = true;
                    reject(new Error('Timeout esperando arranque del worker aislado de WhatsApp'));
                }
            }, 10000);
            if (typeof timer.unref === 'function') timer.unref();

            const onMessage = (msg) => {
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'worker_ready') {
                    if (!readyResolved) {
                        readyResolved = true;
                        clearTimeout(timer);
                        resolve();
                    }
                    return;
                }
                if (msg.type === 'rpc_result' && msg.reqId !== undefined) {
                    const pending = this._pendingRpc.get(msg.reqId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this._pendingRpc.delete(msg.reqId);
                        if (msg.ok) pending.resolve(msg.data);
                        else pending.reject(new Error(msg.error || 'Error RPC en worker WhatsApp'));
                    }
                    return;
                }
                if (msg.type === 'status_update') {
                    this.status = msg.status || this.status;
                    this.qrCodeUrl = msg.qrCodeUrl !== undefined ? msg.qrCodeUrl : null;
                    this.lastError = msg.lastError !== undefined ? msg.lastError : null;
                    if (typeof msg.qrAttempts === 'number') this.qrAttempts = msg.qrAttempts;
                    if (typeof msg.maxQrAttempts === 'number') this.maxQrAttempts = msg.maxQrAttempts;
                    if (typeof msg._isAutoStartRun === 'boolean') this._isAutoStartRun = msg._isAutoStartRun;
                    if (msg.companyId) this.companyId = msg.companyId;
                    if (this.status === 'CONNECTED') {
                        this._crashCount = 0;
                        this.humanInterventionChats.clear();
                    }
                    this._emitStatus();
                    return;
                }
                if (msg.type === 'worker_log' && msg.message) {
                    if (msg.level === 'error') console.error(msg.message);
                    else if (msg.level === 'warn') console.warn(msg.message);
                    else console.log(msg.message);
                    return;
                }
                if (msg.type === 'incoming_consolidated') {
                    this._handleIncomingConsolidated(msg).catch(() => {});
                }
            };

            worker.on('message', onMessage);
            worker.once('error', (err) => {
                if (!readyResolved) {
                    readyResolved = true;
                    clearTimeout(timer);
                    reject(err);
                }
            });
            worker.once('exit', (code, signal) => {
                if (!readyResolved) {
                    readyResolved = true;
                    clearTimeout(timer);
                    reject(new Error(`Worker WhatsApp cerró durante el arranque (code=${code})`));
                }
                this._handleWorkerExit(worker, code, signal, { workerScriptPath });
            });
        });

        await readyPromise;
        return worker;
    }

    async init(companyId = 'default', options = {}) {
        const isAutoStart = Boolean(options?.autoStart);
        const forceRestart = Boolean(options?.forceRestart);
        const workerScriptPath = options?.workerScriptPath
            || process.env.WHATSAPP_WORKER_SCRIPT
            || path.join(__dirname, 'whatsappWorker.js');
        const isCustomWorkerScript = Boolean(options?.workerScriptPath || process.env.WHATSAPP_WORKER_SCRIPT);

        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        this._intentionalStop = false;

        const authDataPath = this._getAuthDataPath();
        const sessionState = this._readSessionState(authDataPath);

        if (isAutoStart) {
            if (sessionState && sessionState.linked === false) {
                console.log('[WHATSAPP] ℹ️ Bot sin sesión vinculada previa; omitiendo auto-inicio de navegador en arranque.');
                this.status = 'DISCONNECTED';
                this.qrCodeUrl = null;
                this.lastError = null;
                return this.getStatus();
            }
            if (!sessionState && !fs.existsSync(path.join(authDataPath, 'session'))) {
                this._writeSessionState(authDataPath, { linked: false, reason: 'never_linked' });
                console.log('[WHATSAPP] ℹ️ Sin perfil previo de WhatsApp Web; esperando vinculación manual.');
                this.status = 'DISCONNECTED';
                this.qrCodeUrl = null;
                this.lastError = null;
                return this.getStatus();
            }
        }

        if (!forceRestart) {
            if (this._initInFlight) {
                if (!isAutoStart) {
                    this._isAutoStartRun = false;
                    this.maxQrAttempts = 12;
                }
                return this._initInFlight;
            }
            if (this.client || this._worker) {
                if (this.status === 'CONNECTED') {
                    this._emitStatus();
                    return this.getStatus();
                }
                if (this.status === 'QR_READY' && this.qrCodeUrl) {
                    this._isAutoStartRun = false;
                    this.maxQrAttempts = 12;
                    if (this._worker) {
                        this._sendRpc('promote_manual', { maxQrAttempts: 12 }).catch(() => {});
                    }
                    this._emitStatus();
                    return this.getStatus();
                }
                if (this.status === 'INITIALIZING') {
                    if (!isAutoStart) {
                        this._isAutoStartRun = false;
                        this.maxQrAttempts = 12;
                        if (this._worker) {
                            this._sendRpc('promote_manual', { maxQrAttempts: 12 }).catch(() => {});
                        }
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
                includeServiceWorkerCache: false,
                stopWorker: true
            });

            this._intentionalStop = false;
            this._isAutoStartRun = isAutoStart;
            this.qrAttempts = 0;
            this.maxQrAttempts = isAutoStart ? 4 : 12;
            this.companyId = (!companyId || companyId === 'DEFAULT_COMPANY') ? 'default' : companyId;
            this.status = 'INITIALIZING';
            this.qrCodeUrl = null;
            this.lastError = null;
            this._emitStatus();

            if (!isCustomWorkerScript) {
                const execPath = getExecutablePath();
                if (!execPath) {
                    console.log('[WHATSAPP] ℹ️ Navegador Chromium/Edge no detectado en el host. Bot en modo pasivo.');
                    this.status = 'DISCONNECTED';
                    this.lastError = 'No se detectó Google Chrome ni Microsoft Edge instalado en este equipo.';
                    this._emitStatus();
                    return this.getStatus();
                }
            }

            try {
                await this._spawnWorker(workerScriptPath);
                const initRes = await this._sendRpc('init', {
                    companyId: this.companyId,
                    authDataPath,
                    options: {
                        autoStart: isAutoStart,
                        forceRestart
                    }
                }, 20000);
                if (initRes && typeof initRes === 'object' && initRes.status) {
                    this.status = initRes.status;
                    if (initRes.lastError !== undefined) this.lastError = initRes.lastError;
                    if (initRes.qrCodeUrl !== undefined) this.qrCodeUrl = initRes.qrCodeUrl;
                }
            } catch (err) {
                console.warn('[WHATSAPP] Error iniciando worker aislado:', err?.message || err);
                await this._teardownStaleClient(authDataPath, {
                    nextStatus: 'DISCONNECTED',
                    lastError: `Error iniciando el trabajador aislado de WhatsApp: ${err?.message || err}`,
                    stopWorker: true
                });
            }

            return this.getStatus();
        };

        this._initInFlight = runSetup();
        try {
            return await this._initInFlight;
        } finally {
            this._initInFlight = null;
        }
    }

    cleanPhoneNumber(phone) {
        return cleanPhoneNumber(phone);
    }

    formatPurchaseOrderMessage(params) {
        return formatPurchaseOrderMessage(params);
    }

    async sendDirectMessage(phone, messageText) {
        const cleanPhone = this.cleanPhoneNumber(phone);
        if (!cleanPhone) {
            throw new Error('El proveedor no tiene un número de teléfono válido registrado');
        }

        const chatId = `${cleanPhone}@c.us`;
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageText)}`;

        if (this.status === 'CONNECTED' && this._worker) {
            try {
                this.botSendingToChat.set(chatId, Date.now() + 12000);
                const res = await this._sendRpc('send_direct', {
                    cleanPhone,
                    chatId,
                    messageText,
                    whatsappUrl
                }, 25000);
                for (const id of res?.sentIds || []) this.botSentMessageIds.add(id);
                if (res?.response) return res.response;
            } catch (err) {
                console.warn(`[WHATSAPP] Error RPC sendDirectMessage:`, err.message);
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

        if (this.status === 'CONNECTED' && this.client && typeof this.client.sendMessage === 'function') {
            this.botSendingToChat.set(chatId, Date.now() + 12000);
            const sentMsg = await this.client.sendMessage(chatId, messageText);
            if (sentMsg?.id?.id) this.botSentMessageIds.add(sentMsg.id.id);
            if (sentMsg?.id?._serialized) this.botSentMessageIds.add(sentMsg.id._serialized);
            return {
                success: true,
                botSent: true,
                phone: cleanPhone,
                chatId,
                whatsappUrl,
                message: 'Pedido enviado exitosamente al WhatsApp del proveedor'
            };
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

    async sendMediaMessage(phone, base64Data, mimeType = 'image/png', caption = '', filename = 'ticket.png') {
        const cleanPhone = this.cleanPhoneNumber(phone);
        if (!cleanPhone) {
            throw new Error('Número de teléfono no válido o sin formato');
        }

        const chatId = `${cleanPhone}@c.us`;
        const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}`;

        if (this.status !== 'CONNECTED' || (!this._worker && !this.client)) {
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

        if (this._worker) {
            try {
                this.botSendingToChat.set(chatId, Date.now() + 12000);
                const res = await this._sendRpc('send_media', {
                    cleanPhone,
                    base64Data,
                    mimeType,
                    caption,
                    filename,
                    whatsappUrl
                }, 35000);
                for (const id of res?.sentIds || []) this.botSentMessageIds.add(id);
                if (res?.response) return res.response;
            } catch (err) {
                console.warn(`[WHATSAPP] Error RPC sendMediaMessage:`, err.message);
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

    getStatus() {
        return {
            status: this.status,
            qrCodeUrl: this.qrCodeUrl,
            lastError: this.lastError,
            qrAttempts: this.qrAttempts,
            maxQrAttempts: this.maxQrAttempts
        };
    }

    _pruneChromeBloatCache(authDataPath, options) {
        return pruneChromeBloatCache(authDataPath, options);
    }

    async shutdown() {
        this._intentionalStop = true;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        for (const entry of this.pendingBursts.values()) {
            if (entry?.timer) clearTimeout(entry.timer);
        }
        this.pendingBursts.clear();
        await this._teardownStaleClient(this._getAuthDataPath(), {
            nextStatus: 'DISCONNECTED',
            pruneCache: true,
            includeServiceWorkerCache: false,
            stopWorker: true
        });
    }

    async logout() {
        this._intentionalStop = true;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        const authDataPath = this._getAuthDataPath();
        const wasConnected = this.status === 'CONNECTED';
        this._writeSessionState(authDataPath, { linked: false, reason: 'manual_logout' });

        if (this._worker) {
            try {
                await Promise.race([
                    this._sendRpc('logout', { authDataPath }, 3500),
                    new Promise((resolve) => setTimeout(resolve, 3600))
                ]);
            } catch (e) {
                console.error('[WHATSAPP] Error en logout worker:', e.message);
            }
        } else if (wasConnected && this.client) {
            try {
                await Promise.race([
                    this.client.logout(),
                    new Promise((resolve) => setTimeout(resolve, 2500))
                ]);
            } catch (e) {
                console.error('[WHATSAPP] Error en logout', e.message);
            }
        }

        await this._teardownStaleClient(authDataPath, {
            nextStatus: 'DISCONNECTED',
            pruneCache: true,
            includeServiceWorkerCache: true,
            stopWorker: true
        });
    }
}

module.exports = new WhatsappBotService();
