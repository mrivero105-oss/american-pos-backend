import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { 
    ShoppingCart,
    ArrowRight,
    CheckCircle2,
    X,
    AlertCircle,
    Activity
} from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import { db } from '../services/db';
import { usePos } from '../hooks/PosContext';
import { useSocket } from '../hooks/SocketContext';
import { lazy, Suspense } from 'react';
import CheckoutModal from '../components/CheckoutModal';
const ReceiptModal = lazy(() => import('../components/ReceiptModal'));
const CustomerModal = lazy(() => import('../components/CustomerModal'));
const HeldSalesModal = lazy(() => import('../components/HeldSalesModal'));
const ProductModal = lazy(() => import('../components/ProductModal'));
import SupervisorPinModal from '../components/SupervisorPinModal';
import { useTheme } from '../hooks/ThemeContext';
import { toast } from 'react-hot-toast';
import { useCartCalculation } from '../hooks/useCartCalculation';
import { useCartManager } from '../hooks/useCartManager';
import { usePosShortcuts } from '../hooks/usePosShortcuts';
import ActionDialog from '../components/ActionDialog';
import ProductGrid from '../components/ProductGrid';
import CartSidebar from '../components/CartSidebar';
import DraftRecoveryBanner from '../components/DraftRecoveryBanner';

import { usePOSData, getProductStock } from '../hooks/usePOSData';
import { usePOSHandlers } from '../hooks/usePOSHandlers';
import { useFuzzySearch } from '../hooks/useFuzzySearch';
import useScanner from '../hooks/useScanner';
import { playScanSound, playErrorSound, playNotificationSound } from '../utils/sounds';

export default function POS() {
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const {
        cart,
        setCart,
        selectedCustomer,
        setSelectedCustomer,
        selectedCustomerInfo,
        discountActive,
        setDiscountActive,
        heldSales,
        setHeldSales,
        clearPosState,
        searchTerm,
        setSearchTerm,
        exchangeRate,
        currencyMode,
        registerId,
        registerDisplayName,
        allowedCategories,
        allowedProducts,
        fetchExchangeRate,
        posViewMode,
        setPosViewMode,
        isHydrating,
        promoEvaluation,
        appliedPromotions,
        totalPromoSavings
    } = usePos();
    const { socket } = useSocket();
    const { layoutStyle, posLayout, viewLayout, setViewLayout, theme } = useTheme();

    const [category, setCategory] = useState('Todas');
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
    const [notification, setNotification] = useState(null);
    const searchInputRef = useRef(null);
    const notificationTimer = useRef(null);
    
    // Modals state
    const [isReceiptOpen, setIsReceiptOpen] = useState(false);
    const [lastSale, setLastSale] = useState(null);
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [selectedQuickProduct, setSelectedQuickProduct] = useState(null);
    const [processingQuickProduct, setProcessingQuickProduct] = useState(false);
    const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
    const [customerToEdit, setCustomerToEdit] = useState(null);
    const [isHeldModalOpen, setIsHeldModalOpen] = useState(false);
    const [activeQuotationId, setActiveQuotationId] = useState(null);
    const [lastAddedId, setLastAddedId] = useState(null);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [actionDialog, setActionDialog] = useState({ isOpen: false, type: '', data: null });
    const localCart = useMemo(() => {
        if (!promoEvaluation?.itemsWithPromotions?.length) return cart;
        return promoEvaluation.itemsWithPromotions;
    }, [cart, promoEvaluation]);
    const setLocalCart = setCart;
    const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
    const [customerSearch, setCustomerSearch] = useState('');
    const [isPinModalOpen, setIsPinModalOpen] = useState(false);
    const [pendingDiscount, setPendingDiscount] = useState(0);

    // Android Back / Esc handler to dismiss mobile cart drawer
    useEffect(() => {
        if (isMobileCartOpen) {
            const handleCartEsc = (e) => {
                if (e.key === 'Escape' || e.key === 'Esc') {
                    const isAnyModalOpen = actionDialog.isOpen || isCheckoutOpen || isReceiptOpen || showNewCustomerModal || isHeldModalOpen;
                    if (!isAnyModalOpen) {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsMobileCartOpen(false);
                    }
                }
            };
            window.addEventListener('keydown', handleCartEsc, false);
            return () => window.removeEventListener('keydown', handleCartEsc, false);
        }
    }, [isMobileCartOpen, actionDialog.isOpen, isCheckoutOpen, isReceiptOpen, showNewCustomerModal, isHeldModalOpen]);

    // Data Hook
    const {
        loading,
        allProducts,
        setAllProducts,
        categories,
        customers,
        businessSettings,
        taxSettings,
        stockIntelligence,
        fetchProducts,
        fetchCustomers
    } = usePOSData(socket, fetchExchangeRate, location, setCart, setSelectedCustomer, setActiveQuotationId);

    const showNotification = useCallback((message, type = 'warning') => {
        setNotification({ message, type });
        if (type === 'error' || type === 'warning') playErrorSound();
        else playNotificationSound();
        
        if (notificationTimer.current) clearTimeout(notificationTimer.current);
        notificationTimer.current = setTimeout(() => setNotification(null), 3000);
    }, []);

    const isAdmin = ['admin', 'superadmin', 'supervisor', 'owner', 'dueño', 'master'].includes((user?.role || '').toLowerCase()) || hasPermission('canManageInventory') || hasPermission('canCreateProducts');
    const activeCustomer = useMemo(() => {
        if (!selectedCustomer && !selectedCustomerInfo) return null;

        // 1. Si selectedCustomer es un objeto completo (ej. viene de preventa o modal)
        if (selectedCustomer && typeof selectedCustomer === 'object') {
            const doc = String(selectedCustomer.idDocument || selectedCustomer.identification || selectedCustomer.doc || '').trim();
            const custName = String(selectedCustomer.name || selectedCustomer.nombre || '').trim().toLowerCase();
            const found = Array.isArray(customers) ? customers.find(c => {
                if (!c) return false;
                if (selectedCustomer.id && String(c.id) === String(selectedCustomer.id)) return true;
                const cDoc = String(c.idDocument || c.identification || '').trim();
                if (doc && cDoc && cDoc.toLowerCase() === doc.toLowerCase()) return true;
                const cName = String(c.name || c.nombre || '').trim().toLowerCase();
                if (custName && cName && cName === custName) return true;
                return false;
            }) : null;
            return found || selectedCustomer;
        }

        // 2. Si selectedCustomer es un ID o texto identificador
        if (selectedCustomer) {
            const target = String(selectedCustomer).trim();
            const targetLower = target.toLowerCase();
            const found = Array.isArray(customers) ? customers.find(c => {
                if (!c) return false;
                if (String(c.id) === target) return true;
                const cDoc = String(c.idDocument || c.identification || '').trim().toLowerCase();
                if (cDoc && cDoc === targetLower) return true;
                const cName = String(c.name || c.nombre || '').trim().toLowerCase();
                if (cName && cName === targetLower) return true;
                return false;
            }) : null;
            if (found) return found;
        }

        // 3. Fallback con selectedCustomerInfo del contexto
        if (selectedCustomerInfo && (selectedCustomerInfo.name || selectedCustomerInfo.idDocument)) {
            const doc = String(selectedCustomerInfo.idDocument || '').trim();
            const custName = String(selectedCustomerInfo.name || '').trim().toLowerCase();
            const found = Array.isArray(customers) ? customers.find(c => {
                if (!c) return false;
                if (selectedCustomerInfo.id && String(c.id) === String(selectedCustomerInfo.id)) return true;
                const cDoc = String(c.idDocument || c.identification || '').trim();
                if (doc && cDoc && cDoc.toLowerCase() === doc.toLowerCase()) return true;
                const cName = String(c.name || c.nombre || '').trim().toLowerCase();
                if (custName && cName && cName === custName) return true;
                return false;
            }) : null;
            return found || selectedCustomerInfo;
        }

        return null;
    }, [customers, selectedCustomer, selectedCustomerInfo]);

    // Deferred Search Term for buttery-smooth non-blocking search
    const deferredSearchTerm = useDeferredValue(searchTerm);

    // 🎯 Helper de Normalización de Texto con eliminación de acentos y tildes
    const normalizeStationText = useCallback((str) => {
        return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    }, []);

    const hasCategoryRestriction = Array.isArray(allowedCategories) && allowedCategories.length > 0;
    const hasProductRestriction = Array.isArray(allowedProducts) && allowedProducts.length > 0;
    const hasStationRestriction = hasCategoryRestriction || hasProductRestriction;

    const normalizedAllowed = useMemo(() => {
        if (!hasCategoryRestriction) return [];
        return allowedCategories.map(c => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase());
    }, [allowedCategories, hasCategoryRestriction]);

    // 🎯 Resiliencia de producto en estación (verifica productos específicos y categorías)
    const isProductAllowedInStation = useCallback((p) => {
        if (!hasStationRestriction) return true;

        // 1. Verificación por lista de productos específicos autorizados (ID o Código de barras)
        if (hasProductRestriction) {
            const matchesProduct = allowedProducts.some(ap => {
                const targetId = typeof ap === 'object' ? String(ap.id) : String(ap);
                const targetBarcode = typeof ap === 'object' ? String(ap.barcode || '') : '';
                if (targetId && String(p?.id) === targetId) return true;
                if (targetBarcode && p?.barcode && String(p.barcode) === targetBarcode) return true;
                return false;
            });
            if (matchesProduct) return true;
        }

        // 2. Verificación por categorías autorizadas (con coincidencia de rubro en el nombre)
        if (hasCategoryRestriction) {
            const pCatNorm = normalizeStationText(p?.category);
            if (normalizedAllowed.includes(pCatNorm)) return true;
            const pNameNorm = normalizeStationText(p?.name || p?.nombre);
            const matchesName = normalizedAllowed.some(allowed => 
                pNameNorm.includes(allowed) && !pCatNorm.includes('golosina') && !pNameNorm.includes('sorpresa')
            );
            if (matchesName) return true;
        }

        return false;
    }, [hasStationRestriction, hasProductRestriction, hasCategoryRestriction, allowedProducts, normalizedAllowed, normalizeStationText]);

    const displayCategories = useMemo(() => {
        if (!hasStationRestriction) return categories;
        if (hasCategoryRestriction) {
            const filtered = categories.filter(c => c !== 'Todas' && normalizedAllowed.includes(normalizeStationText(c)));
            if (filtered.length === 0) {
                return ['Todas', ...allowedCategories];
            }
            return ['Todas', ...filtered];
        }
        if (hasProductRestriction && Array.isArray(allProducts)) {
            const prodCats = new Set();
            allProducts.filter(isProductAllowedInStation).forEach(p => {
                if (p?.category && typeof p.category === 'string') prodCats.add(p.category.trim());
            });
            if (prodCats.size > 0) {
                return ['Todas', ...Array.from(prodCats).sort()];
            }
        }
        return categories;
    }, [categories, hasStationRestriction, hasCategoryRestriction, hasProductRestriction, normalizedAllowed, allowedCategories, allProducts, isProductAllowedInStation, normalizeStationText]);

    // Fuzzy Search Integration off-main-thread con pre-indexado O(1) por categoría para 5.000+ SKUs
    const workerCategory = useMemo(() => {
        if (hasStationRestriction) return '';
        if (!category || category === 'Todas' || category.toLowerCase().includes('sin stock')) return '';
        return category;
    }, [category, hasStationRestriction]);

    const fuzzyProducts = useFuzzySearch(allProducts, deferredSearchTerm, {
        category: workerCategory,
        maxResults: 500
    });
    
    const filteredProducts = useMemo(() => {
        const isNoStockFilter = category && (category === '🚫 Productos sin stock' || category.toLowerCase().includes('sin stock'));

        const list = fuzzyProducts.filter(p => {
            // 🎯 Modo Estación: Si la terminal está restringida, verificar permiso en estación
            if (hasStationRestriction && !isProductAllowedInStation(p)) return false;

            if (isNoStockFilter) {
                const stock = getProductStock(p);
                return stock <= 0;
            }

            const matchesCategory = category === 'Todas' || 
                (p.category && normalizeStationText(p.category) === normalizeStationText(category)) ||
                (hasStationRestriction && isProductAllowedInStation(p));
            return matchesCategory;
        });

        // Si el usuario eligió explícitamente "🚫 Productos sin stock", no reordenar
        if (isNoStockFilter) return list;

        // Regla: Productos con stock primero, productos agotados (stock <= 0) de último
        return [...list].sort((a, b) => {
            const stockA = getProductStock(a);
            const stockB = getProductStock(b);
            const outA = stockA <= 0 ? 1 : 0;
            const outB = stockB <= 0 ? 1 : 0;

            if (outA !== outB) return outA - outB;

            // Si ambos tienen stock o ambos están agotados:
            // Si no hay término de búsqueda activo, ordenar alfabéticamente A-Z
            if (!deferredSearchTerm || !deferredSearchTerm.trim()) {
                const nameA = String(a?.name || a?.nombre || '').trim();
                const nameB = String(b?.name || b?.nombre || '').trim();
                return nameA.localeCompare(nameB, 'es', { sensitivity: 'base', numeric: true });
            }

            // Si hay búsqueda activa, mantener el orden de relevancia del buscador
            return 0;
        });
    }, [fuzzyProducts, category, deferredSearchTerm, hasStationRestriction, isProductAllowedInStation, normalizeStationText]);

    // Handlers Hook
    const {
        processing,
        creatingCustomer,
        handleSaveQuotation,
        handleProcessSale,
        handleHoldSale,
        handleCreateCustomer,
        handleUpdateCustomer,
        handleOpenDrawer,
        handlePrintLast
    } = usePOSHandlers({
        user, localCart, setLocalCart, clearPosState, 
        selectedCustomer, setSelectedCustomer, activeCustomer,
        discountActive, setDiscountActive, heldSales, setHeldSales,
        activeQuotationId, setActiveQuotationId, fetchProducts, 
        fetchCustomers, businessSettings, showNotification, navigate,
        setLastSale, setIsReceiptOpen, setShowNewCustomerModal
    });

    // Hook Desacoplado: Gestor Modular del Carrito de Compras (Fase 3 - Arquitectura Limpia)
    const {
        handleAddToCart,
        updateQuantity,
        toggleCartItemPresentation,
        handleApplyTierSuggestion,
        handleClearCartDirect,
        addToCartOptimistic,
        setQuantityMultiplier,
        localCartRef
    } = useCartManager({
        cart,
        setCart: setLocalCart,
        localCart,
        allProducts,
        stationConfig: {
            hasStationRestriction,
            isProductAllowedInStation,
            hasCategoryRestriction,
            allowedCategories
        },
        uiHelpers: {
            showNotification,
            setActionDialog,
            setLastAddedId,
            setSelectedIndex,
            setIsMobileCartOpen,
            clearPosState
        }
    });

    const handleEditCartWeight = useCallback((cartItem) => {
        if (!cartItem) return;
        const baseProductId = String(cartItem.productId || cartItem.id || '').replace(/__bulk$|__mid$|__pres_.*$|__srv_.*$/, '');
        const originalProduct = allProducts.find(p => String(p.id) === baseProductId) || cartItem;
        const isServiceItem = Boolean(cartItem.isService || originalProduct?.isService || String(cartItem.category || originalProduct?.category || '').trim().toLowerCase() === 'servicios');
        const isCashAdvanceItem = isServiceItem && (cartItem.isCashAdvance || /\bavance\b/i.test(String(cartItem.originalName || originalProduct?.name || cartItem.name || '')));

        if (isServiceItem) {
            setActionDialog({
                isOpen: true,
                type: isCashAdvanceItem ? 'CASH_ADVANCE_PROMPT' : 'SERVICE_PRICE_PROMPT',
                data: {
                    product: { ...originalProduct, ...cartItem, name: cartItem.originalName || originalProduct?.name || cartItem.name },
                    cashBs: cartItem.cashBs,
                    commissionPct: cartItem.commissionPct,
                    priceUsd: cartItem.price,
                    quantity: cartItem.quantity,
                    note: cartItem.serviceNote || '',
                    isEditingCart: true,
                    cartItemId: cartItem.id
                }
            });
            return;
        }

        const currentCartRef = localCartRef?.current || [];
        const alreadyInCartUnits = currentCartRef
            .filter(it => it.id !== cartItem.id && (it.productId === baseProductId || it.id === baseProductId || String(it.id).startsWith(`${baseProductId}__`)) && !it.isCustom)
            .reduce((sum, it) => {
                const mult = Number(it.factorConversion) > 0
                    ? Number(it.factorConversion)
                    : (it.isBulk ? (Number(it.unitsPerBulk) || 1) : (it.isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1));
                return sum + ((Number(it.quantity) || 0) * mult);
            }, 0);

        const isWeighedItem = Boolean(cartItem.isSoldByWeight || originalProduct?.isSoldByWeight || cartItem.stockUnit === 'kg' || originalProduct?.stockUnit === 'kg');
        if (!isWeighedItem) {
            setActionDialog({
                isOpen: true,
                type: 'QUANTITY_PROMPT',
                data: {
                    product: { ...originalProduct, ...cartItem, stockQuantity: originalProduct?.stockQuantity ?? cartItem.stockQuantity, stockUnits: originalProduct?.stockUnits ?? cartItem.stockUnits },
                    defaultValue: cartItem.quantity,
                    isBulkSale: Boolean(cartItem.isBulk),
                    isMidBulkSale: Boolean(cartItem.isMidBulk),
                    presentation: cartItem.presentationId ? {
                        id: cartItem.presentationId,
                        name: cartItem.presentationName,
                        factorConversion: cartItem.factorConversion,
                        price: cartItem.price
                    } : null,
                    isEditingCart: true,
                    cartItemId: cartItem.id,
                    alreadyInCartUnits
                }
            });
            return;
        }

        setActionDialog({
            isOpen: true,
            type: 'WEIGHT_PROMPT',
            data: {
                product: { ...originalProduct, ...cartItem, stockQuantity: originalProduct?.stockQuantity ?? cartItem.stockQuantity, stockUnits: originalProduct?.stockUnits ?? cartItem.stockUnits },
                defaultValue: cartItem.quantity,
                presentation: cartItem.presentationId ? {
                    id: cartItem.presentationId,
                    name: cartItem.presentationName
                } : null,
                isBulkSale: Boolean(cartItem.isBulk || (cartItem.isWeightedWholesale && !cartItem.presentationId)),
                isMidBulkSale: Boolean(cartItem.isMidBulk),
                isWeightedWholesale: Boolean(cartItem.isWeightedWholesale),
                piecesToDeduct: cartItem.piecesToDeduct || 1,
                isEditingCart: true,
                cartItemId: cartItem.id,
                alreadyInCartUnits
            }
        });
    }, [allProducts, localCartRef]);

    const handleActionSubmit = useCallback((result) => {
        const { type, data } = actionDialog;
        setActionDialog({ isOpen: false, type: '', data: null });
        if (type === 'QUANTITY_PROMPT') {
            if (result?.isEditingCart && result?.cartItemId) {
                updateQuantity(result.cartItemId, result.quantity);
            } else {
                handleAddToCart(
                    result.product || data?.product,
                    result.quantity,
                    true,
                    Boolean(result.isBulkSale),
                    Boolean(result.isMidBulkSale),
                    result.presentation || null
                );
            }
            return;
        }
        if (type === 'ADD_MANUAL') {
            const manualName = (result?.name || '').trim() || 'Varios';
            addToCartOptimistic(prev => [{
                id: `manual-${Date.now()}`,
                name: manualName,
                price: result.price,
                category: 'General',
                stockQuantity: '∞',
                quantity: 1,
                taxStatus: 'gravable',
                isCustom: true
            }, ...prev]);
        } else if (type === 'CASH_ADVANCE_PROMPT') {
            const baseProd = result.product || data?.product || {};
            const baseName = baseProd.originalName || baseProd.name || 'Avance BS';
            const formattedCash = Number(result.cashBs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const displayName = `${baseName} (Efectivo Bs ${formattedCash} + ${result.commissionPct}%)`;

            if (result.isEditingCart && result.cartItemId) {
                setLocalCart(prev => prev.map(it => it.id === result.cartItemId ? {
                    ...it,
                    name: displayName,
                    originalName: baseName,
                    price: result.priceUsd,
                    cost: result.costUsd,
                    cashBs: result.cashBs,
                    commissionPct: result.commissionPct,
                    commissionBs: result.commissionBs
                } : it));
            } else {
                addToCartOptimistic(prev => [{
                    id: `${baseProd.id || 'srv'}__srv_${Date.now()}`,
                    productId: baseProd.id,
                    name: displayName,
                    originalName: baseName,
                    price: result.priceUsd,
                    cost: result.costUsd,
                    cashBs: result.cashBs,
                    commissionPct: result.commissionPct,
                    commissionBs: result.commissionBs,
                    category: baseProd.category || 'Servicios',
                    imageUri: baseProd.imageUri || baseProd.imageUrl || null,
                    stockQuantity: '∞',
                    quantity: 1,
                    taxStatus: baseProd.taxStatus || 'exento',
                    isService: true,
                    isCashAdvance: true,
                    isSoldByWeight: false
                }, ...prev]);
                playScanSound();
            }
        } else if (type === 'SERVICE_PRICE_PROMPT') {
            const baseProd = result.product || data?.product || {};
            const baseName = baseProd.originalName || baseProd.name || 'Servicio';
            const displayName = result.note ? `${baseName} (${result.note})` : baseName;

            if (result.isEditingCart && result.cartItemId) {
                setLocalCart(prev => prev.map(it => it.id === result.cartItemId ? {
                    ...it,
                    name: displayName,
                    originalName: baseName,
                    price: result.priceUsd,
                    quantity: result.quantity || 1,
                    serviceNote: result.note || ''
                } : it));
            } else {
                addToCartOptimistic(prev => [{
                    id: `${baseProd.id || 'srv'}__srv_${Date.now()}`,
                    productId: baseProd.id,
                    name: displayName,
                    originalName: baseName,
                    price: result.priceUsd,
                    cost: Number(baseProd.cost) || 0,
                    serviceNote: result.note || '',
                    category: baseProd.category || 'Servicios',
                    imageUri: baseProd.imageUri || baseProd.imageUrl || null,
                    stockQuantity: '∞',
                    quantity: result.quantity || 1,
                    taxStatus: baseProd.taxStatus || 'gravable',
                    isService: true,
                    isSoldByWeight: false
                }, ...prev]);
                playScanSound();
            }
        } else if (type === 'WEIGHT_PROMPT') {
            const baseProd = result.product || data?.product || {};
            const cleanBaseId = String(baseProd.productId || baseProd.id || '').replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
            const catalogProd = allProducts.find(p => String(p.id) === cleanBaseId) || baseProd;
            const baseName = catalogProd.name || baseProd.originalName || baseProd.name;
            const retailKgPrice = Number(catalogProd.price || baseProd.basePrice || baseProd.unitPrice || baseProd.price || 0);
            const editTargetId = data?.isEditingCart ? (data?.cartItemId || data?.product?.id) : null;

            const isServiceItem = Boolean(catalogProd.isService || String(catalogProd.category || '').trim().toLowerCase() === 'servicios');
            const maxStockKg = (catalogProd.stockQuantity !== undefined && catalogProd.stockQuantity !== null && catalogProd.stockQuantity !== '∞')
                ? Number(catalogProd.stockQuantity)
                : null;

            const currentCartItems = localCartRef?.current || [];
            const otherKgInCart = currentCartItems
                .filter(it => (!editTargetId || it.id !== editTargetId) && (it.productId === cleanBaseId || it.id === cleanBaseId || String(it.id).startsWith(`${cleanBaseId}__`)) && !it.isCustom)
                .reduce((sum, it) => {
                    const mult = Number(it.factorConversion) > 0
                        ? Number(it.factorConversion)
                        : (it.isBulk ? (Number(it.unitsPerBulk) || 1) : (it.isMidBulk ? (Number(it.unitsPerMidBulk) || 1) : 1));
                    return sum + ((Number(it.quantity) || 0) * mult);
                }, 0);

            if (!isServiceItem && !catalogProd.allowNegative && maxStockKg !== null && !isNaN(maxStockKg) && (result.weight + otherKgInCart) > maxStockKg + 0.0001) {
                playErrorSound();
                const availKg = Math.max(0, Math.round((maxStockKg - otherKgInCart) * 1000) / 1000);
                showNotification(`Stock insuficiente: disponible ${availKg} ${catalogProd.stockUnit || 'kg'}`, 'warning');
                return;
            }

            if (result.isWholesaleWeight) {
                const wholesaleKgPrice = Number(result.wholesaleUnitPrice) > 0 ? Number(result.wholesaleUnitPrice) : retailKgPrice;
                const pFactor = Number(result.pieceFactor) || 1;
                const exactPieces = Number(result.piecesSold) > 0
                    ? Number(result.piecesSold)
                    : (pFactor > 0 ? Math.round((result.weight / pFactor) * 10) / 10 : 1);
                const pLabel = result.pieceLabel || 'Pieza';
                const displayName = `${baseName} (${exactPieces} ${pLabel}${exactPieces === 1 ? '' : 's'} Mayor)`;
                const targetCartId = `${cleanBaseId}__wpres_${result.presentation?.id || 'bulk'}`;

                if (data?.isEditingCart && (data?.cartItemId || data?.product?.id)) {
                    const editTargetId = data.cartItemId || data.product.id;
                    setLocalCart(prev => prev.map(it => it.id === editTargetId ? {
                        ...it,
                        id: targetCartId,
                        productId: cleanBaseId,
                        name: displayName,
                        originalName: baseName,
                        price: wholesaleKgPrice,
                        unitPrice: retailKgPrice,
                        basePrice: retailKgPrice,
                        quantity: result.weight,
                        piecesToDeduct: exactPieces,
                        factorConversion: 1,
                        isWeightedWholesale: true,
                        presentationId: result.presentation?.id || null,
                        presentationName: pLabel
                    } : it));
                } else {
                    setLocalCart(prev => {
                        const existingIdx = prev.findIndex(it => it.id === targetCartId);
                        if (existingIdx > -1) {
                            const updated = [...prev];
                            const nextW = Math.round((Number(updated[existingIdx].quantity || 0) + result.weight) * 1000) / 1000;
                            const nextPieces = (Number(updated[existingIdx].piecesToDeduct || 0) || 0) + exactPieces;
                            updated[existingIdx] = {
                                ...updated[existingIdx],
                                quantity: nextW,
                                piecesToDeduct: nextPieces,
                                name: `${baseName} (${nextPieces} ${pLabel}${nextPieces === 1 ? '' : 's'} Mayor)`
                            };
                            return updated;
                        }
                        return [...prev, {
                            ...catalogProd,
                            id: targetCartId,
                            productId: cleanBaseId,
                            name: displayName,
                            originalName: baseName,
                            price: wholesaleKgPrice,
                            unitPrice: retailKgPrice,
                            basePrice: retailKgPrice,
                            quantity: result.weight,
                            piecesToDeduct: exactPieces,
                            factorConversion: 1,
                            isWeightedWholesale: true,
                            isSoldByWeight: true,
                            presentationId: result.presentation?.id || null,
                            presentationName: pLabel
                        }];
                    });
                    playScanSound();
                }
            } else if (data?.isEditingCart) {
                const editTargetId = data?.cartItemId || data?.product?.id;
                if (String(editTargetId).includes('__wpres_')) {
                    setLocalCart(prev => prev.map(it => it.id === editTargetId ? {
                        ...it,
                        id: cleanBaseId,
                        productId: cleanBaseId,
                        name: baseName,
                        originalName: baseName,
                        price: retailKgPrice,
                        quantity: result.weight,
                        factorConversion: 1,
                        isWeightedWholesale: false,
                        presentationId: null,
                        presentationName: null
                    } : it));
                } else {
                    updateQuantity(editTargetId, result.weight);
                }
            } else {
                handleAddToCart(catalogProd, result.weight, true);
            }
        } else if (type === 'DISCOUNT_PROMPT') {
            if (result.pct > 5) {
                setPendingDiscount(result.pct);
                setIsPinModalOpen(true);
            } else {
                setDiscountActive(result.pct);
            }
        } else if (type === 'CONFIRM_CLEAR_CART') {
            if (result) {
                clearPosState();
                setLocalCart([]);
                setIsMobileCartOpen(false);
            }
        }
    }, [actionDialog, handleAddToCart, updateQuantity, clearPosState, addToCartOptimistic, setDiscountActive, setLocalCart, allProducts, localCartRef, showNotification]);

    const handleRestoreHeldSale = useCallback((held) => {
        if (!held) return;
        const normalizedItems = Array.isArray(held.items) ? held.items.map(it => {
            if (it && it.product) {
                return {
                    ...it.product,
                    quantity: it.quantity,
                    unitPrice: it.unitPrice || it.product.price || it.product.precio,
                    price: it.product.price || it.product.precio
                };
            }
            return it;
        }) : [];

        setCart(normalizedItems);
        setLocalCart(normalizedItems);

        // Restaurar el cliente asociado a la preventa o venta pausada
        const cust = held.customer || (held.customerName && held.customerName !== 'Consumidor Final' ? {
            id: held.customerId || null,
            name: held.customerName,
            idDocument: held.customerDoc || '',
            doc: held.customerDoc || '',
            identification: held.customerDoc || ''
        } : null);

        if (cust) {
            const doc = cust.idDocument || cust.identification || cust.doc;
            const matched = Array.isArray(customers) ? customers.find(c => 
                (cust.id && String(c.id) === String(cust.id)) ||
                (doc && (c.idDocument === doc || c.identification === doc)) ||
                (cust.name && c.name?.toLowerCase() === cust.name?.toLowerCase() && cust.name !== 'Consumidor Final')
            ) : null;

            if (matched) {
                setSelectedCustomer(matched.id, matched);
            } else {
                setSelectedCustomer(cust.id || cust, cust);
            }
        } else {
            setSelectedCustomer(null);
        }

        setDiscountActive(held.discount || 0);
        setHeldSales(prev => prev.filter(h => h.id !== held.id && (!held.code || String(h.code || '').toUpperCase() !== String(held.code).toUpperCase())));
        setIsHeldModalOpen(false);

        if (held.type === 'remote_preventa' || String(held.code || '').toUpperCase().startsWith('PV-')) {
            api.delete(`/sales/remote-held-sale/${encodeURIComponent(held.id || held.code)}`).catch(() => {});
        }

        const badge = [held.code ? `[${held.code}]` : null, held.table ? `🍽️ ${held.table}` : null].filter(Boolean).join(' • ');
        toast.success(badge ? `📥 Orden ${badge} cargada en caja` : 'Venta reanudada correctamente');
    }, [customers, setCart, setLocalCart, setSelectedCustomer, setDiscountActive, setHeldSales]);

    const handleRemoveHeldSale = useCallback((id) => {
        setHeldSales(prev => {
            const target = prev.find(h => h.id === id);
            if (target && (target.type === 'remote_preventa' || String(target.code || '').toUpperCase().startsWith('PV-'))) {
                api.delete(`/sales/remote-held-sale/${encodeURIComponent(target.id || target.code)}`).catch(() => {});
            }
            return prev.filter(h => h.id !== id);
        });
    }, [setHeldSales]);

    const lastScanRef = useRef({ code: '', time: 0 });

    // PARCHE CRÍTICO: Integración del Hardware Scanner de Alta Velocidad
    const cleanScannerInput = (s) => String(s || '').split('').filter(c => { const code = c.charCodeAt(0); return code >= 32 && code !== 127; }).join('').trim();
    const handleBarcodeScan = useCallback((barcode, scanOptions = {}) => {
        const rawInput = cleanScannerInput(barcode);
        if (!rawInput) return false;

        const now = Date.now();
        if (lastScanRef.current.code === rawInput.toLowerCase() && (now - lastScanRef.current.time) < 180) {
            return true;
        }

        // 📱 INTERCEPTOR DE PREVENTA / COMANDA MÓVIL (Pistola Óptica de Caja o Enter en Buscador: ej. PV-452, PV'452, PV/452)
        const pvMatch = rawInput.match(/^pv[-'/\s_]?(\d{2,6})$/i);
        if (pvMatch) {
            const normalizedPvCode = `PV-${pvMatch[1]}`;
            lastScanRef.current = { code: rawInput.toLowerCase(), time: now };

            const clearPvSearch = () => {
                setSearchTerm('');
                window.dispatchEvent(new CustomEvent('pos-scanner-clear'));
                if (searchInputRef.current) {
                    searchInputRef.current.value = '';
                    searchInputRef.current.focus();
                }
            };

            const localMatch = Array.isArray(heldSales)
                ? heldSales.find(h => String(h.code || '').toUpperCase() === normalizedPvCode)
                : null;

            if (localMatch) {
                playScanSound();
                handleRestoreHeldSale(localMatch);
                clearPvSearch();
                return true;
            }

            api.get('/sales/remote-held-sales', { timeout: 3500 })
                .then(res => {
                    const list = res.data?.sales || [];
                    const remoteMatch = Array.isArray(list)
                        ? list.find(s => String(s.code || '').toUpperCase() === normalizedPvCode)
                        : null;
                    if (remoteMatch) {
                        playScanSound();
                        handleRestoreHeldSale(remoteMatch);
                    } else {
                        playErrorSound();
                        toast.error(`La preventa ${normalizedPvCode} no existe o ya fue procesada`, { id: 'pv-not-found' });
                    }
                    clearPvSearch();
                })
                .catch(() => {
                    playErrorSound();
                    toast.error(`No se encontró la preventa ${normalizedPvCode} en espera`, { id: 'pv-not-found' });
                    clearPvSearch();
                });

            return true;
        }

        let code = rawInput;
        let weight = 1;
        let hasExplicitMultiplier = false;
        let isScaleBarcode = false;

        // Soporte de Multiplicador Directo en Escáner o Búsqueda (ej: 5*750123)
        if (rawInput.includes('*')) {
            const parts = rawInput.split('*');
            if (parts.length === 2 && !isNaN(parts[0]) && Number(parts[0]) > 0 && parts[1].trim()) {
                weight = parseFloat(parts[0]);
                code = parts[1].trim();
                hasExplicitMultiplier = true;
            }
        }

        // Verificar si es un código de barras de balanza / peso variable (formato 20/21/22 + 5 SKU + 5 Peso + Digito control)
        if (/^(20|21|22)\d{11}$/.test(code) && code.length === 13) {
            const weightRaw = code.substring(7, 12);
            code = code.substring(2, 7);
            weight = parseInt(weightRaw, 10) / 1000;
            isScaleBarcode = true;
        }

        const norm = (val) => cleanScannerInput(val).toLowerCase();
        const stripZeros = (val) => (/^\d+$/.test(val) ? (val.replace(/^0+/, '') || '0') : val);
        const targetNorm = norm(code);
        const targetNoZeros = stripZeros(targetNorm);

        const isExactCodeMatch = (candidate) => {
            const c = norm(candidate);
            if (!c) return false;
            if (c === targetNorm) return true;
            if (/^\d+$/.test(c) && /^\d+$/.test(targetNorm) && targetNoZeros.length >= 4 && stripZeros(c) === targetNoZeros) {
                return true;
            }
            return false;
        };

        const isSuffixCodeMatch = (candidate) => {
            if (targetNorm.length < 4) return false;
            const c = norm(candidate);
            if (!c) return false;
            return c.endsWith(targetNorm);
        };

        let matchedPres = null;

        // Fase 1: Búsqueda por coincidencia exacta de código
        let product = allProducts.find(p => {
            if (Array.isArray(p.Presentations)) {
                const foundPres = p.Presentations.find(pres => isExactCodeMatch(pres.barcode));
                if (foundPres) {
                    matchedPres = foundPres;
                    return true;
                }
            }
            if (
                isExactCodeMatch(p.barcode) ||
                isExactCodeMatch(p.codigo_barras) ||
                isExactCodeMatch(p.sku) ||
                isExactCodeMatch(p.bulkBarcode) ||
                isExactCodeMatch(p.midBulkBarcode)
            ) {
                return true;
            }
            if (Array.isArray(p.Variantes)) {
                if (p.Variantes.some(v => isExactCodeMatch(v.sku_variante) || isExactCodeMatch(v.barcode))) {
                    return true;
                }
            }
            return false;
        });

        // Fase 2: Búsqueda por sufijo (solo si no hubo coincidencia exacta y tiene >= 4 caracteres)
        if (!product && targetNorm.length >= 4) {
            product = allProducts.find(p => {
                if (Array.isArray(p.Presentations)) {
                    const foundPres = p.Presentations.find(pres => isSuffixCodeMatch(pres.barcode));
                    if (foundPres) {
                        matchedPres = foundPres;
                        return true;
                    }
                }
                if (
                    isSuffixCodeMatch(p.barcode) ||
                    isSuffixCodeMatch(p.codigo_barras) ||
                    isSuffixCodeMatch(p.sku) ||
                    isSuffixCodeMatch(p.bulkBarcode) ||
                    isSuffixCodeMatch(p.midBulkBarcode)
                ) {
                    return true;
                }
                return false;
            });
        }

        const clearAndFocusSearch = () => {
            setSearchTerm('');
            window.dispatchEvent(new CustomEvent('pos-scanner-clear'));
            if (searchInputRef.current) {
                searchInputRef.current.value = '';
                searchInputRef.current.focus();
            }
        };

        if (product) {
            lastScanRef.current = { code: rawInput.toLowerCase(), time: now };
            if (hasStationRestriction && !isProductAllowedInStation(product)) {
                playErrorSound();
                const stationDesc = hasCategoryRestriction ? allowedCategories.join(', ') : 'productos autorizados para esta estación';
                showNotification(`Código rechazado: Esta caja solo despacha [${stationDesc}]`, 'warning');
                clearAndFocusSearch();
                return true;
            }
            const isBulkScan = Boolean(!matchedPres && (isExactCodeMatch(product.bulkBarcode) || isSuffixCodeMatch(product.bulkBarcode)));
            const isMidBulkScan = Boolean(!matchedPres && !isBulkScan && (isExactCodeMatch(product.midBulkBarcode) || isSuffixCodeMatch(product.midBulkBarcode)));
            const isWeighed = Boolean(product.isSoldByWeight || product.stockUnit === 'kg');
            const skipWeightPrompt = Boolean(isScaleBarcode || hasExplicitMultiplier || !isWeighed);
            playScanSound();
            handleAddToCart(product, weight, skipWeightPrompt, isBulkScan, isMidBulkScan, matchedPres, { fromScanner: true });
            toast.success(`🛒 +${weight} ${matchedPres ? `${product.name} (${matchedPres.name})` : product.name}`, { id: 'pos-scan-ok', duration: 1800 });
            clearAndFocusSearch();
            return true;
        }

        if (scanOptions.silentIfNotFound) {
            return false;
        }

        // Si provino de Enter en el buscador pero el texto es una búsqueda por nombre (contiene espacios o solo letras),
        // devolver false para que el buscador filtre o seleccione por nombre normalmente.
        const looksLikeBarcode = hasExplicitMultiplier || /^\d{3,}$/.test(targetNorm) || (/^[a-z0-9-_]{4,}$/i.test(targetNorm) && /\d/.test(targetNorm));
        if (scanOptions.fromSearchInput && !looksLikeBarcode) {
            return false;
        }

        lastScanRef.current = { code: rawInput.toLowerCase(), time: now };

        // Búsqueda de emergencia en el servidor local si no existe en IndexedDB
        api.get(`/products?search=${encodeURIComponent(code)}`).then(res => {
            const list = res.data?.products || res.data || [];
            const found = Array.isArray(list) ? list.find(p => {
                if (Array.isArray(p.Presentations) && p.Presentations.some(pr => isExactCodeMatch(pr.barcode) || isSuffixCodeMatch(pr.barcode))) return true;
                return (
                    isExactCodeMatch(p.barcode) || isSuffixCodeMatch(p.barcode) ||
                    isExactCodeMatch(p.bulkBarcode) || isSuffixCodeMatch(p.bulkBarcode) ||
                    isExactCodeMatch(p.midBulkBarcode) || isSuffixCodeMatch(p.midBulkBarcode)
                );
            }) : null;
            if (found) {
                if (hasStationRestriction && !isProductAllowedInStation(found)) {
                    playErrorSound();
                    const stationDesc = hasCategoryRestriction ? allowedCategories.join(', ') : 'productos autorizados para esta estación';
                    showNotification(`Código rechazado: Esta caja solo despacha [${stationDesc}]`, 'warning');
                    clearAndFocusSearch();
                    return;
                }
                let serverPres = null;
                if (Array.isArray(found.Presentations)) {
                    serverPres = found.Presentations.find(pres => isExactCodeMatch(pres.barcode) || isSuffixCodeMatch(pres.barcode));
                }
                const isBulkScan = Boolean(!serverPres && (isExactCodeMatch(found.bulkBarcode) || isSuffixCodeMatch(found.bulkBarcode)));
                const isMidBulkScan = Boolean(!serverPres && !isBulkScan && (isExactCodeMatch(found.midBulkBarcode) || isSuffixCodeMatch(found.midBulkBarcode)));
                const isWeighedFound = Boolean(found.isSoldByWeight || found.stockUnit === 'kg');
                const skipWeightPrompt = Boolean(isScaleBarcode || hasExplicitMultiplier || !isWeighedFound);
                playScanSound();
                handleAddToCart(found, weight, skipWeightPrompt, isBulkScan, isMidBulkScan, serverPres, { fromScanner: true });
                toast.success(`🛒 +${weight} ${serverPres ? `${found.name} (${serverPres.name})` : found.name}`, { id: 'pos-scan-ok', duration: 1800 });
                clearAndFocusSearch();
            } else {
                playErrorSound();
                clearAndFocusSearch();
                if (isAdmin) {
                    toast((t) => (
                        <div className="flex items-center gap-3">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-900">Código sin asignar: <span className="font-mono text-rose-600">{code}</span></span>
                                <span className="text-[11px] text-slate-500">Este código aún no está vinculado a ningún producto.</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    toast.dismiss(t.id);
                                    setSelectedQuickProduct({ barcode: code });
                                    setIsProductModalOpen(true);
                                }}
                                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg shrink-0 cursor-pointer"
                            >
                                + Crear Producto
                            </button>
                        </div>
                    ), { id: 'pos-scan-not-found', duration: 6000 });
                } else {
                    toast.error(`Producto no encontrado para el código: ${code}`, { id: 'pos-scan-not-found' });
                }
            }
        }).catch(() => {
            playErrorSound();
            toast.error(`Producto no encontrado para el código: ${code}`, { id: 'pos-scan-not-found' });
            clearAndFocusSearch();
        });

        return true;
    }, [allProducts, handleAddToCart, setSearchTerm, hasStationRestriction, isProductAllowedInStation, hasCategoryRestriction, allowedCategories, showNotification, isAdmin, heldSales, handleRestoreHeldSale]);

    useScanner(handleBarcodeScan, {
        timeout: 150,
        minLength: 3,
        enabled: !isProductModalOpen && !isCheckoutOpen && !showNewCustomerModal
    });

    const handleSearchChange = useCallback((val) => {
        setSearchTerm(val);
        setSelectedIndex(-1);
    }, [setSearchTerm, setSelectedIndex]);

    // (3) Limpiar marcador de último ítem agregado sin robar el foco del buscador/escáner
    useEffect(() => {
        if (lastAddedId && !actionDialog.isOpen) {
            const timer = setTimeout(() => {
                setLastAddedId(null);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [lastAddedId, actionDialog.isOpen]);

    // --- ISAAC AI EVENT LISTENERS ---
    useEffect(() => {
        const handleAIAdd = (e) => {
            const { items } = e.detail;
            if (!items || !Array.isArray(items)) return;

            items.forEach(item => {
                // Fuzzy find product by name
                const searchTerm = item.name.toLowerCase();
                const product = allProducts.find(p => 
                    p.name.toLowerCase().includes(searchTerm) || 
                    searchTerm.includes(p.name.toLowerCase())
                );

                if (product) {
                    handleAddToCart(product, Number(item.qty || 1), true);
                    toast.success(`Añadido: ${product.name} x${item.qty}`, { icon: '🤖' });
                } else {
                    toast.error(`No encontré: ${item.name}`, { icon: '🤖' });
                }
            });
        };

        const handleAIClear = () => {
            clearPosState();
            setLocalCart([]);
            toast.success('Carrito vaciado por comando de voz', { icon: '🤖' });
        };

        window.addEventListener('ai-add-to-cart', handleAIAdd);
        window.addEventListener('ai-clear-cart', handleAIClear);
        return () => {
            window.removeEventListener('ai-add-to-cart', handleAIAdd);
            window.removeEventListener('ai-clear-cart', handleAIClear);
        };
    }, [allProducts, handleAddToCart, clearPosState, setLocalCart]);

    const closeProductModal = useCallback(() => {
        setIsProductModalOpen(false);
        setSelectedQuickProduct(null);
    }, []);

    const handleQuickEdit = useCallback(async (product) => {
        try {
            setProcessingQuickProduct(true);
            let prodData = null;
            try {
                const { data } = await api.get(`/products/${product.id}`, { timeout: 3000 });
                prodData = data;
            } catch (netErr) {
                console.warn('Network error in POS quick edit, loading from IndexedDB:', netErr);
            }
            if (!prodData) {
                try {
                    prodData = await db.getById('products', product.id);
                } catch (caughtErr) { console.warn('[StandardPOSView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }
            }
            if (!prodData) {
                prodData = product;
            } else if (product?.variants || product?._familyVariants) {
                prodData = { ...prodData, _familyVariants: product.variants || product._familyVariants };
            }
            setSelectedQuickProduct(prodData);
            setIsProductModalOpen(true);
        } catch (error) {
            console.error('Error in handleQuickEdit:', error);
            if (product) {
                setSelectedQuickProduct(product);
                setIsProductModalOpen(true);
            } else {
                toast.error('Error al cargar detalles del producto');
            }
        } finally {
            setProcessingQuickProduct(false);
        }
    }, []);

    const handleSaveQuickProduct = async (productData) => {
        try {
            setProcessingQuickProduct(true);
            const targetId = productData?.id || selectedQuickProduct?.id;
            const isCreating = !targetId;
            let savedOnline = false;
            let onlineProduct = null;
            try {
                const res = isCreating
                    ? await api.post('/products', productData, { timeout: 4000 })
                    : await api.put(`/products/${targetId}`, productData, { timeout: 4000 });
                savedOnline = true;
                onlineProduct = res.data?.product || res.data;
                toast.success(isCreating ? 'Producto creado y vinculado al código' : 'Producto actualizado');
            } catch (netErr) {
                if (netErr.response && netErr.response.status >= 400 && netErr.response.status < 500) {
                    const errorMsg = netErr.response?.data?.error || netErr.response?.data?.message || 'Error de validación al guardar producto';
                    toast.error(errorMsg);
                    return;
                }
                console.warn('Online quick product save failed, saving locally:', netErr);
            }

            const finalId = onlineProduct?.id || targetId || `local-${Date.now()}`;
            const updated = { 
                ...selectedQuickProduct, 
                ...productData, 
                ...(onlineProduct || {}), 
                id: finalId,
                updated_at: new Date().toISOString() 
            };

            // 1. Guardar de inmediato en IndexedDB para asegurar persistencia local
            try {
                await db.put('products', updated);
            } catch (dbErr) {
                console.warn('Error saving to IndexedDB:', dbErr);
            }

            // 2. Si falló la red, encolar en syncQueue para sincronización diferida
            if (!savedOnline) {
                try {
                    await db.put('syncQueue', {
                        endpoint: isCreating ? '/products' : `/products/${finalId}`,
                        method: isCreating ? 'POST' : 'PUT',
                        payload: productData,
                        timestamp: Date.now()
                    });
                } catch (caughtErr) { console.warn('[StandardPOSView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
                toast.success('⚡ Producto guardado localmente (Modo Offline)');
            }

            // 3. Actualización Optimista INMEDIATA en el catálogo en memoria (sin esperar petición de red)
            if (setAllProducts) {
                setAllProducts(prev => isCreating
                    ? [updated, ...prev]
                    : prev.map(p => p.id === finalId ? { ...p, ...updated } : p)
                );
            }

            // 4. Disparar evento para componentes observadores
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('pos-data-synced'));
            }

            // 5. Refrescar catálogo completo en segundo plano
            fetchProducts().catch(() => {});
            setIsProductModalOpen(false);
        } catch (_error) { 
            toast.error('Error al actualizar'); 
        } finally { 
            setProcessingQuickProduct(false); 
        }
    };

        // Financial Calculations
    const {
        subtotal,
        totalPromoSavings: calcPromoSavings,
        discountAmount,
        total,
        igtfAmount,
        totalWithIgtf,
        ivaAmount,
        taxableBase,
        exemptBase,
        renderFormatMoney
    } = useCartCalculation(
        localCart, discountActive, exchangeRate, currencyMode,
        taxSettings.ivaRate, taxSettings.igtfRate, taxSettings.igtfEnabled
    );

    const unifiedProductsForKeyboard = filteredProducts;

    // Shortcut Handling
    usePosShortcuts({
        handleClearCart: handleClearCartDirect,
        searchInputRef,
        isCheckoutOpen,
        isReceiptOpen,
        isActionModalOpen: actionDialog.isOpen,
        cartLength: localCart.length,
        localCart,
        filteredProducts: unifiedProductsForKeyboard,
        selectedIndex,
        setSelectedIndex,
        handleAddToCart,
        setSearchTerm,
        setIsCheckoutOpen,
        setActionDialog,
        setCategory,
        categories,
        setShowNewCustomerModal,
        setIsCustomerDropdownOpen,
        handleSaveQuotation,
        handleHoldSale,
        setIsHeldModalOpen,
        handleOpenDrawer,
        setLocalCart,
        setQuantityMultiplier
    });

    // Backup Safety Monitoring
    const canManageBackups = hasPermission('canManageSettings');
    const [lastBackup, setLastBackup] = useState(localStorage.getItem('isaac_pos_last_backup') || localStorage.getItem('american_pos_last_backup'));
    const isBackingUpRef = useRef(false);
    const needsBackup = useMemo(() => {
        if (!canManageBackups) return false;
        if (!lastBackup) return true;
        const last = new Date(lastBackup);
        if (Number.isNaN(last.getTime())) return true;
        const now = new Date();
        return (now - last) > (24 * 60 * 60 * 1000); // 24 hours
    }, [lastBackup, canManageBackups]);

    const handleQuickBackup = async () => {
        if (isBackingUpRef.current) return;
        const toastId = 'quick-backup-toast';
        isBackingUpRef.current = true;
        try {
            toast.loading('Generando respaldo de seguridad...', { id: toastId });
            // El respaldo completo (pg_dump + imágenes + espejo cloud) supera el timeout global de 8s
            const res = await api.post('/backup/generate', {}, { timeout: 600000 });
            if (res.data?.success) {
                const now = new Date().toISOString();
                localStorage.setItem('isaac_pos_last_backup', now);
                setLastBackup(now);
                toast.success('¡Respaldo local guardado con éxito!', { id: toastId });
                playNotificationSound();
            } else {
                toast.error(res.data?.error || 'No se pudo confirmar el respaldo local', { id: toastId });
            }
        } catch (err) {
            const isTimeout = err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout');
            const detail = err.response?.data?.details || err.response?.data?.error;
            const msg = isTimeout
                ? 'El respaldo tardó demasiado en responder; verifique en Configuración > Respaldos'
                : (detail || 'Error al generar respaldo local');
            toast.error(msg, { id: toastId });
        } finally {
            isBackingUpRef.current = false;
        }
    };

    useEffect(() => {
        if (needsBackup && !sessionStorage.getItem('backupToastShown')) {
            sessionStorage.setItem('backupToastShown', 'true');
            const isDark = document.documentElement.classList.contains('dark') || theme === 'dark' || theme === '2025' || theme === 'glass' || theme === 'oled' || theme === 'titanium';
            toast((t) => (
                <div className="flex flex-col gap-2 py-1 select-none min-w-[260px]">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1 rounded-lg bg-amber-500/15 text-amber-500 shrink-0">
                            <AlertCircle size={18} />
                        </div>
                        <span className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">
                            Respaldo Pendiente
                        </span>
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed pl-0.5">
                        Tu última copia de seguridad local es antigua.
                    </span>
                    <div className="flex items-center gap-2 mt-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        <button 
                            onClick={() => { toast.dismiss(t.id); handleQuickBackup(); }}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold tracking-wider uppercase text-[11px] py-2 px-3 rounded-xl transition-all shadow-sm cursor-pointer"
                        >
                            Respaldar
                        </button>
                        <button 
                            onClick={() => toast.dismiss(t.id)}
                            className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-300 font-bold tracking-wider uppercase text-[11px] py-2 px-3 rounded-xl transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                        >
                            Omitir
                        </button>
                    </div>
                </div>
            ), { 
                id: 'backup-pending-toast',
                duration: 15000, 
                position: 'bottom-right',
                style: {
                    background: isDark ? '#1e293b' : '#ffffff',
                    color: isDark ? '#ffffff' : '#0f172a',
                    border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid #e2e8f0',
                    boxShadow: isDark 
                        ? '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)' 
                        : '0 20px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    padding: '12px 14px',
                    borderRadius: '1rem'
                }
            });
        }
    }, [needsBackup, theme]);

    const cartSidebarProps = {
        localCart,
        handleClearCart: handleClearCartDirect,
        onAddToCart: handleAddToCart,
        updateQuantity,
        onTogglePresentation: toggleCartItemPresentation,
        onEditWeight: handleEditCartWeight,
        handleHoldSale,
        setIsCheckoutOpen,
        setIsHeldModalOpen,
        handlePrintLast,
        handleOpenDrawer,
        setActionDialog,
        selectedCustomer,
        setSelectedCustomer,
        activeCustomer,
        customerSearch,
        setCustomerSearch,
        isCustomerDropdownOpen,
        setIsCustomerDropdownOpen,
        filteredCustomers: (Array.isArray(customers) ? customers : []).filter(c => 
            (c.name || '').toLowerCase().includes(customerSearch.toLowerCase()) || 
            c.idDocument?.includes(customerSearch)
        ),
        setShowNewCustomerModal,
        subtotal,
        taxableBase,
        exemptBase,
        ivaAmount,
        ivaRate: taxSettings.ivaRate,
        igtfAmount,
        igtfRate: taxSettings.igtfRate,
        discountActive,
        discountAmount,
        totalPromoSavings: calcPromoSavings || totalPromoSavings || 0,
        appliedPromotions: appliedPromotions || [],
        total,
        totalWithIgtf,
        currencyMode,
        exchangeRate,
        renderFormatMoney,
        processing,
        heldSalesCount: heldSales.length,
        searchInputRef,
        handleSaveQuotation: () => handleSaveQuotation(navigate),
        businessSettings,
        onApplyTierSuggestion: handleApplyTierSuggestion,
        onClose: () => setIsMobileCartOpen(false)
    };

    return (
        <div className="flex flex-col h-full bg-transparent overflow-hidden">
            {isHydrating && !localCart.length && (
                <div className="absolute inset-0 z-[999] bg-white/95 dark:bg-slate-900/95 flex flex-col items-center justify-center gap-3">
                    <Activity className="w-8 h-8 text-primary-600 animate-spin" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cargando catálogo de productos...</span>
                </div>
            )}
            
            <DraftRecoveryBanner />

            <div className={`flex flex-1 min-h-0 overflow-hidden ${posLayout === 'reversed' ? 'flex-row-reverse' : ''}`}>
                <ProductGrid 
                    loading={loading}
                    allProducts={allProducts}
                    filteredProducts={filteredProducts}
                    categories={displayCategories}
                    allowedCategories={allowedCategories}
                    allowedProducts={allowedProducts}
                    category={category}
                    setCategory={setCategory}
                    searchTerm={searchTerm}
                    onSearchChange={handleSearchChange}
                    onBarcodeScan={handleBarcodeScan}
                    handleAddToCart={handleAddToCart}
                    handleQuickEdit={handleQuickEdit}
                    isAdmin={isAdmin}
                    currencyMode={currencyMode}
                    exchangeRate={exchangeRate}
                    selectedIndex={selectedIndex}
                    setSelectedIndex={setSelectedIndex}
                    searchInputRef={searchInputRef}
                    posViewMode={posViewMode}
                    setPosViewMode={setPosViewMode}
                    viewLayout={viewLayout}
                    setViewLayout={setViewLayout}
                    stockIntelligence={stockIntelligence}
                    activeCustomer={activeCustomer}
                    onSelectCustomer={setSelectedCustomer}
                    onOpenNewCustomer={(initialData) => { setCustomerToEdit(initialData || null); setShowNewCustomerModal(true); }}
                    onEditCustomer={(cust) => { setCustomerToEdit(cust); setShowNewCustomerModal(true); }}
                    customers={customers}
                />

                {posLayout !== 'focus' && (
                    <div className={`hidden lg:flex w-[330px] xl:w-[365px] 2xl:w-[400px] bg-slate-50 dark:bg-slate-900 ${
                        posLayout === 'reversed' ? 'border-r border-slate-200 dark:border-slate-800' : 'border-l border-slate-200 dark:border-slate-800'
                    }`}>
                        <CartSidebar {...cartSidebarProps} showCustomerSelector={false} onClose={null} />
                    </div>
                )}
            </div>

            {/* Mobile / Focus Cart Modal Drawer */}
            {isMobileCartOpen && createPortal(
                <div className="fixed inset-0 z-[9999] flex justify-end">
                    {/* Backdrop */}
                    <div 
                        className="fixed inset-0 bg-slate-950/70 transition-opacity"
                        onClick={() => setIsMobileCartOpen(false)}
                    />
                    
                    {/* Drawer */}
                    <div 
                        className="relative w-full max-w-sm sm:max-w-md lg:max-w-lg h-[100dvh] max-h-[100dvh] pt-safe pb-safe bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200 z-10"
                    >
                        {/* Full CartSidebar with close button & swipe gesture */}
                        <div className="flex-1 overflow-hidden relative h-full">
                            <CartSidebar {...cartSidebarProps} showCustomerSelector={true} onClose={() => setIsMobileCartOpen(false)} />
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Mobile/Focus Checkout Bar - High-Visibility Comfortable POS Bar */}
            <div className={`fixed right-0 p-2.5 sm:p-3 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-t border-slate-300 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-[40] ${
                layoutStyle === 'floating-dock' ? 'bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:bottom-24' : 'bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0'
            } ${
                posLayout === 'focus' ? 'flex w-full' : 'lg:hidden flex w-full'
            } ${
                layoutStyle === 'sidebar' && posLayout !== 'focus' ? 'left-0 md:left-64 xl:left-72' : 'left-0'
            }`}>
                <button 
                    onClick={() => setIsMobileCartOpen(true)}
                    className="w-full max-w-3xl mx-auto h-14 sm:h-16 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl shadow-md border border-slate-600/80 flex items-center justify-between px-4 sm:px-6 active:scale-[0.99] transition-all cursor-pointer group"
                >
                    <div className="flex items-center gap-3 sm:gap-3.5">
                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-slate-700 text-white border border-slate-600 flex items-center justify-center shrink-0 shadow-inner">
                            <ShoppingCart size={20} strokeWidth={2.2} />
                        </div>
                        <div className="flex flex-col items-start text-left">
                            <span className="text-xs sm:text-[13px] font-bold text-white tracking-wide">
                                Carrito de Ventas
                            </span>
                            <span className="inline-flex items-center mt-0.5 px-2 py-0.5 rounded-md bg-slate-700 text-slate-200 border border-slate-600 text-[11px] font-bold tracking-tight">
                                {localCart.length} {localCart.length === 1 ? 'producto añadido' : 'productos añadidos'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="flex flex-col items-end">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total a Pagar</span>
                            <span className="text-xl sm:text-2xl font-black text-white tracking-tight tabular-nums leading-tight">
                                {renderFormatMoney(total)}
                            </span>
                        </div>
                        <div className="px-4 py-2 bg-slate-700 group-hover:bg-slate-600 border border-slate-500 text-white rounded-xl flex items-center gap-1.5 font-bold text-xs sm:text-sm transition-colors shrink-0 shadow-xs">
                            <span>Ver Ticket</span>
                            <ArrowRight size={16} strokeWidth={2.5} />
                        </div>
                    </div>
                </button>
            </div>

            {/* System HUD - Notifications */}
            {notification && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[200000] animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className={`px-5 py-3 rounded-xl shadow-lg border flex items-center gap-3 ${
                        notification.type === 'success' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-red-600 border-red-500 text-white'
                    }`}>
                        {notification.type === 'success' ? <CheckCircle2 size={18} /> : <X size={18} />}
                        <div className="flex flex-col">
                            <span className="font-semibold text-xs">{notification.message}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals Collection */}
            <ActionDialog 
                isOpen={actionDialog.isOpen} type={actionDialog.type} data={actionDialog.data}
                onClose={() => setActionDialog({ isOpen: false, type: '', data: null })}
                onSubmit={handleActionSubmit} exchangeRate={exchangeRate} currencyMode={currencyMode}
            />

            <CheckoutModal 
                isOpen={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)}
                onConfirm={(data) => handleProcessSale({
                    ...data,
                    promoDiscount: data.promoDiscount !== undefined ? data.promoDiscount : (calcPromoSavings || totalPromoSavings || 0),
                    appliedPromotions: data.appliedPromotions || appliedPromotions || []
                }, { setIsReceiptOpen, setLastSale, setIsCheckoutOpen })}
                cartItems={localCart || cart}
                basePromoDiscount={calcPromoSavings || totalPromoSavings || 0}
                baseAppliedPromotions={appliedPromotions || []}
                total={total} subtotal={subtotal} taxableBase={taxableBase} exemptBase={exemptBase}
                taxAmount={ivaAmount} ivaRate={taxSettings.ivaRate} igtfRate={taxSettings.igtfRate}
                igtfEnabled={taxSettings.igtfEnabled} discountAmount={discountAmount}
                discountPercent={discountActive} exchangeRate={exchangeRate}
                currencyMode={currencyMode} processing={processing}
                initialCustomerId={selectedCustomer} customerName={activeCustomer?.name} registerId={registerId} registerDisplayName={registerDisplayName}
                businessSettings={businessSettings}
            />

            {isReceiptOpen && (
                <Suspense fallback={null}>
                    <ReceiptModal 
                        isOpen={isReceiptOpen} onClose={() => setIsReceiptOpen(false)}
                        sale={lastSale} businessSettings={businessSettings}
                        exchangeRate={exchangeRate} currencyMode={currencyMode}
                    />
                </Suspense>
            )}

            {showNewCustomerModal && (
                <Suspense fallback={null}>
                    <CustomerModal 
                        isOpen={showNewCustomerModal} 
                        customer={customerToEdit}
                        onClose={() => {
                            setShowNewCustomerModal(false);
                            setCustomerToEdit(null);
                        }}
                        onSave={(payload) => {
                            if (customerToEdit && customerToEdit.id) {
                                handleUpdateCustomer(customerToEdit.id, payload);
                            } else {
                                handleCreateCustomer(payload);
                            }
                        }} 
                        processing={creatingCustomer}
                    />
                </Suspense>
            )}

            {isHeldModalOpen && (
                <Suspense fallback={null}>
                    <HeldSalesModal 
                        isOpen={isHeldModalOpen} 
                        onClose={() => setIsHeldModalOpen(false)}
                        heldSales={heldSales}
                        exchangeRate={exchangeRate}
                        currencyMode={currencyMode}
                        formatMoney={renderFormatMoney}
                        onRestore={handleRestoreHeldSale}
                        onRemove={handleRemoveHeldSale}
                    />
                </Suspense>
            )}

            {isProductModalOpen && (
                <Suspense fallback={null}>
                    <ProductModal
                        isOpen={isProductModalOpen}
                        onClose={closeProductModal}
                        product={selectedQuickProduct}
                        onSave={handleSaveQuickProduct}
                        processing={processingQuickProduct}
                        categories={categories.filter(c => c !== 'Todas')}
                        businessSettings={businessSettings}
                    />
                </Suspense>
            )}

            {isPinModalOpen && (
                <Suspense fallback={null}>
                    <SupervisorPinModal
                        isOpen={isPinModalOpen}
                        onClose={() => {
                            setIsPinModalOpen(false);
                            setPendingDiscount(0);
                        }}
                        onApprove={() => {
                            setDiscountActive(pendingDiscount);
                            setPendingDiscount(0);
                            toast.success('Descuento especial autorizado');
                        }}
                        actionType="HIGH_DISCOUNT"
                        referenceId="POS_DISCOUNT"
                    />
                </Suspense>
            )}

            {/* Flying Items Layer */}
            {/* Removed flying animations for performance */}
        </div>
    );
}
