import { POS } from './pos.js';
import { Dashboard } from './dashboard.js';
import { SalesHistory } from './sales.js';
import { Settings } from './settings.js';
import { Customers } from './customers.js';
import { Products } from './products.js';

class App {
    constructor() {
        console.log('App initializing...');
        this.views = {
            pos: new POS(),
            dashboard: new Dashboard(),
            sales: new SalesHistory(),
            settings: new Settings(),
            customers: new Customers(),
            products: Products
        };
        this.currentView = 'pos';
        this.init();
    }

    init() {
        // Navigation
        document.querySelectorAll('[data-view]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const viewName = e.currentTarget.dataset.view;
                this.switchView(viewName);

                // Close mobile sidebar on selection
                if (window.innerWidth < 768) {
                    this.toggleSidebar(false);
                }
            });
        });

        // Mobile Menu Button
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                this.toggleSidebar(true);
            });
        }

        // Mobile Cart Button
        const mobileCartBtn = document.getElementById('mobile-cart-btn');
        if (mobileCartBtn) {
            mobileCartBtn.addEventListener('click', () => {
                this.toggleCart(true);
            });
        }

        // Close Cart Button (Mobile)
        const closeCartBtn = document.getElementById('close-cart-btn');
        if (closeCartBtn) {
            closeCartBtn.addEventListener('click', () => {
                this.toggleCart(false);
            });
        }

        // Overlay
        const overlay = document.getElementById('mobile-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => {
                this.toggleSidebar(false);
                this.toggleCart(false);
            });
        }

        // Initial view
        this.views.products.init();
        this.switchView('pos');
    }

    toggleSidebar(show) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobile-overlay');

        if (show) {
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
        } else {
            sidebar.classList.add('-translate-x-full');
            // Only hide overlay if cart is also closed
            const cartSidebar = document.getElementById('cart-sidebar');
            if (cartSidebar.classList.contains('translate-x-full')) {
                overlay.classList.add('hidden');
            }
        }
    }

    toggleCart(show) {
        const cartSidebar = document.getElementById('cart-sidebar');
        const overlay = document.getElementById('mobile-overlay');

        if (show) {
            cartSidebar.classList.remove('translate-x-full');
            overlay.classList.remove('hidden');
        } else {
            cartSidebar.classList.add('translate-x-full');
            // Only hide overlay if sidebar is also closed
            const sidebar = document.getElementById('sidebar');
            if (sidebar.classList.contains('-translate-x-full')) {
                overlay.classList.add('hidden');
            }
        }
    }

    switchView(viewName) {
        // Update Nav
        document.querySelectorAll('nav a').forEach(link => {
            if (link.dataset.view === viewName) {
                link.classList.add('bg-slate-800', 'text-white');
                link.classList.remove('text-slate-300', 'hover:bg-slate-800', 'hover:text-white');
            } else {
                link.classList.remove('bg-slate-800', 'text-white');
                link.classList.add('text-slate-300', 'hover:bg-slate-800', 'hover:text-white');
            }
        });

        // Hide all views
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.add('hidden');
        });

        // Show selected view
        const activeSection = document.getElementById(`view-${viewName}`);
        if (activeSection) {
            activeSection.classList.remove('hidden');
            // Trigger data load if needed
            if (viewName === 'dashboard') this.views.dashboard.loadData();
            if (viewName === 'sales') this.views.sales.loadSales();
            if (viewName === 'products') this.views.products.loadProducts();
            if (viewName === 'settings') this.views.settings.loadSettings();
        }

        this.currentView = viewName;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.app) return;
    window.app = new App();
});
