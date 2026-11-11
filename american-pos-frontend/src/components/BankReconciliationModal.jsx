import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { 
    X, CheckCircle2, AlertCircle, RefreshCw, Landmark, 
    DollarSign, Banknote, Calendar, Hash, ArrowUpRight, 
    ArrowDownRight, Check, Filter, Plus, ShieldCheck
} from 'lucide-react';
import api from '../services/api';
import { formatMoney } from '../utils/format';

export default function BankReconciliationModal({ isOpen, onClose, initialAccountId, onReconciled }) {
    const [accounts, setAccounts] = useState([]);
    const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId || '');
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [reconcilingId, setReconcilingId] = useState(null);
    const [filterStatus, setFilterStatus] = useState('PENDIENTE'); // 'PENDIENTE', 'CONCILIADO', 'ALL'
    
    // Quick Commission Modal inside
    const [showFeeModal, setShowFeeModal] = useState(false);
    const [feeForm, setFeeForm] = useState({
        amount: '',
        referenceNumber: '',
        description: 'Comisión bancaria / Mantenimiento de cuenta',
        date: new Date().toISOString().split('T')[0]
    });
    const [savingFee, setSavingFee] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadAccounts();
        }
    }, [isOpen]);

    useEffect(() => {
        if (initialAccountId) {
            setSelectedAccountId(initialAccountId);
        }
    }, [initialAccountId]);

    useEffect(() => {
        if (selectedAccountId) {
            loadTransactions(selectedAccountId);
        }
    }, [selectedAccountId, filterStatus]);

    const loadAccounts = async () => {
        try {
            const res = await api.get('/banks/accounts');
            setAccounts(res.data || []);
            if (!selectedAccountId && res.data && res.data.length > 0) {
                setSelectedAccountId(initialAccountId || res.data[0].id);
            }
        } catch (error) {
            console.error('Error loading accounts:', error);
            toast.error('Error al cargar cuentas bancarias');
        }
    };

    const loadTransactions = async (accountId) => {
        try {
            setLoading(true);
            const params = {
                bankAccountId: accountId,
                status: filterStatus === 'ALL' ? undefined : filterStatus
            };
            const res = await api.get('/banks/transactions', { params });
            setTransactions(res.data || []);
        } catch (error) {
            console.error('Error loading transactions:', error);
            toast.error('Error al cargar movimientos para conciliación');
        } finally {
            setLoading(false);
        }
    };

    const currentAccount = useMemo(() => {
        return accounts.find(a => a.id === selectedAccountId);
    }, [accounts, selectedAccountId]);

    // Reconciliation calculations
    const stats = useMemo(() => {
        const total = Number(currentAccount?.currentBalance) || 0;
        const pendingTxs = transactions.filter(t => t.status === 'PENDIENTE');
        const reconciledTxs = transactions.filter(t => t.status === 'CONCILIADO');

        const pendingSum = pendingTxs.reduce((acc, t) => {
            const isIngreso = t.type === 'INGRESO' || t.type === 'TRANSFERENCIA_ENTRADA';
            return isIngreso ? acc + Number(t.amount) : acc - Number(t.amount);
        }, 0);

        return {
            totalBalance: total,
            pendingCount: pendingTxs.length,
            reconciledCount: reconciledTxs.length,
            pendingDifference: pendingSum
        };
    }, [currentAccount, transactions]);

    const handleToggleReconcile = async (txId, currentStatus) => {
        try {
            setReconcilingId(txId);
            const newStatus = currentStatus !== 'CONCILIADO';
            await api.post(`/banks/transactions/${txId}/reconcile`, { reconciled: newStatus });
            
            toast.success(newStatus ? 'Movimiento marcado como conciliado' : 'Movimiento marcado como pendiente');
            
            // Update local state smoothly
            setTransactions(prev => prev.map(t => {
                if (t.id === txId) {
                    return { ...t, status: newStatus ? 'CONCILIADO' : 'PENDIENTE' };
                }
                return t;
            }));

            if (onReconciled) onReconciled();
        } catch (error) {
            console.error('Error toggling reconcile:', error);
            toast.error('Error al actualizar estatus de conciliación');
        } finally {
            setReconcilingId(null);
        }
    };

    const handleBulkReconcileAll = async () => {
        const pendings = transactions.filter(t => t.status === 'PENDIENTE');
        if (pendings.length === 0) {
            toast('No hay movimientos pendientes por conciliar', { icon: 'ℹ️' });
            return;
        }

        if (!window.confirm(`¿Deseas marcar los ${pendings.length} movimientos pendientes como CONCILIADOS?`)) return;

        try {
            setLoading(true);
            for (const tx of pendings) {
                await api.post(`/banks/transactions/${tx.id}/reconcile`, { reconciled: true });
            }
            toast.success(`${pendings.length} movimientos conciliados con éxito`);
            loadTransactions(selectedAccountId);
            if (onReconciled) onReconciled();
        } catch (error) {
            console.error('Error in bulk reconcile:', error);
            toast.error('Error en la conciliación masiva');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveFee = async (e) => {
        e.preventDefault();
        if (!feeForm.amount || Number(feeForm.amount) <= 0) {
            toast.error('Ingresa un monto válido para la comisión');
            return;
        }

        try {
            setSavingFee(true);
            await api.post('/banks/transactions', {
                bankAccountId: selectedAccountId,
                type: 'COMISION',
                amount: Number(feeForm.amount),
                currency: currentAccount?.currency || 'VES',
                referenceNumber: feeForm.referenceNumber,
                description: feeForm.description,
                category: 'COMISION_BANCARIA',
                date: feeForm.date,
                status: 'CONCILIADO'
            });

            toast.success('Comisión bancaria registrada y conciliada');
            setShowFeeModal(false);
            setFeeForm({
                amount: '',
                referenceNumber: '',
                description: 'Comisión bancaria / Mantenimiento de cuenta',
                date: new Date().toISOString().split('T')[0]
            });
            loadAccounts();
            loadTransactions(selectedAccountId);
            if (onReconciled) onReconciled();
        } catch (error) {
            console.error('Error saving fee:', error);
            toast.error('Error al registrar la comisión bancaria');
        } finally {
            setSavingFee(false);
        }
    };

    if (!isOpen) return null;

    const currencySymbol = currentAccount?.currency === 'USD' ? '$' : 'Bs';

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92dvh] overflow-hidden pb-safe">
                
                {/* Header */}
                <div className="p-3.5 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold shrink-0">
                            <ShieldCheck size={24} />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">Conciliación Bancaria</h2>
                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                Cotejo de movimientos registrados en el sistema contra el extracto oficial del banco
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Account & Controls Selector */}
                <div className="p-3.5 sm:p-6 border-b border-slate-200 dark:border-white/10 bg-slate-100/40 dark:bg-slate-800/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        <label className="text-[11px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider shrink-0">
                            Cuenta:
                        </label>
                        <select
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none shadow-sm min-h-[44px]"
                        >
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.bankName} - {acc.accountNumber ? `(***${acc.accountNumber.slice(-4)})` : 'S/N'} [{acc.currency}] - Saldo: {formatMoney(acc.currentBalance, acc.currency)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Filter Status */}
                        <div className="flex flex-1 sm:flex-none bg-slate-200/60 dark:bg-slate-800 p-1 rounded-xl border border-slate-300/60 dark:border-white/5 text-[11px] sm:text-xs font-bold">
                            <button
                                type="button"
                                onClick={() => setFilterStatus('PENDIENTE')}
                                className={`flex-1 sm:flex-none px-2.5 sm:px-3 py-2 sm:py-1.5 min-h-[38px] rounded-lg transition-all cursor-pointer active:scale-95 flex items-center justify-center ${filterStatus === 'PENDIENTE' ? 'bg-white dark:bg-primary-500 text-primary-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                Pendientes ({stats.pendingCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterStatus('CONCILIADO')}
                                className={`flex-1 sm:flex-none px-2.5 sm:px-3 py-2 sm:py-1.5 min-h-[38px] rounded-lg transition-all cursor-pointer active:scale-95 flex items-center justify-center ${filterStatus === 'CONCILIADO' ? 'bg-white dark:bg-primary-500 text-primary-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                Conciliados ({stats.reconciledCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setFilterStatus('ALL')}
                                className={`flex-1 sm:flex-none px-2.5 sm:px-3 py-2 sm:py-1.5 min-h-[38px] rounded-lg transition-all cursor-pointer active:scale-95 flex items-center justify-center ${filterStatus === 'ALL' ? 'bg-white dark:bg-primary-500 text-primary-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                Todos
                            </button>
                        </div>

                        {/* Quick Register Fee */}
                        <button
                            onClick={() => setShowFeeModal(true)}
                            type="button"
                            className="min-h-[44px] px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                            title="Registrar comisión o gasto no reflejado en libros"
                        >
                            <Plus size={14} />
                            <span>Comisión</span>
                        </button>

                        {/* Bulk Reconcile */}
                        <button
                            onClick={handleBulkReconcileAll}
                            disabled={loading || stats.pendingCount === 0}
                            type="button"
                            className="min-h-[44px] px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/20"
                            title="Conciliar todos los pendientes visibles"
                        >
                            <Check size={14} />
                            <span>Conciliar Todo</span>
                        </button>
                    </div>
                </div>

                {/* Account Balance Summary Bar */}
                <div className="grid grid-cols-3 gap-2 p-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-white/10 text-center">
                    <div className="p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Saldo en Libros</span>
                        <span className="text-base font-black text-slate-800 dark:text-white">
                            {formatMoney(stats.totalBalance, currentAccount?.currency || 'VES')}
                        </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-500 block">Por Conciliar</span>
                        <span className="text-base font-black text-amber-500">
                            {stats.pendingCount} movimientos
                        </span>
                    </div>
                    <div className="p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500 block">Conciliados</span>
                        <span className="text-base font-black text-emerald-500">
                            {stats.reconciledCount} cotejados
                        </span>
                    </div>
                </div>

                {/* Transaction List */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {loading ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-3 text-slate-400">
                            <RefreshCw className="animate-spin text-primary-500" size={32} />
                            <span className="text-xs font-bold">Cargando movimientos...</span>
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-2 text-slate-400">
                            <CheckCircle2 size={40} className="text-emerald-500/50" />
                            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                {filterStatus === 'PENDIENTE' 
                                    ? '¡Excelente! No hay movimientos pendientes en esta cuenta.' 
                                    : 'No se encontraron movimientos registrados con este filtro.'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {transactions.map(tx => {
                                const isIngreso = tx.type === 'INGRESO' || tx.type === 'TRANSFERENCIA_ENTRADA';
                                const isReconciled = tx.status === 'CONCILIADO';
                                
                                return (
                                    <div 
                                        key={tx.id}
                                        className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                            isReconciled 
                                                ? 'bg-slate-50/70 dark:bg-slate-800/30 border-slate-200/60 dark:border-white/5 opacity-85' 
                                                : 'bg-white dark:bg-slate-800 border-amber-500/30 dark:border-amber-500/20 shadow-sm'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black ${
                                                isIngreso 
                                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                                                    : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                            }`}>
                                                {isIngreso ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-xs font-bold text-slate-800 dark:text-white truncate">
                                                        {tx.description || tx.type}
                                                    </span>
                                                    {tx.referenceNumber && (
                                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/5">
                                                            Ref: {tx.referenceNumber}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                                                    <span>{tx.date}</span>
                                                    <span>•</span>
                                                    <span className="uppercase tracking-wider font-semibold">{tx.type}</span>
                                                    {tx.reconciledAt && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-emerald-500 text-[10px]">
                                                                Conciliado el {new Date(tx.reconciledAt).toLocaleDateString()}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-white/5 shrink-0">
                                            <div className="text-left sm:text-right">
                                                <span className={`text-sm font-black tabular-nums ${
                                                    isIngreso ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                                }`}>
                                                    {isIngreso ? '+' : '-'}{formatMoney(tx.amount, tx.currency)}
                                                </span>
                                            </div>

                                            <button
                                                onClick={() => handleToggleReconcile(tx.id, tx.status)}
                                                disabled={reconcilingId === tx.id}
                                                type="button"
                                                className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 border ${
                                                    isReconciled 
                                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30' 
                                                        : 'bg-amber-500 hover:bg-amber-600 text-white border-transparent shadow-sm shadow-amber-500/20'
                                                }`}
                                            >
                                                {reconcilingId === tx.id ? (
                                                    <RefreshCw className="animate-spin" size={14} />
                                                ) : isReconciled ? (
                                                    <>
                                                        <Check size={14} />
                                                        <span>Conciliado</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>Marcar Conciliado</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3.5 sm:p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/50 flex flex-col sm:flex-row gap-3 justify-between items-center text-xs text-slate-500">
                    <span className="text-center sm:text-left">Marque las casillas para confirmar que el dinero coincide con el extracto bancario oficial.</span>
                    <button
                        onClick={onClose}
                        type="button"
                        className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white rounded-xl font-bold transition-all active:scale-95 cursor-pointer flex items-center justify-center shrink-0"
                    >
                        Cerrar Ventana
                    </button>
                </div>
            </div>

            {/* Quick Fee Modal Sub-dialog */}
            {showFeeModal && (
                <div className="fixed inset-0 z-[350] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-4 sm:p-6 animate-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto pb-safe">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
                            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <Plus size={16} className="text-rose-500" />
                                Registrar Comisión Bancaria
                            </h3>
                            <button
                                onClick={() => setShowFeeModal(false)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-2 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveFee} className="space-y-4 pt-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Monto de la Comisión ({currencySymbol}) *
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    required
                                    value={feeForm.amount}
                                    onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                                    placeholder="0.00"
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-base sm:text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none min-h-[44px]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Número de Referencia / Débito
                                </label>
                                <input
                                    type="text"
                                    value={feeForm.referenceNumber}
                                    onChange={(e) => setFeeForm({ ...feeForm, referenceNumber: e.target.value })}
                                    placeholder="Ej. COM-89421"
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none min-h-[44px]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Concepto / Descripción
                                </label>
                                <input
                                    type="text"
                                    value={feeForm.description}
                                    onChange={(e) => setFeeForm({ ...feeForm, description: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none min-h-[44px]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                    Fecha en el Extracto
                                </label>
                                <input
                                    type="date"
                                    value={feeForm.date}
                                    onChange={(e) => setFeeForm({ ...feeForm, date: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2.5 text-base sm:text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-rose-500 outline-none min-h-[44px]"
                                />
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowFeeModal(false)}
                                    className="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingFee}
                                    className="min-h-[44px] px-5 py-2.5 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-rose-500/20 cursor-pointer"
                                >
                                    {savingFee ? <RefreshCw className="animate-spin" size={14} /> : null}
                                    <span>Guardar y Conciliar</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
