import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    Search, 
    X, 
    ArrowRight, 
    Store, 
    Printer, 
    CreditCard, 
    Shield, 
    Database, 
    SlidersHorizontal, 
    Globe, 
    FileText, 
    Scale, 
    Banknote, 
    Lock, 
    HardDrive, 
    MessageSquare, 
    Laptop, 
    RefreshCw, 
    Server,
    Cpu,
    CornerDownLeft,
    Volume2
} from 'lucide-react';

const ICON_MAP = {
    Store,
    Printer,
    CreditCard,
    Shield,
    Database,
    SlidersHorizontal,
    Globe,
    FileText,
    Scale,
    Banknote,
    Lock,
    HardDrive,
    MessageSquare,
    Laptop,
    RefreshCw,
    Server,
    Cpu,
    Volume2
};

export const SETTINGS_INDEX = [
    // --- TAB: Identidad & Negocio (business) ---
    {
        id: 'biz_name_rif',
        title: 'Nombre Comercial y RIF / NIT / RUC',
        description: 'Razón social, RIF o documento de identificación fiscal de la empresa.',
        tab: 'business',
        subTab: null,
        targetElementId: 'business-profile-card',
        category: 'Identidad & Negocio',
        icon: 'Store',
        keywords: ['nombre', 'rif', 'nit', 'ruc', 'razon social', 'empresa', 'identidad', 'perfil']
    },
    {
        id: 'biz_address_contact',
        title: 'Dirección, Teléfono y Correo de la Empresa',
        description: 'Datos de contacto impresos en encabezados de tickets y facturas.',
        tab: 'business',
        subTab: null,
        targetElementId: 'business-profile-card',
        category: 'Identidad & Negocio',
        icon: 'Store',
        keywords: ['direccion', 'telefono', 'email', 'correo', 'ubicacion', 'contacto']
    },
    {
        id: 'biz_logo',
        title: 'Logo de la Empresa',
        description: 'Imagen o logotipo para facturas, recibos y reportes.',
        tab: 'business',
        subTab: null,
        targetElementId: 'business-profile-card',
        category: 'Identidad & Negocio',
        icon: 'Store',
        keywords: ['logo', 'imagen', 'marca', 'foto', 'icono']
    },
    {
        id: 'biz_receipt_text',
        title: 'Encabezado y Pie de Ticket / Factura',
        description: 'Mensajes personalizados al inicio y pie de los comprobantes impresos.',
        tab: 'business',
        subTab: null,
        targetElementId: 'business-profile-card',
        category: 'Identidad & Negocio',
        icon: 'FileText',
        keywords: ['encabezado', 'pie', 'ticket', 'factura', 'gracias por su compra', 'mensaje', 'recibo']
    },
    {
        id: 'biz_country_region',
        title: 'País y Región Fiscal',
        description: 'Venezuela, Ecuador, Colombia, Panamá, USA. Moneda base y formatos fiscales.',
        tab: 'business',
        subTab: null,
        targetElementId: 'region-settings-card',
        category: 'Identidad & Negocio',
        icon: 'Globe',
        keywords: ['pais', 'region', 'venezuela', 'ecuador', 'colombia', 'panama', 'dolar', 'moneda', 'internacional']
    },
    {
        id: 'biz_mode_type',
        title: 'Modalidad de Negocio (Retail, Farmacia, Ropa)',
        description: 'Modo estándar, farmacia con control de lotes, o boutiques con tallas/colores.',
        tab: 'business',
        subTab: null,
        targetElementId: 'business-mode-card',
        category: 'Identidad & Negocio',
        icon: 'Store',
        keywords: ['modalidad', 'farmacia', 'ropa', 'tallas', 'colores', 'lotes', 'vencimiento', 'retail']
    },
    {
        id: 'biz_sri_ecuador',
        title: 'Facturación Electrónica SRI (Ecuador)',
        description: 'Ambiente de pruebas/producción, RUC, firma electrónica .p12 y clave SRI.',
        tab: 'business',
        subTab: null,
        targetElementId: 'sri-settings-card',
        category: 'Identidad & Negocio',
        icon: 'Cpu',
        keywords: ['sri', 'ecuador', 'facturacion electronica', 'p12', 'firma electronica', 'ruc', 'ambiente']
    },

    // --- TAB: Impresoras & Periféricos (printers) ---
    {
        id: 'printer_station_select',
        title: 'Impresora Predeterminada de Estación / Caja',
        description: 'Seleccionar impresora USB, de red o térmica para este terminal.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printer-station-card',
        category: 'Impresoras & Periféricos',
        icon: 'Printer',
        keywords: ['impresora', 'termica', 'usb', 'pos-58', 'pos-80', 'bixolon', 'epson', 'predeterminada']
    },
    {
        id: 'printer_format_width',
        title: 'Ancho de Papel (80mm vs 58mm)',
        description: 'Ajuste del ancho de bobina térmica para impresión perfecta sin desbordes.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printer-format-card',
        category: 'Impresoras & Periféricos',
        icon: 'Printer',
        keywords: ['ancho', 'papel', '80mm', '58mm', 'bobina', 'formato', 'ticket']
    },
    {
        id: 'printer_print_mode',
        title: 'Modo de Impresión (RAW ESC/POS vs Gráfico)',
        description: 'Impresión instantánea en milisegundos por comandos nativos RAW o HTML gráfico.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printer-mode-card',
        category: 'Impresoras & Periféricos',
        icon: 'Printer',
        keywords: ['raw', 'esc/pos', 'modo', 'grafico', 'html', 'velocidad', 'corte']
    },
    {
        id: 'printer_cash_drawer',
        title: 'Apertura de Cajón Portamonedas / Gaveta',
        description: 'Secuencia ESC/POS, apertura automática al imprimir o sólo en pagos efectivo.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printer-drawer-card',
        category: 'Impresoras & Periféricos',
        icon: 'SlidersHorizontal',
        keywords: ['cajon', 'gaveta', 'portamonedas', 'dinero', 'apertura', 'secuencia', 'pulso', 'cash drawer']
    },
    {
        id: 'printer_order_replica',
        title: 'Réplica Multicaja y Comandas de Cocina',
        description: 'Replicar órdenes y comprobantes a impresoras remotas o comandera de preparación.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printer-replica-card',
        category: 'Impresoras & Periféricos',
        icon: 'Printer',
        keywords: ['replica', 'comanda', 'cocina', 'multicaja', 'remota', 'preparacion', 'red']
    },
    {
        id: 'printer_scale_weight',
        title: 'Balanza / Báscula Digital',
        description: 'Conexión serial COM de balanzas para productos pesados y pesaje en vivo.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printer-scale-card',
        category: 'Impresoras & Periféricos',
        icon: 'Scale',
        keywords: ['balanza', 'bascula', 'peso', 'kilos', 'gramos', 'puerto com', 'serial', 'pesaje']
    },

    // --- TAB: Finanzas & Pagos (billing) ---
    {
        id: 'billing_bcv_rate',
        title: 'Tasa de Cambio (BCV / Paralelo / Personalizada)',
        description: 'Valor del dólar oficial BCV o fijado manualmente para cálculos duales.',
        tab: 'billing',
        subTab: null,
        targetElementId: 'rate-settings-card',
        category: 'Finanzas & Pagos',
        icon: 'Banknote',
        keywords: ['tasa', 'bcv', 'dolar', 'cambio', 'divisa', 'paralelo', 'oficial', 'cotizacion']
    },
    {
        id: 'billing_currency_mode',
        title: 'Modo de Moneda (Dual Bs/USD o Divisa Única)',
        description: 'Mostrar precios simultáneos en Bolívares y Dólares o sólo en Dólares.',
        tab: 'billing',
        subTab: null,
        targetElementId: 'currency-mode-card',
        category: 'Finanzas & Pagos',
        icon: 'Banknote',
        keywords: ['moneda', 'dual', 'single', 'ambas', 'bolivares', 'dolares', 'ves', 'usd']
    },
    {
        id: 'billing_taxes_iva',
        title: 'Impuesto al Valor Agregado (IVA %)',
        description: 'Tasa general de IVA (16%, 12%, 15%) y habilitación en ventas.',
        tab: 'billing',
        subTab: null,
        targetElementId: 'tax-settings-card',
        category: 'Finanzas & Pagos',
        icon: 'CreditCard',
        keywords: ['iva', 'impuesto', 'tributo', 'seniat', 'porcentaje', 'fiscal', 'alicuota']
    },
    {
        id: 'billing_taxes_igtf',
        title: 'Impuesto a Grandes Transacciones Financieras (IGTF 3%)',
        description: 'Recargo del 3% en pagos realizados con divisas o moneda extranjera.',
        tab: 'billing',
        subTab: null,
        targetElementId: 'igtf-settings-card',
        category: 'Finanzas & Pagos',
        icon: 'CreditCard',
        keywords: ['igtf', '3%', 'divisas', 'impuesto divisas', 'seniat', 'dolares', 'recargo']
    },
    {
        id: 'billing_payment_methods',
        title: 'Métodos de Pago (Efectivo, Pago Móvil, Zelle, Tarjeta)',
        description: 'Administración de formas de pago aceptadas en el terminal POS.',
        tab: 'billing',
        subTab: null,
        targetElementId: 'payment-methods-card',
        category: 'Finanzas & Pagos',
        icon: 'CreditCard',
        keywords: ['metodos de pago', 'pago movil', 'zelle', 'tarjeta', 'efectivo', 'transferencia', 'pos', 'biopago']
    },

    // --- TAB: Seguridad & Acceso (security) ---
    {
        id: 'sec_supervisor_pin',
        title: 'PIN de Supervisor / Administrador',
        description: 'Clave de seguridad requerida para anular ventas, dar descuentos o abrir cajón.',
        tab: 'security',
        subTab: null,
        targetElementId: 'security-pin-card',
        category: 'Seguridad & Acceso',
        icon: 'Shield',
        keywords: ['pin', 'supervisor', 'clave', 'contraseña', 'autorizacion', 'permiso', 'anulacion']
    },
    {
        id: 'sec_max_discount',
        title: 'Límite Máximo de Descuento Sin Autorización',
        description: 'Porcentaje tope que un cajero puede aplicar antes de pedir PIN de supervisor.',
        tab: 'security',
        subTab: null,
        targetElementId: 'security-discount-card',
        category: 'Seguridad & Acceso',
        icon: 'Shield',
        keywords: ['descuento', 'limite', 'maximo', 'cajero', 'porcentaje', 'rebaja', 'promocion']
    },
    {
        id: 'sec_drawer_protection',
        title: 'Protección de Apertura Manual de Cajón',
        description: 'Exigir autorización de supervisor para abrir la gaveta sin venta.',
        tab: 'security',
        subTab: null,
        targetElementId: 'security-drawer-card',
        category: 'Seguridad & Acceso',
        icon: 'Lock',
        keywords: ['abrir cajon', 'gaveta', 'proteccion', 'supervisor', 'seguridad', 'manual']
    },
    {
        id: 'sec_session_lock',
        title: 'Bloqueo Automático por Inactividad',
        description: 'Cerrar la pantalla del terminal tras minutos sin actividad para proteger la caja.',
        tab: 'security',
        subTab: null,
        targetElementId: 'security-lock-card',
        category: 'Seguridad & Acceso',
        icon: 'Lock',
        keywords: ['bloqueo', 'inactividad', 'tiempo', 'pantalla', 'seguridad', 'auto bloqueo']
    },

    // --- TAB: Sistema & Respaldos (system) ---
    {
        id: 'sys_backups_pg',
        title: 'Copias de Seguridad PostgreSQL',
        description: 'Crear respaldo manual, descargar dump SQL/ZIP o restaurar base de datos.',
        tab: 'system',
        subTab: 'backups',
        targetElementId: 'system-backups-card',
        category: 'Sistema & Respaldos',
        icon: 'Database',
        keywords: ['respaldo', 'backup', 'base de datos', 'postgres', 'restaurar', 'dump', 'copia', 'seguridad']
    },
    {
        id: 'sys_offline_sales',
        title: 'Ventas Offline Pendientes y Cola de Sincronización',
        description: 'Ver y sincronizar ventas guardadas localmente durante fallas de conexión.',
        tab: 'system',
        subTab: 'offline',
        targetElementId: 'system-offline-card',
        category: 'Sistema & Respaldos',
        icon: 'HardDrive',
        keywords: ['offline', 'sin internet', 'sincronizar', 'ventas pendientes', 'cola', 'sync', 'local']
    },
    {
        id: 'sys_whatsapp_bot',
        title: 'Servicio de Notificaciones WhatsApp',
        description: 'Envío de recibos de venta, cierres de turno y alertas de stock por WhatsApp.',
        tab: 'system',
        subTab: 'whatsapp',
        targetElementId: 'system-whatsapp-card',
        category: 'Sistema & Respaldos',
        icon: 'MessageSquare',
        keywords: ['whatsapp', 'notificaciones', 'mensajes', 'recibos', 'alertas', 'qr', 'servicio']
    },
    {
        id: 'sys_startup_windows',
        title: 'Inicio Automático con Windows',
        description: 'Configuración de arranque al encender la PC y prevención de doble inicio.',
        tab: 'system',
        subTab: 'startup',
        targetElementId: 'system-startup-card',
        category: 'Sistema & Respaldos',
        icon: 'Laptop',
        keywords: ['inicio automatico', 'arranque', 'windows', 'encender', 'pc', 'doble apertura', 'startup']
    },
    {
        id: 'sys_updater_github',
        title: 'Actualizador del Sistema (GitHub / OTA)',
        description: 'Verificar nuevas versiones, parches de seguridad y actualizar en 1-click.',
        tab: 'system',
        subTab: 'updater',
        targetElementId: 'system-updater-card',
        category: 'Sistema & Respaldos',
        icon: 'RefreshCw',
        keywords: ['actualizar', 'version', 'github', 'update', 'parche', 'nube', 'ota']
    },
    {
        id: 'sys_email_smtp',
        title: 'Servidor de Correo SMTP',
        description: 'Configurar servidor Gmail/SMTP para enviar facturas electrónicas a clientes.',
        tab: 'system',
        subTab: 'email',
        targetElementId: 'system-email-card',
        category: 'Sistema & Respaldos',
        icon: 'Server',
        keywords: ['correo', 'email', 'smtp', 'facturas', 'gmail', 'notificacion', 'envio']
    },
    {
        id: 'sys_db_maintenance',
        title: 'Optimización y Mantenimiento Autónomo de Base de Datos (VACUUM)',
        description: 'Reconstrucción de índices B-Tree, particionamiento de ventas y VACUUM ANALYZE para 1M+ registros.',
        tab: 'system',
        subTab: 'backups',
        targetElementId: 'system-backups-card',
        category: 'Sistema & Respaldos',
        icon: 'Database',
        keywords: ['mantenimiento', 'vacuum', 'optimizar', 'velocidad', 'base de datos', 'indices', 'limpieza', 'rendimiento', 'rapido', 'particion']
    },
    {
        id: 'fiscal_printer_hardware',
        title: 'Impresora Fiscal y Reportes X / Z (SENIAT)',
        description: 'Conexión serial/USB con máquinas fiscales homologadas (HKA, Bixolon, Custom) y emisión de cierres X y Z.',
        tab: 'printers',
        subTab: null,
        targetElementId: 'printers-config-card',
        category: 'Impresoras & Periféricos',
        icon: 'Printer',
        keywords: ['fiscal', 'reporte x', 'reporte z', 'cierre z', 'seniat', 'hka', 'bixolon', 'maquina fiscal', 'com', 'serial', 'puerto']
    },
    {
        id: 'sys_voice_sound_ai',
        title: 'Asistente de Voz IA y Silenciamiento de Audio / Beeps',
        description: 'Silenciar o activar la voz del asistente tras cada venta, regular volumen, tono femenino/masculino y sonidos beep.',
        tab: 'system',
        subTab: 'voice',
        targetElementId: 'voice-sound-settings-card',
        category: 'Sistema & Respaldos',
        icon: 'Volume2',
        keywords: ['voz', 'silenciar', 'silencio', 'ia', 'asistente', 'audio', 'habla', 'sonido', 'mudo', 'beep', 'volumen', 'parlante', 'decir', 'hablar', 'desactivar voz']
    }
];

export default function QuickSettingsFinder({ isOpen, onClose, onSelectSetting, isOwnerUser = false }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Auto-focus input on open
    useEffect(() => {
        if (isOpen) {
            setSearchQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 60);
        }
    }, [isOpen]);

    // Global Ctrl + K listener is placed in parent or here
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (isOpen) onClose();
                else onSelectSetting && onSelectSetting({ triggerOpen: true });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onSelectSetting]);

    // Filter results based on multi-token unaccented matching
    const filteredResults = useMemo(() => {
        const baseItems = isOwnerUser
            ? SETTINGS_INDEX
            : SETTINGS_INDEX.filter(item => item.id !== 'biz_country_region');
        const q = searchQuery.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!q) return baseItems.slice(0, 10);

        const tokens = q.split(/\s+/).filter(Boolean);

        return baseItems.filter(item => {
            const fullText = `${item.title} ${item.description} ${item.category} ${item.keywords.join(' ')}`
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            return tokens.every(token => fullText.includes(token));
        });
    }, [searchQuery, isOwnerUser]);

    // Keep selected index in bounds
    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredResults]);

    // Handle Keyboard Navigation (Arrows & Enter)
    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredResults.length));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filteredResults.length) % Math.max(1, filteredResults.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredResults[selectedIndex]) {
                handleItemSelect(filteredResults[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    const handleItemSelect = (item) => {
        onSelectSetting(item);
        onClose();

        // Highlight effect on target element
        setTimeout(() => {
            if (item.targetElementId) {
                const el = document.getElementById(item.targetElementId);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-4', 'ring-primary-500', 'ring-offset-4', 'transition-all', 'duration-500');
                    setTimeout(() => {
                        el.classList.remove('ring-4', 'ring-primary-500', 'ring-offset-4');
                    }, 2500);
                }
            }
        }, 300);
    };

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-[9999] bg-slate-950/70 flex items-start justify-center pt-6 sm:pt-24 px-2 sm:px-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div 
                className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[80vh] animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Search Bar Header */}
                <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-slate-950/40">
                    <Search size={20} className="text-primary-500 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Buscar ajuste... (ej. Tasa BCV, Papel 80mm, PIN, WhatsApp, IVA, SRI)"
                        className="flex-1 bg-transparent border-none text-slate-900 dark:text-white placeholder-slate-400 font-medium text-sm sm:text-base focus:outline-hidden focus:ring-0 p-0"
                    />
                    <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-500 shadow-2xs">
                        ESC
                    </kbd>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Results List */}
                <div ref={listRef} className="overflow-y-auto flex-1 p-2 sm:p-3 divide-y divide-slate-100 dark:divide-white/5">
                    {filteredResults.length > 0 ? (
                        filteredResults.map((item, idx) => {
                            const IconComponent = ICON_MAP[item.icon] || SlidersHorizontal;
                            const isSelected = idx === selectedIndex;

                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleItemSelect(item)}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                    className={`w-full text-left p-3 rounded-xl sm:rounded-2xl transition-all flex items-center justify-between gap-3 cursor-pointer ${
                                        isSelected
                                            ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25 translate-x-1'
                                            : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-800 dark:text-slate-200'
                                    }`}
                                >
                                    <div className="flex items-center gap-3.5 min-w-0">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform ${
                                            isSelected 
                                                ? 'bg-white/20 text-white scale-105' 
                                                : 'bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20'
                                        }`}>
                                            <IconComponent size={20} />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h4 className={`text-sm font-black tracking-tight truncate ${isSelected ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                                                    {item.title}
                                                </h4>
                                                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                                                    isSelected
                                                        ? 'bg-white/20 text-white'
                                                        : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
                                                }`}>
                                                    {item.category}
                                                </span>
                                            </div>
                                            <p className={`text-xs truncate mt-0.5 ${isSelected ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                                                {item.description}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {isSelected && (
                                            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-white/80 uppercase tracking-widest">
                                                Ir <CornerDownLeft size={12} />
                                            </span>
                                        )}
                                        <ArrowRight size={16} className={isSelected ? 'text-white' : 'text-slate-400'} />
                                    </div>
                                </button>
                            );
                        })
                    ) : (
                        <div className="py-12 px-4 text-center">
                            <SlidersHorizontal size={36} className="mx-auto text-slate-400 mb-3 opacity-50" />
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                No se encontraron ajustes para "{searchQuery}"
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                Intente buscar por palabras clave como "tasa", "impresora", "cajon", "iva", "pin" o "backup".
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer hints */}
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border rounded text-[10px] font-mono">↑↓</kbd> Navegar
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border rounded text-[10px] font-mono">↵</kbd> Seleccionar
                        </span>
                    </div>
                    <span>{filteredResults.length} ajustes encontrados</span>
                </div>
            </div>
        </div>
    );
}
