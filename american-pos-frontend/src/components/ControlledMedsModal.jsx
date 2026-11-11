import { useState } from 'react';
import BaseModal from './BaseModal';

export default function ControlledMedsModal({ isOpen, product, onClose, onConfirm }) {
  const [cedula, setCedula] = useState('');
  const [colegiatura, setColegiatura] = useState('');
  const [medico, setMedico] = useState('');
  const [error, setError] = useState('');

  if (!product) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!cedula.trim() || !colegiatura.trim() || !medico.trim()) {
      setError('Por favor complete todos los datos obligatorios del récipe.');
      return;
    }
    setError('');
    onConfirm({
      cedula_paciente: cedula.trim(),
      nro_colegiatura: colegiatura.trim(),
      nombre_medico: medico.trim()
    });
    setCedula('');
    setColegiatura('');
    setMedico('');
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-md"
      className="p-6 overflow-y-auto custom-scrollbar bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
    >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/60 flex items-center justify-center text-purple-600 dark:text-purple-400 font-black text-xl">
            💊
          </div>
          <div>
            <h3 className="font-black text-lg text-slate-900 dark:text-white leading-tight">
              Medicamento Controlado
            </h3>
            <p className="text-xs font-semibold text-purple-600 dark:text-purple-400">
              Requiere validación de récipe médico
            </p>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl mb-5 border border-slate-200 dark:border-slate-700">
          <span className="font-bold text-sm text-slate-900 dark:text-white block truncate">
            {product.nombre}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Precio: ${Number(product.precio).toFixed(2)} | Stock: {product.stock_total}
          </span>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 rounded-xl text-xs font-bold border border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
              Cédula / ID del Paciente *
            </label>
            <input
              type="text"
              required
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              placeholder="Ej. V-12345678"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
              Nro. Colegiatura / MPPS del Médico *
            </label>
            <input
              type="text"
              required
              value={colegiatura}
              onChange={(e) => setColegiatura(e.target.value)}
              placeholder="Ej. CMP-54321"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
              Nombre del Médico *
            </label>
            <input
              type="text"
              required
              value={medico}
              onChange={(e) => setMedico(e.target.value)}
              placeholder="Ej. Dr. Juan Pérez"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-sm shadow-lg shadow-purple-500/25 transition-colors"
            >
              Autorizar y Agregar
            </button>
          </div>
        </form>
    </BaseModal>
  );
}
