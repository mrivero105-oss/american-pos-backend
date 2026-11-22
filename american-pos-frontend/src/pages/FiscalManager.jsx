import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    FileSpreadsheet, 
    FileText, 
    Download, 
    Printer, 
    Plus, 
    Search, 
    AlertTriangle, 
    RefreshCw, 
    Calculator, 
    DollarSign, 
    ShieldAlert, 
    X, 
    Info, 
    Settings2, 
    Activity, 
    Terminal
} from 'lucide-react';
import api from '../services/api';
import { formatMoney } from '../utils/format';
import CreditNoteModal from '../components/CreditNoteModal';
import ConfirmModal from '../components/ConfirmModal';

const MONTHS = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' }
];

const getLocalDateISO = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getConfiguredFiscalSettings = () => {
    try {
        const raw = localStorage.getItem('pos_business_settings');
        return raw ? (JSON.parse(raw) || {}) : {};
    } catch (_) {
        return {};
    }
};

// FiscalService entrega montos ya convertidos a Bolívares (VES); forzar rate=1 evita doble conversión por la tasa BCV.
const formatVesBook = (val) => formatMoney(Number(val) || 0, 'VES', { rate: 1, currencyMode: 'VES' });

export default function FiscalManager() {
    const currentDate = new Date();
    const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
    const [activeTab, setActiveTab] = useState('sales'); // 'sales', 'purchases', 'retentions', 'summary'
    
    // Data States
    const [salesBook, setSalesBook] = useState({ records: [], totals: {} });
    const [purchasesBook, setPurchasesBook] = useState({ records: [], totals: {} });
    const [taxSummary, setTaxSummary] = useState(null);
    const [retentions, setRetentions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // Modals
    const [isCreditNoteModalOpen, setIsCreditNoteModalOpen] = useState(false);
    const [isManualRecordModalOpen, setIsManualRecordModalOpen] = useState(false);
    const [isRetentionModalOpen, setIsRetentionModalOpen] = useState(false);

    // Fiscal Hardware States
    const [fiscalConfig, setFiscalConfig] = useState(() => ({
        targetType: localStorage.getItem('fiscal_target_type') || 'com',
        targetPort: localStorage.getItem('fiscal_target_port') || 'COM1',
        baudRate: Number(localStorage.getItem('fiscal_baud_rate') || 9600),
        targetPrinter: localStorage.getItem('fiscal_target_printer') || '',
        spoolerPath: localStorage.getItem('fiscal_spooler_path') || 'C:\\IntTFHKA\\Factura.txt'
    }));
    const [devices, setDevices] = useState({ comPorts: ['COM1', 'COM2', 'COM3', 'COM4'], printers: [] });
    const [detectingDevices, setDetectingDevices] = useState(false);
    const [executingFiscalAction, setExecutingFiscalAction] = useState(false);
    const [fiscalLogs, setFiscalLogs] = useState([]);
    const [confirmConfig, setConfirmConfig] = useState({
        isOpen: false,
        title: '',
        message: '',
        variant: 'danger',
        confirmText: 'Confirmar',
        cancelText: 'Cancelar',
        action: () => {}
    });

    const updateFiscalConfig = (patch) => {
        setFiscalConfig(prev => {
            const next = { ...prev, ...patch };
            if (patch.targetType !== undefined) localStorage.setItem('fiscal_target_type', patch.targetType);
            if (patch.targetPort !== undefined) localStorage.setItem('fiscal_target_port', patch.targetPort);
            if (patch.baudRate !== undefined) localStorage.setItem('fiscal_baud_rate', String(patch.baudRate));
            if (patch.targetPrinter !== undefined) localStorage.setItem('fiscal_target_printer', patch.targetPrinter);
            if (patch.spoolerPath !== undefined) localStorage.setItem('fiscal_spooler_path', patch.spoolerPath);
            return next;
        });
    };

    const fetchDevices = async () => {
        try {
            setDetectingDevices(true);
            const res = await api.get('/fiscal/devices');
            if (res.data && res.data.success) {
                setDevices({
                    comPorts: res.data.comPorts || ['COM1', 'COM2'],
                    printers: res.data.printers || []
                });
                toast.success('Dispositivos y puertos COM actualizados');
            }
        } catch (e) {
            console.error('Error fetching devices', e);
            toast.error('Error al detectar puertos COM');
        } finally {
            setDetectingDevices(false);
        }
    };

    const executeFiscalTransmission = async (action, label) => {
        try {
            setExecutingFiscalAction(true);
            const res = await api.post('/fiscal/action', {
                action,
                targetType: fiscalConfig.targetType,
                targetPort: fiscalConfig.targetPort,
                baudRate: fiscalConfig.baudRate,
                targetPrinter: fiscalConfig.targetPrinter,
                spoolerPath: fiscalConfig.spoolerPath
            });

            if (res.data && res.data.success) {
                toast.success(`${label} emitido con éxito`);
                setFiscalLogs(prev => [
                    {
                        time: new Date().toLocaleTimeString(),
                        action: label,
                        status: 'OK',
                        details: `Transmisión exitosa hacia ${fiscalConfig.targetType.toUpperCase()}`
                    },
                    ...prev.slice(0, 19)
                ]);
            } else {
                toast.error(res.data?.error || `Error al emitir ${label}`);
            }
        } catch (error) {
            console.error('Error in handleFiscalAction', error);
            toast.error(error.response?.data?.error || `Error de conexión: ${error.message}`);
            setFiscalLogs(prev => [
                {
                    time: new Date().toLocaleTimeString(),
                    action: label,
                    status: 'ERROR',
                    details: error.response?.data?.error || error.message
                },
                ...prev.slice(0, 19)
            ]);
        } finally {
            setExecutingFiscalAction(false);
        }
    };

    const handleFiscalAction = (action, label) => {
        if (action === 'REPORTE_Z') {
            setConfirmConfig({
                isOpen: true,
                title: '¿Emitir Reporte Z (Cierre Fiscal)?',
                message: 'El Reporte Z realiza el CIERRE FISCAL DEFINITIVO del período en la impresora fiscal y consolida la memoria de auditoría SENIAT. ¿Deseas emitir el Reporte Z ahora?',
                variant: 'danger',
                confirmText: 'Sí, Emitir Cierre Z',
                cancelText: 'Cancelar',
                action: () => executeFiscalTransmission(action, label)
            });
            return;
        }
        executeFiscalTransmission(action, label);
    };

    const configuredSettings = useMemo(() => getConfiguredFiscalSettings(), []);
    const defaultIvaPct = useMemo(() => {
        const parsed = Number(configuredSettings?.ivaRate ?? configuredSettings?.taxRate ?? 16);
        return parsed > 0 ? parsed : 16;
    }, [configuredSettings]);

    // Manual Record Form
    const [manualForm, setManualForm] = useState({
        bookType: 'VENTAS',
        recordDate: getLocalDateISO(),
        documentType: 'FACTURA',
        documentNumber: '',
        controlNumber: '',
        entityRif: '',
        entityName: '',
        affectedInvoiceNumber: '',
        totalAmount: '',
        exemptAmount: '0',
        taxableBase: '',
        taxRate: defaultIvaPct.toFixed(2),
        taxAmount: '',
        retainedIvaAmount: '0',
        igtfAmount: '0',
        notes: ''
    });

    // Retention Form
    const [retentionForm, setRetentionForm] = useState({
        retentionType: 'IVA_75',
        retentionCategory: 'EMITIDA_A_PROVEEDOR',
        recordDate: getLocalDateISO(),
        entityRif: '',
        entityName: '',
        invoiceNumber: '',
        controlNumber: '',
        invoiceDate: getLocalDateISO(),
        invoiceTotalAmount: '',
        baseAmount: '',
        taxAmount: '',
        retentionPercentage: '75',
        retainedAmount: '',
        notes: ''
    });

    const effectiveCountry = (configuredSettings?.country || localStorage.getItem('pos_country') || '').toLowerCase();
    const isVenezuela = effectiveCountry === 'venezuela' || effectiveCountry === 've' || !effectiveCountry;

    const [saving, setSaving] = useState(false);

    const loadFiscalData = useCallback(async () => {
        try {
            setLoading(true);
            const params = { year: selectedYear, month: selectedMonth };

            if (activeTab === 'sales') {
                const res = await api.get('/fiscal/sales-book', { params });
                setSalesBook(res.data || { records: [], totals: {} });
            } else if (activeTab === 'purchases') {
                const res = await api.get('/fiscal/purchases-book', { params });
                setPurchasesBook(res.data || { records: [], totals: {} });
            } else if (activeTab === 'retentions') {
                const res = await api.get('/fiscal/retentions', {
                    params: { periodYear: selectedYear, periodMonth: selectedMonth }
                });
                setRetentions(res.data || []);
            } else if (activeTab === 'summary') {
                const res = await api.get('/fiscal/tax-summary', { params });
                setTaxSummary(res.data || null);
            }
        } catch (error) {
            console.error('Error loading fiscal data:', error);
            toast.error('Error al cargar información fiscal del período');
        } finally {
            setLoading(false);
        }
    }, [selectedYear, selectedMonth, activeTab]);

    useEffect(() => {
        if (!isVenezuela) return;
        loadFiscalData();
    }, [isVenezuela, loadFiscalData]);

    // Filter active records by search
    const filteredRecords = useMemo(() => {
        const source = activeTab === 'sales' ? salesBook.records : purchasesBook.records;
        if (!source) return [];
        const term = searchTerm.toLowerCase();
        return source.filter(r => 
            (r.documentNumber || '').toLowerCase().includes(term) ||
            (r.entityName || '').toLowerCase().includes(term) ||
            (r.entityRif || '').toLowerCase().includes(term) ||
            (r.controlNumber || '').toLowerCase().includes(term)
        );
    }, [activeTab, salesBook, purchasesBook, searchTerm]);

    if (!isVenezuela) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center animate-in fade-in duration-300">
                <div className="w-16 h-16 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center border border-amber-500/20 mb-4">
                    <ShieldAlert size={32} />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                    Módulo Fiscal Exclusivo de Venezuela
                </h2>
                <p className="text-sm font-normal text-slate-500 dark:text-slate-400 max-w-lg mt-2">
                    La gestión de libros fiscales de compras/ventas, comprobantes de retención e IGTF aplican según la providencia administrativa del SENIAT en Venezuela.
                </p>
                <div className="mt-4 px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                    Su nodo actual está operando en modalidad {effectiveCountry ? effectiveCountry.toUpperCase() : 'DÓLAR (USD)'}
                </div>
            </div>
        );
    }

    // Handle Manual Fiscal Record Save
    const handleSaveManualRecord = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            await api.post('/fiscal/records', manualForm);
            toast.success('Documento fiscal registrado en el libro');
            setIsManualRecordModalOpen(false);
            setManualForm({
                bookType: activeTab === 'purchases' ? 'COMPRAS' : 'VENTAS',
                recordDate: new Date().toISOString().split('T')[0],
                documentType: 'FACTURA',
                documentNumber: '',
                controlNumber: '',
                entityRif: '',
                entityName: '',
                affectedInvoiceNumber: '',
                totalAmount: '',
                exemptAmount: '0',
                taxableBase: '',
                taxRate: '16.00',
                taxAmount: '',
                retainedIvaAmount: '0',
                igtfAmount: '0',
                notes: ''
            });
            loadFiscalData();
        } catch (error) {
            console.error('Error saving fiscal record:', error);
            toast.error(error.response?.data?.error || 'Error al guardar el documento fiscal');
        } finally {
            setSaving(false);
        }
    };

    // Handle Tax Retention Save
    const handleSaveRetention = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            await api.post('/fiscal/retentions', {
                ...retentionForm,
                periodYear: selectedYear,
                periodMonth: selectedMonth
            });
            toast.success('Comprobante de Retención emitido exitosamente');
            setIsRetentionModalOpen(false);
            loadFiscalData();
        } catch (error) {
            console.error('Error saving retention:', error);
            toast.error(error.response?.data?.error || 'Error al emitir comprobante de retención');
        } finally {
            setSaving(false);
        }
    };

    // Quick CSV / Excel Export
    const handleExportCSV = () => {
        const isSales = activeTab === 'sales';
        const records = isSales ? salesBook.records : purchasesBook.records;
        if (!records || records.length === 0) {
            toast.error('No hay registros para exportar en este período');
            return;
        }

        let headers = isSales
            ? 'Operacion,Fecha,RIF,Nombre / Razon Social,Nro Factura,Nro Control,Factura Afectada,Total Ventas (Bs),Exento (Bs),Base Imponible (Bs),Alicuota (%),IVA Debito (Bs),IGTF 3% (Bs),Retencion IVA (Bs)\n'
            : 'Operacion,Fecha,RIF Proveedor,Nombre / Razon Social,Nro Factura,Nro Control,Factura Afectada,Total Compras (Bs),Exento (Bs),Base Imponible (Bs),Alicuota (%),IVA Credito (Bs),Retencion IVA (Bs)\n';

        const rows = records.map((r, idx) => {
            if (isSales) {
                return [
                    idx + 1,
                    r.recordDate,
                    `"${r.entityRif || ''}"`,
                    `"${r.entityName || ''}"`,
                    `"${r.documentNumber || ''}"`,
                    `"${r.controlNumber || ''}"`,
                    `"${r.affectedInvoiceNumber || ''}"`,
                    Number(r.totalAmount || 0).toFixed(2),
                    Number(r.exemptAmount || 0).toFixed(2),
                    Number(r.taxableBase || 0).toFixed(2),
                    Number(r.taxRate || 16).toFixed(2),
                    Number(r.taxAmount || 0).toFixed(2),
                    Number(r.igtfAmount || 0).toFixed(2),
                    Number(r.retainedIvaAmount || 0).toFixed(2)
                ].join(',');
            } else {
                return [
                    idx + 1,
                    r.recordDate,
                    `"${r.entityRif || ''}"`,
                    `"${r.entityName || ''}"`,
                    `"${r.documentNumber || ''}"`,
                    `"${r.controlNumber || ''}"`,
                    `"${r.affectedInvoiceNumber || ''}"`,
                    Number(r.totalAmount || 0).toFixed(2),
                    Number(r.exemptAmount || 0).toFixed(2),
                    Number(r.taxableBase || 0).toFixed(2),
                    Number(r.taxRate || 16).toFixed(2),
                    Number(r.taxAmount || 0).toFixed(2),
                    Number(r.retainedIvaAmount || 0).toFixed(2)
                ].join(',');
            }
        }).join('\n');

        const blob = new Blob(['\uFEFF' + headers + rows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Libro_${isSales ? 'Ventas' : 'Compras'}_SENIAT_${selectedYear}_${selectedMonth}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(`Libro de ${isSales ? 'Ventas' : 'Compras'} exportado a formato tabular SENIAT`);
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 overflow-y-auto custom-scrollbar pb-24 sm:pb-8 pb-safe">
            <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-4 sm:space-y-6">

                {/* Page Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold shrink-0">
                                <FileSpreadsheet size={24} />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                                    Gestión Fiscal & SENIAT
                                </h1>
                                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                    Libros de Compras y Ventas oficiales, comprobantes de retención y declaración tributaria
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Period Controls & Quick Actions */}
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
                        {/* Month Selector */}
                        <div className="col-span-2 sm:col-span-1 flex items-center justify-between sm:justify-start gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-1 shadow-sm min-h-[44px]">
                            <select
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                                className="bg-transparent text-base sm:text-xs font-black text-slate-800 dark:text-white outline-none px-2 py-1 cursor-pointer flex-1 sm:flex-none"
                            >
                                {MONTHS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                            <select
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                className="bg-transparent text-base sm:text-xs font-black text-slate-800 dark:text-white outline-none px-2 py-1 cursor-pointer border-l border-slate-200 dark:border-white/10 flex-1 sm:flex-none"
                            >
                                {[2024, 2025, 2026, 2027].map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>

                        {/* Export Button */}
                        {(activeTab === 'sales' || activeTab === 'purchases') && (
                            <button
                                onClick={handleExportCSV}
                                className="min-h-[44px] px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
                                title="Exportar libro en formato oficial para contador"
                            >
                                <Download size={14} className="text-primary-500 shrink-0" />
                                <span className="truncate">Exportar</span>
                            </button>
                        )}

                        {/* Credit Note Trigger */}
                        <button
                            onClick={() => setIsCreditNoteModalOpen(true)}
                            className="min-h-[44px] px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                        >
                            <Plus size={14} className="shrink-0" />
                            <span className="truncate">Nota de Crédito</span>
                        </button>

                        {/* Manual Record Trigger */}
                        <button
                            onClick={() => {
                                setManualForm(prev => ({
                                    ...prev,
                                    bookType: activeTab === 'purchases' ? 'COMPRAS' : 'VENTAS'
                                }));
                                setIsManualRecordModalOpen(true);
                            }}
                            className="col-span-2 sm:col-span-1 min-h-[44px] px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm shadow-primary-500/20 active:scale-95"
                        >
                            <Plus size={16} className="shrink-0" />
                            <span>+ Registro Manual</span>
                        </button>
                    </div>
                </div>

                {/* Tabs Navigation */}
                <div className="flex overflow-x-auto no-scrollbar border-b border-slate-200 dark:border-white/10 space-x-1 sm:space-x-2 text-xs font-black pb-0.5">
                    <button
                        onClick={() => setActiveTab('sales')}
                        className={`min-h-[44px] shrink-0 pb-3 px-3.5 transition-all cursor-pointer flex items-center gap-2 active:scale-95 ${
                            activeTab === 'sales' 
                                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400' 
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        <FileText size={16} className="shrink-0" />
                        <span>Libro de Ventas</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500">
                            {salesBook.records.length}
                        </span>
                    </button>

                    <button
                        onClick={() => setActiveTab('purchases')}
                        className={`min-h-[44px] shrink-0 pb-3 px-3.5 transition-all cursor-pointer flex items-center gap-2 active:scale-95 ${
                            activeTab === 'purchases' 
                                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400' 
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        <FileSpreadsheet size={16} className="shrink-0" />
                        <span>Libro de Compras</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500">
                            {purchasesBook.records.length}
                        </span>
                    </button>

                    <button
                        onClick={() => setActiveTab('retentions')}
                        className={`min-h-[44px] shrink-0 pb-3 px-3.5 transition-all cursor-pointer flex items-center gap-2 active:scale-95 ${
                            activeTab === 'retentions' 
                                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400' 
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        <ShieldAlert size={16} className="shrink-0" />
                        <span>Comprobantes de Retención</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500">
                            {retentions.length}
                        </span>
                    </button>

                    <button
                        onClick={() => setActiveTab('summary')}
                        className={`min-h-[44px] shrink-0 pb-3 px-3.5 transition-all cursor-pointer flex items-center gap-2 active:scale-95 ${
                            activeTab === 'summary' 
                                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400' 
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        <Calculator size={16} className="shrink-0" />
                        <span>Resumen Impositivo</span>
                    </button>

                    <button
                        onClick={() => {
                            setActiveTab('hardware');
                            fetchDevices();
                        }}
                        className={`min-h-[44px] shrink-0 pb-3 px-3.5 transition-all cursor-pointer flex items-center gap-2 active:scale-95 ${
                            activeTab === 'hardware' 
                                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400' 
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        <Printer size={16} className="shrink-0" />
                        <span>Máquina Fiscal (Hardware)</span>
                    </button>
                </div>

                {/* TAB 1: LIBRO DE VENTAS */}
                {activeTab === 'sales' && (
                    <div className="space-y-4">
                        {/* KPI Bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Facturado</span>
                                <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white tabular-nums">
                                    {formatVesBook(salesBook.totals.totalVentas || 0)}
                                </span>
                            </div>
                            <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Base Imponible</span>
                                <span className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                    {formatVesBook(salesBook.totals.totalBaseImponible || 0)}
                                </span>
                            </div>
                            <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-primary-500 block">Débito Fiscal (16%)</span>
                                <span className="text-base sm:text-lg font-black text-primary-600 dark:text-primary-400 tabular-nums">
                                    {formatVesBook(salesBook.totals.totalDebitoFiscal || 0)}
                                </span>
                            </div>
                            <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Ventas Exentas</span>
                                <span className="text-base sm:text-lg font-black text-slate-700 dark:text-slate-300 tabular-nums">
                                    {formatVesBook(salesBook.totals.totalExento || 0)}
                                </span>
                            </div>
                            <div className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm col-span-2 sm:col-span-1">
                                <span className="text-[10px] font-black uppercase tracking-wider text-amber-500 block">IGTF (3% Divisas)</span>
                                <span className="text-base sm:text-lg font-black text-amber-500 tabular-nums">
                                    {formatVesBook(salesBook.totals.totalIgtf || 0)}
                                </span>
                            </div>
                        </div>

                        {/* Search Bar */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="relative flex-1 max-w-sm">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Buscar por factura, RIF o cliente..."
                                    className="w-full min-h-[44px] pl-9 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>

                        {/* Official SENIAT Tabular Sales Table (Dual View) */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
                            {/* Mobile Cards (block md:hidden) */}
                            <div className="block md:hidden divide-y divide-slate-100 dark:divide-white/5">
                                {loading ? (
                                    <div className="py-12 text-center text-slate-400">
                                        <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                        <span className="text-xs">Generando Libro de Ventas SENIAT...</span>
                                    </div>
                                ) : filteredRecords.length === 0 ? (
                                    <div className="py-12 text-center text-slate-400 p-4">
                                        <FileText className="mx-auto mb-2 opacity-50" size={28} />
                                        <span className="text-xs">No hay facturas registradas en este período</span>
                                    </div>
                                ) : (
                                    filteredRecords.map((r, idx) => {
                                        const isNc = r.documentType === 'NOTA_CREDITO';
                                        return (
                                            <div 
                                                key={r.id || idx} 
                                                className={`p-4 space-y-2 ${isNc ? 'bg-rose-500/5' : ''}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        <span className="text-xs font-mono font-bold text-primary-600 dark:text-primary-400">
                                                            {r.documentNumber}
                                                        </span>
                                                        {isNc && (
                                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                                                NC
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] font-mono text-slate-400 shrink-0">
                                                        {r.recordDate}
                                                    </span>
                                                </div>

                                                <div className="space-y-0.5">
                                                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                        {r.entityName || 'Consumidor Final'}
                                                    </p>
                                                    <p className="text-[11px] font-mono text-slate-500">
                                                        RIF: {r.entityRif || 'V-00000000'}
                                                    </p>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-100 dark:border-white/5 font-mono">
                                                    <div>
                                                        <span className="text-slate-400 block text-[9px] uppercase font-sans">Base Imponible</span>
                                                        <span className="font-bold text-slate-700 dark:text-slate-300">
                                                            {formatVesBook(r.taxableBase)}
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-slate-400 block text-[9px] uppercase font-sans">IVA ({r.taxRate ?? defaultIvaPct}%)</span>
                                                        <span className="font-bold text-primary-600 dark:text-primary-400">
                                                            {formatVesBook(r.taxAmount)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
                                                    <span className="text-[10px] uppercase font-bold text-slate-400">Total Factura</span>
                                                    <span className="text-sm font-black font-mono text-slate-900 dark:text-white">
                                                        {formatVesBook(r.totalAmount)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Desktop Table (hidden md:block) */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/40 text-[10px] uppercase tracking-wider text-slate-400 font-black">
                                            <th className="py-3 px-3">Op. N°</th>
                                            <th className="py-3 px-3">Fecha</th>
                                            <th className="py-3 px-3">RIF / Cédula</th>
                                            <th className="py-3 px-3">Razón Social</th>
                                            <th className="py-3 px-3">N° Factura</th>
                                            <th className="py-3 px-3">N° Control</th>
                                            <th className="py-3 px-3">Fact. Afectada</th>
                                            <th className="py-3 px-3 text-right">Total Ventas (Bs)</th>
                                            <th className="py-3 px-3 text-right">Exento (Bs)</th>
                                            <th className="py-3 px-3 text-right">Base Imponible</th>
                                            <th className="py-3 px-3 text-center">% Alíc.</th>
                                            <th className="py-3 px-3 text-right">IVA Débito</th>
                                            <th className="py-3 px-3 text-right">IGTF (3%)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono text-[11px]">
                                        {loading ? (
                                            <tr>
                                                <td colSpan="13" className="py-12 text-center text-slate-400 font-sans">
                                                    <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                                    <span>Generando Libro de Ventas SENIAT...</span>
                                                </td>
                                            </tr>
                                        ) : filteredRecords.length === 0 ? (
                                            <tr>
                                                <td colSpan="13" className="py-12 text-center text-slate-400 font-sans">
                                                    <FileText className="mx-auto mb-2 opacity-50" size={28} />
                                                    <span>No hay facturas registradas en este período</span>
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredRecords.map((r, idx) => {
                                                const isNc = r.documentType === 'NOTA_CREDITO';
                                                return (
                                                    <tr 
                                                        key={r.id || idx}
                                                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                                            isNc ? 'bg-rose-500/5 text-rose-600 dark:text-rose-400 font-bold' : ''
                                                        }`}
                                                    >
                                                        <td className="py-3 px-3 text-slate-400">{idx + 1}</td>
                                                        <td className="py-3 px-3 whitespace-nowrap">{r.recordDate}</td>
                                                        <td className="py-3 px-3">{r.entityRif || 'V-00000000'}</td>
                                                        <td className="py-3 px-3 font-sans font-bold text-slate-800 dark:text-white truncate max-w-[160px]">
                                                            {r.entityName || 'Consumidor Final'}
                                                        </td>
                                                        <td className="py-3 px-3 font-bold text-primary-600 dark:text-primary-400">
                                                            {r.documentNumber}
                                                        </td>
                                                        <td className="py-3 px-3 text-slate-500">{r.controlNumber || '-'}</td>
                                                        <td className="py-3 px-3 text-slate-500">{r.affectedInvoiceNumber || '-'}</td>
                                                        <td className="py-3 px-3 text-right font-black tabular-nums">
                                                            {formatVesBook(r.totalAmount)}
                                                        </td>
                                                        <td className="py-3 px-3 text-right tabular-nums text-slate-400">
                                                            {formatVesBook(r.exemptAmount)}
                                                        </td>
                                                        <td className="py-3 px-3 text-right font-bold tabular-nums text-slate-700 dark:text-slate-300">
                                                            {formatVesBook(r.taxableBase)}
                                                        </td>
                                                        <td className="py-3 px-3 text-center">{r.taxRate}%</td>
                                                        <td className="py-3 px-3 text-right font-bold tabular-nums text-primary-500">
                                                            {formatVesBook(r.taxAmount)}
                                                        </td>
                                                        <td className="py-3 px-3 text-right tabular-nums text-amber-500">
                                                            {Number(r.igtfAmount) > 0 ? formatVesBook(r.igtfAmount) : '-'}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: LIBRO DE COMPRAS */}
                {activeTab === 'purchases' && (
                    <div className="space-y-4">
                        {/* KPI Bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Compras</span>
                                <span className="text-lg font-black text-slate-900 dark:text-white tabular-nums">
                                    {formatVesBook(purchasesBook.totals.totalCompras || 0)}
                                </span>
                            </div>
                            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Base Imponible</span>
                                <span className="text-lg font-black text-blue-600 dark:text-blue-400 tabular-nums">
                                    {formatVesBook(purchasesBook.totals.totalBaseImponible || 0)}
                                </span>
                            </div>
                            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500 block">Crédito Fiscal (IVA 16%)</span>
                                <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                    {formatVesBook(purchasesBook.totals.totalCreditoFiscal || 0)}
                                </span>
                            </div>
                            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm">
                                <span className="text-[10px] font-black uppercase tracking-wider text-rose-500 block">Retenciones Aplicadas (75%)</span>
                                <span className="text-lg font-black text-rose-500 tabular-nums">
                                    {formatVesBook(purchasesBook.totals.totalIvaRetenido || 0)}
                                </span>
                            </div>
                        </div>

                        {/* Search Bar */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="relative flex-1 max-w-sm">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Buscar por factura o proveedor..."
                                    className="w-full min-h-[44px] pl-9 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl text-base sm:text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>

                        {/* Tabular Purchases Table & Mobile Cards */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
                            {/* Mobile Card List (block md:hidden) */}
                            <div className="block md:hidden divide-y divide-slate-100 dark:divide-white/5">
                                {loading ? (
                                    <div className="py-12 text-center text-slate-400">
                                        <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                        <span className="text-xs">Generando Libro de Compras SENIAT...</span>
                                    </div>
                                ) : filteredRecords.length === 0 ? (
                                    <div className="py-12 text-center text-slate-400">
                                        <FileSpreadsheet className="mx-auto mb-2 opacity-50" size={28} />
                                        <span className="text-xs">No hay compras registradas en este período</span>
                                    </div>
                                ) : (
                                    filteredRecords.map((r, idx) => (
                                        <div key={r.id || idx} className="p-3.5 space-y-2.5">
                                            <div className="flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-1.5 font-mono text-slate-400">
                                                    <span className="font-bold text-slate-500">#{idx + 1}</span>
                                                    <span>•</span>
                                                    <span>{r.recordDate}</span>
                                                </div>
                                                <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono text-xs">
                                                    {r.documentNumber}
                                                </span>
                                            </div>

                                            <div>
                                                <h4 className="text-sm font-black text-slate-800 dark:text-white truncate">
                                                    {r.entityName || 'Proveedor'}
                                                </h4>
                                                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                                                    <span>{r.entityRif || 'J-00000000-0'}</span>
                                                    {r.controlNumber && (
                                                        <>
                                                            <span>•</span>
                                                            <span>Ctrl: {r.controlNumber}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-100 dark:border-white/5 font-mono">
                                                <div>
                                                    <span className="text-slate-400 block text-[9px] uppercase font-sans">Base Imponible</span>
                                                    <span className="font-bold text-slate-700 dark:text-slate-300">
                                                        {formatVesBook(r.taxableBase)}
                                                    </span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-slate-400 block text-[9px] uppercase font-sans">IVA Crédito ({r.taxRate}%)</span>
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                                        {formatVesBook(r.taxAmount)}
                                                    </span>
                                                </div>
                                            </div>

                                            {Number(r.retainedIvaAmount) > 0 && (
                                                <div className="flex items-center justify-between text-[11px] font-mono bg-rose-50 dark:bg-rose-500/10 px-2.5 py-1 rounded-lg">
                                                    <span className="text-rose-600 dark:text-rose-400 text-[10px] uppercase font-sans font-bold">Retención IVA</span>
                                                    <span className="font-black text-rose-600 dark:text-rose-400">
                                                        -{formatVesBook(r.retainedIvaAmount)}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
                                                <span className="text-[10px] uppercase font-bold text-slate-400">Total Compra</span>
                                                <span className="text-sm font-black font-mono text-slate-900 dark:text-white">
                                                    {formatVesBook(r.totalAmount)}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Desktop Table (hidden md:block) */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/40 text-[10px] uppercase tracking-wider text-slate-400 font-black">
                                            <th className="py-3 px-3">Op. N°</th>
                                            <th className="py-3 px-3">Fecha</th>
                                            <th className="py-3 px-3">RIF Proveedor</th>
                                            <th className="py-3 px-3">Razón Social</th>
                                            <th className="py-3 px-3">N° Factura</th>
                                            <th className="py-3 px-3">N° Control</th>
                                            <th className="py-3 px-3 text-right">Total Compras (Bs)</th>
                                            <th className="py-3 px-3 text-right">Exento (Bs)</th>
                                            <th className="py-3 px-3 text-right">Base Imponible</th>
                                            <th className="py-3 px-3 text-center">% Alíc.</th>
                                            <th className="py-3 px-3 text-right">IVA Crédito</th>
                                            <th className="py-3 px-3 text-right">Retención (75%)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono text-[11px]">
                                        {loading ? (
                                            <tr>
                                                <td colSpan="12" className="py-12 text-center text-slate-400 font-sans">
                                                    <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                                    <span>Generando Libro de Compras SENIAT...</span>
                                                </td>
                                            </tr>
                                        ) : filteredRecords.length === 0 ? (
                                            <tr>
                                                <td colSpan="12" className="py-12 text-center text-slate-400 font-sans">
                                                    <FileSpreadsheet className="mx-auto mb-2 opacity-50" size={28} />
                                                    <span>No hay compras registradas en este período</span>
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredRecords.map((r, idx) => (
                                                <tr key={r.id || idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                                    <td className="py-3 px-3 text-slate-400">{idx + 1}</td>
                                                    <td className="py-3 px-3 whitespace-nowrap">{r.recordDate}</td>
                                                    <td className="py-3 px-3">{r.entityRif || 'J-00000000-0'}</td>
                                                    <td className="py-3 px-3 font-sans font-bold text-slate-800 dark:text-white truncate max-w-[160px]">
                                                        {r.entityName || 'Proveedor'}
                                                    </td>
                                                    <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">
                                                        {r.documentNumber}
                                                    </td>
                                                    <td className="py-3 px-3 text-slate-500">{r.controlNumber || '-'}</td>
                                                    <td className="py-3 px-3 text-right font-black tabular-nums">
                                                        {formatVesBook(r.totalAmount)}
                                                    </td>
                                                    <td className="py-3 px-3 text-right tabular-nums text-slate-400">
                                                        {formatVesBook(r.exemptAmount)}
                                                    </td>
                                                    <td className="py-3 px-3 text-right font-bold tabular-nums text-slate-700 dark:text-slate-300">
                                                        {formatVesBook(r.taxableBase)}
                                                    </td>
                                                    <td className="py-3 px-3 text-center">{r.taxRate}%</td>
                                                    <td className="py-3 px-3 text-right font-bold tabular-nums text-emerald-500">
                                                        {formatVesBook(r.taxAmount)}
                                                    </td>
                                                    <td className="py-3 px-3 text-right tabular-nums text-rose-500 font-bold">
                                                        {Number(r.retainedIvaAmount) > 0 ? formatVesBook(r.retainedIvaAmount) : '-'}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: COMPROBANTES DE RETENCION */}
                {activeTab === 'retentions' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">
                                Comprobantes de Retención de IVA e ISLR
                            </h2>
                            <button
                                onClick={() => setIsRetentionModalOpen(true)}
                                className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shadow-sm shadow-primary-500/20"
                            >
                                <Plus size={16} />
                                <span>Emitir Comprobante</span>
                            </button>
                        </div>

                        {retentions.length === 0 ? (
                            <div className="p-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-center space-y-3">
                                <ShieldAlert size={36} className="mx-auto text-primary-500 opacity-60" />
                                <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                                    No hay comprobantes de retención emitidos en este período
                                </h3>
                                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                                    Emite comprobantes de retención del 75% o 100% de IVA a tus proveedores para generar el correlativo oficial exigido por el SENIAT.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {retentions.map(ret => (
                                    <div 
                                        key={ret.id}
                                        className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm space-y-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400">
                                                {ret.retentionType} ({ret.retentionPercentage}%)
                                            </span>
                                            <span className="text-xs font-mono font-bold text-slate-400">
                                                {ret.voucherNumber}
                                            </span>
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-black text-slate-800 dark:text-white truncate">
                                                {ret.entityName}
                                            </h4>
                                            <span className="text-xs text-slate-400 font-mono">
                                                {ret.entityRif}
                                            </span>
                                        </div>

                                        <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-xs">
                                            <span className="text-slate-400">Factura Afectada:</span>
                                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                                                {ret.invoiceNumber}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-400">Monto Retenido:</span>
                                            <span className="text-base font-black text-rose-500 tabular-nums">
                                                {formatVesBook(ret.retainedAmount)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 4: RESUMEN IMPOSITIVO & DECLARACION */}
                {activeTab === 'summary' && (
                    <div className="space-y-6">
                        {taxSummary ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Tax Comparison Card */}
                                <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center font-bold">
                                            <Calculator size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-black text-slate-900 dark:text-white">
                                                Liquidación Impositiva de IVA
                                            </h3>
                                            <p className="text-xs text-slate-500">
                                                Cálculo de Débito Fiscal vs Crédito Fiscal para el período fiscal {selectedMonth}/{selectedYear}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-2 text-xs divide-y divide-slate-100 dark:divide-white/5 font-sans">
                                        <div className="flex justify-between py-1.5">
                                            <span className="text-slate-500 font-bold">Total Débito Fiscal (IVA en Ventas):</span>
                                            <span className="font-mono font-black text-primary-500 tabular-nums text-sm">
                                                +{formatVesBook(taxSummary.debitoFiscal)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between py-1.5">
                                            <span className="text-slate-500 font-bold">(-) Total Crédito Fiscal (IVA en Compras):</span>
                                            <span className="font-mono font-black text-emerald-500 tabular-nums text-sm">
                                                -{formatVesBook(taxSummary.creditoFiscal)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between py-2 border-t-2 border-slate-200 dark:border-white/10 font-bold">
                                            <span className="text-slate-800 dark:text-white">(=) Cuota Tributaria Preliminar:</span>
                                            <span className={`font-mono font-black tabular-nums text-sm ${
                                                taxSummary.balanceIva > 0 ? 'text-rose-500' : 'text-emerald-500'
                                            }`}>
                                                {formatVesBook(taxSummary.balanceIva)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between py-1.5">
                                            <span className="text-slate-500">(-) Retenciones de IVA del período:</span>
                                            <span className="font-mono font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                                -{formatVesBook(taxSummary.retencionesIvaRecibidas)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between py-3 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl">
                                            <div>
                                                <span className="font-black text-slate-900 dark:text-white text-sm block">
                                                    {taxSummary.impuestoPorPagarIva > 0 ? 'Total IVA a Pagar al SENIAT' : 'Saldo a Favor Trasladable'}
                                                </span>
                                                <span className="text-[10px] text-slate-400">
                                                    Monto a ingresar en el Portal Fiscal SENIAT
                                                </span>
                                            </div>
                                            <span className={`text-xl font-black tabular-nums ${
                                                taxSummary.impuestoPorPagarIva > 0 ? 'text-rose-500' : 'text-emerald-500'
                                            }`}>
                                                {formatVesBook(taxSummary.impuestoPorPagarIva > 0 ? taxSummary.impuestoPorPagarIva : taxSummary.saldoAFavorIva)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* IGTF & Fiscal Obligations Card */}
                                <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
                                            <DollarSign size={22} />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-black text-slate-900 dark:text-white">
                                                IGTF & Obligaciones Especiales
                                            </h3>
                                            <p className="text-xs text-slate-500">
                                                Impuesto a las Grandes Transacciones Financieras percibido en divisas
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-2 text-xs divide-y divide-slate-100 dark:divide-white/5">
                                        <div className="flex justify-between py-2">
                                            <span className="text-slate-500 font-bold">Total IGTF 3% Percibido en Efectivo Divisas:</span>
                                            <span className="font-mono font-black text-amber-500 tabular-nums text-sm">
                                                {formatVesBook(taxSummary.igtfPorEnterar)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between py-2">
                                            <span className="text-slate-500 font-bold">Ventas Brutas del Período:</span>
                                            <span className="font-mono font-bold text-slate-800 dark:text-white tabular-nums">
                                                {formatVesBook(taxSummary.ventasTotales)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between py-2">
                                            <span className="text-slate-500 font-bold">Compras Brutas del Período:</span>
                                            <span className="font-mono font-bold text-slate-800 dark:text-white tabular-nums">
                                                {formatVesBook(taxSummary.comprasTotales)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                                        <div className="flex items-center gap-1.5 font-bold">
                                            <Info size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                            <span>Recordatorio Tributario SENIAT</span>
                                        </div>
                                        <p className="text-[11px] leading-relaxed">
                                            Las retenciones de IVA e IGTF percibido deben ser enteradas quincenalmente según el calendario oficial de Sujetos Pasivos Especiales de acuerdo al último dígito del RIF.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="py-12 text-center text-slate-400">
                                <RefreshCw className="animate-spin text-primary-500 mx-auto mb-2" size={24} />
                                <span>Calculando resumen impositivo del período...</span>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 5: MÁQUINA E IMPRESORA FISCAL (HARDWARE) */}
                {activeTab === 'hardware' && (
                    <div className="space-y-6">
                        {/* Header Box */}
                        <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                    <Printer className="text-slate-700 dark:text-slate-300" size={22} />
                                    Protocolo Nativo de Impresora Fiscal Homologada
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                                    Comunicación directa por puerto COM / RS232 / USB y WinSpool con impresoras fiscales (The Factory HKA, Bixolon SRP-350 / 812, Custom, BMC, Dascom). Emisión oficial de Reportes X y Z para cumplimiento tributario SENIAT.
                                </p>
                            </div>
                            <button
                                onClick={fetchDevices}
                                disabled={detectingDevices}
                                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm flex items-center justify-center gap-2 active:scale-95 shrink-0 transition-all cursor-pointer"
                            >
                                <RefreshCw size={15} className={detectingDevices ? 'animate-spin text-primary-500' : 'text-slate-400'} />
                                <span>{detectingDevices ? 'Escaneando...' : 'Escanear Puertos'}</span>
                            </button>
                        </div>

                        {/* Configuration & Controls Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Col 1: Configuración de Conexión */}
                            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm space-y-4">
                                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                    <Settings2 size={14} className="text-slate-500" />
                                    <span>Conexión y Puerto Fiscal</span>
                                </h4>

                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Modo de Conexión
                                    </label>
                                    <select
                                        value={fiscalConfig.targetType}
                                        onChange={(e) => updateFiscalConfig({ targetType: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        <option value="com">Puerto Serial COM / RS232 / USB</option>
                                        <option value="printer">Cola de Impresión Windows (WinSpool RAW)</option>
                                        <option value="spooler_file">Archivo Spooler (The Factory HKA / Bixolon)</option>
                                    </select>
                                </div>

                                {fiscalConfig.targetType === 'com' && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                Puerto COM
                                            </label>
                                            <select
                                                value={fiscalConfig.targetPort}
                                                onChange={(e) => updateFiscalConfig({ targetPort: e.target.value })}
                                                className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                            >
                                                {devices.comPorts.map(port => (
                                                    <option key={port} value={port}>{port}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                                Velocidad en Baudios (Baud Rate)
                                            </label>
                                            <select
                                                value={fiscalConfig.baudRate}
                                                onChange={(e) => updateFiscalConfig({ baudRate: Number(e.target.value) })}
                                                className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                            >
                                                <option value={9600}>9600 Baudios (Estándar HKA / Bixolon)</option>
                                                <option value={19200}>19200 Baudios (Bixolon alta velocidad)</option>
                                                <option value={38400}>38400 Baudios (BMC / Custom)</option>
                                                <option value={115200}>115200 Baudios</option>
                                            </select>
                                        </div>
                                    </>
                                )}

                                {fiscalConfig.targetType === 'printer' && (
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            Impresora Fiscal Instalada en Windows
                                        </label>
                                        <select
                                            value={fiscalConfig.targetPrinter}
                                            onChange={(e) => updateFiscalConfig({ targetPrinter: e.target.value })}
                                            className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                        >
                                            <option value="">-- Seleccionar Impresora --</option>
                                            {devices.printers.map(p => (
                                                <option key={p.name} value={p.name}>
                                                    {p.name} {p.isDefault ? '(Predeterminada)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {fiscalConfig.targetType === 'spooler_file' && (
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                            Ruta del Archivo Spooler
                                        </label>
                                        <input
                                            type="text"
                                            value={fiscalConfig.spoolerPath}
                                            onChange={(e) => updateFiscalConfig({ spoolerPath: e.target.value })}
                                            placeholder="C:\IntTFHKA\Factura.txt"
                                            className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                        />
                                    </div>
                                )}

                                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                                    <div className="flex items-center gap-1.5 font-bold">
                                        <Activity size={13} className="text-slate-500" />
                                        <span>Estado Actual:</span>
                                    </div>
                                    <span>Destino: <strong>{fiscalConfig.targetType.toUpperCase()}</strong> ({fiscalConfig.targetPort || fiscalConfig.targetPrinter || fiscalConfig.spoolerPath})</span>
                                </div>
                            </div>

                            {/* Col 2 & 3: Botones de Acción Fiscal Directa & Consola */}
                            <div className="lg:col-span-2 space-y-4">
                                {/* Action Buttons Panel */}
                                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 shadow-sm space-y-4">
                                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <FileText size={14} className="text-slate-500" />
                                            <span>Operaciones Fiscales de Caja</span>
                                        </div>
                                        {executingFiscalAction && (
                                            <span className="text-primary-500 text-[10px] font-bold flex items-center gap-1">
                                                <RefreshCw size={12} className="animate-spin" /> Transmitiendo comando...
                                            </span>
                                        )}
                                    </h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* REPORTE X */}
                                        <div className="p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 transition-all flex flex-col justify-between space-y-3">
                                            <div>
                                                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-black text-sm">
                                                    <FileText size={18} />
                                                    <span>Reporte X (Lectura Diaria)</span>
                                                </div>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                                    Imprime la lectura parcial de ventas, impuestos acumulados e IGTF del día sin cerrar la memoria fiscal.
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleFiscalAction('REPORTE_X', 'Reporte X')}
                                                disabled={executingFiscalAction}
                                                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                            >
                                                <Printer size={16} />
                                                <span>Emitir Reporte X</span>
                                            </button>
                                        </div>

                                        {/* REPORTE Z */}
                                        <div className="p-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 transition-all flex flex-col justify-between space-y-3">
                                            <div>
                                                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-black text-sm">
                                                    <ShieldAlert size={18} />
                                                    <span>Reporte Z (Cierre Diario Definitivo)</span>
                                                </div>
                                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                                    Realiza el cierre fiscal diario obligatorio SENIAT, corta las ventas del día y actualiza la memoria de auditoría.
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleFiscalAction('REPORTE_Z', 'Reporte Z (Cierre Definitivo)')}
                                                disabled={executingFiscalAction}
                                                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                                            >
                                                <Printer size={16} />
                                                <span>Emitir Cierre Z</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Action Emergency Button */}
                                    <div className="pt-2 flex justify-end">
                                        <button
                                            onClick={() => handleFiscalAction('CANCELAR', 'Cancelar Documento')}
                                            disabled={executingFiscalAction}
                                            className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-white/10 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:border-rose-500/30 flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                                        >
                                            <AlertTriangle size={14} className="text-amber-500" />
                                            <span>Desbloquear / Cancelar Documento Fiscal</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Live Terminal Logs */}
                                <div className="p-5 rounded-2xl bg-slate-900 border border-white/10 shadow-sm space-y-2 text-xs font-mono">
                                    <div className="flex items-center justify-between text-slate-400 border-b border-white/10 pb-2">
                                        <span className="font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                                            <Terminal size={13} className="text-slate-400" />
                                            <span>Registro de Comunicación Fiscal</span>
                                        </span>
                                        <span className="text-[10px]">{fiscalLogs.length} eventos registrados</span>
                                    </div>

                                    <div className="max-h-48 overflow-y-auto space-y-1.5 pt-1 custom-scrollbar">
                                        {fiscalLogs.length === 0 ? (
                                            <p className="text-slate-500 italic py-4 text-center">
                                                No hay transmisiones fiscales registradas en esta sesión.
                                            </p>
                                        ) : (
                                            fiscalLogs.map((log, idx) => (
                                                <div key={idx} className="flex items-start gap-2 text-[11px] py-0.5">
                                                    <span className="text-slate-500 shrink-0">[{log.time}]</span>
                                                    <span className={`px-1.5 py-0.2 rounded font-bold text-[9px] shrink-0 ${log.status === 'OK' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
                                                        {log.status}
                                                    </span>
                                                    <span className="font-bold text-slate-200 shrink-0">{log.action}:</span>
                                                    <span className="text-slate-400 break-all">{log.details}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {/* Modal: Manual Fiscal Record */}
            {isManualRecordModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[92dvh] sm:max-h-[90vh] flex flex-col pb-safe">
                        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <Plus size={18} className="text-primary-500" />
                                Registrar Documento en Libro Fiscal
                            </h3>
                            <button
                                onClick={() => setIsManualRecordModalOpen(false)}
                                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl active:scale-95"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveManualRecord} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Libro Destino *
                                    </label>
                                    <select
                                        value={manualForm.bookType}
                                        onChange={(e) => setManualForm({ ...manualForm, bookType: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        <option value="VENTAS">Libro de Ventas</option>
                                        <option value="COMPRAS">Libro de Compras</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Tipo de Documento *
                                    </label>
                                    <select
                                        value={manualForm.documentType}
                                        onChange={(e) => setManualForm({ ...manualForm, documentType: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        <option value="FACTURA">Factura</option>
                                        <option value="NOTA_CREDITO">Nota de Crédito</option>
                                        <option value="NOTA_DEBITO">Nota de Débito</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Fecha *
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={manualForm.recordDate}
                                        onChange={(e) => setManualForm({ ...manualForm, recordDate: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        N° Documento *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={manualForm.documentNumber}
                                        onChange={(e) => setManualForm({ ...manualForm, documentNumber: e.target.value })}
                                        placeholder="0001892"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        N° Control
                                    </label>
                                    <input
                                        type="text"
                                        value={manualForm.controlNumber}
                                        onChange={(e) => setManualForm({ ...manualForm, controlNumber: e.target.value })}
                                        placeholder="00-01923"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        RIF / Cédula *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={manualForm.entityRif}
                                        onChange={(e) => setManualForm({ ...manualForm, entityRif: e.target.value })}
                                        placeholder="J-12345678-0"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Nombre / Razón Social *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={manualForm.entityName}
                                        onChange={(e) => setManualForm({ ...manualForm, entityName: e.target.value })}
                                        placeholder="Empresa o Persona"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Base Imponible (Bs) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={manualForm.taxableBase}
                                        onChange={(e) => {
                                            const base = Number(e.target.value) || 0;
                                            const taxPct = Number(manualForm.taxRate || defaultIvaPct) || 0;
                                            const tax = base * (taxPct / 100);
                                            setManualForm({
                                                ...manualForm,
                                                taxableBase: e.target.value,
                                                taxAmount: tax.toFixed(2),
                                                totalAmount: (base + tax + (Number(manualForm.exemptAmount) || 0)).toFixed(2)
                                            });
                                        }}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        IVA 16% (Bs)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={manualForm.taxAmount}
                                        onChange={(e) => setManualForm({ ...manualForm, taxAmount: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Total General (Bs) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={manualForm.totalAmount}
                                        onChange={(e) => setManualForm({ ...manualForm, totalAmount: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-black text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsManualRecordModalOpen(false)}
                                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl flex items-center justify-center active:scale-95"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="w-full sm:w-auto min-h-[48px] px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-primary-500/20 active:scale-95"
                                >
                                    {saving ? <RefreshCw className="animate-spin" size={14} /> : null}
                                    <span>Guardar en Libro Fiscal</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Tax Retention Voucher */}
            {isRetentionModalOpen && (
                <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 max-h-[92dvh] sm:max-h-[90vh] flex flex-col pb-safe">
                        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
                            <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                                <ShieldAlert size={18} className="text-primary-500" />
                                Emitir Comprobante de Retención de IVA
                            </h3>
                            <button
                                onClick={() => setIsRetentionModalOpen(false)}
                                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl active:scale-95"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveRetention} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Tipo de Retención
                                    </label>
                                    <select
                                        value={retentionForm.retentionType}
                                        onChange={(e) => setRetentionForm({ 
                                            ...retentionForm, 
                                            retentionType: e.target.value,
                                            retentionPercentage: e.target.value === 'IVA_100' ? '100' : '75'
                                        })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    >
                                        <option value="IVA_75">Retención IVA 75% (General)</option>
                                        <option value="IVA_100">Retención IVA 100%</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Fecha de Emisión *
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={retentionForm.recordDate}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, recordDate: e.target.value })}
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        RIF del Proveedor *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={retentionForm.entityRif}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, entityRif: e.target.value })}
                                        placeholder="J-12345678-0"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Nombre / Razón Social *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={retentionForm.entityName}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, entityName: e.target.value })}
                                        placeholder="Proveedor C.A."
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        N° Factura del Proveedor *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={retentionForm.invoiceNumber}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, invoiceNumber: e.target.value })}
                                        placeholder="Ej. 000842"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        N° Control de Factura
                                    </label>
                                    <input
                                        type="text"
                                        value={retentionForm.controlNumber}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, controlNumber: e.target.value })}
                                        placeholder="00-00842"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Base Imponible (Bs) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={retentionForm.baseAmount}
                                        onChange={(e) => {
                                            const base = Number(e.target.value) || 0;
                                            const tax = base * (defaultIvaPct / 100);
                                            const pct = Number(retentionForm.retentionPercentage) / 100;
                                            setRetentionForm({
                                                ...retentionForm,
                                                baseAmount: e.target.value,
                                                taxAmount: tax.toFixed(2),
                                                retainedAmount: (tax * pct).toFixed(2),
                                                invoiceTotalAmount: (base + tax).toFixed(2)
                                            });
                                        }}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        Impuesto IVA (Bs)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={retentionForm.taxAmount}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, taxAmount: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                                        IVA Retenido ({retentionForm.retentionPercentage}%) *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        value={retentionForm.retainedAmount}
                                        onChange={(e) => setRetentionForm({ ...retentionForm, retainedAmount: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full min-h-[42px] bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-white/10 rounded-xl px-3 py-2 text-base sm:text-xs font-black text-rose-500 focus:ring-2 focus:ring-primary-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsRetentionModalOpen(false)}
                                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl flex items-center justify-center active:scale-95"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="w-full sm:w-auto min-h-[48px] px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-primary-500/20 active:scale-95"
                                >
                                    {saving ? <RefreshCw className="animate-spin" size={14} /> : null}
                                    <span>Emitir Comprobante</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Credit Note Modal */}
            <CreditNoteModal
                isOpen={isCreditNoteModalOpen}
                onClose={() => setIsCreditNoteModalOpen(false)}
                onCreated={() => loadFiscalData()}
            />

            {/* Confirm Modal */}
            <ConfirmModal
                isOpen={confirmConfig.isOpen}
                onClose={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmConfig.action}
                title={confirmConfig.title}
                message={confirmConfig.message}
                variant={confirmConfig.variant || 'danger'}
                confirmText={confirmConfig.confirmText || 'Confirmar'}
                cancelText={confirmConfig.cancelText || 'Cancelar'}
            />
        </div>
    );
}
