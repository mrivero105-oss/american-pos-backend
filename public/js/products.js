import { api as API } from './api.js';

export const Products = {
    products: [],
    html5QrCode: null,

    dom: {
        viewProducts: document.getElementById('view-products'),
        productsList: document.getElementById('products-list'),
        btnAddProduct: document.getElementById('add-product-btn'),
        btnBulkUpload: document.getElementById('bulk-upload-btn'),
        btnExportProducts: document.getElementById('export-products-btn'),
        searchInput: document.getElementById('search-product-manage'),

        // Modal
        modal: document.getElementById('product-form-modal'),
        modalTitle: document.getElementById('product-modal-title'),
        form: document.getElementById('product-form'),
        btnCloseModal: document.getElementById('close-product-modal'),
        btnCancelForm: document.getElementById('cancel-product-form'),

        // Bulk Upload Modal
        bulkModal: document.getElementById('bulk-upload-modal'),
        bulkFileInput: document.getElementById('bulk-file-input'),
        bulkPreviewTable: document.getElementById('bulk-preview-table'),
        bulkSummary: document.getElementById('bulk-summary'),
        bulkErrors: document.getElementById('bulk-errors'),
        btnCloseBulkModal: document.getElementById('close-bulk-modal'),
        btnConfirmBulk: document.getElementById('confirm-bulk-upload'),
        btnCancelBulk: document.getElementById('cancel-bulk-upload'),

        // Form Fields
        inputId: document.getElementById('product-id'),
        inputName: document.getElementById('product-name'),
        inputPrice: document.getElementById('product-price'),
        inputPriceBs: document.getElementById('product-price-bs'),
        inputStock: document.getElementById('product-stock'),
        inputCategory: document.getElementById('product-category'),
        inputImageFile: document.getElementById('product-image-file'),
        imagePreview: document.getElementById('image-preview'),

        inputBarcode: document.getElementById('product-barcode'),

        // Advanced Pricing Fields
        packageType: document.getElementById('package-type'),
        unitsPerBulk: document.getElementById('units-per-bulk'),
        boxesPerBulk: document.getElementById('boxes-per-bulk'),
        unitsPerBox: document.getElementById('units-per-box'),
        costPerPackage: document.getElementById('cost-per-package'),
        profitMargin: document.getElementById('profit-margin'),
        calculatedUnitCost: document.getElementById('calculated-unit-cost'),
        calculatedSalePrice: document.getElementById('calculated-sale-price'),
        btnApplyPrice: document.getElementById('apply-calculated-price'),
        packageLabel: document.getElementById('package-label'),
        quantityFields: document.getElementById('quantity-fields'),
        unitsPerBulkField: document.getElementById('units-per-bulk-field'),
        boxesPerBulkField: document.getElementById('boxes-per-bulk-field'),
        unitsPerBoxField: document.getElementById('units-per-box-field'),
        costFields: document.getElementById('cost-fields'),
        calculatedValues: document.getElementById('calculated-values')
    },

    async init() {
        this.bindEvents();
        await this.loadExchangeRate();
    },

    async loadExchangeRate() {
        try {
            const settings = await API.settings.getRate();
            this.exchangeRate = settings.rate || 40; // Default fallback
        } catch (error) {
            console.error('Error loading exchange rate:', error);
            this.exchangeRate = 40;
        }
    },

    bindEvents() {
        // Navigation to this view is handled in app.js

        // Add Product Button
        this.dom.btnAddProduct?.addEventListener('click', () => this.openModal());

        // Bulk Upload Button
        this.dom.btnBulkUpload?.addEventListener('click', () => this.openBulkUploadModal());

        // Export Products Button
        this.dom.btnExportProducts?.addEventListener('click', () => this.exportProducts());

        // Modal Actions
        this.dom.btnCloseModal?.addEventListener('click', () => this.closeModal());
        this.dom.btnCancelForm?.addEventListener('click', () => this.closeModal());

        // Bulk Upload Modal Actions
        this.dom.btnCloseBulkModal?.addEventListener('click', () => this.closeBulkUploadModal());
        this.dom.btnCancelBulk?.addEventListener('click', () => this.closeBulkUploadModal());
        this.dom.btnConfirmBulk?.addEventListener('click', () => this.processBulkUpload());
        this.dom.bulkFileInput?.addEventListener('change', (e) => this.handleFileSelect(e));

        // Form Submit
        this.dom.form?.addEventListener('submit', (e) => this.handleFormSubmit(e));

        // Image Preview
        this.dom.inputImageFile?.addEventListener('change', (e) => this.handleImageSelect(e));

        // Search
        this.dom.searchInput?.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = this.products.filter(p =>
                p.name.toLowerCase().includes(term) ||
                (p.category && p.category.toLowerCase().includes(term)) ||
                (p.barcode && p.barcode.includes(term))
            );
            this.renderProductList(filtered);
        });

        // Barcode Scanner
        const btnScan = document.getElementById('scan-barcode-btn');
        if (btnScan) {
            btnScan.addEventListener('click', () => this.startScanner());
        }

        // Advanced Pricing Event Listeners
        this.dom.packageType?.addEventListener('change', () => this.handlePackageTypeChange());
        this.dom.unitsPerBulk?.addEventListener('input', () => this.updatePriceCalculations());
        this.dom.boxesPerBulk?.addEventListener('input', () => this.updatePriceCalculations());
        this.dom.unitsPerBox?.addEventListener('input', () => this.updatePriceCalculations());
        this.dom.costPerPackage?.addEventListener('input', () => this.updatePriceCalculations());
        this.dom.profitMargin?.addEventListener('input', () => this.updatePriceCalculations());
        this.dom.btnApplyPrice?.addEventListener('click', () => this.applyCalculatedPrice());

        // Price Conversion Events
        this.dom.inputPrice?.addEventListener('input', (e) => {
            const usd = parseFloat(e.target.value);
            if (!isNaN(usd) && this.dom.inputPriceBs) {
                this.dom.inputPriceBs.value = (usd * this.exchangeRate).toFixed(2);
            }
        });

        this.dom.inputPriceBs?.addEventListener('input', (e) => {
            const bs = parseFloat(e.target.value);
            if (!isNaN(bs) && this.dom.inputPrice) {
                this.dom.inputPrice.value = (bs / this.exchangeRate).toFixed(2);
            }
        });
    },

    async startScanner() {
        const readerElement = document.getElementById('reader');
        if (!readerElement) return;

        readerElement.classList.remove('hidden');

        // Check if Html5Qrcode is loaded
        if (typeof Html5Qrcode === 'undefined') {
            alert('Error: La librería de escáner no se ha cargado.');
            return;
        }

        try {
            if (this.html5QrCode) {
                await this.html5QrCode.stop().catch(err => console.log('Scanner stop error', err));
            }

            this.html5QrCode = new Html5Qrcode("reader");

            const config = { fps: 10, qrbox: { width: 250, height: 250 } };

            await this.html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText, decodedResult) => {
                    // Success callback
                    console.log(`Code matched = ${decodedText}`, decodedResult);

                    // Fill input
                    if (this.dom.inputBarcode) {
                        this.dom.inputBarcode.value = decodedText;
                        // Flash effect or sound could go here
                    }

                    // Stop scanning
                    this.stopScanner();
                },
                (errorMessage) => {
                    // parse error, ignore it.
                }
            );
        } catch (err) {
            console.error('Error starting scanner', err);
            alert('No se pudo iniciar la cámara. Si estás en un móvil, usa HTTPS o localhost. Los navegadores bloquean la cámara en conexiones inseguras.');
            readerElement.classList.add('hidden');
        }
    },

    async stopScanner() {
        if (this.html5QrCode) {
            try {
                await this.html5QrCode.stop();
                this.html5QrCode = null;
            } catch (err) {
                console.error('Failed to stop scanner', err);
            }
        }
        const readerElement = document.getElementById('reader');
        if (readerElement) {
            readerElement.classList.add('hidden');
        }
    },

    async loadProducts() {
        try {
            this.products = await API.products.getAll();
            this.renderProductList(this.products);
        } catch (error) {
            console.error('Error loading products:', error);
            alert('Error al cargar productos');
        }
    },

    renderProductList(products) {
        if (!this.dom.productsList) return;

        this.dom.productsList.innerHTML = products.map(product => `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="h-10 w-10 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                        <img src="${product.imageUri || 'assets/placeholder.png'}" alt="${product.name}" class="h-full w-full object-cover" onerror="this.src='https://via.placeholder.com/40'">
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-slate-900 dark:text-white">${product.name}</div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">${product.barcode || ''}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-800">
                        ${product.category || 'General'}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-600 dark:text-slate-300">
                    $${parseFloat(product.price).toFixed(2)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${product.stock > 5 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        ${product.stock}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onclick="window.editProduct('${product.id}')" class="text-indigo-600 hover:text-indigo-900 mr-3">Editar</button>
                    <button onclick="window.deleteProduct('${product.id}')" class="text-red-600 hover:text-red-900">Borrar</button>
                </td>
            </tr>
        `).join('');

        // Expose functions to window for inline onclick handlers
        window.editProduct = (id) => {
            const product = this.products.find(p => p.id === id);
            if (product) this.openModal(product);
        };

        window.deleteProduct = (id) => this.deleteProduct(id);
    },

    openModal(product = null) {
        this.stopScanner(); // Ensure scanner is closed when opening modal
        this.dom.form.reset();
        this.dom.inputId.value = '';

        // Reset pricing fields
        if (this.dom.packageType) this.dom.packageType.value = '';
        if (this.dom.unitsPerBulk) this.dom.unitsPerBulk.value = '';
        if (this.dom.boxesPerBulk) this.dom.boxesPerBulk.value = '';
        if (this.dom.unitsPerBox) this.dom.unitsPerBox.value = '';
        if (this.dom.costPerPackage) this.dom.costPerPackage.value = '';
        if (this.dom.profitMargin) this.dom.profitMargin.value = '';

        // Hide all pricing fields
        if (this.dom.quantityFields) this.dom.quantityFields.classList.add('hidden');
        if (this.dom.unitsPerBulkField) this.dom.unitsPerBulkField.classList.add('hidden');
        if (this.dom.boxesPerBulkField) this.dom.boxesPerBulkField.classList.add('hidden');
        if (this.dom.unitsPerBoxField) this.dom.unitsPerBoxField.classList.add('hidden');
        if (this.dom.costFields) this.dom.costFields.classList.add('hidden');
        if (this.dom.calculatedValues) this.dom.calculatedValues.classList.add('hidden');

        if (product) {
            this.dom.modalTitle.textContent = 'Editar Producto';
            this.dom.inputId.value = product.id;
            this.dom.inputName.value = product.name;
            this.dom.inputPrice.value = product.price;
            this.dom.inputStock.value = product.stock;
            this.dom.inputCategory.value = product.category || '';
            this.dom.inputBarcode.value = product.barcode || '';

            // Show existing image preview
            if (product.imageUri) {
                this.dom.imagePreview.innerHTML = `<img src="${product.imageUri}" class="w-full h-full object-cover">`;
            } else {
                this.resetImagePreview();
            }
            this.currentImageUri = product.imageUri; // Store current image
        } else {
            this.dom.modalTitle.textContent = 'Nuevo Producto';
            this.resetImagePreview();
            this.currentImageUri = '';
        }

        this.dom.modal.classList.remove('hidden');
    },

    closeModal() {
        this.stopScanner(); // Ensure scanner stops when closing modal
        this.dom.modal.classList.add('hidden');
    },

    async handleFormSubmit(e) {
        e.preventDefault();

        const productData = {
            name: this.dom.inputName.value,
            price: parseFloat(this.dom.inputPrice.value),
            stock: parseInt(this.dom.inputStock.value),
            category: this.dom.inputCategory.value,
            imageUri: this.currentImageUri || '',
            barcode: this.dom.inputBarcode.value
        };

        const id = this.dom.inputId.value;

        try {
            if (id) {
                await API.products.update(id, productData);
            } else {
                await API.products.create(productData);
            }

            this.closeModal();
            this.loadProducts();

            // Also refresh POS grid if available
            if (window.app && window.app.views && window.app.views.pos) {
                window.app.views.pos.loadProducts();
            }
        } catch (error) {
            console.error('Error saving product:', error);
            alert('Error al guardar producto');
        }
    },

    async deleteProduct(id) {
        if (!confirm('¿Estás seguro de que quieres eliminar este producto?')) return;

        try {
            await API.products.delete(id);
            this.loadProducts();

            // Also refresh POS grid if available
            if (window.app && window.app.views && window.app.views.pos) {
                window.app.views.pos.loadProducts();
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            alert('Error al eliminar el producto');
        }
    },

    handleImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('La imagen es demasiado grande. Máximo 5MB.');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            this.currentImageUri = base64;
            this.dom.imagePreview.innerHTML = `<img src="${base64}" class="w-full h-full object-cover">`;
        };
        reader.readAsDataURL(file);
    },

    resetImagePreview() {
        if (this.dom.imagePreview) {
            this.dom.imagePreview.innerHTML = `
                <svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
            `;
        }
        if (this.dom.inputImageFile) this.dom.inputImageFile.value = '';
    },

    // Bulk Upload Methods
    bulkData: [],

    openBulkUploadModal() {
        this.bulkData = [];
        if (this.dom.bulkFileInput) this.dom.bulkFileInput.value = '';
        if (this.dom.bulkPreviewTable) this.dom.bulkPreviewTable.innerHTML = '';
        if (this.dom.bulkSummary) this.dom.bulkSummary.innerHTML = '';
        if (this.dom.bulkErrors) this.dom.bulkErrors.innerHTML = '';
        this.dom.bulkModal?.classList.remove('hidden');
    },

    closeBulkUploadModal() {
        this.dom.bulkModal?.classList.add('hidden');
        this.bulkData = [];
    },

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
            alert('Por favor selecciona un archivo Excel (.xlsx, .xls) o CSV (.csv)');
            return;
        }

        try {
            const data = await this.parseExcelFile(file);
            this.bulkData = data;
            this.renderBulkPreview(data);
        } catch (error) {
            console.error('Error parsing file:', error);
            alert('Error al leer el archivo');
        }
    },

    parseExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);

                    const parsedData = jsonData.map((row, index) => {
                        const errors = [];

                        if (!row.nombre) errors.push('Nombre requerido');
                        if (!row.precio || isNaN(row.precio)) errors.push('Precio inválido');
                        if (!row.stock || isNaN(row.stock)) errors.push('Stock inválido');
                        if (!row.categoria) errors.push('Categoría requerida');

                        return {
                            rowNumber: index + 2,
                            name: row.nombre || '',
                            price: parseFloat(row.precio) || 0,
                            stock: parseInt(row.stock) || 0,
                            category: row.categoria || '',
                            barcode: row.codigo_barras || '',
                            imageUri: row.imagen_url || '',
                            errors,
                            isValid: errors.length === 0
                        };
                    });

                    resolve(parsedData);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    },

    renderBulkPreview(data) {
        if (!this.dom.bulkPreviewTable) return;

        const validCount = data.filter(d => d.isValid).length;
        const errorCount = data.length - validCount;
        const existingBarcodes = data.filter(d => d.barcode && this.products.some(p => p.barcode === d.barcode));

        // Summary
        if (this.dom.bulkSummary) {
            this.dom.bulkSummary.innerHTML = `
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p class="text-sm text-blue-800">
                        <strong>Total:</strong> ${data.length} productos | 
                        <strong class="text-green-700">Válidos:</strong> ${validCount} | 
                        <strong class="text-red-700">Errores:</strong> ${errorCount} | 
                        <strong class="text-yellow-700">Actualizaciones:</strong> ${existingBarcodes.length}
                    </p>
                </div>
            `;
        }

        // Errors
        if (this.dom.bulkErrors && errorCount > 0) {
            const errorRows = data.filter(d => !d.isValid);
            this.dom.bulkErrors.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p class="text-sm font-semibold text-red-800 mb-2">Errores encontrados:</p>
                    <ul class="text-xs text-red-700 list-disc list-inside">
                        ${errorRows.map(row => `<li>Fila ${row.rowNumber}: ${row.errors.join(', ')}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else if (this.dom.bulkErrors) {
            this.dom.bulkErrors.innerHTML = '';
        }

        // Preview Table
        this.dom.bulkPreviewTable.innerHTML = `
            <table class="min-w-full divide-y divide-slate-200">
                <thead class="bg-slate-50">
                    <tr>
                        <th class="px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">Fila</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">Nombre</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">Precio</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">Stock</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">Categoría</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300">Estado</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-slate-200">
                    ${data.slice(0, 10).map(row => `
                        <tr class="${row.isValid ? '' : 'bg-red-50'}">
                            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">${row.rowNumber}</td>
                            <td class="px-3 py-2 text-xs text-slate-900 dark:text-white">${row.name}</td>
                            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">$${row.price.toFixed(2)}</td>
                            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">${row.stock}</td>
                            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">${row.category}</td>
                            <td class="px-3 py-2 text-xs">
                                ${row.isValid ?
                (row.barcode && this.products.some(p => p.barcode === row.barcode) ?
                    '<span class="text-yellow-600">Actualizar</span>' :
                    '<span class="text-green-600">Crear</span>') :
                '<span class="text-red-600">Error</span>'}
                            </td>
                        </tr>
                    `).join('')}
                    ${data.length > 10 ? `<tr><td colspan="6" class="px-3 py-2 text-xs text-slate-500 text-center">... y ${data.length - 10} más</td></tr>` : ''}
                </tbody>
            </table>
        `;
    },

    async processBulkUpload() {
        const validData = this.bulkData.filter(d => d.isValid);
        if (validData.length === 0) {
            alert('No hay productos válidos para procesar');
            return;
        }

        if (!confirm(`¿Procesar ${validData.length} productos?`)) return;

        try {
            let created = 0;
            let updated = 0;
            let errors = 0;

            for (const item of validData) {
                try {
                    // Check if product exists by barcode
                    const existing = item.barcode ? this.products.find(p => p.barcode === item.barcode) : null;

                    const productData = {
                        name: item.name,
                        price: item.price,
                        stock: item.stock,
                        category: item.category,
                        barcode: item.barcode,
                        imageUri: item.imageUri
                    };

                    if (existing) {
                        await API.products.update(existing.id, productData);
                        updated++;
                    } else {
                        await API.products.create(productData);
                        created++;
                    }
                } catch (error) {
                    console.error('Error processing row:', item, error);
                    errors++;
                }
            }

            alert(`Carga completada:\n✓ ${created} productos creados\n✓ ${updated} productos actualizados${errors > 0 ? `\n✗ ${errors} errores` : ''}`);

            this.closeBulkUploadModal();
            this.loadProducts();

            // Refresh POS if available
            if (window.app && window.app.views && window.app.views.pos) {
                window.app.views.pos.loadProducts();
            }
        } catch (error) {
            console.error('Bulk upload error:', error);
            alert('Error durante la carga masiva');
        }
    },

    exportProducts() {
        if (this.products.length === 0) {
            alert('No hay productos para exportar');
            return;
        }

        // Create CSV content
        const headers = 'nombre,precio,stock,categoria,codigo_barras,imagen_url';
        const rows = this.products.map(p => {
            return [
                p.name || '',
                p.price || 0,
                p.stock || 0,
                p.category || '',
                p.barcode || '',
                p.imageUri || ''
            ].join(',');
        });

        const csvContent = [headers, ...rows].join('\n');

        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `productos_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        alert(`${this.products.length} productos exportados exitosamente`);
    },

    // Advanced Pricing Methods
    handlePackageTypeChange() {
        const packageType = this.dom.packageType.value;

        // Reset fields
        this.dom.unitsPerBulk.value = '';
        this.dom.boxesPerBulk.value = '';
        this.dom.unitsPerBox.value = '';
        this.dom.costPerPackage.value = '';
        this.dom.profitMargin.value = '';

        // Hide all conditional fields
        this.dom.quantityFields.classList.add('hidden');
        this.dom.unitsPerBulkField.classList.add('hidden');
        this.dom.boxesPerBulkField.classList.add('hidden');
        this.dom.unitsPerBoxField.classList.add('hidden');
        this.dom.costFields.classList.add('hidden');
        this.dom.calculatedValues.classList.add('hidden');

        if (!packageType) return;

        // Show cost fields for all types
        this.dom.costFields.classList.remove('hidden');

        // Update label
        const labels = {
            'unidad': 'Unidad',
            'caja': 'Caja',
            'bulto': 'Bulto'
        };
        this.dom.packageLabel.textContent = labels[packageType] || 'Empaque';

        // Show quantity fields based on type
        if (packageType === 'caja') {
            this.dom.quantityFields.classList.remove('hidden');
            this.dom.unitsPerBoxField.classList.remove('hidden');
        } else if (packageType === 'bulto') {
            this.dom.quantityFields.classList.remove('hidden');
            this.dom.unitsPerBulkField.classList.remove('hidden');
            this.dom.boxesPerBulkField.classList.remove('hidden');
            this.dom.unitsPerBoxField.classList.remove('hidden');
        }
    },

    calculateUnitCost() {
        const packageType = this.dom.packageType.value;
        const cost = parseFloat(this.dom.costPerPackage.value) || 0;

        if (!packageType || cost === 0) return 0;

        if (packageType === 'unidad') {
            return cost;
        } else if (packageType === 'caja') {
            const unitsPerBox = parseFloat(this.dom.unitsPerBox.value) || 0;
            if (unitsPerBox === 0) return 0;
            return cost / unitsPerBox;
        } else if (packageType === 'bulto') {
            // Check if direct units per bulk is provided
            const unitsPerBulk = parseFloat(this.dom.unitsPerBulk.value) || 0;
            if (unitsPerBulk > 0) {
                return cost / unitsPerBulk;
            }

            // Otherwise calculate from boxes
            const boxesPerBulk = parseFloat(this.dom.boxesPerBulk.value) || 0;
            const unitsPerBox = parseFloat(this.dom.unitsPerBox.value) || 0;
            if (boxesPerBulk === 0 || unitsPerBox === 0) return 0;
            const totalUnits = boxesPerBulk * unitsPerBox;
            return cost / totalUnits;
        }

        return 0;
    },

    calculateSalePrice(unitCost) {
        const margin = parseFloat(this.dom.profitMargin.value) || 0;
        if (unitCost === 0 || margin === 0) return 0;
        return unitCost * (1 + margin / 100);
    },

    updatePriceCalculations() {
        const unitCost = this.calculateUnitCost();
        const salePrice = this.calculateSalePrice(unitCost);

        // Update display
        this.dom.calculatedUnitCost.textContent = `$${unitCost.toFixed(2)}`;
        this.dom.calculatedSalePrice.textContent = `$${salePrice.toFixed(2)}`;

        // Show/hide calculated values
        if (unitCost > 0 && salePrice > 0) {
            this.dom.calculatedValues.classList.remove('hidden');
        } else {
            this.dom.calculatedValues.classList.add('hidden');
        }
    },

    applyCalculatedPrice() {
        const salePrice = parseFloat(this.dom.calculatedSalePrice.textContent.replace('$', ''));
        if (salePrice > 0) {
            this.dom.inputPrice.value = salePrice.toFixed(2);
            alert('Precio aplicado correctamente');
        }
    }
};
