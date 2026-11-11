import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Critical UI Error captured by ErrorBoundary:", error, errorInfo);

        // Auto-recarga automática si es un fallo por despliegue de nueva versión / chunks obsoletos
        const errMsg = error?.message || '';
        const isChunkError = Boolean(
            errMsg.includes('Failed to fetch dynamically imported module') ||
            errMsg.includes('Importing a module script failed') ||
            errMsg.includes('dynamically imported module') ||
            error?.name === 'ChunkLoadError'
        );

        if (isChunkError && typeof window !== 'undefined') {
            const lastReload = sessionStorage.getItem('pos_preload_reload');
            const now = Date.now();
            if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
                sessionStorage.setItem('pos_preload_reload', String(now));
                setTimeout(() => {
                    window.location.reload();
                }, 800);
            }
        }
    }

    render() {
        if (this.state.hasError) {
            const errMsg = this.state.error?.message || '';
            const isChunkError = Boolean(
                errMsg.includes('Failed to fetch dynamically imported module') ||
                errMsg.includes('Importing a module script failed') ||
                errMsg.includes('dynamically imported module') ||
                this.state.error?.name === 'ChunkLoadError'
            );

            return (
                <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 sm:p-8 text-center animate-in fade-in duration-300 my-auto">
                        <div className={`w-14 h-14 ${isChunkError ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60'} rounded-xl flex items-center justify-center mx-auto mb-5`}>
                            {isChunkError ? <RefreshCw size={26} className="animate-spin" /> : <AlertTriangle size={26} />}
                        </div>
                        
                        <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                            {isChunkError ? 'Actualizando a la última versión' : 'Algo no salió bien'}
                        </h1>
                        
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-6 leading-relaxed">
                            {isChunkError
                                ? 'Se detectó una nueva versión del sistema en el servidor. La interfaz se está recargando para sincronizar los módulos actualizados...'
                                : 'La aplicación ha detectado un error inesperado en la interfaz. Tus datos registrados permanecen protegidos.'}
                        </p>

                        <div className="space-y-2.5">
                            <button 
                                onClick={() => window.location.reload()}
                                className="w-full h-10 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                            >
                                <RefreshCw size={15} />
                                Recargar Aplicación
                            </button>
                            
                            <button 
                                onClick={() => {
                                    this.setState({ hasError: false, error: null });
                                    window.location.hash = '#/pos';
                                    window.location.reload();
                                }}
                                className="w-full h-10 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <Home size={15} />
                                Volver al Punto de Venta
                            </button>
                        </div>
                        
                        {this.state.error && (
                            <details className="mt-4 text-left p-3 bg-slate-100 dark:bg-slate-950 rounded-xl text-slate-700 dark:text-slate-300">
                                <summary className="text-[11px] font-bold cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                                    Ver detalle del error
                                </summary>
                                <p className="text-[10px] font-mono text-rose-600 dark:text-rose-400 break-all mt-2 font-bold whitespace-pre-wrap">
                                    {this.state.error?.toString()}
                                </p>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
