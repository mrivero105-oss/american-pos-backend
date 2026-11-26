import {
  Settings, Smartphone, RefreshCw, Tag, CreditCard, DollarSign, Wallet,
  FileText, Box, Users, Truck, ShieldCheck, Coins, TrendingUp,
  Scale, Shield, Store, FileSpreadsheet, Building2, PieChart, UserCog, Banknote
} from 'lucide-react';

export const MOBILE_MODULE_PERMISSIONS = {
  pos: 'canAccessPOS',
  cash: 'canManageCashShift',
  sales: 'canViewSalesHistory',
  customers: 'canManageCustomers',
  receivables: 'canManageReceivables',
  collections: 'canAccessCollections',
  inventory: 'canManageInventory',
  promotions: 'canManagePromotions',
  importer: 'canImportCatalog',
  suppliers: 'canManageSuppliers',
  payables: 'canManagePayables',
  expenses: 'canManageExpenses',
  fiscal: 'canManageFiscal',
  bi: 'canAccessBI',
  reports: 'canViewReports',
  accounting: 'canManageAccounting',
  payroll: 'canManagePayroll',
  assets: 'canManageAssets',
  audit: 'canAccessAudit',
  'cash-monitoring': 'canMonitorCashiers',
  branches: 'canManageBranches',
  users: 'canManageUsers',
  settings: 'canManageSettings'
};

export function buildMobileNavSections(hasPermission) {
  const rawSections = [
    {
      title: 'Ventas',
      items: [
        { id: 'pos', moduleId: 'pos', label: 'Punto de Venta', icon: Smartphone, desc: 'Catálogo y cobro rápido', permission: 'canAccessPOS' },
        { id: 'cash', moduleId: 'cash', label: 'Caja y Turno', icon: Wallet, desc: 'Apertura, arqueo y cierre', permission: 'canManageCashShift' },
        { id: 'sales', moduleId: 'sales', label: 'Ventas', icon: FileText, desc: 'Historial y recibos', permission: 'canViewSalesHistory' },
        { id: 'sync', moduleId: 'sync', label: 'Conexión PC', icon: RefreshCw, desc: 'Sincronización con servidor' }
      ]
    },
    {
      title: 'Clientes',
      items: [
        { id: 'customers', moduleId: 'customers', label: 'Clientes', icon: Users, desc: 'Directorio y créditos', permission: 'canManageCustomers' },
        { id: 'receivables', moduleId: 'receivables', label: 'Por Cobrar', icon: DollarSign, desc: 'Saldos y abonos', permission: 'canManageReceivables' },
        { id: 'collections', moduleId: 'collections', label: 'Cobranza', icon: Coins, desc: 'Control de cartera', permission: 'canAccessCollections' }
      ]
    },
    {
      title: 'Inventario',
      items: [
        { id: 'inventory', moduleId: 'inventory', label: 'Inventario', icon: Box, desc: 'Productos, precios y stock', permission: 'canManageInventory' },
        { id: 'promotions', moduleId: 'promotions', label: 'Promociones', icon: Tag, desc: 'Descuentos y ofertas', permission: 'canManagePromotions' },
        { id: 'importer', moduleId: 'importer', label: 'Importar', icon: FileSpreadsheet, desc: 'Carga por Excel o CSV', permission: 'canImportCatalog' }
      ]
    },
    {
      title: 'Compras',
      items: [
        { id: 'suppliers', moduleId: 'suppliers', label: 'Proveedores', icon: Truck, desc: 'Directorio y compras', permission: 'canManageSuppliers' },
        { id: 'payables', moduleId: 'payables', label: 'Por Pagar', icon: CreditCard, desc: 'Facturas pendientes', permission: 'canManagePayables' }
      ]
    },
    {
      title: 'Tesorería',
      items: [
        { id: 'expenses', moduleId: 'expenses', label: 'Gastos', icon: Banknote, desc: 'Caja chica y egresos', permission: 'canManageExpenses' },
        { id: 'fiscal', moduleId: 'fiscal', label: 'Fiscal SENIAT', icon: FileText, desc: 'Libros e impuestos', permission: 'canManageFiscal' }
      ]
    },
    {
      title: 'Gerencia',
      items: [
        { id: 'bi', moduleId: 'bi', label: 'P&L Gerencial', icon: TrendingUp, desc: 'Márgenes y ganancias', permission: 'canAccessBI' },
        { id: 'reports', moduleId: 'reports', label: 'Reportes', icon: PieChart, desc: 'Estadísticas de ventas', permission: 'canViewReports' },
        { id: 'accounting', moduleId: 'accounting', label: 'Contabilidad', icon: Scale, desc: 'Cuentas y asientos', permission: 'canManageAccounting' },
        { id: 'payroll', moduleId: 'payroll', label: 'Nómina', icon: Users, desc: 'Personal y pagos', permission: 'canManagePayroll' },
        { id: 'assets', moduleId: 'assets', label: 'Activos Fijos', icon: Building2, desc: 'Bienes del negocio', permission: 'canManageAssets' }
      ]
    },
    {
      title: 'Seguridad',
      items: [
        { id: 'audit', moduleId: 'audit', label: 'Auditoría', icon: ShieldCheck, desc: 'Registro de actividad', permission: 'canAccessAudit' },
        { id: 'cash-monitoring', moduleId: 'cash-monitoring', label: 'Monitor Cajas', icon: Shield, desc: 'Control de cajeros', permission: 'canMonitorCashiers' }
      ]
    },
    {
      title: 'Sistema',
      items: [
        { id: 'branches', moduleId: 'branches', label: 'Sucursales', icon: Store, desc: 'Tiendas y sedes', permission: 'canManageBranches' },
        { id: 'users', moduleId: 'users', label: 'Usuarios', icon: UserCog, desc: 'Cajeros y permisos', permission: 'canManageUsers' },
        { id: 'settings', moduleId: 'settings', label: 'Ajustes', icon: Settings, desc: 'Tienda, tasa e impresoras', permission: 'canManageSettings' }
      ]
    }
  ];

  if (!hasPermission) return rawSections;
  return rawSections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((item) => !item.permission || hasPermission(item.permission))
    }))
    .filter((sec) => sec.items.length > 0);
}
