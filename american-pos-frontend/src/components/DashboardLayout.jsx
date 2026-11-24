import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useNavigate, NavLink, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/AuthContext';
import { useTheme } from '../hooks/ThemeContext';
import { LogOut, Store, Menu, Banknote, ShoppingCart, Package, Users as UsersIcon, History, Settings, Bell, AlertTriangle, X, Shield, ShieldCheck, Truck, FileText, UserCog, Tag, Key, DollarSign, Lock, Clock, Calculator, PieChart, Palette, ChevronDown, FileSpreadsheet, Warehouse, TrendingUp, Scale, Coins, Building2, Columns2, Grid2x2, Cpu, Search, PanelLeftClose, PanelLeftOpen, BellOff, ChevronRight, ArrowRight, Check } from 'lucide-react';
const CashRegisterModal = lazy(() => import('./CashRegisterModal'));
const QuickSettingsFinder = lazy(() => import('./settings/QuickSettingsFinder'));
import Logo from './Logo';
import BranchSelector from './BranchSelector';
import api from '../services/api';
import useHorizontalScroll from '../hooks/useHorizontalScroll';
import useSidebarSmartScroll from '../hooks/useSidebarSmartScroll';
import { usePos } from '../hooks/PosContext';
import {
    formatStock,
    isDualCurrencyMode,
    isSingleCurrencyCountry,
    isUsdOnlyMode,
    fetchBusinessSettingsCached,
    fetchCurrentShiftCached
} from '../utils/format';
import CloudSyncIndicator from './CloudSyncIndicator';
import WhatsappBotIndicator from './WhatsappBotIndicator';
import UpdateAlertBadge from './common/UpdateAlertBadge';
import ErrorBoundary from './ErrorBoundary';

// Performance: Lazy loaded secondary dialogs and modals
const ProductModal = lazy(() => import('./ProductModal'));
const AboutModal = lazy(() => import('./AboutModal'));
const CalculatorModal = lazy(() => import('./CalculatorModal'));
const RegisterSetupModal = lazy(() => import('./RegisterSetupModal'));
const WhatsappBotModal = lazy(() => import('./WhatsappBotModal'));
const ExchangeRateModal = lazy(() => import('./ExchangeRateModal'));
const AppearanceModal = lazy(() => import('./AppearanceModal'));
const FirstTimeSetupWizard = lazy(() => import('./FirstTimeSetupWizard'));

// Helper to format user role label and color badge

// Isolated Clock component to prevent full layout re-renders every second

// Isolated Exchange Rate Monitor to prevent full layout re-renders on cart changes
function ExchangeRateMonitor({ businessSettings }) {
    const { exchangeRate, euroRate, currencyMode, fetchExchangeRate, country } = usePos();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const activeCountry = businessSettings?.country || country || localStorage.getItem('pos_country') || '';
    if (isSingleCurrencyCountry(activeCountry) || isUsdOnlyMode({ currencyMode, country: activeCountry, ...businessSettings })) return null;

    const isVenezuela = (activeCountry && (activeCountry.toLowerCase() === 'venezuela' || activeCountry.toLowerCase() === 've')) || (!activeCountry && (!localStorage.getItem('pos_country') || localStorage.getItem('pos_country')?.toLowerCase() === 'venezuela'));
    const isDual = isDualCurrencyMode({ currencyMode, country: activeCountry, ...businessSettings });
    if (!exchangeRate || !isDual || !isVenezuela) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                title={euroRate > 0 ? `Tasa BCV: 1 $ = ${exchangeRate} Bs · 1 € = ${euroRate} Bs (clic para actualizar)` : 'Clic para actualizar tasa de cambio BCV'}
                className="hidden sm:flex items-center gap-2 h-9 px-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-xs hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 transition-all cursor-pointer group shrink-0 whitespace-nowrap"
            >
                <div className="w-5 h-5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold shrink-0 border border-slate-200 dark:border-slate-700">
                    <DollarSign size={12} strokeWidth={2.5} />
                </div>
                <div className="flex items-center gap-1.5 text-left leading-none whitespace-nowrap">
                    <span className="text-[11px] font-medium text-slate-500">1 $ =</span>
                    <span className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
                        {exchangeRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs
                    </span>
                    {euroRate > 0 && (
                        <>
                            <span className="hidden xl:inline text-slate-300 dark:text-slate-700 mx-0.5">|</span>
                            <span className="hidden xl:inline text-[11px] font-medium text-indigo-500">1 € =</span>
                            <span className="hidden xl:inline text-xs font-bold text-indigo-700 dark:text-indigo-300 tabular-nums tracking-tight">
                                {euroRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs
                            </span>
                        </>
                    )}
                </div>
            </button>

            <ExchangeRateModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                currentRate={exchangeRate}
                currentEuroRate={euroRate}
                currencyMode={currencyMode}
                onRateUpdated={() => {
                    fetchExchangeRate(true);
                }}
            />
        </>
    );
}

// Isolated Register Check to prevent re-renders in main layout


export default function DashboardLayout() {
    const { user, logout, appLock, hasPermission } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { registerId, registerDisplayName, currencyMode, exchangeRate, euroRate, fetchExchangeRate, country, isUsdOnly } = usePos();
    const [isCashModalOpen, setIsCashModalOpen] = useState(false);
    const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false);
    const [lowStockItems, setLowStockItems] = useState([]);
    const [showStockAlerts, setShowStockAlerts] = useState(false);
    const [stockSearchQuery, setStockSearchQuery] = useState('');
    const [stockFilterTab, setStockFilterTab] = useState('all'); // 'all' | 'out_of_stock' | 'low_stock'
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isStockAlertDismissed, setIsStockAlertDismissed] = useState(() => {
        return sessionStorage.getItem('stockAlertDismissed') === 'true';
    });
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [selectedAlertProduct, setSelectedAlertProduct] = useState(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
    const [businessSettings, setBusinessSettings] = useState({});
    const [processingProduct, setProcessingProduct] = useState(false);
    const [isShiftOpen, setIsShiftOpen] = useState(false);
    const [shiftStatusChecked, setShiftStatusChecked] = useState(false);
    const [currentShiftData, setCurrentShiftData] = useState(null);
    const prevCashModalOpenRef = useRef(false);
    const [isAppearanceModalOpen, setIsAppearanceModalOpen] = useState(false);
    const [isWhatsappModalOpen, setIsWhatsappModalOpen] = useState(false);
    const [showFirstTimeSetup, setShowFirstTimeSetup] = useState(() => !localStorage.getItem('initial_setup_completed'));

    const { theme, setTheme, layoutStyle } = useTheme();
    const navRef = useHorizontalScroll();
    const sidebarScroll = useSidebarSmartScroll();
    const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
    const [isGlobalFinderOpen, setIsGlobalFinderOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        return localStorage.getItem('pos_sidebar_collapsed') === 'true';
    });
    const toggleSidebarCollapse = () => {
        setIsSidebarCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('pos_sidebar_collapsed', String(next));
            return next;
        });
    };
    const stockMenuRef = useRef(null);
    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const themeDropdownRef = useRef(null);

    // Cerrar dropdown de temas al hacer clic afuera
    useEffect(() => {
        if (!isThemeDropdownOpen) return;
        const handleClickOutside = (e) => {
            if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target)) {
                setIsThemeDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isThemeDropdownOpen]);

    // Global Command Palette / Quick Settings (Ctrl + K / Cmd + K)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsGlobalFinderOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleQuickSelectSetting = (setting) => {
        if (!setting) return;
        setIsGlobalFinderOpen(false);
        if (setting.tab) {
            navigate(`/settings?tab=${setting.tab}`);
            setTimeout(() => {
                if (setting.targetElementId) {
                    const el = document.getElementById(setting.targetElementId);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);
        }
    };

    // Outside click handler for Stock Alerts
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (stockMenuRef.current && !stockMenuRef.current.contains(event.target)) {
                setShowStockAlerts(false);
            }
        };
        if (showStockAlerts) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showStockAlerts]);

    useEffect(() => {
        const handleToggleCalc = () => setIsCalculatorOpen(prev => !prev);
        window.addEventListener('toggle-calculator', handleToggleCalc);
        return () => {
            window.removeEventListener('toggle-calculator', handleToggleCalc);
        };
    }, []);

    const pathnameRef = useRef(location.pathname);
    pathnameRef.current = location.pathname;

    useEffect(() => {
        let mounted = true;
        const checkRegisterStatus = async (forceRefresh = false) => {
            try {
                const data = await fetchCurrentShiftCached(registerId, forceRefresh === true);
                if (!mounted) return;
                setIsShiftOpen(!!data);
                setCurrentShiftData(data || null);
                if (!data && pathnameRef.current === '/pos') {
                    setIsCashModalOpen(true);
                }
            } catch (error) {
                console.error('Error checking register status:', error);
            } finally {
                if (mounted) setShiftStatusChecked(true);
            }
        };
        checkRegisterStatus(false);

        const handleShiftStatusChanged = (e) => {
            if (e && e.detail && typeof e.detail.isOpen === 'boolean') {
                setIsShiftOpen(e.detail.isOpen);
                setCurrentShiftData(e.detail.shift || null);
            } else {
                checkRegisterStatus(true);
            }
        };
        window.addEventListener('shift_status_changed', handleShiftStatusChanged);

        const fetchLowStock = async () => {
            try {
                const { data } = await api.get('/products/low-stock');
                if (mounted) setLowStockItems(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Error fetching low stock items:', error);
            }
        };

        const fetchBusinessSettings = async () => {
            try {
                const prevMode = localStorage.getItem('pos_business_mode') || '';
                const bData = (await fetchBusinessSettingsCached()) || {};
                if (!mounted) return;
                setBusinessSettings(bData);
                localStorage.setItem('pos_business_settings', JSON.stringify(bData));
                if (bData.cashClosureMode) {
                    localStorage.setItem('pos_cash_closure_mode', bData.cashClosureMode);
                }
                if (bData.businessMode) {
                    localStorage.setItem('pos_business_mode', bData.businessMode);
                    if (bData.businessMode !== prevMode) {
                        window.dispatchEvent(new Event('business_mode_changed'));
                    }
                }
                if (bData.initialSetupCompleted) {
                    localStorage.setItem('initial_setup_completed', 'true');
                    setShowFirstTimeSetup(false);
                } else if (!localStorage.getItem('initial_setup_completed')) {
                    setShowFirstTimeSetup(true);
                }
            } catch (e) {
                console.warn('[DashboardLayout] Error capturado en operación:', e?.message || e);
                // Silently fallback to cached values
            }
        };

        fetchLowStock();
        fetchBusinessSettings();
        const handleSaleLowStockRefresh = () => {
            if (document.visibilityState === 'visible') fetchLowStock();
        };
        const handleOpenCashModal = () => setIsCashModalOpen(true);
        window.addEventListener('pos-daily-ticket-updated', handleSaleLowStockRefresh);
        window.addEventListener('open_cash_modal', handleOpenCashModal);
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchLowStock();
            }
        }, 180000); // Polling ligero cada 3 min + refresco reactivo tras cada venta
        return () => {
            mounted = false;
            clearInterval(interval);
            window.removeEventListener('pos-daily-ticket-updated', handleSaleLowStockRefresh);
            window.removeEventListener('shift_status_changed', handleShiftStatusChanged);
            window.removeEventListener('open_cash_modal', handleOpenCashModal);
        };
    }, [registerId]);

    // Re-check shift status only when modal transitions from open to closed
    useEffect(() => {
        const wasOpen = prevCashModalOpenRef.current;
        prevCashModalOpenRef.current = isCashModalOpen;
        if (wasOpen && !isCashModalOpen) {
            const checkStatus = async () => {
                try {
                    const data = await fetchCurrentShiftCached(registerId, true);
                    setIsShiftOpen(!!data);
                    setCurrentShiftData(data || null);
                } catch (e) { console.error(e); }
            };
            checkStatus();
        }
    }, [isCashModalOpen, registerId]);

    useEffect(() => {
        // Electron "About" listener
        if (window.electronAPI && window.electronAPI.onShowAbout) {
            const removeListener = window.electronAPI.onShowAbout(() => {
                setIsAboutModalOpen(true);
            });
            return () => removeListener();
        }
    }, []);

    // Search logic moved to HeaderSearch component to avoid global re-renders

    const handleFetchLowStock = async () => {
        try {
            const { data } = await api.get('/products/low-stock');
            setLowStockItems(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching low stock items:', error);
        }
    };

    const handleSaveProduct = async (productData) => {
        try {
            setProcessingProduct(true);
            if (selectedAlertProduct) {
                await api.put(`/products/${selectedAlertProduct.id}`, productData);
            } else {
                await api.post('/products', productData);
            }
            await handleFetchLowStock();
            setIsProductModalOpen(false);
        } catch (error) {
            console.error('Error saving product from alert', error);
            const msg = error.response?.data?.details || error.response?.data?.error || 'Error desconocido';
            toast.error(`Error al guardar producto: ${msg}`);
        } finally {
            setProcessingProduct(false);
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const _NavSectionTitle = ({ title }) => (
        <div className="pt-4 pb-1.5 px-3 text-[10.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest opacity-80 select-none">
            {title}
        </div>
    );

    const NavLinks = ({ onClick = () => { }, isHorizontal = false, isCollapsed = false }) => {
        const location = useLocation();
        const userRole = (user?.role || '').toLowerCase();
        const isSuperadmin = ['superadmin', 'owner', 'dueño', 'master'].includes(userRole);

        const canManageInventory = hasPermission('canManageInventory');
        const canManageExpenses = hasPermission('canManageExpenses');
        const canViewReports = hasPermission('canViewReports');
        const canAccessAudit = hasPermission('canAccessAudit');
        const canManageSettings = hasPermission('canManageSettings');

        const canAccessPOS = hasPermission('canAccessPOS');
        const canManageCashShift = hasPermission('canManageCashShift');
        const canViewSalesHistory = hasPermission('canViewSalesHistory');
        const canManageCustomers = hasPermission('canManageCustomers');
        const canManageReceivables = hasPermission('canManageReceivables');
        const canAccessCollections = hasPermission('canAccessCollections');
        const canManageWarehouses = hasPermission('canManageWarehouses');
        const canManagePromotions = hasPermission('canManagePromotions');
        const canManageSuppliers = hasPermission('canManageSuppliers');
        const canManagePurchases = hasPermission('canManagePurchases');
        const canManagePayables = hasPermission('canManagePayables');
        const canImportCatalog = hasPermission('canImportCatalog');
        const effectiveCountry = businessSettings?.country || country || localStorage.getItem('pos_country') || '';
        const isVenezuela = (effectiveCountry && (effectiveCountry.toLowerCase() === 'venezuela' || effectiveCountry.toLowerCase() === 've')) || (!effectiveCountry && (!localStorage.getItem('pos_country') || localStorage.getItem('pos_country')?.toLowerCase() === 'venezuela'));
        const canManageFiscal = isVenezuela && hasPermission('canManageFiscal');
        const canAccessBI = hasPermission('canAccessBI');
        const canManageAccounting = hasPermission('canManageAccounting');
        const canManagePayroll = hasPermission('canManagePayroll');
        const canManageAssets = hasPermission('canManageAssets');
        const canMonitorCashiers = hasPermission('canMonitorCashiers');
        const canManageBranches = hasPermission('canManageBranches');
        const canManageUsers = hasPermission('canManageUsers');

        const labelClasses = `font-bold tracking-tight truncate ${isHorizontal ? 'text-[11px]' : 'text-[12px]'}`;
        const NavLabel = ({ children }) => isCollapsed ? null : <span className={labelClasses}>{children}</span>;
        const [hoveredTooltip, setHoveredTooltip] = useState(null);

        const getCollapseTooltipProps = (label, section = '') => {
            if (!isCollapsed) return {};
            return {
                onMouseEnter: (e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredTooltip({
                        label,
                        section,
                        top: rect.top + rect.height / 2,
                        left: rect.right + 12
                    });
                },
                onMouseLeave: () => setHoveredTooltip(null)
            };
        };

        const NavIcon = ({ icon: Icon, duotone = false, badge = false, isActive = false }) => {
            if (isHorizontal) {
                return (
                    <div className="relative flex-shrink-0 transition-transform duration-150 group-hover/navitem:scale-110">
                        <Icon
                            size={16}
                            fill={duotone ? 'currentColor' : 'none'}
                            fillOpacity={duotone ? (isActive ? 0.28 : 0.16) : 0}
                            strokeWidth={isActive ? 2.4 : 2}
                            className={isActive ? 'text-white' : 'text-slate-600 dark:text-slate-400 group-hover/navitem:text-slate-900 dark:group-hover/navitem:text-white'}
                        />
                        {badge && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full border border-white dark:border-slate-800 animate-pulse"></span>
                        )}
                    </div>
                );
            }

            const boxSizeClass = isCollapsed
                ? 'w-10 h-10 rounded-xl group-hover/navitem:scale-105 group-hover/navitem:z-20 transition-all duration-150 ease-out'
                : 'w-6 h-6 rounded-md group-hover/navitem:scale-105 transition-transform duration-150';
            
            const svgSize = isCollapsed ? 20 : 14;
            const styleClasses = isActive 
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 border-slate-900 dark:border-white shadow-xs'
                : 'bg-slate-200/50 dark:bg-slate-800/60 border-slate-300/70 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 group-hover/navitem:bg-white dark:group-hover/navitem:bg-slate-700 group-hover/navitem:text-slate-900 dark:group-hover/navitem:text-white group-hover/navitem:border-slate-400 dark:group-hover/navitem:border-slate-500';

            return (
                <div className={`relative ${boxSizeClass} border flex items-center justify-center flex-shrink-0 select-none transition-colors ${styleClasses}`}>
                    <Icon
                        size={svgSize}
                        fill={duotone ? 'currentColor' : 'none'}
                        fillOpacity={duotone ? (isActive ? 0.25 : 0.16) : 0}
                        strokeWidth={isActive ? 2.4 : 2}
                    />
                    {badge && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse"></span>
                    )}
                </div>
            );
        };

        const linkClasses = ({ isActive }) => {
            if (isHorizontal) {
                return `group/navitem flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-lg font-semibold text-[11px] sm:text-[12px] tracking-tight shrink-0 transition-colors ${isActive ? 'bg-slate-900 dark:bg-slate-800 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}`;
            }
            if (isCollapsed) {
                return `group/navitem relative flex items-center justify-center p-1 rounded-xl transition-all duration-150 !overflow-visible my-0.5 ${isActive ? 'nav-collapsed-active' : ''}`;
            }
            return `nav-link-premium group/navitem !overflow-visible ${isActive ? 'active' : ''}`;
        };

        const SectionTitle = ({ title }) => (
            isHorizontal 
                ? <div className="hidden shrink-0 px-2 text-[10px] font-black text-slate-500 uppercase">{title}</div>
                : isCollapsed
                    ? <div className="my-2 mx-auto w-4 h-[1px] bg-slate-300/80 dark:bg-slate-800 rounded-full select-none" />
                    : <div className="pt-3 pb-1 px-2.5 text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest select-none flex items-center gap-1.5">
                        <span>{title}</span>
                    </div>
        );

        const NavItem = ({ to, label, section, icon, duotone = false, badge = false, isExternalActive = null }) => {
            const checkActive = ({ isActive }) => {
                const finalActive = isExternalActive !== null ? isExternalActive({ isActive }) : isActive;
                return linkClasses({ isActive: finalActive });
            };

            return (
                <NavLink 
                    to={to} 
                    onClick={onClick} 
                    className={checkActive} 
                    {...getCollapseTooltipProps(label, section)}
                >
                    {({ isActive: navActive }) => {
                        const active = isExternalActive !== null ? isExternalActive({ isActive: navActive }) : navActive;
                        return (
                            <>
                                {isCollapsed && active && (
                                    <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-r-full shadow-xs z-30 bg-slate-900 dark:bg-sky-400" />
                                )}
                                <NavIcon icon={icon} duotone={duotone} badge={badge} isActive={active} />
                                <NavLabel>{label}</NavLabel>
                            </>
                        );
                    }}
                </NavLink>
            );
        };

        return (
            <div
                onMouseLeave={() => setHoveredTooltip(null)}
                className={isHorizontal ? "flex items-center gap-1 shrink-0 min-w-max" : isCollapsed ? "space-y-1 flex flex-col items-center" : "space-y-0.5"}
            >
                {/* 1. VENTA & CAJA */}
                {(canAccessPOS || canManageCashShift || canViewSalesHistory || canManageCustomers || canManageReceivables || canAccessCollections) && (
                    <>
                        <SectionTitle title="Venta & Caja" />
                        {canAccessPOS && (
                            <NavItem to="/pos" label="POS (Venta)" section="Venta & Caja" icon={ShoppingCart} />
                        )}
                        {canManageCashShift && (
                            <NavItem to="/cash-register" label="Control de Caja" section="Venta & Caja" icon={Banknote} />
                        )}
                        {canViewSalesHistory && (
                            <NavItem to="/sales-manager" label="Gestor de Ventas" section="Venta & Caja" icon={History} duotone={false} />
                        )}
                        {canManageCustomers && (
                            <NavItem to="/customers" label="Clientes" section="Venta & Caja" icon={UsersIcon} />
                        )}
                        {canManageReceivables && (
                            <NavItem to="/accounts-receivable" label="Cobranzas" section="Venta & Caja" icon={DollarSign} duotone={false} />
                        )}
                        {canAccessCollections && (
                            <NavItem 
                                to="/assets-collections?tab=collections" 
                                label="Radar de Cobranza" 
                                section="Venta & Caja" 
                                icon={Coins} 
                                isExternalActive={({ isActive }) => isActive && location.search.includes('collections')}
                            />
                        )}
                    </>
                )}

                {/* 2. CATÁLOGO & ABASTECIMIENTO */}
                {(canManageInventory || canManageWarehouses || canManagePromotions || canManageSuppliers || canManagePurchases || canManagePayables || canImportCatalog) && (
                    <>
                        <SectionTitle title="Catálogo & Stock" />
                        {canManageInventory && (
                            <NavItem 
                                to="/inventory" 
                                label="Inventario" 
                                section="Catálogo & Stock" 
                                icon={Package} 
                                badge={lowStockItems.length > 0 && !isStockAlertDismissed} 
                            />
                        )}
                        {canManageWarehouses && (
                            <NavItem 
                                to="/warehouses" 
                                label="Almacenes" 
                                section="Catálogo & Stock" 
                                icon={Warehouse} 
                            />
                        )}
                        {canManageInventory && (
                            <NavItem 
                                to="/lots" 
                                label="Lotes & Vencimientos" 
                                section="Catálogo & Stock" 
                                icon={Clock} 
                            />
                        )}
                        {canManagePromotions && (
                            <NavItem to="/promotions" label="Ofertas" section="Catálogo & Stock" icon={Tag} />
                        )}
                        {(canManageSuppliers || canManagePurchases) && (
                            <NavItem 
                                to="/suppliers" 
                                label="Proveedores" 
                                section="Catálogo & Stock" 
                                icon={Truck} 
                                isExternalActive={({ isActive }) => isActive || location.pathname === '/purchase-orders'}
                            />
                        )}
                        {canManagePayables && (
                            <NavItem to="/accounts-payable" label="Por Pagar" section="Catálogo & Stock" icon={FileText} />
                        )}
                        {canImportCatalog && (
                            <NavItem to="/catalog-importer" label="Importar Factura" section="Catálogo & Stock" icon={FileSpreadsheet} />
                        )}
                    </>
                )}

                {/* 3. TESORERÍA & FISCAL */}
                {(canManageExpenses || canManageFiscal) && (
                    <>
                        <SectionTitle title={canManageFiscal ? "Tesorería & Fiscal" : "Tesorería & Gastos"} />
                        {canManageFiscal && (
                            <NavItem to="/fiscal" label="Gestión Fiscal SENIAT" section="Tesorería & Fiscal" icon={FileSpreadsheet} />
                        )}
                        {canManageExpenses && (
                            <NavItem to="/expenses" label="Gastos Operativos" section="Tesorería & Fiscal" icon={Banknote} />
                        )}
                    </>
                )}

                {/* 4. GERENCIA & AJUSTES */}
                {(canAccessBI || canViewReports || canManageAccounting || canManagePayroll || canManageAssets || canAccessAudit || canMonitorCashiers || canManageBranches || canManageUsers || canManageSettings || isSuperadmin) && (
                    <>
                        <SectionTitle title="Gerencia & Ajustes" />
                        {canAccessBI && (
                            <NavItem to="/bi" label="Rendimiento & P&L" section="Gerencia & Ajustes" icon={TrendingUp} duotone={false} />
                        )}
                        {canViewReports && (
                            <NavItem to="/dashboard" label="Estadísticas" section="Gerencia & Ajustes" icon={PieChart} />
                        )}
                        {canManageAccounting && (
                            <NavItem to="/accounting" label="Contabilidad General (PUC)" section="Gerencia & Ajustes" icon={Scale} duotone={false} />
                        )}
                        {canManagePayroll && (
                            <NavItem to="/payroll" label="Nómina & RRHH" section="Gerencia & Ajustes" icon={UsersIcon} />
                        )}
                        {canManageAssets && (
                            <NavItem 
                                to="/assets-collections?tab=assets" 
                                label="Activos Fijos" 
                                section="Gerencia & Ajustes" 
                                icon={Building2} 
                                isExternalActive={({ isActive }) => isActive && !location.search.includes('collections')}
                            />
                        )}
                        {canAccessAudit && (
                            <NavItem to="/audit" label="Auditoría" section="Gerencia & Ajustes" icon={Shield} />
                        )}
                        {canMonitorCashiers && (
                            <NavItem to="/admin/cash-monitoring" label="Monitoreo de Cajas" section="Gerencia & Ajustes" icon={ShieldCheck} />
                        )}
                        {canManageBranches && (
                            <NavItem to="/branches" label="Sucursales" section="Gerencia & Ajustes" icon={Store} />
                        )}
                        {canManageUsers && (
                            <NavItem to="/users" label="Usuarios" section="Gerencia & Ajustes" icon={UserCog} />
                        )}
                        {canManageSettings && (
                            <NavItem to="/settings" label="Ajustes" section="Gerencia & Ajustes" icon={Settings} />
                        )}
                        {isSuperadmin && (
                            <NavItem to="/licenses" label="Licencias" section="Gerencia & Ajustes" icon={Key} />
                        )}
                    </>
                )}
                <div className="h-16"></div>{/* Bottom Padding */}
                {isCollapsed && hoveredTooltip && createPortal(
                    <div
                        style={{
                            top: `${hoveredTooltip.top}px`,
                            left: `${hoveredTooltip.left}px`,
                            transform: 'translateY(-50%)'
                        }}
                        className="fixed z-[99999] pointer-events-none flex items-center animate-in fade-in zoom-in-95 duration-150"
                    >
                        <div className="w-2 h-2 bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur-md border-l border-b border-slate-700/80 rotate-45 -mr-1 z-10"></div>
                        <div className="px-3 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur-md text-white text-xs font-bold tracking-tight shadow-xl border border-slate-700/80 whitespace-nowrap flex items-center gap-2">
                            <span>{hoveredTooltip.label}</span>
                            {hoveredTooltip.section && (
                                <span className="text-[10px] text-slate-400 font-normal border-l border-slate-700 pl-2">
                                    {hoveredTooltip.section}
                                </span>
                            )}
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        );
    };

    const shiftHoursOpen = currentShiftData?.openedAt 
        ? (Date.now() - new Date(currentShiftData.openedAt).getTime()) / (1000 * 60 * 60)
        : 0;
    const isShiftExpired = isShiftOpen && shiftHoursOpen >= 16;    return (
        <div className="h-dvh min-h-dvh bg-transparent transition-colors duration-200 flex overflow-hidden">
            {/* Desktop Sidebar Navigation */}
            {layoutStyle === 'sidebar' && (
                <aside className={`app-main-sidebar hidden md:flex flex-col ${isSidebarCollapsed ? 'w-[68px]' : 'w-52 sm:w-56 lg:w-60 xl:w-64'} transition-all duration-200 bg-[#e8edf3] dark:bg-[#0b1120] z-[100] relative overflow-hidden group/sidebar shrink-0`}>

                <div className={`${isSidebarCollapsed ? 'py-3 px-1' : 'py-3.5 px-2'} flex flex-col items-center justify-center relative z-10 shrink-0 bg-transparent transition-all duration-200 border-b border-white/[0.06] mb-1`}>
                    {isSidebarCollapsed ? (
                        <Logo compact={true} hideText={true} size="md" variant={theme === 'swiss' ? 'light' : 'dark'} />
                    ) : (
                        <Logo compact={false} size="sidebar" variant={theme === 'swiss' ? 'light' : 'dark'} className="w-full flex items-center justify-center" />
                    )}
                </div>

                <div 
                    ref={sidebarScroll.containerRef}
                    className={`flex-1 overflow-y-auto ${isSidebarCollapsed ? 'px-2' : 'px-2'} py-1 pb-16 no-scrollbar relative z-10`}
                >
                    <NavLinks isCollapsed={isSidebarCollapsed} />
                </div>
            </aside>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Top Bar */}
                <header className="app-main-header sticky top-0 z-[200] bg-[#eef2f6] dark:bg-slate-900">
                    <div className="px-2 sm:px-3 lg:px-4 xl:px-5 max-w-full">
                        <div className="flex justify-between items-center h-14 sm:h-16 gap-1 sm:gap-2 w-full">
                            {/* Mobile Menu Trigger & Icon Emblem Only */}
                            <div className="flex items-center gap-1.5 sm:gap-2 md:hidden shrink-0">
                                <button
                                    onClick={() => setIsMobileMenuOpen(true)}
                                    className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                                    title="Abrir menú lateral"
                                    >
                                    <Menu size={24} className="w-6 h-6" />
                                </button>
                                <Logo
                                    compact={true}
                                    hideText={true}
                                />
                            </div>

                            {/* Left/Center Section: Contextual Info (Desktop) */}
                            <div className="hidden md:flex items-center justify-start gap-2.5 shrink-0">
                                {layoutStyle === 'sidebar' ? (
                                    <button
                                        type="button"
                                        onClick={toggleSidebarCollapse}
                                        className="h-9 w-9 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-center shrink-0"
                                        title={isSidebarCollapsed ? "Expandir menú lateral" : "Ocultar menú (Solo íconos)"}
                                    >
                                        {isSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                                    </button>
                                ) : (
                                    <div className="flex items-center mr-1">
                                        <Logo size="sm" className="h-7 w-auto max-w-[150px]" />
                                    </div>
                                )}
                                <ExchangeRateMonitor businessSettings={businessSettings} />
                            </div>

                            {/* Right Side (Actions & User - Adaptable & Organized) */}
                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                <UpdateAlertBadge />

                                {/* Mobile Status Indicator (Compact) */}
                                <div className="lg:hidden flex items-center shrink-0">
                                    <CloudSyncIndicator compact={true} />
                                </div>

                                {/* Capsule 1: Cloud Sync, WhatsApp Bot & Branch Selector (Desktop) */}
                                <div className="hidden lg:flex items-center gap-2 h-9 px-2.5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-xs shrink-0">
                                    <CloudSyncIndicator />
                                    <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-800"></div>
                                    <WhatsappBotIndicator onOpenModal={() => setIsWhatsappModalOpen(true)} />
                                    <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-800"></div>
                                    <BranchSelector />
                                </div>

                                {/* Capsule 2: System Action Buttons Group */}
                                <div className="flex items-center gap-1 h-9 px-1.5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-xs shrink-0">

                                    {/* Selector Desplegable de Arquitectura Visual / Tema */}
                                    <div className="relative" ref={themeDropdownRef}>
                                        <button
                                            type="button"
                                            onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                                            className="flex items-center gap-1.5 h-7 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-all cursor-pointer select-none"
                                            title="Cambiar Arquitectura Visual / Tema"
                                        >
                                            {theme === 'swiss' ? (
                                                <Grid2x2 size={13} className="text-slate-800 dark:text-slate-200" />
                                            ) : theme === 'titanium' ? (
                                                <Cpu size={13} className="text-slate-700 dark:text-slate-200" />
                                            ) : (
                                                <Columns2 size={13} className="text-slate-900 dark:text-slate-100" />
                                            )}
                                            <span className="text-[11px] font-semibold hidden md:inline capitalize">
                                                {theme === 'swiss' ? 'Swiss' : theme === 'titanium' ? 'Titanium' : 'Studio'}
                                            </span>
                                            <ChevronDown 
                                                size={11} 
                                                className={`text-slate-400 transition-transform duration-150 ${isThemeDropdownOpen ? 'rotate-180' : ''}`} 
                                            />
                                        </button>

                                        {isThemeDropdownOpen && (
                                            <div className="absolute top-full left-0 mt-1.5 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden z-50 p-1 animate-in fade-in slide-in-from-top-1 duration-150">
                                                <div className="px-2 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                    Arquitectura Visual
                                                </div>
                                                <div className="space-y-0.5 mt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setTheme('studio'); setIsThemeDropdownOpen(false); }}
                                                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                                            theme === 'studio'
                                                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold'
                                                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Columns2 size={14} />
                                                            <span>Studio Bimodal</span>
                                                        </div>
                                                        {theme === 'studio' && <Check size={13} />}
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => { setTheme('swiss'); setIsThemeDropdownOpen(false); }}
                                                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                                            theme === 'swiss'
                                                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold'
                                                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Grid2x2 size={14} />
                                                            <span>Swiss Grid</span>
                                                        </div>
                                                        {theme === 'swiss' && <Check size={13} />}
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => { setTheme('titanium'); setIsThemeDropdownOpen(false); }}
                                                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                                                            theme === 'titanium'
                                                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold'
                                                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Cpu size={14} />
                                                            <span>Titanium Console</span>
                                                        </div>
                                                        {theme === 'titanium' && <Check size={13} />}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-800 mx-0.5"></div>

                                    <button
                                        onClick={() => setIsCalculatorOpen(!isCalculatorOpen)}
                                        className="w-7 h-7 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center cursor-pointer"
                                        title="Calculadora"
                                    >
                                        <Calculator size={15} />
                                    </button>

                                    <button
                                        onClick={() => setIsAppearanceModalOpen(true)}
                                        className="hidden sm:flex w-7 h-7 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors items-center justify-center cursor-pointer"
                                        title="Apariencia"
                                    >
                                        <Palette size={15} />
                                    </button>

                                    {/* Stock Alerts Bell Button */}
                                    {['admin', 'superadmin'].includes(user?.role?.toLowerCase()) && (
                                        <div className="relative">
                                            <button
                                                onClick={() => {
                                                    setShowStockAlerts(!showStockAlerts);
                                                    setStockSearchQuery('');
                                                    setStockFilterTab('all');
                                                }}
                                                className="w-7 h-7 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center relative cursor-pointer"
                                                title="Alertas de Inventario"
                                            >
                                                <Bell size={15} />
                                                {(lowStockItems.length > 0 && !isStockAlertDismissed) && (
                                                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900" />
                                                )}
                                            </button>

                                            {showStockAlerts && lowStockItems.length > 0 && (() => {
                                                const outOfStockCount = lowStockItems.filter(i => (Number(i.stockQuantity) || 0) <= 0).length;
                                                const lowStockCount = lowStockItems.filter(i => (Number(i.stockQuantity) || 0) > 0).length;

                                                const filteredStockItems = lowStockItems.filter(item => {
                                                    const q = stockSearchQuery.toLowerCase().trim();
                                                    if (q) {
                                                        const nameMatch = (item.name || '').toLowerCase().includes(q);
                                                        const barcodeMatch = (item.barcode || '').toLowerCase().includes(q);
                                                        if (!nameMatch && !barcodeMatch) return false;
                                                    }
                                                    const qty = Number(item.stockQuantity) || 0;
                                                    if (stockFilterTab === 'out_of_stock') return qty <= 0;
                                                    if (stockFilterTab === 'low_stock') return qty > 0;
                                                    return true;
                                                });

                                                return createPortal(
                                                    <>
                                                        {/* Backdrop for closing when clicking outside */}
                                                        <div className="fixed inset-0 z-[99998] bg-black/20 backdrop-blur-[1px]" onClick={() => setShowStockAlerts(false)} />
                                                        <div 
                                                            ref={stockMenuRef}
                                                            className="fixed top-16 right-2 sm:right-4 md:right-12 w-[calc(100vw-1rem)] sm:w-[440px] max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-[99999] overflow-hidden animate-in fade-in zoom-in-95 duration-150 bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex flex-col max-h-[85vh]"
                                                        >
                                                            {/* Cabecera Ejecutiva */}
                                                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                                        <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 shrink-0">
                                                                            <AlertTriangle size={18} />
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <div className="flex items-center gap-2">
                                                                                <h3 className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">Stock Crítico</h3>
                                                                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                                                                                    {lowStockItems.length}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                                                Productos que requieren reposición inmediata
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-1 shrink-0">
                                                                        <button 
                                                                            onClick={() => {
                                                                                setIsStockAlertDismissed(true);
                                                                                sessionStorage.setItem('stockAlertDismissed', 'true');
                                                                                setShowStockAlerts(false);
                                                                                toast('Alertas de inventario silenciadas por esta sesión');
                                                                            }}
                                                                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                                            title="Silenciar alertas de la sesión"
                                                                        >
                                                                            <BellOff size={16} />
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => setShowStockAlerts(false)}
                                                                            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                                                            title="Cerrar panel"
                                                                        >
                                                                            <X size={16} />
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                {/* Buscador Rápido y Filtros */}
                                                                <div className="mt-3.5 space-y-2">
                                                                    <div className="relative">
                                                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                                        <input
                                                                            type="text"
                                                                            value={stockSearchQuery}
                                                                            onChange={(e) => setStockSearchQuery(e.target.value)}
                                                                            placeholder="Buscar por nombre o código de barra..."
                                                                            className="w-full pl-8.5 pr-8 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs outline-none focus:border-amber-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                                                                        />
                                                                        {stockSearchQuery && (
                                                                            <button
                                                                                onClick={() => setStockSearchQuery('')}
                                                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                                                            >
                                                                                <X size={12} />
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    <div className="flex gap-1.5">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setStockFilterTab('all')}
                                                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                                                                                stockFilterTab === 'all'
                                                                                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-2xs'
                                                                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
                                                                            }`}
                                                                        >
                                                                            Todos ({lowStockItems.length})
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setStockFilterTab('out_of_stock')}
                                                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                                                                stockFilterTab === 'out_of_stock'
                                                                                    ? 'bg-rose-600 text-white shadow-2xs'
                                                                                    : 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-slate-200 dark:border-slate-800'
                                                                            }`}
                                                                        >
                                                                            <span className={`w-1.5 h-1.5 rounded-full ${stockFilterTab === 'out_of_stock' ? 'bg-white' : 'bg-rose-500'}`}></span>
                                                                            Agotados ({outOfStockCount})
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setStockFilterTab('low_stock')}
                                                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                                                                                stockFilterTab === 'low_stock'
                                                                                    ? 'bg-amber-600 text-white shadow-2xs'
                                                                                    : 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-slate-200 dark:border-slate-800'
                                                                            }`}
                                                                        >
                                                                            <span className={`w-1.5 h-1.5 rounded-full ${stockFilterTab === 'low_stock' ? 'bg-white' : 'bg-amber-500'}`}></span>
                                                                            Bajo Mínimo ({lowStockCount})
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Lista de Productos Filtrada */}
                                                            <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 p-1 flex-1 max-h-[380px] custom-scrollbar">
                                                                {filteredStockItems.length === 0 ? (
                                                                    <div className="py-12 text-center text-slate-400 space-y-1.5">
                                                                        <Package size={28} className="mx-auto text-slate-300 dark:text-slate-600" />
                                                                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                                                                            {stockSearchQuery ? 'No hay productos que coincidan con la búsqueda' : 'No hay productos en esta categoría'}
                                                                        </p>
                                                                        <p className="text-[11px] text-slate-400">Prueba con otro término de búsqueda o filtro</p>
                                                                    </div>
                                                                ) : (
                                                                    filteredStockItems.map(item => {
                                                                        const isDepleted = Number(item.stockQuantity) <= 0;
                                                                        return (
                                                                            <div 
                                                                                key={item.id} 
                                                                                onClick={() => {
                                                                                    setSelectedAlertProduct(item);
                                                                                    setIsProductModalOpen(true);
                                                                                    setShowStockAlerts(false);
                                                                                }}
                                                                                className="group p-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl cursor-pointer flex items-center justify-between gap-3 transition-colors"
                                                                            >
                                                                                <div className="min-w-0 flex-1">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                                                                                            {item.name}
                                                                                        </p>
                                                                                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                                                                                            isDepleted
                                                                                                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60'
                                                                                                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60'
                                                                                        }`}>
                                                                                            {isDepleted ? 'Agotado' : 'Bajo'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                                                        {item.barcode ? (
                                                                                            <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                                                                                {item.barcode}
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="text-[10px] text-slate-400 italic">Sin código</span>
                                                                                        )}
                                                                                        <span>•</span>
                                                                                        <span>Mínimo: <strong className="text-slate-700 dark:text-slate-300">{formatStock(item.minStock)}</strong> {item.stockUnit || 'UND'}</span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center gap-2.5 shrink-0 text-right">
                                                                                    <div>
                                                                                        <span className={`text-sm font-bold font-mono block tabular-nums ${
                                                                                            isDepleted 
                                                                                                ? 'text-rose-600 dark:text-rose-400' 
                                                                                                : 'text-amber-600 dark:text-amber-400'
                                                                                        }`}>
                                                                                            {formatStock(item.stockQuantity)}
                                                                                        </span>
                                                                                        <span className="text-[10px] font-semibold text-slate-400 block uppercase">
                                                                                            {item.stockUnit || 'UND'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>

                                                            {/* Footer con Acciones Ejecutivas */}
                                                            <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 flex items-center justify-between gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setShowStockAlerts(false);
                                                                        navigate('/inventory');
                                                                    }}
                                                                    className="flex-1 h-9 px-3 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                                                                >
                                                                    <Package size={14} className="text-slate-500" />
                                                                    <span>Ver Módulo de Inventario</span>
                                                                    <ArrowRight size={13} className="text-slate-400" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </>,
                                                    document.body
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* User Avatar Menu Trigger */}
                                    <div className="relative shrink-0">
                                        <button
                                            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                                            className="h-9 flex items-center gap-2 pl-1 pr-2.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 rounded-xl transition-all cursor-pointer border border-slate-200/90 dark:border-slate-800 shadow-xs shrink-0 select-none group"
                                            title={user?.name || user?.username || 'Usuario'}
                                        >
                                            {/* Avatar Squircle con fondo oscuro sólido y contraste perfecto */}
                                            <div className="w-7 h-7 rounded-lg bg-slate-900 dark:bg-slate-800 flex items-center justify-center text-white font-black text-xs shadow-xs shrink-0 ring-1 ring-black/10 dark:ring-white/10">
                                                {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
                                            </div>

                                            {/* Nombre y Rol */}
                                            <div className="hidden md:flex flex-col text-left leading-tight max-w-[110px] lg:max-w-[140px] min-w-0">
                                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                                                    {user?.name || user?.username || 'Usuario'}
                                                </span>
                                                <span className="text-[9.5px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider truncate">
                                                    {user?.role || 'Superadmin'}
                                                </span>
                                            </div>

                                            {/* Chevron con rotación fluida */}
                                            <ChevronDown 
                                                size={13} 
                                                className={`text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-transform duration-200 shrink-0 ${
                                                    isUserMenuOpen ? 'rotate-180 text-primary-500' : ''
                                                }`} 
                                            />
                                        </button>

                                        {isUserMenuOpen && createPortal(
                                            <>
                                                {/* Backdrop invisible para cerrar al hacer clic afuera */}
                                                <div className="fixed inset-0 z-[99998] bg-black/10 backdrop-blur-[0.5px]" onClick={() => setIsUserMenuOpen(false)} />
                                                
                                                {/* Dropdown Card con diseño de Producto Real */}
                                                <div 
                                                    className="fixed top-14 right-3 sm:right-4 w-72 rounded-2xl shadow-2xl border border-slate-200/90 dark:border-slate-800 z-[99999] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 bg-white dark:bg-slate-900 text-slate-900 dark:text-white divide-y divide-slate-100 dark:divide-slate-800/80"
                                                >
                                                    {/* Cabecera del Operador */}
                                                    <div className="p-3.5 bg-slate-50/80 dark:bg-slate-950/60 flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm flex items-center justify-center ring-1 ring-black/10 dark:ring-white/10 shrink-0 shadow-xs">
                                                            {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                                {user?.name || user?.username}
                                                            </p>
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                                                    {registerDisplayName || 'Caja 1'}
                                                                </span>
                                                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                                                <span className="inline-flex items-center gap-1.5 font-bold text-[10px] text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                                                    <svg className="w-3.5 h-2.5 rounded-[2px] shadow-xs shrink-0 overflow-hidden border border-black/15" viewBox="0 0 900 600">
                                                                        <rect width="900" height="200" fill="#FCE300" />
                                                                        <rect y="200" width="900" height="200" fill="#003DA5" />
                                                                        <rect y="400" width="900" height="200" fill="#EF3340" />
                                                                        <g fill="#FFFFFF" transform="translate(450, 350)">
                                                                            {[-70, -50, -30, -10, 10, 30, 50, 70].map((deg, i) => {
                                                                                const a = (deg - 90) * (Math.PI / 180);
                                                                                return <circle key={i} cx={Math.round(100 * Math.cos(a))} cy={Math.round(100 * Math.sin(a))} r="11" />;
                                                                            })}
                                                                        </g>
                                                                    </svg>
                                                                    <span>{String(country || 'VENEZUELA').toUpperCase()}</span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Acciones del Operador */}
                                                    <div className="p-1.5 space-y-0.5">
                                                        <button
                                                            onClick={() => { setIsUserMenuOpen(false); appLock(); }}
                                                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 text-xs font-medium transition-colors cursor-pointer group"
                                                        >
                                                            <div className="flex items-center gap-2.5">
                                                                <Lock size={15} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
                                                                <span>Bloquear Terminal</span>
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Pausar</span>
                                                        </button>

                                                        <button
                                                            onClick={() => { setIsUserMenuOpen(false); setIsAppearanceModalOpen(true); }}
                                                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 text-xs font-medium transition-colors cursor-pointer group"
                                                        >
                                                            <div className="flex items-center gap-2.5">
                                                                <Palette size={15} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
                                                                <span>Apariencia & Temas</span>
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 capitalize">{theme || 'Sistema'}</span>
                                                        </button>

                                                        <button
                                                            onClick={() => { setIsUserMenuOpen(false); setIsAboutModalOpen(true); }}
                                                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 text-xs font-medium transition-colors cursor-pointer group"
                                                        >
                                                            <div className="flex items-center gap-2.5">
                                                                <Shield size={15} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition-colors" />
                                                                <span>Acerca de Isaac POS</span>
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 font-mono">v24.04</span>
                                                        </button>
                                                    </div>

                                                    {/* Cerrar Sesión Seguro */}
                                                    <div className="p-1.5 bg-slate-50/50 dark:bg-slate-950/30">
                                                        <button
                                                            onClick={() => { setIsUserMenuOpen(false); handleLogout(); }}
                                                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors cursor-pointer"
                                                        >
                                                            <LogOut size={15} />
                                                            <span>Cerrar Sesión</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </>,
                                            document.body
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Banner de Alerta para Turno Expirado (>16h) */}
                {isShiftExpired && (
                    <div className="bg-amber-600 text-white px-5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-4 border-b border-amber-700/50 shadow-sm z-[95]">
                        <div className="flex items-center gap-3">
                            <AlertTriangle size={18} className="shrink-0" />
                            <span>
                                <strong className="font-bold">Turno prolongado:</strong> Tu turno actual lleva abierto <strong>{Math.round(shiftHoursOpen)} horas</strong>{currentShiftData?.openedAt ? ` (desde ${new Date(currentShiftData.openedAt).toLocaleString()})` : ''}. Se recomienda realizar el Corte Z o arqueo para mantener la precisión de los reportes.
                            </span>
                        </div>
                        <button
                            onClick={() => setIsCashModalOpen(true)}
                            className="bg-slate-900 text-white hover:bg-slate-800 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-all shrink-0 cursor-pointer"
                        >
                            Gestionar Caja (Cierre / Corte Z)
                        </button>
                    </div>
                )}

                {/* Top Navigation Bar for Top-Nav layout */}
                {layoutStyle === 'top-nav' && (
                    <div ref={navRef} className="hidden md:flex w-full overflow-x-auto bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-4 no-scrollbar select-none scroll-smooth">
                        <div className="flex gap-2 py-2 w-full max-w-[1900px] mx-auto items-center">
                            <NavLinks isHorizontal={true} />
                        </div>
                    </div>
                )}

                {/* Floating Dock Layout (Desktop) */}
                {layoutStyle === 'floating-dock' && (
                    <div className="fixed bottom-6 lg:bottom-8 left-1/2 -translate-x-1/2 z-[200] hidden md:flex items-center">
                        <div ref={navRef} className="bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-2 flex gap-1 sm:gap-2 items-center mx-auto overflow-x-auto no-scrollbar max-w-[95vw] select-none scroll-smooth">
                            <NavLinks isHorizontal={true} />
                        </div>
                    </div>
                )}

                {/* Main Content Area Scrollable */}
                <main className={`flex-1 flex flex-col min-h-0 min-w-0 w-full touch-pan-y ${
                    location.pathname === '/pos' 
                        ? `overflow-hidden pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0 ${layoutStyle === 'floating-dock' ? 'md:pb-24 sm:pb-28' : ''}` 
                        : `overflow-y-auto custom-scrollbar overscroll-y-contain py-3 px-1 sm:py-6 sm:px-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-8 ${layoutStyle === 'floating-dock' ? 'md:pb-36 sm:pb-40' : ''}`
                }`}>
                    <div className={`mx-auto w-full min-w-0 ${location.pathname === '/pos' ? 'h-full flex-1 flex flex-col min-h-0 overflow-hidden' : 'max-w-[1900px]'}`}>
                        <ErrorBoundary inline resetKey={location.pathname} moduleName={location.pathname}>
                            <Outlet />
                        </ErrorBoundary>
                    </div>
                </main>
            </div>

            {/* Mobile Bottom Navigation Dock */}
            {(() => {
                const canAccessPOS = hasPermission('canAccessPOS');
                const canManageCashShift = hasPermission('canManageCashShift');
                const canViewSalesHistory = hasPermission('canViewSalesHistory');
                const canManageCustomers = hasPermission('canManageCustomers');

                const dockItems = [
                    canAccessPOS && {
                        id: 'pos',
                        type: 'link',
                        to: '/pos',
                        label: 'POS',
                        icon: ShoppingCart,
                        iconColor: 'text-blue-500 dark:text-blue-400',
                        isActive: location.pathname === '/pos'
                    },
                    canManageCashShift && {
                        id: 'cash',
                        type: 'button',
                        onClick: () => setIsCashModalOpen(true),
                        label: 'Caja',
                        icon: Banknote,
                        iconColor: 'text-emerald-500 dark:text-emerald-400',
                        badge: isShiftOpen,
                        isActive: location.pathname === '/cash-register' || isCashModalOpen
                    },
                    canViewSalesHistory && {
                        id: 'sales',
                        type: 'link',
                        to: '/sales-manager',
                        label: 'Ventas',
                        icon: History,
                        iconColor: 'text-indigo-500 dark:text-indigo-400',
                        isActive: location.pathname.includes('/sales')
                    },
                    canManageCustomers && {
                        id: 'customers',
                        type: 'link',
                        to: '/customers',
                        label: 'Clientes',
                        icon: UsersIcon,
                        iconColor: 'text-sky-500 dark:text-sky-400',
                        isActive: location.pathname === '/customers'
                    },
                    {
                        id: 'menu',
                        type: 'button',
                        onClick: () => setIsMobileMenuOpen(true),
                        label: 'Menú',
                        icon: Menu,
                        iconColor: 'text-violet-500 dark:text-violet-400',
                        badge: lowStockItems.length > 0 && !isStockAlertDismissed,
                        badgePulse: true,
                        isActive: isMobileMenuOpen
                    }
                ].filter(Boolean);

                return (
                    <nav aria-label="Navegación Móvil" className="md:hidden fixed bottom-0 left-0 right-0 z-[120] mobile-bottom-dock pb-safe">
                        <div 
                            className="grid h-14 items-center px-1"
                            style={{ gridTemplateColumns: `repeat(${dockItems.length}, minmax(0, 1fr))` }}
                        >
                            {dockItems.map(item => {
                                const IconComponent = item.icon;
                                if (item.type === 'link') {
                                    return (
                                        <NavLink
                                            key={item.id}
                                            to={item.to}
                                            className={({ isActive }) => `flex flex-col items-center justify-center py-1 transition-all ${
                                                isActive ? 'text-primary-500 font-black scale-105' : 'text-slate-500 dark:text-slate-400 font-semibold hover:text-slate-800 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            <IconComponent size={19} strokeWidth={item.isActive ? 2.5 : 2} className={item.iconColor} />
                                            <span className="text-[9.5px] tracking-tight mt-0.5">{item.label}</span>
                                        </NavLink>
                                    );
                                }
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={item.onClick}
                                        className={`flex flex-col items-center justify-center py-1 transition-all relative ${
                                            item.isActive ? 'text-primary-500 font-black scale-105' : 'text-slate-500 dark:text-slate-400 font-semibold hover:text-slate-800 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        <div className="relative">
                                            <IconComponent size={19} strokeWidth={2} className={item.iconColor} />
                                            {item.badge && (
                                                <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${item.badgePulse ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500 shadow-sm animate-pulse'}`}></span>
                                            )}
                                        </div>
                                        <span className="text-[9.5px] tracking-tight mt-0.5">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </nav>
                );
            })()}

            {/* Mobile Navigation Drawer */}
            {/* Mobile Navigation Drawer */}
            {isMobileMenuOpen && createPortal(
                <div className="fixed inset-0 z-[9999] md:hidden flex">
                    <div
                        className="fixed inset-0 bg-slate-950/70 transition-opacity"
                        onClick={() => setIsMobileMenuOpen(false)}
                    ></div>
                    <div 
                        className="relative flex-1 flex flex-col max-w-xs sm:max-w-sm w-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/10 shadow-2xl animate-in slide-in-from-left duration-250 z-10"
                    >
                        <div 
                            className="h-16 sm:h-20 px-5 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-slate-50 dark:bg-slate-950/80 shrink-0"
                        >
                            <Logo compact={false} size="lg" />
                            <button
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl transition-colors border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div 
                            className="overflow-y-auto pb-4 no-scrollbar flex-1 px-4 bg-white dark:bg-slate-900"
                        >
                            <NavLinks onClick={() => setIsMobileMenuOpen(false)} />
                        </div>
                        <div 
                            className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-slate-200 dark:border-white/10 space-y-2 bg-slate-50 dark:bg-slate-950/80 shrink-0"
                        >
                            {/* Branch Selector (Compact) */}
                            <div className="md:hidden">
                                <BranchSelector compact={true} />
                            </div>

                            {/* Compact Row: Exchange Rate + Theme Switch */}
                            <div className="flex items-center gap-2">
                                {!isUsdOnly && !isSingleCurrencyCountry(country) && exchangeRate > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsMobileMenuOpen(false);
                                            setIsExchangeModalOpen(true);
                                        }}
                                        className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/10 hover:border-primary-500 shadow-xs transition-all text-left cursor-pointer min-w-0"
                                    >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <div className="w-5 h-5 rounded-md bg-primary-500/15 text-primary-500 flex items-center justify-center font-black shrink-0">
                                                <DollarSign size={11} strokeWidth={3} />
                                            </div>
                                            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono truncate">
                                                1$ = {exchangeRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs
                                            </span>
                                        </div>
                                        <span className="text-[8px] font-black text-primary-600 dark:text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded uppercase shrink-0">Editar</span>
                                    </button>
                                )}

                                {/* Compact Theme Switch: Pro Architectures */}
                                <div className="flex items-center p-0.5 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-white/10 shadow-xs shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setTheme('studio')}
                                        className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                            theme === 'studio'
                                                ? 'bg-[#0a0d12] text-white shadow-xs border border-slate-700'
                                                : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'
                                        }`}
                                        title="Studio Bimodal"
                                    >
                                        <Columns2 size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTheme('swiss')}
                                        className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                            theme === 'swiss'
                                                ? 'bg-white text-slate-900 border border-slate-900'
                                                : 'text-slate-400 hover:text-slate-700 dark:hover:text-white'
                                        }`}
                                        title="Swiss Grid"
                                    >
                                        <Grid2x2 size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTheme('titanium')}
                                        className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                            theme === 'titanium'
                                                ? 'bg-[#14181e] text-slate-100 shadow-xs border border-slate-600'
                                                : 'text-slate-400 hover:text-slate-600 dark:hover:text-white'
                                        }`}
                                        title="Titanium Console"
                                    >
                                        <Cpu size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Compact Action Buttons: Cash Register + Logout */}
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => { setIsMobileMenuOpen(false); setIsCashModalOpen(true); }}
                                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl font-bold text-xs transition-all shadow-xs truncate ${
                                        isShiftOpen 
                                            ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10 hover:bg-primary-100 border border-primary-200/80 dark:border-primary-500/20' 
                                            : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 border border-emerald-200/80 dark:border-emerald-500/20'
                                    }`}
                                >
                                    <Banknote size={15} className="shrink-0" />
                                    <span className="truncate">{isShiftOpen ? 'Caja (Cortes)' : 'Abrir Caja'}</span>
                                </button>
                                <button
                                    onClick={() => { setIsMobileMenuOpen(false); handleLogout(); }}
                                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 font-bold transition-all shadow-xs border border-rose-200/80 dark:border-rose-500/20 truncate"
                                >
                                    <LogOut size={15} className="shrink-0" />
                                    <span className="truncate">Cerrar Sesión</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isCashModalOpen && (
                <Suspense fallback={null}>
                    <CashRegisterModal
                        isOpen={isCashModalOpen}
                        onClose={() => setIsCashModalOpen(false)}
                        registerId={registerId}
                        registerDisplayName={registerDisplayName}
                        businessSettings={businessSettings}
                    />
                </Suspense>
            )}

            {isProductModalOpen && (
                <Suspense fallback={null}>
                    <ProductModal
                        isOpen={isProductModalOpen}
                        onClose={() => setIsProductModalOpen(false)}
                        onSave={handleSaveProduct}
                        product={selectedAlertProduct}
                        processing={processingProduct}
                    />
                </Suspense>
            )}

            {isAboutModalOpen && (
                <Suspense fallback={null}>
                    <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />
                </Suspense>
            )}

            {(shiftStatusChecked && !registerDisplayName && !isCashModalOpen && !isShiftOpen && location.pathname === '/pos') && (
                <Suspense fallback={null}>
                    <RegisterSetupModal isOpen={true} onClose={() => setIsShiftOpen(true)} />
                </Suspense>
            )}

            {isAppearanceModalOpen && (
                <Suspense fallback={null}>
                    <AppearanceModal isOpen={isAppearanceModalOpen} onClose={() => setIsAppearanceModalOpen(false)} />
                </Suspense>
            )}
            
            {isExchangeModalOpen && (
                <Suspense fallback={null}>
                    <ExchangeRateModal
                        isOpen={isExchangeModalOpen}
                        onClose={() => setIsExchangeModalOpen(false)}
                        currentRate={exchangeRate}
                        currentEuroRate={euroRate}
                        currencyMode={currencyMode}
                        onRateUpdated={fetchExchangeRate}
                    />
                </Suspense>
            )}

            {isWhatsappModalOpen && (
                <Suspense fallback={null}>
                    <WhatsappBotModal 
                        isOpen={isWhatsappModalOpen} 
                        onClose={() => setIsWhatsappModalOpen(false)} 
                    />
                </Suspense>
            )}

            {isCalculatorOpen && (
                <Suspense fallback={null}>
                    <CalculatorModal 
                        isOpen={isCalculatorOpen}
                        onClose={() => setIsCalculatorOpen(false)}
                    />
                </Suspense>
            )}

            {showFirstTimeSetup && (
                <Suspense fallback={null}>
                    <FirstTimeSetupWizard
                        onCompleted={() => {
                            setShowFirstTimeSetup(false);
                            localStorage.setItem('initial_setup_completed', 'true');
                        }}
                    />
                </Suspense>
            )}

            {/* Quick Settings Finder (Ctrl + K o botón táctil) */}
            {isGlobalFinderOpen && (
                <Suspense fallback={null}>
                    <QuickSettingsFinder
                        isOpen={isGlobalFinderOpen}
                        onClose={() => setIsGlobalFinderOpen(false)}
                        onSelectSetting={handleQuickSelectSetting}
                    />
                </Suspense>
            )}

            {/* Removed duplicate LockScreen, managed by App.jsx globally */}
        </div>
    );
}
