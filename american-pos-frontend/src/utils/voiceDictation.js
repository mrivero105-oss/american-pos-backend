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

  clean = clean.replace(/^(?:buscar|busca|búscame|buscame|encontrar|filtrar)\s+/i, '').trim();
  return clean;
}

let activeWebRecognition = null;

export function getApkDownloadUrl() {
  try {
    const saved = localStorage.getItem('pos_server_url') || localStorage.getItem('isaac_pos_server_ip');
    if (saved && saved.trim()) {
      const normalized = saved.trim().startsWith('http') ? saved.trim() : `http://${saved.trim()}`;
      return `${normalized.replace(/\/+$/, '').replace(/\/api$/, '')}/Isaac-POS-Mobile.apk`;
    }
    if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
      return `${window.location.origin}/Isaac-POS-Mobile.apk`;
    }
  } catch (err) {
    console.warn('[VoiceDictation] No se pudo resolver la URL del servidor APK:', err?.message);
  }
  return '/Isaac-POS-Mobile.apk';
}

export function getAndroidIntentUrl(httpUrl) {
  try {
    const u = new URL(httpUrl);
    const scheme = u.protocol.replace(':', '');
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
  } catch {
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
  if (activeWebRecognition) {
    try {
      activeWebRecognition.stop();
    } catch (stopErr) {
      console.warn('[VoiceDictation] Error deteniendo sesión previa:', stopErr?.message);
    }
    activeWebRecognition = null;
    onStateChange?.(false);
    return;
  }

  triggerHaptic('medium');

  const isNativeAndroid = Boolean(
    typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()
  );
  const nativePlugin = window.Capacitor?.Plugins?.PosNativeHardware;

  if (isNativeAndroid && nativePlugin) {
    try {
      onStateChange?.(true);
      try {
        await nativePlugin.ensureMicrophonePermission();
      } catch {
        // Si ensureMicrophonePermission no existe en un APK anterior, continúa hacia startVoiceRecognition.
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

  if (!isNativeAndroid && navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
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
  } catch {
    activeWebRecognition = null;
    onStateChange?.(false);
    if (isNativeAndroid && onNeedsApkUpdate) {
      onNeedsApkUpdate();
      return;
    }
    onError?.('No se pudo iniciar el micrófono de dictado.');
  }
}
