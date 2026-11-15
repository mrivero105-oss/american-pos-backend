import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Tv,
    Monitor,
    Smartphone,
    QrCode,
    ExternalLink,
    Copy,
    Check,
    X,
    Wifi,
    Maximize2,
    RefreshCw,
    Upload,
    Plus,
    Trash2,
    ChevronUp,
    ChevronDown,
    Search,
    Layers,
    Save,
    Eye,
    EyeOff,
    Image as ImageIcon,
    Columns2,
    Package
} from 'lucide-react';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import api from '../services/api';
import { useAuth } from '../hooks/AuthContext';
import { getImageUrl } from '../utils/imageUtils';
import { formatBs, formatUSD } from '../utils/format';

const DEFAULT_CONFIG = {
    layoutMode: 'split',
    intervalSeconds: 8,
    imageFit: 'contain',
    autoIncludePromotions: true,
    autoIncludeProducts: true,
    maxAutoProducts: 10,
    institutionalTagline: 'Precios calculados a tasa oficial vigente',
    slides: []
};

export default function CustomerDisplayModal({ isOpen, onClose }) {
    const auth = useAuth();
    const user = auth?.user || null;

    const canManageAds = (() => {
        if (!user) return false;
        const role = String(user.role || '').toLowerCase();
        return ['admin', 'superadmin', 'owner', 'dueño', 'master', 'supervisor'].includes(role)
            || user.permissions?.canManageSettings === true
            || user.permissions?.canManagePromotions === true;
    })();

    const [activeTab, setActiveTab] = useState(canManageAds ? 'ads' : 'pc');
    const [copied, setCopied] = useState(false);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [networkInfo, setNetworkInfo] = useState({
        primaryIp: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
        port: typeof window !== 'undefined' ? (window.location.port || '3005') : '3005'
    });
    const [displayPairing, setDisplayPairing] = useState({ companyId: user?.companyId || '2', registerId: '1', displayToken: '' });

    // Estado del Carrusel Publicitario
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [loadingConfig, setLoadingConfig] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [uploadingSlideId, setUploadingSlideId] = useState(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [exchangeRate, setExchangeRate] = useState(() => {
        const saved = parseFloat(localStorage.getItem('pos_exchange_rate'));
        return (!isNaN(saved) && saved > 0) ? saved : 1;
    });

    // Buscador de productos del catálogo para crear anuncios rápidos
    const [showProductPicker, setShowProductPicker] = useState(false);
    const [productQuery, setProductQuery] = useState('');
    const [productResults, setProductResults] = useState([]);
    const [searchingProducts, setSearchingProducts] = useState(false);

    const newFlyerInputRef = useRef(null);
    const replaceImageInputRef = useRef(null);
    const [replaceTargetSlideId, setReplaceTargetSlideId] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab(canManageAds ? 'ads' : 'pc');
    }, [isOpen, canManageAds]);

    // Cargar IP LAN + Configuración actual del carrusel
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;

        api.get('/settings/network-info')
            .then(res => {
                if (isMounted && res.data?.primaryIp) {
                    setNetworkInfo({
                        primaryIp: res.data.primaryIp,
                        port: res.data.port || (window.location.port || '3005')
                    });
                }
            })
            .catch(() => {});

        api.get('/settings/rate')
            .then(res => {
                if (isMounted && res.data?.rate > 0) {
                    setExchangeRate(Number(res.data.rate));
                }
            })
            .catch(() => {});

        api.get('/settings/customer-display/pairing')
            .then(res => {
                if (isMounted && res.data?.displayToken) {
                    setDisplayPairing({
                        companyId: res.data.companyId || user?.companyId || '2',
                        registerId: res.data.registerId || '1',
                        displayToken: res.data.displayToken
                    });
                }
            })
            .catch(() => {});

        if (canManageAds) {
            setLoadingConfig(true);
            api.get('/settings/customer-display')
                .then(res => {
                    if (isMounted && res.data?.config) {
                        setConfig({
                            ...DEFAULT_CONFIG,
                            ...res.data.config,
                            slides: Array.isArray(res.data.config.slides) ? res.data.config.slides : []
                        });
                        setHasUnsavedChanges(false);
                    }
                })
                .catch(() => {
                    try {
                        const local = localStorage.getItem('pos_customer_display_config');
                        if (local && isMounted) {
                            const parsed = JSON.parse(local);
                            setConfig({ ...DEFAULT_CONFIG, ...parsed });
                        }
                    } catch (_) {}
                })
                .finally(() => {
                    if (isMounted) setLoadingConfig(false);
                });
        }

        return () => { isMounted = false; };
    }, [isOpen, canManageAds]);

    // Búsqueda rápida de productos para destacar en el carrusel
    useEffect(() => {
        if (!isOpen || !showProductPicker) return;
        let isMounted = true;
        setSearchingProducts(true);

        const timer = setTimeout(() => {
            api.get('/products', {
                params: {
                    search: productQuery.trim(),
                    limit: 18,
                    page: 1
                }
            })
                .then(res => {
                    if (!isMounted) return;
                    const list = Array.isArray(res.data?.products)
                        ? res.data.products
                        : (Array.isArray(res.data) ? res.data : []);
                    setProductResults(list.slice(0, 18));
                })
                .catch(() => {
                    if (isMounted) setProductResults([]);
                })
                .finally(() => {
                    if (isMounted) setSearchingProducts(false);
                });
        }, 200);

        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [isOpen, showProductPicker, productQuery]);

    const lanIp = networkInfo.primaryIp === 'localhost' || networkInfo.primaryIp === '127.0.0.1'
        ? (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? window.location.hostname : networkInfo.primaryIp)
        : networkInfo.primaryIp;

    const pairingQuery = displayPairing.displayToken
        ? `?companyId=${encodeURIComponent(displayPairing.companyId || '2')}&registerId=${encodeURIComponent(displayPairing.registerId || '1')}&dt=${encodeURIComponent(displayPairing.displayToken)}`
        : '';

    const lanUrl = typeof window !== 'undefined'
        ? `${window.location.protocol}//${lanIp}:${networkInfo.port}/#/display${pairingQuery}`
        : `http://${lanIp}:3005/#/display${pairingQuery}`;

    useEffect(() => {
        if (!isOpen || !lanUrl) return;
        let isMounted = true;
        QRCode.toDataURL(lanUrl, {
            width: 240,
            margin: 1,
            color: { dark: '#0B0F17', light: '#FFFFFF' },
            errorCorrectionLevel: 'M'
        })
            .then(url => {
                if (isMounted) setQrCodeDataUrl(url);
            })
            .catch(() => {});

        return () => { isMounted = false; };
    }, [isOpen, lanUrl]);

    if (!isOpen) return null;

    const updateConfigField = (field, value) => {
        setConfig(prev => ({ ...prev, [field]: value }));
        setHasUnsavedChanges(true);
    };

    const updateSlideField = (slideId, field, value) => {
        setConfig(prev => ({
            ...prev,
            slides: prev.slides.map(s => (s.id === slideId ? { ...s, [field]: value } : s))
        }));
        setHasUnsavedChanges(true);
    };

    const moveSlide = (index, direction) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= config.slides.length) return;
        const copy = [...config.slides];
        const [moved] = copy.splice(index, 1);
        copy.splice(targetIndex, 0, moved);
        setConfig(prev => ({ ...prev, slides: copy }));
        setHasUnsavedChanges(true);
    };

    const removeSlide = (slide) => {
        setConfig(prev => ({
            ...prev,
            slides: prev.slides.filter(s => s.id !== slide.id)
        }));
        setHasUnsavedChanges(true);

        // Si era una imagen propia en /display_ads/, limpiarla opcionalmente en segundo plano al guardar o eliminar
        if (slide.imageUrl && slide.imageUrl.startsWith('/display_ads/')) {
            const filename = slide.imageUrl.replace('/display_ads/', '').trim();
            if (filename) {
                api.delete(`/settings/customer-display/upload/${encodeURIComponent(filename)}`).catch(() => {});
            }
        }
    };

    const broadcastConfigLive = (savedConfig) => {
        try {
            localStorage.setItem('pos_customer_display_config', JSON.stringify(savedConfig));
        } catch (_) {}
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('isaac_pos_display_sync');
                bc.postMessage({ type: 'DISPLAY_CONFIG_UPDATED', payload: savedConfig });
                bc.close();
            }
        } catch (_) {}
    };

    const persistConfig = async (nextConfig = config, silent = false) => {
        setSavingConfig(true);
        try {
            const res = await api.post('/settings/customer-display', { config: nextConfig });
            const saved = res.data?.config || nextConfig;
            setConfig(saved);
            setHasUnsavedChanges(false);
            broadcastConfigLive(saved);
            if (!silent) {
                toast.success('Carrusel publicitario actualizado en vivo');
            }
            return saved;
        } catch (err) {
            toast.error(err.response?.data?.error || 'No se pudo guardar la configuración del visor');
            return null;
        } finally {
            setSavingConfig(false);
        }
    };

    const handleUploadNewFlyer = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setUploadingSlideId('new');
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await api.post('/settings/customer-display/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data?.imageUrl) {
                const newSlide = {
                    id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    enabled: true,
                    imageUrl: res.data.imageUrl,
                    badge: '',
                    title: '',
                    subtitle: '',
                    priceUSD: '',
                    unitLabel: '',
                    imageFit: 'inherit',
                    productId: ''
                };
                const updatedConfig = {
                    ...config,
                    slides: [newSlide, ...config.slides]
                };
                setConfig(updatedConfig);
                await persistConfig(updatedConfig, true);
                toast.success('Pieza gráfica cargada y publicada en el carrusel');
            }
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al subir la imagen publicitaria');
        } finally {
            setUploadingSlideId(null);
        }
    };

    const handleReplaceSlideImage = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        const targetId = replaceTargetSlideId;
        setReplaceTargetSlideId(null);
        if (!file || !targetId) return;

        setUploadingSlideId(targetId);
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await api.post('/settings/customer-display/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (res.data?.imageUrl) {
                updateSlideField(targetId, 'imageUrl', res.data.imageUrl);
                toast.success('Imagen actualizada. Guarde los cambios para publicar.');
            }
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error al reemplazar imagen');
        } finally {
            setUploadingSlideId(null);
        }
    };

    const handleAddProductAsSlide = (prod) => {
        if (!prod) return;
        const presSummary = Array.isArray(prod.Presentations) && prod.Presentations.length > 0
            ? prod.Presentations.slice(0, 3).map(pr => pr.name).join(' · ')
            : '';

        const newSlide = {
            id: `slide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            enabled: true,
            imageUrl: prod.imageUrl || prod.imageUri || '',
            badge: (prod.category || 'DESTACADO').toUpperCase().slice(0, 36),
            title: prod.name || 'Producto Destacado',
            subtitle: presSummary ? `Presentaciones disponibles: ${presSummary}` : 'Disponible inmediatamente en caja',
            priceUSD: Number(prod.price) > 0 ? Number(prod.price) : '',
            unitLabel: (prod.isSoldByWeight || prod.unitType === 'kg') ? 'PRECIO POR KG' : 'PRECIO UNITARIO',
            imageFit: 'contain',
            productId: String(prod.id || '')
        };

        setConfig(prev => ({
            ...prev,
            slides: [newSlide, ...prev.slides]
        }));
        setHasUnsavedChanges(true);
        setShowProductPicker(false);
        setProductQuery('');
        toast.success(`"${prod.name}" añadido al carrusel`);
    };

    const handleOpenWindow = () => {
        const width = 1280;
        const height = 720;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        const displayTarget = `/#/display${pairingQuery}`;
        const popup = window.open(
            displayTarget,
            'IsaacCustomerDisplay',
            `width=${width},height=${height},top=${top},left=${left},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`
        );

        if (popup) {
            toast.success('Visor abierto. Arrástrelo al monitor secundario y pulse F11.');
        } else {
            window.open(displayTarget, '_blank');
            toast.success('Visor abierto en pestaña nueva.');
        }
    };

    const handleOpenTab = () => {
        window.open(`/#/display${pairingQuery}`, '_blank');
        toast.success('Visor abierto en nueva pestaña.');
    };

    const handleCopyLanUrl = () => {
        navigator.clipboard.writeText(lanUrl);
        setCopied(true);
        toast.success('Dirección de red copiada');
        setTimeout(() => setCopied(false), 2500);
    };

    return createPortal(
        <div className="fixed inset-0 z-[99999] bg-black/75 flex items-center justify-center p-3 sm:p-5">
            <div className="fixed inset-0" onClick={onClose} />

            <div className="relative w-full max-w-4xl bg-white dark:bg-[#0D1117] border border-slate-300 dark:border-[#242B35] rounded-lg shadow-2xl overflow-hidden z-10 flex flex-col max-h-[92vh]">
                {/* Cabecera Industrial */}
                <div className="px-5 py-3.5 bg-[#0A0D12] text-white flex items-center justify-between border-b border-[#1E2530] shrink-0 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-md bg-[#141A23] border border-[#263040] flex items-center justify-center text-slate-200 shrink-0">
                            <Tv size={18} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm sm:text-base font-bold tracking-tight text-white truncate">
                                    Visor de Cliente & Señalización Comercial
                                </h3>
                                <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    0ms Sync
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                Pantalla pública de cobro auditado, QR Pago Móvil y carrusel publicitario en espera
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={handleOpenWindow}
                            className="h-8 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            title="Abrir ventana del visor de clientes inmediatamente"
                        >
                            <ExternalLink size={13} />
                            <span>Abrir Visor</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 rounded-md bg-[#141A23] hover:bg-[#1E2633] border border-[#263040] text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            title="Cerrar consola"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Selector Ortogonal de Pestañas */}
                <div className="flex border-b border-slate-200 dark:border-[#1E2530] bg-slate-100 dark:bg-[#090C10] px-4 pt-2 gap-1 shrink-0">
                    {canManageAds && (
                        <button
                            type="button"
                            onClick={() => setActiveTab('ads')}
                            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                                activeTab === 'ads'
                                    ? 'border-blue-600 text-slate-900 dark:text-white bg-white dark:bg-[#0D1117] rounded-t-md'
                                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            <Layers size={14} />
                            <span>Carrusel Publicitario</span>
                            {config.slides.length > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-200 dark:bg-[#1A212C] text-[10px] font-mono">
                                    {config.slides.filter(s => s.enabled !== false).length}
                                </span>
                            )}
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setActiveTab('pc')}
                        className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                            activeTab === 'pc'
                                ? 'border-blue-600 text-slate-900 dark:text-white bg-white dark:bg-[#0D1117] rounded-t-md'
                                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        <Monitor size={14} />
                        <span>Segunda Pantalla (HDMI / PC)</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('tablet')}
                        className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
                            activeTab === 'tablet'
                                ? 'border-blue-600 text-slate-900 dark:text-white bg-white dark:bg-[#0D1117] rounded-t-md'
                                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        <Smartphone size={14} />
                        <span>Tablet / Smart TV (Wi-Fi)</span>
                    </button>
                </div>

                {/* Inputs de archivo ocultos */}
                <input
                    ref={newFlyerInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleUploadNewFlyer}
                />
                <input
                    ref={replaceImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleReplaceSlideImage}
                />

                {/* Cuerpo Principal */}
                <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
                    {activeTab === 'ads' && canManageAds ? (
                        loadingConfig ? (
                            <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-2">
                                <RefreshCw size={22} className="animate-spin" />
                                <span className="text-xs font-mono uppercase tracking-wider">Cargando configuración del visor...</span>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                {/* 1. Configuración de Arquitectura en Espera */}
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-md bg-slate-50 dark:bg-[#121720] border border-slate-200 dark:border-[#222A36]">
                                    <div className="md:col-span-5">
                                        <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                            Disposición en Modo Espera
                                        </label>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => updateConfigField('layoutMode', 'split')}
                                                className={`px-2.5 py-2 rounded border text-left transition-colors cursor-pointer ${
                                                    config.layoutMode === 'split'
                                                        ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-500'
                                                        : 'bg-white dark:bg-[#0D1117] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#263040]'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5 text-xs font-bold">
                                                    <Columns2 size={13} />
                                                    <span>Vitrina + Caja</span>
                                                </div>
                                                <span className={`block text-[10px] mt-0.5 ${config.layoutMode === 'split' ? 'text-slate-200' : 'text-slate-500'}`}>
                                                    Publicidad + Tasa BCV
                                                </span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => updateConfigField('layoutMode', 'fullscreen')}
                                                className={`px-2.5 py-2 rounded border text-left transition-colors cursor-pointer ${
                                                    config.layoutMode === 'fullscreen'
                                                        ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-500'
                                                        : 'bg-white dark:bg-[#0D1117] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#263040]'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5 text-xs font-bold">
                                                    <Maximize2 size={13} />
                                                    <span>Lienzo 100%</span>
                                                </div>
                                                <span className={`block text-[10px] mt-0.5 ${config.layoutMode === 'fullscreen' ? 'text-slate-200' : 'text-slate-500'}`}>
                                                    Pantalla completa
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="md:col-span-3">
                                        <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                            Duración por Slide
                                        </label>
                                        <select
                                            value={config.intervalSeconds}
                                            onChange={(e) => updateConfigField('intervalSeconds', Number(e.target.value))}
                                            className="w-full h-[52px] px-3 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                                        >
                                            <option value={5}>5 segundos (Dinámico)</option>
                                            <option value={8}>8 segundos (Estándar)</option>
                                            <option value={12}>12 segundos (Editorial)</option>
                                            <option value={15}>15 segundos (Pausado)</option>
                                            <option value={20}>20 segundos (Exposición)</option>
                                        </select>
                                    </div>

                                    <div className="md:col-span-4">
                                        <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                                            Encuadre de Flyers Subidos
                                        </label>
                                        <select
                                            value={config.imageFit}
                                            onChange={(e) => updateConfigField('imageFit', e.target.value)}
                                            className="w-full h-[52px] px-3 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                                        >
                                            <option value="cover">Cubrir lienzo completo (16:9)</option>
                                            <option value="contain">Mostrar flyer íntegro sin recortes</option>
                                        </select>
                                    </div>

                                    <div className="md:col-span-12 pt-2 border-t border-slate-200 dark:border-[#222A36] grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                                        <div className="sm:col-span-7 flex flex-col sm:flex-row sm:items-center gap-3">
                                            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={config.autoIncludePromotions !== false}
                                                    onChange={(e) => updateConfigField('autoIncludePromotions', e.target.checked)}
                                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span>Incluir Ofertas Activas</span>
                                            </label>

                                            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={config.autoIncludeProducts !== false}
                                                    onChange={(e) => updateConfigField('autoIncludeProducts', e.target.checked)}
                                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span>Rotar Productos con Foto del Catálogo</span>
                                            </label>

                                            {config.autoIncludeProducts !== false && (
                                                <select
                                                    value={config.maxAutoProducts || 10}
                                                    onChange={(e) => updateConfigField('maxAutoProducts', Number(e.target.value))}
                                                    className="h-7 px-2 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-[11px] font-mono text-slate-800 dark:text-slate-200"
                                                    title="Cantidad máxima de productos automáticos en rotación"
                                                >
                                                    <option value={6}>Máx. 6 ítems</option>
                                                    <option value={10}>Máx. 10 ítems</option>
                                                    <option value={16}>Máx. 16 ítems</option>
                                                </select>
                                            )}
                                        </div>

                                        <div className="sm:col-span-5">
                                            <input
                                                type="text"
                                                value={config.institutionalTagline || ''}
                                                onChange={(e) => updateConfigField('institutionalTagline', e.target.value)}
                                                placeholder="Nota institucional (ej. Precios a tasa oficial vigente)"
                                                className="w-full h-8 px-2.5 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 2. Cabecera y Acciones de Piezas Publicitarias */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                    <div>
                                        <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                            Anuncios & Flyers Personalizados ({config.slides.length})
                                        </h4>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                            Suba artes promocionales 16:9 listos o destaque productos específicos con precio dinámico en Bs y USD.
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setShowProductPicker(prev => !prev)}
                                            className="h-8 px-3 rounded border border-slate-300 dark:border-[#2A3444] bg-white dark:bg-[#141A23] hover:bg-slate-50 dark:hover:bg-[#1A222E] text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                                        >
                                            <Package size={13} />
                                            <span>Destacar Producto</span>
                                        </button>

                                        <button
                                            type="button"
                                            disabled={uploadingSlideId === 'new'}
                                            onClick={() => newFlyerInputRef.current?.click()}
                                            className="h-8 px-3 rounded bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            {uploadingSlideId === 'new' ? (
                                                <RefreshCw size={13} className="animate-spin" />
                                            ) : (
                                                <Upload size={13} />
                                            )}
                                            <span>Subir Flyer / Imagen</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Selector Rápido de Producto del Catálogo */}
                                {showProductPicker && (
                                    <div className="p-3.5 rounded-md border border-blue-500/40 bg-blue-50/40 dark:bg-[#101722] space-y-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="relative flex-1">
                                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    value={productQuery}
                                                    onChange={(e) => setProductQuery(e.target.value)}
                                                    placeholder="Buscar producto del inventario por nombre o código..."
                                                    className="w-full h-8 pl-8 pr-3 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowProductPicker(false)}
                                                className="h-8 px-2.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                                            >
                                                Cerrar
                                            </button>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 dark:divide-[#1E2530] border border-slate-200 dark:border-[#1E2530] rounded bg-white dark:bg-[#0D1117]">
                                            {searchingProducts ? (
                                                <div className="py-6 text-center text-xs text-slate-500">Buscando productos...</div>
                                            ) : productResults.length === 0 ? (
                                                <div className="py-6 text-center text-xs text-slate-500">No se encontraron productos coincidentes.</div>
                                            ) : (
                                                productResults.map(prod => {
                                                    const img = getImageUrl(prod.imageUrl || prod.imageUri);
                                                    return (
                                                        <button
                                                            key={prod.id}
                                                            type="button"
                                                            onClick={() => handleAddProductAsSlide(prod)}
                                                            className="w-full px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#141A24] text-left transition-colors cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="w-8 h-8 rounded border border-slate-200 dark:border-[#263040] bg-slate-100 dark:bg-[#161C26] flex items-center justify-center overflow-hidden shrink-0">
                                                                    {img ? (
                                                                        <img src={img} alt={prod.name} className="w-full h-full object-contain" />
                                                                    ) : (
                                                                        <Package size={14} className="text-slate-400" />
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                                                        {prod.name}
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-500 uppercase font-mono">
                                                                        {prod.category || 'General'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 font-mono">
                                                                <div className="text-xs font-bold text-slate-900 dark:text-white">
                                                                    {formatBs((Number(prod.price) || 0) * exchangeRate)}
                                                                </div>
                                                                <div className="text-[10px] text-slate-500">
                                                                    {formatUSD(Number(prod.price) || 0)}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Lista de Slides Personalizados */}
                                {config.slides.length === 0 ? (
                                    <div className="p-6 rounded-md border border-dashed border-slate-300 dark:border-[#283242] bg-slate-50/60 dark:bg-[#0F141C] text-center space-y-2">
                                        <div className="w-10 h-10 mx-auto rounded-md bg-slate-200/70 dark:bg-[#18202C] flex items-center justify-center text-slate-500">
                                            <ImageIcon size={18} />
                                        </div>
                                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                            Sin flyers personalizados cargados todavía
                                        </div>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
                                            {config.autoIncludeProducts !== false || config.autoIncludePromotions !== false
                                                ? 'El visor rotará automáticamente sus ofertas activas y productos con fotografía del catálogo. Suba un flyer cuando desee intercalar campañas gráficas propias.'
                                                : 'Active la rotación automática del catálogo arriba o suba su primer flyer publicitario.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {config.slides.map((slide, idx) => {
                                            const resolvedImg = getImageUrl(slide.imageUrl);
                                            const numericUsd = slide.priceUSD !== '' && slide.priceUSD !== null && !isNaN(Number(slide.priceUSD))
                                                ? Number(slide.priceUSD)
                                                : null;

                                            return (
                                                <div
                                                    key={slide.id}
                                                    className={`p-3.5 rounded-md border transition-colors ${
                                                        slide.enabled !== false
                                                            ? 'bg-white dark:bg-[#11161F] border-slate-300 dark:border-[#252E3D]'
                                                            : 'bg-slate-50 dark:bg-[#0B0E14] border-slate-200 dark:border-[#1B222D] opacity-65'
                                                    }`}
                                                >
                                                    <div className="flex flex-col sm:flex-row gap-3.5">
                                                        {/* Miniatura de Pieza Gráfica */}
                                                        <div className="w-full sm:w-40 shrink-0 flex flex-col gap-1.5">
                                                            <div className="relative h-24 w-full rounded border border-slate-200 dark:border-[#263040] bg-white overflow-hidden flex items-center justify-center">
                                                                {resolvedImg ? (
                                                                    <img
                                                                        src={resolvedImg}
                                                                        alt={slide.title || `Anuncio ${idx + 1}`}
                                                                        className="w-full h-full object-contain p-1"
                                                                    />
                                                                ) : (
                                                                    <ImageIcon size={22} className="text-slate-400" />
                                                                )}
                                                                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-white font-mono text-[10px] font-bold">
                                                                    {String(idx + 1).padStart(2, '0')}
                                                                </span>
                                                            </div>

                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setReplaceTargetSlideId(slide.id);
                                                                    replaceImageInputRef.current?.click();
                                                                }}
                                                                className="h-7 px-2 rounded border border-slate-300 dark:border-[#263040] bg-slate-50 dark:bg-[#161D28] hover:bg-slate-100 text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1 cursor-pointer"
                                                            >
                                                                {uploadingSlideId === slide.id ? (
                                                                    <RefreshCw size={11} className="animate-spin" />
                                                                ) : (
                                                                    <Upload size={11} />
                                                                )}
                                                                <span>Cambiar imagen</span>
                                                            </button>
                                                        </div>

                                                        {/* Formulario Compacto de Campos Editoriales */}
                                                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                                                            <div className="sm:col-span-4">
                                                                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                                                                    Etiqueta Superior
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={slide.badge || ''}
                                                                    onChange={(e) => updateSlideField(slide.id, 'badge', e.target.value)}
                                                                    placeholder="Ej. PROMOCIÓN / NUEVO"
                                                                    className="w-full h-8 px-2.5 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs text-slate-900 dark:text-white"
                                                                />
                                                            </div>

                                                            <div className="sm:col-span-5">
                                                                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                                                                    Titular (vacío = flyer gráfico puro)
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={slide.title || ''}
                                                                    onChange={(e) => updateSlideField(slide.id, 'title', e.target.value)}
                                                                    placeholder="Ej. Combo Familiar Fin de Semana"
                                                                    className="w-full h-8 px-2.5 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs font-semibold text-slate-900 dark:text-white"
                                                                />
                                                            </div>

                                                            <div className="sm:col-span-3">
                                                                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                                                                    Precio USD (Opcional)
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    value={slide.priceUSD ?? ''}
                                                                    onChange={(e) => updateSlideField(slide.id, 'priceUSD', e.target.value)}
                                                                    placeholder="0.00"
                                                                    className="w-full h-8 px-2.5 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs font-mono font-bold text-slate-900 dark:text-white"
                                                                />
                                                            </div>

                                                            <div className="sm:col-span-8">
                                                                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                                                                    Descripción / Detalle Comercial
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={slide.subtitle || ''}
                                                                    onChange={(e) => updateSlideField(slide.id, 'subtitle', e.target.value)}
                                                                    placeholder="Detalle breve opcional o condiciones de la promoción"
                                                                    className="w-full h-8 px-2.5 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs text-slate-700 dark:text-slate-300"
                                                                />
                                                            </div>

                                                            <div className="sm:col-span-4">
                                                                <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                                                                    Encuadre Individual
                                                                </label>
                                                                <select
                                                                    value={slide.imageFit || 'inherit'}
                                                                    onChange={(e) => updateSlideField(slide.id, 'imageFit', e.target.value)}
                                                                    className="w-full h-8 px-2 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#0D1117] text-xs text-slate-800 dark:text-slate-200"
                                                                >
                                                                    <option value="inherit">Usar general</option>
                                                                    <option value="cover">Cubrir (Cover)</option>
                                                                    <option value="contain">Sin recorte (Contain)</option>
                                                                </select>
                                                            </div>

                                                            {/* Barra de estado y acciones de la fila */}
                                                            <div className="sm:col-span-12 pt-1.5 flex items-center justify-between border-t border-slate-100 dark:border-[#1D2430]">
                                                                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                                                    {numericUsd !== null && numericUsd > 0 ? (
                                                                        <span>
                                                                            En pantalla: <strong className="text-slate-900 dark:text-white">{formatBs(numericUsd * exchangeRate)}</strong> ({formatUSD(numericUsd)})
                                                                        </span>
                                                                    ) : (
                                                                        <span>Modo cartel gráfico (sin bloque de precio)</span>
                                                                    )}
                                                                </div>

                                                                <div className="flex items-center gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => updateSlideField(slide.id, 'enabled', slide.enabled === false)}
                                                                        className={`h-7 px-2 rounded border text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                                                                            slide.enabled !== false
                                                                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                                                                : 'border-slate-300 dark:border-[#263040] text-slate-500'
                                                                        }`}
                                                                        title={slide.enabled !== false ? 'Pausar anuncio' : 'Activar anuncio'}
                                                                    >
                                                                        {slide.enabled !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                                                                        <span>{slide.enabled !== false ? 'Visible' : 'Pausado'}</span>
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        disabled={idx === 0}
                                                                        onClick={() => moveSlide(idx, -1)}
                                                                        className="w-7 h-7 rounded border border-slate-200 dark:border-[#263040] flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-30 cursor-pointer"
                                                                        title="Subir orden"
                                                                    >
                                                                        <ChevronUp size={14} />
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        disabled={idx === config.slides.length - 1}
                                                                        onClick={() => moveSlide(idx, 1)}
                                                                        className="w-7 h-7 rounded border border-slate-200 dark:border-[#263040] flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-30 cursor-pointer"
                                                                        title="Bajar orden"
                                                                    >
                                                                        <ChevronDown size={14} />
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeSlide(slide)}
                                                                        className="w-7 h-7 rounded border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400 cursor-pointer"
                                                                        title="Eliminar anuncio"
                                                                    >
                                                                        <Trash2 size={13} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    ) : activeTab === 'pc' ? (
                        <div className="space-y-4">
                            <div className="p-5 rounded-md bg-slate-50 dark:bg-[#121720] border border-slate-200 dark:border-[#222A36]">
                                <div className="flex items-start gap-3.5 mb-4">
                                    <div className="w-10 h-10 rounded-md bg-slate-900 dark:bg-[#1A222E] text-white flex items-center justify-center shrink-0 border border-[#2A3547]">
                                        <Monitor size={19} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                                            Monitor Secundario Extendido (HDMI / DisplayPort / VGA)
                                        </h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                                            Diseñado para estaciones de cobro con doble pantalla: consola operativa para el cajero y visor comercial para el cliente.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                                    <button
                                        type="button"
                                        onClick={handleOpenWindow}
                                        className="h-10 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-md font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <ExternalLink size={14} />
                                        <span>Abrir Ventana Dedicada del Visor</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleOpenTab}
                                        className="h-10 px-4 bg-white dark:bg-[#0D1117] hover:bg-slate-100 dark:hover:bg-[#18202B] text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-[#263040] rounded-md font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <Maximize2 size={14} />
                                        <span>Abrir en Pestaña del Navegador</span>
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 rounded-md bg-slate-50 dark:bg-[#10151D] border border-slate-200 dark:border-[#1F2734]">
                                <h5 className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                                    Protocolo de Montaje en Segunda Pantalla
                                </h5>
                                <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-decimal list-inside">
                                    <li>Pulse <strong>Abrir Ventana Dedicada del Visor</strong>.</li>
                                    <li>Arrastre la ventana emergente hacia el monitor orientado al cliente.</li>
                                    <li>Presione <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#1E2633] text-slate-900 dark:text-white font-mono text-[11px]">F11</kbd> o el botón de pantalla completa en la esquina superior derecha del visor.</li>
                                </ol>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="p-5 rounded-md bg-slate-50 dark:bg-[#121720] border border-slate-200 dark:border-[#222A36]">
                                <div className="flex flex-col sm:flex-row items-center gap-5">
                                    <div className="p-3 bg-white rounded-md border border-slate-300 flex flex-col items-center shrink-0">
                                        {qrCodeDataUrl ? (
                                            <img
                                                src={qrCodeDataUrl}
                                                alt="QR Visor Red Local"
                                                className="w-40 h-40 object-contain"
                                            />
                                        ) : (
                                            <div className="w-40 h-40 flex items-center justify-center">
                                                <RefreshCw className="animate-spin text-slate-400" size={24} />
                                            </div>
                                        )}
                                        <span className="text-[10px] font-mono font-bold text-slate-600 uppercase tracking-wider mt-2 flex items-center gap-1">
                                            <QrCode size={11} />
                                            Acceso Directo LAN
                                        </span>
                                    </div>

                                    <div className="flex-1 space-y-3 text-center sm:text-left">
                                        <div>
                                            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded mb-1.5">
                                                <Wifi size={11} />
                                                Sincronización en Red Local (Sin Login)
                                            </span>
                                            <h4 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                                                Conectar Tablet de Mostrador o Smart TV Publicitario
                                            </h4>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                                Escanee el código QR o ingrese la dirección inferior en el navegador de cualquier Tablet o Smart TV conectada al mismo Wi-Fi del comercio.
                                            </p>
                                        </div>

                                        <div className="p-2.5 bg-white dark:bg-[#0D1117] rounded border border-slate-300 dark:border-[#263040] flex items-center justify-between gap-2">
                                            <code className="text-xs text-slate-800 dark:text-slate-200 font-mono truncate select-all">
                                                {lanUrl}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={handleCopyLanUrl}
                                                className="h-7 px-2.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#18202C] dark:hover:bg-[#222C3C] text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                                            >
                                                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                                                <span>{copied ? 'Copiado' : 'Copiar'}</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Pie de Consola con Guardado en Vivo */}
                <div className="px-5 py-3 bg-slate-100 dark:bg-[#090C10] border-t border-slate-200 dark:border-[#1E2530] flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>
                            {hasUnsavedChanges
                                ? 'Cambios pendientes por publicar en el carrusel'
                                : 'Transmisión activa hacia pantallas conectadas'}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-9 px-3.5 rounded border border-slate-300 dark:border-[#263040] bg-white dark:bg-[#141A23] hover:bg-slate-50 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                        >
                            Cerrar
                        </button>

                        {activeTab === 'ads' && canManageAds && (
                            <button
                                type="button"
                                disabled={savingConfig}
                                onClick={() => persistConfig(config, false)}
                                className="h-9 px-4 rounded bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                {savingConfig ? (
                                    <RefreshCw size={14} className="animate-spin" />
                                ) : (
                                    <Save size={14} />
                                )}
                                <span>Guardar y Publicar en Vivo</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
