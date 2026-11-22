import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, Palette, Sidebar, Monitor, AppWindow, 
    PanelLeft, PanelRight, Maximize, LayoutGrid, List, Check, Type, 
    CheckCircle2, ArrowRight, Zap, Layers, Eye, Minus, Plus, RotateCcw, 
    Store, Shield, Utensils, Shirt, Wrench, Tablet, Building2,
    SlidersHorizontal, ShoppingBag, Tag, Volume2, Columns2, Grid2x2, Cpu
} from 'lucide-react';
import { useTheme } from '../hooks/ThemeContext';
import BaseModal from './BaseModal';
import VoiceSoundSettings from './settings/VoiceSoundSettings';

export default function AppearanceModal({ isOpen, onClose }) {
    
    const { 
        theme, setTheme, 
        colorTheme, setColorTheme,
        layoutStyle, setLayoutStyle,
        posLayout, setPosLayout,
        viewLayout, setViewLayout,
        fontFamily, setFontFamily,
        fontSize, setFontSize
    } = useTheme();

    // Active Category in Navigation
    const [activeTab, setActiveTab] = useState('presets');
    const [presetCategory, setPresetCategory] = useState('all');

    const colors = [
        { id: 'blue', name: 'Azul Clásico', hex: '#3b82f6' },
        { id: 'purple', name: 'Púrpura', hex: '#a855f7' },
        { id: 'emerald', name: 'Verde Esmeralda', hex: '#10b981' },
        { id: 'crimson', name: 'Carmesí', hex: '#f43f5e' },
        { id: 'amber', name: 'Ámbar', hex: '#f59e0b' },
        { id: 'cyan', name: 'Cian', hex: '#06b6d4' },
        { id: 'orange', name: 'Naranja', hex: '#f97316' },
        { id: 'pink', name: 'Rosa', hex: '#ec4899' },
        { id: 'teal', name: 'Verde Azulado', hex: '#14b8a6' },
        { id: 'indigo', name: 'Índigo', hex: '#6366f1' }
    ];

    const fonts = [
        { id: 'inter', name: 'Inter', desc: 'Tipografía estándar de máxima legibilidad en monitores', fontFamily: "'Inter', sans-serif" },
        { id: 'outfit', name: 'Outfit', desc: 'Diseño geométrico moderno para comercio y moda', fontFamily: "'Outfit', sans-serif" },
        { id: 'roboto', name: 'Roboto', desc: 'Diseño neutro optimizado para números y tablas', fontFamily: "'Roboto', sans-serif" },
        { id: 'poppins', name: 'Poppins', desc: 'Trazos suaves de alto contraste en pantallas táctiles', fontFamily: "'Poppins', sans-serif" },
        { id: 'system', name: 'Sistema Nativo UI', desc: 'Rendimiento directo usando fuentes del sistema operativo', fontFamily: 'system-ui, sans-serif' },
        { id: 'monospace', name: 'Monospace', desc: 'Ancho fijo para referencias técnicas y códigos', fontFamily: 'monospace' }
    ];

    const menuStructures = [
        { id: 'sidebar', name: 'Barra Lateral (Sidebar)', desc: 'Menú vertical permanente con accesos rápidos', icon: Sidebar },
        { id: 'floating-dock', name: 'Base Flotante (Dock)', desc: 'Barra inferior compacta para mayor área de trabajo', icon: AppWindow },
        { id: 'top-nav', name: 'Navegación Superior', desc: 'Barra horizontal tradicional de escritorio', icon: Monitor }
    ];

    const posLayouts = [
        { id: 'classic', name: 'Caja Estándar (Diestro)', desc: 'Catálogo a la izquierda, totalizador y cobro a la derecha', icon: PanelRight },
        { id: 'reversed', name: 'Caja Invertida (Zurdo)', desc: 'Totalizador y cobro a la izquierda, catálogo a la derecha', icon: PanelLeft },
        { id: 'focus', name: 'Modo Enfoque Táctil', desc: 'Área táctil maximizada con panel de cobro compacto', icon: Maximize }
    ];

    const productCardDesigns = [
        { id: 'grid', name: 'Cuadrícula Estándar', desc: 'Tarjetas balanceadas con imagen, existencia y precio', icon: LayoutGrid },
        { id: 'glassmorphism', name: 'Cristal Translúcido', desc: 'Fondo suavemente difuminado de estilo contemporáneo', icon: Layers },
        { id: 'list', name: 'Lista Densa', desc: 'Filas compactas de máxima eficiencia para inventarios grandes', icon: List }
    ];

    // Presets organizados por rubro comercial
    const presets = [
        {
            id: 'studio-bimodal-pro',
            name: 'Studio Bimodal (Carbón & Porcelana)',
            badge: 'Arquitectura Pro',
            category: 'retail',
            icon: Columns2,
            desc: 'Chasis lateral en carbón anodizado (#0A0D12), mesa de catálogo en piedra neutra y módulo totalizador financiero de alto contraste.',
            color: 'emerald',
            theme: 'studio',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'inter',
            fontSize: 'normal',
            accentBg: 'bg-slate-900 text-white'
        },
        {
            id: 'swiss-architectural-grid',
            name: 'Swiss Grid (Rejilla Continua)',
            badge: 'Editorial Suizo',
            category: 'services',
            icon: Grid2x2,
            desc: 'Retícula ortogonal continua de 1px sin sombras flotantes sobre papel técnico antirreflejo. Orden clínico y precisión tabular.',
            color: 'blue',
            theme: 'swiss',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'inter',
            fontSize: 'normal',
            accentBg: 'bg-slate-200 text-slate-900'
        },
        {
            id: 'titanium-hardware-console',
            name: 'Titanium Console (Hardware Dark)',
            badge: 'Ingeniería',
            category: 'touch',
            icon: Cpu,
            desc: 'Capas de acero y titanio neutro (#0B0D10) con micro-biseles metálicos e instrumentación monocromática de alta precisión.',
            color: 'emerald',
            theme: 'titanium',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'inter',
            fontSize: 'normal',
            accentBg: 'bg-zinc-800 text-zinc-100'
        },
        {
            id: 'supermarket',
            name: 'Supermercado & Retail',
            badge: 'Retail',
            category: 'retail',
            icon: Store,
            desc: 'Cuadrícula balanceada para escaneo veloz de código de barras y panel de cobro diestro.',
            color: 'blue',
            theme: 'studio',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'inter',
            fontSize: 'normal',
            accentBg: 'bg-blue-500/10 text-blue-500'
        },
        {
            id: 'pharmacy',
            name: 'Farmacia & Salud',
            badge: 'Salud',
            category: 'services',
            icon: Shield,
            desc: 'Listado compacto de alta densidad para consultar stock inmediato, lotes y principios activos.',
            color: 'emerald',
            theme: 'swiss',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'list',
            fontFamily: 'poppins',
            fontSize: 'normal',
            accentBg: 'bg-emerald-500/10 text-emerald-500'
        },
        {
            id: 'restaurant',
            name: 'Restaurante & Comida Rápida',
            badge: 'Gastronomía',
            category: 'services',
            icon: Utensils,
            desc: 'Modo enfoque con botones táctiles ampliados para agilizar pedidos de mesas y comandas.',
            color: 'orange',
            theme: 'titanium',
            layoutStyle: 'sidebar',
            posLayout: 'focus',
            viewLayout: 'glassmorphism',
            fontFamily: 'outfit',
            fontSize: 'large',
            accentBg: 'bg-orange-500/10 text-orange-500'
        },
        {
            id: 'boutique',
            name: 'Boutique & Textil',
            badge: 'Moda',
            category: 'retail',
            icon: Shirt,
            desc: 'Presentación visual destacada orientada a imágenes de producto, tallas y variantes.',
            color: 'purple',
            theme: 'studio',
            layoutStyle: 'floating-dock',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'outfit',
            fontSize: 'normal',
            accentBg: 'bg-purple-500/10 text-purple-500'
        },
        {
            id: 'hardware',
            name: 'Ferretería & Repuestos',
            badge: 'Técnico',
            category: 'retail',
            icon: Wrench,
            desc: 'Lista de alta densidad para inventarios extensos con referencias técnicas y medidas.',
            color: 'amber',
            theme: 'swiss',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'list',
            fontFamily: 'inter',
            fontSize: 'small',
            accentBg: 'bg-amber-500/10 text-amber-500'
        },
        {
            id: 'touch_pos',
            name: 'Terminal Táctil POS',
            badge: 'Táctil',
            category: 'touch',
            icon: Tablet,
            desc: 'Tipografía ampliada (120%), botones de gran formato y panel de cobro simplificado.',
            color: 'cyan',
            theme: 'titanium',
            layoutStyle: 'sidebar',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'roboto',
            fontSize: 'xlarge',
            accentBg: 'bg-cyan-500/10 text-cyan-500'
        },
        {
            id: 'executive',
            name: 'Oficina & Facturación',
            badge: 'Gestión',
            category: 'services',
            icon: Building2,
            desc: 'Arquitectura editorial de alta nitidez, navegación superior y formato estructurado para administración.',
            color: 'blue',
            theme: 'swiss',
            layoutStyle: 'top-nav',
            posLayout: 'classic',
            viewLayout: 'grid',
            fontFamily: 'inter',
            fontSize: 'normal',
            accentBg: 'bg-blue-500/10 text-blue-500'
        },
        {
            id: 'modern_glass',
            name: 'Diseño Contemporáneo',
            badge: 'Moderno',
            category: 'touch',
            icon: LayoutGrid,
            desc: 'Consola oscura de precisión, base flotante y tipografía geométrica para espacios modernos.',
            color: 'indigo',
            theme: 'titanium',
            layoutStyle: 'floating-dock',
            posLayout: 'classic',
            viewLayout: 'glassmorphism',
            fontFamily: 'outfit',
            fontSize: 'normal',
            accentBg: 'bg-indigo-500/10 text-indigo-500'
        }
    ];

    const isPresetActive = (p) => {
        return colorTheme === p.color && 
               posLayout === p.posLayout && 
               layoutStyle === p.layoutStyle &&
               viewLayout === p.viewLayout &&
               (!p.theme || theme === p.theme);
    };

    const applyPreset = (p) => {
        if (p.theme) setTheme(p.theme);
        setColorTheme(p.color);
        setLayoutStyle(p.layoutStyle);
        setPosLayout(p.posLayout);
        setViewLayout(p.viewLayout);
        setFontFamily(p.fontFamily);
        setFontSize(p.fontSize);
    };

    const tabs = [
        { id: 'presets', label: 'Plantillas de Negocio', desc: 'Perfiles comerciales preconfigurados', icon: Zap },
        { id: 'color', label: 'Modo y Colores', desc: 'Tema de fondo y tono de acento', icon: Palette },
        { id: 'layout', label: 'Ergonomía de Caja', desc: 'Disposición del mostrador y menús', icon: Layers },
        { id: 'typography', label: 'Tipografía y Escala', desc: 'Fuente de texto y tamaño general', icon: Type },
        { id: 'audio', label: 'Audio y Alertas', desc: 'Locución de ventas y confirmaciones', icon: Volume2 }
    ];

    const getCurrentNumericScale = () => {
        if (fontSize === 'auto') {
            const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
            if (w >= 2560) return 125;
            if (w >= 1920) return 105;
            if (w >= 1440) return 100;
            if (w >= 1024) return 95;
            return 90;
        }
        if (fontSize === 'small') return 90;
        if (fontSize === 'normal') return 100;
        if (fontSize === 'large') return 110;
        if (fontSize === 'xlarge') return 120;
        const parsed = parseInt(fontSize, 10);
        return isNaN(parsed) ? 100 : parsed;
    };

    const currentScaleNum = getCurrentNumericScale();

    const getScaleLabel = (val) => {
        if (fontSize === 'auto') return `Automático (${currentScaleNum}% calculado)`;
        if (val <= 85) return 'Compacto / Alta Densidad';
        if (val <= 95) return 'Ligero / Pantallas Pequeñas';
        if (val <= 105) return 'Estándar FHD Recomendado';
        if (val <= 115) return 'Cómodo / Letra Mediana';
        if (val <= 130) return 'Táctil / Pantallas Touch POS';
        return 'Alta Visibilidad';
    };

    const stepFontSize = (delta) => {
        const next = Math.min(150, Math.max(80, currentScaleNum + delta));
        setFontSize(String(next));
    };

    const filteredPresets = presets.filter(p => {
        if (presetCategory === 'all') return true;
        return p.category === presetCategory;
    });

    const activeColorObj = colors.find(c => c.id === colorTheme) || colors[0];

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-6xl w-[96vw]"
            className="h-[88vh] max-h-[850px] overflow-hidden flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl transition-all duration-200"
            backdropStyle="bg-slate-950/75 backdrop-blur-md"
        >
            {/* Cabecera del Modal */}
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 flex items-center justify-center text-primary-500 shadow-2xs shrink-0">
                        <SlidersHorizontal size={18} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                            Personalización y Apariencia
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-normal truncate">
                            Temas de pantalla, ergonomía de mostrador y preferencias del sistema
                        </p>
                    </div>
                </div>
                <button 
                    onClick={onClose} 
                    className="min-h-[36px] min-w-[36px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer flex items-center justify-center shrink-0"
                    title="Cerrar [Esc]"
                >
                    <X size={17} />
                </button>
            </div>

            {/* Pestañas para Móvil (< md) */}
            <div className="flex md:hidden overflow-x-auto gap-1 p-2 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 shrink-0 custom-scrollbar">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                                isActive 
                                    ? 'bg-primary-500 text-white shadow-2xs' 
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                            }`}
                        >
                            <Icon size={14} />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Contenedor Principal: Master-Detail en Escritorio */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                {/* Barra Lateral Izquierda (Desktop) */}
                <aside className="hidden md:flex flex-col w-64 lg:w-72 bg-slate-50/70 dark:bg-slate-950/50 border-r border-slate-200/80 dark:border-slate-800 p-3 lg:p-4 shrink-0 overflow-y-auto custom-scrollbar">
                    <nav className="space-y-1">
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer ${
                                        isActive
                                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs border border-slate-200/90 dark:border-slate-700/80'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/40 dark:hover:bg-slate-800/40'
                                    }`}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                                        isActive 
                                            ? 'bg-primary-500 text-white shadow-2xs' 
                                            : 'bg-slate-200/60 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                    }`}>
                                        <Icon size={15} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-xs truncate">
                                            {tab.label}
                                        </div>
                                        <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                            {tab.desc}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                {/* Panel de Contenido Derecho */}
                <main className="flex-1 p-5 sm:p-7 overflow-y-auto custom-scrollbar bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    <AnimatePresence mode="wait">
                        {/* TAB 1: MODELOS POR RUBRO DE NEGOCIO */}
                        {activeTab === 'presets' && (
                            <motion.div 
                                key="tab-presets"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                                className="space-y-5"
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                            Plantillas Prediseñadas por Rubro
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                            Aplica combinaciones optimizadas de paleta de color y disposición de mostrador
                                        </p>
                                    </div>

                                    {/* Filtro de Categorías */}
                                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg shrink-0 border border-slate-200/60 dark:border-slate-700/60">
                                        {[
                                            { id: 'all', label: 'Todos' },
                                            { id: 'retail', label: 'Comercio' },
                                            { id: 'services', label: 'Servicios' },
                                            { id: 'touch', label: 'Táctil' }
                                        ].map(cat => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setPresetCategory(cat.id)}
                                                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                                                    presetCategory === cat.id
                                                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                }`}
                                            >
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Grilla de Tarjetas */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                                    {filteredPresets.map((p) => {
                                        const Icon = p.icon;
                                        const isApplied = isPresetActive(p);
                                        return (
                                            <div
                                                key={p.id}
                                                onClick={() => applyPreset(p)}
                                                className={`group relative p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                                                    isApplied
                                                        ? 'border-primary-500 bg-primary-500/[0.04] ring-1 ring-primary-500/30 shadow-xs'
                                                        : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
                                                }`}
                                            >
                                                <div>
                                                    <div className="flex items-start justify-between mb-2">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.accentBg || 'bg-slate-200 dark:bg-slate-700'}`}>
                                                                <Icon size={16} />
                                                            </div>
                                                            <div>
                                                                <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white leading-tight">
                                                                    {p.name}
                                                                </h4>
                                                                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                                                    {p.badge}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {isApplied ? (
                                                            <div className="px-2 py-0.5 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center gap-1 shadow-2xs">
                                                                <Check size={11} strokeWidth={3} />
                                                                <span>Activo</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-[11px] font-medium text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                                                <span>Aplicar</span>
                                                                <ArrowRight size={12} />
                                                            </span>
                                                        )}
                                                    </div>

                                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                                                        {p.desc}
                                                    </p>
                                                </div>

                                                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/40">
                                                    <div className="flex flex-wrap gap-1.5">
                                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-200/60 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300">
                                                            {p.layoutStyle === 'sidebar' ? 'Sidebar' : p.layoutStyle === 'floating-dock' ? 'Dock' : 'Top Nav'}
                                                        </span>
                                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-200/60 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300">
                                                            {p.posLayout === 'classic' ? 'Diestro' : p.posLayout === 'reversed' ? 'Zurdo' : 'Enfoque'}
                                                        </span>
                                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-200/60 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300">
                                                            {p.viewLayout === 'grid' ? 'Cuadrícula' : p.viewLayout === 'list' ? 'Lista' : 'Glass'}
                                                        </span>
                                                    </div>

                                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                                        {p.theme ? p.theme.toUpperCase() : 'AUTO'}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        )}

                        {/* TAB 2: MODO Y COLORES */}
                        {activeTab === 'color' && (
                            <motion.div 
                                key="tab-color"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                                className="space-y-6"
                            >
                                {/* Arquitecturas de Alta Ingeniería (Edición Pro) */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                                Arquitectura Visual del Sistema
                                            </h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Diseños industriales de alta jerarquía espacial y precisión tipográfica
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {/* 1. Studio Bimodal */}
                                        <button
                                            type="button"
                                            onClick={() => setTheme('studio')}
                                            className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer relative ${
                                                theme === 'studio'
                                                    ? 'border-slate-900 dark:border-white bg-slate-100/80 dark:bg-slate-800/70 ring-1 ring-slate-900/20 shadow-xs'
                                                    : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-8 h-8 rounded-lg bg-[#0a0d12] text-white border border-slate-700 flex items-center justify-center shadow-2xs">
                                                        <Columns2 size={16} />
                                                    </div>
                                                    <div className="flex h-5 w-8 rounded overflow-hidden border border-slate-300">
                                                        <span className="w-2.5 h-full bg-[#0a0d12]" />
                                                        <span className="flex-1 h-full bg-[#f3f4f6]" />
                                                        <span className="w-2 h-full bg-white border-l border-slate-200" />
                                                    </div>
                                                </div>
                                                {theme === 'studio' && (
                                                    <span className="px-2 py-0.5 rounded-full bg-[#0a0d12] text-white text-[10px] font-bold">Activo</span>
                                                )}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-xs text-slate-900 dark:text-white">Studio Bimodal</h4>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                                    Chasis en carbón anodizado, catálogo en piedra neutra y totalizador financiero oscuro.
                                                </p>
                                            </div>
                                        </button>

                                        {/* 2. Swiss Architectural Grid */}
                                        <button
                                            type="button"
                                            onClick={() => setTheme('swiss')}
                                            className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer relative ${
                                                theme === 'swiss'
                                                    ? 'border-slate-900 dark:border-white bg-white dark:bg-slate-800/70 ring-1 ring-slate-900/20 shadow-xs'
                                                    : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-8 h-8 rounded-md bg-white text-[#090d16] border border-[#0f172a] flex items-center justify-center">
                                                        <Grid2x2 size={16} />
                                                    </div>
                                                    <div className="flex h-5 w-8 overflow-hidden border border-slate-400 bg-white">
                                                        <span className="w-2.5 h-full bg-[#f7f8fa] border-r border-slate-300" />
                                                        <span className="flex-1 h-full bg-[#f2f4f7]" />
                                                    </div>
                                                </div>
                                                {theme === 'swiss' && (
                                                    <span className="px-2 py-0.5 rounded bg-[#0f172a] text-white text-[10px] font-bold">Activo</span>
                                                )}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-xs text-slate-900 dark:text-white">Swiss Grid</h4>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                                    Rejilla continua de 1px sin sombras flotantes sobre papel técnico antirreflejo.
                                                </p>
                                            </div>
                                        </button>

                                        {/* 3. Titanium Console */}
                                        <button
                                            type="button"
                                            onClick={() => setTheme('titanium')}
                                            className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer relative ${
                                                theme === 'titanium'
                                                    ? 'border-zinc-400 bg-zinc-900/[0.06] dark:bg-zinc-800/70 ring-1 ring-zinc-400/30 shadow-xs'
                                                    : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-8 h-8 rounded-lg bg-[#14181e] text-[#f1f3f5] border border-[#3a4352] flex items-center justify-center shadow-2xs">
                                                        <Cpu size={16} />
                                                    </div>
                                                    <div className="flex h-5 w-8 rounded overflow-hidden border border-[#2a313d]">
                                                        <span className="w-2.5 h-full bg-[#08090c]" />
                                                        <span className="flex-1 h-full bg-[#0b0d10]" />
                                                        <span className="w-2 h-full bg-[#14181e] border-l border-[#232933]" />
                                                    </div>
                                                </div>
                                                {theme === 'titanium' && (
                                                    <span className="px-2 py-0.5 rounded-full bg-[#14181e] text-white border border-[#3a4352] text-[10px] font-bold">Activo</span>
                                                )}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-xs text-slate-900 dark:text-white">Titanium Console</h4>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                                    Consola de titanio y acero neutro (#0B0D10) con micro-biseles de instrumentación.
                                                </p>
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                {/* Paleta de Color */}
                                <div className="space-y-3">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                            Color de Acento
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Tono distintivo para botones principales y elementos seleccionados
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                                        {colors.map(c => {
                                            const isSelected = colorTheme === c.id;
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => setColorTheme(c.id)}
                                                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col items-center gap-2 ${
                                                        isSelected 
                                                            ? 'border-primary-500 bg-primary-500/[0.06] ring-1 ring-primary-500/25 shadow-xs' 
                                                            : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div 
                                                        className="w-8 h-8 rounded-full shadow-xs flex items-center justify-center border-2 border-white/40 dark:border-slate-900/40 transition-transform"
                                                        style={{ backgroundColor: c.hex }}
                                                    >
                                                        {isSelected && <Check size={14} className="text-white font-black drop-shadow-sm" />}
                                                    </div>
                                                    <span className={`text-xs text-center truncate w-full ${
                                                        isSelected ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-600 dark:text-slate-400'
                                                    }`}>
                                                        {c.name}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Muestra de Componentes */}
                                <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-3.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Eye size={16} className="text-primary-500" />
                                            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                                                Muestra de Interfaz
                                            </h4>
                                        </div>
                                        <span className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 px-2 py-0.5 rounded-md bg-primary-500/10 border border-primary-500/20">
                                            Tono Activo: {activeColorObj.name}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                        <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                                Botones de Acción
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button 
                                                    type="button"
                                                    className="px-3.5 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 transition-colors"
                                                >
                                                    <ShoppingBag size={13} />
                                                    <span>Cobrar $45.00</span>
                                                </button>
                                                <button 
                                                    type="button"
                                                    className="px-3 py-1.5 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 text-primary-600 dark:text-primary-400 border border-primary-500/20 font-semibold text-xs transition-colors"
                                                >
                                                    Factura Rápida
                                                </button>
                                            </div>
                                        </div>

                                        <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-2">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                                Etiquetas de Estado
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                                                    Caja Operativa
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-primary-500 text-white shadow-2xs flex items-center gap-1">
                                                    <Tag size={11} />
                                                    <span>-10%</span>
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                    Stock: 36
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* TAB 3: ERGONOMÍA DE CAJA */}
                        {activeTab === 'layout' && (
                            <motion.div 
                                key="tab-layout"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                                className="space-y-6"
                            >
                                <div className="space-y-2.5">
                                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        1. Estructura de Navegación del Sistema
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {menuStructures.map(m => {
                                            const Icon = m.icon;
                                            const isSelected = layoutStyle === m.id;
                                            return (
                                                <button
                                                    key={m.id}
                                                    type="button"
                                                    onClick={() => setLayoutStyle(m.id)}
                                                    className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                                                        isSelected
                                                            ? 'border-primary-500 bg-primary-500/[0.05] ring-1 ring-primary-500/25 shadow-xs'
                                                            : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary-500 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                            <Icon size={16} />
                                                        </div>
                                                        {isSelected && <CheckCircle2 size={16} className="text-primary-500" />}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-xs text-slate-900 dark:text-white mb-0.5">{m.name}</h4>
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{m.desc}</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="space-y-2.5">
                                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        2. Orientación y Ergonomía de Caja
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {posLayouts.map(p => {
                                            const Icon = p.icon;
                                            const isSelected = posLayout === p.id;
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => setPosLayout(p.id)}
                                                    className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                                                        isSelected
                                                            ? 'border-primary-500 bg-primary-500/[0.05] ring-1 ring-primary-500/25 shadow-xs'
                                                            : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary-500 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                            <Icon size={16} />
                                                        </div>
                                                        {isSelected && <CheckCircle2 size={16} className="text-primary-500" />}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-xs text-slate-900 dark:text-white mb-0.5">{p.name}</h4>
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{p.desc}</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="space-y-2.5">
                                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        3. Formato Visual de Catálogo
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {productCardDesigns.map(c => {
                                            const Icon = c.icon;
                                            const isSelected = viewLayout === c.id;
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => setViewLayout(c.id)}
                                                    className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                                                        isSelected
                                                            ? 'border-primary-500 bg-primary-500/[0.05] ring-1 ring-primary-500/25 shadow-xs'
                                                            : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary-500 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                            <Icon size={16} />
                                                        </div>
                                                        {isSelected && <CheckCircle2 size={16} className="text-primary-500" />}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-xs text-slate-900 dark:text-white mb-0.5">{c.name}</h4>
                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{c.desc}</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* TAB 4: TIPOGRAFÍA Y ESCALA */}
                        {activeTab === 'typography' && (
                            <motion.div 
                                key="tab-typography"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                                className="space-y-6"
                            >
                                <div className="space-y-2.5">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                            Familia Tipográfica
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Tipografía principal utilizada para títulos, tablas y recibos
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        {fonts.map(f => {
                                            const isSelected = fontFamily === f.id;
                                            return (
                                                <button
                                                    key={f.id}
                                                    type="button"
                                                    onClick={() => setFontFamily(f.id)}
                                                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                                                        isSelected
                                                            ? 'border-primary-500 bg-primary-500/[0.05] ring-1 ring-primary-500/25 shadow-xs'
                                                            : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between mb-1">
                                                        <h4 className="font-bold text-sm text-slate-900 dark:text-white" style={{ fontFamily: f.fontFamily }}>
                                                            {f.name}
                                                        </h4>
                                                        {isSelected && <CheckCircle2 size={16} className="text-primary-500" />}
                                                    </div>
                                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">{f.desc}</p>
                                                    <div className="p-1.5 rounded-lg bg-slate-200/50 dark:bg-slate-900/60 font-medium text-xs text-slate-700 dark:text-slate-300 tracking-wide" style={{ fontFamily: f.fontFamily }}>
                                                        Terminal POS • Facturación $145.00
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                <Monitor size={15} className="text-primary-500" />
                                                <span>Escala y Tamaño General</span>
                                            </h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Ajusta la densidad visual según las dimensiones de tu monitor
                                            </p>
                                        </div>
                                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                            {typeof window !== 'undefined' ? `${window.innerWidth} × ${window.innerHeight}` : '1920×1080'} px
                                        </span>
                                    </div>

                                    <div className="p-4 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-4">
                                        <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-slate-700/60">
                                            <div className="flex items-center gap-2.5">
                                                <div className={`p-2 rounded-lg ${fontSize === 'auto' ? 'bg-primary-500 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                                    <Zap size={16} />
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                                        Auto-Escala según Resolución
                                                    </h4>
                                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                        Calcula el porcentaje idóneo analizando la resolución de pantalla
                                                    </p>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setFontSize(fontSize === 'auto' ? 'normal' : 'auto')}
                                                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                                                    fontSize === 'auto'
                                                        ? 'bg-primary-500 text-white shadow-2xs'
                                                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:border-primary-500'
                                                }`}
                                            >
                                                {fontSize === 'auto' ? '✓ Activo' : 'Activar'}
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Ajuste Manual</span>
                                                <p className="text-xs text-primary-600 dark:text-primary-400 font-semibold">
                                                    {getScaleLabel(currentScaleNum)}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                                                    {currentScaleNum}%
                                                </span>
                                                {fontSize !== 'normal' && fontSize !== '100' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setFontSize('normal')}
                                                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                                        title="Restablecer a 100%"
                                                    >
                                                        <RotateCcw size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2.5">
                                            <button
                                                type="button"
                                                onClick={() => stepFontSize(-5)}
                                                disabled={currentScaleNum <= 80}
                                                className="min-w-[40px] min-h-[40px] p-2 rounded-lg bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-primary-500 hover:text-white transition-colors disabled:opacity-30 cursor-pointer flex items-center justify-center active:scale-95"
                                                title="Reducir 5%"
                                            >
                                                <Minus size={15} />
                                            </button>

                                            <input
                                                type="range"
                                                min="80"
                                                max="150"
                                                step="5"
                                                value={currentScaleNum}
                                                onChange={(e) => setFontSize(e.target.value)}
                                                className="flex-1 h-2 bg-slate-300/80 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => stepFontSize(5)}
                                                disabled={currentScaleNum >= 150}
                                                className="min-w-[40px] min-h-[40px] p-2 rounded-lg bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-primary-500 hover:text-white transition-colors disabled:opacity-30 cursor-pointer flex items-center justify-center active:scale-95"
                                                title="Aumentar 5%"
                                            >
                                                <Plus size={15} />
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            {[
                                                { id: '85', label: '85% Compacto' },
                                                { id: 'normal', label: '100% Estándar' },
                                                { id: '115', label: '115% Cómodo' },
                                                { id: 'xlarge', label: '120% Grande' },
                                                { id: '135', label: '135% Táctil POS' }
                                            ].map(chip => {
                                                const isSelected = fontSize === chip.id || (chip.id === 'normal' && fontSize === '100') || (chip.id === 'xlarge' && fontSize === '120');
                                                return (
                                                    <button
                                                        key={chip.id}
                                                        type="button"
                                                        onClick={() => setFontSize(chip.id)}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer active:scale-95 ${
                                                            isSelected
                                                                ? 'bg-primary-500 text-white shadow-2xs'
                                                                : 'bg-white dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-slate-300'
                                                        }`}
                                                    >
                                                        {chip.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* TAB 5: AUDIO Y ALERTAS */}
                        {activeTab === 'audio' && (
                            <motion.div
                                key="audio"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                            >
                                <VoiceSoundSettings />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </main>
            </div>

            {/* Modal Footer */}
            <div className="px-5 sm:px-6 py-3.5 bg-slate-50/90 dark:bg-slate-950/80 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                    <span>Los ajustes se guardan automáticamente en tiempo real</span>
                </div>
                <button
                    onClick={onClose}
                    className="w-full sm:w-auto min-h-[38px] px-6 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 active:scale-95 text-white font-bold text-xs shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                    <Check size={14} strokeWidth={2.5} />
                    <span>Listo</span>
                </button>
            </div>
        </BaseModal>
    );
}
