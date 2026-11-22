// src/utils/sounds.js
// High-performance, zero-latency Web Audio API sound engine (0 KB external assets)

let audioCtx = null;
let soundMuted = null;

export const isSoundMuted = () => {
    if (typeof window === 'undefined') return false;
    if (soundMuted === null) {
        soundMuted = localStorage.getItem('pos_sound_muted') === 'true';
    }
    return soundMuted;
};

export const setSoundMuted = (muted) => {
    soundMuted = Boolean(muted);
    if (typeof window !== 'undefined') {
        localStorage.setItem('pos_sound_muted', String(soundMuted));
        window.dispatchEvent(new CustomEvent('pos-sound-mute-changed', { detail: { muted: soundMuted } }));
    }
    return soundMuted;
};

export const toggleSoundMute = () => {
    return setSoundMuted(!isSoundMuted());
};

function getAudioContext() {
    try {
        if (!audioCtx && typeof window !== 'undefined') {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    } catch {
        return null;
    }
}

// User-gesture touch unblock for mobile browsers/WebViews
if (typeof window !== 'undefined') {
    const unlockAudio = () => {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        window.removeEventListener('touchstart', unlockAudio);
        window.removeEventListener('click', unlockAudio);
    };
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('click', unlockAudio, { passive: true });
}

const playTone = (freq, type, duration, volume = 0.1, delay = 0) => {
    if (isSoundMuted()) return;

    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const startTime = ctx.currentTime + (delay > 0 ? delay : 0);
        const stopTime = startTime + duration;

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, startTime);
        
        gainNode.gain.setValueAtTime(volume, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, stopTime);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.onended = () => {
            try {
                oscillator.disconnect();
                gainNode.disconnect();
            } catch { /* Nodos de audio ya desconectados */ }
        };

        oscillator.start(startTime);
        oscillator.stop(stopTime);
    } catch (_err) {
        // Safe silent fallback
    }
};

/**
 * Professional Cashier / Barcode Scanner Beep (Honeywell/Zebra style)
 * High crisp frequency (1864 Hz) with lightning-fast decay
 */
export const playScanSound = () => {
    if (isSoundMuted()) return;
    playTone(1864.66, 'sine', 0.065, 0.18); // A#6 crisp register beep
    playTone(2093.00, 'sine', 0.045, 0.08, 0.015); // C7 harmonic overtone
};

/**
 * Premium Fintech Checkout Success Sound (Harmonic 4-note Arpeggio)
 */
export const playSuccessSound = () => {
    if (isSoundMuted()) return;
    const vol = 0.12;
    playTone(523.25, 'sine', 0.35, vol);        // C5
    playTone(659.25, 'sine', 0.35, vol, 0.05);  // E5
    playTone(783.99, 'sine', 0.35, vol, 0.10);  // G5
    playTone(1046.50, 'sine', 0.55, vol * 1.2, 0.15); // C6
};

/**
 * Error / Stock Warning Buzz (Dual low square tone)
 */
export const playErrorSound = () => {
    if (isSoundMuted()) return;
    playTone(220, 'square', 0.18, 0.06); 
    playTone(185, 'square', 0.22, 0.06, 0.04); 
};

/**
 * Item Removed / Cart Delete Sound (Soft descending frequency drop)
 */
export const playDeleteSound = () => {
    if (isSoundMuted()) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const startTime = ctx.currentTime;
        const duration = 0.10;
        const stopTime = startTime + duration;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(480, startTime);
        osc.frequency.exponentialRampToValueAtTime(140, stopTime);

        gain.gain.setValueAtTime(0.12, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, stopTime);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.onended = () => {
            try {
                osc.disconnect();
                gain.disconnect();
            } catch { /* Nodos de audio ya desconectados */ }
        };

        osc.start(startTime);
        osc.stop(stopTime);
    } catch { /* WebAudio opcional no disponible */ }
};

/**
 * Friendly Notification Bubble Pop
 */
export const playNotificationSound = () => {
    if (isSoundMuted()) return;
    playTone(600, 'sine', 0.08, 0.06);
    playTone(1200, 'sine', 0.06, 0.04, 0.02);
};

/**
 * Cash Drawer Solenoid Kick Sound
 */
export const playDrawerSound = () => {
    if (isSoundMuted()) return;
    playTone(160, 'sawtooth', 0.06, 0.05);
    playTone(95, 'sawtooth', 0.10, 0.05, 0.04);
};
