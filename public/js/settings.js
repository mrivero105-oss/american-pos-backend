import { api } from './api.js';
import { ui } from './ui.js';

export class Settings {
    constructor() {
        this.init();
    }

    init() {
        this.cacheDOM();
        this.bindEvents();
    }

    cacheDOM() {
        this.dom = {
            rateInput: document.getElementById('exchange-rate-input'),
            saveRateBtn: document.getElementById('save-rate-btn'),
            // Business Info
            businessName: document.getElementById('business-name'),
            businessAddress: document.getElementById('business-address'),
            businessPhone: document.getElementById('business-phone'),
            businessTaxId: document.getElementById('business-tax-id'),
            businessLogo: document.getElementById('business-logo'),
            saveBusinessBtn: document.getElementById('save-business-btn'),
            // Payment Methods
            paymentMethodsList: document.getElementById('payment-methods-list'),
            newPaymentMethodName: document.getElementById('new-payment-method-name'),
            newPaymentMethodRequiresRef: document.getElementById('new-payment-method-requires-ref'),
            addPaymentMethodBtn: document.getElementById('add-payment-method-btn')
        };
    }

    bindEvents() {
        this.dom.saveRateBtn?.addEventListener('click', () => this.saveRate());
        this.dom.saveBusinessBtn?.addEventListener('click', () => this.saveBusinessInfo());
        this.dom.addPaymentMethodBtn?.addEventListener('click', () => this.addPaymentMethod());

        // Initialize payment methods array
        this.paymentMethods = [];
    }

    async loadSettings() {
        try {
            const [rateData, businessData, paymentMethods] = await Promise.all([
                api.settings.getRate(),
                api.settings.getBusinessInfo(),
                api.settings.getPaymentMethods()
            ]);

            if (this.dom.rateInput) {
                this.dom.rateInput.value = rateData.rate;
            }

            if (this.dom.businessName) {
                this.dom.businessName.value = businessData.name || '';
            }
            if (this.dom.businessAddress) {
                this.dom.businessAddress.value = businessData.address || '';
            }
            if (this.dom.businessPhone) {
                this.dom.businessPhone.value = businessData.phone || '';
            }
            if (this.dom.businessTaxId) {
                this.dom.businessTaxId.value = businessData.taxId || '';
            }
            if (this.dom.businessLogo) {
                this.dom.businessLogo.value = businessData.logoUrl || '';
            }

            // Store payment methods locally and render
            this.paymentMethods = paymentMethods || [];
            this.renderPaymentMethods();
        } catch (error) {
            console.error('Error loading settings:', error);
            ui.showNotification('Error loading settings', 'error');
        }
    }

    async saveRate() {
        if (this.dom.saveRateBtn.disabled) return;

        const rate = parseFloat(this.dom.rateInput?.value);
        if (!rate || rate <= 0) {
            ui.showNotification('Please enter a valid rate', 'error');
            return;
        }

        this.dom.saveRateBtn.disabled = true;
        this.dom.saveRateBtn.textContent = 'Guardando...';

        try {
            await api.settings.updateRate(rate);
            ui.showNotification('Tasa actualizada correctamente');
            // Trigger an event or callback to update POS if needed
            try {
                if (window.app && window.app.views.pos) {
                    window.app.views.pos.updateExchangeRate(rate);
                }
            } catch (posError) {
                console.error('Error updating POS with new rate:', posError);
            }
        } catch (error) {
            ui.showNotification('Error saving rate', 'error');
        } finally {
            this.dom.saveRateBtn.disabled = false;
            this.dom.saveRateBtn.textContent = 'Guardar Tasa';
        }
    }

    async saveBusinessInfo() {
        if (this.dom.saveBusinessBtn.disabled) return;

        const info = {
            name: this.dom.businessName?.value.trim(),
            address: this.dom.businessAddress?.value.trim(),
            phone: this.dom.businessPhone?.value.trim(),
            taxId: this.dom.businessTaxId?.value.trim(),
            logoUrl: this.dom.businessLogo?.value.trim()
        };

        this.dom.saveBusinessBtn.disabled = true;
        this.dom.saveBusinessBtn.textContent = 'Guardando...';

        try {
            await api.settings.updateBusinessInfo(info);
            ui.showNotification('Información del negocio actualizada');
        } catch (error) {
            ui.showNotification('Error saving business info', 'error');
        } finally {
            this.dom.saveBusinessBtn.disabled = false;
            this.dom.saveBusinessBtn.textContent = 'Guardar Información';
        }
    }

    renderPaymentMethods() {
        if (!this.dom.paymentMethodsList) return;

        this.dom.paymentMethodsList.innerHTML = this.paymentMethods.map(method => `
            <tr>
                <td class="px-4 py-2 whitespace-nowrap text-sm text-slate-900">${method.name}</td>
                <td class="px-4 py-2 whitespace-nowrap text-sm text-slate-500">
                    ${method.requiresReference ?
                '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Sí</span>' :
                '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-800">No</span>'}
                </td>
                <td class="px-4 py-2 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-red-600 hover:text-red-900 delete-method-btn" data-id="${method.id}">
                        Eliminar
                    </button>
                </td>
            </tr>
        `).join('');

        // Re-bind delete events
        this.dom.paymentMethodsList.querySelectorAll('.delete-method-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.deletePaymentMethod(id);
            });
        });
    }

    async addPaymentMethod() {
        const name = this.dom.newPaymentMethodName?.value.trim();
        const requiresReference = this.dom.newPaymentMethodRequiresRef?.checked;

        if (!name) {
            ui.showNotification('El nombre es requerido', 'warning');
            return;
        }

        const newMethod = {
            id: name.toLowerCase().replace(/\s+/g, '-'),
            name: name,
            requiresReference: requiresReference
        };

        // Check for duplicates
        if (this.paymentMethods.some(m => m.id === newMethod.id)) {
            ui.showNotification('Este método de pago ya existe', 'warning');
            return;
        }

        this.paymentMethods.push(newMethod);

        try {
            await api.settings.updatePaymentMethods(this.paymentMethods);
            this.renderPaymentMethods();

            // Clear inputs
            this.dom.newPaymentMethodName.value = '';
            this.dom.newPaymentMethodRequiresRef.checked = false;

            ui.showNotification('Método de pago agregado');
        } catch (error) {
            console.error('Error adding payment method:', error);
            ui.showNotification('Error al agregar método de pago', 'error');
            // Revert
            this.paymentMethods.pop();
        }
    }

    async deletePaymentMethod(id) {
        if (!confirm('¿Estás seguro de eliminar este método de pago?')) return;

        const originalMethods = [...this.paymentMethods];
        this.paymentMethods = this.paymentMethods.filter(m => m.id !== id);

        try {
            await api.settings.updatePaymentMethods(this.paymentMethods);
            this.renderPaymentMethods();
            ui.showNotification('Método de pago eliminado');
        } catch (error) {
            console.error('Error deleting payment method:', error);
            ui.showNotification('Error al eliminar método de pago', 'error');
            // Revert
            this.paymentMethods = originalMethods;
            this.renderPaymentMethods();
        }
    }
}
