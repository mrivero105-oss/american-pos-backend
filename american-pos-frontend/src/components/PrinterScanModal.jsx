import { useState, useEffect } from 'react';
import { Printer, RefreshCw, X, Play, Loader2, CheckCircle2, ShieldCheck, FileScan, Sliders, Wifi } from 'lucide-react';
import BaseModal from './BaseModal';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function PrinterScanModal({ isOpen, onClose, onScan, isScanning }) {
    const [scanners, setScanners] = useState([]);
    const [isLoadingDevices, setIsLoadingDevices] = useState(false);
    const [selectedDeviceId, setSelectedDeviceId] = useState('DEFAULT_WIA_SCANNER');
    const [dpi, setDpi] = useState('300');
    const [colorMode, setColorMode] = useState('gray');

    const fetchScanners = async () => {
        setIsLoadingDevices(true);
        try {
            const { data } = await api.get('/products/scanners');
            const list = data?.scanners || [];
            setScanners(list);

            if (list.length > 0) {
                // Pre-select first real device if available, otherwise DEFAULT_WIA_SCANNER
                const realDevice = list.find(s => s.id !== 'DEFAULT_WIA_SCANNER') || list[0];
                setSelectedDeviceId(realDevice.id);
            }
        } catch (err) {
            console.error('Error fetching scanners:', err);
            toast.error('No se pudo obtener la lista de escáneres. Se usará la detección automática.');
            setScanners([
                {
                    id: 'DEFAULT_WIA_SCANNER',
                    name: 'Selección Automática (Predeterminada)',
                    manufacturer: 'Windows WIA / eSCL',
                    type: 'GENERIC',
                    status: 'Listo'
                }
            ]);
        } finally {
            setIsLoadingDevices(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchScanners();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirmScan = () => {
        onScan({
            deviceId: selectedDeviceId,
            dpi: Number(dpi),
            colorMode
        });
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            zIndex="z-[100020]"
            maxWidth="max-w-lg"
            className="overflow-hidden flex flex-col p-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-h-[92dvh]"
        >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between relative bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className="w-10 h-10 bg-primary-500/10 text-primary-500 rounded-lg flex items-center justify-center shrink-0 border border-primary-500/20">
                        <Printer size={20} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight truncate">
                                Escáner / Impresora
                            </h3>
                            <span className="bg-primary-500/10 text-primary-600 dark:text-primary-400 text-[10px] font-semibold px-2 py-0.5 rounded border border-primary-500/20 shrink-0">
                                Multifuncional
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-normal truncate mt-0.5">
                            Selecciona el equipo para procesar la factura física
                        </p>
                    </div>
                </div>

                <button
                    onClick={onClose}
                    disabled={isScanning}
                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                    title="Cerrar ventana"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-4 sm:p-5 space-y-4 max-h-[55dvh] sm:max-h-[68dvh]">
                {/* Device Selector Header */}
                <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <FileScan size={13} className="text-primary-500" />
                        Dispositivos Detectados
                    </label>
                    <button
                        onClick={fetchScanners}
                        disabled={isLoadingDevices || isScanning}
                        className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw size={11} className={isLoadingDevices ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                </div>

                {/* Device List */}
                {isLoadingDevices ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/20">
                        <Loader2 size={22} className="animate-spin text-primary-500" />
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Buscando escáneres en red y USB...</span>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {scanners.map((sc) => {
                            const isSelected = selectedDeviceId === sc.id;
                            const isNetwork = sc.type?.includes('NET') || sc.manufacturer?.includes('eSCL') || sc.id?.includes('NET');
                            
                            return (
                                <div
                                    key={sc.id}
                                    onClick={() => !isScanning && setSelectedDeviceId(sc.id)}
                                    className={`p-3 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
                                        isSelected
                                            ? 'bg-primary-500/10 border-primary-500 text-primary-900 dark:text-primary-100 ring-1 ring-primary-500/30'
                                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                                    }`}
                                >
                                    <div className="flex items-center gap-3 min-w-0 pr-2">
                                        <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                                            isSelected ? 'bg-primary-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                                        }`}>
                                            {isNetwork ? <Wifi size={15} /> : <Printer size={15} />}
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-semibold tracking-tight truncate">
                                                {sc.name}
                                            </h4>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                                    {sc.manufacturer || 'Dispositivo'}
                                                </span>
                                                <span className="text-slate-300 dark:text-slate-600 text-[10px]">•</span>
                                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                    {sc.status || 'Disponible'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="shrink-0">
                                        {isSelected ? (
                                            <CheckCircle2 size={16} className="text-primary-600" />
                                        ) : (
                                            <div className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-600" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Scan Parameters: DPI & Color Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                            <Sliders size={12} className="text-primary-500" />
                            Resolución (DPI)
                        </label>
                        <select
                            value={dpi}
                            onChange={(e) => setDpi(e.target.value)}
                            disabled={isScanning}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-primary-500 outline-none transition-colors cursor-pointer h-10"
                        >
                            <option value="150">150 DPI (Rápido • ~15s)</option>
                            <option value="300">300 DPI (Recomendado • ~30s)</option>
                            <option value="600">600 DPI (Alta Definición • ~75s)</option>
                        </select>
                        <span className="text-[10px] text-slate-400 font-medium block mt-1">
                            {dpi === '600' ? '600 DPI toma ~75s por escaneo' : '300 DPI es óptimo para OCR de facturas'}
                        </span>
                    </div>

                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                            Modo de Color
                        </label>
                        <select
                            value={colorMode}
                            onChange={(e) => setColorMode(e.target.value)}
                            disabled={isScanning}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-primary-500 outline-none transition-colors cursor-pointer h-10"
                        >
                            <option value="gray">Escala de Grises (Óptimo y Rápido)</option>
                            <option value="color">Color Verdadero</option>
                            <option value="bw">Blanco y Negro (Texto)</option>
                        </select>
                        <span className="text-[10px] text-slate-400 font-medium block mt-1">
                            {colorMode === 'gray' ? 'Grises procesa el OCR con mayor rapidez' : 'Color captura sellos y firmas'}
                        </span>
                    </div>
                </div>

                {/* Helpful Instruction Tip */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-2.5">
                    <ShieldCheck size={16} className="text-primary-500 shrink-0" />
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-normal leading-tight">
                        Coloca la factura en el cristal del escáner y haz clic en <strong>Iniciar Escaneo</strong>.
                    </p>
                </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={isScanning}
                    className="h-10 px-4 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center"
                >
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={handleConfirmScan}
                    disabled={isScanning || isLoadingDevices}
                    className="h-10 px-5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-xs tracking-wider shadow-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                    {isScanning ? (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Escaneando...</span>
                        </>
                    ) : (
                        <>
                            <Play size={14} />
                            <span>Iniciar Escaneo</span>
                        </>
                    )}
                </button>
            </div>
        </BaseModal>
    );
}
