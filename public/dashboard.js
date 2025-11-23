document.addEventListener('DOMContentLoaded', () => {
    const dateFilter = document.getElementById('date-filter');
    const totalRevenueEl = document.getElementById('total-revenue');
    const totalProfitEl = document.getElementById('total-profit');
    const numberOfSalesEl = document.getElementById('number-of-sales');
    const lowStockListEl = document.getElementById('low-stock-items');
    let salesChart = null; // Guardar la instancia del gráfico para destruirla después

    const fetchDashboardData = async (date) => {
        // Resetear el estado de carga
        totalRevenueEl.textContent = 'Cargando...';
        totalProfitEl.textContent = 'Cargando...';
        numberOfSalesEl.textContent = 'Cargando...';
        lowStockListEl.innerHTML = '<li>Cargando...</li>';

        try {
            let url = '/dashboard-summary';
            if (date) {
                url += `?date=${date}`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error('Error de red.');
            const data = await response.json();

            totalRevenueEl.textContent = `$${data.totalRevenue.toFixed(2)}`;
            totalProfitEl.textContent = `$${data.totalProfit.toFixed(2)}`;
            numberOfSalesEl.textContent = data.numberOfSales;
            
            lowStockListEl.innerHTML = '';
            if (data.lowStockItems.length === 0) {
                lowStockListEl.innerHTML = '<li>No hay productos con bajo stock.</li>';
            } else {
                data.lowStockItems.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'flex justify-between';
                    li.innerHTML = `<span>${item.name}</span> <span class="font-bold text-red-500">${item.stock}</span>`;
                    lowStockListEl.appendChild(li);
                });
            }

            // Destruir el gráfico anterior si existe
            if (salesChart) {
                salesChart.destroy();
            }

            const ctx = document.getElementById('salesChart').getContext('2d');
            salesChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.salesLast7Days.labels,
                    datasets: [{
                        label: 'Ventas ($)',
                        data: data.salesLast7Days.data,
                        backgroundColor: 'rgba(59, 130, 246, 0.5)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151'
                            }
                        },
                        x: {
                            ticks: {
                                color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: {
                                color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151'
                            }
                        }
                    }
                }
            });

        } catch (error) {
            console.error("Error al cargar datos del dashboard:", error);
            totalRevenueEl.textContent = 'Error';
            totalProfitEl.textContent = 'Error';
            numberOfSalesEl.textContent = 'Error';
            lowStockListEl.innerHTML = '<li class="text-red-500">No se pudieron cargar los datos.</li>';
        }
    };

    dateFilter.addEventListener('change', (event) => {
        fetchDashboardData(event.target.value);
    });

    // Carga inicial con la fecha de hoy
    const today = new Date().toISOString().split('T')[0];
    dateFilter.value = today;
    fetchDashboardData(today);
});
