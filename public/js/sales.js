import { api } from './api.js';
import { formatCurrency, formatDate } from './utils.js';
import { ui } from './ui.js';

export class SalesHistory {
    constructor() {
        this.init();
    }

    init() {
        this.cacheDOM();
        this.bindEvents();
    }

    cacheDOM() {
        this.dom = {
            salesTableBody: document.getElementById('sales-table-body'),
            dateFilter: document.getElementById('sales-date-filter'),
            modal: document.getElementById('sale-details-modal'),
            modalContent: document.getElementById('sale-details-content'),
            closeModalBtn: document.getElementById('close-sale-modal')
        };
    }

    bindEvents() {
        this.dom.dateFilter?.addEventListener('change', (e) => this.loadSales(e.target.value));
        this.dom.closeModalBtn?.addEventListener('click', () => ui.toggleModal('sale-details-modal', false));

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === this.dom.modal) {
                ui.toggleModal('sale-details-modal', false);
            }
        });
    }

    async loadSales(date = null) {
        try {
            const sales = await api.sales.getAll(date);
            this.renderSales(sales);
        } catch (error) {
            console.error('Error loading sales:', error);
            ui.showNotification('Error loading sales history', 'error');
        }
    }

    renderSales(sales) {
        if (!this.dom.salesTableBody) return;

        if (sales.length === 0) {
            this.dom.salesTableBody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-500">No se encontraron ventas.</td></tr>';
            return;
        }

        this.dom.salesTableBody.innerHTML = sales.map(sale => `
            <tr class="hover:bg-gray-50 transition-colors cursor-pointer" onclick="window.viewSaleDetails('${sale.id || ''}')">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${formatDate(sale.timestamp.toDate ? sale.timestamp.toDate() : sale.timestamp)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${(sale.id || '-----').slice(0, 8)}...
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${sale.items.length} items
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-indigo-600">
                    ${formatCurrency(sale.total)}
                </td>
            </tr>
        `).join('');

        // Expose helper for the onclick handler (temporary hack until we have a better event delegation)
        window.viewSaleDetails = (saleId) => {
            const sale = sales.find(s => s.id === saleId);
            if (sale) this.showDetails(sale);
        };
    }

    showDetails(sale) {
        if (!this.dom.modalContent) return;

        const itemsHtml = sale.items.map(item => `
            <div class="flex justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                    <p class="font-medium text-gray-800">${item.name}</p>
                    <p class="text-xs text-gray-500">${item.quantity} x ${formatCurrency(item.price)}</p>
                </div>
                <span class="font-medium text-gray-800">${formatCurrency(item.price * item.quantity)}</span>
            </div>
        `).join('');

        this.dom.modalContent.innerHTML = `
            <div class="mb-4">
                <p class="text-sm text-gray-500">ID Venta: ${sale.id}</p>
                <p class="text-sm text-gray-500">Fecha: ${formatDate(sale.timestamp.toDate ? sale.timestamp.toDate() : sale.timestamp)}</p>
            </div>
            <div class="bg-gray-50 rounded-lg p-4 mb-4">
                ${itemsHtml}
            </div>
            <div class="flex justify-between items-center pt-4 border-t border-gray-200">
                <span class="font-bold text-lg">Total</span>
                <span class="font-bold text-xl text-indigo-600">${formatCurrency(sale.total)}</span>
            </div>
        `;

        ui.toggleModal('sale-details-modal', true);
    }
}
