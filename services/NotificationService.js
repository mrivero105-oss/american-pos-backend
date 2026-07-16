const nodemailer = require('nodemailer');
const { readJson, getUserSettings } = require('../utils/helpers');
const { SETTINGS_FILE } = require('../config/paths');

class NotificationService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail', // Simplificado para este entorno
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    /**
     * Envía una notificación inmediata para alertas CRÍTICAS con impacto visual extremo.
     */
    async sendImmediateAlert(alert, companyId) {
        try {
            const settings = getUserSettings(readJson(SETTINGS_FILE), companyId);
            const ownerEmail = settings.ownerEmail || process.env.DEFAULT_OWNER_EMAIL;

            if (!ownerEmail) return;

            const isCritical = alert.severity === 'critical';
            const color = isCritical ? '#ef4444' : '#f59e0b';
            const icon = isCritical ? '🚨' : '⚠️';
            
            // Asunto ultra-optimizado para escaneo
            const subject = `${icon} ${alert.message.split(':')[0]} - ${alert.metadata?.differences?.usd ? '$' + Math.abs(alert.metadata.differences.usd) : 'Alerta'}`;

            const mailOptions = {
                from: '"American POS Intelligence" <security@americanpos.com>',
                to: ownerEmail,
                subject: subject,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 24px; overflow: hidden; background: #ffffff;">
                        <div style="background: ${color}; padding: 20px; text-align: center;">
                            <span style="font-size: 40px;">${icon}</span>
                        </div>
                        <div style="padding: 32px; text-align: center;">
                            <h2 style="margin: 0; font-size: 24px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: -1px;">${alert.message.split(':')[0]}</h2>
                            <p style="margin: 12px 0 0; font-size: 16px; color: #64748b; font-weight: 600;">${alert.message}</p>
                            
                            <div style="margin: 32px 0; padding: 24px; background: #f8fafc; border-radius: 20px; border: 1px dashed #e2e8f0;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="text-align: left; font-size: 11px; font-weight: 900; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Responsable</td>
                                        <td style="text-align: right; font-size: 14px; font-weight: 800; color: #1e293b;">${alert.userId}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding-top: 12px; text-align: left; font-size: 11px; font-weight: 900; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Severidad</td>
                                        <td style="padding-top: 12px; text-align: right; font-size: 14px; font-weight: 800; color: ${color};">${alert.severity.toUpperCase()}</td>
                                    </tr>
                                </table>
                            </div>

                            <a href="http://localhost:3000/audit-alerts?id=${alert.id}" style="display: block; background: #0f172a; color: #ffffff; padding: 18px; text-decoration: none; border-radius: 16px; font-size: 14px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);">
                                Gestionar Incidencia
                            </a>
                        </div>
                        <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                            Verificado vía Auditoría Criptográfica
                        </div>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
        } catch (error) {
            console.error('[NotificationService] Error al enviar email:', error.message);
        }
    }

    /**
     * Envía el resumen diario inteligente (Digest) con conclusiones directas.
     */
    async sendDailyDigest(summary, companyId) {
        try {
            const settings = getUserSettings(readJson(SETTINGS_FILE), companyId);
            const ownerEmail = settings.ownerEmail || process.env.DEFAULT_OWNER_EMAIL;

            if (!ownerEmail) return;

            const { totalLossUSD, openAlertsCount, alerts = [] } = summary;
            if (totalLossUSD >= 0 && openAlertsCount === 0) return;

            const hasCriticalLoss = totalLossUSD < -20;
            const statusColor = hasCriticalLoss ? '#ef4444' : '#f59e0b';

            const mailOptions = {
                from: '"American POS Intelligence" <audit@americanpos.com>',
                to: ownerEmail,
                subject: `📋 Balance Diario: ${totalLossUSD < 0 ? 'Pérdida detectada' : 'Alertas pendientes'}`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 24px; padding: 32px; background: #ffffff;">
                        <h1 style="margin: 0 0 8px; font-size: 28px; font-weight: 900; color: #0f172a; letter-spacing: -1px;">BALANCE DIARIO</h1>
                        <p style="margin: 0; font-size: 14px; color: #64748b; font-weight: 600;">${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        
                        <div style="margin: 24px 0; padding: 24px; background: ${hasCriticalLoss ? '#fff1f2' : '#fffbeb'}; border-radius: 20px; text-align: center;">
                            <span style="display: block; font-size: 11px; font-weight: 900; color: ${statusColor}; text-transform: uppercase; letter-spacing: 2px;">Resultado Neto</span>
                            <span style="display: block; font-size: 48px; font-weight: 900; color: ${statusColor}; letter-spacing: -2px;">$${totalLossUSD.toFixed(2)}</span>
                        </div>

                        <div style="margin-bottom: 32px;">
                            <h3 style="font-size: 10px; font-weight: 900; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Puntos de Atención</h3>
                            ${alerts.map(a => `
                                <div style="margin-bottom: 12px; padding: 12px; border-radius: 12px; background: #f8fafc; font-size: 13px; font-weight: 700; color: #1e293b;">
                                    <span style="color: #ef4444;">•</span> ${a.message}
                                </div>
                            `).join('')}
                        </div>

                        <a href="http://localhost:3000/audit" style="display: block; background: #0f172a; color: #ffffff; padding: 18px; text-decoration: none; border-radius: 16px; text-align: center; font-size: 14px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px;">
                            Ver Reporte Completo
                        </a>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
        } catch (error) {
            console.error('[NotificationService] Error al enviar digest:', error.message);
        }
    }
}

module.exports = new NotificationService();
