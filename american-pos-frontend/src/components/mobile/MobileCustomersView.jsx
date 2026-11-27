import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, 
  Users, 
  Search, 
  UserPlus, 
  Phone, 
  MessageSquare, 
  X, 
  Check, 
  Save, 
  RefreshCw, 
  Edit2, 
  Trash2, 
  Eye, 
  Star, 
  AlertTriangle, 
  Mail, 
  MapPin, 
  FileText, 
  Archive,
  Clock
} from 'lucide-react';
import api from '../../services/api';
import { db as primaryDb } from '../../services/db';
import localDb from '../../db/localDb';
import { VoiceMicButton } from '../../utils/voiceSearch';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';
import { useOfflineQueueCounts } from '../../hooks/useOfflineQueueCounts';
import VirtualMobileList from './VirtualMobileList';

const stripAccents = (str = '') => String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function MobileCustomersView({
  onSelectCustomerForSale,
  T,
  onBackToPOS,
  onOpenSyncCenter = null,
  showToast
}) {
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'debt' | 'credit' | 'vip' | 'inactive'
  const [isLoading, setIsLoading] = useState(false);
  const { counts: offlineCounts } = useOfflineQueueCounts();

  // Modal para Crear / Editar Cliente
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    handleFieldFocusCapture,
    handleFormKeyDown
  } = useMobileKeyboardViewport({ enabled: isFormModalOpen });
  const [editingCustomer, setEditingCustomer] = useState(null); // null = Crear, obj = Editar
  const [formData, setFormData] = useState({
    name: '',
    idDocument: '',
    phone: '',
    email: '',
    address: '',
    creditLimit: '',
    isVIP: false,
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de Detalles / Ficha del Cliente
  const [detailCustomer, setDetailCustomer] = useState(null);

  // Modal de Confirmación de Eliminación / Archivo
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { customer, isDependencyError, message }
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/customers?limit=200', { timeout: 4000 });
      const raw = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
      if (raw.length > 0) {
        setCustomers(raw);
        try {
          if (localDb && localDb.customers) {
            localDb.customers.bulkPut(raw).catch(() => {});
          }
        } catch (caughtErr) { console.warn('[MobileCustomersView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
        setIsLoading(false);
        return;
      }
    } catch (_netErr) {
      console.warn('Conexión al servidor falló, leyendo clientes locales...');
    }

    try {
      if (localDb && localDb.customers) {
        const localList = await localDb.customers.toArray();
        if (localList && localList.length > 0) {
          setCustomers(localList);
        }
      }
    } catch (caughtErr) { console.warn('[MobileCustomersView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
    setIsLoading(false);
  };

  // Contadores para pestañas
  const counts = useMemo(() => {
    let debt = 0;
    let credit = 0;
    let vip = 0;
    let inactive = 0;
    customers.forEach(c => {
      const bal = Number(c.balance || c.saldo || c.creditBalance || 0);
      const lim = Number(c.creditLimit || c.limite_credito || 0);
      if (bal > 0) debt++;
      if (lim > 0) credit++;
      if (c.isVIP) vip++;
      if (c.isActive === false) inactive++;
    });
    return {
      all: customers.filter(c => c.isActive !== false).length,
      debt,
      credit,
      vip,
      inactive
    };
  }, [customers]);

  // Lista filtrada
  const filteredCustomers = useMemo(() => {
    let list = customers;

    if (activeTab === 'debt') {
      list = list.filter(c => Number(c.balance || c.saldo || c.creditBalance || 0) > 0);
    } else if (activeTab === 'credit') {
      list = list.filter(c => Number(c.creditLimit || c.limite_credito || 0) > 0);
    } else if (activeTab === 'vip') {
      list = list.filter(c => Boolean(c.isVIP));
    } else if (activeTab === 'inactive') {
      list = list.filter(c => c.isActive === false);
    } else {
      if (!searchQuery.trim()) {
        list = list.filter(c => c.isActive !== false);
      }
    }

    const rawQ = searchQuery.trim();
    if (!rawQ) return list;
    const q = stripAccents(rawQ);
    const qDigits = rawQ.replace(/\D/g, '');
    const qAlphanum = rawQ.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    return list.filter(c => {
      const name = stripAccents(c.name || c.nombre || '');
      const rawDoc = String(c.idDocument || c.document || c.cedula || c.rif || '');
      const doc = stripAccents(rawDoc);
      const docDigits = rawDoc.replace(/\D/g, '');
      const docAlphanum = rawDoc.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const phone = stripAccents(c.phone || c.telefono || '');
      const phoneDigits = String(c.phone || c.telefono || '').replace(/\D/g, '');
      const email = stripAccents(c.email || '');

      if (name.includes(q) || doc.includes(q) || phone.includes(q) || email.includes(q)) return true;
      if (qDigits.length >= 3 && docDigits.includes(qDigits)) return true;
      if (qAlphanum.length >= 3 && docAlphanum.includes(qAlphanum)) return true;
      if (qDigits.length >= 4 && phoneDigits.includes(qDigits)) return true;

      return false;
    });
  }, [customers, searchQuery, activeTab]);

  // Abrir modal para Crear
  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      idDocument: '',
      phone: '',
      email: '',
      address: '',
      creditLimit: '',
      isVIP: false,
      notes: ''
    });
    setIsFormModalOpen(true);
  };

  // Abrir modal para Editar
  const handleOpenEdit = (cust) => {
    setEditingCustomer(cust);
    setFormData({
      name: cust.name || cust.nombre || '',
      idDocument: cust.idDocument || cust.document || cust.cedula || cust.rif || '',
      phone: cust.phone || cust.telefono || '',
      email: cust.email || '',
      address: cust.address || cust.direccion || '',
      creditLimit: cust.creditLimit !== undefined ? String(cust.creditLimit) : '',
      isVIP: Boolean(cust.isVIP),
      notes: cust.notes || ''
    });
    setIsFormModalOpen(true);
  };

  // Guardar (Crear o Editar)
  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showToast?.('Ingresa el nombre del cliente');
      return;
    }

    setIsSubmitting(true);
    const payload = {
      name: formData.name.trim(),
      idDocument: formData.idDocument.trim() || 'V-00000000',
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      address: formData.address.trim(),
      creditLimit: parseFloat(formData.creditLimit) || 0,
      isVIP: Boolean(formData.isVIP),
      notes: formData.notes.trim()
    };

    if (editingCustomer) {
      // ACTUALIZAR
      try {
        const res = await api.put(`/customers/${editingCustomer.id}`, payload, { timeout: 4000 });
        const updated = res.data?.customer || { ...editingCustomer, ...payload };
        setCustomers(prev => prev.map(c => c.id === editingCustomer.id ? { ...c, ...updated } : c));
        try {
          if (localDb && localDb.customers) {
            await localDb.customers.put({ ...editingCustomer, ...updated });
          }
        } catch (caughtErr) { console.warn('[MobileCustomersView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
        showToast?.(`✅ Cliente "${payload.name}" actualizado`);
        setIsFormModalOpen(false);
        if (detailCustomer?.id === editingCustomer.id) {
          setDetailCustomer(prev => ({ ...prev, ...updated }));
        }
      } catch (err) {
        const httpStatus = err?.response?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          showToast?.(`⚠️ ${err.response?.data?.error || 'No se pudo actualizar el cliente'}`);
          return;
        }
        console.warn('Fallo al actualizar en el servidor, guardando local:', err);
        const updated = { ...editingCustomer, ...payload, updatedAt: new Date().toISOString() };
        setCustomers(prev => prev.map(c => c.id === editingCustomer.id ? updated : c));
        try {
          if (localDb && localDb.customers) {
            await localDb.customers.put(updated);
          }
          await primaryDb.put('syncQueue', {
            id: `cust_update_${Date.now()}`,
            endpoint: `/customers/${editingCustomer.id}`,
            method: 'PUT',
            payload,
            createdAt: new Date().toISOString()
          });
        } catch (caughtErr) { console.warn('[MobileCustomersView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
        showToast?.(`⚡ Cliente actualizado offline`);
        setIsFormModalOpen(false);
        if (detailCustomer?.id === editingCustomer.id) {
          setDetailCustomer(prev => ({ ...prev, ...updated }));
        }
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // CREAR
      const tempCustId = `cust_off_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const newCust = {
        id: tempCustId,
        ...payload,
        creditBalance: 0,
        balance: 0,
        loyaltyPoints: 0,
        isActive: true,
        status: 'offline_queued',
        createdAt: new Date().toISOString()
      };

      try {
        const res = await api.post('/customers', payload, { timeout: 4000 });
        const created = res.data?.customer || res.data || newCust;
        setCustomers(prev => [created, ...prev]);
        try {
          if (localDb && localDb.customers) {
            await localDb.customers.put({ ...created, status: 'synced' });
          }
        } catch (caughtErr) { console.warn('[MobileCustomersView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
        showToast?.(`✅ Cliente "${payload.name}" registrado`);
        setIsFormModalOpen(false);
      } catch (_netErr) {
        const httpStatus = _netErr?.response?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          showToast?.(`⚠️ ${_netErr.response?.data?.error || 'Datos de cliente inválidos'}`);
          return;
        }
        console.warn('Servidor inaccesible, guardando cliente en base local:', _netErr);
        setCustomers(prev => [newCust, ...prev]);
        try {
          if (localDb && localDb.customers) {
            await localDb.customers.put(newCust);
          }
          await primaryDb.put('syncQueue', {
            id: `cust_create_${Date.now()}`,
            tempLocalId: tempCustId,
            endpoint: '/customers',
            method: 'POST',
            payload: { ...payload, id: tempCustId },
            createdAt: new Date().toISOString()
          });
        } catch (caughtErr) { console.warn('[MobileCustomersView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
        showToast?.(`⚡ Cliente guardado offline`);
        setIsFormModalOpen(false);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Solicitar eliminación
  const handleRequestDelete = (cust) => {
    setDeleteConfirm({
      customer: cust,
      isDependencyError: false,
      message: `¿Estás seguro de que deseas eliminar permanentemente al cliente "${cust.name || cust.nombre}"?`
    });
  };

  // Ejecutar eliminación física
  const handleExecuteDelete = async () => {
    if (!deleteConfirm?.customer) return;
    const cust = deleteConfirm.customer;
    setIsDeleting(true);

    try {
      await api.delete(`/customers/${cust.id}`, { timeout: 4000 });
      setCustomers(prev => prev.filter(c => c.id !== cust.id));
      try {
        if (localDb && localDb.customers) {
          await localDb.customers.delete(cust.id);
        }
      } catch (caughtErr) { console.warn('[MobileCustomersView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
      showToast?.(`✅ Cliente "${cust.name || cust.nombre}" eliminado`);
      setDeleteConfirm(null);
      if (detailCustomer?.id === cust.id) setDetailCustomer(null);
    } catch (error) {
      console.error('Error al eliminar cliente:', error);
      if (error.response?.status === 409 && error.response?.data?.code === 'ENTITY_HAS_DEPENDENCIES') {
        // Tiene historial de ventas o créditos, ofrecer archivar/inactivar
        setDeleteConfirm({
          customer: cust,
          isDependencyError: true,
          message: 'Este cliente tiene facturas, ventas o registros contables asociados y no puede borrarse físicamente por seguridad contable. ¿Deseas archivarlo e inactivarlo para que no aparezca en ventas?'
        });
      } else if (error.response?.status === 403) {
        showToast?.('⚠️ Se requieren permisos de Administrador para eliminar clientes');
        setDeleteConfirm(null);
      } else {
        const msg = error.response?.data?.error || error.response?.data?.message || 'Error al eliminar cliente';
        showToast?.(`❌ ${msg}`);
        setDeleteConfirm(null);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Archivar / Inactivar cliente
  const handleArchiveCustomer = async () => {
    if (!deleteConfirm?.customer) return;
    const cust = deleteConfirm.customer;
    setIsDeleting(true);

    try {
      await api.put(`/customers/${cust.id}`, { isActive: false });
      setCustomers(prev => prev.map(c => c.id === cust.id ? { ...c, isActive: false } : c));
      showToast?.(`📁 Cliente "${cust.name || cust.nombre}" archivado e inactivado`);
      setDeleteConfirm(null);
      if (detailCustomer?.id === cust.id) setDetailCustomer(null);
    } catch (err) {
      console.warn('[MobileCustomersView] Error capturado en operación:', err?.message || err);
      showToast?.('❌ Error al archivar cliente');
    } finally {
      setIsDeleting(false);
    }
  };

  // Reactivar cliente archivado
  const handleReactivateCustomer = async (cust) => {
    try {
      await api.put(`/customers/${cust.id}`, { isActive: true });
      setCustomers(prev => prev.map(c => c.id === cust.id ? { ...c, isActive: true } : c));
      showToast?.(`✅ Cliente "${cust.name || cust.nombre}" reactivado`);
      if (detailCustomer?.id === cust.id) {
        setDetailCustomer(prev => ({ ...prev, isActive: true }));
      }
    } catch (err) {
      console.warn('[MobileCustomersView] Error capturado en operación:', err?.message || err);
      showToast?.('❌ Error al reactivar cliente');
    }
  };

  return (
    <div className={`flex flex-col h-full ${T.cardBg} animate-fadeIn`}>
      {/* 1. HEADER PRINCIPAL */}
      <div className={`p-3 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg || T.cardBg}`}>
        <div className="flex items-center gap-2">
          <button 
            onClick={onBackToPOS}
            className={`p-1.5 rounded-xl ${T.btnGhost} flex items-center gap-1 text-xs font-bold`}
            title="Volver a Terminal POS"
          >
            <ArrowLeft size={16} />
            <span className="hidden xs:inline">POS</span>
          </button>
          <div>
            <h2 className={`font-black text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5`}>
              <Users size={16} className="text-blue-500 shrink-0" />
              <span>Clientes</span>
            </h2>
            <p className={`text-[10px] ${T.textMuted}`}>{customers.length} registrados</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {offlineCounts.customers > 0 && (
            <button
              type="button"
              onClick={() => onOpenSyncCenter?.()}
              className="px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-500 text-[10px] font-black flex items-center gap-1 cursor-pointer active:scale-95"
              title="Clientes pendientes por sincronizar"
            >
              <Clock size={11} />
              <span>{offlineCounts.customers} pend.</span>
            </button>
          )}
          <button
            onClick={handleOpenCreate}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <UserPlus size={14} />
            <span>+ Nuevo</span>
          </button>
        </div>
      </div>

      {/* 2. BUSCADOR */}
      <div className={`p-2.5 border-b ${T.border} shrink-0 ${T.subPanelBg || T.cardBg} space-y-2`}>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${T.inputBg} border ${T.border}`}>
          <Search size={14} className={T.textMuted} />
          <input 
            type="text"
            enterKeyHint="search"
            placeholder="Buscar o dictar nombre, cédula, teléfono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`bg-transparent flex-1 text-base sm:text-sm outline-none ${T.textPrimary} font-medium`}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className={T.textMuted}>
              <X size={13} />
            </button>
          )}
          <VoiceMicButton
            size={14}
            prompt="Di el nombre o cédula del cliente..."
            onResult={(spokenText) => setSearchQuery(spokenText)}
            onError={(errMsg) => showToast?.(`🎤 ${errMsg}`)}
          />
        </div>

        {/* PESTAÑAS DE FILTRO */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${
              activeTab === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : `${T.btnGhost} ${T.textMuted}`
            }`}
          >
            Todos ({counts.all})
          </button>
          <button
            onClick={() => setActiveTab('debt')}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all flex items-center gap-1 ${
              activeTab === 'debt'
                ? 'bg-rose-600 text-white shadow-xs'
                : `${T.btnGhost} text-rose-500`
            }`}
          >
            <span>Con Deuda</span>
            <span className="text-[9.5px] opacity-80">({counts.debt})</span>
          </button>
          <button
            onClick={() => setActiveTab('credit')}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all flex items-center gap-1 ${
              activeTab === 'credit'
                ? 'bg-emerald-600 text-white shadow-xs'
                : `${T.btnGhost} text-emerald-500`
            }`}
          >
            <span>Con Crédito</span>
            <span className="text-[9.5px] opacity-80">({counts.credit})</span>
          </button>
          <button
            onClick={() => setActiveTab('vip')}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all flex items-center gap-1 ${
              activeTab === 'vip'
                ? 'bg-amber-500 text-white shadow-xs'
                : `${T.btnGhost} text-amber-500`
            }`}
          >
            <Star size={11} className={activeTab === 'vip' ? 'fill-current' : ''} />
            <span>VIP ({counts.vip})</span>
          </button>
          {counts.inactive > 0 && (
            <button
              onClick={() => setActiveTab('inactive')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${
                activeTab === 'inactive'
                  ? 'bg-slate-600 text-white shadow-xs'
                  : `${T.btnGhost} ${T.textMuted}`
              }`}
            >
              Inactivos ({counts.inactive})
            </button>
          )}
        </div>
      </div>

      {/* 3. LISTADO DE CLIENTES RESPONSIVO VIRTUALIZADO */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <RefreshCw size={24} className="animate-spin text-blue-500" />
          <p className={`text-xs font-bold ${T.textMuted}`}>Cargando clientes...</p>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
          <Users size={36} className={T.textMuted} />
          <p className={`font-bold text-xs sm:text-sm ${T.textPrimary}`}>
            {searchQuery ? 'No se encontraron clientes con esa búsqueda' : 'No hay clientes registrados en esta categoría'}
          </p>
          <p className={`text-[11px] ${T.textMuted}`}>
            Usa el botón &ldquo;+ Nuevo&rdquo; arriba para agregar un cliente
          </p>
        </div>
      ) : (
        <VirtualMobileList
          items={filteredCustomers}
          estimateSize={142}
          gap={10}
          columnsMd={2}
          columnsXl={3}
          className="flex-1"
          paddingClass="p-2.5 sm:p-3"
          getItemKey={(cust, idx) => cust.id || idx}
          renderItem={(cust) => {
            const doc = cust.idDocument || cust.document || cust.cedula || cust.rif || 'V-00000000';
            const phone = cust.phone || cust.telefono || '';
            const credit = Number(cust.creditLimit || cust.limite_credito || 0);
            const balance = Number(cust.balance || cust.saldo || cust.creditBalance || 0);
            const isInactive = cust.isActive === false;

            return (
              <div
                className={`${T.ticketItemBg} p-3 rounded-2xl border ${T.border} space-y-2.5 hover:border-blue-500/30 transition-all flex flex-col justify-between shadow-2xs`}
              >
                {/* Fila Superior: Nombre y Datos */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className={`font-black text-xs sm:text-sm ${T.textPrimary} truncate`}>
                        {cust.name || cust.nombre}
                      </h4>
                      {cust.isVIP && (
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-500 text-[9.5px] font-black flex items-center gap-0.5 shrink-0">
                          <Star size={9} className="fill-current" />
                          VIP
                        </span>
                      )}
                      {isInactive && (
                        <span className="px-1.5 py-0.5 rounded-md bg-slate-500/20 text-slate-400 text-[9px] font-bold shrink-0">
                          Inactivo
                        </span>
                      )}
                    </div>

                    <p className={`text-[11px] font-mono ${T.textMuted} truncate mt-0.5`}>
                      {doc} {phone ? `• ${phone}` : ''}
                    </p>

                    {cust.address && (
                      <p className={`text-[10px] ${T.textSecondary} truncate mt-0.5 flex items-center gap-1`}>
                        <MapPin size={10} className="shrink-0 text-slate-400" />
                        <span className="truncate">{cust.address}</span>
                      </p>
                    )}
                  </div>

                  {/* Resumen Financiero */}
                  {(credit > 0 || balance > 0) && (
                    <div className="text-right shrink-0">
                      {credit > 0 && (
                        <span className="text-[10px] text-emerald-500 font-extrabold block">
                          Crédito: ${credit.toFixed(2)}
                        </span>
                      )}
                      {balance > 0 && (
                        <span className="text-[10px] text-rose-500 font-black block">
                          Debe: ${balance.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Fila Inferior: Barra de Acciones Completas */}
                <div className={`pt-2 border-t ${T.border} flex items-center justify-between gap-1.5 flex-wrap`}>
                  {/* Botones de Gestión (Editar, Eliminar, Contacto, Ficha) */}
                  <div className="flex items-center gap-1">
                    {/* WhatsApp */}
                    {phone && (
                      <a
                        href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-xl bg-emerald-600/15 text-emerald-500 hover:bg-emerald-600/25 transition-all flex items-center justify-center"
                        title="Enviar WhatsApp"
                      >
                        <MessageSquare size={13} />
                      </a>
                    )}

                    {/* Llamar */}
                    {phone && (
                      <a
                        href={`tel:${phone}`}
                        className={`p-2 rounded-xl ${T.btnGhost} text-blue-500 hover:bg-blue-500/15 transition-all flex items-center justify-center`}
                        title="Llamar"
                      >
                        <Phone size={13} />
                      </a>
                    )}

                    {/* Editar */}
                    <button
                      onClick={() => handleOpenEdit(cust)}
                      className={`p-2 rounded-xl ${T.btnGhost} text-amber-500 hover:bg-amber-500/15 transition-all flex items-center justify-center cursor-pointer`}
                      title="Editar Datos del Cliente"
                    >
                      <Edit2 size={13} />
                    </button>

                    {/* Eliminar / Inactivar */}
                    <button
                      onClick={() => handleRequestDelete(cust)}
                      className={`p-2 rounded-xl ${T.btnGhost} text-rose-500 hover:bg-rose-500/15 transition-all flex items-center justify-center cursor-pointer`}
                      title="Eliminar Cliente"
                    >
                      <Trash2 size={13} />
                    </button>

                    {/* Ficha / Ver Más */}
                    <button
                      onClick={() => setDetailCustomer(cust)}
                      className={`p-2 rounded-xl ${T.btnGhost} ${T.textMuted} hover:text-blue-500 transition-all flex items-center justify-center cursor-pointer`}
                      title="Ver Ficha Completa"
                    >
                      <Eye size={13} />
                    </button>
                  </div>

                  {/* Botón Principal: Cobrar a este Cliente */}
                  {!isInactive ? (
                    <button
                      onClick={() => {
                        onSelectCustomerForSale?.({
                          name: cust.name || cust.nombre,
                          doc: doc
                        });
                        onBackToPOS?.();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs active:scale-95 transition-all cursor-pointer shadow-sm flex items-center gap-1 ml-auto"
                    >
                      <Check size={13} />
                      <span>Cobrar</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivateCustomer(cust)}
                      className="px-2.5 py-1 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-[11px] active:scale-95 transition-all cursor-pointer ml-auto"
                    >
                      Reactivar
                    </button>
                  )}
                </div>
              </div>
            );
          }}
        />
      )}

      {/* 4. MODAL: CREAR / EDITAR CLIENTE (COMPLETO Y RESPONSIVO) */}
      {isFormModalOpen && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4 backdrop-blur-xs animate-fadeIn overflow-y-auto"
          style={modalOverlayStyle}
        >
          <div
            className={`w-full max-w-md ${T.modalCard} rounded-2xl sm:rounded-xl p-4 sm:p-5 shadow-2xl space-y-3.5 max-h-[92dvh] overflow-y-auto custom-scrollbar my-auto`}
            style={modalCardMaxHeightStyle}
          >
            {/* Header del modal */}
            <div className={`flex items-center justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2">
                {editingCustomer ? (
                  <Edit2 size={18} className="text-amber-500 shrink-0" />
                ) : (
                  <UserPlus size={18} className="text-blue-500 shrink-0" />
                )}
                <div>
                  <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary}`}>
                    {editingCustomer ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}
                  </h3>
                  <p className={`text-[10px] ${T.textMuted}`}>
                    {editingCustomer ? `Modificando a ${editingCustomer.name || editingCustomer.nombre}` : 'Completa los datos del cliente'}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsFormModalOpen(false)} 
                className={`p-1 rounded-lg ${T.btnGhost} text-slate-400 hover:text-rose-500`}
              >
                <X size={18} />
              </button>
            </div>

            {/* Formulario */}
            <form
              onSubmit={handleSaveCustomer}
              onKeyDown={handleFormKeyDown}
              onFocusCapture={handleFieldFocusCapture}
              className="space-y-3"
            >
              {/* Nombre Completo */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Nombre Completo *
                </label>
                <input 
                  type="text"
                  enterKeyHint="next"
                  placeholder="Ej. Juan Pérez"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                  required
                />
              </div>

              {/* Cédula y Teléfono en 2 columnas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Cédula / RIF / NIT
                  </label>
                  <input 
                    type="text"
                    enterKeyHint="next"
                    placeholder="Ej. V-12345678"
                    value={formData.idDocument}
                    onChange={(e) => setFormData(prev => ({ ...prev, idDocument: e.target.value }))}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                  />
                </div>

                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Teléfono / WhatsApp
                  </label>
                  <input 
                    type="tel"
                    inputMode="tel"
                    enterKeyHint="next"
                    placeholder="Ej. 04241234567"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                  />
                </div>
              </div>

              {/* Correo Electrónico */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Correo Electrónico
                </label>
                <input 
                  type="email"
                  inputMode="email"
                  enterKeyHint="next"
                  placeholder="cliente@ejemplo.com"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-medium outline-none`}
                />
              </div>

              {/* Dirección */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Dirección
                </label>
                <input 
                  type="text"
                  enterKeyHint="next"
                  placeholder="Ej. Av. Principal, Local 4, Maturín"
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-medium outline-none`}
                />
              </div>

              {/* Límite de Crédito y VIP */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Límite de Crédito ($ USD)
                  </label>
                  <input 
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    value={formData.creditLimit}
                    onChange={(e) => setFormData(prev => ({ ...prev, creditLimit: e.target.value }))}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                  />
                </div>

                <div className={`p-2.5 rounded-xl border ${T.border} flex items-center justify-between gap-2`}>
                  <div className="flex items-center gap-1.5">
                    <Star size={14} className={formData.isVIP ? 'text-amber-500 fill-current' : T.textMuted} />
                    <span className={`text-xs font-extrabold ${T.textPrimary}`}>Cliente VIP</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={formData.isVIP}
                    onChange={(e) => setFormData(prev => ({ ...prev, isVIP: e.target.checked }))}
                    className="w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Notas u Observaciones */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Notas u Observaciones
                </label>
                <textarea 
                  rows={2}
                  placeholder="Detalles sobre el cliente, preferencias, etc."
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className={`w-full px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-medium outline-none resize-none`}
                />
              </div>

              {/* Botón de Guardar */}
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
                  className={`flex-1 min-h-[40px] ${editingCustomer ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'} text-white font-semibold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95`}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      <span>{editingCustomer ? 'Guardar Cambios' : 'Crear Cliente'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. MODAL: DETALLES / FICHA 360 DEL CLIENTE */}
      {detailCustomer && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-md ${T.modalCard} rounded-xl p-4 sm:p-5 shadow-2xl space-y-4 max-h-[92dvh] overflow-y-auto custom-scrollbar`}>
            {/* Header de la Ficha */}
            <div className={`flex items-start justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                  {(detailCustomer.name || detailCustomer.nombre || 'C').substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5`}>
                    <span>{detailCustomer.name || detailCustomer.nombre}</span>
                    {detailCustomer.isVIP && (
                      <Star size={12} className="text-amber-500 fill-current shrink-0" />
                    )}
                  </h3>
                  <p className={`text-[11px] font-mono ${T.textMuted}`}>
                    {detailCustomer.idDocument || detailCustomer.document || detailCustomer.cedula || detailCustomer.rif || 'Sin documento'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setDetailCustomer(null)}
                className={`p-1.5 rounded-lg ${T.btnGhost} text-slate-400 hover:text-rose-500`}
              >
                <X size={18} />
              </button>
            </div>

            {/* Resumen de Crédito y Puntos */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className={`p-3 rounded-2xl ${T.ticketItemBg} border ${T.border} space-y-1`}>
                <span className={`text-[10px] font-extrabold ${T.textMuted} uppercase block`}>
                  Límite de Crédito
                </span>
                <span className="text-sm font-black text-emerald-500 block">
                  ${Number(detailCustomer.creditLimit || detailCustomer.limite_credito || 0).toFixed(2)}
                </span>
              </div>
              <div className={`p-3 rounded-2xl ${T.ticketItemBg} border ${T.border} space-y-1`}>
                <span className={`text-[10px] font-extrabold ${T.textMuted} uppercase block`}>
                  Saldo Deudor
                </span>
                <span className="text-sm font-black text-rose-500 block">
                  ${Number(detailCustomer.balance || detailCustomer.saldo || detailCustomer.creditBalance || 0).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Datos de Contacto y Ubicación */}
            <div className={`p-3.5 rounded-2xl ${T.ticketItemBg} border ${T.border} space-y-2.5 text-xs`}>
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-blue-500 shrink-0" />
                <span className={T.textMuted}>Teléfono:</span>
                <span className={`font-bold ${T.textPrimary}`}>
                  {detailCustomer.phone || detailCustomer.telefono || 'No registrado'}
                </span>
              </div>

              {detailCustomer.email && (
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-purple-500 shrink-0" />
                  <span className={T.textMuted}>Email:</span>
                  <span className={`font-medium ${T.textPrimary} truncate`}>
                    {detailCustomer.email}
                  </span>
                </div>
              )}

              {detailCustomer.address && (
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="text-rose-500 shrink-0 mt-0.5" />
                  <span className={T.textMuted}>Dirección:</span>
                  <span className={`font-medium ${T.textPrimary} flex-1`}>
                    {detailCustomer.address}
                  </span>
                </div>
              )}

              {detailCustomer.notes && (
                <div className="flex items-start gap-2 pt-1 border-t border-slate-700/30">
                  <FileText size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <span className={T.textMuted}>Notas:</span>
                  <span className={`font-medium ${T.textSecondary} flex-1`}>
                    {detailCustomer.notes}
                  </span>
                </div>
              )}
            </div>

            {/* Botones de Acción dentro de la Ficha */}
            <div className="space-y-2 pt-1">
              <button
                onClick={() => {
                  onSelectCustomerForSale?.({
                    name: detailCustomer.name || detailCustomer.nombre,
                    doc: detailCustomer.idDocument || detailCustomer.cedula || 'V-00000000'
                  });
                  setDetailCustomer(null);
                  onBackToPOS?.();
                }}
                className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer"
              >
                <Check size={16} />
                <span>Cobrar a este Cliente en POS</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    handleOpenEdit(detailCustomer);
                    setDetailCustomer(null);
                  }}
                  className={`min-h-[40px] rounded-lg ${T.btnGhost} text-amber-500 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer`}
                >
                  <Edit2 size={14} />
                  <span>Editar Datos</span>
                </button>

                <button
                  onClick={() => {
                    handleRequestDelete(detailCustomer);
                    setDetailCustomer(null);
                  }}
                  className={`min-h-[40px] rounded-lg ${T.btnGhost} text-rose-500 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer`}
                >
                  <Trash2 size={14} />
                  <span>Eliminar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL: CONFIRMACIÓN DE ELIMINACIÓN / ARCHIVO */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/85 z-60 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm ${T.modalCard} rounded-xl p-5 shadow-2xl space-y-4 border ${deleteConfirm.isDependencyError ? 'border-amber-500/40' : 'border-rose-500/40'}`}>
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${deleteConfirm.isDependencyError ? 'bg-amber-500/20 text-amber-500' : 'bg-rose-500/20 text-rose-500'}`}>
                {deleteConfirm.isDependencyError ? (
                  <Archive size={26} />
                ) : (
                  <AlertTriangle size={26} />
                )}
              </div>

              <h3 className={`font-bold text-base ${T.textPrimary}`}>
                {deleteConfirm.isDependencyError ? 'Cliente con Movimientos' : '¿Eliminar Cliente?'}
              </h3>

              <p className={`text-xs ${T.textSecondary} leading-relaxed`}>
                {deleteConfirm.message}
              </p>

              <div className={`w-full p-2.5 rounded-lg ${T.ticketItemBg} text-xs font-mono font-bold ${T.textPrimary}`}>
                {deleteConfirm.customer?.name || deleteConfirm.customer?.nombre}
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

              {deleteConfirm.isDependencyError ? (
                <button
                  onClick={handleArchiveCustomer}
                  disabled={isDeleting}
                  className="flex-1 min-h-[40px] rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-colors cursor-pointer"
                >
                  {isDeleting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <>
                      <Archive size={14} />
                      <span>Inactivar</span>
                    </>
                  )}
                </button>
              ) : (
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
