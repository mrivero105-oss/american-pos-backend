import { useState, useEffect } from 'react';
import { X, Printer, Plus, Minus, Layers, Eye, Zap } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import api from '../services/api';
import { formatMoney } from '../utils/format';
import { formatBatchProductLabelsToEscPos } from '../utils/escposFormatter';
import BaseModal from './BaseModal';

export default function LabelModal({ isOpen, onClose, products = [], exchangeRate = 1, zIndex = "z-[100200]" }) {
    const [localProducts, setLocalProducts] = useState(() => (products || []).map(p => ({ ...p, labelCopies: p.labelCopies || 1 })));
    const [isPrinting, setIsPrinting] = useState(false);
    const [config, setConfig] = useState(() => {
        const savedReceiptWidth = typeof localStorage !== 'undefined' ? localStorage.getItem('pos_receipt_width') : '';
        return {
            showPrice: true,
            showPriceBs: true,
            showName: true,
            showBarcode: true,
            labelSize: savedReceiptWidth === '58mm' ? 'roll58' : 'roll80',
            scale: 1,
        };
    });

    useEffect(() => {
        if (isOpen && products && products.length > 0) {
            setLocalProducts(products.map(p => ({ ...p, labelCopies: p.labelCopies || 1 })));
        }
    }, [isOpen, products]);

    useEffect(() => {
        if (isOpen && localProducts.length > 0) {
            // Render barcodes after DOM paints
            setTimeout(() => {
                const svgs = document.querySelectorAll('.barcode-svg');
                svgs.forEach(svg => {
                    const barcode = svg.getAttribute('data-barcode');
                    if (barcode) {
                        try {
                            JsBarcode(svg, barcode, {
                                format: "CODE128",
                                width: config.labelSize === 'small' ? 1.3 : 1.8,
                                height: config.labelSize === 'small' ? 32 : 45,
                                displayValue: true,
                                fontSize: 10,
                                margin: 0,
                                textMargin: 2
                            });
                        } catch (e) {
                            console.warn('Barcode generation warning:', e);
                        }
                    }
                });
            }, 100);
        }
    }, [isOpen, localProducts, config.labelSize, config.showBarcode]);

    const activeProducts = localProducts.length > 0 ? localProducts : (products || []).map(p => ({ ...p, labelCopies: p.labelCopies || 1 }));

    if (!isOpen || activeProducts.length === 0) return null;

    const setCopies = (id, val) => {
        setLocalProducts(prev => {
            const list = prev.length > 0 ? prev : activeProducts;
            return list.map(p => p.id === id ? { ...p, labelCopies: Math.max(1, val) } : p);
        });
    };

    const totalLabels = activeProducts.reduce((acc, p) => acc + (p.labelCopies || 1), 0);

    const isThermalRoll = config.labelSize === 'roll58' || config.labelSize === 'roll80';
    const is58mm = config.labelSize === 'roll58' || (config.labelSize !== 'roll80' && typeof localStorage !== 'undefined' && localStorage.getItem('pos_receipt_width') === '58mm');

    const handleDirectThermalPrint = async () => {
        setIsPrinting(true);
        const activePrinter = (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_station_printer') : '') || '';
        try {
            const escPosContent = formatBatchProductLabelsToEscPos(activeProducts, config, exchangeRate, is58mm);

            // 1. Entorno Desktop con Electron
            if (window.electronAPI) {
                const res = await window.electronAPI.printRaw(escPosContent, activePrinter);
                if (res && res.success !== false) {
                    toast.success(`Rótulos enviados a la tickera (${is58mm ? 'POS-58' : 'POS-80'})`);
                    onClose();
                    return;
                }
            }

            // 2. Entorno Web en PC con Backend Local
            await api.post('/settings/print-raw', {
                content: escPosContent,
                printerName: activePrinter
            });

            toast.success(`Rótulos enviados a la tickera (${is58mm ? 'POS-58' : 'POS-80'})`);
            onClose();
        } catch (err) {
            console.error('Error al imprimir etiquetas térmicas:', err);
            toast.error(err.response?.data?.error || 'No se pudo conectar con la impresora térmica. Verifica que esté encendida o usa la opción "Diálogo / PDF".');
        } finally {
            setIsPrinting(false);
        }
    };

    const handleBrowserPrint = () => {
        // Asegurar que los códigos de barras en #print-area estén pintados
        const svgs = document.querySelectorAll('#print-area .barcode-svg');
        svgs.forEach(svg => {
            const barcode = svg.getAttribute('data-barcode');
            if (barcode && !svg.hasChildNodes()) {
                try {
                    JsBarcode(svg, barcode, {
                        format: "CODE128",
                        width: (config.labelSize === 'roll58' || config.labelSize === 'small') ? 1.2 : 1.8,
                        height: (config.labelSize === 'roll58' || config.labelSize === 'small') ? 32 : 45,
                        displayValue: true,
                        fontSize: 10,
                        margin: 0,
                        textMargin: 2
                    });
                } catch (e) {
                    console.warn('Advertencia al generar código de barras SVG:', e);
                }
            }
        });

        const printEl = document.getElementById('print-area');
        if (!printEl) return;
        const printContent = printEl.innerHTML;

        const style = `
            <style>
                @page {
                    size: ${
                        config.labelSize === 'roll80' ? '80mm auto' :
                        config.labelSize === 'roll58' ? '58mm auto' :
                        config.labelSize === 'small40x25' ? '40mm 25mm' :
                        config.labelSize === 'small' ? '40mm 30mm' :
                        config.labelSize === 'medium' ? '50mm 25mm' :
                        config.labelSize === 'gondola50x30' ? '50mm 30mm' :
                        config.labelSize === 'gondola' ? '80mm 40mm' : '100mm 50mm'
                    };
                    margin: 0;
                }
                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                body {
                    margin: 0;
                    padding: 0;
                    font-family: Arial, Helvetica, sans-serif;
                    background: #ffffff !important;
                    color: #000000 !important;
                }
                .label-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    width: ${
                        config.labelSize === 'roll80' ? '72mm' :
                        config.labelSize === 'roll58' ? '48mm' :
                        (config.labelSize === 'small40x25' || config.labelSize === 'small') ? '40mm' :
                        (config.labelSize === 'medium' || config.labelSize === 'gondola50x30') ? '50mm' :
                        config.labelSize === 'gondola' ? '80mm' : '100mm'
                    };
                    height: ${
                        config.labelSize === 'roll80' || config.labelSize === 'roll58' ? 'auto' :
                        (config.labelSize === 'small40x25' || config.labelSize === 'medium') ? '25mm' :
                        (config.labelSize === 'small' || config.labelSize === 'gondola50x30') ? '30mm' :
                        config.labelSize === 'gondola' ? '40mm' : '50mm'
                    };
                    min-height: ${
                        config.labelSize === 'roll80' ? '35mm' :
                        config.labelSize === 'roll58' ? '30mm' : 'auto'
                    };
                    padding: ${config.labelSize === 'roll58' ? '2mm 1mm' : '2mm 3mm'};
                    page-break-after: always;
                    background: #ffffff !important;
                    color: #000000 !important;
                    overflow: hidden;
                    ${config.labelSize === 'roll80' || config.labelSize === 'roll58' ? 'border-bottom: 1px dashed #666; margin-bottom: 2mm;' : ''}
                }
                .label-name {
                    font-size: ${config.labelSize === 'roll58' || config.labelSize === 'small' ? '9pt' : '11.5pt'};
                    font-weight: 900 !important;
                    color: #000000 !important;
                    text-transform: uppercase;
                    line-height: 1.15;
                    max-height: 2.3em;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    width: 100%;
                    margin-bottom: 1.5mm;
                }
                .label-price-box {
                    display: flex;
                    align-items: baseline;
                    justify-content: center;
                    gap: 2mm;
                    margin-bottom: 1.5mm;
                    width: 100%;
                }
                .label-price-usd {
                    font-size: ${
                        !config.showPriceBs ? (config.labelSize === 'roll58' || config.labelSize === 'small' ? '12pt' : '15pt') :
                        (config.labelSize === 'roll58' || config.labelSize === 'small' ? '10pt' : '12pt')
                    };
                    font-weight: 900 !important;
                    color: #000000 !important;
                }
                .label-price-bs {
                    font-size: ${
                        !config.showPrice ? (config.labelSize === 'roll58' || config.labelSize === 'small' ? '12pt' : '15pt') :
                        (config.labelSize === 'roll58' || config.labelSize === 'small' ? '9.5pt' : '11.5pt')
                    };
                    font-weight: 900 !important;
                    color: #000000 !important;
                }
                .barcode-svg {
                    max-width: ${config.labelSize === 'roll58' ? '98%' : '90%'};
                    height: auto;
                }
            </style>
        `;

        const fullHtml = `<!DOCTYPE html><html><head><title>Imprimir Rótulos - Isaac POS</title>${style}</head><body>${printContent}</body></html>`;

        // Impresión en iframe invisible en la misma página: CERO apertura de ventanas en blanco about:blank
        let iframe = document.getElementById('label-silent-print-frame');
        if (iframe) {
            iframe.remove();
        }

        iframe = document.createElement('iframe');
        iframe.id = 'label-silent-print-frame';
        iframe.setAttribute('sandbox', 'allow-modals allow-same-origin');
        iframe.style.position = 'fixed';
        iframe.style.top = '-9999px';
        iframe.style.left = '-9999px';
        iframe.style.width = '0px';
        iframe.style.height = '0px';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(fullHtml);
        doc.close();

        iframe.contentWindow.focus();
        setTimeout(() => {
            try {
                iframe.contentWindow.print();
            } catch (e) {
                console.error('Error al invocar impresión por iframe:', e);
            }
            setTimeout(() => {
                if (iframe && iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            }, 1500);
        }, 300);
    };


    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            zIndex={zIndex}
            maxWidth="max-w-6xl"
            className="overflow-hidden flex flex-col h-[92dvh] max-h-[92dvh] pb-safe border border-slate-200 dark:border-white/10"
        >
            {/* Header */}
            <div className="px-4 py-3 sm:px-8 sm:py-5 border-b border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className="w-10 h-10 sm:w-11 sm:h-11 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center font-black shadow-inner shrink-0">
                        <Printer size={20} className="sm:hidden" />
                        <Printer size={22} className="hidden sm:block" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none truncate">
                            Generar & Imprimir Etiquetas
                        </h2>
                        <p className="text-[9px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1 truncate">
                            Rótulos de Góndola, Precios Duales y Códigos de Barras
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-2 sm:p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-2xl transition-all active:scale-90 cursor-pointer shrink-0 ml-2"
                    title="Cerrar"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                {/* Settings Sidebar */}
                <div className="w-full lg:w-[380px] border-r border-slate-100 dark:border-white/10 p-4 sm:p-6 space-y-4 sm:space-y-6 bg-slate-50/40 dark:bg-slate-950/40 overflow-y-auto custom-scrollbar shrink-0">
                    {/* SKU Quantification */}
                    <section className="space-y-2.5 sm:space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <Layers size={14} /> Copias por Producto
                            </h3>
                            <span className="text-[10px] font-black text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                                {totalLabels} etiquetas
                            </span>
                        </div>

                        <div className="space-y-2 max-h-[22vh] sm:max-h-[25vh] overflow-y-auto pr-1 sm:pr-2 custom-scrollbar">
                            {localProducts.map(p => (
                                <div key={p.id} className="bg-white dark:bg-slate-900 p-2.5 sm:p-3 rounded-2xl border border-slate-200/80 dark:border-white/5 flex items-center justify-between gap-2 shadow-sm">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-black text-slate-900 dark:text-white truncate uppercase">{p.name}</div>
                                        <div className="text-[9px] font-bold text-slate-400">{formatMoney(p.price, 'USD')}</div>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 p-1 rounded-xl shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setCopies(p.id, p.labelCopies - 1)}
                                            className="w-9 h-9 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-black transition-all cursor-pointer active:scale-95"
                                        >
                                            <Minus size={15} />
                                        </button>
                                        <span className="w-6 text-center font-black text-xs text-slate-900 dark:text-white tabular-nums">
                                            {p.labelCopies}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setCopies(p.id, p.labelCopies + 1)}
                                            className="w-9 h-9 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-black transition-all cursor-pointer active:scale-95"
                                        >
                                            <Plus size={15} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Dimensions / Preset */}
                    <div className="space-y-1.5 sm:space-y-2">
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Dimensiones del Rótulo
                        </label>
                        <select
                            value={config.labelSize}
                            onChange={(e) => setConfig({ ...config, labelSize: e.target.value })}
                            className="w-full px-4 py-3 min-h-[44px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl text-base sm:text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider focus:border-indigo-500 outline-none cursor-pointer"
                        >
                            <option value="roll58">🧾 Tickera Térmica 58 mm (POS-58 Directo)</option>
                            <option value="roll80">🧾 Tickera Térmica 80 mm (POS-80 Directo)</option>
                            <option value="small40x25">🏷️ Adhesiva Compacta (40 x 25 mm)</option>
                            <option value="small">🏷️ Térmica Mini (40 x 30 mm)</option>
                            <option value="medium">🏷️ Térmica Estándar (50 x 25 mm)</option>
                            <option value="gondola50x30">🏷️ Góndola Supermercado (50 x 30 mm)</option>
                            <option value="gondola">🏷️ Rótulo de Góndola (80 x 40 mm)</option>
                            <option value="large">🏷️ Industrial / Almacén (100 x 50 mm)</option>
                        </select>
                    </div>

                    {/* Visual Elements Toggles */}
                    <section className="space-y-2">
                        <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Elementos Visibles
                        </label>
                        <div className="space-y-2">
                            {[
                                { label: 'Nombre del Producto', key: 'showName' },
                                { label: 'Precio en Dólares ($)', key: 'showPrice' },
                                { label: 'Precio en Bolívares (Bs)', key: 'showPriceBs' },
                                { label: 'Código de Barras (CODE128)', key: 'showBarcode' }
                            ].map(item => (
                                <label key={item.key} className="flex items-center justify-between p-3 min-h-[44px] bg-white dark:bg-slate-900 rounded-xl border border-slate-200/70 dark:border-white/5 cursor-pointer hover:border-indigo-500/40 transition-all">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{item.label}</span>
                                    <input
                                        type="checkbox"
                                        checked={config[item.key]}
                                        onChange={() => setConfig({ ...config, [item.key]: !config[item.key] })}
                                        className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer"
                                    />
                                </label>
                            ))}
                        </div>
                    </section>
                </div>

                {/* Preview Canvas Area */}
                <div className="flex-1 p-4 sm:p-6 md:p-8 bg-slate-200/60 dark:bg-slate-950/60 flex flex-col items-center overflow-y-auto custom-scrollbar relative">
                    <div className="sticky top-0 z-10 mb-4 sm:mb-6">
                        <span className="bg-indigo-600 text-white px-4 sm:px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-600/30 flex items-center gap-1.5">
                            <Eye size={13} /> Previsualización Real
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-4 sm:gap-5 justify-center max-w-4xl pb-10">
                        {localProducts.flatMap(p => Array.from({ length: p.labelCopies }).map((_, i) => ({ ...p, key: `${p.id}-${i}` })))
                            .slice(0, 16)
                            .map((item, idx) => {
                                const priceUsd = Number(item.price) || 0;
                                const priceBs = (priceUsd * (exchangeRate || 1)).toFixed(2);

                                return (
                                    <motion.div
                                        key={item.key}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.03 }}
                                        className="bg-white text-black shadow-xl rounded-xl p-4 flex flex-col items-center justify-between text-center border-2 border-slate-900/10 transition-all hover:scale-105"
                                        style={{
                                            width: config.labelSize === 'roll58' ? '160px' :
                                                   config.labelSize === 'roll80' ? '210px' :
                                                   (config.labelSize === 'small' || config.labelSize === 'small40x25') ? '180px' :
                                                   (config.labelSize === 'medium' || config.labelSize === 'gondola50x30') ? '220px' :
                                                   config.labelSize === 'gondola' ? '260px' : '300px',
                                            minHeight: (config.labelSize === 'small40x25' || config.labelSize === 'medium') ? '120px' :
                                                       config.labelSize === 'roll58' ? '130px' :
                                                       (config.labelSize === 'small' || config.labelSize === 'gondola50x30' || config.labelSize === 'roll80') ? '145px' : '160px',
                                            borderBottom: (config.labelSize === 'roll58' || config.labelSize === 'roll80') ? '2px dashed #94a3b8' : undefined,
                                            color: '#000000',
                                            backgroundColor: '#ffffff'
                                        }}
                                    >
                                        {/* Product Name - Guaranteed 100% Black & Bold */}
                                        {config.showName && (
                                            <div 
                                                className="text-xs font-black uppercase tracking-tight leading-tight w-full line-clamp-2 mb-1.5"
                                                style={{ color: '#000000 !important', fontWeight: 900 }}
                                            >
                                                {item.name}
                                            </div>
                                        )}

                                        {/* Prices Container */}
                                        <div className="flex flex-wrap items-baseline justify-center gap-1.5 my-1.5 w-full">
                                            {config.showPrice && (
                                                <span 
                                                    className={`tracking-tight font-black ${!config.showPriceBs ? 'text-lg text-black' : 'text-sm text-black'}`}
                                                    style={{ color: '#000000 !important', fontWeight: 900 }}
                                                >
                                                    ${priceUsd.toFixed(2)}
                                                </span>
                                            )}
                                            {config.showPriceBs && (
                                                <span 
                                                    className={`tracking-tight font-black ${!config.showPrice ? 'text-base text-black' : 'text-xs text-black'}`}
                                                    style={{ color: '#000000 !important', fontWeight: 900 }}
                                                >
                                                    {config.showPrice ? `(${priceBs} Bs)` : `${priceBs} Bs`}
                                                </span>
                                            )}
                                        </div>

                                        {/* Barcode Render */}
                                        {config.showBarcode && item.barcode ? (
                                            <div className="w-full flex justify-center mt-1">
                                                <svg className="barcode-svg" data-barcode={item.barcode}></svg>
                                            </div>
                                        ) : config.showBarcode && (
                                            <div className="text-[8px] font-black text-rose-600 uppercase tracking-widest mt-1">
                                                Sin Código de Barras
                                            </div>
                                        )}
                                    </motion.div>
                                );
                            })}
                    </div>

                    {totalLabels > 16 && (
                        <div className="text-xs font-black text-slate-500 uppercase tracking-wider bg-white dark:bg-slate-900 px-4 sm:px-5 py-2.5 rounded-full border border-slate-200 dark:border-white/10 shadow-sm mt-4 text-center">
                            + {totalLabels - 16} etiquetas adicionales listas para imprimir
                        </div>
                    )}
                </div>
            </div>

            {/* Hidden Print Spool Area */}
            <div id="print-area" className="hidden">
                {localProducts.flatMap(p => Array.from({ length: p.labelCopies }).map((_, i) => ({ ...p, key: `${p.id}-${i}` }))).map((item) => {
                    const priceUsd = Number(item.price) || 0;
                    const priceBs = (priceUsd * (exchangeRate || 1)).toFixed(2);

                    return (
                        <div key={item.key} className="label-container">
                            {config.showName && <div className="label-name">{item.name}</div>}
                            <div className="label-price-box">
                                {config.showPrice && <span className="label-price-usd">${priceUsd.toFixed(2)}</span>}
                                {config.showPriceBs && <span className="label-price-bs">({priceBs} Bs)</span>}
                            </div>
                            {config.showBarcode && item.barcode && (
                                <svg className="barcode-svg" data-barcode={item.barcode}></svg>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 sm:px-8 sm:py-5 border-t border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 flex flex-col-reverse sm:flex-row items-center justify-between gap-3 shrink-0 pb-safe">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full sm:w-auto px-5 py-3 min-h-[44px] rounded-2xl text-xs font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex items-center justify-center cursor-pointer"
                    >
                        Descartar
                    </button>
                    <button
                        type="button"
                        onClick={handleBrowserPrint}
                        title="Imprimir en impresora normal de Windows o exportar a PDF (sin ventanas emergentes)"
                        className="w-full sm:w-auto px-4 py-3 min-h-[44px] rounded-2xl text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                        <Eye size={15} /> Diálogo / PDF
                    </button>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                        type="button"
                        disabled={isPrinting}
                        onClick={handleDirectThermalPrint}
                        className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 min-h-[44px] rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg transition-all active:scale-95 cursor-pointer ${
                            isPrinting ? 'bg-indigo-400 text-white cursor-wait' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                        }`}
                    >
                        <Zap size={16} />
                        {isPrinting ? 'Enviando a Tickera...' : `⚡ Tickera POS (${is58mm ? 'POS-58' : 'POS-80'})`}
                    </button>
                    {!isThermalRoll && (
                        <button
                            type="button"
                            onClick={handleBrowserPrint}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
                        >
                            <Printer size={16} /> Imprimir {totalLabels} Etiquetas
                        </button>
                    )}
                </div>
            </div>
        </BaseModal>
    );
}
