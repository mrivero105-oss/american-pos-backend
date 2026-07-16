const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const AIService = require('./AIService');

class WhatsappBotService {
    constructor() {
        this.client = null;
        this.qrCodeUrl = null;
        this.status = 'DISCONNECTED';
        this.companyId = null; // En una versión multitenant sería un array o mapa
    }

    async init(companyId = 'DEFAULT_COMPANY') {
        if (this.client) return;

        this.companyId = companyId;
        this.status = 'INITIALIZING';
        console.log('[WHATSAPP] Inicializando cliente...');

        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: true
            }
        });

        this.client.on('qr', async (qr) => {
            console.log('[WHATSAPP] QR Code generado');
            this.status = 'QR_READY';
            try {
                this.qrCodeUrl = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('[WHATSAPP] Error generando DataURL del QR:', err);
            }
        });

        this.client.on('ready', () => {
            console.log('[WHATSAPP] ¡Cliente conectado y listo!');
            this.status = 'CONNECTED';
            this.qrCodeUrl = null;
        });

        this.client.on('auth_failure', msg => {
            console.error('[WHATSAPP] Fallo en autenticación', msg);
            this.status = 'AUTH_FAILED';
            this.qrCodeUrl = null;
        });

        this.client.on('disconnected', async (reason) => {
            console.log('[WHATSAPP] Cliente desconectado', reason);
            if (this.client) {
                try { await this.client.destroy(); } catch (e) { console.error('[WHATSAPP] Error destroy:', e); }
            }
            this.status = 'DISCONNECTED';
            this.client = null;
            this.qrCodeUrl = null;
        });

        this.client.on('message', async msg => {
            try {
                // Solo responder a chats privados y que no sean mensajes del propio bot
                if (msg.from === 'status@broadcast' || msg.isGroupMsg || msg.fromMe) return;

                console.log(`[WHATSAPP] Nuevo mensaje de ${msg.from}: ${msg.body}`);
                
                // Leemos el chat para generar el historial
                const chat = await msg.getChat();
                await chat.sendStateTyping();

                const messages = await chat.fetchMessages({ limit: 10 });
                const history = messages
                    .filter(m => m.id.id !== msg.id.id) // excluir el actual
                    .map(m => ({
                        role: m.fromMe ? 'model' : 'user',
                        content: m.body || ''
                    }))
                    .filter(m => m.content.trim() !== '');

                let audioMedia = null;
                if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
                    audioMedia = await msg.downloadMedia();
                    console.log(`[WHATSAPP] Audio recibido, preparando para IA...`);
                }

                // Consultar la IA (pasando isWhatsApp = true y audioMedia)
                const aiResponse = await AIService.askCustomerBot(this.companyId, msg.body, history, true, audioMedia);

                await chat.clearState();
                
                // Si la IA decide que no tiene que ver con productos, ignoramos silenciosamente
                if (aiResponse && !aiResponse.includes('IGNORE_MESSAGE')) {
                    await msg.reply(aiResponse);
                } else {
                    console.log(`[WHATSAPP] Mensaje personal ignorado por la IA: ${msg.body}`);
                }

            } catch (error) {
                console.error('[WHATSAPP] Error procesando mensaje:', error);
            }
        });

        this.client.initialize().catch(err => {
            console.error('[WHATSAPP] Fallo crítico al inicializar cliente:', err);
            this.status = 'ERROR';
            this.client = null;
        });
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
                await this.client.destroy();
            } catch (e) {
                console.error('[WHATSAPP] Error en logout', e);
            }
            this.status = 'DISCONNECTED';
            this.client = null;
            this.qrCodeUrl = null;
        }
    }
}

module.exports = new WhatsappBotService();
