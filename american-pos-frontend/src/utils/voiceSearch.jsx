import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Download, Copy, X, CheckCircle2, ExternalLink } from 'lucide-react';
import { triggerHaptic } from './haptics';
import { playScanSound } from './sounds';

/**
 * Limpia el texto dictado por voz eliminando signos de puntuación finales
 * y prefijos verbales comunes ("buscar...", "búscame...").
 */
export function cleanSpokenQuery(rawText = '') {
  let clean = String(rawText || '')
    .trim()
    .replace(/^[¿¡"'«»]+|[.?!,;:;'"»«]+$/g, '')
    .trim();

  // Si el usuario dice "buscar harina pan" o "busca azúcar", extraer solo el término
  clean = clean.replace(/^(?:buscar|busca|búscame|buscame|encontrar|filtrar)\s+/i, '').trim();
  return clean;
}

let activeWebRecognition = null;

function getApkDownloadUrl() {
  try {
    const saved = localStorage.getItem('pos_server_url');
    if (saved && saved.startsWith('http')) {
      return `${saved.replace(/\/+$/, '').replace(/\/api$/, '')}/Isaac-POS-Mobile.apk`;
    }
  } catch (_) {}
  return 'http://192.168.1.2:3005/Isaac-POS-Mobile.apk';
}

function getAndroidIntentUrl(httpUrl) {
  try {
    const u = new URL(httpUrl);
    const scheme = u.protocol.replace(':', '');
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
  } catch (_) {
    return httpUrl;
  }
}

/**
 * Inicia el dictado por voz usando el motor nativo de Android (Capacitor)
 * o Web Speech API (Chrome / Safari / Edge) como respaldo automático.
 */
export async function startVoiceDictation({
  prompt = 'Di el nombre del producto o código...',
  language = 'es-VE',
  onInterimResult,
  onFinalResult,
  onStateChange,
  onError,
  onNeedsApkUpdate
} = {}) {
  // Si ya hay una sesión Web Speech activa, detenerla
  if (activeWebRecognition) {
    try {
      activeWebRecognition.stop();
    } catch (_) {}
    activeWebRecognition = null;
    onStateChange?.(false);
    return;
  }

  triggerHaptic('medium');

  const isNativeAndroid = Boolean(
    typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
  );
  const nativePlugin = window.Capacitor?.Plugins?.PosNativeHardware;

  // 1. PRIORIDAD NATIVA ANDROID (APK actualizado con permiso RECORD_AUDIO y RecognizerIntent)
  if (isNativeAndroid && nativePlugin) {
    try {
      onStateChange?.(true);
      try {
        await nativePlugin.ensureMicrophonePermission();
      } catch (_permErr) {
        // Si ensureMicrophonePermission no está implementado en el APK viejo, continuará a startVoiceRecognition
      }
      const res = await nativePlugin.startVoiceRecognition({
        prompt,
        language
      });
      onStateChange?.(false);
      if (res && res.success && res.text) {
        const cleaned = cleanSpokenQuery(res.text);
        if (cleaned) {
          triggerHaptic('light');
          playScanSound();
          onFinalResult?.(cleaned);
        }
        return;
      }
      if (res && res.cancelled) {
        return;
      }
    } catch (nativeErr) {
      onStateChange?.(false);
      const errMsg = String(nativeErr?.message || nativeErr || '');
      // En Capacitor, PosNativeHardware es un Proxy JS. Si el APK instalado es anterior,
      // lanza "not implemented on android" o código UNIMPLEMENTED.
      if (
        errMsg.toLowerCase().includes('not implemented') ||
        errMsg.toLowerCase().includes('unimplemented') ||
        nativeErr?.code === 'UNIMPLEMENTED'
      ) {
        if (onNeedsApkUpdate) {
          onNeedsApkUpdate();
          return;
        }
      } else {
        onError?.(errMsg || 'El motor de dictado por voz de Google está desactivado en este teléfono.');
        return;
      }
    }
  }

  // 2. FALLBACK WEB SPEECH API (Navegadores móviles Chrome / Safari / Desktop)
  const SpeechRecognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!SpeechRecognition) {
    onStateChange?.(false);
    if (isNativeAndroid && onNeedsApkUpdate) {
      onNeedsApkUpdate();
      return;
    }
    onError?.('Tu navegador no soporta dictado por voz directo. Usa la App instalada (APK) o Chrome.');
    return;
  }

  // Solicitar permiso de micrófono explícito en navegador si getUserMedia está disponible
  if (!isNativeAndroid && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (_permErr) {
      onStateChange?.(false);
      onError?.('Permiso de micrófono denegado en el navegador. Actívalo en el candado de la barra de direcciones.');
      return;
    }
  }

  try {
    const recognition = new SpeechRecognition();
    activeWebRecognition = recognition;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalCaptured = '';

    recognition.onstart = () => {
      onStateChange?.(true);
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        finalCaptured = cleanSpokenQuery(finalTranscript);
        if (finalCaptured) {
          triggerHaptic('light');
          playScanSound();
          onFinalResult?.(finalCaptured);
        }
      } else if (interimTranscript) {
        const cleanedInterim = cleanSpokenQuery(interimTranscript);
        if (cleanedInterim) {
          onInterimResult?.(cleanedInterim);
        }
      }
    };

    recognition.onerror = (event) => {
      activeWebRecognition = null;
      onStateChange?.(false);
      if (isNativeAndroid && onNeedsApkUpdate) {
        onNeedsApkUpdate();
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onError?.('Permiso de micrófono denegado. Habilita el micrófono para dictar por voz.');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        onError?.('No se pudo escuchar con claridad. Intenta de nuevo.');
      }
    };

    recognition.onend = () => {
      activeWebRecognition = null;
      onStateChange?.(false);
    };

    recognition.start();
  } catch (_err) {
    activeWebRecognition = null;
    onStateChange?.(false);
    if (isNativeAndroid && onNeedsApkUpdate) {
      onNeedsApkUpdate();
      return;
    }
    onError?.('No se pudo iniciar el micrófono de dictado.');
  }
}

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
    } catch (_) {}
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
