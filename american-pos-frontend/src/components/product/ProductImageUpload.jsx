import { ZoomIn, ZoomOut, Upload, Search, Loader2, X, Link as LinkIcon, Image as ImageIcon } from 'lucide-react';

export default function ProductImageUpload({
    imageSrc,
    imageScale,
    setImageScale,
    loading,
    isGeneratingImage,
    fileInputRef,
    handleImageChange,
    handleGenerateImageIA,
    formData,
    setFormData,
    setLocalImageFile
}) {
    return (
        <div className="w-full md:w-56 lg:w-64 flex flex-col gap-3 shrink-0">
            {/* Header del Bloque Multimedia */}
            <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <ImageIcon size={14} className="text-slate-500 dark:text-slate-400" />
                    Foto del producto
                </span>
                {imageSrc && (
                    <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                        Cargada
                    </span>
                )}
            </div>

            {/* Vitrina de Fotografía Comercial (Limpia, Sin Halos Fluorescentes) */}
            <div className={`relative group aspect-square rounded-xl overflow-hidden transition-all duration-200 ${
                imageSrc
                    ? 'bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-750 shadow-xs'
                    : 'bg-slate-50/80 dark:bg-slate-900/40 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
            }`}>
                {imageSrc ? (
                    <>
                        <div className="w-full h-full p-3 flex items-center justify-center">
                            <img
                                src={imageSrc}
                                alt="Vista previa del producto"
                                style={{ transform: `scale(${imageScale})` }}
                                className="w-full h-full object-contain transition-transform duration-200 select-none pointer-events-none"
                            />
                        </div>

                        {imageScale !== 1 && (
                            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-slate-900/80 text-white text-[9px] font-mono font-medium backdrop-blur-xs">
                                {Math.round(imageScale * 100)}%
                            </span>
                        )}

                        {/* Controles de Zoom y Acción Flotantes (Hover / Touch) */}
                        <div className="absolute inset-0 bg-slate-900/70 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-1.5 p-2 backdrop-blur-[2px]">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setImageScale(prev => Math.min(prev + 0.25, 2.5)); }}
                                className="p-2 bg-white/10 hover:bg-white text-white hover:text-slate-900 rounded-lg transition-all active:scale-95 cursor-pointer"
                                title="Acercar imagen"
                            >
                                <ZoomIn size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setImageScale(prev => Math.max(prev - 0.25, 0.6)); }}
                                className="p-2 bg-white/10 hover:bg-white text-white hover:text-slate-900 rounded-lg transition-all active:scale-95 cursor-pointer"
                                title="Alejar imagen"
                            >
                                <ZoomOut size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                                className="p-2 bg-white/10 hover:bg-blue-600 text-white rounded-lg transition-all active:scale-95 cursor-pointer"
                                title="Reemplazar archivo"
                                disabled={loading || isGeneratingImage}
                            >
                                <Upload size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setFormData(prev => ({ ...prev, imageUrl: '' }));
                                    setLocalImageFile(null);
                                    setImageScale(1);
                                }}
                                className="p-2 bg-white/10 hover:bg-rose-600 text-white rounded-lg transition-all active:scale-95 cursor-pointer"
                                title="Eliminar foto"
                                disabled={loading || isGeneratingImage}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </>
                ) : (
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center cursor-pointer select-none group/placeholder"
                    >
                        <div className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 group-hover/placeholder:text-blue-600 group-hover/placeholder:bg-blue-50 dark:group-hover/placeholder:bg-blue-950/40 transition-colors">
                            <Upload size={18} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Subir fotografía
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                Arrastra o toca aquí
                            </p>
                        </div>
                    </div>
                )}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageChange}
                    accept="image/*"
                    className="hidden"
                    disabled={loading}
                />
            </div>

            {/* Barra de Acciones Táctiles Inferiores */}
            <div className="space-y-2">
                <div className="flex gap-1.5">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 h-9 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs"
                        disabled={loading}
                    >
                        <Upload size={13} className="text-slate-500" />
                        <span>Subir</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleGenerateImageIA}
                        className="h-9 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs"
                        title="Buscar imagen sugerida por catálogo"
                        disabled={loading || isGeneratingImage}
                    >
                        {isGeneratingImage ? <Loader2 size={13} className="animate-spin text-blue-600" /> : <Search size={13} className="text-slate-500" />}
                        <span>Buscar</span>
                    </button>

                    {imageSrc && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setFormData(prev => ({ ...prev, imageUrl: '' }));
                                setLocalImageFile(null);
                                setImageScale(1);
                            }}
                            className="h-9 px-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-semibold transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-2xs"
                            title="Quitar foto"
                            disabled={loading || isGeneratingImage}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Input de Enlace / URL Web Limpio (Sin texto cortado ni bloqueo por type=url) */}
                <div className="relative flex items-center">
                    <span className="absolute left-2.5 text-slate-400 pointer-events-none">
                        <LinkIcon size={12} />
                    </span>
                    <input
                        type="text"
                        placeholder="O pegar URL o ruta de imagen..."
                        value={formData.imageUrl || ''}
                        onChange={(e) => {
                            setFormData(prev => ({ ...prev, imageUrl: e.target.value }));
                            setLocalImageFile(null);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full h-8 pl-7 pr-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-750 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all font-mono"
                        disabled={loading}
                    />
                </div>
            </div>
        </div>
    );
}
