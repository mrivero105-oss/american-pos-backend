const path = require('path');
const fs = require('fs');

class CatalogPdfGenerator {
    static async generate(businessInfo, categories, settings) {
        // Verificar que estamos corriendo dentro de Electron (vital para ahorrar los 300MB de Puppeteer)
        if (!process.versions.hasOwnProperty('electron')) {
            throw new Error('La generación de catálogos en PDF nativa requiere que la app se ejecute mediante Electron (npm run electron:start o versión empaquetada).');
        }

        const { BrowserWindow } = require('electron');

        return new Promise(async (resolve, reject) => {
            let printWin;
            try {
                printWin = new BrowserWindow({
                    show: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true,
                        javascript: false
                    }
                });

            const { rate, currencyMode, baseUrl } = settings;
            const today = new Date().toLocaleDateString('es-VE', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            });

            const htmlContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <style>
                    :root {
                        --primary: #3b82f6;
                        --primary-dark: #1d4ed8;
                        --slate-900: #0f172a;
                        --slate-100: #f1f5f9;
                        --slate-600: #475569;
                    }

                    body {
                        font-family: 'system-ui', '-apple-system', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        background: white;
                        color: var(--slate-900);
                        margin: 0;
                        padding: 0;
                    }

                    .page {
                        padding: 25px;
                    }

                    .header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 2px solid var(--slate-100);
                        padding-bottom: 12px;
                        margin-bottom: 20px;
                    }

                    .business-info h1 {
                        margin: 0;
                        font-size: 20px;
                        font-weight: 900;
                        color: var(--primary);
                        text-transform: uppercase;
                    }

                    .business-info p {
                        margin: 1px 0;
                        font-size: 10px;
                        color: var(--slate-600);
                        font-weight: 700;
                    }

                    .catalog-title h2 {
                        margin: 0;
                        font-size: 22px;
                        font-weight: 900;
                        text-transform: uppercase;
                        text-align: right;
                    }

                    .date-badge {
                        display: block;
                        background: var(--slate-900);
                        color: white;
                        padding: 2px 8px;
                        border-radius: 12px;
                        font-size: 8px;
                        font-weight: 900;
                        margin-top: 4px;
                        text-align: center;
                    }

                    .category-section {
                        margin-bottom: 20px;
                        break-inside: avoid;
                    }

                    .category-header {
                        background: #f1f5f9;
                        border-left: 6px solid var(--primary);
                        color: var(--slate-900);
                        padding: 10px 18px;
                        font-size: 14px;
                        font-weight: 900;
                        text-transform: uppercase;
                        margin-bottom: 18px;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }

                    .products-grid {
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 10px;
                    }

                    .product-card {
                        background: white;
                        padding: 12px;
                        border-radius: 14px;
                        border: 1px solid #edf2f7;
                        display: flex;
                        align-items: center;
                        gap: 14px;
                        height: 85px; /* Increased height for better fit */
                        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
                    }

                    .product-image-container {
                        width: 60px;
                        height: 60px;
                        background: #f8fafc;
                        border-radius: 10px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                        overflow: hidden;
                        border: 1px solid #f1f5f9;
                    }

                    .product-image-container img {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    }

                    .product-img-placeholder {
                        font-weight: 900;
                        color: #cbd5e1;
                        font-size: 18px;
                    }

                    .product-details {
                        flex: 1;
                        min-width: 0;
                    }

                    .product-name {
                        font-size: 10.5px;
                        font-weight: 900;
                        text-transform: uppercase;
                        margin-bottom: 3px;
                        color: #1a202c;
                        display: -webkit-box;
                        -webkit-line-clamp: 2; /* Allow 2 lines */
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                        line-height: 1.3;
                    }

                    .price-primary {
                        font-size: 14px;
                        font-weight: 900;
                        color: var(--primary);
                    }

                    .price-secondary {
                        font-size: 8px;
                        font-weight: 700;
                        color: var(--slate-600);
                        margin-left: 4px;
                    }

                    .unit-label {
                        font-size: 8px;
                        color: #a0aec0;
                        font-weight: 800;
                        text-transform: uppercase;
                        margin-top: 4px;
                    }

                    .footer {
                        text-align: center;
                        padding-top: 10px;
                        border-top: 1px solid var(--slate-100);
                        font-size: 8px;
                        color: var(--slate-600);
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="page">
                    <div class="header">
                        <div class="business-info">
                            <h1>${businessInfo.name || 'American POS'}</h1>
                            <p>${businessInfo.address || 'Catálogo Digital'}</p>
                            <p>${businessInfo.phone || ''}</p>
                        </div>
                        <div class="catalog-title">
                            <h2>CATÁLOGO DE PRODUCTOS</h2>
                            <span class="date-badge">${today}</span>
                        </div>
                    </div>

                    ${Object.keys(categories).map(catName => {
                const escapeHtml = (str) => {
                    if (!str) return '';
                    return str.toString()
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');
                };

                const productsHtml = categories[catName].map(p => {
                    const priceUsd = parseFloat(p.price) || 0;
                    const priceBs = priceUsd * rate;
                    const safeName = escapeHtml(p.name);
                    const safeUnit = escapeHtml(p.stockUnit || 'UND');

                    // Load image via network URL instead of Base64 for performance
                    const imgUrl = p.imageUri ? `${baseUrl}${p.imageUri}` : null;

                    let primaryPrice = '';
                    let secondaryPrice = '';

                    if (currencyMode === 'USD') {
                        primaryPrice = `$${priceUsd.toFixed(2)}`;
                    } else if (currencyMode === 'VES') {
                        primaryPrice = `Bs. ${priceBs.toFixed(2)}`;
                    } else {
                        primaryPrice = `$${priceUsd.toFixed(2)}`;
                        secondaryPrice = `Ref: Bs. ${priceBs.toFixed(2)}`;
                    }

                    // Clean up unit label to avoid "UNIDAD: UNIDAD"
                    let unitText = safeUnit;
                    if (unitText.toLowerCase() === 'unidad' || unitText.toLowerCase() === 'und') {
                        unitText = '1 Unidad';
                    } else if (!unitText.toLowerCase().includes('unidad') && !unitText.toLowerCase().includes('kg')) {
                        unitText = `1 ${unitText}`;
                    }

                    return `
                                <div class="product-card">
                                    <div class="product-image-container">
                                        ${imgUrl
                            ? `<img src="${imgUrl}" alt="${safeName}">`
                            : `<div class="product-img-placeholder">${safeName.charAt(0)}</div>`
                        }
                                    </div>
                                    <div class="product-details">
                                        <div class="product-name">${safeName}</div>
                                        <div class="product-price">
                                            <span class="price-primary">${primaryPrice}</span>
                                            ${secondaryPrice ? `<span class="price-secondary">${secondaryPrice}</span>` : ''}
                                        </div>
                                        <div class="unit-label">${unitText}</div>
                                    </div>
                                </div>
                            `;
                }).join('');

                return `
                            <div class="category-section">
                                <div class="category-header">📦 ${escapeHtml(catName)}</div>
                                <div class="products-grid">
                                    ${productsHtml}
                                </div>
                            </div>
                        `;
            }).join('')}

                    <div class="footer">
                        <p>PRECIOS VÁLIDOS AL MOMENTO DE LA CONSULTA. <span style="font-weight: 900;">TASA: ${rate.toFixed(2)} Bs/$</span></p>
                        <p>© ${new Date().getFullYear()} Generado por American POS</p>
                    </div>
                </div>
            </body>
            </html>
            `;

            await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

            printWin.webContents.on('did-finish-load', async () => {
                try {
                    const pdfBuffer = await printWin.webContents.printToPDF({
                        printBackground: true,
                        margins: { marginType: 'none' }, // Sin márgenes (0px)
                        pageSize: 'A4'
                    });

                    // Sanity check: PDF signature
                    if (!pdfBuffer || pdfBuffer[0] !== 0x25 || pdfBuffer[1] !== 0x50 || pdfBuffer[2] !== 0x44 || pdfBuffer[3] !== 0x46) {
                        throw new Error('El motor generó un archivo no válido (Firma PDF incorrecta)');
                    }

                    printWin.close();
                    resolve(pdfBuffer);
                } catch (err) {
                    if (!printWin.isDestroyed()) printWin.close();
                    reject(err);
                }
            });

            // Timeout de seguridad de 60 segundos
            setTimeout(() => {
                if (printWin && !printWin.isDestroyed()) {
                    printWin.close();
                    reject(new Error('Timeout al generar el PDF del catálogo'));
                }
            }, 60000);

        } catch (error) {
            if (printWin && !printWin.isDestroyed()) printWin.close();
            reject(error);
        }
        });
    }
}

module.exports = CatalogPdfGenerator;
