import { useState, useEffect } from 'react';
import { CheckCircle, X, AlertTriangle, ArrowRight, Save, Printer } from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';
import { formatUSD, formatBs, getGlobalSettings, isSingleCurrencyMode } from '../utils/format';
import { printZReportReceipt, printShiftInventoryReceipt } from '../utils/printCashReceipts';
import SupervisorAuthModal from './SupervisorAuthModal';
import { useAuth } from '../hooks/AuthContext';

// Reusable Input with Quick Chips (+1, +5, +10)
const DenominationInput = ({ label, value, onChange, isCoin = false }) => (
    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-500/40 transition-colors group">
        <span className="font-black text-slate-800 dark:text-slate-200 text-sm tracking-tight">{label}</span>
        <div className="flex items-center gap-1.5">
            {!isCoin && (
                <div className="hidden sm:flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onChange((Number(value) || 0) + 1)}
                        className="px-2 py-1 bg-white dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-600 transition-all active:scale-95"
                    >
                        +1
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange((Number(value) || 0) + 5)}
                        className="px-2 py-1 bg-white dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-600 transition-all active:scale-95"
                    >
                        +5
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange((Number(value) || 0) + 10)}
                        className="px-2 py-1 bg-white dark:bg-slate-700 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-[10px] font-black rounded-lg border border-slate-200 dark:border-slate-600 transition-all active:scale-95"
                    >
                        +10
                    </button>
                </div>
            )}
            <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min="0"
                value={value || ''}
                onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 sm:w-20 text-right bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 font-black text-base sm:text-sm outline-none focus:border-primary-500 text-slate-900 dark:text-white"
                placeholder="0"
            />
        </div>
    </div>
);

export default function BlindClosureModal(props) {
    const {
        isOpen,
        onClose,
        currentShift,
        onSuccess,
        businessSettings = {}
    } = props;

    const { user } = useAuth();
    const isUserAdminOrSupervisor = ['admin', 'superadmin', 'owner', 'supervisor'].includes(String(user?.role || '').toLowerCase());
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [risk, setRisk] = useState({ level: 'SAFE', score: 0 });

    const [closureData, setClosureData] = useState({
        usd: { '1': 0, '5': 0, '10': 0, '20': 0, '50': 0, '100': 0, '0.50': 0, '0.25': 0, '0.10': 0, '0.05': 0, '0.01': 0 },
        looseCoins: 0,
        ves: 0,
        zelle: 0,
        card: 0,
        mobile: 0
    });
    
    const [notes, setNotes] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [showAuth, setShowAuth] = useState(false);
    const [approval, setApproval] = useState(null);

    // Load Draft
    useEffect(() => {
        if (isOpen && step === 1) {
            const draft = localStorage.getItem('closureDraft');
            if (draft) {
                try {
                    setClosureData(JSON.parse(draft));
                } catch (_e) {}
            }
            fetchRiskLevel();
        }
    }, [isOpen]);

    const fetchRiskLevel = async () => {
        if (!currentShift?.userId) return;
        try {
            const { data } = await api.get(`/cash/risk-level/${currentShift.userId}`);
            setRisk(data);
        } catch (e) {
            console.error('Error fetching risk level', e);
        }
    };

    // Save Draft
    useEffect(() => {
        if (step < 5) {
            localStorage.setItem('closureDraft', JSON.stringify(closureData));
        }
    }, [closureData, step]);

    if (!isOpen) return null;

    const billsTotal = ['100', '50', '20', '10', '5', '1'].reduce(
        (sum, bill) => sum + (Number(bill) * Number(closureData.usd?.[bill] || 0)), 0
    );
    const coinsDenomTotal = ['0.50', '0.25', '0.10', '0.05', '0.01'].reduce(
        (sum, coin) => sum + (Number(coin) * Number(closureData.usd?.[coin] || 0)), 0
    );
    const usdTotal = Math.round((billsTotal + coinsDenomTotal + Number(closureData.looseCoins || 0)) * 100) / 100;

    const submitClosure = async (overrideApproval = null) => {
        const activeApproval = overrideApproval || approval;
        if (risk.level === 'CRITICAL' && !activeApproval && !isUserAdminOrSupervisor) {
            setShowAuth(true);
            return;
        }

        try {
            setLoading(true);
            const supervisorId = activeApproval?.approvedBy || activeApproval?.supervisorId || (isUserAdminOrSupervisor ? user?.id : null);
            const supervisorName = activeApproval?.metadata?.approverName || activeApproval?.supervisorName || activeApproval?.name || (isUserAdminOrSupervisor ? (user?.name || user?.username) : null);

            const { data } = await api.post('/cash/close-blind', {
                shiftId: currentShift.id,
                declaration: closureData,
                notes,
                supervisorApprovalId: activeApproval?.id || null,
                approvedBy: supervisorId,
                supervisorId: supervisorId,
                supervisorName: supervisorName,
                overrideBySupervisor: !!activeApproval || isUserAdminOrSupervisor
            });
            setResult(data);
            setStep(5);
            localStorage.removeItem('closureDraft');
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: { isOpen: false, shift: null } }));
            }

            try {
                const shiftItems = data?.salesSummary?.itemsSummary || data?.shift?.salesSummary?.itemsSummary || data?.itemsSummary || [];
                printZReportReceipt({
                    shift: data?.shift || currentShift,
                    closureResult: data,
                    declaration: closureData,
                    difference: data?.shift?.difference || 0,
                    supervisorName,
                    user,
                    settings: businessSettings,
                    businessSettings,
                    kickDrawer: businessSettings?.openDrawerOnPrint !== false,
                    itemsSummary: shiftItems,
                    autoPrint: true
                });

                if (businessSettings?.zReportItemsPrintMode === 'SEPARATE' && shiftItems.length > 0) {
                    printShiftInventoryReceipt({
                        shift: data?.shift || currentShift,
                        itemsSummary: shiftItems,
                        settings: businessSettings,
                        businessSettings,
                        autoPrint: true
                    });
                }
            } catch (printErr) {
                console.warn('Auto-print blind closure warning:', printErr);
            }
        } catch (error) {
            const isAuthReq = error.response?.data?.code === 'SUPERVISOR_AUTH_REQUIRED' || error.response?.status === 403;
            const errStr = String(error.response?.data?.error || error.response?.data?.message || error.message || '').toLowerCase();
            
            if (isAuthReq) {
                toast.error(error.response?.data?.error || error.response?.data?.message || 'Descuadre excede tolerancia ($1.00 USD). Se requiere autorización de Supervisor.');
                setShowAuth(true);
            } else if (errStr.includes('ya se encuentra cerrado') || errStr.includes('ya está cerrado') || errStr.includes('cerrado')) {
                toast.success('El turno ya ha sido cerrado en el sistema.');
                localStorage.removeItem('closureDraft');
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: { isOpen: false, shift: null } }));
                }
                if (onSuccess) onSuccess(currentShift);
                onClose();
            } else {
                console.error(error);
                toast.error(error.response?.data?.message || error.response?.data?.error || 'Error al sellar declaración');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleFinish = () => {
        if (onSuccess && result) onSuccess(result.shift);
        onClose();
    };

    const renderStepContent = () => {
        switch (step) {
            case 1: // Denominaciones Físicas
                return (
                    <div className="space-y-4 animate-in slide-in-from-right-4">
                        <div className="text-center mb-6">
                            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800 dark:text-white">Conteo de Efectivo</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Paso 1 de 3: Gaveta Física</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[60vh] overflow-y-auto pr-2">
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mb-2">Billetes USD</h3>
                                    <div className="space-y-2">
                                        {['100', '50', '20', '10', '5', '1'].map(bill => (
                                            <DenominationInput
                                                key={bill}
                                                label={`$${bill}`}
                                                value={closureData.usd[bill]}
                                                onChange={(val) => setClosureData(prev => ({
                                                    ...prev, usd: { ...prev.usd, [bill]: val }
                                                }))}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mb-2">Monedas / Centavos USD</h3>
                                    <div className="space-y-2">
                                        {[
                                            { id: '0.50', label: '50¢ ($0.50)' },
                                            { id: '0.25', label: '25¢ ($0.25)' },
                                            { id: '0.10', label: '10¢ ($0.10)' },
                                            { id: '0.05', label: '5¢ ($0.05)' },
                                            { id: '0.01', label: '1¢ ($0.01)' }
                                        ].map(coin => (
                                            <DenominationInput
                                                key={coin.id}
                                                label={coin.label}
                                                value={closureData.usd[coin.id]}
                                                onChange={(val) => setClosureData(prev => ({
                                                    ...prev, usd: { ...prev.usd, [coin.id]: val }
                                                }))}
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">o Monto Suelto en Monedas ($ / Centavos)</label>
                                    <div className="flex items-center gap-2">
                                        <span className="font-black text-slate-500">$</span>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            step="0.01"
                                            min="0"
                                            value={closureData.looseCoins || ''}
                                            onChange={(e) => setClosureData(prev => ({ ...prev, looseCoins: e.target.value ? Number(e.target.value) : 0 }))}
                                            className="w-full bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 font-black text-base sm:text-sm outline-none focus:border-primary-500 text-slate-800 dark:text-white"
                                            placeholder="Ej. 0.18"
                                        />
                                    </div>
                                </div>

                                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-5 rounded-2xl border border-emerald-200 dark:border-emerald-800 text-center">
                                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">{isSingleCurrencyMode(businessSettings) ? 'Total Contado (Billetes + Monedas)' : 'Total USD Contado'}</span>
                                    <p className="text-3xl font-black text-emerald-700 dark:text-emerald-300 mt-1.5 font-mono">${usdTotal.toFixed(2)}</p>
                                </div>

                                {!isSingleCurrencyMode(businessSettings) && (
                                    <div className="space-y-2 pt-2">
                                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center mb-1">Efectivo Bolívares</h3>
                                        <DenominationInput
                                            label="Total Bs"
                                            value={closureData.ves}
                                            onChange={(val) => setClosureData(prev => ({ ...prev, ves: val }))}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-4 mt-6">
                            <button onClick={onClose} className="w-1/3 py-4 min-h-[48px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black rounded-2xl uppercase tracking-widest hover:bg-slate-300 dark:hover:bg-slate-700 transition-all active:scale-95 flex items-center justify-center cursor-pointer">
                                Cancelar
                            </button>
                            <button onClick={() => setStep(2)} className="w-2/3 py-4 min-h-[48px] bg-primary-600 text-white font-black rounded-2xl uppercase tracking-widest flex justify-center items-center gap-2 hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 active:scale-95 cursor-pointer">
                                Continuar <ArrowRight size={18} />
                            </button>
                        </div>
                    </div>
                );
            case 2: // Digital
                return (
                    <div className="space-y-6 animate-in slide-in-from-right-4">
                        <div className="text-center mb-6">
                            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800 dark:text-white">Declaración Digital</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Paso 2 de 3: Terminales y Cuentas</p>
                        </div>

                        <div className="space-y-4 max-w-sm mx-auto">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">{isSingleCurrencyMode(businessSettings) ? 'Total Tarjeta / Débito ($)' : 'Total Cierre Punto Venta (Bs)'}</label>
                                <input type="number" inputMode="decimal" min="0" step="any" value={closureData.card || ''} onChange={(e) => setClosureData({...closureData, card: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 font-black text-xl text-center outline-none focus:border-primary-500 text-slate-800 dark:text-white" placeholder="0.00" />
                            </div>
                            {!isSingleCurrencyMode(businessSettings) && (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Total Pago Móvil (Bs)</label>
                                    <input type="number" inputMode="decimal" min="0" step="any" value={closureData.mobile || ''} onChange={(e) => setClosureData({...closureData, mobile: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 font-black text-xl text-center outline-none focus:border-primary-500 text-slate-800 dark:text-white" placeholder="0.00" />
                                </div>
                            )}
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">{isSingleCurrencyMode(businessSettings) ? 'Total Transferencia / Zelle ($)' : 'Total Zelle ($)'}</label>
                                <input type="number" inputMode="decimal" min="0" step="any" value={closureData.zelle || ''} onChange={(e) => setClosureData({...closureData, zelle: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 font-black text-xl text-center outline-none focus:border-primary-500 text-slate-800 dark:text-white" placeholder="0.00" />
                            </div>
                        </div>

                        <div className="flex gap-4 mt-6">
                            <button onClick={() => setStep(1)} className="w-1/3 py-4 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black rounded-2xl uppercase tracking-widest hover:bg-slate-300 dark:hover:bg-slate-700 transition-all active:scale-95">Atrás</button>
                            <button onClick={() => setStep(3)} className="w-2/3 py-4 bg-primary-600 text-white font-black rounded-2xl uppercase tracking-widest flex justify-center items-center gap-2 hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 active:scale-95">
                                Revisión Final <ArrowRight size={18} />
                            </button>
                        </div>
                    </div>
                );
            case 3: // Notas opcionales
                return (
                    <div className="space-y-6 animate-in slide-in-from-right-4 max-w-lg mx-auto">
                        <div className="text-center mb-6">
                            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800 dark:text-white">Observaciones de Cierre</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Justificaciones o notas del turno</p>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {['Sin incidencias', 'Ajuste por redondeo', 'Diferencia en monedas', 'Propina en caja'].map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => setNotes(prev => prev ? `${prev} • ${tag}` : tag)}
                                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-primary-500 hover:text-white text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 transition-all active:scale-95"
                                >
                                    + {tag}
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full h-32 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl p-4 font-bold outline-none resize-none focus:border-primary-500 text-slate-800 dark:text-white"
                            placeholder="¿Alguna irregularidad o aclaración sobre el conteo de caja?"
                        />
                         <div className="flex gap-4 mt-6">
                            <button onClick={() => setStep(2)} className="w-1/3 py-4 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black rounded-2xl uppercase tracking-widest hover:bg-slate-300 dark:hover:bg-slate-700 transition-all active:scale-95">Atrás</button>
                            <button onClick={() => setStep(4)} className="w-2/3 py-4 bg-primary-600 text-white font-black rounded-2xl uppercase tracking-widest flex justify-center items-center gap-2 hover:bg-primary-700 transition-all shadow-lg shadow-primary-500/20 active:scale-95">
                                Ir al Sello <ArrowRight size={18} />
                            </button>
                        </div>
                    </div>
                );
            case 4: // Contrato Psicológico
                return (
                    <div className="space-y-6 animate-in slide-in-from-right-4 max-w-md mx-auto">
                        <div className="text-center mb-6">
                            <div className={`mx-auto w-16 h-16 flex items-center justify-center rounded-full mb-4 ${
                                risk.level === 'CRITICAL' ? 'bg-red-100 text-red-600' : 
                                risk.level === 'RISK' ? 'bg-orange-100 text-orange-600' :
                                'bg-amber-100 text-amber-500'
                            }`}>
                                {risk.level === 'CRITICAL' ? <X size={32} /> : <AlertTriangle size={32} />}
                            </div>
                            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-800 dark:text-white">Declaración Definitiva</h2>
                            
                            {risk.level === 'CRITICAL' && (
                                <div className="mt-2 p-3 bg-red-600 text-white rounded-xl animate-pulse">
                                    <p className="text-[10px] font-black uppercase tracking-widest">⚠️ NIVEL DE RIESGO CRÍTICO DETECTADO</p>
                                    <p className="text-[9px] font-bold opacity-90 mt-1">Esta operación está bajo vigilancia especial debido a descuadres recurrentes.</p>
                                </div>
                            )}
                            
                            {risk.level === 'RISK' && (
                                <div className="mt-2 p-3 bg-orange-500 text-white rounded-xl">
                                    <p className="text-[10px] font-black uppercase tracking-widest">⚠️ ATENCIÓN: ALERTA DE RIESGO</p>
                                    <p className="text-[9px] font-bold opacity-90">Verifica montos antes de sellar. Se han detectado inconsistencias previas.</p>
                                </div>
                            )}

                            {risk.level === 'SAFE' && <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mt-2">Revisa con cuidado. Esta acción es inmutable.</p>}
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-2xl text-sm font-bold border border-slate-200 dark:border-slate-700 space-y-3 text-slate-700 dark:text-slate-300">
                            <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2"><span>{isSingleCurrencyMode(businessSettings) ? 'Efectivo Contado' : 'Efectivo USD'}</span> <span className="font-black text-emerald-600 dark:text-emerald-400">${usdTotal}</span></div>
                            {!isSingleCurrencyMode(businessSettings) && (
                                <>
                                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2"><span>Efectivo VES</span> <span className="font-black">Bs. {closureData.ves}</span></div>
                                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2"><span>Punto de Venta</span> <span className="font-black">Bs. {closureData.card}</span></div>
                                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2"><span>Pago Móvil</span> <span className="font-black">Bs. {closureData.mobile}</span></div>
                                </>
                            )}
                            {isSingleCurrencyMode(businessSettings) && (
                                <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2"><span>Tarjeta / Débito</span> <span className="font-black">${closureData.card}</span></div>
                            )}
                            <div className="flex justify-between"><span>{isSingleCurrencyMode(businessSettings) ? 'Transferencia / Zelle' : 'Zelle'}</span> <span className="font-black">${closureData.zelle}</span></div>
                        </div>

                        <label className="flex items-start gap-4 p-4 border-2 border-primary-500/30 bg-primary-50 dark:bg-primary-900/10 rounded-xl cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-900/20 transition-colors">
                            <input type="checkbox" checked={confirmed} onChange={() => setConfirmed(!confirmed)} className="mt-1 w-5 h-5 accent-primary-600" />
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide leading-relaxed">Confirmo que el conteo físico y digital ha sido realizado correctamente y asumo responsabilidad por el monto declarado.</span>
                        </label>

                        <div className="flex gap-4 mt-6">
                            <button disabled={loading} onClick={() => setStep(1)} className="w-1/3 py-4 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black rounded-2xl uppercase tracking-widest disabled:opacity-50 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all active:scale-95">Corregir</button>
                            <button disabled={!confirmed || loading} onClick={() => submitClosure()} className="w-2/3 py-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl uppercase tracking-widest flex justify-center items-center gap-2 disabled:opacity-50 disabled:grayscale transition-all shadow-xl shadow-red-500/20 active:scale-95">
                                {loading ? 'Sellando...' : <><Save size={18} /> SELLAR DECLARACIÓN</>}
                            </button>
                        </div>
                    </div>
                );
            case 5: // Resultado
                if (!result) return null;
                const isPerfect = result.status === 'match';
                return (
                    <div className="space-y-6 animate-in zoom-in-95 duration-500 max-w-md mx-auto">
                        <div className="text-center mb-6">
                            <div className={`mx-auto w-24 h-24 flex items-center justify-center rounded-full mb-6 ${isPerfect ? 'bg-emerald-100 text-emerald-500 dark:bg-emerald-900/30' : 'bg-red-100 text-red-500 dark:bg-red-900/30'}`}>
                                {isPerfect ? <CheckCircle size={48} /> : <AlertTriangle size={48} />}
                            </div>
                            <h2 className={`text-3xl font-black uppercase tracking-tight ${isPerfect ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                {isPerfect ? 'Cuadre Perfecto' : 'Diferencia Detectada'}
                            </h2>
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-2">La auditoría del turno ha sido sellada en el Ledger.</p>
                        </div>

                        {!isPerfect && (
                            <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-2xl text-sm border border-slate-200 dark:border-slate-700 space-y-4">
                                <h3 className="font-black text-slate-400 uppercase tracking-widest text-center mb-4 text-[10px]">Desglose de Descuadre</h3>
                                {Object.entries(result.differences).map(([key, diff]) => {
                                    if (diff === 0) return null;
                                    const isNegative = diff < 0;
                                    return (
                                        <div key={key} className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-3">
                                            <span className="font-black text-slate-600 dark:text-slate-300 uppercase">{key}</span>
                                            <span className={`font-black tabular-nums text-lg ${isNegative ? 'text-red-500' : 'text-amber-500'}`}>
                                                {isNegative ? 'Faltante: ' : 'Sobrante: '}
                                                {['usd', 'zelle'].includes(key) || isSingleCurrencyMode(businessSettings) ? formatUSD(Math.abs(diff)) : formatBs(Math.abs(diff))}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-xl text-center">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hash de Seguridad</span>
                            <p className="font-mono text-xs mt-1 truncate text-slate-600 dark:text-slate-400 select-all">{result.shift?.salesSummary?.declarationHash || result.shift?.salesSummary?.declarationHash}</p>
                        </div>

                        {result.zReportText && (
                            <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block text-center">Vista Previa de Ticket Térmico</span>
                                <pre className="text-[10px] font-mono leading-tight text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre">
                                    {result.zReportText}
                                </pre>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
                            <button
                                onClick={async () => {
                                    const targetPrinter = localStorage.getItem('pos_station_printer') || businessSettings?.printerName || '';
                                    if (window.electronAPI) {
                                        try {
                                            await window.electronAPI.openDrawer(targetPrinter, businessSettings?.drawerSequence);
                                            toast.success('Gaveta abierta');
                                        } catch (e) {
                                            toast.error('Error al abrir gaveta');
                                        }
                                    } else {
                                        try {
                                            await api.post('/settings/open-drawer', {
                                                printerName: targetPrinter,
                                                sequence: businessSettings?.drawerSequence
                                            });
                                            toast.success('Gaveta abierta');
                                        } catch (e) {
                                            toast.error('Error al abrir gaveta');
                                        }
                                    }
                                }}
                                className="py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black rounded-2xl uppercase tracking-widest text-xs border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95 cursor-pointer"
                            >
                                🔓 Abrir Gaveta
                            </button>
                            <button onClick={async () => {
                                const targetPrinter = localStorage.getItem('pos_station_printer') || businessSettings?.printerName || '';
                                if (window.electronAPI && result?.zReportText) {
                                    await window.electronAPI.printRaw(result.zReportText, targetPrinter);
                                    toast.success('Ticket enviado a la impresora');
                                } else {
                                    await printZReportReceipt({
                                        shift: result?.shift || currentShift,
                                        closureResult: result,
                                        declaration: closureData,
                                        difference: result?.shift?.difference || 0,
                                        supervisorName: approval?.supervisorName || approval?.name || null,
                                        user,
                                        settings: businessSettings,
                                        businessSettings
                                    });
                                    toast.success('Ticket enviado a la impresora');
                                }
                            }} className="py-4 bg-emerald-600 text-white font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer">
                                <Printer size={18} /> Imprimir Corte Z
                            </button>
                        </div>

                        <button onClick={handleFinish} className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black rounded-2xl uppercase tracking-widest text-xs shadow-xl hover:opacity-90 transition-all active:scale-95">
                            Finalizar Turno
                        </button>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={() => {}} // BLOCKED COMPLETELY
            disableOutsideClick={true}
            maxWidth={step === 1 ? 'max-w-3xl' : 'max-w-2xl'}
            className="overflow-hidden flex flex-col p-4 sm:p-8 max-h-[92dvh] bg-white dark:bg-slate-950 font-sans shadow-2xl"
        >
            {/* Si NO estamos en resultado, podemos poner un boton de X oculto o bloqueado solo para debug, pero mejor quitarlo en producción */}
            
            <div className="flex-1 overflow-y-auto no-scrollbar pb-6 pt-4">
                {renderStepContent()}
            </div>
            
            <SupervisorAuthModal
                isOpen={showAuth}
                onClose={() => setShowAuth(false)}
                onAuthorized={(appr) => {
                    setApproval(appr);
                    setShowAuth(false);
                    submitClosure(appr);
                }}
                actionType="CLOSE_SHIFT"
                actionLabel="autorizar cierre de caja crítico"
                referenceId={currentShift.id}
            />

            {/* Indicador de pasos */}
            {step < 5 && (
                <div className="flex justify-center gap-2 pt-4 sm:pt-5 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] border-t border-slate-100 dark:border-slate-800">
                    {[1,2,3,4].map(i => (
                        <div key={i} className={`h-1.5 rounded-full transition-all duration-200 ${step >= i ? 'w-6 bg-primary-600' : 'w-2 bg-slate-200 dark:bg-slate-700'}`} />
                    ))}
                </div>
            )}
        </BaseModal>
    );
}
