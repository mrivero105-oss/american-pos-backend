import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Utensils, Check, MessageSquare } from 'lucide-react';

const QUICK_NOTES = [
  'Sin cebolla',
  'Término medio',
  'Bien cocido',
  'Sin picante',
  'Sin salsa',
  'Para llevar',
  'Con hielo',
  'Urgente',
  'Sin sal',
  'Cubiertos extra'
];

const SPECIAL_LOCATIONS = [
  'Barra 1',
  'Barra 2',
  'Terraza 1',
  'Terraza 2',
  'Para Llevar',
  'Delivery'
];

export default function MobileTableSelectModal({
  isOpen,
  onClose,
  currentTable,
  currentNotes = '',
  onSave,
  T,
  triggerHaptic = () => {}
}) {
  const [selectedTable, setSelectedTable] = useState(currentTable || '');
  const [notes, setNotes] = useState(currentNotes || '');

  // Generar 24 mesas estándar
  const tables = Array.from({ length: 24 }, (_, i) => `Mesa ${i + 1}`);

  const handleSelectTable = (tbl) => {
    triggerHaptic(15);
    setSelectedTable(prev => (prev === tbl ? '' : tbl));
  };

  const handleAddQuickNote = (noteText) => {
    triggerHaptic(10);
    setNotes(prev => {
      const clean = (prev || '').trim();
      if (!clean) return noteText;
      if (clean.includes(noteText)) return clean;
      return `${clean}, ${noteText}`;
    });
  };

  const handleConfirm = () => {
    triggerHaptic(20);
    onSave({ table: selectedTable || null, notes: notes.trim() });
    onClose();
  };

  const handleClear = () => {
    triggerHaptic(15);
    setSelectedTable('');
    setNotes('');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 animate-fadeIn">
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className={`w-full max-w-lg ${T.modalCard} rounded-t-2xl sm:rounded-2xl border ${T.border} shadow-2xl flex flex-col max-h-[88dvh] overflow-hidden`}
          >
            {/* Header */}
            <div className={`px-4 py-3 border-b ${T.border} flex items-center justify-between shrink-0`}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center justify-center">
                  <Utensils size={16} />
                </div>
                <div>
                  <h3 className={`text-sm font-black ${T.textPrimary}`}>
                    Mesa y Notas de Comanda
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    {selectedTable ? `Seleccionada: ${selectedTable}` : 'Sin mesa asignada (Preventa libre)'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {(selectedTable || notes) && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-[11px] font-bold text-rose-500 hover:text-rose-400 px-2 py-1 rounded-md active:scale-95 cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className={`p-1.5 rounded-lg ${T.btnGhost} cursor-pointer active:scale-95`}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Contenido scrolleable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {/* Secciones especiales */}
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-2">
                  Áreas Especiales y Modos
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {SPECIAL_LOCATIONS.map(loc => {
                    const isSelected = selectedTable === loc;
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => handleSelectTable(loc)}
                        className={`py-2 px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border flex items-center justify-center gap-1.5 active:scale-95 ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-black'
                            : `${T.subPanelBg} ${T.textPrimary} border-slate-700/40 hover:border-slate-500`
                        }`}
                      >
                        {isSelected && <Check size={12} className="stroke-[3]" />}
                        <span>{loc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cuadrícula de Mesas 1 al 24 */}
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-2">
                  Mesas (1 al 24)
                </span>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {tables.map(tbl => {
                    const isSelected = selectedTable === tbl;
                    const num = tbl.replace('Mesa ', '');
                    return (
                      <button
                        key={tbl}
                        type="button"
                        onClick={() => handleSelectTable(tbl)}
                        className={`h-12 rounded-xl text-xs font-extrabold transition-all cursor-pointer border flex flex-col items-center justify-center active:scale-95 ${
                          isSelected
                            ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-500/20 font-black scale-105'
                            : `${T.subPanelBg} ${T.textPrimary} border-slate-700/40 hover:border-slate-500`
                        }`}
                      >
                        <span className="text-[9px] font-mono opacity-60 uppercase">Mesa</span>
                        <span className="text-sm font-black leading-none">{num}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notas de Cocina y Preparación */}
              <div className="pt-2 border-t border-slate-700/30">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-2 flex items-center gap-1.5">
                  <MessageSquare size={12} className="text-amber-400" />
                  Notas Rápidas para Cocina / Barra
                </span>

                {/* Chips rápidos */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {QUICK_NOTES.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleAddQuickNote(chip)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold cursor-pointer active:scale-95 transition-colors"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                {/* Input de nota personalizada */}
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Instrucciones adicionales para la cocina o despacho..."
                  rows={2}
                  className={`w-full p-2.5 rounded-xl border ${T.border} ${T.subPanelBg} ${T.textPrimary} text-xs outline-none focus:border-amber-500 transition-colors resize-none`}
                />
              </div>
            </div>

            {/* Footer de Confirmación */}
            <div className={`p-3 border-t ${T.border} ${T.subPanelBg} flex gap-2 shrink-0`}>
              <button
                type="button"
                onClick={onClose}
                className={`flex-1 py-2.5 rounded-xl border ${T.btnGhost} font-bold text-xs cursor-pointer active:scale-95`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider cursor-pointer active:scale-95 shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5"
              >
                <Check size={14} className="stroke-[3]" />
                <span>Aplicar a la Orden</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
