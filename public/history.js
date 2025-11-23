document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('history-table-body');
    const loadingMessage = document.getElementById('loading');
    const dateFilter = document.getElementById('date-filter');

    const fetchHistory = async (date) => {
        loadingMessage.style.display = 'block';
        loadingMessage.textContent = 'Cargando historial...';
        tableBody.innerHTML = '';

        try {
            let url = '/sales';
            if (date) {
                url += `?date=${date}`;
            }
            const response = await fetch(url);
            if (!response.ok) throw new Error('Error de red.');
            const sales = await response.json();

            loadingMessage.style.display = 'none';
            document.getElementById('history-table').style.display = 'table';
            
            if (sales.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-4">No hay ventas para la fecha seleccionada.</td></tr>';
                return;
            }

            sales.forEach(sale => {
                const row = document.createElement('tr');
                // Firestore timestamp puede venir en distintos formatos, nos aseguramos de manejarlo
                const saleTimestamp = sale.timestamp._seconds ? sale.timestamp._seconds * 1000 : sale.timestamp;
                const saleDate = new Date(saleTimestamp);
                
                const formattedDate = saleDate.toLocaleString('es-ES', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                const itemsHtml = sale.items.map(item => `<li>${item.quantity} x ${item.name}</li>`).join('');
                
                row.innerHTML = `
                    <td class="p-3 text-xs align-top">${sale.id}</td>
                    <td class="p-3 text-sm align-top">${formattedDate}</td>
                    <td class="p-3 text-sm align-top"><ul class="list-disc list-inside">${itemsHtml}</ul></td>
                    <td class="p-3 font-bold text-sm align-top">$${parseFloat(sale.total).toFixed(2)}</td>`;
                tableBody.appendChild(row);
            });
        } catch (error) {
            loadingMessage.textContent = 'Error al cargar el historial.';
            loadingMessage.classList.add('text-red-500');
        }
    };

    dateFilter.addEventListener('change', (event) => {
        fetchHistory(event.target.value);
    });

    // Carga inicial con la fecha de hoy
    const today = new Date().toISOString().split('T')[0];
    dateFilter.value = today;
    fetchHistory(today);
});
