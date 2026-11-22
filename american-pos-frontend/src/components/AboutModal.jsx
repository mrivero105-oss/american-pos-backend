import { X, Mail } from 'lucide-react';
import BaseModal from './BaseModal';
import Logo from './Logo';

export default function AboutModal({ isOpen, onClose, version = "24.04" }) {
    if (!isOpen) return null;

    const displayVersion = version.startsWith('V') || version.startsWith('v') ? version : `v${version}`;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-[420px]"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden text-slate-800 dark:text-slate-100"
        >
            {/* Cabecera con botón de cierre */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800/80">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Acerca del Sistema
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Cerrar"
                    aria-label="Cerrar modal"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Identidad de la Aplicación */}
            <div className="px-6 pt-5 pb-4 flex flex-col items-center text-center">
                <Logo size="lg" className="w-full max-w-[210px] h-auto mx-auto" />

                <div className="mt-3">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80">
                        Versión {displayVersion}
                    </span>
                </div>
            </div>

            {/* Ficha técnica y canales de soporte */}
            <div className="px-6 pb-5 space-y-3.5">
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">Desarrollador</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">Manuel Rivero</span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-800/60">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">Licencia</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">Comercial</span>
                    </div>
                </div>

                {/* Canales directos de soporte */}
                <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block px-0.5">
                        Contacto y Soporte
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <a
                            href="mailto:mrivero105@gmail.com"
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-2xs group"
                            title="Enviar correo a soporte"
                        >
                            <Mail size={14} className="text-slate-400 dark:text-slate-400 shrink-0 group-hover:text-primary-500 transition-colors" />
                            <span className="truncate">mrivero105@gmail.com</span>
                        </a>

                        <a
                            href="https://wa.me/584248302226"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-2xs group"
                            title="Contactar vía WhatsApp"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.396.015 12.03c0 2.12.559 4.189 1.619 6.007L0 24l6.135-1.61a11.81 11.81 0 005.91 1.586h.005c6.634 0 12.032-5.396 12.035-12.031a11.83 11.83 0 00-3.528-8.503z" />
                            </svg>
                            <span>WhatsApp Soporte</span>
                        </a>
                    </div>
                </div>
            </div>

            {/* Pie con copyright y botón de acción */}
            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-normal">
                    &copy; {new Date().getFullYear()} Isaac POS
                </p>
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[32px] px-3.5 py-1.5 rounded-lg font-semibold text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer shadow-2xs"
                >
                    Cerrar
                </button>
            </div>
        </BaseModal>
    );
}
