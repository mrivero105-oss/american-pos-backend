import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import {
    Building2, 
    Plus, 
    Edit2, 
    Trash2, 
    MapPin, 
    Phone, 
    CheckCircle2, 
    Star, 
    Search, 
    RefreshCcw, 
    BarChart3, 
    Users, 
    Navigation, 
    Store, 
    Warehouse, 
    Zap, 
    Award
} from 'lucide-react';
import BranchModal from '../components/BranchModal';
import BranchAnalyticsModal from '../components/BranchAnalyticsModal';
import ConfirmModal from '../components/ConfirmModal';
import toast from 'react-hot-toast';

const BRANCH_TYPE_CONFIG = {
    STORE: { label: 'Tienda POS', icon: Store, bg: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    WAREHOUSE: { label: 'Almacén Central', icon: Warehouse, bg: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' },
    EXPRESS: { label: 'Punto Express', icon: Zap, bg: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
    PHARMACY: { label: 'Farmacia', icon: Award, bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' }
};

export default function Branches() {
    const { user } = useAuth();
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('ALL');

    // Modals
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState(null);
    const [processing, setProcessing] = useState(false);

    // Analytics Modal
    const [analyticsBranch, setAnalyticsBranch] = useState(null);

    // Confirm Modal
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    useEffect(() => {
        fetchBranches();
    }, []);

    const fetchBranches = async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/branches');
            setBranches(data || []);
        } catch (error) {
            console.error('Error fetching branches:', error);
            toast.error('Error al sincronizar sucursales');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setSelectedBranch(null);
        setIsModalOpen(true);
    };

    const handleEdit = (branch) => {
        setSelectedBranch(branch);
        setIsModalOpen(true);
    };

    const handleToggleStatus = async (branch) => {
        try {
            const { data } = await api.patch(`/branches/${branch.id}/toggle-status`);
            toast.success(data.message);
            setBranches(prev => prev.map(b => b.id === branch.id ? { ...b, isActive: data.isActive } : b));
        } catch (error) {
            console.error('Error toggling branch status:', error);
            toast.error('Error al cambiar estado de la sucursal');
        }
    };

    const handleSetMainBranch = async (branch) => {
        if (branch.isMain) return;
        try {
            const { data } = await api.patch(`/branches/${branch.id}/set-main`);
            toast.success(data.message);
            fetchBranches();
        } catch (error) {
            console.error('Error setting main branch:', error);
            toast.error('Error al definir sede principal');
        }
    };

    const handleSwitchContext = async (branchId) => {
        try {
            const { data } = await api.post('/branches/switch', { branchId });
            toast.success(`Contexto cambiado a: ${data.branchName}`);
            // Actualizar el estado local de auth si es necesario
            if (user) {
                user.activeBranchId = data.activeBranchId;
            }
            fetchBranches();
        } catch (error) {
            console.error('Error switching branch:', error);
            toast.error('Error al cambiar de sucursal activa');
        }
    };

    const handleDelete = (branch) => {
        if (branch.isMain) {
            toast.error('No puedes eliminar la Casa Matriz. Designa otra sucursal como principal primero.');
            return;
        }

        setConfirmConfig({
            isOpen: true,
            title: `Eliminar ${branch.name}`,
            message: '¿Seguro que deseas eliminar esta sucursal? Recuerda que no debe tener inventario físico activo.',
            variant: 'danger',
            confirmText: 'Eliminar Sucursal',
            action: async () => {
                try {
                    await api.delete(`/branches/${branch.id}`);
                    toast.success('Sucursal eliminada correctamente');
                    fetchBranches();
                } catch (error) {
                    console.error('Error deleting branch:', error);
                    toast.error(error.response?.data?.error || 'Error al eliminar sucursal');
                }
            }
        });
    };

    const handleSave = async (data) => {
        try {
            setProcessing(true);
            if (selectedBranch) {
                await api.put(`/branches/${selectedBranch.id}`, data);
                toast.success('Sucursal actualizada correctamente');
            } else {
                await api.post('/branches', data);
                toast.success('Nueva sucursal creada con éxito');
            }
            fetchBranches();
            setIsModalOpen(false);
        } catch (error) {
            console.error('Error saving branch:', error);
            toast.error(error.response?.data?.error || 'Error al guardar sucursal');
        } finally {
            setProcessing(false);
        }
    };

    // Filtered Branches
    const filteredBranches = useMemo(() => {
        if (!Array.isArray(branches)) return [];
        return branches.filter(b => {
            const matchSearch = 
                (b.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (b.code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (b.address || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (b.managerName || '').toLowerCase().includes(searchTerm.toLowerCase());
            
            const matchType = typeFilter === 'ALL' || (b.type || 'STORE') === typeFilter;
            return matchSearch && matchType;
        });
    }, [branches, searchTerm, typeFilter]);

    // Network KPIs
    const networkStats = useMemo(() => {
        const total = branches.length;
        const active = branches.filter(b => b.isActive).length;
        const main = branches.find(b => b.isMain);
        const totalUsers = branches.reduce((acc, b) => acc + (b.usersCount || 0), 0);
        return { total, active, main, totalUsers };
    }, [branches]);

    // Restrictions
    if (!['admin', 'superadmin'].includes(user?.role?.toLowerCase())) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500">
                <Building2 size={64} className="mb-4 text-slate-600 dark:text-slate-300" />
                <h2 className="text-xl font-bold">Acceso Denegado</h2>
                <p>No tienes permisos de administrador para gestionar las sucursales.</p>
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-20 pb-safe animate-in fade-in duration-300 max-w-[1600px] mx-auto px-1 sm:px-4">
            {/* Header Toolbar */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800/40 flex items-center justify-center shrink-0">
                        <Building2 size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Red de Sucursales
                            </h1>
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700">
                                Multi-sede
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Gestión centralizada de tiendas, almacenes y puntos de venta
                        </p>
                    </div>
                </div>

                <div className="w-full lg:w-auto">
                    <button
                        onClick={handleCreate}
                        className="w-full sm:w-auto h-9 px-3.5 bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <Plus size={14} className="stroke-[2.5]" />
                        <span>Registrar Sucursal</span>
                    </button>
                </div>
            </div>

            {/* Network KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sedes en Red</span>
                    <p className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">{networkStats.total}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Locales y almacenes</p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Operativas</span>
                    <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">{networkStats.active}</p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 font-medium">{Math.round((networkStats.active / (networkStats.total || 1)) * 100)}% operatividad</p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Casa Matriz</span>
                    <p className="text-base font-bold text-slate-900 dark:text-white truncate mt-1">
                        {networkStats.main ? networkStats.main.name : 'No definida'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate font-mono">
                        {networkStats.main ? `Código: ${networkStats.main.code || 'MATRIZ'}` : 'Sin asignar'}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contexto Sesión</span>
                    <p className="text-base font-bold text-primary-600 dark:text-primary-400 truncate mt-1">
                        {user?.activeBranchId ? (branches.find(b => b.id === user.activeBranchId)?.name || 'Asignada') : 'Vista Global'}
                    </p>
                    <button
                        type="button"
                        onClick={() => handleSwitchContext(null)}
                        className="text-xs font-medium text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 mt-1 transition-colors cursor-pointer text-left block"
                    >
                        Cambiar a Vista Global
                    </button>
                </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, código, encargado o dirección..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 h-9 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-normal outline-none focus:border-slate-400 dark:focus:border-slate-500 text-slate-900 dark:text-white placeholder-slate-400"
                    />
                </div>

                <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 p-0.5 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'ALL', label: 'Todas las Sedes', icon: null },
                        { id: 'STORE', label: 'Tiendas POS', icon: Store },
                        { id: 'WAREHOUSE', label: 'Almacenes', icon: Warehouse },
                        { id: 'EXPRESS', label: 'Puntos Express', icon: Zap },
                        { id: 'PHARMACY', label: 'Farmacias', icon: Award }
                    ].map(tf => {
                        const Icon = tf.icon;
                        const active = typeFilter === tf.id;
                        return (
                            <button
                                key={tf.id}
                                type="button"
                                onClick={() => setTypeFilter(tf.id)}
                                className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                                    active 
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold' 
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                {Icon && <Icon size={12} />}
                                <span>{tf.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Branches Hub Grid */}
            {loading ? (
                <div className="py-20 text-center">
                    <RefreshCcw className="animate-spin mx-auto mb-3 text-primary-500" size={28} />
                    <p className="text-xs font-medium text-slate-500">Cargando red de sucursales...</p>
                </div>
            ) : filteredBranches.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 shadow-xs">
                    <Building2 size={40} className="mx-auto mb-3 text-slate-400 opacity-50" />
                    <h3 className="text-base font-bold text-slate-700 dark:text-slate-200">No se encontraron sucursales</h3>
                    <p className="text-xs text-slate-500 mt-1">Registra tu tienda principal o ajusta los filtros de búsqueda.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                    {filteredBranches.map(branch => {
                        const typeInfo = BRANCH_TYPE_CONFIG[branch.type] || BRANCH_TYPE_CONFIG['STORE'];
                        const TypeIcon = typeInfo.icon;
                        const isCurrentActive = user?.activeBranchId === branch.id;

                        return (
                            <div
                                key={branch.id}
                                className={`bg-white dark:bg-slate-900 rounded-lg border p-4 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between group ${
                                    isCurrentActive ? 'border-primary-500 ring-1 ring-primary-500/20' : 'border-slate-200 dark:border-slate-800'
                                }`}
                            >
                                <div className="space-y-3">
                                    {/* Top Row: Initial Badge + Name + Status Switch */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-sm border border-slate-200 dark:border-slate-700 shrink-0">
                                                {(branch.name || 'S').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                                    {branch.name}
                                                </h3>
                                                <p className="text-xs text-slate-400 font-mono truncate">
                                                    Cód: <span className="font-semibold text-slate-600 dark:text-slate-300">{branch.code || branch.id.substring(0, 8)}</span>
                                                </p>
                                            </div>
                                        </div>

                                        {/* Status Switcher Button */}
                                        <button
                                            type="button"
                                            onClick={() => handleToggleStatus(branch)}
                                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors flex items-center gap-1.5 cursor-pointer ${
                                                branch.isActive 
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/50 hover:bg-emerald-100' 
                                                    : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/50 hover:bg-rose-100'
                                            }`}
                                            title="Clic para cambiar estado"
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full ${branch.isActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                            <span>{branch.isActive ? 'Activa' : 'Inactiva'}</span>
                                        </button>
                                    </div>

                                    {/* Badges Bar */}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1.5 ${typeInfo.bg}`}>
                                            <TypeIcon size={11} /> {typeInfo.label}
                                        </span>

                                        {branch.isMain ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/50 flex items-center gap-1">
                                                <Star size={10} className="fill-amber-500" /> Matriz
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleSetMainBranch(branch)}
                                                className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-50 dark:bg-slate-800 text-slate-500 hover:text-amber-600 border border-slate-200 dark:border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                                                title="Hacer Casa Matriz"
                                            >
                                                <Star size={10} /> Asignar Matriz
                                            </button>
                                        )}

                                        {branch.invoicePrefix && (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                Serie: {branch.invoicePrefix}
                                            </span>
                                        )}
                                    </div>

                                    {/* Location & Contact Meta Box */}
                                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-md border border-slate-200 dark:border-slate-800">
                                        <p className="flex items-start gap-1.5 truncate">
                                            <MapPin size={12} className="text-slate-400 shrink-0 mt-0.5" />
                                            <span className="truncate">{branch.address || 'Sin dirección registrada'}</span>
                                        </p>
                                        <div className="flex justify-between items-center text-xs text-slate-500">
                                            <span className="flex items-center gap-1">
                                                <Phone size={11} className="text-slate-400" />
                                                <span>{branch.phone || 'Sin teléfono'}</span>
                                            </span>
                                            <span className="flex items-center gap-1 truncate">
                                                <Users size={11} className="text-slate-400" />
                                                <span className="truncate">{branch.managerName ? `Resp: ${branch.managerName}` : 'Sin encargado'}</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* Operational Mini-Stats */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-800 text-center">
                                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Personal</span>
                                            <span className="text-sm font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                                {branch.usersCount || 0} <span className="text-[10px] font-normal text-slate-500">operadores</span>
                                            </span>
                                        </div>
                                        <div className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-800 text-center">
                                            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Inventario</span>
                                            <span className="text-sm font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                                                {branch.stockCount || 0} <span className="text-[10px] font-normal text-slate-500">productos</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Bottom Actions & Context Switch */}
                                <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-3">
                                    {isCurrentActive ? (
                                        <div className="w-full py-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-xs font-semibold rounded-md border border-emerald-200 dark:border-emerald-800/50 flex items-center justify-center gap-1.5">
                                            <CheckCircle2 size={13} /> Sede Activa en tu Sesión
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleSwitchContext(branch.id)}
                                            className="w-full py-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                                        >
                                            <Navigation size={13} /> Seleccionar esta Sede
                                        </button>
                                    )}

                                    {/* Action Button Group */}
                                    <div className="w-full inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xs divide-x divide-slate-200 dark:divide-slate-700 overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setAnalyticsBranch(branch)}
                                            className="flex-1 h-8 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                            title="Ver Métricas"
                                        >
                                            <BarChart3 size={12} />
                                            <span>Métricas</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(branch)}
                                            className="flex-1 h-8 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                                            title="Editar Sucursal"
                                        >
                                            <Edit2 size={12} />
                                            <span>Editar</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(branch)}
                                            disabled={branch.isMain}
                                            className={`flex-1 h-8 font-medium text-xs transition-colors flex items-center justify-center gap-1 ${
                                                branch.isMain 
                                                    ? 'opacity-40 cursor-not-allowed text-slate-400 bg-slate-50 dark:bg-slate-800/40' 
                                                    : 'hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 text-slate-500 cursor-pointer'
                                            }`}
                                            title={branch.isMain ? 'No puedes eliminar la Casa Matriz' : 'Eliminar Sucursal'}
                                        >
                                            <Trash2 size={12} />
                                            <span>Eliminar</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Branch Config Modal */}
            <BranchModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                branch={selectedBranch}
                processing={processing}
            />

            {/* Branch Analytics & Stock Modal */}
            <BranchAnalyticsModal
                isOpen={!!analyticsBranch}
                onClose={() => setAnalyticsBranch(null)}
                branch={analyticsBranch}
                onSwitchBranch={handleSwitchContext}
            />

            {/* Confirm Modal */}
            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant}
                confirmText={confirmConfig.confirmText}
            />
        </div>
    );
}
