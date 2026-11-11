import { useState, useMemo } from 'react';
import { 
    Calendar, DollarSign, RotateCcw, Filter, ChevronDown, ChevronUp,
    CreditCard, FileText, CheckCircle2, User, Monitor, Clock
} from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';

const formatDateString = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export default function SalesFilters({ onFilterChange, paymentMethods = [], users = [], registers = [], initialFilters = {} }) {
    const { user } = useAuth();
    const currentUserRole = String(user?.role || '').toLowerCase();
    const canFilterByRegister = ['admin', 'superadmin', 'owner', 'dueño', 'dueno', 'gerente', 'manager', 'administrador', 'supervisor'].includes(currentUserRole);
    const isAdmin = canFilterByRegister;

    const [filters, setFilters] = useState(() => {
        const today = formatDateString(new Date());
        return {
            startDate: today,
            endDate: today,
            paymentMethod: '',
            documentType: '',
            status: '',
            userId: '',
            registerId: '',
            minAmount: '',
            maxAmount: '',
            ...initialFilters
        };
    });

    const [showAdvanced, setShowAdvanced] = useState(false);

    // Determine which preset is currently active
    const activePreset = useMemo(() => {
        if (!filters.startDate && !filters.endDate) return 'all';
        const todayStr = formatDateString(new Date());
        if (filters.startDate === todayStr && filters.endDate === todayStr) return 'today';
        
        const y = new Date();
        y.setDate(new Date().getDate() - 1);
        const yStr = formatDateString(y);
        if (filters.startDate === yStr && filters.endDate === yStr) return 'yesterday';
        
        const past7 = new Date();
        past7.setDate(new Date().getDate() - 6);
        if (filters.startDate === formatDateString(past7) && filters.endDate === todayStr) return '7days';
        
        const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        if (filters.startDate === formatDateString(firstDay) && filters.endDate === todayStr) return 'month';
        
        return 'custom';
    }, [filters.startDate, filters.endDate]);

    const applyDatePreset = (presetKey) => {
        const today = new Date();
        let start = '';
        let end = '';

        if (presetKey === 'today') {
            start = formatDateString(today);
            end = formatDateString(today);
        } else if (presetKey === 'yesterday') {
            const y = new Date();
            y.setDate(today.getDate() - 1);
            start = formatDateString(y);
            end = formatDateString(y);
        } else if (presetKey === '7days') {
            const past7 = new Date();
            past7.setDate(today.getDate() - 6);
            start = formatDateString(past7);
            end = formatDateString(today);
        } else if (presetKey === 'month') {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            start = formatDateString(firstDay);
            end = formatDateString(today);
        } else if (presetKey === 'all') {
            start = '';
            end = '';
        }

        const updated = { ...filters, startDate: start, endDate: end };
        setFilters(updated);
        onFilterChange(updated);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        const newFilters = { ...filters, [name]: value };
        setFilters(newFilters);
        onFilterChange(newFilters);
    };

    const clearFilters = () => {
        const today = formatDateString(new Date());
        const cleared = {
            startDate: today,
            endDate: today,
            paymentMethod: '',
            documentType: '',
            status: '',
            userId: '',
            registerId: '',
            minAmount: '',
            maxAmount: ''
        };
        setFilters(cleared);
        onFilterChange(cleared);
    };

    // Calculate how many filters are currently active (excluding defaults)
    const activeFilterCount = useMemo(() => {
        let count = 0;
        const today = formatDateString(new Date());
        if (filters.startDate !== today || filters.endDate !== today) count++;
        if (filters.paymentMethod) count++;
        if (filters.documentType) count++;
        if (filters.status) count++;
        if (filters.userId) count++;
        if (filters.registerId) count++;
        if (filters.minAmount || filters.maxAmount) count++;
        return count;
    }, [filters]);

    const advancedFilterCount = [
        filters.userId, 
        filters.registerId, 
        filters.minAmount, 
        filters.maxAmount
    ].filter(v => v !== '').length;

    const presets = [
        { key: 'today', label: 'Hoy' },
        { key: 'yesterday', label: 'Ayer' },
        { key: '7days', label: '7 Días' },
        { key: 'month', label: 'Este Mes' },
        { key: 'all', label: 'Todo' },
    ];

    return (
        <div className="space-y-3 animate-in fade-in duration-300">
            {/* Quick Date Presets Row */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-medium text-slate-500 mr-1 flex items-center gap-1">
                        <Clock size={12} className="text-slate-400" /> Período:
                    </span>
                    <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 gap-0.5 text-xs">
                        {presets.map(p => {
                            const isSelected = activePreset === p.key;
                            return (
                                <button
                                    key={p.key}
                                    type="button"
                                    onClick={() => applyDatePreset(p.key)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                                        isSelected
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Right controls: Advanced filters toggle & Clear all */}
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced(prev => !prev)}
                        className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors border flex items-center gap-1.5 cursor-pointer ${
                            showAdvanced || advancedFilterCount > 0
                                ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-800/40'
                                : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Filter size={12} />
                        <span>Filtros Avanzados</span>
                        {advancedFilterCount > 0 && (
                            <span className="w-4 h-4 rounded-full bg-primary-600 text-white text-[10px] flex items-center justify-center font-bold">
                                {advancedFilterCount}
                            </span>
                        )}
                        {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {activeFilterCount > 0 && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="h-8 px-2.5 rounded-lg text-xs font-medium transition-colors text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer"
                            title="Restablecer filtros al día actual"
                        >
                            <RotateCcw size={11} />
                            <span>Limpiar ({activeFilterCount})</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Main Primary Filters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12 gap-2.5 items-end">
                {/* 1. Date Range: Start -> End */}
                <div className="sm:col-span-2 md:col-span-3 lg:col-span-3 xl:col-span-4 space-y-1">
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Calendar size={12} className="text-slate-400" /> Rango de Fechas
                    </label>
                    <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                            <input
                                type="date"
                                name="startDate"
                                value={filters.startDate}
                                onChange={handleChange}
                                title="Fecha Desde"
                                className="w-full h-8 px-2.5 text-xs font-mono font-medium bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-slate-900 dark:text-white"
                            />
                        </div>
                        <span className="text-slate-400 text-xs font-bold">-</span>
                        <div className="relative flex-1">
                            <input
                                type="date"
                                name="endDate"
                                value={filters.endDate}
                                onChange={handleChange}
                                title="Fecha Hasta"
                                className="w-full h-8 px-2.5 text-xs font-mono font-medium bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-slate-900 dark:text-white"
                            />
                        </div>
                    </div>
                </div>

                {/* 2. Payment Method */}
                <div className="sm:col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-3 space-y-1">
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <CreditCard size={12} className="text-slate-400" /> Método de Pago
                    </label>
                    <select
                        name="paymentMethod"
                        value={filters.paymentMethod}
                        onChange={handleChange}
                        className="w-full h-8 px-2.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-slate-900 dark:text-white cursor-pointer"
                    >
                        <option value="">Todos los métodos</option>
                        <option value="cash">Efectivo</option>
                        <option value="card">Punto de Venta / Tarjeta</option>
                        <option value="transfer">Pago Móvil / Transferencia</option>
                        <option value="zelle">Zelle</option>
                        <option value="fiado">Fiado (Crédito)</option>
                        {paymentMethods.map(pm => (
                            <option key={pm.id} value={pm.id}>{pm.name}</option>
                        ))}
                    </select>
                </div>

                {/* 3. Document Type */}
                <div className="sm:col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-2 space-y-1">
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <FileText size={12} className="text-slate-400" /> Tipo Comprobante
                    </label>
                    <select
                        name="documentType"
                        value={filters.documentType}
                        onChange={handleChange}
                        className="w-full h-8 px-2.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-slate-900 dark:text-white cursor-pointer"
                    >
                        <option value="">Todos los tipos</option>
                        <option value="factura">Factura</option>
                        <option value="nota_entrega">Nota de Entrega</option>
                    </select>
                </div>

                {/* 4. Status */}
                <div className="sm:col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-3 space-y-1">
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <CheckCircle2 size={12} className="text-slate-400" /> Estado
                    </label>
                    <select
                        name="status"
                        value={filters.status}
                        onChange={handleChange}
                        className="w-full h-8 px-2.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-slate-900 dark:text-white cursor-pointer"
                    >
                        <option value="">Todos los estados</option>
                        <option value="completed">Completadas</option>
                        <option value="refunded">Reembolsadas</option>
                        <option value="cancelled">Anuladas</option>
                    </select>
                </div>
            </div>

            {/* Collapsible Advanced Filters Section */}
            {showAdvanced && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3 animate-in slide-in-from-top-1 duration-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-12 gap-3 items-end">
                        {/* Vendor / User */}
                        {users && users.length > 0 && (
                            <div className="sm:col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-3 space-y-1">
                                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                    <User size={12} className="text-slate-400" /> Cajero / Operador
                                </label>
                                <select
                                    name="userId"
                                    value={filters.userId}
                                    onChange={handleChange}
                                    className="w-full h-8 px-2.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-900 dark:text-white cursor-pointer"
                                >
                                    <option value="">Todos los operadores</option>
                                    {users.map(u => (
                                        <option key={u.id} value={u.id}>{u.name || u.username}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Caja / Terminal */}
                        {canFilterByRegister && (
                            <div className="sm:col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-3 space-y-1">
                                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                    <Monitor size={12} className="text-slate-400" /> Caja / Terminal
                                </label>
                                <select
                                    name="registerId"
                                    value={filters.registerId || ''}
                                    onChange={handleChange}
                                    className="w-full h-8 px-2.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-900 dark:text-white cursor-pointer"
                                >
                                    <option value="">Todas las cajas</option>
                                    {registers && registers.length > 0 ? (
                                        registers.map(reg => (
                                            <option key={reg.id} value={reg.id}>
                                                {reg.name || `Caja ${reg.id}`} {reg.activeUser ? `(${reg.activeUser})` : ''} {reg.isActive ? '[Abierta]' : '[Cerrada]'}
                                            </option>
                                        ))
                                    ) : (
                                        <option value="1">Caja 1 (Principal)</option>
                                    )}
                                </select>
                            </div>
                        )}

                        {/* Amount Range (Min - Max) */}
                        <div className={`sm:col-span-2 md:col-span-1 lg:col-span-2 ${isAdmin ? 'xl:col-span-6' : 'xl:col-span-9'} space-y-1`}>
                            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <DollarSign size={12} className="text-slate-400" /> Rango de Importe ($)
                            </label>
                            <div className="flex items-center gap-1.5">
                                <div className="relative flex-1">
                                    <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <input
                                        type="number"
                                        name="minAmount"
                                        placeholder="Mín"
                                        value={filters.minAmount}
                                        onChange={handleChange}
                                        className="w-full h-8 pl-6 pr-2 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-900 dark:text-white placeholder-slate-400"
                                    />
                                </div>
                                <span className="text-slate-400 text-xs font-bold">-</span>
                                <div className="relative flex-1">
                                    <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <input
                                        type="number"
                                        name="maxAmount"
                                        placeholder="Máx"
                                        value={filters.maxAmount}
                                        onChange={handleChange}
                                        className="w-full h-8 pl-6 pr-2 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 text-slate-900 dark:text-white placeholder-slate-400"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
