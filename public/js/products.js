import { api as API } from './api.js';

export const Products = {
    products: [],
    html5QrCode: null,

    dom: {
        viewProducts: document.getElementById('view-products'),
        productsList: document.getElementById('products-list'),
        btnAddProduct: document.getElementById('add-product-btn'),
        searchInput: document.getElementById('search-product-manage'),

        // Modal
        modal: document.getElementById('product-form-modal'),
        modalTitle: document.getElementById('product-modal-title'),
        form: document.getElementById('product-form'),
        btnCloseModal: document.getElementById('close-product-modal'),
        btnCancelForm: document.getElementById('cancel-product-form'),

        // Form Fields
        inputId: document.getElementById('product-id'),
        inputName: document.getElementById('product-name'),
        inputPrice: document.getElementById('product-price'),
        inputStock: document.getElementById('product-stock'),
        inputCategory: document.getElementById('product-category'),
        inputImage: document.getElementById('product-image'),
        inputBarcode: document.getElementById('product-barcode')
    },

    init() {
        this.bindEvents();
    },

    bindEvents() {
        // Navigation to this view is handled in app.js

        // Add Product Button
        this.dom.btnAddProduct?.addEventListener('click', () => this.openModal());

        // Modal Actions
        this.dom.btnCloseModal?.addEventListener('click', () => this.closeModal());
        this.dom.btnCancelForm?.addEventListener('click', () => this.closeModal());

        // Form Submit
        this.dom.form?.addEventListener('submit', (e) => this.handleFormSubmit(e));

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
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="h-10 w-10 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                        <img src="${product.imageUri || 'assets/placeholder.png'}" alt="${product.name}" class="h-full w-full object-cover" onerror="this.src='https://via.placeholder.com/40'">
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-slate-900">${product.name}</div>
                    <div class="text-xs text-slate-500">${product.barcode || ''}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-800">
                        ${product.category || 'General'}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-600">
                    $${parseFloat(product.price).toFixed(2)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${product.stockQuantity > 5 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                        ${product.stockQuantity}
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

        if (product) {
            this.dom.modalTitle.textContent = 'Editar Producto';
            this.dom.inputId.value = product.id;
            this.dom.inputName.value = product.name;
            this.dom.inputPrice.value = product.price;
            this.dom.inputStock.value = product.stockQuantity;
            this.dom.inputCategory.value = product.category || '';
            this.dom.inputImage.value = product.imageUri || '';
            this.dom.inputBarcode.value = product.barcode || '';
        } else {
            this.dom.modalTitle.textContent = 'Nuevo Producto';
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
            stockQuantity: parseInt(this.dom.inputStock.value),
            category: this.dom.inputCategory.value,
            imageUri: this.dom.inputImage.value,
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
            if (window.app && window.app.pos) {
                window.app.pos.loadProducts();
            }

        } catch (error) {
            console.error('Error saving product:', error);
            alert('Error al guardar el producto');
        }
    },

    async deleteProduct(id) {
        if (!confirm('¿Estás seguro de que quieres eliminar este producto?')) return;

        try {
            await API.products.delete(id);
            this.loadProducts();

            // Also refresh POS grid if available
            if (window.app && window.app.pos) {
                window.app.pos.loadProducts();
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            alert('Error al eliminar el producto');
        }
    }
};
