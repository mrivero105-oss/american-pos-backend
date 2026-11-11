import { useState } from 'react';
import { Volume2, VolumeX, Mic, Bell, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTheme } from '../../hooks/ThemeContext';
import { stopAI, testVoiceAI } from '../../utils/tts';
import { isSoundMuted, setSoundMuted, playSuccessSound } from '../../utils/sounds';

export default function VoiceSoundSettings() {
    const { voiceEnabled, setVoiceEnabled } = useTheme();

    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('american_pos_ai_volume') || localStorage.getItem('isaac_pos_ai_volume');
        return saved !== null ? Math.round(parseFloat(saved) * 100) : 100;
    });

    const [gender, setGender] = useState(() => {
        return localStorage.getItem('american_pos_ai_gender') || localStorage.getItem('isaac_pos_ai_gender') || 'female';
    });

    const [soundsActive, setSoundsActive] = useState(() => !isSoundMuted());
    const [isPlayingTest, setIsPlayingTest] = useState(false);

    const handleToggleVoice = (next) => {
        setVoiceEnabled(next);
        if (!next) {
            stopAI();
            toast('Locución desactivada');
        } else {
            toast.success('Locución activada');
        }
    };

    const handleVolumeChange = (e) => {
        const val = parseInt(e.target.value, 10);
        setVolume(val);
        const floatVal = (val / 100).toFixed(2);
        localStorage.setItem('american_pos_ai_volume', floatVal);
        localStorage.setItem('isaac_pos_ai_volume', floatVal);
    };

    const handleGenderChange = (newGender) => {
        setGender(newGender);
        localStorage.setItem('american_pos_ai_gender', newGender);
        localStorage.setItem('isaac_pos_ai_gender', newGender);
        toast.success(`Tono de voz: ${newGender === 'female' ? 'Femenino' : 'Masculino'}`);
    };

    const handleToggleSounds = (next) => {
        setSoundsActive(next);
        setSoundMuted(!next);
        if (next) {
            playSuccessSound();
            toast.success('Efectos sonoros activados');
        } else {
            toast('Efectos sonoros silenciados');
        }
    };

    const handleTestVoice = () => {
        if (!voiceEnabled) {
            toast.error('Activa primero la locución para reproducir');
            return;
        }
        setIsPlayingTest(true);
        testVoiceAI('Asistente de voz de Isaac POS configurado correctamente.');
        setTimeout(() => setIsPlayingTest(false), 2500);
    };

    const handleTestBeep = () => {
        if (!soundsActive) {
            toast.error('Activa los sonidos del sistema para probar');
            return;
        }
        playSuccessSound();
    };

    return (
        <div className="space-y-6">
            {/* Header de la sección */}
            <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Voz del Asistente y Efectos Sonoros
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Configuración de locuciones en caja y tonos de confirmación del escáner
                </p>
            </div>

            {/* Dos bloques principales de configuración */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Bloque 1: Locución de Voz */}
                <div className="p-5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 flex flex-col justify-between space-y-4">
                    <div className="space-y-3.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    voiceEnabled 
                                        ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400' 
                                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                                }`}>
                                    <Mic size={16} />
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                                        Locución de Ventas y Avisos
                                    </h4>
                                    <span className="text-[11px] text-slate-400">
                                        {voiceEnabled ? 'Habilitada' : 'Deshabilitada'}
                                    </span>
                                </div>
                            </div>

                            {/* Interruptor tipo Switch */}
                            <button
                                type="button"
                                role="switch"
                                aria-checked={voiceEnabled}
                                onClick={() => handleToggleVoice(!voiceEnabled)}
                                className={`w-11 h-6 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                                    voiceEnabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                            >
                                <span
                                    className={`bg-white w-5 h-5 rounded-full shadow-xs transform transition-transform ${
                                        voiceEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            Reproduce avisos audibles automáticos en español al cobrar o guardar ventas en el terminal.
                        </p>

                        {/* Selector de Tono */}
                        <div className="pt-1">
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                                Tono de voz
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    disabled={!voiceEnabled}
                                    onClick={() => handleGenderChange('female')}
                                    className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                                        gender === 'female'
                                            ? 'bg-white dark:bg-slate-800 border-primary-500 text-primary-600 dark:text-primary-400 shadow-2xs'
                                            : 'bg-white/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                                    } ${!voiceEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                >
                                    Femenino
                                </button>
                                <button
                                    type="button"
                                    disabled={!voiceEnabled}
                                    onClick={() => handleGenderChange('male')}
                                    className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                                        gender === 'male'
                                            ? 'bg-white dark:bg-slate-800 border-primary-500 text-primary-600 dark:text-primary-400 shadow-2xs'
                                            : 'bg-white/60 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                                    } ${!voiceEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                >
                                    Masculino
                                </button>
                            </div>
                        </div>

                        {/* Slider de Volumen */}
                        <div className="pt-1">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                    Volumen de locución
                                </span>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                                    {volume}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min="10"
                                max="100"
                                step="5"
                                value={volume}
                                disabled={!voiceEnabled}
                                onChange={handleVolumeChange}
                                className="w-full accent-primary-600 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg cursor-pointer disabled:opacity-40"
                            />
                        </div>
                    </div>

                    {/* Botón de Prueba */}
                    <div className="pt-2">
                        <button
                            type="button"
                            disabled={!voiceEnabled || isPlayingTest}
                            onClick={handleTestVoice}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Play size={13} className={isPlayingTest ? 'text-primary-500 animate-pulse' : 'text-slate-500'} />
                            <span>{isPlayingTest ? 'Reproduciendo audio...' : 'Probar locución de voz'}</span>
                        </button>
                    </div>
                </div>

                {/* Bloque 2: Efectos Sonoros */}
                <div className="p-5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 flex flex-col justify-between space-y-4">
                    <div className="space-y-3.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    soundsActive 
                                        ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400' 
                                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                                }`}>
                                    <Bell size={16} />
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                                        Efectos Sonoros y Alertas
                                    </h4>
                                    <span className="text-[11px] text-slate-400">
                                        {soundsActive ? 'Habilitados' : 'Silenciados'}
                                    </span>
                                </div>
                            </div>

                            {/* Interruptor tipo Switch */}
                            <button
                                type="button"
                                role="switch"
                                aria-checked={soundsActive}
                                onClick={() => handleToggleSounds(!soundsActive)}
                                className={`w-11 h-6 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                                    soundsActive ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                            >
                                <span
                                    className={`bg-white w-5 h-5 rounded-full shadow-xs transform transition-transform ${
                                        soundsActive ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                            Tonos de confirmación acústica inmediatos para escaneo de códigos de barra y cobro exitoso.
                        </p>

                        <div className="p-3 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-xs space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-500 dark:text-slate-400">Lectura de código</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-300">Tono de confirmación</span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-200/50 dark:border-slate-800">
                                <span className="text-slate-500 dark:text-slate-400">Venta cobrada</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-300">Tono armónico</span>
                            </div>
                        </div>
                    </div>

                    {/* Botón de Prueba sin Sparkles */}
                    <div className="pt-2">
                        <button
                            type="button"
                            disabled={!soundsActive}
                            onClick={handleTestBeep}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Volume2 size={13} className="text-slate-500" />
                            <span>Probar tono de confirmación</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
