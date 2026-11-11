import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
    ShieldAlert, Key, Copy, CheckCircle2, ArrowRight, RefreshCw, 
    Smartphone, Wifi, AlertTriangle, Clipboard as ClipboardIcon, Zap, Check, Trash2
} from 'lucide-react';
import { Clipboard as CapClipboard } from '@capacitor/clipboard';
import api, { updateApiBaseUrl } from '../services/api';
import ServerConfigModal from './ServerConfigModal';
import { useAuth } from '../hooks/AuthContext';
import { getTerminalId } from '../utils/terminalIdentity';
import { 
    validateLicenseKeyLocally, 
    extractAndCleanLicenseKey 
} from '../utils/clientLicenseValidator';
import axios from 'axios';
import toast from 'react-hot-toast';

export default function ActivationPortal({ machineId, onActivated }) {
    const { checkLicense } = useAuth();
    const [key, setKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [pastedStatus, setPastedStatus] = useState(false);

    // Server IP Config state
    const [showConfig, setShowConfig] = useState(false);
    const [serverIp, setServerIp] = useState(
        localStorage.getItem('isaac_pos_server_ip') || 
        localStorage.getItem('american_pos_server_ip') || ''
    );
    const [isTesting, setIsTesting] = useState(false);
    const [isRechecking, setIsRechecking] = useState(false);

    const isConnectionError = machineId === 'CONNECTION-ERROR';

    // Manejador ultra-robusto para pegar llave (PosNativeHardware + Capacitor + Clipboard API + ExecCommand)
    const handlePasteKey = async () => {
        setErrorMessage('');
        let textToPaste = '';

        // 1. Intentar plugin nativo directo de la app PosNativeHardware
        try {
            if (window.Capacitor?.Plugins?.PosNativeHardware?.readClipboard) {
                const res = await window.Capacitor.Plugins.PosNativeHardware.readClipboard();
                if (res?.value && typeof res.value === 'string' && res.value.trim()) {
                    textToPaste = res.value.trim();
                }
            }
        } catch (posErr) {
            console.warn('[ActivationPortal] PosNativeHardware.readClipboard:', posErr);
        }

        // 2. Intentar plugin nativo oficial de Capacitor (@capacitor/clipboard)
        if (!textToPaste) {
            try {
                const result = await CapClipboard.read();
                if (result?.value && typeof result.value === 'string' && result.value.trim()) {
                    textToPaste = result.value.trim();
                }
            } catch (capErr) {
                console.warn('[ActivationPortal] CapClipboard error:', capErr);
            }
        }

        // 3. Intentar window.Capacitor.Plugins.Clipboard fallback
        if (!textToPaste) {
            try {
                if (window.Capacitor?.Plugins?.Clipboard) {
                    const result = await window.Capacitor.Plugins.Clipboard.read();
                    if (result?.value && typeof result.value === 'string' && result.value.trim()) {
                        textToPaste = result.value.trim();
                    }
                }
            } catch (_) {}
        }

        // 4. Intentar API estándar de Portapapeles del navegador
        if (!textToPaste && navigator?.clipboard?.readText) {
            try {
                textToPaste = await navigator.clipboard.readText();
            } catch (clipErr) {
                console.warn('[ActivationPortal] Clipboard API restringido por el navegador:', clipErr);
            }
        }

        // 5. Intentar execCommand('paste') con el textarea enfocado
        if (!textToPaste) {
            try {
                const textareaEl = document.getElementById('activation-key-textarea');
                if (textareaEl) {
                    textareaEl.focus();
                    document.execCommand('paste');
                    if (textareaEl.value && textareaEl.value.trim()) {
                        textToPaste = textareaEl.value.trim();
                    }
                }
            } catch (_) {}
        }

        if (textToPaste) {
            const cleaned = extractAndCleanLicenseKey(textToPaste);
            setKey(cleaned);
            setPastedStatus(true);
            setTimeout(() => setPastedStatus(false), 2500);

            if (cleaned.length >= 40) {
                toast.success(`📋 Llave pegada (${cleaned.length} caracteres)`);
            } else {
                toast('Texto pegado. Verifica que la llave esté completa.', { icon: 'ℹ️' });
            }
        } else {
            // Enfocar y abrir cursor en el textarea para pegado directo
            const textareaEl = document.getElementById('activation-key-textarea');
            if (textareaEl) {
                textareaEl.focus();
                textareaEl.click();
            }
            toast('Mantén presionado el cuadro de texto y toca "Pegar" (o usa el botón de tu teclado)', { 
                icon: '📋',
                duration: 4000 
            });
        }
    };

    const handleActivate = async (e) => {
        if (e?.preventDefault) e.preventDefault();
        setErrorMessage('');

        const cleanedKey = extractAndCleanLicenseKey(key);
        if (!cleanedKey) {
            setErrorMessage('Por favor introduce o pega la llave de activación.');
            return;
        }

        try {
            setLoading(true);

            // 1. Validación Criptográfica Local Instantánea (Offline-First, sin depender de red)
            const targetMid = machineId || getTerminalId();
            const localValidation = await validateLicenseKeyLocally(cleanedKey, targetMid);
            
            if (localValidation.valid) {
                // Registrar activación local permanente en este equipo
                localStorage.setItem('isaac_pos_license_activated', 'true');
                localStorage.setItem('isaac_pos_license_machine_id', targetMid);
                localStorage.setItem('isaac_pos_license_key', cleanedKey);
                localStorage.setItem('isaac_pos_license_last_validated', Date.now().toString());

                // Notificar y persistir en el servidor central antes de continuar
                try {
                    await api.post('/license/activate', { key: cleanedKey, machineId: targetMid }, { timeout: 4000 });
                } catch (syncErr) {
                    console.log('[ActivationPortal] Activación persistida localmente (modo autónomo):', syncErr?.message);
                }

                setSuccess(true);
                toast.success(localValidation.message || '¡Terminal Activada Correctamente!');
                setTimeout(() => {
                    onActivated();
                }, 500);
                return;
            }

            // 2. Si la validación local falló, intentar consultar al servidor central (con timeout estricto de 3.5s)
            if (!isConnectionError) {
                try {
                    const { data } = await api.post('/license/activate', { key: cleanedKey, machineId }, { timeout: 3500 });
                    if (data?.success) {
                        localStorage.setItem('isaac_pos_license_activated', 'true');
                        localStorage.setItem('isaac_pos_license_machine_id', machineId);
                        localStorage.setItem('isaac_pos_license_key', cleanedKey);
                        localStorage.setItem('isaac_pos_license_last_validated', Date.now().toString());

                        setSuccess(true);
                        toast.success('¡Sistema Activado Correctamente!');
                        setTimeout(() => {
                            onActivated();
                        }, 1000);
                        return;
                    }
                } catch (serverErr) {
                    if (serverErr.response?.data?.error) {
                        const sMsg = serverErr.response.data.error;
                        setErrorMessage(sMsg);
                        toast.error(sMsg);
                        return;
                    }
                }
            }

            // 3. Mostrar el mensaje de error exacto y visible en pantalla
            const msg = localValidation.message || 'Llave de activación inválida';
            setErrorMessage(msg);
            toast.error(msg);
        } catch (error) {
            console.error('Activation failed:', error);
            const errMsg = error.message || 'Error al procesar la activación';
            setErrorMessage(errMsg);
            toast.error(errMsg);
        } finally {
            setLoading(false);
        }
    };

    const copyMachineId = async () => {
        if (isConnectionError) {
            toast.error('No se puede copiar: Error de conexión con el servidor.');
            return;
        }
        let copied = false;
        try {
            if (window.Capacitor?.Plugins?.PosNativeHardware?.writeClipboard) {
                await window.Capacitor.Plugins.PosNativeHardware.writeClipboard({ text: machineId });
                copied = true;
            }
        } catch (_) {}

        if (!copied) {
            try {
                await CapClipboard.write({ string: machineId });
                copied = true;
            } catch (_) {}
        }

        if (!copied && navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(machineId);
                copied = true;
            } catch (_) {}
        }

        toast.success('¡ID de Máquina copiado al portapapeles!');
    };

    const shareViaWhatsapp = () => {
        if (isConnectionError || !machineId) {
            toast.error('No se puede compartir: Error de conexión con el servidor.');
            return;
        }
        const isTerm = machineId.startsWith('TERM-');
        const text = `Hola, requiero la llave de activación para mi ${isTerm ? 'Terminal / Cajero' : 'Servidor'} Isaac POS.\n\nCódigo de Equipo: *${machineId}*`;
        window.open(`https://wa.me/584248302226?text=${encodeURIComponent(text)}`, '_blank');
    };

    const handleRetry = async () => {
        setIsRechecking(true);
        try {
            const data = await checkLicense();
            if (data?.activated) {
                toast.success('¡Servidor conectado y licencia activa!');
                onActivated();
            } else if (data?.machineId && data.machineId !== 'CONNECTION-ERROR') {
                toast.success('Conectado al servidor POS exitosamente.');
            } else {
                toast.error('Aún no se puede conectar al servidor POS. Verifica la IP.');
            }
        } catch {
            toast.error('Error al reintentar conexión.');
        } finally {
            setIsRechecking(false);
        }
    };

    if (success) {
        return (
            <div className="fixed inset-0 z-[9990] bg-slate-950 flex items-center justify-center overflow-hidden">
                <div className="text-center p-6 max-w-sm">
                    <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-xl flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-1">Acceso Concedido</h2>
                    <p className="text-emerald-400 font-medium text-xs">Iniciando Isaac POS Engine...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9990] bg-slate-950/95 flex items-center justify-center p-4 overflow-y-auto">
            <div className="max-w-xl w-full bg-slate-900 rounded-xl border border-slate-800 p-6 sm:p-8 shadow-xl relative z-10 my-auto">
                {/* Header with Title and Network Config Button */}
                <div className="flex items-center justify-between gap-3 mb-6 border-b border-slate-800 pb-5">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-12 h-12 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl flex items-center justify-center shrink-0">
                            <ShieldAlert size={24} />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-xl font-bold text-white leading-tight mb-1 truncate">ISAAC POS</h1>
                            <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] font-semibold text-amber-400 inline-block">
                                {isConnectionError ? 'Sin Conexión al Servidor' : 'Requiere Activación'}
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowConfig(true)}
                        className="flex items-center gap-2 px-3 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-300 hover:text-white text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                        title="Configurar IP del Servidor"
                    >
                        <Wifi size={15} />
                        <span className="hidden sm:inline">Config Red</span>
                    </button>
                </div>

                <div className="space-y-5">
                    {/* Connection Error Banner */}
                    {isConnectionError ? (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 sm:p-5 space-y-3.5">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="text-rose-400 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h3 className="text-sm font-bold text-rose-300">
                                        No se pudo conectar al Servidor POS
                                    </h3>
                                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                                        Este dispositivo no puede comunicarse con el servidor principal de Isaac POS.
                                        Si estás usando un dispositivo móvil, debes configurar la <strong>Dirección IP</strong> de la computadora principal donde corre el sistema.
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setShowConfig(true)}
                                    className="flex-1 h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                                >
                                    <Wifi size={15} />
                                    <span>Configurar IP de Red</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRetry}
                                    disabled={isRechecking}
                                    className="h-10 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors flex items-center justify-center gap-2 border border-slate-700 cursor-pointer disabled:opacity-50"
                                >
                                    <RefreshCw className={isRechecking ? 'animate-spin' : ''} size={15} />
                                    <span>{isRechecking ? 'Conectando...' : 'Reintentar'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Standard Machine ID Display (Full-width card, impossible to wrap vertically) */
                        <div className="bg-slate-950/70 rounded-xl p-3.5 sm:p-5 border border-slate-800 space-y-3">
                            <div className="flex justify-between items-center px-0.5">
                                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Smartphone className="text-blue-400" size={14} />
                                    {machineId.startsWith('TERM-') ? 'Identificador de Cajero / Terminal' : 'Identificador de Servidor'}
                                </span>
                                <span className="text-[10px] text-blue-400 font-medium">Toque para copiar</span>
                            </div>

                            {/* Full-width ID Box */}
                            <div 
                                onClick={copyMachineId}
                                className="bg-slate-900/90 border border-slate-700/80 hover:border-blue-500/60 active:scale-[0.99] rounded-xl p-3 text-center cursor-pointer transition-all shadow-inner select-all"
                                title="Toca para copiar este código"
                            >
                                <code className="text-base sm:text-lg font-mono font-black text-amber-400 tracking-wider block">
                                    {machineId}
                                </code>
                            </div>

                            {/* Two Balanced Action Buttons */}
                            <div className="grid grid-cols-2 gap-2 pt-0.5">
                                <button 
                                    type="button"
                                    onClick={copyMachineId}
                                    className="h-10 px-3 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 hover:text-white rounded-lg text-xs font-bold transition-colors border border-slate-700 shadow-sm cursor-pointer"
                                >
                                    <Copy size={15} className="mr-1.5 text-blue-400 shrink-0" />
                                    <span>Copiar ID</span>
                                </button>
                                <button 
                                    type="button"
                                    onClick={shareViaWhatsapp}
                                    className="h-10 px-3 flex items-center justify-center bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 text-emerald-300 hover:text-white rounded-lg text-xs font-bold transition-colors border border-emerald-500/30 shadow-sm cursor-pointer"
                                >
                                    <Zap size={15} className="mr-1.5 text-emerald-400 shrink-0" />
                                    <span>WhatsApp</span>
                                </button>
                            </div>

                            <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                                {machineId.startsWith('TERM-') 
                                    ? 'Envía este código por WhatsApp para recibir tu licencia de cajero.'
                                    : 'Envía este código por WhatsApp para recibir tu llave de activación.'
                                }
                            </p>
                        </div>
                    )}

                    {/* Activation Form */}
                    <form onSubmit={handleActivate} className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex justify-between items-center px-0.5">
                                <label 
                                    htmlFor="activation-key-textarea"
                                    className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5"
                                >
                                    <Key size={14} className="text-blue-400" />
                                    {machineId.startsWith('TERM-') ? 'Llave de Activación de Cajero' : 'Llave Maestra de Acceso'}
                                </label>

                                <div className="flex items-center gap-1.5">
                                    {key.trim() && (
                                        <button
                                            type="button"
                                            onClick={() => setKey('')}
                                            className="h-7 px-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                                            title="Borrar texto"
                                        >
                                            <Trash2 size={12} />
                                            <span>Limpiar</span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handlePasteKey}
                                        disabled={isConnectionError || loading}
                                        className="h-7 px-3 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-40"
                                        title="Pegar llave desde el portapapeles"
                                    >
                                        {pastedStatus ? <CheckCircle2 size={13} className="text-emerald-300" /> : <ClipboardIcon size={13} />}
                                        <span>{pastedStatus ? '¡Pegado!' : 'Pegar'}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Textarea for easy tapping, native long-press paste, and viewing full key */}
                            <div className="relative">
                                <textarea 
                                    id="activation-key-textarea"
                                    rows={3}
                                    value={key}
                                    onPaste={(e) => {
                                        try {
                                            const pasted = e.clipboardData?.getData('text');
                                            if (pasted) {
                                                e.preventDefault();
                                                const cleaned = extractAndCleanLicenseKey(pasted);
                                                setKey(cleaned);
                                                if (errorMessage) setErrorMessage('');
                                                if (cleaned.length >= 40) {
                                                    toast.success(`📋 Llave detectada (${cleaned.length} caracteres)`);
                                                } else {
                                                    toast('Texto pegado. Verifica que la llave esté completa.', { icon: 'ℹ️' });
                                                }
                                            }
                                        } catch (_) {}
                                    }}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val.length > 20 && (val.includes('.') || val.includes('\n') || val.includes('eyJ'))) {
                                            setKey(extractAndCleanLicenseKey(val));
                                        } else {
                                            setKey(val);
                                        }
                                        if (errorMessage) setErrorMessage('');
                                    }}
                                    placeholder={
                                        isConnectionError 
                                            ? 'CONECTA AL SERVIDOR PRIMERO' 
                                            : 'Pega aquí la llave recibida (o presiona el botón "Pegar")...'
                                    }
                                    disabled={isConnectionError || loading}
                                    className="w-full bg-slate-950 border border-slate-700/80 focus:border-blue-500 rounded-xl p-3 text-white font-mono text-xs outline-none transition-colors placeholder:text-slate-500 resize-none leading-relaxed disabled:opacity-40 select-text"
                                    required
                                />
                            </div>

                            {/* Key length and validation feedback helper */}
                            <div className="flex justify-between items-center px-1 text-[11px]">
                                {key.trim() ? (
                                    <>
                                        <span className="text-slate-400 font-mono">
                                            {key.trim().length} caracteres
                                        </span>
                                        {key.trim().length < 40 ? (
                                            <span className="text-amber-400 font-semibold flex items-center gap-1">
                                                <AlertTriangle size={12} />
                                                Incompleta (~150 carac. esperados)
                                            </span>
                                        ) : (
                                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                                <Check size={12} />
                                                Formato completo detectado
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-slate-500 text-[10px]">
                                            Tip: Mantén presionado para pegar con tu teclado.
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const promptVal = window.prompt('Pega aquí tu clave completa (mantén presionado y selecciona Pegar):');
                                                if (promptVal) {
                                                    const cleaned = extractAndCleanLicenseKey(promptVal);
                                                    setKey(cleaned);
                                                    if (cleaned.length >= 40) {
                                                        toast.success(`📋 Llave pegada (${cleaned.length} caracteres)`);
                                                    }
                                                }
                                            }}
                                            className="text-[10px] text-blue-400 underline hover:text-blue-300 ml-2 shrink-0 cursor-pointer"
                                        >
                                            Ventana de pegado
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Inline Error Message Banner */}
                        {errorMessage && (
                            <div className="bg-rose-950/80 border border-rose-500/60 rounded-xl p-3.5 flex items-start gap-2.5 text-rose-200 text-xs animate-in fade-in duration-200 shadow-md">
                                <AlertTriangle className="shrink-0 text-rose-400 mt-0.5" size={17} />
                                <div className="space-y-0.5 flex-1">
                                    <p className="font-bold text-rose-200">Error de Activación</p>
                                    <p className="leading-relaxed text-rose-300/90">{errorMessage}</p>
                                </div>
                            </div>
                        )}

                        {/* Main Activate Button (Vibrant Blue, High-contrast, Responsive) */}
                        <button 
                            type="submit"
                            disabled={loading || isConnectionError}
                            className={`w-full h-12 rounded-xl flex items-center justify-center gap-2 font-black text-sm tracking-wide transition-all shadow-lg cursor-pointer ${
                                !key.trim() 
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60' 
                                    : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-blue-600/30 active:scale-[0.99]'
                            }`}
                        >
                            {loading ? (
                                <>
                                    <RefreshCw className="animate-spin" size={18} />
                                    <span>Validando y Activando...</span>
                                </>
                            ) : (
                                <>
                                    <span>
                                        {machineId.startsWith('TERM-') 
                                            ? 'Activar Terminal / Cajero' 
                                            : 'Activar Sistema Isaac POS'}
                                    </span>
                                    <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>

            {/* ENTERPRISE SERVER IP & LAN CLUSTER CONFIG MODAL */}
            <ServerConfigModal 
                isOpen={showConfig}
                initialIp={serverIp}
                onClose={() => setShowConfig(false)}
                onConfigSaved={(newIp) => {
                    setServerIp(newIp);
                    if (typeof checkLicense === 'function') checkLicense();
                }}
            />
        </div>
    );
}
