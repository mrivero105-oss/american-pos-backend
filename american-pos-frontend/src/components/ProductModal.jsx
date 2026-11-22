import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { X, Package, Save, Loader2, Check, Printer, Layers, Search, Maximize2, Minimize2 } from 'lucide-react';
import { usePos } from '../hooks/PosContext';
import { precisionRound, formatStock, isDollarOnlyCountry, isUsdOnlyMode, formatMoney } from '../utils/format';
import { getImageUrl } from '../utils/imageUtils';
import { parsePresentation, normalizeFamilyKey } from '../utils/productFamilies';
import api from '../services/api';
import { db } from '../services/db';
import BaseModal from './BaseModal';
import MobileBarcodeScannerModal from './MobileBarcodeScannerModal';
import LabelModal from './LabelModal';
import SupervisorPinModal from './SupervisorPinModal';
import ProductImageUpload from './product/ProductImageUpload';
import ProductBasicInfo from './product/ProductBasicInfo';
import ProductInventoryInfo from './product/ProductInventoryInfo';
import ProductPricingDetail from './product/ProductPricingDetail';
import { useAuth } from '../hooks/AuthContext';
import { normalizeProductImage } from '../utils/imageProcess';
import useScanner from '../hooks/useScanner';

function extractProductFormData(prod, rate, isPharmacy) {
    if (!prod) {
        return {
            name: '',
            category: 'General',
            price: '',
            cost: '',
            margin: '',
            priceBs: '',
            costBs: '',
            stockQuantity: '',
            stockUnits: '',
            minStock: '5',
            stockUnit: isPharmacy ? 'tab' : 'und',
            isSoldByWeight: false,
            barcode: '',
            imageUrl: '',
            supplierId: '',
            bulkUnitName: isPharmacy ? 'Caja' : 'Bulto',
            unitsPerBulk: 1,
            bulkCost: '',
            bulkCostBs: '',
            bulkPrice: '',
            bulkPriceBs: '',
            bulkBarcode: '',
            midBulkUnitName: isPharmacy ? 'Media Caja' : 'Media Presentación',
            unitsPerMidBulk: 0,
            midBulkCost: '',
            midBulkCostBs: '',
            midBulkPrice: '',
            midBulkPriceBs: '',
            midBulkBarcode: '',
            taxStatus: 'gravable',
            batchNumber: '',
            expirationDate: '',
            es_controlado: false,
            principio_activo: '',
            presentations: []
        };
    }

    const usdPrice = Number(prod.price || 0);
    const usdCost = Number(prod.cost || 0);
    const bsPrice = usdPrice ? precisionRound(parseFloat(usdPrice) * rate, 6).toString() : '';
    const calcBsCost = usdCost ? precisionRound(parseFloat(usdCost) * rate, 6).toString() : '';

    const unitsPerBulk = Number(prod.unitsPerBulk || 1);
    const unitsPerMidBulk = Number(prod.unitsPerMidBulk || 0);

    const bulkUsd = prod.bulkCost !== undefined && prod.bulkCost !== null && Number(prod.bulkCost) !== 0 ? Number(prod.bulkCost) : (usdCost * unitsPerBulk);
    const calcUsdCost = unitsPerBulk > 0 ? precisionRound(bulkUsd / unitsPerBulk, 6) : usdCost;
    const bsBulkCost = precisionRound(bulkUsd * rate, 6);

    const margin = prod.margin !== undefined && prod.margin !== null ? Number(prod.margin).toFixed(2) : (calcUsdCost > 0 ? (((usdPrice - calcUsdCost) / calcUsdCost) * 100).toFixed(2) : '');

    let bulkPriceUsd = prod.bulkPrice !== undefined && prod.bulkPrice !== null && Number(prod.bulkPrice) > 0 ? Number(prod.bulkPrice) : '';
    let bulkPriceBs = prod.bulkPriceBs !== undefined && prod.bulkPriceBs !== null && Number(prod.bulkPriceBs) > 0 
        ? Number(prod.bulkPriceBs) 
        : (bulkPriceUsd !== '' && rate > 0 ? precisionRound(bulkPriceUsd * rate, 2) : '');

    if (!bulkPriceUsd && unitsPerBulk > 1 && usdPrice > 0) {
        const autoBulk = precisionRound(usdPrice * unitsPerBulk, 2);
        bulkPriceUsd = autoBulk;
        bulkPriceBs = rate > 0 ? precisionRound(autoBulk * rate, 2) : '';
    }

    const midBulkUsd = prod.midBulkCost !== undefined && prod.midBulkCost !== null && Number(prod.midBulkCost) !== 0 
        ? Number(prod.midBulkCost) 
        : (unitsPerMidBulk > 0 ? precisionRound(calcUsdCost * unitsPerMidBulk, 6) : 0);
    const bsMidBulkCost = midBulkUsd > 0 ? precisionRound(midBulkUsd * rate, 6) : '';

    let midBulkPriceUsd = prod.midBulkPrice !== undefined && prod.midBulkPrice !== null && Number(prod.midBulkPrice) > 0 ? Number(prod.midBulkPrice) : '';
    let midBulkPriceBs = prod.midBulkPriceBs !== undefined && prod.midBulkPriceBs !== null && Number(prod.midBulkPriceBs) > 0 
        ? Number(prod.midBulkPriceBs) 
        : (midBulkPriceUsd !== '' && rate > 0 ? precisionRound(midBulkPriceUsd * rate, 2) : '');

    if (!midBulkPriceUsd && unitsPerMidBulk > 1 && usdPrice > 0) {
        const autoMidBulk = precisionRound(usdPrice * unitsPerMidBulk, 2);
        midBulkPriceUsd = autoMidBulk;
        midBulkPriceBs = rate > 0 ? precisionRound(autoMidBulk * rate, 2) : '';
    }

    return {
        name: prod.name || '',
        category: prod.category || 'General',
        price: usdPrice.toString(),
        cost: calcUsdCost.toString(),
        margin: margin.toString(),
        priceBs: bsPrice.toString(),
        costBs: calcBsCost.toString(),
        stockQuantity: formatStock(prod.stockQuantity !== undefined ? Number(prod.stockQuantity) : (Number(prod.stock) || '')),
        stockUnits: prod.stockUnits !== undefined && prod.stockUnits !== null ? formatStock(Number(prod.stockUnits)) : '',
        minStock: formatStock(prod.minStock !== undefined ? Number(prod.minStock) : 5),
        stockUnit: prod.isSoldByWeight && (!prod.stockUnit || prod.stockUnit === 'und' || prod.stockUnit === 'unidad')
            ? 'kg'
            : (prod.stockUnit || 'und'),
        isSoldByWeight: !!prod.isSoldByWeight,
        barcode: prod.barcode || prod.sku || '',
        imageUrl: prod.imageUri || prod.imageUrl || '',
        supplierId: prod.supplierId || '',
        bulkUnitName: prod.bulkUnitName || (isPharmacy ? 'Caja' : 'Bulto'),
        unitsPerBulk: unitsPerBulk,
        bulkCost: bulkUsd.toString(),
        bulkCostBs: bsBulkCost.toString(),
        bulkPrice: bulkPriceUsd.toString(),
        bulkPriceBs: bulkPriceBs.toString(),
        bulkBarcode: prod.bulkBarcode || '',
        midBulkUnitName: prod.midBulkUnitName || (isPharmacy ? 'Media Caja' : 'Media Presentación'),
        unitsPerMidBulk: unitsPerMidBulk,
        midBulkCost: midBulkUsd > 0 ? midBulkUsd.toString() : '',
        midBulkCostBs: bsMidBulkCost ? bsMidBulkCost.toString() : '',
        midBulkPrice: midBulkPriceUsd.toString(),
        midBulkPriceBs: midBulkPriceBs.toString(),
        midBulkBarcode: prod.midBulkBarcode || '',
        taxStatus: prod.taxStatus || 'gravable',
        batchNumber: prod.batchNumber || '',
        expirationDate: prod.expirationDate || '',
        es_controlado: !!prod.es_controlado,
        principio_activo: prod.principio_activo || '',
        presentations: (Array.isArray(prod.Presentations) && prod.Presentations.length > 0)
            ? prod.Presentations.map(p => ({
                ...p,
                factorConversion: p.factorConversion !== undefined && p.factorConversion !== null && !Number.isNaN(Number(p.factorConversion))
                    ? String(Number(p.factorConversion))
                    : p.factorConversion,
                price: p.price !== undefined && p.price !== null && Number(p.price) > 0
                    ? String(Number(p.price))
                    : '',
                cost: p.cost !== undefined && p.cost !== null && Number(p.cost) > 0
                    ? String(Number(p.cost))
                    : '',
                priceBs: p.priceBs !== undefined && p.priceBs !== null && Number(p.priceBs) > 0
                    ? String(Number(p.priceBs))
                    : (Number(p.price) > 0 && rate > 0 ? precisionRound(Number(p.price) * rate, 2).toString() : '')
            }))
            : (() => {
                const legacyList = [];
                const baseBc = String(prod.barcode || prod.sku || '').trim();
                const bulkBc = String(prod.bulkBarcode || '').trim();
                const midBc = String(prod.midBulkBarcode || '').trim();
                if (Number(unitsPerMidBulk) > 0) {
                    legacyList.push({
                        id: `pres_mid_${Date.now()}_1`,
                        name: prod.midBulkUnitName || (isPharmacy ? 'Media Caja' : 'Media Presentación'),
                        factorConversion: Number(unitsPerMidBulk),
                        cost: midBulkUsd > 0 ? midBulkUsd.toString() : '',
                        price: midBulkPriceUsd > 0 ? midBulkPriceUsd.toString() : '',
                        priceBs: midBulkPriceBs ? midBulkPriceBs.toString() : '',
                        barcode: (midBc && midBc !== baseBc && midBc !== bulkBc) ? midBc : '',
                        isDefaultPurchase: false
                    });
                }
                if (Number(unitsPerBulk) > 1) {
                    legacyList.push({
                        id: `pres_bulk_${Date.now()}_2`,
                        name: prod.bulkUnitName || (isPharmacy ? 'Caja' : 'Bulto'),
                        factorConversion: Number(unitsPerBulk),
                        cost: bulkUsd > 0 ? bulkUsd.toString() : '',
                        price: bulkPriceUsd > 0 ? bulkPriceUsd.toString() : '',
                        priceBs: bulkPriceBs ? bulkPriceBs.toString() : '',
                        barcode: (bulkBc && bulkBc !== baseBc) ? bulkBc : '',
                        isDefaultPurchase: true
                    });
                }
                return legacyList;
            })()
    };
}

export default function ProductModal({ isOpen, onClose, onSave, product = null, processing = false, businessSettings = null }) {
    const { exchangeRate, currencyMode, country: contextCountry, isUsdOnly: contextIsUsdOnly } = usePos();
    const { user, hasPermission } = useAuth();
    
    const userRole = (user?.role || '').toLowerCase();
    const isCashier = ['cashier', 'cajero', 'waiter', 'mesero'].includes(userRole);
    const canDirectlyModifyPrices = !isCashier && (['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes(userRole) || hasPermission('canModifyPrices'));
    const canDirectlyAdjustStock = !isCashier && (['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes(userRole) || hasPermission('canAdjustStock'));
    const canDirectlyCreateEdit = !isCashier && (['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes(userRole) || hasPermission('canCreateProducts'));

    const effectiveCountry = businessSettings?.country || contextCountry || localStorage.getItem('pos_country') || '';
    const isDollarCountry = isDollarOnlyCountry(effectiveCountry);
    const isUsdOnly = contextIsUsdOnly || isDollarCountry || isUsdOnlyMode({ currencyMode, country: effectiveCountry });
    const isVenezuela = !isUsdOnly && !isDollarCountry && ((effectiveCountry.toLowerCase() === 'venezuela' || effectiveCountry.toLowerCase() === 've') || !effectiveCountry);

    const isPharmacy = (businessSettings?.industry || '').toLowerCase() === 'pharmacy';

    // Estados para familia multivariante (50g, 100g, 200g, etc.)
    const [familyVariants, setFamilyVariants] = useState([]);
    const [activeVariantId, setActiveVariantId] = useState(null);
    const [currentEditingProduct, setCurrentEditingProduct] = useState(null);

    const [formData, setFormData] = useState(() => extractProductFormData(null, 1, isPharmacy));

    const [loading, setLoading] = useState(false);
    const [suppliers, setSuppliers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [localImageFile, setLocalImageFile] = useState(null);
    const [imageSrc, setImageSrc] = useState('');
    const [isGeneratingBarcode, setIsGeneratingBarcode] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [iaImageCandidates, setIaImageCandidates] = useState([]);
    const [isSelectingImage, setIsSelectingImage] = useState(false);
    const [isDownloadingImage, setIsDownloadingImage] = useState(false);
    const [imageScale, setImageScale] = useState(1);
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryInput, setNewCategoryInput] = useState('');
    const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
    const [scannerMode, setScannerMode] = useState('BARCODE');
    const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
    const [isSupervisorPinOpen, setIsSupervisorPinOpen] = useState(false);
    const [supervisorPinAction, setSupervisorPinAction] = useState('MODIFICAR PRODUCTO');
    const [pendingPayload, setPendingPayload] = useState(null);
    const fileInputRef = useRef(null);

    const labelProductList = useMemo(() => {
        if (!isOpen) return [];
        return [{
            id: product?.id || 'temp-barcode',
            name: formData.name || 'Producto',
            barcode: formData.barcode || '',
            price: Number(formData.price) || 0,
            priceBs: Number(formData.priceBs) || (Number(formData.price) * (exchangeRate || 1)),
            stockUnit: formData.stockUnit || 'und',
            isSoldByWeight: Boolean(formData.isSoldByWeight),
            category: formData.category || 'General',
            labelCopies: 1
        }];
    }, [isOpen, product?.id, formData.name, formData.barcode, formData.price, formData.priceBs, formData.stockUnit, formData.isSoldByWeight, formData.category, exchangeRate]);

    const handleBarcodeScanned = useCallback((scannedCode) => {
        const clean = String(scannedCode || '').trim();
        if (!clean) return;
        setFormData(prev => ({ ...prev, barcode: clean }));
        setIsBarcodeScannerOpen(false);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(clean).catch(() => {});
        }
        toast.success(`Código asignado al producto: ${clean}`, { id: 'barcode-scan' });
    }, []);

    useScanner(handleBarcodeScanned, {
        enabled: Boolean(isOpen),
        priority: true
    });

    const handleConfirmNewCategory = () => {
        if (!newCategoryInput || !newCategoryInput.trim()) {
            toast.error('Ingresa un nombre para la categoría');
            return;
        }
        const normalized = newCategoryInput.trim().charAt(0).toUpperCase() + newCategoryInput.trim().slice(1).toLowerCase();
        setCategories(prev => [...new Set([...prev, normalized])].sort());
        setFormData(prev => ({ ...prev, category: normalized }));
        setNewCategoryInput('');
        setIsAddingCategory(false);
        toast.success(`Categoría "${normalized}" creada`);
    };

    // Memory management for localImageFile object URL
    useEffect(() => {
        if (localImageFile) {
            const objectUrl = URL.createObjectURL(localImageFile);
            setImageSrc(objectUrl);
            return () => URL.revokeObjectURL(objectUrl);
        } else {
            setImageSrc(getImageUrl(formData.imageUrl));
        }
    }, [localImageFile, formData.imageUrl]);

    // Fetch suppliers and categories
    useEffect(() => {
        if (isOpen) {
            const fetchData = async () => {
                try {
                    const [supRes, catRes] = await Promise.all([
                        api.get('/suppliers', { timeout: 3000 }).catch(() => ({ data: [] })),
                        api.get('/products/categories', { timeout: 3000 }).catch(() => ({ data: [] }))
                    ]);
                    let sups = supRes.data || [];
                    let cats = (catRes.data || []).map(c => c?.trim().charAt(0).toUpperCase() + c?.trim().slice(1).toLowerCase()).filter(Boolean);

                    if (cats.length === 0) {
                        try {
                            const cachedCats = JSON.parse(localStorage.getItem('pos_categories') || '[]');
                            if (cachedCats.length > 0) cats = cachedCats;
                        } catch (caughtErr) { console.warn('[ProductModal] Error parseando JSON local:', caughtErr?.message || caughtErr); }
                    }
                    if (cats.length === 0) {
                        try {
                            const localProds = await db.getAll('products');
                            cats = [...new Set(localProds.map(p => p.category?.trim().charAt(0).toUpperCase() + p.category?.trim().slice(1).toLowerCase()))].filter(Boolean);
                        } catch (caughtErr) { console.warn('[ProductModal] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
                    }
                    setSuppliers(sups);
                    const uniqueCats = [...new Set(cats)].sort();
                    setCategories(uniqueCats.length > 0 ? uniqueCats : ['General']);
                } catch (err) {
                    console.error('Error fetching modal data:', err);
                    setCategories(['General']);
                }
            };
            fetchData();
        }
    }, [isOpen]);


    const exchangeRateRef = useRef(exchangeRate);
    const isPharmacyRef = useRef(isPharmacy);
    useEffect(() => {
        exchangeRateRef.current = exchangeRate;
        isPharmacyRef.current = isPharmacy;
    }, [exchangeRate, isPharmacy]);

    useEffect(() => {
        const rate = exchangeRateRef.current || 1;
        if (isOpen) {
            if (product) {
                const targetId = product.id;
                setActiveVariantId(targetId);
                setCurrentEditingProduct(product);
                setFormData(extractProductFormData(product, rate, isPharmacyRef.current));

                // Detectar variantes de familia (si vinieron en product.variants o _familyVariants)
                const preVariants = Array.isArray(product.variants) && product.variants.length > 1
                    ? product.variants
                    : (Array.isArray(product._familyVariants) && product._familyVariants.length > 1 ? product._familyVariants : null);

                if (preVariants) {
                    setFamilyVariants(preVariants);
                } else {
                    // Buscar hermanos de familia en base de datos local
                    const findSiblings = async () => {
                        try {
                            const parsed = parsePresentation(product.name);
                            if (!parsed || !parsed.baseName) {
                                setFamilyVariants([]);
                                return;
                            }
                            const targetBaseKey = normalizeFamilyKey(parsed.baseName);
                            if (targetBaseKey.length < 3) {
                                setFamilyVariants([]);
                                return;
                            }

                            const allLocal = await db.getAll('products');
                            const siblings = allLocal.filter(p => {
                                if (!p || !p.name) return false;
                                const pParsed = parsePresentation(p.name);
                                return pParsed && normalizeFamilyKey(pParsed.baseName) === targetBaseKey;
                            });

                            if (siblings.length > 1) {
                                const mapped = siblings.map(s => {
                                    const sParsed = parsePresentation(s.name);
                                    return {
                                        ...s,
                                        presentationLabel: sParsed ? sParsed.label : s.name,
                                        sortWeight: sParsed ? sParsed.sortWeight : 0
                                    };
                                }).sort((a, b) => a.sortWeight - b.sortWeight);
                                setFamilyVariants(mapped);
                            } else {
                                setFamilyVariants([]);
                            }
                        } catch (e) {
                            console.warn('Error detectando variantes en modal:', e);
                            setFamilyVariants([]);
                        }
                    };
                    findSiblings();
                }
            } else {
                setActiveVariantId(null);
                setCurrentEditingProduct(null);
                setFamilyVariants([]);
                setFormData(extractProductFormData(null, rate, isPharmacyRef.current));
            }
            setLocalImageFile(null);
            setImageScale(1);
        }
    }, [product, isOpen]);

    // Función para alternar entre presentaciones de la familia dentro del mismo modal
    const handleSwitchVariant = useCallback(async (targetVariant) => {
        if (!targetVariant || targetVariant.id === activeVariantId) return;
        try {
            setLoading(true);
            const rate = exchangeRate || 1;
            let fullData = null;
            try {
                const res = await api.get(`/products/${targetVariant.id}`, { timeout: 3000 });
                fullData = res.data;
            } catch {
                fullData = await db.getById('products', targetVariant.id);
            }
            if (!fullData) fullData = targetVariant;

            setActiveVariantId(fullData.id);
            setCurrentEditingProduct(fullData);
            setFormData(extractProductFormData(fullData, rate, isPharmacy));
            setLocalImageFile(null);
            setImageSrc(getImageUrl(fullData.imageUri || fullData.imageUrl));
            toast.success(`Editando: ${targetVariant.presentationLabel || targetVariant.name}`, { id: 'variant-switch', duration: 1500 });
        } catch (err) {
            console.error('Error al cambiar de presentación:', err);
            toast.error('No se pudo cargar la presentación');
        } finally {
            setLoading(false);
        }
    }, [activeVariantId, exchangeRate, isPharmacy]);

    const [isMaximized, setIsMaximized] = useState(() => {
        try {
            return localStorage.getItem('pos_product_modal_maximized') === 'true';
        } catch {
            return false;
        }
    });

    const toggleMaximize = () => {
        setIsMaximized(prev => {
            const next = !prev;
            try {
                localStorage.setItem('pos_product_modal_maximized', String(next));
            } catch (caughtErr) { console.warn('[ProductModal] Error accediendo almacenamiento web local:', caughtErr?.message || caughtErr); }
            return next;
        });
    };

    if (!isOpen) return null;

    const handleChange = (e) => {
        let { name, value, type, checked } = e.target;
        const rate = exchangeRate || 1;

        // Normalize numeric input: convert comma to dot
        const isNumericField = ['price', 'priceBs', 'cost', 'costBs', 'bulkCost', 'bulkCostBs', 'unitsPerBulk', 'margin', 'stockQuantity', 'minStock', 'bulkPrice', 'bulkPriceBs', 'unitsPerMidBulk', 'midBulkCost', 'midBulkCostBs', 'midBulkPrice', 'midBulkPriceBs'].includes(name);
        if (isNumericField && typeof value === 'string') {
            value = value.replace(',', '.');
        }

        if (type === 'checkbox') {
            if (name === 'isSoldByWeight') {
                setFormData(prev => ({
                    ...prev,
                    isSoldByWeight: checked,
                    stockUnit: checked ? 'kg' : (prev.stockUnit === 'kg' ? (isPharmacy ? 'tab' : 'und') : prev.stockUnit)
                }));
                return;
            }
            setFormData(prev => ({ ...prev, [name]: checked }));
            return;
        }

        const syncPresentations = (list, prevUnitPrice, nextUnitPrice, prevUnitCost, nextUnitCost) => {
            if (!Array.isArray(list) || list.length === 0) return list;
            const prevP = parseFloat(prevUnitPrice) || 0;
            const nextP = parseFloat(nextUnitPrice) || 0;
            const prevC = parseFloat(prevUnitCost) || 0;
            const nextC = parseFloat(nextUnitCost) || 0;

            return list.map(pres => {
                const factor = Number(pres.factorConversion) || 1;
                const currentPresPrice = parseFloat(pres.price) || 0;
                const currentPresCost = parseFloat(pres.cost) || 0;

                const updated = { ...pres };

                if (nextUnitPrice !== undefined) {
                    const matchedPrevExact = prevP > 0 && Math.abs(currentPresPrice - (prevP * factor)) < 0.025;
                    const matchedPrevDiscount = prevP > 0 && Math.abs(currentPresPrice - (prevP * factor * 0.95)) < 0.025;
                    const shouldSyncPrice = !pres.isManualPrice || currentPresPrice <= 0 || matchedPrevExact || matchedPrevDiscount;

                    if (shouldSyncPrice) {
                        const newPresUsd = nextP > 0 ? (nextP * factor).toFixed(2) : '';
                        const newPresBs = newPresUsd && rate > 0 ? (Math.round(parseFloat(newPresUsd) * rate * 100) / 100).toString() : '';
                        updated.price = newPresUsd;
                        updated.priceBs = newPresBs;
                    }
                }

                if (nextUnitCost !== undefined) {
                    const matchedPrevCost = prevC > 0 && Math.abs(currentPresCost - (prevC * factor)) < 0.025;
                    const shouldSyncCost = !pres.isManualCost || currentPresCost <= 0 || matchedPrevCost;

                    if (shouldSyncCost) {
                        updated.cost = nextC > 0 ? (nextC * factor).toFixed(2) : '';
                    }
                }

                return updated;
            });
        };

        if (name === 'price') {
            const priceVal = parseFloat(value) || 0;
            const costVal = parseFloat(formData.cost) || 0;
            const marginVal = costVal > 0 ? (((priceVal - costVal) / costVal) * 100).toFixed(2) : '';
            const bsVal = value ? precisionRound(parseFloat(value) * rate, 6).toString() : '';
            const units = parseFloat(formData.unitsPerBulk) || 1;
            let bulkPriceVal = formData.bulkPrice;
            let bulkPriceBsVal = formData.bulkPriceBs;
            if (priceVal > 0 && units > 1 && (!formData.bulkPrice || parseFloat(formData.bulkPrice) === 0)) {
                bulkPriceVal = precisionRound(priceVal * units, 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            }
            const midUnits = parseFloat(formData.unitsPerMidBulk) || 0;
            let midPriceVal = formData.midBulkPrice;
            let midPriceBsVal = formData.midBulkPriceBs;
            if (priceVal > 0 && midUnits > 1 && (!formData.midBulkPrice || parseFloat(formData.midBulkPrice) === 0)) {
                midPriceVal = precisionRound(priceVal * midUnits, 2).toString();
                midPriceBsVal = rate > 0 ? precisionRound(parseFloat(midPriceVal) * rate, 2).toString() : '';
            }
            setFormData(prev => ({ 
                ...prev, 
                price: value, 
                priceBs: bsVal, 
                margin: marginVal, 
                bulkPrice: bulkPriceVal, 
                bulkPriceBs: bulkPriceBsVal,
                midBulkPrice: midPriceVal,
                midBulkPriceBs: midPriceBsVal,
                presentations: syncPresentations(prev.presentations, prev.price, value, undefined, undefined)
            }));
        } else if (name === 'priceBs') {
            const priceBsVal = parseFloat(value) || 0;
            const usdVal = value ? precisionRound(priceBsVal / rate, 6).toString() : '';
            const costVal = parseFloat(formData.cost) || 0;
            const marginVal = (costVal > 0 && usdVal) ? (((parseFloat(usdVal) - costVal) / costVal) * 100).toFixed(2) : '';
            const units = parseFloat(formData.unitsPerBulk) || 1;
            let bulkPriceVal = formData.bulkPrice;
            let bulkPriceBsVal = formData.bulkPriceBs;
            if (usdVal && parseFloat(usdVal) > 0 && units > 1 && (!formData.bulkPrice || parseFloat(formData.bulkPrice) === 0)) {
                bulkPriceVal = precisionRound(parseFloat(usdVal) * units, 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            }
            const midUnits = parseFloat(formData.unitsPerMidBulk) || 0;
            let midPriceVal = formData.midBulkPrice;
            let midPriceBsVal = formData.midBulkPriceBs;
            if (usdVal && parseFloat(usdVal) > 0 && midUnits > 1 && (!formData.midBulkPrice || parseFloat(formData.midBulkPrice) === 0)) {
                midPriceVal = precisionRound(parseFloat(usdVal) * midUnits, 2).toString();
                midPriceBsVal = rate > 0 ? precisionRound(parseFloat(midPriceVal) * rate, 2).toString() : '';
            }
            setFormData(prev => ({ 
                ...prev, 
                priceBs: value, 
                price: usdVal, 
                margin: marginVal, 
                bulkPrice: bulkPriceVal, 
                bulkPriceBs: bulkPriceBsVal,
                midBulkPrice: midPriceVal,
                midBulkPriceBs: midPriceBsVal,
                presentations: syncPresentations(prev.presentations, prev.price, usdVal, undefined, undefined)
            }));
        } else if (name === 'cost') {
            const costVal = parseFloat(value) || 0;
            const units = parseFloat(formData.unitsPerBulk) || 1;
            
            const currentPrice = parseFloat(formData.price) || 0;
            let marginVal = formData.margin;
            let priceVal = formData.price;

            if (currentPrice > 0 && formData.margin === '') {
                marginVal = costVal > 0 ? (((currentPrice - costVal) / costVal) * 100).toFixed(2) : '';
            } else if (formData.margin !== '') {
                const mVal = parseFloat(formData.margin) || 0;
                priceVal = costVal > 0 ? precisionRound(costVal * (1 + mVal / 100), 6).toString() : formData.price;
            }

            const bsCostVal = value ? precisionRound(parseFloat(value) * rate, 6).toString() : '';
            const bsPriceVal = priceVal ? precisionRound(parseFloat(priceVal) * rate, 6).toString() : '';
            const bulkCostVal = precisionRound(costVal * units, 6).toString();
            const bulkCostBsVal = bsCostVal ? precisionRound(parseFloat(bsCostVal) * units, 6).toString() : '';
            const midUnits = parseFloat(formData.unitsPerMidBulk) || 0;
            const midCostVal = midUnits > 0 ? precisionRound(costVal * midUnits, 6).toString() : formData.midBulkCost;
            const midCostBsVal = midUnits > 0 && bsCostVal ? precisionRound(parseFloat(bsCostVal) * midUnits, 6).toString() : formData.midBulkCostBs;
            
            setFormData(prev => ({ 
                ...prev, 
                cost: value, 
                costBs: bsCostVal, 
                price: priceVal, 
                priceBs: bsPriceVal, 
                bulkCost: bulkCostVal, 
                bulkCostBs: bulkCostBsVal,
                midBulkCost: midCostVal,
                midBulkCostBs: midCostBsVal,
                margin: marginVal,
                presentations: syncPresentations(prev.presentations, prev.price, priceVal, prev.cost, value)
            }));
        } else if (name === 'costBs') {
            const costBsVal = parseFloat(value) || 0;
            const units = parseFloat(formData.unitsPerBulk) || 1;
            const usdVal = value ? precisionRound(costBsVal / rate, 6) : 0;
            
            const currentPrice = parseFloat(formData.price) || 0;
            let marginVal = formData.margin;
            let priceVal = formData.price;

            if (currentPrice > 0 && formData.margin === '') {
                marginVal = usdVal > 0 ? (((currentPrice - usdVal) / usdVal) * 100).toFixed(2) : '';
            } else if (formData.margin !== '') {
                const mVal = parseFloat(formData.margin) || 0;
                priceVal = usdVal > 0 ? precisionRound(usdVal * (1 + mVal / 100), 6).toString() : formData.price;
            }

            const bsPriceVal = priceVal ? precisionRound(parseFloat(priceVal) * rate, 6).toString() : '';
            const bulkCostVal = precisionRound(usdVal * units, 6).toString();
            const bulkCostBsVal = value ? precisionRound(parseFloat(value) * units, 6).toString() : '';
            const midUnits = parseFloat(formData.unitsPerMidBulk) || 0;
            const midCostVal = midUnits > 0 ? precisionRound(usdVal * midUnits, 6).toString() : formData.midBulkCost;
            const midCostBsVal = midUnits > 0 && value ? precisionRound(parseFloat(value) * midUnits, 6).toString() : formData.midBulkCostBs;
            
            setFormData(prev => ({ 
                ...prev, 
                costBs: value, 
                cost: usdVal.toString(), 
                price: priceVal, 
                priceBs: bsPriceVal, 
                bulkCost: bulkCostVal, 
                bulkCostBs: bulkCostBsVal,
                midBulkCost: midCostVal,
                midCostBs: midCostBsVal,
                margin: marginVal,
                presentations: syncPresentations(prev.presentations, prev.price, priceVal, prev.cost, usdVal.toString())
            }));
        } else if (name === 'bulkCost') {
            const bulkCostVal = parseFloat(value) || 0;
            const units = parseFloat(formData.unitsPerBulk) || 1;
            const costVal = units > 0 ? precisionRound(bulkCostVal / units, 6) : 0;
            
            const currentPrice = parseFloat(formData.price) || 0;
            let marginVal = formData.margin;
            let priceVal = formData.price;

            if (currentPrice > 0 && formData.margin === '') {
                marginVal = costVal > 0 ? (((currentPrice - costVal) / costVal) * 100).toFixed(2) : '';
            } else if (formData.margin !== '') {
                const mVal = parseFloat(formData.margin) || 0;
                priceVal = costVal > 0 ? precisionRound(costVal * (1 + mVal / 100), 6).toString() : formData.price;
            }

            const bsCostVal = costVal ? precisionRound(costVal * rate, 6).toString() : '';
            const bsPriceVal = priceVal ? precisionRound(parseFloat(priceVal) * rate, 6).toString() : '';
            const bulkCostBsVal = value ? precisionRound(parseFloat(value) * rate, 6).toString() : '';
            
            // Auto calculate bulkPrice based on margin or unit price
            let bulkPriceVal = formData.bulkPrice;
            let bulkPriceBsVal = formData.bulkPriceBs;
            if (formData.margin !== '' && bulkCostVal > 0) {
                const mVal = parseFloat(formData.margin) || 0;
                bulkPriceVal = precisionRound(bulkCostVal * (1 + mVal / 100), 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            } else if (priceVal && units > 1) {
                bulkPriceVal = precisionRound(parseFloat(priceVal) * units, 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            }

            setFormData(prev => ({ 
                ...prev, 
                bulkCost: value, 
                bulkCostBs: bulkCostBsVal, 
                cost: costVal.toString(), 
                costBs: bsCostVal, 
                price: priceVal, 
                priceBs: bsPriceVal,
                bulkPrice: bulkPriceVal,
                bulkPriceBs: bulkPriceBsVal,
                margin: marginVal
            }));
        } else if (name === 'bulkCostBs') {
            const bulkCostBsVal = parseFloat(value) || 0;
            const units = parseFloat(formData.unitsPerBulk) || 1;
            const bulkUsdVal = value ? precisionRound(bulkCostBsVal / rate, 6) : 0;
            const costVal = units > 0 ? precisionRound(bulkUsdVal / units, 6) : 0;
            
            const currentPrice = parseFloat(formData.price) || 0;
            let marginVal = formData.margin;
            let priceVal = formData.price;

            if (currentPrice > 0 && formData.margin === '') {
                marginVal = costVal > 0 ? (((currentPrice - costVal) / costVal) * 100).toFixed(2) : '';
            } else if (formData.margin !== '') {
                const mVal = parseFloat(formData.margin) || 0;
                priceVal = costVal > 0 ? precisionRound(costVal * (1 + mVal / 100), 6).toString() : formData.price;
            }

            const bsCostVal = costVal ? precisionRound(costVal * rate, 6).toString() : '';
            const bsPriceVal = priceVal ? precisionRound(parseFloat(priceVal) * rate, 6).toString() : '';
            
            let bulkPriceVal = formData.bulkPrice;
            let bulkPriceBsVal = formData.bulkPriceBs;
            if (formData.margin !== '' && bulkUsdVal > 0) {
                const mVal = parseFloat(formData.margin) || 0;
                bulkPriceVal = precisionRound(bulkUsdVal * (1 + mVal / 100), 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            }

            setFormData(prev => ({ 
                ...prev, 
                bulkCost: bulkUsdVal.toString(), 
                bulkCostBs: value, 
                cost: costVal.toString(), 
                costBs: bsCostVal, 
                price: priceVal, 
                priceBs: bsPriceVal,
                bulkPrice: bulkPriceVal,
                bulkPriceBs: bulkPriceBsVal,
                margin: marginVal
            }));
        } else if (name === 'unitsPerBulk') {
            const units = parseFloat(value) || 1;
            const bulkCostVal = parseFloat(formData.bulkCost) || 0;
            const bulkCostBsVal = parseFloat(formData.bulkCostBs) || 0;
            
            const costVal = units > 0 ? precisionRound(bulkCostVal / units, 6) : 0;
            const costBsVal = units > 0 ? precisionRound(bulkCostBsVal / units, 6) : 0;
            
            const currentPrice = parseFloat(formData.price) || 0;
            let marginVal = formData.margin;
            let priceVal = formData.price;

            if (currentPrice > 0 && formData.margin === '') {
                marginVal = costVal > 0 ? (((currentPrice - costVal) / costVal) * 100).toFixed(2) : '';
            } else if (formData.margin !== '') {
                const mVal = parseFloat(formData.margin) || 0;
                priceVal = costVal > 0 ? precisionRound(costVal * (1 + mVal / 100), 6).toString() : formData.price;
            }

            const bsPriceVal = priceVal ? precisionRound(parseFloat(priceVal) * rate, 6).toString() : '';
            
            let bulkPriceVal = formData.bulkPrice;
            let bulkPriceBsVal = formData.bulkPriceBs;
            if (priceVal && units > 1 && (!formData.bulkPrice || parseFloat(formData.bulkPrice) === 0)) {
                bulkPriceVal = precisionRound(parseFloat(priceVal) * units, 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            }

            setFormData(prev => ({ 
                ...prev, 
                unitsPerBulk: value, 
                cost: costVal.toString(), 
                costBs: costBsVal.toString(),
                price: priceVal,
                priceBs: bsPriceVal,
                bulkPrice: bulkPriceVal,
                bulkPriceBs: bulkPriceBsVal,
                margin: marginVal
            }));
        } else if (name === 'margin') {
            const marginVal = parseFloat(value) || 0;
            const costVal = parseFloat(formData.cost) || 0;
            const priceVal = costVal > 0 ? precisionRound(costVal * (1 + marginVal / 100), 6).toString() : formData.price;
            const bsPriceVal = priceVal ? precisionRound(parseFloat(priceVal) * rate, 6).toString() : '';
            
            const units = parseFloat(formData.unitsPerBulk) || 1;
            const bulkCostVal = parseFloat(formData.bulkCost) || 0;
            let bulkPriceVal = formData.bulkPrice;
            let bulkPriceBsVal = formData.bulkPriceBs;
            if (bulkCostVal > 0 && marginVal > 0) {
                bulkPriceVal = precisionRound(bulkCostVal * (1 + marginVal / 100), 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            } else if (priceVal && units > 1) {
                bulkPriceVal = precisionRound(parseFloat(priceVal) * units, 2).toString();
                bulkPriceBsVal = rate > 0 ? precisionRound(parseFloat(bulkPriceVal) * rate, 2).toString() : '';
            }

            setFormData(prev => ({ 
                ...prev, 
                margin: value, 
                price: priceVal, 
                priceBs: bsPriceVal,
                bulkPrice: bulkPriceVal,
                bulkPriceBs: bulkPriceBsVal,
                presentations: syncPresentations(prev.presentations, prev.price, priceVal, undefined, undefined)
            }));
        } else if (name === 'bulkPrice') {
            const bsVal = value ? precisionRound(parseFloat(value) * rate, 6).toString() : '';
            setFormData(prev => ({ ...prev, bulkPrice: value, bulkPriceBs: bsVal }));
        } else if (name === 'bulkPriceBs') {
            const usdVal = value ? precisionRound((parseFloat(value) || 0) / rate, 6).toString() : '';
            setFormData(prev => ({ ...prev, bulkPriceBs: value, bulkPrice: usdVal }));
        } else if (name === 'unitsPerMidBulk') {
            const midUnits = parseFloat(value) || 0;
            const costVal = parseFloat(formData.cost) || 0;
            const midCostVal = midUnits > 0 ? precisionRound(costVal * midUnits, 6).toString() : '';
            const midCostBsVal = midCostVal && rate > 0 ? precisionRound(parseFloat(midCostVal) * rate, 6).toString() : '';
            
            let midPriceVal = formData.midBulkPrice;
            let midPriceBsVal = formData.midBulkPriceBs;
            const priceVal = parseFloat(formData.price) || 0;
            if (priceVal > 0 && midUnits > 1 && (!formData.midBulkPrice || parseFloat(formData.midBulkPrice) === 0)) {
                midPriceVal = precisionRound(priceVal * midUnits, 2).toString();
                midPriceBsVal = rate > 0 ? precisionRound(parseFloat(midPriceVal) * rate, 2).toString() : '';
            }

            setFormData(prev => ({ 
                ...prev, 
                unitsPerMidBulk: value, 
                midBulkCost: midCostVal, 
                midBulkCostBs: midCostBsVal, 
                midBulkPrice: midPriceVal, 
                midBulkPriceBs: midPriceBsVal 
            }));
        } else if (name === 'midBulkPrice') {
            const bsVal = value ? precisionRound(parseFloat(value) * rate, 6).toString() : '';
            setFormData(prev => ({ ...prev, midBulkPrice: value, midBulkPriceBs: bsVal }));
        } else if (name === 'midBulkPriceBs') {
            const usdVal = value ? precisionRound((parseFloat(value) || 0) / rate, 6).toString() : '';
            setFormData(prev => ({ ...prev, midBulkPriceBs: value, midBulkPrice: usdVal }));
        } else if (name === 'midBulkCost') {
            const bsVal = value ? precisionRound(parseFloat(value) * rate, 6).toString() : '';
            setFormData(prev => ({ ...prev, midBulkCost: value, midBulkCostBs: bsVal }));
        } else if (name === 'midBulkCostBs') {
            const usdVal = value ? precisionRound((parseFloat(value) || 0) / rate, 6).toString() : '';
            setFormData(prev => ({ ...prev, midBulkCostBs: value, midBulkCost: usdVal }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleSuggestBulkPrice = (discountPercent = 0) => {
        const rate = exchangeRate || 1;
        const unitPrice = parseFloat(formData.price) || 0;
        const units = parseFloat(formData.unitsPerBulk) || 1;
        if (unitPrice <= 0) {
            toast.error('Ingresa primero el precio al detal');
            return;
        }
        const baseBulk = unitPrice * units;
        const discounted = baseBulk * (1 - (discountPercent / 100));
        const finalBulkUsd = precisionRound(discounted, 2).toString();
        const finalBulkBs = rate > 0 ? precisionRound(discounted * rate, 2).toString() : '';
        setFormData(prev => ({
            ...prev,
            bulkPrice: finalBulkUsd,
            bulkPriceBs: finalBulkBs
        }));
        toast.success(`Precio sugerido para ${formData.bulkUnitName}: $${finalBulkUsd}`);
    };

    const generateBulkBarcode = () => {
        const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
        const code = `98${randomDigits}`;
        setFormData(prev => ({ ...prev, bulkBarcode: code }));
    };

    const handleSuggestMidBulkPrice = (discountPercent = 0) => {
        const rate = exchangeRate || 1;
        const unitPrice = parseFloat(formData.price) || 0;
        const units = parseFloat(formData.unitsPerMidBulk) || 0;
        if (unitPrice <= 0) {
            toast.error('Ingresa primero el precio al detal');
            return;
        }
        if (units <= 0) {
            toast.error('Ingresa primero las unidades de la media presentación');
            return;
        }
        const baseMid = unitPrice * units;
        const discounted = baseMid * (1 - (discountPercent / 100));
        const finalMidUsd = precisionRound(discounted, 2).toString();
        const finalMidBs = rate > 0 ? precisionRound(discounted * rate, 2).toString() : '';
        setFormData(prev => ({
            ...prev,
            midBulkPrice: finalMidUsd,
            midBulkPriceBs: finalMidBs
        }));
        toast.success(`Precio sugerido para ${formData.midBulkUnitName || 'Media Presentación'}: $${finalMidUsd}`);
    };

    const generateMidBulkBarcode = () => {
        const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
        const code = `97${randomDigits}`;
        setFormData(prev => ({ ...prev, midBulkBarcode: code }));
    };

    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setLocalImageFile(file);
        setFormData(prev => ({ ...prev, imageUrl: '' }));

        try {
            setLoading(true);
            toast.loading('Estandarizando tamaño de imagen a 1:1...', { id: 'img-norm' });
            
            // Normalizar a 500x500 px cuadrado perfecto con fondo blanco limpio de estudio
            const base64 = await normalizeProductImage(file, { size: 500, mode: 'contain', quality: 0.88 });
            toast.dismiss('img-norm');

            let imgUri = '';
            try {
                const res = await api.post('/products/upload-image', {
                    base64,
                    productId: product ? product.id : 'new'
                }, { timeout: 8000 });
                imgUri = res.data.imageUri;
                toast.success('¡Imagen estandarizada y guardada con éxito!');
            } catch (uploadErr) {
                console.warn('Could not upload image online, preserving base64 offline:', uploadErr);
                imgUri = base64;
                toast.success('Imagen optimizada localmente (Modo Offline) ⚡');
            }
            setFormData(prev => ({ ...prev, imageUrl: imgUri }));
        } catch (err) {
            toast.dismiss('img-norm');
            console.error('Error uploading/normalizing image:', err);
            const errorMsg = err.response?.data?.error || err.message || 'Error desconocido';
            toast.error('Error al procesar la imagen: ' + errorMsg);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        const rate = exchangeRate || 1;
        const bulkPriceNum = parseFloat(formData.bulkPrice) || 0;
        const bulkPriceBsNum = parseFloat(formData.bulkPriceBs) || (bulkPriceNum > 0 && rate > 0 ? precisionRound(bulkPriceNum * rate, 2) : 0);

        const midBulkPriceNum = parseFloat(formData.midBulkPrice) || 0;
        const midBulkPriceBsNum = parseFloat(formData.midBulkPriceBs) || (midBulkPriceNum > 0 && rate > 0 ? precisionRound(midBulkPriceNum * rate, 2) : 0);

        const priceNum = parseFloat(formData.price) || 0;
        const priceBsNum = parseFloat(formData.priceBs) || (priceNum > 0 && rate > 0 ? precisionRound(priceNum * rate, 2) : 0);

        const payload = {
            ...formData,
            id: activeVariantId || currentEditingProduct?.id || product?.id,
            supplierId: formData.supplierId || null,
            imageUri: formData.imageUrl,
            price: priceNum,
            priceBs: priceBsNum,
            cost: parseFloat(formData.cost) || 0,
            bulkCost: parseFloat(formData.bulkCost) || 0,
            bulkPrice: bulkPriceNum,
            bulkPriceBs: bulkPriceBsNum,
            bulkBarcode: formData.bulkBarcode ? formData.bulkBarcode.trim() : null,
            midBulkCost: parseFloat(formData.midBulkCost) || 0,
            midBulkPrice: midBulkPriceNum,
            midBulkPriceBs: midBulkPriceBsNum,
            midBulkBarcode: formData.midBulkBarcode ? formData.midBulkBarcode.trim() : null,
            unitsPerMidBulk: parseFloat(formData.unitsPerMidBulk) || 0,
            midBulkUnitName: formData.midBulkUnitName || 'Media Presentación',
            margin: parseFloat(formData.margin) || 0,
            stockQuantity: parseFloat(formData.stockQuantity) || 0,
            stockUnits: formData.stockUnits !== '' && formData.stockUnits !== null && formData.stockUnits !== undefined ? (parseFloat(formData.stockUnits) || 0) : null,
            minStock: parseFloat(formData.minStock) || 0,
            unitsPerBulk: parseFloat(formData.unitsPerBulk) || 1,
            batchNumber: formData.batchNumber || null,
            expirationDate: formData.expirationDate || null,
            es_controlado: !!formData.es_controlado,
            principio_activo: formData.principio_activo || null
        };

        delete payload.costBs;
        delete payload.bulkCostBs;
        delete payload.midBulkCostBs;
        delete payload.imageUrl;

        const targetRefProd = currentEditingProduct || product;

        // Verificar si se modificó precio o stock, o si un cajero requiere autorización de supervisor
        if (targetRefProd) {
            const oldPrice = parseFloat(targetRefProd?.price || 0);
            const oldBulkPrice = parseFloat(targetRefProd?.bulkPrice || 0);
            const oldMidBulkPrice = parseFloat(targetRefProd?.midBulkPrice || 0);
            const isPriceChanged = Math.abs(oldPrice - priceNum) > 0.0001 ||
                                  Math.abs(oldBulkPrice - bulkPriceNum) > 0.0001 ||
                                  Math.abs(oldMidBulkPrice - midBulkPriceNum) > 0.0001;

            const oldStock = parseFloat(targetRefProd?.stockQuantity ?? targetRefProd?.stock ?? 0);
            const newStock = parseFloat(payload.stockQuantity || 0);
            const isStockChanged = Math.abs(oldStock - newStock) > 0.0001;

            const needsPriceAuth = isPriceChanged && !canDirectlyModifyPrices;
            const needsStockAuth = isStockChanged && !canDirectlyAdjustStock;
            const needsGeneralAuth = !canDirectlyCreateEdit;

            if (needsPriceAuth || needsStockAuth || needsGeneralAuth) {
                let action = 'AUTORIZACIÓN: MODIFICAR PRODUCTO';
                if (needsPriceAuth && needsStockAuth) {
                    action = `AUTORIZACIÓN: MODIFICAR PRECIO ($${priceNum}) Y STOCK (${newStock})`;
                } else if (needsPriceAuth) {
                    action = `AUTORIZACIÓN: MODIFICAR PRECIO ($${oldPrice} → $${priceNum})`;
                } else if (needsStockAuth) {
                    action = `AUTORIZACIÓN: MODIFICAR STOCK (${oldStock} → ${newStock})`;
                }
                setSupervisorPinAction(action);
                setPendingPayload(payload);
                setIsSupervisorPinOpen(true);
                return;
            }
        } else {
            // Creación de nuevo producto
            if (!canDirectlyCreateEdit) {
                setSupervisorPinAction('AUTORIZACIÓN: CREACIÓN DE PRODUCTO');
                setPendingPayload(payload);
                setIsSupervisorPinOpen(true);
                return;
            }
        }

        // Actualizar en caliente la variante en la lista de familia si existe
        if (familyVariants.length > 0) {
            setFamilyVariants(prev => prev.map(v => v.id === payload.id ? { ...v, price: payload.price, priceBs: payload.priceBs } : v));
        }

        onSave(payload);
    };

    const handleSupervisorApproved = (approvalId) => {
        setIsSupervisorPinOpen(false);
        if (pendingPayload) {
            const authorizedPayload = {
                ...pendingPayload,
                supervisorApprovalId: approvalId
            };
            setPendingPayload(null);
            onSave(authorizedPayload);
        }
    };

    const generateInternalBarcode = () => {
        const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
        const code = `99${randomDigits}`;
        setFormData(prev => ({ ...prev, barcode: code }));
    };

    const handleGenerateBarcodeIA = async () => {
        if (!formData.name) {
            toast.error('Indique el nombre del producto para buscar su código');
            return;
        }

        try {
            setIsGeneratingBarcode(true);
            toast.loading('Buscando código de barras oficial...', { id: 'barcode-gen' });
            
            // Si el producto ya existe en DB, usamos su ID. Si es nuevo, usamos un endpoint temporal o pasamos el nombre.
            // Para simplificar, si no hay producto, podríamos necesitar un endpoint que busque por nombre.
            // Pero el endpoint actual recibe :id. Así que asumiremos que el producto debe existir o implementamos uno por nombre.
            
            if (!product?.id) {
                toast.error('Guarde el producto primero o use un producto existente para esta función.', { id: 'barcode-gen' });
                return;
            }

            const { data } = await api.post(`/products/${product.id}/generate-barcode`);
            
            if (data.barcode) {
                setFormData(prev => ({ ...prev, barcode: data.barcode }));
                toast.success('¡Código de barras encontrado!', { id: 'barcode-gen' });
            } else {
                toast.error('No se encontró un código claro.', { id: 'barcode-gen' });
            }
        } catch (error) {
            console.error('Error generating barcode IA:', error);
            const msg = error.response?.data?.error || 'Error en la búsqueda';
            toast.error(msg, { id: 'barcode-gen' });
        } finally {
            setIsGeneratingBarcode(false);
        }
    };

    const handleCreateSupplier = async (supplierData) => {
        try {
            const res = await api.post('/suppliers', supplierData);
            const created = res.data;
            if (created && created.id) {
                setSuppliers(prev => {
                    const exists = prev.some(s => s.id === created.id);
                    return exists ? prev : [...prev, created];
                });
                setFormData(prev => ({ ...prev, supplierId: created.id }));
                toast.success(`Proveedor "${created.name}" registrado y asignado exitosamente`);
                return created;
            }
        } catch (err) {
            console.error('Error al crear proveedor:', err);
            const errMsg = err.response?.data?.error || err.message || 'Error al registrar el proveedor';
            toast.error(errMsg);
            throw err;
        }
    };

    const handleGenerateImageIA = async (e) => {
        if (e) e.stopPropagation();
        const searchName = (formData.name || '').trim();
        if (!searchName) {
            toast.error('Por favor, ingresa el nombre del producto primero para buscar su imagen.', { id: 'image-gen' });
            return;
        }

        try {
            setIsGeneratingImage(true);
            toast.loading('Buscando imágenes del producto...', { id: 'image-gen' });
            
            const prodId = product?.id ? product.id : 'new';
            const { data } = await api.post(`/products/${prodId}/search-images-ia`, {
                name: searchName,
                category: formData.category
            }, { timeout: 25000 });
            
            if (data.images && data.images.length > 0) {
                setIaImageCandidates(data.images);
                setIsSelectingImage(true);
                toast.success(`Se encontraron ${data.images.length} imágenes`, { id: 'image-gen' });
            } else {
                toast.error('No se encontraron imágenes en el catálogo.', { id: 'image-gen' });
            }
        } catch (error) {
            console.error('Error searching image:', error);
            const msg = error.response?.data?.error || 'Error al buscar imágenes';
            toast.error(msg, { id: 'image-gen' });
        } finally {
            setIsGeneratingImage(false);
        }
    };

    const handleSelectCandidate = async (imageUrl) => {
        try {
            setIsDownloadingImage(true);
            toast.loading('Descargando y asignando imagen...', { id: 'image-select' });

            const prodId = product?.id ? product.id : 'new';
            const { data } = await api.post(`/products/${prodId}/select-image-ia`, { imageUrl }, { timeout: 25000 });
            
            const newImage = data.imageUri || data.imageUrl;
            if (newImage) {
                setFormData(prev => ({ ...prev, imageUrl: newImage }));
                setLocalImageFile(null);
                setIsSelectingImage(false);
                setIaImageCandidates([]);
                toast.success('¡Imagen asignada con éxito!', { id: 'image-select' });
            }
        } catch (error) {
            console.error('Error downloading image IA:', error);
            const msg = error.response?.data?.error || 'Error al descargar la imagen. Intenta con otra.';
            toast.error(msg, { id: 'image-select' });
        } finally {
            setIsDownloadingImage(false);
        }
    };

    const showBsInputs = !isDollarCountry && (
        (currencyMode === 'BOTH' || currencyMode === 'VES') || 
        (Number(exchangeRate) > 1) || 
        isVenezuela
    );

    return (
        <>
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth={isMaximized ? 'w-[99vw] max-w-[99vw]' : 'w-[96vw] max-w-7xl 2xl:max-w-[1550px]'}
            className={`overflow-hidden flex flex-col transition-all duration-300 pb-safe shadow-2xl ${
                isMaximized 
                    ? 'h-[98dvh] max-h-[98dvh] !rounded-xl' 
                    : 'max-h-[94dvh] h-auto !rounded-2xl'
            }`}
            backdropStyle="bg-slate-900/60 dark:bg-slate-950/85 backdrop-blur-md"
        >
                        {/* Header Limpio Square POS */}
                        <div className="px-4 py-3 sm:px-6 sm:py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-10">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl shrink-0">
                                    <Package size={20} />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight truncate">
                                        {product ? 'Editar producto' : 'Nuevo producto'}
                                    </h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 hidden xs:block">
                                        Configuración comercial, existencias y precios
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                <button
                                    type="button"
                                    onClick={toggleMaximize}
                                    className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-xl transition-all cursor-pointer"
                                    title={isMaximized ? "Restaurar tamaño normal" : "Maximizar a pantalla completa"}
                                    aria-label={isMaximized ? "Restaurar tamaño normal" : "Maximizar a pantalla completa"}
                                >
                                    {isMaximized ? (
                                        <Minimize2 size={18} />
                                    ) : (
                                        <Maximize2 size={18} />
                                    )}
                                </button>
                                <button
                                    onClick={onClose}
                                    className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-all active:scale-90 cursor-pointer"
                                    title="Cerrar ventana (Esc)"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Barra Superior de Presentaciones de la Familia (50g, 100g, 200g, etc.) */}
                        {familyVariants.length > 1 && (
                            <div className="px-4 py-2 sm:px-6 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-2">
                                    <Layers size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                                        Editar Presentación:
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {familyVariants.map((v) => {
                                        const isCurrent = v.id === activeVariantId;
                                        const vPriceFormatted = formatMoney(v.price, null, { rate: exchangeRate, currencyMode });
                                        return (
                                            <button
                                                key={v.id}
                                                type="button"
                                                onClick={() => handleSwitchVariant(v)}
                                                className={`px-3 py-1 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 shadow-2xs active:scale-95 ${
                                                    isCurrent
                                                        ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/40 scale-105'
                                                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                                                }`}
                                                title={`Cambiar a ${v.name} (${vPriceFormatted})`}
                                            >
                                                <span>{v.presentationLabel || v.name}</span>
                                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                                                    isCurrent ? 'bg-emerald-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                                }`}>
                                                    {vPriceFormatted}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-3 sm:p-5 custom-scrollbar bg-slate-50/20 dark:bg-transparent">
                            <form id="product-form" onSubmit={handleSubmit} noValidate autoComplete="off" className="flex flex-col md:flex-row gap-3 sm:gap-5">
                                {/* Left Column: Image */}
                                <ProductImageUpload
                                    imageSrc={imageSrc}
                                    imageScale={imageScale}
                                    setImageScale={setImageScale}
                                    loading={loading}
                                    isGeneratingImage={isGeneratingImage}
                                    fileInputRef={fileInputRef}
                                    handleImageChange={handleImageChange}
                                    handleGenerateImageIA={handleGenerateImageIA}
                                    formData={formData}
                                    setFormData={setFormData}
                                    setLocalImageFile={setLocalImageFile}
                                />

                                {/* Right Column: Form Data */}
                                <div className="flex-1 flex flex-col gap-3 sm:gap-4 min-w-0">
                                    {/* Nombre del Producto */}
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                                            Nombre del producto <span className="text-blue-600">*</span>
                                        </label>
                                        <input
                                            required
                                            type="text"
                                            name="name"
                                            value={formData.name}
                                            onChange={handleChange}
                                            autoComplete="off"
                                            autoCorrect="off"
                                            autoCapitalize="off"
                                            spellCheck={false}
                                            data-lpignore="true"
                                            data-form-type="other"
                                            className="w-full h-11 px-3.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:border-blue-600 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 outline-none transition-all placeholder:text-slate-400"
                                            placeholder="Ej: Harina PAN 1kg, Arroz Mary 1kg..."
                                            disabled={loading}
                                        />
                                    </div>

                                    {/* Two Columns Grid: Left (General Info & Stock: 5 cols) / Right (Pricing & Presentations: 7 cols) */}
                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5 items-start">
                                        {/* COLUMNA IZQUIERDA: INFORMACIÓN BÁSICA & CONTROL DE INVENTARIO */}
                                        <div className="lg:col-span-5 flex flex-col gap-3 sm:gap-4 min-w-0">
                                            <ProductBasicInfo
                                                formData={formData}
                                                handleChange={handleChange}
                                                setFormData={setFormData}
                                                loading={loading}
                                                isAddingCategory={isAddingCategory}
                                                setIsAddingCategory={setIsAddingCategory}
                                                newCategoryInput={newCategoryInput}
                                                setNewCategoryInput={setNewCategoryInput}
                                                handleConfirmNewCategory={handleConfirmNewCategory}
                                                categories={categories}
                                                suppliers={suppliers}
                                                onAddSupplier={handleCreateSupplier}
                                                product={product}
                                                setScannerMode={setScannerMode}
                                                setIsBarcodeScannerOpen={setIsBarcodeScannerOpen}
                                                generateInternalBarcode={generateInternalBarcode}
                                                isGeneratingBarcode={isGeneratingBarcode}
                                                handleGenerateBarcodeIA={handleGenerateBarcodeIA}
                                                setIsLabelModalOpen={setIsLabelModalOpen}
                                            />

                                            <ProductInventoryInfo
                                                formData={formData}
                                                setFormData={setFormData}
                                                handleChange={handleChange}
                                                loading={loading}
                                                exchangeRate={exchangeRate}
                                                setScannerMode={setScannerMode}
                                                setIsBarcodeScannerOpen={setIsBarcodeScannerOpen}
                                            />
                                        </div>

                                        {/* COLUMNA DERECHA: PRESENTACIONES, PRECIOS Y COSTOS (MÁS ANCHA Y CÓMODA) */}
                                        <div className="lg:col-span-7 flex flex-col gap-3 sm:gap-4 min-w-0">
                                            <ProductPricingDetail
                                                formData={formData}
                                                setFormData={setFormData}
                                                handleChange={handleChange}
                                                currencyMode={currencyMode}
                                                showBsInputs={showBsInputs}
                                                exchangeRate={exchangeRate}
                                                loading={loading}
                                                handleSuggestMidBulkPrice={handleSuggestMidBulkPrice}
                                                generateMidBulkBarcode={generateMidBulkBarcode}
                                                handleSuggestBulkPrice={handleSuggestBulkPrice}
                                                generateBulkBarcode={generateBulkBarcode}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>

                        {/* Footer Ergonómico Square POS */}
                        <div className="px-4 py-3 sm:px-6 sm:py-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row justify-between items-center gap-2.5 sticky bottom-0 pb-safe">
                            <div className="w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!formData.name && !formData.barcode) {
                                            toast.error('Ingresa al menos el nombre o código del producto');
                                            return;
                                        }
                                        setIsLabelModalOpen(true);
                                    }}
                                    className="w-full sm:w-auto h-10 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
                                    title="Generar e Imprimir Etiqueta de este producto"
                                >
                                    <Printer size={15} />
                                    <span>Imprimir etiqueta</span>
                                </button>
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row items-center gap-2 sm:gap-2.5 w-full sm:w-auto justify-end">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-full sm:w-auto h-10 px-6 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-xs transition-all cursor-pointer active:scale-95"
                                    disabled={loading}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    form="product-form"
                                    disabled={loading || processing}
                                    className={`w-full sm:w-auto h-10 px-8 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${(loading || processing) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {(loading || processing) ? (
                                        <>
                                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Guardando...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Save size={15} />
                                            <span>Guardar producto</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
        </BaseModal>

            {/* Modal de Selección de Imagen del Catálogo */}
            <BaseModal
                isOpen={isSelectingImage}
                onClose={() => {
                    setIsSelectingImage(false);
                    setIaImageCandidates([]);
                }}
                maxWidth="max-w-4xl"
                className="overflow-hidden flex flex-col !rounded-xl shadow-xl"
                backdropStyle="bg-slate-900/80 backdrop-blur-xs z-[60]"
            >
                <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900/50 backdrop-blur-md z-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-2xl shadow-inner">
                            <Search size={24} />
                        </div>
                        <div className="flex flex-col">
                            <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tighter uppercase leading-none">
                                Selecciona la imagen del producto
                            </h2>
                            <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mt-1">Imágenes sugeridas del catálogo</p>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            setIsSelectingImage(false);
                            setIaImageCandidates([]);
                        }}
                        className="p-3 bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-2xl transition-all active:scale-90"
                        disabled={isDownloadingImage}
                    >
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 bg-slate-50/50 dark:bg-transparent overflow-y-auto max-h-[60vh] custom-scrollbar">
                    {iaImageCandidates.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {iaImageCandidates.map((url, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => handleSelectCandidate(url)}
                                    disabled={isDownloadingImage}
                                    className="relative group aspect-square bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:ring-4 hover:ring-emerald-500/50 transition-all focus:outline-none"
                                >
                                    <img 
                                        src={url} 
                                        alt={`Opción ${index + 1}`} 
                                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500 bg-white"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.parentElement.classList.add('hidden');
                                        }}
                                    />
                                    <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/20 transition-all flex flex-col items-center justify-center opacity-0 group-hover:opacity-100">
                                        <div className="bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest px-4 py-2 rounded-xl shadow-lg flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all">
                                            {isDownloadingImage ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                            Usar esta
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                            <Loader2 size={48} className="animate-spin mb-4 text-emerald-500" />
                            <p className="font-bold">Procesando imágenes...</p>
                        </div>
                    )}
                </div>
            </BaseModal>

            {/* Modal de Escaneo con Cámara Móvil */}
            <MobileBarcodeScannerModal
                isOpen={isBarcodeScannerOpen}
                initialMode={scannerMode}
                onClose={() => setIsBarcodeScannerOpen(false)}
                onBarcodeScanned={handleBarcodeScanned}
                onOcrDetected={({ batchNumber, expirationDate }) => {
                    setFormData(prev => ({
                        ...prev,
                        batchNumber: batchNumber || prev.batchNumber,
                        expirationDate: expirationDate || prev.expirationDate
                    }));
                    toast.success(`✓ Lote: ${batchNumber || '-'} | Vto: ${expirationDate || '-'}`);
                }}
            />

            {/* Modal para Generar e Imprimir Etiqueta del Producto */}
            <LabelModal
                isOpen={isLabelModalOpen}
                onClose={() => setIsLabelModalOpen(false)}
                products={labelProductList}
                exchangeRate={exchangeRate || 1}
                zIndex="z-[100200]"
            />

            {/* Modal para Autorización de Supervisor (PIN) */}
            {isSupervisorPinOpen && (
                <SupervisorPinModal
                    isOpen={isSupervisorPinOpen}
                    onClose={() => {
                        setIsSupervisorPinOpen(false);
                        setPendingPayload(null);
                    }}
                    onApprove={handleSupervisorApproved}
                    actionType={supervisorPinAction}
                    referenceId={product?.id || 'NEW_PRODUCT'}
                />
            )}
        </>
    );
}
