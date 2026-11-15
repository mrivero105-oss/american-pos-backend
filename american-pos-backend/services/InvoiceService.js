const fs = require('fs');
const path = require('path');

const RECENT_INVOICE_OWNERS = new Map();

class InvoiceService {
    static _normalizeCompanyId(companyId) {
        if (!companyId || companyId === 'default' || companyId === 'admin') return '2';
        return String(companyId);
    }

    static recordInvoiceOwner(filename, explicitCompanyId = null) {
        try {
            let comp = explicitCompanyId;
            if (!comp) {
                const { getCurrentTenantContext } = require('../database/tenantContext');
                comp = getCurrentTenantContext()?.companyId;
            }
            if (!filename || !comp) return;
            const now = Date.now();
            RECENT_INVOICE_OWNERS.set(path.basename(String(filename)), {
                companyId: this._normalizeCompanyId(comp),
                ts: now
            });
            if (RECENT_INVOICE_OWNERS.size > 2000) {
                for (const [k, v] of RECENT_INVOICE_OWNERS.entries()) {
                    if (now - v.ts > 24 * 3600 * 1000) RECENT_INVOICE_OWNERS.delete(k);
                }
            }
        } catch (_) {}
    }

    /**
     * Valida fail-closed (compatible con PostgreSQL RLS) que un usuario puede acceder a una factura.
     */
    static async assertInvoiceAccess(user, rawPath) {
        const userRole = String(user?.role || '').toLowerCase();
        const userCompanyId = this._normalizeCompanyId(user?.companyId);
        const requestedRel = String(rawPath || '').trim().replace(/^\/+/, '').replace(/^api\//, '');
        if (!requestedRel || requestedRel.includes('\0') || requestedRel.includes('..')) {
            return { allowed: false, status: 400, error: 'Ruta de factura inválida' };
        }
        if (userRole === 'superadmin') {
            return { allowed: true };
        }

        const relNoPrefix = requestedRel.startsWith('invoices/')
            ? requestedRel.slice('invoices/'.length)
            : (requestedRel.startsWith('uploads/') ? requestedRel.slice('uploads/'.length) : requestedRel);

        if (relNoPrefix.includes('/')) {
            const firstSegment = relNoPrefix.split('/')[0];
            if (firstSegment && firstSegment !== userCompanyId) {
                return { allowed: false, status: 403, error: 'Acceso denegado a factura de otra empresa' };
            }
            return { allowed: true };
        }

        const fileName = path.basename(relNoPrefix);
        if (!fileName || fileName === '.' || fileName === '..') {
            return { allowed: false, status: 400, error: 'Nombre de factura inválido' };
        }

        const recentOwner = RECENT_INVOICE_OWNERS.get(fileName);
        if (recentOwner) {
            if (recentOwner.companyId === userCompanyId) {
                return { allowed: true };
            }
            return { allowed: false, status: 403, error: 'Acceso denegado a factura de otra empresa' };
        }

        const { PurchaseOrder, Expense } = require('../database/models');
        const { Op } = require('sequelize');
        const likePattern = `%${fileName}%`;
        const [ownPo, ownExp] = await Promise.all([
            PurchaseOrder.findOne({
                where: { invoiceUrl: { [Op.like]: likePattern }, companyId: userCompanyId },
                attributes: ['id']
            }).catch(() => null),
            Expense.findOne({
                where: { receiptUrl: { [Op.like]: likePattern }, companyId: userCompanyId },
                attributes: ['id']
            }).catch(() => null)
        ]);

        if (ownPo || ownExp) {
            return { allowed: true };
        }
        return { allowed: false, status: 403, error: 'Acceso denegado: la factura pertenece a otra empresa o no está autorizada' };
    }

    /**
     * Devuelve la ruta absoluta del directorio persistente de facturas
     */
    static getInvoicesDir() {
        const userDataPath = process.env.USER_DATA_PATH;
        let invoicesDir;
        if (userDataPath) {
            invoicesDir = path.join(userDataPath, 'invoices');
        } else if (process.platform === 'win32' && process.env.APPDATA) {
            invoicesDir = path.join(process.env.APPDATA, 'isaac-pos', 'invoices');
        } else {
            const isAsar = __dirname.includes('app.asar');
            if (isAsar) {
                const os = require('os');
                invoicesDir = path.join(os.homedir(), '.isaac-pos', 'invoices');
            } else {
                invoicesDir = path.join(__dirname, '..', 'invoices');
            }
        }

        if (!fs.existsSync(invoicesDir)) {
            try {
                fs.mkdirSync(invoicesDir, { recursive: true });
            } catch (err) {
                console.error('[INVOICE SERVICE] Error creando directorio de facturas:', err);
            }
        }
        return invoicesDir;
    }

    /**
     * Guarda un archivo de factura desde una ruta existente (ej. archivo temporal de escáner o multer)
     * @param {string} sourcePath Ruta del archivo origen
     * @param {string} originalName Nombre original del archivo (opcional)
     * @returns {string} URI pública de la factura guardada (ej. /invoices/inv_1734567890_abc123.jpg)
     */
    static async saveInvoiceFromPath(sourcePath, originalName = '') {
        const targetDir = this.getInvoicesDir();
        const ext = path.extname(originalName || sourcePath) || '.jpg';
        const uniqueName = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext.toLowerCase()}`;
        const destinationPath = path.join(targetDir, uniqueName);

        await fs.promises.copyFile(sourcePath, destinationPath);
        this.recordInvoiceOwner(uniqueName);
        console.log(`[INVOICE SERVICE] Factura guardada permanentemente en: ${destinationPath}`);
        return `/invoices/${uniqueName}`;
    }

    /**
     * Guarda un archivo de factura a partir de un Buffer en memoria
     * @param {Buffer} buffer Contenido del archivo
     * @param {string} ext Extensión del archivo (ej. .pdf, .jpg, .png)
     * @returns {string} URI pública de la factura guardada
     */
    static async saveInvoiceFromBuffer(buffer, ext = '.jpg') {
        const targetDir = this.getInvoicesDir();
        const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
        const uniqueName = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${safeExt.toLowerCase()}`;
        const destinationPath = path.join(targetDir, uniqueName);

        await fs.promises.writeFile(destinationPath, buffer);
        this.recordInvoiceOwner(uniqueName);
        console.log(`[INVOICE SERVICE] Factura (Buffer) guardada permanentemente en: ${destinationPath}`);
        return `/invoices/${uniqueName}`;
    }

    /**
     * Elimina un archivo de factura si existe
     * @param {string} invoiceUri URI pública de la factura (ej. /invoices/inv_123.jpg)
     */
    static async deleteInvoice(invoiceUri) {
        if (!invoiceUri || !invoiceUri.startsWith('/invoices/')) return;
        const filename = path.basename(invoiceUri);
        const targetDir = this.getInvoicesDir();
        const filePath = path.join(targetDir, filename);

        if (fs.existsSync(filePath)) {
            try {
                await fs.promises.unlink(filePath);
                console.log(`[INVOICE SERVICE] Factura eliminada: ${filePath}`);
            } catch (err) {
                console.warn(`[INVOICE SERVICE] No se pudo eliminar la factura: ${err.message}`);
            }
        }
    }
}

module.exports = InvoiceService;
