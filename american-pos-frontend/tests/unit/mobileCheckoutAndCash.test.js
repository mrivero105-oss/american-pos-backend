import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../src/services/api', () => ({
  default: {
    post: vi.fn()
  }
}));

vi.mock('../../src/services/db', () => ({
  db: {
    put: vi.fn().mockResolvedValue('ok'),
    get: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([])
  }
}));

vi.mock('../../src/db/localDb', () => ({
  default: {
    sales: { put: vi.fn().mockResolvedValue('ok') },
    products: {
      get: vi.fn().mockResolvedValue({ id: 'p1', stockQuantity: 10 }),
      update: vi.fn().mockResolvedValue(1)
    },
    transaction: vi.fn(async (_mode, _table, cb) => cb())
  }
}));

vi.mock('../../src/services/lanSyncService', () => ({
  default: { broadcastSale: vi.fn() }
}));

vi.mock('../../src/services/mobilePrinterService', () => ({
  default: { enqueueSalePrint: vi.fn() }
}));

import api from '../../src/services/api';
import { db as primaryDb } from '../../src/services/db';
import {
  useMobileCheckoutFlow,
  canonicalizeMobilePaymentMethod,
  stripMobileProductSuffix
} from '../../src/hooks/mobile/useMobileCheckoutFlow';

function makeBaseParams(overrides = {}) {
  return {
    cart: [{ product: { id: 'p1', name: 'Harina PAN', price: 2.0, cost: 1.2, category: 'Alimentos', taxStatus: 'gravable' }, quantity: 2 }],
    setCart: vi.fn(),
    promotions: [],
    cartDiscountPercent: 0,
    setCartDiscountPercent: vi.fn(),
    discountSupervisorApprovalId: null,
    setDiscountSupervisorApprovalId: vi.fn(),
    exchangeRate: 100,
    lockedExchangeRate: 100,
    businessInfo: { country: 'Venezuela', name: 'Comercio Test', ivaEnabled: true, ivaRate: 16, igtfEnabled: true, igtfRate: 3 },
    documentType: 'factura',
    setDocumentType: vi.fn(),
    checkoutMode: 'express',
    setCheckoutMode: vi.fn(),
    splitPayments: { cash_usd: '', cash_bs: '', pago_movil: '', tarjeta: '', zelle: '', binance: '', credito: '' },
    setSplitPayments: vi.fn(),
    selectedMethod: 'Pago Móvil',
    setSelectedMethod: vi.fn(),
    amountPaidUSD: '',
    setAmountPaidUSD: vi.fn(),
    amountPaidBS: '400.00',
    setAmountPaidBS: vi.fn(),
    paymentReference: '998877',
    setPaymentReference: vi.fn(),
    isProcessingSale: false,
    setIsProcessingSale: vi.fn(),
    setIsCheckoutOpen: vi.fn(),
    setIsMobileCartOpen: vi.fn(),
    setIsThermalPrinterModalOpen: vi.fn(),
    setPrintedReceipt: vi.fn(),
    setSalesHistory: vi.fn(),
    setPendingSalesCount: vi.fn(),
    setProducts: vi.fn(),
    productsMap: new Map([['p1', { id: 'p1', stockQuantity: 10 }]]),
    getCleanProductId: stripMobileProductSuffix,
    getProductUnitsMultiplier: () => 1,
    customers: [],
    selectedCustomer: { id: 'cust-77', name: 'María Pérez', idDocument: 'V-12345678' },
    setSelectedCustomer: vi.fn(),
    setSelectedTable: vi.fn(),
    setOrderNotes: vi.fn(),
    customerName: 'María Pérez',
    setCustomerName: vi.fn(),
    customerDoc: 'V-12345678',
    setCustomerDoc: vi.fn(),
    setCustomerPhone: vi.fn(),
    isDollarCountry: false,
    autoPrint: false,
    canApplyDiscounts: true,
    user: { id: 'u1', name: 'Cajero Test' },
    requestSupervisorAuth: vi.fn(),
    showToast: vi.fn(),
    ...overrides
  };
}

describe('Fase M1 — Integridad Financiera Móvil (useMobileCheckoutFlow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
  });

  it('normaliza etiquetas de pago en español a IDs canónicos NIIF/Caja y limpia sufijos de presentación', () => {
    expect(canonicalizeMobilePaymentMethod('Pago Móvil')).toBe('pago_movil');
    expect(canonicalizeMobilePaymentMethod('Efectivo USD')).toBe('cash_usd');
    expect(canonicalizeMobilePaymentMethod('Efectivo Bs')).toBe('cash_bs');
    expect(canonicalizeMobilePaymentMethod('Crédito')).toBe('fiado');
    expect(canonicalizeMobilePaymentMethod('Binance')).toBe('binance_usdt');
    expect(canonicalizeMobilePaymentMethod('Biopago')).toBe('biopago');

    expect(stripMobileProductSuffix('prod-1__bulk')).toBe('prod-1');
    expect(stripMobileProductSuffix('prod-1__pres_caja12')).toBe('prod-1');
    expect(stripMobileProductSuffix('prod-1__wpres_5kg')).toBe('prod-1');
    expect(stripMobileProductSuffix('prod-1__srv_envio')).toBe('prod-1');
  });

  it('envía promoDiscount, appliedPromotions, customerId y método canónico pago_movil en salePayload', async () => {
    api.post.mockResolvedValueOnce({ data: { sale: { id: 'sale-1', invoiceNumber: 'FAC-1001' } } });
    const params = makeBaseParams({
      promotions: [{
        id: 'promo-pm',
        name: 'Promo Pago Móvil 10%',
        type: 'PAYMENT_METHOD_DISCOUNT',
        isActive: true,
        discountPercentage: 10,
        targetPaymentMethods: ['pago_movil']
      }]
    });

    const { result } = renderHook(() => useMobileCheckoutFlow(params));

    expect(result.current.totalPromoSavings).toBe(0.4);
    expect(result.current.totalDueUSD).toBe(3.6);

    await act(async () => {
      await result.current.handleConfirmSale();
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [endpoint, payload] = api.post.mock.calls[0];
    expect(endpoint).toBe('/sales');
    expect(payload.customerId).toBe('cust-77');
    expect(payload.paymentMethod).toBe('pago_movil');
    expect(payload.paymentMethods[0].method).toBe('pago_movil');
    expect(payload.promoDiscount).toBe(0.4);
    expect(payload.appliedPromotions).toHaveLength(1);
    expect(payload.items[0].promoDiscount).toBe(0.4);
    expect(payload.total).toBe(3.6);
  });

  it('respeta ivaEnabled=false e ivaRate=0 sin forzar 16%', () => {
    const params = makeBaseParams({
      businessInfo: { country: 'Venezuela', ivaEnabled: false, ivaRate: 0, igtfEnabled: false }
    });
    const { result } = renderHook(() => useMobileCheckoutFlow(params));
    expect(result.current.effectiveIvaRate).toBe(0);
    expect(result.current.taxUSD).toBe(0);
    expect(result.current.currentIgtfUSD).toBe(0);
  });

  it('usa actionType HIGH_DISCOUNT para descuentos >10% y bloquea si no tiene permiso canApplyDiscounts', () => {
    const reqSup = vi.fn();
    const { result: allowed } = renderHook(() => useMobileCheckoutFlow(makeBaseParams({
      canApplyDiscounts: true,
      requestSupervisorAuth: reqSup
    })));
    act(() => allowed.current.handleApplyDiscount(15));
    expect(reqSup).toHaveBeenCalledWith(
      'Autorizar Descuento Especial',
      expect.stringContaining('15%'),
      expect.any(Function),
      'HIGH_DISCOUNT'
    );

    const setDisc = vi.fn();
    const toastFn = vi.fn();
    const { result: denied } = renderHook(() => useMobileCheckoutFlow(makeBaseParams({
      canApplyDiscounts: false,
      setCartDiscountPercent: setDisc,
      showToast: toastFn
    })));
    act(() => denied.current.handleApplyDiscount(5));
    expect(setDisc).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('No tienes permisos'));
  });

  it('divide automáticamente pagos Express cuando se ingresa USD + Bs simultáneamente', async () => {
    api.post.mockResolvedValueOnce({ data: { sale: { id: 'sale-2', invoiceNumber: 'FAC-1002' } } });
    const params = makeBaseParams({
      selectedMethod: 'Efectivo USD',
      amountPaidUSD: '2.06',
      amountPaidBS: '200.00',
      paymentReference: ''
    });

    const { result } = renderHook(() => useMobileCheckoutFlow(params));
    await act(async () => {
      await result.current.handleConfirmSale();
    });

    const [, payload] = api.post.mock.calls[0];
    expect(payload.paymentMethod).toBe('mixto');
    expect(payload.paymentMethods).toHaveLength(2);
    expect(payload.paymentMethods[0]).toMatchObject({ method: 'cash_usd', currency: 'USD' });
    expect(payload.paymentMethods[1]).toMatchObject({ method: 'cash_bs', currency: 'VES' });
  });

  it('respalda cotizaciones offline en syncQueue y abre WhatsApp antes de limpiar el carrito', async () => {
    api.post.mockRejectedValueOnce(new Error('Network Error'));
    const params = makeBaseParams({ documentType: 'cotizacion' });

    const { result } = renderHook(() => useMobileCheckoutFlow(params));
    await act(async () => {
      await result.current.handleSaveQuotation();
    });

    expect(primaryDb.put).toHaveBeenCalledWith(
      'syncQueue',
      expect.objectContaining({ endpoint: '/quotations', method: 'POST' })
    );
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/?text='), '_blank');
    expect(params.setCart).toHaveBeenCalledWith([]);
  });
});
