const https = require('https');
const { readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');
const WhatsappBotService = require('./WhatsappBotService');

class OwnerNotificationService {
    /**
     * Resolves owner notification configuration for a given company
     */
    getConfig(companyId) {
        try {
            const allSettings = readJson(SETTINGS_FILE) || {};
            const settings = getUserSettings(allSettings, companyId || '2') || {};
            const biz = settings.businessInfo || settings.business || {};
            const notif = settings.ownerNotifications || {};

            return {
                enabled: notif.enabled ?? true,
                ownerPhone: notif.ownerPhone || biz.ownerWhatsappPhone || biz.phone || biz.ownerPhone || '',
                telegramBotToken: notif.telegramBotToken || biz.ownerTelegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '',
                telegramChatId: notif.telegramChatId || biz.ownerTelegramChatId || process.env.TELEGRAM_CHAT_ID || '',
                notifyShiftClose: notif.notifyShiftClose ?? true,
                notifyRefunds: notif.notifyRefunds ?? true,
                refundThreshold: Number(notif.refundThreshold || 20),
                notifyDrawerOpenNoSale: notif.notifyDrawerOpenNoSale ?? true,
                businessName: biz.name || 'Isaac POS'
            };
        } catch (e) {
            console.warn('[OwnerNotificationService] Error reading settings:', e.message);
            return {
                enabled: false,
                ownerPhone: '',
                businessName: 'Isaac POS'
            };
        }
    }

    /**
     * Sends message via WhatsApp and/or Telegram
     */
    async dispatch(cfg, messageText) {
        let sentWhatsApp = false;
        let sentTelegram = false;

        // 1. WhatsApp Delivery
        if (cfg.ownerPhone) {
            try {
                const res = await WhatsappBotService.sendDirectMessage(cfg.ownerPhone, messageText);
                if (res?.botSent) sentWhatsApp = true;
            } catch (wErr) {
                console.warn('[OwnerNotificationService] WhatsApp alert dispatch failed:', wErr.message);
            }
        }

        // 2. Telegram Delivery (Optional Dual Channel)
        if (cfg.telegramBotToken && cfg.telegramChatId) {
            try {
                await this._sendTelegram(cfg.telegramBotToken, cfg.telegramChatId, messageText);
                sentTelegram = true;
            } catch (tErr) {
                console.warn('[OwnerNotificationService] Telegram alert dispatch failed:', tErr.message);
            }
        }

        return { sentWhatsApp, sentTelegram };
    }

    /**
     * Sends dual notification (WhatsApp + Telegram)
     */
    async sendDualNotification(messageText, options = {}) {
        const companyId = options.companyId || '2';
        let cfg = options.config ? { ...options.config } : this.getConfig(companyId);

        if (options.ownerPhone) cfg.ownerPhone = options.ownerPhone;
        if (options.telegramBotToken) cfg.telegramBotToken = options.telegramBotToken;
        if (options.telegramChatId) cfg.telegramChatId = options.telegramChatId;

        const { sentWhatsApp, sentTelegram } = await this.dispatch(cfg, messageText);
        return {
            whatsapp: sentWhatsApp,
            telegram: sentTelegram
        };
    }

    /**
     * Dispatches executive Cierre de Caja Z summary
     */
    async notifyShiftClose(companyId, shiftData) {
        const cfg = this.getConfig(companyId);
        if (!cfg.enabled || !cfg.notifyShiftClose) return;

        try {
            const shift = shiftData.shift || shiftData;
            const diffUsd = Number(shiftData.differenceUSD ?? shift.difference ?? 0);
            const diffVes = Number(shiftData.differenceVES ?? 0);
            const isMatch = (diffUsd === 0 && diffVes === 0);

            const nowStr = new Date().toLocaleString('es-VE', { 
                timeZone: 'America/Caracas', 
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true 
            });

            const sales = shift.salesSummary || {};
            const totalSales = Number(sales.totalSales || shift.totalSales || 0).toFixed(2);
            const cashSales = Number(sales.cashSales || 0).toFixed(2);
            const salesCount = sales.salesCount || 0;

            let msg = `📊 *CIERRE DE CAJA Z — NOTIFICACIÓN EJECUTIVA*\n`;
            msg += `🏢 *${cfg.businessName}*\n`;
            msg += `📍 *Caja:* ${shift.registerId || '01'} | *Cajero:* ${shift.userName || 'Usuario'}\n`;
            msg += `📅 *Fecha:* ${nowStr}\n`;
            msg += `--------------------------------\n`;
            msg += `💰 *Ventas Totales:* $${totalSales} (${salesCount} transacciones)\n`;
            msg += `💵 *Efectivo USD:* $${cashSales}\n`;

            if (shiftData.differences) {
                const d = shiftData.differences;
                if (d.zelle) msg += `💳 *Zelle:* $${Number(shiftData.expected?.zelle || 0).toFixed(2)}\n`;
                if (d.card) msg += `💳 *Punto de Venta:* Bs ${Number(shiftData.expected?.card || 0).toFixed(2)}\n`;
                if (d.mobile) msg += `📱 *Pago Móvil:* Bs ${Number(shiftData.expected?.mobile || 0).toFixed(2)}\n`;
            }

            msg += `--------------------------------\n`;
            if (isMatch) {
                msg += `🎯 *Resultado de Cuadre:* ✅ CUADRE PERFECTO ($0.00)\n`;
            } else {
                msg += `⚠️ *Resultado de Cuadre:* ❌ DESCUADRE DETECTADO\n`;
                msg += `💵 Diferencia USD: ${diffUsd >= 0 ? '+' : ''}$${diffUsd.toFixed(2)}\n`;
                if (diffVes !== 0) msg += `🇻🇪 Diferencia Bs: ${diffVes >= 0 ? '+' : ''}Bs ${diffVes.toFixed(2)}\n`;
            }

            if (shift.closingNotes) {
                msg += `📝 *Observaciones:* ${shift.closingNotes}\n`;
            }

            msg += `\n🔒 *ID Turno:* #${String(shift.id || '').substring(0, 8).toUpperCase()}`;

            const dispatchResult = await this.dispatch(cfg, msg);
            console.log(`[OwnerNotificationService] Cierre Z notificado para caja ${shift.registerId}`);
            return { success: true, message: msg, ...dispatchResult };
        } catch (e) {
            console.warn('[OwnerNotificationService] Error building shift close alert:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Dispatches security alert (Refund, Price Change, Drawer Open)
     */
    async notifySecurityAlert(companyId, alertType, data = {}) {
        const cfg = this.getConfig(companyId);
        if (!cfg.enabled) return { success: false, reason: 'NOT_ENABLED' };

        try {
            const nowStr = new Date().toLocaleTimeString('es-VE', { 
                timeZone: 'America/Caracas', 
                hour: '2-digit', minute: '2-digit', hour12: true 
            });

            let msg = '';
            if (alertType === 'REFUND') {
                const amount = Number(data.amount || 0);
                if (!cfg.notifyRefunds || amount < cfg.refundThreshold) return { success: false, reason: 'BELOW_THRESHOLD' };

                msg = `🚨 *ALERTA DE SEGURIDAD: DEVOLUCIÓN / ANULACIÓN*\n`;
                msg += `🏢 *${cfg.businessName}*\n`;
                msg += `👤 *Cajero:* ${data.userName || 'Usuario'} (Caja ${data.registerId || '1'})\n`;
                msg += `💵 *Monto:* $${amount.toFixed(2)}\n`;
                if (data.reason) msg += `📝 *Motivo:* ${data.reason}\n`;
                if (data.authorizedBy) msg += `🔑 *Autorizado por:* ${data.authorizedBy}\n`;
                msg += `⏰ *Hora:* ${nowStr}`;
            } else if (alertType === 'DRAWER_OPEN_NO_SALE' || alertType === 'MANUAL_DRAWER_OPEN') {
                if (!cfg.notifyDrawerOpenNoSale) return { success: false, reason: 'DISABLED' };

                msg = `⚠️ *ALERTA: APERTURA MANUAL DE GAVETA DE DINERO*\n`;
                msg += `🏢 *${cfg.businessName}*\n`;
                msg += `👤 *Usuario:* ${data.userName || data.cashierName || 'Usuario'} (Caja ${data.registerId || '1'})\n`;
                msg += `📝 *Motivo:* ${data.reason || 'Apertura manual sin venta registrada'}\n`;
                msg += `⏰ *Hora:* ${nowStr}`;
            } else if (alertType === 'PRICE_CHANGE') {
                msg = `🏷️ *ALERTA: CAMBIO MANUAL DE PRECIO*\n`;
                msg += `🏢 *${cfg.businessName}*\n`;
                msg += `📦 *Producto:* ${data.productName || 'Producto'}\n`;
                msg += `💲 *Precio Anterior:* $${data.oldPrice} ➔ *Nuevo:* $${data.newPrice}\n`;
                msg += `👤 *Modificado por:* ${data.userName || 'Usuario'}\n`;
                msg += `⏰ *Hora:* ${nowStr}`;
            }

            if (msg) {
                const dispatchResult = await this.dispatch(cfg, msg);
                return { success: true, message: msg, ...dispatchResult };
            }
            return { success: false, reason: 'NO_MESSAGE' };
        } catch (e) {
            console.warn('[OwnerNotificationService] Error sending security alert:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * Direct HTTP Telegram sender
     */
    _sendTelegram(token, chatId, text) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown'
            });

            const req = https.request({
                hostname: 'api.telegram.org',
                port: 443,
                path: `/bot${token}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Telegram timeout')); });
            req.write(postData);
            req.end();
        });
    }
}

module.exports = new OwnerNotificationService();
