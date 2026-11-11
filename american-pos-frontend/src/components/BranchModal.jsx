import { useState, useEffect } from 'react';
import { 
    X, Building2, MapPin, Phone, Mail, CheckCircle2, User, 
    Hash, Palette, FileText, Star, RefreshCcw, Save, Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BaseModal from './BaseModal';
import toast from 'react-hot-toast';

const BRANCH_TYPES = [
    { id: 'STORE', label: 'Tienda / Punto de Venta', desc: 'Local comercial con facturación directa al público y cajas', icon: '🏪', color: 'border-blue-500 bg-blue-500/10 text-blue-400' },
    { id: 'WAREHOUSE', label: 'Almacén / Centro de Distribución', desc: 'Depósito logístico para recepción de compras y despachos', icon: '📦', color: 'border-cyan-500 bg-cyan-500/10 text-cyan-400' },
    { id: 'EXPRESS', label: 'Punto Express / Kiosco', desc: 'Local rápido con inventario reducido y alta rotación', icon: '⚡', color: 'border-amber-500 bg-amber-500/10 text-amber-400' },
    { id: 'PHARMACY', label: 'Farmacia / Sede Especializada', desc: 'Atención especializada con control de lotes', icon: '💊', color: 'border-emerald-500 bg-emerald-500/10 text-emerald-400' }
];

const BRANCH_COLORS = [
    'from-primary-600 to-indigo-700',
    'from-emerald-600 to-teal-700',
    'from-purple-600 to-pink-700',
    'from-amber-500 to-orange-600',
    'from-rose-600 to-red-700',
    'from-cyan-600 to-blue-700',
    'from-slate-700 to-slate-900'
];

export default function BranchModal({ isOpen, onClose, onSave, branch, processing }) {
    const [activeTab, setActiveTab] = useState('identity'); // 'identity' | 'location' | 'fiscal'
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        type: 'STORE',
        managerName: '',
        address: '',
        phone: '',
        email: '',
        color: BRANCH_COLORS[0],
        invoicePrefix: '',
        isMain: false,
        isActive: true
    });

    useEffect(() => {
        if (isOpen) {
            if (branch) {
                setFormData({
                    name: branch.name || '',
                    code: branch.code || '',
                    type: branch.type || 'STORE',
                    managerName: branch.managerName || '',
                    address: branch.address || '',
                    phone: branch.phone || '',
                    email: branch.email || '',
                    color: branch.color || BRANCH_COLORS[0],
                    invoicePrefix: branch.invoicePrefix || '',
                    isMain: !!branch.isMain,
                    isActive: branch.isActive !== undefined ? branch.isActive : true
                });
            } else {
                setFormData({
                    name: '',
                    code: `SUC-${Math.floor(100 + Math.random() * 900)}`,
                    type: 'STORE',
                    managerName: '',
                    address: '',
                    phone: '',
                    email: '',
                    color: BRANCH_COLORS[Math.floor(Math.random() * BRANCH_COLORS.length)],
                    invoicePrefix: '',
                    isMain: false,
                    isActive: true
                });
            }
            setActiveTab('identity');
        }
    }, [isOpen, branch]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            toast.error('El nombre de la sucursal es obligatorio');
            return;
        }
        onSave(formData);
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-2xl"
            className="overflow-hidden flex flex-col font-sans"
            disableOutsideClick={true}
        >
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${formData.color || BRANCH_COLORS[0]} text-white flex items-center justify-center font-black text-xl shadow-md border border-white/20 shrink-0`}>
                        <Building2 size={24} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                {branch ? 'Editar Sucursal' : 'Nueva Sucursal / Local'}
                            </h2>
                            {formData.isMain && (
                                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-md border border-amber-500/20 uppercase flex items-center gap-1">
                                    <Star size={10} className="fill-amber-500" /> Matriz
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                            {branch ? `Código: ${branch.code || branch.id} • ${branch.address || 'Sin dirección'}` : 'Configura un nuevo punto de venta o almacén logístico'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 text-slate-400 hover:text-red-500 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-all cursor-pointer"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex p-1.5 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 shrink-0 px-6 gap-2">
                <button
                    type="button"
                    onClick={() => setActiveTab('identity')}
                    className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'identity' ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <Building2 size={14} /> 1. Identidad & Tipo
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('location')}
                    className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'location' ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <MapPin size={14} /> 2. Ubicación & Contacto
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('fiscal')}
                    className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${activeTab === 'fiscal' ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
                >
                    <FileText size={14} /> 3. Fiscal & Jerarquía
                </button>
            </div>

            {/* Main Form Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 custom-scrollbar max-h-[580px]">
                <AnimatePresence mode="wait">
                    {/* TAB 1: IDENTIDAD Y TIPO */}
                    {activeTab === 'identity' && (
                        <motion.div
                            key="tab-identity"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-5"
                        >
                            {/* Color Selector */}
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                                <span className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                    <Palette size={14} /> Color Distintivo
                                </span>
                                <div className="flex gap-2">
                                    {BRANCH_COLORS.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, color: c })}
                                            className={`w-6 h-6 rounded-full bg-gradient-to-br ${c} transition-transform ${formData.color === c ? 'ring-2 ring-primary-500 scale-125' : 'hover:scale-110 opacity-70'}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Name & Code */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Nombre de la Sucursal *</label>
                                    <div className="relative">
                                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="Ej. Sucursal Centro Plaza"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Código Identificador *</label>
                                    <div className="relative">
                                        <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            required
                                            value={formData.code}
                                            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-black font-mono outline-none focus:border-primary-500 text-slate-900 dark:text-white uppercase"
                                            placeholder="SUC-01"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Branch Type Selector */}
                            <div className="space-y-2 pt-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Tipo de Establecimiento</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {BRANCH_TYPES.map(bt => {
                                        const isSelected = formData.type === bt.id;
                                        return (
                                            <button
                                                key={bt.id}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, type: bt.id })}
                                                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${isSelected ? `${bt.color} shadow-md` : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300'}`}
                                            >
                                                <span className="text-2xl shrink-0 mt-0.5">{bt.icon}</span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white leading-tight">
                                                        {bt.label}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                                        {bt.desc}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Manager Name */}
                            <div className="space-y-1 pt-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Gerente / Encargado de Sucursal</label>
                                <div className="relative">
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        value={formData.managerName}
                                        onChange={(e) => setFormData({ ...formData, managerName: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                        placeholder="Ej. Lic. Roberto Gómez"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* TAB 2: UBICACIÓN Y CONTACTO */}
                    {activeTab === 'location' && (
                        <motion.div
                            key="tab-location"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-5"
                        >
                            {/* Address */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Dirección Física del Local</label>
                                <div className="relative">
                                    <MapPin className="absolute left-3.5 top-3 text-slate-400" size={16} />
                                    <textarea
                                        rows={3}
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white resize-none"
                                        placeholder="Av. Principal, Edificio Isaac Plaza, Local 4B..."
                                    />
                                </div>
                            </div>

                            {/* Phone & Email */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Teléfono Directo / WhatsApp</label>
                                    <div className="relative">
                                        <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="+58 212 5550011"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Correo Electrónico de la Sede</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                                            placeholder="sucursalcentro@empresa.com"
                                        />
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* TAB 3: FISCAL Y JERARQUÍA */}
                    {activeTab === 'fiscal' && (
                        <motion.div
                            key="tab-fiscal"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-5"
                        >
                            {/* Invoice Prefix */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Prefijo de Facturación / Serie</label>
                                <div className="relative">
                                    <FileText className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        value={formData.invoicePrefix}
                                        onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value.toUpperCase() })}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold font-mono outline-none focus:border-primary-500 text-slate-900 dark:text-white uppercase"
                                        placeholder="Ej. SUC01- (Genera SUC01-00001)"
                                    />
                                </div>
                                <p className="text-[10px] text-slate-400 px-1">Opcional. Permite distinguir correlativos fiscales por cada punto de venta.</p>
                            </div>

                            {/* Main Branch Toggle */}
                            <label className={`flex items-start gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${formData.isMain ? 'border-amber-500 bg-amber-500/10' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40'}`}>
                                <input
                                    type="checkbox"
                                    checked={formData.isMain}
                                    onChange={(e) => setFormData({ ...formData, isMain: e.target.checked })}
                                    className="mt-1 w-5 h-5 accent-amber-500 rounded shrink-0"
                                />
                                <div>
                                    <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                                        <Star size={14} className={formData.isMain ? 'fill-amber-500 text-amber-500' : 'text-slate-400'} />
                                        Designar como Casa Matriz (Sede Principal)
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                        Esta sede será la referencia principal de la empresa para reportes consolidados y configuración por defecto.
                                    </p>
                                </div>
                            </label>

                            {/* Active Status Toggle */}
                            <label className={`flex items-start gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${formData.isActive ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40'}`}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="mt-1 w-5 h-5 accent-emerald-500 rounded shrink-0"
                                />
                                <div>
                                    <p className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white">
                                        Estado Operativo Habilitado
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                        Las sucursales activas permiten facturación, apertura de turnos y transferencias de inventario en vivo.
                                    </p>
                                </div>
                            </label>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Footer Buttons */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-1/3 py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-black rounded-2xl uppercase tracking-widest text-xs transition-all active:scale-95 cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={processing}
                        className="w-2/3 py-4 bg-primary-600 hover:bg-primary-700 text-white font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-primary-600/20 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {processing ? (
                            <RefreshCcw size={16} className="animate-spin" />
                        ) : (
                            <>
                                <Save size={16} /> {branch ? 'GUARDAR CAMBIOS' : 'CREAR SUCURSAL'}
                            </>
                        )}
                    </button>
                </div>
            </form>
        </BaseModal>
    );
}
