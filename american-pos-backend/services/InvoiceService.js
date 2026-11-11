const fs = require('fs');
const path = require('path');

class InvoiceService {
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
