import { useState } from 'react';
import { Mail, Loader2, Save, Send } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function EmailSettings({ business, setBusiness, saving, onSave }) {
    const [testing, setTesting] = useState(false);

    const emailConfig = business.emailConfig || { user: '', pass: '' };

    const handleConfigChange = (field, value) => {
        setBusiness({
            ...business,
            emailConfig: {
                ...emailConfig,
                [field]: value
            }
        });
    };

    const handleTestEmail = async () => {
        if (!emailConfig.user || !emailConfig.pass) {
            toast.error('Complete el correo y la contraseña de aplicación primero');
            return;
        }

        try {
            setTesting(true);
            const toastId = toast.loading('Probando conexión SMTP...');
            
            await api.post('/settings/email-test', {
                user: emailConfig.user,
                pass: emailConfig.pass
            });

            toast.success('¡Conexión SMTP exitosa!', { id: toastId });
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al conectar con el servidor de correo');
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-6 transition-all">
            <div className="flex items-center gap-3.5 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/30">
                    <Mail size={20} />
                </div>
                <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">Envío de Facturas por Correo</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Configura una cuenta de Gmail para despachar comprobantes digitales a tus clientes</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Correo de Envío (Gmail)
                    </label>
                    <input
                        type="email"
                        value={emailConfig.user}
                        onChange={(e) => handleConfigChange('user', e.target.value)}
                        placeholder="tu-negocio@gmail.com"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20"
                    />
                </div>

                <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Contraseña de Aplicación
                    </label>
                    <input
                        type="password"
                        value={emailConfig.pass}
                        onChange={(e) => handleConfigChange('pass', e.target.value)}
                        placeholder="•••• •••• •••• ••••"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Generada desde <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">Google Security (Contraseñas de aplicación)</a>
                    </p>
                </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2.5">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    <span>{saving ? 'Guardando...' : 'Guardar Ajustes'}</span>
                </button>
                <button
                    type="button"
                    onClick={handleTestEmail}
                    disabled={testing || !emailConfig.user || !emailConfig.pass}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                    {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    <span>Probar Conexión SMTP</span>
                </button>
            </div>
        </div>
    );
}
