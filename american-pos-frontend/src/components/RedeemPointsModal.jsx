import { useState } from 'react';
import { X, Zap, DollarSign, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import BaseModal from './BaseModal';
import toast from 'react-hot-toast';
import api from '../services/api';
import { formatMoney } from '../utils/format';

export default function RedeemPointsModal({ isOpen, onClose, customer, onSuccess }) {
    const [pointsToRedeem, setPointsToRedeem] = useState('');
    const [mode, setMode] = useState('debt_reduction'); // 'debt_reduction' | 'credit_coupon'
    const [processing, setProcessing] = useState(false);

    if (!isOpen || !customer) return null;

    const availablePoints = parseFloat(customer.loyaltyPoints) || 0;
    const currentDebt = parseFloat(customer.creditBalance) || 0;
    const pointValueUsd = 1.0; // 1 punto = $1.00 USD
    const numPoints = parseFloat(pointsToRedeem) || 0;
    const calculatedUsd = (numPoints * pointValueUsd).toFixed(2);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (numPoints <= 0) {
            toast.error('Ingresa una cantidad válida de puntos');
            return;
        }
        if (numPoints > availablePoints) {
            toast.error(`Puntos insuficientes. Solo dispone de ${availablePoints.toFixed(2)} pts.`);
            return;
        }

        try {
            setProcessing(true);
            const res = await api.post(`/customers/${customer.id}/redeem-points`, {
                pointsToRedeem: numPoints,
                mode,
                pointValueUsd
            });
            toast.success(res.data.message || 'Puntos canjeados con éxito');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error redeeming points:', error);
            toast.error(error.response?.data?.error || 'Error al canjear puntos');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <BaseModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg">
            <div className="relative bg-slate-900 text-white rounded-xl p-4 sm:p-6 border border-slate-800 shadow-2xl overflow-y-auto max-h-[92dvh] pb-safe">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                            <Zap size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg sm:text-xl font-bold uppercase tracking-tight text-white">Canjear Puntos</h2>
                            <p className="text-xs text-slate-400 font-medium truncate max-w-[200px] sm:max-w-xs">{customer.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors shrink-0 cursor-pointer">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6 pt-5 sm:pt-6">
                    {/* Points Balance Overview */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-950/60 rounded-xl p-4 border border-slate-800">
                        <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Puntos Disponibles</span>
                            <div className="text-xl sm:text-2xl font-bold text-amber-400 tracking-tight mt-1">
                                {availablePoints.toFixed(2)} <span className="text-xs text-slate-400">pts</span>
                            </div>
                        </div>
                        <div className="border-l border-slate-800 pl-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Deuda Actual</span>
                            <div className={`text-xl sm:text-2xl font-bold tracking-tight mt-1 ${currentDebt > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {formatMoney(currentDebt, 'USD')}
                            </div>
                        </div>
                    </div>

                    {/* Quantity Input */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Puntos a Canjear</label>
                            <button
                                type="button"
                                onClick={() => setPointsToRedeem(String(availablePoints))}
                                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-primary-400 hover:text-primary-300 py-1 px-2 rounded transition-colors cursor-pointer"
                            >
                                Usar Todos ({availablePoints.toFixed(2)})
                            </button>
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                step="any"
                                min="0.01"
                                max={availablePoints}
                                value={pointsToRedeem}
                                onChange={(e) => setPointsToRedeem(e.target.value)}
                                placeholder="0.00"
                                required
                                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg py-2.5 px-4 text-lg font-bold text-white focus:outline-none tracking-tight h-11"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                = ${calculatedUsd} USD
                            </div>
                        </div>
                    </div>

                    {/* Mode Selection */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Destino del Canje</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setMode('debt_reduction')}
                                className={`p-3.5 sm:p-3 rounded-xl text-left border transition-colors cursor-pointer ${
                                    mode === 'debt_reduction' 
                                    ? 'bg-emerald-500/10 border-emerald-500/40 text-white' 
                                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                                }`}
                            >
                                <div className="text-xs font-bold uppercase tracking-wide">Abonar a Deuda</div>
                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">Rebaja el saldo deudor de la cuenta</p>
                            </button>

                            <button
                                type="button"
                                onClick={() => setMode('credit_coupon')}
                                className={`p-3.5 sm:p-3 rounded-xl text-left border transition-colors cursor-pointer ${
                                    mode === 'credit_coupon' 
                                    ? 'bg-amber-500/10 border-amber-500/40 text-white' 
                                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white'
                                }`}
                            >
                                <div className="text-xs font-bold uppercase tracking-wide">Saldo a Favor</div>
                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">Disponible para compras futuras</p>
                            </button>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={processing || numPoints <= 0 || numPoints > availablePoints}
                        className="w-full h-11 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {processing ? 'Procesando Canje...' : `Confirmar Canje por $${calculatedUsd} USD`}
                    </button>
                </form>
            </div>
        </BaseModal>
    );
}
