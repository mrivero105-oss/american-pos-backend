import { useState, useEffect } from 'react';
import { Printer, X, ShieldCheck, FileText } from 'lucide-react';
import api from '../../services/api';

export default function ControlledMedsBookModal({ isOpen, onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchBook();
    }
  }, [isOpen]);

  const fetchBook = async () => {
    setLoading(true);
    try {
      const response = await api.get('/sales/reports/controlled-meds');
      setRecords(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error('Error fetching controlled meds book:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-md">
              <ShieldCheck size={13} /> Auditoría MPPS / SANID / DEA
            </span>
            <h3 className="text-xl font-bold text-white mt-2">
              Libro Oficial de Medicamentos Controlados y Psicotrópicos
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Registro histórico de despachos sujetos a récipe médico obligatorio.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-lg border border-slate-700 shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Printer size={15} /> Imprimir / Exportar
            </button>
            <button 
              onClick={onClose}
              className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-16 text-center text-slate-400 font-semibold animate-pulse">
              Obteniendo registros oficiales del servidor...
            </div>
          ) : records.length === 0 ? (
            <div className="py-16 text-center bg-slate-950/50 rounded-xl border border-slate-800 p-6">
              <p className="text-slate-300 font-semibold text-base mb-1">Libro sin registros</p>
              <p className="text-xs text-slate-500">Aún no se han despachado medicamentos controlados con récipe.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-black uppercase text-slate-400 tracking-wider bg-slate-950/40">
                    <th className="p-3.5">Fecha</th>
                    <th className="p-3.5">Paciente / Cédula</th>
                    <th className="p-3.5">Médico / MPPS</th>
                    <th className="p-3.5">Nº Récipe</th>
                    <th className="p-3.5">Fármaco Despachado</th>
                    <th className="p-3.5">Lote / Vence</th>
                    <th className="p-3.5">Cant.</th>
                    <th className="p-3.5">Cajero</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs font-medium text-slate-300">
                  {records.map((rec, i) => (
                    <tr key={rec.id || i} className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 whitespace-nowrap text-slate-400">
                        {rec.date ? new Date(rec.date).toLocaleDateString('es-VE') : 'N/A'}
                      </td>
                      <td className="p-3.5">
                        <div className="font-bold text-white">{rec.patientName}</div>
                        <div className="text-[10px] text-slate-400">{rec.patientId}</div>
                      </td>
                      <td className="p-3.5">
                        <div className="font-bold text-slate-200">{rec.doctorName}</div>
                        <div className="text-[10px] text-cyan-400">{rec.doctorLicense}</div>
                      </td>
                      <td className="p-3.5 font-mono text-amber-400 font-bold">
                        {rec.recipeNumber}
                      </td>
                      <td className="p-3.5 font-bold text-white">
                        {rec.productName}
                      </td>
                      <td className="p-3.5 text-[11px]">
                        <div>Lote: <span className="text-slate-200">{rec.batchNumber}</span></div>
                        <div className="text-slate-400">Vence: {rec.expirationDate}</div>
                      </td>
                      <td className="p-3.5 font-black text-emerald-400 text-sm">
                        {rec.quantity}
                      </td>
                      <td className="p-3.5 text-slate-400 text-[11px]">
                        {rec.dispensedBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-between items-center text-xs text-slate-500">
          <span>Cumplimiento Sanitario Institucional • Sistema POS Farmacia</span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
}
