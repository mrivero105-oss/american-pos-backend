import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MobileQuickItemModal from '../../src/components/mobile/MobileQuickItemModal';
import MobileCheckoutModal from '../../src/components/mobile/MobileCheckoutModal';
import MobileSideNav from '../../src/components/mobile/MobileSideNav';
import MobileThermalPrinterModal from '../../src/components/mobile/MobileThermalPrinterModal';
import MobileWhatsAppReceiptModal from '../../src/components/mobile/MobileWhatsAppReceiptModal';
import MobileInventoryView from '../../src/components/mobile/MobileInventoryView';
import mobilePrinterService from '../../src/services/mobilePrinterService';

const BASE_THEME = {
  appBg: 'bg-slate-950',
  cardBg: 'bg-slate-900',
  subPanelBg: 'bg-slate-900',
  modalCard: 'bg-slate-900',
  modalSubCard: 'bg-slate-950',
  border: 'border-slate-800',
  textPrimary: 'text-white',
  textSecondary: 'text-slate-300',
  textMuted: 'text-slate-400',
  inputBg: 'bg-slate-950 text-white border-slate-700',
  btnGhost: 'bg-slate-800 text-slate-300',
  ticketItemBg: 'bg-slate-800'
};

describe('Pulido Integral App Móvil (Ramas 1 a 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    delete window.Capacitor;
  });

  it('Rama 1: MobileQuickItemModal avanza foco campo a campo con Enter y usa text-base + inputMode numérico/decimal', () => {
    const handleAddManualItem = vi.fn((e) => e.preventDefault());
    render(
      <MobileQuickItemModal
        isOpen={true}
        onClose={vi.fn()}
        T={BASE_THEME}
        manualItemName="Recarga"
        setManualItemName={vi.fn()}
        manualItemPrice="5"
        setManualItemPrice={vi.fn()}
        manualItemPriceBS="200"
        setManualItemPriceBS={vi.fn()}
        manualItemQty="2"
        setManualItemQty={vi.fn()}
        exchangeRate={40}
        handleAddManualItem={handleAddManualItem}
      />
    );

    const descInput = screen.getByPlaceholderText(/Bolsa plástica/i);
    const numInputs = screen.getAllByPlaceholderText('0.00');
    const usdInput = numInputs[0];
    const bsInput = numInputs[1];
    const qtyInput = screen.getByPlaceholderText('1');

    expect(descInput.className).toContain('text-base');
    expect(usdInput).toHaveAttribute('inputmode', 'decimal');
    expect(qtyInput).toHaveAttribute('inputmode', 'numeric');

    descInput.focus();
    fireEvent.keyDown(descInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(usdInput);
    expect(handleAddManualItem).not.toHaveBeenCalled();

    fireEvent.keyDown(usdInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(bsInput);

    fireEvent.keyDown(bsInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(qtyInput);
  });

  it('Rama 2: MobileCheckoutModal oculta billetes en pagos electrónicos y permite Completar Restante en cualquier método Split', () => {
    const setSplitPayments = vi.fn();
    const commonProps = {
      isOpen: true,
      onClose: vi.fn(),
      T: BASE_THEME,
      isLight: false,
      documentType: 'factura',
      setDocumentType: vi.fn(),
      totalUSD: 10,
      baseTotalUSD: 10,
      totalBS: 500,
      taxUSD: 1.38,
      exchangeRate: 50,
      customerDoc: 'V-12345678',
      setCustomerDoc: vi.fn(),
      customerName: 'Cliente Prueba',
      setCustomerName: vi.fn(),
      onOpenCustomerSelect: vi.fn(),
      isProcessingSale: false,
      handleSaveQuotation: vi.fn(),
      checkoutMode: 'express',
      setCheckoutMode: vi.fn(),
      selectedMethod: 'Efectivo USD',
      handleSelectPaymentMethod: vi.fn(),
      cashAccumulateMode: false,
      setCashAccumulateMode: vi.fn(),
      amountPaidUSD: '',
      setAmountPaidUSD: vi.fn(),
      amountPaidBS: '',
      setAmountPaidBS: vi.fn(),
      totalPaidInUSD: 0,
      paidUSD: 0,
      paidBS: 0,
      changeUSD: 0,
      changeBS: 0,
      isDollarCountry: false,
      splitPayments: { cash_usd: '4.00', cash_bs: '', pago_movil: '', tarjeta: '', zelle: '', binance: '', credito: '' },
      setSplitPayments,
      splitPaidUSD: 4,
      splitRemainingUSD: 6,
      splitChangeUSD: 0,
      businessInfo: { pagoMovilBank: 'Banesco', pagoMovilPhone: '04141234567', pagoMovilId: 'V-123' },
      paymentReference: '',
      setPaymentReference: vi.fn(),
      handleConfirmSale: vi.fn()
    };

    const { rerender } = render(<MobileCheckoutModal {...commonProps} />);
    expect(screen.getByText(/Billetes & Calculadora Rápida/i)).toBeInTheDocument();

    // Cambiar a Pago Móvil: debe ocultar la calculadora de billetes y mostrar aviso de Referencia obligatoria
    rerender(<MobileCheckoutModal {...commonProps} selectedMethod="Pago Móvil" />);
    expect(screen.queryByText(/Billetes & Calculadora Rápida/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Falta el N° de Referencia obligatorio/i)).toBeInTheDocument();

    // Cambiar a modo Split: cada método debe tener su botón "Resto"; al tocar el de Pago Móvil (Bs) suma 6 * 50 = 300.00 Bs
    rerender(<MobileCheckoutModal {...commonProps} checkoutMode="split" />);
    const restoButtons = screen.getAllByRole('button', { name: /Resto/i });
    expect(restoButtons.length).toBeGreaterThanOrEqual(7);

    const pmRestoBtn = screen.getByTitle(/Completar restante en Pago Móvil/i);
    fireEvent.click(pmRestoBtn);
    expect(setSplitPayments).toHaveBeenCalledTimes(1);
    const updaterFn = setSplitPayments.mock.calls[0][0];
    const nextState = updaterFn(commonProps.splitPayments);
    expect(nextState.pago_movil).toBe('300.00');
  });

  it('Rama 4: MobileSideNav hace tocable la tasa de cambio solo para usuarios con permiso canManageSettings', () => {
    const onOpenExchangeRateModal = vi.fn();
    const onClose = vi.fn();
    const navProps = {
      isOpen: true,
      onClose,
      socketConnected: true,
      pendingSalesCount: 0,
      businessInfo: { name: 'Tienda Test' },
      exchangeRate: 62.5,
      user: { name: 'Admin', role: 'admin' },
      drawerSearch: '',
      setDrawerSearch: vi.fn(),
      filteredNavSections: [],
      activeModule: 'pos',
      setActiveModule: vi.fn(),
      posMode: 'SALE',
      setPosMode: vi.fn(),
      onOpenThermalPrinterSettings: vi.fn(),
      isAudioMuted: false,
      setIsAudioMuted: vi.fn(),
      toggleSoundMute: vi.fn(),
      playScanSound: vi.fn(),
      showToast: vi.fn(),
      theme: 'dark',
      setTheme: vi.fn(),
      logout: vi.fn()
    };

    const { rerender } = render(
      <MobileSideNav {...navProps} canManageSettings={false} onOpenExchangeRateModal={onOpenExchangeRateModal} />
    );
    expect(screen.queryByRole('button', { name: /Bs\. 62\.50/i })).not.toBeInTheDocument();

    rerender(
      <MobileSideNav {...navProps} canManageSettings={true} onOpenExchangeRateModal={onOpenExchangeRateModal} />
    );
    const rateBtn = screen.getByRole('button', { name: /Bs\. 62\.50/i });
    fireEvent.click(rateBtn);
    expect(onClose).toHaveBeenCalled();
    expect(onOpenExchangeRateModal).toHaveBeenCalledTimes(1);
  });

  it('Rama 4: MobileInventoryView expone chips de Stock Bajo y Agotados y botón de cámara en Conteo Físico', () => {
    const products = [
      { id: 1, name: 'Harina', stockQuantity: 20, minStock: 5, price: 2, category: 'Alimentos' },
      { id: 2, name: 'Aceite', stockQuantity: 2, minStock: 5, price: 4, category: 'Alimentos' },
      { id: 3, name: 'Azúcar', stockQuantity: 0, minStock: 5, price: 1.5, category: 'Alimentos' }
    ];

    render(
      <MobileInventoryView
        products={products}
        categories={['Alimentos']}
        exchangeRate={50}
        T={BASE_THEME}
        isLight={false}
        onBackToPOS={vi.fn()}
        showToast={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Stock Bajo \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agotados \(1\)/i })).toBeInTheDocument();

    // Activar modo conteo físico y verificar que aparezca el botón de cámara directo
    const auditBtn = screen.getByTitle(/Toma de Inventario/i);
    fireEvent.click(auditBtn);
    expect(screen.getByRole('button', { name: /Escanear con cámara para conteo/i })).toBeInTheDocument();
  });

  it('Rama 5: MobileThermalPrinterModal soporta modo Wi-Fi TCP 9100 y envía prueba en CP858 real', async () => {
    const printNetSpy = vi.spyOn(mobilePrinterService, 'printNetwork').mockResolvedValue(true);

    render(
      <MobileThermalPrinterModal
        isOpen={true}
        onClose={vi.fn()}
        T={BASE_THEME}
        showToast={vi.fn()}
        businessInfo={{ name: 'Ferretería Ñandú' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Wi-Fi \/ Red LAN/i }));
    const ipInput = screen.getByPlaceholderText('192.168.1.200');
    fireEvent.change(ipInput, { target: { value: '192.168.1.210' } });

    const savedCfg = JSON.parse(localStorage.getItem('pos_printer_config') || '{}');
    expect(savedCfg.type).toBe('network');
    expect(savedCfg.ip).toBe('192.168.1.210');
    expect(savedCfg.port).toBe(9100);

    fireEvent.click(screen.getByRole('button', { name: /Imprimir Ticket de Prueba/i }));

    await waitFor(() => {
      expect(printNetSpy).toHaveBeenCalledTimes(1);
    });
    const [calledIp, calledPort, calledBytes] = printNetSpy.mock.calls[0];
    expect(calledIp).toBe('192.168.1.210');
    expect(calledPort).toBe(9100);
    expect(calledBytes).toBeInstanceOf(Uint8Array);
    // Verificar secuencia ESC_INIT_CP858 (ESC @ + FS . + ESC t 19) y bytes CP858 de Ñ (0xA5) / ñ (0xA4)
    expect(Array.from(calledBytes.slice(0, 7))).toEqual([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x13]);
    expect(calledBytes).toContain(0xa5);
    expect(calledBytes).toContain(0xa4);

    printNetSpy.mockRestore();
  });

  it('Rama 5: MobileWhatsAppReceiptModal envía con Enter desde el teléfono y comparte imagen PNG por plugin nativo Android', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const shareImageMock = vi.fn().mockResolvedValue({ success: true });
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        PosNativeHardware: {
          shareImageToWhatsApp: shareImageMock
        }
      }
    };

    // Mock básico de Canvas 2D para jsdom
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    const origToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn()
    }));
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');

    const onClose = vi.fn();
    const saleData = {
      invoiceNumber: 'FAC-1001',
      customerName: 'María Pérez',
      totalUSD: 15,
      totalBS: 750,
      method: 'Pago Móvil',
      items: [{ quantity: 2, name: 'Café', finalSubtotal: 15 }]
    };

    render(
      <MobileWhatsAppReceiptModal
        whatsAppModalData={saleData}
        onClose={onClose}
        T={BASE_THEME}
        businessInfo={{ name: 'Comercio Test', rif: 'J-12345678-9' }}
        exchangeRate={50}
        whatsAppPhoneInput="0414-5551234"
        setWhatsAppPhoneInput={vi.fn()}
        generateEcoReceiptText={() => 'Recibo FAC-1001 Total $15.00'}
        cleanWhatsAppPhone={(p) => `58${String(p).replace(/\D/g, '').replace(/^0/, '')}`}
        showToast={vi.fn()}
      />
    );

    const phoneInput = screen.getByPlaceholderText(/0414 1234567/i);
    expect(phoneInput).toHaveAttribute('enterkeyhint', 'send');
    expect(phoneInput).toHaveAttribute('inputmode', 'tel');

    // Probar botón de enviar ticket como imagen vía plugin nativo Android
    fireEvent.click(screen.getByRole('button', { name: /Enviar Ticket como Imagen/i }));
    await waitFor(() => {
      expect(shareImageMock).toHaveBeenCalledWith(expect.objectContaining({
        imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        phone: '584145551234',
        title: 'Comprobante #FAC-1001'
      }));
    });

    // Probar envío directo con Enter en el campo teléfono
    fireEvent.keyDown(phoneInput, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/584145551234?text='),
      '_blank'
    );

    HTMLCanvasElement.prototype.getContext = origGetContext;
    HTMLCanvasElement.prototype.toDataURL = origToDataUrl;
    openSpy.mockRestore();
  });
});
