import { api } from './api.js';
import { ui } from './ui.js';

export class Customers {
    constructor() {
        this.customers = [];
        this.editingCustomerId = null;
        this.init();
    }

    async init() {
        this.cacheDOM();
        this.bindEvents();
        await this.loadCustomers();
    }

    cacheDOM() {
        this.dom = {
            customersList: document.getElementById('customers-list'),
            searchCustomer: document.getElementById('search-customer'),
            addCustomerBtn: document.getElementById('add-customer-btn'),
            customerFormModal: document.getElementById('customer-form-modal'),
            customerForm: document.getElementById('customer-form'),
            closeModalBtn: document.getElementById('close-customer-modal'),
            modalTitle: document.getElementById('customer-modal-title'),
            cancelFormBtn: document.getElementById('cancel-customer-form')
        };
    }

    bindEvents() {
        this.dom.searchCustomer?.addEventListener('input', (e) => this.filterCustomers(e.target.value));
        this.dom.addCustomerBtn?.addEventListener('click', () => this.showAddForm());
        this.dom.closeModalBtn?.addEventListener('click', () => this.closeModal());
        this.dom.cancelFormBtn?.addEventListener('click', () => this.closeModal());
        this.dom.customerForm?.addEventListener('submit', (e) => this.handleFormSubmit(e));
        this.dom.customersList?.addEventListener('click', (e) => this.handleListClick(e));
    }

    async loadCustomers() {
        try {
            this.customers = await api.customers.getAll();
            this.renderCustomers(this.customers);
        } catch (error) {
            ui.showNotification('Error al cargar clientes', 'error');
        }
    }

    renderCustomers(customers) {
        if (!this.dom.customersList) return;

        if (customers.length === 0) {
            this.dom.customersList.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-8 text-center text-slate-500">
                        No hay clientes registrados
                    </td>
                </tr>
            `;
            return;
        }

        this.dom.customersList.innerHTML = customers.map(customer => `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-slate-900">${customer.name}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-slate-600">${customer.phone}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-slate-600">${customer.email || '-'}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-slate-600">${customer.idDocument || '-'}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button class="edit-customer text-blue-600 hover:text-blue-900 mr-4" data-id="${customer.id}">
                        Editar
                    </button>
                    <button class="delete-customer text-red-600 hover:text-red-900" data-id="${customer.id}">
                        Eliminar
                    </button>
                </td>
            </tr>
        `).join('');
    }

    filterCustomers(query) {
        const filtered = this.customers.filter(c =>
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.phone.includes(query) ||
            (c.email && c.email.toLowerCase().includes(query.toLowerCase()))
        );
        this.renderCustomers(filtered);
    }

    showAddForm() {
        this.editingCustomerId = null;
        this.dom.modalTitle.textContent = 'Agregar Cliente';
        this.dom.customerForm.reset();
        this.dom.customerFormModal.classList.remove('hidden');
    }

    showEditForm(customerId) {
        const customer = this.customers.find(c => c.id === customerId);
        if (!customer) return;

        this.editingCustomerId = customerId;
        this.dom.modalTitle.textContent = 'Editar Cliente';

        document.getElementById('customer-name').value = customer.name;
        document.getElementById('customer-phone').value = customer.phone;
        document.getElementById('customer-email').value = customer.email || '';
        document.getElementById('customer-address').value = customer.address || '';
        document.getElementById('customer-id-document').value = customer.idDocument || '';

        this.dom.customerFormModal.classList.remove('hidden');
    }

    closeModal() {
        this.dom.customerFormModal.classList.add('hidden');
        this.dom.customerForm.reset();
        this.editingCustomerId = null;
    }

    async handleFormSubmit(e) {
        e.preventDefault();

        const customerData = {
            name: document.getElementById('customer-name').value,
            phone: document.getElementById('customer-phone').value,
            email: document.getElementById('customer-email').value,
            address: document.getElementById('customer-address').value,
            idDocument: document.getElementById('customer-id-document').value
        };

        try {
            if (this.editingCustomerId) {
                await api.customers.update(this.editingCustomerId, customerData);
                ui.showNotification('Cliente actualizado');
            } else {
                await api.customers.create(customerData);
                ui.showNotification('Cliente agregado');
            }

            await this.loadCustomers();
            this.closeModal();
        } catch (error) {
            ui.showNotification(error.message, 'error');
        }
    }

    async handleDelete(customerId) {
        if (!confirm('¿Estás seguro de eliminar este cliente?')) return;

        try {
            await api.customers.delete(customerId);
            ui.showNotification('Cliente eliminado');
            await this.loadCustomers();
        } catch (error) {
            ui.showNotification(error.message, 'error');
        }
    }

    handleListClick(e) {
        const target = e.target;

        if (target.classList.contains('edit-customer')) {
            const id = target.dataset.id;
            this.showEditForm(id);
        } else if (target.classList.contains('delete-customer')) {
            const id = target.dataset.id;
            this.handleDelete(id);
        }
    }
}
