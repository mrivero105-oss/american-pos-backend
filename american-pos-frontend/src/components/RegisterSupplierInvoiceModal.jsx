import { useState, useEffect, useRef } from 'react';
import {
    FileText, 
    Calendar, 
    DollarSign, 
    Truck, 
    Hash, 
    Clock, 
    CheckCircle2, 
    ScanLine, 
    RefreshCw, 
    FileUp, 
    ArrowRight, 
    Printer, 
    Eye, 
    Trash2, 
    Loader2, 
    Check, 
    History
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import BaseModal from './BaseModal';
import PrinterScanModal from './PrinterScanModal';
import InvoiceViewerModal from './InvoiceViewerModal';
import { fetchGlobalSettings } from '../utils/format';

export default function RegisterSupplierInvoiceModal({ isOpen, onClose, onSuccess, defaultSupplier = null }) {
    const [suppliers, setSuppliers] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    // Form fields
    const [supplierId, setSupplierId] = useState('');
    const [referenceNumber, setReferenceNumber] = useState('');
    const [amount, setAmount] = useState('');
    const [arrivalDate, setArrivalDate] = useState(new Date().toISOString().split('T')[0]);
    const [dueDate, setDueDate] = useState('');
    const [exchangeRate, setExchangeRate] = useState(1);
    const [notes, setNotes] = useState('');
    
    // File / Scanner states
    const [selectedFile, setSelectedFile] = useState(null);
    const [scannedInvoiceUrl, setScannedInvoiceUrl] = useState(null);
    const fileInputRef = useRef(null);

    // Printer Scan Modal state
    const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
    const [isScanning, setIsScanning] = useState(false);

    // AI Extraction states
    const [isExtractingAI, setIsExtractingAI] = useState(false);
    const [aiExtractionInfo, setAiExtractionInfo] = useState(null);
    const [fetchingBcvRate, setFetchingBcvRate] = useState(false);

    // Invoice Viewer Modal state
    const [viewerInvoice, setViewerInvoice] = useState({ isOpen: false, url: '', details: {} });

    useEffect(() => {
        if (isOpen) {
            loadSuppliers();
            loadCurrentRate();
            if (defaultSupplier) {
                setSupplierId(defaultSupplier.id);
            }
            // Preset 15 days due date
            const d = new Date();
            d.setDate(d.getDate() + 15);
            setDueDate(d.toISOString().split('T')[0]);
        } else {
            resetForm();
        }
    }, [isOpen, defaultSupplier]);

    const resetForm = () => {
        setSupplierId('');
        setReferenceNumber('');
        setAmount('');
        setArrivalDate(new Date().toISOString().split('T')[0]);
        setDueDate('');
        setNotes('');
        setSelectedFile(null);
        setScannedInvoiceUrl(null);
        setAiExtractionInfo(null);
    };

    const loadSuppliers = async () => {
        try {
            const res = await api.get('/suppliers');
            setSuppliers(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Error loading suppliers:', err);
        }
    };

    const loadCurrentRate = async () => {
        try {
            const settings = await fetchGlobalSettings();
            if (settings?.rate && Number(settings.rate) > 0) {
                setExchangeRate(Number(settings.rate));
            }
        } catch (err) {
            console.error('Error loading rate:', err);
        }
    };

    const loadBcvRateForDate = async (dateVal) => {
        if (!dateVal) return;
        try {
            setFetchingBcvRate(true);
            const res = await api.get(`/suppliers/bcv-rate?date=${dateVal}`);
            if (res.data?.success && res.data.rate > 0) {
                const bcvRate = Number(res.data.rate);
                setExchangeRate(bcvRate);
                toast.success(`Tasa BCV del ${res.data.date}: Bs. ${bcvRate} Bs/$`);
            }
        } catch (err) {
            console.error('Error loading BCV rate for date:', err);
            toast.error('No se pudo obtener la tasa BCV para la fecha seleccionada');
        } finally {
            setFetchingBcvRate(false);
        }
    };

    // AI Extraction from Image or PDF + Historical BCV Rate Verification
    const handleExtractDataFromInvoice = async (target) => {
        if (!target) return;
        try {
            setIsExtractingAI(true);
            toast.loading('Analizando factura y consultando tasa histórica BCV...', { id: 'ai-extract' });
            
            const formData = new FormData();
            if (typeof target === 'string') {
                formData.append('invoiceUrl', target);
            } else if (target instanceof File) {
                formData.append('file', target);
            }

            const res = await api.post('/suppliers/analyze-invoice-data', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 120000
            });

            toast.dismiss('ai-extract');
            const data = res.data?.data;
            if (data) {
                if (data.referenceNumber) setReferenceNumber(data.referenceNumber);
                if (data.totalUsd && data.totalUsd > 0) setAmount(data.totalUsd);
                if (data.appliedRate && data.appliedRate > 0) setExchangeRate(data.appliedRate);
                if (data.date) {
                    setArrivalDate(data.date);
                    const d = new Date(data.date);
                    d.setDate(d.getDate() + 15);
                    setDueDate(d.toISOString().split('T')[0]);
                }
                if (data.concept) setNotes(data.concept);

                if (data.matchedSupplierId) {
                    setSupplierId(data.matchedSupplierId);
                }

                setAiExtractionInfo({
                    supplierName: data.supplierName,
                    supplierRif: data.supplierRif,
                    currency: data.currency,
                    rawTotal: data.rawTotalAmount,
                    totalUsd: data.totalUsd,
                    bcvRate: data.appliedRate || data.bcvRate,
                    bcvSource: data.bcvSource,
                    date: data.date,
                    matchedSupplierName: data.matchedSupplierName
                });

                if (data.currency === 'BS') {
                    toast.success(
                        `¡Factura en Bs. ${data.rawTotalAmount.toLocaleString('es-VE')} convertida a $${data.totalUsd} USD con tasa BCV del ${data.date} (${data.appliedRate} Bs/$)!`,
                        { duration: 6000 }
                    );
                } else {
                    toast.success(
                        `¡Datos extraídos con éxito: $${data.totalUsd} USD (Ref: ${data.referenceNumber || 'S/N'})!`,
                        { duration: 5000 }
                    );
                }
            }
        } catch (err) {
            toast.dismiss('ai-extract');
            console.error('Error in invoice extraction:', err);
            toast.error(err.response?.data?.error || err.message || 'No se pudieron extraer los datos.');
        } finally {
            setIsExtractingAI(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 15 * 1024 * 1024) {
                toast.error('El archivo excede el límite de 15MB');
                return;
            }
            setSelectedFile(file);
            setScannedInvoiceUrl(null);

            // Auto-trigger AI Extraction
            handleExtractDataFromInvoice(file);
        }
    };

    const handleScanFromPrinter = async ({ deviceId, dpi, colorMode }) => {
        try {
            setIsScanning(true);
            toast.loading('Iniciando escáner de la impresora... Por favor espere', { id: 'scan-inv' });
            
            const res = await api.post('/suppliers/scan-invoice', {
                deviceId,
                dpi,
                colorMode
            }, {
                timeout: 180000 // 3 minutos para hardware físico
            });

            toast.dismiss('scan-inv');

            if (res.data?.invoiceUrl) {
                const invoiceUrl = res.data.invoiceUrl;
                setScannedInvoiceUrl(invoiceUrl);
                setSelectedFile(null);
                setIsPrinterModalOpen(false);
                toast.success('¡Factura física escaneada con éxito!');

                // Auto-trigger AI Extraction from the scanned document
                handleExtractDataFromInvoice(invoiceUrl);
            }
        } catch (err) {
            toast.dismiss('scan-inv');
            console.error('Scan error:', err);
            toast.error(err.response?.data?.error || err.message || 'Error al comunicarse con la impresora/escáner.');
        } finally {
            setIsScanning(false);
        }
    };

    const handleSetQuickDueDays = (days) => {
        const d = new Date(arrivalDate || new Date());
        d.setDate(d.getDate() + days);
        setDueDate(d.toISOString().split('T')[0]);
    };

    const calculatedVes = (parseFloat(amount) || 0) * (parseFloat(exchangeRate) || 1);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!supplierId) {
            toast.error('Selecciona un proveedor');
            return;
        }
        if (!amount || parseFloat(amount) <= 0) {
            toast.error('Ingresa un monto válido mayor a 0');
            return;
        }

        try {
            setSubmitting(true);
            const formData = new FormData();
            formData.append('supplierId', supplierId);
            formData.append('referenceNumber', referenceNumber || `FACT-${Date.now().toString().slice(-6)}`);
            formData.append('amount', parseFloat(amount));
            formData.append('arrivalDate', arrivalDate);
            formData.append('exchangeRate', parseFloat(exchangeRate) || 1);
            if (dueDate) formData.append('dueDate', dueDate);
            if (notes) formData.append('notes', notes);
            
            if (scannedInvoiceUrl) {
                formData.append('invoiceUrl', scannedInvoiceUrl);
            } else if (selectedFile) {
                formData.append('file', selectedFile);
            }

            await api.post('/suppliers/invoices', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 180000
            });

            toast.success('¡Factura de proveedor y cuenta por pagar registradas con éxito!');
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            console.error('Submit invoice error:', err);
            toast.error('Error al registrar factura: ' + (err.response?.data?.error || err.message));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Registrar Factura de Proveedor"
            subtitle="Escanea la factura física con tu impresora o sube el archivo digital."
            icon={FileText}
            maxWidth="max-w-3xl"
            className="max-h-[92dvh] pb-safe"
        >
            <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                {/* AI Extraction Banner */}
                {aiExtractionInfo && (
                    <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
                        <div className="flex items-center gap-3">
                            <div className="p-2 sm:p-2.5 bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-lg shadow-xs shrink-0">
                                <ScanLine size={18} />
                            </div>
                            <div className="text-xs space-y-0.5">
                                <p className="font-black text-slate-800 dark:text-white uppercase tracking-wide flex items-center gap-2 flex-wrap">
                                    <span>Lectura Óptica de Factura (OCR)</span>
                                    <span className="text-[10px] font-black px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                                        BCV {aiExtractionInfo.date} Verificado
                                    </span>
                                </p>
                                <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                                    Prov: <strong className="text-sky-600 dark:text-sky-400">{aiExtractionInfo.supplierName || 'Detectado'}</strong>
                                    {aiExtractionInfo.supplierRif && <> • RIF: <strong className="text-slate-600 dark:text-slate-300 font-mono">{aiExtractionInfo.supplierRif}</strong></>}
                                    • Tasa BCV ({aiExtractionInfo.date}): <strong className="text-emerald-600 dark:text-emerald-400 font-mono">Bs. {aiExtractionInfo.bcvRate}</strong>
                                    {aiExtractionInfo.currency === 'BS' && <> • Total Original: <strong className="text-amber-600 dark:text-amber-400 font-mono">Bs. {aiExtractionInfo.rawTotal?.toLocaleString('es-VE')}</strong></>}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleExtractDataFromInvoice(scannedInvoiceUrl || selectedFile)}
                            disabled={isExtractingAI}
                            className="px-3 py-2 min-h-[36px] bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shrink-0 self-end sm:self-auto"
                            title="Volver a leer factura con OCR"
                        >
                            {isExtractingAI ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
                            <span>Re-analizar OCR</span>
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    {/* Proveedor */}
                    <div className="space-y-1.5 sm:space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                <Truck size={14} className="text-amber-500" /> Proveedor *
                            </label>
                            {aiExtractionInfo?.matchedSupplierName && (
                                <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                                    <Check size={11} /> Vinculado automáticamente
                                </span>
                            )}
                        </div>
                        <select
                            value={supplierId}
                            onChange={(e) => setSupplierId(e.target.value)}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base sm:text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 transition-all min-h-[44px]"
                        >
                            <option value="">-- Seleccionar Proveedor --</option>
                            {suppliers.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name} {s.rif ? `(${s.rif})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Nro Factura / Control */}
                    <div className="space-y-1.5 sm:space-y-2">
                        <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Hash size={14} className="text-amber-500" /> Nro. Factura / Control *
                        </label>
                        <input
                            type="text"
                            placeholder="Ej. FACT-004891 o 00-1284"
                            value={referenceNumber}
                            onChange={(e) => setReferenceNumber(e.target.value)}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base sm:text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 uppercase transition-all font-mono min-h-[44px]"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    {/* Monto de la Factura (USD) */}
                    <div className="space-y-1.5 sm:space-y-2">
                        <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <DollarSign size={14} className="text-emerald-500" /> Monto Total ($ USD) *
                        </label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-lg">$</span>
                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                                className="w-full pl-9 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-lg font-black text-emerald-600 dark:text-emerald-400 outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-mono min-h-[48px]"
                            />
                        </div>
                    </div>

                    {/* Tasa de Cambio al Llegar */}
                    <div className="space-y-1.5 sm:space-y-2">
                        <div className="flex justify-between items-center flex-wrap gap-1">
                            <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                <RefreshCw size={14} className="text-indigo-500" /> Tasa al Momento de Llegada *
                            </label>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => loadBcvRateForDate(arrivalDate)}
                                    disabled={fetchingBcvRate}
                                    className="text-[10px] font-black text-emerald-500 hover:underline uppercase flex items-center gap-1 cursor-pointer min-h-[30px]"
                                    title="Consultar tasa BCV oficial para la fecha de llegada seleccionada"
                                >
                                    {fetchingBcvRate ? <Loader2 size={10} className="animate-spin" /> : <History size={10} />}
                                    <span>Tasa BCV de esta Fecha</span>
                                </button>
                                <span className="text-slate-400 text-[10px]">•</span>
                                <button
                                    type="button"
                                    onClick={loadCurrentRate}
                                    className="text-[10px] font-black text-indigo-500 hover:underline uppercase cursor-pointer min-h-[30px] flex items-center"
                                    title="Usar tasa actual del sistema"
                                >
                                    Tasa Actual
                                </button>
                            </div>
                        </div>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">Bs/$</span>
                            <input
                                type="number"
                                step="0.0001"
                                min="0.0001"
                                value={exchangeRate}
                                onChange={(e) => setExchangeRate(e.target.value)}
                                required
                                className="w-full pl-14 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base sm:text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono min-h-[44px]"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold">
                            Total en Moneda Local: <strong className="text-slate-700 dark:text-slate-200 font-mono">Bs. {calculatedVes.toFixed(2)}</strong>
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Fecha de Llegada */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar size={14} className="text-amber-500" /> Fecha de Llegada / Recepción *
                        </label>
                        <input
                            type="date"
                            value={arrivalDate}
                            onChange={(e) => {
                                const newDate = e.target.value;
                                setArrivalDate(newDate);
                                if (newDate) {
                                    loadBcvRateForDate(newDate);
                                }
                            }}
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base sm:text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 transition-all min-h-[44px]"
                        />
                    </div>

                    {/* Fecha Límite de Pago / Vencimiento */}
                    <div className="space-y-1.5 sm:space-y-2">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                <Clock size={14} className="text-rose-500" /> Fecha Límite de Pago
                            </label>
                            <div className="flex gap-1">
                                <button
                                    type="button"
                                    onClick={() => handleSetQuickDueDays(7)}
                                    className="px-2.5 py-1 min-h-[30px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[9px] font-black text-slate-600 dark:text-slate-300"
                                >
                                    +7d
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSetQuickDueDays(15)}
                                    className="px-2.5 py-1 min-h-[30px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[9px] font-black text-slate-600 dark:text-slate-300"
                                >
                                    +15d
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSetQuickDueDays(30)}
                                    className="px-2.5 py-1 min-h-[30px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-[9px] font-black text-slate-600 dark:text-slate-300"
                                >
                                    +30d
                                </button>
                            </div>
                        </div>
                        <input
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base sm:text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-rose-500 transition-all min-h-[44px]"
                        />
                    </div>
                </div>

                {/* Subir o Escanear Factura Real */}
                <div className="space-y-3">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                        <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <FileText size={14} className="text-indigo-500" /> Factura Real (Digital o Escaneada)
                        </label>
                        
                        {/* Botón de Escanear con Impresora */}
                        <button
                            type="button"
                            onClick={() => setIsPrinterModalOpen(true)}
                            className="flex items-center gap-2 px-3.5 py-2 min-h-[38px] bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-md shadow-indigo-500/20 transition-all active:scale-95 cursor-pointer"
                        >
                            <Printer size={14} />
                            <span>Escanear con Impresora</span>
                        </button>
                    </div>

                    {scannedInvoiceUrl ? (
                        <div className="p-4 sm:p-5 bg-indigo-500/10 border-2 border-indigo-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                <div className="p-2.5 sm:p-3 bg-indigo-500/20 text-indigo-500 rounded-lg shrink-0">
                                    <CheckCircle2 size={24} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide truncate">
                                        Factura Escaneada con Éxito
                                    </p>
                                    <p className="text-[10px] font-mono text-slate-400 truncate">
                                        {scannedInvoiceUrl}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                                <button
                                    type="button"
                                    onClick={() => handleExtractDataFromInvoice(scannedInvoiceUrl)}
                                    disabled={isExtractingAI}
                                    className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-black uppercase shadow-sm transition-all cursor-pointer"
                                    title="Extraer datos y consultar tasa BCV de la fecha de emisión"
                                >
                                    {isExtractingAI ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                                    <span>Extraer Datos (OCR)</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewerInvoice({
                                        isOpen: true,
                                        url: scannedInvoiceUrl,
                                        details: { referenceNumber: referenceNumber || 'Factura Escaneada', supplierName: 'Proveedor' }
                                    })}
                                    className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase"
                                >
                                    <Eye size={14} /> Ver Escaneo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setScannedInvoiceUrl(null);
                                        setAiExtractionInfo(null);
                                    }}
                                    className="min-w-[38px] min-h-[38px] flex items-center justify-center p-2 text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                                    title="Eliminar escaneo"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className={`p-5 sm:p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors flex flex-col items-center justify-center text-center ${
                                selectedFile
                                    ? 'border-emerald-400 bg-emerald-50/30 dark:bg-emerald-500/10'
                                    : 'border-slate-200 dark:border-slate-700 hover:border-amber-500 bg-slate-50/50 dark:bg-slate-800/30'
                            }`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={handleFileChange}
                                className="hidden"
                            />

                            {selectedFile ? (
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between w-full gap-3">
                                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                        <div className="p-2.5 sm:p-3 bg-emerald-500/20 text-emerald-500 rounded-2xl shrink-0">
                                            <CheckCircle2 size={24} />
                                        </div>
                                        <div className="text-left min-w-0">
                                            <p className="text-sm font-black text-slate-800 dark:text-white truncate max-w-xs">
                                                {selectedFile.name}
                                            </p>
                                            <p className="text-xs text-slate-400 font-bold">
                                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • Clic para cambiar archivo
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 self-end sm:self-auto">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleExtractDataFromInvoice(selectedFile);
                                            }}
                                            disabled={isExtractingAI}
                                            className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-black uppercase shadow-sm cursor-pointer"
                                        >
                                            {isExtractingAI ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                                            <span>Extraer Datos (OCR)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedFile(null);
                                                setAiExtractionInfo(null);
                                            }}
                                            className="min-w-[38px] min-h-[38px] flex items-center justify-center p-2 text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2">
                                    <div className="flex items-center gap-3">
                                        <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-2xl">
                                            <FileUp size={22} />
                                        </div>
                                        <div className="p-3 bg-amber-50 dark:bg-amber-500/10 text-amber-500 rounded-2xl">
                                            <Printer size={22} />
                                        </div>
                                    </div>
                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                                        Arrastra un archivo PDF / Imagen o usa el botón &ldquo;Escanear con Impresora&rdquo;
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                        Formatos soportados: PDF, JPG, PNG, Escaneo WIA (Hasta 15MB) • <strong>Extracción y Tasa BCV Histórica</strong>
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Concepto / Notas */}
                <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        Observaciones / Concepto
                    </label>
                    <textarea
                        rows="2"
                        placeholder="Detalles sobre los productos recibidos, condiciones de pago o acuerdo..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base sm:text-xs font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none min-h-[44px]"
                    />
                </div>

                {/* Submit Buttons */}
                <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 sm:gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[48px] sm:min-h-[44px] w-full sm:w-auto flex items-center justify-center px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={submitting || !supplierId || !amount}
                        className="min-h-[48px] sm:min-h-[44px] w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all active:scale-95 cursor-pointer"
                    >
                        {submitting ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        ) : (
                            <>
                                <span>Registrar Factura</span>
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </div>
            </form>

            {/* Modal de Escaneo con Impresora */}
            <PrinterScanModal
                isOpen={isPrinterModalOpen}
                onClose={() => setIsPrinterModalOpen(false)}
                onScan={handleScanFromPrinter}
                isScanning={isScanning}
            />

            {/* Modal Visor de Factura Escaneada */}
            <InvoiceViewerModal
                isOpen={viewerInvoice.isOpen}
                onClose={() => setViewerInvoice(prev => ({ ...prev, isOpen: false }))}
                invoiceUrl={viewerInvoice.url}
                title="Factura Escaneada"
                details={viewerInvoice.details}
            />
        </BaseModal>
    );
}
