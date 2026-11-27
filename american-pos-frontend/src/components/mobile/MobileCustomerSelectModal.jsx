import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Users, X, Search, CheckCircle, RefreshCw, UserPlus, User, Phone, Edit3 } from 'lucide-react';
import { VoiceMicButton } from '../../utils/voiceSearch';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';

export default function MobileCustomerSelectModal({
  isOpen,
  onClose,
  T,
  customers = [],
  customerName = 'Consumidor Final',
  isDollarCountry = false,
  isCreatingCustomerInMobile,
  setIsCreatingCustomerInMobile,
  customerSearch,
  setCustomerSearch,
  filteredCustomers,
  handleSelectExistingCustomer: handleSelectCustomer,
  newCustomerData: newCustomerForm,
  setNewCustomerData: setNewCustomerForm,
  handleCreateCustomerSubmit: handleSaveNewCustomer,
  isSavingCustomer,
  triggerHaptic = () => {}
}) {
  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    handleFieldFocusCapture,
    handleFormKeyDown
  } = useMobileKeyboardViewport({ enabled: isOpen });

  return (
    <AnimatePresence>
      {isOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-xs animate-fadeIn"
            style={modalOverlayStyle}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={`w-full max-w-md ${T.modalCard} rounded-t-xl sm:rounded-xl p-4 sm:p-5 shadow-2xl border ${T.border} space-y-3.5 max-h-[92dvh] flex flex-col`}
              style={modalCardMaxHeightStyle}
            >
              {/* Header del Modal */}
              <div className="flex items-center justify-between border-b pb-2.5 shrink-0">
                <div className="flex items-center gap-2">
                  {isCreatingCustomerInMobile ? (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(10);
                        setIsCreatingCustomerInMobile(false);
                      }}
                      className="p-1 rounded-xl hover:bg-slate-700/50 text-slate-300 cursor-pointer"
                    >
                      <ArrowLeft size={18} />
                    </button>
                  ) : (
                    <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                      <Users size={16} />
                    </div>
                  )}
                  <div>
                    <h3 className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>
                      {isCreatingCustomerInMobile ? (newCustomerForm?.id ? 'Editar Cliente' : 'Nuevo Cliente') : 'Seleccionar Cliente'}
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      {isCreatingCustomerInMobile 
                        ? (newCustomerForm?.id ? 'Modifica los datos del cliente y guarda cambios' : 'Registra datos y selecciona para la venta')
                        : `${filteredCustomers.length} de ${customers.length} clientes disponibles`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(10);
                    onClose()
                  }}
                  className="p-1.5 rounded-full text-slate-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {!isCreatingCustomerInMobile ? (
                /* VISTA A: BUSCADOR Y LISTA DE CLIENTES */
                <div className="flex-1 flex flex-col min-h-0 space-y-3">
                  {/* Botón Destacado: Añadir Nuevo Cliente */}
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      const rawSearch = customerSearch.trim();
                      const digitsOnly = rawSearch.replace(/\D/g, '');
                      const isDocLike = digitsOnly.length >= 5 && (!/[a-zA-Z]{3,}/.test(rawSearch) || /^[VJEG]-?\d+/i.test(rawSearch));

                      if (isDocLike) {
                        let pref = 'V-';
                        if (/^J/i.test(rawSearch)) pref = 'J-';
                        else if (/^E/i.test(rawSearch)) pref = 'E-';
                        else if (/^G/i.test(rawSearch)) pref = 'G-';

                        setNewCustomerForm({
                          name: '',
                          idDocument: isDollarCountry ? digitsOnly : `${pref}${digitsOnly}`,
                          phone: '',
                          address: '',
                          email: '',
                          creditLimit: '0'
                        });
                      } else {
                        setNewCustomerForm({
                          name: rawSearch,
                          idDocument: isDollarCountry ? '' : 'V-',
                          phone: '',
                          address: '',
                          email: '',
                          creditLimit: '0'
                        });
                      }
                      setIsCreatingCustomerInMobile(true);
                    }}
                    className="w-full py-2.5 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-emerald-600/30 active:scale-98 transition-all cursor-pointer shrink-0"
                  >
                    <UserPlus size={15} />
                    <span>➕ Añadir Nuevo Cliente</span>
                  </button>

                  {/* Pequeño Buscador de Cliente */}
                  <div className="relative shrink-0">
                    <Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${T.textMuted}`} />
                    <input
                      type="text"
                      enterKeyHint="search"
                      placeholder="Buscar o dictar nombre, cédula..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && filteredCustomers.length === 1) {
                          e.preventDefault();
                          handleSelectCustomer(filteredCustomers[0]);
                        }
                      }}
                      className={`w-full min-h-[44px] ${T.inputBg} border rounded-2xl pl-9 pr-14 py-2 text-base sm:text-sm font-bold outline-none focus:border-blue-500 transition-colors`}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                      {customerSearch && (
                        <button
                          type="button"
                          onClick={() => setCustomerSearch('')}
                          className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      )}
                      <VoiceMicButton
                        size={14}
                        prompt="Di el nombre o cédula del cliente..."
                        onResult={(spokenText) => setCustomerSearch(spokenText)}
                      />
                    </div>
                  </div>

                  {/* Opción Rápida: Consumidor Final */}
                  <div
                    onClick={() => handleSelectCustomer(null)}
                    className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between shrink-0 active:scale-98 ${
                      customerName === 'Consumidor Final'
                        ? 'bg-blue-600/15 border-blue-500/50 shadow-sm'
                        : `${T.ticketItemBg} ${T.border} hover:border-blue-500/30`
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-slate-500/15 text-slate-400 flex items-center justify-center shrink-0">
                        <User size={15} />
                      </div>
                      <div className="min-w-0">
                        <h4 className={`text-xs font-black ${T.textPrimary}`}>Consumidor Final</h4>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {isDollarCountry ? '0000000000' : 'V-00000000'} • Venta Rápida
                        </span>
                      </div>
                    </div>
                    {customerName === 'Consumidor Final' && (
                      <span className="text-[10px] font-black text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded-full border border-blue-500/30">
                        ✓ Activo
                      </span>
                    )}
                  </div>

                  {/* Lista con Scroll de Clientes */}
                  <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-0.5 min-h-[160px]">
                    {filteredCustomers.length === 0 ? (
                      <div className="py-8 text-center space-y-2">
                        <p className="text-xs text-slate-400">
                          No se encontraron clientes para <b className="text-white">&ldquo;{customerSearch}&rdquo;</b>
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(15);
                            const rawSearch = customerSearch.trim();
                            const digitsOnly = rawSearch.replace(/\D/g, '');
                            const isDocLike = digitsOnly.length >= 5 && (!/[a-zA-Z]{3,}/.test(rawSearch) || /^[VJEG]-?\d+/i.test(rawSearch));

                            if (isDocLike) {
                              let pref = 'V-';
                              if (/^J/i.test(rawSearch)) pref = 'J-';
                              else if (/^E/i.test(rawSearch)) pref = 'E-';
                              else if (/^G/i.test(rawSearch)) pref = 'G-';

                              setNewCustomerForm({
                                name: '',
                                idDocument: isDollarCountry ? digitsOnly : `${pref}${digitsOnly}`,
                                phone: '',
                                address: '',
                                email: '',
                                creditLimit: '0'
                              });
                            } else {
                              setNewCustomerForm({
                                name: rawSearch,
                                idDocument: isDollarCountry ? '' : 'V-',
                                phone: '',
                                address: '',
                                email: '',
                                creditLimit: '0'
                              });
                            }
                            setIsCreatingCustomerInMobile(true);
                          }}
                          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer shadow-sm active:scale-95 transition-all"
                        >
                          Crear cliente &ldquo;{customerSearch}&rdquo; ahora
                        </button>
                      </div>
                    ) : (
                      filteredCustomers.map((c) => {
                        const name = c.name || c.nombre || 'Cliente';
                        const doc = c.identification || c.idDocument || c.doc || c.rif;
                        const phone = c.phone || c.telefono;
                        const isSelected = customerName === name;
                        const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'CL';

                        return (
                          <div
                            key={c.id || `c_${name}`}
                            onClick={() => handleSelectCustomer(c)}
                            className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-98 ${
                              isSelected
                                ? 'bg-blue-600/20 border-blue-500 shadow-sm shadow-blue-500/10'
                                : `${T.ticketItemBg} ${T.border} hover:border-blue-500/30`
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-400 font-black text-xs flex items-center justify-center shrink-0 border border-blue-500/20">
                                {initials}
                              </div>
                              <div className="min-w-0 flex-1">
                                <h4 className={`text-xs font-bold ${T.textPrimary} truncate`}>
                                  {name}
                                </h4>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono truncate">
                                  {doc && <span>{doc}</span>}
                                  {phone && (
                                    <span className="flex items-center gap-0.5 text-emerald-400">
                                      <Phone size={10} /> {phone}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerHaptic(15);
                                  setNewCustomerForm({
                                    id: c.id,
                                    name: c.name || c.nombre || '',
                                    idDocument: c.identification || c.idDocument || c.doc || c.rif || '',
                                    phone: c.phone || c.telefono || '',
                                    address: c.address || c.direccion || '',
                                    email: c.email || '',
                                    creditLimit: String(c.creditLimit || c.limite_credito || '0')
                                  });
                                  setIsCreatingCustomerInMobile(true);
                                }}
                                className="p-1.5 rounded-xl hover:bg-slate-700/50 text-slate-400 hover:text-blue-400 cursor-pointer active:scale-90 transition-all"
                                title="Editar datos del cliente"
                              >
                                <Edit3 size={13} />
                              </button>

                              {isSelected ? (
                                <span className="text-[10px] font-black text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded-full border border-blue-500/30">
                                  ✓ Activo
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="text-[10px] text-slate-400 font-bold px-2 py-1 rounded-lg hover:text-white"
                                >
                                  Elegir
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                /* VISTA B: FORMULARIO AÑADIR NUEVO CLIENTE */
                <form
                  onSubmit={handleSaveNewCustomer}
                  onKeyDown={handleFormKeyDown}
                  onFocusCapture={handleFieldFocusCapture}
                  className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-0.5"
                >
                  {/* Nombre Completo */}
                  <div className="space-y-1">
                    <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      enterKeyHint="next"
                      required
                      placeholder="Ej: Manuel Rivero"
                      value={newCustomerForm.name}
                      onChange={(e) => setNewCustomerForm(prev => ({ ...prev, name: e.target.value }))}
                      autoFocus
                      className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl px-3 py-2 text-base sm:text-sm font-bold outline-none focus:border-blue-500`}
                    />
                  </div>

                  {/* Documento / Cédula / RIF */}
                  <div className="space-y-1">
                    <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                      C.I. / RIF / Pasaporte
                    </label>
                    <div className="flex gap-1.5">
                      {!isDollarCountry && (
                        <div className="flex gap-1 shrink-0">
                          {['V-', 'J-', 'E-', 'G-'].map(pfx => (
                            <button
                              key={pfx}
                              type="button"
                              onClick={() => {
                                const current = newCustomerForm.idDocument.replace(/^[VJEG]-/, '');
                                setNewCustomerForm(prev => ({ ...prev, idDocument: `${pfx}${current}` }));
                              }}
                              className={`px-2 py-1.5 rounded-lg text-[10px] font-black border transition-all cursor-pointer ${
                                newCustomerForm.idDocument.startsWith(pfx)
                                  ? 'bg-blue-600 text-white border-blue-500'
                                  : 'border-slate-700 text-slate-400 hover:text-white'
                              }`}
                            >
                              {pfx}
                            </button>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        enterKeyHint="next"
                        placeholder="Número de documento..."
                        value={newCustomerForm.idDocument}
                        onChange={(e) => setNewCustomerForm(prev => ({ ...prev, idDocument: e.target.value }))}
                        className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl px-3 py-2 text-base sm:text-sm font-bold outline-none focus:border-blue-500 font-mono`}
                      />
                    </div>
                  </div>

                  {/* Teléfono / WhatsApp */}
                  <div className="space-y-1">
                    <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                      Teléfono / WhatsApp
                    </label>
                    <div className="relative">
                      <Phone size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${T.textMuted}`} />
                      <input
                        type="tel"
                        inputMode="tel"
                        enterKeyHint="next"
                        placeholder="Ej: 0414 1234567"
                        value={newCustomerForm.phone}
                        onChange={(e) => setNewCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
                        className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl pl-8 pr-3 py-2 text-base sm:text-sm font-bold outline-none focus:border-emerald-500 font-mono`}
                      />
                    </div>
                    <span className="text-[9px] text-emerald-400 font-medium block">
                      Permite enviar el recibo de compra digital por WhatsApp
                    </span>
                  </div>

                  {/* Dirección */}
                  <div className="space-y-1">
                    <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                      Dirección (Opcional)
                    </label>
                    <input
                      type="text"
                      enterKeyHint="next"
                      placeholder="Ej: Av. Bolívar, Local 12"
                      value={newCustomerForm.address}
                      onChange={(e) => setNewCustomerForm(prev => ({ ...prev, address: e.target.value }))}
                      className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl px-3 py-2 text-base sm:text-sm font-bold outline-none focus:border-blue-500`}
                    />
                  </div>

                  {/* Límite de Crédito */}
                  <div className="space-y-1">
                    <label className={`text-[10px] font-black uppercase tracking-wider ${T.textSecondary} block`}>
                      Límite de Crédito ($ USD)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="done"
                      step="any"
                      placeholder="0.00"
                      value={newCustomerForm.creditLimit}
                      onChange={(e) => setNewCustomerForm(prev => ({ ...prev, creditLimit: e.target.value }))}
                      className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl px-3 py-2 text-base sm:text-sm font-bold outline-none focus:border-blue-500 font-mono`}
                    />
                  </div>

                  {/* Botones de Acción */}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingCustomerInMobile(false)}
                      className={`flex-1 py-2.5 rounded-xl border ${T.btnGhost} font-bold text-xs cursor-pointer active:scale-95`}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingCustomer || !newCustomerForm.name.trim()}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-emerald-600/30 active:scale-95 transition-all cursor-pointer"
                    >
                      {isSavingCustomer ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>Guardando...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle size={14} />
                          <span>{newCustomerForm?.id ? 'Guardar Cambios' : 'Guardar y Seleccionar'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}

    </AnimatePresence>
  );
}