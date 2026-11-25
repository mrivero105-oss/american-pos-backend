import { useState, useEffect, useCallback } from 'react';
import {
  Printer, 
  Bluetooth, 
  Wifi,
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Settings2, 
  X, 
  Zap
} from 'lucide-react';
import mobilePrinterService from '../../services/mobilePrinterService';
import {
  formatCenter,
  formatLine,
  ESC_INIT_CP858,
  ESC_BOLD_ON,
  ESC_BOLD_OFF,
  ESC_ALIGN_CENTER,
  GS_CUT,
  encodeEscPosCp858
} from '../../utils/escposFormatter';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';

const readSavedPrinterConfig = () => {
  try {
    const raw = localStorage.getItem('pos_printer_config');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export default function MobileThermalPrinterModal({
  isOpen,
  onClose,
  T,
  showToast,
  businessInfo = {}
}) {
  const initialCfg = readSavedPrinterConfig();
  const [printerMode, setPrinterMode] = useState(() => (
    initialCfg.type === 'network' ? 'network' : 'bluetooth'
  ));
  const [networkIp, setNetworkIp] = useState(() => initialCfg.ip || '');
  const [networkPort, setNetworkPort] = useState(() => String(initialCfg.port || 9100));

  const [pairedPrinters, setPairedPrinters] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState(() => {
    return initialCfg.btAddress || localStorage.getItem('pos_mobile_bt_printer_last') || localStorage.getItem('pos_mobile_bt_printer') || '';
  });
  const [selectedName, setSelectedName] = useState(() => {
    return initialCfg.btName || localStorage.getItem('pos_mobile_bt_printer_name') || '';
  });
  const [paperWidth, setPaperWidth] = useState(() => {
    return localStorage.getItem('pos_mobile_paper_width') || '58mm';
  });
  const [autoPrint, setAutoPrint] = useState(() => {
    return localStorage.getItem('pos_mobile_auto_print') === 'true';
  });
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isPrintingTest, setIsPrintingTest] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    handleFieldFocusCapture,
    handleFormKeyDown
  } = useMobileKeyboardViewport({ enabled: isOpen });

  const persistPrinterConfig = useCallback((patch = {}) => {
    const current = readSavedPrinterConfig();
    const next = {
      ...current,
      type: patch.type ?? printerMode,
      ip: String(patch.ip ?? networkIp).trim(),
      port: Number(patch.port ?? networkPort) || 9100,
      btAddress: patch.btAddress ?? selectedAddress,
      btName: patch.btName ?? selectedName
    };
    try {
      localStorage.setItem('pos_printer_config', JSON.stringify(next));
    } catch {
      // Almacenamiento opcional
    }
    return next;
  }, [printerMode, networkIp, networkPort, selectedAddress, selectedName]);

  // Cargar lista de impresoras emparejadas en el sistema Android
  const loadPairedDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    setTestResult(null);
    try {
      if (mobilePrinterService.isNativePlatform()) {
        const devices = await mobilePrinterService.getPairedPrinters();
        setPairedPrinters(devices || []);

        if (!selectedAddress && devices && devices.length > 0) {
          setSelectedAddress(devices[0].address);
          setSelectedName(devices[0].name);
        }
      } else {
        setPairedPrinters([]);
      }
    } catch (err) {
      console.warn('[PrinterModal] Error al listar dispositivos:', err);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [selectedAddress]);

  useEffect(() => {
    if (isOpen && printerMode === 'bluetooth') {
      loadPairedDevices();
    }
  }, [isOpen, printerMode, loadPairedDevices]);

  if (!isOpen) return null;

  const handleSwitchMode = (nextMode) => {
    setPrinterMode(nextMode);
    setTestResult(null);
    persistPrinterConfig({ type: nextMode });
    showToast?.(nextMode === 'network' ? 'Modo Wi-Fi / Red LAN (TCP 9100) activo' : 'Modo Bluetooth térmico activo');
  };

  const handleSetPaperWidth = (width) => {
    setPaperWidth(width);
    localStorage.setItem('pos_mobile_paper_width', width);
    showToast?.(`Ancho de papel configurado en ${width}`);
  };

  const handleToggleAutoPrint = () => {
    const nextVal = !autoPrint;
    setAutoPrint(nextVal);
    localStorage.setItem('pos_mobile_auto_print', String(nextVal));
    showToast?.(nextVal ? 'Impresión automática activada' : 'Impresión automática desactivada');
  };

  const handleSelectPrinter = (device) => {
    setSelectedAddress(device.address);
    setSelectedName(device.name);
    localStorage.setItem('pos_mobile_bt_printer_last', device.address);
    localStorage.setItem('pos_mobile_bt_printer', device.address);
    localStorage.setItem('pos_mobile_bt_printer_name', device.name);
    persistPrinterConfig({ type: 'bluetooth', btAddress: device.address, btName: device.name });
    showToast?.(`Impresora seleccionada: ${device.name}`);
  };

  const handlePairWebBluetooth = async () => {
    setIsLoadingDevices(true);
    try {
      const dev = await mobilePrinterService.connectBluetooth();
      if (dev && dev.id) {
        setSelectedAddress(dev.id);
        setSelectedName(dev.name);
        localStorage.setItem('pos_mobile_bt_printer_name', dev.name);
        persistPrinterConfig({ type: 'bluetooth', btAddress: dev.id, btName: dev.name });
        showToast?.(`Impresora vinculada: ${dev.name}`);
      }
    } catch (err) {
      const msg = err?.message || 'Error desconocido al conectar impresora Bluetooth';
      setTestResult({ success: false, message: `No se pudo conectar: ${msg}` });
      showToast?.(`⚠️ No se pudo conectar: ${msg}`);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const handleSaveAndClose = () => {
    persistPrinterConfig();
    onClose();
  };

  // Imprimir Ticket de Prueba Profesional ESC/POS con codificación CP858 real (tildes y ñ limpias)
  const handlePrintTestTicket = async () => {
    setIsPrintingTest(true);
    setTestResult(null);
    persistPrinterConfig();

    const cols = paperWidth === '80mm' ? 48 : 32;
    const company = businessInfo?.name || localStorage.getItem('company_name') || 'Isaac POS';
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-VE');
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const cleanIp = String(networkIp || '').trim();
    const cleanPort = Number(networkPort) || 9100;

    const cp858Opt = { preserveCp858: true };
    let ticket = ESC_INIT_CP858;
    ticket += ESC_ALIGN_CENTER;
    ticket += ESC_BOLD_ON;
    ticket += formatCenter(company.toUpperCase(), cols, cp858Opt) + '\n';
    ticket += ESC_BOLD_OFF;
    ticket += formatCenter('PRUEBA DE IMPRESIÓN TÉRMICA', cols, cp858Opt) + '\n';
    ticket += formatCenter('--------------------------------', cols, cp858Opt) + '\n';
    ticket += formatLine('Fecha:', dateStr, cols, cp858Opt) + '\n';
    ticket += formatLine('Hora:', timeStr, cols, cp858Opt) + '\n';
    ticket += formatLine('Modo:', printerMode === 'network' ? 'Wi-Fi / LAN TCP' : 'Bluetooth SPP', cols, cp858Opt) + '\n';
    ticket += formatLine('Papel:', `${paperWidth} (${cols} col.)`, cols, cp858Opt) + '\n';
    ticket += formatLine(
      printerMode === 'network' ? 'IP:Puerto:' : 'Equipo:',
      printerMode === 'network' ? `${cleanIp}:${cleanPort}` : (selectedName || 'Genérica').substring(0, 16),
      cols,
      cp858Opt
    ) + '\n';
    ticket += formatCenter('CP858: ÁÉÍÓÚ Ññ ¡Éxito!', cols, cp858Opt) + '\n';
    ticket += formatCenter('--------------------------------', cols, cp858Opt) + '\n';
    ticket += ESC_BOLD_ON;
    ticket += formatCenter('ESTADO: CONEXIÓN EXITOSA', cols, cp858Opt) + '\n';
    ticket += ESC_BOLD_OFF;
    ticket += formatCenter('Isaac POS Mobile - 100% Operativo', cols, cp858Opt) + '\n';
    ticket += '\n\n\n\n' + GS_CUT;

    const cp858Bytes = encodeEscPosCp858(ticket);

    try {
      if (printerMode === 'network') {
        if (!cleanIp) {
          throw new Error('Ingresa la dirección IP de tu impresora térmica Wi-Fi/LAN (ej. 192.168.1.200).');
        }
        await mobilePrinterService.printNetwork(cleanIp, cleanPort, cp858Bytes);
        setTestResult({ success: true, message: `Ticket CP858 enviado por red a ${cleanIp}:${cleanPort}.` });
        showToast?.('✅ Ticket de prueba enviado a impresora Wi-Fi/Red');
      } else if (mobilePrinterService.isNativePlatform()) {
        const base64Data = mobilePrinterService.toBase64(cp858Bytes);
        const { registerPlugin } = await import('@capacitor/core');
        const PosNativeHardware = registerPlugin('PosNativeHardware');
        const res = await PosNativeHardware.printBluetooth({
          address: selectedAddress || '',
          data: base64Data
        });

        if (res?.success) {
          setTestResult({ success: true, message: 'Ticket de prueba CP858 impreso por Bluetooth.' });
          showToast?.('✅ Ticket de prueba enviado a la impresora');
        } else {
          setTestResult({ success: false, message: 'La impresora no respondió. Verifica que esté encendida.' });
        }
      } else {
        await mobilePrinterService.printBluetooth(cp858Bytes);
        setTestResult({ success: true, message: 'Ticket de prueba CP858 impreso vía Web Bluetooth.' });
        showToast?.('✅ Ticket de prueba enviado a la impresora');
      }
    } catch (err) {
      console.error('[PrinterTest] Error:', err);
      const defaultHint = printerMode === 'network'
        ? 'Verifica que la impresora esté encendida, en la misma red Wi-Fi/LAN y acepte puerto TCP 9100.'
        : 'Verifica que la impresora esté encendida y emparejada en los ajustes de Bluetooth de Android.';
      setTestResult({ 
        success: false, 
        message: `Error de comunicación: ${err.message || defaultHint}` 
      });
    } finally {
      setIsPrintingTest(false);
    }
  };

  const isConfigured = printerMode === 'network' ? Boolean(String(networkIp || '').trim()) : Boolean(selectedAddress);

  return (
    <div
      className="fixed inset-0 bg-black/85 z-[9999] flex items-end sm:items-center justify-center p-2 sm:p-4 animate-fadeIn overflow-y-auto"
      style={modalOverlayStyle}
    >
      <div
        className={`w-full max-w-md ${T?.cardBg || 'bg-slate-900'} rounded-2xl sm:rounded-xl border ${T?.border || 'border-slate-800'} shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] my-auto`}
        style={modalCardMaxHeightStyle}
      >
        
        {/* Cabecera */}
        <div className={`p-4 border-b ${T?.border || 'border-slate-800'} flex items-center justify-between shrink-0 bg-slate-950/40`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/15 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
              <Printer size={20} />
            </div>
            <div>
              <h3 className={`font-bold text-sm sm:text-base ${T?.textPrimary || 'text-white'}`}>
                Impresora Térmica ESC/POS
              </h3>
              <p className={`text-[10px] ${T?.textMuted || 'text-slate-400'}`}>
                Bluetooth portátil o Wi-Fi / Red LAN (TCP 9100 • CP858)
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={handleSaveAndClose}
            className={`p-2 rounded-lg ${T?.btnGhost || 'text-slate-400 hover:text-white'} cursor-pointer active:scale-95`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Selector de Modo: Bluetooth vs Wi-Fi / Red LAN */}
        <div className={`px-4 pt-3 pb-1 shrink-0`}>
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950/60 border border-slate-800">
            <button
              type="button"
              onClick={() => handleSwitchMode('bluetooth')}
              className={`min-h-[40px] py-2 px-2 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                printerMode === 'bluetooth'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bluetooth size={14} />
              <span>Bluetooth</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('network')}
              className={`min-h-[40px] py-2 px-2 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                printerMode === 'network'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Wifi size={14} />
              <span>Wi-Fi / Red LAN</span>
            </button>
          </div>
        </div>

        {/* Contenido con scroll */}
        <div
          className="p-4 overflow-y-auto space-y-4 flex-1 text-xs"
          onKeyDown={handleFormKeyDown}
          onFocusCapture={handleFieldFocusCapture}
        >
          {/* Tarjeta de Estado Activo */}
          <div className={`p-3.5 rounded-xl border ${isConfigured ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'} flex items-center justify-between gap-3`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`p-2 rounded-lg ${isConfigured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'} shrink-0`}>
                {printerMode === 'network' ? <Wifi size={18} /> : <Bluetooth size={18} />}
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] uppercase font-bold tracking-wider ${isConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {printerMode === 'network'
                    ? (isConfigured ? 'Impresora Wi-Fi / LAN Lista' : 'Sin IP Configurada')
                    : (isConfigured ? 'Impresora Bluetooth Vinculada' : 'Sin Impresora Seleccionada')}
                </p>
                <p className={`font-bold text-xs truncate ${T?.textPrimary || 'text-white'}`}>
                  {printerMode === 'network'
                    ? (networkIp ? `${networkIp}:${networkPort || 9100}` : 'Ingresa la IP de la impresora')
                    : (selectedName || 'Ningún dispositivo asignado')}
                </p>
                {printerMode === 'bluetooth' && selectedAddress && (
                  <p className="text-[10px] font-mono text-slate-400 truncate">
                    MAC: {selectedAddress}
                  </p>
                )}
              </div>
            </div>

            {printerMode === 'bluetooth' && (
              <button
                type="button"
                onClick={loadPairedDevices}
                disabled={isLoadingDevices}
                className={`p-2 rounded-lg ${T?.btnGhost || 'text-slate-400'} shrink-0 hover:text-blue-400 cursor-pointer`}
                title="Actualizar lista de dispositivos"
              >
                <RefreshCw size={15} className={isLoadingDevices ? 'animate-spin' : ''} />
              </button>
            )}
          </div>

          {/* Configuración específica según modo */}
          {printerMode === 'network' ? (
            <div className={`p-3.5 rounded-xl border ${T?.border || 'border-slate-800'} ${T?.ticketItemBg || 'bg-slate-800/40'} space-y-3`}>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className={`text-[11px] font-bold ${T?.textSecondary || 'text-slate-300'} block mb-1`}>
                    Dirección IP de Impresora *
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={networkIp}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNetworkIp(val);
                      persistPrinterConfig({ type: 'network', ip: val });
                    }}
                    placeholder="192.168.1.200"
                    className={`w-full min-h-[44px] ${T?.inputBg || 'bg-slate-950 text-white border-slate-700'} border rounded-xl px-3 py-2 text-base sm:text-sm font-mono font-bold outline-none focus:border-emerald-500`}
                  />
                </div>
                <div>
                  <label className={`text-[11px] font-bold ${T?.textSecondary || 'text-slate-300'} block mb-1`}>
                    Puerto TCP
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="done"
                    data-enter-submit="true"
                    value={networkPort}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNetworkPort(val);
                      persistPrinterConfig({ type: 'network', port: val });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isPrintingTest && String(networkIp || '').trim()) {
                        e.preventDefault();
                        handlePrintTestTicket();
                      }
                    }}
                    placeholder="9100"
                    className={`w-full min-h-[44px] ${T?.inputBg || 'bg-slate-950 text-white border-slate-700'} border rounded-xl px-3 py-2 text-base sm:text-sm font-mono font-bold outline-none focus:border-emerald-500`}
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Los tickets se envían en crudo ESC/POS (CP858) vía tu servidor PC hacia la impresora térmica de red (puerto estándar <b>9100</b>).
              </p>
            </div>
          ) : (
            /* Lista de Dispositivos Emparejados en Android */
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className={`text-[11px] font-bold ${T?.textSecondary || 'text-slate-300'}`}>
                  Dispositivos Bluetooth Disponibles
                </label>
                <span className="text-[10px] text-slate-500">
                  {pairedPrinters.length} detectados
                </span>
              </div>

              {pairedPrinters.length === 0 ? (
                <div className={`p-4 rounded-xl border border-dashed ${T?.border || 'border-slate-800'} text-center space-y-2`}>
                  <p className={`text-[11px] ${T?.textMuted || 'text-slate-400'}`}>
                    No hay impresoras emparejadas en Android.
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Enciende tu impresora térmica, ve a <b>Ajustes de Android &gt; Bluetooth</b> y vincúlala con el PIN 0000 o 1234.
                  </p>
                  <button
                    type="button"
                    onClick={handlePairWebBluetooth}
                    className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-semibold hover:bg-blue-600/30 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Bluetooth size={13} />
                    Buscar con Web Bluetooth
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {pairedPrinters.map((dev, idx) => {
                    const isSelected = selectedAddress === dev.address;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectPrinter(dev)}
                        className={`w-full p-2.5 rounded-lg border flex items-center justify-between text-left transition-colors cursor-pointer ${
                          isSelected 
                            ? 'border-blue-500 bg-blue-600/15 text-blue-400 shadow-sm' 
                            : `${T?.ticketItemBg || 'bg-slate-800/40'} ${T?.border || 'border-slate-800'} hover:border-slate-700 text-slate-300`
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-bold text-xs truncate">
                            {dev.name || 'Impresora Bluetooth'}
                          </p>
                          <p className="text-[9px] font-mono opacity-70">
                            {dev.address}
                          </p>
                        </div>
                        {isSelected ? (
                          <CheckCircle2 size={16} className="text-blue-400 shrink-0" />
                        ) : (
                          <span className="text-[10px] text-slate-500 uppercase font-bold shrink-0">
                            Elegir
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Selector de Ancho de Papel */}
          <div className="space-y-1.5">
            <label className={`text-[11px] font-bold ${T?.textSecondary || 'text-slate-300'} flex items-center gap-1.5`}>
              <Settings2 size={13} className="text-blue-400" />
              Ancho del Rollo de Papel
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSetPaperWidth('58mm')}
                className={`p-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                  paperWidth === '58mm'
                    ? 'border-blue-500 bg-blue-600/20 text-blue-400 shadow-sm'
                    : `${T?.ticketItemBg || 'bg-slate-800/50'} ${T?.border || 'border-slate-800'} ${T?.textMuted || 'text-slate-400'}`
                }`}
              >
                <p className="text-xs font-bold">58 mm (Estándar)</p>
                <p className="text-[10px] font-normal opacity-80 mt-0.5">Impresoras portátiles (32 col.)</p>
              </button>

              <button
                type="button"
                onClick={() => handleSetPaperWidth('80mm')}
                className={`p-3 rounded-xl border font-bold text-center transition-all cursor-pointer ${
                  paperWidth === '80mm'
                    ? 'border-blue-500 bg-blue-600/20 text-blue-400 shadow-sm'
                    : `${T?.ticketItemBg || 'bg-slate-800/50'} ${T?.border || 'border-slate-800'} ${T?.textMuted || 'text-slate-400'}`
                }`}
              >
                <p className="text-xs font-bold">80 mm (Ancho)</p>
                <p className="text-[10px] font-normal opacity-80 mt-0.5">Impresoras mostrador (48 col.)</p>
              </button>
            </div>
          </div>

          {/* Interruptor de Impresión Automática */}
          <div className={`p-3 rounded-xl border ${T?.border || 'border-slate-800'} ${T?.ticketItemBg || 'bg-slate-800/40'} flex items-center justify-between gap-3`}>
            <div>
              <p className={`font-bold text-xs ${T?.textPrimary || 'text-white'}`}>
                Impresión Automática
              </p>
              <p className={`text-[10px] ${T?.textMuted || 'text-slate-400'}`}>
                Emitir el ticket físico inmediatamente al confirmar cada venta
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleAutoPrint}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer p-0.5 shrink-0 ${
                autoPrint ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                autoPrint ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* Resultado de la Prueba */}
          {testResult && (
            <div className={`p-3 rounded-lg border flex items-start gap-2.5 text-[11px] ${
              testResult.success 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              {testResult.success ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-bold">{testResult.success ? 'Impresión Correcta' : 'Aviso de Impresión'}</p>
                <p className="opacity-90">{testResult.message}</p>
              </div>
            </div>
          )}
        </div>

        {/* Botones de Acción */}
        <div className={`p-3.5 border-t ${T?.border || 'border-slate-800'} bg-slate-950/40 space-y-2 shrink-0`}>
          <button
            type="button"
            onClick={handlePrintTestTicket}
            disabled={isPrintingTest}
            className="w-full min-h-[44px] py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-colors disabled:opacity-50"
          >
            {isPrintingTest ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Zap size={15} />
            )}
            <span>
              {isPrintingTest
                ? 'Enviando Datos a la Impresora...'
                : printerMode === 'network'
                  ? 'Imprimir Ticket de Prueba (Wi-Fi / CP858)'
                  : 'Imprimir Ticket de Prueba (Bluetooth / CP858)'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleSaveAndClose}
            className={`w-full min-h-[40px] py-2 rounded-lg border ${T?.border || 'border-slate-800'} ${T?.btnGhost || 'text-slate-400'} text-xs font-semibold hover:text-white transition-colors cursor-pointer`}
          >
            Cerrar y Guardar
          </button>
        </div>

      </div>
    </div>
  );
}
