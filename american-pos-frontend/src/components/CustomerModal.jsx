import { useState, useEffect } from 'react';
import { X, Save, User, CreditCard, Phone, Mail, MapPin, Star, MessageCircle, Zap, BookOpen, FileText, Maximize2, Minimize2, Wallet } from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';
import { triggerHaptic } from '../utils/haptics';

export default function CustomerModal({ isOpen, onClose, onSave, customer = null, processing = false }) {
    const [formData, setFormData] = useState({
        name: '',
        idDocument: '',
        phone: '',
        email: '',
        address: '',
        creditLimit: '0',
        creditBalance: '0',
        loyaltyPoints: '0',
        isVIP: false,
    });

    // Expandido por defecto al tamaño de la pantalla
    const [isMaximized, setIsMaximized] = useState(true);
    const effectiveCountry = localStorage.getItem('pos_country') || '';
    const isEcuador = effectiveCountry.toLowerCase().includes('ecuador');
    const isDollarCountry = ['ecuador', 'panama', 'usa', 'eeuu', 'estadosunidos'].some(c => effectiveCountry.toLowerCase().includes(c));

    useEffect(() => {
        if (customer) {
            setFormData({
                name: customer.name || '',
                idDocument: customer.idDocument || '',
                phone: customer.phone || '',
                email: customer.email || '',
                address: customer.address || '',
                creditLimit: customer.creditLimit !== undefined ? (Math.round(parseFloat(customer.creditLimit) * 100) / 100).toString() : '0',
                creditBalance: customer.creditBalance !== undefined ? (Math.round(parseFloat(customer.creditBalance) * 100) / 100).toString() : '0',
                loyaltyPoints: customer.loyaltyPoints !== undefined ? (Math.round(parseFloat(customer.loyaltyPoints) * 100) / 100).toString() : '0',
                isVIP: !!customer.isVIP,
            });
        } else {
            setFormData({
                name: '',
                idDocument: '',
                phone: '',
                email: '',
                address: '',
                creditLimit: '0',
                creditBalance: '0',
                loyaltyPoints: '0',
                isVIP: false,
            });
        }
    }, [customer, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleCloseModal = () => {
        triggerHaptic('light');
        onClose();
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        triggerHaptic('medium');
        const payload = {
            ...formData,
            creditLimit: parseFloat(formData.creditLimit) || 0,
            creditBalance: parseFloat(formData.creditBalance) || 0,
            loyaltyPoints: parseFloat(formData.loyaltyPoints) || 0,
            isVIP: !!formData.isVIP,
        };
        onSave(payload);
    };

    const handleSendCatalog = async () => {
        if (!formData.phone) {
            toast.error('Ingrese un número de teléfono primero');
            return;
        }

        try {
            const loadingToast = toast.loading('Generando catálogo digital...');
            const { data } = await api.get('/catalog/whatsapp');
            toast.dismiss(loadingToast);

            const encodedText = encodeURIComponent(data.text);
            const phone = formData.phone.replace(/[^0-9]/g, '');
            window.open(`https://wa.me/${phone}?text=${encodedText}`, '_blank');
        } catch (error) {
            console.error('Error sharing catalog:', error);
            toast.error('Error al generar el catálogo');
        }
    };

    const handleDownloadPdfCatalog = async () => {
        try {
            const loadingToast = toast.loading('Diseñando catálogo PDF profesional...');
            const response = await api.get('/catalog/pdf', { 
                responseType: 'arraybuffer',
                timeout: 60000 // 60 seconds for large catalogs
            });
            
            // Validate it's a PDF by checking the first 4 bytes (%PDF)
            const arr = new Uint8Array(response.data);
            const isPdf = arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46;

            if (!isPdf) {
                const text = new TextDecoder().decode(response.data);
                try {
                    const errorData = JSON.parse(text);
                    throw new Error(errorData.error || 'Error del servidor');
                } catch (_e) {
                    throw new Error('El archivo generado no es un PDF válido');
                }
            }

            toast.dismiss(loadingToast);

            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Catalogo_IsaacPOS_${new Date().toISOString().split('T')[0]}.pdf`);
            document.body.appendChild(link);
            link.click();
            
            setTimeout(() => {
                link.remove();
                window.URL.revokeObjectURL(url);
            }, 100);
            
            toast.success('✅ ¡Catálogo PDF generado con éxito!');
        } catch (error) {
            console.error('Error downloading PDF catalog:', error);
            toast.error('Fallo al generar PDF: ' + (error.message || 'Error técnico'));
        }
    };

    const availableCredit = Math.max(0, (parseFloat(formData.creditLimit) || 0) - (parseFloat(formData.creditBalance) || 0));

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={handleCloseModal}
            maxWidth={isMaximized ? "max-w-[96vw] w-[96vw]" : "max-w-2xl"}
            className={`${isMaximized ? "h-[92vh] max-h-[92vh]" : ""} overflow-hidden flex flex-col transition-all duration-200`}
        >
            {/* Header */}
            <div className="relative px-5 sm:px-7 py-4 flex justify-between items-center group border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="absolute inset-0 bg-gradient-to-r from-primary-600/5 to-transparent dark:from-primary-400/5 pointer-events-none" />
                <div className="relative flex items-center gap-3">
                    <div className="p-2.5 bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded-2xl">
                        <User size={22} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h2 className="text-lg sm:text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">
                            {customer?.id ? 'Editar Cliente' : 'Nuevo Cliente'}
                        </h2>
                        <p className="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Información Versátil
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="relative p-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
                        title={isMaximized ? "Restaurar tamaño normal" : "Maximizar a pantalla completa"}
                    >
                        {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                    <button
                        type="button"
                        onClick={handleCloseModal}
                        className="relative p-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all hover:rotate-90 group/close min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
                        disabled={processing}
                        aria-label="Cerrar modal"
                    >
                        <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 rounded-full scale-0 group-hover/close:scale-100 transition-transform duration-300" />
                        <X size={20} className="relative z-10" />
                    </button>
                </div>
            </div>

            {/* Body / Form */}
            <div className="px-5 sm:px-7 py-5 overflow-y-auto flex-1 custom-scrollbar">
                <form id="customer-form" onSubmit={handleSubmit} className="h-full pb-4">
                    <div className={`grid grid-cols-1 ${isMaximized ? 'lg:grid-cols-12 gap-8 items-start' : 'gap-5'}`}>
                        
                        {/* Columna Izquierda: Datos Personales / Fiscales */}
                        <div className={`${isMaximized ? 'lg:col-span-7 space-y-4' : 'space-y-4'}`}>
                            {isMaximized && (
                                <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-slate-800">
                                    <span className="text-[11px] font-bold tracking-wider uppercase text-primary-600 dark:text-primary-400">
                                        1. Datos de Identificación y Contacto
                                    </span>
                                </div>
                            )}

                            {/* Full Name */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 ml-1">Nombre o Razón Social *</label>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary-500 transition-colors">
                                        <User size={16} />
                                    </div>
                                    <input
                                        required
                                        autoFocus
                                        type="text"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        className="w-full pl-10 pr-3 h-11 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors text-slate-900 dark:text-white text-xs sm:text-sm font-medium placeholder-slate-400"
                                        placeholder="Nombre completo del titular o empresa..."
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* ID Document */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 ml-1">
                                        {isEcuador ? 'RUC o Cédula' : (isDollarCountry ? 'Documento / ID' : 'Cédula o RIF')}
                                    </label>
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary-500 transition-colors">
                                            <CreditCard size={16} />
                                        </div>
                                        <input
                                            type="text"
                                            name="idDocument"
                                            value={formData.idDocument}
                                            onChange={handleChange}
                                            className="w-full pl-10 pr-3 h-11 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors text-slate-900 dark:text-white text-xs sm:text-sm font-medium placeholder-slate-400 uppercase"
                                            placeholder={isEcuador ? 'Ej: 1790012345001 o 0912345678' : (isDollarCountry ? 'Ej: ID-12345678' : 'Ej: V-12345678')}
                                        />
                                    </div>
                                </div>

                                {/* Phone */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 ml-1">Teléfono Móvil</label>
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary-500 transition-colors">
                                            <Phone size={16} />
                                        </div>
                                        <input
                                            type="tel"
                                            name="phone"
                                            value={formData.phone}
                                            onChange={handleChange}
                                            className="w-full pl-10 pr-3 h-11 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors text-slate-900 dark:text-white text-xs sm:text-sm font-medium placeholder-slate-400"
                                            placeholder={isEcuador ? 'Ej: 0991234567' : 'Ej: 0412-1234567'}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Acciones de WhatsApp / Catálogo si hay teléfono */}
                            {formData.phone && (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <a 
                                        href={`https://wa.me/${formData.phone.replace(/[^0-9]/g, '')}`} 
                                        target="_blank" 
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
                                        title="Contactar por WhatsApp"
                                    >
                                        <MessageCircle size={14} /> WhatsApp
                                    </a>
                                    <button 
                                        type="button"
                                        onClick={handleSendCatalog}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer shadow-xs"
                                        title="Enviar Catálogo por WhatsApp"
                                    >
                                        <BookOpen size={14} /> Catálogo
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={handleDownloadPdfCatalog}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
                                        title="Descargar Catálogo PDF"
                                    >
                                        <FileText size={14} /> PDF
                                    </button>
                                </div>
                            )}

                            {/* Email */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 ml-1">E-mail Corporativo</label>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary-500 transition-colors">
                                        <Mail size={16} />
                                    </div>
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        className="w-full pl-10 pr-3 h-11 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors text-slate-900 dark:text-white text-xs sm:text-sm font-medium placeholder-slate-400 lowercase"
                                        placeholder="ejemplo@servidor.com"
                                    />
                                </div>
                            </div>

                            {/* Address */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 ml-1">Dirección Fiscal / Ubicación Comercial</label>
                                <div className="relative group">
                                    <div className="absolute top-3 left-3.5 pointer-events-none text-slate-400 group-focus-within:text-primary-500 transition-colors">
                                        <MapPin size={16} />
                                    </div>
                                    <textarea
                                        name="address"
                                        value={formData.address}
                                        onChange={handleChange}
                                        rows={isMaximized ? "3" : "2"}
                                        className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none transition-colors text-slate-900 dark:text-white text-xs sm:text-sm font-medium placeholder-slate-400 resize-none leading-relaxed"
                                        placeholder="Indique dirección completa, sector o punto de referencia..."
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Columna Derecha: VIP, Condiciones Comerciales y Crédito */}
                        <div className={`${isMaximized ? 'lg:col-span-5 space-y-4' : 'space-y-4'}`}>
                            {isMaximized && (
                                <div className="flex items-center gap-2 pb-1 border-b border-slate-100 dark:border-slate-800">
                                    <span className="text-[11px] font-bold tracking-wider uppercase text-amber-600 dark:text-amber-400">
                                        2. Perfil Comercial y Créditos
                                    </span>
                                </div>
                            )}

                            {/* VIP Switch */}
                            <div 
                                className={`relative p-4 rounded-xl border transition-all cursor-pointer overflow-hidden group select-none shadow-xs ${formData.isVIP 
                                        ? 'bg-amber-500/10 border-amber-400 dark:border-amber-600 ring-1 ring-amber-400/30' 
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}
                                onClick={() => setFormData(prev => ({ ...prev, isVIP: !prev.isVIP }))}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3.5">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${formData.isVIP 
                                                ? 'bg-amber-500 text-white shadow-xs' 
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                                            <Star size={20} fill={formData.isVIP ? "currentColor" : "none"} strokeWidth={2} />
                                        </div>
                                        <div>
                                            <span className={`block text-xs sm:text-sm font-bold uppercase tracking-tight ${formData.isVIP ? 'text-amber-900 dark:text-amber-200' : 'text-slate-800 dark:text-slate-200'}`}>
                                                Cliente VIP / Prioritario
                                            </span>
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                                Condiciones comerciales y atención preferencial
                                            </span>
                                        </div>
                                    </div>
                                    <div className={`w-12 h-6 rounded-full p-0.5 transition-colors ${formData.isVIP ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                        <div 
                                            className={`w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${formData.isVIP ? 'translate-x-6' : 'translate-x-0'}`}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Bloque Financiero y Cuentas */}
                            <div className="bg-slate-50 dark:bg-slate-950/60 p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                                        <Wallet size={16} className="text-primary-500" /> Límites & Fidelidad
                                    </span>
                                    {parseFloat(formData.creditLimit) > 0 && (
                                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                                            Crédito Habilitado
                                        </span>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                    {/* Credit Limit */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Límite de Crédito</label>
                                        </div>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-600 dark:text-emerald-400 text-sm">$</span>
                                            <input
                                                type="number"
                                                step="any"
                                                min="0"
                                                name="creditLimit"
                                                value={formData.creditLimit}
                                                onChange={handleChange}
                                                className="w-full pl-7 pr-3 h-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none text-slate-900 dark:text-white font-mono font-bold text-sm tabular-nums"
                                            />
                                        </div>
                                        <p className="text-[10px] text-slate-400">Cupo máximo autorizado</p>
                                    </div>

                                    {/* Credit Balance */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Saldo Pendiente</label>
                                        </div>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-rose-500 text-sm">$</span>
                                            <input
                                                type="number"
                                                step="any"
                                                name="creditBalance"
                                                value={formData.creditBalance}
                                                onChange={handleChange}
                                                className="w-full pl-7 pr-3 h-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none text-rose-700 dark:text-rose-400 font-mono font-bold text-sm tabular-nums"
                                            />
                                        </div>
                                        <p className="text-[10px] text-slate-400">Cuenta por cobrar</p>
                                    </div>
                                </div>

                                {/* Loyalty Points */}
                                <div className="space-y-1.5 pt-1">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Puntos de Fidelidad</label>
                                    </div>
                                    <div className="relative">
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-500">
                                            <Zap size={16} fill="currentColor" />
                                        </div>
                                        <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            name="loyaltyPoints"
                                            value={formData.loyaltyPoints}
                                            onChange={handleChange}
                                            className="w-full pl-8 pr-3 h-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none text-slate-900 dark:text-white font-mono font-bold text-sm tabular-nums"
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-400">Saldo acumulado para promociones y canje</p>
                                </div>

                                {/* Resumen Disponible Estimado si tiene cupo */}
                                {parseFloat(formData.creditLimit) > 0 && (
                                    <div className="p-3 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs">
                                        <span className="text-emerald-800 dark:text-emerald-300 font-medium">Crédito disponible para compras:</span>
                                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300 text-sm">
                                            ${availableCredit.toFixed(2)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </form>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-7 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end gap-3 shrink-0">
                <button
                    type="button"
                    onClick={handleCloseModal}
                    disabled={processing}
                    className="px-5 py-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 uppercase tracking-wider transition-colors cursor-pointer"
                >
                    Cancelar
                </button>
                <button
                    type="submit"
                    form="customer-form"
                    disabled={processing}
                    className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs text-white bg-sky-600 hover:bg-sky-700 transition-colors uppercase tracking-wider shadow-sm cursor-pointer disabled:opacity-50"
                >
                    {processing ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                    ) : (
                        <>
                            <Save size={16} /> 
                            <span>{customer ? 'Guardar Cambios' : 'Guardar Cliente'}</span>
                        </>
                    )}
                </button>
            </div>
        </BaseModal>
    );
}
