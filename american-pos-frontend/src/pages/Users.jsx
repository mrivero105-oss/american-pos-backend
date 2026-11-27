import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import {
    Users as UsersIcon, 
    Plus, 
    Edit2, 
    Trash2, 
    Shield, 
    User as UserIcon, 
    Search, 
    Key, 
    Building, 
    XCircle, 
    LayoutGrid, 
    Table as TableIcon, 
    Copy, 
    Share2, 
    BarChart3, 
    DollarSign, 
    RefreshCcw, 
    ShieldCheck, 
    Award
} from 'lucide-react';
import UserModal from '../components/UserModal';
import ConfirmModal from '../components/ConfirmModal';
import UpdatePinModal from '../components/UpdatePinModal';
import BaseModal from '../components/BaseModal';

const ROLE_BADGES = {
    superadmin: { label: 'Superadmin', bg: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/50', icon: ShieldCheck },
    admin: { label: 'Administrador', bg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50', icon: Shield },
    supervisor: { label: 'Supervisor', bg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50', icon: Key },
    cashier: { label: 'Cajero POS', bg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50', icon: DollarSign },
    user: { label: 'Operador', bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700', icon: UserIcon },
    inventory: { label: 'Almacén', bg: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800/50', icon: Building },
    waiter: { label: 'Mesero / Venta', bg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50', icon: Award }
};

export default function Users() {
    const { user: currentUser, updateCurrentUser, refreshUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRoleFilter, setSelectedRoleFilter] = useState('ALL');
    const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'

    // Modals
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [modalInitialTab, setModalInitialTab] = useState('identity');
    const [processing, setProcessing] = useState(false);

    // PIN Modal
    const [isPinModalOpen, setIsPinModalOpen] = useState(false);
    const [pinUser, setPinUser] = useState(null);

    // Operator Stats Modal
    const [statsUser, setStatsUser] = useState(null);
    const [userStatsData, setUserStatsData] = useState(null);
    const [statsLoading, setStatsLoading] = useState(false);

    // Share Credentials Modal
    const [shareUser, setShareUser] = useState(null);

    // Confirm Modal
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        action: null,
        title: '',
        message: '',
        variant: 'primary',
        confirmText: 'Confirmar'
    });

    const isMasterRevealActive = useMemo(() => {
        const role = String(currentUser?.role || '').toLowerCase();
        return role === 'superadmin' || role === 'owner' || role === 'dueño';
    }, [currentUser?.role]);

    const fetchUsers = useCallback(async (revealMaster = false) => {
        try {
            setLoading(true);
            const shouldReveal = revealMaster || String(currentUser?.role || '').toLowerCase() === 'superadmin';
            const res = await api.get(shouldReveal ? '/users?revealMaster=1' : '/users');
            setUsers(res.data || []);
        } catch (error) {
            console.error('Error fetching users:', error);
            toast.error('Error al sincronizar usuarios');
        } finally {
            setLoading(false);
        }
    }, [currentUser?.role]);

    const fetchBranches = useCallback(async () => {
        try {
            const { data } = await api.get('/branches');
            setBranches(data || []);
        } catch (e) {
            console.error('Error fetching branches', e);
        }
    }, []);

    useEffect(() => {
        fetchUsers(isMasterRevealActive);
    }, [isMasterRevealActive, fetchUsers]);

    useEffect(() => {
        fetchBranches();
    }, [fetchBranches]);

    const fetchUserStats = async (user) => {
        setStatsUser(user);
        setStatsLoading(true);
        try {
            const { data } = await api.get(`/users/${user.id}/stats`);
            setUserStatsData(data);
        } catch (e) {
            console.error('Error fetching user stats', e);
            toast.error('No se pudieron cargar las estadísticas');
        } finally {
            setStatsLoading(false);
        }
    };

    const handleCreateUser = () => {
        setSelectedUser(null);
        setModalInitialTab('identity');
        setIsModalOpen(true);
    };

    const handleEditUser = (user, initialTab = 'identity') => {
        setSelectedUser(user);
        setModalInitialTab(initialTab);
        setIsModalOpen(true);
    };

    const handleEditMyOwnPermissions = () => {
        const myRecord = visibleUsers.find(u => String(u.id) === String(currentUser?.id)) || currentUser;
        if (myRecord) {
            handleEditUser(myRecord, 'permissions');
        }
    };

    const handleToggleStatus = async (user) => {
        if (user.id === currentUser.id) {
            toast.error('No puedes desactivar tu propia cuenta.');
            return;
        }

        try {
            const { data } = await api.patch(`/users/${user.id}/toggle-status`);
            toast.success(data.message);
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: data.status } : u));
        } catch (error) {
            console.error('Error toggling status', error);
            toast.error('Error al actualizar estado del usuario');
        }
    };

    const handleDeleteUser = (id) => {
        if (id === currentUser.id) {
            toast.error('No puedes eliminar tu propia cuenta.');
            return;
        }

        setConfirmConfig({
            isOpen: true,
            title: 'Eliminar Usuario',
            message: '¿Seguro que deseas dar de baja o eliminar este operador?',
            variant: 'danger',
            confirmText: 'Eliminar Usuario',
            action: async () => {
                try {
                    await api.delete(`/users/${id}`);
                    toast.success('Usuario eliminado');
                    fetchUsers(isMasterRevealActive);
                } catch (error) {
                    console.error('Error deleting user', error);
                    const serverMsg = error.response?.data?.message || error.response?.data?.error;
                    toast.error(serverMsg || 'Error al eliminar usuario');
                }
            }
        });
    };

    const handleSaveUser = async (userData) => {
        try {
            setProcessing(true);
            if (selectedUser) {
                const response = await api.put(`/users/${selectedUser.id}`, userData);
                toast.success('Ficha de usuario actualizada');

                // Si el usuario editado es el operador en sesión, actualizar de inmediato AuthContext en vivo
                const isCurrent = 
                    String(selectedUser.id) === String(currentUser?.id) ||
                    selectedUser.email === currentUser?.email ||
                    selectedUser.username === currentUser?.username;

                if (isCurrent) {
                    if (response.data?.user) {
                        updateCurrentUser(response.data.user);
                    } else {
                        updateCurrentUser(prev => ({
                            ...prev,
                            ...userData,
                            permissions: { ...(prev?.permissions || {}), ...(userData.permissions || {}) }
                        }));
                    }
                    if (refreshUser) refreshUser();
                }
            } else {
                await api.post('/users', userData);
                toast.success('Operador registrado exitosamente');
            }
            fetchUsers(isMasterRevealActive);
            setIsModalOpen(false);
        } catch (error) {
            console.error('Error saving user', error);
            toast.error(error.response?.data?.message || 'Error al guardar usuario');
        } finally {
            setProcessing(false);
        }
    };

    // Visible users (Master/superadmin accounts visible to the superadmin/owner, hidden from regular admins)
    const visibleUsers = useMemo(() => {
        const baseList = Array.isArray(users) ? [...users] : [];
        if (isMasterRevealActive) {
            if (currentUser?.id && !baseList.some(u => String(u.id) === String(currentUser.id))) {
                baseList.unshift({
                    ...currentUser,
                    status: currentUser.status || 'active'
                });
            }
            return baseList.sort((a, b) => {
                if (String(a.id) === String(currentUser?.id)) return -1;
                if (String(b.id) === String(currentUser?.id)) return 1;
                return 0;
            });
        }
        return baseList.filter(u => String(u.role || '').toLowerCase() !== 'superadmin');
    }, [users, isMasterRevealActive, currentUser]);

    // Filter & Search Logic
    const filteredUsers = useMemo(() => {
        const cleanQuery = isMasterRevealActive
            ? searchTerm.trim().replace(/^#master\s*/i, '').toLowerCase()
            : searchTerm.toLowerCase();

        return visibleUsers.filter(u => {
            const matchSearch = !cleanQuery ||
                (u.name || '').toLowerCase().includes(cleanQuery) ||
                (u.username || '').toLowerCase().includes(cleanQuery) ||
                (u.email || '').toLowerCase().includes(cleanQuery) ||
                (u.role || '').toLowerCase().includes(cleanQuery);
            
            const matchRole = selectedRoleFilter === 'ALL' || u.role === selectedRoleFilter;
            return matchSearch && matchRole;
        });
    }, [visibleUsers, searchTerm, selectedRoleFilter, isMasterRevealActive]);

    // Statistics Calculations
    const stats = useMemo(() => {
        const total = visibleUsers.length;
        const active = visibleUsers.filter(u => u.status === 'active').length;
        const supervisors = visibleUsers.filter(u => Boolean(u.supervisorPin || u.hasPin || u.hasSupervisorPin)).length;
        const rolesCount = new Set(visibleUsers.map(u => u.role)).size;
        return { total, active, supervisors, rolesCount };
    }, [visibleUsers]);

    const getBranchName = (branchId) => {
        if (!branchId) return 'Global (Todas)';
        const b = branches.find(item => item.id === branchId);
        return b ? b.name : 'Sucursal';
    };

    return (
        <div className="space-y-6 pb-20 max-w-[1600px] mx-auto px-2 sm:px-6">
            {/* Header Section */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center shrink-0 shadow-2xs">
                        <UsersIcon size={20} />
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                                Gestión de Operadores
                            </h1>
                            <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold uppercase tracking-wider rounded border border-slate-200 dark:border-slate-700">
                                Directorio IAM
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Administración centralizada de cuentas de usuario, roles jerárquicos y credenciales PIN
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto">
                    <button
                        type="button"
                        onClick={() => fetchUsers(isMasterRevealActive)}
                        className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
                        title="Actualizar directorio"
                    >
                        <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline">Actualizar</span>
                    </button>

                    {/* View Switcher Segmented Control */}
                    <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setViewMode('cards')}
                            className={`p-1.5 rounded transition-colors ${viewMode === 'cards' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                            title="Vista en Tarjetas"
                        >
                            <LayoutGrid size={15} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={`p-1.5 rounded transition-colors ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                            title="Vista en Tabla"
                        >
                            <TableIcon size={15} />
                        </button>
                    </div>

                    {currentUser && (
                        <button
                            type="button"
                            onClick={handleEditMyOwnPermissions}
                            className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-md transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Abrir directamente la Matriz de Permisos de tu usuario actual"
                        >
                            <ShieldCheck size={15} /> Mis Permisos ({currentUser.role === 'superadmin' ? 'Dueño' : 'Mi Cuenta'})
                        </button>
                    )}

                    <button
                        onClick={handleCreateUser}
                        className="flex-1 sm:flex-none px-3.5 py-2 bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold rounded-md transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <Plus size={15} /> Registrar Operador
                    </button>
                </div>
            </div>

            {/* KPI Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Operadores</span>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-1">{stats.total}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Cuentas registradas en sistema</p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Activos</span>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-1">{stats.active}</p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                        {stats.active} de {stats.total || 1} operativos ({Math.round((stats.active / (stats.total || 1)) * 100)}%)
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Supervisor PIN</span>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 font-mono tabular-nums mt-1">{stats.supervisors}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Autorización elevada activa</p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Roles en Uso</span>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-1">{stats.rolesCount}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Niveles jerárquicos activos</p>
                </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-2xs">
                {/* Search */}
                <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, usuario, correo o rol..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-medium outline-none focus:border-primary-500 focus:bg-white dark:focus:bg-slate-800 text-slate-900 dark:text-white transition-colors"
                    />
                </div>

                {/* Role Filter Segmented Control */}
                <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 overflow-x-auto max-w-full">
                    {[
                        { id: 'ALL', label: 'Todos' },
                        ...(isMasterRevealActive ? [{ id: 'superadmin', label: 'Superadmin' }] : []),
                        { id: 'admin', label: 'Admin' },
                        { id: 'supervisor', label: 'Supervisor' },
                        { id: 'cashier', label: 'Cajeros' },
                        { id: 'inventory', label: 'Almacén' },
                        { id: 'waiter', label: 'Meseros' }
                    ].map(rf => (
                        <button
                            key={rf.id}
                            type="button"
                            onClick={() => setSelectedRoleFilter(rf.id)}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors shrink-0 cursor-pointer ${selectedRoleFilter === rf.id ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-semibold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            {rf.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Users Content: Cards Grid or Tactical Table */}
            {loading ? (
                <div className="py-20 text-center">
                    <RefreshCcw className="animate-spin mx-auto mb-3 text-primary-500" size={28} />
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sincronizando operadores...</p>
                </div>
            ) : filteredUsers.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
                    <UsersIcon size={36} className="mx-auto mb-3 text-slate-400 opacity-40" />
                    <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">No se encontraron operadores</h3>
                    <p className="text-xs text-slate-500 mt-1">Prueba con otro término de búsqueda o registra un nuevo operador.</p>
                </div>
            ) : viewMode === 'cards' ? (
                /* ==================== CARDS GRID VIEW ==================== */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredUsers.map(u => {
                        const roleInfo = ROLE_BADGES[u.role] || ROLE_BADGES['user'];
                        const RoleIcon = roleInfo.icon;
                        const isSelf = u.id === currentUser?.id;
                        const hasPin = Boolean(u.supervisorPin || u.hasPin || u.hasSupervisorPin);

                        return (
                            <div
                                key={u.id}
                                className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between group"
                            >
                                <div className="space-y-3">
                                    {/* Top Row: Avatar + Name + Status Pill */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs border border-slate-200 dark:border-slate-700 shrink-0 font-mono">
                                                {(u.name || u.username || 'U').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                                    {u.name || u.username}
                                                </h3>
                                                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                                                    @{u.username}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Status Switcher Button */}
                                        <button
                                            type="button"
                                            onClick={() => handleToggleStatus(u)}
                                            disabled={isSelf}
                                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${u.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'} ${isSelf ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                            title={isSelf ? 'No puedes cambiar tu propio estado' : 'Alternar estado activo/inactivo'}
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                            {u.status === 'active' ? 'Activo' : 'Inactivo'}
                                        </button>
                                    </div>

                                    {/* Badges Bar: Role + Branch + Security */}
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 ${roleInfo.bg}`}>
                                            <RoleIcon size={12} /> {roleInfo.label}
                                        </span>

                                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
                                            <Building size={11} className="text-slate-400" />
                                            {getBranchName(u.activeBranchId)}
                                        </span>

                                        {hasPin ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 flex items-center gap-1" title="PIN de Supervisor Configurado">
                                                <Key size={11} /> PIN OK
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700" title="Sin PIN supervisor">
                                                Sin PIN
                                            </span>
                                        )}
                                    </div>

                                    {/* Contact & Currency Meta */}
                                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-md border border-slate-200 dark:border-slate-700/60 font-medium">
                                        <p className="truncate">Correo: {u.email || 'Sin correo asignado'}</p>
                                        {u.phone && <p>Teléfono: {u.phone}</p>}
                                        <p className="text-[11px] text-slate-500">
                                            Moneda de Venta: <strong className="text-slate-800 dark:text-slate-200 font-semibold">{u.defaultCurrency || 'Bimoneda'}</strong>
                                        </p>
                                    </div>
                                </div>

                                {/* Bottom Action Buttons Group */}
                                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 mt-3">
                                    <div className="flex items-center w-full divide-x divide-slate-200 dark:divide-slate-700 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800/40">
                                        <button
                                            type="button"
                                            onClick={() => fetchUserStats(u)}
                                            className="flex-1 py-1.5 px-2 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            title="Ver Métricas de Turnos & Ventas"
                                        >
                                            <BarChart3 size={13} />
                                            <span className="text-[11px]">Métricas</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShareUser(u)}
                                            className="flex-1 py-1.5 px-2 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            title="Compartir Ficha de Acceso"
                                        >
                                            <Share2 size={13} />
                                            <span className="text-[11px]">Ficha</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setPinUser(u); setIsPinModalOpen(true); }}
                                            className="flex-1 py-1.5 px-2 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            title="Gestionar PIN Supervisor"
                                        >
                                            <Key size={13} />
                                            <span className="text-[11px]">PIN</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleEditUser(u)}
                                            className="flex-1 py-1.5 px-2 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            title="Editar Operador"
                                        >
                                            <Edit2 size={13} />
                                            <span className="text-[11px]">Editar</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteUser(u.id)}
                                            disabled={isSelf}
                                            className={`py-1.5 px-2.5 transition-colors flex items-center justify-center ${isSelf ? 'opacity-30 cursor-not-allowed text-slate-400 bg-slate-100 dark:bg-slate-800' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer'}`}
                                            title={isSelf ? 'No puedes eliminar tu propia cuenta' : 'Eliminar Operador'}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* ==================== TACTICAL TABLE VIEW (Desktop) + TARJETAS TÁCTILES (Móvil) ==================== */
                <div className="space-y-2.5">
                    {/* Tarjetas táctiles móviles (sin desborde horizontal < 768px) */}
                    <div className="md:hidden space-y-2.5">
                        {filteredUsers.map(u => {
                            const roleInfo = ROLE_BADGES[u.role] || ROLE_BADGES['user'];
                            const RoleIcon = roleInfo.icon;
                            const isSelf = u.id === currentUser?.id;
                            return (
                                <div key={u.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-2xs space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs border border-slate-200 dark:border-slate-700 shrink-0 font-mono">
                                                {(u.name || u.username || 'U').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{u.name || u.username}</p>
                                                <p className="text-[11px] text-slate-400 font-mono truncate">@{u.username}</p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleToggleStatus(u)}
                                            disabled={isSelf}
                                            className={`px-2.5 py-1 min-h-[32px] rounded-lg text-[10px] font-semibold border inline-flex items-center gap-1.5 shrink-0 ${u.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'} ${isSelf ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                        >
                                            <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                            {u.status === 'active' ? 'Activo' : 'Inactivo'}
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                        <span className={`px-2 py-0.5 rounded font-semibold border inline-flex items-center gap-1 ${roleInfo.bg}`}>
                                            <RoleIcon size={11} /> {roleInfo.label}
                                        </span>
                                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                                            {getBranchName(u.activeBranchId)}
                                        </span>
                                        {(u.supervisorPin || u.hasPin || u.hasSupervisorPin) && (
                                            <span className="px-2 py-0.5 rounded font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 inline-flex items-center gap-1">
                                                <Key size={10} /> PIN
                                            </span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-5 gap-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                                        <button type="button" onClick={() => fetchUserStats(u)} className="min-h-[40px] rounded-lg bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer" title="Métricas"><BarChart3 size={15} /></button>
                                        <button type="button" onClick={() => setShareUser(u)} className="min-h-[40px] rounded-lg bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 flex items-center justify-center cursor-pointer" title="Ficha"><Share2 size={15} /></button>
                                        <button type="button" onClick={() => { setPinUser(u); setIsPinModalOpen(true); }} className="min-h-[40px] rounded-lg bg-slate-50 dark:bg-slate-800/70 text-amber-600 dark:text-amber-400 flex items-center justify-center cursor-pointer" title="PIN"><Key size={15} /></button>
                                        <button type="button" onClick={() => handleEditUser(u)} className="min-h-[40px] rounded-lg bg-slate-50 dark:bg-slate-800/70 text-primary-600 dark:text-primary-400 flex items-center justify-center cursor-pointer" title="Editar"><Edit2 size={15} /></button>
                                        <button type="button" onClick={() => handleDeleteUser(u.id)} disabled={isSelf} className={`min-h-[40px] rounded-lg flex items-center justify-center ${isSelf ? 'opacity-30 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-400' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 cursor-pointer'}`} title="Eliminar"><Trash2 size={15} /></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
                        <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    <th className="py-3 px-4">Operador</th>
                                    <th className="py-3 px-4">Rol Jerárquico</th>
                                    <th className="py-3 px-4">Sucursal</th>
                                    <th className="py-3 px-4">Seguridad</th>
                                    <th className="py-3 px-4">Estado</th>
                                    <th className="py-3 px-4 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs text-slate-700 dark:text-slate-300">
                                {filteredUsers.map(u => {
                                    const roleInfo = ROLE_BADGES[u.role] || ROLE_BADGES['user'];
                                    const RoleIcon = roleInfo.icon;
                                    const isSelf = u.id === currentUser?.id;

                                    return (
                                        <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs border border-slate-200 dark:border-slate-700 shrink-0 font-mono">
                                                        {(u.name || u.username || 'U').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-slate-900 dark:text-white leading-tight">{u.name || u.username}</p>
                                                        <p className="text-[11px] text-slate-400 font-mono">@{u.username} • {u.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border inline-flex items-center gap-1.5 ${roleInfo.bg}`}>
                                                    <RoleIcon size={12} /> {roleInfo.label}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{getBranchName(u.activeBranchId)}</span>
                                            </td>
                                            <td className="py-3 px-4">
                                                {(u.supervisorPin || u.hasPin || u.hasSupervisorPin) ? (
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 inline-flex items-center gap-1">
                                                        <Key size={11} /> PIN Activo
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-slate-400">Sin PIN</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleStatus(u)}
                                                    disabled={isSelf}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors inline-flex items-center gap-1.5 ${u.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'} ${isSelf ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                >
                                                    <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                    {u.status === 'active' ? 'Activo' : 'Inactivo'}
                                                </button>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <div className="inline-flex divide-x divide-slate-200 dark:divide-slate-700 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800/40">
                                                    <button
                                                        type="button"
                                                        onClick={() => fetchUserStats(u)}
                                                        className="py-1 px-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                        title="Ver Estadísticas & Actividad"
                                                    >
                                                        <BarChart3 size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShareUser(u)}
                                                        className="py-1 px-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                        title="Compartir Ficha de Acceso"
                                                    >
                                                        <Share2 size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setPinUser(u); setIsPinModalOpen(true); }}
                                                        className="py-1 px-2 text-slate-500 hover:text-amber-600 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                        title="Gestionar PIN Supervisor"
                                                    >
                                                        <Key size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditUser(u)}
                                                        className="py-1 px-2 text-slate-500 hover:text-primary-600 hover:bg-white dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                        title="Editar Ficha"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteUser(u.id)}
                                                        disabled={isSelf}
                                                        className={`py-1 px-2 transition-colors ${isSelf ? 'opacity-30 cursor-not-allowed text-slate-400' : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer'}`}
                                                        title={isSelf ? 'No puedes eliminarte a ti mismo' : 'Eliminar Operador'}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Operator Activity / Stats Modal */}
            <BaseModal
                isOpen={!!statsUser}
                onClose={() => setStatsUser(null)}
                maxWidth="max-w-xl"
                className="p-5 font-sans"
            >
                <div className="flex justify-between items-center mb-5 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center font-bold text-base font-mono shadow-2xs">
                            {(statsUser?.name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                                Rendimiento: {statsUser?.name}
                            </h3>
                            <p className="text-xs text-slate-500 font-mono">
                                Rol: {statsUser?.role?.toUpperCase()} • @{statsUser?.username}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setStatsUser(null)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                        <XCircle size={18} />
                    </button>
                </div>

                {statsLoading ? (
                    <div className="py-16 text-center">
                        <RefreshCcw className="animate-spin mx-auto mb-2 text-primary-500" size={26} />
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cargando métricas operativas...</p>
                    </div>
                ) : userStatsData ? (
                    <div className="space-y-5">
                        {/* 3 Metrics Cards */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 text-center">
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Facturas Emitidas</span>
                                <p className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-1">{userStatsData.salesCount}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 text-center">
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Facturado</span>
                                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-1">${Number(userStatsData.totalSold || 0).toFixed(2)}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 text-center">
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Turnos Operados</span>
                                <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 font-mono tabular-nums mt-1">{userStatsData.shiftCount}</p>
                            </div>
                        </div>

                        {/* Recent Shifts */}
                        <div className="space-y-2">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Últimos Turnos de Caja</span>
                            <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                                {(userStatsData.recentShifts || []).length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center py-6">No registra turnos de caja completados.</p>
                                ) : (
                                    userStatsData.recentShifts.map(s => (
                                        <div key={s.id} className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-md border border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">Turno #{s.id.substring(0, 8)}</p>
                                                <p className="text-[11px] text-slate-400 font-mono">{new Date(s.openedAt).toLocaleString()}</p>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-mono font-bold text-slate-900 dark:text-white block">${Number(s.finalAmount || 0).toFixed(2)}</span>
                                                <span className={`text-[10px] font-semibold uppercase ${s.difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                    {s.difference === 0 ? 'Cuadrado' : `Dif: $${s.difference}`}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                ) : null}
            </BaseModal>

            {/* Share Credentials Modal */}
            <BaseModal
                isOpen={!!shareUser}
                onClose={() => setShareUser(null)}
                maxWidth="max-w-md"
                className="p-5 font-sans"
            >
                <div className="text-center mb-5">
                    <div className="w-11 h-11 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg flex items-center justify-center mx-auto mb-2 border border-slate-200 dark:border-slate-700 shadow-2xs">
                        <Share2 size={20} />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Ficha de Credenciales</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Información formal de acceso al sistema para entrega al operador.</p>
                </div>

                {shareUser && (
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-md border border-slate-200 dark:border-slate-700 font-mono text-xs text-slate-800 dark:text-slate-200 space-y-1.5 mb-5">
                        <p><span className="text-slate-500">Operador:</span> {shareUser.name}</p>
                        <p><span className="text-slate-500">Usuario:</span> {shareUser.username}</p>
                        <p><span className="text-slate-500">Correo:</span> {shareUser.email || 'N/A'}</p>
                        <p><span className="text-slate-500">Rol:</span> {shareUser.role?.toUpperCase()}</p>
                        <p><span className="text-slate-500">Sucursal:</span> {getBranchName(shareUser.activeBranchId)}</p>
                        <p><span className="text-slate-500">Acceso POS:</span> {window.location.origin}</p>
                    </div>
                )}

                <div className="flex gap-2.5">
                    <button
                        type="button"
                        onClick={() => setShareUser(null)}
                        className="w-1/3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-md border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors cursor-pointer"
                    >
                        Cerrar
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const text = `*CREDENCIALES DE ACCESO - ISAAC POS*\n\n*Operador:* ${shareUser.name}\n*Usuario:* ${shareUser.username}\n*Rol:* ${shareUser.role?.toUpperCase()}\n*Sucursal:* ${getBranchName(shareUser.activeBranchId)}\n*Enlace:* ${window.location.origin}\n\n_Guarda tus credenciales de forma confidencial._`;
                            navigator.clipboard?.writeText(text);
                            toast.success('Ficha copiada al portapapeles');
                            setShareUser(null);
                        }}
                        className="w-2/3 py-2 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-md text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                        <Copy size={14} /> Copiar Ficha Completa
                    </button>
                </div>
            </BaseModal>

            {/* Main User Editor Modal */}
            <UserModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveUser}
                user={selectedUser}
                processing={processing}
                initialTab={modalInitialTab}
            />

            {/* Update Supervisor PIN Modal */}
            <UpdatePinModal
                isOpen={isPinModalOpen}
                onClose={() => { setIsPinModalOpen(false); fetchUsers(); }}
                onSuccess={() => fetchUsers()}
                user={pinUser}
            />

            {/* Confirmation Dialog */}
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
