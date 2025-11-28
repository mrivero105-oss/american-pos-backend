import { api } from './api.js';
import { ui } from './ui.js';
import { formatCurrency } from './utils.js';

export class POS {
    constructor() {
        console.log("POS v3 loaded successfully - Restored Version");
        this.cart = [];
        this.products = [];
        this.customers = [];
        this.selectedCustomer = null;
        this.lastSale = null;
        this.exchangeRate = 1.0;
        this.businessInfo = {};
        this.paymentMethods = [];

        // Pagination State
        this.currentPage = 1;
        this.itemsPerPage = 30;
        this.currentFilteredProducts = [];

        this.init();
    }

    async init() {
        this.cacheDOM();
        this.bindEvents();
        await this.loadSettings();
        await this.loadProducts();
        this.renderCategories();
        await this.loadCustomers();
        this.checkHeldSale();
        this.renderCart();
    }

    cacheDOM() {
        this.dom = {
            productGrid: document.getElementById('product-grid'),
            categoryFilters: document.getElementById('category-filters'),
            cartItems: document.getElementById('cart-items'),
            cartTotal: document.getElementById('cart-total'),
            cartTotalBs: document.getElementById('cart-total-bs'),
            searchInput: document.getElementById('search-input'),
            checkoutBtn: document.getElementById('checkout-btn'),
            clearCartBtn: document.getElementById('clear-cart-btn'),
            holdSaleBtn: document.getElementById('hold-sale-btn'),
            mobileCartCount: document.getElementById('mobile-cart-count'),

            // Customer Modal
            customerSelectionModal: document.getElementById('customer-selection-modal'),
            customerListCheckout: document.getElementById('customer-list-checkout'),
            searchCustomerCheckout: document.getElementById('search-customer-checkout'),
            skipCustomerBtn: document.getElementById('skip-customer-btn'),
            closeCustomerSelection: document.getElementById('close-customer-selection'),

            // Receipt Modal (Hidden inside Payment Modal)
            receiptModalContent: document.getElementById('receipt-modal-content'),
            paymentFormContent: document.querySelector('#payment-modal .p-6 > div:not(#receipt-modal-content)'),
            receiptContent: document.getElementById('receipt-content'),
            closeReceipt: document.getElementById('close-receipt'),
            emailReceiptBtn: document.getElementById('email-receipt-btn'),
            printReceiptBtn: document.getElementById('print-receipt-btn'),

            // Payment Modal
            paymentModal: document.getElementById('payment-modal'),
            paymentTotalUsd: document.getElementById('payment-total-usd'),
            paymentTotalVes: document.getElementById('payment-total-ves'),
            paymentMethodSelect: document.getElementById('payment-method-select'),
            paymentFields: document.getElementById('payment-fields'),
            paymentChange: document.getElementById('payment-change'),
            cancelPaymentBtn: document.getElementById('cancel-payment-btn'),
            confirmPaymentBtn: document.getElementById('confirm-payment-btn'),

            // Other
            confirmationModal: document.getElementById('confirmation-modal'),
            cancelConfirmBtn: document.getElementById('cancel-confirm-btn'),
            confirmActionBtn: document.getElementById('confirm-action-btn'),
            scanFeedback: document.getElementById('scan-feedback'),

            // Custom Item Modal
            customItemBtn: document.getElementById('custom-item-btn'),
            customItemModal: document.getElementById('custom-item-modal'),
            closeCustomItemModal: document.getElementById('close-custom-item-modal'),
            cancelCustomItem: document.getElementById('cancel-custom-item'),
            customItemForm: document.getElementById('custom-item-form'),
            customItemName: document.getElementById('custom-item-name'),
            customItemPriceUsd: document.getElementById('custom-item-price-usd'),
            customItemPriceBs: document.getElementById('custom-item-price-bs'),

            // Product Form (Main)
            productFormPriceUsd: document.getElementById('product-price'),
            productFormPriceBs: document.getElementById('product-price-bs')
        };

        // Ensure confirmation modal exists and is fresh
        this.dom.confirmationModal = this.createConfirmationModal();
        this.dom.cancelConfirmBtn = document.getElementById('cancel-confirm-btn');
        this.dom.confirmActionBtn = document.getElementById('confirm-action-btn');

        console.log('Cached DOM. Confirmation Modal:', this.dom.confirmationModal);
    }

    createConfirmationModal() {
        // Remove existing if any
        const existing = document.getElementById('confirmation-modal');
        if (existing) existing.remove();

        const modalHTML = `
        <div id="confirmation-modal"
            class="fixed inset-0 bg-black bg-opacity-50 hidden z-[9999] flex items-center justify-center backdrop-blur-sm p-4"
            style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999;">
            <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all">
                <div class="p-6 text-center">
                    <div class="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z">
                            </path>
                        </svg>
                    </div>
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white mb-2">¿Vaciar Carrito?</h3>
                    <p class="text-sm text-slate-600 dark:text-slate-300 mb-6">¿Estás seguro de que deseas eliminar todos los productos del carrito? Esta acción no se puede deshacer.</p>
                    <div class="flex gap-3">
                        <button id="cancel-confirm-btn"
                            class="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium">
                            Cancelar
                        </button>
                        <button id="confirm-action-btn"
                            class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium shadow-lg shadow-red-200 dark:shadow-none">
                            Sí, Vaciar
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        return document.getElementById('confirmation-modal');
    }

    bindPriceCalculators() {
        // Custom Item Form
        this.dom.customItemPriceUsd?.addEventListener('input', (e) => {
            const usd = parseFloat(e.target.value);
            if (!isNaN(usd) && this.exchangeRate > 0) {
                this.dom.customItemPriceBs.value = (usd * this.exchangeRate).toFixed(2);
            } else {
                this.dom.customItemPriceBs.value = '';
            }
        });

        this.dom.customItemPriceBs?.addEventListener('input', (e) => {
            const bs = parseFloat(e.target.value);
            if (!isNaN(bs) && this.exchangeRate > 0) {
                this.dom.customItemPriceUsd.value = (bs / this.exchangeRate).toFixed(2);
            } else {
                this.dom.customItemPriceUsd.value = '';
            }
        });

        // Product Form (Main)
        this.dom.productFormPriceUsd?.addEventListener('input', (e) => {
            const usd = parseFloat(e.target.value);
            if (!isNaN(usd) && this.exchangeRate > 0) {
                this.dom.productFormPriceBs.value = (usd * this.exchangeRate).toFixed(2);
            } else {
                this.dom.productFormPriceBs.value = '';
            }
        });

        this.dom.productFormPriceBs?.addEventListener('input', (e) => {
            const bs = parseFloat(e.target.value);
            if (!isNaN(bs) && this.exchangeRate > 0) {
                this.dom.productFormPriceUsd.value = (bs / this.exchangeRate).toFixed(2);
            } else {
                this.dom.productFormPriceUsd.value = '';
            }
        });
    }

    bindEvents() {
        this.dom.searchInput?.addEventListener('input', (e) => this.filterProducts(e.target.value));
        this.dom.productGrid?.addEventListener('click', (e) => this.handleGridClick(e));

        this.bindPriceCalculators();

        // Cart events
        this.dom.cartItems?.addEventListener('click', (e) => this.handleCartClick(e));
        this.dom.cartItems?.addEventListener('change', (e) => this.handleCartInput(e));

        this.dom.checkoutBtn?.addEventListener('click', () => this.showCustomerSelection());

        console.log('Binding clearCartBtn:', this.dom.clearCartBtn);
        this.dom.clearCartBtn?.addEventListener('click', () => {
            console.log('Clear Cart Clicked');
            this.clearCart();
        });

        this.dom.holdSaleBtn?.addEventListener('click', () => this.toggleHoldSale());

        // Customer selection
        this.dom.closeCustomerSelection?.addEventListener('click', () => this.hideCustomerSelection());
        this.dom.skipCustomerBtn?.addEventListener('click', () => this.processCheckout(null));
        this.dom.searchCustomerCheckout?.addEventListener('input', (e) => this.filterCustomers(e.target.value));
        this.dom.customerListCheckout?.addEventListener('click', (e) => this.handleCustomerSelect(e));

        // Confirmation Modal
        this.dom.cancelConfirmBtn?.addEventListener('click', () => this.hideConfirmationModal());
        this.dom.confirmActionBtn?.addEventListener('click', () => this.executeClearCart());

        // Custom Item Events
        this.dom.customItemBtn?.addEventListener('click', () => this.openCustomItemModal());
        this.dom.closeCustomItemModal?.addEventListener('click', () => this.closeCustomItemModal());
        this.dom.cancelCustomItem?.addEventListener('click', () => this.closeCustomItemModal());
        this.dom.customItemForm?.addEventListener('submit', (e) => this.handleCustomItemSubmit(e));

        // Receipt
        this.dom.closeReceipt?.addEventListener('click', () => this.hideReceipt());
        this.dom.emailReceiptBtn?.addEventListener('click', () => this.emailReceipt());
        this.dom.printReceiptBtn?.addEventListener('click', () => this.printReceipt());

        // Payment
        this.dom.cancelPaymentBtn?.addEventListener('click', () => this.hidePaymentModal());
        this.dom.confirmPaymentBtn?.addEventListener('click', () => this.confirmPayment());
        this.dom.paymentMethodSelect?.addEventListener('change', () => this.onPaymentMethodChange());

        // Confirmation Modal
        this.dom.cancelConfirmBtn?.addEventListener('click', () => this.hideConfirmationModal());
        this.dom.confirmActionBtn?.addEventListener('click', () => this.executeClearCart());

        // Scanner
        const btnScan = document.getElementById('pos-scan-btn');
        const btnCloseScan = document.getElementById('close-pos-scanner');
        if (btnScan) btnScan.addEventListener('click', () => this.startScanner());
        if (btnCloseScan) btnCloseScan.addEventListener('click', () => this.stopScanner());

        // Global Shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Check if payment/receipt modal is open
                if (this.dom.paymentModal && !this.dom.paymentModal.classList.contains('hidden')) {
                    // If receipt content is visible, use hideReceipt to reset state properly
                    if (this.dom.receiptModalContent && !this.dom.receiptModalContent.classList.contains('hidden')) {
                        this.hideReceipt();
                    } else {
                        // Otherwise it's the payment form
                        this.hidePaymentModal();
                    }
                }
            }
        });
    }
    async startScanner() {
        const modal = document.getElementById('pos-scanner-modal');
        const readerElement = document.getElementById('pos-reader');
        if (!modal || !readerElement) return;

        modal.classList.remove('hidden');

        if (typeof Html5Qrcode === 'undefined') {
            alert('Error: Librería de escáner no cargada.');
            return;
        }

        try {
            if (this.html5QrCode) {
                await this.html5QrCode.stop().catch(err => console.log(err));
            }

            this.html5QrCode = new Html5Qrcode("pos-reader");
            const config = { fps: 10, qrbox: { width: 250, height: 250 } };

            await this.html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => this.handleScan(decodedText),
                (errorMessage) => { /* ignore */ }
            );
        } catch (err) {
            console.error('Error starting scanner', err);
            alert('No se pudo iniciar la cámara. Si estás en un móvil, usa HTTPS o localhost. Los navegadores bloquean la cámara en conexiones inseguras.');
            modal.classList.add('hidden');
        }
    }

    async stopScanner() {
        if (this.html5QrCode) {
            try {
                await this.html5QrCode.stop();
                this.html5QrCode = null;
            } catch (err) {
                console.error('Failed to stop scanner', err);
            }
        }
        const modal = document.getElementById('pos-scanner-modal');
        if (modal) modal.classList.add('hidden');
    }

    handleScan(barcode) {
        const product = this.products.find(p => p.barcode === barcode);

        if (product) {
            this.addToCart(product);
            const feedback = document.getElementById('scan-feedback');
            if (feedback) {
                feedback.classList.remove('opacity-0');
                setTimeout(() => feedback.classList.add('opacity-0'), 1500);
            }
        } else {
            alert(`Producto no encontrado: ${barcode}`);
        }
    }

    async loadSettings() {
        try {
            const [rateData, businessData, paymentMethods] = await Promise.all([
                api.settings.getRate(),
                api.settings.getBusinessInfo(),
                api.settings.getPaymentMethods()
            ]);
            this.exchangeRate = rateData.rate || 1.0;
            this.businessInfo = businessData || {};
            this.paymentMethods = paymentMethods || [];
        } catch (error) {
            console.error('Error loading settings', error);
        }
    }

    async loadProducts() {
        try {
            this.products = await api.products.getAll();
            this.currentFilteredProducts = this.products; // Initialize filtered list
            this.renderProducts(this.products);
        } catch (error) {
            ui.showNotification('Error loading products', 'error');
        }
    }

    async loadCustomers() {
        try {
            this.customers = await api.customers.getAll();
        } catch (error) {
            console.error('Error loading customers', error);
        }
    }

    renderProducts(products = null) {
        if (!this.dom.productGrid) return;

        // If new products list is passed, update filtered list and reset to page 1
        if (products) {
            this.currentFilteredProducts = products;
            this.currentPage = 1;
        }

        const totalItems = this.currentFilteredProducts.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage);

        // Ensure current page is valid
        if (this.currentPage < 1) this.currentPage = 1;
        if (this.currentPage > totalPages && totalPages > 0) this.currentPage = totalPages;

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const productsToShow = this.currentFilteredProducts.slice(startIndex, endIndex);

        // Render Products
        this.dom.productGrid.innerHTML = productsToShow.map(product => {
            const stock = parseInt(product.stock || 0);
            const isAvailable = stock > 0;
            const imageUri = product.imageUri || 'https://via.placeholder.com/150?text=No+Image';

            return `
                <div class="product-card bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group cursor-pointer ring-1 ring-slate-900/5 ${!isAvailable ? 'opacity-75' : ''}" data-id="${product.id}">
                    <div class="aspect-square overflow-hidden bg-gray-50 dark:bg-slate-700 relative">
                        <img src="${imageUri}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                        ${!isAvailable ? '<div class="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center"><span class="bg-red-500 text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm">AGOTADO</span></div>' : ''}
                    </div>
                    <div class="p-3 md:p-4">
                        <div class="mb-2 flex justify-between items-start">
                            <span class="text-xs text-slate-500 dark:text-slate-400 font-mono">#${product.id}</span>
                            ${isAvailable ? '<span class="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Disp</span>' : ''}
                        </div>
                        <h3 class="font-bold text-slate-800 dark:text-slate-100 mb-1 text-sm md:text-base line-clamp-4 leading-tight h-20">${product.name}</h3>
                        <div class="flex justify-between items-center mt-auto pt-2 border-t border-slate-100 dark:border-slate-700/50">
                            <span class="text-lg md:text-xl font-extrabold text-slate-900 dark:text-white">$${parseFloat(product.price).toFixed(2)}</span>
                            <button class="add-to-cart-btn w-8 h-8 md:w-10 md:h-10 bg-slate-900 dark:bg-blue-600 text-white rounded-full hover:bg-blue-600 dark:hover:bg-blue-500 hover:scale-110 transition-all flex items-center justify-center shadow-lg shadow-slate-900/20"
                                ${!isAvailable ? 'disabled' : ''}>
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Render Pagination Controls
        if (totalPages > 1) {
            const paginationHtml = `
                <div class="col-span-full flex justify-center items-center gap-4 mt-6 py-4">
                    <button id="prev-page-btn" class="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" ${this.currentPage === 1 ? 'disabled' : ''}>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                        </svg>
                    </button>
                    <span class="text-slate-600 dark:text-slate-300 font-medium">
                        Página ${this.currentPage} de ${totalPages}
                    </span>
                    <button id="next-page-btn" class="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" ${this.currentPage === totalPages ? 'disabled' : ''}>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </button>
                </div>
            `;
            this.dom.productGrid.insertAdjacentHTML('beforeend', paginationHtml);

            // Bind Pagination Events
            document.getElementById('prev-page-btn')?.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent grid click
                this.changePage(this.currentPage - 1);
            });
            document.getElementById('next-page-btn')?.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent grid click
                this.changePage(this.currentPage + 1);
            });
        }
    }

    changePage(newPage) {
        this.currentPage = newPage;
        this.renderProducts(); // Re-render with current filtered list
        // Scroll to top of grid
        this.dom.productGrid.parentElement.scrollTop = 0;
    }

    renderCategories() {
        if (!this.dom.categoryFilters) return;

        const categories = ['Todas', ...new Set(this.products.map(p => p.category || 'Sin Categoría'))].filter(Boolean);

        this.dom.categoryFilters.innerHTML = categories.map(cat => `
            <button class="category-btn px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${cat === 'Todas' ? 'bg-slate-900 text-white dark:bg-blue-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}"
                data-category="${cat}">
                ${cat}
            </button>
        `).join('');

        this.dom.categoryFilters.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.target.dataset.category;
                this.filterByCategory(category);

                this.dom.categoryFilters.querySelectorAll('.category-btn').forEach(b => {
                    b.className = `category-btn px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${b.dataset.category === category
                        ? 'bg-slate-900 text-white dark:bg-blue-600'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`;
                });
            });
        });
    }

    filterByCategory(category) {
        if (category === 'Todas') {
            this.renderProducts(this.products);
        } else {
            const filtered = this.products.filter(p => (p.category || 'Sin Categoría') === category);
            this.renderProducts(filtered);
        }
    }

    filterProducts(query) {
        const filtered = this.products.filter(p =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.description?.toLowerCase().includes(query.toLowerCase())
        );
        this.renderProducts(filtered);
    }

    handleGridClick(e) {
        const card = e.target.closest('.product-card');
        if (!card) return;

        const id = card.dataset.id;
        const product = this.products.find(p => String(p.id) === String(id));

        if (product && product.stock > 0) {
            this.addToCart(product);
        }
    }

    addToCart(productOrId) {
        let product = productOrId;
        if (typeof productOrId === 'string' || typeof productOrId === 'number') {
            product = this.products.find(p => String(p.id) === String(productOrId));
        }

        if (!product) {
            console.error('Product not found for cart addition:', productOrId);
            return;
        }

        const existingItem = this.cart.find(item => item.id === product.id);
        if (existingItem) {
            if (existingItem.quantity < product.stock) {
                existingItem.quantity++;
            } else {
                ui.showNotification(`Stock máximo alcanzado (${product.stock})`, 'warning');
            }
        } else {
            this.cart.push({ ...product, quantity: 1 });
        }
        this.renderCart();
    }

    handleCartClick(e) {
        const btn = e.target.closest('.increase-qty, .decrease-qty, .remove-item');
        if (!btn) return;

        const cartItem = btn.closest('.cart-item');
        if (!cartItem) return;

        const id = cartItem.dataset.id;
        const item = this.cart.find(i => String(i.id) === String(id));
        if (!item) return;

        if (btn.classList.contains('increase-qty')) {
            if (item.quantity < item.stock) {
                item.quantity++;
            } else {
                ui.showNotification(`Stock máximo alcanzado (${item.stock})`, 'warning');
            }
        } else if (btn.classList.contains('decrease-qty')) {
            if (item.quantity > 1) {
                item.quantity--;
            } else {
                this.cart = this.cart.filter(i => String(i.id) !== String(id));
            }
        } else if (btn.classList.contains('remove-item')) {
            this.cart = this.cart.filter(i => String(i.id) !== String(id));
        }

        this.renderCart();
    }

    handleCartInput(e) {
        if (!e.target.classList.contains('qty-input')) return;

        const cartItem = e.target.closest('.cart-item');
        if (!cartItem) return;

        const id = cartItem.dataset.id;
        const item = this.cart.find(i => String(i.id) === String(id));
        if (!item) return;

        let newQty = parseInt(e.target.value);

        if (isNaN(newQty) || newQty < 1) {
            newQty = 1;
        }

        if (newQty > item.stock) {
            newQty = item.stock;
            ui.showNotification(`Stock máximo alcanzado (${item.stock})`, 'warning');
        }

        item.quantity = newQty;
        this.renderCart();
    }

    renderCart() {
        this.dom.cartItems.innerHTML = this.cart.map(item => {
            const priceBs = (item.price * this.exchangeRate).toFixed(2);
            return `
                <div class="cart-item bg-white dark:bg-slate-800 p-3 rounded-lg border border-gray-100 dark:border-slate-700 flex flex-col gap-2 group" data-id="${item.id}">
                    <h4 class="font-medium text-gray-800 dark:text-slate-100 w-full border-b border-gray-100 dark:border-slate-700 pb-1 mb-1">${item.name}</h4>
                    <div class="flex justify-between items-center w-full">
                        <div class="flex items-center gap-3 flex-1">
                            <div class="h-12 w-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex-shrink-0">
                                <img src="${item.imageUri || 'assets/placeholder.png'}" alt="${item.name}" class="h-full w-full object-cover" onerror="this.src='https://via.placeholder.com/40'">
                            </div>
                            <div class="flex flex-col">
                                <div class="text-lg font-bold text-slate-900 dark:text-white">
                                    $${parseFloat(item.price).toFixed(2)}
                                </div>
                                <div class="text-lg font-bold text-slate-700 dark:text-slate-300">
                                    Bs ${priceBs}
                                </div>
                                <div class="text-xs text-slate-500 mt-1">x ${item.quantity}</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="flex items-center gap-1 bg-gray-50 dark:bg-slate-700 rounded-lg p-1">
                                <button class="decrease-qty w-7 h-7 flex items-center justify-center bg-white dark:bg-slate-600 rounded hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:text-slate-200 transition-colors">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                                    </svg>
                                </button>
                                <input type="number" value="${item.quantity}" min="1" max="${item.stock}" class="qty-input w-12 text-center font-medium text-sm bg-transparent dark:text-slate-200 border-none focus:ring-0 p-0 appearance-none">
                                <button class="increase-qty w-7 h-7 flex items-center justify-center bg-white dark:bg-slate-600 rounded hover:bg-green-50 dark:hover:bg-green-900/30 hover:text-green-600 dark:text-slate-200 transition-colors">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                                    </svg>
                                </button>
                            </div>
                            <button class="remove-item p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Eliminar">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('') || '<p class="text-gray-400 text-center py-8">Carrito vacío</p>';

        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalBs = total * this.exchangeRate;

        this.dom.cartTotal.textContent = formatCurrency(total);
        this.dom.cartTotalBs.textContent = `Bs ${totalBs.toFixed(2)}`;

        if (this.dom.checkoutBtn) {
            const isCartEmpty = this.cart.length === 0;

            // Checkout Button
            this.dom.checkoutBtn.disabled = isCartEmpty;
            if (isCartEmpty) {
                this.dom.checkoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                this.dom.checkoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }

            // Clear Cart Button
            if (this.dom.clearCartBtn) {
                this.dom.clearCartBtn.disabled = isCartEmpty;
                if (isCartEmpty) {
                    this.dom.clearCartBtn.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    this.dom.clearCartBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }
        }
    }

    checkHeldSale() {
        const heldCart = localStorage.getItem('held_cart');
        const btn = document.getElementById('hold-sale-btn');
        if (!btn) return;

        if (heldCart) {
            btn.classList.add('restore-mode', 'bg-yellow-500', 'text-white', 'hover:bg-yellow-600');
            btn.classList.remove('bg-yellow-100', 'text-yellow-600', 'hover:bg-yellow-200');
            btn.title = "Restaurar Venta en Espera";
            this.setButtonIcon(btn, 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15');
        } else {
            btn.classList.remove('restore-mode', 'bg-yellow-500', 'text-white', 'hover:bg-yellow-600');
            btn.classList.add('bg-yellow-100', 'text-yellow-600', 'hover:bg-yellow-200');
            btn.title = "Poner en Espera";
            this.setButtonIcon(btn, 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z');
        }
    }

    toggleHoldSale() {
        const heldCart = localStorage.getItem('held_cart');
        if (heldCart) {
            this.restoreSale();
        } else {
            this.holdSale();
        }
    }

    holdSale() {
        if (this.cart.length === 0) {
            ui.showNotification('El carrito está vacío', 'warning');
            return;
        }
        localStorage.setItem('held_cart', JSON.stringify(this.cart));
        this.cart = [];
        this.renderCart();
        this.checkHeldSale();
        ui.showNotification('Venta puesta en espera');
    }

    restoreSale() {
        const heldCart = localStorage.getItem('held_cart');
        if (!heldCart) return;

        if (this.cart.length > 0) {
            if (!confirm('Hay productos en el carrito actual. ¿Deseas reemplazarlos con la venta en espera?')) {
                return;
            }
        }

        try {
            this.cart = JSON.parse(heldCart);
            localStorage.removeItem('held_cart');
            this.renderCart();
            this.checkHeldSale();
            ui.showNotification('Venta restaurada');
        } catch (e) {
            console.error('Error restoring cart', e);
            ui.showNotification('Error al restaurar venta', 'error');
        }
    }

    clearCart(force = false) {
        console.log('clearCart called, force:', force, 'cart length:', this.cart.length);
        if (this.cart.length === 0) return;
        if (force) {
            this.executeClearCart();
        } else {
            this.showConfirmationModal();
        }
    }

    executeClearCart() {
        this.cart = [];
        this.renderCart();
        this.hideConfirmationModal();
        this.checkHeldSale();
        ui.showNotification('Carrito vaciado');
    }

    showConfirmationModal() {
        console.log('showConfirmationModal called');
        if (this.dom.confirmationModal) {
            this.dom.confirmationModal.classList.remove('hidden');
            this.dom.confirmationModal.style.display = 'flex'; // Ensure flex for centering

            // Debug info
            const rect = this.dom.confirmationModal.getBoundingClientRect();
            console.log('Modal Rect:', rect);
        } else {
            console.error('Confirmation modal element not found!');
            // Try to recreate if missing
            this.dom.confirmationModal = this.createConfirmationModal();
            this.bindEvents(); // Rebind events for new modal
            this.dom.confirmationModal.classList.remove('hidden');
            this.dom.confirmationModal.style.display = 'flex';
        }
    }

    hideConfirmationModal() {
        if (this.dom.confirmationModal) {
            this.dom.confirmationModal.classList.add('hidden');
            this.dom.confirmationModal.style.display = 'none';
        }
    }

    // --- CUSTOM ITEM LOGIC ---
    openCustomItemModal() {
        this.dom.customItemForm.reset();
        this.dom.customItemModal.classList.remove('hidden');
        this.dom.customItemName.focus();

        // Optional: Add auto-calculation listeners if desired, 
        // but for now we'll just let them be independent as requested.
    }

    closeCustomItemModal() {
        this.dom.customItemModal.classList.add('hidden');
    }

    handleCustomItemSubmit(e) {
        e.preventDefault();

        const name = this.dom.customItemName.value.trim();
        const priceUsd = parseFloat(this.dom.customItemPriceUsd.value);
        const priceBs = parseFloat(this.dom.customItemPriceBs.value);

        if (!name) {
            ui.showNotification('El nombre es requerido', 'warning');
            return;
        }

        let finalPriceUSD = 0;

        if (!isNaN(priceUsd) && priceUsd > 0) {
            finalPriceUSD = priceUsd;
        } else if (!isNaN(priceBs) && priceBs > 0) {
            if (this.exchangeRate <= 0) {
                ui.showNotification('Error: Tasa de cambio inválida', 'error');
                return;
            }
            finalPriceUSD = priceBs / this.exchangeRate;
        } else {
            ui.showNotification('Por favor ingresa un precio válido en USD o Bs', 'warning');
            return;
        }

        const customItem = {
            id: `custom-${Date.now()}`,
            name: name,
            price: finalPriceUSD,
            stock: 9999, // Unlimited stock for custom items
            isCustom: true,
            imageUri: 'assets/placeholder.png' // Or a specific icon for custom items
        };

        this.addToCart(customItem);
        this.closeCustomItemModal();
        ui.showNotification('Artículo agregado al carrito');
    }

    async showCustomerSelection() {
        await this.loadCustomers();
        if (!this.customers || this.customers.length === 0) {
            this.processCheckout(null);
            return;
        }
        this.renderCustomerList(this.customers);
        this.dom.customerSelectionModal?.classList.remove('hidden');
        setTimeout(() => this.dom.searchCustomerCheckout?.focus(), 100);
    }

    hideCustomerSelection() {
        this.dom.customerSelectionModal?.classList.add('hidden');
        if (this.dom.searchCustomerCheckout) this.dom.searchCustomerCheckout.value = '';
    }

    renderCustomerList(customers) {
        if (!this.dom.customerListCheckout) return;
        if (customers.length === 0) {
            this.dom.customerListCheckout.innerHTML = '<p class="text-gray-400 text-center py-4">No hay clientes</p>';
            return;
        }
        this.dom.customerListCheckout.innerHTML = customers.map(customer => `
            <div class="customer-item p-3 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors" data-id="${customer.id}">
                <div class="font-medium text-slate-800">${customer.name}</div>
                <div class="text-sm text-slate-500">${customer.phone}${customer.email ? ' • ' + customer.email : ''}</div>
            </div>
        `).join('');
    }

    filterCustomers(query) {
        const filtered = this.customers.filter(c =>
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.phone.includes(query)
        );
        this.renderCustomerList(filtered);
    }

    handleCustomerSelect(e) {
        const item = e.target.closest('.customer-item');
        if (!item) return;
        const customerId = item.dataset.id;
        const customer = this.customers.find(c => c.id === customerId);
        this.processCheckout(customer);
    }

    processCheckout(customer) {
        this.selectedCustomer = customer;
        this.hideCustomerSelection();
        this.showPaymentModal();
    }

    showPaymentModal() {
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalBs = total * this.exchangeRate;

        this.dom.paymentTotalUsd.textContent = `$${total.toFixed(2)} `;
        this.dom.paymentTotalVes.textContent = `Bs ${totalBs.toFixed(2)} `;

        this.populatePaymentMethods();

        this.dom.paymentFields.innerHTML = '';
        this.dom.paymentChange.textContent = 'Bs 0.00';
        this.dom.paymentModal?.classList.remove('hidden');
    }

    hidePaymentModal() {
        this.dom.paymentModal?.classList.add('hidden');
        if (this.dom.paymentFields) this.dom.paymentFields.innerHTML = '';
    }

    populatePaymentMethods() {
        if (!this.dom.paymentMethodSelect) return;
        this.dom.paymentMethodSelect.innerHTML = '';

        const hasCash = this.paymentMethods.some(m => m.id === 'cash');
        if (!hasCash) {
            this.paymentMethods.unshift({ id: 'cash', name: 'Efectivo (USD/VES)', requiresReference: false });
        }

        this.paymentMethods.forEach(method => {
            const option = document.createElement('option');
            option.value = method.id;
            option.textContent = method.name;
            this.dom.paymentMethodSelect.appendChild(option);
        });
        this.onPaymentMethodChange();
    }

    onPaymentMethodChange() {
        const methodId = this.dom.paymentMethodSelect.value;
        this.dom.paymentFields.innerHTML = '';

        if (methodId === 'cash') {
            this.dom.paymentFields.innerHTML = `
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Recibido USD</label>
                        <input type="number" id="payment-received-usd" class="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" step="0.01" min="0">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-700 mb-1">Recibido VES</label>
                        <input type="number" id="payment-received-ves" class="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" step="0.01" min="0">
                    </div>
                </div>
            `;
            this.dom.paymentReceivedUsd = document.getElementById('payment-received-usd');
            this.dom.paymentReceivedVes = document.getElementById('payment-received-ves');
            this.dom.paymentReceivedUsd?.addEventListener('input', () => this.calculateChange());
            this.dom.paymentReceivedVes?.addEventListener('input', () => this.calculateChange());
        } else {
            const method = this.paymentMethods.find(m => m.id === methodId);
            let fieldsHtml = `
                <div class="mb-4">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Monto</label>
                    <input type="number" id="payment-amount" class="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" step="0.01" min="0" value="${this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2)}">
                </div>
            `;
            if (method && method.requiresReference) {
                fieldsHtml += `
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-slate-700 mb-1">Referencia</label>
                        <input type="text" id="payment-reference" class="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                    </div>
                `;
            }
            this.dom.paymentFields.innerHTML = fieldsHtml;
            this.dom.paymentAmount = document.getElementById('payment-amount');
            this.dom.paymentReference = document.getElementById('payment-reference');
            this.dom.paymentAmount?.addEventListener('input', () => this.calculateChange());
        }
        this.calculateChange();
    }

    calculateChange() {
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalBs = total * this.exchangeRate;
        const method = this.dom.paymentMethodSelect?.value;
        let totalReceived = 0;

        if (method === 'cash') {
            const ves = parseFloat(this.dom.paymentReceivedVes?.value) || 0;
            const usd = parseFloat(this.dom.paymentReceivedUsd?.value) || 0;
            const usdToVes = usd * this.exchangeRate;
            totalReceived = ves + usdToVes;
        } else {
            const amount = parseFloat(this.dom.paymentAmount?.value) || 0;
            totalReceived = amount;
        }

        const change = totalReceived - totalBs;
        this.dom.paymentChange.textContent = `Bs ${change.toFixed(2)} `;

        if (this.dom.confirmPaymentBtn) {
            if (method === 'cash') {
                this.dom.confirmPaymentBtn.disabled = change < -0.01;
            } else {
                this.dom.confirmPaymentBtn.disabled = totalReceived <= 0;
            }
        }
    }

    async confirmPayment() {
        const methodId = this.dom.paymentMethodSelect.value;
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const sale = {
            items: this.cart,
            total: total,
            exchangeRate: this.exchangeRate,
            customer: this.selectedCustomer,
            paymentMethod: methodId,
            timestamp: new Date()
        };

        try {
            const result = await api.sales.create(sale);
            this.lastSale = { ...sale, id: result.id };
            this.lastSale = { ...sale, id: result.id };
            // Don't hide payment modal yet, switch to receipt view
            this.cart = [];
            this.renderCart();
            this.showReceipt();
            ui.showNotification('Venta procesada exitosamente');
        } catch (error) {
            console.error('Error creating sale:', error);
            ui.showNotification('Error al procesar la venta', 'error');
        }
    }

    showReceipt() {
        if (!this.lastSale || !this.dom.receiptContent) return;

        const totalBs = this.lastSale.total * this.lastSale.exchangeRate;
        const { name, address, phone, taxId, logoUrl } = this.businessInfo;

        this.dom.receiptContent.innerHTML = `
            <div class="text-center mb-6">
                ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="mx-auto h-16 object-contain mb-2">` : ''}
                <h2 class="text-xl font-bold text-slate-900 leading-tight">${name || 'American POS'}</h2>
                ${address ? `<p class="text-xs text-slate-500 mt-1">${address}</p>` : ''}
                ${phone ? `<p class="text-xs text-slate-500">Tel: ${phone}</p>` : ''}
                ${taxId ? `<p class="text-xs text-slate-500">RIF/NIT: ${taxId}</p>` : ''}
                <div class="mt-4 pt-2 border-t border-dashed border-slate-300">
                    <p class="text-sm font-bold text-slate-700 uppercase tracking-wide">Recibo de Venta</p>
                    <p class="text-xs text-slate-400 mt-1">${this.lastSale.timestamp.toLocaleString('es-VE')}</p>
                </div>
            </div>
            ${this.lastSale.customer ? `
                <div class="mb-4 pb-4 border-b border-slate-200">
                    <p class="text-sm font-medium text-slate-700">Cliente:</p>
                    <p class="text-base font-semibold text-slate-900">${this.lastSale.customer.name}</p>
                    <p class="text-sm text-slate-600">${this.lastSale.customer.phone}</p>
                    ${this.lastSale.customer.email ? `<p class="text-sm text-slate-600">${this.lastSale.customer.email}</p>` : ''}
                </div>
            ` : ''}
            <div class="mb-4">
                <p class="text-sm font-medium text-slate-700 mb-2">Productos:</p>
                ${this.lastSale.items.map(item => `
                    <div class="flex justify-between text-sm py-1">
                        <span class="text-slate-700">${item.name} x${item.quantity}</span>
                        <span class="font-medium text-slate-900">$${(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="border-t border-slate-200 pt-4">
                <div class="flex justify-between mb-2">
                    <span class="text-lg font-semibold text-slate-700">Total USD:</span>
                    <span class="text-2xl font-bold text-slate-900">$${this.lastSale.total.toFixed(2)}</span>
                </div>
                <div class="flex justify-between text-slate-600">
                    <span>Total BS (Ref):</span>
                    <span class="font-semibold">Bs ${totalBs.toFixed(2)}</span>
                </div>
            </div>
            <div class="mt-6 pt-4 border-t border-slate-200 text-center">
                <p class="text-xs text-slate-500">ID Venta: ${this.lastSale.id}</p>
                <p class="text-xs text-slate-400 mt-1">¡Gracias por su compra!</p>
            </div>
        `;

        if (this.dom.emailReceiptBtn) {
            this.dom.emailReceiptBtn.style.display = this.lastSale.customer?.email ? 'flex' : 'none';
        }

        // Toggle visibility
        // Hide all direct children of payment modal body except receipt content
        const modalBody = this.dom.paymentModal.querySelector('.p-6');
        Array.from(modalBody.children).forEach(child => {
            if (child.id === 'receipt-modal-content') {
                child.classList.remove('hidden');
            } else {
                child.classList.add('hidden');
            }
        });

        this.dom.paymentModal?.classList.remove('hidden');
    }

    hideReceipt() {
        this.dom.paymentModal?.classList.add('hidden');
        // Reset visibility for next time
        const modalBody = this.dom.paymentModal.querySelector('.p-6');
        Array.from(modalBody.children).forEach(child => {
            if (child.id === 'receipt-modal-content') {
                child.classList.add('hidden');
            } else {
                child.classList.remove('hidden');
            }
        });
    }

    async emailReceipt() {
        if (!this.lastSale || !this.lastSale.customer?.email) {
            ui.showNotification('El cliente no tiene email', 'warning');
            return;
        }

        this.dom.emailReceiptBtn.disabled = true;
        this.dom.emailReceiptBtn.textContent = 'Enviando...';

        try {
            await api.sales.emailReceipt(this.lastSale.id, this.lastSale.customer.email);
            ui.showNotification('Recibo enviado por email');
        } catch (error) {
            ui.showNotification('Error al enviar email', 'error');
        } finally {
            this.dom.emailReceiptBtn.disabled = false;
            this.dom.emailReceiptBtn.innerHTML = `
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                </svg>
                Enviar al correo del cliente
            `;
        }
    }

    printReceipt() {
        window.print();
    }

    setButtonIcon(button, dPath) {
        button.textContent = '';
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "w-6 h-6");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("viewBox", "0 0 24 24");

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("d", dPath);

        svg.appendChild(path);
        button.appendChild(svg);
    }
}
