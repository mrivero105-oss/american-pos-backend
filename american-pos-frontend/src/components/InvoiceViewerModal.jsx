import React, { useState, useEffect, useRef } from 'react';
import { 
    X, ZoomIn, ZoomOut, RotateCw, Download, Printer, 
    ExternalLink, FileText, Loader2, AlertCircle, Maximize2, Minimize2,
    Expand, Shrink
} from 'lucide-react';
import { getInvoiceUrl } from '../utils/imageUtils';

export default function InvoiceViewerModal({ isOpen, onClose, invoiceUrl, title = 'Factura Real Digitalizada', details = {} }) {
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    const [fitMode, setFitMode] = useState('width'); // 'width' (Ajustar a ancho de lectura) | 'page' (Página completa)
    
    // Pan / Dragging state
    const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    
    const containerRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setZoom(1);
            setRotation(0);
            setPanPosition({ x: 0, y: 0 });
            setIsLoading(true);
            setHasError(false);
            setFitMode('width');
        }
    }, [isOpen, invoiceUrl]);

    // Handle non-passive wheel events to prevent Chrome console warnings
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !isOpen) return;

        const onWheel = (e) => {
            // If Ctrl is held or fitMode is page, zoom in/out smoothly
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.15 : 0.15;
                setZoom(prev => Math.min(Math.max(prev + delta, 0.4), 4));
            }
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            container.removeEventListener('wheel', onWheel);
        };
    }, [isOpen]);

    // Handle Esc key to close modal
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, onClose]);

    if (!isOpen || !invoiceUrl) return null;

    const fullUrl = getInvoiceUrl(invoiceUrl);
    const isPdf = invoiceUrl.toLowerCase().endsWith('.pdf') || fullUrl.toLowerCase().includes('.pdf');

    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 4));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.4));
    const handleResetZoom = () => { 
        setZoom(1); 
        setRotation(0); 
        setPanPosition({ x: 0, y: 0 });
    };
    const handleRotate = () => setRotation(prev => (prev + 90) % 360);

    const handleMouseDown = (e) => {
        if (isPdf || e.button !== 0) return;
        // Only start drag if clicking on the background or with zoom
        if (zoom > 1 || fitMode === 'page') {
            setIsDragging(true);
            dragStartRef.current = {
                x: e.clientX - panPosition.x,
                y: e.clientY - panPosition.y
            };
        }
    };

    const handleMouseMove = (e) => {
        if (!isDragging || isPdf) return;
        setPanPosition({
            x: e.clientX - dragStartRef.current.x,
            y: e.clientY - dragStartRef.current.y
        });
    };

    const handleMouseUp = () => setIsDragging(false);

    const handlePrint = () => {
        if (isPdf) {
            const printWindow = window.open(fullUrl, '_blank');
            if (printWindow) {
                printWindow.focus();
                printWindow.print();
            }
        } else {
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                const doc = printWindow.document;
                doc.open();
                doc.write('<html><head><title>Imprimir Factura - Isaac POS</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;background:#fff;}img{max-width:100%;height:auto;}@page{margin:5mm;}</style></head><body></body></html>');
                doc.close();
                const img = doc.createElement('img');
                img.src = fullUrl;
                img.onload = () => {
                    printWindow.print();
                    printWindow.close();
                };
                doc.body.appendChild(img);
            }
        }
    };

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = fullUrl;
        link.download = `factura_${details?.referenceNumber || Date.now()}${isPdf ? '.pdf' : '.jpg'}`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-2 sm:p-5 animate-in fade-in duration-200">
            <div 
                className={`bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 pb-safe ${
                    isFullscreen ? 'w-full h-full rounded-none' : 'w-full max-w-5xl h-[92dvh] max-h-[92dvh]'
                }`}
            >
                {/* Header with Title & Action Controls */}
                <div className="px-4 sm:px-5 py-3 border-b border-slate-800 bg-slate-950 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 bg-primary-600/20 text-primary-400 rounded-lg border border-primary-500/30 shrink-0">
                            <FileText size={18} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-xs sm:text-sm font-bold text-white">
                                    {title}
                                </h3>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-primary-500/20 text-primary-300 border border-primary-500/30">
                                    {isPdf ? 'Documento PDF' : 'Factura Digitalizada'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                                {details?.referenceNumber && (
                                    <span className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 font-mono text-slate-200 text-[11px]">
                                        Ref: <strong>{details.referenceNumber}</strong>
                                    </span>
                                )}
                                {details?.supplierName && (
                                    <span className="text-slate-300 font-medium">
                                        Prov: <strong className="text-white">{details.supplierName}</strong>
                                    </span>
                                )}
                                {details?.date && (
                                    <span className="text-slate-400">
                                        • Fecha: <strong className="text-slate-300">{details.date}</strong>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Toolbar Controls */}
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-750 p-1 rounded-lg shrink-0 self-stretch sm:self-auto overflow-x-auto no-scrollbar max-w-full">
                        {!isPdf && (
                            <>
                                {/* Fit Width vs Fit Page toggle */}
                                <button
                                    onClick={() => {
                                        setFitMode(prev => prev === 'width' ? 'page' : 'width');
                                        setPanPosition({ x: 0, y: 0 });
                                    }}
                                    className={`h-8 px-2.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                                        fitMode === 'width'
                                            ? 'bg-primary-600 text-white shadow-xs'
                                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                                    title={fitMode === 'width' ? 'Modo actual: Ancho Óptimo. Clic para ver página completa' : 'Modo actual: Página Completa. Clic para ampliar a ancho de lectura'}
                                >
                                    {fitMode === 'width' ? <Expand size={13} /> : <Shrink size={13} />}
                                    <span className="whitespace-nowrap">{fitMode === 'width' ? 'Ancho Óptimo' : 'Página Completa'}</span>
                                </button>

                                <div className="w-[1px] h-4 bg-slate-700 mx-0.5 shrink-0" />

                                <button
                                    onClick={handleZoomIn}
                                    className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
                                    title="Acercar (Zoom In)"
                                >
                                    <ZoomIn size={15} />
                                </button>
                                <button
                                    onClick={handleZoomOut}
                                    className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
                                    title="Alejar (Zoom Out)"
                                >
                                    <ZoomOut size={15} />
                                </button>
                                <button
                                    onClick={handleRotate}
                                    className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
                                    title="Girar 90°"
                                >
                                    <RotateCw size={15} />
                                </button>
                                <button
                                    onClick={handleResetZoom}
                                    className="h-8 px-2 text-[11px] font-semibold text-slate-300 hover:text-white rounded-md transition-colors shrink-0 flex items-center justify-center"
                                    title="Reiniciar Zoom y Posición"
                                >
                                    {Math.round(zoom * 100)}%
                                </button>
                                <div className="w-[1px] h-4 bg-slate-700 mx-0.5 shrink-0" />
                            </>
                        )}

                        <button
                            onClick={handlePrint}
                            className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-primary-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
                            title="Imprimir Factura"
                        >
                            <Printer size={15} />
                        </button>
                        <button
                            onClick={handleDownload}
                            className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-emerald-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
                            title="Descargar Factura"
                        >
                            <Download size={15} />
                        </button>
                        <a
                            href={fullUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-cyan-400 hover:bg-slate-800 rounded-md transition-colors shrink-0"
                            title="Abrir original en pestaña nueva"
                        >
                            <ExternalLink size={15} />
                        </a>
                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="w-8 h-8 items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors cursor-pointer hidden sm:flex shrink-0"
                            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla Completa'}
                        >
                            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                        </button>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer ml-0.5 shrink-0"
                            title="Cerrar (Esc)"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div 
                    ref={containerRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    className="flex-1 bg-slate-950 overflow-y-auto overflow-x-auto flex justify-center p-4 sm:p-6 relative custom-scrollbar select-none"
                >
                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-950 z-10">
                            <Loader2 size={32} className="animate-spin text-primary-500" />
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cargando Factura...</span>
                        </div>
                    )}

                    {hasError ? (
                        <div className="p-6 bg-rose-500/10 border border-rose-500/20 rounded-xl text-center space-y-2.5 max-w-md my-auto">
                            <AlertCircle size={36} className="text-rose-400 mx-auto" />
                            <h4 className="text-sm font-bold text-white">No se pudo cargar el archivo</h4>
                            <p className="text-xs text-slate-400">Verifica que el documento digital se encuentre disponible en el servidor.</p>
                            <a 
                                href={fullUrl} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm mt-1 transition-colors"
                            >
                                Intentar Descarga Directa
                            </a>
                        </div>
                    ) : isPdf ? (
                        <iframe 
                            src={`${fullUrl}#toolbar=1&navpanes=0`} 
                            className="w-full h-full border-none rounded-xl bg-white"
                            title="Factura PDF"
                            onLoad={() => setIsLoading(false)}
                            onError={() => { setIsLoading(false); setHasError(true); }}
                        />
                    ) : (
                        <div 
                            className="transition-transform duration-100 ease-out flex items-start justify-center"
                            style={{
                                transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                                transformOrigin: 'top center'
                            }}
                        >
                            <img
                                src={fullUrl}
                                alt="Factura Digitalizada"
                                className={`rounded-xl shadow-2xl border border-white/10 transition-all ${
                                    fitMode === 'width'
                                        ? 'w-full max-w-2xl h-auto object-contain'
                                        : 'max-w-full max-h-[80vh] object-contain'
                                }`}
                                onLoad={() => setIsLoading(false)}
                                onError={() => { setIsLoading(false); setHasError(true); }}
                                draggable={false}
                            />
                        </div>
                    )}
                </div>

                {/* Footer Info / Navigation Helper */}
                <div className="px-5 py-2.5 border-t border-white/10 bg-slate-950/90 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-medium shrink-0 gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-200 font-semibold">Isaac POS • Archivo Digital</span>
                        <span className="text-indigo-400 font-medium">
                            • Modo Ancho Óptimo Activo (Desplázate hacia abajo para leer la factura completa)
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-slate-400">
                        <span>💡 <strong>Ctrl + Rueda:</strong> Zoom</span>
                        <span>• <strong>Rueda:</strong> Scroll</span>
                        <span>• <strong>Ancho Óptimo:</strong> Letras grandes</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
