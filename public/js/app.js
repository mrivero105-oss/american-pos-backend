import { POS } from './pos.v3.js?v=192';
import { Dashboard } from './dashboard.js?v=192';
import { SalesHistory } from './sales.js?v=192';
import { Settings } from './settings.js?v=192';
import { Customers } from './customers.js?v=192';
import { Products } from './products.js?v=192';
import { authService } from './auth.js?v=192';

const APP_VERSION = 'v192';

class App {
    constructor() {
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

    async init() {
        // Check Authentication
        if (!authService.isAuthenticated()) {
            window.location.href = 'login.html';
            return;
        }

        // Navigation
        const navLinks = document.querySelectorAll('[data-view]');
        console.log('Found nav links:', navLinks.length);

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                console.log('Nav link clicked:', e.currentTarget.dataset.view);
                e.preventDefault();
                const viewName = e.currentTarget.dataset.view;
                this.switchView(viewName);

                // Close mobile sidebar on selection
                if (window.innerWidth < 768) {
                    this.toggleSidebar(false);
                }
            });
        });

        // Logout Button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                if (confirm('¿Estás seguro de que deseas cerrar sesión?')) {
                    await authService.logout();
                }
            });
        }

        // Mobile Menu Button
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                this.toggleSidebar(true);
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

        // Theme Toggle (Delegation)
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#theme-toggle');
            if (btn) {
                console.log('Theme toggle clicked');
                try {
                    console.log('Tailwind Config:', typeof tailwind !== 'undefined' ? JSON.stringify(tailwind.config) : 'undefined');
                } catch (e) {
                    console.error('Error reading tailwind config:', e);
                }
                console.log('Classes before:', document.documentElement.className);

                if (document.documentElement.classList.contains('dark')) {
                    document.documentElement.classList.remove('dark');
                    localStorage.theme = 'light';
                } else {
                    document.documentElement.classList.add('dark');
                    localStorage.theme = 'dark';
                }
                console.log('Classes after:', document.documentElement.className);
            }
        });

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
                // Active State
                link.classList.add('bg-slate-800', 'text-white');
                link.classList.remove('text-slate-800', 'dark:text-slate-200', 'hover:bg-slate-100', 'dark:hover:bg-slate-800');
            } else {
                // Inactive State
                link.classList.remove('bg-slate-800', 'text-white');
                link.classList.add('text-slate-800', 'dark:text-slate-200', 'hover:bg-slate-100', 'dark:hover:bg-slate-800');
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
            console.log(`Switching to view: ${viewName}`);

            // Trigger data load if needed
            try {
                if (viewName === 'dashboard') this.views.dashboard.loadData();
                if (viewName === 'sales') this.views.sales.loadSales();
                if (viewName === 'products') {
                    console.log('Loading products view...', this.views.products);
                    this.views.products.loadProducts();
                }
                if (viewName === 'settings') this.views.settings.loadSettings();
                if (viewName === 'pos') this.views.pos.refreshData();
            } catch (error) {
                console.error(`Error loading view ${viewName}:`, error);
            }
        }

        this.currentView = viewName;
    }
}

console.log('App.js module loaded');

const initApp = () => {
    if (window.appInitialized) {
        console.warn('App already initialized, skipping.');
        return;
    }
    window.appInitialized = true;
    console.log('initApp called');
    // if (window.app) return; // Force init for debugging
    window.app = new App();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
