import React from 'react';
import { Tag, Check, X, Settings2, Scan, RefreshCw, Loader2, Printer, Plus, Truck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ProductBasicInfo({
    formData,
    handleChange,
    setFormData,
    loading,
    isAddingCategory,
    setIsAddingCategory,
    newCategoryInput,
    setNewCategoryInput,
    handleConfirmNewCategory,
    categories,
    suppliers,
    onAddSupplier,
    setScannerMode,
    setIsBarcodeScannerOpen,
    generateInternalBarcode,
    isGeneratingBarcode,
    setIsLabelModalOpen
}) {
    const [isAddingSupplier, setIsAddingSupplier] = React.useState(false);
    const [isSavingSupplier, setIsSavingSupplier] = React.useState(false);
    const [newSupplierData, setNewSupplierData] = React.useState({
        name: '',
        contact: '',
        phone: ''
    });
    const supplierInputRef = React.useRef(null);

    React.useEffect(() => {
        if (isAddingSupplier && supplierInputRef.current) {
            supplierInputRef.current.focus();
        }
    }, [isAddingSupplier]);

    const handleSaveQuickSupplier = async () => {
        const trimmedName = newSupplierData.name.trim();
        if (!trimmedName) {
            toast.error('Por favor ingresa el nombre del proveedor');
            return;
        }
        try {
            setIsSavingSupplier(true);
            if (onAddSupplier) {
                await onAddSupplier({
                    name: trimmedName,
                    contact: newSupplierData.contact.trim() || undefined,
                    phone: newSupplierData.phone.trim() || undefined
                });
            }
            setIsAddingSupplier(false);
            setNewSupplierData({ name: '', contact: '', phone: '' });
        } catch (err) {
            console.warn('[ProductBasicInfo] Error capturado en operación:', err?.message || err);
            // Manejado en handler superior
        } finally {
            setIsSavingSupplier(false);
        }
    };

    return (
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
            {/* Header Limpio Square POS */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                        <Tag size={15} />
                    </span>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        Información general
                    </h3>
                </div>
            </div>

            <div className="space-y-3.5">
                {/* Categoría */}
                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Categoría
                    </label>
                    {isAddingCategory ? (
                        <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
                            <input
                                type="text"
                                placeholder="Nombre de nueva categoría..."
                                value={newCategoryInput}
                                onChange={(e) => setNewCategoryInput(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleConfirmNewCategory();
                                    } else if (e.key === 'Escape') {
                                        setIsAddingCategory(false);
                                    }
                                }}
                                className="w-full h-10 px-3 bg-white dark:bg-slate-850 border border-blue-500 rounded-lg text-sm font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={handleConfirmNewCategory}
                                className="h-10 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-xs active:scale-95 shrink-0 flex items-center justify-center cursor-pointer"
                                title="Guardar Categoría"
                            >
                                <Check size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsAddingCategory(false)}
                                className="h-10 px-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-all shrink-0 flex items-center justify-center cursor-pointer"
                                title="Cancelar"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <select
                                name="category"
                                value={formData.category}
                                onChange={(e) => {
                                    if (e.target.value === 'ADD_NEW') {
                                        setIsAddingCategory(true);
                                    } else {
                                        handleChange(e);
                                    }
                                }}
                                className="w-full h-10 px-3 pr-8 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all cursor-pointer appearance-none"
                                disabled={loading}
                            >
                                <option value="General">General</option>
                                {categories.map(cat => (
                                    cat !== 'General' && <option key={cat} value={cat}>{cat}</option>
                                ))}
                                <option value="ADD_NEW">+ Crear nueva categoría...</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                                <Settings2 size={14} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Proveedor */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Proveedor
                        </label>
                        {!isAddingSupplier && (
                            <button
                                type="button"
                                onClick={() => setIsAddingSupplier(true)}
                                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                                <Plus size={12} />
                                Nuevo
                            </button>
                        )}
                    </div>

                    {isAddingSupplier ? (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2 animate-in fade-in duration-150">
                            <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                    <Truck size={13} className="text-blue-500" />
                                    Registrar proveedor
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsAddingSupplier(false);
                                        setNewSupplierData({ name: '', contact: '', phone: '' });
                                    }}
                                    className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <input
                                ref={supplierInputRef}
                                type="text"
                                placeholder="Nombre o Razón Social *"
                                value={newSupplierData.name}
                                onChange={(e) => setNewSupplierData(prev => ({ ...prev, name: e.target.value }))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSaveQuickSupplier();
                                    }
                                }}
                                className="w-full h-8 px-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white font-medium outline-none focus:border-blue-500"
                                disabled={isSavingSupplier}
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                                <input
                                    type="text"
                                    placeholder="Contacto / RIF (opcional)"
                                    value={newSupplierData.contact}
                                    onChange={(e) => setNewSupplierData(prev => ({ ...prev, contact: e.target.value }))}
                                    className="w-full h-8 px-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white outline-none focus:border-blue-500"
                                    disabled={isSavingSupplier}
                                />
                                <input
                                    type="text"
                                    placeholder="Teléfono (opcional)"
                                    value={newSupplierData.phone}
                                    onChange={(e) => setNewSupplierData(prev => ({ ...prev, phone: e.target.value }))}
                                    className="w-full h-8 px-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white outline-none focus:border-blue-500"
                                    disabled={isSavingSupplier}
                                />
                            </div>
                            <div className="flex justify-end gap-1.5 pt-0.5">
                                <button
                                    type="button"
                                    onClick={() => setIsAddingSupplier(false)}
                                    className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveQuickSupplier}
                                    disabled={isSavingSupplier || !newSupplierData.name.trim()}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md flex items-center gap-1 shadow-2xs"
                                >
                                    {isSavingSupplier ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                    <span>Guardar</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <select
                            name="supplierId"
                            value={formData.supplierId || ''}
                            onChange={(e) => {
                                if (e.target.value === 'ADD_NEW') {
                                    setIsAddingSupplier(true);
                                } else {
                                    handleChange(e);
                                }
                            }}
                            className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all cursor-pointer"
                            disabled={loading}
                        >
                            <option value="">-- Sin Proveedor asignado --</option>
                            {Array.isArray(suppliers) && suppliers.map(sup => (
                                <option key={sup.id} value={sup.id}>{sup.name}</option>
                            ))}
                            <option value="ADD_NEW">+ Registrar nuevo proveedor...</option>
                        </select>
                    )}
                </div>

                {/* Régimen Fiscal (IVA) */}
                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Régimen fiscal (IVA)
                    </label>
                    <select
                        name="taxStatus"
                        value={formData.taxStatus}
                        onChange={handleChange}
                        className="w-full h-10 px-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all cursor-pointer"
                        disabled={loading}
                    >
                        <option value="gravable">Gravable (Aplica IVA ordinario)</option>
                        <option value="exento">Exento (Tasa cero / No lleva IVA)</option>
                    </select>
                </div>

                {/* Código de Barras con Barra de Herramientas Ergonómica */}
                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Código de barras
                    </label>
                    <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                name="barcode"
                                data-barcode-input="true"
                                value={formData.barcode}
                                onChange={handleChange}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }
                                }}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full h-10 pl-3 pr-7 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs sm:text-sm font-mono font-medium text-slate-900 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 tracking-wider transition-all placeholder:font-sans placeholder:text-slate-400"
                                placeholder="Escanear o escribir código..."
                                disabled={loading}
                            />
                            {formData.barcode && (
                                <button
                                    type="button"
                                    onClick={() => setFormData(prev => ({ ...prev, barcode: '' }))}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 p-0.5 cursor-pointer"
                                    title="Borrar código"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Botón Escáner Cámara */}
                        <button
                            type="button"
                            onClick={() => {
                                setScannerMode('BARCODE');
                                setIsBarcodeScannerOpen(true);
                            }}
                            className="h-10 w-10 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition-all shadow-2xs"
                            title="Escanear con cámara"
                            disabled={loading}
                        >
                            <Scan size={16} />
                        </button>

                        {/* Botón Generar Código Interno */}
                        <button
                            type="button"
                            onClick={generateInternalBarcode}
                            className="h-10 w-10 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition-all shadow-2xs"
                            title="Generar código aleatorio interno"
                            disabled={loading || isGeneratingBarcode}
                        >
                            <RefreshCw size={15} className={isGeneratingBarcode ? 'animate-spin' : ''} />
                        </button>

                        {/* Botón Imprimir Etiqueta Rápida */}
                        <button
                            type="button"
                            onClick={() => {
                                if (!formData.name && !formData.barcode) {
                                    toast.error('Ingresa al menos el nombre o código del producto');
                                    return;
                                }
                                setIsLabelModalOpen(true);
                            }}
                            className="h-10 w-10 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition-all shadow-2xs"
                            title="Diseñar e imprimir etiqueta"
                        >
                            <Printer size={15} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
