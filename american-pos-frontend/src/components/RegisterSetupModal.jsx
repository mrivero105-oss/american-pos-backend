import { useState } from 'react';
import { Store, Check, AlertCircle } from 'lucide-react';
import { usePos } from '../hooks/PosContext';
import BaseModal from './BaseModal';

export default function RegisterSetupModal({ isOpen }) {
    const { registerDisplayName, setRegisterDisplayName } = usePos();
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    if (!isOpen || registerDisplayName) return null;

    const handleSave = () => {
        if (!name.trim()) {
            setError('Debes ingresar un nombre para esta caja.');
            return;
        }
        setRegisterDisplayName(name.trim());
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={() => {}} // Empty to prevent closing via Escape/Backdrop as it's mandatory
            maxWidth="max-w-md"
            className="bg-white dark:bg-slate-900 overflow-hidden border border-slate-100 dark:border-white/10"
            zIndex="z-[9999]"
            disableOutsideClick={true}
        >
                <div className="bg-gradient-to-br from-primary-500 to-indigo-600 p-5 sm:p-8 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>
                    <div className="relative z-10 flex flex-col items-center">
                        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/30 mb-3 sm:mb-4 shadow-xl">
                            <Store size={28} className="text-white drop-shadow-md sm:w-8 sm:h-8" />
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black tracking-tight drop-shadow-md">Configuración de Caja</h2>
                        <p className="text-primary-100 mt-1.5 sm:mt-2 font-medium text-xs sm:text-sm drop-shadow-md opacity-90 max-w-[280px]">
                            Al parecer este es un dispositivo nuevo. Por favor, asígnale un nombre para identificarlo en las auditorías.
                        </p>
                    </div>
                </div>
                
                <div className="p-5 sm:p-8 pb-safe sm:pb-8">
                    <label className="block text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">
                        Nombre del Dispositivo / Caja
                    </label>
                    <div className="relative">
                        <input 
                            type="text"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (error) setError('');
                            }}
                            placeholder="Ej: Caja Principal, Teléfono Juan, etc."
                            className={`w-full bg-slate-50 dark:bg-slate-950 border ${error ? 'border-red-500' : 'border-slate-200 dark:border-white/10 focus:border-primary-500'} rounded-2xl px-5 py-3.5 sm:py-4 text-base text-slate-900 dark:text-white font-bold outline-none transition-all placeholder:font-medium placeholder:text-slate-400`}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSave();
                            }}
                        />
                        {error && (
                            <div className="absolute -bottom-6 left-1 text-[10px] font-black text-red-500 uppercase flex items-center gap-1">
                                <AlertCircle size={10} /> {error}
                            </div>
                        )}
                    </div>

                    <button 
                        onClick={handleSave}
                        className="mt-7 sm:mt-8 w-full min-h-[48px] bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white rounded-2xl py-3.5 sm:py-4 font-black flex justify-center items-center gap-2 transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 active:scale-95 cursor-pointer text-xs sm:text-sm uppercase tracking-wider"
                    >
                        <Check size={20} /> Guardar Identificador
                    </button>
                    
                    <p className="text-center text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-4 px-4 leading-tight">
                        Este nombre solo se pedirá la primera vez y servirá para los reportes Z y X.
                    </p>
                </div>
        </BaseModal>
    );
}
