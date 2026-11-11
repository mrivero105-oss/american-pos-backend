import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = globalThis.__ISAAC_THEME_CONTEXT__ || (globalThis.__ISAAC_THEME_CONTEXT__ = createContext());

const PRO_THEMES = ['studio', 'swiss', 'titanium'];

function normalizeTheme(rawTheme) {
    if (PRO_THEMES.includes(rawTheme)) return rawTheme;
    if (rawTheme === 'dark' || rawTheme === 'oled' || rawTheme === '2025' || rawTheme === 'glass') {
        return 'titanium';
    }
    return 'studio';
}

export function ThemeProvider({ children }) {
    // Arquitecturas Pro exclusivas: 'studio' | 'swiss' | 'titanium'
    const [theme, setRawTheme] = useState(() => {
        return normalizeTheme(localStorage.getItem('app_theme'));
    });

    const setTheme = (next) => {
        setRawTheme(prev => {
            const resolved = typeof next === 'function' ? next(prev) : next;
            return normalizeTheme(resolved);
        });
    };

    // Color Palette Theme
    const [colorTheme, setColorTheme] = useState(() => {
        const savedColor = localStorage.getItem('app_color_theme');
        return savedColor || 'blue';
    });

    // Layout Style
    const [layoutStyle, setLayoutStyle] = useState(() => {
        const savedLayout = localStorage.getItem('app_layout_style');
        return savedLayout || 'sidebar';
    });

    // POS Layout Order
    const [posLayout, setPosLayout] = useState(() => {
        const savedPosLayout = localStorage.getItem('app_pos_layout');
        return savedPosLayout || 'focus';
    });

    // Voice Enabled State
    const [voiceEnabled, setVoiceEnabled] = useState(() => {
        const savedVoice = localStorage.getItem('app_voice_enabled');
        if (savedVoice === 'false') return false;
        if (savedVoice === 'true') return true;
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        return !isMobile;
    });

    // Product Grid View Layout
    const [viewLayout, setViewLayout] = useState(() => {
        const savedViewLayout = localStorage.getItem('pos_view_layout');
        if (savedViewLayout === 'grid_round') return 'grid';
        return savedViewLayout || 'grid';
    });

    // Font Family Customization
    const [fontFamily, setFontFamily] = useState(() => {
        const savedFont = localStorage.getItem('app_font_family');
        return savedFont || 'inter';
    });

    // Font Size Customization (small = 90%, normal = 100%, large = 110%, xlarge = 120%)
    const [fontSize, setFontSize] = useState(() => {
        const savedSize = localStorage.getItem('app_font_size');
        return savedSize || 'normal';
    });

    useEffect(() => {
        const checkWin7 = async () => {
            if (window.electronAPI && window.electronAPI.isWindows7) {
                const isWin7 = await window.electronAPI.isWindows7();
                if (isWin7) {
                    window.document.documentElement.classList.add('win7');
                } else {
                    window.document.documentElement.classList.remove('win7');
                }
            }
        };
        checkWin7();
    }, []);

    useEffect(() => {
        const root = window.document.documentElement;
        const activeTheme = normalizeTheme(theme);

        // Remove all theme classes first
        ['dark', 'light', 'retro', 'theme-2005', 'theme-2015', 'theme-2025', 'glass', 'oled', 'studio', 'swiss', 'titanium'].forEach(t => root.classList.remove(t));

        if (activeTheme === 'swiss') {
            root.classList.add('swiss', 'light');
        } else if (activeTheme === 'titanium') {
            root.classList.add('titanium', 'dark');
        } else {
            root.classList.add('studio', 'light');
        }
        localStorage.setItem('app_theme', activeTheme);

        // Actualizar barra de estado nativa en Android/Móvil vía meta theme-color
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            if (activeTheme === 'titanium') {
                metaThemeColor.setAttribute('content', '#0b0d10');
            } else if (activeTheme === 'swiss') {
                metaThemeColor.setAttribute('content', '#ffffff');
            } else {
                metaThemeColor.setAttribute('content', '#0a0d12');
            }
        }

        // Apply data attributes for CSS overrides
        root.setAttribute('data-color-theme', colorTheme);
        localStorage.setItem('app_color_theme', colorTheme);

        root.setAttribute('data-layout', layoutStyle);
        localStorage.setItem('app_layout_style', layoutStyle);

        root.setAttribute('data-pos-layout', posLayout);
        localStorage.setItem('app_pos_layout', posLayout);

        root.setAttribute('data-font-family', fontFamily);
        document.body.setAttribute('data-font-family', fontFamily);
        localStorage.setItem('app_font_family', fontFamily);

        // Apply font size scaling to root document element (supports 'auto', 'small', 'normal', 'large', 'xlarge', or number 80-150)
        root.setAttribute('data-font-size', fontSize);
        let scalePercent = 100;
        if (fontSize === 'auto') {
            const width = window.innerWidth;
            if (width >= 2560) scalePercent = 125;
            else if (width >= 1920) scalePercent = 105;
            else if (width >= 1440) scalePercent = 100;
            else if (width >= 1024) scalePercent = 95;
            else scalePercent = 90;
        } else if (fontSize === 'small') scalePercent = 90;
        else if (fontSize === 'normal') scalePercent = 100;
        else if (fontSize === 'large') scalePercent = 110;
        else if (fontSize === 'xlarge') scalePercent = 120;
        else {
            const parsed = parseInt(fontSize, 10);
            scalePercent = !isNaN(parsed) ? Math.min(160, Math.max(75, parsed)) : 100;
        }
        root.style.fontSize = `${scalePercent}%`;
        localStorage.setItem('app_font_size', fontSize);

    }, [theme, colorTheme, layoutStyle, posLayout, fontFamily, fontSize]);

    useEffect(() => {
        localStorage.setItem('pos_view_layout', viewLayout);
    }, [viewLayout]);

    useEffect(() => {
        localStorage.setItem('app_voice_enabled', voiceEnabled ? 'true' : 'false');
        if (!voiceEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
            try {
                window.speechSynthesis.cancel();
            } catch (_e) {}
        }
    }, [voiceEnabled]);

    useEffect(() => {
        const handleVoiceChanged = (e) => {
            if (e && e.detail && typeof e.detail.enabled === 'boolean') {
                setVoiceEnabled(e.detail.enabled);
            }
        };
        window.addEventListener('app-voice-changed', handleVoiceChanged);
        return () => window.removeEventListener('app-voice-changed', handleVoiceChanged);
    }, []);

    const toggleTheme = () => {
        setTheme(prev => {
            if (prev === 'studio') return 'swiss';
            if (prev === 'swiss') return 'titanium';
            return 'studio';
        });
    };

    const isOled = false;

    return (
        <ThemeContext.Provider value={{ 
            theme, 
            setTheme, 
            isOled,
            toggleTheme,
            colorTheme,
            setColorTheme,
            layoutStyle,
            setLayoutStyle,
            posLayout,
            setPosLayout,
            voiceEnabled,
            setVoiceEnabled,
            viewLayout,
            setViewLayout,
            fontFamily,
            setFontFamily,
            fontSize,
            setFontSize
        }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
