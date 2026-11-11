import { useState, useEffect, useRef } from 'react';
import { X, Save, Upload, Image as ImageIcon, User, Phone, Mail, MapPin, FileText, Globe } from 'lucide-react';
import { motion } from 'framer-motion';
import { getImageUrl } from '../utils/imageUtils';
import BaseModal from './BaseModal';
import SupplierLogoSearchModal from './SupplierLogoSearchModal';
import { getSupplierInitials, getSupplierTheme } from './SupplierLogoBox';

export default function SupplierModal({ isOpen, onClose, onSave, supplier = null, processing = false }) {
    const fileInputRef = useRef(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [isLogoSearchOpen, setIsLogoSearchOpen] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        contact: '',
        phone: '',
        email: '',
        address: '',
        notes: '',
        logoUri: ''
    });

    useEffect(() => {
        if (supplier) {
            setFormData({
                name: supplier.name || '',
                contact: supplier.contact || '',
                phone: supplier.phone || '',
                email: supplier.email || '',
                address: supplier.address || '',
                notes: supplier.notes || '',
                logoUri: supplier.logoUri || ''
            });
            setImagePreview(supplier.logoUri ? getImageUrl(supplier.logoUri) : null);
        } else {
            setFormData({
                name: '',
                contact: '',
                phone: '',
                email: '',
                address: '',
                notes: '',
                logoUri: ''
            });
            setImagePreview(null);
        }
        setSelectedFile(null);
    }, [supplier, isOpen]);

    if (!isOpen) return null;

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData, selectedFile);
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                maxWidth="max-w-3xl"
                className="overflow-hidden flex flex-col max-h-[92dvh] pb-safe transition-all"
            >

                        {/* Header */}
                        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-200 dark:border-indigo-800/40 shrink-0">
                                    <ImageIcon size={20} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                                        {supplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                                    </h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        Gestión de Proveedores y Catálogos
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
                                disabled={processing}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Body / Form */}
                        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1 custom-scrollbar">
                            <form id="supplier-form" onSubmit={handleSubmit} className="space-y-4">

                                <div className="flex flex-col md:flex-row gap-5 items-start">
                                    {/* Logo Upload Section */}
                                    <div className="flex flex-col items-center gap-2 self-center md:self-start w-32 shrink-0">
                                        <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Logo</label>
                                        <div 
                                            onClick={triggerFileInput}
                                            className={`w-28 h-28 rounded-2xl flex items-center justify-center cursor-pointer border-2 transition-all duration-200 overflow-hidden relative group shadow-sm hover:scale-[1.02] active:scale-95 ${
                                                imagePreview 
                                                    ? 'border-emerald-500/40 dark:border-emerald-500/40 bg-white dark:bg-slate-900 ring-2 ring-emerald-500/10' 
                                                    : formData.name?.trim()
                                                    ? 'border-slate-300 dark:border-slate-700'
                                                    : 'border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 hover:border-emerald-500 dark:hover:border-emerald-400'
                                            }`}
                                        >
                                            {imagePreview ? (
                                                <>
                                                    <div className="w-full h-full p-2.5 flex items-center justify-center bg-white dark:bg-slate-900">
                                                        <img src={imagePreview} alt="Preview" className="w-full h-full object-contain drop-shadow-xs" />
                                                    </div>
                                                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[1px] flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
                                                        <Upload size={22} className="text-emerald-400 drop-shadow-sm mb-1" />
                                                        <span className="text-[10px] font-bold tracking-wide uppercase">Cambiar</span>
                                                    </div>
                                                </>
                                            ) : formData.name?.trim() ? (
                                                <div className={`w-full h-full bg-gradient-to-br ${getSupplierTheme(formData.name).bg} text-white flex flex-col items-center justify-center font-black uppercase relative select-none shadow-inner`}>
                                                    <span className="text-2xl font-black tracking-wider drop-shadow-sm">{getSupplierInitials(formData.name)}</span>
                                                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-white/20 opacity-80" />
                                                    <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[1px] flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white">
                                                        <Upload size={22} className="text-emerald-400 drop-shadow-sm mb-1" />
                                                        <span className="text-[10px] font-bold tracking-wide uppercase">Subir Logo</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center text-slate-400 group-hover:text-emerald-500 transition-colors p-2 text-center">
                                                    <ImageIcon size={30} />
                                                    <span className="text-[10px] font-bold uppercase tracking-wider mt-1.5">Subir Logo</span>
                                                </div>
                                            )}
                                        </div>
                                        <input 
                                            type="file" 
                                            ref={fileInputRef} 
                                            onChange={handleImageChange} 
                                            accept="image/*" 
                                            className="hidden" 
                                        />

                                        {/* Action buttons under logo */}
                                        <div className="flex flex-col items-center gap-1 w-full">
                                            <button
                                                type="button"
                                                onClick={() => setIsLogoSearchOpen(true)}
                                                className="w-full py-1.5 px-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/40 text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            >
                                                <Globe size={12} className="shrink-0" />
                                                <span className="truncate">Buscar Logo Online</span>
                                            </button>

                                            {imagePreview && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setImagePreview(null);
                                                        setSelectedFile(null);
                                                        setFormData(prev => ({ ...prev, logoUri: '' }));
                                                        if (fileInputRef.current) fileInputRef.current.value = '';
                                                    }}
                                                    className="text-[10px] text-rose-500 hover:text-rose-600 font-semibold uppercase tracking-wider transition-colors py-0.5 cursor-pointer"
                                                >
                                                    Eliminar Logo
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex-1 space-y-4 w-full">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Razón Social / Nombre *</label>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                                    <User size={16} />
                                                </div>
                                                <input
                                                    required
                                                    type="text"
                                                    name="name"
                                                    value={formData.name}
                                                    onChange={handleChange}
                                                    className="w-full pl-9 pr-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-slate-900 dark:text-white font-medium text-xs sm:text-sm min-h-[40px] placeholder:text-slate-400"
                                                    placeholder="Nombre de la empresa proveedora..."
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Persona de Contacto</label>
                                                <div className="relative">
                                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                                        <User size={16} />
                                                    </div>
                                                    <input
                                                        type="text"
                                                        name="contact"
                                                        value={formData.contact}
                                                        onChange={handleChange}
                                                        className="w-full pl-9 pr-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-slate-900 dark:text-white font-medium text-xs sm:text-sm min-h-[40px] placeholder:text-slate-400"
                                                        placeholder="Nombre del representante..."
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Teléfono</label>
                                                <div className="relative">
                                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                                        <Phone size={16} />
                                                    </div>
                                                    <input
                                                        type="tel"
                                                        name="phone"
                                                        value={formData.phone}
                                                        onChange={handleChange}
                                                        className="w-full pl-9 pr-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-slate-900 dark:text-white font-medium text-xs sm:text-sm min-h-[40px] placeholder:text-slate-400 font-mono"
                                                        placeholder="0412-5556677"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Correo Electrónico</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                            <Mail size={16} />
                                        </div>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="w-full pl-9 pr-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-slate-900 dark:text-white font-medium text-xs sm:text-sm min-h-[40px] placeholder:text-slate-400 lowercase"
                                            placeholder="empresa@proveedor.com"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Dirección Fiscal / Operaciones</label>
                                    <div className="relative">
                                        <div className="absolute top-2.5 left-3 pointer-events-none text-slate-400">
                                            <MapPin size={16} />
                                        </div>
                                        <textarea
                                            name="address"
                                            value={formData.address}
                                            onChange={handleChange}
                                            rows="2"
                                            className="w-full pl-9 pr-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-slate-900 dark:text-white font-medium text-xs sm:text-sm min-h-[40px] placeholder:text-slate-400 resize-none leading-relaxed"
                                            placeholder="Dirección fiscal o de almacén..."
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Notas Adicionales</label>
                                    <div className="relative">
                                        <div className="absolute top-2.5 left-3 pointer-events-none text-slate-400">
                                            <FileText size={16} />
                                        </div>
                                        <textarea
                                            name="notes"
                                            value={formData.notes}
                                            onChange={handleChange}
                                            rows="2"
                                            className="w-full pl-9 pr-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-slate-900 dark:text-white font-medium text-xs sm:text-sm min-h-[40px] placeholder:text-slate-400 resize-none leading-relaxed"
                                            placeholder="Términos de crédito, días de entrega, etc..."
                                        />
                                    </div>
                                </div>

                            </form>
                        </div>

                        {/* Footer */}
                        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 flex justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={processing}
                                className="min-h-[38px] px-4 py-2 rounded-lg font-semibold text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors cursor-pointer shadow-xs"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                form="supplier-form"
                                disabled={processing}
                                className="min-h-[38px] px-5 py-2 rounded-lg font-semibold text-xs text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                                {processing ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                                ) : (
                                    <>
                                        <Save size={15} /> 
                                        <span>Guardar Proveedor</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </BaseModal>

                    <SupplierLogoSearchModal
                        isOpen={isLogoSearchOpen}
                        onClose={() => setIsLogoSearchOpen(false)}
                        supplierName={formData.name}
                        supplierId={supplier?.id || null}
                        onSelectLogo={(logoUri, fullUrl) => {
                            setFormData(prev => ({ ...prev, logoUri }));
                            setImagePreview(fullUrl || getImageUrl(logoUri));
                            setSelectedFile(null);
                        }}
                    />
                </>
            );
        }
