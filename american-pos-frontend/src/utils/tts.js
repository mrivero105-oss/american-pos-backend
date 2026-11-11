export const getBestVoice = (voices, gender = 'female') => {
    if (!voices || voices.length === 0) return null;
    try {
        const latamVoices = voices.filter(v => v.lang && ['es-VE', 'es-US', 'es-419', 'es-MX'].some(lang => v.lang.includes(lang)));
        const esVoices = voices.filter(v => v.lang && v.lang.includes('es'));
        
        const maleKeywords = ['male', 'pablo', 'raul', 'diego', 'jorge', 'carlos', 'hombre'];
        const femaleKeywords = ['female', 'sabina', 'monica', 'paulina', 'helena', 'zira', 'google', 'mujer'];
        const keywords = gender === 'male' ? maleKeywords : femaleKeywords;

        const findMatch = (voiceList) => {
            if (!voiceList || voiceList.length === 0) return undefined;
            return voiceList.find(v => v.name && keywords.some(kw => v.name.toLowerCase().includes(kw))) || voiceList[0];
        };

        return findMatch(latamVoices.length > 0 ? latamVoices : esVoices) || voices[0];
    } catch (e) {
        console.error("TTS Match Error", e);
        return voices[0];
    }
};

let speakTimeout = null;
let currentUtterance = null;

export const isVoiceEnabled = () => {
    if (typeof window === 'undefined') return false;
    const voiceSetting = localStorage.getItem('app_voice_enabled');
    if (voiceSetting === 'false') return false;
    if (voiceSetting === 'true') return true;
    const isMobile = window.innerWidth < 768;
    return !isMobile;
};

export const stopAI = () => {
    if (typeof window === 'undefined') return;
    if (speakTimeout) {
        clearTimeout(speakTimeout);
        speakTimeout = null;
    }
    if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
        currentUtterance = null;
    }
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    } catch (e) {
        // safe fallback
    }
};

export const setVoiceEnabledState = (enabled) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('app_voice_enabled', enabled ? 'true' : 'false');
    if (!enabled) {
        stopAI();
    }
    window.dispatchEvent(new CustomEvent('app-voice-changed', { detail: { enabled: !!enabled } }));
};

export const speakAI = (message) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    
    // Check if voice is enabled
    if (!isVoiceEnabled()) return;
    
    // Clear the previous timeout to debounce rapid successive calls
    if (speakTimeout) clearTimeout(speakTimeout);
    
    speakTimeout = setTimeout(() => {
        if (!isVoiceEnabled()) return;

        const setVoiceAndSpeak = () => {
            try {
                if (currentUtterance) {
                    currentUtterance.onend = null;
                    currentUtterance.onerror = null;
                    currentUtterance = null;
                }

                window.speechSynthesis.cancel(); 

                const utterance = new SpeechSynthesisUtterance(message);
                currentUtterance = utterance;
                utterance.lang = 'es-VE'; 
                utterance.rate = 1.15; 
                
                const savedVolume = localStorage.getItem('american_pos_ai_volume') || localStorage.getItem('isaac_pos_ai_volume');
                utterance.volume = savedVolume !== null ? parseFloat(savedVolume) : 1.0;
                if (utterance.volume < 0.05) return; 
    
                const savedGender = localStorage.getItem('american_pos_ai_gender') || localStorage.getItem('isaac_pos_ai_gender') || 'female';
                utterance.pitch = savedGender === 'male' ? 0.9 : 1.1; 
                
                const voices = window.speechSynthesis.getVoices();
                if (voices.length > 0) {
                    const voice = getBestVoice(voices, savedGender);
                    if (voice) utterance.voice = voice;
                }
                
                utterance.onend = () => {
                    currentUtterance = null;
                };
                utterance.onerror = () => {
                    currentUtterance = null;
                };

                window.speechSynthesis.speak(utterance);
            } catch (e) {
                console.warn("Habla IA notice:", e);
                currentUtterance = null;
            }
        };
    
        if (speechSynthesis.getVoices().length === 0) {
            speechSynthesis.addEventListener('voiceschanged', setVoiceAndSpeak, { once: true });
        } else {
            setVoiceAndSpeak();
        }
    }, 400);
};

export const testVoiceAI = (sampleText = 'Voz de Asistente IA de American POS activada y lista para trabajar.') => {
    stopAI();
    speakAI(sampleText);
};
