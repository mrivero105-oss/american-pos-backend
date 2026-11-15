import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Fingerprint, KeyRound, X, CheckCircle2, AlertCircle, RefreshCw, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import biometricService from '../../services/biometricService';
import api from '../../services/api';
import { useAuth } from '../../hooks/AuthContext';

export default function SupervisorAuthModal({
  isOpen,
  onClose,
  onAuthorized,
  title = 'Autorización de Supervisor',
  reason = 'Esta acción requiere aprobación de supervisor',
  actionType = 'mobile_authorization',
  referenceId = null,
  isLight = false,
  T = {}
}) {
  const { user: currentUser } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [supervisors, setSupervisors] = useState([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState('');
  const [isBiometricAttempting, setIsBiometricAttempting] = useState(false);
  const [hasBiometricSensor, setHasBiometricSensor] = useState(false);

  // Cargar lista de supervisores reales desde el servidor
  useEffect(() => {
    if (!isOpen) {
      setPin('');
      setError('');
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Verificar sensor biométrico
    biometricService.checkSupport().then(supported => {
      if (isMounted) setHasBiometricSensor(supported);
    }).catch(() => {
      if (isMounted) setHasBiometricSensor(false);
    });

    // Cargar supervisores autorizados
    const fetchSupervisors = async () => {
      try {
        const { data } = await api.get('/auth/supervisors');
        if (!isMounted) return;
        const list = Array.isArray(data) ? data : [];
        setSupervisors(list);

        // Pre-seleccionar automáticamente al usuario actual si es supervisor/admin
        if (currentUser && list.some(s => String(s.id) === String(currentUser.id))) {
          setSelectedSupervisorId(String(currentUser.id));
        } else if (list.length > 0) {
          setSelectedSupervisorId(String(list[0].id));
        }
      } catch (err) {
        console.warn('[SupervisorAuth] Error al consultar supervisores en servidor:', err.message);
        // Fallback local: Si el usuario actual es admin o supervisor
        if (currentUser && ['admin', 'superadmin', 'supervisor', 'owner'].includes((currentUser.role || '').toLowerCase())) {
          setSupervisors([currentUser]);
          setSelectedSupervisorId(String(currentUser.id));
        }
      }
    };

    fetchSupervisors();

    return () => { isMounted = false; };
  }, [isOpen, currentUser]);

  // Ejecución segura de verificación en servidor con SHA-256 (PIN obligatorio)
  const executeAuthorization = useCallback(async (candidatePin) => {
    if (!selectedSupervisorId) {
      setError('Seleccione un supervisor responsable');
      return;
    }
    if (!candidatePin || String(candidatePin).trim().length < 4) {
      setError('Ingrese el PIN de autorización del supervisor (4 a 6 dígitos)');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const buffer = new TextEncoder().encode(String(candidatePin));
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashedPin = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const { data } = await api.post('/auth/supervisor-authorize', {
        supervisorId: selectedSupervisorId || currentUser?.id,
        pin: hashedPin,
        isBiometric: false,
        actionType,
        referenceId
      }, { timeout: 6000 });

      biometricService.triggerHaptic('success');
      onAuthorized?.(data);
      onClose();
    } catch (err) {
      biometricService.triggerHaptic('error');
      const serverMsg = err.response?.data?.message || err.response?.data?.error;

      // Si estamos 100% offline y el servidor es inalcanzable: no fabricar aprobaciones offline falsas
      if ((err.code === 'ECONNABORTED' || !navigator.onLine) && !err.response) {
        setError('Sin conexión al servidor para validar y firmar autorización de supervisor.');
      } else {
        setError(serverMsg || 'PIN incorrecto o no autorizado');
      }

      setTimeout(() => setPin(''), 500);
    } finally {
      setLoading(false);
    }
  }, [selectedSupervisorId, currentUser, actionType, referenceId, onAuthorized, onClose]);

  // La biometría local del dispositivo del cajero no puede suplantar el PIN criptográfico del supervisor
  const triggerBiometric = useCallback(async () => {
    setError('Por seguridad Zero-Trust, ingrese el PIN del supervisor.');
    setIsBiometricAttempting(false);
  }, []);

  useEffect(() => {
    // El PIN del supervisor se solicita directamente sin disparar biometría del cajero
  }, [isOpen, hasBiometricSensor]);

  // Manejo de teclado de PIN numérico (Soporta 4 a 6 dígitos con auto-envío en 6 o botón confirmar en 4+)
  const handleKeyPress = (num) => {
    if (loading) return;
    setError('');
    biometricService.triggerHaptic('success');
    if (pin.length < 6) {
      const newPin = pin + num;
      setPin(newPin);
      // Si alcanza la longitud máxima de 6 dígitos, auto-envío inmediato
      if (newPin.length === 6) {
        executeAuthorization(newPin);
      }
    }
  };

  const handleDelete = () => {
    if (loading) return;
    biometricService.triggerHaptic('success');
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    if (loading) return;
    biometricService.triggerHaptic('success');
    setPin('');
    setError('');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[250000] flex items-end sm:items-center justify-center p-0 sm:p-4">
        {/* Backdrop táctil */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 cursor-pointer"
        />

        {/* Panel Bottom Sheet / Modal */}
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-sm rounded-t-xl sm:rounded-xl p-5 shadow-2xl relative z-10 border-t sm:border border-slate-800 flex flex-col space-y-4 select-none ${
            isLight ? 'bg-white text-slate-900' : 'bg-slate-950 text-white'
          }`}
        >
          {/* Cabecera */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/25 shrink-0">
                <ShieldAlert size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-amber-400 uppercase tracking-wider truncate">{title}</h3>
                <p className="text-[11px] text-slate-400 truncate max-w-[210px]">{reason}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          {/* Selector de Supervisor si hay más de 1 disponible */}
          {supervisors.length > 1 && (
            <div className="flex items-center gap-2 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
              <UserCheck size={14} className="text-amber-400 shrink-0 ml-1" />
              <select
                value={selectedSupervisorId}
                onChange={(e) => setSelectedSupervisorId(e.target.value)}
                disabled={loading}
                className="w-full bg-transparent text-xs font-bold text-slate-200 outline-none cursor-pointer"
              >
                {supervisors.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                    {s.name || s.username} ({s.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Botón de Huella / Face Unlock si hay soporte */}
          {hasBiometricSensor && (
            <button
              type="button"
              onClick={triggerBiometric}
              disabled={isBiometricAttempting || loading}
              className="w-full py-2.5 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-400 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-colors shadow-sm"
            >
              <Fingerprint size={18} className={isBiometricAttempting ? 'animate-pulse text-blue-300' : ''} />
              <span>{isBiometricAttempting ? 'Esperando Huella Digital...' : 'Tocar Lector de Huellas'}</span>
            </button>
          )}

          {/* Indicador de Dígitos PIN (Masked Dots) */}
          <div className="flex flex-col items-center space-y-2 py-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <KeyRound size={12} />
              <span>Ingresa PIN de Supervisor</span>
            </span>

            <div className="flex items-center justify-center gap-2.5 py-1">
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const filled = pin.length > idx;
                return (
                  <div
                    key={idx}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                      filled
                        ? 'bg-amber-400 scale-110 shadow-md shadow-amber-400/50'
                        : 'border-2 border-slate-700 bg-slate-900'
                    }`}
                  />
                );
              })}
            </div>

            {loading ? (
              <p className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5 animate-fadeIn">
                <RefreshCw size={12} className="animate-spin" />
                <span>Verificando credenciales con servidor...</span>
              </p>
            ) : error ? (
              <p className="text-[11px] font-bold text-rose-400 flex items-center gap-1 animate-fadeIn text-center px-2">
                <AlertCircle size={13} className="shrink-0" />
                <span>{error}</span>
              </p>
            ) : (
              <p className="text-[10px] text-slate-500">Autorización auditada con registro criptográfico</p>
            )}
          </div>

          {/* Teclado Numérico en Pantalla */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                disabled={loading}
                onClick={() => handleKeyPress(String(num))}
                className="h-12 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-lg font-bold text-white active:scale-95 transition-colors flex items-center justify-center cursor-pointer shadow-sm disabled:opacity-50"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              disabled={loading}
              onClick={handleClear}
              className="h-12 rounded-lg bg-slate-900/50 hover:bg-slate-800 border border-slate-800/80 text-xs font-bold text-slate-400 active:scale-95 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              LIMPIAR
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleKeyPress('0')}
              className="h-12 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-lg font-bold text-white active:scale-95 transition-colors flex items-center justify-center cursor-pointer shadow-sm disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleDelete}
              className="h-12 rounded-lg bg-slate-900/50 hover:bg-slate-800 border border-slate-800/80 text-xs font-bold text-slate-400 active:scale-95 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              ⌫
            </button>
          </div>

          {/* Botón de Confirmación Manual (Activo cuando el PIN tiene entre 4 y 6 dígitos) */}
          <button
            type="button"
            disabled={loading || pin.length < 4}
            onClick={() => executeAuthorization(pin)}
            className={`w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md ${
              pin.length >= 4 && !loading
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-amber-500/25 active:scale-98'
                : 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed opacity-50'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Verificando PIN de Supervisor...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>Autorizar Acción {pin.length >= 4 ? `(${pin.length}/6)` : '(4 a 6 dígitos)'}</span>
              </>
            )}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
