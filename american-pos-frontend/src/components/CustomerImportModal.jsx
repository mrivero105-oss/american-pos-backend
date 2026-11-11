import { useState, useRef } from 'react';
import { X, UploadCloud, FileSpreadsheet, Download, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import BaseModal from './BaseModal';
import toast from 'react-hot-toast';
import api from '../services/api';

export default function CustomerImportModal({ isOpen, onClose, onSuccess }) {
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [stats, setStats] = useState(null);
    const fileInputRef = useRef();

    if (!isOpen) return null;

    const parseCSVText = (text) => {
        const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) return [];

        // Detect separator (comma or semicolon)
        const firstLine = lines[0];
        const separator = firstLine.includes(';') ? ';' : ',';

        const headers = lines[0].split(separator).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const rawCols = lines[i].split(separator).map(c => c.trim().replace(/^["']|["']$/g, ''));
            if (rawCols.length === 0 || !rawCols[0]) continue;

            const row = {};
            headers.forEach((h, idx) => {
                const val = rawCols[idx] || '';
                if (h.includes('nombre') || h.includes('name') || h.includes('cliente')) row.name = val;
                else if (h.includes('doc') || h.includes('cedula') || h.includes('rif') || h.includes('identidad')) row.idDocument = val;
                else if (h.includes('tel') || h.includes('phone') || h.includes('cel')) row.phone = val;
                else if (h.includes('correo') || h.includes('email') || h.includes('mail')) row.email = val;
                else if (h.includes('dir') || h.includes('address') || h.includes('ubicacion')) row.address = val;
                else if (h.includes('limite') || h.includes('credit')) row.creditLimit = parseFloat(val) || 0;
                else if (h.includes('vip')) row.isVIP = val.toLowerCase() === 'si' || val.toLowerCase() === 'true';
            });

            if (row.name) {
                rows.push(row);
            }
        }
        return rows;
    };

    const handleFileChange = (e) => {
        const selected = e.target.files?.[0];
        if (!selected) return;

        setFile(selected);
        setStats(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const content = event.target.result;
                const parsed = parseCSVText(content);
                if (parsed.length === 0) {
                    toast.error('No se detectaron clientes válidos en el archivo');
                } else {
                    setParsedData(parsed);
                    toast.success(`${parsed.length} clientes listos para importar`);
                }
            } catch (err) {
                console.error('Error parsing file:', err);
                toast.error('Error al procesar el archivo');
            }
        };
        reader.readAsText(selected, 'UTF-8');
    };

    const handleDownloadTemplate = () => {
        const BOM = '\ufeff';
        const SEP = ';';
        let csv = BOM + `Nombre${SEP}Documento${SEP}Telefono${SEP}Email${SEP}Direccion${SEP}Limite Credito${SEP}Es VIP\n`;
        csv += `JUAN PEREZ${SEP}V-18456123${SEP}04141234567${SEP}juan@email.com${SEP}Av. Bolívar${SEP}100${SEP}NO\n`;
        csv += `DISTRIBUIDORA ANDINA C.A.${SEP}J-30456789-0${SEP}02129876543${SEP}contacto@andina.com${SEP}Zona Industrial${SEP}500${SEP}SI\n`;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'plantilla_importar_clientes.csv');
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const handleImportSubmit = async () => {
        if (parsedData.length === 0) {
            toast.error('No hay datos para importar');
            return;
        }

        try {
            setProcessing(true);
            const res = await api.post('/customers/import', { customers: parsedData });
            setStats(res.data);
            toast.success(`Importación completada: ${res.data.imported} nuevos, ${res.data.updated} actualizados`);
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Import error:', error);
            toast.error(error.response?.data?.error || 'Error al importar clientes');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <BaseModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-2xl">
            <div className="relative bg-slate-900 text-white rounded-xl p-4 sm:p-6 border border-slate-800 shadow-2xl max-h-[90dvh] overflow-y-auto pb-safe">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-primary-400 shrink-0">
                            <FileSpreadsheet size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg sm:text-xl font-bold uppercase tracking-tight text-white">Importador Masivo de Clientes</h2>
                            <p className="text-xs text-slate-400 font-medium">Desde hojas de cálculo Excel / CSV</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-6 pt-6">
                    {/* Template download & instruction */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                        <div>
                            <h4 className="text-xs font-bold uppercase text-white">¿No tienes el formato exacto?</h4>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Descarga nuestra plantilla oficial con encabezados preconfigurados.</p>
                        </div>
                        <button
                            onClick={handleDownloadTemplate}
                            className="h-10 px-4 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0 border border-slate-700 cursor-pointer w-full sm:w-auto"
                        >
                            <Download size={14} /> Plantilla CSV
                        </button>
                    </div>

                    {/* Upload Dropzone */}
                    {!stats ? (
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-slate-700 hover:border-primary-500/50 bg-slate-950/50 hover:bg-primary-500/5 rounded-xl p-8 text-center cursor-pointer transition-colors group"
                        >
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileChange} 
                                accept=".csv,.txt" 
                                className="hidden" 
                            />
                            <UploadCloud size={36} className="text-slate-400 group-hover:text-primary-400 mx-auto mb-3 transition-colors" />
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-white mb-1">
                                {file ? file.name : 'Haz clic para seleccionar tu archivo CSV'}
                            </h3>
                            <p className="text-xs text-slate-400 font-medium">
                                {parsedData.length > 0 ? `${parsedData.length} registros cargados correctamente` : 'Soporta archivos exportados de Excel en formato .csv'}
                            </p>
                        </div>
                    ) : (
                        <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center space-y-3">
                            <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
                            <h3 className="text-base font-black uppercase text-white">¡Importación Exitosa!</h3>
                            <div className="flex justify-center gap-4 text-xs font-bold text-slate-300">
                                <span>Total: <b>{stats.totalRows}</b></span>
                                <span>•</span>
                                <span className="text-emerald-400">Nuevos: <b>{stats.imported}</b></span>
                                <span>•</span>
                                <span className="text-indigo-400">Actualizados: <b>{stats.updated}</b></span>
                            </div>
                        </div>
                    )}

                    {/* Preview Table if file loaded */}
                    {parsedData.length > 0 && !stats && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-xs font-black text-slate-400 uppercase">
                                <span>Previsualización (Primeros 3 registros)</span>
                                <span>Total: {parsedData.length}</span>
                            </div>
                            <div className="overflow-x-auto bg-slate-950 rounded-xl p-2 border border-white/5 text-xs">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="text-[10px] font-black uppercase text-slate-500 border-b border-white/10">
                                            <th className="p-2">Nombre</th>
                                            <th className="p-2">Documento</th>
                                            <th className="p-2">Teléfono</th>
                                            <th className="p-2">Límite</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 font-bold text-slate-300">
                                        {parsedData.slice(0, 3).map((r, i) => (
                                            <tr key={i}>
                                                <td className="p-2 text-white">{r.name}</td>
                                                <td className="p-2">{r.idDocument || '---'}</td>
                                                <td className="p-2">{r.phone || '---'}</td>
                                                <td className="p-2">${r.creditLimit || 0}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Submit Button */}
                    <div className="pt-2">
                        {!stats ? (
                            <button
                                onClick={handleImportSubmit}
                                disabled={processing || parsedData.length === 0}
                                className="w-full h-11 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                            >
                                {processing ? 'Importando Base de Datos...' : `Importar ${parsedData.length} Clientes al Sistema`}
                            </button>
                        ) : (
                            <button
                                onClick={onClose}
                                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-colors cursor-pointer flex items-center justify-center"
                            >
                                Finalizar
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </BaseModal>
    );
}
