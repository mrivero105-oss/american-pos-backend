import { useState } from 'react';
import { Lock, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
    getIdleLockMinutes,
    setIdleLockMinutes,
    formatIdleLockLabel,
} from '../../utils/idleLockSettings';

const BASE_PRESETS = [
    { value: 5, label: '5 min' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hora' },
    { value: 120, label: '2 horas' },
];

const DISABLE_PRESET = { value: 0, label: 'Desactivado' };

export default function IdleLockPanel({ compact = false, allowDisable = false }) {
    const presets = allowDisable ? [DISABLE_PRESET, ...BASE_PRESETS] : BASE_PRESETS;
    const initialMinutes = getIdleLockMinutes();
    const presetValues = presets.map((preset) => preset.value);
    const isCustomInitial = initialMinutes > 0 && !presetValues.includes(initialMinutes);

    const [minutes, setMinutes] = useState(initialMinutes);
    const [customMode, setCustomMode] = useState(isCustomInitial);
    const [customMinutes, setCustomMinutes] = useState(
        isCustomInitial ? String(initialMinutes) : ''
    );

    const applyMinutes = (nextMinutes, message) => {
        const saved = setIdleLockMinutes(nextMinutes);
        setMinutes(saved);
        toast.success(message || `Bloqueo por inactividad: ${formatIdleLockLabel(saved)}`);
    };

    const handlePresetSelect = (value) => {
        if (value === 0 && !allowDisable) {
            toast.error('Solo un administrador puede desactivar el bloqueo automático');
            return;
        }
        setCustomMode(false);
        setCustomMinutes('');
        applyMinutes(value);
    };

    const handleCustomMode = () => {
        setCustomMode(true);
        if (customMinutes) {
            const parsed = parseInt(customMinutes, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                applyMinutes(parsed);
            }
        }
    };

    const handleCustomSave = () => {
        const parsed = parseInt(customMinutes, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            toast.error('Ingresa un tiempo válido en minutos (mínimo 1)');
            return;
        }
        if (parsed > 24 * 60) {
            toast.error('El máximo permitido es 24 horas (1440 minutos)');
            return;
        }
        applyMinutes(parsed);
    };

    const isPresetActive = (value) => !customMode && minutes === value;

    return (
        <div className={compact ? 'space-y-4' : 'space-y-5'}>
            {/* Estado actual */}
            <div className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 ${compact ? 'p-3.5' : 'p-4'}`}>
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                        <Lock size={16} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                            Configuración activa: {formatIdleLockLabel(minutes)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {compact
                                ? 'Bloquea la terminal automáticamente tras inactividad. Bloqueo manual: Ctrl+L.'
                                : 'Si se mantiene inactivo el sistema por este tiempo, se solicitará contraseña o PIN para reanudar. También puedes bloquear manualmente con Ctrl+L.'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Presets */}
            <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tiempo de espera antes del bloqueo
                </label>
                <div className="flex flex-wrap gap-2">
                    {presets.map((preset) => (
                        <button
                            key={preset.value}
                            type="button"
                            onClick={() => handlePresetSelect(preset.value)}
                            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                isPresetActive(preset.value)
                                    ? 'bg-primary-600 text-white shadow-xs'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                            }`}
                        >
                            {preset.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={handleCustomMode}
                        className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            customMode
                                ? 'bg-primary-600 text-white shadow-xs'
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                        }`}
                    >
                        Personalizado
                    </button>
                </div>
            </div>

            {/* Modo Personalizado */}
            {customMode && (
                <div className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 ${compact ? 'p-3.5' : 'p-4'} space-y-2`}>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Duración personalizada (en minutos)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                        <div className="relative flex-1">
                            <Clock
                                size={15}
                                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                type="number"
                                min="1"
                                max="1440"
                                value={customMinutes}
                                onChange={(e) => setCustomMinutes(e.target.value)}
                                placeholder="Ej: 45"
                                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleCustomSave}
                            className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                        >
                            Guardar
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Rango permitido: 1 a 1440 minutos (hasta 24 horas).
                    </p>
                </div>
            )}
        </div>
    );
}
