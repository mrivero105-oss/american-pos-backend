import React, { useState, useEffect, useCallback } from 'react';
import { 
  Printer, Bluetooth, CheckCircle2, AlertCircle, RefreshCw, 
  Settings2, FileText, X, ShieldCheck, Smartphone, Zap
} from 'lucide-react';
import mobilePrinterService from '../../services/mobilePrinterService';
import { cleanAscii, formatCenter, formatLine, ESC_INIT, ESC_BOLD_ON, ESC_BOLD_OFF, ESC_ALIGN_CENTER, GS_CUT } from '../../utils/escposFormatter';

export default function MobileThermalPrinterModal({
  isOpen,
  onClose,
  T,
  isLight,
  showToast,
  businessInfo = {}
}) {
  const [pairedPrinters, setPairedPrinters] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState(() => {
    return localStorage.getItem('pos_mobile_bt_printer_last') || localStorage.getItem('pos_mobile_bt_printer') || '';
  });
  const [selectedName, setSelectedName] = useState(() => {
    return localStorage.getItem('pos_mobile_bt_printer_name') || '';
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

  // Cargar lista de impresoras emparejadas en el sistema Android
  const loadPairedDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    setTestResult(null);
    try {
      if (mobilePrinterService.isNativePlatform()) {
        const devices = await mobilePrinterService.getPairedPrinters();
        setPairedPrinters(devices || []);
        
        // Si no hay seleccionada pero hay disponibles, sugerir la primera
        if (!selectedAddress && devices && devices.length > 0) {
          setSelectedAddress(devices[0].address);
          setSelectedName(devices[0].name);
        }
      } else {
        // En entorno Web, verificar si soporta Web Bluetooth
        setPairedPrinters([]);
      }
    } catch (err) {
      console.warn('[PrinterModal] Error al listar dispositivos:', err);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [selectedAddress]);

  useEffect(() => {
    if (isOpen) {
      loadPairedDevices();
    }
  }, [isOpen, loadPairedDevices]);

  if (!isOpen) return null;

  // Cambiar tamaño de papel
  const handleSetPaperWidth = (width) => {
    setPaperWidth(width);
    localStorage.setItem('pos_mobile_paper_width', width);
    showToast?.(`Ancho de papel configurado en ${width}`);
  };

  // Alternar impresión automática
  const handleToggleAutoPrint = () => {
    const nextVal = !autoPrint;
    setAutoPrint(nextVal);
    localStorage.setItem('pos_mobile_auto_print', String(nextVal));
    showToast?.(nextVal ? 'Impresión automática activada' : 'Impresión automática desactivada');
  };

  // Seleccionar impresora
  const handleSelectPrinter = (device) => {
    setSelectedAddress(device.address);
    setSelectedName(device.name);
    localStorage.setItem('pos_mobile_bt_printer_last', device.address);
    localStorage.setItem('pos_mobile_bt_printer', device.address);
    localStorage.setItem('pos_mobile_bt_printer_name', device.name);
    showToast?.(`Impresora seleccionada: ${device.name}`);
  };

  // Conectar vía Web Bluetooth (si corre en navegador o dispositivo no emparejado previamente)
  const handlePairWebBluetooth = async () => {
    setIsLoadingDevices(true);
    try {
      const dev = await mobilePrinterService.connectBluetooth();
      if (dev && dev.id) {
        setSelectedAddress(dev.id);
        setSelectedName(dev.name);
        localStorage.setItem('pos_mobile_bt_printer_name', dev.name);
        showToast?.(`Impresora vinculada: ${dev.name}`);
      }
    } catch (err) {
      alert(`No se pudo conectar: ${err.message}`);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  // Imprimir Ticket de Prueba Profesional ESC/POS
  const handlePrintTestTicket = async () => {
    setIsPrintingTest(true);
    setTestResult(null);

    const cols = paperWidth === '80mm' ? 48 : 32;
    const company = businessInfo?.name || localStorage.getItem('company_name') || 'Isaac POS';
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-VE');
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let ticket = ESC_INIT;
    ticket += ESC_ALIGN_CENTER;
    ticket += ESC_BOLD_ON;
    ticket += formatCenter(company.toUpperCase(), cols) + '\n';
    ticket += ESC_BOLD_OFF;
    ticket += formatCenter('PRUEBA DE IMPRESION TERMICA', cols) + '\n';
    ticket += formatCenter('--------------------------------', cols) + '\n';
    ticket += formatLine('Fecha:', dateStr, cols) + '\n';
    ticket += formatLine('Hora:', timeStr, cols) + '\n';
    ticket += formatLine('Formato Papel:', paperWidth, cols) + '\n';
    ticket += formatLine('Columnas:', `${cols} car.`, cols) + '\n';
    ticket += formatLine('Dispositivo:', (selectedName || 'Generica').substring(0, 15), cols) + '\n';
    ticket += formatCenter('--------------------------------', cols) + '\n';
    ticket += ESC_BOLD_ON;
    ticket += formatCenter('ESTADO: CONEXION EXITOSA', cols) + '\n';
    ticket += ESC_BOLD_OFF;
    ticket += formatCenter('Isaac POS Mobile - 100% Operativo', cols) + '\n';
    ticket += '\n\n\n\n' + GS_CUT;

    try {
      if (mobilePrinterService.isNativePlatform()) {
        const base64Data = mobilePrinterService.toBase64(ticket);
        const { registerPlugin } = await import('@capacitor/core');
        const PosNativeHardware = registerPlugin('PosNativeHardware');
        const res = await PosNativeHardware.printBluetooth({
          address: selectedAddress || '',
          data: base64Data
        });

        if (res?.success) {
          setTestResult({ success: true, message: 'Ticket de prueba impreso correctamente.' });
          showToast?.('✅ Ticket de prueba enviado a la impresora');
        } else {
          setTestResult({ success: false, message: 'La impresora no respondió. Verifica que esté encendida.' });
        }
      } else {
        await mobilePrinterService.printBluetooth(ticket);
        setTestResult({ success: true, message: 'Ticket de prueba impreso correctamente vía Web Bluetooth.' });
        showToast?.('✅ Ticket de prueba enviado a la impresora');
      }
    } catch (err) {
      console.error('[PrinterTest] Error:', err);
      setTestResult({ 
        success: false, 
        message: `Error de comunicación: ${err.message || 'Verifica que la impresora esté encendida y emparejada en los ajustes de Bluetooth de Android.'}` 
      });
    } finally {
      setIsPrintingTest(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-[9999] flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className={`w-full max-w-md ${T?.cardBg || 'bg-slate-900'} rounded-xl border ${T?.border || 'border-slate-800'} shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}>
        
        {/* Cabecera */}
        <div className={`p-4 border-b ${T?.border || 'border-slate-800'} flex items-center justify-between shrink-0 bg-slate-950/40`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/15 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
              <Printer size={20} />
            </div>
            <div>
              <h3 className={`font-bold text-sm sm:text-base ${T?.textPrimary || 'text-white'}`}>
                Impresora Térmica Bluetooth
              </h3>
              <p className={`text-[10px] ${T?.textMuted || 'text-slate-400'}`}>
                Configuración de tickets y recibos ESC/POS
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className={`p-2 rounded-lg ${T?.btnGhost || 'text-slate-400 hover:text-white'} cursor-pointer active:scale-95`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Contenido con scroll */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
          
          {/* Tarjeta de Estado Activo */}
          <div className={`p-3.5 rounded-xl border ${selectedAddress ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'} flex items-center justify-between gap-3`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`p-2 rounded-lg ${selectedAddress ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'} shrink-0`}>
                <Bluetooth size={18} />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] uppercase font-bold tracking-wider ${selectedAddress ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {selectedAddress ? 'Impresora Vinculada' : 'Sin Impresora Seleccionada'}
                </p>
                <p className={`font-bold text-xs truncate ${T?.textPrimary || 'text-white'}`}>
                  {selectedName || 'Ningún dispositivo asignado'}
                </p>
                {selectedAddress && (
                  <p className="text-[10px] font-mono text-slate-400 truncate">
                    MAC: {selectedAddress}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={loadPairedDevices}
              disabled={isLoadingDevices}
              className={`p-2 rounded-lg ${T?.btnGhost || 'text-slate-400'} shrink-0 hover:text-blue-400 cursor-pointer`}
              title="Actualizar lista de dispositivos"
            >
              <RefreshCw size={15} className={isLoadingDevices ? 'animate-spin' : ''} />
            </button>
          </div>

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

          {/* Lista de Dispositivos Emparejados en Android */}
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
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-colors disabled:opacity-50"
          >
            {isPrintingTest ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Zap size={15} />
            )}
            <span>{isPrintingTest ? 'Enviando Datos a la Impresora...' : 'Imprimir Ticket de Prueba'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className={`w-full py-2 rounded-lg border ${T?.border || 'border-slate-800'} ${T?.btnGhost || 'text-slate-400'} text-xs font-semibold hover:text-white transition-colors cursor-pointer`}
          >
            Cerrar y Guardar
          </button>
        </div>

      </div>
    </div>
  );
}
