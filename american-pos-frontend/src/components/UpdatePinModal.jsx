import { useState, useEffect } from 'react';
import { Key, AlertTriangle, CheckCircle2, AlertCircle, Eye, EyeOff, Lock } from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function UpdatePinModal({
    isOpen,
    onClose,
    user,
    onSuccess
}) {
    const [currentPin, setCurrentPin] = useState('');
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);

    const hasExistingPin = Boolean(user?.hasPin || user?.supervisorPin || user?.hasSupervisorPin);
    const isCurrentPinValid = !hasExistingPin || (currentPin.length >= 4 && currentPin.length <= 6);
    const isPinLengthValid = pin.length >= 4 && pin.length <= 6;
    const isMatching = pin.length > 0 && confirmPin.length > 0 && pin === confirmPin;
    const hasMismatch = confirmPin.length > 0 && pin !== confirmPin;
    const canSubmit = isCurrentPinValid && isPinLengthValid && isMatching && !loading;

    useEffect(() => {
        if (isOpen) {
            setCurrentPin('');
            setPin('');
            setConfirmPin('');
            setShowPin(false);
        }
    }, [isOpen]);

    const handleUpdate = async (e) => {
        e.preventDefault();
        
        if (hasExistingPin && (!currentPin || currentPin.length < 4)) {
            return toast.error('Por favor ingresa el PIN actual del operador.');
        }

        if (pin !== confirmPin) {
            return toast.error('Los nuevos PINs no coinciden.');
        }

        if (pin.length < 4 || pin.length > 6) {
            return toast.error('El nuevo PIN debe tener entre 4 y 6 dígitos.');
        }

        try {
            setLoading(true);
            
            // Hashear nuevo PIN con SHA-256
            const buffer = new TextEncoder().encode(String(pin));
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashedPin = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

            // Hashear PIN actual con SHA-256 si existe
            let hashedCurrentPin = undefined;
            if (hasExistingPin && currentPin) {
                const currentBuffer = new TextEncoder().encode(String(currentPin));
                const currentHashBuffer = await crypto.subtle.digest('SHA-256', currentBuffer);
                hashedCurrentPin = Array.from(new Uint8Array(currentHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            }

            await api.post(`/users/${user.id}/supervisor-pin`, { 
                pin: hashedPin,
                currentPin: hashedCurrentPin 
            });
            
            toast.success('PIN de supervisor actualizado correctamente');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error al actualizar PIN');
        } finally {
            setLoading(false);
            setPin('');
            setConfirmPin('');
            setCurrentPin('');
        }
    };

    if (!isOpen || !user) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-md"
            className="p-5 sm:p-7 max-h-[92dvh] overflow-y-auto custom-scrollbar bg-white dark:bg-slate-950 pb-safe border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl"
        >
            <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-primary-600 text-white rounded-xl flex items-center justify-center mb-3 sm:mb-4 shadow-sm">
                    <Key size={24} />
                </div>
                
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">Gestión de PIN</h2>
                <p className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wider">
                    Operador: <span className="text-primary-500">{user.name || user.username}</span>
                </p>

                {hasExistingPin ? (
                    <span className="mt-2 px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20 inline-flex items-center gap-1.5">
                        <Lock size={11} /> PIN Activo — Se requiere PIN anterior
                    </span>
                ) : (
                    <span className="mt-2 px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1">
                        Sin PIN previo configurado
                    </span>
                )}

                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-500/20 rounded-xl flex gap-2.5 text-left">
                    <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase leading-relaxed">
                        Este PIN autoriza apertura de gaveta, descuentos y anulaciones. {hasExistingPin ? 'Ingresa el PIN anterior para verificar tu identidad.' : 'Asígnale una clave segura.'}
                    </p>
                </div>

                <form onSubmit={handleUpdate} className="w-full mt-5 space-y-4 text-left">
                    {/* Header bar con switch para ver/ocultar dígitos */}
                    <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            Claves Numéricas
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowPin(!showPin)}
                            className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500 hover:text-primary-500 transition-colors cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                            <span>{showPin ? 'Ocultar Dígitos' : 'Ver Dígitos'}</span>
                        </button>
                    </div>

                    {/* Campo 1: PIN Actual / Anterior (Solo visible si ya tiene PIN) */}
                    {hasExistingPin && (
                        <div className="p-3.5 bg-slate-50 dark:bg-slate-900 rounded-xl border border-amber-500/30 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Lock size={12} /> 1. PIN Anterior / Actual
                                </label>
                                {currentPin.length > 0 && (
                                    <span className={`text-[10px] font-bold ${currentPin.length >= 4 ? 'text-emerald-500' : 'text-amber-500'}`}>
                                        {currentPin.length} / 6 dígitos
                                    </span>
                                )}
                            </div>
                            <input
                                type={showPin ? "text" : "password"}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={currentPin}
                                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                className={`w-full bg-white dark:bg-slate-950 border rounded-lg px-4 py-2.5 font-bold text-center text-base outline-none transition-all ${
                                    showPin ? 'tracking-[0.3em] text-slate-900 dark:text-white' : 'tracking-[0.6em] text-slate-800 dark:text-white'
                                } ${
                                    currentPin.length >= 4 
                                        ? 'border-amber-500/80 focus:border-amber-500' 
                                        : 'border-slate-200 dark:border-slate-800 focus:border-amber-500'
                                }`}
                                placeholder={showPin ? "PIN actual" : "••••"}
                                maxLength={6}
                                required={hasExistingPin}
                                autoFocus
                            />
                        </div>
                    )}

                    {/* Campo 2: Nuevo PIN */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between ml-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                {hasExistingPin ? '2. Nuevo PIN (4-6 dígitos)' : 'Nuevo PIN (4-6 dígitos)'}
                            </label>
                            {pin.length > 0 && (
                                <span className={`text-[10px] font-bold ${isPinLengthValid ? 'text-emerald-500' : 'text-amber-500'}`}>
                                    {pin.length} / 6 dígitos
                                </span>
                            )}
                        </div>
                        <input
                            type={showPin ? "text" : "password"}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className={`w-full bg-slate-50 dark:bg-slate-900 border rounded-lg px-4 py-2.5 font-bold text-center text-base outline-none transition-all ${
                                showPin ? 'tracking-[0.3em] text-slate-900 dark:text-white' : 'tracking-[0.6em] text-slate-800 dark:text-white'
                            } ${
                                pin.length >= 4 
                                    ? 'border-slate-300 dark:border-slate-700 focus:border-primary-500' 
                                    : 'border-slate-200 dark:border-slate-800 focus:border-primary-500'
                            }`}
                            placeholder={showPin ? "Nuevo PIN" : "••••"}
                            maxLength={6}
                            required
                        />
                    </div>

                    {/* Campo 3: Confirmar Nuevo PIN */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between ml-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                {hasExistingPin ? '3. Confirmar Nuevo PIN' : 'Confirmar PIN'}
                            </label>
                            {confirmPin.length > 0 && (
                                <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                                    isMatching ? 'text-emerald-500' : 'text-red-500'
                                }`}>
                                    {isMatching ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                                    {isMatching ? 'Coincide' : 'Diferente'}
                                </span>
                            )}
                        </div>
                        <input
                            type={showPin ? "text" : "password"}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={confirmPin}
                            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className={`w-full bg-slate-50 dark:bg-slate-900 border rounded-lg px-4 py-2.5 font-bold text-center text-base outline-none transition-all ${
                                showPin ? 'tracking-[0.3em] text-slate-900 dark:text-white' : 'tracking-[0.6em] text-slate-800 dark:text-white'
                            } ${
                                isMatching
                                    ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-300 focus:border-emerald-500 shadow-sm'
                                    : hasMismatch
                                        ? 'border-red-500 bg-red-500/5 dark:bg-red-950/20 text-red-600 dark:text-red-300 focus:border-red-500 shadow-sm'
                                        : 'border-slate-200 dark:border-slate-800 focus:border-primary-500 text-slate-800 dark:text-white'
                            }`}
                            placeholder={showPin ? "Repetir PIN" : "••••"}
                            maxLength={6}
                            required
                        />
                    </div>

                    {/* Banner de Verificación en Tiempo Real */}
                    {confirmPin.length > 0 && (
                        <div className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all duration-200 animate-in fade-in ${
                            isMatching
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
                        }`}>
                            {isMatching ? (
                                <>
                                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                    <span>Los nuevos PINs coinciden ({pin.length} dígitos)</span>
                                </>
                            ) : (
                                <>
                                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                                    <span>Los códigos nuevos no coinciden.</span>
                                </>
                            )}
                        </div>
                    )}

                    <div className="flex gap-3 pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 min-h-[40px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold rounded-lg text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center cursor-pointer border border-slate-200 dark:border-slate-700"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className={`flex-1 py-2.5 min-h-[40px] font-semibold rounded-lg text-xs transition-colors flex items-center justify-center cursor-pointer shadow-sm ${
                                canSubmit
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-98'
                                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-60'
                            }`}
                        >
                            {loading ? 'Verificando...' : (isMatching ? '✓ Guardar PIN' : 'Guardar PIN')}
                        </button>
                    </div>
                </form>
            </div>
        </BaseModal>
    );
}
