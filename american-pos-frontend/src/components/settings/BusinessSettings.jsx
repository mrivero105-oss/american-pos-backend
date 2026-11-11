import { useState } from 'react';
import { Store, Save, Loader2, Printer, ShieldCheck, Settings2, Building2, Phone, Mail, MapPin, Receipt, Coins, Upload, Trash2, Image as ImageIcon, Crop } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import SupervisorAuthModal from '../SupervisorAuthModal';
import { getTaxIdLabel, getTaxIdPlaceholder } from '../../utils/format';

/**
 * Recorta automáticamente bordes blancos o transparentes vacíos de un logo
 * y lo escala proporcionalmente para que encaje perfecto en el visor y comprobantes.
 */
const trimAndCropImage = (imgSrc) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0);

            try {
                const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const { data, width, height } = imgData;

                let minX = width, minY = height, maxX = 0, maxY = 0;
                let foundNonBackground = false;

                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const idx = (y * width + x) * 4;
                        const r = data[idx];
                        const g = data[idx + 1];
                        const b = data[idx + 2];
                        const a = data[idx + 3];

                        // Considerar píxeles que no son transparentes ni fondo casi blanco puro
                        const isTransparent = a < 25;
                        const isWhite = r > 242 && g > 242 && b > 242;

                        if (!isTransparent && !isWhite) {
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                            foundNonBackground = true;
                        }
                    }
                }

                // Si encontramos bordes vacíos y el contenido no ocupa todo el lienzo
                if (foundNonBackground && (maxX > minX) && (maxY > minY)) {
                    // Margen de seguridad estético (3%)
                    const pad = Math.max(4, Math.round(Math.min(maxX - minX, maxY - minY) * 0.03));
                    minX = Math.max(0, minX - pad);
                    minY = Math.max(0, minY - pad);
                    maxX = Math.min(width - 1, maxX + pad);
                    maxY = Math.min(height - 1, maxY + pad);

                    const cropW = maxX - minX + 1;
                    const cropH = maxY - minY + 1;

                    const MAX_SIZE = 512;
                    let targetW = cropW;
                    let targetH = cropH;

                    if (targetW > MAX_SIZE || targetH > MAX_SIZE) {
                        if (targetW > targetH) {
                            targetH = Math.round((targetH * MAX_SIZE) / targetW);
                            targetW = MAX_SIZE;
                        } else {
                            targetW = Math.round((targetW * MAX_SIZE) / targetH);
                            targetH = MAX_SIZE;
                        }
                    }

                    const finalCanvas = document.createElement('canvas');
                    finalCanvas.width = targetW;
                    finalCanvas.height = targetH;
                    const finalCtx = finalCanvas.getContext('2d');
                    finalCtx.drawImage(tempCanvas, minX, minY, cropW, cropH, 0, 0, targetW, targetH);
                    resolve(finalCanvas.toDataURL('image/png', 0.95));
                    return;
                }
            } catch (err) {
                console.warn('Auto-trimming canvas error, using fallback:', err);
            }

            // Fallback: Redimensión regular
            const MAX_SIZE = 512;
            let targetW = img.width;
            let targetH = img.height;
            if (targetW > MAX_SIZE || targetH > MAX_SIZE) {
                if (targetW > targetH) {
                    targetH = Math.round((targetH * MAX_SIZE) / targetW);
                    targetW = MAX_SIZE;
                } else {
                    targetW = Math.round((targetW * MAX_SIZE) / targetH);
                    targetH = MAX_SIZE;
                }
            }
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = targetW;
            finalCanvas.height = targetH;
            const finalCtx = finalCanvas.getContext('2d');
            finalCtx.drawImage(img, 0, 0, targetW, targetH);
            resolve(finalCanvas.toDataURL('image/png', 0.95));
        };
        img.onerror = () => resolve(imgSrc);
        img.src = imgSrc;
    });
};

export const BUSINESS_MODES = [
    { id: 'STANDARD', label: 'Bodega / Supermercado (Comercio General)', icon: '🛒', desc: 'Ventas al mayor y detal, múltiples unidades y control de inventario general' },
    { id: 'PHARMACY', label: 'Farmacia / Droguería (Control Clínico)', icon: '💊', desc: 'Control de lotes, vencimiento FEFO, componente activo y recetas' },
    { id: 'CLOTHING', label: 'Tienda de Ropa & Boutique', icon: '👗', desc: 'Control de matriz de tallas, colores y colecciones de temporada' }
];

export default function BusinessSettings({
    business,
    setBusiness,
    systemPrinters = [],
    saving,
    onSave,
    onTestPrint,
    onTestDrawer
}) {
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [isTrimming, setIsTrimming] = useState(false);

    const handleLogoUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error('Por favor selecciona un archivo de imagen válido (PNG, JPG, WebP)');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            const rawBase64 = event.target.result;
            const optimizedBase64 = await trimAndCropImage(rawBase64);
            setBusiness(prev => ({ ...prev, logo: optimizedBase64 }));
            toast.success('Logotipo recortado y optimizado. Recuerda guardar cambios.', { icon: '✨' });
        };
        reader.readAsDataURL(file);
    };

    const handleAutoFitLogo = async () => {
        if (!business.logo) return;
        setIsTrimming(true);
        try {
            const trimmed = await trimAndCropImage(business.logo);
            setBusiness(prev => ({ ...prev, logo: trimmed }));
            toast.success('¡Logotipo ajustado al marco exitosamente! Guarda los cambios.', { icon: '✂️' });
        } catch (e) {
            toast.error('No se pudo recortar la imagen');
        } finally {
            setIsTrimming(false);
        }
    };

    const handleRemoveLogo = () => {
        setBusiness(prev => ({ ...prev, logo: '' }));
        toast('Logotipo eliminado. Guarda los cambios para confirmar.', { icon: '🗑️' });
    };

    const handleAuthReconfigure = async () => {
        setShowAuthModal(false);
        try {
            await api.post('/settings/business', { ...business, initialSetupCompleted: false });
            localStorage.removeItem('initial_setup_completed');
            window.location.reload();
        } catch (e) {
            toast.error('Error al solicitar reconfiguración');
        }
    };

    const currentMode = (business.businessMode || localStorage.getItem('pos_business_mode') || 'STANDARD').toUpperCase();
    const activeModeConfig = BUSINESS_MODES.find(m => m.id === currentMode) || BUSINESS_MODES[0];
    const effectiveCountry = business.country || (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_country') : '') || 'venezuela';
    const taxIdLabel = getTaxIdLabel(effectiveCountry);
    const taxIdPlaceholder = getTaxIdPlaceholder(effectiveCountry);

    return (
        <div className="space-y-8">
            {/* Formulario Principal */}
            <form onSubmit={onSave} className="space-y-6">
                {/* 1. Datos Principales del Negocio */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                            <Store size={20} />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                                Identidad Fiscal & Comercial
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                                {`Nombre comercial, ${taxIdLabel} y datos de contacto en comprobantes`}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Denominación Comercial */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Denominación Comercial / Nombre *
                            </label>
                            <div className="relative">
                                <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    required
                                    value={business.name || ''}
                                    onChange={(e) => setBusiness({ ...business, name: e.target.value })}
                                    placeholder="EJ: BODEGA SIGFRIDO C.A."
                                    className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all uppercase"
                                />
                            </div>
                        </div>

                        {/* RIF / Documento Fiscal */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                {taxIdLabel === 'RUC' ? 'Registro Único de Contribuyentes (RUC) *' : (taxIdLabel === 'NIT' ? 'Número de Identificación Tributaria (NIT) *' : 'Registro de Identificación Fiscal (RIF) *')}
                            </label>
                            <div className="relative">
                                <Receipt size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    required
                                    value={business.rif || ''}
                                    onChange={(e) => setBusiness({ ...business, rif: e.target.value })}
                                    placeholder={taxIdPlaceholder}
                                    className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all uppercase"
                                />
                            </div>
                        </div>

                        {/* Teléfono */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Teléfono de Contacto
                            </label>
                            <div className="relative">
                                <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={business.phone || ''}
                                    onChange={(e) => setBusiness({ ...business, phone: e.target.value })}
                                    placeholder="+58 414 0000000"
                                    className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all"
                                />
                            </div>
                        </div>

                        {/* Correo Electrónico */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Correo Electrónico
                            </label>
                            <div className="relative">
                                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="email"
                                    value={business.email || ''}
                                    onChange={(e) => setBusiness({ ...business, email: e.target.value })}
                                    placeholder="contacto@empresa.com"
                                    className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all"
                                />
                            </div>
                        </div>

                        {/* Dirección Física */}
                        <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Dirección Física del Establecimiento
                            </label>
                            <div className="relative">
                                <MapPin size={16} className="absolute left-3.5 top-3 text-slate-400" />
                                <textarea
                                    rows={2}
                                    value={business.address || ''}
                                    onChange={(e) => setBusiness({ ...business, address: e.target.value })}
                                    placeholder="Av. Principal, Edificio Central, Local 1..."
                                    className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all"
                                />
                            </div>
                        </div>

                        {/* Logotipo Oficial del Negocio */}
                        <div className="md:col-span-2 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
                            {/* Vista Previa del Logo */}
                            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center p-2 shrink-0 shadow-2xs overflow-hidden relative">
                                {business.logo ? (
                                    <img 
                                        src={business.logo} 
                                        alt="Logo del negocio" 
                                        className="w-full h-full object-contain"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-slate-400 text-center p-2">
                                        <ImageIcon size={22} className="mb-1 opacity-60" />
                                        <span className="text-[10px] font-semibold text-slate-500">Sin Logo</span>
                                    </div>
                                )}
                            </div>

                            {/* Controles de Subida */}
                            <div className="flex-1 text-center sm:text-left space-y-1.5">
                                <div>
                                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                                        <label className="text-xs font-bold text-slate-800 dark:text-white">
                                            Logotipo del Establecimiento
                                        </label>
                                        <span className="px-2 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300 text-[10px] font-medium border border-primary-200 dark:border-primary-800/60">
                                            Visor & Comprobantes
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                                        Se mostrará en la pantalla para clientes, comprobantes electrónicos y tickets impresos.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start pt-1">
                                    <label className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-xs cursor-pointer shadow-xs transition-colors">
                                        <Upload size={14} />
                                        <span>{business.logo ? 'Cambiar Logo' : 'Subir Logo'}</span>
                                        <input 
                                            type="file" 
                                            accept="image/png, image/jpeg, image/jpg, image/webp" 
                                            className="hidden" 
                                            onChange={handleLogoUpload}
                                        />
                                    </label>

                                    {business.logo && (
                                        <button
                                            type="button"
                                            onClick={handleAutoFitLogo}
                                            disabled={isTrimming}
                                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg font-medium text-xs transition-colors cursor-pointer disabled:opacity-50"
                                            title="Recortar espacios blancos y ajustar al marco"
                                        >
                                            {isTrimming ? <Loader2 size={13} className="animate-spin" /> : <Crop size={13} />}
                                            <span>Ajustar al Marco</span>
                                        </button>
                                    )}

                                    {business.logo && (
                                        <button
                                            type="button"
                                            onClick={handleRemoveLogo}
                                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 rounded-lg font-medium text-xs transition-colors cursor-pointer"
                                            title="Eliminar logotipo"
                                        >
                                            <Trash2 size={13} />
                                            <span>Eliminar</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Rubro Operativo */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                            <span className="text-3xl">{activeModeConfig.icon}</span>
                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Rubro Operativo Activo</span>
                                    <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 rounded-full text-[10px] font-semibold flex items-center gap-1">
                                        <ShieldCheck size={11} /> Protegido
                                    </span>
                                </div>
                                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-0.5">
                                    {activeModeConfig.label}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xl">
                                    {activeModeConfig.desc}
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowAuthModal(true)}
                            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2 shrink-0 w-fit"
                        >
                            <Settings2 size={14} className="text-primary-600" />
                            <span>Reconfigurar</span>
                        </button>
                    </div>
                </div>

                {/* Info Impresoras Reubicado */}
                <div className="rounded-2xl p-4 sm:p-5 border border-primary-200 dark:border-primary-800/40 bg-primary-50/40 dark:bg-primary-950/20 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-9 h-9 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 rounded-lg flex items-center justify-center border border-primary-200 dark:border-primary-800/60 shrink-0">
                            <Printer size={18} />
                        </div>
                        <div>
                            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                                Impresoras, Red & Periféricos
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-400 font-normal mt-0.5">
                                La configuración de impresoras USB, Red y apertura de gaveta cuenta con una pestaña dedicada en la barra superior.
                            </p>
                        </div>
                    </div>
                </div>

                {/* 3. Control de Caja & Cierre de Turno */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                            <Coins size={20} />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                                Control de Caja & Cierre de Turno
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5">
                                Modalidad de arqueo de turnos y tolerancia permitida
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Modalidad de Cierre */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Modalidad de Cierre de Caja
                            </label>
                            <select
                                value={business.cashClosureMode || 'ASSISTED'}
                                onChange={(e) => {
                                    const newMode = e.target.value;
                                    setBusiness({ ...business, cashClosureMode: newMode });
                                    localStorage.setItem('pos_cash_closure_mode', newMode);
                                }}
                                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all cursor-pointer"
                            >
                                <option value="ASSISTED">🟢 Cierre Asistido / Transparente (Recomendado)</option>
                                <option value="BLIND">🔒 Cierre Ciego Tradicional</option>
                            </select>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                {business.cashClosureMode === 'BLIND' 
                                    ? 'El cajero declara montos sin ver cifras teóricas ni comparativas.'
                                    : 'Muestra montos teóricos, desglose en tiempo real y diferencias por método de pago.'}
                            </p>
                        </div>

                        {/* Tolerancia de Descuadre */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                Tolerancia de Descuadre (USD)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">$</span>
                                <input
                                    type="number"
                                    step="0.10"
                                    min="0"
                                    value={business.cashDifferenceToleranceUsd ?? 1.0}
                                    onChange={(e) => setBusiness({ ...business, cashDifferenceToleranceUsd: parseFloat(e.target.value) || 0 })}
                                    placeholder="1.00"
                                    className="w-full pl-8 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all"
                                />
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                Diferencia máxima en USD permitida antes de exigir PIN de supervisor.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Botón Guardar Cambios */}
                <div className="flex justify-end pt-1">
                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full sm:w-auto px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                    >
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        <span>Guardar Perfil Empresarial</span>
                    </button>
                </div>
            </form>

            {/* Auth Modal para Reconfigurar Rubro */}
            <SupervisorAuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
                onAuthorized={handleAuthReconfigure}
                actionType="RECONFIGURE_BUSINESS_RUBRO"
                actionLabel="reconfigurar rubro de negocio"
            />
        </div>
    );
}
