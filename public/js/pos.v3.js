import { api } from './api.js';
import { ui } from './ui.js';
import { debounce } from './utils.js';

export class POS {
    constructor() {
        console.log('POS v192 LOADED - CACHE BUSTED');
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
        this.customerSearchHighlightIndex = -1; // Track highlighted result

        console.log('POS: Calling init()');
        this.init();
    }

    async init() {
        console.log('POS: init() started');
        window.pos = this;
        try {
            this.cacheDOM();
            console.log('POS: cacheDOM finished');

            this.showLoading(); // Show loading overlay

            this.bindEvents();
            console.log('POS: bindEvents finished');

            // Parallelize data loading
            console.time('POS Initialization');
            await Promise.all([
                this.loadSettings(),
                this.loadProducts(),
                this.loadCustomers()
            ]);
            console.timeEnd('POS Initialization');
            console.log('POS: Data loading finished');

            this.renderCategories();
            console.log('POS: renderCategories finished');

            this.checkHeldSale();
            this.renderCart();

            // Initial Focus
            if (this.dom.customerSearchInput) {
                this.dom.customerSearchInput.focus();
            }

            console.log('POS: init() completed successfully');
        } catch (error) {
            console.error('POS: Critical error during init:', error);
            ui.showNotification('Error crítico al iniciar POS: ' + error.message, 'error');
        } finally {
            this.hideLoading(); // Hide loading overlay
        }
    }

    showLoading() {
        const overlay = document.getElementById('pos-loading-overlay');
        if (overlay) overlay.classList.remove('hidden');
    }

    hideLoading() {
        const overlay = document.getElementById('pos-loading-overlay');
        if (overlay) overlay.classList.add('hidden');
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
            viewHeldSalesBtn: document.getElementById('view-held-sales-btn'),
            heldCountBadge: document.getElementById('held-count-badge'),
            heldSalesDrawer: document.getElementById('held-sales-drawer'),
            heldSalesList: document.getElementById('held-sales-list'),
            closeHeldDrawerBtn: document.getElementById('close-held-drawer-btn'),
            mobileCartCount: document.getElementById('mobile-cart-count'),
            mobileCartItems: document.getElementById('mobile-cart-items-container'),

            // Mobile Menu
            mobileMenuBtn: document.getElementById('mobile-menu-btn'),
            sidebar: document.getElementById('sidebar'),
            mobileOverlay: document.getElementById('mobile-overlay'),
            mobileCartBtn: document.getElementById('mobile-cart-btn'),
            cartSidebar: document.getElementById('cart-sidebar'),
            closeCartBtn: document.getElementById('close-cart-btn'),

            // Customer Modal
            customerSelectionModal: document.getElementById('customer-selection-modal'),
            customerListCheckout: document.getElementById('customer-list-checkout'),
            searchCustomerCheckout: document.getElementById('search-customer-checkout'),
            skipCustomerBtn: document.getElementById('skip-customer-btn'),
            closeCustomerSelection: document.getElementById('close-customer-selection'),

            // Receipt Modal Elements
            receiptModalContent: document.getElementById('receipt-modal-content'),
            paymentFormContent: document.getElementById('payment-form-content'),
            receiptContent: document.getElementById('receipt-content'),
            closeReceiptBtn: document.getElementById('close-receipt'),
            emailReceiptBtn: document.getElementById('email-receipt-btn'),
            printReceiptBtn: document.getElementById('print-receipt-btn'),

            // Payment Modal Elements
            paymentModal: document.getElementById('payment-modal'),
            cancelPaymentBtn: document.getElementById('cancel-payment-btn'),
            confirmPaymentBtn: document.getElementById('confirm-payment-btn'),
            paymentTotalUsd: document.getElementById('payment-total-usd'),
            paymentTotalVes: document.getElementById('payment-total-ves'),
            paymentReceivedUsd: document.getElementById('payment-received-usd'),
            paymentReceivedVes: document.getElementById('payment-received-ves'),
            paymentAmount: document.getElementById('payment-amount'),
            paymentMethodOptions: document.getElementById('payment-method-options'),
            paymentChange: document.getElementById('payment-change'),
            paymentFields: document.getElementById('payment-fields'),

            // Confirmation Modal
            confirmationModal: document.getElementById('confirmation-modal'),
            confirmModalTitle: document.getElementById('confirm-modal-title'),
            confirmModalMessage: document.getElementById('confirm-modal-message'),
            cancelConfirmBtn: document.getElementById('cancel-confirm-btn'),
            confirmActionBtn: document.getElementById('confirm-action-btn'),

            // Input Modal
            inputModal: document.getElementById('input-modal'),
            inputModalTitle: document.getElementById('input-modal-title'),
            selectedCustomerName: document.getElementById('selected-customer-name'),
            selectedCustomerDoc: document.getElementById('selected-customer-doc'),
            removeCustomerBtn: document.getElementById('remove-customer-btn'),
            customerSearchContainer: document.getElementById('customer-search-container'),
            customerSearchInput: document.getElementById('pos-customer-search'),
            customerSearchResults: document.getElementById('pos-customer-results'),
            posSelectedCustomer: document.getElementById('pos-selected-customer'),
        };
    }

    bindEvents() {
        if (this.eventsBound) return;
        this.eventsBound = true;

        try {
            // Payment
            if (this.dom.cancelPaymentBtn) this.dom.cancelPaymentBtn.addEventListener('click', () => this.hidePaymentModal());
            if (this.dom.confirmPaymentBtn) this.dom.confirmPaymentBtn.addEventListener('click', () => this.confirmPayment());

            // Header Total Clicks (Quick Fill)
            if (this.dom.paymentTotalUsd) {
                this.dom.paymentTotalUsd.addEventListener('click', () => {
                    const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                    if (this.selectedPaymentMethodId === 'cash') {
                        if (this.dom.paymentReceivedUsd) this.dom.paymentReceivedUsd.value = total.toFixed(2);
                        if (this.dom.paymentReceivedVes) this.dom.paymentReceivedVes.value = '';
                    } else {
                        if (this.dom.paymentAmount) this.dom.paymentAmount.value = total.toFixed(2);
                    }
                    this.calculateChange();
                });
            }



            // Search Input
            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', (e) => {
                    const query = e.target.value;
                    this.filterProducts(query);
                });
            }

            // Scanner
            const btnScan = document.getElementById('pos-scan-btn');
            const btnCloseScan = document.getElementById('close-pos-scanner');
            if (btnScan) btnScan.addEventListener('click', () => this.startScanner());
            if (btnCloseScan) btnCloseScan.addEventListener('click', () => this.stopScanner());

            // Mobile Cart Toggles
            if (this.dom.mobileCartBtn) {
                this.dom.mobileCartBtn.addEventListener('click', () => {
                    if (this.dom.cartSidebar) {
                        this.dom.cartSidebar.classList.remove('translate-x-full');
                        if (this.dom.mobileOverlay) this.dom.mobileOverlay.classList.remove('hidden');
                    }
                });
            }

            if (this.dom.closeCartBtn) {
                this.dom.closeCartBtn.addEventListener('click', () => {
                    if (this.dom.cartSidebar) {
                        this.dom.cartSidebar.classList.add('translate-x-full');
                        if (this.dom.mobileOverlay) this.dom.mobileOverlay.classList.add('hidden');
                    }
                });
            }

            // Mobile Overlay Click
            if (this.dom.mobileOverlay) {
                this.dom.mobileOverlay.addEventListener('click', () => {
                    // Close Cart
                    if (this.dom.cartSidebar) this.dom.cartSidebar.classList.add('translate-x-full');
                    // Close Sidebar
                    if (this.dom.sidebar) this.dom.sidebar.classList.add('-translate-x-full');

                    this.dom.mobileOverlay.classList.add('hidden');
                });
            }

            // Cart Actions
            if (this.dom.clearCartBtn) this.dom.clearCartBtn.addEventListener('click', () => this.clearCart());
            if (this.dom.holdSaleBtn) this.dom.holdSaleBtn.addEventListener('click', () => this.holdSale());
            if (this.dom.viewHeldSalesBtn) this.dom.viewHeldSalesBtn.addEventListener('click', () => this.showHeldSales());
            if (this.dom.checkoutBtn) this.dom.checkoutBtn.addEventListener('click', () => this.showPaymentModal());
            if (this.dom.closeHeldDrawerBtn) this.dom.closeHeldDrawerBtn.addEventListener('click', () => this.closeHeldSalesDrawer());

            // Cart Item Delegation (Remove, Increase, Decrease, Input)
            const handleCartAction = (e) => {
                const target = e.target;
                const cartItem = target.closest('.cart-item');
                if (!cartItem) return;
                const id = cartItem.dataset.id;

                // Remove Item
                if (target.closest('.remove-item')) {
                    this.removeFromCart(id);
                    return;
                }

                // Increase Qty
                if (target.closest('.increase-qty')) {
                    this.updateQuantity(id, 1);
                    return;
                }

                // Decrease Qty
                if (target.closest('.decrease-qty')) {
                    this.updateQuantity(id, -1);
                    return;
                }
            };

            const handleCartInput = (e) => {
                if (e.target.classList.contains('qty-input')) {
                    const cartItem = e.target.closest('.cart-item');
                    if (!cartItem) return;
                    const id = cartItem.dataset.id;
                    const newQty = parseFloat(e.target.value); // Use parseFloat
                    if (!isNaN(newQty) && newQty > 0) {
                        this.setQuantity(id, newQty);
                    }
                }
            };

            if (this.dom.cartItems) {
                this.dom.cartItems.addEventListener('click', handleCartAction);
                this.dom.cartItems.addEventListener('change', handleCartInput);
            }

            if (this.dom.mobileCartItems) {
                this.dom.mobileCartItems.addEventListener('click', handleCartAction);
                this.dom.mobileCartItems.addEventListener('change', handleCartInput);
            }

            // Held Sales List Delegation
            if (this.dom.heldSalesList) {
                this.dom.heldSalesList.addEventListener('click', (e) => {
                    const restoreBtn = e.target.closest('.restore-held-btn');
                    if (restoreBtn) {
                        this.restoreSale(restoreBtn.dataset.id);
                        return;
                    }

                    const deleteBtn = e.target.closest('.delete-held-btn');
                    if (deleteBtn) {
                        this.deleteHeldSale(deleteBtn.dataset.id);
                        return;
                    }
                });
            }

            // Customer Selection
            if (this.dom.skipCustomerBtn) this.dom.skipCustomerBtn.addEventListener('click', () => this.processCheckout(null));
            if (this.dom.closeCustomerSelection) this.dom.closeCustomerSelection.addEventListener('click', () => this.hideCustomerSelection());
            if (this.dom.searchCustomerCheckout) this.dom.searchCustomerCheckout.addEventListener('input', (e) => this.filterCustomers(e.target.value));
            if (this.dom.customerListCheckout) this.dom.customerListCheckout.addEventListener('click', (e) => this.handleCustomerSelect(e));

            // Receipt Actions
            if (this.dom.closeReceiptBtn) this.dom.closeReceiptBtn.addEventListener('click', () => this.hideReceipt());
            if (this.dom.emailReceiptBtn) this.dom.emailReceiptBtn.addEventListener('click', () => this.emailReceipt());
            if (this.dom.printReceiptBtn) this.dom.printReceiptBtn.addEventListener('click', () => this.printReceipt());

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
                    // Close search results if open
                    if (this.dom.customerSearchResults && !this.dom.customerSearchResults.classList.contains('hidden')) {
                        this.dom.customerSearchResults.classList.add('hidden');
                    }
                }
            });

            // New Customer Search Events
            if (this.dom.customerSearchInput) {
                this.dom.customerSearchInput.addEventListener('input', (e) => this.handleCustomerSearch(e.target.value));

                // Keyboard Navigation
                this.dom.customerSearchInput.addEventListener('keydown', (e) => {
                    const resultsContainer = this.dom.customerSearchResults;
                    if (resultsContainer.classList.contains('hidden')) return;

                    const items = resultsContainer.querySelectorAll('div[onclick]');
                    if (items.length === 0) return;

                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        this.customerSearchHighlightIndex++;
                        if (this.customerSearchHighlightIndex >= items.length) this.customerSearchHighlightIndex = 0;
                        this.updateCustomerSearchHighlight(items);
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        this.customerSearchHighlightIndex--;
                        if (this.customerSearchHighlightIndex < 0) this.customerSearchHighlightIndex = items.length - 1;
                        this.updateCustomerSearchHighlight(items);
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (this.customerSearchHighlightIndex >= 0 && this.customerSearchHighlightIndex < items.length) {
                            items[this.customerSearchHighlightIndex].click();
                        }
                    }
                });

                // Close results when clicking outside
                document.addEventListener('click', (e) => {
                    if (!this.dom.customerSearchContainer.contains(e.target)) {
                        this.dom.customerSearchResults.classList.add('hidden');
                    }
                });
            }

            if (this.dom.removeCustomerBtn) {
                this.dom.removeCustomerBtn.addEventListener('click', () => this.deselectCustomer());
            }

            // Product Grid Delegation
            if (this.dom.productGrid) {
                this.dom.productGrid.addEventListener('click', (e) => {
                    const card = e.target.closest('.product-card');
                    if (card) {
                        const id = card.dataset.id;
                        // Use loose equality for ID matching just in case
                        const product = this.products.find(p => p.id == id);

                        if (product) {
                            // Check stock if needed, though UI handles disabled state
                            if (parseInt(product.stock || 0) > 0) {
                                this.addToCart(product);
                            } else {
                                ui.showNotification('Producto agotado', 'warning');
                            }
                        }
                    }
                });
            }

            // Weight Modal Events
            if (this.dom.weightInput) this.dom.weightInput.addEventListener('input', () => this.calculateWeightValues('weight'));
            if (this.dom.weightPriceUsd) this.dom.weightPriceUsd.addEventListener('input', () => this.calculateWeightValues('usd'));
            if (this.dom.weightPriceBs) this.dom.weightPriceBs.addEventListener('input', () => this.calculateWeightValues('bs'));
            if (this.dom.cancelWeightBtn) this.dom.cancelWeightBtn.addEventListener('click', () => this.closeWeightModal());
            if (this.dom.cancelWeightBtnX) this.dom.cancelWeightBtnX.addEventListener('click', () => this.closeWeightModal());

            const weightForm = document.getElementById('weight-item-form');
            if (weightForm) {
                weightForm.addEventListener('submit', (e) => this.confirmWeightItem(e));
            }
        } catch (error) {
            console.error('Error binding events:', error);
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
            ui.showNotification(`Producto no encontrado: ${barcode}`, 'warning');
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
        // 1. Try to load from cache first
        const cachedProducts = localStorage.getItem('cached_products');
        if (cachedProducts) {
            try {
                this.products = JSON.parse(cachedProducts);
                this.renderCategories();
                this.renderProducts();
                console.log('POS: Loaded products from cache');
            } catch (e) {
                console.error('Error parsing cached products', e);
            }
        }

        // 2. Fetch fresh data in background (Stale-While-Revalidate)
        try {
            const freshProducts = await api.products.getAll();
            this.products = freshProducts;
            localStorage.setItem('cached_products', JSON.stringify(freshProducts));
            this.renderCategories();
            this.renderProducts();
            console.log('POS: Updated products from API');
        } catch (error) {
            console.error('Error loading products', error);
            if (!this.products.length) {
                ui.showNotification('Error al cargar productos', 'error');
            }
        }
    }

    async loadCustomers() {
        console.log('POS: Loading customers...');
        // 1. Try to load from cache first
        const cachedCustomers = localStorage.getItem('cached_customers');
        if (cachedCustomers) {
            try {
                this.customers = JSON.parse(cachedCustomers);
                console.log('POS: Loaded customers from cache. Count:', this.customers.length);
            } catch (e) {
                console.error('Error parsing cached customers', e);
            }
        }

        // 2. Fetch fresh data in background
        try {
            console.log('POS: Fetching fresh customers from API...');
            const freshCustomers = await api.customers.getAll();
            console.log('POS: API Response:', freshCustomers);

            if (Array.isArray(freshCustomers)) {
                this.customers = freshCustomers;
                localStorage.setItem('cached_customers', JSON.stringify(freshCustomers));
                console.log('POS: Updated customers from API. Count:', this.customers.length);

                // If modal is open, refresh list
                if (this.dom.customerSelectionModal && !this.dom.customerSelectionModal.classList.contains('hidden')) {
                    this.renderCustomerList(this.customers);
                }
            } else {
                console.error('POS: API returned non-array for customers:', freshCustomers);
            }
        } catch (error) {
            console.error('Error loading customers:', error);
            if (!this.customers || this.customers.length === 0) {
                ui.showNotification('Error al cargar clientes', 'error');
            }
        }
    }

    renderProducts(products = null) {
        this.currentFilteredProducts = products || this.products;

        const totalPages = Math.ceil(this.currentFilteredProducts.length / this.itemsPerPage);

        if (this.currentPage > totalPages) this.currentPage = 1;

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const productsToShow = this.currentFilteredProducts.slice(startIndex, endIndex);

        if (!this.dom.productGrid) {
            console.error('CRITICAL ERROR: product-grid element not found!');
            return;
        }

        // Reset styles
        this.dom.productGrid.style.display = '';
        this.dom.productGrid.style.minHeight = '';
        this.dom.productGrid.style.border = '';
        this.dom.productGrid.style.opacity = '';
        this.dom.productGrid.style.visibility = '';

        // Render Products
        this.dom.productGrid.innerHTML = productsToShow.map(product => {
            const stock = parseInt(product.stock || 0);
            const isAvailable = stock > 0;
            const imageUri = product.imageUri || 'https://via.placeholder.com/150?text=No+Image';

            let availabilityBadge = '';
            if (!isAvailable) {
                availabilityBadge = '<div class="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center"><span class="bg-red-500 text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm">AGOTADO</span></div>';
            }

            let dispBadge = '';
            if (isAvailable) {
                dispBadge = '<span class="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Disp</span>';
            }

            return `
                <div class="product-card bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group cursor-pointer ring-1 ring-slate-900/5 ${!isAvailable ? 'opacity-75' : ''}" data-id="${product.id}">
                    <div class="aspect-square overflow-hidden bg-gray-50 dark:bg-slate-700 relative">
                        <img src="${imageUri}" alt="${product.name}" loading="lazy" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                        ${availabilityBadge}
                    </div>
                    <div class="p-3 md:p-4">
                        <div class="mb-2 flex justify-between items-start">
                            <span class="text-xs text-slate-500 dark:text-slate-400 font-mono">#${product.id}</span>
                            ${dispBadge}
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
            const prevBtn = document.getElementById('prev-page-btn');
            if (prevBtn) {
                prevBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent grid click
                    this.changePage(this.currentPage - 1);
                });
            }
            const nextBtn = document.getElementById('next-page-btn');
            if (nextBtn) {
                nextBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent grid click
                    this.changePage(this.currentPage + 1);
                });
            }
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

        // Clear existing
        this.dom.categoryFilters.innerHTML = '';

        // Get unique categories and sort them
        const rawCategories = this.products.map(p => p.category || 'Sin Categoría');
        const uniqueCategories = [...new Set(rawCategories)].sort();
        const categories = ['Todas', ...uniqueCategories];

        // Helper to get count
        const getCount = (cat) => cat === 'Todas' ? this.products.length : this.products.filter(p => (p.category || 'Sin Categoría') === cat).length;

        categories.forEach(cat => {
            const count = getCount(cat);
            const label = cat === 'Todas' ? 'Todas' : (cat.charAt(0).toUpperCase() + cat.slice(1));

            const btn = document.createElement('button');
            const isSelected = false; // Default to false, will be updated by click or init? 
            // Actually we need to track selected category. Default is 'Todas'.
            // But for now let's just render.

            // Initial class
            const baseClass = "category-btn px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2";
            const activeClass = "bg-slate-900 text-white dark:bg-blue-600";
            const inactiveClass = "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";

            btn.className = `${baseClass} ${cat === 'Todas' ? activeClass : inactiveClass}`;
            btn.dataset.category = cat;

            btn.innerHTML = `
                <span>${label}</span>
                <span class="bg-white/20 px-1.5 py-0.5 rounded-full text-xs opacity-80">${count}</span>
            `;

            btn.addEventListener('click', () => {
                this.filterByCategory(cat);

                // Update classes
                this.dom.categoryFilters.querySelectorAll('.category-btn').forEach(b => {
                    const bCat = b.dataset.category;
                    b.className = `${baseClass} ${bCat === cat ? activeClass : inactiveClass}`;
                });
            });

            this.dom.categoryFilters.appendChild(btn);
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
            (p.description && p.description.toLowerCase().includes(query.toLowerCase()))
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

    addToCart(productOrId, quantity = 1) {
        let product = productOrId;
        if (typeof productOrId === 'string' || typeof productOrId === 'number') {
            product = this.products.find(p => String(p.id) === String(productOrId));
        }

        if (!product) {
            console.error('Product not found for cart addition:', productOrId);
            ui.showNotification('Error: Producto no encontrado para agregar al carrito', 'error');
            return;
        }

        // Check for weighted product
        // Assuming 'isWeighted' property or 'measurement' === 'kg'
        const isWeighted = product.isWeighted || product.measurement === 'kg';

        // If it's weighted and no specific quantity was passed (meaning it came from a click), open modal
        if (isWeighted && quantity === 1 && arguments.length === 1) {
            this.openWeightModal(product);
            return;
        }

        const existingItem = this.cart.find(item => item.id === product.id);
        if (existingItem) {
            const newQty = existingItem.quantity + quantity;
            if (newQty <= product.stock) {
                existingItem.quantity = newQty;
            } else {
                ui.showNotification(`Stock máximo alcanzado (${product.stock})`, 'warning');
            }
        } else {
            this.cart.push({ ...product, quantity: quantity });
        }
        this.renderCart();
    }

    renderCart() {
        // Calculate Totals
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalBs = total * this.exchangeRate;
        const itemCount = this.cart.reduce((sum, item) => sum + item.quantity, 0);

        // Update UI Totals
        if (this.dom.cartTotal) this.dom.cartTotal.textContent = `$${total.toFixed(2)} `;
        if (this.dom.cartTotalBs) this.dom.cartTotalBs.textContent = `Bs ${totalBs.toFixed(2)} `;
        if (this.dom.mobileCartCount) this.dom.mobileCartCount.textContent = itemCount;

        // Render Desktop Cart
        if (this.dom.cartItems) {
            if (this.cart.length === 0) {
                this.dom.cartItems.innerHTML = '<div class="text-center text-slate-400 py-8">Carrito vacío</div>';
            } else {
                this.dom.cartItems.innerHTML = this.cart.map(item => this.renderCartItem(item)).join('');
            }
        }

        // Render Mobile Cart
        if (this.dom.mobileCartItems) {
            if (this.cart.length === 0) {
                this.dom.mobileCartItems.innerHTML = '<div class="text-center text-slate-400 py-8">Carrito vacío</div>';
            } else {
                this.dom.mobileCartItems.innerHTML = this.cart.map(item => this.renderCartItem(item)).join('');
            }
        } else {
            // Try to find it again dynamically
            const mobileContainer = document.getElementById('mobile-cart-items-container');
            if (mobileContainer) {
                this.dom.mobileCartItems = mobileContainer;
                this.dom.mobileCartItems.innerHTML = this.cart.map(item => this.renderCartItem(item)).join('');
            }
        }

        // Update Button States
        const isCartEmpty = this.cart.length === 0;
        if (this.dom.checkoutBtn) {
            this.dom.checkoutBtn.disabled = isCartEmpty;
            if (isCartEmpty) {
                this.dom.checkoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                this.dom.checkoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
        if (this.dom.clearCartBtn) {
            this.dom.clearCartBtn.disabled = isCartEmpty;
            if (isCartEmpty) {
                this.dom.clearCartBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                this.dom.clearCartBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }

        // Update Mobile Cart Button Badge visibility
        if (this.dom.mobileCartCount) {
            if (itemCount > 0) {
                this.dom.mobileCartCount.classList.remove('hidden');
            } else {
                this.dom.mobileCartCount.classList.add('hidden');
            }
        }
    }


    renderCartItem(item) {
        const isWeighted = item.isWeighted || item.measurement === 'kg';
        const step = isWeighted ? '0.001' : '1';
        const quantityDisplay = isWeighted ? parseFloat(item.quantity).toFixed(3) : item.quantity;
        const weightTag = isWeighted ? '<span class="text-xs bg-blue-100 text-blue-800 px-1 rounded ml-1">Peso</span>' : '';

        return `
                    <div class="cart-item flex justify-between items-center p-3 mb-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500 transition-colors" data-id="${item.id}">
                    <div class="flex-1">
                        <div class="flex items-center">
                            <h4 class="font-medium text-slate-900 dark:text-white">${item.name}</h4>
                            ${weightTag}
                        </div>
                        <div class="text-sm text-slate-500 dark:text-slate-400">
                            $${parseFloat(item.price).toFixed(2)} x 
                            <input type="number" class="qty-input w-16 px-1 py-0.5 text-center border rounded mx-1 bg-white dark:bg-slate-600 dark:text-white" 
                                value="${quantityDisplay}" step="${step}" min="${step}">
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-slate-900 dark:text-white">$${(item.price * item.quantity).toFixed(2)}</p>
                        <div class="flex items-center justify-end gap-1 mt-1">
                            <button class="decrease-qty p-1 text-slate-400 hover:text-red-500 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path></svg>
                            </button>
                            <button class="increase-qty p-1 text-slate-400 hover:text-green-500 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            </button>
                            <button class="remove-item p-1 text-slate-400 hover:text-red-500 transition-colors ml-1">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                </div >
                    `;
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
                ui.showNotification(`Stock máximo alcanzado(${item.stock})`, 'warning');
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

        let newQty = parseFloat(e.target.value);

        if (isNaN(newQty) || newQty < 1) {
            newQty = 1;
        }

        if (newQty > item.stock) {
            newQty = item.stock;
            ui.showNotification(`Stock máximo alcanzado(${item.stock})`, 'warning');
        }

        item.quantity = newQty;
        this.renderCart();
    }

    checkHeldSale() {
        this.updateHeldSalesCount();
    }

    updateHeldSalesCount() {
        const heldSales = JSON.parse(localStorage.getItem('held_sales') || '[]');
        const count = heldSales.length;

        if (this.dom.heldCountBadge) {
            this.dom.heldCountBadge.textContent = count;
            if (count > 0) {
                this.dom.heldCountBadge.classList.remove('hidden');
            } else {
                this.dom.heldCountBadge.classList.add('hidden');
            }
        }
    }

    initiateHoldSale() {
        if (this.cart.length === 0) {
            ui.showNotification('El carrito está vacío', 'warning');
            return;
        }

        // Always prompt for customer as requested
        this.showConfirmationModal(
            '¿Asignar Cliente?',
            '¿Desea asignar un cliente a esta venta en espera? Si selecciona "No", se guardará como anónima.',
            () => {
                this.pendingHold = true;
                this.showCustomerSelection();
            },
            'Sí, Asignar',
            () => {
                this.holdSale();
            },
            'No, Guardar Anónima'
        );
    }

    holdSale() {
        if (this.cart.length === 0) {
            ui.showNotification('El carrito está vacío', 'warning');
            return;
        }

        console.log('DEBUG: holdSale called');

        const heldSales = JSON.parse(localStorage.getItem('held_sales') || '[]');
        let existingSaleIndex = -1;

        // If we have a customer, check if they already have a held sale
        if (this.selectedCustomer) {
            existingSaleIndex = heldSales.findIndex(s => s.customer && s.customer.id === this.selectedCustomer.id);
        }

        if (existingSaleIndex !== -1) {
            // Merge with existing sale
            const existingSale = heldSales[existingSaleIndex];

            this.cart.forEach(cartItem => {
                const existingItem = existingSale.items.find(i => i.id === cartItem.id);
                if (existingItem) {
                    existingItem.quantity += cartItem.quantity;
                } else {
                    existingSale.items.push(cartItem);
                }
            });

            // Recalculate total
            existingSale.total = existingSale.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            ui.showNotification(`Venta actualizada para ${this.selectedCustomer.name} `, 'success');
        } else {
            // Create new held sale
            // Helper to save sale
            const saveSale = (customer) => {
                const sale = {
                    id: Date.now().toString(),
                    items: [...this.cart],
                    customer: customer,
                    total: this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
                    timestamp: new Date().toISOString()
                };
                heldSales.push(sale);
                localStorage.setItem('held_sales', JSON.stringify(heldSales));
                this.cart = [];
                this.selectedCustomer = null;
                this.renderCart();
                this.updateHeldSalesCount();
                this.closeHeldSalesDrawer();
                ui.showNotification('Venta puesta en espera', 'success');
            };

            // If no customer selected, ask for a reference name
            if (!this.selectedCustomer) {
                this.showInputModal(
                    'Referencia de Venta',
                    'Ingrese un nombre de referencia para esta venta (Opcional):',
                    (value) => {
                        let customer = null;
                        if (value && value.trim()) {
                            customer = { id: 'ref-' + Date.now(), name: value.trim(), email: '', phone: '' };
                        }
                        saveSale(customer);
                    },
                    'Ej. Mesa 5, Juan...'
                );
                return; // Wait for modal callback
            } else {
                saveSale(this.selectedCustomer);
            }
        }

        localStorage.setItem('held_sales', JSON.stringify(heldSales));
        this.cart = [];
        this.selectedCustomer = null;
        this.renderCart();
        this.updateHeldSalesCount();
        this.closeHeldSalesDrawer();
    }

    showHeldSales() {
        const heldSales = JSON.parse(localStorage.getItem('held_sales') || '[]');
        this.renderHeldSalesList(heldSales);
        if (this.dom.heldSalesDrawer) {
            this.dom.heldSalesDrawer.classList.remove('translate-x-full');
            if (this.dom.mobileOverlay) this.dom.mobileOverlay.classList.remove('hidden');
        }
    }


    closeHeldSalesDrawer() {
        if (this.dom.heldSalesDrawer) {
            this.dom.heldSalesDrawer.classList.add('translate-x-full');
            if (this.dom.mobileOverlay) this.dom.mobileOverlay.classList.add('hidden');
        }
    }

    renderHeldSalesList(heldSales) {
        if (!this.dom.heldSalesList) return;

        if (heldSales.length === 0) {
            this.dom.heldSalesList.innerHTML = '<p class="text-center text-slate-400 py-8">No hay ventas en espera</p>';
            return;
        }

        this.dom.heldSalesList.innerHTML = heldSales.map(sale => {
            const date = new Date(sale.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString();
            const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            const customerName = sale.customer
                ? `<div class="text-sm font-bold text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                ${sale.customer.name}
               </div>`
                : `<div class="text-sm font-medium text-slate-400 dark:text-slate-500 mb-1 italic">Sin cliente asignado</div>`;

            return `
                    <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-yellow-400 dark:hover:border-yellow-500/50 transition-colors group mb-3">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        ${customerName}
                        <p class="font-bold text-slate-800 dark:text-white text-lg">$${sale.total.toFixed(2)}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">${dateStr} - ${timeStr}</p>
                    </div>
                    <span class="bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs px-2 py-1 rounded-lg font-medium">
                        ${itemCount} items
                    </span>
                </div>
                <div class="flex gap-2 mt-3">
                    <button class="restore-held-btn flex-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 dark:hover:bg-yellow-900/50 py-2 px-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1" data-id="${sale.id}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        Recuperar
                    </button>
                    <button class="delete-held-btn bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 p-2 rounded-lg transition-colors" data-id="${sale.id}" title="Eliminar">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div >
                    `;
        }).join('');


    }

    restoreSale(id) {
        const heldSales = JSON.parse(localStorage.getItem('held_sales') || '[]');
        const saleIndex = heldSales.findIndex(s => s.id === id);

        if (saleIndex === -1) return;

        const sale = heldSales[saleIndex];

        const doRestore = () => {
            this.cart = sale.items;
            this.selectedCustomer = sale.customer;

            // Remove from held sales
            heldSales.splice(saleIndex, 1);
            localStorage.setItem('held_sales', JSON.stringify(heldSales));

            this.renderCart();
            this.updateHeldSalesCount();
            this.closeHeldSalesDrawer();
            ui.showNotification('Venta recuperada', 'success');
        };

        // Confirm if cart is not empty
        if (this.cart.length > 0) {
            this.showConfirmationModal(
                '¿Reemplazar carrito?',
                'Hay productos en el carrito actual. ¿Desea reemplazarlos por la venta en espera?',
                () => doRestore(),
                'Sí, Reemplazar'
            );
        } else {
            doRestore();
        }
    }

    deleteHeldSale(id) {
        this.showConfirmationModal(
            '¿Eliminar venta en espera?',
            '¿Está seguro de eliminar esta venta en espera? Esta acción no se puede deshacer.',
            () => {
                const heldSales = JSON.parse(localStorage.getItem('held_sales') || '[]');
                const newHeldSales = heldSales.filter(s => s.id !== id);

                localStorage.setItem('held_sales', JSON.stringify(newHeldSales));

                this.renderHeldSalesList(newHeldSales);
                this.updateHeldSalesCount();
                ui.showNotification('Venta eliminada', 'success');
            },
            'Sí, Eliminar'
        );
    }

    openHeldSalesDrawer() {
        const heldSales = JSON.parse(localStorage.getItem('held_sales') || '[]');

        if (heldSales.length === 0) {
            ui.showNotification('No hay ventas en espera', 'info');
            return;
        }

        this.renderHeldSalesList(heldSales);
        this.dom.heldSalesDrawer.classList.remove('translate-x-full');
    }



    renderHeldSalesList(heldSales) {
        if (!this.dom.heldSalesList) return;

        this.dom.heldSalesList.innerHTML = heldSales.map(sale => {
            const date = new Date(sale.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString();
            const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            const customerName = sale.customer
                ? `<div class="text-sm font-bold text-blue-600 dark:text-blue-400 mb-1 flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                ${sale.customer.name}
               </div>`
                : `<div class="text-sm font-medium text-slate-400 dark:text-slate-500 mb-1 italic">Sin cliente asignado</div>`;

            return `
                    <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-yellow-400 dark:hover:border-yellow-500/50 transition-colors group">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        ${customerName}
                        <p class="font-bold text-slate-800 dark:text-white text-lg">$${sale.total.toFixed(2)}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">${dateStr} - ${timeStr}</p>
                    </div>
                    <span class="bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs px-2 py-1 rounded-lg font-medium">
                        ${itemCount} items
                    </span>
                </div>
                <div class="flex gap-2 mt-3">
                    <button class="restore-held-btn flex-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 dark:hover:bg-yellow-900/50 py-2 px-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1" data-id="${sale.id}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        Recuperar
                    </button>
                    <button class="delete-held-btn bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 p-2 rounded-lg transition-colors" data-id="${sale.id}" title="Eliminar">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div >
                    `;
        }).join('');

        // Add listeners to new buttons
        this.dom.heldSalesList.querySelectorAll('.restore-held-btn').forEach(btn => {
            btn.addEventListener('click', () => this.restoreSale(btn.dataset.id));
        });
        this.dom.heldSalesList.querySelectorAll('.delete-held-btn').forEach(btn => {
            btn.addEventListener('click', () => this.deleteHeldSale(btn.dataset.id));
        });
    }

    async showCustomerSelection() {
        await this.loadCustomers();
        if (!this.customers || this.customers.length === 0) {
            this.processCheckout(null);
            return;
        }
        this.renderCustomerList(this.customers);
        if (this.dom.customerSelectionModal) this.dom.customerSelectionModal.classList.remove('hidden');
        setTimeout(() => {
            if (this.dom.searchCustomerCheckout) this.dom.searchCustomerCheckout.focus();
        }, 100);
    }

    hideCustomerSelection() {
        if (this.dom.customerSelectionModal) this.dom.customerSelectionModal.classList.add('hidden');
        if (this.dom.searchCustomerCheckout) this.dom.searchCustomerCheckout.value = '';
    }

    renderCustomerList(customers) {
        console.log('Rendering customer list:', customers ? customers.length : 'null');
        if (!this.dom.customerListCheckout) {
            console.error('Customer list container not found!');
            return;
        }
        if (!customers || customers.length === 0) {
            this.dom.customerListCheckout.innerHTML = '<p class="text-gray-400 text-center py-4">No hay clientes</p>';
            return;
        }
        this.dom.customerListCheckout.innerHTML = customers.map(customer => `
            <div class="customer-item p-3 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors bg-white dark:bg-slate-800" data-id="${customer.id}">
                <div class="font-medium text-slate-800 dark:text-white">${customer.name}</div>
                <div class="text-sm text-slate-500 dark:text-slate-400">
                    ${customer.idDocument ? `<span class="mr-2 font-mono bg-slate-100 dark:bg-slate-900 px-1 rounded text-xs">${customer.idDocument}</span>` : ''}
                    ${customer.phone}
                    ${customer.email ? ' • ' + customer.email : ''}
                </div>
            </div>
        `).join('');
    }

    filterCustomers(query) {
        console.log('Filtering customers with query:', query);
        if (!this.customers) {
            console.error('this.customers is undefined or null');
            return;
        }

        if (!query) {
            this.renderCustomerList(this.customers);
            return;
        }
        const lowerQuery = query.toLowerCase();
        const filtered = this.customers.filter(c =>
            (c.name && c.name.toLowerCase().includes(lowerQuery)) ||
            (c.phone && c.phone.includes(query)) ||
            (c.email && c.email.toLowerCase().includes(lowerQuery)) ||
            (c.idDocument && c.idDocument.toLowerCase().includes(lowerQuery))
        );
        console.log('Filtered count:', filtered.length);
        this.renderCustomerList(filtered);
    }
    handleCustomerSelect(e) {
        const item = e.target.closest('.customer-item');
        if (!item) return;
        const id = item.dataset.id;
        const customer = this.customers.find(c => String(c.id) === String(id));
        if (customer) {
            this.selectedCustomer = customer;
            this.hideCustomerSelection();
            if (this.pendingHold) {
                this.holdSale();
                this.pendingHold = false;
            }
        }
    }

    handleCustomerSearch(query) {
        if (!query) {
            if (this.dom.customerSearchResults) this.dom.customerSearchResults.classList.add('hidden');
            return;
        }

        const lowerQuery = query.toLowerCase();
        const filtered = this.customers.filter(c =>
            (c.name && c.name.toLowerCase().includes(lowerQuery)) ||
            (c.phone && c.phone.includes(query)) ||
            (c.email && c.email.toLowerCase().includes(lowerQuery)) ||
            (c.idDocument && c.idDocument.toLowerCase().includes(lowerQuery))
        );

        this.renderCustomerSearchResults(filtered);
    }

    renderCustomerSearchResults(customers) {
        if (!this.dom.customerSearchResults) return;

        if (customers.length === 0) {
            this.dom.customerSearchResults.innerHTML = '<div class="p-3 text-sm text-slate-500 text-center">No se encontraron clientes</div>';
            this.dom.customerSearchResults.classList.remove('hidden');
            return;
        }

        this.dom.customerSearchResults.innerHTML = customers.map((c, index) => `
            <div class="p-3 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-700 last:border-0"
                 onclick="window.app.views.pos.selectCustomerById('${c.id}')">
                <div class="font-bold text-slate-800 dark:text-white text-sm">${c.name}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 flex gap-2">
                    ${c.idDocument ? `<span>${c.idDocument}</span>` : ''}
                    ${c.phone ? `<span>${c.phone}</span>` : ''}
                </div>
            </div>
        `).join('');

        this.dom.customerSearchResults.classList.remove('hidden');
        this.customerSearchHighlightIndex = -1;
    }

    selectCustomerById(id) {
        const customer = this.customers.find(c => String(c.id) === String(id));
        if (customer) this.selectCustomer(customer);
    }

    selectCustomer(customer) {
        this.selectedCustomer = customer;

        // Update Sidebar UI
        if (this.dom.selectedCustomerName) this.dom.selectedCustomerName.textContent = customer.name;
        if (this.dom.selectedCustomerDoc) this.dom.selectedCustomerDoc.textContent = customer.idDocument || customer.phone || 'Sin ID';

        if (this.dom.customerSearchContainer) this.dom.customerSearchContainer.classList.add('hidden');
        if (this.dom.posSelectedCustomer) this.dom.posSelectedCustomer.classList.remove('hidden');
        if (this.dom.customerSearchResults) this.dom.customerSearchResults.classList.add('hidden');
        if (this.dom.customerSearchInput) this.dom.customerSearchInput.value = '';

        ui.showNotification(`Cliente seleccionado: ${customer.name}`, 'success');
    }

    deselectCustomer() {
        this.selectedCustomer = null;

        if (this.dom.customerSearchContainer) this.dom.customerSearchContainer.classList.remove('hidden');
        if (this.dom.posSelectedCustomer) this.dom.posSelectedCustomer.classList.add('hidden');
        if (this.dom.customerSearchInput) {
            this.dom.customerSearchInput.value = '';
            this.dom.customerSearchInput.focus();
        }
    }

    async refreshData() {
        // Only refresh if cache is missing (meaning it was invalidated by management views)
        if (!localStorage.getItem('cached_products') || !localStorage.getItem('cached_customers')) {
            console.log('POS: Cache invalidated, refreshing data...');
            await Promise.all([
                this.loadProducts(),
                this.loadCustomers()
            ]);
        }
    }

    showInputModal(title, message, onConfirm, placeholder = '') {
        if (this.dom.inputModal) {
            if (this.dom.inputModalTitle) this.dom.inputModalTitle.textContent = title;
            if (this.dom.inputModalMessage) this.dom.inputModalMessage.textContent = message;
            if (this.dom.inputModalValue) {
                this.dom.inputModalValue.value = '';
                this.dom.inputModalValue.placeholder = placeholder;
            }

            const confirmBtn = this.dom.confirmInputBtn;
            const cancelBtn = this.dom.cancelInputBtn;

            if (confirmBtn) {
                const newConfirmBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
                this.dom.confirmInputBtn = newConfirmBtn;

                newConfirmBtn.addEventListener('click', () => {
                    const value = this.dom.inputModalValue.value;
                    if (onConfirm) onConfirm(value);
                    this.hideInputModal();
                });
            }

            if (cancelBtn) {
                const newCancelBtn = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
                this.dom.cancelInputBtn = newCancelBtn;

                newCancelBtn.addEventListener('click', () => {
                    this.hideInputModal();
                });
            }

            // Allow Enter key to confirm
            if (this.dom.inputModalValue) {
                const input = this.dom.inputModalValue;
                const newInput = input.cloneNode(true);
                input.parentNode.replaceChild(newInput, input);
                this.dom.inputModalValue = newInput;

                newInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const value = this.dom.inputModalValue.value;
                        if (onConfirm) onConfirm(value);
                        this.hideInputModal();
                    }
                });
            }

            this.dom.inputModal.classList.remove('hidden');
            this.dom.inputModal.style.display = 'flex';
            setTimeout(() => {
                if (this.dom.inputModalValue) this.dom.inputModalValue.focus();
            }, 100);
        }
    }

    hideInputModal() {
        if (this.dom.inputModal) {
            this.dom.inputModal.classList.add('hidden');
            this.dom.inputModal.style.display = 'none';
        }
    }

    removeFromCart(id) {
        this.cart = this.cart.filter(item => item.id !== id);
        this.renderCart();
    }

    updateQuantity(id, change) {
        const item = this.cart.find(i => i.id === id);
        if (item) {
            const newQty = item.quantity + change;
            if (newQty > 0 && newQty <= item.stock) {
                item.quantity = newQty;
                this.renderCart();
            } else if (newQty > item.stock) {
                ui.showNotification(`Stock máximo alcanzado(${item.stock})`, 'warning');
            }
        }
    }

    setQuantity(id, qty) {
        const item = this.cart.find(i => i.id === id);
        if (item) {
            if (qty > 0 && qty <= item.stock) {
                item.quantity = qty;
                this.renderCart();
            } else if (qty > item.stock) {
                ui.showNotification(`Stock máximo alcanzado(${item.stock})`, 'warning');
                this.renderCart(); // Reset input
            }
        }
    }

    clearCart() {
        if (this.cart.length === 0) return;

        this.showConfirmationModal(
            '¿Vaciar Carrito?',
            '¿Estás seguro de que deseas eliminar todos los productos del carrito? Esta acción no se puede deshacer.',
            () => this.executeClearCart(),
            'Sí, Vaciar'
        );
    }

    executeClearCart() {
        this.cart = [];
        this.selectedCustomer = null;
        this.customerSelectionSkipped = false;
        this.renderCart();
        this.hideConfirmationModal();
        ui.showNotification('Carrito vaciado');
    }

    showConfirmationModal(title, message, onConfirm, confirmText = 'Confirmar', onCancel = null, cancelText = 'Cancelar') {
        if (this.dom.confirmationModal) {
            if (this.dom.confirmModalTitle) this.dom.confirmModalTitle.textContent = title;
            if (this.dom.confirmModalMessage) this.dom.confirmModalMessage.textContent = message;

            const confirmBtn = this.dom.confirmActionBtn;
            const cancelBtn = this.dom.cancelConfirmBtn;

            if (confirmBtn) {
                confirmBtn.textContent = confirmText;
                // Remove old listeners by cloning
                const newConfirmBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
                this.dom.confirmActionBtn = newConfirmBtn;

                newConfirmBtn.addEventListener('click', () => {
                    if (onConfirm) onConfirm();
                    this.hideConfirmationModal();
                });
            }

            if (cancelBtn) {
                cancelBtn.textContent = cancelText;
                const newCancelBtn = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
                this.dom.cancelConfirmBtn = newCancelBtn;

                newCancelBtn.addEventListener('click', () => {
                    if (onCancel) onCancel();
                    this.hideConfirmationModal();
                });
            }

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

    openCustomItemModal() {
        if (this.dom.customItemModal) this.dom.customItemModal.classList.remove('hidden');
        if (this.dom.customItemName) this.dom.customItemName.focus();
    }

    closeCustomItemModal() {
        if (this.dom.customItemModal) this.dom.customItemModal.classList.add('hidden');
        if (this.dom.customItemForm) this.dom.customItemForm.reset();
    }

    handleCustomItemSubmit(e) {
        e.preventDefault();
        const name = this.dom.customItemName.value;
        const price = parseFloat(this.dom.customItemPriceUsd.value);

        if (!name || isNaN(price) || price <= 0) {
            ui.showNotification('Datos inválidos', 'error');
            return;
        }

        const customProduct = {
            id: 'custom-' + Date.now(),
            name: name,
            price: price,
            stock: 9999,
            imageUri: 'https://via.placeholder.com/150?text=Custom',
            isCustom: true
        };

        this.addToCart(customProduct);
        this.closeCustomItemModal();
        ui.showNotification('Item personalizado agregado', 'success');
    }

    // Weighted Product Logic
    openWeightModal(product) {
        this.currentWeightedProduct = product;
        this.dom.weightModalTitle.textContent = product.name;
        this.dom.weightInput.value = '';
        this.dom.weightPriceUsd.value = '';
        this.dom.weightPriceBs.value = '';
        this.dom.weightModal.classList.remove('hidden');
        this.dom.weightInput.focus();
    }

    closeWeightModal() {
        this.dom.weightModal.classList.add('hidden');
        this.currentWeightedProduct = null;
    }

    calculateWeightValues(source) {
        if (!this.currentWeightedProduct) return;
        const pricePerUnit = this.currentWeightedProduct.price;
        const exchangeRate = this.exchangeRate;

        if (source === 'weight') {
            const weight = parseFloat(this.dom.weightInput.value) || 0;
            const totalUsd = weight * pricePerUnit;
            const totalBs = totalUsd * exchangeRate;
            this.dom.weightPriceUsd.value = totalUsd.toFixed(2);
            this.dom.weightPriceBs.value = totalBs.toFixed(2);
        } else if (source === 'usd') {
            const totalUsd = parseFloat(this.dom.weightPriceUsd.value) || 0;
            const weight = totalUsd / pricePerUnit;
            const totalBs = totalUsd * exchangeRate;
            this.dom.weightInput.value = weight.toFixed(3);
            this.dom.weightPriceBs.value = totalBs.toFixed(2);
        } else if (source === 'bs') {
            const totalBs = parseFloat(this.dom.weightPriceBs.value) || 0;
            const totalUsd = totalBs / exchangeRate;
            const weight = totalUsd / pricePerUnit;
            this.dom.weightInput.value = weight.toFixed(3);
            this.dom.weightPriceUsd.value = totalUsd.toFixed(2);
        }
    }

    confirmWeightItem(e) {
        e.preventDefault();
        if (!this.currentWeightedProduct) return;

        const weight = parseFloat(this.dom.weightInput.value);
        if (isNaN(weight) || weight <= 0) {
            ui.showNotification('Peso inválido', 'error');
            return;
        }

        this.addToCart(this.currentWeightedProduct, weight);
        this.closeWeightModal();
        ui.showNotification('Producto agregado', 'success');
    }

    processCheckout(customer) {
        this.selectedCustomer = customer;
        this.customerSelectionSkipped = !customer; // Set flag if skipped
        this.hideCustomerSelection();

        if (this.pendingHold) {
            this.holdSale();
            this.pendingHold = false;
            return;
        }

        this.showPaymentModal();
    }

    handleCustomerSearch(query) {
        if (!query || query.length < 2) {
            this.dom.customerSearchResults.classList.add('hidden');
            this.customerSearchHighlightIndex = -1;
            return;
        }

        const term = query.toLowerCase();
        const matches = this.customers.filter(c =>
            c.name.toLowerCase().includes(term) ||
            (c.idDocument && c.idDocument.includes(term))
        ).slice(0, 5); // Limit to 5 results

        this.customerSearchHighlightIndex = -1; // Reset highlight

        if (matches.length > 0) {
            this.dom.customerSearchResults.innerHTML = matches.map((c, index) => `
                    < div class="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors"
                data - index="${index}"
                onclick = "window.pos.selectCustomer('${c.id}')" >
                    <p class="text-sm font-bold text-slate-800 dark:text-white">${c.name}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">${c.idDocument || 'Sin Doc'}</p>
                </div >
                    `).join('');
            this.dom.customerSearchResults.classList.remove('hidden');
        } else {
            this.dom.customerSearchResults.innerHTML = `
                    < div class="p-2 text-sm text-slate-500 dark:text-slate-400 text-center" > No encontrado</div >
                        `;
            this.dom.customerSearchResults.classList.remove('hidden');
        }
    }

    updateCustomerSearchHighlight(items) {
        items.forEach((item, index) => {
            if (index === this.customerSearchHighlightIndex) {
                item.classList.add('bg-blue-100', 'dark:bg-blue-900');
                item.classList.remove('hover:bg-slate-100', 'dark:hover:bg-slate-700');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('bg-blue-100', 'dark:bg-blue-900');
                item.classList.add('hover:bg-slate-100', 'dark:hover:bg-slate-700');
            }
        });
    }

    selectCustomer(customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (customer) {
            this.selectedCustomer = customer;

            // Update UI
            this.dom.customerSearchContainer.classList.add('hidden');
            this.dom.selectedCustomerDisplay.classList.remove('hidden');

            if (this.dom.selectedCustomerName) this.dom.selectedCustomerName.textContent = customer.name;
            if (this.dom.selectedCustomerDoc) this.dom.selectedCustomerDoc.textContent = customer.idDocument || 'Sin Doc';

            // Clear search
            this.dom.customerSearchInput.value = '';
            this.dom.customerSearchResults.classList.add('hidden');

            // Focus on Product Search
            if (this.dom.searchInput) {
                this.dom.searchInput.focus();
            }
        }
    }

    deselectCustomer() {
        this.selectedCustomer = null;

        // Update UI
        this.dom.selectedCustomerDisplay.classList.add('hidden');
        this.dom.customerSearchContainer.classList.remove('hidden');

        // Focus search
        this.dom.customerSearchInput.focus();
    }

    showPaymentModal() {
        if (this.dom.paymentModal) this.dom.paymentModal.classList.remove('hidden');

        // Ensure methods are populated
        this.populatePaymentMethods();

        // Calculate totals
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalBs = total * this.exchangeRate;

        // Update Total Display
        if (this.dom.paymentTotalUsd) this.dom.paymentTotalUsd.textContent = `$${total.toFixed(2)} `;
        if (this.dom.paymentTotalVes) this.dom.paymentTotalVes.textContent = `Bs ${totalBs.toFixed(2)} `;

        // Select default method (Cash)
        this.handlePaymentMethodClick('cash');

        // Auto-fill amount for Cash USD
        if (this.dom.paymentReceivedUsd) {
            this.dom.paymentReceivedUsd.value = total.toFixed(2);
            this.calculateChange();
        }

        // Show payment form, hide receipt
        if (this.dom.paymentFormContent) this.dom.paymentFormContent.classList.remove('hidden');
        if (this.dom.receiptModalContent) this.dom.receiptModalContent.classList.add('hidden');
    }

    hidePaymentModal() {
        if (this.dom.paymentModal) this.dom.paymentModal.classList.add('hidden');
    }

    populatePaymentMethods() {
        if (!this.dom.paymentMethodOptions) return;
        this.dom.paymentMethodOptions.innerHTML = '';

        // Ensure Cash exists
        if (!this.paymentMethods.some(m => m.id === 'cash')) {
            this.paymentMethods.unshift({ id: 'cash', name: 'Efectivo (USD/VES)', currency: 'MIXED' });
        }

        // Render Buttons
        this.paymentMethods.forEach(method => {
            // Skip individual cash entries if they exist in the list (legacy)
            if (method.id === 'cash_usd' || method.id === 'cash_bs') return;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = `payment - method - btn w - full py - 3 px - 4 rounded - lg border text - sm font - medium transition - all duration - 200 ${method.id === this.selectedPaymentMethodId
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-600 dark:text-white shadow-md'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-600'
                } `;
            button.textContent = method.name;
            button.dataset.id = method.id;
            button.addEventListener('click', () => this.handlePaymentMethodClick(method.id));
            this.dom.paymentMethodOptions.appendChild(button);
        });

        // Add Combined Option explicitly if not present (it's usually handled by UI, but good to ensure)
        // logic handled in render
        this.onPaymentMethodChange();
    }

    handlePaymentMethodClick(methodId) {
        this.selectedPaymentMethodId = methodId;

        // Update UI
        const buttons = this.dom.paymentMethodOptions.querySelectorAll('.payment-method-btn');
        buttons.forEach(btn => {
            if (btn.dataset.id === methodId) {
                btn.className = 'payment-method-btn w-full py-3 px-4 rounded-lg border text-sm font-medium transition-all duration-200 bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-600 dark:text-white shadow-md';
            } else {
                btn.className = 'payment-method-btn w-full py-3 px-4 rounded-lg border text-sm font-medium transition-all duration-200 bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-600';
            }
        });

        this.onPaymentMethodChange();
    }

    onPaymentMethodChange() {
        const methodId = this.selectedPaymentMethodId;
        this.dom.paymentFields.innerHTML = '';

        let inputsToRender = [];

        if (methodId === 'cash') {
            inputsToRender.push(
                { id: 'cash_usd', name: 'Efectivo USD', currency: 'USD', placeholder: 'Monto $' },
                { id: 'cash_ves', name: 'Efectivo VES', currency: 'VES', placeholder: 'Monto Bs' }
            );
        } else if (methodId === 'combined') {
            // Cash first
            inputsToRender.push(
                { id: 'cash_usd', name: 'Efectivo USD', currency: 'USD', placeholder: 'Monto $' },
                { id: 'cash_ves', name: 'Efectivo VES', currency: 'VES', placeholder: 'Monto Bs' }
            );
            // Then all others
            this.paymentMethods.forEach(m => {
                if (m.id !== 'cash' && m.id !== 'combined' && m.id !== 'cash_usd' && m.id !== 'cash_bs') {
                    inputsToRender.push({
                        id: m.id,
                        name: m.name,
                        currency: m.currency || 'VES',
                        placeholder: `Monto ${m.currency || 'VES'} `,
                        requiresReference: m.requiresReference // Keep this if needed
                    });
                }
            });
        } else {
            // Single specific method
            const method = this.paymentMethods.find(m => m.id === methodId);
            if (method) {
                inputsToRender.push({
                    id: method.id,
                    name: method.name,
                    currency: method.currency || 'VES',
                    placeholder: `Monto ${method.currency || 'VES'} `,
                    requiresReference: method.requiresReference
                });
            }
        }

        // Generate HTML
        let html = '<div class="space-y-3 mb-4 max-h-60 overflow-y-auto pr-2">';
        inputsToRender.forEach(input => {
            const showRef = input.requiresReference || input.id === 'pago_movil' || input.name.toLowerCase().includes('pago movil');

            html += `
                    <div class="grid grid-cols-12 gap-2 items-end payment-row">
                    <div class="col-span-12">
                        <label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">${input.name}</label>
                    </div>
                    <div class="${showRef ? 'col-span-7' : 'col-span-12'}">
                        <input type="number" 
                            data-id="${input.id}" 
                            data-currency="${input.currency}" 
                            class="payment-input w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500" 
                            step="0.01" min="0" placeholder="${input.placeholder}">
                    </div>
                    ${showRef ? `
                    <div class="col-span-5">
                        <input type="text" 
                            data-ref-for="${input.id}"
                            class="payment-ref w-full rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500" 
                            placeholder="Ref.">
                    </div>
                    ` : ''
                }
                </div>
                    `;
        });
        html += '</div>';
        this.dom.paymentFields.innerHTML = html;

        // Bind events
        this.dom.paymentFields.querySelectorAll('.payment-input').forEach(input => {
            input.addEventListener('input', () => this.calculateChange());
        });

        // Reset change display
        this.calculateChange();
    }



    calculateChange() {
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        let paidUsd = 0;
        let paidBs = 0;

        // Unified calculation: Iterate over ALL visible payment inputs
        const inputs = this.dom.paymentFields.querySelectorAll('.payment-input');
        inputs.forEach(input => {
            const val = parseFloat(input.value || 0);
            const currency = input.dataset.currency;
            if (currency === 'USD') {
                paidUsd += val;
            } else {
                paidBs += val;
            }
        });

        const paidTotalInUsd = paidUsd + (paidBs / (this.exchangeRate || 1));
        const changeUsd = paidTotalInUsd - total;
        const changeBs = changeUsd * this.exchangeRate;

        if (changeUsd >= -0.01) { // Tolerance for float errors
            this.dom.paymentChange.innerHTML = `
                <div class="flex flex-col items-center justify-center">
                    <span class="text-sm text-slate-500 dark:text-slate-400">Su Vuelto</span>
                    <div class="text-xl font-bold text-green-600 dark:text-green-400">
                        $${Math.max(0, changeUsd).toFixed(2)}
                    </div>
                    <div class="text-sm font-medium text-green-600 dark:text-green-400">
                        Bs ${Math.max(0, changeBs).toFixed(2)}
                    </div>
                </div>
            `;
        } else {
            const missing = Math.abs(changeUsd);
            const missingBs = missing * this.exchangeRate;
            this.dom.paymentChange.innerHTML = `
                <div class="flex flex-col items-center justify-center">
                    <span class="text-sm text-red-500 dark:text-red-400 font-medium">Faltan</span>
                    <div class="text-xl font-bold text-red-600 dark:text-red-400">
                        $${missing.toFixed(2)}
                    </div>
                    <div class="text-sm font-medium text-red-600 dark:text-red-400">
                        Bs ${missingBs.toFixed(2)}
                    </div>
                </div>
            `;
        }
    }

    async confirmPayment() {
        const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        let paidUsd = 0;
        let paidBs = 0;

        const inputs = this.dom.paymentFields.querySelectorAll('.payment-input');
        inputs.forEach(input => {
            const val = parseFloat(input.value || 0);
            const currency = input.dataset.currency;
            if (currency === 'USD') {
                paidUsd += val;
            } else {
                paidBs += val;
            }
        });

        const paidTotalInUsd = paidUsd + (paidBs / (this.exchangeRate || 1));

        if (paidTotalInUsd < total - 0.01) {
            ui.showNotification('Monto insuficiente', 'warning');
            return;
        }

        let paymentDetails = [];
        inputs.forEach(input => {
            const val = parseFloat(input.value || 0);
            if (val > 0) {
                const id = input.dataset.id;
                const currency = input.dataset.currency;
                const refInput = this.dom.paymentFields.querySelector(`[data-ref-for="${id}"]`);
                const reference = refInput ? refInput.value : '';

                paymentDetails.push({
                    method: id,
                    amount: val,
                    currency: currency,
                    reference: reference
                });
            }
        });

        if (paymentDetails.length === 0) {
            ui.showNotification('Por favor ingrese un monto de pago', 'warning');
            return;
        }

        const saleData = {
            items: this.cart,
            total: total,
            paymentDetails: paymentDetails,
            date: new Date().toISOString(),
            customer: this.selectedCustomer || { name: 'Cliente General' },
            exchangeRate: this.exchangeRate
        };

        try {
            const createdSale = await api.sales.create(saleData);
            this.lastSale = createdSale;
            this.cart = [];
            this.selectedCustomer = null;
            this.customerSelectionSkipped = false;
            this.renderCart();
            // this.hidePaymentModal(); // Keep modal open for receipt
            this.showReceipt(createdSale);
            ui.showNotification('Venta procesada correctamente');
        } catch (error) {
            console.error('Error processing sale:', error);
            ui.showNotification('Error al procesar la venta: ' + error.message, 'error');
        }
    }

    showReceipt(saleData) {
        this.lastSale = saleData;
        if (this.dom.paymentModal) this.dom.paymentModal.classList.remove('hidden');
        if (this.dom.paymentFormContent) this.dom.paymentFormContent.classList.add('hidden');
        if (this.dom.receiptModalContent) this.dom.receiptModalContent.classList.remove('hidden');

        if (this.dom.receiptContent) {
            this.dom.receiptContent.innerHTML = this.generateReceiptHtml(saleData);
        }
    }

    generateReceiptHtml(saleData) {
        // Inline styles for email compatibility
        const styles = {
            container: "font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 400px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border: 1px solid #f1f5f9;",
            header: "background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 30px 20px; text-align: center;",
            headerTitle: "margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;",
            headerSub: "margin: 8px 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;",
            body: "padding: 25px;",
            section: "margin-bottom: 25px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 20px;",
            label: "font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;",
            text: "font-size: 14px; color: #334155; margin: 4px 0; font-weight: 500;",
            itemRow: "display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; color: #334155;",
            totalRow: "display: flex; justify-content: space-between; font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 15px; align-items: center;",
            footer: "background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9;",
            badge: "display: inline-block; padding: 4px 8px; border-radius: 4px; background-color: #f1f5f9; color: #475569; font-size: 12px; font-weight: 600;"
        };

        const dateStr = saleData.date ? new Date(saleData.date).toLocaleString('es-VE') : new Date().toLocaleString('es-VE');

        // Helper to get method name
        const getMethodName = (id) => {
            const method = this.paymentMethods.find(m => m.id === id);
            return method ? method.name : (id === 'cash' ? 'Efectivo' : id);
        };

        return `
            <div style="${styles.container}">
                <div style="${styles.header}">
                    <h1 style="${styles.headerTitle}">${this.businessInfo?.name || 'American POS'}</h1>
                    <p style="${styles.headerSub}">${dateStr}</p>
                </div>
                
                <div style="${styles.body}">
                    <div style="${styles.section}">
                        ${this.businessInfo?.address ? `<p style="${styles.text}">${this.businessInfo.address}</p>` : ''}
                        ${this.businessInfo?.phone ? `<p style="${styles.text}">Tel: ${this.businessInfo.phone}</p>` : ''}
                        ${this.businessInfo?.rif ? `<p style="${styles.text}">RIF: ${this.businessInfo.rif}</p>` : ''}
                    </div>

                    ${saleData.customer ? `
                    <div style="${styles.section}">
                        <p style="${styles.label}">Cliente</p>
                        <p style="${styles.text}" style="font-size: 16px; font-weight: 700; color: #0f172a;">${saleData.customer.name}</p>
                        ${saleData.customer.idDocument ? `<p style="${styles.text}">CI/RIF: ${saleData.customer.idDocument}</p>` : ''}
                        ${saleData.customer.phone ? `<p style="${styles.text}">Tel: ${saleData.customer.phone}</p>` : ''}
                    </div>
                    ` : ''}

                    <div style="${styles.section}">
                        <p style="${styles.label}">Detalle de Compra</p>
                        ${saleData.items.map(item => `
                            <div style="${styles.itemRow}">
                                <span style="font-weight: 500;">${item.quantity} x ${item.name}</span>
                                <span style="font-weight: 600;">Bs ${(item.price * item.quantity * this.exchangeRate).toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>

                    <div style="margin-bottom: 20px;">
                        <div style="${styles.totalRow}">
                            <span>Total</span>
                            <span>Bs ${(saleData.total * this.exchangeRate).toFixed(2)}</span>
                        </div>
                        <div style="${styles.itemRow}; color: #64748b; font-size: 13px; margin-top: 5px;">
                            <span>Ref USD</span>
                            <span>$${saleData.total.toFixed(2)}</span>
                        </div>
                    </div>

                    <div style="${styles.section}; border-bottom: none; padding-bottom: 0;">
                        <p style="${styles.label}">Método de Pago</p>
                        ${saleData.paymentDetails.map(detail => `
                            <div style="${styles.itemRow}">
                                <span style="${styles.badge}">${getMethodName(detail.method)}</span>
                                <span style="font-weight: 600;">$${detail.amount.toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div style="${styles.footer}">
                    <p style="margin: 0; font-weight: 600;">¡Gracias por su compra!</p>
                    <p style="margin: 5px 0 0; opacity: 0.7;">Generado por American POS</p>
                </div>
            </div>
        `;
    }

    hideReceipt() {
        this.hidePaymentModal();
        // Reset modal state for next time
        if (this.dom.paymentFormContent) this.dom.paymentFormContent.classList.remove('hidden');
        if (this.dom.receiptModalContent) this.dom.receiptModalContent.classList.add('hidden');
    }

    async emailReceipt() {
        if (!this.lastSale) return;

        let email = this.lastSale.customer?.email;

        if (!email) {
            this.showEmailInputModal((enteredEmail) => {
                if (enteredEmail) {
                    this.sendEmailInBackground(enteredEmail);
                }
            });
        } else {
            this.sendEmailInBackground(email);
        }
    }

    sendEmailInBackground(email) {
        ui.showNotification('Enviando recibo en segundo plano...', 'info');
        const html = this.generateReceiptHtml(this.lastSale);

        // Fire and forget (but handle errors)
        api.sales.emailReceipt(this.lastSale.id, email, html)
            .then(() => {
                ui.showNotification(`Recibo enviado a ${email}`, 'success');
            })
            .catch(error => {
                console.error('Error sending email:', error);
                ui.showNotification('Error al enviar correo: ' + error.message, 'error');
            });
    }

    showEmailInputModal(callback) {
        const modal = document.getElementById('email-input-modal');
        const input = document.getElementById('email-input-field');
        const confirmBtn = document.getElementById('confirm-email-btn');
        const cancelBtn = document.getElementById('cancel-email-btn');

        if (!modal || !input || !confirmBtn || !cancelBtn) {
            console.error('Email modal elements not found');
            return;
        }

        input.value = '';
        modal.classList.remove('hidden');
        input.focus();

        const close = () => {
            modal.classList.add('hidden');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            input.onkeydown = null;
        };

        const confirm = () => {
            const email = input.value.trim();
            if (email && email.includes('@')) {
                close();
                callback(email);
            } else {
                ui.showNotification('Por favor ingrese un correo válido', 'warning');
                input.focus();
            }
        };

        confirmBtn.onclick = confirm;
        cancelBtn.onclick = close;

        input.onkeydown = (e) => {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') close();
        };
    }

    printReceipt() {
        window.print();
    }




}


// Global Toggle Functions for Mobile (Emergency Fallback)
window.toggleMobileMenu = function () {
    // console.log('Global toggleMobileMenu called');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('-translate-x-full');
        overlay.classList.toggle('hidden');
    } else {
        console.error('Error: Menu elements not found');
    }
};

window.toggleMobileCart = function () {
    // console.log('Global toggleMobileCart called');
    const cartSidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (cartSidebar && overlay) {
        cartSidebar.classList.toggle('translate-x-full');
        overlay.classList.toggle('hidden');
    } else {
        console.error('Error: Cart elements not found');
    }
};

window.closeMobileCart = function () {
    const cartSidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (cartSidebar) cartSidebar.classList.add('translate-x-full');
    if (overlay) overlay.classList.add('hidden');
};




