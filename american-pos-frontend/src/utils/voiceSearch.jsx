import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Download, Copy, X, CheckCircle2 } from 'lucide-react';
import { triggerHaptic } from './haptics';
import {
  startVoiceDictation,
  getApkDownloadUrl,
  getAndroidIntentUrl
} from './voiceDictation';

/**
 * Botón reutilizable de Micrófono para barras de búsqueda móviles.
 */
export function VoiceMicButton({
  onResult,
  onError,
  prompt = 'Di el nombre del producto o código...',
  className = '',
  size = 14
}) {
  const [isListening, setIsListening] = useState(false);
  const [showApkUpgradePrompt, setShowApkUpgradePrompt] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handlePress = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    startVoiceDictation({
      prompt,
      onInterimResult: (text) => {
        if (mountedRef.current) onResult?.(text);
      },
      onFinalResult: (text) => {
        if (mountedRef.current) onResult?.(text);
      },
      onStateChange: (listening) => {
        if (mountedRef.current) setIsListening(listening);
      },
      onError: (msg) => {
        if (mountedRef.current && onError) onError(msg);
      },
      onNeedsApkUpdate: () => {
        if (mountedRef.current) setShowApkUpgradePrompt(true);
      }
    });
  };

  const apkUrl = getApkDownloadUrl();
  const intentUrl = getAndroidIntentUrl(apkUrl);

  const handleCopyApkUrl = async () => {
    triggerHaptic('light');
    try {
      if (window.Capacitor?.Plugins?.PosNativeHardware?.copyToClipboard) {
        await window.Capacitor.Plugins.PosNativeHardware.copyToClipboard({ text: apkUrl });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(apkUrl);
      }
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch (err) {
      console.warn('[VoiceMicButton] No se pudo copiar la URL del APK:', err?.message);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handlePress}
        title={isListening ? 'Escuchando... toca para detener' : 'Buscar dictando por voz'}
        className={`p-1 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 active:scale-90 ${
          isListening
            ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/40'
            : 'text-blue-500 dark:text-blue-400 hover:bg-blue-500/15'
        } ${className}`}
      >
        <Mic size={size} />
      </button>

      {showApkUpgradePrompt &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
            <div className="w-full max-w-sm bg-slate-900 border border-blue-500/40 rounded-2xl p-5 shadow-2xl text-white space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                    <Mic size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wide text-white">
                      Activar Permiso de Micrófono
                    </h3>
                    <p className="text-[11px] text-blue-400 font-bold">
                      Se requiere actualizar el instalador APK
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowApkUpgradePrompt(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-300 space-y-2 leading-relaxed">
                <p>
                  El APK que tienes instalado fue compilado antes de agregar el permiso de <b className="text-white">Micrófono</b>. Por eso Android aún no te muestra el permiso de Micrófono en los ajustes de Isaac POS.
                </p>
                <p className="text-[11px] text-slate-400">
                  Descarga e instala el nuevo APK desde tu PC tocando el botón de abajo (o abriendo el enlace en Chrome):
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <a
                  href={intentUrl}
                  onClick={() => {
                    triggerHaptic('medium');
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all no-underline"
                >
                  <Download size={16} />
                  <span>Abrir en Chrome y Descargar APK</span>
                </a>

                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-[10.5px] font-mono text-blue-300 truncate">{apkUrl}</span>
                  <button
                    type="button"
                    onClick={handleCopyApkUrl}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-white flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Copy size={12} />
                    <span>{copiedUrl ? '¡Copiado!' : 'Copiar'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300">
                  <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                  <span>Instálalo encima del actual; no perderás tus datos ni configuración.</span>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
