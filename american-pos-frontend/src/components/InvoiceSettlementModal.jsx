import { useState, useEffect, useMemo } from 'react';
import {
    X,
    CheckCircle2,
    CreditCard,
    Building2,
    Calendar,
    DollarSign,
    AlertCircle,
    Boxes,
    FileText,
    Plus,
    Loader2,
    ArrowRight,
    Wallet,
    Clock,
    Layers,
    BadgePercent
} from 'lucide-react';

const formatSmartUsd = (val) => {
    const num = Number(val || 0);
    if (isNaN(num) || !isFinite(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatBs = (val) => {
    const num = Number(val || 0);
    if (isNaN(num) || !isFinite(num)) return '0,00';
    return num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function InvoiceSettlementModal({
    isOpen,
    onClose,
    onConfirm,
    isSaving,
    summary = {},
    suppliers = [],
    initialSupplierId = null
}) {
    if (!isOpen) return null;

    // Destino financiero: 'CREDIT' (Por Pagar) | 'PAID' (Contado) | 'INVENTORY_ONLY' (Solo Almacén)
    const [financialAction, setFinancialAction] = useState('CREDIT');

    // Gestión de Proveedor
    const [supplierMode, setSupplierMode] = useState('AUTO'); // 'AUTO' (crear nuevo detectado) | 'SELECT' (elegir existente)
    const [selectedSupplierId, setSelectedSupplierId] = useState(initialSupplierId || '');
    const [newSupplierName, setNewSupplierName] = useState(summary.detectedSupplierName || '');
    const [newSupplierRif, setNewSupplierRif] = useState(summary.detectedSupplierRif || '');

    // Crédito y Vencimiento
    const [creditDays, setCreditDays] = useState(15);
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');

    // Pago de Contado
    const [paymentMethod, setPaymentMethod] = useState('CASH_USD'); // 'CASH_USD' | 'TRANSFER_BS' | 'PAGO_MOVIL' | 'CASH_REGISTER'

    // Cálculo de fecha de vencimiento según días de crédito
    useEffect(() => {
        const baseDate = summary.invoiceDate ? new Date(summary.invoiceDate) : new Date();
        const targetDate = new Date(baseDate);
        targetDate.setDate(targetDate.getDate() + Number(creditDays || 0));
        setDueDate(targetDate.toISOString().split('T')[0]);
    }, [creditDays, summary.invoiceDate]);

    // Inicializar proveedor detectado
    useEffect(() => {
        if (initialSupplierId) {
            setSelectedSupplierId(initialSupplierId);
            setSupplierMode('SELECT');
        } else if (summary.detectedSupplierId) {
            setSelectedSupplierId(summary.detectedSupplierId);
            setSupplierMode('SELECT');
        } else if (summary.detectedSupplierName) {
            // Verificar si el proveedor ya existe por nombre o RIF
            const found = suppliers.find(s => {
                const sRif = (s.rif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                const dRif = (summary.detectedSupplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
                if (sRif && dRif && sRif === dRif) return true;
                const sName = (s.name || '').toLowerCase().trim();
                const dName = (summary.detectedSupplierName || '').toLowerCase().trim();
                return sName && dName && (sName.includes(dName) || dName.includes(sName));
            });
            if (found) {
                setSelectedSupplierId(found.id);
                setSupplierMode('SELECT');
            } else {
                setSupplierMode('AUTO');
                setNewSupplierName(summary.detectedSupplierName || '');
                setNewSupplierRif(summary.detectedSupplierRif || '');
            }
        }
    }, [initialSupplierId, summary.detectedSupplierId, summary.detectedSupplierName, summary.detectedSupplierRif, suppliers]);

    const handleQuickDays = (days) => {
        setCreditDays(days);
    };

    const handleConfirm = () => {
        const payload = {
            financialAction,
            supplierId: supplierMode === 'SELECT' ? (selectedSupplierId || null) : null,
            newSupplier: supplierMode === 'AUTO' && newSupplierName.trim() ? {
                name: newSupplierName.trim(),
                rif: newSupplierRif.trim() || null
            } : null,
            dueDate: financialAction === 'CREDIT' ? dueDate : null,
            creditDays: financialAction === 'CREDIT' ? creditDays : null,
            paymentMethod: financialAction === 'PAID' ? paymentMethod : null,
            notes: notes.trim() || null
        };
        onConfirm(payload);
    };

    const totalUsd = Number(summary.totalUsd || 0);
    const exchangeRate = Number(summary.exchangeRate || 1);
    const totalBs = Number(summary.totalBs || (totalUsd * exchangeRate));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary-600/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                            <Layers size={22} />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                                Asentamiento Contable y Financiero
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
                                    Recepción Fiscal
                                </span>
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Define el impacto financiero de esta factura antes de cargar existencias
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body con Scroll */}
                <div className="p-6 overflow-y-auto space-y-6">

                    {/* Resumen Superior en Tarjetas */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                <DollarSign size={13} className="text-emerald-500" />
                                <span>Total Factura</span>
                            </div>
                            <div className="text-lg font-black text-slate-900 dark:text-white font-mono">
                                ${formatSmartUsd(totalUsd)}
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 font-mono mt-0.5">
                                Bs. {formatBs(totalBs)}
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                <FileText size={13} className="text-primary-500" />
                                <span>Factura / Control</span>
                            </div>
                            <div className="text-sm font-bold text-slate-800 dark:text-white font-mono truncate">
                                {summary.referenceNumber || 'S/N (Sin Número)'}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                                <Calendar size={11} />
                                <span>{summary.invoiceDate || 'Fecha de hoy'}</span>
                            </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                <Boxes size={13} className="text-blue-500" />
                                <span>Entrada de Stock</span>
                            </div>
                            <div className="text-lg font-black text-blue-600 dark:text-blue-400 font-mono">
                                +{summary.totalUnits || 0} u.
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 mt-0.5">
                                {summary.itemCount || 0} renglones aprobados
                            </div>
                        </div>
                    </div>

                    {/* Selector de Destino Financiero (3 Opciones Profesionales) */}
                    <div>
                        <label className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider block mb-3">
                            ¿Cómo deseas registrar esta factura en tus finanzas?
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            
                            {/* Opción 1: Crédito / Por Pagar */}
                            <button
                                type="button"
                                onClick={() => setFinancialAction('CREDIT')}
                                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                    financialAction === 'CREDIT'
                                        ? 'bg-amber-500/10 border-amber-500 shadow-sm ring-1 ring-amber-500/30'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className={`p-2 rounded-xl ${financialAction === 'CREDIT' ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                            <CreditCard size={18} />
                                        </div>
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                            financialAction === 'CREDIT' ? 'border-amber-500 bg-amber-500' : 'border-slate-300 dark:border-slate-600'
                                        }`}>
                                            {financialAction === 'CREDIT' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                    <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                        Pendiente por Pagar
                                    </h4>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                                        Asienta la deuda a crédito en <span className="font-bold text-amber-600 dark:text-amber-400">Cuentas por Pagar</span> con vencimiento.
                                    </p>
                                </div>
                                <span className="inline-block mt-3 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                                    Recomendado Proveedor
                                </span>
                            </button>

                            {/* Opción 2: Contado / Solvente */}
                            <button
                                type="button"
                                onClick={() => setFinancialAction('PAID')}
                                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                    financialAction === 'PAID'
                                        ? 'bg-emerald-500/10 border-emerald-500 shadow-sm ring-1 ring-emerald-500/30'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className={`p-2 rounded-xl ${financialAction === 'PAID' ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                            <Wallet size={18} />
                                        </div>
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                            financialAction === 'PAID' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 dark:border-slate-600'
                                        }`}>
                                            {financialAction === 'PAID' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                    <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                        Pagada de Contado
                                    </h4>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                                        Archiva la compra como <span className="font-bold text-emerald-600 dark:text-emerald-400">Solvente / Cancelada</span> sin deuda pendiente.
                                    </p>
                                </div>
                                <span className="inline-block mt-3 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                                    Liquidación Inmediata
                                </span>
                            </button>

                            {/* Opción 3: Solo Inventario */}
                            <button
                                type="button"
                                onClick={() => setFinancialAction('INVENTORY_ONLY')}
                                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                    financialAction === 'INVENTORY_ONLY'
                                        ? 'bg-slate-600/10 border-slate-500 shadow-sm ring-1 ring-slate-500/30'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className={`p-2 rounded-xl ${financialAction === 'INVENTORY_ONLY' ? 'bg-slate-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                            <Boxes size={18} />
                                        </div>
                                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                            financialAction === 'INVENTORY_ONLY' ? 'border-slate-500 bg-slate-500' : 'border-slate-300 dark:border-slate-600'
                                        }`}>
                                            {financialAction === 'INVENTORY_ONLY' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                    <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                        Solo Inventario
                                    </h4>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                                        Carga stock y PVP sin generar orden contable ni afectar saldos de proveedores.
                                    </p>
                                </div>
                                <span className="inline-block mt-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                    Sin Registro Pasivo
                                </span>
                            </button>

                        </div>
                    </div>

                    {/* Configuración de Proveedor (Si es Crédito o Contado) */}
                    {financialAction !== 'INVENTORY_ONLY' && (
                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                                    <Building2 size={14} className="text-primary-500" />
                                    <span>Asignación de Proveedor</span>
                                </label>
                                
                                {summary.detectedSupplierName && (
                                    <div className="inline-flex p-0.5 bg-slate-200 dark:bg-slate-800 rounded-lg text-[10px] font-bold">
                                        <button
                                            type="button"
                                            onClick={() => setSupplierMode('AUTO')}
                                            className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                                                supplierMode === 'AUTO' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
                                            }`}
                                        >
                                            Detectado ({summary.detectedSupplierName.slice(0, 15)}...)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSupplierMode('SELECT')}
                                            className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                                                supplierMode === 'SELECT' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
                                            }`}
                                        >
                                            Elegir del Listado
                                        </button>
                                    </div>
                                )}
                            </div>

                            {supplierMode === 'AUTO' && summary.detectedSupplierName ? (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
                                    <div className="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-400">
                                        <span className="flex items-center gap-1.5">
                                            <CheckCircle2 size={14} />
                                            <span>Nuevo Proveedor Detectado por OCR</span>
                                        </span>
                                        <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/20 rounded-md">
                                            Se creará automáticamente
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <span className="text-[10px] text-slate-500 uppercase font-bold block">Razón Social:</span>
                                            <input
                                                type="text"
                                                value={newSupplierName}
                                                onChange={(e) => setNewSupplierName(e.target.value)}
                                                className="w-full h-8 px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-white text-xs outline-none focus:border-emerald-500"
                                            />
                                        </div>
                                        <div>
                                            <span className="text-[10px] text-slate-500 uppercase font-bold block">RIF / Identificación:</span>
                                            <input
                                                type="text"
                                                value={newSupplierRif}
                                                onChange={(e) => setNewSupplierRif(e.target.value)}
                                                placeholder="Ej. J-12345678-9"
                                                className="w-full h-8 px-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-800 dark:text-white text-xs outline-none focus:border-emerald-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <select
                                        value={selectedSupplierId}
                                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                                        className="w-full h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-primary-500 cursor-pointer"
                                    >
                                        <option value="">-- Seleccionar Proveedor de la Empresa --</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>
                                                {s.name} {s.rif ? `(${s.rif})` : ''} - Saldo: ${formatSmartUsd(s.creditBalance || 0)}
                                            </option>
                                        ))}
                                    </select>
                                    {!selectedSupplierId && financialAction === 'CREDIT' && (
                                        <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                                            <AlertCircle size={12} />
                                            <span>Debes seleccionar un proveedor para asentar la deuda a crédito en Cuentas por Pagar.</span>
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Detalles Específicos para CRÉDITO */}
                    {financialAction === 'CREDIT' && (
                        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-amber-800 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <Clock size={14} />
                                    <span>Términos del Crédito y Vencimiento</span>
                                </label>
                                <span className="text-[11px] font-bold text-slate-500">
                                    Vence el: <span className="text-amber-600 dark:text-amber-400 font-mono font-black">{dueDate || 'Sin definir'}</span>
                                </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {[7, 15, 21, 30, 45, 60].map(days => (
                                    <button
                                        key={days}
                                        type="button"
                                        onClick={() => handleQuickDays(days)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                            creditDays === days
                                                ? 'bg-amber-500 text-white shadow-xs'
                                                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-amber-400'
                                        }`}
                                    >
                                        {days} Días
                                    </button>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                        Fecha Exacta de Vencimiento
                                    </label>
                                    <input
                                        type="date"
                                        value={dueDate}
                                        onChange={(e) => {
                                            setDueDate(e.target.value);
                                            setCreditDays(0);
                                        }}
                                        className="w-full h-9 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-800 dark:text-white outline-none focus:border-amber-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                        Observación / Notas de Crédito
                                    </label>
                                    <input
                                        type="text"
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Ej. Factura a 15 días con entrega en camión"
                                        className="w-full h-9 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white outline-none focus:border-amber-500"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Detalles Específicos para CONTADO */}
                    {financialAction === 'PAID' && (
                        <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                            <label className="text-xs font-black text-emerald-800 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Wallet size={14} />
                                <span>Origen del Pago (Liquidada de Contado)</span>
                            </label>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { id: 'CASH_USD', label: 'Efectivo USD' },
                                    { id: 'TRANSFER_BS', label: 'Banco (Bs)' },
                                    { id: 'PAGO_MOVIL', label: 'Pago Móvil' },
                                    { id: 'CASH_REGISTER', label: 'Caja Chica' }
                                ].map(m => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setPaymentMethod(m.id)}
                                        className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                                            paymentMethod === m.id
                                                ? 'bg-emerald-500 text-white border-emerald-600 font-black shadow-xs text-xs'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:border-emerald-400'
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer de Acciones */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving}
                        className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        Volver a la Lista
                    </button>

                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSaving || (financialAction === 'CREDIT' && supplierMode === 'SELECT' && !selectedSupplierId && !newSupplierName.trim())}
                        className={`w-full sm:w-auto px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer ${
                            financialAction === 'CREDIT'
                                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/30'
                                : financialAction === 'PAID'
                                ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                                : 'bg-slate-800 hover:bg-slate-900 shadow-slate-900/30'
                        }`}
                    >
                        {isSaving ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Procesando Entrada...</span>
                            </>
                        ) : (
                            <>
                                <span>
                                    {financialAction === 'CREDIT'
                                        ? `Confirmar Compra a Crédito ($${formatSmartUsd(totalUsd)})`
                                        : financialAction === 'PAID'
                                        ? `Confirmar Compra Pagada ($${formatSmartUsd(totalUsd)})`
                                        : `Actualizar Solo Inventario (${summary.totalUnits || 0} u.)`}
                                </span>
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
}
