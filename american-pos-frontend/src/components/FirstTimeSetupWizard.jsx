import React, { useState } from 'react';
import { Store, Pill, Shirt, CheckCircle2, Globe2, Building2, ArrowRight, ArrowLeft, ShieldCheck, Check, Phone, FileText, MapPin } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { usePos } from '../hooks/PosContext';

export default function FirstTimeSetupWizard({ onCompleted }) {
    const { setBusinessMode, setGlobalSettings, globalSettings } = usePos();
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);

    // Initial values based on existing partial settings if any
    const [formData, setFormData] = useState({
        businessMode: localStorage.getItem('pos_business_mode') || 'STANDARD',
        country: globalSettings?.country || 'Ecuador',
        name: globalSettings?.businessInfo?.name || 'Isaac POS',
        taxId: globalSettings?.businessInfo?.taxId || '',
        phone: globalSettings?.businessInfo?.phone || '',
        address: globalSettings?.businessInfo?.address || ''
    });

    const handleChange = (field, val) => {
        setFormData(prev => ({ ...prev, [field]: val }));
    };

    const handleFinish = async () => {
        if (!formData.name.trim()) {
            return toast.error('El nombre del negocio es obligatorio');
        }

        setSaving(true);
        try {
            // Determine industry string matching the businessMode
            let industry = 'general';
            if (formData.businessMode === 'PHARMACY') industry = 'pharmacy';
            if (formData.businessMode === 'CLOTHING') industry = 'clothing';

            const updatedBusinessInfo = {
                ...(globalSettings?.businessInfo || {}),
                name: formData.name.trim(),
                taxId: formData.taxId.trim(),
                phone: formData.phone.trim(),
                address: formData.address.trim(),
                businessMode: formData.businessMode,
                industry: industry,
                country: formData.country,
                initialSetupCompleted: true
            };

            // Save business info to server (non-blocking if offline or without sync)
            try {
                await api.post('/settings/business', updatedBusinessInfo);
            } catch (serverErr) {
                console.warn('[SetupWizard] No se pudo guardar configuración en el servidor (modo offline o servidor no sincronizado):', serverErr.message);
            }

            // Save currency setting based on country
            const isSingleCurrencyCountry = ['ecuador', 'usa', 'panama', 'colombia'].includes((formData.country || '').toLowerCase());
            try {
                if (isSingleCurrencyCountry) {
                    await api.post('/settings/rate', { rate: 1.0, currencyMode: 'SINGLE' });
                } else if ((formData.country || '').toLowerCase() === 'venezuela') {
                    await api.post('/settings/rate', { rate: 50.0, currencyMode: 'BOTH' });
                }
            } catch (_) {}

            // Update local storage and PosContext (Always succeed locally)
            localStorage.setItem('pos_business_mode', formData.businessMode);
            localStorage.setItem('initial_setup_completed', 'true');
            localStorage.setItem('pos_business_info', JSON.stringify(updatedBusinessInfo));
            if (formData.country) localStorage.setItem('pos_country', formData.country);

            setBusinessMode(formData.businessMode);
            setGlobalSettings(prev => ({
                ...prev,
                businessInfo: updatedBusinessInfo,
                country: formData.country,
                currencyMode: isSingleCurrencyCountry ? 'SINGLE' : 'BOTH',
                rate: isSingleCurrencyCountry ? 1.0 : (prev.rate || 50.0)
            }));

            window.dispatchEvent(new Event('business_mode_changed'));
            toast.success('¡Configuración inicial completada con éxito!');

            if (onCompleted) {
                onCompleted();
            } else {
                window.location.reload();
            }
        } catch (error) {
            console.error('Error in first-time setup handler:', error);
            // Even on catastrophic error, ensure setup is marked completed locally
            localStorage.setItem('initial_setup_completed', 'true');
            if (onCompleted) onCompleted();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[99999] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-xl w-full max-w-4xl overflow-hidden flex flex-col relative my-auto">
                {/* Header Banner */}
                <div className="bg-slate-850 border-b border-slate-800 p-5 sm:p-6 text-white relative">
                    <div className="flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className="w-11 h-11 bg-primary-600/20 text-primary-400 border border-primary-500/30 rounded-lg flex items-center justify-center shrink-0">
                                <Store className="w-6 h-6" />
                            </div>
                            <div>
                                <span className="px-2 py-0.5 bg-primary-500/20 text-primary-300 rounded text-[10px] font-semibold uppercase tracking-wider border border-primary-500/30">
                                    Paso {step} de 3
                                </span>
                                <h1 className="text-base sm:text-xl font-bold tracking-tight mt-1 text-white">Asistente de Inicialización Isaac POS</h1>
                                <p className="text-xs text-slate-400 font-medium">Configura el rubro y perfil de tu negocio una única vez para proteger tu operación</p>
                            </div>
                        </div>
                        <div className="hidden sm:flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs font-semibold text-slate-200">Configuración Protegida</span>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800 h-1.5 rounded-full mt-5 overflow-hidden flex gap-1 p-0.5 border border-slate-700/60">
                        <div className={`h-full rounded-full transition-all duration-300 ${step >= 1 ? 'w-1/3 bg-primary-500' : 'w-0'}`}></div>
                        <div className={`h-full rounded-full transition-all duration-300 ${step >= 2 ? 'w-1/3 bg-primary-500' : 'w-0'}`}></div>
                        <div className={`h-full rounded-full transition-all duration-300 ${step >= 3 ? 'w-1/3 bg-primary-500' : 'w-0'}`}></div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="p-4 sm:p-6 md:p-8 flex-1 space-y-6">
                    {/* STEP 1: BUSINESS MODE / INDUSTRY */}
                    {step === 1 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4 duration-200">
                            <div className="text-center sm:text-left">
                                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                                    <Store className="w-5 h-5 text-primary-400" />
                                    1. Selecciona el Rubro y Modelo de tu Negocio
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                                    Esta decisión adaptará las unidades de inventario, pantalla de caja y reglas fiscales. Al finalizar, quedará fija para evitar errores en caja.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Option 1: Pharmacy */}
                                <div
                                    onClick={() => handleChange('businessMode', 'PHARMACY')}
                                    className={`p-5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden group ${
                                        formData.businessMode === 'PHARMACY'
                                            ? 'bg-slate-850 border-primary-500 shadow-md'
                                            : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/70'
                                    }`}
                                >
                                    {formData.businessMode === 'PHARMACY' && (
                                        <div className="absolute top-3.5 right-3.5 text-primary-400">
                                            <CheckCircle2 className="w-5 h-5 fill-primary-500 text-slate-950" />
                                        </div>
                                    )}
                                    <div>
                                        <div className="w-11 h-11 rounded-lg bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-3">
                                            <Pill className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-sm font-bold text-white">Farmacia / Clínico</h3>
                                        <span className="inline-block mt-1 px-2 py-0.5 bg-teal-500/20 text-teal-300 rounded text-[10px] font-semibold border border-teal-500/30">
                                            Control FEFO & Lotes
                                        </span>
                                        <ul className="text-xs text-slate-300 space-y-1.5 mt-3">
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-0.5" />
                                                <span>Unidades en tabletas, blíster y cajas.</span>
                                            </li>
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-0.5" />
                                                <span>Libro de Medicamentos Controlados.</span>
                                            </li>
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-0.5" />
                                                <span>Alerta inteligente de fechas de vencimiento.</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>

                                {/* Option 2: Standard / Bodega / Supermarket */}
                                <div
                                    onClick={() => handleChange('businessMode', 'STANDARD')}
                                    className={`p-5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden group ${
                                        formData.businessMode === 'STANDARD'
                                            ? 'bg-slate-850 border-primary-500 shadow-md'
                                            : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/70'
                                    }`}
                                >
                                    {formData.businessMode === 'STANDARD' && (
                                        <div className="absolute top-3.5 right-3.5 text-primary-400">
                                            <CheckCircle2 className="w-5 h-5 fill-primary-500 text-slate-950" />
                                        </div>
                                    )}
                                    <div>
                                        <div className="w-11 h-11 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3">
                                            <Store className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-sm font-bold text-white">Bodega / Supermercado</h3>
                                        <span className="inline-block mt-1 px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px] font-semibold border border-amber-500/30">
                                            Caja Rápida & Bultos
                                        </span>
                                        <ul className="text-xs text-slate-300 space-y-1.5 mt-3">
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                                <span>Pantalla ágil para escáner de código de barras.</span>
                                            </li>
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                                <span>Soporte de Bulto, Paquete y Docena.</span>
                                            </li>
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                                <span>Ideal para minimarkets, ferreterías y repuestos.</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>

                                {/* Option 3: Clothing / Boutique */}
                                <div
                                    onClick={() => handleChange('businessMode', 'CLOTHING')}
                                    className={`p-5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden group ${
                                        formData.businessMode === 'CLOTHING'
                                            ? 'bg-slate-850 border-primary-500 shadow-md'
                                            : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/70'
                                    }`}
                                >
                                    {formData.businessMode === 'CLOTHING' && (
                                        <div className="absolute top-3.5 right-3.5 text-primary-400">
                                            <CheckCircle2 className="w-5 h-5 fill-primary-500 text-slate-950" />
                                        </div>
                                    )}
                                    <div>
                                        <div className="w-11 h-11 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 mb-3">
                                            <Shirt className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-sm font-bold text-white">Tienda de Ropa / Boutique</h3>
                                        <span className="inline-block mt-1 px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[10px] font-semibold border border-purple-500/30">
                                            Tallas & Colores
                                        </span>
                                        <ul className="text-xs text-slate-300 space-y-1.5 mt-3">
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                                                <span>Gestión visual por tallas (S, M, L, XL) y calzado.</span>
                                            </li>
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                                                <span>Paleta de colores para cada variante o prenda.</span>
                                            </li>
                                            <li className="flex items-start gap-1.5">
                                                <Check className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                                                <span>Catálogo visual con cuadrícula de ropa.</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: COUNTRY AND CURRENCY MODE */}
                    {step === 2 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4 duration-200">
                            <div className="text-center sm:text-left">
                                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                                    <Globe2 className="w-5 h-5 text-primary-400" />
                                    2. Selecciona tu País y Sistema Monetario
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                                    Ajustará automáticamente si facturas en Moneda Única (USD / Dólares) o si requieres manejo Bimonetario (Tasa de Cambio diaria e IGTF).
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Ecuador / USA / Panama */}
                                <div
                                    onClick={() => handleChange('country', 'Ecuador')}
                                    className={`p-5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                                        formData.country === 'Ecuador' || formData.country === 'USA' || formData.country === 'Panama'
                                            ? 'bg-slate-850 border-primary-500 shadow-md'
                                            : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/70'
                                    }`}
                                >
                                    {formData.country === 'Ecuador' && (
                                        <div className="absolute top-3.5 right-3.5 text-primary-400">
                                            <CheckCircle2 className="w-5 h-5 fill-primary-500 text-slate-950" />
                                        </div>
                                    )}
                                    <div>
                                        <div className="flex items-center gap-3 mb-3">
                                            <span className="text-3xl">🇪🇨</span>
                                            <div>
                                                <h3 className="text-sm font-bold text-white">Ecuador / USA / Panamá</h3>
                                                <span className="inline-block mt-0.5 px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-[10px] font-semibold border border-emerald-500/30">
                                                    Moneda Única: Dólar USD ($)
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-300 leading-relaxed">
                                            Facturación nativa 100% en Dólares ($). Oculta referencias de tasa de cambio y bolívares para una experiencia limpia y directa.
                                        </p>
                                    </div>
                                </div>

                                {/* Venezuela */}
                                <div
                                    onClick={() => handleChange('country', 'Venezuela')}
                                    className={`p-5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                                        formData.country === 'Venezuela'
                                            ? 'bg-slate-850 border-primary-500 shadow-md'
                                            : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/70'
                                    }`}
                                >
                                    {formData.country === 'Venezuela' && (
                                        <div className="absolute top-3.5 right-3.5 text-primary-400">
                                            <CheckCircle2 className="w-5 h-5 fill-primary-500 text-slate-950" />
                                        </div>
                                    )}
                                    <div>
                                        <div className="flex items-center gap-3 mb-3">
                                            <span className="text-3xl">🇻🇪</span>
                                            <div>
                                                <h3 className="text-sm font-bold text-white">Venezuela</h3>
                                                <span className="inline-block mt-0.5 px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px] font-semibold border border-amber-500/30">
                                                    Modo Dual: Dólares USD + Bs
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-300 leading-relaxed">
                                            Facturación bimonetaria simultánea. Cálculo automático de Bolívares (Bs) según la tasa del día, desglose en tickets e impuestos locales.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: BUSINESS PROFILE */}
                    {step === 3 && (
                        <div className="space-y-5 animate-in slide-in-from-right-4 duration-200">
                            <div className="text-center sm:text-left">
                                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                                    <Building2 className="w-5 h-5 text-primary-400" />
                                    3. Identidad del Negocio (Ticket de Caja)
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                                    Ingresa el nombre y datos de tu local. Se imprimirán automáticamente en el encabezado de todos tus tickets e informes de venta.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-850 p-5 rounded-xl border border-slate-800">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                                        <Store className="w-3.5 h-3.5 text-primary-400" /> Nombre del Negocio / Empresa *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={e => handleChange('name', e.target.value)}
                                        placeholder="Ej: Farmacia San José / Comercial ABC"
                                        className="w-full h-10 px-3 bg-slate-900 border border-slate-700 rounded-lg text-xs sm:text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                                        <FileText className="w-3.5 h-3.5 text-primary-400" /> RUC / RIF / ID Tributario
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.taxId}
                                        onChange={e => handleChange('taxId', e.target.value)}
                                        placeholder="Ej: 1790012345001 / J-12345678-9"
                                        className="w-full h-10 px-3 bg-slate-900 border border-slate-700 rounded-lg text-xs sm:text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                                        <Phone className="w-3.5 h-3.5 text-primary-400" /> Teléfono / WhatsApp
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.phone}
                                        onChange={e => handleChange('phone', e.target.value)}
                                        placeholder="Ej: +593 99 123 4567"
                                        className="w-full h-10 px-3 bg-slate-900 border border-slate-700 rounded-lg text-xs sm:text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                                        <MapPin className="w-3.5 h-3.5 text-primary-400" /> Dirección Corta
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.address}
                                        onChange={e => handleChange('address', e.target.value)}
                                        placeholder="Ej: Av. Principal 123, Quito - Ecuador"
                                        className="w-full h-10 px-3 bg-slate-900 border border-slate-700 rounded-lg text-xs sm:text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Navigation */}
                <div className="p-4 sm:p-5 md:px-8 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] bg-slate-900 border-t border-slate-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                    {step > 1 ? (
                        <button
                            type="button"
                            onClick={() => setStep(step - 1)}
                            disabled={saving}
                            className="h-10 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" /> Anterior
                        </button>
                    ) : (
                        <div className="hidden sm:block"></div>
                    )}

                    {step < 3 ? (
                        <button
                            type="button"
                            onClick={() => setStep(step + 1)}
                            className="h-10 px-5 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer shadow-sm"
                        >
                            Continuar <ArrowRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleFinish}
                            disabled={saving}
                            className="h-10 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer shadow-sm"
                        >
                            {saving ? (
                                <>
                                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    Guardando y Protegiendo...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="w-4 h-4" /> Comenzar a Facturar en Isaac POS
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
