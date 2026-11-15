import { useState, useEffect } from 'react';
import { MessageCircle, QrCode, LogOut, Loader2, Play, X, CheckCircle2, ShieldCheck, RefreshCw, Smartphone, Send } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function WhatsappBotModal({ isOpen, onClose }) {
    const [status, setStatus] = useState('DISCONNECTED');
    const [qrCodeUrl, setQrCodeUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState(false);

    const fetchStatus = async () => {
        try {
            const { data } = await api.get('/whatsapp/status');
            setStatus(data.status);
            setQrCodeUrl(data.qrCodeUrl);
        } catch (error) {
            console.error('Error fetching WhatsApp status:', error);
        }
    };

    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            fetchStatus().finally(() => setLoading(false));
            const interval = setInterval(fetchStatus, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleStart = async () => {
        try {
            setIsActionLoading(true);
            setStatus('INITIALIZING');
            await api.post('/whatsapp/start');
            toast.success('Iniciando servicio de WhatsApp...');
            setTimeout(fetchStatus, 1500);
        } catch (error) {
            toast.error('Error al iniciar servicio de WhatsApp');
            setStatus('DISCONNECTED');
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleLogout = async () => {
        try {
            setIsActionLoading(true);
            await api.post('/whatsapp/logout');
            toast.success('Servicio de WhatsApp desconectado');
            setStatus('DISCONNECTED');
            setQrCodeUrl(null);
        } catch (error) {
            toast.error('Error al desconectar servicio');
        } finally {
            setIsActionLoading(false);
        }
    };

    const isConnected = status === 'CONNECTED';
    const isQrReady = status === 'QR_READY';
    const isInitializing = status === 'INITIALIZING';

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-xl shadow-xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-850/50">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-lg border ${
                            isConnected 
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' 
                                : isQrReady 
                                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800' 
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                        }`}>
                            <MessageCircle size={20} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-slate-900 dark:text-white">Servicio de WhatsApp</h3>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                    isConnected 
                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' 
                                        : isQrReady 
                                            ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 animate-pulse' 
                                            : isInitializing 
                                                ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' 
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                }`}>
                                    {isConnected ? 'Conectado' : isQrReady ? 'Código QR Listo' : isInitializing ? 'Iniciando...' : 'Desconectado'}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Envío de recibos digitales y notificaciones
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 sm:p-6 flex flex-col items-center justify-center text-center">
                    {loading && status !== 'QR_READY' && status !== 'CONNECTED' ? (
                        <div className="flex flex-col items-center gap-3 py-8 text-slate-500">
                            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Verificando estado del servicio...</p>
                        </div>
                    ) : isConnected ? (
                        <div className="flex flex-col items-center w-full">
                            <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center mb-3 border border-emerald-200 dark:border-emerald-800/60">
                                <MessageCircle size={28} />
                            </div>
                            <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                                Servicio Conectado y Activo
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-5 leading-relaxed">
                                El servicio de WhatsApp está conectado para el envío directo de recibos digitales, tickets de venta y estados de cuenta a clientes.
                            </p>

                            {/* Features Active */}
                            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5 text-left">
                                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Envío de Recibos Digitales</span>
                                </div>
                                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Estados de Cuenta a Clientes</span>
                                </div>
                                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Notificaciones de Cobro</span>
                                </div>
                                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                                    <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Sincronización en Tiempo Real</span>
                                </div>
                            </div>

                            <button
                                onClick={handleLogout}
                                disabled={isActionLoading}
                                className="w-full h-10 px-4 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold text-xs border border-rose-200 dark:border-rose-900/50 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {isActionLoading ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
                                <span>Desconectar Servicio</span>
                            </button>
                        </div>
                    ) : isQrReady && qrCodeUrl ? (
                        <div className="flex flex-col items-center w-full">
                            <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-200 mb-3 inline-block">
                                <img src={qrCodeUrl} alt="WhatsApp QR Code" className="w-52 h-52 object-contain" />
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                                <Smartphone size={16} className="text-primary-600 dark:text-primary-400" />
                                Escanea este Código con tu Teléfono
                            </h4>
                            <div className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mb-5 space-y-1 text-left bg-slate-50 dark:bg-slate-850 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                                <p><strong>1.</strong> Abre WhatsApp en tu celular</p>
                                <p><strong>2.</strong> Toca Configuración &gt; <strong>Dispositivos vinculados</strong></p>
                                <p><strong>3.</strong> Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara a este código</p>
                            </div>

                            <div className="flex gap-2.5 w-full">
                                <button
                                    onClick={fetchStatus}
                                    className="flex-1 h-10 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <RefreshCw size={14} />
                                    <span>Actualizar</span>
                                </button>
                                <button
                                    onClick={onClose}
                                    disabled={isActionLoading}
                                    className="flex-1 h-10 px-4 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-semibold text-xs border border-rose-200 dark:border-rose-900/50 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                >
                                    <X size={14} />
                                    <span>Cancelar</span>
                                </button>
                            </div>
                        </div>
                    ) : isInitializing ? (
                        <div className="flex flex-col items-center gap-3 py-6 text-center max-w-sm">
                            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center border border-indigo-200 dark:border-indigo-800">
                                <Loader2 className="w-6 h-6 animate-spin" />
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                                Inicializando Servicio de WhatsApp...
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Preparando la sesión. En unos segundos se generará el código QR para escanear.
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center w-full max-w-sm py-2">
                            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl flex items-center justify-center mb-3 border border-slate-200 dark:border-slate-700">
                                <MessageCircle size={28} />
                            </div>
                            <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1.5">
                                Servicio de WhatsApp Desconectado
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
                                Al conectar el servicio, podrás enviar recibos de compra, tickets digitales y estados de cuenta directamente a tus clientes.
                            </p>
                            <button
                                onClick={handleStart}
                                disabled={isActionLoading}
                                className="w-full h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {isActionLoading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                                <span>Iniciar y Conectar WhatsApp</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
