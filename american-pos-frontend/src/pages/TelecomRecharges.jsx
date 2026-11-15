import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    Smartphone, Wallet, Printer, CheckCircle2, XCircle, RefreshCw,
    Copy, ExternalLink, Search, TrendingUp, DollarSign, ShieldCheck,
    AlertCircle, Eye, EyeOff, Share2, Settings2, Zap, Banknote, CreditCard, History, LayoutPanelLeft, Plus, RotateCcw
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { usePos } from '../hooks/PosContext';
import { formatBs, formatUSD } from '../utils/format';
import { formatRechargeToEscPos } from '../utils/escposFormatter';

const DEFAULT_MOVILWAY_URL = 'https://web-ve.movilway.net/Pos/';

const OPERADORAS = {
    MOVISTAR: {
        id: 'MOVISTAR',
        nombre: 'Movistar',
        prefijos: ['0414', '0424'],
        color: '#00a9e0',
        bgLight: 'bg-sky-50 dark:bg-sky-950/40',
        border: 'border-sky-500',
        text: 'text-sky-600 dark:text-sky-400',
        badgeBg: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
        regla: 'Escala Movistar (Mín. Bs. 40 • Múltiplos de Bs. 10)',
        montosPorDefecto: [40, 60, 100, 150, 200, 300, 400, 500, 600, 900, 1200, 1600]
    },
    DIGITEL: {
        id: 'DIGITEL',
        nombre: 'Digitel',
        prefijos: ['0412'],
        color: '#e30613',
        bgLight: 'bg-rose-50 dark:bg-rose-950/40',
        border: 'border-rose-600',
        text: 'text-rose-600 dark:text-rose-400',
        badgeBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
        regla: 'Escala Oficial Digitel (Bloques y peldaños autorizados)',
        montosPorDefecto: [50, 100, 150, 200, 300, 320, 500, 640, 960, 1280, 2400]
    },
    MOVILNET: {
        id: 'MOVILNET',
        nombre: 'Movilnet',
        prefijos: ['0416', '0426'],
        color: '#ff6600',
        bgLight: 'bg-orange-50 dark:bg-orange-950/40',
        border: 'border-orange-500',
        text: 'text-orange-600 dark:text-orange-400',
        badgeBg: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
        regla: 'Escala Oficial Movilnet (Mín. Bs. 30 • Prepago 4GMAX)',
        montosPorDefecto: [30, 50, 60, 90, 100, 150, 200, 300, 400, 600, 900, 1500]
    },
    CANTV: {
        id: 'CANTV',
        nombre: 'CANTV / Inter',
        prefijos: ['02'],
        color: '#003399',
        bgLight: 'bg-indigo-50 dark:bg-indigo-950/40',
        border: 'border-indigo-600',
        text: 'text-indigo-600 dark:text-indigo-400',
        badgeBg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
        regla: 'Telefonía Fija / Internet / TV Prepago',
        montosPorDefecto: [50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000]
    }
};

const DEFAULT_MONTOS_MAP = {
    MOVISTAR: OPERADORAS.MOVISTAR.montosPorDefecto,
    DIGITEL: OPERADORAS.DIGITEL.montosPorDefecto,
    MOVILNET: OPERADORAS.MOVILNET.montosPorDefecto,
    CANTV: OPERADORAS.CANTV.montosPorDefecto
};

const METODOS_COBRO = [
    { id: 'pago_movil', label: 'Pago Móvil', requiresRef: true, icon: Smartphone },
    { id: 'cash_bs', label: 'Efectivo (Bs)', requiresRef: false, icon: Banknote },
    { id: 'debit', label: 'Punto de Venta', requiresRef: false, icon: CreditCard },
    { id: 'biopago', label: 'Biopago BDV', requiresRef: false, icon: ShieldCheck },
    { id: 'cash', label: 'Efectivo ($ / Divisas)', requiresRef: false, icon: DollarSign },
    { id: 'zelle', label: 'Zelle', requiresRef: true, icon: Zap }
];

export default function TelecomRecharges() {
    const { exchangeRate, registerId, registerDisplayName } = usePos();
    const webviewRef = useRef(null);
    const popupWindowRef = useRef(null);

    const isElectronEnv = typeof window !== 'undefined' && Boolean(window.electronAPI);

    // Configuración de URL y % de comisión predeterminado (20%)
    const [movilwayUrl, setMovilwayUrl] = useState(() => {
        return localStorage.getItem('pos_movilway_url') || DEFAULT_MOVILWAY_URL;
    });
    const [isEditingUrl, setIsEditingUrl] = useState(false);

    // Estados del formulario de Caja (POS)
    const [telefono, setTelefono] = useState('');
    const [operadora, setOperadora] = useState('MOVISTAR');
    const [montoNominal, setMontoNominal] = useState('');
    const [montosPorOperadora, setMontosPorOperadora] = useState(() => {
        try {
            const raw = localStorage.getItem('pos_operator_amounts_v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    MOVISTAR: Array.isArray(parsed.MOVISTAR) && parsed.MOVISTAR.length > 0 ? parsed.MOVISTAR : DEFAULT_MONTOS_MAP.MOVISTAR,
                    DIGITEL: Array.isArray(parsed.DIGITEL) && parsed.DIGITEL.length > 0 ? parsed.DIGITEL : DEFAULT_MONTOS_MAP.DIGITEL,
                    MOVILNET: Array.isArray(parsed.MOVILNET) && parsed.MOVILNET.length > 0 ? parsed.MOVILNET : DEFAULT_MONTOS_MAP.MOVILNET,
                    CANTV: Array.isArray(parsed.CANTV) && parsed.CANTV.length > 0 ? parsed.CANTV : DEFAULT_MONTOS_MAP.CANTV
                };
            }
        } catch (_) {}
        return DEFAULT_MONTOS_MAP;
    });
    const [isEditingMontos, setIsEditingMontos] = useState(false);
    const [nuevoMontoInput, setNuevoMontoInput] = useState('');
    const [porcentajeComision, setPorcentajeComision] = useState(() => {
        const saved = localStorage.getItem('pos_recharge_default_fee');
        return saved !== null ? Number(saved) : 20;
    });
    const [metodoPago, setMetodoPago] = useState('pago_movil');
    const [refPagoCliente, setRefPagoCliente] = useState('');
    const [refMovilwayManual, setRefMovilwayManual] = useState('');

    // Estados de control de Movilway y Bolsa
    const [saldoBolsaNum, setSaldoBolsaNum] = useState(null);
    const [isEditingSaldo, setIsEditingSaldo] = useState(false);
    const [saldoInputManual, setSaldoInputManual] = useState('');
    const [estadoProceso, setEstadoProceso] = useState('LISTO'); // LISTO, PROCESANDO, ESPERANDO_CONFIRMACION
    const [txActualId, setTxActualId] = useState(null);
    const [mostrarPortal, setMostrarPortal] = useState(true);
    const [rightTab, setRightTab] = useState('PORTAL'); // 'PORTAL' | 'HISTORIAL'
    const [mensajeSistema, setMensajeSistema] = useState('');
    const [tipoMensaje, setTipoMensaje] = useState('info'); // 'info' | 'success' | 'error'

    // Estados de Historial y Estadísticas
    const [recharges, setRecharges] = useState([]);
    const [stats, setStats] = useState({
        totalNominalBs: 0,
        totalServiceFeeBs: 0,
        totalChargedBs: 0,
        completedCount: 0,
        pendingCount: 0
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [businessSettings, setBusinessSettings] = useState({});

    // Cálculos exactos de caja (Redondeo seguro a 2 decimales)
    const montoNum = parseFloat(montoNominal) || 0;
    const feePct = parseFloat(porcentajeComision) || 0;
    const comisionBs = Math.round((montoNum * feePct) * 100) / 10000;
    const totalCobrarNum = Number((montoNum + comisionBs).toFixed(2));
    const totalCobrarStr = totalCobrarNum.toFixed(2);
    const effRate = Number(exchangeRate) || 1;
    const totalCobrarUsd = effRate > 0 ? Number((totalCobrarNum / effRate).toFixed(2)) : 0;

    const selectedMethodConfig = useMemo(() => {
        return METODOS_COBRO.find(m => m.id === metodoPago) || METODOS_COBRO[0];
    }, [metodoPago]);

    // Cargar configuración de empresa e historial del día
    const fetchRechargesAndStats = useCallback(async () => {
        try {
            setLoadingHistory(true);
            const todayStr = new Date().toISOString().split('T')[0];
            const { data } = await api.get('/recharges', {
                params: {
                    startDate: todayStr,
                    endDate: todayStr,
                    limit: 150
                }
            });
            if (data) {
                setRecharges(Array.isArray(data.data) ? data.data : []);
                if (data.stats) {
                    setStats(data.stats);
                    if (data.stats.lastWalletBalanceBs !== null && data.stats.lastWalletBalanceBs !== undefined) {
                        setSaldoBolsaNum(prev => prev === null ? Number(data.stats.lastWalletBalanceBs) : prev);
                    }
                }
            }
        } catch (err) {
            console.warn('Error cargando historial de recargas:', err.message);
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        fetchRechargesAndStats();
        api.get('/settings')
            .then(res => {
                if (res.data) {
                    setBusinessSettings(res.data.businessInfo || res.data || {});
                }
            })
            .catch(() => {});
    }, [fetchRechargesAndStats]);

    // Auto-detectar operadora al escribir los primeros dígitos
    const handleTelefonoChange = (e) => {
        const val = e.target.value.replace(/\D/g, '').slice(0, 11);
        setTelefono(val);

        if (val.length >= 4) {
            const pref = val.slice(0, 4);
            if (['0414', '0424'].includes(pref)) setOperadora('MOVISTAR');
            else if (pref === '0412') setOperadora('DIGITEL');
            else if (['0416', '0426'].includes(pref)) setOperadora('MOVILNET');
            else if (val.startsWith('02')) setOperadora('CANTV');
        } else if (val.startsWith('02')) {
            setOperadora('CANTV');
        }
    };

    const handlePorcentajeChange = (val) => {
        setPorcentajeComision(val);
        const num = parseFloat(val);
        if (!isNaN(num) && num >= 0) {
            localStorage.setItem('pos_recharge_default_fee', String(num));
        }
    };

    const montosOperadoraActual = useMemo(() => {
        return montosPorOperadora[operadora] || OPERADORAS[operadora]?.montosPorDefecto || [];
    }, [montosPorOperadora, operadora]);

    const actualizarMontosOperadora = useCallback((opId, nuevosMontos) => {
        const cleanSorted = Array.from(new Set(
            nuevosMontos
                .map(n => Number(n))
                .filter(n => !isNaN(n) && n > 0)
        )).sort((a, b) => a - b);

        if (cleanSorted.length === 0) return;

        setMontosPorOperadora(prev => {
            const updated = { ...prev, [opId]: cleanSorted };
            try {
                localStorage.setItem('pos_operator_amounts_v1', JSON.stringify(updated));
            } catch (_) {}
            return updated;
        });
    }, []);

    const handleAgregarMontoOperadora = () => {
        const num = parseFloat(nuevoMontoInput);
        if (isNaN(num) || num <= 0) {
            toast.error('Ingresa un monto en Bs. mayor a 0');
            return;
        }
        const actuales = montosPorOperadora[operadora] || [];
        actualizarMontosOperadora(operadora, [...actuales, num]);
        setNuevoMontoInput('');
        toast.success(`Monto Bs. ${num} añadido a ${OPERADORAS[operadora]?.nombre}`);
    };

    const handleEliminarMontoOperadora = (montoEliminar) => {
        const actuales = montosPorOperadora[operadora] || [];
        if (actuales.length <= 1) {
            toast.error('Cada operadora debe tener al menos un monto rápido');
            return;
        }
        actualizarMontosOperadora(operadora, actuales.filter(m => m !== montoEliminar));
    };

    const handleRestaurarMontosOperadora = () => {
        const defaults = DEFAULT_MONTOS_MAP[operadora] || [50, 100, 150, 200, 300, 500];
        actualizarMontosOperadora(operadora, defaults);
        toast.success(`Escala oficial de ${OPERADORAS[operadora]?.nombre} restaurada`);
    };

    // Sincronizar montos directamente desde el <select> o botones del portal Movilway si están visibles
    const sincronizarMontosDesdePortal = async () => {
        const wv = webviewRef.current;
        if (!isElectronEnv || !wv) {
            toast.error('Disponible cuando el portal Movilway está abierto en el panel derecho');
            return;
        }
        try {
            const extracted = await wv.executeJavaScript(`
                (function() {
                    const montos = [];
                    const selects = Array.from(document.querySelectorAll('select'));
                    selects.forEach(sel => {
                        Array.from(sel.options || []).forEach(opt => {
                            const txt = (opt.innerText || opt.value || '').replace(/\\./g, '').replace(',', '.');
                            const m = txt.match(/\\b([0-9]{2,5}(?:\\.[0-9]{1,2})?)\\b/);
                            if (m) {
                                const val = parseFloat(m[1]);
                                // Ignorar códigos de área (0414, 0424, 0412, 0416, 0426) o años
                                if (val >= 10 && val <= 15000 && ![414, 424, 412, 416, 426, 2024, 2025, 2026].includes(val)) {
                                    montos.push(val);
                                }
                            }
                        });
                    });
                    return Array.from(new Set(montos)).sort((a, b) => a - b);
                })();
            `);
            if (Array.isArray(extracted) && extracted.length >= 2) {
                actualizarMontosOperadora(operadora, extracted);
                toast.success(`${extracted.length} montos sincronizados desde Movilway para ${OPERADORAS[operadora]?.nombre}`);
            } else {
                toast('Abre primero el formulario de la operadora en Movilway ("Recargas") para detectar su lista desplegable, o edítalos manualmente con el botón Editar.', { icon: 'ℹ️' });
            }
        } catch (_) {
            toast.error('No se pudo leer la lista desde el portal en este momento');
        }
    };

    // Sincronizar saldo detectado de Movilway con el backend
    const syncWalletBalanceToBackend = useCallback(async (numericBalance) => {
        if (isNaN(numericBalance) || numericBalance < 0) return;
        setSaldoBolsaNum(numericBalance);
        try {
            await api.post('/recharges/wallet-balance', { balanceBs: numericBalance });
        } catch (_) {}
    }, []);

    // Escuchar el Webview de Movilway (cuando corre en Electron) para leer el saldo ("Saldo Bs.S 103.61")
    useEffect(() => {
        if (!isElectronEnv) return;
        const wv = webviewRef.current;
        if (!wv) return;

        const extraerSaldoMovilway = async () => {
            try {
                const saldoDetectado = await wv.executeJavaScript(`
                    (function() {
                        const textoCompleto = document.body ? document.body.innerText : '';
                        const match = textoCompleto.match(/Saldo\\s*(?:Bs\\.S|Bs\\.?|VES)?\\s*([0-9.,]+)/i);
                        return match ? match[1] : null;
                    })();
                `);
                if (saldoDetectado) {
                    const normalized = String(saldoDetectado).replace(/\s/g, '');
                    // Manejar formato 1.234,56 o 1234.56
                    let parsed = NaN;
                    if (normalized.includes(',') && normalized.includes('.')) {
                        if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
                            parsed = parseFloat(normalized.replace(/\./g, '').replace(',', '.'));
                        } else {
                            parsed = parseFloat(normalized.replace(/,/g, ''));
                        }
                    } else if (normalized.includes(',')) {
                        parsed = parseFloat(normalized.replace(',', '.'));
                    } else {
                        parsed = parseFloat(normalized);
                    }
                    if (!isNaN(parsed)) {
                        setSaldoBolsaNum(parsed);
                    }
                }
            } catch (_) {
                // Silencioso mientras termina de cargar la página
            }
        };

        const onDomReady = () => {
            extraerSaldoMovilway();
        };

        wv.addEventListener('dom-ready', onDomReady);
        wv.addEventListener('did-stop-loading', extraerSaldoMovilway);

        const timer = setInterval(extraerSaldoMovilway, 8000);

        return () => {
            try {
                wv.removeEventListener('dom-ready', onDomReady);
                wv.removeEventListener('did-stop-loading', extraerSaldoMovilway);
            } catch (_) {}
            clearInterval(timer);
        };
    }, [isElectronEnv, mostrarPortal, rightTab]);

    // Abrir o enfocar ventana acoplada de Movilway cuando corre en Edge/Chrome App Mode
    const abrirVentanaMovilwayAcoplada = useCallback(() => {
        try {
            const screenW = window.screen?.availWidth || 1366;
            const screenH = window.screen?.availHeight || 768;
            const winW = Math.max(580, Math.floor(screenW * 0.52));
            const winH = screenH - 40;
            const leftPos = Math.max(0, screenW - winW);

            if (popupWindowRef.current && !popupWindowRef.current.closed) {
                popupWindowRef.current.focus();
                return popupWindowRef.current;
            }

            const features = `width=${winW},height=${winH},left=${leftPos},top=10,menubar=no,toolbar=no,location=yes,status=yes,resizable=yes,scrollbars=yes`;
            const nw = window.open(movilwayUrl, 'MovilwayPosWebWindow', features);
            if (nw) {
                popupWindowRef.current = nw;
                nw.focus();
            }
            return nw;
        } catch (err) {
            window.open(movilwayUrl, '_blank');
            return null;
        }
    }, [movilwayUrl]);

    const handleCopyText = (text, label) => {
        if (!text) return;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(String(text));
        }
        toast.success(`${label} copiado: ${text}`, { duration: 1800 });
    };

    // Imprimir comprobante térmico ESC/POS (58mm / 80mm)
    const imprimirTicketRecarga = async (rechargeRecord) => {
        const activePrinter = localStorage.getItem('pos_station_printer') || businessSettings.printerName || '';
        const escPosTicket = formatRechargeToEscPos(rechargeRecord, {
            ...businessSettings,
            printerName: activePrinter
        });

        if (window.electronAPI?.printRaw) {
            try {
                const res = await window.electronAPI.printRaw(escPosTicket, activePrinter);
                if (res && res.success !== false) {
                    toast.success('🖨️ Comprobante de recarga impreso');
                    return true;
                }
            } catch (e) {
                console.warn('Error imprimiendo por Electron printRaw:', e);
            }
        }

        try {
            await api.post('/settings/print-raw', {
                content: escPosTicket,
                printerName: activePrinter,
                printMode: businessSettings?.printMode
            });
            toast.success('🖨️ Comprobante de recarga enviado a la impresora');
            return true;
        } catch (err) {
            console.warn('Aviso al imprimir comprobante de recarga:', err);
            toast.error('Recarga guardada, pero no se detectó impresora térmica activa');
            return false;
        }
    };

    // Compartir comprobante de recarga por WhatsApp
    const compartirRecargaWhatsApp = (rec) => {
        if (!rec) return;
        const companyName = (businessSettings.name || 'Isaac POS').toUpperCase();
        const rawPhone = String(rec.phoneNumber || '').replace(/\D/g, '');
        const formattedPhone = rawPhone.length === 11 ? `${rawPhone.slice(0, 4)}-${rawPhone.slice(4)}` : rawPhone;
        const dateStr = new Date(rec.createdAt || Date.now()).toLocaleString('es-VE');
        const nominal = Number(rec.nominalAmountBs || 0).toFixed(2);
        const fee = Number(rec.serviceFeeBs || 0).toFixed(2);
        const total = Number(rec.totalChargedBs || 0).toFixed(2);

        const lines = [
            `📲 *COMPROBANTE DE RECARGA*`,
            `🏢 *${companyName}*`,
            `--------------------------------`,
            `*Fecha:* ${dateStr}`,
            `*Operadora:* ${rec.operator}`,
            `*Teléfono:* ${formattedPhone}`,
            `*Ref. Operador:* #${rec.providerRef || 'MW-OK'}`,
            `--------------------------------`,
            `*Monto Recargado:* Bs. ${nominal}`,
            Number(fee) > 0 ? `*Servicio Caja:* Bs. ${fee}` : null,
            `*TOTAL PAGADO:* *Bs. ${total}*`,
            rec.customerPaymentRef ? `*Ref. Pago Cliente:* #${rec.customerPaymentRef}` : null,
            `--------------------------------`,
            `✅ _Verifique su saldo marcando el código de su operadora._`
        ].filter(Boolean).join('\n');

        let cleanDest = rawPhone;
        if (cleanDest.startsWith('0') && cleanDest.length === 11) {
            cleanDest = '58' + cleanDest.slice(1);
        }
        const url = `https://wa.me/${cleanDest}?text=${encodeURIComponent(lines)}`;
        window.open(url, '_blank');
    };

    // PASO 1: Validar, registrar cobro en POS como PENDIENTE e inyectar datos en Movilway
    const iniciarRecargaSegura = async (e) => {
        e.preventDefault();

        if (telefono.length !== 11) {
            setTipoMensaje('error');
            setMensajeSistema('El número telefónico debe tener exactamente 11 dígitos (Ej: 04141234567).');
            toast.error('El número telefónico debe tener 11 dígitos');
            return;
        }
        if (montoNum <= 0) {
            setTipoMensaje('error');
            setMensajeSistema('Ingresa o selecciona un monto nominal de recarga válido en Bolívares.');
            toast.error('Ingresa un monto de recarga válido');
            return;
        }
        if (selectedMethodConfig?.requiresRef && !refPagoCliente.trim()) {
            setTipoMensaje('error');
            setMensajeSistema(`El método ${selectedMethodConfig.label} exige ingresar el número de referencia del cliente.`);
            toast.error(`Ingresa el número de referencia de ${selectedMethodConfig.label}`);
            return;
        }

        const nuevoId = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        setTxActualId(nuevoId);
        setEstadoProceso('PROCESANDO');
        setTipoMensaje('info');
        setMensajeSistema('Registrando cobro en base de datos local y preparando Movilway...');

        try {
            // 1. Guardar en Base de Datos Local como PENDIENTE antes de ejecutar en Movilway
            await api.post('/recharges', {
                id: nuevoId,
                operator: operadora,
                phoneNumber: telefono,
                nominalAmountBs: montoNum,
                serviceFeePercent: feePct,
                serviceFeeBs: comisionBs,
                totalChargedBs: totalCobrarNum,
                exchangeRate: effRate,
                paymentMethod: metodoPago,
                customerPaymentRef: refPagoCliente.trim(),
                status: 'PENDIENTE',
                registerId: registerId || '1',
                registerName: registerDisplayName || `Caja ${registerId || '1'}`
            });

            // 2. Copiar teléfono al portapapeles siempre para pegado instantáneo
            if (navigator.clipboard) {
                navigator.clipboard.writeText(telefono).catch(() => {});
            }

            // 3. Si estamos en Electron con <webview>, inyectar directamente en el DOM de Movilway
            const wv = webviewRef.current;
            if (isElectronEnv && wv) {
                try {
                    const result = await wv.executeJavaScript(`
                        (function() {
                            const enlaces = Array.from(document.querySelectorAll('a, span, li, div, button'));
                            const menuRecargas = enlaces.find(el => el.innerText && el.innerText.trim().toLowerCase() === 'recargas');

                            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])'))
                                .filter(i => i.offsetParent !== null && !i.disabled && !i.readOnly);

                            if (inputs.length >= 2) {
                                inputs[0].focus();
                                inputs[0].value = '${telefono}';
                                inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                                inputs[0].dispatchEvent(new Event('change', { bubbles: true }));

                                inputs[1].focus();
                                inputs[1].value = '${montoNum}';
                                inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                                inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
                                return 'INYECTADO_OK';
                            } else if (menuRecargas) {
                                menuRecargas.click();
                                return 'NAVEGANDO_A_RECARGAS';
                            }
                            return 'FORMULARIO_NO_VISIBLE';
                        })();
                    `);

                    setEstadoProceso('ESPERANDO_CONFIRMACION');
                    setTipoMensaje('info');
                    if (result === 'INYECTADO_OK') {
                        setMensajeSistema('Datos inyectados automáticamente en Movilway. Procesa la recarga en el panel derecho y presiona "2. Confirmar Éxito e Imprimir Ticket".');
                    } else {
                        setMensajeSistema('Cobro pre-registrado. El teléfono ya está en tu portapapeles (Ctrl+V). Ejecuta la recarga en Movilway y confirma abajo.');
                    }
                } catch (_wvErr) {
                    setEstadoProceso('ESPERANDO_CONFIRMACION');
                    setTipoMensaje('info');
                    setMensajeSistema('Cobro pre-registrado. El teléfono ya está en tu portapapeles (Ctrl+V). Ejecuta la recarga en Movilway y confirma abajo.');
                }
            } else {
                // Modo Edge/Chrome App: Abrir/enfocar ventana acoplada de Movilway y dejar teléfono en portapapeles
                abrirVentanaMovilwayAcoplada();
                setEstadoProceso('ESPERANDO_CONFIRMACION');
                setTipoMensaje('info');
                setMensajeSistema(`Cobro pre-registrado y número ${telefono} copiado al portapapeles (Ctrl+V). Completa la recarga en la ventana de Movilway y presiona "2. Confirmar Éxito e Imprimir Ticket".`);
            }

            fetchRechargesAndStats();
        } catch (err) {
            setEstadoProceso('LISTO');
            setTipoMensaje('error');
            const errMsg = err.response?.data?.error || err.message || 'Error al registrar la recarga en base de datos';
            setMensajeSistema(`Error: ${errMsg}`);
            toast.error(errMsg);
        }
    };

    // PASO 2: Confirmar éxito, sumar a Caja, guardar referencia de Movilway e imprimir ticket térmico 58mm/80mm
    const finalizarEImprimir = async () => {
        if (!txActualId) return;

        let refDetectada = refMovilwayManual.trim() || ('MW-' + Date.now().toString().slice(-6));
        let nuevoSaldoDetectado = null;

        const wv = webviewRef.current;
        if (isElectronEnv && wv) {
            try {
                const extracted = await wv.executeJavaScript(`
                    (function() {
                        const txt = document.body ? document.body.innerText : '';
                        const matchRef = txt.match(/(?:Transacci[oó]n|Referencia|Aprobaci[oó]n|ID|Nro)[:\\s#]*([0-9A-Z]{5,15})/i);
                        const matchSaldo = txt.match(/Saldo\\s*(?:Bs\\.S|Bs\\.?|VES)?\\s*([0-9.,]+)/i);
                        return {
                            ref: matchRef ? matchRef[1] : null,
                            saldo: matchSaldo ? matchSaldo[1] : null
                        };
                    })();
                `);
                if (extracted?.ref && !refMovilwayManual.trim()) {
                    refDetectada = extracted.ref;
                }
                if (extracted?.saldo) {
                    const norm = String(extracted.saldo).replace(/\./g, '').replace(',', '.');
                    const p = parseFloat(norm);
                    if (!isNaN(p)) nuevoSaldoDetectado = p;
                }
            } catch (_) {}
        }

        // Si tenemos un saldo de bolsa previo y no se leyó del DOM, descontar automáticamente el monto nominal
        if (nuevoSaldoDetectado === null && saldoBolsaNum !== null && saldoBolsaNum > 0) {
            nuevoSaldoDetectado = Math.max(0, Number((saldoBolsaNum - montoNum).toFixed(2)));
        }

        try {
            const { data } = await api.put(`/recharges/${txActualId}/complete`, {
                providerRef: refDetectada,
                customerPaymentRef: refPagoCliente.trim(),
                remainingWalletBalanceBs: nuevoSaldoDetectado
            });

            if (nuevoSaldoDetectado !== null) {
                setSaldoBolsaNum(nuevoSaldoDetectado);
            }

            const completedRecord = data?.recharge || {
                id: txActualId,
                operator: operadora,
                phoneNumber: telefono,
                nominalAmountBs: montoNum,
                serviceFeePercent: feePct,
                serviceFeeBs: comisionBs,
                totalChargedBs: totalCobrarNum,
                paymentMethod: metodoPago,
                customerPaymentRef: refPagoCliente.trim(),
                providerRef: refDetectada,
                createdAt: new Date().toISOString()
            };

            await imprimirTicketRecarga(completedRecord);

            // Disparar sincronización de estado de caja global
            window.dispatchEvent(new CustomEvent('shift_status_changed'));

            // Limpiar formulario para el siguiente cliente
            setTelefono('');
            setMontoNominal('');
            setRefPagoCliente('');
            setRefMovilwayManual('');
            setTxActualId(null);
            setEstadoProceso('LISTO');
            setTipoMensaje('success');
            setMensajeSistema(`✅ Recarga completada con éxito (Ref Movilway: #${refDetectada}) y sumada al cuadre de caja.`);

            fetchRechargesAndStats();
        } catch (err) {
            const errMsg = err.response?.data?.error || err.message || 'Error al confirmar la recarga';
            toast.error(errMsg);
            setTipoMensaje('error');
            setMensajeSistema(`Error al confirmar: ${errMsg}`);
        }
    };

    // Anular recarga en curso o desde el historial
    const anularRecarga = async (idToCancel = txActualId) => {
        if (!idToCancel) {
            setEstadoProceso('LISTO');
            setMensajeSistema('Operación cancelada.');
            return;
        }
        try {
            await api.put(`/recharges/${idToCancel}/cancel`, {
                reason: 'Anulada por el cajero'
            });
            if (idToCancel === txActualId) {
                setTxActualId(null);
                setEstadoProceso('LISTO');
                setTipoMensaje('info');
                setMensajeSistema('Operación anulada. No se sumó ningún cobro a la caja.');
            } else {
                toast.success('Recarga anulada y reversada de caja');
            }
            window.dispatchEvent(new CustomEvent('shift_status_changed'));
            fetchRechargesAndStats();
        } catch (err) {
            toast.error('No se pudo anular el registro');
        }
    };

    const filteredRecharges = useMemo(() => {
        const q = searchTerm.toLowerCase().trim();
        if (!q) return recharges;
        return recharges.filter(r =>
            (r.phoneNumber || '').toLowerCase().includes(q) ||
            (r.customerPaymentRef || '').toLowerCase().includes(q) ||
            (r.providerRef || '').toLowerCase().includes(q) ||
            (r.operator || '').toLowerCase().includes(q)
        );
    }, [recharges, searchTerm]);

    const handleGuardarSaldoManual = async () => {
        const val = parseFloat(saldoInputManual);
        if (isNaN(val) || val < 0) {
            toast.error('Ingresa un saldo válido');
            return;
        }
        await syncWalletBalanceToBackend(val);
        setIsEditingSaldo(false);
        toast.success('Saldo de bolsa Movilway actualizado');
    };

    const handleGuardarUrl = () => {
        const clean = (movilwayUrl || '').trim() || DEFAULT_MOVILWAY_URL;
        try {
            const parsed = new URL(clean);
            const host = parsed.hostname.toLowerCase();
            if (parsed.protocol !== 'https:' || (!host.endsWith('.movilway.net') && host !== 'movilway.net' && !host.endsWith('.movilway.com') && host !== 'movilway.com')) {
                toast.error('Por seguridad, solo se permiten URLs HTTPS oficiales de Movilway (.movilway.net / .movilway.com)');
                return;
            }
        } catch (_) {
            toast.error('URL de portal Movilway inválida');
            return;
        }
        setMovilwayUrl(clean);
        localStorage.setItem('pos_movilway_url', clean);
        setIsEditingUrl(false);
        toast.success('URL de Movilway guardada');
    };

    return (
        <div className="space-y-4 pb-20 animate-in fade-in duration-300 px-1 sm:px-4 lg:px-6">
            {/* CABECERA EJECUTIVA Y KPIS DEL DÍA */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-pink-600/10 dark:bg-pink-500/15 border border-pink-500/25 flex items-center justify-center text-pink-600 dark:text-pink-400 shrink-0">
                            <Smartphone size={20} />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                                    Recargas Telefónicas Movilway
                                </h1>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20">
                                    PosWeb v2.18 • Puente Contable
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Recaudación directa integrada al arqueo de caja, cálculo automático del {porcentajeComision}% de servicio e impresión térmica
                            </p>
                        </div>
                    </div>

                    {/* Indicador de Bolsa Movilway + Botones de Control */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        {/* Bolsa Movilway */}
                        <div className="flex items-center gap-2 bg-pink-600 text-white px-3.5 py-2 rounded-xl shadow-xs">
                            <Wallet size={16} className="shrink-0" />
                            <div className="leading-tight">
                                <span className="block text-[9px] uppercase font-bold tracking-wider opacity-85">
                                    Saldo Bolsa Movilway
                                </span>
                                {isEditingSaldo ? (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={saldoInputManual}
                                            onChange={(e) => setSaldoInputManual(e.target.value)}
                                            placeholder="0.00"
                                            className="w-24 px-1.5 py-0.5 text-xs font-mono font-bold text-slate-900 bg-white rounded"
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            onClick={handleGuardarSaldoManual}
                                            className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-[10px] font-bold rounded cursor-pointer"
                                        >
                                            OK
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsEditingSaldo(false)}
                                            className="px-1.5 py-0.5 bg-white/20 hover:bg-white/30 text-[10px] font-bold rounded cursor-pointer"
                                        >
                                            X
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-mono font-black">
                                            {saldoBolsaNum !== null ? formatBs(saldoBolsaNum) : 'Sincronizar...'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSaldoInputManual(saldoBolsaNum !== null ? String(saldoBolsaNum) : '');
                                                setIsEditingSaldo(true);
                                            }}
                                            title="Ajustar saldo disponible en bolsa Movilway"
                                            className="text-[10px] underline opacity-85 hover:opacity-100 cursor-pointer"
                                        >
                                            Ajustar
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setIsEditingUrl(!isEditingUrl)}
                            className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                            title="Configurar URL del portal Movilway"
                        >
                            <Settings2 size={14} />
                            <span className="hidden sm:inline">URL Portal</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setMostrarPortal(!mostrarPortal)}
                            className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                        >
                            {mostrarPortal ? <EyeOff size={14} /> : <Eye size={14} />}
                            <span>{mostrarPortal ? 'Ocultar Panel Derecho' : 'Mostrar Panel Derecho'}</span>
                        </button>
                    </div>
                </div>

                {/* Barra de edición de URL si está abierta */}
                {isEditingUrl && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">URL Movilway PosWeb:</span>
                        <input
                            type="url"
                            value={movilwayUrl}
                            onChange={(e) => setMovilwayUrl(e.target.value)}
                            className="flex-1 min-w-[260px] h-8 px-3 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        />
                        <button
                            type="button"
                            onClick={handleGuardarUrl}
                            className="h-8 px-3 bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold rounded-lg cursor-pointer"
                        >
                            Guardar URL
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMovilwayUrl(DEFAULT_MOVILWAY_URL);
                                localStorage.setItem('pos_movilway_url', DEFAULT_MOVILWAY_URL);
                                setIsEditingUrl(false);
                            }}
                            className="h-8 px-2.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                        >
                            Restaurar por defecto
                        </button>
                    </div>
                )}

                {/* 4 Tarjetas KPI Rápidas */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Total Cobrado Hoy (Caja)
                        </span>
                        <div className="text-base sm:text-lg font-mono font-black text-slate-900 dark:text-white mt-0.5">
                            {formatBs(stats.totalChargedBs)}
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">
                            Ref: {formatUSD(stats.totalChargedBs / effRate)}
                        </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Saldo Nominal Recargado
                        </span>
                        <div className="text-base sm:text-lg font-mono font-black text-sky-600 dark:text-sky-400 mt-0.5">
                            {formatBs(stats.totalNominalBs)}
                        </div>
                        <span className="text-[10px] text-slate-500">
                            Descontado en Movilway
                        </span>
                    </div>

                    <div className="bg-emerald-50/70 dark:bg-emerald-950/25 rounded-xl p-3 border border-emerald-200/70 dark:border-emerald-800/50">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            Ganancia por Servicio Hoy
                        </span>
                        <div className="text-base sm:text-lg font-mono font-black text-emerald-700 dark:text-emerald-400 mt-0.5">
                            +{formatBs(stats.totalServiceFeeBs)}
                        </div>
                        <span className="text-[10px] font-mono text-emerald-600/80 dark:text-emerald-400/80">
                            Ref: +{formatUSD(stats.totalServiceFeeBs / effRate)}
                        </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200/70 dark:border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Operaciones del Día
                        </span>
                        <div className="text-base sm:text-lg font-mono font-black text-slate-900 dark:text-white mt-0.5">
                            {stats.completedCount} <span className="text-xs font-semibold text-slate-500">exitosas</span>
                        </div>
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                            {stats.pendingCount > 0 ? `${stats.pendingCount} en espera de confirmación` : '100% conciliadas'}
                        </span>
                    </div>
                </div>
            </div>

            {/* CUERPO PRINCIPAL: FORMULARIO IZQUIERDO + PANEL DERECHO (PORTAL / HISTORIAL) */}
            <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                {/* COLUMNA IZQUIERDA: CONTROL DE CAJA DE TU POS */}
                <div className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs shrink-0 ${
                    mostrarPortal ? 'w-full lg:w-[440px]' : 'w-full max-w-2xl mx-auto'
                }`}>
                    <form onSubmit={iniciarRecargaSegura} className="space-y-4">
                        {/* 1. Selector Visual de Operadora */}
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                                1. Operadora (Autodetección por prefijo)
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {Object.values(OPERADORAS).map((op) => {
                                    const isSelected = operadora === op.id;
                                    return (
                                        <button
                                            type="button"
                                            key={op.id}
                                            onClick={() => setOperadora(op.id)}
                                            className={`py-2 px-2.5 rounded-xl border-2 text-xs font-bold transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                                                isSelected
                                                    ? `${op.border} ${op.bgLight} ${op.text} shadow-2xs scale-[1.01]`
                                                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                                            }`}
                                        >
                                            <span>{op.nombre}</span>
                                            <span className="text-[9px] font-mono opacity-75">
                                                {op.prefijos.join(' / ')}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 2. Número de Teléfono */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    2. Número a Recargar (11 Dígitos)
                                </label>
                                <span className={`text-[11px] font-mono font-bold ${
                                    telefono.length === 11 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                                }`}>
                                    {telefono.length}/11 dígitos
                                </span>
                            </div>
                            <div className="relative">
                                <input
                                    type="tel"
                                    value={telefono}
                                    onChange={handleTelefonoChange}
                                    placeholder="Ej: 04141234567"
                                    required
                                    className="w-full h-11 px-3.5 pr-20 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-lg font-mono font-black tracking-wider text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                                {telefono && (
                                    <button
                                        type="button"
                                        onClick={() => handleCopyText(telefono, 'Teléfono')}
                                        className="absolute right-2 top-2 h-7 px-2.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-[11px] font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                        title="Copiar teléfono"
                                    >
                                        <Copy size={12} />
                                        <span>Copiar</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 3. Botones Rápidos de Monto por Operadora + Monto Nominal y % Servicio */}
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                <div className="flex items-center gap-1.5">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        3. Montos Disponibles
                                    </label>
                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${OPERADORAS[operadora]?.badgeBg}`}>
                                        {OPERADORAS[operadora]?.nombre}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {isElectronEnv && (
                                        <button
                                            type="button"
                                            onClick={sincronizarMontosDesdePortal}
                                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border border-pink-500/20 inline-flex items-center gap-1 cursor-pointer"
                                            title="Extraer montos de la lista desplegable abierta en Movilway"
                                        >
                                            <RefreshCw size={10} />
                                            <span>Leer Portal</span>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIsEditingMontos(!isEditingMontos)}
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1 cursor-pointer ${
                                            isEditingMontos
                                                ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                        }`}
                                        title="Personalizar los montos rápidos de esta operadora"
                                    >
                                        <Settings2 size={10} />
                                        <span>{isEditingMontos ? 'Listo' : 'Editar Escala'}</span>
                                    </button>
                                </div>
                            </div>

                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-2">
                                {OPERADORAS[operadora]?.regla}
                            </p>

                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mb-2.5">
                                {montosOperadoraActual.map((m) => {
                                    const active = Number(montoNominal) === m;
                                    const totalConServicio = Number((m * (1 + feePct / 100)).toFixed(2));
                                    const excedeBolsa = saldoBolsaNum !== null && saldoBolsaNum > 0 && m > saldoBolsaNum;
                                    return (
                                        <div key={m} className="relative group">
                                            <button
                                                type="button"
                                                onClick={() => setMontoNominal(String(m))}
                                                title={excedeBolsa ? `Supera el saldo actual en bolsa (Bs. ${saldoBolsaNum})` : `Nominal: Bs. ${m} | Cobrar con ${feePct}%: Bs. ${totalConServicio}`}
                                                className={`w-full px-2 py-1.5 rounded-xl text-left font-mono border transition-all cursor-pointer flex flex-col justify-between ${
                                                    active
                                                        ? `${OPERADORAS[operadora]?.border} ${OPERADORAS[operadora]?.bgLight} ${OPERADORAS[operadora]?.text} ring-2 ring-primary-500/30 shadow-2xs`
                                                        : excedeBolsa
                                                            ? 'bg-slate-50/60 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 border-dashed border-slate-200 dark:border-slate-800 hover:border-slate-300'
                                                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-100/80'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <span className="text-xs font-black">Bs. {m}</span>
                                                    {excedeBolsa && (
                                                        <span className="text-[8px] font-bold text-amber-500" title="Saldo en bolsa insuficiente">!</span>
                                                    )}
                                                </div>
                                                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 truncate">
                                                    Cobrar: Bs.{totalConServicio % 1 === 0 ? totalConServicio : totalConServicio.toFixed(1)}
                                                </span>
                                            </button>

                                            {isEditingMontos && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleEliminarMontoOperadora(m)}
                                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center shadow-xs hover:bg-rose-500 cursor-pointer"
                                                    title={`Quitar Bs. ${m} de ${OPERADORAS[operadora]?.nombre}`}
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Barra de edición rápida de montos por operadora */}
                            {isEditingMontos && (
                                <div className="mb-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-2">
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        value={nuevoMontoInput}
                                        onChange={(e) => setNuevoMontoInput(e.target.value)}
                                        placeholder={`Nuevo monto ${OPERADORAS[operadora]?.nombre} (Bs.)`}
                                        className="flex-1 min-w-[140px] h-8 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAgregarMontoOperadora}
                                        className="h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                    >
                                        <Plus size={12} />
                                        <span>Añadir</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRestaurarMontosOperadora}
                                        className="h-8 px-2.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                        title="Restaurar los montos predeterminados de esta operadora"
                                    >
                                        <RotateCcw size={11} />
                                        <span>Restaurar</span>
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-2.5">
                                <div className="col-span-2">
                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                                        Monto Recarga (Bs.)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="1"
                                            value={montoNominal}
                                            onChange={(e) => setMontoNominal(e.target.value)}
                                            placeholder="0.00"
                                            required
                                            className="w-full h-10 px-3 pr-16 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-base font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                                        />
                                        {montoNominal && (
                                            <button
                                                type="button"
                                                onClick={() => handleCopyText(montoNominal, 'Monto')}
                                                className="absolute right-1.5 top-1.5 h-7 px-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                                title="Copiar monto"
                                            >
                                                <Copy size={11} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
                                        % Servicio
                                    </label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        max="100"
                                        value={porcentajeComision}
                                        onChange={(e) => handlePorcentajeChange(e.target.value)}
                                        className="w-full h-10 px-2.5 rounded-xl border border-emerald-300 dark:border-emerald-700/70 bg-emerald-50/50 dark:bg-emerald-950/30 text-base font-mono font-black text-emerald-700 dark:text-emerald-300 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 4. Método de Cobro y Referencia */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                                    4. Método de Cobro
                                </label>
                                <select
                                    value={metodoPago}
                                    onChange={(e) => setMetodoPago(e.target.value)}
                                    className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                    {METODOS_COBRO.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                                    Ref. Pago Cliente {selectedMethodConfig?.requiresRef ? <span className="text-rose-500">*</span> : '(Opcional)'}
                                </label>
                                <input
                                    type="text"
                                    value={refPagoCliente}
                                    onChange={(e) => setRefPagoCliente(e.target.value)}
                                    placeholder={selectedMethodConfig?.requiresRef ? 'Nro. Referencia obligatorio' : 'Últimos dígitos / Nro.'}
                                    required={selectedMethodConfig?.requiresRef}
                                    className={`w-full h-10 px-3 rounded-xl border text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 ${
                                        selectedMethodConfig?.requiresRef
                                            ? 'border-sky-400 dark:border-sky-600 bg-sky-50/40 dark:bg-sky-950/30 focus:ring-sky-500'
                                            : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-primary-500'
                                    }`}
                                />
                            </div>
                        </div>

                        {/* 5. Resumen Financiero Total a Cobrar */}
                        <div className="bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
                                <span>Saldo nominal enviado a {OPERADORAS[operadora]?.nombre}:</span>
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                    {formatBs(montoNum)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-emerald-700 dark:text-emerald-400">
                                <span>Recargo / Servicio POS ({feePct}%):</span>
                                <span className="font-mono font-bold">
                                    +{formatBs(comisionBs)}
                                </span>
                            </div>
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-baseline">
                                <div>
                                    <span className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                        TOTAL A COBRAR:
                                    </span>
                                    <span className="block text-[10px] font-mono text-slate-500">
                                        Equivalente USD: {formatUSD(totalCobrarUsd)}
                                    </span>
                                </div>
                                <span className="text-xl font-mono font-black text-emerald-600 dark:text-emerald-400">
                                    Bs. {totalCobrarStr}
                                </span>
                            </div>
                        </div>

                        {/* Botones de Acción (Paso 1 y Paso 2) */}
                        {estadoProceso === 'LISTO' ? (
                            <button
                                type="submit"
                                className="w-full py-3.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 active:scale-[0.99] text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-md shadow-sky-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                            >
                                <Zap size={16} />
                                <span>1. Registrar Cobro y Cargar en Movilway</span>
                            </button>
                        ) : (
                            <div className="space-y-2.5 p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 mb-1">
                                        Nro. Transacción / Ref. Movilway (Opcional, se autogenera si se deja vacío)
                                    </label>
                                    <input
                                        type="text"
                                        value={refMovilwayManual}
                                        onChange={(e) => setRefMovilwayManual(e.target.value)}
                                        placeholder="Ej: 849201 (o automático)"
                                        className="w-full h-9 px-3 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={finalizarEImprimir}
                                        className="flex-2 py-3 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider shadow-md shadow-emerald-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <Printer size={15} />
                                        <span>2. Confirmar Éxito e Imprimir Ticket</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => anularRecarga(txActualId)}
                                        className="flex-1 py-3 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1"
                                    >
                                        <XCircle size={14} />
                                        <span>Anular</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </form>

                    {/* Notificación / Estado del Proceso */}
                    {mensajeSistema && (
                        <div className={`mt-3 p-3 rounded-xl border text-xs font-semibold flex items-start gap-2 ${
                            tipoMensaje === 'error'
                                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                : tipoMensaje === 'success'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
                        }`}>
                            {tipoMensaje === 'error' ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
                            <span>{mensajeSistema}</span>
                        </div>
                    )}
                </div>

                {/* COLUMNA DERECHA: PORTAL MOVILWAY Y AUDITORÍA / HISTORIAL DE RECARGAS */}
                {mostrarPortal && (
                    <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col min-h-[560px] overflow-hidden">
                        {/* Barra de Pestañas del Panel Derecho */}
                        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/50">
                            <div className="inline-flex rounded-lg p-0.5 bg-slate-200/70 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setRightTab('PORTAL')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                                        rightTab === 'PORTAL'
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                    }`}
                                >
                                    <LayoutPanelLeft size={13} />
                                    <span>Portal Movilway PosWeb</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRightTab('HISTORIAL')}
                                    className={`px-3 py-1.5 rounded-md text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                                        rightTab === 'HISTORIAL'
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                                    }`}
                                >
                                    <History size={13} />
                                    <span>Historial de Hoy ({recharges.length})</span>
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={abrirVentanaMovilwayAcoplada}
                                    className="px-2.5 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-[11px] font-bold inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                    title="Abre o enfoca el portal Movilway acoplado a la derecha con tu sesión guardada"
                                >
                                    <ExternalLink size={12} />
                                    <span>Ventana Acoplada Movilway</span>
                                </button>
                            </div>
                        </div>

                        {/* Contenido de la Pestaña Seleccionada */}
                        {rightTab === 'PORTAL' ? (
                            <div className="flex-1 flex flex-col relative">
                                {isElectronEnv ? (
                                    <webview
                                        ref={webviewRef}
                                        src={movilwayUrl}
                                        partition="persist:movilway"
                                        style={{ width: '100%', height: '100%', minHeight: '520px', border: 'none', flex: 1 }}
                                        allowpopups="true"
                                    />
                                ) : (
                                    <div className="flex-1 flex flex-col">
                                        {/* Barra de asistencia rápida para copiado en 1 clic */}
                                        <div className="px-4 py-2.5 bg-sky-50/80 dark:bg-sky-950/30 border-b border-sky-200/70 dark:border-sky-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                                            <span className="font-semibold text-sky-900 dark:text-sky-200">
                                                ⚡ Atajos rápidos para pegar en Movilway:
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyText(telefono, 'Teléfono')}
                                                    disabled={!telefono}
                                                    className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                                                >
                                                    <Copy size={11} />
                                                    <span>Copiar Tel: {telefono || '---'}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopyText(montoNominal, 'Monto')}
                                                    disabled={!montoNominal}
                                                    className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                                                >
                                                    <Copy size={11} />
                                                    <span>Copiar Monto: {montoNominal ? `Bs. ${montoNominal}` : '---'}</span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Intento de Iframe + Botón prominente de Ventana Acoplada si el navegador protege cookies de terceros */}
                                        <div className="flex-1 relative min-h-[470px] bg-slate-100 dark:bg-slate-950 flex flex-col">
                                            <iframe
                                                src={movilwayUrl}
                                                title="Movilway PosWeb"
                                                className="w-full flex-1 border-0 min-h-[420px]"
                                                sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals"
                                            />
                                            <div className="p-3 bg-slate-900/95 text-white flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-800">
                                                <div className="text-[11px] text-slate-300">
                                                    💡 <strong>¿Movilway pide certificado de equipo o bloquea el cuadro interno?</strong> Usa el botón <strong>Ventana Acoplada</strong> para operar con tu sesión autorizada de siempre.
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={abrirVentanaMovilwayAcoplada}
                                                    className="shrink-0 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <ExternalLink size={13} />
                                                    <span>Abrir Movilway Acoplado</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* PESTAÑA DE HISTORIAL DE RECARGAS DEL DÍA */
                            <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="relative flex-1 min-w-[220px]">
                                        <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                                        <input
                                            type="text"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            placeholder="Buscar por teléfono, referencia de pago o ref Movilway..."
                                            className="w-full h-9 pl-9 pr-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={fetchRechargesAndStats}
                                        className="h-9 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-bold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer"
                                    >
                                        <RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} />
                                        <span>Actualizar</span>
                                    </button>
                                </div>

                                <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[460px] border border-slate-200 dark:border-slate-800 rounded-xl">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                                <th className="py-2.5 px-3">Hora / Operadora</th>
                                                <th className="py-2.5 px-3">Teléfono</th>
                                                <th className="py-2.5 px-3">Método / Ref</th>
                                                <th className="py-2.5 px-3 text-right">Nominal / Serv.</th>
                                                <th className="py-2.5 px-3 text-right">Total Cobrado</th>
                                                <th className="py-2.5 px-3 text-center">Estado</th>
                                                <th className="py-2.5 px-3 text-right">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                                            {filteredRecharges.length === 0 ? (
                                                <tr>
                                                    <td colSpan={7} className="py-12 text-center text-slate-400 font-semibold">
                                                        No hay recargas registradas hoy con este filtro.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredRecharges.map((r) => {
                                                    const opInfo = OPERADORAS[r.operator] || OPERADORAS.MOVISTAR;
                                                    const timeStr = new Date(r.createdAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
                                                    return (
                                                        <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                                                            <td className="py-2.5 px-3">
                                                                <div className="font-bold text-slate-900 dark:text-white">{opInfo.nombre}</div>
                                                                <div className="text-[10px] text-slate-400 font-mono">{timeStr}</div>
                                                            </td>
                                                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-white">
                                                                {r.phoneNumber}
                                                                {r.providerRef && (
                                                                    <div className="text-[10px] text-pink-600 dark:text-pink-400">
                                                                        MW: #{r.providerRef}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="py-2.5 px-3">
                                                                <span className="font-semibold text-slate-700 dark:text-slate-300 uppercase text-[11px]">
                                                                    {r.paymentMethod}
                                                                </span>
                                                                {r.customerPaymentRef && (
                                                                    <div className="text-[10px] font-mono font-bold text-sky-600 dark:text-sky-400">
                                                                        Ref: #{r.customerPaymentRef}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right font-mono">
                                                                <div className="text-slate-700 dark:text-slate-300">{formatBs(r.nominalAmountBs)}</div>
                                                                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                                                                    +{formatBs(r.serviceFeeBs)} ({Number(r.serviceFeePercent || 0)}%)
                                                                </div>
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900 dark:text-white">
                                                                {formatBs(r.totalChargedBs)}
                                                            </td>
                                                            <td className="py-2.5 px-3 text-center">
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                                    r.status === 'COMPLETADA'
                                                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                                        : r.status === 'PENDIENTE'
                                                                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                                                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                                                }`}>
                                                                    {r.status}
                                                                </span>
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right">
                                                                <div className="inline-flex items-center gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => imprimirTicketRecarga(r)}
                                                                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 cursor-pointer"
                                                                        title="Imprimir Ticket Térmico"
                                                                    >
                                                                        <Printer size={13} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => compartirRecargaWhatsApp(r)}
                                                                        className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                                                                        title="Enviar comprobante por WhatsApp"
                                                                    >
                                                                        <Share2 size={13} />
                                                                    </button>
                                                                    {r.status !== 'ANULADA' && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => anularRecarga(r.id)}
                                                                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 cursor-pointer"
                                                                            title="Anular recarga y revertir de caja"
                                                                        >
                                                                            <XCircle size={13} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
