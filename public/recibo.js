document.addEventListener('DOMContentLoaded', () => {
    const receiptDate = document.getElementById('receipt-date');
    const receiptItems = document.getElementById('receipt-items');
    const receiptTotal = document.getElementById('receipt-total');
    const receiptTotalLocal = document.getElementById('receipt-total-local');
    const printBtn = document.getElementById('print-btn');

    const fetchReceiptData = async () => {
        const params = new URLSearchParams(window.location.search);
        const saleId = params.get('id');

        if (!saleId) {
            receiptItems.innerHTML = '<p class="text-red-500">Error: No se ha especificado un ID de venta.</p>';
            return;
        }

        try {
            const response = await fetch(`/sales/${saleId}`);
            if (!response.ok) {
                throw new Error('No se pudo encontrar la venta.');
            }
            const { sale, exchangeRate } = await response.json();

            const saleDate = new Date(sale.timestamp._seconds * 1000);
            receiptDate.textContent = saleDate.toLocaleString('es-ES', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            receiptItems.innerHTML = sale.items.map(item => `
                <div class="flex justify-between">
                    <span>${item.quantity}x ${item.name}</span>
                    <span>$${(item.price * item.quantity).toFixed(2)}</span>
                </div>
            `).join('');

            receiptTotal.textContent = `$${sale.total.toFixed(2)}`;
            receiptTotalLocal.textContent = `Bs. ${(sale.total * exchangeRate).toFixed(2)}`;

        } catch (error) {
            receiptItems.innerHTML = `<p class="text-red-500">${error.message}</p>`;
        }
    };

    printBtn.addEventListener('click', () => {
        window.print();
    });

    fetchReceiptData();
});