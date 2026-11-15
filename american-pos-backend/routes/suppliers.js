const express = require('express');
const router = express.Router();
const supplierService = require('../services/SupplierService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { Supplier } = require('../database/models');
const { Op } = require('sequelize');
const { requirePermission } = require('../middleware/auth');

const READ_ONLY_SUPPLIER_AUX_PATHS = new Set(['/public-list', '/bcv-rate']);
const PAYABLE_SUPPLIER_PATHS = ['/invoices', '/analyze-invoice-data'];
router.use((req, res, next) => {
    if (READ_ONLY_SUPPLIER_AUX_PATHS.has(req.path)) {
        return next();
    }
    if (
        PAYABLE_SUPPLIER_PATHS.includes(req.path) ||
        req.path.endsWith('/credit-history') ||
        req.path.endsWith('/payment')
    ) {
        return requirePermission(['canManageSuppliers', 'canManagePayables', 'canManagePurchases', 'canImportCatalog'])(req, res, next);
    }
    if (req.method === 'GET' && req.path === '/') {
        return requirePermission(['canManageSuppliers', 'canManagePayables', 'canManagePurchases', 'canImportCatalog'])(req, res, next);
    }
    return requirePermission(['canManageSuppliers', 'canManagePurchases'])(req, res, next);
});

// Helper para obtener todos los directorios de almacenamiento de logotipos donde Express los sirve
const getCandidateLogoDirs = () => {
    let userDataPath = process.env.USER_DATA_PATH;
    if (!userDataPath && process.platform === 'win32' && process.env.APPDATA) {
        const candidates = [
            path.join(process.env.APPDATA, 'isaac-pos'),
            path.join(process.env.APPDATA, 'americanpos'),
            path.join(process.env.APPDATA, 'Isaac POS'),
            path.join(process.env.APPDATA, 'isaacpos'),
            path.join(process.env.APPDATA, 'american-pos-backend')
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) {
                userDataPath = c;
                break;
            }
        }
        if (!userDataPath) {
            userDataPath = path.join(process.env.APPDATA, 'isaac-pos');
        }
    }

    const dirs = [
        path.join(__dirname, '..', 'supplier_logos'),
        userDataPath ? path.join(userDataPath, 'supplier_logos') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'isaac-pos', 'supplier_logos') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'americanpos', 'supplier_logos') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Isaac POS', 'supplier_logos') : null
    ].filter(Boolean);

    dirs.forEach(d => {
        try {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        } catch (_) {}
    });

    return [...new Set(dirs)];
};

const getUploadDir = () => {
    const candidateDirs = getCandidateLogoDirs();
    return candidateDirs[0] || path.join(__dirname, '..', 'supplier_logos');
};

const replicateLogoBuffer = (filename, buffer) => {
    const candidateDirs = getCandidateLogoDirs();
    for (const dir of candidateDirs) {
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, filename), buffer);
        } catch (e) {
            console.warn(`[Suppliers] Error al replicar logo en ${dir}:`, e.message);
        }
    }
};

// Setup Multer Storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, getUploadDir());
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = (path.extname(file.originalname) || '.png').toLowerCase();
        cb(null, 'supplier-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de logo no permitido. Solo se aceptan imágenes.'));
        }
    }
});

/**
 * GET /public-list - Search and list active suppliers (Protected for Sync)
 */
router.get('/public-list', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const suppliers = await Supplier.findAll({
            where: { isActive: true, companyId },
            attributes: [
                'id', 'name', 'rif', 'phone', 'email', 'address', 
                'creditBalance', ['contact', 'contactPerson'], 'logoUri'
            ]
        });
        res.json(suppliers || []);
    } catch (error) {
        console.error('Public suppliers list error:', error);
        res.status(500).json({ error: `Error al obtener proveedores: ${error.message || error}` });
    }
});

function fetchWeb(url, headers = {}) {
    return new Promise((resolve) => {
        try {
            const u = new URL(url);
            const client = u.protocol === 'https:' ? https : http;
            const req = client.get({
                hostname: u.hostname,
                path: u.pathname + u.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'es-VE,es-ES,es;q=0.9,en;q=0.8',
                    ...headers
                },
                timeout: 7000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
            });
            req.on('error', (err) => resolve({ status: 500, error: err.message, body: '' }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 408, body: '' }); });
        } catch (e) {
            resolve({ status: 500, error: e.message, body: '' });
        }
    });
}

function cleanBrandName(name) {
    if (!name) return '';
    return name
        .replace(/\b(c\.?a\.?|s\.?a\.?|s\.?r\.?l\.?|c\.?v\.?|llc|inc|corp|distribuidora|distribuidor|comercializadora|comercial|inversiones|grupo|alimentos|empresa|empresas|de|del|la|los|las|y|oriente|venezuela)\b/gi, ' ')
        .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function searchBingImages(term) {
    try {
        const url = `https://www.bing.com/images/search?q=${encodeURIComponent(term)}&form=HDRSC2&first=1`;
        const res = await fetchWeb(url);
        if (res.status !== 200 || !res.body) return [];

        const matches = [...res.body.matchAll(/m="(\{[^"]+\})"/g)];
        const results = [];

        for (const m of matches) {
            try {
                const unescaped = m[1].replace(/&quot;/g, '"');
                const data = JSON.parse(unescaped);
                const rawUrl = data.murl;
                if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) continue;

                const cleanTitle = (data.t || term)
                    .replace(/&amp;/g, '&')
                    .replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>');

                const thumb = (data.turl || rawUrl).replace(/&amp;/g, '&');
                const sourceHost = data.purl ? new URL(data.purl).hostname.replace(/^www\./, '') : 'Web';
                const ext = (rawUrl.split('?')[0].split('.').pop() || data.fmt || 'png').toLowerCase();

                results.push({
                    title: cleanTitle,
                    thumbnail: thumb,
                    url: rawUrl,
                    source: sourceHost,
                    ext
                });
            } catch (e) {}
        }
        return results;
    } catch (e) {
        return [];
    }
}

async function searchWikimedia(term) {
    try {
        const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=400&format=json`;
        const res = await fetchWeb(searchUrl, { 'User-Agent': 'IsaacPOS/1.0 (https://isaacpos.com; support@isaacpos.com) Node/18' });
        if (res.status !== 200 || !res.body) return [];
        const parsed = JSON.parse(res.body);
        const pages = Object.values(parsed.query?.pages || {});
        return pages
            .filter(p => p.imageinfo && p.imageinfo[0])
            .map(p => {
                const rawTitle = p.title.replace('File:', '');
                const ext = (rawTitle.split('.').pop() || '').toLowerCase();
                return {
                    title: rawTitle.replace(/\.[^/.]+$/, ''),
                    thumbnail: p.imageinfo[0].thumburl || p.imageinfo[0].url,
                    url: p.imageinfo[0].url,
                    ext,
                    source: 'Wikimedia Commons'
                };
            });
    } catch {
        return [];
    }
}

// GET /search-logos - Búsqueda de logotipos corporativos de alta precisión multi-fuente
router.get('/search-logos', async (req, res) => {
    try {
        const query = (req.query.q || req.query.query || '').trim();
        if (!query) return res.json({ results: [] });

        const clean = cleanBrandName(query);

        // Múltiples variaciones ordenadas por relevancia
        const terms = [
            clean ? `${clean} logo venezuela` : '',
            clean ? `${clean} logo` : '',
            `${query} logo`,
            clean || query
        ].filter((t, idx, arr) => t && arr.indexOf(t) === idx);

        const seenUrls = new Set();
        const allResults = [];

        // Ejecutar consultas en paralelo
        const searchPromises = [];
        if (terms[0]) searchPromises.push(searchBingImages(terms[0]));
        if (terms[1] && terms[1] !== terms[0]) searchPromises.push(searchBingImages(terms[1]));
        if (terms[2] && terms[2] !== terms[0] && terms[2] !== terms[1]) searchPromises.push(searchBingImages(terms[2]));
        searchPromises.push(searchWikimedia(clean ? `${clean} logo` : `${query} logo`));

        const settled = await Promise.allSettled(searchPromises);
        for (const r of settled) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                for (const item of r.value) {
                    if (!seenUrls.has(item.url)) {
                        seenUrls.add(item.url);
                        allResults.push(item);
                    }
                }
            }
        }

        // Scoring y ordenamiento por relevancia
        const searchKeyword = (clean || query).toLowerCase();
        const ranked = allResults.sort((a, b) => {
            const score = (item) => {
                let s = 0;
                const t = (item.title || '').toLowerCase();
                const u = (item.url || '').toLowerCase();
                const src = (item.source || '').toLowerCase();

                if (t.includes('logo') || u.includes('logo') || t.includes('isologo') || t.includes('brand')) s += 50;
                if (src.includes('seeklogo') || src.includes('freepik') || src.includes('brandfetch') || src.includes('vecteezy')) s += 30;
                if (src.includes('facebook') || src.includes('instagram') || src.includes('linkedin')) s += 20;

                if (t.includes(searchKeyword)) s += 40;
                if (u.includes(searchKeyword.replace(/\s+/g, ''))) s += 25;

                if (item.ext === 'png' || item.ext === 'svg' || item.ext === 'webp') s += 20;

                if (t.includes('wallpaper') || t.includes('meme') || t.includes('spacecraft') || t.includes('paper') || t.includes('document')) s -= 40;

                return s;
            };
            return score(b) - score(a);
        });

        res.json({ results: ranked.slice(0, 30) });
    } catch (err) {
        console.error('Logo search fatal error:', err);
        res.status(500).json({ error: 'Error al buscar logotipos' });
    }
});

// POST /download-logo - Descarga y almacenamiento permanente y replicado de logos online
router.post('/download-logo', async (req, res) => {
    try {
        const { imageUrl, supplierId } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'URL de imagen requerida' });

        const isSafeExternalUrl = (rawUrl) => {
            try {
                const parsed = new URL(rawUrl);
                if (!['http:', 'https:'].includes(parsed.protocol)) return false;
                const host = parsed.hostname.toLowerCase();
                if (
                    host === 'localhost' ||
                    host === '0.0.0.0' ||
                    host === '[::1]' ||
                    host === '::1' ||
                    host.endsWith('.local') ||
                    /^127\./.test(host) ||
                    /^10\./.test(host) ||
                    /^192\.168\./.test(host) ||
                    /^169\.254\./.test(host) ||
                    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
                ) {
                    return false;
                }
                return true;
            } catch (_) {
                return false;
            }
        };

        if (!isSafeExternalUrl(imageUrl)) {
            return res.status(400).json({ error: 'URL de imagen inválida o restringida por políticas de seguridad.' });
        }

        const downloadBuffer = (targetUrl, redirectDepth = 0) => {
            return new Promise((resolve, reject) => {
                if (redirectDepth > 4) return reject(new Error('Demasiadas redirecciones'));
                if (!isSafeExternalUrl(targetUrl)) return reject(new Error('Redirección a URL no permitida'));

                const parsed = new URL(targetUrl);
                const client = parsed.protocol === 'https:' ? https : http;
                const reqHttp = client.get(targetUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'Referer': parsed.origin
                    },
                    timeout: 10000
                }, (resp) => {
                    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                        const nextUrl = resp.headers.location.startsWith('http')
                            ? resp.headers.location
                            : new URL(resp.headers.location, targetUrl).toString();
                        return downloadBuffer(nextUrl, redirectDepth + 1).then(resolve).catch(reject);
                    }

                    if (resp.statusCode !== 200) {
                        return reject(new Error(`El servidor de la imagen respondió con HTTP ${resp.statusCode}`));
                    }

                    const contentType = resp.headers['content-type'] || '';
                    const chunks = [];
                    resp.on('data', chunk => chunks.push(chunk));
                    resp.on('end', () => {
                        resolve({
                            buffer: Buffer.concat(chunks),
                            contentType
                        });
                    });
                    resp.on('error', reject);
                });

                reqHttp.on('error', reject);
                reqHttp.on('timeout', () => { reqHttp.destroy(); reject(new Error('Tiempo de espera agotado al descargar la imagen')); });
            });
        };

        const { buffer, contentType } = await downloadBuffer(imageUrl);

        let ext = '.png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg';
        else if (contentType.includes('webp')) ext = '.webp';
        else if (contentType.includes('svg')) ext = '.svg';
        else if (contentType.includes('gif')) ext = '.gif';
        else {
            const rawExt = path.extname(imageUrl.split('?')[0]).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(rawExt)) {
                ext = rawExt;
            }
        }

        const filename = `supplier-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
        
        // Replicar en todas las rutas candidatas para garantizar cero 404
        replicateLogoBuffer(filename, buffer);

        const logoUri = `supplier_logos/${filename}`;

        // Persistir en base de datos
        if (supplierId) {
            const finalCompanyId = req.user?.companyId || 'default';
            const isSuperOrAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
            const companyCondition = (finalCompanyId === '2' || finalCompanyId === 'default' || isSuperOrAdmin)
                ? { [Op.or]: [{ companyId: '2' }, { companyId: 'default' }, { companyId: null }] }
                : { companyId: finalCompanyId };

            const targetSupplier = await Supplier.findOne({ where: { id: String(supplierId), ...companyCondition } });

            if (targetSupplier) {
                targetSupplier.logoUri = logoUri;
                await targetSupplier.save();
                console.log(`[Suppliers] Logo asignado y guardado exitosamente para proveedor ${targetSupplier.id} (${targetSupplier.name}): ${logoUri}`);
            } else {
                return res.status(404).json({ error: 'Proveedor no encontrado en esta empresa' });
            }
        }

        res.json({
            success: true,
            logoUri,
            filename,
            message: 'Logotipo descargado y asignado exitosamente'
        });
    } catch (err) {
        console.error('Download logo error:', err.message);
        res.status(500).json({ error: 'Error al descargar logotipo: ' + err.message });
    }
});

// GET / - List all suppliers
router.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const role = req.user?.role || 'admin';
        const suppliers = await supplierService.getAllSuppliers(companyId, role);
        res.json(suppliers || []);
    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({ error: `Error al obtener proveedores: ${error.message || error}` });
    }
});

// GET /export - Export suppliers (data only)
router.get('/export', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const role = req.user?.role || 'admin';
        const suppliers = await supplierService.getAllSuppliers(companyId, role);
        // Exclude internal IDs for cleaner export
        const exportData = suppliers.map(s => {
            const plain = typeof s.toJSON === 'function' ? s.toJSON() : s;
            const { id, userId, companyId, createdAt, updatedAt, ...rest } = plain;
            return rest;
        });
        res.json(exportData);
    } catch (error) {
        console.error('Export suppliers error:', error);
        res.status(500).json({ error: 'Error al exportar proveedores' });
    }
});

// POST / - Create supplier with logo
router.post('/', upload.single('logo'), async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const newSupplier = await supplierService.createSupplier(user, req.body, req.file);
        res.status(201).json(newSupplier);
    } catch (error) {
        console.error('Create supplier error:', error);
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
});

// PUT /:id - Update supplier
router.put('/:id', upload.single('logo'), async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const updatedSupplier = await supplierService.updateSupplier(user, req.params.id, req.body, req.file);
        if (updatedSupplier) {
            res.json({ message: 'Proveedor actualizado', supplier: updatedSupplier });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        console.error('Update supplier error:', error);
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
});

// DELETE /:id - Delete supplier
router.delete('/:id', async (req, res, next) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const success = await supplierService.deleteSupplier(user, req.params.id);
        if (success) {
            res.json({ success: true, message: 'Proveedor eliminado' });
        } else {
            res.status(404).json({ message: 'Proveedor no encontrado' });
        }
    } catch (error) {
        next(error);
    }
});

const invoiceUpload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for PDF / High-res photos
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen (JPG, PNG, WebP) o documentos PDF.'));
        }
    }
});

const ScannerService = require('../services/ScannerService');
const InvoiceService = require('../services/InvoiceService');
const precision = require('../utils/precision');
const { generateRobustId } = require('../utils/helpers');

// GET /scanners - Listar impresoras y escáneres WIA conectados
router.get('/scanners', async (req, res) => {
    try {
        const scanners = await ScannerService.listScanners();
        res.json({ scanners });
    } catch (err) {
        console.error('[SUPPLIER SCANNER] Error listando escáneres:', err);
        res.status(500).json({ error: 'Error al listar escáneres disponibles: ' + err.message });
    }
});

// POST /scan-invoice - Adquirir imagen de la factura directamente desde la impresora/escáner
router.post('/scan-invoice', async (req, res) => {
    const { deviceId, dpi, colorMode } = req.body || {};

    let scannedFilePath = null;
    try {
        console.log(`[SUPPLIER SCAN] Adquiriendo factura física con escáner: ${deviceId || 'DEFAULT_WIA_SCANNER'} (DPI: ${dpi || 300})`);

        const scanResult = await ScannerService.scanDocument({ deviceId, dpi, colorMode });
        scannedFilePath = scanResult?.path || scanResult;

        if (!scannedFilePath || !fs.existsSync(scannedFilePath)) {
            return res.status(400).json({ error: 'No se generó el archivo escaneado correctamente.' });
        }

        console.log(`[SUPPLIER SCAN] Factura escaneada con éxito: ${scannedFilePath}`);

        // Guardar permanentemente en /invoices/
        const invoiceUrl = await InvoiceService.saveInvoiceFromPath(scannedFilePath, 'factura_proveedor_escaneada.jpg');

        res.json({
            success: true,
            invoiceUrl,
            message: 'Factura física escaneada y guardada con éxito'
        });
    } catch (err) {
        console.error('[SUPPLIER SCAN] Error procesando escaneo:', err);
        res.status(400).json({ 
            error: err.message || 'No se pudo adquirir la imagen del escáner. Verifica que la impresora/escáner esté encendida y conectada.' 
        });
    } finally {
        if (scannedFilePath && fs.existsSync(scannedFilePath)) {
            try { fs.unlinkSync(scannedFilePath); } catch (e) {}
        }
    }
});

const BCVRateService = require('../services/BCVRateService');

// GET /bcv-rate - Obtener la tasa oficial del BCV para una fecha específica (o actual)
router.get('/bcv-rate', async (req, res) => {
    try {
        const { date } = req.query;
        const rateInfo = await BCVRateService.getOfficialRate(date);
        res.json({
            success: true,
            rate: rateInfo.rate,
            date: rateInfo.date || date,
            source: rateInfo.source
        });
    } catch (err) {
        console.error('[SUPPLIER BCV] Error consultando tasa:', err?.message || String(err));
        res.status(500).json({ error: 'Error al consultar tasa oficial BCV: ' + err.message });
    }
});

// POST /analyze-invoice-data - Extraer datos de la factura con IA y verificar tasa BCV
const aiService = require('../services/AIService');

router.post('/analyze-invoice-data', invoiceUpload.single('file'), async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const companyId = user.companyId || 'default';
        const { invoiceUrl } = req.body;

        let buffer = null;

        if (req.file && fs.existsSync(req.file.path)) {
            buffer = fs.readFileSync(req.file.path);
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        } else if (invoiceUrl) {
            const rawUrl = String(invoiceUrl || '').trim();
            if (!rawUrl || rawUrl.includes('\0') || /^([a-zA-Z]:|\\\\)/.test(rawUrl)) {
                return res.status(400).json({ error: 'Ruta de factura inválida' });
            }
            let cleanUrl = rawUrl.replace(/^\/+/, '');
            if (cleanUrl.startsWith('api/')) cleanUrl = cleanUrl.replace(/^api\//, '');

            const allowedRoots = [
                path.resolve(__dirname, '..', 'invoices'),
                path.resolve(__dirname, '..', 'uploads'),
                process.env.USER_DATA_PATH ? path.resolve(process.env.USER_DATA_PATH, 'invoices') : null,
                process.env.USER_DATA_PATH ? path.resolve(process.env.USER_DATA_PATH, 'uploads') : null
            ].filter(Boolean);

            const isPathInsideRoot = (rootDir, targetFile) => {
                const rel = path.relative(rootDir, targetFile);
                return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
            };

            const fileNameOnly = path.basename(cleanUrl);
            const candidatePaths = [];
            for (const rootDir of allowedRoots) {
                if (cleanUrl.startsWith('invoices/') || cleanUrl.startsWith('uploads/')) {
                    const parentOfRoot = path.dirname(rootDir);
                    const directCandidate = path.resolve(parentOfRoot, cleanUrl);
                    if (isPathInsideRoot(rootDir, directCandidate)) {
                        candidatePaths.push(directCandidate);
                    }
                }
                if (fileNameOnly && fileNameOnly !== '.' && fileNameOnly !== '..') {
                    const baseCandidate = path.resolve(rootDir, fileNameOnly);
                    if (isPathInsideRoot(rootDir, baseCandidate)) {
                        candidatePaths.push(baseCandidate);
                    }
                }
            }

            if (candidatePaths.length === 0) {
                return res.status(403).json({ error: 'Ruta de factura fuera de los directorios permitidos' });
            }

            const accessCheck = await InvoiceService.assertInvoiceAccess(req.user, rawUrl);
            if (!accessCheck.allowed) {
                return res.status(accessCheck.status || 403).json({ error: accessCheck.error || 'Acceso denegado a factura de otra empresa' });
            }
            for (const p of candidatePaths) {
                if (p && fs.existsSync(p) && fs.statSync(p).isFile()) {
                    buffer = fs.readFileSync(p);
                    break;
                }
            }
        }

        if (!buffer) {
            return res.status(400).json({ error: 'No se recibió ningún archivo o URL de factura para analizar.' });
        }

        const extractedData = await aiService.extractSupplierInvoiceMetadata(buffer, companyId);

        res.json({
            success: true,
            data: extractedData,
            message: 'Datos extraídos con éxito y tasa BCV verificada'
        });
    } catch (err) {
        console.error('[SUPPLIER AI] Error analizando factura:', err);
        res.status(500).json({ error: 'Error al analizar la factura con IA: ' + err.message });
    }
});

// POST /invoices - Registrar Factura Real de Proveedor y Cuenta por Pagar
router.post('/invoices', invoiceUpload.single('file'), async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const companyId = user.companyId || 'default';
        const {
            supplierId,
            referenceNumber,
            amount,
            arrivalDate,
            exchangeRate,
            dueDate,
            notes,
            currency,
            invoiceUrl: manualInvoiceUrl
        } = req.body;

        if (!supplierId) return res.status(400).json({ error: 'Se requiere el ID del proveedor' });
        
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ error: 'El monto de la factura debe ser mayor a 0' });
        }

        const rate = parseFloat(exchangeRate) > 0 ? parseFloat(exchangeRate) : 1.0;
        const arrival = arrivalDate || new Date().toISOString().split('T')[0];
        const due = dueDate || null;
        const refNo = (referenceNumber || '').trim() || `FACT-${Date.now().toString().slice(-6)}`;

        let invoiceUrl = manualInvoiceUrl || req.body.invoiceUrl || null;
        if (req.file) {
            invoiceUrl = await InvoiceService.saveInvoiceFromPath(req.file.path, req.file.originalname);
            if (fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (e) {}
            }
        }

        const supplier = await Supplier.findOne({ where: { id: supplierId, companyId } });
        if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });

        const { sequelize } = require('../database/connection');
        const { SupplierCreditHistory, PurchaseOrder } = require('../database/models');
        
        const result = await sequelize.transaction(async (t) => {
            // Actualizar balance de crédito del proveedor
            const oldBalance = Number(supplier.creditBalance) || 0;
            const newBalance = precision.round(precision.add([oldBalance, numAmount]), 2);
            await supplier.update({ creditBalance: newBalance }, { transaction: t });

            const orderId = generateRobustId();
            const totalVes = precision.round(precision.multiply(numAmount, rate), 2);

            // Crear PurchaseOrder para archivo digital y trazabilidad
            const order = await PurchaseOrder.create({
                id: orderId,
                supplierId,
                date: arrival,
                expectedDate: due,
                arrivalDate: arrival,
                dueDate: due,
                exchangeRate: rate,
                status: 'received',
                total: numAmount,
                totalVes: totalVes,
                items: [],
                notes: notes || `Factura de proveedor Nro ${refNo}`,
                paymentStatus: 'unpaid',
                referenceNumber: refNo,
                invoiceUrl: invoiceUrl,
                receivedAt: arrival,
                userId: user.id,
                companyId
            }, { transaction: t });

            // Crear Asiento en Historial de Crédito del Proveedor
            const historyEntry = await SupplierCreditHistory.create({
                id: generateRobustId(),
                supplierId,
                userId: user.id,
                companyId,
                timestamp: new Date().toISOString(),
                type: 'charge',
                amount: numAmount,
                balanceAfter: newBalance,
                description: `Factura ${refNo} (Tasa llegada: ${rate} Bs/$) - ${notes || 'Recepción de mercancía'}`,
                paymentMethod: 'credit',
                purchaseOrderId: orderId,
                referenceNumber: refNo,
                invoiceUrl: invoiceUrl,
                arrivalDate: arrival,
                dueDate: due,
                exchangeRate: rate
            }, { transaction: t });

            return { order, historyEntry, newBalance };
        });

        res.json({
            success: true,
            message: 'Factura de proveedor registrada exitosamente',
            invoiceUrl: invoiceUrl,
            referenceNumber: refNo,
            supplierId,
            creditBalance: result.newBalance,
            orderId: result.order.id
        });
    } catch (err) {
        console.error('Error registrando factura de proveedor:', err);
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(500).json({ error: 'Error al registrar factura: ' + err.message });
    }
});

// GET /:id/credit-history - Supplier credit movements
router.get('/:id/credit-history', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { SupplierCreditHistory, PurchaseOrder } = require('../database/models');
        const supplier = await supplierService.getSupplierById(req.params.id, companyId);
        if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });

        const history = await SupplierCreditHistory.findAll({
            where: { supplierId: req.params.id, companyId },
            order: [['timestamp', 'DESC']]
        });

        // Enrich movements with invoiceUrl, orderReference, arrivalDate, dueDate, exchangeRate
        const purchaseOrderIds = history.map(h => h.purchaseOrderId).filter(Boolean);
        let orderMap = new Map();
        if (purchaseOrderIds.length > 0) {
            const orders = await PurchaseOrder.findAll({
                where: { id: purchaseOrderIds, companyId },
                attributes: ['id', 'invoiceUrl', 'referenceNumber', 'arrivalDate', 'dueDate', 'exchangeRate', 'total', 'totalVes', 'status', 'paymentStatus']
            });
            orderMap = new Map(orders.map(o => [o.id, o]));
        }

        // Convertir a objetos planos garantizando persistencia de campos
        const plainHistory = history.map(h => {
            const hData = h.toJSON();
            if (h.purchaseOrderId && orderMap.has(h.purchaseOrderId)) {
                const ord = orderMap.get(h.purchaseOrderId);
                if (!hData.invoiceUrl) hData.invoiceUrl = ord.invoiceUrl;
                if (!hData.orderReference) hData.orderReference = ord.referenceNumber;
                if (!hData.arrivalDate) hData.arrivalDate = ord.arrivalDate;
                if (!hData.dueDate) hData.dueDate = ord.dueDate;
                if (!hData.exchangeRate) hData.exchangeRate = ord.exchangeRate;
                if (ord.paymentStatus === 'paid') hData.poPaymentStatus = 'paid';
            }
            return hData;
        });

        // Calcular estado FIFO individual para cada factura (de la más antigua a la más reciente)
        const chronologicalCharges = plainHistory.filter(h => h.type === 'charge').sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const totalPaidPool = plainHistory.filter(h => h.type === 'payment').reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        let availablePayments = totalPaidPool;

        for (const ch of chronologicalCharges) {
            const amountUsd = Number(ch.amount || 0);
            if (availablePayments >= (amountUsd - 0.005)) {
                ch.invoiceStatus = 'PAID';
                ch.balanceRemaining = 0;
                availablePayments = Math.max(0, availablePayments - amountUsd);
            } else if (availablePayments > 0.01) {
                ch.invoiceStatus = 'PARTIAL';
                ch.balanceRemaining = precision.round(amountUsd - availablePayments, 2);
                availablePayments = 0;
            } else {
                ch.invoiceStatus = 'PENDING';
                ch.balanceRemaining = amountUsd;
            }
        }

        const pendingInvoices = chronologicalCharges.filter(c => (c.balanceRemaining || 0) > 0.005);
        const paidInvoices = chronologicalCharges.filter(c => (c.balanceRemaining || 0) <= 0.005);

        // Mapear de vuelta el estado y saldo remanente a cada item de plainHistory
        const chargeStatusMap = new Map(chronologicalCharges.map(c => [c.id, { invoiceStatus: c.invoiceStatus, balanceRemaining: c.balanceRemaining }]));
        plainHistory.forEach(item => {
            if (item.type === 'charge' && chargeStatusMap.has(item.id)) {
                const s = chargeStatusMap.get(item.id);
                item.invoiceStatus = s.invoiceStatus;
                item.balanceRemaining = s.balanceRemaining;
            }
        });

        res.json({ supplier, history: plainHistory, pendingInvoices, paidInvoices });
    } catch (error) {
        console.error('Supplier history error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// POST /:id/payment - Register payment to supplier
router.post('/:id/payment', async (req, res) => {
    try {
        const user = req.user || { id: 'admin', companyId: 'default' };
        const payment = await supplierService.registerPayment(user, req.params.id, req.body);
        res.json(payment);
    } catch (error) {
        console.error('Supplier payment error:', error);
        res.status(error.message === 'Proveedor no encontrado' ? 404 : 500).json({ error: error.message });
    }
});

// POST /:id/products - Synchronize products list
router.post('/:id/products', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        await supplierService.syncProducts(companyId, req.params.id, req.body.productIds);
        res.json({ success: true, message: 'Productos sincronizados exitosamente' });
    } catch (error) {
        console.error('Supplier products sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /invoices/history - Listado completo de facturas de proveedores (Pendientes y Canceladas/Pagadas)
router.get('/invoices/history', async (req, res) => {
    try {
        const companyId = req.user?.companyId || 'default';
        const { Supplier, SupplierCreditHistory, PurchaseOrder } = require('../database/models');

        const charges = await SupplierCreditHistory.findAll({
            where: { companyId, type: 'charge' },
            include: [{ model: Supplier, attributes: ['id', 'name', 'rif', 'creditBalance', 'phone', 'contact', 'logoUri'] }],
            order: [['timestamp', 'ASC']] // Orden ascendente para calcular FIFO
        });

        const allPayments = await SupplierCreditHistory.findAll({
            where: { companyId, type: 'payment' },
            order: [['timestamp', 'ASC']]
        });

        // Enriquecer con PurchaseOrder si existe
        const purchaseOrderIds = charges.map(c => c.purchaseOrderId).filter(Boolean);
        let orderMap = new Map();
        if (purchaseOrderIds.length > 0) {
            const orders = await PurchaseOrder.findAll({
                where: { id: purchaseOrderIds, companyId },
                attributes: ['id', 'invoiceUrl', 'referenceNumber', 'arrivalDate', 'dueDate', 'exchangeRate', 'total', 'totalVes', 'status', 'paymentStatus']
            });
            orderMap = new Map(orders.map(o => [o.id, o]));
        }

        // Agrupar pagos y cargos por proveedor
        const paymentsBySupplier = new Map();
        for (const p of allPayments) {
            const sId = p.supplierId;
            if (!paymentsBySupplier.has(sId)) paymentsBySupplier.set(sId, []);
            paymentsBySupplier.get(sId).push(p);
        }

        const chargesBySupplier = new Map();
        for (const ch of charges) {
            const sId = ch.supplierId;
            if (!chargesBySupplier.has(sId)) chargesBySupplier.set(sId, []);
            chargesBySupplier.get(sId).push(ch);
        }

        // Mapear resultados con balance individualizado por factura (FIFO)
        const computedInvoices = [];

        const { readJson, getUserSettings } = require('../utils/helpers');
        const { SETTINGS_FILE } = require('../config/paths');
        const allSettings = readJson(SETTINGS_FILE);
        const userSettings = getUserSettings(allSettings, companyId);
        const currentSystemRate = Number(userSettings.exchangeRate) || 1.0;

        for (const [sId, sCharges] of chargesBySupplier.entries()) {
            const sPayments = paymentsBySupplier.get(sId) || [];
            let availablePaymentPool = sPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const latestPayment = sPayments.length > 0 ? sPayments[sPayments.length - 1] : null;

            for (const ch of sCharges) {
                const sup = ch.Supplier;
                const po = ch.purchaseOrderId ? orderMap.get(ch.purchaseOrderId) : null;
                const arrivalRate = Number(ch.exchangeRate || po?.exchangeRate || 1.0);
                const amountUsd = Number(ch.amount || po?.total || 0);
                const arrivalAmountVes = Number((amountUsd * arrivalRate).toFixed(2));

                let status = 'PENDING';
                let balanceRemaining = amountUsd;
                let paidAt = null;
                let paymentRate = arrivalRate;

                if (availablePaymentPool >= (amountUsd - 0.005)) {
                    // Pagada totalmente por el pool de abonos
                    status = 'PAID';
                    balanceRemaining = 0;
                    availablePaymentPool = Math.max(0, availablePaymentPool - amountUsd);
                    paidAt = latestPayment?.timestamp || ch.timestamp;
                    paymentRate = Number(latestPayment?.exchangeRate) > 1 ? Number(latestPayment.exchangeRate) : currentSystemRate;
                } else if (availablePaymentPool > 0.01) {
                    // Pago parcial
                    balanceRemaining = precision.round(amountUsd - availablePaymentPool, 2);
                    status = 'PARTIAL';
                    availablePaymentPool = 0;
                    paymentRate = Number(latestPayment?.exchangeRate) > 1 ? Number(latestPayment.exchangeRate) : currentSystemRate;
                } else {
                    // Sin pagar
                    status = 'PENDING';
                    balanceRemaining = amountUsd;
                    paymentRate = currentSystemRate;
                }

                const paymentAmountVes = Number((amountUsd * paymentRate).toFixed(2));
                const exchangeDifference = Number((paymentAmountVes - arrivalAmountVes).toFixed(2));

                computedInvoices.push({
                    id: ch.id,
                    supplierId: ch.supplierId,
                    supplierName: sup?.name || 'Proveedor Desconocido',
                    supplierRif: sup?.rif || 'N/A',
                    supplierPhone: sup?.phone || '',
                    supplierLogo: sup?.logoUrl || null,
                    referenceNumber: ch.referenceNumber || po?.referenceNumber || 'S/N',
                    invoiceUrl: ch.invoiceUrl || po?.invoiceUrl || null,
                    amountUsd,
                    exchangeRate: arrivalRate, // Tasa BCV histórica al recibir mercancía
                    amountVes: arrivalAmountVes,
                    arrivalExchangeRate: arrivalRate,
                    paymentExchangeRate: paymentRate, // Tasa BCV efectiva al día del pago
                    paymentAmountVes, // Monto en Bs calculado a la tasa del día de pago
                    exchangeDifference, // Diferencial cambiario por variación de tasa
                    arrivalDate: ch.arrivalDate || po?.arrivalDate || (ch.timestamp ? ch.timestamp.split('T')[0] : null),
                    dueDate: ch.dueDate || po?.dueDate || null,
                    timestamp: ch.timestamp,
                    description: ch.description,
                    status,
                    balanceRemaining,
                    paidAt,
                    paymentMethod: latestPayment?.paymentMethod || 'cash',
                    paymentsCount: sPayments.length
                });
            }
        }

        // Ordenar facturas por fecha descendente (más recientes primero)
        computedInvoices.sort((a, b) => new Date(b.arrivalDate || b.timestamp) - new Date(a.arrivalDate || a.timestamp));

        const paidInvoices = computedInvoices.filter(i => i.status === 'PAID');
        const pendingInvoices = computedInvoices.filter(i => i.status === 'PENDING' || i.status === 'PARTIAL');
        const totalPaidUsd = paidInvoices.reduce((sum, i) => sum + i.amountUsd, 0);

        res.json({
            success: true,
            invoices: computedInvoices,
            paidInvoices,
            pendingInvoices,
            summary: {
                totalInvoices: computedInvoices.length,
                totalPaidCount: paidInvoices.length,
                totalPaidUsd: Number(totalPaidUsd.toFixed(2)),
                totalPendingCount: pendingInvoices.length
            }
        });
    } catch (err) {
        console.error('Error fetching invoice history:', err);
        res.status(500).json({ error: 'Error al consultar historial de facturas: ' + err.message });
    }
});

// POST /suppliers/import - Importación masiva de proveedores
router.post('/import', requirePermission('canManageSuppliers'), async (req, res) => {
    try {
        const companyId = req.user.companyId || 'default';
        const suppliersList = Array.isArray(req.body?.suppliers)
            ? req.body.suppliers
            : (Array.isArray(req.body) ? req.body : []);

        if (suppliersList.length === 0) {
            return res.status(400).json({ error: 'No se recibieron proveedores válidos para importar.' });
        }

        const results = { imported: 0, updated: 0, errors: [] };
        for (const item of suppliersList) {
            try {
                if (!item || !item.name) continue;
                let existing = null;
                if (item.rif) {
                    existing = await Supplier.findOne({ where: { rif: item.rif, companyId } });
                }
                if (!existing && item.id) {
                    existing = await Supplier.findOne({ where: { id: String(item.id), companyId } });
                }

                if (existing) {
                    await existing.update({
                        name: item.name || existing.name,
                        contactName: item.contactName ?? existing.contactName,
                        phone: item.phone ?? existing.phone,
                        email: item.email ?? existing.email,
                        address: item.address ?? existing.address,
                        rif: item.rif ?? existing.rif,
                        category: item.category ?? existing.category,
                        notes: item.notes ?? existing.notes
                    });
                    results.updated++;
                } else {
                    await Supplier.create({
                        id: (item.id && !String(item.id).startsWith('local-')) ? String(item.id) : generateRobustId(),
                        companyId,
                        name: String(item.name).trim(),
                        contactName: item.contactName || '',
                        phone: item.phone || '',
                        email: item.email || '',
                        address: item.address || '',
                        rif: item.rif || '',
                        category: item.category || 'General',
                        debt: Number(item.debt) || 0,
                        creditBalance: Number(item.creditBalance) || 0,
                        notes: item.notes || ''
                    });
                    results.imported++;
                }
            } catch (rowErr) {
                results.errors.push({ name: item?.name, error: rowErr.message });
            }
        }

        res.json({
            success: true,
            message: `Importación completada: ${results.imported} creados, ${results.updated} actualizados.`,
            ...results
        });
    } catch (err) {
        console.error('Error importing suppliers:', err);
        res.status(500).json({ error: 'Error al importar proveedores: ' + err.message });
    }
});

module.exports = router;
