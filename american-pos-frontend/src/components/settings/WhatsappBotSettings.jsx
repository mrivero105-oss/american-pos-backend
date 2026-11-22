import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, QrCode, LogOut, Loader2, Play, Bell, Save, SendHorizontal } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/SocketContext';

export default function WhatsappBotSettings() {
    const [status, setStatus] = useState('DISCONNECTED');
    const [qrCodeUrl, setQrCodeUrl] = useState(null);
    const [lastError, setLastError] = useState(null);
    const [loading, setLoading] = useState(true);
    const { socket } = useSocket() || {};
    const [ownerConfig, setOwnerConfig] = useState({
        ownerWhatsappPhone: '',
        ownerTelegramChatId: '',
        ownerTelegramBotToken: ''
    });
    const [savingAlerts, setSavingAlerts] = useState(false);
    const [testingAlert, setTestingAlert] = useState(false);

    const applyStatusData = useCallback((data) => {
        if (!data || !data.status) return;
        setStatus(data.status);
        setQrCodeUrl(data.qrCodeUrl || null);
        setLastError(data.lastError || null);
    }, []);

    const fetchStatus = useCallback(async () => {
        try {
            const { data } = await api.get('/whatsapp/status');
            applyStatusData(data);
        } catch (error) {
            console.error('Error fetching WhatsApp status:', error);
        } finally {
            setLoading(false);
        }
    }, [applyStatusData]);

    const fetchAlertConfig = async () => {
        try {
            const { data } = await api.get('/settings/business');
            if (data) {
                setOwnerConfig({
                    ownerWhatsappPhone: data.ownerWhatsappPhone || data.phone || '',
                    ownerTelegramChatId: data.ownerTelegramChatId || '',
                    ownerTelegramBotToken: data.ownerTelegramBotToken || ''
                });
            }
        } catch (e) {
            console.warn('Error fetching alert config:', e);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchAlertConfig();
    }, [fetchStatus]);

    useEffect(() => {
        if (!socket) return;
        socket.on('whatsapp_status', applyStatusData);
        return () => socket.off('whatsapp_status', applyStatusData);
    }, [socket, applyStatusData]);

    useEffect(() => {
        const pollMs = status === 'INITIALIZING' ? 1000 : 4000;
        const interval = setInterval(fetchStatus, pollMs);
        return () => clearInterval(interval);
    }, [status, fetchStatus]);

    const handleStart = async (forceRestart = false) => {
        try {
            setLastError(null);
            setStatus('INITIALIZING');
            setLoading(false);
            const { data } = await api.post('/whatsapp/start', { forceRestart });
            applyStatusData(data);
            if (!forceRestart && data?.status !== 'QR_READY' && data?.status !== 'CONNECTED') {
                toast.success('Iniciando servicio de WhatsApp...');
            }
            setTimeout(fetchStatus, 800);
        } catch (error) {
            const errMsg = error?.response?.data?.error || 'Error al iniciar servicio';
            toast.error(errMsg);
            setLastError(errMsg);
            setStatus('DISCONNECTED');
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        try {
            setLoading(true);
            await api.post('/whatsapp/logout');
            toast.success('Sesión cerrada');
            setStatus('DISCONNECTED');
            setQrCodeUrl(null);
            setLastError(null);
        } catch (_error) {
            toast.error('Error al cerrar sesión');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveAlertConfig = async (e) => {
        if (e) e.preventDefault();
        try {
            setSavingAlerts(true);
            const { data: current } = await api.get('/settings/business');
            await api.post('/settings/business', {
                ...(current || {}),
                ...ownerConfig
            });
            toast.success('Configuración de alertas guardada exitosamente');
        } catch (_e) {
            toast.error('Error al guardar configuración de alertas');
        } finally {
            setSavingAlerts(false);
        }
    };

    const handleTestAlert = async () => {
        try {
            setTestingAlert(true);
            const { data } = await api.post('/system/test-owner-alert', {
                ownerWhatsappPhone: ownerConfig.ownerWhatsappPhone,
                ownerTelegramChatId: ownerConfig.ownerTelegramChatId,
                ownerTelegramBotToken: ownerConfig.ownerTelegramBotToken
            });
            if (data.sent?.whatsapp && data.sent?.telegram) {
                toast.success('¡Alerta enviada exitosamente por WhatsApp y Telegram!');
            } else if (data.sent?.whatsapp) {
                toast.success('¡Alerta enviada a tu WhatsApp exitosamente!');
            } else if (data.sent?.telegram) {
                toast.success('¡Alerta enviada a Telegram exitosamente!');
            } else {
                toast('Alerta procesada. Si deseas recibirla por WhatsApp, inicia el servicio escaneando el código QR. Para Telegram, configura Token y Chat ID.', { 
                    icon: 'ℹ️', 
                    duration: 6500 
                });
            }
        } catch (e) {
            toast.error('Error enviando alerta de prueba: ' + (e.response?.data?.error || e.message));
        } finally {
            setTestingAlert(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
                <div className="flex items-center gap-3.5 mb-5 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/30">
                        <MessageCircle size={20} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">Servicio de WhatsApp</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Envío automático de recibos digitales, tickets y notificaciones de compra</p>
                    </div>
                </div>

                <div className="flex flex-col items-center justify-center py-6">
                    {loading && status !== 'QR_READY' ? (
                        <div className="flex flex-col items-center gap-3 text-slate-500 text-xs font-medium">
                            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                            <p>Verificando estado del servicio...</p>
                        </div>
                    ) : status === 'DISCONNECTED' ? (
                        <div className="flex flex-col items-center text-center max-w-sm">
                            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-3 text-slate-400">
                                <QrCode size={28} />
                            </div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Servicio Desconectado</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-xs mb-4">Inicia el servicio para generar el código QR y vincular el WhatsApp de tu negocio.</p>
                            {lastError && (
                                <p className="text-amber-600 dark:text-amber-400 text-xs mb-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-2">
                                    {lastError}
                                </p>
                            )}
                            <button 
                                type="button"
                                onClick={() => handleStart(false)} 
                                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-semibold text-xs transition-colors shadow-xs cursor-pointer"
                            >
                                <Play size={14} /> Iniciar Servicio
                            </button>
                        </div>
                    ) : status === 'INITIALIZING' ? (
                        <div className="flex flex-col items-center gap-3 text-slate-500 text-center max-w-sm text-xs font-medium">
                            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                            <p className="font-semibold text-slate-700 dark:text-slate-300">Inicializando navegador y esperando código QR...</p>
                            <p className="text-slate-400">Esto suele tomar unos 4 a 12 segundos.</p>
                            <button
                                type="button"
                                onClick={() => handleStart(true)}
                                className="text-primary-600 dark:text-primary-400 font-semibold hover:underline cursor-pointer mt-1"
                            >
                                ¿Tarda demasiado? Reintentar
                            </button>
                        </div>
                    ) : status === 'QR_READY' && qrCodeUrl ? (
                        <div className="flex flex-col items-center text-center">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Escanea el Código QR con tu Teléfono</h3>
                            <div className="bg-white p-3 rounded-xl shadow-xs border border-slate-200 mb-3 inline-block">
                                <img src={qrCodeUrl} alt="WhatsApp QR Code" className="w-56 h-56 object-contain" />
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 text-xs max-w-sm mb-4">Abre WhatsApp en tu teléfono, ve a Dispositivos Vinculados y escanea este código.</p>
                            <button 
                                type="button"
                                onClick={handleLogout} 
                                className="text-red-500 hover:text-red-600 text-xs font-semibold cursor-pointer"
                            >
                                Cancelar vinculación
                            </button>
                        </div>
                    ) : status === 'CONNECTED' ? (
                        <div className="flex flex-col items-center text-center">
                            <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mb-3 border border-emerald-100 dark:border-emerald-900/30">
                                <MessageCircle size={28} />
                            </div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">WhatsApp Conectado y Activo</h3>
                            <p className="text-slate-500 dark:text-slate-400 text-xs mb-5 max-w-sm">El servicio está listo para emitir recibos y tickets de compra directamente a tus clientes.</p>
                            <button 
                                type="button"
                                onClick={handleLogout} 
                                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40 px-4 py-2 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                            >
                                <LogOut size={14} /> Desconectar Sesión
                            </button>
                        </div>
                    ) : (
                        <div className="text-center text-slate-500 text-xs">
                            Estado: {status}
                            <div className="mt-3">
                                <button type="button" onClick={handleLogout} className="text-red-500 hover:underline">Reiniciar</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Executive Alerts Card for Owner */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
                <div className="flex items-center gap-3.5 mb-5 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-100 dark:border-indigo-900/30">
                        <Bell size={20} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">Alertas Ejecutivas al Propietario</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Notificaciones instantáneas de Cierres Z, Devoluciones y Aperturas de Gaveta</p>
                    </div>
                </div>

                <form onSubmit={handleSaveAlertConfig} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                WhatsApp del Propietario
                            </label>
                            <input
                                type="text"
                                placeholder="Ej: 584121234567"
                                value={ownerConfig.ownerWhatsappPhone}
                                onChange={(e) => setOwnerConfig({ ...ownerConfig, ownerWhatsappPhone: e.target.value })}
                                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                            />
                            <p className="text-[11px] text-slate-400">Con código de país sin signos (ej. 58412...)</p>
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Telegram Chat ID (Opcional)
                            </label>
                            <input
                                type="text"
                                placeholder="Ej: 123456789"
                                value={ownerConfig.ownerTelegramChatId}
                                onChange={(e) => setOwnerConfig({ ...ownerConfig, ownerTelegramChatId: e.target.value })}
                                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                            />
                            <p className="text-[11px] text-slate-400">ID numérico de tu chat de Telegram</p>
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Telegram Bot Token (Opcional)
                            </label>
                            <input
                                type="password"
                                placeholder="Token de @BotFather"
                                value={ownerConfig.ownerTelegramBotToken}
                                onChange={(e) => setOwnerConfig({ ...ownerConfig, ownerTelegramBotToken: e.target.value })}
                                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500"
                            />
                            <p className="text-[11px] text-slate-400">Token del bot creado con BotFather</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <button
                            type="button"
                            onClick={handleTestAlert}
                            disabled={testingAlert}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-xs transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            {testingAlert ? <Loader2 size={14} className="animate-spin" /> : <SendHorizontal size={14} />}
                            <span>Probar Alerta</span>
                        </button>

                        <button
                            type="submit"
                            disabled={savingAlerts}
                            className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-semibold text-xs transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                            {savingAlerts ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            <span>Guardar Configuración</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
