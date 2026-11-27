import { useState, useEffect } from 'react';
import { Printer, RefreshCw, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import api from '../services/api';
import BaseModal from './BaseModal';
import { getInvoiceUrl } from '../utils/imageUtils';

export default function HardwareScannerModal({
    isOpen,
    onClose,
    onScanCompleted,
    title = 'Escanear Factura desde Impresora',
    subtitle = 'Coloca la factura o albarán físico en el cristal o alimentador de tu impresora multifuncional'
}) {
    const [devices, setDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [loadingDevices, setLoadingDevices] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scannedResult, setScannedResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        if (isOpen) {
            fetchDevices();
            setScannedResult(null);
            setErrorMsg('');
        }
    }, [isOpen]);

    const fetchDevices = async () => {
        try {
            setLoadingDevices(true);
            setErrorMsg('');
            const res = await api.get('/scanner/devices', { timeout: 25000 });
            const list = res.data?.devices || [];
            setDevices(list);
            if (list.length > 0) {
                setSelectedDevice(list[0]);
            }
        } catch (err) {
            console.error('Error fetching scanner devices:', err);
            setErrorMsg('No se pudo verificar la conexión con escáneres locales.');
        } finally {
            setLoadingDevices(false);
        }
    };

    const handleStartScan = async () => {
        try {
            setIsScanning(true);
            setErrorMsg('');
            const res = await api.post('/scanner/scan', {
                deviceId: selectedDevice?.id || null
            }, { timeout: 120000 });

            if (res.data?.success && res.data?.invoiceUrl) {
                setScannedResult(res.data);
                toast.success('¡Documento escaneado exitosamente desde la impresora!');
            } else {
                throw new Error(res.data?.error || 'No se obtuvo imagen del escáner.');
            }
        } catch (err) {
            console.error('Error durante escaneo:', err);
            const msg = err.response?.data?.error || err.message || 'Error al comunicarse con el escáner.';
            setErrorMsg(msg);
            toast.error(msg);
        } finally {
            setIsScanning(false);
        }
    };

    const handleConfirmAttachment = () => {
        if (scannedResult?.invoiceUrl) {
            onScanCompleted(scannedResult.invoiceUrl);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-2xl"
            className="overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 rounded-xl"
        >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                        <Printer size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="p-5 space-y-5">
                {/* Device Selector / Status */}
                <div className="bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${devices.length > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <div>
                            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Dispositivo Detectado</span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {loadingDevices ? 'Detectando escáner...' : devices.length > 0 ? devices[0].name : 'Buscando escáner...'}
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={fetchDevices}
                        disabled={loadingDevices || isScanning}
                        className="p-1.5 text-slate-400 hover:text-indigo-500 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                        title="Volver a buscar escáner"
                    >
                        <RefreshCw size={15} className={loadingDevices ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Main Action / Scanning State / Result Preview */}
                <div className="min-h-[200px] flex flex-col items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 relative overflow-hidden bg-slate-50/50 dark:bg-slate-950/40">
                    <AnimatePresence mode="wait">
                        {isScanning ? (
                            <motion.div
                                key="scanning"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="flex flex-col items-center text-center space-y-3 py-4"
                            >
                                <div className="relative">
                                    <div className="w-14 h-14 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center animate-pulse">
                                        <Printer size={26} />
                                    </div>
                                    <motion.div
                                        animate={{ y: [-15, 15, -15] }}
                                        transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                                        className="absolute inset-x-0 h-0.5 bg-indigo-500/60"
                                    />
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                                        Escaneando Documento Físico...
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                                        El escáner de tu <strong>{selectedDevice?.name || 'Impresora'}</strong> está procesando la factura.
                                    </p>
                                </div>
                            </motion.div>
                        ) : scannedResult ? (
                            <motion.div
                                key="result"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="flex flex-col items-center w-full space-y-3"
                            >
                                <div className="relative max-h-[220px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-black/40">
                                    <img
                                        src={getInvoiceUrl(scannedResult.invoiceUrl)}
                                        alt="Factura Escaneada"
                                        className="max-h-[220px] object-contain"
                                    />
                                    <div className="absolute top-2 right-2 bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 shadow-sm">
                                        <CheckCircle2 size={12} /> Escaneado OK
                                    </div>
                                </div>
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    ¿Deseas adjuntar esta factura al albarán de recepción?
                                </span>
                            </motion.div>
                        ) : errorMsg ? (
                            <motion.div
                                key="error"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center text-center space-y-2 py-4"
                            >
                                <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 flex items-center justify-center">
                                    <AlertCircle size={22} />
                                </div>
                                <div className="space-y-0.5">
                                    <h4 className="text-xs font-bold text-rose-600 dark:text-rose-400">Aviso del Escáner</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">{errorMsg}</p>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="idle"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center text-center space-y-2.5 py-4"
                            >
                                <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                    <Printer size={24} />
                                </div>
                                <div className="space-y-0.5">
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                                        Listo para digitalizar factura
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                                        Coloca la factura en el cristal del escáner y presiona el botón inferior para comenzar.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Footer Actions */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={isScanning}
                    className="h-9 px-3 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                    Cancelar
                </button>

                <div className="flex items-center gap-2.5">
                    {scannedResult ? (
                        <>
                            <button
                                type="button"
                                onClick={handleStartScan}
                                disabled={isScanning}
                                className="h-9 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                            >
                                Re-Escanear
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmAttachment}
                                className="h-9 px-4 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                            >
                                <ShieldCheck size={15} />
                                <span>Adjuntar Factura Escaneada</span>
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={handleStartScan}
                            disabled={isScanning || loadingDevices}
                            className="h-9 px-4 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                        >
                            <Printer size={15} />
                            <span>{isScanning ? 'Escaneando...' : 'Iniciar Escaneo desde Impresora'}</span>
                        </button>
                    )}
                </div>
            </div>
        </BaseModal>
    );
}
