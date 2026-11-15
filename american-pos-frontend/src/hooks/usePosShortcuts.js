import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

/**
 * Hook to handle all POS keyboard shortcuts and arrow navigation.
 */
export const usePosShortcuts = (props) => {
    const propsRef = useRef(props);
    useEffect(() => {
        propsRef.current = props;
    });

    const multiplierBufferRef = useRef('');
    const multiplierTimerRef = useRef(null);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const {
                searchInputRef,
                isCheckoutOpen,
                isReceiptOpen,
                isActionModalOpen,
                cartLength,
                filteredProducts = [],
                selectedIndex,
                setSelectedIndex,
                handleAddToCart,
                setLocalSearch,
                setSearchTerm,
                setIsCheckoutOpen,
                setActionDialog,
                setCategory,
                categories = [],
                setShowNewCustomerModal,
                setIsCustomerDropdownOpen,
                customerSearchRef,
                handleSaveQuotation
            } = propsRef.current;

            const activeEl = document.activeElement;
            const isEditable = activeEl && (
                activeEl.tagName === 'INPUT' || 
                activeEl.tagName === 'TEXTAREA' || 
                activeEl.isContentEditable ||
                activeEl.tagName === 'SELECT'
            );
            const isSearchInput = searchInputRef.current && activeEl === searchInputRef.current;

            // Global Multiplier Buffer Logic
            if (!isEditable || isSearchInput) {
                if (/^\d$/.test(e.key)) {
                    multiplierBufferRef.current += e.key;
                    if (multiplierTimerRef.current) clearTimeout(multiplierTimerRef.current);
                    multiplierTimerRef.current = setTimeout(() => { multiplierBufferRef.current = ''; }, 2000);
                } else if (e.key !== '*' && e.key !== 'Escape' && e.key !== 'Enter') {
                    multiplierBufferRef.current = '';
                }
            }

            // Asterisk Multiplier
            if (e.key === '*') {
                let val = '';
                if (isSearchInput && searchInputRef.current?.value && !isNaN(searchInputRef.current.value.trim())) {
                    val = searchInputRef.current.value.trim();
                } else if (multiplierBufferRef.current.length > 0) {
                    val = multiplierBufferRef.current;
                }

                if (val !== '' && !isNaN(val)) {
                    e.preventDefault();
                    if (propsRef.current.setQuantityMultiplier) {
                        propsRef.current.setQuantityMultiplier(Number(val));
                        toast.success(`Multiplicador: x${val}`, { icon: '⚡', duration: 4000, style: { fontSize: '18px', fontWeight: 'bold' } });
                    }
                    if (isSearchInput) {
                        setSearchTerm('');
                        if (setLocalSearch) setLocalSearch('');
                    }
                    multiplierBufferRef.current = '';
                }
            }

            // F4: Focus Search
            if (e.key === 'F4') {
                e.preventDefault();
                if (searchInputRef.current?.value) {
                    setSearchTerm('');
                    if (setLocalSearch) setLocalSearch('');
                }
                searchInputRef.current?.focus();
            }

            // F5: Hold / Resume Sale (allow Ctrl+F5 or Shift+F5 for normal browser refresh)
            if ((e.key === 'F5' || e.code === 'F5') && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }

                if (isActionModalOpen || isCheckoutOpen) return;

                const currentCart = propsRef.current.localCart || [];
                const currentLength = (propsRef.current.cartLength !== undefined) 
                    ? propsRef.current.cartLength 
                    : currentCart.length;

                if (currentLength > 0 && typeof propsRef.current.handleHoldSale === 'function') {
                    propsRef.current.handleHoldSale();
                } else if (typeof propsRef.current.setIsHeldModalOpen === 'function') {
                    propsRef.current.setIsHeldModalOpen(prev => !prev);
                }
                return;
            }

            // F7: Discount Global
            if (e.key === 'F7') {
                e.preventDefault();
                if (cartLength > 0 && !isActionModalOpen && !isCheckoutOpen) {
                    setActionDialog({ isOpen: true, type: 'DISCOUNT_PROMPT', data: null });
                }
            }

            // F9: Open Drawer
            if (e.key === 'F9' && !isActionModalOpen && !isCheckoutOpen) {
                e.preventDefault();
                if (propsRef.current.handleOpenDrawer) {
                    propsRef.current.handleOpenDrawer();
                }
            }
            
            // F2: Open Checkout
            if (e.key === 'F2' && cartLength > 0 && !isCheckoutOpen) {
                e.preventDefault();
                if (propsRef.current.isShiftOpen === false) {
                    if (propsRef.current.promptOpenCashShift) {
                        propsRef.current.promptOpenCashShift();
                    } else if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('open_cash_modal'));
                    }
                    return;
                }
                setIsCheckoutOpen(true);
            }
            
            // F3: Add Manual Item
            if (e.key === 'F3' && !isActionModalOpen) {
                e.preventDefault();
                setActionDialog({ isOpen: true, type: 'ADD_MANUAL', data: { defaultValue: 'Varios' } });
            }
            
            // F6: Clear Cart Direct (sin alerta modal bloqueante)
            if (e.key === 'F6' && cartLength > 0 && !isActionModalOpen) {
                e.preventDefault();
                const { handleClearCart } = propsRef.current;
                if (typeof handleClearCart === 'function') {
                    handleClearCart();
                }
            }

            // Alt + C o Shift + F6: Control de Caja Registradora
            if (((e.altKey && (e.key === 'c' || e.key === 'C')) || (e.shiftKey && e.key === 'F6')) && !isActionModalOpen && !isCheckoutOpen) {
                e.preventDefault();
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('open_cash_modal'));
                }
            }

            // F1: Atajo deshabilitado a petición del usuario (previene ayuda por defecto del SO sin disparar acciones)
            if (e.key === 'F1') {
                e.preventDefault();
                return;
            }

            // CTRL + S: Save Quotation
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                if (cartLength > 0) handleSaveQuotation();
            }
            
            // Delete: Remove last item from cart
            if (e.key === 'Delete' && cartLength > 0 && !isActionModalOpen && !isCheckoutOpen && !isEditable) {
                e.preventDefault();
                if (propsRef.current.setLocalCart) {
                    propsRef.current.setLocalCart(prev => prev.slice(0, -1));
                    toast.success('Último artículo eliminado', { icon: '🗑️' });
                }
            }

            // Escape: Reset Search and Blur
            if (e.key === 'Escape') {
                if (!isActionModalOpen && !isCheckoutOpen && !isReceiptOpen) {
                    if (setLocalSearch) setLocalSearch('');
                    setSearchTerm('');
                    setSelectedIndex(-1);
                    if (propsRef.current.setQuantityMultiplier) {
                        propsRef.current.setQuantityMultiplier(1);
                    }
                    searchInputRef.current?.focus();
                }
            }

            // Arrow Navigation Logic
            if (!isActionModalOpen && !isCheckoutOpen && !isReceiptOpen) {
                // If focus is in any editable input that is NOT the search box, ignore POS keyboard grid navigation
                if (isEditable && !isSearchInput) {
                    return;
                }

                const cols = window.innerWidth >= 1536 ? 5 : 
                             window.innerWidth >= 1024 ? 4 : 
                             window.innerWidth >= 640 ? 3 : 2;

                if (e.key === 'ArrowRight') {
                    if (isSearchInput) return; // Allow natural cursor movement in search input
                    e.preventDefault();
                    setSelectedIndex(prev => prev === -1 ? 0 : Math.min(prev + 1, filteredProducts.length - 1));
                }
                if (e.key === 'ArrowLeft') {
                    if (isSearchInput) return; // Allow natural cursor movement in search input
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, 0));
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(prev => prev === -1 ? 0 : Math.min(prev + cols, filteredProducts.length - 1));
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - cols, 0));
                }
                if (e.key === 'Enter' && selectedIndex >= 0) {
                    e.preventDefault();
                    const product = filteredProducts[selectedIndex];
                    if (product) {
                        if (e.shiftKey && Number(product.unitsPerMidBulk) > 0) {
                            // Shift + Enter -> Venta directa de Media Presentación
                            handleAddToCart(product, 1, false, false, true);
                        } else if ((e.altKey || e.ctrlKey) && Number(product.unitsPerBulk) > 1) {
                            // Alt/Ctrl + Enter -> Venta directa de Presentación Mayor / Caja
                            handleAddToCart(product, 1, false, true, false);
                        } else if ((product.isFamily && Array.isArray(product.variants) && product.variants.length > 1) || (Array.isArray(product.Presentations) && product.Presentations.length > 0)) {
                            const el = document.getElementById(`product-${product.id}`);
                            if (el) el.click();
                            else handleAddToCart(product);
                        } else {
                            handleAddToCart(product);
                        }
                    }
                }

                // Quantity Adjust (+ / -)
                if ((e.key === '+' || e.key === '-') && selectedIndex >= 0) {
                    if (isSearchInput) return; // Allow natural typing of '+' or '-' in search input
                    e.preventDefault();
                    const product = filteredProducts[selectedIndex];
                    if (product) {
                        // This might need a bit more state to work perfectly with 'handleAddToCart', 
                        // but for now we'll just trigger it.
                        handleAddToCart(product, e.key === '+' ? 1 : -1);
                    }
                }

                // Category Switching (CTRL + 1, 2, 3...)
                if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
                    e.preventDefault();
                    const idx = parseInt(e.key) - 1;
                    if (categories[idx]) {
                        setCategory(categories[idx].name || categories[idx]);
                    } else if (e.key === '1') {
                        setCategory('Todas');
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, []); // PARCHE CRÍTICO: Suscripción única libre de fugas y re-creaciones infinitas

    // Focus scroll management
    useEffect(() => {
        if (props.selectedIndex >= 0 && props.filteredProducts && props.filteredProducts[props.selectedIndex]) {
            const product = props.filteredProducts[props.selectedIndex];
            const el = document.getElementById(`product-${product.id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [props.selectedIndex, props.filteredProducts]);
};
