import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Fingerprint, KeyRound, X, CheckCircle2, AlertCircle, RefreshCw, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import biometricService from '../../services/biometricService';
import api from '../../services/api';
import { useAuth } from '../../hooks/AuthContext';

// Fallback SHA-256 en JS puro para contextos HTTP LAN donde crypto.subtle no está expuesto
function pureSha256Hex(asciiInput) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const bytes = new TextEncoder().encode(String(asciiInput || ''));
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const w = new Uint32Array(64);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (hh + S1 + ch + k[t] + w[t]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('');
}

async function computePinSha256Hex(rawPin) {
  const input = String(rawPin || '');
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const buffer = new TextEncoder().encode(input);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { /* Fallback JS puro */ }
  }
  return pureSha256Hex(input);
}

export default function SupervisorAuthModal({
  isOpen,
  onClose,
  onAuthorized,
  title = 'Autorización de Supervisor',
  reason = 'Esta acción requiere aprobación de supervisor',
  actionType = 'mobile_authorization',
  referenceId = null,
  isLight = false
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

  // Blindaje anti-captura (FLAG_SECURE) mientras el modal de PIN de supervisor está abierto
  useEffect(() => {
    const plugin = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
      ? window.Capacitor?.Plugins?.PosNativeHardware
      : null;
    if (!plugin?.setScreenSecure) return undefined;
    if (isOpen) {
      plugin.setScreenSecure({ secure: true }).catch(() => {});
      return () => {
        plugin.setScreenSecure({ secure: false }).catch(() => {});
      };
    }
    return undefined;
  }, [isOpen]);

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
      const hashedPin = await computePinSha256Hex(candidatePin);

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

  const enrolledBio = biometricService.getEnrolledCredential();
  const canUseBiometric = Boolean(
    hasBiometricSensor &&
    currentUser &&
    selectedSupervisorId &&
    String(currentUser.id) === String(selectedSupervisorId) &&
    ['supervisor', 'admin', 'owner', 'superadmin'].includes(String(currentUser.role || '').toLowerCase()) &&
    enrolledBio?.keyAlias &&
    String(enrolledBio.userId) === String(selectedSupervisorId) &&
    biometricService.isNativeHardwareBiometricAvailable()
  );

  // Firma biométrica ECDSA P-256 v2 sobre reto de un solo uso (solo si el supervisor es el titular de la sesión)
  const triggerBiometric = useCallback(async () => {
    if (!canUseBiometric) {
      setError('Por seguridad Zero-Trust, ingrese el PIN del supervisor.');
      return;
    }
    setIsBiometricAttempting(true);
    setLoading(true);
    setError('');
    try {
      const supObj = supervisors.find(s => String(s.id) === String(selectedSupervisorId)) || currentUser;
      const { challengeId, signature } = await biometricService.signSupervisorBiometricChallenge(supObj, {
        title,
        subtitle: reason
      });
      const { data } = await api.post('/auth/supervisor-authorize', {
        supervisorId: selectedSupervisorId,
        isBiometric: true,
        challengeId,
        signature,
        actionType,
        referenceId
      }, { timeout: 6000 });
      biometricService.triggerHaptic('success');
      onAuthorized?.(data);
      onClose();
    } catch (err) {
      biometricService.triggerHaptic('error');
      const serverMsg = err.response?.data?.message || err.response?.data?.error;
      setError(serverMsg || err.message || 'Verificación biométrica no completada. Ingresa tu PIN.');
    } finally {
      setIsBiometricAttempting(false);
      setLoading(false);
    }
  }, [canUseBiometric, supervisors, selectedSupervisorId, currentUser, title, reason, actionType, referenceId, onAuthorized, onClose]);

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
          role="dialog"
          aria-modal="true"
          aria-label={title || 'Autorización de Supervisor'}
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
              type="button"
              onClick={onClose}
              disabled={loading}
              aria-label="Cerrar autorización de supervisor"
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
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

          {/* Botón de Huella ECDSA v2 solo cuando el supervisor es el titular de la sesión */}
          {canUseBiometric && (
            <button
              type="button"
              onClick={triggerBiometric}
              disabled={isBiometricAttempting || loading}
              className="w-full py-2.5 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-400 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-colors shadow-sm"
            >
              <Fingerprint size={18} className={isBiometricAttempting ? 'animate-pulse text-blue-300' : ''} />
              <span>{isBiometricAttempting ? 'Esperando Huella Digital...' : 'Autorizar con Huella (ECDSA v2)'}</span>
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
