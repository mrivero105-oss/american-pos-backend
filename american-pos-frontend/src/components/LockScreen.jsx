import { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Unlock, LogOut, Fingerprint, Eye, EyeOff } from 'lucide-react';
import biometricService from '../services/biometricService';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

const LockScreen = ({ user, onUnlock, onLogout }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    document.body.dataset.screenLocked = 'true';
    biometricService.checkSupport().then(supported => {
      setHasBiometrics(Boolean(supported));
    });
    return () => {
      delete document.body.dataset.screenLocked;
    };
  }, []);

  useEffect(() => {
    if (!lockoutUntil) {
      setSecondsLeft(0);
      return undefined;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setLockoutUntil(0);
        setFailedAttempts(0);
        setError('');
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const isLockedOut = lockoutUntil > Date.now();

  const handleUnlockAttempt = useCallback(async (valueToVerify) => {
    const val = valueToVerify ?? password;
    if (isLockedOut || loading || !val) return;

    setLoading(true);
    setError('');

    try {
      const result = await onUnlock(val);
      if (result?.success) {
        setPassword('');
        setFailedAttempts(0);
        return;
      }

      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      setPassword('');

      if (nextAttempts >= MAX_ATTEMPTS) {
        setLockoutUntil(Date.now() + LOCKOUT_SECONDS * 1000);
        setError(`Demasiados intentos. Espera ${LOCKOUT_SECONDS} segundos.`);
      } else {
        setError(result?.message || 'PIN o contraseña incorrecta');
      }
    } catch {
      setError('Error al verificar la clave');
      setPassword('');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [isLockedOut, loading, password, onUnlock, failedAttempts]);

  const handleSubmit = (e) => {
    e.preventDefault();
    handleUnlockAttempt();
  };

  const handleBiometricUnlock = async () => {
    if (isLockedOut || loading) return;
    setError('');
    try {
      setLoading(true);
      const enrolledCred = biometricService.getEnrolledCredential();
      if (!enrolledCred?.biometricToken || (user?.id && enrolledCred.userId && String(enrolledCred.userId) !== String(user.id))) {
        setError('La huella almacenada no coincide con el usuario activo. Ingresa tu PIN o contraseña.');
        return;
      }

      const bioResult = await biometricService.authenticate({
        title: 'Desbloquear Isaac POS',
        subtitle: `Verificación para ${user?.name || 'Usuario'}`
      });
      if (bioResult?.success) {
        const result = await onUnlock(enrolledCred.biometricToken, true);
        if (!result?.success) {
          setError(result?.message || 'Error al restaurar sesión');
        }
      }
    } catch (err) {
      setError(err.message || 'Verificación biométrica no completada');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="max-w-sm w-full my-auto bg-white dark:bg-slate-900 rounded-xl shadow-xl p-6 text-center border border-slate-200 dark:border-slate-800 relative overflow-hidden">
        <div className="relative z-10">
          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg flex items-center justify-center mx-auto mb-3 border border-slate-200 dark:border-slate-700">
            <Lock size={24} />
          </div>

          <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-0.5 tracking-tight">Caja Bloqueada</h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-4 font-normal">
            Cajero: <span className="text-slate-800 dark:text-slate-200 font-semibold">{user?.name || user?.username || 'Usuario'}</span>
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="relative">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setError('');
                  setPassword(e.target.value);
                }}
                placeholder="Ingresa tu PIN o clave"
                autoFocus
                disabled={isLockedOut}
                className={`w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-950 border ${
                  error ? 'border-red-500' : 'border-slate-300 dark:border-slate-700'
                } rounded-lg text-center text-base font-mono font-bold tracking-widest text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 transition-colors disabled:opacity-50`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 transition-colors cursor-pointer"
                title={showPassword ? "Ocultar clave" : "Mostrar clave"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {error && (
                <p className="text-red-500 text-xs font-semibold mt-1.5">{error}</p>
              )}
              {isLockedOut && secondsLeft > 0 && (
                <p className="text-amber-500 text-xs font-semibold mt-1.5">
                  Demasiados intentos. Espera {secondsLeft}s
                </p>
              )}
              {!isLockedOut && failedAttempts > 0 && (
                <p className="text-slate-400 text-[10px] font-semibold mt-1 uppercase tracking-wider">
                  Intentos fallidos: {failedAttempts}/{MAX_ATTEMPTS}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !password || isLockedOut}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white rounded-lg font-bold text-xs uppercase tracking-wider shadow-xs flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Unlock size={15} /> Desbloquear
                </>
              )}
            </button>

            {hasBiometrics && (
              <button
                type="button"
                onClick={handleBiometricUnlock}
                disabled={loading || isLockedOut}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <Fingerprint size={15} className="text-primary-500" />
                Huella Digital
              </button>
            )}
          </form>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-center">
            <button 
              onClick={onLogout}
              className="flex items-center gap-1.5 p-1.5 text-xs font-semibold uppercase text-slate-500 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
            >
              <LogOut size={13} /> Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LockScreen;
