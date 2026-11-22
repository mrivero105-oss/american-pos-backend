import { useState, useEffect } from 'react';
import {
    Banknote, 
    Plus, 
    ChevronUp, 
    ChevronDown, 
    Trash2, 
    Save, 
    RefreshCcw, 
    CreditCard, 
    Send, 
    DollarSign, 
    User, 
    QrCode, 
    Wallet, 
    Building2, 
    CheckCircle2, 
    Hash, 
    ShieldCheck, 
    SlidersHorizontal, 
    Smartphone, 
    Upload, 
    Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { generateBinanceQR, buildBinancePayString } from '../../utils/binanceQR';
import { isDollarOnlyCountry } from '../../utils/format';
import { 
    VENEZUELAN_BANKS, 
    cleanPhone, 
    cleanIdNumber, 
    formatPhoneDisplay, 
    formatIdDisplay, 
    generatePagoMovilQR, 
    buildPagoMovilString,
    getBankNameByCode 
} from '../../utils/pagoMovilQR';

function PagoMovilLivePreview({ method }) {
    const [qrUrl, setQrUrl] = useState('');
    const bank = method.pagoMovilBank || '';
    const phone = cleanPhone(method.pagoMovilPhone || '');
    const id = cleanIdNumber(method.pagoMovilId || '');
    const mode = method.pagoMovilQrMode || 'AUTO';
    const customImg = method.pagoMovilQrImage || '';
    const includeAmount = method.pagoMovilIncludeAmount !== false;

    useEffect(() => {
        let isMounted = true;
        if (mode === 'IMAGE' && customImg) {
            setQrUrl(customImg);
            return;
        }
        if (bank && phone && id) {
            generatePagoMovilQR({
                bankCode: bank,
                phone: phone,
                idNumber: id,
                amountBs: includeAmount ? 150.00 : 0,
                customImage: customImg,
                mode: mode,
                includeAmount: includeAmount
            }).then(url => {
                if (isMounted) setQrUrl(url || '');
            });
        } else {
            setQrUrl('');
        }
        return () => { isMounted = false; };
    }, [bank, phone, id, mode, customImg, includeAmount]);

    const payload = mode === 'AUTO' && bank && phone && id
        ? buildPagoMovilString({ bankCode: bank, phone, idNumber: id, amountBs: includeAmount ? 150.00 : 0, includeAmount })
        : '';

    return (
        <div className="mt-3 p-3.5 bg-white dark:bg-slate-800/90 rounded-xl border border-purple-200 dark:border-purple-800/40 flex flex-col sm:flex-row items-center gap-4 shadow-2xs">
            <div className="p-2 bg-white rounded-xl border border-slate-200 shrink-0 shadow-xs flex items-center justify-center">
                {qrUrl ? (
                    <img src={qrUrl} alt="Vista previa QR" className="w-28 h-28 object-contain rounded" />
                ) : (
                    <div className="w-28 h-28 flex flex-col items-center justify-center text-slate-500 text-[10px] text-center p-2">
                        <Smartphone size={24} className="mb-1 text-slate-400" />
                        <span>Completa banco, teléfono y cédula para generar el QR</span>
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0 text-left space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={13} />
                        Vista Previa en Vivo (Cliente)
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono">
                        {mode === 'IMAGE' ? 'Afiche Oficial' : (includeAmount ? 'QR con Monto' : 'QR Solo Datos')}
                    </span>
                </div>
                <div className="text-xs text-slate-900 dark:text-white font-bold flex flex-wrap gap-x-4 gap-y-1">
                    {bank && <span>🏦 {getBankNameByCode(bank)}</span>}
                    {phone && <span className="font-mono">📞 {formatPhoneDisplay(phone)}</span>}
                    {id && <span className="font-mono">🪪 {formatIdDisplay(id)}</span>}
                </div>
                {payload && (
                    <div className="mt-1 font-mono text-[9px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-slate-900 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800/40 break-all select-all">
                        {payload}
                    </div>
                )}
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    💡 Puedes apuntar la cámara de tu teléfono a este cuadro ahora mismo para verificar la lectura con tu banco.
                </p>
            </div>
        </div>
    );
}


function BinancePayLivePreview({ method }) {
    const [qrUrl, setQrUrl] = useState('');
    const payId = method.binancePayId || '';
    const email = method.binanceEmail || '';
    const mode = method.binanceQrMode || (method.binanceQrImage ? 'IMAGE' : 'AUTO');
    const customImg = method.binanceQrImage || '';

    useEffect(() => {
        let isMounted = true;
        if (mode === 'IMAGE' && customImg) {
            setQrUrl(customImg);
            return;
        }
        if (payId || email || customImg) {
            generateBinanceQR({
                payId,
                email,
                amountUsdt: 10.00,
                customImage: customImg,
                mode
            }).then(url => {
                if (isMounted) setQrUrl(url || customImg || '');
            });
        } else {
            setQrUrl('');
        }
        return () => { isMounted = false; };
    }, [payId, email, mode, customImg]);

    const payload = buildBinancePayString({ payId, email, amountUsdt: 10.00 });

    return (
        <div className="mt-3 p-3.5 bg-white dark:bg-slate-800/90 rounded-xl border border-amber-200 dark:border-amber-800/40 flex flex-col sm:flex-row items-center gap-4 shadow-2xs">
            <div className="p-2 bg-white rounded-xl border border-slate-200 shrink-0 shadow-xs flex items-center justify-center">
                {qrUrl ? (
                    <img src={qrUrl} alt="Vista previa QR Binance" className="w-28 h-28 object-contain rounded" />
                ) : (
                    <div className="w-28 h-28 flex flex-col items-center justify-center text-slate-500 text-[10px] text-center p-2">
                        <Wallet size={24} className="mb-1 text-amber-500" />
                        <span>Completa Pay ID o correo para generar el QR</span>
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0 text-left space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <CheckCircle2 size={13} />
                        QR Binance Pay Oficial
                    </span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 font-mono">
                        {mode === 'IMAGE' ? 'Afiche Oficial' : 'QR Generado Auto'}
                    </span>
                </div>
                <div className="text-xs text-slate-900 dark:text-white font-bold flex flex-wrap gap-x-4 gap-y-1">
                    {payId && <span className="font-mono">🆔 Pay ID: {payId}</span>}
                    {email && <span className="font-mono">📧 {email}</span>}
                    {method.binanceRate > 0 && <span className="text-emerald-600 font-mono">💵 Tasa: {Number(method.binanceRate).toFixed(2)} Bs/USDT</span>}
                </div>
                {payload && (
                    <div className="mt-1 font-mono text-[9px] text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-slate-900 p-2 rounded-lg border border-amber-200 dark:border-amber-800/40 break-all select-all">
                        {payload}
                    </div>
                )}
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    💡 El cliente puede escanear este código directamente desde su app de Binance para transferir sin comisiones.
                </p>
            </div>
        </div>
    );
}

function BinancePaySettingsBlock({ method, updatePaymentMethod, onSave, saving }) {
    const [fetchingRate, setFetchingRate] = useState(false);

    const handleFetchRate = async () => {
        try {
            setFetchingRate(true);
            const { data } = await api.get('/settings/binance/rate');
            if (data?.success && data?.rate > 0) {
                updatePaymentMethod(method.id, 'binanceRate', data.rate);
                toast.success(`Tasa Binance P2P actualizada: Bs. ${Number(data.rate).toFixed(2)}`);
            } else {
                toast.error('No se pudo obtener la tasa P2P en este momento.');
            }
        } catch (err) {
            console.error('Error al consultar tasa Binance:', err);
            toast.error(err.response?.data?.error || 'Error al conectar con el servicio P2P.');
        } finally {
            setFetchingRate(false);
        }
    };

    return (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 bg-amber-50/40 dark:bg-amber-950/20 p-4 sm:p-5 rounded-xl border border-amber-200 dark:border-amber-800/40 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0 border border-amber-200 dark:border-amber-800/60">
                        <Wallet size={16} />
                    </div>
                    <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            Configuración Binance Pay (USDT)
                            <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-semibold">
                                Cripto / P2P
                            </span>
                        </span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Gestión de tasa USDT/Bs, Pay ID, QR del comercio y reglas fiscales de cobro.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
                    <button
                        type="button"
                        onClick={() => updatePaymentMethod(method.id, 'binanceQrMode', 'AUTO')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                            (method.binanceQrMode || 'AUTO') === 'AUTO'
                                ? 'bg-amber-600 text-white shadow-2xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        QR Auto
                    </button>
                    <button
                        type="button"
                        onClick={() => updatePaymentMethod(method.id, 'binanceQrMode', 'IMAGE')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                            method.binanceQrMode === 'IMAGE'
                                ? 'bg-amber-600 text-white shadow-2xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        Subir Imagen QR
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                {/* 1. Tasa de Liquidación USDT con botón de consulta P2P */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                        <span>Tasa USDT (Bs/USDT)</span>
                        <button
                            type="button"
                            onClick={handleFetchRate}
                            disabled={fetchingRate}
                            className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Consultar tasa P2P en tiempo real"
                        >
                            <RefreshCcw size={11} className={fetchingRate ? 'animate-spin' : ''} />
                            <span>{fetchingRate ? 'Consultando...' : 'Consultar P2P'}</span>
                        </button>
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            step="0.01"
                            value={method.binanceRate || ''}
                            onChange={(e) => updatePaymentMethod(method.id, 'binanceRate', parseFloat(e.target.value) || 0)}
                            placeholder="Ej: 100.45"
                            className="w-full px-3 py-2 text-xs font-mono font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-amber-500 transition-colors"
                        />
                        <span className="absolute right-3 top-2 text-[10px] text-slate-400 font-mono">Bs/USDT</span>
                    </div>
                </div>

                {/* 2. Binance Pay ID */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                        <span>Binance Pay ID</span>
                        <span className="text-[10px] text-slate-400 font-mono">App Binance</span>
                    </label>
                    <input
                        type="text"
                        value={method.binancePayId || ''}
                        onChange={(e) => updatePaymentMethod(method.id, 'binancePayId', e.target.value.trim())}
                        placeholder="Ej: 849201948"
                        className="w-full px-3 py-2 text-xs font-mono font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-amber-500 transition-colors"
                    />
                </div>

                {/* 3. Correo de Binance */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                        <span>Correo Cuenta Binance</span>
                    </label>
                    <input
                        type="email"
                        value={method.binanceEmail || ''}
                        onChange={(e) => updatePaymentMethod(method.id, 'binanceEmail', e.target.value.trim())}
                        placeholder="Ej: pagos@mitienda.com"
                        className="w-full px-3 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-amber-500 transition-colors"
                    />
                </div>
            </div>

            {/* Configuración Fiscal & Redondeo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Switch IGTF 3% */}
                <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="pr-2">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                            Aplicar IGTF (3%) a Binance
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            Desactivado por defecto. Active sólo si su negocio es Contribuyente Especial (Sujeto Pasivo Especial).
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => updatePaymentMethod(method.id, 'binanceIgtfEnabled', !method.binanceIgtfEnabled)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                            method.binanceIgtfEnabled
                                ? 'bg-amber-600 text-white shadow-2xs'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                        }`}
                    >
                        {method.binanceIgtfEnabled ? '✓ IGTF 3% Activo' : 'Exento (0% IGTF)'}
                    </button>
                </div>

                {/* Margen de Tolerancia de Redondeo */}
                <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="pr-2">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                            Tolerancia de Redondeo
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            Margen en Bs que el sistema absorbe para evitar bloqueos por céntimos.
                        </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <input
                            type="number"
                            step="0.05"
                            value={method.binanceRoundingToleranceBs ?? 0.50}
                            onChange={(e) => updatePaymentMethod(method.id, 'binanceRoundingToleranceBs', parseFloat(e.target.value) || 0)}
                            className="w-16 px-2 py-1 text-xs font-mono font-bold text-center bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                        />
                        <span className="text-xs text-slate-500 font-bold">Bs</span>
                    </div>
                </div>
            </div>

            {/* Blindaje Fiscal SENIAT - Nombre en Ticket */}
            <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <ShieldCheck size={14} className="text-emerald-500" />
                            Nombre en Ticket / Factura (Blindaje Fiscal SENIAT)
                        </span>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            En Venezuela, las facturas y comprobantes no deben contener marcas de criptoactivos. Se imprimirá bajo este concepto legal autorizado.
                        </p>
                    </div>
                    <div className="w-full sm:w-56 shrink-0">
                        <input
                            type="text"
                            value={method.receiptLabel || 'PAGO ELECTRÓNICO'}
                            onChange={(e) => updatePaymentMethod(method.id, 'receiptLabel', e.target.value)}
                            placeholder="Ej: PAGO ELECTRÓNICO"
                            className="w-full px-3 py-1.5 text-xs font-bold uppercase bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none focus:border-emerald-500"
                        />
                    </div>
                </div>
            </div>

            {/* Subida de Imagen QR si modo es IMAGE */}
            {method.binanceQrMode === 'IMAGE' && (
                <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800/80 p-3.5 rounded-xl border border-dashed border-amber-300 dark:border-amber-700">
                    <div className="flex items-center gap-3">
                        {method.binanceQrImage ? (
                            <img 
                                src={method.binanceQrImage} 
                                alt="QR Binance Pay" 
                                className="w-16 h-16 object-contain rounded-lg bg-white p-1 border border-slate-200 shadow-2xs"
                            />
                        ) : (
                            <div className="w-16 h-16 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                <ImageIcon size={22} />
                            </div>
                        )}
                        <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">Imagen Oficial de Binance Pay</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Sube la captura de tu código QR generado en la app de Binance.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="cursor-pointer px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs">
                            <Upload size={13} />
                            <span>{method.binanceQrImage ? 'Cambiar Imagen' : 'Subir Imagen'}</span>
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        updatePaymentMethod(method.id, 'binanceQrImage', reader.result);
                                    };
                                    reader.readAsDataURL(file);
                                }}
                            />
                        </label>
                        {method.binanceQrImage && (
                            <button
                                type="button"
                                onClick={() => updatePaymentMethod(method.id, 'binanceQrImage', '')}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                title="Eliminar imagen"
                            >
                                <Trash2 size={15} />
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Vista Previa en Vivo */}
            <BinancePayLivePreview method={method} />

            {/* Barra de Guardado Inmediato de esta tarjeta */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-amber-200 dark:border-amber-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    🔒 Los datos de Binance Pay se sincronizan con la pantalla de cobro del cajero y el visor del cliente.
                </div>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                >
                    {saving ? (
                        <RefreshCcw size={14} className="animate-spin" />
                    ) : (
                        <Save size={14} />
                    )}
                    <span>Guardar Configuración Binance</span>
                </button>
            </div>
        </div>
    );
}

export default function PaymentMethodSettings({ 
    paymentMethods = [], 
    addPaymentMethod, 
    updatePaymentMethod, 
    removePaymentMethod, 
    movePaymentMethod, 
    saving, 
    onSave,
    country
}) {
    const isDollarCountry = isDollarOnlyCountry(country || localStorage.getItem('pos_country'));
    // Estado para colapsar/desplegar el MÓDULO COMPLETO de Métodos de Pago
    const [isSectionOpen, setIsSectionOpen] = useState(true);
    // Estado para controlar qué métodos de pago están desplegados individualmente
    const [expandedIds, setExpandedIds] = useState({});

    const toggleExpand = (id) => {
        setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const expandAll = () => {
        const all = {};
        paymentMethods.forEach(m => { all[m.id] = true; });
        setExpandedIds(all);
    };

    const collapseAll = () => {
        setExpandedIds({});
    };

    const handleAddMethod = () => {
        setIsSectionOpen(true);
        if (typeof addPaymentMethod === 'function') {
            addPaymentMethod();
            // Desplegar automáticamente el último recién agregado al siguiente tick
            setTimeout(() => {
                const last = paymentMethods[paymentMethods.length - 1];
                if (last) {
                    setExpandedIds(prev => ({ ...prev, [last.id]: true }));
                }
            }, 100);
        }
    };

    const iconList = [
        { id: 'Banknote', label: 'Efectivo / Billete', icon: Banknote },
        { id: 'CreditCard', label: 'Tarjeta / Punto', icon: CreditCard },
        { id: 'Send', label: isDollarCountry ? 'Transferencia / Envíos' : 'Pago Móvil / Envíos', icon: Send },
        { id: 'DollarSign', label: 'Divisas / Dólar', icon: DollarSign },
        { id: 'User', label: 'Cliente / Crédito', icon: User },
        { id: 'QrCode', label: 'Código QR / Digital', icon: QrCode },
        { id: 'Wallet', label: 'Billetera Digital', icon: Wallet },
        { id: 'Building2', label: 'Banco / Transferencia', icon: Building2 },
    ];

    const IconComponent = ({ name, size = 20, className = "" }) => {
        const found = iconList.find(i => i.id === name);
        const Comp = found ? found.icon : CreditCard;
        return <Comp size={size} className={className} />;
    };

    const getTypeBadgeClass = (type) => {
        switch (type) {
            case 'CASH':
                return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60';
            case 'DIGITAL':
                return 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-800/60';
            case 'CREDIT':
                return 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60';
            default:
                return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
        }
    };

    const getTypeLabel = (type) => {
        switch (type) {
            case 'CASH': return '💵 EFECTIVO';
            case 'DIGITAL': return '💳 DIGITAL';
            case 'CREDIT': return '👤 CRÉDITO';
            default: return type;
        }
    };

    const getCurrencyLabel = (curr) => {
        switch (curr) {
            case 'USD': return '🇺🇸 USD';
            case 'VES': return '🇻🇪 VES';
            case 'COP': return '🇨🇴 COP';
            case 'USDT': return '🪙 USDT';
            default: return curr || 'USD';
        }
    };

    const cashCount = paymentMethods.filter(m => m.type === 'CASH').length;
    const digitalCount = paymentMethods.filter(m => m.type === 'DIGITAL').length;
    const creditCount = paymentMethods.filter(m => m.type === 'CREDIT').length;

    return (
        <div className="xl:col-span-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs font-sans transition-colors">
            {/* Header Principal del Módulo (Clickeable para plegar/desplegar todo el módulo) */}
            <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${isSectionOpen ? 'mb-5 pb-4 border-b border-slate-200 dark:border-slate-800' : ''}`}>
                <div 
                    onClick={() => setIsSectionOpen(!isSectionOpen)}
                    className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0 select-none"
                >
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <Banknote size={20} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2 flex-wrap">
                            Métodos de Pago
                            <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 rounded-md border border-emerald-200 dark:border-emerald-800/60 whitespace-nowrap">
                                {paymentMethods.length} Configurados
                            </span>
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-normal mt-0.5 truncate">
                            Gestione, ordene y personalice las opciones de cobro disponibles en caja
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                        type="button"
                        onClick={handleAddMethod}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                        <Plus size={16} />
                        <span>Agregar Método</span>
                    </button>

                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="px-3.5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                        {saving ? (
                            <RefreshCcw size={15} className="animate-spin" />
                        ) : (
                            <Save size={15} />
                        )}
                        <span>Guardar</span>
                    </button>

                    {/* Botón Plegar / Desplegar Módulo */}
                    <button
                        type="button"
                        onClick={() => setIsSectionOpen(!isSectionOpen)}
                        className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
                        title={isSectionOpen ? 'Ocultar Lista de Métodos' : 'Mostrar Lista de Métodos'}
                    >
                        <ChevronDown size={18} className={`transition-transform duration-200 ${isSectionOpen ? 'rotate-180' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Contenido Completo del Módulo (Desplegable) */}
            <AnimatePresence initial={false}>
                {isSectionOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                    >

            {/* Bar de Resumen Métodos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                <div className="bg-slate-50 dark:bg-slate-800/80 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between min-w-0">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate mr-2">Total Métodos</span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white font-mono shrink-0">{paymentMethods.length}</span>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between min-w-0">
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 truncate mr-2">Efectivo</span>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 font-mono shrink-0">{cashCount}</span>
                </div>
                <div className="bg-primary-50 dark:bg-primary-950/40 px-3.5 py-2.5 rounded-xl border border-primary-200 dark:border-primary-800/60 flex items-center justify-between min-w-0">
                    <span className="text-[11px] font-semibold text-primary-700 dark:text-primary-300 truncate mr-2">Digitales</span>
                    <span className="text-xs font-bold text-primary-700 dark:text-primary-300 font-mono shrink-0">{digitalCount}</span>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950/40 px-3.5 py-2.5 rounded-xl border border-purple-200 dark:border-purple-800/60 flex items-center justify-between min-w-0">
                    <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 truncate mr-2">Crédito</span>
                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 font-mono shrink-0">{creditCount}</span>
                </div>
            </div>

            {/* Barra de Controles de Acordeón Plegar / Expandir Todos */}
            <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal size={14} className="text-primary-600 dark:text-primary-400" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Opciones de Cobro Disponibles
                    </span>
                </div>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
                    <button
                        type="button"
                        onClick={expandAll}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors hover:bg-white dark:hover:bg-slate-700 rounded-lg cursor-pointer"
                    >
                        Expandir Todos
                    </button>
                    <span className="text-slate-300 dark:text-slate-600 text-xs">|</span>
                    <button
                        type="button"
                        onClick={collapseAll}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors hover:bg-white dark:hover:bg-slate-700 rounded-lg cursor-pointer"
                    >
                        Plegar Todos
                    </button>
                </div>
            </div>

            {/* Lista Acordeón Desplegable de Métodos de Pago */}
            <div className="space-y-3">
                {paymentMethods.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                        <Banknote size={40} className="mx-auto text-slate-400 mb-2" />
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No hay métodos de pago registrados</p>
                        <p className="text-xs text-slate-500 mt-0.5">Haz clic en &ldquo;Agregar Método&rdquo; para crear uno nuevo.</p>
                    </div>
                ) : (
                    paymentMethods.map((method, index) => {
                        const currentCurrency = method.currency || method.defaultCurrency || 'USD';
                        const currentType = method.type || 'DIGITAL';
                        const isExpanded = !!expandedIds[method.id];

                        return (
                            <motion.div
                                key={method.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className={`border transition-colors rounded-xl overflow-hidden shadow-2xs ${
                                    isExpanded 
                                        ? 'border-primary-500 bg-white dark:bg-slate-850 ring-1 ring-primary-500/20' 
                                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                {/* Barra Superior Plegada (Header Clickeable para desplegar) */}
                                <div className="p-3.5 sm:p-4 flex items-center gap-3 select-none">
                                    {/* Botones de Reordenamiento */}
                                    <div className="flex flex-col items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            type="button"
                                            onClick={() => movePaymentMethod(index, 'up')}
                                            disabled={index === 0}
                                            className="p-0.5 text-slate-500 hover:text-primary-600 disabled:opacity-20 disabled:hover:text-slate-400 transition-colors cursor-pointer"
                                            title="Mover arriba"
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 leading-none my-0.5">
                                            #{index + 1}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => movePaymentMethod(index, 'down')}
                                            disabled={index === paymentMethods.length - 1}
                                            className="p-0.5 text-slate-500 hover:text-primary-600 disabled:opacity-20 disabled:hover:text-slate-400 transition-colors cursor-pointer"
                                            title="Mover abajo"
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>

                                    {/* Icono Principal */}
                                    <div 
                                        onClick={() => toggleExpand(method.id)}
                                        className={`p-2.5 rounded-xl border shrink-0 transition-transform cursor-pointer ${getTypeBadgeClass(currentType)}`}
                                    >
                                        <IconComponent name={method.icon} size={18} />
                                    </div>

                                    {/* Título e Insignias (Área desplegable) */}
                                    <div 
                                        onClick={() => toggleExpand(method.id)}
                                        className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                                    >
                                        <div className="min-w-0">
                                            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                                                {method.name || 'Sin Nombre'}
                                            </h3>
                                        </div>

                                        {/* Insignias de Resumen Visible cuando está plegado */}
                                        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${getTypeBadgeClass(currentType)}`}>
                                                {getTypeLabel(currentType)}
                                            </span>
                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60">
                                                {getCurrencyLabel(currentCurrency)}
                                            </span>
                                            {method.requiresReference && (
                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 flex items-center gap-1">
                                                    <Hash size={11} /> Ref.
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Botón Flecha Desplegable + Eliminar */}
                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                        <button
                                            type="button"
                                            onClick={() => toggleExpand(method.id)}
                                            className={`p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white rounded-lg transition-colors cursor-pointer ${isExpanded ? 'bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 rotate-180' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                            title={isExpanded ? 'Plegar' : 'Desplegar / Editar'}
                                        >
                                            <ChevronDown size={16} className="transition-transform duration-200" />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removePaymentMethod(method.id);
                                            }}
                                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                            title="Eliminar método"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>

                                {/* Contenido Desplegable (Opciones de Edición) */}
                                <AnimatePresence initial={false}>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                                        >
                                            <div className="p-4 sm:p-5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-700 space-y-4">
                                                {/* Nombre Completo Edición */}
                                                <div>
                                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                                        Nombre Visible en POS
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={method.name}
                                                        onChange={(e) => updatePaymentMethod(method.id, 'name', e.target.value)}
                                                        placeholder={isDollarCountry ? "Ej: Efectivo USD, DeUna, Tarjeta, Transferencia..." : "Ej: Pago Móvil, Punto Banesco, Zelle..."}
                                                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 focus:border-primary-500 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-900 dark:text-white outline-none transition-colors placeholder:text-slate-400"
                                                    />
                                                </div>

                                                {/* Controles de Configuración en Grilla */}
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                                                    {/* 1. Categoría / Tipo */}
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            Categoría / Tipo
                                                        </span>
                                                        <select
                                                            value={currentType}
                                                            onChange={(e) => updatePaymentMethod(method.id, 'type', e.target.value)}
                                                            className="w-full px-3 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-primary-500 transition-colors cursor-pointer"
                                                        >
                                                            <option value="CASH">💵 Efectivo</option>
                                                            <option value="DIGITAL">{isDollarCountry ? '💳 Digital (Tarjeta / Red)' : '💳 Digital (Punto / Móvil)'}</option>
                                                            <option value="CREDIT">👤 Crédito (Fiado)</option>
                                                        </select>
                                                    </div>

                                                    {/* 2. Moneda Base */}
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            Moneda Base
                                                        </span>
                                                        <select
                                                            value={currentCurrency}
                                                            onChange={(e) => updatePaymentMethod(method.id, 'currency', e.target.value)}
                                                            className="w-full px-3 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-primary-500 transition-colors cursor-pointer"
                                                        >
                                                            <option value="USD">🇺🇸 USD ($)</option>
                                                            {!isDollarCountry && (
                                                                <>
                                                                    <option value="VES">🇻🇪 VES (Bs)</option>
                                                                    <option value="COP">🇨🇴 COP ($)</option>
                                                                    <option value="USDT">🪙 USDT (Binance Pay)</option>
                                                                </>
                                                            )}
                                                        </select>
                                                    </div>

                                                    {/* 3. Selección de Icono */}
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                            Icono
                                                        </span>
                                                        <select
                                                            value={method.icon || 'CreditCard'}
                                                            onChange={(e) => updatePaymentMethod(method.id, 'icon', e.target.value)}
                                                            className="w-full px-3 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-primary-500 transition-colors cursor-pointer"
                                                        >
                                                            {iconList.map(i => (
                                                                <option key={i.id} value={i.id}>
                                                                    {i.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* 4. Opción: Requerir Nº de Referencia */}
                                                    <div className="flex flex-col justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => updatePaymentMethod(method.id, 'requiresReference', !method.requiresReference)}
                                                            className={`w-full px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                                                                method.requiresReference
                                                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                                                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                                                            }`}
                                                        >
                                                            <span className="flex items-center gap-1.5 text-xs">
                                                                <Hash size={13} />
                                                                Requerir Referencia
                                                            </span>
                                                            <div className={`w-4 h-4 rounded-full flex items-center justify-center ${method.requiresReference ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                                                                {method.requiresReference && <CheckCircle2 size={11} strokeWidth={2.5} />}
                                                            </div>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Sección Específica: Datos Bancarios & Código QR (Pago Móvil) */}
                                                {!isDollarCountry && (
                                                    currentCurrency === 'VES' || 
                                                    currentType === 'DIGITAL' || 
                                                    (method.id || '').toLowerCase().includes('movil') || 
                                                    (method.name || '').toLowerCase().includes('movil') || 
                                                    (method.name || '').toLowerCase().includes('móvil')
                                                ) && (
                                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 bg-purple-50/40 dark:bg-purple-950/20 p-4 sm:p-5 rounded-xl border border-purple-200 dark:border-purple-800/40 space-y-3">
                                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0 border border-purple-200 dark:border-purple-800/60">
                                                                    <Smartphone size={16} />
                                                                </div>
                                                                <div>
                                                                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                                        Datos Bancarios & Código QR (Pago Móvil)
                                                                    </span>
                                                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                                        Genera el QR para cobro en el visor de clientes y en la caja registradora.
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updatePaymentMethod(method.id, 'pagoMovilQrMode', 'AUTO')}
                                                                    className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                                                                        (method.pagoMovilQrMode || 'AUTO') === 'AUTO'
                                                                            ? 'bg-purple-600 text-white shadow-2xs'
                                                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                                    }`}
                                                                >
                                                                    QR Dinámico Auto
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updatePaymentMethod(method.id, 'pagoMovilQrMode', 'IMAGE')}
                                                                    className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                                                                        method.pagoMovilQrMode === 'IMAGE'
                                                                            ? 'bg-purple-600 text-white shadow-2xs'
                                                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                                    }`}
                                                                >
                                                                    Subir Imagen QR
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                                                            {/* Banco Receptor */}
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                                                    <span>Banco Receptor</span>
                                                                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">SUDEBAN</span>
                                                                </label>
                                                                <select
                                                                    value={method.pagoMovilBank || ''}
                                                                    onChange={(e) => updatePaymentMethod(method.id, 'pagoMovilBank', e.target.value)}
                                                                    className="w-full px-3 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-purple-500 transition-colors cursor-pointer"
                                                                >
                                                                    <option value="">-- Seleccionar Banco --</option>
                                                                    {VENEZUELAN_BANKS.map(b => (
                                                                        <option key={b.code} value={b.code}>
                                                                            {b.code} - {b.name}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Teléfono Receptor */}
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                                                    <span>Teléfono Pago Móvil</span>
                                                                    {method.pagoMovilPhone && (
                                                                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                                                                            {formatPhoneDisplay(cleanPhone(method.pagoMovilPhone))}
                                                                        </span>
                                                                    )}
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={method.pagoMovilPhone || ''}
                                                                    onChange={(e) => updatePaymentMethod(method.id, 'pagoMovilPhone', e.target.value)}
                                                                    placeholder="Ej: 04248302226"
                                                                    className="w-full px-3 py-2 text-xs font-mono font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-purple-500 transition-colors"
                                                                />
                                                            </div>

                                                            {/* Cédula / RIF */}
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                                                                    <span>Cédula o RIF</span>
                                                                    {method.pagoMovilId && (
                                                                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                                                                            {formatIdDisplay(cleanIdNumber(method.pagoMovilId))}
                                                                        </span>
                                                                    )}
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={method.pagoMovilId || ''}
                                                                    onChange={(e) => updatePaymentMethod(method.id, 'pagoMovilId', e.target.value.toUpperCase())}
                                                                    placeholder="Ej: V-22650692 o J-123456789"
                                                                    className="w-full px-3 py-2 text-xs font-mono font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white outline-none focus:border-purple-500 transition-colors uppercase"
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* Opción de Monto en el QR (Para modo AUTO) */}
                                                        {method.pagoMovilQrMode !== 'IMAGE' && (
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                                                                <div>
                                                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                                                                        ¿Incluir monto dinámico de la venta dentro del QR?
                                                                    </span>
                                                                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                                        {method.pagoMovilIncludeAmount === false
                                                                            ? 'Solo codifica banco, teléfono y cédula. El cliente introduce el monto manualmente en su app bancaria.'
                                                                            : 'Calcula y coloca el monto exacto en Bs en el QR para que el cliente no tenga que escribir el monto.'}
                                                                    </p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updatePaymentMethod(method.id, 'pagoMovilIncludeAmount', method.pagoMovilIncludeAmount === false ? true : false)}
                                                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                                                                        method.pagoMovilIncludeAmount !== false
                                                                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                                                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:text-slate-900'
                                                                    }`}
                                                                >
                                                                    {method.pagoMovilIncludeAmount !== false ? '✓ Con Monto en QR' : 'Sin Monto (Solo Datos)'}
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Subida de Imagen QR si modo es IMAGE */}
                                                        {method.pagoMovilQrMode === 'IMAGE' && (
                                                            <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800/80 p-3.5 rounded-xl border border-dashed border-purple-300 dark:border-purple-700">
                                                                <div className="flex items-center gap-3">
                                                                    {method.pagoMovilQrImage ? (
                                                                        <img 
                                                                            src={method.pagoMovilQrImage} 
                                                                            alt="QR Banco" 
                                                                            className="w-16 h-16 object-contain rounded-lg bg-white p-1 border border-slate-200 shadow-2xs"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-16 h-16 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 flex items-center justify-center text-purple-600 dark:text-purple-400">
                                                                            <ImageIcon size={22} />
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <p className="text-xs font-bold text-slate-900 dark:text-white">Imagen de Código QR Oficial del Banco</p>
                                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Sube la captura de &apos;Mi QR&apos; o tu afiche de Pago Móvil provisto por tu banco.</p>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <label className="cursor-pointer px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs">
                                                                        <Upload size={13} />
                                                                        <span>{method.pagoMovilQrImage ? 'Cambiar Imagen' : 'Subir Imagen'}</span>
                                                                        <input
                                                                            type="file"
                                                                            accept="image/*"
                                                                            className="hidden"
                                                                            onChange={(e) => {
                                                                                const file = e.target.files?.[0];
                                                                                if (!file) return;
                                                                                const reader = new FileReader();
                                                                                reader.onload = () => {
                                                                                    updatePaymentMethod(method.id, 'pagoMovilQrImage', reader.result);
                                                                                };
                                                                                reader.readAsDataURL(file);
                                                                            }}
                                                                        />
                                                                    </label>
                                                                    {method.pagoMovilQrImage && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => updatePaymentMethod(method.id, 'pagoMovilQrImage', '')}
                                                                            className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                                                            title="Eliminar imagen"
                                                                        >
                                                                            <Trash2 size={15} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Vista Previa en Vivo y Verificador de QR */}
                                                        <PagoMovilLivePreview method={method} />

                                                        {/* Barra de Guardado Inmediato de esta tarjeta */}
                                                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-purple-200 dark:border-purple-800/40">
                                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                                                🔒 Al guardar, estos datos se sincronizan con el visor del cliente (/display) y la caja registradora.
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={onSave}
                                                                disabled={saving}
                                                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer whitespace-nowrap"
                                                            >
                                                                {saving ? (
                                                                    <RefreshCcw size={14} className="animate-spin" />
                                                                ) : (
                                                                    <Save size={14} />
                                                                )}
                                                                <span>Guardar Datos de Pago Móvil</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Sección Específica: Configuración Binance Pay (USDT) */}
                                                {(
                                                    method.id === 'binance_usdt' || 
                                                    method.id === 'binance' || 
                                                    currentCurrency === 'USDT' || 
                                                    (method.name || '').toLowerCase().includes('binance') || 
                                                    (method.name || '').toLowerCase().includes('usdt')
                                                ) && (
                                                    <BinancePaySettingsBlock 
                                                        method={method} 
                                                        updatePaymentMethod={updatePaymentMethod}
                                                        onSave={onSave}
                                                        saving={saving}
                                                    />
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    })
                )}
            </div>

            {/* Footer con Botón de Guardado */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-5 border-t border-slate-200 dark:border-slate-800 mt-6">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                    <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <span>Los cambios guardados se reflejarán instantáneamente en la caja registradora.</span>
                </div>

                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving}
                    className="w-full sm:w-auto px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                    {saving ? (
                        <RefreshCcw size={15} className="animate-spin" />
                    ) : (
                        <Save size={15} />
                    )}
                    <span>Guardar Métodos de Pago</span>
                </button>
            </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

