import React, { useState } from 'react';
import { X, ShieldAlert, FileText, CheckCircle, User, Calendar, Hash } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MobileControlledMedModal({
  product,
  isOpen,
  onClose,
  onConfirm,
  T
}) {
  const [doctorName, setDoctorName] = useState('');
  const [patientDoc, setPatientDoc] = useState('');
  const [recipeNumber, setRecipeNumber] = useState('');
  const [recipeDate, setRecipeDate] = useState(() => new Date().toISOString().split('T')[0]);

  if (!isOpen || !product) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!doctorName.trim() || !patientDoc.trim() || !recipeNumber.trim()) {
      alert('Por favor complete todos los datos requeridos del récipe médico');
      return;
    }

    onConfirm({
      doctorName: doctorName.trim(),
      patientDoc: patientDoc.trim(),
      recipeNumber: recipeNumber.trim(),
      recipeDate: recipeDate
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/85 cursor-pointer"
      />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md ${T?.modalCard || 'bg-slate-900'} rounded-t-xl sm:rounded-xl p-4 sm:p-5 shadow-2xl relative z-10 border-t sm:border border-amber-500/40 max-h-[90vh] overflow-y-auto space-y-4`}
      >
        <div className="w-full flex justify-center pb-1 sm:hidden">
          <div className="w-12 h-1 rounded-full bg-slate-600" />
        </div>

        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-700/50 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
              <ShieldAlert size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white truncate">
                Medicamento Controlado
              </h3>
              <p className="text-[10px] text-amber-400 font-semibold truncate">
                Registro Obligatorio de Récipe (Ley de Farmacia)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Info del producto */}
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">
          <p className="font-bold text-xs text-white">{product.nombre || product.name}</p>
          {product.principio_activo && (
            <p className="text-[10px] text-amber-300 font-semibold">
              Principio Activo: {product.principio_activo}
            </p>
          )}
          <p className="text-[10px] text-slate-400">
            Este medicamento requiere registro de receta facultativa para auditoría sanitaria.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block mb-1">
              Médico Tratante / Especialista *
            </label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                required
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="Ej: Dr. Roberto Gómez (MPPS: 45892)"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs font-semibold text-white outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block mb-1">
                C.I. / RIF Paciente *
              </label>
              <input
                type="text"
                required
                value={patientDoc}
                onChange={(e) => setPatientDoc(e.target.value)}
                placeholder="V-12345678"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-white outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block mb-1">
                Nº de Récipe *
              </label>
              <input
                type="text"
                required
                value={recipeNumber}
                onChange={(e) => setRecipeNumber(e.target.value)}
                placeholder="R-98431"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-white outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block mb-1">
              Fecha de Emisión de Récipe
            </label>
            <input
              type="date"
              required
              value={recipeDate}
              onChange={(e) => setRecipeDate(e.target.value)}
              className="w-full bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-white outline-none focus:border-amber-500"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95 transition-colors mt-3"
          >
            <CheckCircle size={16} />
            <span>Validar Récipe y Continuar</span>
          </button>
        </form>
      </motion.div>
    </div>
  );
}
