import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
    Users, Calendar, FileText, PlusCircle, CheckCircle2,
    Download, DollarSign, Briefcase, Building2, ShieldAlert,
    Printer, Search, RefreshCw, UserPlus
} from 'lucide-react';
import api from '../services/api';
import { usePos } from '../hooks/PosContext';

const showToast = (msg, type = 'info') => {
    if (type === 'success') toast.success(msg);
    else if (type === 'error') toast.error(msg);
    else toast(msg);
};

export default function PayrollManager() {
    const { exchangeRate, settings: storeConfig } = usePos();
    const confirm = async ({ title, message }) => window.confirm(`${title}\n\n${message}`);
    const bcvRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;

    const [activeTab, setActiveTab] = useState('empleados'); // 'empleados' | 'periodos' | 'recibos'
    const [loading, setLoading] = useState(false);

    // Data States
    const [employees, setEmployees] = useState([]);
    const [posUsers, setPosUsers] = useState([]);
    const [periods, setPeriods] = useState([]);
    const [selectedPeriodForReceipts, setSelectedPeriodForReceipts] = useState('');
    const [receipts, setReceipts] = useState([]);
    const [bankAccounts, setBankAccounts] = useState([]);

    // Search
    const [employeeSearch, setEmployeeSearch] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('ALL');

    // Modals
    const [isNewEmployeeModalOpen, setIsNewEmployeeModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [isNewPeriodModalOpen, setIsNewPeriodModalOpen] = useState(false);
    const [isDisburseModalOpen, setIsDisburseModalOpen] = useState(false);
    const [selectedPeriodToClose, setSelectedPeriodToClose] = useState(null);
    const [selectedBankAccountId, setSelectedBankAccountId] = useState('');

    // Forms
    const [employeeForm, setEmployeeForm] = useState({
        idCard: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        position: 'Cajero / Vendedor',
        department: 'VENTAS',
        hireDate: new Date().toISOString().split('T')[0],
        contractType: 'INDETERMINADO',
        salaryType: 'MENSUAL',
        baseSalary: '',
        foodAllowance: '40',
        bankName: 'Banesco',
        bankAccountNumber: '',
        status: 'ACTIVE',
        notes: ''
    });

    const [newPeriodForm, setNewPeriodForm] = useState(() => {
        const now = new Date();
        const year = now.getFullYear();
        const monthName = now.toLocaleString('es-VE', { month: 'long' });
        const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
        const isFirstHalf = now.getDate() <= 15;
        return {
            periodName: `${isFirstHalf ? '1era' : '2da'} Quincena ${capitalizedMonth} ${year}`,
            startDate: new Date(year, now.getMonth(), isFirstHalf ? 1 : 16).toISOString().split('T')[0],
            endDate: new Date(year, now.getMonth(), isFirstHalf ? 15 : new Date(year, now.getMonth() + 1, 0).getDate()).toISOString().split('T')[0],
            paymentDate: new Date().toISOString().split('T')[0],
            frequency: 'QUINCENAL',
            exchangeRate: bcvRate,
            notes: ''
        };
    });

    const fetchEmployees = async () => {
        setLoading(true);
        try {
            const [empRes, usrRes] = await Promise.all([
                api.get('/payroll/employees'),
                api.get('/users').catch(() => ({ data: [] }))
            ]);
            if (empRes.data?.ok) {
                setEmployees(empRes.data.employees || []);
            }
            const rawUsers = Array.isArray(usrRes.data) ? usrRes.data : (usrRes.data?.users || []);
            setPosUsers(rawUsers);
        } catch (err) {
            console.error('Error cargando empleados:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchPeriods = async () => {
        setLoading(true);
        try {
            const res = await api.get('/payroll/periods');
            if ((res.data?.success || res.data?.ok)) {
                const list = res.data.periods || [];
                setPeriods(list);
                if (!selectedPeriodForReceipts && list.length > 0) {
                    setSelectedPeriodForReceipts(list[0].id);
                }
            }
        } catch (err) {
            console.error('Error cargando períodos de nómina:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchBankAccounts = async () => {
        try {
            const res = await api.get('/treasury/accounts');
            if ((res.data?.success || res.data?.ok)) {
                setBankAccounts(res.data.accounts || []);
            }
        } catch (err) {
            console.error('Error cargando cuentas bancarias:', err);
        }
    };

    const fetchReceipts = async (periodId) => {
        if (!periodId) return;
        setLoading(true);
        try {
            const res = await api.get(`/payroll/periods/${periodId}/receipts`);
            if ((res.data?.success || res.data?.ok)) {
                setReceipts(res.data.receipts || []);
            }
        } catch (err) {
            console.error('Error cargando recibos:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEmployees();
        fetchPeriods();
        fetchBankAccounts();
    }, []);

    useEffect(() => {
        if (activeTab === 'recibos' && selectedPeriodForReceipts) {
            fetchReceipts(selectedPeriodForReceipts);
        }
    }, [activeTab, selectedPeriodForReceipts]);

    // Sync POS Operators into Payroll Employees with 1 click
    const handleSyncPosOperators = async () => {
        if (!posUsers.length) {
            showToast('No se detectaron operadores en el directorio de usuarios', 'warning');
            return;
        }
        setLoading(true);
        let importedCount = 0;
        try {
            for (const u of posUsers) {
                const fullName = (u.name || u.username || '').trim();
                if (!fullName) continue;
                const parts = fullName.split(' ');
                const firstName = parts[0] || fullName;
                const lastName = parts.slice(1).join(' ') || 'Operador POS';

                const alreadyExists = employees.some(e =>
                    (u.email && e.email && e.email.toLowerCase() === u.email.toLowerCase()) ||
                    (`${e.firstName} ${e.lastName}`.toLowerCase() === fullName.toLowerCase())
                );
                if (alreadyExists) continue;

                const roleLabel = u.role === 'admin' || u.role === 'superadmin'
                    ? 'Administrador / Encargado'
                    : u.role === 'supervisor'
                    ? 'Supervisor de Caja'
                    : 'Cajero / Vendedor POS';
                const dept = (u.role === 'admin' || u.role === 'superadmin') ? 'ADMINISTRACION' : 'VENTAS';

                await api.post('/payroll/employees', {
                    idCard: `V-${Math.floor(10000000 + Math.random() * 89999999)}`,
                    firstName,
                    lastName,
                    email: u.email || '',
                    phone: u.phone || '',
                    position: roleLabel,
                    department: dept,
                    hireDate: new Date().toISOString().split('T')[0],
                    contractType: 'INDETERMINADO',
                    salaryType: 'MENSUAL',
                    baseSalary: u.role === 'admin' ? 200 : 120,
                    foodAllowance: 40,
                    bankName: 'Pago Móvil / Banco Nacional',
                    bankAccountNumber: '',
                    status: u.isActive === false ? 'TERMINATED' : 'ACTIVE',
                    notes: `Vinculado desde Operador POS (@${u.username})`
                });
                importedCount++;
            }

            if (importedCount > 0) {
                showToast(`${importedCount} operador(es) del POS incorporados a la nómina. Puede ajustar su cédula y sueldo base.`, 'success');
                fetchEmployees();
            } else {
                showToast('Todos los operadores del POS ya están registrados en la nómina.', 'info');
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error importando operadores del POS', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveEmployee = async (e) => {
        e.preventDefault();
        try {
            let res;
            if (editingEmployee) {
                res = await api.put(`/payroll/employees/${editingEmployee.id}`, employeeForm);
            } else {
                res = await api.post('/payroll/employees', employeeForm);
            }
            if ((res.data?.success || res.data?.ok)) {
                setIsNewEmployeeModalOpen(false);
                setEditingEmployee(null);
                resetEmployeeForm();
                showToast(editingEmployee ? 'Expediente laboral actualizado' : 'Trabajador registrado en nómina', 'success');
                fetchEmployees();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error guardando ficha del trabajador', 'error');
        }
    };

    const resetEmployeeForm = () => {
        setEmployeeForm({
            idCard: '',
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            position: 'Cajero / Vendedor',
            department: 'VENTAS',
            hireDate: new Date().toISOString().split('T')[0],
            contractType: 'INDETERMINADO',
            salaryType: 'MENSUAL',
            baseSalary: '',
            foodAllowance: '40',
            bankName: 'Banesco',
            bankAccountNumber: '',
            status: 'ACTIVE',
            notes: ''
        });
    };

    const handleCreatePeriod = async (e) => {
        e.preventDefault();
        try {
            const res = await api.post('/payroll/periods', {
                ...newPeriodForm,
                exchangeRate: bcvRate
            });
            if ((res.data?.success || res.data?.ok)) {
                setIsNewPeriodModalOpen(false);
                showToast('Período de nómina aperturado', 'success');
                fetchPeriods();
                setActiveTab('periodos');
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error creando período de nómina', 'error');
        }
    };

    const handleCalculatePeriod = async (periodId) => {
        const ok = await confirm({
            title: 'Procesar Prenómina y Retenciones de Ley',
            message: 'Se calcularán los sueldos quincenales, Bono de Alimentación (Cestaticket), comisiones de venta POS y deducciones legales (IVSS 4%, FAOV 1%, RPE 0.5%) para todos los trabajadores activos. ¿Desea ejecutar el cálculo?',
            confirmText: 'Calcular Prenómina',
            variant: 'primary'
        });
        if (!ok) return;

        try {
            setLoading(true);
            const res = await api.post(`/payroll/periods/${periodId}/calculate`, {
                exchangeRate: bcvRate
            });
            if ((res.data?.success || res.data?.ok)) {
                showToast(res.data.message || 'Nómina calculada exitosamente', 'success');
                fetchPeriods();
                setSelectedPeriodForReceipts(periodId);
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error al calcular la nómina', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCloseAndDisburse = async (e) => {
        e.preventDefault();
        if (!selectedPeriodToClose) return;
        try {
            setLoading(true);
            const res = await api.post(`/payroll/periods/${selectedPeriodToClose.id}/close`, {
                bankAccountId: selectedBankAccountId || null,
                paymentMethod: 'TRANSFERENCIA'
            });
            if ((res.data?.success || res.data?.ok)) {
                setIsDisburseModalOpen(false);
                setSelectedPeriodToClose(null);
                showToast(res.data.message || 'Nómina cerrada y asentada en Libro Diario', 'success');
                fetchPeriods();
            }
        } catch (err) {
            showToast(err.response?.data?.error || 'Error cerrando nómina', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadBankTxt = (periodId, bankFormat) => {
        const token = localStorage.getItem('token');
        const baseUrl = api.defaults.baseURL || '';
        const url = `${baseUrl}/payroll/periods/${periodId}/bank-txt?bankFormat=${bankFormat}&token=${token}`;
        window.open(url, '_blank');
    };

    const fmtUSD = (val) => {
        const num = parseFloat(val) || 0;
        return `$ ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const fmtBs = (valUsd) => {
        const num = (parseFloat(valUsd) || 0) * bcvRate;
        return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const filteredEmployees = useMemo(() => {
        return employees.filter(e => {
            const matchDept = departmentFilter === 'ALL' || e.department === departmentFilter;
            if (!matchDept) return false;
            if (!employeeSearch.trim()) return true;
            const q = employeeSearch.toLowerCase();
            return (
                e.firstName?.toLowerCase().includes(q) ||
                e.lastName?.toLowerCase().includes(q) ||
                e.idCard?.toLowerCase().includes(q) ||
                e.position?.toLowerCase().includes(q)
            );
        });
    }, [employees, employeeSearch, departmentFilter]);

    // Summary KPIs
    const payrollMetrics = useMemo(() => {
        const activeList = employees.filter(e => e.status === 'ACTIVE');
        const totalBaseUsd = activeList.reduce((acc, e) => acc + (parseFloat(e.baseSalary) || 0), 0);
        const totalFoodUsd = activeList.reduce((acc, e) => acc + (parseFloat(e.foodAllowance) || 0), 0);
        const statutoryRetentionUsd = totalBaseUsd * 0.055; // 4% IVSS + 1% FAOV + 0.5% RPE
        const totalMonthlyLiabilityUsd = totalBaseUsd + totalFoodUsd;

        return {
            activeCount: activeList.length,
            totalBaseUsd,
            totalFoodUsd,
            statutoryRetentionUsd,
            totalMonthlyLiabilityUsd,
            biweeklyEstimateUsd: totalMonthlyLiabilityUsd / 2
        };
    }, [employees]);

    return (
        <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-5 animate-in fade-in duration-300">
            {/* CABECERA INSTITUCIONAL DE NÓMINA */}
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                                GESTIÓN LABORAL LOTTT • PARAFISCAL
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Tasa Oficial BCV: Bs. {bcvRate.toLocaleString('es-VE', { minimumFractionDigits: 2 })} / USD
                            </span>
                        </div>
                        <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">
                            Nómina, Recursos Humanos y Liquidación de Haberes
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Control de expedientes, cálculo quincenal bimoneda, retenciones de ley (IVSS, FAOV, RPE), comisiones de venta y recibos de pago
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
                        <button
                            type="button"
                            onClick={handleSyncPosOperators}
                            disabled={loading}
                            className="h-9 px-3 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            title="Importar automáticamente a los cajeros y operadores registrados en Usuarios del POS"
                        >
                            <UserPlus size={13} />
                            <span>Importar Operadores POS</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsNewPeriodModalOpen(true)}
                            className="h-9 px-3 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                            <Calendar size={13} />
                            <span>Aperturar Quincena</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                resetEmployeeForm();
                                setEditingEmployee(null);
                                setIsNewEmployeeModalOpen(true);
                            }}
                            className="h-9 px-3.5 rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                        >
                            <PlusCircle size={13} />
                            <span>Registrar Trabajador</span>
                        </button>
                    </div>
                </div>

                {/* CINTA DE INDICADORES DE PASIVO LABORAL */}
                <div className="grid grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            PLANTILLA ACTIVA
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                            {payrollMetrics.activeCount} trabajadores
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                            {employees.length} registrados en total
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            NÓMINA BASE MENSUAL
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                            {fmtUSD(payrollMetrics.totalBaseUsd)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(payrollMetrics.totalBaseUsd)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            CESTATICKET MENSUAL
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
                            {fmtUSD(payrollMetrics.totalFoodUsd)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(payrollMetrics.totalFoodUsd)}
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            RETENCIONES LEY (5.5%)
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-1">
                            {fmtUSD(payrollMetrics.statutoryRetentionUsd)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                            IVSS 4% · FAOV 1% · RPE 0.5%
                        </div>
                    </div>

                    <div className="p-3.5 sm:px-5 col-span-2 lg:col-span-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block">
                            PROVISIÓN POR QUINCENA
                        </span>
                        <div className="text-base sm:text-lg font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums mt-1">
                            {fmtUSD(payrollMetrics.biweeklyEstimateUsd)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                            {fmtBs(payrollMetrics.biweeklyEstimateUsd)}
                        </div>
                    </div>
                </div>
            </div>

            {/* BARRA DE PESTAÑAS */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-md">
                    {[
                        { id: 'empleados', label: `1. Expedientes de Personal (${employees.length})`, icon: Users },
                        { id: 'periodos', label: `2. Quincenas y Liquidación (${periods.length})`, icon: Calendar },
                        { id: 'recibos', label: '3. Recibos de Pago (LOTTT)', icon: FileText }
                    ].map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`h-8 px-3 rounded text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                                    active
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Icon size={13} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {activeTab === 'empleados' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-64">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar por cédula, nombre o cargo..."
                                value={employeeSearch}
                                onChange={(e) => setEmployeeSearch(e.target.value)}
                                className="w-full h-8 pl-8 pr-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs outline-none"
                            />
                        </div>
                        <select
                            value={departmentFilter}
                            onChange={(e) => setDepartmentFilter(e.target.value)}
                            className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold"
                        >
                            <option value="ALL">Todos los Dptos.</option>
                            <option value="VENTAS">Ventas & Caja</option>
                            <option value="ALMACEN">Almacén</option>
                            <option value="ADMINISTRACION">Administración</option>
                            <option value="OPERACIONES">Operaciones</option>
                        </select>
                    </div>
                )}
            </div>

            {/* PESTAÑA 1: DIRECTORIO DE PERSONAL */}
            {activeTab === 'empleados' && (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    {filteredEmployees.length === 0 ? (
                        <div className="p-12 text-center space-y-3">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                No hay trabajadores registrados en el libro de nómina
                            </p>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                Puede importar en un clic a los operadores que ya usan el Punto de Venta o registrar un nuevo expediente laboral manualmente.
                            </p>
                            <div className="flex items-center justify-center gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={handleSyncPosOperators}
                                    className="h-9 px-4 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                    <UserPlus size={14} />
                                    <span>Importar Operadores del POS</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        resetEmployeeForm();
                                        setEditingEmployee(null);
                                        setIsNewEmployeeModalOpen(true);
                                    }}
                                    className="h-9 px-4 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                    <PlusCircle size={14} />
                                    <span>Registrar Manualmente</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500">
                                        <th className="py-2.5 px-4">Cédula / ID</th>
                                        <th className="py-2.5 px-4">Nombre Completo</th>
                                        <th className="py-2.5 px-4">Cargo y Departamento</th>
                                        <th className="py-2.5 px-4">Ingreso</th>
                                        <th className="py-2.5 px-4 text-right">Sueldo Base (USD / Bs)</th>
                                        <th className="py-2.5 px-4 text-right">Cestaticket</th>
                                        <th className="py-2.5 px-4 text-right">Neto Quincenal Est.</th>
                                        <th className="py-2.5 px-4">Banco / Cuenta</th>
                                        <th className="py-2.5 px-4 text-center">Estatus</th>
                                        <th className="py-2.5 px-4 text-right">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {filteredEmployees.map(emp => {
                                        const base = parseFloat(emp.baseSalary) || 0;
                                        const food = parseFloat(emp.foodAllowance) || 0;
                                        const quincenaNetUsd = ((base * (1 - 0.055)) + food) / 2;
                                        return (
                                            <tr key={emp.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                                <td className="py-2.5 px-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                                                    {emp.idCard}
                                                </td>
                                                <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                                                    <div>{emp.firstName} {emp.lastName}</div>
                                                    {emp.phone && <div className="text-[10px] font-mono text-slate-400">{emp.phone}</div>}
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <div className="font-semibold text-slate-800 dark:text-slate-200">{emp.position}</div>
                                                    <div className="text-[10px] font-mono uppercase text-slate-400">{emp.department}</div>
                                                </td>
                                                <td className="py-2.5 px-4 font-mono text-slate-500">
                                                    {emp.hireDate}
                                                </td>
                                                <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                                                    <div className="font-bold text-slate-900 dark:text-white">{fmtUSD(base)}</div>
                                                    <div className="text-[10px] text-slate-400">{fmtBs(base)}</div>
                                                </td>
                                                <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                                                    <div className="font-bold text-emerald-700 dark:text-emerald-400">{fmtUSD(food)}</div>
                                                    <div className="text-[10px] text-slate-400">{fmtBs(food)}</div>
                                                </td>
                                                <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                                                    <div className="font-bold text-blue-700 dark:text-blue-400">{fmtUSD(quincenaNetUsd)}</div>
                                                    <div className="text-[10px] text-slate-400">{fmtBs(quincenaNetUsd)}</div>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <div className="font-semibold text-slate-700 dark:text-slate-300">{emp.bankName || 'Efectivo / Caja'}</div>
                                                    <div className="text-[10px] font-mono text-slate-400">
                                                        {emp.bankAccountNumber ? `••••${emp.bankAccountNumber.slice(-6)}` : 'Sin cuenta 20 dígitos'}
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                                        emp.status === 'ACTIVE'
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                            : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400'
                                                    }`}>
                                                        {emp.status === 'ACTIVE' ? 'ACTIVO' : emp.status}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setEditingEmployee(emp);
                                                            setEmployeeForm({
                                                                idCard: emp.idCard,
                                                                firstName: emp.firstName,
                                                                lastName: emp.lastName,
                                                                email: emp.email || '',
                                                                phone: emp.phone || '',
                                                                position: emp.position,
                                                                department: emp.department,
                                                                hireDate: emp.hireDate,
                                                                contractType: emp.contractType,
                                                                salaryType: emp.salaryType,
                                                                baseSalary: emp.baseSalary,
                                                                foodAllowance: emp.foodAllowance,
                                                                bankName: emp.bankName || '',
                                                                bankAccountNumber: emp.bankAccountNumber || '',
                                                                status: emp.status,
                                                                notes: emp.notes || ''
                                                            });
                                                            setIsNewEmployeeModalOpen(true);
                                                        }}
                                                        className="h-7 px-2.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-[11px] cursor-pointer"
                                                    >
                                                        Editar Ficha
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* PESTAÑA 2: PERÍODOS DE NÓMINA Y LIQUIDACIÓN */}
            {activeTab === 'periodos' && (
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    {periods.length === 0 ? (
                        <div className="p-12 text-center space-y-3">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                Sin quincenas o períodos de nómina aperturados
                            </p>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                                Aperture una quincena para calcular automáticamente sueldos, Cestaticket, retenciones de ley y generar el asiento contable de pago.
                            </p>
                            <button
                                type="button"
                                onClick={() => setIsNewPeriodModalOpen(true)}
                                className="h-9 px-4 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                                <Calendar size={14} />
                                <span>Aperturar Primera Quincena</span>
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500">
                                        <th className="py-2.5 px-4">Período / Quincena</th>
                                        <th className="py-2.5 px-4">Lapso Laborado</th>
                                        <th className="py-2.5 px-4">Frecuencia</th>
                                        <th className="py-2.5 px-4 text-right">Asignaciones</th>
                                        <th className="py-2.5 px-4 text-right">Deducciones Ley</th>
                                        <th className="py-2.5 px-4 text-right">Neto a Desembolsar (USD / Bs)</th>
                                        <th className="py-2.5 px-4 text-center">Estado</th>
                                        <th className="py-2.5 px-4 text-right">Operaciones de Nómina</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                    {periods.map(p => {
                                        const isClosed = p.status === 'CLOSED';
                                        const isCalculated = p.status === 'CALCULATED';
                                        return (
                                            <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                                <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                                                    {p.periodName}
                                                </td>
                                                <td className="py-3 px-4 font-mono text-slate-500">
                                                    {p.startDate} → {p.endDate}
                                                </td>
                                                <td className="py-3 px-4 font-mono text-[11px] uppercase text-slate-600 dark:text-slate-400">
                                                    {p.frequency}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-bold">
                                                    {fmtUSD(p.totalEarnings)}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400 font-bold">
                                                    -{fmtUSD(p.totalDeductions)}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono tabular-nums">
                                                    <div className="font-bold text-slate-900 dark:text-white">{fmtUSD(p.totalNet)}</div>
                                                    <div className="text-[10px] text-slate-400">{fmtBs(p.totalNet)}</div>
                                                </td>
                                                <td className="py-3 px-4 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                                        isClosed
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                            : isCalculated
                                                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                                            : 'bg-slate-100 text-slate-700 border-slate-300'
                                                    }`}>
                                                        {isClosed ? 'PAGADA / CERRADA' : isCalculated ? 'CALCULADA' : 'ABIERTA'}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        {!isClosed && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCalculatePeriod(p.id)}
                                                                    className="h-7 px-2.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-semibold cursor-pointer"
                                                                >
                                                                    Calcular
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setSelectedPeriodToClose(p);
                                                                        setIsDisburseModalOpen(true);
                                                                    }}
                                                                    className="h-7 px-2.5 rounded bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 text-[11px] font-semibold cursor-pointer"
                                                                >
                                                                    Cerrar y Pagar
                                                                </button>
                                                            </>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedPeriodForReceipts(p.id);
                                                                setActiveTab('recibos');
                                                            }}
                                                            className="h-7 px-2.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold cursor-pointer"
                                                        >
                                                            Recibos
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDownloadBankTxt(p.id, 'BANESCO')}
                                                            className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono font-bold cursor-pointer"
                                                            title="Descargar archivo plano TXT Banesco"
                                                        >
                                                            TXT Banesco
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDownloadBankTxt(p.id, 'BDV')}
                                                            className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono font-bold cursor-pointer"
                                                            title="Descargar archivo plano TXT Banco de Venezuela"
                                                        >
                                                            TXT BDV
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* PESTAÑA 3: RECIBOS DE PAGO LOTTT */}
            {activeTab === 'recibos' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="w-full sm:w-96">
                            <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500 block mb-1">
                                Seleccionar Período Liquidado:
                            </label>
                            <select
                                value={selectedPeriodForReceipts}
                                onChange={(e) => setSelectedPeriodForReceipts(e.target.value)}
                                className="w-full h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold"
                            >
                                {periods.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.periodName} ({p.status})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            type="button"
                            onClick={() => window.print()}
                            className="h-9 px-4 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            <Printer size={14} />
                            <span>Imprimir Comprobantes de Pago</span>
                        </button>
                    </div>

                    {receipts.length === 0 ? (
                        <div className="bg-white dark:bg-slate-900 p-12 rounded-lg border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                            No existen recibos calculados para este período. En la pestaña "Quincenas y Liquidación", presione "Calcular" sobre el período deseado.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {receipts.map(rec => {
                                const emp = rec.Employee;
                                return (
                                    <div
                                        key={rec.id}
                                        className="bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden shadow-xs print:border-black"
                                    >
                                        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between">
                                            <div>
                                                <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                                                    {storeConfig?.name || 'ESTABLECIMIENTO COMERCIAL'} • COMPROBANTE LOTTT ART. 106
                                                </div>
                                                <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                                                    {emp?.firstName} {emp?.lastName}
                                                </h4>
                                                <div className="text-xs font-mono text-slate-500">
                                                    C.I: {emp?.idCard} • Cargo: {emp?.position}
                                                </div>
                                            </div>
                                            <div className="text-right font-mono">
                                                <span className="text-[10px] uppercase text-slate-400 block">Neto a Pagar</span>
                                                <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
                                                    {fmtUSD(rec.netAmount)}
                                                </span>
                                                <span className="block text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                                    {fmtBs(rec.netAmount)}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="p-4 space-y-1.5 text-xs font-mono">
                                            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                                                <span className="font-sans text-slate-700 dark:text-slate-300">Salario Base ({rec.daysWorked} días laborados)</span>
                                                <div className="text-right tabular-nums">
                                                    <span className="font-bold text-slate-900 dark:text-white">{fmtUSD(rec.baseEarnings)}</span>
                                                    <span className="text-[10px] text-slate-400 ml-2">({fmtBs(rec.baseEarnings)})</span>
                                                </div>
                                            </div>
                                            {rec.foodAllowance > 0 && (
                                                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                                                    <span className="font-sans text-slate-700 dark:text-slate-300">Cestaticket Socialista (No Salarial)</span>
                                                    <div className="text-right tabular-nums">
                                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">+{fmtUSD(rec.foodAllowance)}</span>
                                                        <span className="text-[10px] text-slate-400 ml-2">({fmtBs(rec.foodAllowance)})</span>
                                                    </div>
                                                </div>
                                            )}
                                            {rec.commissionsAmount > 0 && (
                                                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                                                    <span className="font-sans text-slate-700 dark:text-slate-300">Comisiones de Ventas POS</span>
                                                    <div className="text-right tabular-nums">
                                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">+{fmtUSD(rec.commissionsAmount)}</span>
                                                        <span className="text-[10px] text-slate-400 ml-2">({fmtBs(rec.commissionsAmount)})</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800 text-rose-700 dark:text-rose-400">
                                                <span className="font-sans">Retención Seguro Social Obligatorio (IVSS 4%)</span>
                                                <span className="tabular-nums font-bold">-{fmtUSD(rec.deductionIvss)}</span>
                                            </div>
                                            <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800 text-rose-700 dark:text-rose-400">
                                                <span className="font-sans">Fondo Ahorro Obligatorio Vivienda (FAOV 1%)</span>
                                                <span className="tabular-nums font-bold">-{fmtUSD(rec.deductionFaov)}</span>
                                            </div>
                                            {rec.deductionRpe > 0 && (
                                                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800 text-rose-700 dark:text-rose-400">
                                                    <span className="font-sans">Régimen Prestacional de Empleo (RPE 0.5%)</span>
                                                    <span className="tabular-nums font-bold">-{fmtUSD(rec.deductionRpe)}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-500">
                                            <span>Recibí conforme (Firma / Huella): ______________________</span>
                                            <span>Hash: {rec.receiptHash?.substring(0, 12)}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* MODAL: FICHA DEL TRABAJADOR CON VINCULACIÓN RÁPIDA DE OPERADOR POS */}
            {isNewEmployeeModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-lg border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                {editingEmployee ? 'Editar Expediente Laboral' : 'Registrar Trabajador en Nómina'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsNewEmployeeModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Autocompletar desde Operador del POS */}
                        {!editingEmployee && posUsers.length > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                                <span className="text-[10px] font-mono uppercase text-slate-500 font-bold block mb-1.5">
                                    Autocompletar desde Operador existente del POS:
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                    {posUsers.map(u => (
                                        <button
                                            key={u.id}
                                            type="button"
                                            onClick={() => {
                                                const fullName = (u.name || u.username || '').trim();
                                                const parts = fullName.split(' ');
                                                setEmployeeForm(prev => ({
                                                    ...prev,
                                                    firstName: parts[0] || fullName,
                                                    lastName: parts.slice(1).join(' ') || 'Operador',
                                                    email: u.email || '',
                                                    phone: u.phone || '',
                                                    position: u.role === 'admin' || u.role === 'superadmin' ? 'Administrador' : 'Cajero POS',
                                                    department: u.role === 'admin' || u.role === 'superadmin' ? 'ADMINISTRACION' : 'VENTAS'
                                                }));
                                            }}
                                            className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold hover:bg-slate-100 cursor-pointer"
                                        >
                                            + {u.name || u.username}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleSaveEmployee} className="space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Cédula de Identidad *</label>
                                    <input
                                        type="text"
                                        placeholder="V-18452910"
                                        required
                                        value={employeeForm.idCard}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, idCard: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Condición Laboral</label>
                                    <select
                                        value={employeeForm.status}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, status: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    >
                                        <option value="ACTIVE">Activo en Nómina</option>
                                        <option value="VACATION">En Vacaciones</option>
                                        <option value="LEAVE">Reposo / Permiso</option>
                                        <option value="TERMINATED">Egresado / Liquidado</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Nombres *</label>
                                    <input
                                        type="text"
                                        required
                                        value={employeeForm.firstName}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, firstName: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Apellidos *</label>
                                    <input
                                        type="text"
                                        required
                                        value={employeeForm.lastName}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, lastName: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Cargo Desempeñado</label>
                                    <input
                                        type="text"
                                        value={employeeForm.position}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, position: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Departamento</label>
                                    <select
                                        value={employeeForm.department}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    >
                                        <option value="VENTAS">Ventas & Mostrador</option>
                                        <option value="ALMACEN">Almacén & Despacho</option>
                                        <option value="ADMINISTRACION">Administración</option>
                                        <option value="OPERACIONES">Operaciones Generales</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Sueldo Base Mensual (USD) *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        placeholder="150.00"
                                        value={employeeForm.baseSalary}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, baseSalary: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono font-bold"
                                    />
                                    <span className="text-[10px] font-mono text-slate-400">
                                        Equiv: {fmtBs(employeeForm.baseSalary)} / mes
                                    </span>
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Cestaticket Mensual (USD)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="40.00"
                                        value={employeeForm.foodAllowance}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, foodAllowance: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono font-bold"
                                    />
                                    <span className="text-[10px] font-mono text-slate-400">
                                        Equiv: {fmtBs(employeeForm.foodAllowance)} / mes
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Banco Receptor</label>
                                    <input
                                        type="text"
                                        placeholder="Banesco / BDV / Pago Móvil"
                                        value={employeeForm.bankName}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, bankName: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Cuenta Bancaria (20 dígitos)</label>
                                    <input
                                        type="text"
                                        maxLength={20}
                                        placeholder="01340000000000000000"
                                        value={employeeForm.bankAccountNumber}
                                        onChange={(e) => setEmployeeForm({ ...employeeForm, bankAccountNumber: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsNewEmployeeModalOpen(false)}
                                    className="h-9 px-4 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="h-9 px-4 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold cursor-pointer"
                                >
                                    Guardar Expediente
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: APERTURAR PERÍODO */}
            {isNewPeriodModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-4">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Aperturar Período de Nómina
                        </h3>
                        <form onSubmit={handleCreatePeriod} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold text-slate-500 mb-1">Denominación del Período:</label>
                                <input
                                    type="text"
                                    required
                                    value={newPeriodForm.periodName}
                                    onChange={(e) => setNewPeriodForm({ ...newPeriodForm, periodName: e.target.value })}
                                    className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Fecha Inicio:</label>
                                    <input
                                        type="date"
                                        required
                                        value={newPeriodForm.startDate}
                                        onChange={(e) => setNewPeriodForm({ ...newPeriodForm, startDate: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Fecha Cierre:</label>
                                    <input
                                        type="date"
                                        required
                                        value={newPeriodForm.endDate}
                                        onChange={(e) => setNewPeriodForm({ ...newPeriodForm, endDate: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Fecha de Pago:</label>
                                    <input
                                        type="date"
                                        required
                                        value={newPeriodForm.paymentDate}
                                        onChange={(e) => setNewPeriodForm({ ...newPeriodForm, paymentDate: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-semibold text-slate-500 mb-1">Modalidad:</label>
                                    <select
                                        value={newPeriodForm.frequency}
                                        onChange={(e) => setNewPeriodForm({ ...newPeriodForm, frequency: e.target.value })}
                                        className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                    >
                                        <option value="QUINCENAL">Quincenal (15 días)</option>
                                        <option value="SEMANAL">Semanal (7 días)</option>
                                        <option value="MENSUAL">Mensual (30 días)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsNewPeriodModalOpen(false)}
                                    className="h-9 px-4 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="h-9 px-4 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold cursor-pointer"
                                >
                                    Aperturar Período
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CERRAR Y DESEMBOLSAR */}
            {isDisburseModalOpen && selectedPeriodToClose && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-800 shadow-xl p-5 space-y-4">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Liquidar y Asentar Nómina en Contabilidad
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                            Se cerrará el período <strong>{selectedPeriodToClose.periodName}</strong> por un neto de{' '}
                            <strong>{fmtUSD(selectedPeriodToClose.totalNet)}</strong> ({fmtBs(selectedPeriodToClose.totalNet)}).
                        </p>
                        <form onSubmit={handleCloseAndDisburse} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-semibold text-slate-500 mb-1">
                                    Cuenta Bancaria / Tesorería de Origen:
                                </label>
                                <select
                                    value={selectedBankAccountId}
                                    onChange={(e) => setSelectedBankAccountId(e.target.value)}
                                    className="w-full h-9 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-semibold"
                                >
                                    <option value="">Liquidar contra Efectivo en Caja General</option>
                                    {bankAccounts.map(b => (
                                        <option key={b.id} value={b.id}>
                                            {b.bankName} — {b.accountNumber} (Saldo: {fmtUSD(b.currentBalance)})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="p-3 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
                                Se generará automáticamente el asiento de partida doble en el Libro Diario (Gasto de Nómina y Cestaticket contra Retenciones por Pagar y Banco/Caja).
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsDisburseModalOpen(false);
                                        setSelectedPeriodToClose(null);
                                    }}
                                    className="h-9 px-4 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 font-semibold"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="h-9 px-4 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold cursor-pointer"
                                >
                                    Confirmar Desembolso
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
