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
            searchInput: document.getElementById('sales-search-input'),
            modal: document.getElementById('sale-details-modal'),
            modalContent: document.getElementById('sale-details-content'),
            closeModalBtn: document.getElementById('close-sale-modal')
        };
    }

    bindEvents() {
        this.dom.dateFilter?.addEventListener('change', (e) => this.loadSales(e.target.value));
        this.dom.searchInput?.addEventListener('input', (e) => this.filterSales(e.target.value));
        this.dom.closeModalBtn?.addEventListener('click', () => ui.toggleModal('sale-details-modal', false));

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === this.dom.modal) {
                ui.toggleModal('sale-details-modal', false);
            }
        });

        // Event delegation for table actions
        this.dom.salesTableBody?.addEventListener('click', (e) => {
            const btn = e.target.closest('.view-receipt-btn');

            if (btn) {
                e.stopPropagation();
                const saleId = btn.dataset.id;
                const sale = this.sales.find(s => String(s.id) === String(saleId));
                if (sale) this.showDetails(sale);
            }
        });
    }

    async loadSales(date = null) {
        try {
            this.sales = await api.sales.getAll(date);
            this.currentFilteredSales = this.sales; // Store for filtering
            this.renderSales(this.sales);
        } catch (error) {
            console.error('Error loading sales:', error);
            ui.showNotification('Error loading sales history', 'error');
        }
    }

    renderSales(sales) {
        if (!this.dom.salesTableBody) return;

        if (sales.length === 0) {
            this.dom.salesTableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">No se encontraron ventas.</td></tr>';
            return;
        }

        this.dom.salesTableBody.innerHTML = sales.map(sale => `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors" data-id="${sale.id || ''}">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${formatDate(sale.timestamp.toDate ? sale.timestamp.toDate() : sale.timestamp)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${(sale.id || '-----').slice(0, 8)}...
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-slate-900 dark:text-white">${sale.customer?.name || 'Cliente Casual'}</div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">${sale.customer?.idDocument || ''}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${sale.items.length} items
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-indigo-600">
                    ${formatCurrency(sale.total)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button data-id="${sale.id}" class="view-receipt-btn text-slate-400 dark:text-slate-300 hover:text-blue-600 transition-colors p-1 rounded-full hover:bg-blue-50" title="Ver Recibo">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    showDetails(sale) {
        if (!this.dom.modalContent) return;

        const itemsHtml = sale.items.map(item => `
            <div class="flex justify-between py-2 border-b border-gray-100 dark:border-slate-700 last:border-0">
                <div>
                    <p class="font-medium text-gray-800 dark:text-white">${item.name}</p>
                    <p class="text-xs text-gray-500 dark:text-slate-400">${item.quantity} x ${formatCurrency(item.price)}</p>
                </div>
                <span class="font-medium text-gray-800 dark:text-white">${formatCurrency(item.price * item.quantity)}</span>
            </div>
        `).join('');

        this.dom.modalContent.innerHTML = `
            <div class="mb-4">
                <p class="text-sm text-gray-500 dark:text-slate-400">ID Venta: ${sale.id}</p>
                <p class="text-sm text-gray-500 dark:text-slate-400">Fecha: ${formatDate(sale.timestamp.toDate ? sale.timestamp.toDate() : sale.timestamp)}</p>
            </div>
            <div class="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4 mb-4">
                ${itemsHtml}
            </div>
            <div class="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-slate-700">
                <span class="font-bold text-lg text-slate-900 dark:text-white">Total</span>
                <span class="font-bold text-xl text-indigo-600 dark:text-indigo-400">${formatCurrency(sale.total)}</span>
            </div>
        `;

        ui.toggleModal('sale-details-modal', true);
    }

    filterSales(query) {
        if (!query) {
            this.renderSales(this.sales);
            return;
        }

        const lowerQuery = query.toLowerCase();
        const filtered = this.sales.filter(sale => {
            const docMatch = sale.customer?.idDocument?.toLowerCase().includes(lowerQuery);
            const nameMatch = sale.customer?.name?.toLowerCase().includes(lowerQuery);
            const itemMatch = sale.items.some(item => item.name.toLowerCase().includes(lowerQuery));
            const idMatch = sale.id.toLowerCase().includes(lowerQuery);

            return docMatch || nameMatch || itemMatch || idMatch;
        });

        this.renderSales(filtered);
    }
}
