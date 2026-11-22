import { useRef, useState, useEffect } from 'react';
import { X, Printer, CheckCircle2, MessageCircle, Mail, Loader2, Copy, Download, ExternalLink, Phone, Check, CornerUpLeft, Share2 } from 'lucide-react';
import { formatMoney as utilFormatMoney, formatBs, formatUSD, formatStock, isDollarOnlyCountry, isUsdOnlyMode, getTaxIdLabel, getCustomerDocLabel } from '../utils/format';
import BaseModal from './BaseModal';
import { formatSaleToEscPos } from '../utils/escposFormatter';
import { escapeHtml } from '../utils/escapeHtml';
import api from '../services/api';
import toast from 'react-hot-toast';
import JsBarcode from 'jsbarcode';
import html2canvas from 'html2canvas-pro';

import mobilePrinterService from '../services/mobilePrinterService';

export default function ReceiptModal({ isOpen, onClose, sale, businessSettings = {}, exchangeRate = 1, currencyMode = 'BOTH', paymentMethods = [], onRefund = null }) {
    const [showEmailPrompt, setShowEmailPrompt] = useState(false);
    const [emailAddress, setEmailAddress] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);

    const effectiveCountry = businessSettings?.country || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = isDollarCountry || isUsdOnlyMode({ currencyMode, country: effectiveCountry, ...businessSettings });
    const taxIdLabel = getTaxIdLabel(effectiveCountry);
    const clientDocLabel = getCustomerDocLabel(effectiveCountry);

    // Modo de visualización de comprobante: Solo en Bs (Ocultar tasa y ref. USD) o Moneda Dual (Bs y USD)
    const [receiptOnlyBs, setReceiptOnlyBs] = useState(() => {
        const saved = localStorage.getItem('pos_receipt_only_bs');
        if (saved !== null) return saved === 'true';
        return Boolean(businessSettings?.receiptOnlyBs);
    });

    const isOnlyBs = !isUsdOnly && (currencyMode === 'VES' || receiptOnlyBs === true);

    // WhatsApp Image Modal states
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const [capturingImage, setCapturingImage] = useState(false);
    const [whatsappImageBlob, setWhatsappImageBlob] = useState(null);
    const [whatsappImageDataUrl, setWhatsappImageDataUrl] = useState('');
    const [whatsappPhone, setWhatsappPhone] = useState('');
    const [sendingViaBot, setSendingViaBot] = useState(false);
    const [botStatus, setBotStatus] = useState('DISCONNECTED');

    const printRef = useRef();
    const scrollContainerRef = useRef(null);
    const barcodeRef = useRef(null);
    const autoPrintedSaleIdRef = useRef(null);
    const handlePrintRef = useRef(null);
    const userInteractedRef = useRef(false);
    const [autoClosePaused, setAutoClosePaused] = useState(false);
    const dailyTicketNum = sale?.dailyTicketNumber || sale?.taxInfo?.dailyTicketNumber || null;
    const receiptNum = String(sale?.id || '').split('-')[0].toUpperCase();

    const pauseAutoClose = () => {
        if (!userInteractedRef.current) {
            userInteractedRef.current = true;
            setAutoClosePaused(true);
        }
    };

    useEffect(() => {
        if (sale) {
            const rawPhone = sale.customerPhone || sale.Customer?.phone || '';
            setWhatsappPhone(rawPhone.replace(/[^0-9+]/g, ''));
            userInteractedRef.current = false;
            setAutoClosePaused(false);
        }
        if (isOpen && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [sale, isOpen]);

    useEffect(() => {
        if (isOpen && receiptNum && barcodeRef.current) {
            try {
                JsBarcode(barcodeRef.current, receiptNum, {
                    format: "CODE128",
                    width: 1.5,
                    height: 38,
                    displayValue: false,
                    margin: 0,
                    background: "transparent",
                    lineColor: "#020617"
                });
            } catch (err) {
                console.warn('Receipt barcode generation error:', err);
            }
        }
    }, [isOpen, receiptNum]);

    useEffect(() => {
        if (isOpen && sale && sale._autoPrint && businessSettings?.autoPrintReceipt !== false) {
            const saleKey = String(sale._autoPrintNonce || sale.id || sale.invoiceNumber || '');
            if (saleKey && autoPrintedSaleIdRef.current !== saleKey) {
                autoPrintedSaleIdRef.current = saleKey;
                if (sale?.id) {
                    try { sessionStorage.setItem('last_local_printed_sale_id', String(sale.id)); } catch (caughtErr) { console.warn('[ReceiptModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
                }
                const timer = setTimeout(() => {
                    if (handlePrintRef.current) {
                        handlePrintRef.current({ isAutoPrint: true });
                    }
                }, 100);
                return () => clearTimeout(timer);
            }
        }
    }, [isOpen, sale, businessSettings?.autoPrintReceipt]);

    // Auto-cerrar el recibo después de cobrar si el cajero no interactúa con el modal
    useEffect(() => {
        if (!isOpen || !sale || !sale._autoPrint) return;
        if (businessSettings?.autoCloseReceipt === false) return;
        if (autoClosePaused || showWhatsAppModal || showEmailPrompt || capturingImage) return;

        const closeTimer = setTimeout(() => {
            if (!userInteractedRef.current && typeof onClose === 'function') {
                onClose();
            }
        }, 3200);

        return () => clearTimeout(closeTimer);
    }, [isOpen, sale, autoClosePaused, showWhatsAppModal, showEmailPrompt, capturingImage, businessSettings?.autoCloseReceipt, onClose]);

    // Permitir cerrar con Enter o Escape inmediatamente
    useEffect(() => {
        if (!isOpen || showEmailPrompt || showWhatsAppModal) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                if (typeof onClose === 'function') onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, showEmailPrompt, showWhatsAppModal, onClose]);

    if (!isOpen || !sale) return null;

    const isSingle = isUsdOnly;
    const effectiveRate = isUsdOnly ? 1 : Number(sale?.exchangeRate || exchangeRate || 1);
    const renderFormatMoney = (val, mode = null) => utilFormatMoney(val, isUsdOnly ? 'USD' : mode, { rate: effectiveRate, currencyMode: isUsdOnly ? 'USD' : currencyMode });

    const documentTitle = sale?.documentType === 'nota_entrega' 
        ? 'Nota de Entrega' 
        : (sale?.documentType === 'cotizacion' || sale?.documentType === 'presupuesto'
            ? 'Cotización'
            : (sale?.sriAccessKey ? 'Factura Electrónica' : 'Factura'));
    const saleItems = Array.isArray(sale.SaleItems) ? sale.SaleItems : (Array.isArray(sale.items) ? sale.items : []);
    const totalUnitsCount = saleItems.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);

    const normalizedPaymentMethods = (() => {
        let raw = sale?.paymentMethods || sale?.PaymentDetails || sale?.splitDetails;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_) { raw = []; }
        }
        return Array.isArray(raw) ? raw : [];
    })();

    const fallbackSaleReference = (() => {
        const direct = String(sale?.paymentReference || sale?.reference || sale?.taxInfo?.reference || '').trim();
        if (direct) return direct;
        if (typeof sale?.notes === 'string' && sale.notes.toLowerCase().startsWith('ref:')) {
            return sale.notes.substring(4).trim();
        }
        return '';
    })();

    const parseTemplate = (template, variables) => {
        if (!template) return '';
        return template
            .split('\n')
            .filter(line => line.trim() !== '')
            .map((rawLine) => {
                let escapedLine = escapeHtml(rawLine);
                for (const [key, value] of Object.entries(variables)) {
                    escapedLine = escapedLine.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), escapeHtml(value || ''));
                }
                return `<p style="margin:2px 0;">${escapedLine}</p>`;
            })
            .join('');
    };

    const templateVariables = {
        nombre_empresa: businessSettings.name || 'Isaac POS',
        rif: businessSettings.rif || (taxIdLabel === 'RUC' ? '9999999999001' : 'J-XXXXXXX-X'),
        ruc: businessSettings.rif || (taxIdLabel === 'RUC' ? '9999999999001' : 'J-XXXXXXX-X'),
        nit: businessSettings.rif || '900000000-1',
        tax_id: businessSettings.rif || '',
        direccion: businessSettings.address || 'Principal',
        telefono: businessSettings.phone || '',
        cliente_nombre: sale.customerName || 'Cliente Ocasional',
        documento_cliente: sale.customerDoc || sale.customerDocument || sale.Customer?.idDocument || '',
        fecha: new Date(sale.createdAt || sale.date || Date.now()).toLocaleDateString(),
        hora: new Date(sale.createdAt || sale.date || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        nro_recibo: dailyTicketNum ? `${dailyTicketNum} (#${receiptNum})` : receiptNum,
        nro_ticket: dailyTicketNum ? String(dailyTicketNum) : receiptNum,
        total: renderFormatMoney(sale.total, !isSingle ? 'VES' : 'USD')
    };

    const formatPaymentMethodName = (methodKey, currency) => {
        if (!methodKey) {
            return (currency === 'VES' || currency === 'BS') ? 'EFECTIVO BS' : 'EFECTIVO';
        }
        const key = String(methodKey).toLowerCase().trim();
        const curr = String(currency || '').toUpperCase().trim();
        const isVesCurrency = curr === 'VES' || curr === 'BS';

        // 1. Modo exclusivo USD (Ecuador, Panamá, USA)
        if (isSingle || isUsdOnly) {
            if (key.includes('cash') || key.includes('efectivo')) return 'EFECTIVO';
            if (key === 'biopago') return 'PAGO DIGITAL';
            if (key === 'debit' || key === 'debito' || key === 'punto_de_venta' || key.includes('punto') || key === 'card' || key === 'tarjeta') return 'TARJETA / DÉBITO';
            if (key === 'pago_movil' || key.includes('movil') || key === 'transfer' || key === 'transferencia' || key === 'transfer_bs') return 'TRANSFERENCIA';
            if (key === 'zelle') return 'ZELLE';
            if (key === 'fiado' || key === 'credit' || key === 'credito') return 'CRÉDITO (CUENTA POR COBRAR)';
            if (key === 'binance_usdt' || key.includes('binance') || key === 'usdt') return 'PAGO ELECTRÓNICO';
        }

        // Blindaje Fiscal Venezuela: Criptoactivos jamás deben imprimirse como "BINANCE" o "USDT" en comprobantes al cliente
        if (key === 'binance_usdt' || key === 'binance' || key.includes('binance') || key === 'usdt') {
            const dynCrypto = Array.isArray(paymentMethods) && paymentMethods.find(pm => 
                pm.id === methodKey || String(pm.id).toLowerCase() === key || (pm.name && pm.name.toLowerCase().includes('binance'))
            );
            return String(dynCrypto?.receiptLabel || 'PAGO ELECTRÓNICO').trim().toUpperCase();
        }

        // 2. Método dinámico personalizado configurado por el usuario
        const dyn = Array.isArray(paymentMethods) && paymentMethods.find(pm => 
            pm.id === methodKey || String(pm.id).toLowerCase() === key
        );
        if (dyn && dyn.name) {
            let dynName = dyn.name.trim().toUpperCase();
            if (dyn.id === 'binance_usdt' || dynName.includes('BINANCE') || dynName.includes('USDT')) {
                return String(dyn.receiptLabel || 'PAGO ELECTRÓNICO').trim().toUpperCase();
            }
            if (isSingle || isUsdOnly) {
                if (dynName.includes('EFECTIVO BS') || dynName.includes('EFECTIVO $') || dynName.includes('EFECTIVO USD')) return 'EFECTIVO';
            }
            return dynName;
        }

        // 3. Efectivo Bolívares (VES)
        if (key === 'cash_bs' || key === 'efectivo_bs' || key === 'cash_ves' || (['cash', 'efectivo'].includes(key) && isVesCurrency)) {
            return isSingle || isUsdOnly ? 'EFECTIVO' : 'EFECTIVO BS';
        }

        // 4. Efectivo Dólares (USD)
        if (key === 'cash' || key === 'efectivo_usd' || key === 'cash_usd' || key === 'efectivo' || key === 'dolar' || key === 'usd') {
            return isSingle || isUsdOnly ? 'EFECTIVO' : 'EFECTIVO $';
        }

        // 5. Otros métodos
        if (key === 'biopago') return isUsdOnly ? 'PAGO DIGITAL' : 'BIOPAGO (HUELLA BDV)';
        if (key === 'debit' || key === 'debito' || key === 'punto_de_venta' || key.includes('punto') || key === 'card' || key === 'tarjeta') return isUsdOnly ? 'TARJETA / DÉBITO' : 'PUNTO DE VENTA';
        if (key === 'pago_movil' || key === 'pagomovil' || key.includes('movil')) return isUsdOnly ? 'TRANSFERENCIA' : 'PAGO MÓVIL';
        if (key === 'zelle') return 'ZELLE';
        if (key === 'transfer' || key === 'transferencia' || key === 'transfer_bs') return 'TRANSFERENCIA';
        if (key === 'fiado' || key === 'credit' || key === 'credito') return 'CRÉDITO (CUENTA POR COBRAR)';
        
        return String(methodKey).replace(/_/g, ' ').toUpperCase();
    };

    const generateHtmlForPrint = () => {
        const printContent = printRef.current?.innerHTML || '';
        const printWidth = businessSettings.receiptWidth || '72mm';
        const printCopies = Number(businessSettings.receiptCopies) || 1;

        let bodyContent = printContent;
        if (printCopies === 2) {
            const originalHeader = `
                <div class="text-center font-bold" style="font-size: 10px; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px dashed #000;">
                    *** ORIGINAL - CLIENTE ***
                </div>
            `;
            const controlHeader = `
                <div class="text-center font-bold" style="margin-bottom: 6px; padding: 4px; border: 2px dashed #000;">
                    <div style="font-size: 12px; font-weight: 800;">*** COPIA / CONTROL DE CAJA ***</div>
                    <div style="font-size: 9px;">USO INTERNO DEL COMERCIO</div>
                </div>
            `;
            const pageBreak = `<div style="page-break-after: always; break-after: page; height: 1px; margin: 16px 0; border-bottom: 1px dashed #ccc;"></div>`;
            bodyContent = `
                <div class="ticket-copy-original">
                    ${originalHeader}
                    ${printContent}
                </div>
                ${pageBreak}
                <div class="ticket-copy-control">
                    ${controlHeader}
                    ${printContent}
                </div>
            `;
        }

        const safeWidth = /^(58|80|210)mm$/i.test(String(printWidth || '')) ? String(printWidth) : '80mm';
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <title>${escapeHtml(documentTitle)} #${escapeHtml(receiptNum)}</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');
                        * { box-sizing: border-box; }
                        body { 
                            font-family: 'JetBrains Mono', 'Roboto Mono', 'SFMono-Regular', Consolas, 'Courier New', monospace; 
                            width: ${safeWidth}; 
                            margin: 0 auto; 
                            padding: 4px; 
                            font-size: 11px; 
                            line-height: 1.25; 
                            color: #000000; 
                            background: #ffffff;
                            -webkit-font-smoothing: antialiased;
                            text-rendering: optimizeLegibility;
                        }
                        .text-center { text-align: center; }
                        .text-right { text-align: right; }
                        .text-left { text-align: left; }
                        .font-bold { font-weight: bold; }
                        .border-b { border-bottom: 1px dashed #000; margin: 6px 0; }
                        .border-t { border-top: 1px dashed #000; margin: 6px 0; }
                        .border-y { border-top: 1px dashed #000; border-bottom: 1px dashed #000; margin: 6px 0; padding: 4px 0; }
                        table { width: 100%; border-collapse: collapse; }
                        th { text-align: left; border-bottom: 1px dashed #000; padding: 2px 0; font-size: 10px; }
                        td { padding: 2.5px 0; vertical-align: top; }
                        .logo-print { max-width: 45mm; max-height: 25mm; display: block; margin: 0 auto 6px auto; filter: grayscale(100%) contrast(1.3); }
                        svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                        @media print {
                            body { width: ${printWidth}; margin: 0; padding: 0; }
                            @page { margin: 0; }
                        }
                    </style>
                </head>
                <body>${bodyContent}</body>
            </html>
        `;
    };

    const handlePrint = async (options = {}) => {
        pauseAutoClose();
        const isAutoPrint = Boolean(options?.isAutoPrint);
        const html = generateHtmlForPrint();
        const activePrinter = localStorage.getItem('pos_station_printer') || businessSettings.printerName || '';

        if (sale?.id) {
            try { sessionStorage.setItem('last_local_printed_sale_id', String(sale.id)); } catch (caughtErr) { console.warn('[ReceiptModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
        }

        const hasCashTransaction = (currentSale) => {
            if (!currentSale) return false;
            // 1. Hay vuelto en efectivo (USD o Bs)
            if (Number(currentSale.changeBs) > 0 || Number(currentSale.changeUsd) > 0 || Number(currentSale.change) > 0) {
                return true;
            }
            // 2. Desglose de métodos de pago
            if (Array.isArray(currentSale.paymentMethods) && currentSale.paymentMethods.length > 0) {
                return currentSale.paymentMethods.some(pm => {
                    const methodKey = String(pm.method || pm.id || '').toLowerCase();
                    const amount = Number(pm.amount || pm.paid || 0);
                    return amount > 0 && (
                        methodKey.includes('cash') || 
                        methodKey.includes('efectivo') || 
                        pm.type === 'CASH'
                    );
                });
            }
            // 3. Método único de pago
            if (currentSale.paymentMethod) {
                const methodKey = String(currentSale.paymentMethod).toLowerCase();
                return methodKey.includes('cash') || methodKey.includes('efectivo');
            }
            return false;
        };

        const shouldKickDrawer = businessSettings.openDrawerOnPrint !== false && 
            (businessSettings.openDrawerOnlyCash === false ? true : hasCashTransaction(sale));

        const buildEscPosTicket = () => formatSaleToEscPos(
            sale,
            { ...businessSettings, printerName: activePrinter, receiptOnlyBs: isOnlyBs, isUsdOnly },
            effectiveRate,
            isUsdOnly ? 'USD' : (isOnlyBs ? 'VES' : currencyMode),
            paymentMethods
        );

        if (window.electronAPI) {
            try {
                let printedOk = false;
                if (businessSettings.printMode !== 'HTML') {
                    const escPosContent = buildEscPosTicket();
                    const res = await window.electronAPI.printRaw(escPosContent, activePrinter);
                    printedOk = Boolean(res && res.success !== false);
                }
                if (!printedOk) {
                    const resSilent = await window.electronAPI.printSilent(html, activePrinter);
                    printedOk = Boolean(resSilent && resSilent.success !== false);
                }
                
                if (shouldKickDrawer) {
                    try {
                        await window.electronAPI.openDrawer(activePrinter, businessSettings.drawerSequence);
                    } catch (drawerErr) {
                        console.warn('No se pudo abrir la gaveta:', drawerErr);
                    }
                }
                if (printedOk) {
                    toast.success('Comprobante enviado a la impresora');
                } else if (!isAutoPrint) {
                    toast.error('No se detectó una impresora térmica conectada');
                }
            } catch (err) {
                console.error("Desktop print failed:", err);
                if (!isAutoPrint) {
                    toast.error('Error al imprimir en la impresora térmica');
                }
            }
            return;
        }

        const isMobileDevice = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (!isMobileDevice) {
            // Entorno Web/Navegador en PC con backend local (auto-resuelve impresora si activePrinter está vacío)
            try {
                const escPosContent = buildEscPosTicket();
                const resp = await api.post('/settings/print-raw', {
                    content: escPosContent,
                    printerName: activePrinter,
                    printMode: businessSettings?.printMode,
                    autoPrint: Boolean(isAutoPrint)
                });
                if (resp?.data?.success) {
                    if (shouldKickDrawer) {
                        try {
                            await api.post('/settings/open-drawer', {
                                printerName: resp.data?.printerName || activePrinter,
                                sequence: businessSettings.drawerSequence,
                                autoPrint: Boolean(isAutoPrint)
                            });
                        } catch (caughtErr) { console.warn('[ReceiptModal] Error en operación auxiliar:', caughtErr?.message || caughtErr); }
                    }
                    toast.success('Comprobante enviado a la impresora');
                } else if (!isAutoPrint) {
                    toast.error(resp?.data?.message || 'No se detectó una impresora térmica conectada');
                }
            } catch (err) {
                console.error("Backend print-raw failed:", err);
                if (!isAutoPrint) {
                    toast.error(err.response?.data?.error || 'No se pudo imprimir en la impresora seleccionada');
                }
            }
        } else {
            // Mobile execution
            try {
                await mobilePrinterService.printSaleMobile({
                    sale,
                    businessSettings: { ...businessSettings, printerName: activePrinter, receiptOnlyBs: isOnlyBs, isUsdOnly },
                    exchangeRate: effectiveRate,
                    currencyMode: isUsdOnly ? 'USD' : (isOnlyBs ? 'VES' : currencyMode),
                    paymentMethods,
                    htmlContent: html
                });
                toast.success('Impresión enviada correctamente');
            } catch (err) {
                console.error("Mobile print error:", err);
                if (!isAutoPrint) {
                    fallbackPrint();
                }
            }
        }
    };

    handlePrintRef.current = handlePrint;

    const fallbackPrint = () => {
        if (window.electronAPI) return;
        const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (!isMobile) return;
        const html = generateHtmlForPrint();
        mobilePrinterService.printIframe(html);
    };

    const buildTextReceipt = () => {
        const businessName = businessSettings.name || 'Isaac POS';
        const rif = businessSettings.rif || '';
        const phone = businessSettings.phone || '';
        const address = businessSettings.address || '';
        const clientName = sale.customerName || 'Cliente Ocasional';
        const clientDoc = sale.customerDoc || sale.customerDocument || sale.Customer?.idDocument || '';
        const clientPhone = sale.customerPhone || sale.Customer?.phone || '';
        const dateStr = new Date(sale.createdAt || sale.date || Date.now()).toLocaleDateString();
        const timeStr = new Date(sale.createdAt || sale.date || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const lines = [
            `🧾 *${businessName.toUpperCase()}*`,
            rif ? `*${taxIdLabel}:* ${rif}` : null,
            address ? `*Dirección:* ${address}` : null,
            phone ? `*Tel:* ${phone}` : null,
            '----------------------------------------',
            dailyTicketNum ? `🎫 *NÚMERO DE TICKET:* *#${dailyTicketNum}*` : null,
            `*${documentTitle.toUpperCase()}* #${receiptNum}`,
            `*Fecha:* ${dateStr} ${timeStr}`,
            `*Cliente:* ${clientName}`,
            clientDoc ? `*${clientDocLabel}:* ${clientDoc}` : null,
            clientPhone ? `*Teléfono:* ${clientPhone}` : null,
            '----------------------------------------',
            '*DETALLE DE PRODUCTOS:*'
        ].filter(Boolean);

        saleItems.forEach(item => {
            const qty = formatStock(item.quantity);
            const subtotal = item.subtotal !== undefined ? item.subtotal : (item.price * item.quantity);
            const formattedPrice = renderFormatMoney(subtotal, (!isUsdOnly && currencyMode === 'BOTH') ? 'VES' : 'USD');
            lines.push(`• ${qty}x ${item.name} ➔ *${formattedPrice}*`);
        });

        lines.push('----------------------------------------');
        lines.push(`*TOTAL:* *${renderFormatMoney(sale.total, (!isUsdOnly && !isSingle) ? 'VES' : 'USD')}*`);
        if (!isUsdOnly && currencyMode === 'BOTH' && !isOnlyBs) {
            lines.push(`*Ref. USD:* *${renderFormatMoney(sale.total, 'USD')}* (Tasa: ${formatBs(effectiveRate).replace(/Bs\.S?\s?/g, '').trim()} Bs/$)`);
        }

        const paymentDetails = normalizedPaymentMethods;
        if (paymentDetails.length > 0) {
            lines.push('----------------------------------------');
            lines.push('*PAGO:*');
            paymentDetails.forEach((p, idx) => {
                const isCrypto = p.method === 'binance_usdt' || String(p.method).toLowerCase().includes('binance') || (p.currency || '').toUpperCase() === 'USDT';
                const pCurr = isCrypto ? (isUsdOnly ? 'USD' : 'VES') : (isUsdOnly ? 'USD' : (p.currency || 'VES'));
                let amt = p.amount;
                if (isCrypto && !isUsdOnly) {
                    amt = p.convertedAmountBs || (p.amount && p.cryptoRate ? Number(p.amount) * Number(p.cryptoRate) : (sale.totalBs || (sale.total * effectiveRate)));
                }
                const pRef = String(p.reference || p.ref || p.paymentReference || (idx === 0 ? fallbackSaleReference : '') || '').trim();
                lines.push(`  ✓ ${formatPaymentMethodName(p.method, pCurr)}: ${renderFormatMoney(amt, pCurr)}${pRef ? ` (Ref: #${pRef})` : ''}`);
            });
        } else if (sale.paymentMethod || fallbackSaleReference) {
            lines.push('----------------------------------------');
            const fallbackCurr = sale.currency || (sale.paymentMethod === 'cash_bs' ? 'VES' : 'USD');
            lines.push(`*PAGO:* ${formatPaymentMethodName(sale.paymentMethod, fallbackCurr)}${fallbackSaleReference ? ` (Ref: #${fallbackSaleReference})` : ''}`);
        }

        lines.push('----------------------------------------');
        lines.push('¡Muchas gracias por su preferencia! ✨');

        return lines.join('\n');
    };

    const getCleanPhoneForWhatsApp = () => {
        let clean = (whatsappPhone || '').replace(/\D/g, '');
        if (!clean) return '';
        if (clean.startsWith('0') && clean.length >= 10) {
            clean = '58' + clean.substring(1);
        } else if (clean.length === 10 && (clean.startsWith('412') || clean.startsWith('414') || clean.startsWith('424') || clean.startsWith('416') || clean.startsWith('426'))) {
            clean = '58' + clean;
        }
        return clean;
    };


    const handleWhatsAppShare = async () => {
        if (!printRef.current) {
            toast.error('No se pudo encontrar el comprobante para generar la imagen');
            return;
        }

        setCapturingImage(true);
        try {
            // Verificar estado del bot de WhatsApp en segundo plano
            api.get('/whatsapp/status')
                .then(res => setBotStatus(res.data?.status || 'DISCONNECTED'))
                .catch(() => setBotStatus('DISCONNECTED'));

            // Renderizar ticket como imagen PNG nítida (escala 2x para calidad retina)
            const canvas = await html2canvas(printRef.current, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                allowTaint: true,
                logging: false,
                imageTimeout: 0,
                removeContainer: true
            });

            const dataUrl = canvas.toDataURL('image/png');
            setWhatsappImageDataUrl(dataUrl);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            setWhatsappImageBlob(blob);

            const rawPhone = sale.customerPhone || sale.Customer?.phone || '';
            setWhatsappPhone(rawPhone.replace(/[^0-9+]/g, ''));
            setShowWhatsAppModal(true);
        } catch (err) {
            console.error('Error capturando imagen del ticket:', err);
            toast.error('Error al generar la imagen de la factura');
        } finally {
            setCapturingImage(false);
        }
    };

    const handleDirectWhatsAppImage = async () => {
        if (!printRef.current) {
            toast.error('No se pudo encontrar el comprobante para generar la imagen');
            return;
        }

        const cleanPhone = getCleanPhoneForWhatsApp();
        const textReceipt = buildTextReceipt();

        setCapturingImage(true);
        try {
            // Renderizar ticket como imagen PNG nítida (escala 2x para calidad retina)
            const canvas = await html2canvas(printRef.current, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                allowTaint: true,
                logging: false,
                imageTimeout: 0,
                removeContainer: true
            });

            const dataUrl = canvas.toDataURL('image/png');
            setWhatsappImageDataUrl(dataUrl);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            setWhatsappImageBlob(blob);

            // 1. Android Nativo (Capacitor) -> Abrir WhatsApp directamente con la imagen adjunta
            if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.shareImageToWhatsApp) {
                toast.success('📱 Abriendo WhatsApp con la imagen de la factura...');
                await window.Capacitor.Plugins.PosNativeHardware.shareImageToWhatsApp({
                    imageBase64: dataUrl,
                    phone: cleanPhone,
                    text: textReceipt,
                    title: `${documentTitle} #${receiptNum}`
                });
                return;
            }

            // 2. Web Share API con soporte de archivo (móvil web / iOS)
            if (blob && navigator.share) {
                try {
                    const imageFile = new File([blob], `Factura_${receiptNum}.png`, { type: 'image/png' });
                    if (navigator.canShare && navigator.canShare({ files: [imageFile] })) {
                        await navigator.share({
                            files: [imageFile],
                            title: `${documentTitle} #${receiptNum}`,
                            text: textReceipt
                        });
                        toast.success('¡Factura compartida con éxito!');
                        return;
                    }
                } catch (shareErr) {
                    if (shareErr.name === 'AbortError') return;
                }
            }

            // 3. En PC de escritorio, abrir el modal con opciones de WhatsApp Web / Bot / Descarga
            setWhatsappPhone(cleanPhone);
            setShowWhatsAppModal(true);
        } catch (err) {
            console.error('Error capturando imagen del ticket:', err);
            toast.error('Error al generar la imagen de la factura');
        } finally {
            setCapturingImage(false);
        }
    };

    const handleNativeShare = async () => {
        const textReceipt = buildTextReceipt();
        const cleanPhone = getCleanPhoneForWhatsApp();

        // 0. Si estamos en Android Nativo (Capacitor), usar el plugin nativo de Intent para compartir la imagen directamente
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.shareImageToWhatsApp) {
            try {
                if (!whatsappImageDataUrl) {
                    toast.error('La imagen de la factura se está procesando...');
                    return;
                }
                toast.success('📱 Abriendo WhatsApp con la imagen de la factura...');
                await window.Capacitor.Plugins.PosNativeHardware.shareImageToWhatsApp({
                    imageBase64: whatsappImageDataUrl,
                    phone: cleanPhone,
                    text: textReceipt,
                    title: `${documentTitle} #${receiptNum}`
                });
                setShowWhatsAppModal(false);
                return;
            } catch (pluginErr) {
                console.warn('Native hardware share image notice:', pluginErr);
            }
        }
        
        let blob = whatsappImageBlob;
        if (!blob && whatsappImageDataUrl) {
            try {
                const arr = whatsappImageDataUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) { u8arr[n] = bstr.charCodeAt(n); }
                blob = new Blob([u8arr], { type: mime });
            } catch (e) {
                console.warn('Blob parsing error', e);
            }
        }

        // 1. Intentar compartir Archivo + Texto con la API nativa de Android/iOS
        if (blob && navigator.share) {
            try {
                const imageFile = new File([blob], `Factura_${receiptNum}.png`, { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [imageFile] })) {
                    await navigator.share({
                        files: [imageFile],
                        title: `${documentTitle} #${receiptNum}`,
                        text: textReceipt
                    });
                    toast.success('¡Factura compartida con éxito!');
                    setShowWhatsAppModal(false);
                    return;
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.warn('Native file share failed, fallback to text:', err);
            }
        }

        // 2. Fallback: Compartir texto vía API nativa
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${documentTitle} #${receiptNum}`,
                    text: textReceipt
                });
                toast.success('¡Factura compartida con éxito!');
                setShowWhatsAppModal(false);
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.warn('Native text share failed:', err);
            }
        }

        // 3. Fallback final: Abrir WhatsApp Web / App con el texto completo
        handleOpenWhatsAppWithText();
    };

    const handleOpenWhatsAppWithText = () => {
        const clean = getCleanPhoneForWhatsApp();
        const textReceipt = buildTextReceipt();

        // Copiar texto de la factura al portapapeles
        try {
            navigator.clipboard.writeText(textReceipt);
            toast.success('📋 Factura copiada al portapapeles');
        } catch (e) {
            console.warn('Clipboard writeText notice', e);
        }

        // Guardar la imagen automáticamente en el almacenamiento
        const waDeepLink = clean ? `whatsapp://send?phone=${clean}&text=${encodeURIComponent(textReceipt)}` : `whatsapp://send?text=${encodeURIComponent(textReceipt)}`;
        const waUrl = `https://wa.me/${clean ? clean : ''}?text=${encodeURIComponent(textReceipt)}`;
        if (typeof window !== 'undefined' && ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))) {
            window.location.href = waDeepLink;
        } else {
            window.open(waUrl, '_blank');
        }
        setShowWhatsAppModal(false);
    };

    const handleCopyTextReceipt = async () => {
        const text = buildTextReceipt();
        try {
            await navigator.clipboard.writeText(text);
            toast.success('📋 ¡Factura completa copiada al portapapeles!');
        } catch (e) {
            console.warn('[ReceiptModal] Error capturado en operación:', e?.message || e);
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                toast.success('📋 ¡Factura copiada al portapapeles!');
            } catch (err) {
                console.warn('[ReceiptModal] Error capturado en operación:', err?.message || err);
                toast.error('No se pudo copiar el texto');
            }
            document.body.removeChild(textArea);
        }
    };

    const handleSendViaBot = async () => {
        const cleanPhone = (whatsappPhone || '').replace(/\D/g, '');
        if (!cleanPhone || cleanPhone.length < 7) {
            toast.error('Por favor ingresa un número de teléfono válido para el cliente');
            return;
        }
        if (!whatsappImageDataUrl) {
            toast.error('La imagen de la factura no está lista');
            return;
        }

        setSendingViaBot(true);
        try {
            const caption = buildTextReceipt();

            const { data } = await api.post('/whatsapp/send-media', {
                phone: whatsappPhone,
                imageBase64: whatsappImageDataUrl,
                mimeType: 'image/png',
                caption,
                filename: `Factura_${receiptNum}.png`
            });

            if (data.botSent) {
                if (data.mediaFailed) {
                    toast.success('ℹ️ Factura enviada como texto por WhatsApp');
                } else {
                    toast.success('✅ ¡Factura enviada exitosamente como imagen por WhatsApp!');
                }
                setShowWhatsAppModal(false);
            } else {
                toast.error(data.message || 'No se pudo enviar la imagen. Prueba la opción manual.');
            }
        } catch (err) {
            console.error('Error enviando imagen por WhatsApp:', err);
            const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Error al enviar por WhatsApp';
            toast.error(msg);
        } finally {
            setSendingViaBot(false);
        }
    };

    const handleCopyAndOpenWeb = async () => {
        const clean = getCleanPhoneForWhatsApp();
        const textReceipt = buildTextReceipt();
        let imageCopied = false;

        if (whatsappImageBlob && navigator.clipboard && window.ClipboardItem) {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': whatsappImageBlob })
                ]);
                imageCopied = true;
                toast.success('📋 ¡Imagen copiada al portapapeles! Puedes pegarla con Ctrl + V', { duration: 6000 });
            } catch (clipErr) {
                console.warn('Clipboard write notice:', clipErr);
            }
        }

        if (!imageCopied) {
            handleDownloadImage();
            toast('⬇️ Imagen descargada. Puedes adjuntarla en WhatsApp.', { duration: 5000 });
        }

        const waDeepLink = clean ? `whatsapp://send?phone=${clean}&text=${encodeURIComponent(textReceipt)}` : `whatsapp://send?text=${encodeURIComponent(textReceipt)}`;
        const waUrl = `https://wa.me/${clean ? clean : ''}?text=${encodeURIComponent(textReceipt)}`;
        if (typeof window !== 'undefined' && ((window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))) {
            window.location.href = waDeepLink;
        } else {
            window.open(waUrl, '_blank');
        }
        setShowWhatsAppModal(false);
    };

    const handleDownloadImage = () => {
        if (!whatsappImageBlob && !whatsappImageDataUrl) {
            toast.error('La imagen aún no está lista');
            return;
        }

        try {
            let blob = whatsappImageBlob;
            if (!blob && whatsappImageDataUrl) {
                const arr = whatsappImageDataUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) { u8arr[n] = bstr.charCodeAt(n); }
                blob = new Blob([u8arr], { type: mime });
            }

            if (blob) {
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = `Factura_${receiptNum}.png`;
                link.href = blobUrl;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
                toast.success('💾 Factura descargada en el dispositivo');
                return;
            }
        } catch (err) {
            console.warn('Blob download fallback:', err);
        }

        if (whatsappImageDataUrl) {
            const link = document.createElement('a');
            link.download = `Factura_${receiptNum}.png`;
            link.href = whatsappImageDataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success('💾 Imagen guardada');
        }
    };

    const handleEmailClick = () => {
        const customerEmail = sale.customerEmail || sale.Customer?.email || '';
        setEmailAddress(customerEmail);
        setShowEmailPrompt(true);
    };

    const handleEmailSend = async () => {
        if (!emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
            toast.error('Ingrese un correo electrónico válido');
            return;
        }
        setSendingEmail(true);
        try {
            await api.post(`/sales/${sale.id}/email`, {
                recipientEmail: emailAddress,
                recipientName: sale.customerName || 'Cliente'
            });
            toast.success('📧 Factura enviada exitosamente');
            setShowEmailPrompt(false);
            setEmailAddress('');
        } catch (err) {
            const msg = err.response?.data?.error || 'Error al enviar el correo';
            toast.error(msg);
        } finally {
            setSendingEmail(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="max-w-lg"
            className="bg-white dark:bg-slate-900 rounded-xl overflow-hidden flex flex-col max-h-[94dvh] sm:max-h-[94vh]"
        >
            {/* Header compacto para maximizar el espacio visual del recibo en pantallas pequeñas y medianas */}
            <div className={`relative px-4 py-2.5 sm:px-5 sm:py-3 text-white flex items-center justify-between gap-3 shrink-0 ${
                sale?.documentType === 'cotizacion' || sale?.documentType === 'presupuesto'
                    ? 'bg-blue-600'
                    : 'bg-emerald-600'
            }`}>
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="bg-white/20 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 border border-white/30 backdrop-blur-sm">
                        <CheckCircle2 size={18} className="text-white" />
                    </div>
                    <div className="min-w-0 text-left">
                        <h2 className="text-sm sm:text-base font-black tracking-tight uppercase leading-tight truncate">
                            {sale?.documentType === 'nota_entrega' 
                                ? '¡Nota Generada!' 
                                : (sale?.documentType === 'cotizacion' || sale?.documentType === 'presupuesto'
                                    ? '¡Cotización Generada!'
                                    : '¡Venta Exitosa!')}
                        </h2>
                        <p className="text-white/90 text-[10px] font-bold uppercase tracking-wider leading-tight truncate">
                            {dailyTicketNum ? `Número de Ticket #${dailyTicketNum} · ` : ''}
                            {sale?.documentType === 'nota_entrega' 
                                ? 'Albarán listo' 
                                : (sale?.documentType === 'cotizacion' || sale?.documentType === 'presupuesto'
                                    ? 'Presupuesto listo'
                                    : 'Recibo Generado')}
                        </p>
                    </div>
                </div>

                <button 
                    type="button"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof onClose === 'function') onClose();
                    }} 
                    className="z-50 w-8 h-8 sm:w-9 sm:h-9 bg-black/20 hover:bg-black/40 text-white rounded-full transition-all flex items-center justify-center shrink-0 cursor-pointer active:scale-90 shadow-xs" 
                    title="Cerrar [Esc]" 
                    aria-label="Cerrar modal"
                >
                    <X size={18} className="stroke-[2.5]" />
                </button>
            </div>

            {/* Receipt Content Wrapper (Scrollable) */}
            <div 
                ref={scrollContainerRef}
                onMouseDown={pauseAutoClose}
                onTouchStart={pauseAutoClose}
                className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 bg-slate-200/70 dark:bg-slate-950/80 custom-scrollbar"
            >

                {/* Switch rápido de Moneda del Comprobante */}
                {!isUsdOnly && currencyMode === 'BOTH' && (
                    <div className="mb-2.5 flex items-center justify-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl shadow-xs border border-slate-300/80 dark:border-slate-800 max-w-[380px] mx-auto">
                        <button
                            type="button"
                            onClick={() => {
                                setReceiptOnlyBs(true);
                                localStorage.setItem('pos_receipt_only_bs', 'true');
                            }}
                            className={`flex-1 justify-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all flex items-center gap-1 cursor-pointer active:scale-95 ${
                                isOnlyBs
                                    ? 'bg-emerald-600 text-white shadow-xs ring-1 ring-emerald-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            <span>🇻🇪 Solo en Bs</span>
                            {isOnlyBs && <Check size={12} strokeWidth={3} />}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setReceiptOnlyBs(false);
                                localStorage.setItem('pos_receipt_only_bs', 'false');
                            }}
                            className={`flex-1 justify-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all flex items-center gap-1 cursor-pointer active:scale-95 ${
                                !isOnlyBs
                                    ? 'bg-emerald-600 text-white shadow-xs ring-1 ring-emerald-500/30'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            <span>💵 Dual (Bs y USD)</span>
                            {!isOnlyBs && <Check size={12} strokeWidth={3} />}
                        </button>
                    </div>
                )}

                    {/* The Printable Thermal Ticket */}
                    <div
                        ref={printRef}
                        className="ticket-preview shrink-0 bg-white w-full max-w-[380px] p-4 sm:p-5 shadow-[0_10px_25px_rgba(0,0,0,0.1)] border border-slate-200/80 rounded-xl mx-auto text-slate-800 text-xs leading-relaxed relative selection:bg-slate-100"
                    >
                        {/* Marca de Agua Antifraude de Reimpresión */}
                        {Boolean(sale?.isReprint || sale?.reprintCount > 0) && (
                            <div className="mb-3 py-1.5 px-3 border-2 border-dashed border-rose-500 bg-rose-50 text-rose-700 text-center rounded-xl">
                                <p className="text-xs font-black uppercase tracking-wider">*** COPIA / REIMPRESIÓN ***</p>
                                <p className="text-[9px] font-bold uppercase tracking-tight">No válido como comprobante original</p>
                            </div>
                        )}

                        {/* 1. Encabezado de la Empresa */}
                        <div className="text-center mb-3">
                            {businessSettings.logo && sale.documentType !== 'nota_entrega' && (
                                <img src={businessSettings.logo.startsWith('/') && typeof window !== 'undefined' && window.__ISAAC_SERVER_ORIGIN__ ? `${window.__ISAAC_SERVER_ORIGIN__}${businessSettings.logo}` : businessSettings.logo} alt="Logo" className="h-12 sm:h-14 mx-auto mb-2 object-contain grayscale logo-print" />
                            )}
                            
                            {/* Nombre del Establecimiento */}
                            <h3 className="text-lg sm:text-xl font-black text-slate-950 uppercase tracking-tight leading-tight">
                                {businessSettings.name || 'Isaac POS'}
                            </h3>

                            {/* Identificación Fiscal (RUC en Ecuador, NIT en Colombia, RIF en Venezuela) */}
                            <p className="text-[11px] font-bold text-slate-700 tracking-wider uppercase mt-1">
                                {taxIdLabel}: {businessSettings.rif || (taxIdLabel === 'RUC' ? '9999999999001' : 'J-XXXXXXXX-X')}
                            </p>

                            {/* Dirección Comercial */}
                            {businessSettings.address && (
                                <p className="text-[10px] text-slate-600 uppercase mt-0.5 leading-snug px-2">
                                    {businessSettings.address}
                                </p>
                            )}

                            {/* Teléfono de Contacto */}
                            {businessSettings.phone && (
                                <p className="text-[10px] font-bold text-slate-600 uppercase mt-0.5">
                                    TEL: {businessSettings.phone}
                                </p>
                            )}

                            {/* Mensaje de Cabecera Personalizado si existe */}
                            {businessSettings.receiptHeader && (
                                <div 
                                    dangerouslySetInnerHTML={{ __html: parseTemplate(businessSettings.receiptHeader, templateVariables) }} 
                                    className="text-[10px] font-bold text-slate-800 uppercase mt-1.5 italic leading-tight"
                                />
                            )}

                            <div className="border-b border-dashed border-slate-300 my-3"></div>
                        </div>

                        {/* 2. Metadatos de la Transacción y Control */}
                        <div className="space-y-1.5 text-[11px] font-medium uppercase mb-3">
                            {dailyTicketNum && (
                                <div className="flex justify-between items-center bg-slate-100 px-2 py-1 rounded border border-slate-300 mb-1">
                                    <span className="text-slate-800 font-black text-xs">NÚMERO DE TICKET:</span>
                                    <span className="text-right text-slate-950 font-black font-mono text-sm">#{dailyTicketNum}</span>
                                </div>
                            )}

                            <div className="flex justify-between items-center">
                                <span className="text-slate-500 font-semibold">DOCUMENTO:</span>
                                <span className="text-right text-slate-950 font-black tracking-wide">{documentTitle.toUpperCase()}</span>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-slate-500 font-semibold">NRO RECIBO:</span>
                                <span className="text-right text-slate-950 font-black font-mono">{dailyTicketNum ? `#${dailyTicketNum} (${receiptNum})` : `#${receiptNum}`}</span>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-slate-500 font-semibold">FECHA / HORA:</span>
                                <span className="text-right text-slate-800 font-bold">
                                    {new Date(sale.createdAt || sale.date || Date.now()).toLocaleDateString()} {new Date(sale.createdAt || sale.date || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>

                            <div className="flex justify-between items-center">
                                <span className="text-slate-500 font-semibold">CAJERO / CAJA:</span>
                                <span className="text-right text-slate-800 font-bold truncate max-w-[200px]" title={sale.cashierName || sale.userName || 'Caja Principal'}>
                                    {sale.cashierName || sale.userName || sale.User?.name || businessSettings.cashierName || 'Caja Principal'} ({sale.registerDisplayName || sale.registerName || (sale.registerId ? `Caja #${sale.registerId}` : 'Caja 1')})
                                </span>
                            </div>

                            {/* Tasa de cambio cuando opera en modo dual y NO está en modo Solo Bs */}
                            {!isUsdOnly && currencyMode === 'BOTH' && !isOnlyBs && (
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 font-semibold">TASA DE CAMBIO:</span>
                                    <span className="text-right text-slate-950 font-black font-mono">
                                        {formatBs(effectiveRate).replace('Bs.S ', '').replace('Bs. ', '').replace('Bs.', '').trim()} Bs/$
                                    </span>
                                </div>
                            )}

                            <div className="border-b border-dashed border-slate-200 my-2"></div>

                            {/* Datos del Cliente */}
                            <div className="flex justify-between items-center">
                                <span className="text-slate-500 font-semibold">CLIENTE:</span>
                                <span className="text-right text-slate-950 font-black truncate max-w-[200px]">
                                    {sale.customerName || 'CLIENTE OCASIONAL'}
                                </span>
                            </div>

                            {(sale.customerDoc || sale.customerDocument || sale.Customer?.idDocument) && (
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 font-semibold">{clientDocLabel}:</span>
                                    <span className="text-right text-slate-800 font-bold font-mono">
                                        {sale.customerDoc || sale.customerDocument || sale.Customer?.idDocument}
                                    </span>
                                </div>
                            )}

                            {(sale.customerPhone || sale.Customer?.phone) && (
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-500 font-semibold">TELÉFONO CLIENTE:</span>
                                    <span className="text-right text-slate-800 font-bold">
                                        {sale.customerPhone || sale.Customer?.phone}
                                    </span>
                                </div>
                            )}

                            {/* Acceso SRI en caso de Ecuador */}
                            {sale.sriAccessKey && (
                                <div className="mt-1 pt-1 border-t border-slate-100">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-slate-500 font-semibold">ESTADO SRI:</span>
                                        <span className="text-emerald-700 font-black">AUTORIZADA</span>
                                    </div>
                                    <span className="block text-[9px] text-slate-500 font-bold mb-0.5">CLAVE ACCESO SRI (49 DÍGITOS):</span>
                                    <span className="block text-left text-slate-800 font-mono text-[9px] break-all bg-slate-50 p-1.5 rounded border border-slate-200">
                                        {sale.sriAccessKey}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* 3. Encabezado de Tabla de Artículos */}
                        <div className="border-y-2 border-dashed border-slate-400 py-1.5 my-3 flex justify-between items-center text-[10.5px] font-black text-slate-800 uppercase tracking-wider">
                            <span className="w-12 text-left">CANT</span>
                            <span className="flex-1 text-left px-2">DESCRIPCIÓN</span>
                            <span className="w-24 text-right">TOTAL</span>
                        </div>

                        {/* 4. Lista Detallada de Artículos */}
                        <div className="space-y-2.5 mb-3">
                            {saleItems.map((item, idx) => {
                                const itemSubtotal = item.subtotal !== undefined ? item.subtotal : (item.price * item.quantity);
                                return (
                                    <div key={idx} className="flex flex-col gap-0.5 text-xs pb-2 border-b border-slate-100 last:border-b-0">
                                        {/* Fila principal del ítem */}
                                        <div className="flex justify-between items-start gap-1">
                                            <span className="w-10 font-bold text-slate-700 text-xs">
                                                {formatStock(item.quantity)}x
                                            </span>
                                            <div className="flex-1">
                                                <span className="font-bold text-slate-950 uppercase leading-snug text-xs">
                                                    {item.name}
                                                </span>
                                                {item.isBulk && (
                                                    <span className="inline-block ml-1.5 px-1.5 py-0.5 bg-indigo-100 text-indigo-900 border border-indigo-300 rounded text-[9px] font-black tracking-wide">
                                                        📦 {item.bulkUnitName || 'PAQ'} (x{item.unitsPerBulk})
                                                    </span>
                                                )}
                                                {item.isMidBulk && (
                                                    <span className="inline-block ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[9px] font-black tracking-wide">
                                                        📑 {item.midBulkUnitName || 'MEDIA'} (x{item.unitsPerMidBulk})
                                                    </span>
                                                )}
                                            </div>
                                            <span className="w-24 text-right font-black text-slate-950 text-xs">
                                                {renderFormatMoney(itemSubtotal, (!isUsdOnly && currencyMode === 'BOTH') ? 'VES' : 'USD')}
                                            </span>
                                        </div>

                                        {/* Sub-fila con precio unitario y referencia en USD */}
                                        <div className="flex justify-between text-[10px] text-slate-500 font-semibold pl-10 pr-0">
                                            <span>P.{item.isBulk ? (item.bulkUnitName || 'Paq') : item.isMidBulk ? (item.midBulkUnitName || 'Media') : 'Unit'}: {renderFormatMoney(item.price, isUsdOnly ? 'USD' : (isOnlyBs ? 'VES' : null))}</span>
                                            {!isUsdOnly && currencyMode === 'BOTH' && !isOnlyBs && (
                                                <span className="font-mono text-slate-400">
                                                    Ref: {renderFormatMoney(itemSubtotal, 'USD')}
                                                </span>
                                            )}
                                        </div>

                                        {/* Metadatos adicionales (SKU, Lote, Vencimiento) */}
                                        {(item.code || item.barcode || item.sku || item.batchNumber || item.expirationDate) && (
                                            <div className="flex flex-wrap gap-x-2 text-[9px] text-slate-400 pl-10 mt-0.5">
                                                {(item.code || item.barcode || item.sku) && (
                                                    <span>Cód: {item.code || item.barcode || item.sku}</span>
                                                )}
                                                {item.batchNumber && <span>Lote: {item.batchNumber}</span>}
                                                {item.expirationDate && <span>Venc: {item.expirationDate}</span>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="border-b-2 border-dashed border-slate-400 my-3"></div>

                        {/* 5. Resumen y Desglose Financiero Completo */}
                        <div className="space-y-1.5 text-xs font-semibold text-slate-600 uppercase mb-3">
                            <div className="flex justify-between text-slate-500 text-[10.5px]">
                                <span>TOTAL ÍTEMS / UNIDADES:</span>
                                <span className="font-bold text-slate-800">{saleItems.length} ítems ({totalUnitsCount} unids)</span>
                            </div>

                            <div className="flex justify-between">
                                <span>SUB-TOTAL:</span>
                                <span className="font-bold text-slate-900">{renderFormatMoney(sale.subtotal)}</span>
                            </div>

                            {sale.taxInfo?.exemptBase > 0 && (
                                <div className="flex justify-between">
                                    <span>BASE EXENTA (E):</span>
                                    <span className="font-bold text-slate-900">{renderFormatMoney(sale.taxInfo.exemptBase)}</span>
                                </div>
                            )}

                            {sale.taxInfo?.taxableBase > 0 && (
                                <div className="flex justify-between">
                                    <span>BASE IMPONIBLE (G):</span>
                                    <span className="font-bold text-slate-900">{renderFormatMoney(sale.taxInfo.taxableBase)}</span>
                                </div>
                            )}

                            {(sale.taxAmount > 0 || sale.tax > 0) && (
                                <div className="flex justify-between">
                                    <span>IVA ({sale.taxRate || 16}%):</span>
                                    <span className="font-bold text-slate-900">{renderFormatMoney(sale.taxAmount || sale.tax)}</span>
                                </div>
                            )}

                            {sale.igtfAmount > 0 && (
                                <div className="flex justify-between">
                                    <span>IGTF (3%):</span>
                                    <span className="font-bold text-slate-900">{renderFormatMoney(sale.igtfAmount)}</span>
                                </div>
                            )}

                            {(sale.discountAmount > 0 || sale.discount > 0) && (
                                <div className="flex justify-between text-emerald-700 font-bold">
                                    <span>DESCUENTO:</span>
                                    <span>-{renderFormatMoney(sale.discountAmount || sale.discount)}</span>
                                </div>
                            )}

                            {/* TOTAL GENERAL */}
                            <div className="flex justify-between items-baseline text-base sm:text-lg font-black text-slate-950 pt-2.5 mt-2 border-t-2 border-slate-950">
                                <span>TOTAL A PAGAR:</span>
                                <span className="tracking-tight text-right font-black">
                                    {renderFormatMoney(sale.total, (!isUsdOnly && currencyMode === 'BOTH') ? 'VES' : 'USD')}
                                </span>
                            </div>

                            {/* REFERENCIA EN DÓLARES */}
                            {!isUsdOnly && currencyMode === 'BOTH' && !isOnlyBs && (
                                <div className="flex justify-between items-center text-xs font-bold text-slate-700 bg-slate-100/90 rounded-xl px-3 py-1.5 mt-2 border border-slate-200/80">
                                    <span>REF. USD ($):</span>
                                    <span className="font-mono font-black text-slate-950 text-sm">{renderFormatMoney(sale.total, 'USD')}</span>
                                </div>
                            )}
                        </div>

                        <div className="border-b border-dashed border-slate-300 my-3"></div>

                        {/* 6. Desglose de Formas de Pago y Vuelto */}
                        <div className="bg-slate-50/90 p-3 rounded-xl border border-slate-200/80 text-[11px] font-semibold text-slate-700 mb-3">
                            <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-1.5">
                                DETALLE DE PAGO / FORMA DE PAGO:
                            </span>

                            {normalizedPaymentMethods.length > 0 ? (
                                <div className="space-y-1.5">
                                    {normalizedPaymentMethods.map((pm, idx) => {
                                        const isCrypto = pm.method === 'binance_usdt' || String(pm.method).toLowerCase().includes('binance') || (pm.currency || '').toUpperCase() === 'USDT';
                                        const pmCurr = isCrypto ? (isUsdOnly ? 'USD' : 'VES') : (isUsdOnly ? 'USD' : (pm.currency || (['cash_bs', 'debit', 'pago_movil', 'biopago', 'transfer'].includes(pm.method) ? 'VES' : 'USD')).toUpperCase());
                                        const isVes = !isUsdOnly && (pmCurr === 'VES' || pmCurr === 'BS');
                                        let amt = pm.amount;
                                        if (isCrypto && !isUsdOnly) {
                                            amt = pm.convertedAmountBs || (pm.amount && pm.cryptoRate ? Number(pm.amount) * Number(pm.cryptoRate) : (sale.totalBs || (sale.total * (exchangeRate || 1))));
                                        }
                                        const amtFormatted = isVes ? formatBs(amt) : formatUSD(amt);
                                        const pmRef = String(pm.reference || pm.ref || pm.paymentReference || (normalizedPaymentMethods.length === 1 ? fallbackSaleReference : '') || '').trim();
                                        return (
                                            <div key={idx} className="space-y-0.5">
                                                <div className="flex justify-between items-center text-slate-950 font-bold">
                                                    <span>• {formatPaymentMethodName(pm.method, pmCurr)}:</span>
                                                    <span>{amtFormatted}</span>
                                                </div>
                                                {pmRef && (
                                                    <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-700 pl-2.5">
                                                        <span>REF. OPERACIÓN:</span>
                                                        <span className="text-slate-950 font-black">#{pmRef}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="space-y-0.5">
                                    <div className="flex justify-between items-center text-slate-950 font-bold">
                                        <span>• {formatPaymentMethodName(sale.paymentMethod, sale.currency || (sale.paymentMethod === 'cash_bs' ? 'VES' : 'USD'))}:</span>
                                        <span>{renderFormatMoney(sale.total, (!isUsdOnly && currencyMode === 'BOTH') ? 'VES' : 'USD')}</span>
                                    </div>
                                    {fallbackSaleReference && (
                                        <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-700 pl-2.5">
                                            <span>REF. OPERACIÓN:</span>
                                            <span className="text-slate-950 font-black">#{fallbackSaleReference}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Vuelto / Cambio si aplica */}
                            {((sale.changeBs > 0 || sale.changeUsd > 0 || sale.change > 0)) && (
                                <div className="flex justify-between items-center text-emerald-700 font-bold mt-2 pt-2 border-t border-slate-200/80">
                                    <span>VUELTO / CAMBIO ENTREGADO:</span>
                                    <span className="font-black">
                                        {!isUsdOnly && sale.changeBs > 0 ? formatBs(sale.changeBs) : formatUSD(sale.changeUsd || sale.change || sale.changeBs)}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* 7. Pie de Página y Agradecimiento */}
                        <div className="text-center px-1 pt-1">
                            {businessSettings.receiptFooter ? (
                                <div 
                                    dangerouslySetInnerHTML={{ __html: parseTemplate(businessSettings.receiptFooter, templateVariables) }} 
                                    className="text-[11px] font-black text-slate-900 uppercase leading-snug"
                                />
                            ) : (
                                <p className="text-xs font-black text-slate-950 uppercase tracking-wider">
                                    ¡GRACIAS POR SU COMPRA!
                                </p>
                            )}

                            <p className="text-[9.5px] font-semibold text-slate-500 uppercase mt-1.5">
                                {sale.documentType === 'cotizacion' || sale.documentType === 'presupuesto'
                                    ? `VALIDEZ: ${sale.validUntil ? new Date(sale.validUntil).toLocaleDateString() : '30 DÍAS'} | SIN VALIDEZ FISCAL`
                                    : 'CONSERVE SU COMPROBANTE PARA RECLAMOS O GARANTÍA'}
                            </p>

                            {/* Código de barras visual real con JsBarcode */}
                            <div className="my-3 flex flex-col items-center justify-center">
                                <svg ref={barcodeRef} className="barcode-svg max-w-[220px] h-10"></svg>
                                <span className="text-[9.5px] font-mono font-bold text-slate-600 tracking-widest mt-1">
                                    RECIBO #{receiptNum}
                                </span>
                            </div>

                            <p className="text-[9px] font-mono text-slate-400 tracking-widest mt-1">
                                Isaac POS
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div 
                    onMouseDown={pauseAutoClose}
                    onTouchStart={pauseAutoClose}
                    className="px-3.5 py-2.5 sm:px-4 sm:py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2 shrink-0 font-sans"
                >
                    {/* Email Prompt (inline) */}
                    {showEmailPrompt && (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 animate-in slide-in-from-bottom-2">
                            <p className="text-[11px] font-bold text-blue-800 mb-1.5">📧 Enviar factura por correo electrónico</p>
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={emailAddress}
                                    onChange={(e) => setEmailAddress(e.target.value)}
                                    placeholder="correo@ejemplo.com"
                                    className="flex-1 px-3 py-1.5 text-xs border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium text-slate-800"
                                    onKeyDown={(e) => e.key === 'Enter' && handleEmailSend()}
                                    autoFocus
                                    disabled={sendingEmail}
                                />
                                <button
                                    onClick={handleEmailSend}
                                    disabled={sendingEmail}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5"
                                >
                                    {sendingEmail ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                                    {sendingEmail ? 'Enviando...' : 'Enviar'}
                                </button>
                                <button
                                    onClick={() => setShowEmailPrompt(false)}
                                    disabled={sendingEmail}
                                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg font-bold text-xs transition-all"
                                >
                                    <X size={13} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Botón de Envío Directo de Imagen por WhatsApp */}
                    <button
                        type="button"
                        onClick={handleDirectWhatsAppImage}
                        disabled={capturingImage}
                        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-75 text-white rounded-lg font-bold text-[11px] uppercase tracking-wider transition-colors shadow-xs active:scale-98 flex items-center justify-center gap-1.5 border border-emerald-500/30 cursor-pointer"
                    >
                        {capturingImage ? (
                            <Loader2 size={14} className="animate-spin text-white" />
                        ) : (
                            <Share2 size={14} className="text-white" />
                        )}
                        <span>{capturingImage ? 'Generando...' : 'Enviar Imagen por WhatsApp'}</span>
                    </button>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 w-full">
                        <button
                            onClick={handlePrint}
                            className="flex-1 min-w-[85px] min-h-[36px] flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg font-bold transition-colors text-[11px] border border-slate-700 cursor-pointer"
                        >
                            <Printer size={14} className="text-white shrink-0" /> Imprimir
                        </button>
                        <button
                            onClick={handleWhatsAppShare}
                            disabled={capturingImage}
                            className="flex-1 min-w-[85px] min-h-[36px] flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-3 py-1.5 rounded-lg font-bold transition-colors text-[11px] border border-emerald-500/30 cursor-pointer"
                        >
                            {capturingImage ? <Loader2 size={14} className="animate-spin text-white shrink-0" /> : <MessageCircle size={14} className="text-white shrink-0" />}
                            {capturingImage ? 'Generando...' : 'WhatsApp'}
                        </button>
                        <button
                            onClick={handleEmailClick}
                            className="flex-1 min-w-[75px] min-h-[36px] flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg font-bold transition-colors text-[11px] border border-sky-500/30 cursor-pointer"
                        >
                            <Mail size={14} className="text-white shrink-0" /> Email
                        </button>
                        {onRefund && sale?.status !== 'refunded' && sale?.status !== 'cancelled' && (
                            <button
                                onClick={onRefund}
                                className="flex-1 min-w-[90px] min-h-[36px] flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 px-3 py-1.5 rounded-lg font-bold transition-colors text-[11px] border border-rose-200 dark:border-rose-900 cursor-pointer"
                            >
                                <CornerUpLeft size={14} className="shrink-0" /> Devolución
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (typeof onClose === 'function') onClose();
                            }}
                            className="col-span-2 sm:col-span-1 w-full sm:w-auto min-h-[36px] flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-4 py-1.5 rounded-lg font-bold transition-colors text-[11px] border border-slate-300 dark:border-slate-700 cursor-pointer"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>

                {/* Sub-modal: Compartir Factura por WhatsApp como Imagen */}
                {showWhatsAppModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden flex flex-col">
                            {/* Header */}
                            <div className="p-4 bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between border-b border-slate-800">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-slate-800 dark:bg-slate-700 flex items-center justify-center border border-slate-700 text-emerald-400">
                                        <MessageCircle size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold uppercase tracking-tight">Enviar Factura por WhatsApp</h3>
                                        <p className="text-[11px] text-slate-400 font-medium">Recibo #{receiptNum}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowWhatsAppModal(false)}
                                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="p-4 sm:p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
                                {/* Estado del Bot */}
                                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs border border-slate-200 dark:border-slate-700">
                                    <span className="font-semibold text-slate-500 dark:text-slate-400">WhatsApp Directo:</span>
                                    {botStatus === 'CONNECTED' ? (
                                        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                            Conectado y Listo
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-medium">
                                            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                                            WhatsApp Web estándar
                                        </span>
                                    )}
                                </div>

                                {/* Campo Teléfono del Cliente */}
                                <div>
                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                                        Teléfono del Cliente:
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                            <Phone size={15} />
                                        </div>
                                        <input
                                            type="text"
                                            value={whatsappPhone}
                                            onChange={(e) => setWhatsappPhone(e.target.value)}
                                            placeholder="Ej: 04121234567 o +584121234567"
                                            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                                            disabled={sendingViaBot}
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        Puedes confirmar o editar el número antes de enviar.
                                    </p>
                                </div>

                                {/* Previsualización de la Imagen */}
                                {whatsappImageDataUrl && (
                                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                                        <div className="w-14 h-18 bg-white rounded border border-slate-200 shrink-0 overflow-hidden flex items-center justify-center">
                                            <img src={whatsappImageDataUrl} alt="Preview ticket" className="w-full h-full object-cover object-top" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-slate-800 dark:text-white uppercase truncate">Ticket Digital</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Formato imagen (PNG)</p>
                                            <button
                                                type="button"
                                                onClick={handleDownloadImage}
                                                className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                                            >
                                                <Download size={11} /> Descargar PNG
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Botones de Acción */}
                                <div className="space-y-2 pt-1">
                                    <button
                                        onClick={handleNativeShare}
                                        disabled={sendingViaBot}
                                        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors shadow-sm cursor-pointer"
                                    >
                                        <Share2 size={16} className="text-white shrink-0" />
                                        <span>Enviar Imagen Directa a WhatsApp</span>
                                    </button>

                                    <button
                                        onClick={handleOpenWhatsAppWithText}
                                        disabled={sendingViaBot}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                                    >
                                        <MessageCircle size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                        <span>Enviar Recibo Escrito a WhatsApp</span>
                                    </button>

                                    {typeof window !== 'undefined' && !window.Capacitor?.isNativePlatform?.() && (
                                        <button
                                            onClick={handleCopyAndOpenWeb}
                                            disabled={sendingViaBot}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors border border-slate-700 cursor-pointer"
                                        >
                                            <ExternalLink size={15} className="text-emerald-400 shrink-0" />
                                            <span>Copiar Imagen y Abrir WhatsApp Web</span>
                                        </button>
                                    )}

                                    {botStatus === 'CONNECTED' && (
                                        <button
                                            onClick={handleSendViaBot}
                                            disabled={sendingViaBot}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors shadow-sm cursor-pointer"
                                        >
                                            {sendingViaBot ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />}
                                            <span>{sendingViaBot ? 'Enviando comprobante...' : 'Enviar por WhatsApp Directo'}</span>
                                        </button>
                                    )}

                                    {/* Fila de Utilidades: Copiar texto y Guardar Imagen */}
                                    <div className="flex items-center gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={handleCopyTextReceipt}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg font-bold text-xs transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                                        >
                                            <Copy size={13} className="text-slate-500" />
                                            <span>Copiar Texto</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDownloadImage}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg font-bold text-xs transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                                        >
                                            <Download size={13} className="text-slate-500" />
                                            <span>Guardar Imagen</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Nota de ayuda */}
                                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                                    <p className="text-[10.5px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                                        📱 En terminales táctiles puedes enviar la imagen del recibo directamente a WhatsApp o guardarla como comprobante.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

        </BaseModal>
    );
}
