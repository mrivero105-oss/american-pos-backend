import { api } from './api.js';
import { ui } from './ui.js';
import { formatCurrency } from './utils.js';

export class POS {
    constructor() {
        this.cart = [];
        this.products = [];
        this.customers = [];
        this.selectedCustomer = null;
        this.lastSale = null;
        this.exchangeRate = 1.0;
        this.businessInfo = {};
        this.paymentMethods = []; // Initialize payment methods array
        this.init();
    }

    async init() {
        this.cacheDOM();
        this.bindEvents();
        await this.loadSettings();
        await this.loadProducts();
        await this.loadCustomers();
        this.checkHeldSale();
        this.renderCart();
    }

    cacheDOM() {
        this.dom = {
            // Existing elements
            productGrid: document.getElementById('product-grid'),
            cartItems: document.getElementById('cart-items'),
            cartTotal: document.getElementById('cart-total'),
            cartTotalBs: document.getElementById('cart-total-bs'),
            searchInput: document.getElementById('search-input'),
            checkoutBtn: document.getElementById('checkout-btn'),
            clearCartBtn: document.getElementById('clear-cart-btn'),
            holdSaleBtn: document.getElementById('hold-sale-btn'),
            mobileCartCount: document.getElementById('mobile-cart-count'),
            customerSelectionModal: document.getElementById('customer-selection-modal'),
            customerListCheckout: document.getElementById('customer-list-checkout'),
            searchCustomerCheckout: document.getElementById('search-customer-checkout'),
            skipCustomerBtn: document.getElementById('skip-customer-btn'),
            closeCustomerSelection: document.getElementById('close-customer-selection'),
            receiptModal: document.getElementById('receipt-modal'),
            receiptContent: document.getElementById('receipt-content'),
            closeReceipt: document.getElementById('close-receipt'),
            emailReceiptBtn: document.getElementById('email-receipt-btn'),
            printReceiptBtn: document.getElementById('print-receipt-btn'),
            paymentModal: document.getElementById('payment-modal'),
            paymentTotalUsd: document.getElementById('payment-total-usd'),
            paymentTotalVes: document.getElementById('payment-total-ves'),
            // New elements for dynamic payment UI
            paymentMethodSelect: document.getElementById('payment-method-select'),
            paymentFields: document.getElementById('payment-fields'),
            paymentChange: document.getElementById('payment-change'),
            cancelPaymentBtn: document.getElementById('cancel-payment-btn'),
            confirmPaymentBtn: document.getElementById('confirm-payment-btn')
        };
    }

    bindEvents() {
        this.dom.searchInput?.addEventListener('input', (e) => this.filterProducts(e.target.value));
        this.dom.productGrid?.addEventListener('click', (e) => this.handleGridClick(e));
        this.dom.cartItems?.addEventListener('click', (e) => this.handleCartClick(e));
        this.dom.checkoutBtn?.addEventListener('click', () => this.showCustomerSelection());
        this.dom.clearCartBtn?.addEventListener('click', () => this.clearCart());
        this.dom.holdSaleBtn?.addEventListener('click', () => {
            if (this.dom.holdSaleBtn.classList.contains('restore-mode')) {
                this.restoreSale();
            } else {
                this.holdSale();
            }
        });

        // Customer selection modal events
        this.dom.closeCustomerSelection?.addEventListener('click', () => this.hideCustomerSelection());
        this.dom.skipCustomerBtn?.addEventListener('click', () => this.processCheckout(null));
        this.dom.searchCustomerCheckout?.addEventListener('input', (e) => this.filterCustomers(e.target.value));
        this.dom.customerListCheckout?.addEventListener('click', (e) => this.handleCustomerSelect(e));

        // Receipt modal events
        this.dom.closeReceipt?.addEventListener('click', () => this.hideReceipt());
        this.dom.emailReceiptBtn?.addEventListener('click', () => this.emailReceipt());
        this.dom.printReceiptBtn?.addEventListener('click', () => this.printReceipt());

        // Payment modal events
        this.dom.cancelPaymentBtn?.addEventListener('click', () => this.hidePaymentModal());
        this.dom.confirmPaymentBtn?.addEventListener('click', () => this.confirmPayment());
        this.dom.paymentMethodSelect?.addEventListener('change', () => this.onPaymentMethodChange());
        // Dynamic fields will attach their own listeners when rendered

        // POS Scanner
        const btnScan = document.getElementById('pos-scan-btn');
        const btnCloseScan = document.getElementById('close-pos-scanner');

        if (btnScan) btnScan.addEventListener('click', () => this.startScanner());
        if (btnCloseScan) btnCloseScan.addEventListener('click', () => this.stopScanner());
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
        // Debounce or simple check to prevent double scans if needed
        // For now, just find and add
        const product = this.products.find(p => p.barcode === barcode);

        if (product) {
            this.addToCart(product);

            // Show feedback
            const feedback = document.getElementById('scan-feedback');
            if (feedback) {
                feedback.classList.remove('opacity-0');
                setTimeout(() => feedback.classList.add('opacity-0'), 1500);
            }

            // Optional: Play sound
            // const audio = new Audio('assets/beep.mp3');
            // audio.play().catch(e => {});

        } else {
            // Optional: Show error feedback
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

    renderProducts(products) {
        if (!this.dom.productGrid) return;

        this.dom.productGrid.innerHTML = products.map(product => {
            const stock = parseInt(product.stockQuantity || 0);
            const isAvailable = stock > 0;
            const imageUri = product.imageUri || 'https://via.placeholder.com/150?text=No+Image';

            return `
                <div class="product-card bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer ${!isAvailable ? 'opacity-75' : ''}" data-id="${product.id}">
                    <div class="aspect-square overflow-hidden bg-gray-50">
                        <img src="${imageUri}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                    </div>
                    <div class="p-3 md:p-4">
                        <div class="mb-2">
                            <span class="inline-block px-2 py-1 text-xs font-medium rounded ${isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                                ${isAvailable ? 'Disponible' : 'Agotado'}
                            </span>
                            <span class="ml-2 text-xs text-gray-500">#${product.id}</span>
                        </div>
                        <h3 class="font-semibold text-gray-800 mb-1 text-sm md:text-base line-clamp-2">${product.name}</h3>
                        <p class="text-xs text-gray-500 mb-2 line-clamp-1">${product.description || 'Sin descripción'}</p>
                        <div class="flex justify-between items-center">
                            <span class="text-lg md:text-xl font-bold text-slate-900">$${parseFloat(product.price).toFixed(2)}</span>
                            <button class="add-to-cart-btn px-3 py-2 md:px-4 md:py-2 bg-slate-100 text-slate-900 hover:bg-slate-900 hover:text-white rounded-lg transition-colors flex items-center gap-2 font-medium text-sm"
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
    }

    filterProducts(query) {
        const filtered = this.products.filter(p =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.description?.toLowerCase().includes(query.toLowerCase())
        );
        this.renderProducts(filtered);
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
            // Increase quantity only if below stock limit
            if (item.quantity < item.stockQuantity) {
                item.quantity++;
            } else {
                ui.showNotification(`Stock máximo alcanzado (${item.stockQuantity})`, 'warning');
            }
        } else if (btn.classList.contains('decrease-qty')) {
            // Decrease quantity or remove if at 1
            if (item.quantity > 1) {
                item.quantity--;
            } else {
                // Remove item if quantity would go to 0
                this.cart = this.cart.filter(i => String(i.id) !== String(id));
            }
        } else if (btn.classList.contains('remove-item')) {
            // Remove item from cart
            this.cart = this.cart.filter(i => String(i.id) !== String(id));
        }

        this.renderCart();
    }

    handleGridClick(e) {
        const card = e.target.closest('.product-card');
        if (!card) return;

        const id = card.dataset.id;
        const product = this.products.find(p => String(p.id) === String(id));

        if (product && product.stockQuantity > 0) {
            this.addToCart(product);
            this.dom.cartItems.innerHTML = this.cart.map(item => `
            <div class="cart-item bg-white p-3 rounded-lg border border-gray-100 flex justify-between items-center group" data-id="${item.id}">
                <div class="flex-1 min-w-0 mr-3">
                    <h4 class="font-medium text-gray-800 truncate">${item.name}</h4>
                    <div class="text-sm text-gray-500">$${parseFloat(item.price).toFixed(2)} x ${item.quantity}</div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1 bg-gray-50 rounded-lg p-1">
                        <button class="decrease-qty w-7 h-7 flex items-center justify-center bg-white rounded hover:bg-red-50 hover:text-red-600 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                            </svg>
                        </button>
                        <span class="w-8 text-center font-medium text-sm">${item.quantity}</span>
                        <button class="increase-qty w-7 h-7 flex items-center justify-center bg-white rounded hover:bg-green-50 hover:text-green-600 transition-colors">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                            </svg>
                        </button>
                    </div>
                    <button class="remove-item text-red-500 hover:text-red-700 p-1">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('') || '<p class="text-gray-400 text-center py-8">Carrito vacío</p>';

            const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const totalBs = total * this.exchangeRate;

            this.dom.cartTotal.textContent = formatCurrency(total);
            this.dom.cartTotalBs.textContent = `Bs ${totalBs.toFixed(2)}`;

            const hasItems = this.cart.length > 0;
            this.dom.checkoutBtn.disabled = !hasItems;
            this.dom.clearCartBtn.disabled = !hasItems;

            if (this.dom.mobileCartCount) {
                const count = this.cart.reduce((sum, item) => sum + item.quantity, 0);
                this.dom.mobileCartCount.textContent = count;
                this.dom.mobileCartCount.classList.toggle('hidden', count === 0);
            }

            this.checkHeldSale();
        }

        clearCart() {
            if (confirm('¿Estás seguro de vaciar el carrito?')) {
                this.cart = [];
                this.renderCart();
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

            this.cart = JSON.parse(heldCart);
            localStorage.removeItem('held_cart');
            this.renderCart();
            ui.showNotification('Venta restaurada');
        }

        checkHeldSale() {
            const heldCart = localStorage.getItem('held_cart');
            const btn = this.dom.holdSaleBtn;

            if (!btn) return;

            if (heldCart) {
                btn.classList.add('restore-mode', 'bg-blue-100', 'text-blue-600');
                btn.classList.remove('bg-yellow-100', 'text-yellow-600');
                btn.title = "Restaurar Venta";
                btn.innerHTML = `
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
            `;
            } else {
                btn.classList.remove('restore-mode', 'bg-blue-100', 'text-blue-600');
                btn.classList.add('bg-yellow-100', 'text-yellow-600');
                btn.title = "Poner en Espera";
                btn.innerHTML = `
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
            `;
                btn.disabled = this.cart.length === 0;
            }
        }

    // Customer Selection Methods
    async showCustomerSelection() {
            await this.loadCustomers(); // Recargar clientes frescos

            // If no customers available (endpoint failed or empty), skip to payment
            if (!this.customers || this.customers.length === 0) {
                this.processCheckout(null); // Process without customer
                return;
            }

            this.renderCustomerList(this.customers);
            this.dom.customerSelectionModal?.classList.remove('hidden');
            // Enfocar el input de búsqueda
            setTimeout(() => this.dom.searchCustomerCheckout?.focus(), 100);
        }

        hideCustomerSelection() {
            this.dom.customerSelectionModal?.classList.add('hidden');
            this.dom.searchCustomerCheckout.value = '';
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

    async processCheckout(customer) {
            if (this.cart.length === 0) return;

            this.hideCustomerSelection();
            this.selectedCustomer = customer;
            this.showPaymentModal();
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

            // Show/hide email button based on customer email
            if (this.dom.emailReceiptBtn) {
                this.dom.emailReceiptBtn.style.display = this.lastSale.customer?.email ? 'flex' : 'none';
            }

            this.dom.receiptModal?.classList.remove('hidden');
        }

        hideReceipt() {
            this.dom.receiptModal?.classList.add('hidden');
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
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z">
                    </path>
                </svg>
                Enviar al correo del cliente
            `;
            }
        }

        printReceipt() {
            window.print();
        }

        showPaymentModal() {
            const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const totalBs = total * this.exchangeRate;

            this.dom.paymentTotalUsd.textContent = `$${total.toFixed(2)}`;
            this.dom.paymentTotalVes.textContent = `Bs ${totalBs.toFixed(2)}`;
            // Populate payment method dropdown
            this.populatePaymentMethods();
            // Reset fields
            this.dom.paymentFields.innerHTML = '';
            this.dom.paymentChange.textContent = 'Bs 0.00';
            this.dom.paymentModal?.classList.remove('hidden');
        }

        hidePaymentModal() {
            this.dom.paymentModal?.classList.add('hidden');
            // Clear dynamic fields
            if (this.dom.paymentFields) this.dom.paymentFields.innerHTML = '';
        }

        populatePaymentMethods() {
            console.log('Populating payment methods...', this.paymentMethods);
            console.log('Select element:', this.dom.paymentMethodSelect);

            if (!this.dom.paymentMethodSelect) {
                console.error('Payment method select element not found!');
                return;
            }

            this.dom.paymentMethodSelect.innerHTML = '';

            // Add default cash method if not present
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

            // Trigger change event to set initial fields
            this.onPaymentMethodChange();
        }

        onPaymentMethodChange() {
            const methodId = this.dom.paymentMethodSelect.value;
            const method = this.paymentMethods.find(m => m.id === methodId);

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

                // Re-cache dynamic elements
                this.dom.paymentReceivedUsd = document.getElementById('payment-received-usd');
                this.dom.paymentReceivedVes = document.getElementById('payment-received-ves');

                // Add listeners
                this.dom.paymentReceivedUsd?.addEventListener('input', () => this.calculateChange());
                this.dom.paymentReceivedVes?.addEventListener('input', () => this.calculateChange());

            } else {
                let fieldsHtml = `
                <div class="mb-4">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Monto</label>
                    <input type="number" id="payment-amount" class="w-full rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" step="0.01" min="0">
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

                // Re-cache dynamic elements
                this.dom.paymentAmount = document.getElementById('payment-amount');
                this.dom.paymentReference = document.getElementById('payment-reference');

                // Add listeners
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
            this.dom.paymentChange.textContent = `Bs ${change.toFixed(2)}`;

            // Enable/disable confirm button
            if (this.dom.confirmPaymentBtn) {
                // Allow small margin of error or exact payment
                // For non-cash, we might want to allow 0 change if exact amount is entered
                this.dom.confirmPaymentBtn.disabled = change < -0.01;
            }
        }

    async confirmPayment() {
            if (!this.cart.length) return;

            const methodId = this.dom.paymentMethodSelect.value;
            const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const totalBs = total * this.exchangeRate;

            let paymentDetails = {};

            if (methodId === 'cash') {
                const ves = parseFloat(this.dom.paymentReceivedVes?.value) || 0;
                const usd = parseFloat(this.dom.paymentReceivedUsd?.value) || 0;
                const change = (ves + (usd * this.exchangeRate)) - totalBs;

                paymentDetails = {
                    cash: { usd, ves },
                    change: change
                };
            } else {
                const amount = parseFloat(this.dom.paymentAmount?.value) || 0;
                const reference = this.dom.paymentReference?.value || '';
                const method = this.paymentMethods.find(m => m.id === methodId);

                if (method?.requiresReference && !reference) {
                    ui.showNotification('La referencia es requerida', 'warning');
                    return;
                }

                paymentDetails = {
                    amount: amount,
                    reference: reference
                };
            }

            this.dom.confirmPaymentBtn.disabled = true;
            this.dom.confirmPaymentBtn.textContent = 'Procesando...';

            try {
                const saleData = {
                    items: this.cart,
                    total: total,
                    customerId: this.selectedCustomer?.id || null,
                    paymentMethod: methodId,
                    paymentDetails: paymentDetails
                };

                const response = await api.sales.create(saleData);

                this.lastSale = { ...saleData, id: response.saleId, customer: this.selectedCustomer };
                this.clearCart();
                this.hidePaymentModal();
                this.showReceipt();
                ui.showNotification('Venta registrada exitosamente');
            } catch (error) {
                console.error('Error processing payment:', error);
                ui.showNotification('Error al procesar el pago', 'error');
            } finally {
                this.dom.confirmPaymentBtn.disabled = false;
                this.dom.confirmPaymentBtn.textContent = 'Confirmar Pago';
            }
        }
    }
