document.addEventListener('DOMContentLoaded', () => {
    // --- REFERENCIAS AL DOM ---
    const productGrid = document.getElementById('product-grid');
    const gridLoading = document.getElementById('grid-loading');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalElement = document.getElementById('cart-total');
    const cartTotalLocalElement = document.getElementById('cart-total-local');
    const checkoutBtn = document.getElementById('checkout-btn');
    const searchInput = document.getElementById('product-search');
    const clearCartBtn = document.getElementById('clear-cart-btn');
    const holdCartBtn = document.getElementById('hold-cart-btn');
    const heldCartsContainer = document.getElementById('held-carts-container');
    const heldCartsList = document.getElementById('held-carts-list');
    const customItemBtn = document.getElementById('custom-item-btn');
    const customItemModal = document.getElementById('custom-item-modal');
    const customItemForm = document.getElementById('custom-item-form');
    const cancelCustomItemBtn = document.getElementById('cancel-custom-item-btn');
    const customItemPriceVesInput = document.getElementById('custom-item-price-ves');
    const customItemPriceUsdInput = document.getElementById('custom-item-price-usd');
    // Payment Modal elements
    const paymentModal = document.getElementById('payment-modal');
    const paymentTotalUsd = document.getElementById('payment-total-usd');
    const paymentTotalVes = document.getElementById('payment-total-ves');
    const paymentReceivedVes = document.getElementById('payment-received-ves');
    const paymentReceivedUsd = document.getElementById('payment-received-usd');
    const paymentChange = document.getElementById('payment-change');
    const cancelPaymentBtn = document.getElementById('cancel-payment-btn');
    const confirmPaymentBtn = document.getElementById('confirm-payment-btn');


    // --- VARIABLES DE ESTADO ---
    let allProducts = [];
    let cart = [];
    let heldCarts = [];
    let currentExchangeRate = 1.0;
    const apiBaseUrl = 'http://localhost:3000';
    const productsApiUrl = `${apiBaseUrl}/products`;
    const salesApiUrl = `${apiBaseUrl}/sales`;
    const rateApiUrl = `${apiBaseUrl}/settings/rate`;

    // --- FUNCIONES ---
    const showToast = (message, isError = false) => {
        Toastify({ text: message, duration: 3000, gravity: "top", position: "right", style: { background: isError ? "#dc3545" : "#28a745" } }).showToast();
    };

    const renderProducts = (products) => {
        gridLoading.style.display = 'none';
        const currentScroll = productGrid.scrollTop;
        productGrid.innerHTML = '';
        products.forEach(product => {
            const productCard = document.createElement('div');
            productCard.className = 'border rounded-lg p-4 flex flex-col items-center cursor-pointer hover:shadow-lg transition-transform duration-200 hover:scale-105 dark:border-gray-700';
            productCard.dataset.productId = product.id;

            const imageContainer = document.createElement('div');
            imageContainer.className = 'relative w-24 h-24 mb-2';

            const fallbackContent = () => {
                imageContainer.innerHTML = `
                    <div class="w-full h-full bg-gray-200 dark:bg-gray-700 rounded-md flex items-center justify-center">
                        <button data-refresh-id="${product.id}" class="p-1 rounded-full bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-opacity duration-300 opacity-75 hover:opacity-100">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.899 2.186l-1.393.597A5.002 5.002 0 005.999 7.099V5a1 1 0 01-2 0V3a1 1 0 011-1zm12 5.702a1 1 0 01-1-1V4.598a7.002 7.002 0 01-11.899-2.186l1.393-.597A5.002 5.002 0 0014.001 12.9V15a1 1 0 11-2 0v-2.1a1 1 0 011-1z" clip-rule="evenodd" />
                                <path d="M14.898 12.895l-1.393-.597a5.002 5.002 0 00-7.813 4.301V15a1 1 0 102 0v2.1a7.002 7.002 0 017.813-4.301l1.393.597a1 1 0 00-1-1.702zM4.102 7.105l1.393.597a5.002 5.002 0 007.813-4.3V5a1 1 0 10-2 0V2.9a7.002 7.002 0 01-7.813 4.301l-1.393-.597a1 1 0 001 1.702z" />
                            </svg>
                        </button>
                    </div>`;
            };

            if (product.imageUri) {
                const img = document.createElement('img');
                img.src = product.imageUri;
                img.alt = product.name;
                img.className = 'w-full h-full object-cover rounded-md';
                img.onerror = fallbackContent;
                imageContainer.appendChild(img);
            } else {
                fallbackContent();
            }
            
            const localPrice = product.price * currentExchangeRate;
            productCard.innerHTML = `<h3 class="font-semibold text-center text-sm mt-2">${product.name}</h3><p class="font-bold mt-1">$${product.price.toFixed(2)}</p><p class="text-xs">Bs. ${localPrice.toFixed(2)}</p><p class="text-xs ${product.stockQuantity > 5 ? 'text-green-600' : 'text-red-500'} mt-1">${product.stockQuantity} en stock</p>`;
            productCard.prepend(imageContainer);
            productGrid.appendChild(productCard);
        });
        productGrid.scrollTop = currentScroll;
    };

    const handleImageRefresh = async (productId, button) => {
        const originalButtonContent = button.innerHTML;
        button.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
        button.disabled = true;

        try {
            const response = await fetch(`${productsApiUrl}/${productId}/update-image`, { method: 'POST' });
            const updatedProduct = await response.json();
            if (!response.ok) throw new Error(updatedProduct.message || 'Error del servidor');

            const productIndex = allProducts.findIndex(p => p.id === productId);
            if (productIndex !== -1) {
                allProducts[productIndex] = updatedProduct;
            }
            
            const currentFilter = searchInput.value.toLowerCase();
            renderProducts(allProducts.filter(p => p.name.toLowerCase().includes(currentFilter)));
            showToast('Imagen actualizada.');

        } catch (error) {
            showToast(error.message || 'No se pudo actualizar la imagen.', true);
            button.innerHTML = originalButtonContent;
            button.disabled = false;
        }
    };

    const renderCart = () => {
        cartItemsContainer.innerHTML = cart.length === 0 ? '<p class="text-gray-500">El carrito está vacío.</p>' : '';
        cart.forEach(item => {
            const cartItemElement = document.createElement('div');
            cartItemElement.className = 'flex justify-between items-center mb-3';
            const itemTotal = (item.price * item.quantity).toFixed(2);
            cartItemElement.innerHTML = `
                <div class="flex-grow pr-2">
                    <p class="font-semibold">${item.name}</p>
                    <p class="text-sm">$${item.price.toFixed(2)} x ${item.quantity}</p>
                </div>
                <div class="flex items-center gap-3">
                    <button class="remove-one-btn bg-gray-200 dark:bg-gray-600 rounded-full w-6 h-6 flex items-center justify-center font-bold hover:bg-gray-300 dark:hover:bg-gray-500" data-id="${item.id}">-</button>
                    <span class="font-bold w-8 text-center">${item.quantity}</span>
                    <p class="font-bold w-20 text-right">$${itemTotal}</p>
                    <button class="remove-item-btn text-red-400 hover:text-red-600 p-1" data-id="${item.id}" title="Eliminar producto">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>`;
            cartItemsContainer.appendChild(cartItemElement);
        });
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        cartTotalElement.textContent = `$${total.toFixed(2)}`;
        cartTotalLocalElement.textContent = `Bs. ${(total * currentExchangeRate).toFixed(2)}`;
    };
    
    const renderHeldCarts = () => {
        if (heldCarts.length === 0) {
            heldCartsContainer.style.display = 'none';
            return;
        }
        heldCartsContainer.style.display = 'block';
        heldCartsList.innerHTML = '';
        heldCarts.forEach((heldCart, index) => {
            const cartTotal = heldCart.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const heldCartBtn = document.createElement('button');
            heldCartBtn.className = 'bg-yellow-200 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-100 p-2 rounded-lg text-xs font-semibold';
            heldCartBtn.innerHTML = `Venta #${index + 1} - $${cartTotal.toFixed(2)}`;
            heldCartBtn.onclick = () => {
                if (cart.length > 0 && !confirm("¿Reemplazar el carrito actual con esta venta en espera?")) {
                    return;
                }
                cart = heldCart.cart;
                heldCarts.splice(index, 1);
                localStorage.setItem('heldCarts', JSON.stringify(heldCarts));
                renderCart();
                renderHeldCarts();
                showToast(`Venta #${index + 1} recuperada.`);
            };
            heldCartsList.appendChild(heldCartBtn);
        });
    };

    const fetchInitialData = async () => {
        heldCarts = JSON.parse(localStorage.getItem('heldCarts') || '[]');
        renderHeldCarts();
        
        try {
            const storedRate = localStorage.getItem('exchangeRate');
            if (storedRate) {
                currentExchangeRate = parseFloat(storedRate);
            } else {
                const rateResponse = await fetch(rateApiUrl);
                const rateData = await rateResponse.json();
                currentExchangeRate = rateData.rate || 1.0;
                localStorage.setItem('exchangeRate', currentExchangeRate);
            }
            const productsResponse = await fetch(productsApiUrl);
            if (!productsResponse.ok) throw new Error('No se pudieron cargar los productos');
            allProducts = await productsResponse.json();
            renderProducts(allProducts);
        } catch (error) {
            showToast('Error al cargar datos iniciales.', true);
            gridLoading.textContent = 'Error al cargar.';
        }
    };

    // --- PAYMENT MODAL LOGIC ---
    const openPaymentModal = () => {
        const totalUsd = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (totalUsd === 0) return showToast("El carrito está vacío.", true);
        
        const totalVes = totalUsd * currentExchangeRate;
        
        paymentTotalUsd.textContent = `$${totalUsd.toFixed(2)}`;
        paymentTotalVes.textContent = `Bs. ${totalVes.toFixed(2)}`;
        
        paymentReceivedVes.value = '';
        paymentReceivedUsd.value = '';
        calculateChange();

        paymentModal.classList.remove('hidden');
        paymentModal.classList.add('flex');
        paymentReceivedVes.focus();
    };

    const closePaymentModal = () => {
        paymentModal.classList.add('hidden');
        paymentModal.classList.remove('flex');
    };

    const calculateChange = () => {
        const totalVes = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0) * currentExchangeRate;
        
        const receivedVes = parseFloat(paymentReceivedVes.value) || 0;
        const receivedUsd = parseFloat(paymentReceivedUsd.value) || 0;
        
        const totalReceivedInVes = receivedVes + (receivedUsd * currentExchangeRate);
        
        const change = totalReceivedInVes - totalVes;
        
        paymentChange.textContent = `Bs. ${Math.max(0, change).toFixed(2)}`;
    };
    
    const confirmPayment = async () => {
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        try {
            confirmPaymentBtn.disabled = true;
            confirmPaymentBtn.textContent = 'Procesando...';

            const response = await fetch(salesApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart, total }) });
            if (!response.ok) throw new Error("El servidor rechazó la venta.");
            const result = await response.json();
            
            Toastify({
                text: "Venta registrada. Clic para imprimir recibo.",
                duration: 10000,
                destination: `recibo.html?id=${result.saleId}`,
                newWindow: true,
                close: true,
                gravity: "top",
                position: "right",
                style: { background: "#28a745" },
                stopOnFocus: true, 
            }).showToast();

            cart = [];
            renderCart();
            closePaymentModal();
            fetchInitialData(); // Refresca los productos para actualizar stock

        } catch (error) {
            showToast("No se pudo registrar la venta.", true);
        } finally {
            confirmPaymentBtn.disabled = false;
            confirmPaymentBtn.textContent = 'Confirmar Venta';
        }
    };

    // --- EVENT LISTENERS ---
    checkoutBtn.addEventListener('click', openPaymentModal);
    cancelPaymentBtn.addEventListener('click', closePaymentModal);
    confirmPaymentBtn.addEventListener('click', confirmPayment);
    paymentReceivedVes.addEventListener('input', calculateChange);
    paymentReceivedUsd.addEventListener('input', calculateChange);

    holdCartBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            showToast("El carrito está vacío, no se puede poner en espera.", true);
            return;
        }
        heldCarts.push({ id: Date.now(), cart: cart });
        localStorage.setItem('heldCarts', JSON.stringify(heldCarts));
        cart = [];
        renderCart();
        renderHeldCarts();
        showToast("Venta puesta en espera.");
    });

    searchInput.addEventListener('input', () => {
        const currentFilter = searchInput.value.toLowerCase();
        renderProducts(allProducts.filter(p => p.name.toLowerCase().includes(currentFilter)));
    });
    
    productGrid.addEventListener('click', (event) => {
        const refreshButton = event.target.closest('[data-refresh-id]');
        if (refreshButton) {
            event.stopPropagation();
            handleImageRefresh(refreshButton.dataset.refreshId, refreshButton);
            return;
        }

        const card = event.target.closest('[data-product-id]');
        if (!card) return;
        const product = allProducts.find(p => p.id === card.dataset.productId);
        if (!product) return;
        const cartItem = cart.find(item => item.id === product.id);
        if (cartItem) { cartItem.quantity++; } else { cart.push({ ...product, quantity: 1 }); }
        renderCart();
    });

    cartItemsContainer.addEventListener('click', (event) => {
        const removeOneBtn = event.target.closest('.remove-one-btn');
        if (removeOneBtn) {
            const itemId = removeOneBtn.dataset.id;
            const itemIndex = cart.findIndex(item => item.id === itemId);
            if (itemIndex > -1) {
                cart[itemIndex].quantity--;
                if (cart[itemIndex].quantity === 0) {
                    cart.splice(itemIndex, 1);
                }
            }
            renderCart();
            return;
        }

        const removeItemBtn = event.target.closest('.remove-item-btn');
        if (removeItemBtn) {
            const itemId = removeItemBtn.dataset.id;
            cart = cart.filter(item => item.id !== itemId);
            renderCart();
            showToast("Producto eliminado del carrito.");
        }
    });

    clearCartBtn.addEventListener('click', () => {
        if (cart.length > 0 && confirm('¿Vaciar el carrito?')) {
            cart = [];
            renderCart();
            showToast("Carrito vaciado.");
        }
    });

    window.addEventListener('focus', () => {
        const storedRate = parseFloat(localStorage.getItem('exchangeRate') || '1.0');
        if (storedRate !== currentExchangeRate) {
            currentExchangeRate = storedRate;
            const currentFilter = searchInput.value.toLowerCase();
            renderProducts(allProducts.filter(p => p.name.toLowerCase().includes(currentFilter)));
            renderCart();
        }
    });

    // --- LÓGICA DEL MODAL DE ARTÍCULO PERSONALIZADO ---
    customItemBtn.addEventListener('click', () => {
        customItemModal.classList.remove('hidden');
        customItemModal.classList.add('flex');
        document.getElementById('custom-item-name').focus();
    });

    const closeModal = () => {
        customItemModal.classList.add('hidden');
        customItemModal.classList.remove('flex');
        customItemForm.reset();
    };

    cancelCustomItemBtn.addEventListener('click', closeModal);

    customItemPriceVesInput.addEventListener('input', () => {
        const vesValue = parseFloat(customItemPriceVesInput.value);
        if (!isNaN(vesValue) && currentExchangeRate > 0) {
            customItemPriceUsdInput.value = (vesValue / currentExchangeRate).toFixed(2);
        } else {
            customItemPriceUsdInput.value = '';
        }
    });

    customItemPriceUsdInput.addEventListener('input', () => {
        const usdValue = parseFloat(customItemPriceUsdInput.value);
        if (!isNaN(usdValue)) {
            customItemPriceVesInput.value = (usdValue * currentExchangeRate).toFixed(2);
        } else {
            customItemPriceVesInput.value = '';
        }
    });

    customItemForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = document.getElementById('custom-item-name').value;
        const price = parseFloat(document.getElementById('custom-item-price-usd').value);

        if (!name || isNaN(price) || price <= 0) {
            return showToast("Por favor, introduce una descripción y un precio válido.", true);
        }

        cart.push({ id: `custom-${Date.now()}`, name, price, quantity: 1 });
        renderCart();
        closeModal();
        showToast(`"${name}" añadido al carrito.`);
    });
    
    // --- INICIALIZACIÓN ---
    fetchInitialData();
});
