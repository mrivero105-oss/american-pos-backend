import { useState, useMemo } from 'react';
import BaseModal from './BaseModal';
import { 
    Shield, Clock, User, FileText, ArrowRight, Copy, Check, 
    Code, X, Layers, AlertCircle 
} from 'lucide-react';
import toast from 'react-hot-toast';

// Friendly field name translations
const FIELD_LABELS = {
    price: 'Precio de Venta',
    priceBs: 'Precio en Bs',
    cost: 'Costo Unitario',
    bulkPrice: 'Precio por Bulto',
    bulkPriceBs: 'Precio Bulto en Bs',
    bulkCost: 'Costo por Bulto',
    midBulkPrice: 'Precio Media Presentación',
    midBulkPriceBs: 'Precio Media Pres. Bs',
    midBulkUnits: 'Unidades Media Pres.',
    stockQuantity: 'Stock Actual',
    stock: 'Stock (Heredado)',
    minStock: 'Stock Mínimo',
    alertStockThreshold: 'Umbral Alerta Stock',
    wholesalePrice: 'Precio Mayorista',
    unitsPerBulk: 'Unidades por Bulto',
    bulkUnitName: 'Nombre de Bulto',
    margin: 'Margen de Ganancia (%)',
    name: 'Nombre del Producto',
    barcode: 'Código de Barras',
    category: 'Categoría',
    packaging: 'Tipo de Empaque',
    status: 'Estado',
    allowNegative: 'Permitir Negativos',
    taxStatus: 'Tratamiento Fiscal',
    weight: 'Peso',
    expirationDays: 'Días de Vencimiento',
    supplierId: 'Proveedor ID',
    isSoldByWeight: 'Vendido por Peso',
    isFractional: 'Venta Fraccional',
    amount: 'Monto',
    paymentMethod: 'Método de Pago',
    reason: 'Motivo',
    notes: 'Observaciones'
};

export default function AuditDetailModal({ isOpen, onClose, log, getActionBadge }) {
    const [copied, setCopied] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);

    // Extract structured field differences
    const parsedDiffs = useMemo(() => {
        if (!log) return [];

        const diffs = [];

        // 1. Try parsing oldValue and newValue JSON
        if (log.oldValue && log.newValue) {
            try {
                const oldObj = typeof log.oldValue === 'string' ? JSON.parse(log.oldValue) : log.oldValue;
                const newObj = typeof log.newValue === 'string' ? JSON.parse(log.newValue) : log.newValue;

                const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
                
                allKeys.forEach(key => {
                    // Ignore internal keys
                    if (['updatedAt', 'createdAt', 'companyId'].includes(key)) return;

                    const oldVal = oldObj ? oldObj[key] : undefined;
                    const newVal = newObj ? newObj[key] : undefined;

                    if (String(oldVal ?? '') !== String(newVal ?? '')) {
                        diffs.push({
                            field: key,
                            label: FIELD_LABELS[key] || key,
                            oldVal: oldVal !== undefined && oldVal !== null ? String(oldVal) : 'N/A',
                            newVal: newVal !== undefined && newVal !== null ? String(newVal) : 'N/A'
                        });
                    }
                });

                if (diffs.length > 0) return diffs;
            } catch (_err) {
                // If JSON parse fails, fallback to regex parsing of description
            }
        }

        // 2. Fallback: Parse description string e.g. "field: old -> new"
        if (log.description) {
            const regex = /(?:^|,\s*)([a-zA-Z0-9_\u00C0-\u017F\s]+):\s*([^,->]+?)\s*->\s*([^,]+)/g;
            let match;
            while ((match = regex.exec(log.description)) !== null) {
                const rawField = match[1].trim();
                const oldVal = match[2].trim();
                const newVal = match[3].trim();
                diffs.push({
                    field: rawField,
                    label: FIELD_LABELS[rawField] || rawField,
                    oldVal,
                    newVal
                });
            }
        }

        return diffs;
    }, [log]);

    if (!log) return null;

    const handleCopyReport = () => {
        const text = `=== REPORTE FORENSE DE AUDITORÍA ===
ID Evento: ${log.id}
Fecha/Hora: ${new Date(log.createdAt).toLocaleString()}
Usuario: ${log.User ? `${log.User.name} (@${log.User.username}) - Rol: ${log.User.role}` : log.userId || 'Sistema'}
Acción: ${log.action}
Entidad Afectada: ${log.entityId || 'N/A'}
Descripción: ${log.description}
${parsedDiffs.length > 0 ? `\nCambios Realizados:\n` + parsedDiffs.map(d => `  - ${d.label} (${d.field}): ${d.oldVal} ➔ ${d.newVal}`).join('\n') : ''}`;

        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Reporte copiado al portapapeles');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-3xl"
            className="w-full p-2 sm:p-4 pb-safe"
        >
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
                {/* Header */}
                <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 sm:p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 rounded-lg shrink-0">
                            <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                                    Inspección Forense de Auditoría
                                </h3>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5">
                                    ID: {log.id?.slice(0, 10)}...
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5 mt-0.5">
                                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                                <span>{new Date(log.createdAt).toLocaleString('es-VE', { dateStyle: 'full', timeStyle: 'medium' })}</span>
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Cerrar"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content Body */}
                <div className="p-4 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
                    {/* User & Action Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/5">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/50 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
                                <User size={20} />
                            </div>
                            <div>
                                <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block">
                                    Usuario Responsable
                                </span>
                                <div className="text-xs sm:text-sm font-black text-slate-800 dark:text-white flex items-center gap-1.5">
                                    <span>{log.User?.name || log.userId || 'Sistema'}</span>
                                    {log.User?.username && (
                                        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                            (@{log.User.username})
                                        </span>
                                    )}
                                </div>
                                {log.User?.role && (
                                    <span className="inline-block mt-0.5 text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                        {log.User.role}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 dark:border-white/5">
                            <div>
                                <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block text-left sm:text-right mb-1">
                                    Tipo de Evento
                                </span>
                                <div className="flex justify-start sm:justify-end">
                                    {getActionBadge ? getActionBadge(log.action) : (
                                        <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-500 rounded-full text-xs font-black">
                                            {log.action}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Full Description Plate */}
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <FileText size={13} className="text-indigo-400" />
                            Descripción del Suceso
                        </label>
                        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-white/5 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                            {log.description}
                        </div>
                    </div>

                    {/* Field Comparison Table */}
                    {parsedDiffs.length > 0 ? (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    <Layers size={13} className="text-indigo-400" />
                                    Comparativa de Modificaciones ({parsedDiffs.length} {parsedDiffs.length === 1 ? 'campo' : 'campos'})
                                </label>
                            </div>

                            {/* Desktop Table */}
                            <div className="hidden sm:block rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden shadow-xs">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-white/10">
                                            <th className="px-4 py-2.5 font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                Campo
                                            </th>
                                            <th className="px-4 py-2.5 font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                Valor Anterior
                                            </th>
                                            <th className="px-4 py-2.5 font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                Valor Nuevo
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                        {parsedDiffs.map((diff, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                <td className="px-4 py-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                                    <div>{diff.label}</div>
                                                    <div className="text-[10px] font-mono text-slate-400 font-normal">
                                                        {diff.field}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono text-[11px] font-semibold line-through decoration-rose-500/40">
                                                        {diff.oldVal}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono text-[11px] font-bold">
                                                        <ArrowRight size={11} className="text-emerald-500" />
                                                        {diff.newVal}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Modification Cards */}
                            <div className="block sm:hidden space-y-2">
                                {parsedDiffs.map((diff, idx) => (
                                    <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-white/5 space-y-1.5">
                                        <div className="flex justify-between items-start">
                                            <span className="text-xs font-bold text-slate-900 dark:text-white">{diff.label}</span>
                                            <span className="text-[10px] font-mono text-slate-400">{diff.field}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono text-[11px] font-semibold line-through decoration-rose-500/40">
                                                <span className="text-[9px] uppercase block font-bold text-rose-500 mb-0.5">Antes</span>
                                                {diff.oldVal}
                                            </div>
                                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono text-[11px] font-bold">
                                                <span className="text-[9px] uppercase block font-bold text-emerald-500 mb-0.5">Ahora</span>
                                                {diff.newVal}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/50 dark:border-indigo-500/20 flex items-start gap-3 text-xs text-indigo-700 dark:text-indigo-300">
                            <AlertCircle size={16} className="shrink-0 mt-0.5 text-indigo-500" />
                            <p>
                                Este registro corresponde a una acción directa sin modificación de campos previos/posteriores. Toda la información disponible se encuentra en la descripción oficial superior.
                            </p>
                        </div>
                    )}

                    {/* Collapsible Technical JSON Inspector */}
                    {(log.oldValue || log.newValue || log.entityId) && (
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => setShowRawJson(!showRawJson)}
                                className="text-[11px] font-bold text-slate-500 hover:text-indigo-500 flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                                <Code size={13} />
                                <span>{showRawJson ? 'Ocultar datos técnicos brutos' : 'Ver datos técnicos brutos (JSON / IDs)'}</span>
                            </button>

                            {showRawJson && (
                                <div className="mt-2.5 p-3 rounded-2xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto space-y-2 border border-slate-800">
                                    {log.entityId && (
                                        <div>
                                            <span className="text-slate-400">ID Entidad:</span> <span className="text-amber-400">{log.entityId}</span>
                                        </div>
                                    )}
                                    {log.oldValue && (
                                        <div>
                                            <div className="text-rose-400 font-bold mb-0.5">{'//'} Valor Anterior (Raw):</div>
                                            <pre className="text-slate-300 whitespace-pre-wrap break-all bg-black/30 p-2 rounded-xl">
                                                {typeof log.oldValue === 'string' ? log.oldValue : JSON.stringify(log.oldValue, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                    {log.newValue && (
                                        <div>
                                            <div className="text-emerald-400 font-bold mb-0.5">{'//'} Valor Nuevo (Raw):</div>
                                            <pre className="text-slate-300 whitespace-pre-wrap break-all bg-black/30 p-2 rounded-xl">
                                                {typeof log.newValue === 'string' ? log.newValue : JSON.stringify(log.newValue, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 sm:p-5 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <button
                        onClick={handleCopyReport}
                        className="min-h-[44px] px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                    >
                        {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        <span>{copied ? 'Copiado' : 'Copiar Ficha'}</span>
                    </button>

                    <button
                        onClick={onClose}
                        className="min-h-[44px] px-5 sm:px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black transition-all active:scale-95 shadow-md cursor-pointer flex items-center justify-center"
                    >
                        Entendido
                    </button>
                </div>
            </div>
        </BaseModal>
    );
}
