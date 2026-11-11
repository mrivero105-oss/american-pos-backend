import { useState, useEffect, useMemo } from 'react';
import { 
    X, Save, Mail, Lock, User as UserIcon, Shield, RefreshCcw, 
    Activity, Plus, Key, Phone, Building, Check, Copy, CheckCircle2,
    Eye, EyeOff, AlertTriangle, Layers, Zap, Sliders, ShieldCheck,
    ShoppingCart, Users, Package, Truck, Banknote, TrendingUp, Settings,
    Search, CheckSquare, Square, DollarSign, Coins, Warehouse, Hammer,
    FileText, Landmark, FileSpreadsheet, PieChart, Scale,
    Building2, Store, UserCog
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BaseModal from './BaseModal';
import { useAuth } from '../hooks/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';

export const PERMISSION_CATEGORIES = [
    {
        id: 'sales',
        title: 'Operaciones de Ventas y Cobros (POS)',
        icon: ShoppingCart,
        badgeColor: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        permissions: [
            { key: 'canAccessPOS', title: 'Acceso a Terminal POS', desc: 'Facturación directa, apertura de tickets y cobro en mostrador' },
            { key: 'canVoidSales', title: 'Anular Facturas / Devoluciones', desc: 'Cancelar ventas emitidas y generar notas de crédito' },
            { key: 'canApplyDiscounts', title: 'Aplicar Descuentos Manuales', desc: 'Rebajar montos o porcentajes en el checkout' },
            { key: 'canModifyPrices', title: 'Modificar Precios al Vender', desc: 'Alterar precio unitario de productos del catálogo en vivo' },
            { key: 'canOpenDrawer', title: 'Apertura Manual de Gaveta', desc: 'Abrir gaveta de dinero sin necesidad de emitir venta' },
            { key: 'canManageCashShift', title: 'Control y Arqueo de Caja', desc: 'Apertura, cuadre ciego y cierre de turnos de caja' },
            { key: 'canViewSalesHistory', title: 'Gestor e Historial de Ventas', desc: 'Consultar histórico de ventas, tickets y reimprimir recibos' }
        ]
    },
    {
        id: 'customers',
        title: 'Clientes y Gestión de Créditos',
        icon: Users,
        badgeColor: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
        permissions: [
            { key: 'canManageCustomers', title: 'Directorio de Clientes', desc: 'Crear, editar, consultar y exportar fichas de clientes' },
            { key: 'canManageReceivables', title: 'Cuentas por Cobrar (Créditos)', desc: 'Gestión de fiados, límites crediticios y abonos de clientes' },
            { key: 'canAccessCollections', title: 'Radar de Cobranzas', desc: 'Seguimiento de morosidad, gestión preventiva y cobros vencidos' }
        ]
    },
    {
        id: 'inventory',
        title: 'Catálogo e Inventario',
        icon: Package,
        badgeColor: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        permissions: [
            { key: 'canManageInventory', title: 'Inventario y Existencias', desc: 'Consultar stock físico, existencias por sede y valorización' },
            { key: 'canCreateProducts', title: 'Crear / Editar Productos', desc: 'Modificar fichas, códigos de barra, descripciones y fotos' },
            { key: 'canAdjustStock', title: 'Ajustes de Stock y Kardex', desc: 'Entradas/salidas manuales, mermas y auditoría física de inventario' },
            { key: 'canViewCosts', title: 'Ver Costos y Márgenes', desc: 'Visualizar costo de adquisición de productos y margen de ganancia' },
            { key: 'canManageWarehouses', title: 'Almacenes y Logística', desc: 'Gestión de múltiples bodegas y transferencias entre sedes' },
            { key: 'canManagePromotions', title: 'Promociones & Ofertas', desc: 'Crear, editar y configurar combos, descuentos automáticos y 2x1' }
        ]
    },
    {
        id: 'purchases',
        title: 'Compras y Proveedores',
        icon: Truck,
        badgeColor: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        permissions: [
            { key: 'canManageSuppliers', title: 'Directorio de Proveedores', desc: 'Fichas de proveedores, contactos comerciales y catálogos' },
            { key: 'canManagePurchases', title: 'Órdenes de Compra y Recepción', desc: 'Emitir pedidos a proveedores y recepcionar mercancía en stock' },
            { key: 'canManagePayables', title: 'Cuentas por Pagar', desc: 'Control de facturas por pagar y registro de abonos a proveedores' },
            { key: 'canImportCatalog', title: 'Importador de Facturas/Catálogos (PDF/Excel)', desc: 'Carga masiva de facturas de compras con lectura óptica y tablas' }
        ]
    },
    {
        id: 'treasury',
        title: 'Tesorería, Gastos y Tributos',
        icon: Banknote,
        badgeColor: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
        permissions: [
            { key: 'canManageExpenses', title: 'Gastos Operativos y Vales', desc: 'Registro de egresos extraordinarios y salidas de caja menor' },
            { key: 'canManageBanking', title: 'Bancos y Conciliación', desc: 'Cuentas bancarias, registro de transferencias y conciliación' },
            { key: 'canManageFiscal', title: 'Gestión Fiscal SENIAT', desc: 'Libros de compras/ventas y correlativos de facturación fiscal' }
        ]
    },
    {
        id: 'management',
        title: 'Contabilidad y Reportes Gerenciales',
        icon: TrendingUp,
        badgeColor: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
        permissions: [
            { key: 'canAccessBI', title: 'Inteligencia de Negocios (BI) & P&L', desc: 'Dashboard financiero, estado de resultados y rentabilidad neta' },
            { key: 'canViewReports', title: 'Reportes Generales de Ventas', desc: 'Estadísticas globales, productos más vendidos y cierres Z' },
            { key: 'canManageAccounting', title: 'Contabilidad General (PUC)', desc: 'Libro diario, asientos contables y balance de comprobación' },
            { key: 'canManagePayroll', title: 'Nómina y Recursos Humanos', desc: 'Procesamiento de salarios, comisiones y recibos de pago' },
            { key: 'canManageAssets', title: 'Activos Fijos y Depreciación', desc: 'Registro de maquinaria, mobiliario y amortización de bienes' }
        ]
    },
    {
        id: 'security',
        title: 'Seguridad y Auditoría',
        icon: Shield,
        badgeColor: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
        permissions: [
            { key: 'canAccessAudit', title: 'Panel de Auditoría de Seguridad', desc: 'Revisión de logs, historial de cambios y actividades sospechosas' },
            { key: 'canMonitorCashiers', title: 'Auditoría y Monitoreo de Cajas', desc: 'Supervisión en vivo de gavetas, anulaciones y descuadres' }
        ]
    },
    {
        id: 'admin',
        title: 'Administración del Sistema',
        icon: Settings,
        badgeColor: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
        permissions: [
            { key: 'canManageBranches', title: 'Gestión de Sucursales', desc: 'Crear y administrar puntos de venta y locales comerciales' },
            { key: 'canManageUsers', title: 'Usuarios y Permisos', desc: 'Registrar operadores, asignar roles y configurar privilegios' },
            { key: 'canManageSettings', title: 'Ajustes Generales del Sistema', desc: 'Tasas de cambio, impresoras fiscales y datos de la empresa' }
        ]
    }
];

// Flat map of all default permissions initialized to false
const DEFAULT_PERMISSIONS = PERMISSION_CATEGORIES.reduce((acc, cat) => {
    cat.permissions.forEach(p => {
        acc[p.key] = false;
    });
    return acc;
}, {});

// Pre-packaged permissions per role
const ROLE_PRESET_PERMISSIONS = {
    superadmin: { ...DEFAULT_PERMISSIONS, ...Object.keys(DEFAULT_PERMISSIONS).reduce((acc, k) => ({ ...acc, [k]: true }), {}) },
    admin: {
        ...DEFAULT_PERMISSIONS,
        canAccessPOS: true,
        canVoidSales: true,
        canApplyDiscounts: true,
        canModifyPrices: true,
        canOpenDrawer: true,
        canManageCashShift: true,
        canViewSalesHistory: true,
        canManageCustomers: true,
        canManageReceivables: true,
        canAccessCollections: true,
        canManageInventory: true,
        canCreateProducts: true,
        canAdjustStock: true,
        canViewCosts: true,
        canManageWarehouses: true,
        canManagePromotions: true,
        canManageSuppliers: true,
        canManagePurchases: true,
        canManagePayables: true,
        canImportCatalog: true,
        canManageExpenses: true,
        canManageBanking: true,
        canManageFiscal: true,
        canAccessBI: true,
        canViewReports: true,
        canManageAccounting: true,
        canManagePayroll: true,
        canManageAssets: true,
        canAccessAudit: true,
        canMonitorCashiers: true,
        canManageBranches: true,
        canManageUsers: true,
        canManageSettings: false
    },
    supervisor: {
        ...DEFAULT_PERMISSIONS,
        canAccessPOS: true,
        canVoidSales: true,
        canApplyDiscounts: true,
        canModifyPrices: true,
        canOpenDrawer: true,
        canManageCashShift: true,
        canViewSalesHistory: true,
        canManageCustomers: true,
        canManageReceivables: true,
        canAccessCollections: true,
        canManageInventory: true,
        canCreateProducts: true,
        canAdjustStock: true,
        canViewCosts: true,
        canManageWarehouses: true,
        canManageSuppliers: true,
        canManagePurchases: true,
        canManageExpenses: true,
        canViewReports: true,
        canAccessAudit: true,
        canMonitorCashiers: true
    },
    cashier: {
        ...DEFAULT_PERMISSIONS,
        canAccessPOS: true,
        canVoidSales: false,
        canApplyDiscounts: false,
        canModifyPrices: false,
        canOpenDrawer: false,
        canManageCashShift: true,
        canViewSalesHistory: true,
        canManageCustomers: true
    },
    inventory: {
        ...DEFAULT_PERMISSIONS,
        canManageInventory: true,
        canCreateProducts: true,
        canAdjustStock: true,
        canViewCosts: true,
        canManageWarehouses: true,
        canManageSuppliers: true,
        canManagePurchases: true,
        canImportCatalog: true
    },
    waiter: {
        ...DEFAULT_PERMISSIONS,
        canAccessPOS: true,
        canManageCustomers: true
    },
    user: {
        ...DEFAULT_PERMISSIONS,
        canAccessPOS: true
    }
};

const ROLES = [
    { id: 'superadmin', name: 'Superadmin / Dueño', desc: 'Control absoluto del negocio, licencias y finanzas', color: 'border-purple-500 bg-purple-500/10 text-purple-400', badgeColor: 'bg-purple-500' },
    { id: 'admin', name: 'Administrador / Gerente', desc: 'Gestión operativa, reportes, inventario y personal', color: 'border-blue-500 bg-blue-500/10 text-blue-400', badgeColor: 'bg-blue-500' },
    { id: 'supervisor', name: 'Supervisor de Caja', desc: 'Autorización con PIN, anulación de tickets y sobregiro', color: 'border-amber-500 bg-amber-500/10 text-amber-400', badgeColor: 'bg-amber-500' },
    { id: 'cashier', name: 'Cajero / Punto de Venta', desc: 'Facturación, cobros, arqueo ciego y cortes de turno', color: 'border-emerald-500 bg-emerald-500/10 text-emerald-400', badgeColor: 'bg-emerald-500' },
    { id: 'inventory', name: 'Encargado de Almacén', desc: 'Control de stock, compras, kardex y proveedores', color: 'border-cyan-500 bg-cyan-500/10 text-cyan-400', badgeColor: 'bg-cyan-500' },
    { id: 'waiter', name: 'Mesero / Vendedor', desc: 'Toma de pedidos, cotizaciones y comandas', color: 'border-rose-500 bg-rose-500/10 text-rose-400', badgeColor: 'bg-rose-500' }
];

const AVATAR_COLORS = [
    'from-blue-600 to-indigo-700',
    'from-emerald-600 to-teal-700',
    'from-purple-600 to-pink-700',
    'from-amber-500 to-orange-600',
    'from-rose-600 to-red-700',
    'from-cyan-600 to-blue-700',
    'from-slate-700 to-slate-900'
];

export default function UserModal({ isOpen, onClose, onSave, user, processing, initialTab = 'identity' }) {
    const { user: currentUser } = useAuth();
    const [activeTab, setActiveTab] = useState('identity'); // 'identity' | 'permissions' | 'security'
    const [showPassword, setShowPassword] = useState(false);
    const [branches, setBranches] = useState([]);
    
    // Permissions Filter and Search
    const [selectedCategory, setSelectedCategory] = useState('ALL');
    const [permissionSearch, setPermissionSearch] = useState('');

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        username: '',
        email: '',
        password: '',
        phone: '',
        role: 'cashier',
        status: 'active',
        defaultCurrency: 'BOTH',
        activeBranchId: '',
        avatarColor: AVATAR_COLORS[0],
        permissions: { ...DEFAULT_PERMISSIONS }
    });

    // Supervisor PIN Setup State
    const [supervisorPin, setSupervisorPin] = useState('');
    const [currentSupervisorPin, setCurrentSupervisorPin] = useState('');

    useEffect(() => {
        if (isOpen) {
            fetchBranches();
            if (user) {
                const userRole = user.role || 'cashier';
                const basePerms = ROLE_PRESET_PERMISSIONS[userRole] || DEFAULT_PERMISSIONS;
                setFormData({
                    name: user.name || '',
                    username: user.username || '',
                    email: user.email || '',
                    password: '',
                    phone: user.phone || '',
                    role: userRole,
                    status: user.status || 'active',
                    defaultCurrency: user.defaultCurrency || 'BOTH',
                    activeBranchId: user.activeBranchId || '',
                    avatarColor: user.avatarColor || AVATAR_COLORS[0],
                    permissions: { ...basePerms, ...(user.permissions || {}) }
                });
            } else {
                setFormData({
                    name: '',
                    username: '',
                    email: '',
                    password: generatePassword(),
                    phone: '',
                    role: 'cashier',
                    status: 'active',
                    defaultCurrency: 'BOTH',
                    activeBranchId: '',
                    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
                    permissions: { ...ROLE_PRESET_PERMISSIONS['cashier'] }
                });
            }
            setSupervisorPin('');
            setCurrentSupervisorPin('');
            setSelectedCategory('ALL');
            setPermissionSearch('');
            setActiveTab(initialTab || 'identity');
        }
    }, [user, isOpen, initialTab]);

    const fetchBranches = async () => {
        try {
            const { data } = await api.get('/branches');
            setBranches(data || []);
        } catch (e) {
            console.error('Error fetching branches', e);
        }
    };

    function generatePassword(length = 8) {
        const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
        let pass = '';
        for (let i = 0; i < length; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return pass;
    }

    const handleGenerateNewPassword = () => {
        const pass = generatePassword();
        setFormData(prev => ({ ...prev, password: pass }));
        setShowPassword(true);
        navigator.clipboard?.writeText(pass);
        toast.success('Contraseña generada y copiada al portapapeles');
    };

    const handleRoleChange = (newRole) => {
        const defaultPerms = ROLE_PRESET_PERMISSIONS[newRole] || DEFAULT_PERMISSIONS;
        setFormData(prev => ({
            ...prev,
            role: newRole,
            permissions: { ...defaultPerms }
        }));
    };

    const togglePermission = (key) => {
        setFormData(prev => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [key]: !prev.permissions[key]
            }
        }));
    };

    const toggleCategory = (category) => {
        const allKeys = category.permissions.map(p => p.key);
        const allActive = allKeys.every(k => !!formData.permissions[k]);
        
        setFormData(prev => {
            const nextPerms = { ...prev.permissions };
            allKeys.forEach(k => {
                nextPerms[k] = !allActive;
            });
            return { ...prev, permissions: nextPerms };
        });
    };

    const setAllPermissions = (enableAll) => {
        const newPerms = {};
        Object.keys(DEFAULT_PERMISSIONS).forEach(k => {
            newPerms[k] = enableAll;
        });
        setFormData(prev => ({
            ...prev,
            permissions: newPerms
        }));
        toast.success(enableAll ? 'Todos los permisos concedidos' : 'Todos los permisos revocados');
    };

    const handleResetPermissionsToRole = () => {
        const defaultPerms = ROLE_PRESET_PERMISSIONS[formData.role] || DEFAULT_PERMISSIONS;
        setFormData(prev => ({
            ...prev,
            permissions: { ...defaultPerms }
        }));
        toast.success(`Permisos restablecidos para el rol: ${formData.role.toUpperCase()}`);
    };

    // Calculate total granted permissions
    const totalPermissionsCount = Object.keys(DEFAULT_PERMISSIONS).length;
    const grantedPermissionsCount = Object.values(formData.permissions).filter(Boolean).length;

    // Filter categories and permissions based on selected category and search input
    const filteredCategories = useMemo(() => {
        const search = permissionSearch.trim().toLowerCase();
        
        return PERMISSION_CATEGORIES.filter(cat => {
            if (selectedCategory !== 'ALL' && cat.id !== selectedCategory) return false;
            return true;
        }).map(cat => {
            if (!search) return cat;
            const matchingPerms = cat.permissions.filter(p => 
                p.title.toLowerCase().includes(search) || 
                p.desc.toLowerCase().includes(search)
            );
            return { ...cat, permissions: matchingPerms };
        }).filter(cat => cat.permissions.length > 0);
    }, [selectedCategory, permissionSearch]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            toast.error('El nombre es obligatorio');
            return;
        }

        const dataToSend = { ...formData };
        if (user && !dataToSend.password) {
            delete dataToSend.password;
        }

        // Attach supervisorPin directly to dataToSend so it is saved atomically
        if (supervisorPin) {
            if (supervisorPin.length < 4 || supervisorPin.length > 6) {
                toast.error('El PIN de supervisor debe tener entre 4 y 6 dígitos');
                return;
            }
            if (user?.id && Boolean(user?.hasPin || user?.supervisorPin)) {
                if (!currentSupervisorPin || currentSupervisorPin.length < 4) {
                    toast.error('Por motivos de seguridad, debes ingresar el PIN actual del operador para cambiarlo');
                    return;
                }
                dataToSend.currentPin = currentSupervisorPin;
            }
            dataToSend.supervisorPin = supervisorPin;
        }

        await onSave(dataToSend);
    };

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-6xl w-[94vw]"
            className="overflow-hidden flex flex-col font-sans"
            disableOutsideClick={true}
        >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${formData.avatarColor || AVATAR_COLORS[0]} text-white flex items-center justify-center font-black text-lg shadow-md border border-white/20 shrink-0`}>
                        {(formData.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                {user ? 'Editar Ficha de Usuario' : 'Nuevo Operador de Sistema'}
                            </h2>
                            <span className="px-2 py-0.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 text-[10px] font-black rounded-md uppercase">
                                {formData.role}
                            </span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                            {user ? `ID: #${user.id.substring(0, 8)} • ${user.email || user.username}` : 'Registra credenciales, rol y matriz de seguridad'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-all active:scale-95 cursor-pointer"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex p-1.5 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 shrink-0 px-6 gap-2">
                <button
                    type="button"
                    onClick={() => setActiveTab('identity')}
                    className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'identity' ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <UserIcon size={14} /> 1. Identidad & Rol
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('permissions')}
                    className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'permissions' ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <ShieldCheck size={14} /> 2. Matriz de Permisos ({grantedPermissionsCount}/{totalPermissionsCount})
                </button>
                {['admin', 'supervisor', 'superadmin'].includes(formData.role) && (
                    <button
                        type="button"
                        onClick={() => setActiveTab('security')}
                        className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'security' ? 'bg-white dark:bg-slate-700 text-amber-500 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                    >
                        <Key size={14} /> 3. PIN Supervisor
                    </button>
                )}
            </div>

            {/* Main Form Content */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 custom-scrollbar max-h-[78vh]">
                <AnimatePresence mode="wait">
                    {/* TAB 1: IDENTIDAD Y ROL */}
                    {activeTab === 'identity' && (
                        <motion.div
                            key="tab-identity"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-5"
                        >
                            {/* Color Selector */}
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                                <span className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    Color de Identidad
                                </span>
                                <div className="flex gap-2">
                                    {AVATAR_COLORS.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, avatarColor: c })}
                                            className={`w-6 h-6 rounded-full bg-gradient-to-br ${c} transition-transform ${formData.avatarColor === c ? 'ring-2 ring-primary-500 scale-125' : 'hover:scale-110 opacity-70'}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Name & Username */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Nombre Completo *</label>
                                    <div className="relative">
                                        <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="Ej. Carlos Mendoza"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Nombre de Usuario (Login) *</label>
                                    <div className="relative">
                                        <Activity className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            required
                                            value={formData.username}
                                            onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-black font-mono outline-none focus:border-primary-500 text-slate-900 dark:text-white lowercase"
                                            placeholder="carlosm"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Email & Phone */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Correo Electrónico</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="operador@pos.com"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Teléfono / WhatsApp</label>
                                    <div className="relative">
                                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="+58 412 1234567"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Password with Generator */}
                            <div className="space-y-1">
                                <div className="flex justify-between items-center px-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                        {user ? 'Cambiar Contraseña (Dejar en blanco para mantener)' : 'Contraseña de Acceso *'}
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleGenerateNewPassword}
                                        className="text-[10px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-wider hover:underline flex items-center gap-1"
                                    >
                                        <Key size={12} /> Generar Clave Segura
                                    </button>
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="w-full pl-10 pr-20 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold font-mono outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                        placeholder={user ? '••••••••' : 'Contraseña segura'}
                                    />
                                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                        {formData.password && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard?.writeText(formData.password);
                                                    toast.success('Copiada');
                                                }}
                                                className="p-1 text-slate-400 hover:text-primary-500"
                                                title="Copiar contraseña"
                                            >
                                                <Copy size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Role Cards Grid */}
                            <div className="space-y-2 pt-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Rol y Nivel de Jerarquía</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {ROLES.filter(r => r.id !== 'superadmin' || user?.role === 'superadmin').map(r => {
                                        const isSelected = formData.role === r.id;
                                        return (
                                            <button
                                                key={r.id}
                                                type="button"
                                                onClick={() => handleRoleChange(r.id)}
                                                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${isSelected ? `${r.color} shadow-md` : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300'}`}
                                            >
                                                <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${isSelected ? r.badgeColor : 'bg-slate-300 dark:bg-slate-700'}`} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white leading-tight">
                                                        {r.name}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                                        {r.desc}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Branch & Currency Preference */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Sucursal Asignada</label>
                                    <div className="relative">
                                        <Building className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <select
                                            value={formData.activeBranchId}
                                            onChange={(e) => setFormData({ ...formData, activeBranchId: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                                        >
                                            <option value="">Todas las Sucursales (Global)</option>
                                            {branches.map(b => (
                                                <option key={b.id} value={b.id}>{b.name} ({b.code || 'MATRIZ'})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Moneda Visual Preferida</label>
                                    <select
                                        value={formData.defaultCurrency}
                                        onChange={(e) => setFormData({ ...formData, defaultCurrency: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none text-slate-900 dark:text-white"
                                    >
                                        <option value="BOTH">Bimoneda (USD + VES)</option>
                                        <option value="USD">Solo Dólares (USD $)</option>
                                        <option value="VES">Solo Bolívares (Bs. VES)</option>
                                    </select>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* TAB 2: MATRIZ DE PERMISOS COMPLETA POR CATEGORÍA */}
                    {activeTab === 'permissions' && (
                        <motion.div
                            key="tab-permissions"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-5"
                        >
                            {/* Summary & Bulk Action Bar */}
                            <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">
                                            Matriz Granular de Permisos
                                        </h4>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                                            {grantedPermissionsCount} de {totalPermissionsCount} concedidos
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                        Rol seleccionado: <strong className="text-slate-800 dark:text-slate-200 uppercase">{formData.role}</strong> • Configura los accesos exactos para cada módulo
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setAllPermissions(true)}
                                        className="px-2.5 py-1.5 text-[10px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl transition-all uppercase flex items-center gap-1"
                                        title="Conceder todos los permisos del sistema"
                                    >
                                        <CheckSquare size={13} /> Marcar Todos
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAllPermissions(false)}
                                        className="px-2.5 py-1.5 text-[10px] font-bold bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xl transition-all uppercase flex items-center gap-1"
                                        title="Desmarcar todos los permisos"
                                    >
                                        <Square size={13} /> Desmarcar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleResetPermissionsToRole}
                                        className="px-2.5 py-1.5 text-[10px] font-bold bg-slate-200 dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-700 dark:text-slate-200 rounded-xl transition-all uppercase flex items-center gap-1"
                                        title="Restablecer a los valores por defecto del rol"
                                    >
                                        <RefreshCcw size={12} /> Rol por Defecto
                                    </button>
                                </div>
                            </div>

                            {/* Category Filter Pills & Search */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                                    <input
                                        type="text"
                                        value={permissionSearch}
                                        onChange={(e) => setPermissionSearch(e.target.value)}
                                        placeholder="Buscar permiso específico (ej: precio, anular, gastos, inventario)..."
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                    />
                                </div>

                                <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedCategory('ALL')}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${selectedCategory === 'ALL' ? 'bg-primary-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                    >
                                        Todas ({PERMISSION_CATEGORIES.length})
                                    </button>
                                    {PERMISSION_CATEGORIES.map(cat => {
                                        const isSelected = selectedCategory === cat.id;
                                        return (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setSelectedCategory(cat.id)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${isSelected ? 'bg-primary-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                            >
                                                {cat.title.split(' ')[0]} ({cat.permissions.length})
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Categorized Permissions Accordions / Sections */}
                            <div className="space-y-6">
                                {filteredCategories.map(category => {
                                    const CategoryIcon = category.icon;
                                    const catKeys = category.permissions.map(p => p.key);
                                    const activeCount = catKeys.filter(k => !!formData.permissions[k]).length;
                                    const allActive = activeCount === catKeys.length;

                                    return (
                                        <div key={category.id} className="space-y-2.5">
                                            {/* Category Header */}
                                            <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/80 dark:border-slate-800">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-1.5 rounded-lg ${category.badgeColor}`}>
                                                        <CategoryIcon size={16} />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                                            {category.title}
                                                        </h3>
                                                    </div>
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                        {activeCount} de {catKeys.length} activos
                                                    </span>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => toggleCategory(category)}
                                                    className="text-[10px] font-black text-primary-600 dark:text-primary-400 hover:underline uppercase tracking-wider cursor-pointer"
                                                >
                                                    {allActive ? 'Desmarcar sección' : 'Marcar toda la sección'}
                                                </button>
                                            </div>

                                            {/* Permission Cards Grid */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                                {category.permissions.map(p => {
                                                    const isChecked = !!formData.permissions[p.key];
                                                    return (
                                                        <label
                                                            key={p.key}
                                                            onClick={() => togglePermission(p.key)}
                                                            className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 select-none ${
                                                                isChecked 
                                                                    ? 'border-primary-500 bg-primary-500/[0.08] text-slate-900 dark:text-white shadow-xs ring-1 ring-primary-500/25' 
                                                                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100/50 dark:hover:bg-slate-800/60'
                                                            }`}
                                                        >
                                                            <div className={`w-5 h-5 rounded-lg mt-0.5 flex items-center justify-center transition-colors shrink-0 ${isChecked ? 'bg-primary-600 text-white shadow-xs' : 'border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'}`}>
                                                                {isChecked && <Check size={13} strokeWidth={3} />}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-[13px] font-bold leading-tight">
                                                                    {p.title}
                                                                </p>
                                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                                                                    {p.desc}
                                                                </p>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}

                                {filteredCategories.length === 0 && (
                                    <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
                                        <Search size={32} className="mx-auto mb-2 text-slate-400 opacity-50" />
                                        <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                                            No se encontraron permisos
                                        </h4>
                                        <p className="text-[11px] text-slate-400 mt-1">
                                            Prueba con otro término de búsqueda o selecciona "Todas las categorías".
                                        </p>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* TAB 3: SEGURIDAD Y PIN DE SUPERVISOR */}
                    {activeTab === 'security' && (
                        <motion.div
                            key="tab-security"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-6 max-w-md mx-auto text-center"
                        >
                            <div className="w-16 h-16 bg-amber-500/10 text-amber-500 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/20 shadow-md">
                                <Key size={32} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                    PIN de Autorización Rápida
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Código numérico confidencial de 4 a 6 dígitos para autorizar operaciones sensibles (descuadres, descuentos, anulaciones).
                                </p>
                            </div>

                            {Boolean(user?.hasPin || user?.supervisorPin) && (
                                <div className="space-y-3 max-w-xs mx-auto w-full">
                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-bold w-full justify-center">
                                        <Key size={14} /> PIN Activo — Se requiere PIN anterior
                                    </div>
                                    <div className="space-y-1 text-left">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                            PIN Actual (Para autorizar cambio)
                                        </label>
                                        <input
                                            type="password"
                                            value={currentSupervisorPin}
                                            onChange={(e) => setCurrentSupervisorPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder="Introduce PIN actual"
                                            maxLength={6}
                                            className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-amber-500/40 focus:border-amber-500 rounded-xl px-4 py-2.5 font-black text-center text-base tracking-[0.4em] outline-none transition-all text-slate-900 dark:text-white"
                                        />
                                    </div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 pt-1 text-left">
                                        Nuevo PIN de Supervisor:
                                    </p>
                                </div>
                            )}

                            {/* PIN Display */}
                            <div className="flex justify-center gap-3">
                                {[0, 1, 2, 3, 4, 5].map(idx => (
                                    <div
                                        key={idx}
                                        className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-black font-mono transition-all ${supervisorPin[idx] ? 'border-amber-500 bg-amber-500/10 text-amber-500 shadow-md' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400'}`}
                                    >
                                        {supervisorPin[idx] ? '•' : ''}
                                    </div>
                                ))}
                            </div>

                            {/* Numeric Keypad */}
                            <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => supervisorPin.length < 6 && setSupervisorPin(prev => prev + num)}
                                        className="py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-xl font-black rounded-2xl transition-all active:scale-95 shadow-sm"
                                    >
                                        {num}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setSupervisorPin('')}
                                    className="py-3.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black rounded-2xl transition-all active:scale-95 uppercase tracking-wider"
                                >
                                    Limpiar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => supervisorPin.length < 6 && setSupervisorPin(prev => prev + '0')}
                                    className="py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-xl font-black rounded-2xl transition-all active:scale-95 shadow-sm"
                                >
                                    0
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSupervisorPin(prev => prev.slice(0, -1))}
                                    className="py-3.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black rounded-2xl transition-all active:scale-95 uppercase tracking-wider"
                                >
                                    ⌫
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Footer Buttons */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-1/3 py-3.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-2xl uppercase tracking-wider text-xs transition-all active:scale-95 cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={processing}
                        className="w-2/3 py-3.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-2xl uppercase tracking-wider text-xs shadow-lg shadow-primary-600/20 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {processing ? (
                            <RefreshCcw size={16} className="animate-spin" />
                        ) : (
                            <>
                                <Save size={16} /> {user ? 'GUARDAR CAMBIOS' : 'CREAR OPERADOR'}
                            </>
                        )}
                    </button>
                </div>
            </form>
        </BaseModal>
    );
}
