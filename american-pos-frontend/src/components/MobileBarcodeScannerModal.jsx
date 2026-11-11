import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, Scan, Zap, AlertCircle, CheckCircle2, RefreshCw, SwitchCamera, ZoomIn, Copy, Check, Calendar, Hash, Clock, Plus, Clipboard, Eye, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { hapticTap, hapticSuccess } from '../utils/haptics';
import api from '../services/api';
import {
    MultiFormatReader,
    BarcodeFormat,
    DecodeHintType,
    RGBLuminanceSource,
    BinaryBitmap,
    HybridBinarizer
} from '@zxing/library';

// Singleton AudioContext for instant, zero-latency cashier beep
let sharedAudioCtx = null;
function playCashierBeep() {
    try {
        if (!sharedAudioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) sharedAudioCtx = new AudioCtx();
        }
        if (!sharedAudioCtx) return;
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1900, sharedAudioCtx.currentTime); // Note B6 - Crisp cashier beep
        gain.gain.setValueAtTime(0.4, sharedAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, sharedAudioCtx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        osc.start();
        osc.stop(sharedAudioCtx.currentTime + 0.12);
    } catch (_e) {}
}

export default function MobileBarcodeScannerModal({
    isOpen,
    onClose,
    onBarcodeScanned,
    initialMode = 'BARCODE',
    targetMode = 'CART', // 'CART' | 'ASSIGN' | 'LOOKUP'
    title = '',
    subtitle = '',
    products = [],
    onVisionMatch = null,
    onOcrDetected = null,
    onSaveNewProduct = null
}) {
    const videoRef = useRef(null);
    const animationFrameRef = useRef(null);
    const streamRef = useRef(null);
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const readerRef = useRef(null);
    const nativeDetectorRef = useRef(null);
    const nativeTextDetectorRef = useRef(null);
    const visionWorkerRef = useRef(null);
    const ocrWorkerRef = useRef(null);

    const [activeMode, setActiveMode] = useState(initialMode || 'BARCODE');
    const activeModeRef = useRef(initialMode || 'BARCODE');
    useEffect(() => {
        activeModeRef.current = activeMode;
    }, [activeMode]);
    const [visionMatches, setVisionMatches] = useState([]);
    const [lastDetectedVisionText, setLastDetectedVisionText] = useState('');
    const lastVisionOcrAttemptRef = useRef(0);
    const [detectedOcr, setDetectedOcr] = useState({ batchNumber: '', expirationDate: '' });

    const [availableCameras, setAvailableCameras] = useState([]);
    const [selectedCameraId, setSelectedCameraId] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [errorType, setErrorType] = useState(''); // 'permission' | 'notFound' | 'insecure' | 'generic'
    const [torchOn, setTorchOn] = useState(false);
    const [torchSupported, setTorchSupported] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [zoomSupported, setZoomSupported] = useState(false);
    const [maxZoom, setMaxZoom] = useState(1);
    const [lastScanned, setLastScanned] = useState('');
    const [lastMatchedProduct, setLastMatchedProduct] = useState(null);
    const [burstMode, setBurstMode] = useState(false);
    const [burstCount, setBurstCount] = useState(0);
    const [scanHistory, setScanHistory] = useState([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [copiedCode, setCopiedCode] = useState('');
    const [manualCodeInput, setManualCodeInput] = useState('');
    const [isVideoFeedReady, setIsVideoFeedReady] = useState(false);

    const lastScanTimeRef = useRef(0);
    const lastScanCodeRef = useRef('');

    useEffect(() => {
        if (isOpen) {
            setActiveMode(initialMode || 'BARCODE');
            setVisionMatches([]);
            setDetectedOcr({ batchNumber: '', expirationDate: '' });
            setLastScanned('');
            setErrorMsg('');
            setErrorType('');
            setBurstCount(0);
            setManualCodeInput('');
            setIsVideoFeedReady(false);
            lastScanTimeRef.current = 0;
            lastScanCodeRef.current = '';
            setTorchOn(false);
            setZoomLevel(1);

            // 1. Initialize Hardware-Accelerated Native BarcodeDetector (Chrome / Android WebView)
            if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
                try {
                    nativeDetectorRef.current = new window.BarcodeDetector({
                        formats: [
                            'ean_13',
                            'ean_8',
                            'code_128',
                            'code_39',
                            'code_93',
                            'upc_a',
                            'upc_e',
                            'itf',
                            'qr_code',
                            'data_matrix',
                            'aztec'
                        ]
                    });
                } catch (_e) {
                    nativeDetectorRef.current = null;
                }
            }

            // 2. Initialize ZXing Software Reader as high-speed multi-pass fallback
            const hints = new Map();
            const formats = [
                BarcodeFormat.EAN_13,
                BarcodeFormat.EAN_8,
                BarcodeFormat.CODE_128,
                BarcodeFormat.CODE_39,
                BarcodeFormat.CODE_93,
                BarcodeFormat.UPC_A,
                BarcodeFormat.UPC_E,
                BarcodeFormat.ITF,
                BarcodeFormat.QR_CODE,
                BarcodeFormat.DATA_MATRIX
            ];
            hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
            hints.set(DecodeHintType.TRY_HARDER, true);

            const reader = new MultiFormatReader();
            reader.setHints(hints);
            readerRef.current = reader;

            // Offscreen Canvas for high-res frame capture
            const canvas = document.createElement('canvas');
            canvasRef.current = canvas;
            ctxRef.current = canvas.getContext('2d', { willReadFrequently: true });

            // 3. Initialize Vision Worker
            try {
                visionWorkerRef.current = new Worker(new URL('../workers/visionWorker.js', import.meta.url), { type: 'module' });
                visionWorkerRef.current.onmessage = (e) => {
                    if (e.data?.type === 'CLASSIFY_RESULT') {
                        setVisionMatches(e.data.matches || []);
                        if (e.data.rawDetected !== undefined) {
                            setLastDetectedVisionText(e.data.rawDetected);
                        }
                    }
                };
                if (products && products.length > 0) {
                    visionWorkerRef.current.postMessage({ type: 'INDEX_CATALOG', payload: products });
                }
            } catch (_vErr) {
                console.warn('[Scanner] Vision worker init notice:', _vErr.message);
            }

            // 4. Initialize OCR Worker & Native TextDetector
            try {
                ocrWorkerRef.current = new Worker(new URL('../workers/ocrWorker.js', import.meta.url), { type: 'module' });
                ocrWorkerRef.current.onmessage = (e) => {
                    if (e.data?.type === 'PARSE_RESULT') {
                        if (e.data.success) {
                            setDetectedOcr(e.data.data);
                            playCashierBeep();
                            hapticSuccess();
                        } else if (e.data.raw) {
                            setDetectedOcr(prev => ({ ...prev, rawDetected: e.data.raw }));
                        }
                    }
                };

                if (typeof window !== 'undefined' && 'TextDetector' in window) {
                    nativeTextDetectorRef.current = new window.TextDetector();
                }
            } catch (_oErr) {
                console.warn('[Scanner] OCR worker init notice:', _oErr.message);
            }

            let hardwareScanBuffer = '';
            let lastKeyTimestamp = 0;

            const handleKeyDown = (e) => {
                if (e.key === 'Escape' || e.key === 'Esc') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onClose) onClose();
                    return;
                }

                // Si el usuario escribe en un campo de texto, no interferir
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                    return;
                }

                const now = Date.now();
                if (e.key === 'Enter') {
                    if (hardwareScanBuffer.length >= 3 && (now - lastKeyTimestamp) < 600) {
                        e.preventDefault();
                        e.stopPropagation();
                        const scannedCode = hardwareScanBuffer.trim();
                        hardwareScanBuffer = '';
                        handleValidBarcode(scannedCode);
                    } else {
                        hardwareScanBuffer = '';
                    }
                } else if (e.key.length === 1) {
                    if (now - lastKeyTimestamp > 350) {
                        hardwareScanBuffer = '';
                    }
                    hardwareScanBuffer += e.key;
                    lastKeyTimestamp = now;
                }
            };
            window.addEventListener('keydown', handleKeyDown, true);

            startScanner();

            return () => {
                window.removeEventListener('keydown', handleKeyDown, true);
                stopScanner();
                visionWorkerRef.current?.terminate();
                ocrWorkerRef.current?.terminate();
            };
        } else {
            stopScanner();
            visionWorkerRef.current?.terminate();
            ocrWorkerRef.current?.terminate();
        }

        return () => {
            stopScanner();
        };
    }, [isOpen]);

    const stopScanner = () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (streamRef.current) {
            try {
                streamRef.current.getTracks().forEach(track => {
                    track.stop();
                });
            } catch (_e) {}
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        if (readerRef.current) {
            try {
                readerRef.current.reset();
            } catch (_e) {}
        }

        // Release offscreen canvas memory
        if (canvasRef.current) {
            canvasRef.current.width = 0;
            canvasRef.current.height = 0;
            canvasRef.current = null;
            ctxRef.current = null;
        }

        setIsScanning(false);
    };

    const startScanner = async (preferredDeviceId = null) => {
        stopScanner();
        setErrorMsg('');
        setErrorType('');

        // 0. Asegurar permiso de cámara nativo en Android (Capacitor)
        if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.ensureCameraPermission) {
            try {
                const perm = await window.Capacitor.Plugins.PosNativeHardware.ensureCameraPermission();
                if (perm && perm.granted === false) {
                    setErrorType('permission');
                    setErrorMsg('Permiso de cámara denegado en el sistema. Por favor concede el permiso de Cámara para escanear productos.');
                    setIsScanning(false);
                    return;
                }
            } catch (_pErr) {
                console.warn('[Scanner] Notificación de permiso nativo:', _pErr);
            }
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setErrorType('insecure');
            setErrorMsg('El navegador restringe la cámara en conexiones HTTP no seguras. Para usar la cámara desde el navegador se requiere HTTPS, localhost o usar la App instalada (APK).');
            setIsScanning(false);
            return;
        }

        try {
            // 1. Enumerate available cameras
            let videoDevices = [];
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
                videoDevices = devices.filter(d => d.kind === 'videoinput');
                setAvailableCameras(videoDevices);
            }

            let targetDeviceId = preferredDeviceId;
            if (!targetDeviceId && videoDevices.length > 0) {
                const backCam = videoDevices.find(d => 
                    (d.label || '').toLowerCase().includes('back') || 
                    (d.label || '').toLowerCase().includes('trasera') || 
                    (d.label || '').toLowerCase().includes('rear') ||
                    (d.label || '').toLowerCase().includes('environment')
                );
                targetDeviceId = backCam ? backCam.deviceId : videoDevices[videoDevices.length - 1].deviceId;
                setSelectedCameraId(targetDeviceId);
            }

            // 2. Request camera stream with balanced resolution (1280x720 is optimal for low heat & high barcode precision)
            const videoConstraints = targetDeviceId 
                ? { 
                    deviceId: { exact: targetDeviceId }, 
                    width: { ideal: 1280, max: 1920 }, 
                    height: { ideal: 720, max: 1080 }
                  }
                : { 
                    facingMode: { ideal: 'environment' }, 
                    width: { ideal: 1280, max: 1920 }, 
                    height: { ideal: 720, max: 1080 } 
                  };

            let mediaStream = null;
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints,
                    audio: false
                });
            } catch (strictErr) {
                try {
                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'environment' },
                        audio: false
                    });
                } catch (_facingErr) {
                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });
                }
            }

            streamRef.current = mediaStream;

            // Re-enumerar dispositivos ahora que la cámara está concedida para tener las etiquetas completas
            if (navigator.mediaDevices?.enumerateDevices) {
                navigator.mediaDevices.enumerateDevices().then(devs => {
                    const vDevs = devs.filter(d => d.kind === 'videoinput');
                    if (vDevs.length > 0) setAvailableCameras(vDevs);
                }).catch(() => {});
            }

            if (videoRef.current) {
                const videoEl = videoRef.current;
                videoEl.srcObject = mediaStream;
                videoEl.muted = true;
                videoEl.setAttribute('playsinline', 'true');
                videoEl.setAttribute('webkit-playsinline', 'true');

                const markFeedReady = () => {
                    if (videoEl.videoWidth > 0 || videoEl.readyState >= 2) {
                        setIsVideoFeedReady(true);
                    }
                };

                videoEl.onloadedmetadata = markFeedReady;
                videoEl.onplaying = markFeedReady;
                videoEl.oncanplay = markFeedReady;

                await videoEl.play().catch(() => {});
                // Fallback de comprobación rápida
                setTimeout(markFeedReady, 400);
            }

            // 3. Configure Hardware Capabilities: Continuous Autofocus, Torch & Zoom
            const videoTrack = mediaStream.getVideoTracks()[0];
            if (videoTrack && videoTrack.getCapabilities) {
                const caps = videoTrack.getCapabilities();
                if (caps.torch) setTorchSupported(true);
                if (caps.zoom) {
                    setZoomSupported(true);
                    setMaxZoom(caps.zoom.max || 3);
                }

                const advanced = [];
                if (caps.focusMode && caps.focusMode.includes('continuous')) {
                    advanced.push({ focusMode: 'continuous' });
                }
                if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
                    advanced.push({ exposureMode: 'continuous' });
                }
                if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) {
                    advanced.push({ whiteBalanceMode: 'continuous' });
                }
                if (advanced.length > 0 && videoTrack.applyConstraints) {
                    await videoTrack.applyConstraints({ advanced }).catch(() => {});
                }
            }

            setIsScanning(true);

            // Re-create lightweight offscreen canvas for fallback if needed
            if (!canvasRef.current) {
                const canvas = document.createElement('canvas');
                canvasRef.current = canvas;
                ctxRef.current = canvas.getContext('2d', { willReadFrequently: true });
            }

            // 4. Memory-Efficient Frame Analysis Loop
            let isProcessingFrame = false;
            let lastScanAttempt = 0;
            const hasNative = !!nativeDetectorRef.current;
            const scanInterval = hasNative ? 60 : 120; // 16 FPS with native GPU, 8 FPS with software fallback to prevent mobile heating

            const scanLoop = async () => {
                const video = videoRef.current;
                const canvas = canvasRef.current;
                const ctx = ctxRef.current;
                const reader = readerRef.current;
                const nativeDetector = nativeDetectorRef.current;

                if (video && video.readyState >= 2 && !isProcessingFrame) {
                    const now = Date.now();
                    if (now - lastScanAttempt >= scanInterval) {
                        lastScanAttempt = now;
                        isProcessingFrame = true;

                        try {
                            if (activeModeRef.current === 'BARCODE') {
                                let detectedByTier1 = false;
                                // TIER 1: Native Web BarcodeDetector (Zero Heap Allocations, GPU Accelerated)
                                if (nativeDetector) {
                                    const barcodes = await nativeDetector.detect(video).catch(() => []);
                                    if (barcodes && barcodes.length > 0) {
                                        const rawCode = barcodes[0].rawValue || barcodes[0].displayValue;
                                        if (rawCode) {
                                            detectedByTier1 = true;
                                            handleValidBarcode(rawCode);
                                        }
                                    }
                                }
                                // TIER 2: Native Google MLKit Barcode Scanner (Android Hardware Plugin) + Corregido ZXing Fallback
                                if (!detectedByTier1 && canvas && ctx) {
                                    const vWidth = video.videoWidth;
                                    const vHeight = video.videoHeight;

                                    if (vWidth > 0 && vHeight > 0) {
                                        // Recorte real sobre las coordenadas nativas del stream de video (85% ancho x 60% alto centrado)
                                        const srcW = Math.round(vWidth * 0.85);
                                        const srcH = Math.round(vHeight * 0.60);
                                        const srcX = Math.round((vWidth - srcW) / 2);
                                        const srcY = Math.round((vHeight - srcH) / 2);

                                        const scale = Math.min(1, 640 / Math.max(srcW, srcH));
                                        const cropW = Math.max(1, Math.round(srcW * scale));
                                        const cropH = Math.max(1, Math.round(srcH * scale));

                                        if (canvas.width !== cropW || canvas.height !== cropH) {
                                            canvas.width = cropW;
                                            canvas.height = cropH;
                                        }

                                        ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, cropW, cropH);

                                        let detectedByMlKit = false;
                                        if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.scanBarcode) {
                                            try {
                                                const base64Crop = canvas.toDataURL('image/jpeg', 0.82);
                                                const mlRes = await window.Capacitor.Plugins.PosNativeHardware.scanBarcode({ imageBase64: base64Crop });
                                                if (mlRes && mlRes.found && mlRes.rawValue) {
                                                    detectedByMlKit = true;
                                                    handleValidBarcode(mlRes.rawValue);
                                                }
                                            } catch (_mlErr) {}
                                        }

                                        if (!detectedByMlKit && reader) {
                                            const imgData = ctx.getImageData(0, 0, cropW, cropH);
                                            try {
                                                const luminanceSource = new RGBLuminanceSource(imgData.data, cropW, cropH);
                                                const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
                                                const result = reader.decode(binaryBitmap);
                                                if (result && result.getText()) {
                                                    handleValidBarcode(result.getText());
                                                }
                                            } catch (_e) {
                                                reader.reset();
                                            }
                                        }
                                    }
                                }
                            } else if (activeModeRef.current === 'VISION') {
                                // Reconocimiento Visual y Contextual Inteligente (Vista de Águila / Visión Edge)
                                const now = Date.now();
                                if (now - lastVisionOcrAttemptRef.current >= 240 && canvas && ctx && visionWorkerRef.current) {
                                    lastVisionOcrAttemptRef.current = now;
                                    const vWidth = video.videoWidth;
                                    const vHeight = video.videoHeight;
                                    if (vWidth > 0 && vHeight > 0) {
                                        const cropSize = Math.round(Math.min(vWidth, vHeight) * 0.75);
                                        const cropX = Math.round((vWidth - cropSize) / 2);
                                        const cropY = Math.round((vHeight - cropSize) / 2);

                                        const targetSize = Math.min(500, cropSize);
                                        canvas.width = targetSize;
                                        canvas.height = targetSize;
                                        ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, targetSize, targetSize);

                                        // 1. Extraer código de barras en el encuadre si está visible
                                        let detectedBarcode = '';
                                        if (nativeDetectorRef.current) {
                                            const barcodes = await nativeDetectorRef.current.detect(canvas).catch(() => []);
                                            if (barcodes && barcodes.length > 0) {
                                                detectedBarcode = barcodes[0].rawValue || barcodes[0].displayValue || '';
                                            }
                                        }

                                        // 2. Extraer texto visible del empaque / marca mediante OCR nativo ML Kit
                                        let detectedText = '';
                                        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.recognizeText) {
                                            try {
                                                const frameJpeg = canvas.toDataURL('image/jpeg', 0.65);
                                                const ocrRes = await window.Capacitor.Plugins.PosNativeHardware.recognizeText({ imageBase64: frameJpeg });
                                                if (ocrRes && ocrRes.success && ocrRes.text) {
                                                    detectedText = ocrRes.text;
                                                }
                                            } catch (_ocrErr) {}
                                        }

                                        if (!detectedText && nativeTextDetectorRef.current) {
                                            const textBlocks = await nativeTextDetectorRef.current.detect(canvas).catch(() => []);
                                            if (textBlocks && textBlocks.length > 0) {
                                                detectedText = textBlocks.map(t => t.rawValue).join(' ');
                                            }
                                        }

                                        // 3. Enviar al hilo secundario para búsqueda semántica contra el catálogo
                                        visionWorkerRef.current.postMessage({
                                            type: 'MATCH_INTELLIGENCE',
                                            payload: { detectedText, detectedBarcode }
                                        });
                                    }
                                }
                            } else if (activeModeRef.current === 'OCR') {
                                // Escáner de Lotes y Vencimiento (Texto nativo + Códigos GS1 / DataMatrix)
                                const vWidth = video.videoWidth;
                                const vHeight = video.videoHeight;
                                if (vWidth > 0 && vHeight > 0 && canvas && ctx) {
                                    const cropW = Math.round(vWidth * 0.85);
                                    const cropH = Math.round(vHeight * 0.4);
                                    const cropX = Math.round((vWidth - cropW) / 2);
                                    const cropY = Math.round((vHeight - cropH) / 2);
                                    canvas.width = cropW;
                                    canvas.height = cropH;
                                    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

                                    // Vía A: Reconocimiento OCR Nativo por Hardware con Google ML Kit (Android)
                                    let textRecognized = false;
                                    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.recognizeText && ocrWorkerRef.current) {
                                        try {
                                            const frameJpeg = canvas.toDataURL('image/jpeg', 0.65);
                                            const ocrRes = await window.Capacitor.Plugins.PosNativeHardware.recognizeText({ imageBase64: frameJpeg });
                                            if (ocrRes && ocrRes.success && ocrRes.text) {
                                                textRecognized = true;
                                                ocrWorkerRef.current.postMessage({ type: 'PARSE_TEXT', text: ocrRes.text });
                                            }
                                        } catch (_ocrErr) {}
                                    }

                                    // Vía B: TextDetector nativo si está disponible en Chromium desktop
                                    if (!textRecognized && nativeTextDetectorRef.current && ocrWorkerRef.current) {
                                        const textBlocks = await nativeTextDetectorRef.current.detect(canvas).catch(() => []);
                                        if (textBlocks && textBlocks.length > 0) {
                                            textRecognized = true;
                                            const combined = textBlocks.map(t => t.rawValue).join(' ');
                                            ocrWorkerRef.current.postMessage({ type: 'PARSE_TEXT', text: combined });
                                        }
                                    }

                                    // Vía B: Lectura de códigos GS1 / DataMatrix que contienen Lote (AI 10) y Vencimiento (AI 17)
                                    let codeFound = false;
                                    if (nativeDetectorRef.current && ocrWorkerRef.current) {
                                        const detectedBarcodes = await nativeDetectorRef.current.detect(canvas).catch(() => []);
                                        if (detectedBarcodes && detectedBarcodes.length > 0) {
                                            const rawVal = detectedBarcodes[0].rawValue || detectedBarcodes[0].displayValue;
                                            if (rawVal) {
                                                codeFound = true;
                                                ocrWorkerRef.current.postMessage({ type: 'PARSE_TEXT', text: rawVal });
                                            }
                                        }
                                    }

                                    // Vía C: ZXing Software Fallback si no hay detector nativo o no detectó
                                    if (!codeFound && reader && ocrWorkerRef.current) {
                                        try {
                                            const imgData = ctx.getImageData(0, 0, cropW, cropH);
                                            const luminanceSource = new RGBLuminanceSource(imgData.data, cropW, cropH);
                                            const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
                                            const result = reader.decode(binaryBitmap);
                                            if (result && result.getText()) {
                                                ocrWorkerRef.current.postMessage({ type: 'PARSE_TEXT', text: result.getText() });
                                            }
                                        } catch (_e) {
                                            reader.reset();
                                        }
                                    }
                                }
                            }
                        } catch (_err) {
                            // Silent catch per frame
                        } finally {
                            isProcessingFrame = false;
                        }
                    }
                }

                animationFrameRef.current = requestAnimationFrame(scanLoop);
            };

            animationFrameRef.current = requestAnimationFrame(scanLoop);

        } catch (err) {
            console.warn('Camera Scanner start notice:', err);
            const errName = (err?.name || '').toLowerCase();
            const errStr = `${errName} ${String(err?.message || err)}`.toLowerCase();

            if (errStr.includes('notallowederror') || errStr.includes('permission') || errStr.includes('denied')) {
                setErrorType('permission');
                setErrorMsg('Permiso de cámara bloqueado. Haz clic en el candado 🔒 en la barra de tu navegador y activa el permiso de Cámara.');
            } else if (errStr.includes('notfounderror') || errStr.includes('devicesnotfounderror') || errStr.includes('requested device not found')) {
                setErrorType('notFound');
                setErrorMsg('No se detectó ninguna cámara web o cámara integrada en este equipo. Puedes usar un lector de código de barras USB/Bluetooth, escribir el código abajo, o abrir el sistema desde un celular.');
            } else if (errStr.includes('notreadableerror') || errStr.includes('trackstarterror') || errStr.includes('in use') || errStr.includes('busy')) {
                setErrorType('busy');
                setErrorMsg('La cámara está en uso por otra aplicación. Ciérrala y pulsa reintentar.');
            } else if (errStr.includes('overconstrainederror')) {
                setErrorType('constrained');
                setErrorMsg('La cámara no soporta los modos solicitados. Pulsa reintentar.');
            } else {
                setErrorType('generic');
                setErrorMsg('No se pudo acceder a la cámara. Verifica que tengas los permisos concedidos y una cámara conectada.');
            }
            setIsScanning(false);
        }
    };

    const handleSwitchCamera = async () => {
        if (availableCameras.length < 2) return;
        const currentIndex = availableCameras.findIndex(c => c.deviceId === selectedCameraId);
        const nextIndex = (currentIndex + 1) % availableCameras.length;
        const nextCamera = availableCameras[nextIndex];
        setSelectedCameraId(nextCamera.deviceId);
        await startScanner(nextCamera.deviceId);
    };

    const triggerAutoFocus = async () => {
        try {
            if (streamRef.current) {
                const track = streamRef.current.getVideoTracks()[0];
                if (track && track.applyConstraints) {
                    await track.applyConstraints({
                        advanced: [{ focusMode: 'continuous' }]
                    });
                }
            }
        } catch (_e) {}
    };

    const toggleTorch = async () => {
        try {
            if (streamRef.current) {
                const track = streamRef.current.getVideoTracks()[0];
                if (track && track.applyConstraints) {
                    const nextTorch = !torchOn;
                    await track.applyConstraints({
                        advanced: [{ torch: nextTorch }]
                    });
                    setTorchOn(nextTorch);
                }
            }
        } catch (err) {
            console.warn('Torch toggle error:', err);
        }
    };

    const handleToggleZoom = async () => {
        try {
            if (streamRef.current) {
                const track = streamRef.current.getVideoTracks()[0];
                if (track && track.applyConstraints) {
                    const nextZoom = zoomLevel === 1 ? Math.min(2, maxZoom) : 1;
                    await track.applyConstraints({
                        advanced: [{ zoom: nextZoom }]
                    });
                    setZoomLevel(nextZoom);
                }
            }
        } catch (_e) {}
    };

    const handleCopyOcr = async (type = 'both') => {
        let textToCopy = '';
        if (type === 'batch') {
            textToCopy = detectedOcr.batchNumber;
        } else if (type === 'expiration') {
            textToCopy = detectedOcr.expirationDate;
        } else {
            textToCopy = `Lote: ${detectedOcr.batchNumber || '-'} | Vto: ${detectedOcr.expirationDate || '-'}`;
        }

        if (!textToCopy) return;

        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.copyToClipboard) {
            try {
                await window.Capacitor.Plugins.PosNativeHardware.copyToClipboard({ text: textToCopy });
                if (navigator.vibrate) navigator.vibrate(40);
                toast.success(`📋 Copiado: ${textToCopy}`);
                return;
            } catch (_capErr) {}
        }

        try {
            await navigator.clipboard.writeText(textToCopy);
            if (navigator.vibrate) navigator.vibrate(40);
            toast.success(`📋 Copiado: ${textToCopy}`);
        } catch (_e) {
            const el = document.createElement('textarea');
            el.value = textToCopy;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            toast.success(`📋 Copiado: ${textToCopy}`);
        }
    };

    const copyBarcodeToClipboard = async (codeToCopy) => {
        const text = codeToCopy || lastScanned;
        if (!text) return;
        hapticTap();
        let ok = false;
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.copyToClipboard) {
            try {
                await window.Capacitor.Plugins.PosNativeHardware.copyToClipboard({ text });
                ok = true;
            } catch (_capErr) {}
        }
        if (!ok) {
            try {
                await navigator.clipboard.writeText(text);
                ok = true;
            } catch (_e) {
                try {
                    const el = document.createElement('textarea');
                    el.value = text;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand('copy');
                    document.body.removeChild(el);
                    ok = true;
                } catch (_err) {}
            }
        }
        setCopiedCode(text);
        setTimeout(() => setCopiedCode(''), 2000);
        toast.success(`📋 Código copiado: ${text}`);
    };

    const handleValidBarcode = (code) => {
        const cleanCode = String(code || '').replace(/[\r\n\t]+/g, '').trim();
        if (!cleanCode) return;
        const now = Date.now();
        // Debounce: Ignore identical code within 1.5s
        if (cleanCode === lastScanCodeRef.current && (now - lastScanTimeRef.current) < 1500) {
            return;
        }

        lastScanTimeRef.current = now;
        lastScanCodeRef.current = cleanCode;
        window.__ISAAC_LAST_LOCAL_SCAN__ = { barcode: cleanCode, ts: now };

        // Buscar si el código corresponde a algún producto del catálogo local
        const lowerCode = cleanCode.toLowerCase();
        const strippedCode = lowerCode.replace(/^0+/, '');
        const matched = Array.isArray(products) ? products.find(p => {
            const cands = [
                p.barcode,
                p.bulkBarcode,
                p.midBulkBarcode,
                ...(Array.isArray(p.Presentations) ? p.Presentations.map(pr => pr?.barcode) : []),
                ...(Array.isArray(p.presentations) ? p.presentations.map(pr => pr?.barcode) : []),
                ...(Array.isArray(p.Variantes) ? p.Variantes.map(v => v?.codigo_barras || v?.sku) : [])
            ].filter(Boolean).map(c => String(c).trim().toLowerCase());
            return cands.some(c => c === lowerCode || (strippedCode.length >= 4 && c.replace(/^0+/, '') === strippedCode));
        }) : null;

        setLastScanned(cleanCode);
        setLastMatchedProduct(matched || null);
        setBurstCount(prev => prev + 1);
        setScanHistory(prev => {
            const filtered = prev.filter(item => item.code !== cleanCode);
            return [{ code: cleanCode, productName: matched?.name || null, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }, ...filtered].slice(0, 20);
        });

        playCashierBeep();
        hapticSuccess();

        // Transmitir en tiempo real al servidor (para que la PC Principal reciba el código instantáneamente)
        api.post('/remote-scan', { barcode: cleanCode, source: 'scanner_modal' }).catch(() => {});

        if (typeof onBarcodeScanned === 'function') {
            onBarcodeScanned(cleanCode);
        }

        if (targetMode === 'ASSIGN') {
            setTimeout(() => {
                onClose();
            }, 350);
        } else if (!burstMode) {
            setTimeout(() => {
                onClose();
            }, 450);
        }
    };

    if (!isOpen) return null;

    const modalContent = (
        <AnimatePresence>
            <div className="fixed inset-0 z-[200000] flex items-center justify-center bg-black/95 backdrop-blur-xl p-3 sm:p-4 pb-safe">
                <motion.div
                    initial={{ opacity: 0, scale: 0.94, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.94, y: 15 }}
                    className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto bg-slate-950 rounded-xl border border-slate-800 shadow-2xl flex flex-col z-[200001] custom-scrollbar"
                >
                    {/* Header */}
                    <div className="p-4 flex items-center justify-between border-b border-white/10 bg-slate-900/80">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-primary-500/20 text-primary-400 border border-primary-500/30">
                                <Scan size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
                                    {title || 'Escáner Móvil'}
                                    {targetMode === 'ASSIGN' && (
                                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                            ASIGNAR
                                        </span>
                                    )}
                                    {burstMode && targetMode !== 'ASSIGN' && (
                                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                                             RÁFAGA {burstCount > 0 ? `(${burstCount})` : ''}
                                        </span>
                                    )}
                                </h3>
                                <p className="text-[10px] font-bold text-slate-400">
                                    {subtitle || (targetMode === 'ASSIGN' ? 'Apunta al código para asignarlo al producto' : (burstMode ? 'Pistoleo continuo activo' : 'Apunta al código de barras'))}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                            {scanHistory.length > 0 && (
                                <button
                                    onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                                    title="Historial de Códigos Leídos"
                                    aria-label="Historial"
                                    className={`relative min-w-[40px] min-h-[40px] p-2 rounded-full transition-colors cursor-pointer flex items-center justify-center active:scale-95 ${
                                        isHistoryOpen ? 'bg-primary-500 text-white' : 'text-slate-400 hover:text-white bg-white/5 hover:bg-white/10'
                                    }`}
                                >
                                    <Clock size={17} />
                                    <span className="absolute -top-1 -right-1 px-1 min-w-[15px] h-[15px] rounded-full bg-emerald-500 text-slate-950 font-black text-[9px] flex items-center justify-center">
                                        {scanHistory.length}
                                    </span>
                                </button>
                            )}
                            {availableCameras.length > 1 && (
                                <button
                                    onClick={handleSwitchCamera}
                                    title="Cambiar Cámara Trasera / Delantera"
                                    aria-label="Cambiar Cámara"
                                    className="min-w-[40px] min-h-[40px] p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-colors cursor-pointer flex items-center justify-center active:scale-95"
                                >
                                    <SwitchCamera size={17} />
                                </button>
                            )}
                            <button
                                onClick={onClose}
                                aria-label="Cerrar modal"
                                className="min-w-[40px] min-h-[40px] p-2 text-slate-400 hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-colors cursor-pointer flex items-center justify-center active:scale-95"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Historial de Escaneos de Sesión */}
                    {isHistoryOpen && (
                        <div className="p-3 bg-slate-900 border-b border-white/10 shrink-0 max-h-48 overflow-y-auto custom-scrollbar">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-primary-400 flex items-center gap-1">
                                    <Clock size={12} /> Códigos Leídos ({scanHistory.length})
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setScanHistory([])}
                                    className="text-[9px] font-bold text-slate-400 hover:text-rose-400 uppercase cursor-pointer"
                                >
                                    Limpiar
                                </button>
                            </div>
                            <div className="space-y-1.5">
                                {scanHistory.map((item, idx) => (
                                    <div
                                        key={idx}
                                        className="p-2 rounded-xl bg-slate-950 border border-white/10 flex items-center justify-between gap-2"
                                    >
                                        <div className="min-w-0">
                                            <span className="text-xs font-mono font-black text-white block truncate">
                                                {item.code}
                                            </span>
                                            <span className="text-[9px] text-slate-500">{item.time}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => copyBarcodeToClipboard(item.code)}
                                                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold flex items-center gap-1 active:scale-95 cursor-pointer"
                                                title="Copiar Código"
                                            >
                                                {copiedCode === item.code ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                            </button>
                                            {onSaveNewProduct && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onSaveNewProduct(item.code);
                                                        onClose();
                                                    }}
                                                    className="p-1.5 rounded-lg bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 text-[10px] font-bold flex items-center gap-1 active:scale-95 cursor-pointer"
                                                    title="Crear producto con este código"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Barra de Modos: Barras | Visión Edge | OCR Lote */}
                    <div className="flex items-center gap-1.5 p-2 bg-slate-900 border-b border-white/10 shrink-0">
                        <button
                            type="button"
                            onClick={() => setActiveMode('BARCODE')}
                            className={`flex-1 min-h-[40px] py-1.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                                activeMode === 'BARCODE' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white bg-white/5'
                            }`}
                        >
                            <Scan size={13} />
                            <span>Barras</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveMode('VISION')}
                            className={`flex-1 min-h-[40px] py-1.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                                activeMode === 'VISION' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-400 hover:text-white bg-white/5'
                            }`}
                        >
                            <span>👁️ Visión Edge</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveMode('OCR')}
                            className={`flex-1 min-h-[40px] py-1.5 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                                activeMode === 'OCR' ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-400 hover:text-white bg-white/5'
                            }`}
                        >
                            <span>📋 Lote / Vto</span>
                        </button>
                    </div>

                    {/* Viewfinder Window (Centered Full Video Feed) */}
                    <div 
                        onClick={triggerAutoFocus}
                        className="relative w-full aspect-square max-h-[55vh] bg-black overflow-hidden flex items-center justify-center cursor-pointer"
                    >
                        {errorMsg ? (
                            <div className="p-6 text-center text-slate-300 space-y-4 max-w-sm z-30">
                                <div className="w-14 h-14 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto border border-amber-500/30 text-amber-400">
                                    <AlertCircle size={32} />
                                </div>
                                <div className="space-y-1.5">
                                    <h4 className="text-sm font-black text-white uppercase tracking-wide">
                                        {errorType === 'permission' ? 'Permiso Requerido' : 'Cámara No Disponible'}
                                    </h4>
                                    <p className="text-xs font-medium text-slate-300 leading-relaxed">
                                        {errorMsg}
                                    </p>
                                </div>

                                <button
                                    onClick={() => startScanner()}
                                    className="px-5 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 mx-auto shadow-lg shadow-primary-600/30 active:scale-95 transition-all cursor-pointer"
                                >
                                    <RefreshCw size={14} /> Solicitar / Reintentar Cámara
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Native HTML5 Video Stream */}
                                <video
                                    ref={videoRef}
                                    className="absolute inset-0 w-full h-full object-cover"
                                    autoPlay
                                    muted
                                    playsInline
                                />

                                {!isVideoFeedReady && (
                                    <div className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center p-4 text-center z-15 pointer-events-auto">
                                        <div className="w-9 h-9 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin mb-3"></div>
                                        <p className="text-xs font-black text-white mb-1">Iniciando cámara...</p>
                                        <p className="text-[11px] text-slate-400 max-w-xs mb-3">
                                            Si estás probando en PC sin webcam o con sensor virtual, dispara con tu pistola lectora o escribe el código abajo.
                                        </p>
                                        {availableCameras.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={handleSwitchCamera}
                                                className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95"
                                            >
                                                <SwitchCamera size={13} />
                                                <span>Cambiar Cámara ({availableCameras.length})</span>
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Aim Target HUD Overlay adaptable por Modo */}
                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6 z-10">
                                    {activeMode === 'BARCODE' && (
                                        <div className={`relative w-72 sm:w-80 h-36 sm:h-44 border-2 rounded-xl flex items-center justify-center overflow-hidden transition-colors ${
                                            lastScanned ? 'border-emerald-400 bg-emerald-500/10' : 'border-emerald-500/80'
                                        }`}>
                                            <div className="absolute left-0 right-0 h-0.5 bg-emerald-400 animate-bounce"></div>
                                            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-emerald-400"></div>
                                            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-emerald-400"></div>
                                            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-emerald-400"></div>
                                            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-emerald-400"></div>
                                        </div>
                                    )}

                                    {activeMode === 'VISION' && (
                                        <div className="relative w-56 h-56 rounded-full border-2 border-dashed border-amber-400/80 flex items-center justify-center animate-pulse">
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-slate-900/80 px-2.5 py-1 rounded border border-amber-400/30">
                                                Centre el Producto
                                            </span>
                                        </div>
                                    )}

                                    {activeMode === 'OCR' && (
                                        <div className="relative w-80 h-28 border-2 border-teal-400/90 rounded-xl flex flex-col items-center justify-center bg-teal-500/5">
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-300 bg-slate-900/80 px-2.5 py-1 rounded mb-1 border border-teal-400/30">
                                                Alinee LOTE y VENCIMIENTO
                                            </span>
                                            <div className="w-full h-0.5 bg-teal-400/50 animate-pulse"></div>
                                        </div>
                                    )}
                                </div>

                                {lastScanned && (
                                    <div className={`absolute bottom-3 left-3 right-3 bg-slate-950/95 border ${lastMatchedProduct || targetMode === 'ASSIGN' ? 'border-emerald-500/40' : 'border-amber-500/40'} backdrop-blur-md text-white p-3 rounded-2xl shadow-2xl animate-in zoom-in-95 flex flex-col gap-2 z-20`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className={`p-1.5 rounded-lg shrink-0 ${lastMatchedProduct || targetMode === 'ASSIGN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                                    <CheckCircle2 size={16} />
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                                                        {targetMode === 'ASSIGN'
                                                            ? 'Código Asignado'
                                                            : lastMatchedProduct
                                                                ? `✓ ${lastMatchedProduct.name}`
                                                                : 'Código Detectado (Enviado a Caja)'}
                                                    </span>
                                                    <span className="text-xs font-black font-mono tracking-wider text-emerald-300 block truncate">
                                                        {lastScanned}
                                                    </span>
                                                </div>
                                            </div>
                                            {targetMode !== 'ASSIGN' && (
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg shrink-0 border ${
                                                    lastMatchedProduct
                                                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                                        : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                                }`}>
                                                    {lastMatchedProduct ? `+${burstCount} Agregado` : 'Sin registrar'}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    copyBarcodeToClipboard(lastScanned);
                                                }}
                                                className={`flex-1 py-1.5 px-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 border ${
                                                    copiedCode === lastScanned
                                                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                                                        : 'bg-white/10 hover:bg-white/15 text-white border-white/10'
                                                }`}
                                            >
                                                {copiedCode === lastScanned ? <Check size={12} /> : <Copy size={12} />}
                                                <span>{copiedCode === lastScanned ? 'Copiado!' : 'Copiar Código'}</span>
                                            </button>

                                            {onSaveNewProduct && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSaveNewProduct(lastScanned);
                                                        onClose();
                                                    }}
                                                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
                                                >
                                                    <Plus size={12} />
                                                    <span>Crear Producto</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Resultados de Visión Edge / Vista de Águila */}
                    {activeMode === 'VISION' && (
                        <div className="p-3 bg-slate-900 border-t border-amber-500/30 shrink-0 space-y-2">
                            <div className="flex items-center justify-between text-[10px]">
                                <span className="font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                    <Eye size={12} />
                                    <span>Vista de Águila (Visión Inteligente)</span>
                                </span>
                                {lastDetectedVisionText ? (
                                    <span className="font-mono text-slate-300 truncate max-w-[180px] bg-slate-950 px-2 py-0.5 rounded border border-amber-500/30">
                                        Detectado: "{lastDetectedVisionText}"
                                    </span>
                                ) : (
                                    <span className="text-slate-500 italic">Centre la marca o empaque...</span>
                                )}
                            </div>

                            {visionMatches.length > 0 ? (
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 block">
                                        Coincidencias en Catálogo:
                                    </span>
                                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                        {visionMatches.map((m) => (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => {
                                                    if (onVisionMatch) {
                                                        onVisionMatch(m);
                                                    } else if (m.barcode) {
                                                        handleValidBarcode(m.barcode);
                                                    }
                                                    playCashierBeep();
                                                    if (navigator.vibrate) navigator.vibrate(50);
                                                    onClose();
                                                }}
                                                className="p-2.5 rounded-xl bg-slate-950/90 hover:bg-amber-500/20 border border-emerald-500/40 hover:border-amber-500/50 text-left shrink-0 min-w-[145px] max-w-[200px] flex flex-col justify-between transition-all cursor-pointer shadow-md active:scale-95"
                                            >
                                                <div>
                                                    <span className="text-[11px] font-black text-white truncate block leading-tight">{m.name}</span>
                                                    {m.category && <span className="text-[9px] text-slate-400 block truncate">{m.category}</span>}
                                                </div>
                                                <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-1.5">
                                                    <span className="text-xs font-black text-amber-400 font-mono">${Number(m.price || 0).toFixed(2)}</span>
                                                    <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
                                                        {m.confidence}%
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="py-2 text-center text-[11px] text-slate-400 bg-slate-950/50 rounded-xl border border-white/5 p-2">
                                    Enfoque el producto para que la cámara reconozca la marca o el texto del empaque.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Panel de Datos OCR (Vista de Águila / Lotes y Vencimiento) */}
                    {activeMode === 'OCR' && (
                        <div className="p-3 bg-slate-900 border-t border-teal-500/30 flex flex-col gap-2 shrink-0">
                            {/* Header con estado y texto crudo en vivo */}
                            <div className="flex items-center justify-between text-[10px]">
                                <span className="font-black text-teal-400 uppercase tracking-wider flex items-center gap-1">
                                    <Scan size={12} className="animate-pulse" /> Vista de Águila (OCR)
                                </span>
                                {detectedOcr.rawDetected ? (
                                    <span className="font-mono text-slate-400 truncate max-w-[180px] bg-slate-950/80 px-1.5 py-0.5 rounded border border-white/5">
                                        "{detectedOcr.rawDetected.slice(0, 25)}..."
                                    </span>
                                ) : (
                                    <span className="text-slate-500 text-[10px] italic">
                                        Apunta a LOTE o VTO...
                                    </span>
                                )}
                            </div>

                            {/* Tarjetas de Lote y Vencimiento con botones de copiado */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-2 bg-slate-950/90 rounded-xl border border-teal-500/20 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase mb-0.5">
                                            <span className="flex items-center gap-1"><Hash size={10} className="text-teal-400" /> N° Lote</span>
                                        </div>
                                        <p className="text-xs font-mono font-black text-white truncate min-h-[1.25rem]">
                                            {detectedOcr.batchNumber || <span className="text-slate-600 font-normal italic">Buscando...</span>}
                                        </p>
                                    </div>
                                    {detectedOcr.batchNumber && (
                                        <button
                                            type="button"
                                            onClick={() => handleCopyOcr('batch')}
                                            className="mt-1.5 py-1 px-2 bg-teal-500/15 hover:bg-teal-500/25 active:scale-95 text-teal-300 rounded-lg text-[10px] font-bold uppercase flex items-center justify-center gap-1 border border-teal-500/30 transition-all cursor-pointer"
                                        >
                                            <Copy size={11} /> Copiar Lote
                                        </button>
                                    )}
                                </div>

                                <div className="p-2 bg-slate-950/90 rounded-xl border border-teal-500/20 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase mb-0.5">
                                            <span className="flex items-center gap-1"><Calendar size={10} className="text-teal-400" /> Vencimiento</span>
                                        </div>
                                        <p className="text-xs font-mono font-black text-teal-400 truncate min-h-[1.25rem]">
                                            {detectedOcr.expirationDate || <span className="text-slate-600 font-normal italic">Buscando...</span>}
                                        </p>
                                    </div>
                                    {detectedOcr.expirationDate && (
                                        <button
                                            type="button"
                                            onClick={() => handleCopyOcr('expiration')}
                                            className="mt-1.5 py-1 px-2 bg-teal-500/15 hover:bg-teal-500/25 active:scale-95 text-teal-300 rounded-lg text-[10px] font-bold uppercase flex items-center justify-center gap-1 border border-teal-500/30 transition-all cursor-pointer"
                                        >
                                            <Copy size={11} /> Copiar Vto
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Botones de Acción Global: Copiar Todo y Aplicar */}
                            {(detectedOcr.batchNumber || detectedOcr.expirationDate) && (
                                <div className="flex gap-2 pt-0.5">
                                    <button
                                        type="button"
                                        onClick={() => handleCopyOcr('both')}
                                        className="flex-1 py-2 px-3 bg-white/10 hover:bg-white/15 active:scale-95 text-white rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-1.5 cursor-pointer border border-white/10 transition-all"
                                    >
                                        <Copy size={13} /> Copiar Todo
                                    </button>
                                    {onOcrDetected && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (onOcrDetected) onOcrDetected(detectedOcr);
                                                toast.success('✓ Lote y Vencimiento aplicados');
                                                onClose();
                                            }}
                                            className="flex-1 py-2 px-3 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 active:scale-95 text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider shadow-md flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                                        >
                                            <Check size={14} /> Aplicar
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quick Manual Code Entry Bar */}
                    <form 
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (manualCodeInput.trim()) {
                                handleValidBarcode(manualCodeInput.trim());
                                setManualCodeInput('');
                            }
                        }}
                        className="px-3.5 py-2.5 bg-slate-900/90 border-t border-white/10 flex items-center gap-2"
                    >
                        <input 
                            type="text"
                            value={manualCodeInput}
                            onChange={(e) => setManualCodeInput(e.target.value)}
                            placeholder="O escribe el código aquí..."
                            className="flex-1 px-3 py-2 bg-slate-950 border border-white/15 rounded-xl text-sm sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 font-mono"
                        />
                        <button
                            type="submit"
                            disabled={!manualCodeInput.trim()}
                            className="px-3.5 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:hover:bg-primary-600 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1.5 active:scale-95 transition-all shadow-md cursor-pointer shrink-0"
                        >
                            <span>{targetMode === 'ASSIGN' ? 'Asignar' : 'Listo'}</span>
                            <ArrowRight size={13} />
                        </button>
                    </form>

                    {/* Controls Footer */}
                    <div className="p-3 sm:p-4 pb-safe sm:pb-4 bg-slate-900/80 border-t border-white/10 flex items-center justify-between gap-2">
                        {/* Modo Ráfaga Toggle */}
                        <button
                            type="button"
                            onClick={() => setBurstMode(!burstMode)}
                            className={`flex-1 py-2.5 min-h-[44px] px-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                                burstMode 
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' 
                                    : 'bg-white/10 text-slate-400 hover:text-white'
                            }`}
                        >
                            <Scan size={14} />
                            {burstMode ? 'Ráfaga ON' : 'Ráfaga OFF'}
                        </button>

                        {/* Zoom 1x / 2x Toggle */}
                        {zoomSupported && (
                            <button
                                type="button"
                                onClick={handleToggleZoom}
                                className={`py-2.5 min-h-[44px] px-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 ${
                                    zoomLevel > 1 ? 'bg-primary-500 text-white shadow-lg' : 'bg-white/10 hover:bg-white/15 text-white'
                                }`}
                            >
                                <ZoomIn size={14} />
                                {zoomLevel > 1 ? '2x' : '1x'}
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={toggleTorch}
                            disabled={!torchSupported && !isScanning}
                            className={`py-2.5 min-h-[44px] px-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                                torchOn ? 'bg-amber-500 text-black font-black shadow-lg shadow-amber-500/20' : 'bg-white/10 hover:bg-white/15 text-white disabled:opacity-40'
                            }`}
                        >
                            <Zap size={14} className={torchOn ? 'fill-current' : ''} />
                            {torchOn ? 'Luz ON' : 'Luz'}
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            className="py-2.5 min-h-[44px] px-4 rounded-xl text-[11px] font-black uppercase tracking-wider bg-primary-600 hover:bg-primary-500 text-white transition-all text-center shadow-md cursor-pointer active:scale-95 flex items-center justify-center"
                        >
                            Listo {burstCount > 0 ? `(${burstCount})` : ''}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}

