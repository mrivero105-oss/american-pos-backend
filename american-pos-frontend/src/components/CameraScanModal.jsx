import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, X, AlertCircle } from 'lucide-react';

export default function CameraScanModal({
    isOpen,
    onClose,
    onCapture,
    title = 'Escáner de Factura por Cámara',
    subtitle = 'Coloca la factura o documento fiscal frente a la cámara'
}) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [cameraError, setCameraError] = useState('');

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (err) {
                    console.debug('[CameraScanModal] Aviso deteniendo track:', err);
                }
            });
            streamRef.current = null;
        }
        if (videoRef.current && videoRef.current.srcObject) {
            try {
                const tracks = videoRef.current.srcObject.getTracks?.() || [];
                tracks.forEach(t => t.stop());
            } catch (err) {
                console.debug('[CameraScanModal] Aviso limpiando video srcObject:', err);
            }
            videoRef.current.srcObject = null;
        }
    }, []);

    const startCamera = useCallback(async () => {
        setCameraError('');
        stopCamera();
        try {
            if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.ensureCameraPermission) {
                const perm = await window.Capacitor.Plugins.PosNativeHardware.ensureCameraPermission();
                if (!perm?.granted) {
                    setCameraError('Permiso de cámara denegado en Android. Habilita el acceso a cámara en los ajustes de la aplicación.');
                    return;
                }
            }
            let mediaStream;
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
                });
            } catch (_firstErr) {
                mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            streamRef.current = mediaStream;
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        } catch (err) {
            console.error('Camera error:', err);
            setCameraError('No se pudo acceder a la cámara. Verifica que tengas una cámara/webcam conectada y permisos habilitados.');
        }
    }, [stopCamera]);

    useEffect(() => {
        if (isOpen) {
            startCamera();
        } else {
            stopCamera();
        }
        return () => stopCamera();
    }, [isOpen, startCamera, stopCamera]);

    const handleTakeSnapshot = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
            if (blob) {
                const capturedFile = new File([blob], `factura_scan_${Date.now()}.jpg`, { type: 'image/jpeg' });
                stopCamera();
                onCapture(capturedFile);
                onClose();
            }
        }, 'image/jpeg', 0.95);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3 sm:p-4 pb-safe animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 p-4 sm:p-6 rounded-xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 custom-scrollbar">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
                            <Camera size={22} />
                        </div>
                        <div>
                            <h3 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider">{title}</h3>
                            <p className="text-[11px] sm:text-xs text-slate-400">{subtitle}</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => {
                            stopCamera();
                            onClose();
                        }} 
                        className="w-9 h-9 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
                        aria-label="Cerrar modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {cameraError ? (
                    <div className="p-6 bg-rose-500/10 border border-rose-500/20 rounded-xl text-center space-y-3">
                        <AlertCircle size={36} className="text-rose-400 mx-auto" />
                        <p className="text-xs text-rose-300 font-medium">{cameraError}</p>
                    </div>
                ) : (
                    <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-slate-800">
                        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                        <canvas ref={canvasRef} className="hidden" />
                        <div className="absolute inset-0 border-2 border-dashed border-purple-400/40 pointer-events-none m-4 rounded-lg flex items-center justify-center">
                            <span className="bg-black/80 px-3 py-1 rounded text-[10px] font-bold uppercase text-purple-300 tracking-widest text-center">
                                Centra la factura dentro del marco
                            </span>
                        </div>
                    </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2 sm:gap-3 pt-2">
                    <button 
                        onClick={() => {
                            stopCamera();
                            onClose();
                        }} 
                        className="h-10 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 flex items-center justify-center cursor-pointer transition-colors"
                    >
                        Cancelar
                    </button>
                    {!cameraError && (
                        <button 
                            onClick={handleTakeSnapshot} 
                            className="h-10 px-5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
                        >
                            <Camera size={16} />
                            <span>Capturar y Procesar Factura</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
