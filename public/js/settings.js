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
            paymentMethodsSelect: document.getElementById('payment-methods-settings-select'),
            deleteMethodBtn: document.getElementById('delete-payment-method-btn'),
            newPaymentMethodName: document.getElementById('new-payment-method-name'),
            newPaymentMethodCurrency: document.getElementById('new-payment-method-currency'),
            newPaymentMethodRequiresRef: document.getElementById('new-payment-method-requires-ref'),
            addPaymentMethodBtn: document.getElementById('add-payment-method-btn'),
            // Backup
            downloadBackupBtn: document.getElementById('download-backup-btn'),
            restoreBackupBtn: document.getElementById('restore-backup-btn'),
            restoreFileInput: document.getElementById('restore-file-input')
        };
    }

    bindEvents() {
        this.dom.saveRateBtn?.addEventListener('click', () => this.saveRate());
        this.dom.saveBusinessBtn?.addEventListener('click', () => this.saveBusinessInfo());
        this.dom.addPaymentMethodBtn?.addEventListener('click', () => this.addPaymentMethod());
        this.dom.deleteMethodBtn?.addEventListener('click', () => {
            const id = this.dom.paymentMethodsSelect?.value;
            if (id) this.deletePaymentMethod(id);
        });

        // Backup events
        this.dom.downloadBackupBtn?.addEventListener('click', () => this.createBackup());
        this.dom.restoreBackupBtn?.addEventListener('click', () => this.dom.restoreFileInput?.click());
        this.dom.restoreFileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.restoreBackup(e.target.files[0]);
            }
        });

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
        if (!this.dom.paymentMethodsSelect) return;

        this.dom.paymentMethodsSelect.innerHTML = this.paymentMethods.map(method => `
            <option value="${method.id}">
                ${method.name} ${method.requiresReference ? '(Requiere Ref.)' : ''}
            </option>
        `).join('');
    }

    async addPaymentMethod() {
        const name = this.dom.newPaymentMethodName?.value.trim();
        const currency = this.dom.newPaymentMethodCurrency?.value || 'USD';
        const requiresReference = this.dom.newPaymentMethodRequiresRef?.checked;

        if (!name) {
            ui.showNotification('El nombre es requerido', 'warning');
            return;
        }

        const newMethod = {
            id: name.toLowerCase().replace(/\s+/g, '-'),
            name: name,
            currency: currency,
            type: 'custom',
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

    // --- BACKUP & RESTORE ---
    async createBackup() {
        try {
            this.dom.downloadBackupBtn.disabled = true;
            this.dom.downloadBackupBtn.textContent = 'Generando...';

            const data = await api.backup.create();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_pos_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            ui.showNotification('Copia de seguridad descargada');
        } catch (error) {
            console.error('Error creating backup:', error);
            ui.showNotification('Error al crear copia de seguridad', 'error');
        } finally {
            this.dom.downloadBackupBtn.disabled = false;
            this.dom.downloadBackupBtn.innerHTML = `
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                </svg>
                Descargar Copia
            `;
        }
    }

    async restoreBackup(file) {
        if (!confirm('ADVERTENCIA: Esto sobrescribirá todos los datos actuales. Se creará una copia de seguridad automática antes de proceder. ¿Estás seguro?')) {
            this.dom.restoreFileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backupData = JSON.parse(e.target.result);

                this.dom.restoreBackupBtn.disabled = true;
                this.dom.restoreBackupBtn.textContent = 'Restaurando...';

                await api.backup.restore(backupData);

                alert('Restauración completada con éxito. La página se recargará.');
                window.location.reload();
            } catch (error) {
                console.error('Error restoring backup:', error);
                ui.showNotification('Error al restaurar: Archivo inválido o corrupto', 'error');
                this.dom.restoreBackupBtn.disabled = false;
                this.dom.restoreBackupBtn.innerHTML = `
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                    </svg>
                    Restaurar Copia
                `;
            }
        };
        reader.readAsText(file);
    }
}
