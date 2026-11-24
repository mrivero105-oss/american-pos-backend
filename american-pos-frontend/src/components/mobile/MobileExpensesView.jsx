import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, 
  DollarSign, 
  Plus, 
  Trash2, 
  RefreshCw, 
  X, 
  Save, 
  Edit2, 
  Search, 
  Eye, 
  Receipt, 
  Clock
} from 'lucide-react';
import api from '../../services/api';
import { db as primaryDb } from '../../services/db';
import localDb from '../../db/localDb';
import { VoiceMicButton } from '../../utils/voiceSearch';

const LOCAL_EXPENSES_KEY = 'isaac_pos_mobile_expenses';

const persistExpensesLocally = async (list) => {
  const incoming = Array.isArray(list) ? list : [];
  let merged = incoming;
  try {
    if (localDb && localDb.expenses) {
      const existing = await localDb.expenses.toArray().catch(() => []);
      const incomingIds = new Set(incoming.map(e => String(e?.id || '')));
      const pendingOnly = (existing || []).filter(
        e => e && (e.status === 'pending_sync' || String(e.id || '').startsWith('exp_')) && !incomingIds.has(String(e.id || ''))
      );
      merged = [...pendingOnly, ...incoming].slice(0, 200);
      await primaryDb.replaceAllAtomic('expenses', merged, 'id');
    }
  } catch (caughtErr) { console.warn('[MobileExpensesView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
  try {
    localStorage.setItem(LOCAL_EXPENSES_KEY, JSON.stringify(merged.slice(0, 200)));
  } catch (caughtErr) { console.warn('[MobileExpensesView] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
};

const triggerHaptic = (ms = 15) => {
  try {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(ms);
    }
  } catch { /* Vibración háptica opcional no soportada */ }
};

const EXPENSE_CATEGORIES = [
  'Todos',
  'Operativo',
  'Suministros',
  'Transporte',
  'Alimentación',
  'Servicios',
  'Nómina',
  'Mantenimiento',
  'Varios'
];

export default function MobileExpensesView({
  exchangeRate = 950,
  user,
  T,
  onBackToPOS,
  showToast
}) {
  const [expenses, setExpenses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');

  // Modal para Crear / Editar Gasto
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null); // null = crear, obj = editar
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Operativo');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo USD');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de Confirmación de Eliminación
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { expense }
  const [isDeleting, setIsDeleting] = useState(false);

  // Modal de Detalle / Comprobante de Gasto
  const [detailExpense, setDetailExpense] = useState(null);

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/expenses?limit=100', { timeout: 4000 });
      const raw = Array.isArray(res.data) ? res.data : (res.data?.expenses || []);
      setExpenses(raw);
      persistExpensesLocally(raw);
      setIsLoading(false);
      return;
    } catch (_e) {
      console.warn('No se pudo cargar gastos de API, leyendo almacenamiento local...');
    }

    try {
      if (localDb && localDb.expenses) {
        const localItems = await localDb.expenses.toArray();
        if (Array.isArray(localItems) && localItems.length > 0) {
          localItems.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
          setExpenses(localItems);
          setIsLoading(false);
          return;
        }
      }
    } catch (caughtErr) { console.warn('[MobileExpensesView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

    try {
      const saved = localStorage.getItem(LOCAL_EXPENSES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setExpenses(parsed);
      }
    } catch (caughtErr) { console.warn('[MobileExpensesView] Error parseando JSON local:', caughtErr?.message || caughtErr); }
    setIsLoading(false);
  };

  // Filtrado reactivo por categoría y búsqueda
  const filteredExpenses = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return expenses.filter(exp => {
      const matchesCat = selectedCategory === 'Todos' || 
        (exp.category || exp.categoria || 'Operativo').toLowerCase() === selectedCategory.toLowerCase();

      const desc = (exp.description || exp.concepto || '').toLowerCase();
      const method = (exp.paymentMethod || '').toLowerCase();
      const by = (exp.registeredBy || '').toLowerCase();

      const matchesSearch = !q || desc.includes(q) || method.includes(q) || by.includes(q);
      return matchesCat && matchesSearch;
    });
  }, [expenses, searchQuery, selectedCategory]);

  // Totales financieros calculados en base al filtro actual
  const totals = useMemo(() => {
    let usd = 0;
    filteredExpenses.forEach(exp => {
      const amt = Number(exp.amount || exp.monto || 0);
      const curr = (exp.currency || 'USD').toUpperCase();
      usd += (curr === 'BS' || curr === 'VES') ? (amt / (exp.exchangeRate || exchangeRate)) : amt;
    });
    return {
      usd,
      bs: usd * exchangeRate,
      count: filteredExpenses.length
    };
  }, [filteredExpenses, exchangeRate]);

  // Contadores por categoría para los chips
  const categoryCounts = useMemo(() => {
    const counts = { Todos: expenses.length };
    EXPENSE_CATEGORIES.forEach(cat => {
      if (cat !== 'Todos') {
        counts[cat] = expenses.filter(e => (e.category || e.categoria || 'Operativo').toLowerCase() === cat.toLowerCase()).length;
      }
    });
    return counts;
  }, [expenses]);

  // Abrir Modal de Creación
  const handleOpenCreate = () => {
    triggerHaptic(20);
    setEditingExpense(null);
    setAmount('');
    setCurrency('USD');
    setDescription('');
    setCategory(selectedCategory !== 'Todos' ? selectedCategory : 'Operativo');
    setPaymentMethod('Efectivo USD');
    setNotes('');
    setIsFormModalOpen(true);
  };

  // Abrir Modal de Edición
  const handleOpenEdit = (exp) => {
    triggerHaptic(20);
    setEditingExpense(exp);
    setAmount(String(exp.amount || exp.monto || ''));
    setCurrency(['BS', 'VES', 'BS.'].includes(String(exp.currency || 'USD').toUpperCase()) ? 'VES' : 'USD');
    setDescription(exp.description || exp.concepto || '');
    setCategory(exp.category || exp.categoria || 'Operativo');
    setPaymentMethod(exp.paymentMethod || 'Efectivo USD');
    setNotes(exp.notes || '');
    setIsFormModalOpen(true);
  };

  // Guardar Gasto (Crear o Editar)
  const handleSaveExpense = async (e) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showToast?.('Ingresa un monto válido mayor a 0');
      return;
    }
    if (!description.trim()) {
      showToast?.('Ingresa el concepto del gasto');
      return;
    }

    setIsSubmitting(true);
    const normalizedCur = ['BS', 'VES', 'BS.'].includes(String(currency || 'USD').toUpperCase()) ? 'VES' : 'USD';
    const safeRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;
    const payload = {
      amount: parsedAmount,
      monto: parsedAmount,
      currency: normalizedCur,
      description: description.trim(),
      concepto: description.trim(),
      category,
      categoria: category,
      paymentMethod,
      notes: notes.trim(),
      exchangeRate: safeRate,
      date: editingExpense ? editingExpense.date : new Date().toISOString(),
      registeredBy: user?.name || user?.username || 'Cajero Móvil'
    };

    if (editingExpense) {
      // ACTUALIZAR GASTO EXISTENTE
      const expId = editingExpense.id;
      try {
        const res = await api.put(`/expenses/${expId}`, payload, { timeout: 4000 });
        const updated = res.data || { ...editingExpense, ...payload };
        setExpenses(prev => {
          const next = prev.map(e => e.id === expId ? updated : e);
          persistExpensesLocally(next);
          return next;
        });
        showToast?.(`✅ Gasto actualizado con éxito`);
        setIsFormModalOpen(false);
        if (detailExpense?.id === expId) setDetailExpense(updated);
      } catch (err) {
        const httpStatus = err?.response?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          const msg = err?.response?.data?.error || err?.response?.data?.message || 'No tienes permiso para modificar este gasto';
          showToast?.(`⚠️ ${msg}`);
          return;
        }
        console.warn('Error al actualizar gasto en servidor, guardando local:', err);
        const updated = { ...editingExpense, ...payload, status: 'pending_sync' };
        setExpenses(prev => {
          const next = prev.map(e => e.id === expId ? updated : e);
          persistExpensesLocally(next);
          return next;
        });
        try {
          await primaryDb.put('syncQueue', {
            id: `exp_upd_${Date.now()}`,
            endpoint: `/expenses/${expId}`,
            method: 'PUT',
            payload,
            createdAt: new Date().toISOString()
          });
        } catch (caughtErr) { console.warn('[MobileExpensesView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
        showToast?.('⚡ Gasto actualizado offline');
        setIsFormModalOpen(false);
        if (detailExpense?.id === expId) setDetailExpense(updated);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // CREAR GASTO NUEVO
      const newExpense = {
        id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        ...payload,
        status: 'pending_sync',
        createdAt: new Date().toISOString()
      };

      try {
        const res = await api.post('/expenses', payload, { timeout: 4000 });
        const created = res.data || { ...newExpense, status: 'synced' };
        setExpenses(prev => {
          const next = [created, ...prev];
          persistExpensesLocally(next);
          return next;
        });
        showToast?.('✅ Gasto registrado en el servidor');
        setIsFormModalOpen(false);
      } catch (err) {
        const httpStatus = err?.response?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          const msg = err?.response?.data?.error || err?.response?.data?.message || 'No tienes permiso para registrar gastos';
          showToast?.(`⚠️ ${msg}`);
          return;
        }
        console.warn('Servidor inaccesible, guardando gasto en cola local:', err);
        setExpenses(prev => {
          const next = [newExpense, ...prev];
          persistExpensesLocally(next);
          return next;
        });
        try {
          await primaryDb.put('syncQueue', {
            id: `exp_sync_${Date.now()}`,
            tempLocalId: newExpense.id,
            endpoint: '/expenses',
            method: 'POST',
            payload: newExpense,
            createdAt: new Date().toISOString()
          });
        } catch (caughtErr) { console.warn('[MobileExpensesView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
        showToast?.('⚡ Gasto guardado offline en teléfono');
        setIsFormModalOpen(false);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Solicitar Eliminación
  const handleRequestDelete = (exp) => {
    triggerHaptic(20);
    setDeleteConfirm({
      expense: exp,
      message: `¿Estás seguro de que deseas eliminar permanentemente este egreso de ${exp.description || exp.concepto}?`
    });
  };

  // Ejecutar Eliminación
  const handleExecuteDelete = async () => {
    if (!deleteConfirm?.expense) return;
    const exp = deleteConfirm.expense;
    setIsDeleting(true);

    try {
      await api.delete(`/expenses/${exp.id}`, { timeout: 4000 });
      setExpenses(prev => {
        const next = prev.filter(e => e.id !== exp.id);
        persistExpensesLocally(next);
        return next;
      });
      showToast?.('✅ Gasto eliminado exitosamente');
      setDeleteConfirm(null);
      if (detailExpense?.id === exp.id) setDetailExpense(null);
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 401) {
        const errorMsg = err.response?.data?.error || err.response?.data?.message || 'No tienes permiso para eliminar gastos';
        showToast?.(`🚫 ${errorMsg}`);
        setDeleteConfirm(null);
        return;
      }
      console.warn('Fallo de red al eliminar en servidor, removiendo localmente:', err);
      setExpenses(prev => {
        const next = prev.filter(e => e.id !== exp.id);
        persistExpensesLocally(next);
        return next;
      });
      try {
        await primaryDb.put('syncQueue', {
          id: `exp_del_${Date.now()}`,
          endpoint: `/expenses/${exp.id}`,
          method: 'DELETE',
          createdAt: new Date().toISOString()
        });
      } catch (caughtErr) { console.warn('[MobileExpensesView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
      showToast?.('⚡ Gasto eliminado offline');
      setDeleteConfirm(null);
      if (detailExpense?.id === exp.id) setDetailExpense(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`flex flex-col h-full ${T.cardBg} animate-fadeIn`}>
      {/* 1. HEADER DE GASTOS */}
      <div className={`p-3.5 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
        <div className="flex items-center gap-2">
          <button 
            onClick={onBackToPOS}
            className={`p-1.5 rounded-xl ${T.btnGhost} flex items-center gap-1 text-xs font-bold cursor-pointer`}
            title="Volver a Terminal POS"
          >
            <ArrowLeft size={16} />
            <span className="hidden xs:inline">POS</span>
          </button>
          <div>
            <h2 className={`font-black text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5`}>
              <DollarSign size={16} className="text-rose-500 shrink-0" />
              <span>Gastos</span>
            </h2>
            <p className={`text-[10px] ${T.textMuted}`}>Caja chica y egresos</p>
          </div>
        </div>

        <button
          onClick={handleOpenCreate}
          className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
        >
          <Plus size={14} />
          <span>+ Gasto</span>
        </button>
      </div>

      {/* 2. TARJETAS DE RESUMEN Y TOTALES */}
      <div className={`p-3 border-b ${T.border} shrink-0 space-y-2.5 ${T.subPanelBg}`}>
        <div className="grid grid-cols-2 gap-2">
          <div className={`${T.modalSubCard} p-2.5 rounded-2xl border ${T.border}`}>
            <span className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
              Total Egresos USD
            </span>
            <div className="font-black text-base sm:text-lg text-rose-500 mt-0.5">
              ${totals.usd.toFixed(2)}
            </div>
            <span className={`text-[10px] ${T.textMuted} font-semibold block`}>
              {totals.count} registrados
            </span>
          </div>

          <div className={`${T.modalSubCard} p-2.5 rounded-2xl border ${T.border}`}>
            <span className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
              Total en Bolívares
            </span>
            <div className={`font-black text-base sm:text-lg ${T.textPrimary} mt-0.5 truncate`}>
              Bs. {totals.bs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <span className={`text-[10px] ${T.textMuted} font-semibold block`}>
              Tasa: Bs. {exchangeRate.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Buscador de Gastos */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${T.inputBg} border ${T.border}`}>
          <Search size={14} className={T.textMuted} />
          <input 
            type="text"
            placeholder="Buscar por concepto, categoría o responsable..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`bg-transparent flex-1 text-xs outline-none ${T.textPrimary} font-medium`}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className={T.textMuted}>
              <X size={13} />
            </button>
          )}
          <VoiceMicButton
            size={14}
            prompt="Di el concepto o categoría del gasto..."
            onResult={(spokenText) => setSearchQuery(spokenText)}
            onError={(errMsg) => showToast?.(`🎤 ${errMsg}`)}
          />
        </div>

        {/* Pestañas de Filtro por Categoría */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar text-xs">
          {EXPENSE_CATEGORIES.map((cat, idx) => {
            const isSelected = selectedCategory === cat;
            const count = categoryCounts[cat] || 0;
            return (
              <button
                key={idx}
                onClick={() => {
                  triggerHaptic(10);
                  setSelectedCategory(cat);
                }}
                className={`px-3 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 ${
                  isSelected 
                    ? 'bg-rose-600 text-white shadow-xs' 
                    : `${T.btnGhost} ${T.textMuted}`
                }`}
              >
                <span>{cat}</span>
                <span className="text-[9.5px] opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. LISTADO DE GASTOS */}
      <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 custom-scrollbar">
        {isLoading ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2">
            <RefreshCw size={24} className="animate-spin text-rose-500" />
            <p className={`text-xs font-bold ${T.textMuted}`}>Cargando egresos...</p>
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center p-6 text-center space-y-2">
            <DollarSign size={36} className={T.textMuted} />
            <p className={`font-bold text-xs sm:text-sm ${T.textPrimary}`}>
              {searchQuery ? 'No se encontraron gastos con esa búsqueda' : 'No hay egresos registrados en esta categoría'}
            </p>
            <p className={`text-[11px] ${T.textMuted}`}>
              Usa el botón &ldquo;+ Gasto&rdquo; arriba para registrar compras de caja chica
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {filteredExpenses.map((exp, idx) => {
              const expAmt = Number(exp.amount || exp.monto || 0);
              const isBs = (exp.currency || '').toUpperCase() === 'BS' || (exp.currency || '').toUpperCase() === 'VES';
              const amtUSD = isBs ? (expAmt / exchangeRate) : expAmt;
              const amtBS = isBs ? expAmt : (expAmt * exchangeRate);
              const dateStr = new Date(exp.date || exp.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <div 
                  key={exp.id || idx}
                  className={`${T.ticketItemBg} p-3 rounded-2xl border ${T.border} flex flex-col justify-between gap-2.5 hover:border-rose-500/30 transition-all shadow-2xs`}
                >
                  {/* Fila Superior: Concepto y Monto */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className={`font-black text-xs sm:text-sm ${T.textPrimary} truncate`}>
                        {exp.description || exp.concepto || 'Egreso'}
                      </h4>
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-500 font-black">
                          {exp.category || exp.categoria || 'Operativo'}
                        </span>
                        <span className={`font-bold ${T.textMuted}`}>
                          {exp.paymentMethod || 'Efectivo'}
                        </span>
                        {exp.registeredBy && (
                          <span className={`text-[9.5px] ${T.textSecondary} truncate`}>
                            • {exp.registeredBy}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-black text-sm text-rose-500">
                        -${amtUSD.toFixed(2)}
                      </p>
                      <p className={`text-[10px] font-bold ${T.textSecondary}`}>
                        Bs. {amtBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Fila Inferior: Botones de Acción (Editar, Eliminar, Ver Ficha) */}
                  <div className={`pt-2 border-t ${T.border} flex items-center justify-between gap-1.5`}>
                    <span className={`text-[10px] font-mono ${T.textMuted} flex items-center gap-1`}>
                      <Clock size={11} />
                      {dateStr}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDetailExpense(exp)}
                        className={`p-1.5 rounded-xl ${T.btnGhost} text-slate-400 hover:text-blue-500 transition-all cursor-pointer`}
                        title="Ver Comprobante / Detalle"
                      >
                        <Eye size={13} />
                      </button>

                      <button
                        onClick={() => handleOpenEdit(exp)}
                        className={`p-1.5 rounded-xl ${T.btnGhost} text-amber-500 hover:bg-amber-500/15 transition-all cursor-pointer`}
                        title="Editar Gasto"
                      >
                        <Edit2 size={13} />
                      </button>

                      <button
                        onClick={() => handleRequestDelete(exp)}
                        className={`p-1.5 rounded-xl ${T.btnGhost} text-rose-500 hover:bg-rose-500/15 transition-all cursor-pointer`}
                        title="Eliminar Gasto"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. MODAL: CREAR / EDITAR GASTO */}
      {isFormModalOpen && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm ${T.modalCard} rounded-xl p-4 sm:p-5 shadow-2xl space-y-3.5 max-h-[92dvh] overflow-y-auto custom-scrollbar`}>
            {/* Header del Modal */}
            <div className={`flex items-center justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2">
                {editingExpense ? (
                  <Edit2 size={18} className="text-amber-500 shrink-0" />
                ) : (
                  <DollarSign size={18} className="text-rose-500 shrink-0" />
                )}
                <div>
                  <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary}`}>
                    {editingExpense ? 'Editar Gasto' : 'Registrar Gasto de Caja'}
                  </h3>
                  <p className={`text-[10px] ${T.textMuted}`}>
                    {editingExpense ? 'Modifica los datos del egreso' : 'Salida de dinero de caja chica'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsFormModalOpen(false)} 
                className={`p-1 rounded-lg ${T.btnGhost} text-slate-400 hover:text-rose-500`}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="space-y-3">
              {/* Monto y Selector de Moneda */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Monto del Gasto *
                </label>
                <div className="flex items-center gap-1.5">
                  <div className={`flex-1 flex items-center px-3 py-2 rounded-xl ${T.inputBg} border ${T.border}`}>
                    <span className="text-rose-500 font-bold text-sm mr-1.5">
                      {currency === 'USD' ? '$' : 'Bs'}
                    </span>
                    <input 
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className={`bg-transparent flex-1 text-sm font-black ${T.textPrimary} outline-none`}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="flex rounded-xl p-1 bg-slate-800 text-xs font-black">
                    <button
                      type="button"
                      onClick={() => setCurrency('USD')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${currency === 'USD' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                    >
                      USD
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrency('VES')}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${currency === 'VES' || currency === 'BS' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
                    >
                      Bs (VES)
                    </button>
                  </div>
                </div>
                {/* Equivalencia en tiempo real */}
                {parseFloat(amount) > 0 && (
                  <p className={`text-[10px] ${T.textMuted} text-right mt-1`}>
                    ≈ {currency === 'USD' 
                      ? `Bs. ${(parseFloat(amount) * exchangeRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` 
                      : `$ ${(parseFloat(amount) / exchangeRate).toFixed(2)} USD`}
                  </p>
                )}
              </div>

              {/* Concepto / Motivo */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Concepto / Motivo *
                </label>
                <input 
                  type="text"
                  placeholder="Ej. Compra de bolsas, hielo, flete..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-bold outline-none`}
                  required
                />
              </div>

              {/* Categoría */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Categoría
                </label>
                <select 
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-bold outline-none cursor-pointer`}
                >
                  <option value="Operativo">Operativo</option>
                  <option value="Suministros">Suministros & Empaque</option>
                  <option value="Transporte">Transporte / Flete</option>
                  <option value="Alimentación">Refrigerio / Alimentación</option>
                  <option value="Servicios">Servicios Básicos</option>
                  <option value="Nómina">Nómina / Adelanto</option>
                  <option value="Mantenimiento">Mantenimiento & Reparación</option>
                  <option value="Varios">Varios</option>
                </select>
              </div>

              {/* Forma de Egreso */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Forma de Egreso
                </label>
                <select 
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-bold outline-none cursor-pointer`}
                >
                  <option value="Efectivo USD">Efectivo USD</option>
                  <option value="Efectivo Bs">Efectivo Bs</option>
                  <option value="Pago Móvil">Pago Móvil</option>
                  <option value="Punto de Venta">Punto de Venta / Tarjeta</option>
                  <option value="Zelle">Zelle</option>
                  <option value="Transferencia">Transferencia Bancaria</option>
                </select>
              </div>

              {/* Notas opcionales */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Notas u Observaciones
                </label>
                <input 
                  type="text"
                  placeholder="Nº de factura, proveedor, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-medium outline-none`}
                />
              </div>

              {/* Botones Guardar / Cancelar */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className={`flex-1 min-h-[40px] rounded-lg ${T.btnGhost} font-semibold text-xs uppercase transition-colors`}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex-1 min-h-[40px] ${editingExpense ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'} text-white font-semibold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95`}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      <span>{editingExpense ? 'Guardar Cambios' : 'Registrar Gasto'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. MODAL: DETALLE / FICHA DE COMPROBANTE DE GASTO */}
      {detailExpense && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm ${T.modalCard} rounded-xl p-5 shadow-2xl space-y-4 max-h-[92dvh] overflow-y-auto custom-scrollbar`}>
            {/* Header del comprobante */}
            <div className={`flex items-start justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                  <Receipt size={22} />
                </div>
                <div>
                  <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary}`}>
                    Comprobante de Egreso
                  </h3>
                  <p className={`text-[10px] font-mono ${T.textMuted}`}>
                    ID: {detailExpense.id}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setDetailExpense(null)} 
                className={`p-1 rounded-lg ${T.btnGhost} text-slate-400 hover:text-rose-500`}
              >
                <X size={18} />
              </button>
            </div>

            {/* Monto Principal */}
            {(() => {
              const rawAmt = Number(detailExpense.amount ?? detailExpense.monto ?? 0) || 0;
              const cur = String(detailExpense.currency || 'USD').toUpperCase();
              const isVes = cur === 'BS' || cur === 'VES' || cur === 'BS.';
              const rate = Number(detailExpense.exchangeRate || exchangeRate) || 1;
              const isAlreadyUsdNormalized = detailExpense.status !== 'pending_sync' && isVes && detailExpense.nativeAmount;
              const usdVal = isAlreadyUsdNormalized ? rawAmt : (isVes ? (rawAmt / rate) : rawAmt);
              const bsVal = detailExpense.nativeAmount
                ? Number(detailExpense.nativeAmount)
                : (isVes ? rawAmt : (rawAmt * rate));
              return (
                <div className={`p-4 rounded-xl ${T.ticketItemBg} border ${T.border} text-center space-y-1`}>
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase tracking-wider block`}>
                    Monto Erogado
                  </span>
                  <div className="text-2xl font-bold text-rose-500">
                    -${usdVal.toFixed(2)} USD
                  </div>
                  <div className={`text-xs font-semibold ${T.textSecondary}`}>
                    ≈ Bs. {bsVal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              );
            })()}

            {/* Datos detallados */}
            <div className={`p-3.5 rounded-xl ${T.ticketItemBg} border ${T.border} space-y-2.5 text-xs`}>
              <div>
                <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Concepto</span>
                <span className={`font-bold ${T.textPrimary}`}>
                  {detailExpense.description || detailExpense.concepto}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/20">
                <div>
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Categoría</span>
                  <span className="font-bold text-rose-500">
                    {detailExpense.category || detailExpense.categoria || 'Operativo'}
                  </span>
                </div>
                <div>
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Forma de Egreso</span>
                  <span className={`font-bold ${T.textPrimary}`}>
                    {detailExpense.paymentMethod || 'Efectivo'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/20">
                <div>
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Fecha y Hora</span>
                  <span className={`font-mono text-[11px] ${T.textSecondary}`}>
                    {new Date(detailExpense.date || detailExpense.createdAt || Date.now()).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <div>
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Registrado Por</span>
                  <span className={`font-bold text-[11px] ${T.textPrimary}`}>
                    {detailExpense.registeredBy || 'Cajero'}
                  </span>
                </div>
              </div>

              {detailExpense.notes && (
                <div className="pt-2 border-t border-slate-700/20">
                  <span className={`text-[10px] font-bold ${T.textMuted} uppercase block`}>Notas Adicionales</span>
                  <p className={`text-[11px] ${T.textSecondary}`}>
                    {detailExpense.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Acciones dentro de la ficha */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => {
                  handleOpenEdit(detailExpense);
                  setDetailExpense(null);
                }}
                className={`min-h-[40px] rounded-lg ${T.btnGhost} text-amber-500 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer`}
              >
                <Edit2 size={14} />
                <span>Editar Gasto</span>
              </button>

              <button
                onClick={() => {
                  handleRequestDelete(detailExpense);
                  setDetailExpense(null);
                }}
                className={`min-h-[40px] rounded-lg ${T.btnGhost} text-rose-500 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer`}
              >
                <Trash2 size={14} />
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL: CONFIRMACIÓN DE ELIMINACIÓN */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/85 z-60 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm ${T.modalCard} rounded-xl p-5 shadow-2xl space-y-4 border border-rose-500/40`}>
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-rose-500/20 text-rose-500">
                <Trash2 size={24} />
              </div>

              <h3 className={`font-bold text-base ${T.textPrimary}`}>
                ¿Eliminar Gasto?
              </h3>

              <p className={`text-xs ${T.textSecondary} leading-relaxed`}>
                {deleteConfirm.message}
              </p>

              <div className={`w-full p-2.5 rounded-lg ${T.ticketItemBg} text-xs font-mono font-bold text-rose-500`}>
                {deleteConfirm.expense?.description || deleteConfirm.expense?.concepto} (${Number(deleteConfirm.expense?.amount || deleteConfirm.expense?.monto || 0).toFixed(2)})
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
                className={`flex-1 min-h-[40px] rounded-lg ${T.btnGhost} font-semibold text-xs transition-colors`}
              >
                Cancelar
              </button>

              <button
                onClick={handleExecuteDelete}
                disabled={isDeleting}
                className="flex-1 min-h-[40px] rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-colors cursor-pointer"
              >
                {isDeleting ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Sí, Eliminar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
