document.addEventListener('DOMContentLoaded', () => {
    // --- REFERENCIAS AL DOM ---
    const tableBody = document.getElementById('product-table-body');
    const loadingMessage = document.getElementById('loading');
    const productTable = document.getElementById('product-table');
    const addProductForm = document.getElementById('add-product-form');
    const searchInput = document.getElementById('search-input');
    const editModal = document.getElementById('edit-modal');
    const editForm = document.getElementById('edit-product-form');
    const closeModalBtn = document.querySelector('.close-btn');
    const exchangeRateInput = document.getElementById('exchange-rate-input');
    const saveRateBtn = document.getElementById('save-rate-btn');
    const updateImagesBtn = document.getElementById('update-images-btn');
    const updateImagesBtnText = document.getElementById('update-images-btn-text');
    const updateImagesBtnSpinner = document.getElementById('update-images-btn-spinner');
    const searchImageBtn = document.getElementById('search-image-btn');
    const scanBarcodeBtn = document.getElementById('scan-barcode-btn');

    // --- VARIABLES DE ESTADO ---
    let allProducts = [];
    const apiBaseUrl = 'http://localhost:3000';
    const productsApiUrl = `${apiBaseUrl}/products`;
    const rateApiUrl = `${apiBaseUrl}/settings/rate`;

    // --- FUNCIONES ---
    const showToast = (message, isError = false) => {
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: "right",
            style: {
                background: isError ? "#dc3545" : "#28a745",
            }
        }).showToast();
    };

    const renderTable = (products) => {
        tableBody.innerHTML = '';
        products.forEach((product, index) => {
            const row = document.createElement('tr');
            if (index % 2 !== 0) {
                row.className = 'bg-gray-50 dark:bg-gray-800';
            }

            const imageCell = document.createElement('td');
            imageCell.className = 'p-3';

            const fallbackDiv = document.createElement('div');
            fallbackDiv.className = 'w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-md';
            
            const isContentUri = product.imageUri && product.imageUri.startsWith('content://');

            if (product.imageUri && !isContentUri) {
                const img = document.createElement('img');
                img.src = product.imageUri;
                img.alt = product.name;
                img.className = 'w-12 h-12 object-cover rounded-md';
                img.onerror = () => {
                    if (img.parentNode) {
                        img.parentNode.replaceChild(fallbackDiv, img);
                    }
                };
                imageCell.appendChild(img);
            } else {
                imageCell.appendChild(fallbackDiv);
            }

            row.appendChild(imageCell);
            
            const restOfRow = `
                <td class="p-3 font-medium">${product.name}</td>
                <td class="p-3 text-sm max-w-xs truncate" title="${product.description || ''}">${product.description || ''}</td>
                <td class="p-3 text-sm">${product.category}</td>
                <td class="p-3 text-sm">$${parseFloat(product.price).toFixed(2)}</td>
                <td class="p-3 text-sm">${product.stockQuantity}</td>
                <td class="p-3">
                    <button class="edit-btn text-blue-600 hover:text-blue-800 font-medium text-sm" data-id="${product.id}">Editar</button>
                    <button class="delete-btn text-red-600 hover:text-red-800 font-medium text-sm ml-2" data-id="${product.id}">Borrar</button>
                </td>
            `;
            row.insertAdjacentHTML('beforeend', restOfRow);

            tableBody.appendChild(row);
        });
    };

    const fetchProducts = async () => {
        try {
            const response = await fetch(productsApiUrl);
            if (!response.ok) throw new Error('Error del servidor.');
            allProducts = await response.json();
            loadingMessage.style.display = 'none';
            productTable.style.display = 'table';
            renderTable(allProducts);
        } catch (error) { showToast("Error al cargar productos.", true); }
    };

    const fetchExchangeRate = async () => {
        try {
            const response = await fetch(rateApiUrl);
            const data = await response.json();
            exchangeRateInput.value = data.rate;
        } catch (error) { showToast('Error al cargar la tasa.', true); }
    };

    const saveExchangeRate = async () => {
        try {
            const newRate = exchangeRateInput.value;
            await fetch(rateApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rate: newRate }) });
            localStorage.setItem('exchangeRate', newRate);
            showToast('Tasa guardada.');
        } catch (error) { showToast('Error al guardar la tasa.', true); }
    };
    
    // Función para manejar el resultado del escáner
    window.setBarcode = (barcode) => {
        const barcodeInput = document.getElementById('edit-barcode');
        if (barcodeInput) {
            barcodeInput.value = barcode;
        }
    };

    // --- EVENT LISTENERS ---
    addProductForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(addProductForm);
        const newProduct = {
            name: formData.get('name'),
            price: parseFloat(formData.get('price')),
            category: formData.get('category'),
            stockQuantity: parseInt(formData.get('stockQuantity')),
            description: formData.get('description'),
            imageUri: formData.get('imageUri'),
            barcode: formData.get('barcode')
        };
        try {
            await fetch(productsApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProduct) });
            addProductForm.reset(); fetchProducts(); showToast("Producto añadido.");
        } catch (error) { showToast("No se pudo crear el producto.", true); }
    });

    tableBody.addEventListener('click', async (event) => {
        const productId = event.target.dataset.id;
        if (event.target.classList.contains('delete-btn')) {
            if (!confirm('¿Borrar?')) return;
            try { await fetch(`${productsApiUrl}/${productId}`, { method: 'DELETE' }); fetchProducts(); showToast("Producto borrado."); }
            catch (error) { showToast("Error al borrar.", true); }
        }
        if (event.target.classList.contains('edit-btn')) {
            const product = allProducts.find(p => p.id === productId);
            if (product) {
                document.getElementById('edit-id').value = product.id;
                document.getElementById('edit-name').value = product.name;
                document.getElementById('edit-price').value = product.price;
                document.getElementById('edit-category').value = product.category || '';
                document.getElementById('edit-stockQuantity').value = product.stockQuantity;
                document.getElementById('edit-description').value = product.description || '';
                document.getElementById('edit-imageUri').value = product.imageUri || '';
                document.getElementById('edit-barcode').value = product.barcode || '';
                editModal.style.display = 'block';
            }
        }
    });

    editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(editForm);
        const productId = formData.get('id');
        const updatedData = {
            name: formData.get('name'),
            price: parseFloat(formData.get('price')),
            category: formData.get('category'),
            stockQuantity: parseInt(formData.get('stockQuantity')),
            description: formData.get('description'),
            imageUri: formData.get('imageUri'),
            barcode: formData.get('barcode')
        };
        try {
            await fetch(`${productsApiUrl}/${productId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) });
            editModal.style.display = 'none'; fetchProducts(); showToast("Producto actualizado.");
        } catch (error) { showToast("Error al actualizar.", true); }
    });

    searchImageBtn.addEventListener('click', () => {
        const productName = document.getElementById('edit-name').value;
        if (productName) {
            const googleImagesUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(productName)}`;
            window.open(googleImagesUrl, '_blank');
        } else {
            showToast('Escribe un nombre de producto primero.', true);
        }
    });

    scanBarcodeBtn.addEventListener('click', () => {
        // Navegar a la pantalla de escáner nativa
        window.location.href = '/scanner';
    });

    updateImagesBtn.addEventListener('click', async () => {
        updateImagesBtn.disabled = true;
        updateImagesBtnText.classList.add('hidden');
        updateImagesBtnSpinner.classList.remove('hidden');
        try {
            const response = await fetch(`${apiBaseUrl}/products/update-images`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Error en el servidor.');

            if (result.updatedCount > 0) {
                showToast(`¡Se actualizaron ${result.updatedCount} imágenes!`);
                fetchProducts();
            } else {
                showToast("No se encontraron productos sin imagen.");
            }
        } catch (error) {
            showToast(error.message, true);
        } finally {
            updateImagesBtn.disabled = false;
            updateImagesBtnText.classList.remove('hidden');
            updateImagesBtnSpinner.classList.add('hidden');
        }
    });
    
    searchInput.addEventListener('input', () => renderTable(allProducts.filter(p => p.name.toLowerCase().includes(searchInput.value.toLowerCase()))));
    saveRateBtn.addEventListener('click', saveExchangeRate);
    closeModalBtn.onclick = () => { editModal.style.display = 'none'; };
    window.onclick = (event) => { if (event.target == editModal) editModal.style.display = 'none'; };
    
    // --- INICIALIZACIÓN ---
    fetchProducts();
    fetchExchangeRate();
});