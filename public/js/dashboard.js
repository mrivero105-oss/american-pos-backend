import { api } from './api.js';
import { formatCurrency } from './utils.js';
import { ui } from './ui.js';

export class Dashboard {
    constructor() {
        this.chart = null;
        this.init();
    }

    async init() {
        this.cacheDOM();
        // We don't load data immediately, only when the view is active
    }

    cacheDOM() {
        this.dom = {
            totalRevenue: document.getElementById('total-revenue'),
            totalSales: document.getElementById('total-sales'),
            lowStockList: document.getElementById('low-stock-list'),
            chartCanvas: document.getElementById('sales-chart')
        };
    }

    async loadData() {
        try {
            const data = await api.dashboard.getSummary();
            this.renderSummary(data);
            this.renderChart(data.salesLast7Days);
        } catch (error) {
            ui.showNotification('Error loading dashboard data', 'error');
        }
    }

    renderSummary(data) {
        if (this.dom.totalRevenue) this.dom.totalRevenue.textContent = formatCurrency(data.totalRevenue);
        if (this.dom.totalSales) this.dom.totalSales.textContent = data.numberOfSales;

        if (this.dom.lowStockList) {
            this.dom.lowStockList.innerHTML = data.lowStockItems.map(item => `
                <li class="flex justify-between items-center p-3 bg-red-50 rounded-lg border border-red-100">
                    <span class="font-medium text-gray-800">${item.name}</span>
                    <span class="bg-red-100 text-red-800 text-xs font-bold px-2 py-1 rounded-full">${item.stock} left</span>
                </li>
            `).join('');

            if (data.lowStockItems.length === 0) {
                this.dom.lowStockList.innerHTML = '<p class="text-gray-500 text-center py-4">All items are well stocked!</p>';
            }
        }
    }

    renderChart(salesData) {
        if (!this.dom.chartCanvas) return;

        // Destroy existing chart if any
        if (this.chart) {
            this.chart.destroy();
        }

        const ctx = this.dom.chartCanvas.getContext('2d');

        // Check if Chart.js is loaded
        if (typeof Chart === 'undefined') {
            console.error('Chart.js not loaded');
            return;
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: salesData.labels,
                datasets: [{
                    label: 'Ventas ($)',
                    data: salesData.data,
                    borderColor: '#4F46E5', // Indigo 600
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#4F46E5',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#1F2937',
                        padding: 12,
                        titleFont: { size: 13 },
                        bodyFont: { size: 13 },
                        displayColors: false,
                        callbacks: {
                            label: (context) => formatCurrency(context.raw)
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#F3F4F6',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => '$' + value
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
}
