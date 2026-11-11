import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { 
    Shield as ShieldIcon, Loader2, ShieldCheck as ShieldCheckIcon, 
    CheckCircle2, AlertCircle, Monitor, Clock, Copy, Key, 
    Wrench, Cpu, MessageSquare
} from 'lucide-react';
import { useAuth } from '../../hooks/AuthContext';

export default function LicenseSettings({ 
    licenseStatus = {}, activationKey = '', setActivationKey, 
    activating = false, onActivate 
}) {
    const { user } = useAuth();
    const [targetHwid, setTargetHwid] = useState(licenseStatus?.machineId || '');
    const [selectedDuration, setSelectedDuration] = useState('365');
    const [generating, setGenerating] = useState(false);

    // Sincronizar HWID al cargar
    useEffect(() => {
        if (licenseStatus?.machineId) {
            setTargetHwid(licenseStatus.machineId);
        }
    }, [licenseStatus?.machineId]);

    const handleCopy = (text, message = 'Copiado al portapapeles') => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            toast.success(message);
        } else {
            toast.error('No se pudo copiar');
        }
    };

    const shareViaWhatsapp = () => {
        if (!licenseStatus?.machineId) return;
        const text = `Hola, requiero la llave de activación para mi Servidor Isaac POS.\n\nCódigo de Equipo: *${licenseStatus.machineId}*`;
        window.open(`https://wa.me/584248302226?text=${encodeURIComponent(text)}`, '_blank');
    };

    const handleGenerateTestKey = async () => {
        if (!targetHwid) {
            toast.error('ID de Hardware requerido');
            return;
        }

        try {
            setGenerating(true);
            const durationNum = parseInt(selectedDuration);
            const unit = durationNum === 1 ? 'minutes' : 'days';
            
            const { data } = await api.post('/license/test-generate', {
                machineId: targetHwid,
                duration: durationNum,
                unit: unit
            });

            if (data.success && data.key) {
                setActivationKey(data.key);
                const durationLabel = selectedDuration === '-1' 
                    ? 'Vitalicia' 
                    : selectedDuration === '1' 
                        ? '1 Minuto' 
                        : `${selectedDuration} días`;
                toast.success(`Llave de prueba generada (${durationLabel}) e inyectada.`);
            } else {
                toast.error('Error al generar la llave');
            }
        } catch (error) {
            console.error(error);
            toast.error(error.response?.data?.error || 'Error al conectar con el servidor');
        } finally {
            setGenerating(false);
        }
    };

    const isActivated = Boolean(licenseStatus?.activated);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header del Protocolo */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0 border border-primary-100 dark:border-primary-900/30">
                        <ShieldIcon size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                Licenciamiento & Activación
                            </h2>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                isActivated 
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' 
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40'
                            }`}>
                                {isActivated ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                                {isActivated ? 'Activada' : 'Pendiente de activación'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Identidad del equipo, validación criptográfica y estado de la suscripción
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={shareViaWhatsapp}
                    className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 transition-colors cursor-pointer"
                >
                    <MessageSquare size={14} />
                    <span>Solicitar Llave por WhatsApp</span>
                </button>
            </div>

            {/* Layout de 2 Columnas */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Columna Izquierda (5 de 12): Estado del Servidor */}
                <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                        <div className="flex items-center gap-2.5">
                            <Monitor size={18} className="text-slate-500 dark:text-slate-400" />
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                Información de Esta Máquina
                            </h3>
                        </div>
                        <span className="text-[11px] font-mono font-medium text-slate-400">
                            Terminal 01
                        </span>
                    </div>

                    {/* Estado de Ejecución */}
                    <div className={`p-4 rounded-xl border flex items-center gap-3.5 ${
                        isActivated 
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40' 
                            : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
                    }`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            isActivated 
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' 
                                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                        }`}>
                            {isActivated ? <CheckCircle2 size={22} /> : <AlertCircle size={22} />}
                        </div>
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Estado del Sistema
                            </div>
                            <div className={`text-sm font-bold ${
                                isActivated ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                            }`}>
                                {isActivated ? 'Licencia Válida & Autorizada' : 'Licencia Pendiente de Activación'}
                            </div>
                        </div>
                    </div>

                    {/* ID de Hardware */}
                    <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Identificador de Hardware (HWID)
                        </label>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 truncate select-all">
                                {licenseStatus?.machineId || 'Consultando hardware...'}
                            </div>
                            <button 
                                type="button"
                                onClick={() => handleCopy(licenseStatus?.machineId || '', 'HWID copiado al portapapeles')} 
                                className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors shrink-0 cursor-pointer" 
                                title="Copiar ID de Hardware"
                            >
                                <Copy size={15} />
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            Proporciona este código al equipo de soporte para emitir la clave de activación exclusiva de tu equipo.
                        </p>
                    </div>

                    {/* Expiración */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            <Clock size={14} className="text-slate-400" />
                            <span>Vigencia de la Licencia</span>
                        </div>
                        <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between">
                            <span>Expiración:</span>
                            <span className="font-semibold text-slate-900 dark:text-white">
                                {licenseStatus?.expiresAt 
                                    ? new Date(licenseStatus.expiresAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) 
                                    : 'Licencia Vitalicia / Sin Vencimiento'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Columna Derecha (7 de 12): Formulario de Activación & Herramientas */}
                <div className="lg:col-span-7 space-y-6">
                    
                    {/* Tarjeta de Activación */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                            <Key size={18} className="text-primary-600 dark:text-primary-400" />
                            <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                    Ingresar Llave de Activación
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Pega la firma digital o token proporcionado para habilitar el sistema
                                </p>
                            </div>
                        </div>

                        <form onSubmit={onActivate} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Clave Criptográfica
                                </label>
                                <textarea 
                                    value={activationKey} 
                                    onChange={(e) => setActivationKey(e.target.value)} 
                                    rows={3}
                                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all resize-none"
                                    placeholder="Pega aquí la clave de activación (ej: eyJhbGciOi...)"
                                    required 
                                />
                            </div>

                            <button 
                                type="submit" 
                                disabled={activating || !activationKey} 
                                className="w-full py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-semibold rounded-xl text-xs transition-colors shadow-xs active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {activating ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheckIcon size={15} />}
                                <span>{activating ? 'Validando Clave...' : 'Activar y Validar Sistema'}</span>
                            </button>
                        </form>
                    </div>

                    {/* Módulo Especial de Soporte / Master Admin */}
                    {user?.email === 'mrivero105@gmail.com' && (
                        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                            <div className="flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-700 pb-3">
                                <Cpu size={16} className="text-primary-600 dark:text-primary-400" />
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                                        Generador Interno de Llaves (Soporte Técnico)
                                    </h4>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Herramienta exclusiva de desarrollo y mantenimiento
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                        HWID Destino
                                    </label>
                                    <input 
                                        type="text" 
                                        value={targetHwid} 
                                        onChange={(e) => setTargetHwid(e.target.value)} 
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-primary-500"
                                        placeholder="ID de máquina..."
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                        Duración
                                    </label>
                                    <select 
                                        value={selectedDuration} 
                                        onChange={(e) => setSelectedDuration(e.target.value)} 
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 cursor-pointer"
                                    >
                                        <option value="1">1 Minuto (Prueba rápida)</option>
                                        <option value="7">7 Días (Semanal)</option>
                                        <option value="30">30 Días (Mensual)</option>
                                        <option value="90">90 Días (Trimestral)</option>
                                        <option value="365">365 Días (Anual)</option>
                                        <option value="-1">Vitalicia (Sin Vencimiento)</option>
                                    </select>
                                </div>
                            </div>

                            <button 
                                type="button"
                                onClick={handleGenerateTestKey}
                                disabled={generating || !targetHwid}
                                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {generating ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                                <span>Generar y Cargar Firma</span>
                            </button>
                        </div>
                    )}

                </div>

            </div>
        </div>
    );
}
