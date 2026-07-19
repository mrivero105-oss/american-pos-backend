const nodemailer = require('nodemailer');

class InvoiceEmailService {
  constructor() {
    this.transporter = null;
  }

  /**
   * Initializes the Gmail SMTP transporter.
   * If credentials are provided, they are used.
   */
  _getTransporter(user, pass) {
    // If not caching or if we want to allow dynamic, it's safer to just create it
    // on the fly or recreate if credentials changed.
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      requireTLS: true,
      auth: {
        user: user || process.env.EMAIL_USER,
        pass: pass || process.env.EMAIL_PASS,
      },
    });
  }

  /**
   * Formats a number as currency with 2 decimal places and $ prefix.
   */
  _formatMoney(value) {
    const num = parseFloat(value) || 0;
    return `$${num.toFixed(2)}`;
  }

  /**
   * Resolves the human-readable document title based on document type and SRI key.
   */
  _getDocumentTitle(sale) {
    const type = (sale.documentType || '').toLowerCase();
    if (type === 'nota_entrega') return 'Nota de Entrega';
    if (type === 'cotizacion' || type === 'presupuesto') return 'Cotización';
    if (sale.sriAccessKey) return 'Factura Electrónica';
    return 'Factura';
  }

  /**
   * Derives a short invoice number from the sale ID (first segment, uppercased).
   */
  _getInvoiceNumber(sale) {
    const id = sale.id || '';
    const firstSegment = id.split('-')[0] || id;
    return firstSegment.toUpperCase();
  }

  /**
   * Builds the complete inline-styled HTML email body for an invoice.
   */
  _buildInvoiceHtml(sale, saleItems, businessInfo, recipientName, documentTitle, invoiceNumber) {
    const saleDate = sale.date ? new Date(sale.date) : new Date();
    const formattedDate = saleDate.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = saleDate.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Build items rows
    const itemsRows = (saleItems || [])
      .map((item) => {
        const qty = parseFloat(item.quantity) || 0;
        const unitPrice = parseFloat(item.price) || 0;
        const subtotal = qty * unitPrice;
        return `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 14px; color: #334155;">
              ${qty}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #334155;">
              ${item.name || item.description || 'Producto'}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; color: #334155;">
              ${this._formatMoney(unitPrice)}
            </td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; font-weight: 600; color: #1e293b;">
              ${this._formatMoney(subtotal)}
            </td>
          </tr>`;
      })
      .join('');

    // Financial summary rows
    const subtotal = parseFloat(sale.subtotal) || 0;
    const iva = parseFloat(sale.iva) || parseFloat(sale.tax) || 0;
    const igtf = parseFloat(sale.igtf) || 0;
    const discount = parseFloat(sale.discount) || 0;
    const total = parseFloat(sale.total) || 0;

    let summaryRows = `
      <tr>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #64748b;">Subtotal</td>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #334155; width: 120px;">${this._formatMoney(subtotal)}</td>
      </tr>`;

    if (iva > 0) {
      summaryRows += `
      <tr>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #64748b;">IVA</td>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #334155;">${this._formatMoney(iva)}</td>
      </tr>`;
    }

    if (igtf > 0) {
      summaryRows += `
      <tr>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #64748b;">IGTF</td>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #334155;">${this._formatMoney(igtf)}</td>
      </tr>`;
    }

    if (discount > 0) {
      summaryRows += `
      <tr>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #dc2626;">Descuento</td>
        <td style="padding: 8px 16px; text-align: right; font-size: 14px; color: #dc2626;">-${this._formatMoney(discount)}</td>
      </tr>`;
    }

    // Payment method
    const paymentMethod = sale.paymentMethod || sale.payment_method || 'Efectivo';
    const paymentDisplay = {
      efectivo: 'Efectivo',
      tarjeta: 'Tarjeta',
      transferencia: 'Transferencia',
      pago_movil: 'Pago Móvil',
      zelle: 'Zelle',
      mixto: 'Pago Mixto',
    }[paymentMethod.toLowerCase()] || paymentMethod;

    // SRI Ecuador section
    let sriSection = '';
    if (sale.sriAccessKey) {
      sriSection = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <tr>
          <td style="background-color: #f0fdf4; padding: 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom: 8px;">
                  <span style="font-size: 13px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">
                    ● Información SRI
                  </span>
                </td>
              </tr>
              <tr>
                <td style="font-size: 13px; color: #334155; padding: 4px 0;">
                  <strong>Clave de Acceso:</strong> ${sale.sriAccessKey}
                </td>
              </tr>
              ${sale.sriAuthNumber ? `
              <tr>
                <td style="font-size: 13px; color: #334155; padding: 4px 0;">
                  <strong>Número de Autorización:</strong> ${sale.sriAuthNumber}
                </td>
              </tr>` : ''}
              ${sale.sriEnvironment ? `
              <tr>
                <td style="font-size: 13px; color: #334155; padding: 4px 0;">
                  <strong>Ambiente:</strong> ${sale.sriEnvironment}
                </td>
              </tr>` : ''}
            </table>
          </td>
        </tr>
      </table>`;
    }

    // Business details
    const businessName = businessInfo.name || 'Mi Negocio';
    const businessRif = businessInfo.rif || businessInfo.taxId || '';
    const businessAddress = businessInfo.address || '';
    const businessPhone = businessInfo.phone || '';
    const businessEmail = businessInfo.email || process.env.EMAIL_USER || '';

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${documentTitle} #${invoiceNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">

          <!-- ============ HEADER ============ -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.025em;">
                      ${businessName}
                    </h1>
                    ${businessRif ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #94a3b8;">RIF: ${businessRif}</p>` : ''}
                    ${businessAddress ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #94a3b8;">📍 ${businessAddress}</p>` : ''}
                    ${businessPhone ? `<p style="margin: 0; font-size: 13px; color: #94a3b8;">📞 ${businessPhone}</p>` : ''}
                  </td>
                  <td style="text-align: right; vertical-align: top;">
                    <span style="display: inline-block; background-color: #10b981; color: #ffffff; font-size: 12px; font-weight: 700; padding: 6px 16px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em;">
                      ${documentTitle}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ============ INVOICE META ============ -->
          <tr>
            <td style="padding: 32px 40px 24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width: 50%; vertical-align: top;">
                          <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em;">Número</p>
                          <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: 800; color: #0f172a;">#${invoiceNumber}</p>

                          <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em;">Fecha</p>
                          <p style="margin: 0; font-size: 14px; color: #334155;">${formattedDate} — ${formattedTime}</p>
                        </td>
                        <td style="width: 50%; vertical-align: top; text-align: right;">
                          <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em;">Cliente</p>
                          <p style="margin: 0 0 16px 0; font-size: 16px; font-weight: 700; color: #0f172a;">${recipientName || 'Cliente General'}</p>

                          <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em;">Método de Pago</p>
                          <p style="margin: 0; font-size: 14px; color: #334155;">${paymentDisplay}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ============ ITEMS TABLE ============ -->
          <tr>
            <td style="padding: 0 40px 24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
                <thead>
                  <tr>
                    <th style="background-color: #0f172a; padding: 14px 16px; text-align: center; font-size: 11px; font-weight: 700; color: #e2e8f0; text-transform: uppercase; letter-spacing: 0.1em; width: 60px;">
                      Cant.
                    </th>
                    <th style="background-color: #0f172a; padding: 14px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #e2e8f0; text-transform: uppercase; letter-spacing: 0.1em;">
                      Descripción
                    </th>
                    <th style="background-color: #0f172a; padding: 14px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #e2e8f0; text-transform: uppercase; letter-spacing: 0.1em; width: 100px;">
                      P. Unit.
                    </th>
                    <th style="background-color: #0f172a; padding: 14px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #e2e8f0; text-transform: uppercase; letter-spacing: 0.1em; width: 100px;">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- ============ FINANCIAL SUMMARY ============ -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width: 50%;"></td>
                  <td style="width: 50%;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                      ${summaryRows}
                      <tr>
                        <td colspan="2" style="padding: 0;">
                          <div style="border-top: 2px solid #10b981; margin: 0;"></div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 16px; text-align: right; font-size: 16px; font-weight: 800; color: #0f172a;">
                          TOTAL
                        </td>
                        <td style="padding: 16px; text-align: right; font-size: 22px; font-weight: 800; color: #10b981; width: 120px;">
                          ${this._formatMoney(total)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ============ SRI SECTION (conditional) ============ -->
          ${sriSection ? `
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              ${sriSection}
            </td>
          </tr>` : ''}

          <!-- ============ FOOTER ============ -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 32px 40px; text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 18px; color: #0f172a; font-weight: 700;">
                ¡Gracias por su compra!
              </p>
              <p style="margin: 0 0 16px 0; font-size: 13px; color: #94a3b8;">
                Este documento fue generado electrónicamente por ${businessName}
              </p>
              ${businessEmail ? `
              <p style="margin: 0; font-size: 13px; color: #64748b;">
                📧 ${businessEmail}
              </p>` : ''}
            </td>
          </tr>

          <!-- ============ BOTTOM ACCENT BAR ============ -->
          <tr>
            <td style="background: linear-gradient(90deg, #10b981 0%, #0f172a 100%); height: 4px; font-size: 0; line-height: 0;">
              &nbsp;
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Sends a professional HTML invoice email.
   *
   * @param {Object} sale - The sale record (id, date, total, subtotal, iva, igtf, discount, documentType, etc.)
   * @param {Array}  saleItems - Array of line items ({ name, quantity, price })
   * @param {Object} businessInfo - Business details ({ name, rif, address, phone, email })
   * @param {string} recipientEmail - Recipient email address
   * @param {string} recipientName - Recipient display name
   * @returns {Promise<{success: true}>}
   */
  async sendInvoiceEmail(sale, saleItems, businessInfo, recipientEmail, recipientName) {
    if (!recipientEmail) {
      throw new Error('No se proporcionó un correo electrónico de destinatario.');
    }

    const emailConfig = businessInfo?.emailConfig || {};
    const authUser = emailConfig.user || process.env.EMAIL_USER;
    const authPass = emailConfig.pass || process.env.EMAIL_PASS;

    if (!authUser || !authPass) {
      throw new Error(
        'Las credenciales de correo electrónico no están configuradas en los ajustes ni en el servidor.'
      );
    }

    const documentTitle = this._getDocumentTitle(sale);
    const invoiceNumber = this._getInvoiceNumber(sale);

    const html = this._buildInvoiceHtml(
      sale,
      saleItems,
      businessInfo || {},
      recipientName,
      documentTitle,
      invoiceNumber,
    );

    const businessName = (businessInfo && businessInfo.name) || 'Mi Negocio';

    const mailOptions = {
      from: `"${businessName}" <${authUser}>`,
      to: recipientEmail,
      subject: `${documentTitle} #${invoiceNumber} - ${businessName}`,
      html,
    };

    try {
      const transporter = this._getTransporter(authUser, authPass);
      await transporter.sendMail(mailOptions);
      console.log(`[InvoiceEmailService] Correo enviado a ${recipientEmail} — ${documentTitle} #${invoiceNumber}`);
      return { success: true };
    } catch (error) {
      console.error('[InvoiceEmailService] Error al enviar correo:', error.message);
      throw new Error(`Error al enviar el correo de factura: ${error.message}`);
    }
  }

  /**
   * Verifies that the Gmail SMTP credentials are valid and the connection works.
   *
   * @returns {Promise<{success: true}>}
   */
  async testConnection(user, pass) {
    const authUser = user || process.env.EMAIL_USER;
    const authPass = pass || process.env.EMAIL_PASS;

    if (!authUser || !authPass) {
      throw new Error(
        'Las credenciales de correo electrónico no están configuradas.'
      );
    }

    try {
      const transporter = this._getTransporter(authUser, authPass);
      await transporter.verify();
      console.log('[InvoiceEmailService] Conexión SMTP verificada correctamente.');
      return { success: true };
    } catch (error) {
      console.error('[InvoiceEmailService] Error al verificar conexión SMTP:', error.message);
      throw new Error(`Error al verificar la conexión SMTP: ${error.message}`);
    }
  }
}

module.exports = new InvoiceEmailService();
