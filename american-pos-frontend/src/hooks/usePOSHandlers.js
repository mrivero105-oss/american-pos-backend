import { useState } from 'react';
import api from '../services/api';
import { db } from '../services/db';
import localDb from '../db/localDb';
import { toast } from 'react-hot-toast';
import { playSuccessSound, playErrorSound, playDrawerSound } from '../utils/sounds';
import { speakAI } from '../utils/tts';
import VortexMathEngine from '../utils/VortexMathEngine';
import lanSyncService from '../services/lanSyncService';

export const usePOSHandlers = ({
    user,
    localCart,
    setLocalCart,
    clearPosState,
    selectedCustomer,
    setSelectedCustomer,
    activeCustomer,
    discountActive,
    setDiscountActive,
    setHeldSales,
    activeQuotationId,
    setActiveQuotationId,
    fetchProducts,
    fetchCustomers,
    businessSettings,
    showNotification,
    navigate,
    setLastSale,
    setIsReceiptOpen,
    setShowNewCustomerModal
}) => {
    const [processing, setProcessing] = useState(false);
    const [creatingCustomer, setCreatingCustomer] = useState(false);

    const handleSaveQuotation = async () => {
        if (localCart.length === 0) {
            toast.error('El carrito está vacío');
            playErrorSound();
            return;
        }
        
        try {
            setProcessing(true);
            const subtotal = localCart.reduce((acc, item) => {
                const itemTotal = VortexMathEngine.multiply(Number(item.price) || 0, Number(item.quantity) || 0);
                return VortexMathEngine.add(acc, itemTotal);
            }, 0);
            
            const quotationData = {
                customerId: selectedCustomer || null,
                customerName: activeCustomer?.name || 'Cliente Genérico',
                customerDocument: activeCustomer?.rif || activeCustomer?.document || '',
                items: localCart,
                total: subtotal,
                status: 'pending',
                date: new Date().toISOString()
            };

            await api.post('/quotations', quotationData);
            toast.success('Cotización guardada exitosamente');
            playSuccessSound();
            clearPosState();
            setLocalCart([]);
            navigate('/quotations');
        } catch (error) {
            console.error('Error saving quotation:', error);
            toast.error('Error al guardar la cotización');
            playErrorSound();
        } finally {
            setProcessing(false);
        }
    };

    const handleProcessSale = async (saleData, modalCleanup) => {
        if (processing) return;

        // Generate cryptographic ID early to ensure consistency between API attempt and offline fallback (Idempotency Key)
        const deterministicId = saleData.clientTransactionId || saleData.id || `SALE-${crypto.randomUUID()}`;

        try {
            setProcessing(true);
            const nowD = new Date();
            const todayKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;
            const effRegisterName = String(saleData.registerName || saleData.registerDisplayName || localStorage.getItem('pos_register_name') || 'Caja Principal').trim();
            const effRegisterId = String(saleData.registerId || localStorage.getItem('pos_device_id') || '1').trim();
            const registerTrackerKey = `pos_daily_ticket_tracker_${(effRegisterId || effRegisterName || 'default').toLowerCase().replace(/\s+/g, '_')}`;

            let localDailyCount = 0;
            try {
                const rawTracker = localStorage.getItem(registerTrackerKey);
                if (rawTracker) {
                    const parsedTracker = JSON.parse(rawTracker);
                    if (
                        parsedTracker &&
                        parsedTracker.date === todayKey &&
                        (!effRegisterId || !parsedTracker.registerId || parsedTracker.registerId === effRegisterId) &&
                        Number.isFinite(Number(parsedTracker.count))
                    ) {
                        localDailyCount = Number(parsedTracker.count);
                    }
                }
            } catch (err) {
                console.warn('[usePOSHandlers] Error leyendo contador diario local:', err?.message);
            }
            const optimisticTicketNumber = localDailyCount + 1;

            const payload = {
                ...saleData,
                id: deterministicId,
                registerId: effRegisterId,
                registerName: effRegisterName,
                dailyTicketNumber: optimisticTicketNumber,
                taxInfo: {
                    ...(saleData.taxInfo && typeof saleData.taxInfo === 'object' ? saleData.taxInfo : {}),
                    dailyTicketNumber: optimisticTicketNumber
                },
                customerId: saleData.customerId !== undefined ? saleData.customerId : selectedCustomer,
                customerName: saleData.customerName || activeCustomer?.name || 'Cliente Ocasional',
                promoDiscount: Number(saleData.promoDiscount || 0),
                appliedPromotions: Array.isArray(saleData.appliedPromotions) ? saleData.appliedPromotions : [],
                items: localCart.map(item => {
                    const rawId = String(item.productId || item.id || '').trim();
                    const cleanProdId = item.productId || rawId.replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
                    const isBulk = Boolean(item.isBulk || rawId.endsWith('__bulk'));
                    const isMidBulk = Boolean(item.isMidBulk || rawId.endsWith('__mid'));
                    return {
                        ...item,
                        id: cleanProdId,
                        productId: cleanProdId,
                        isCustom: Boolean(item.isCustom),
                        name: item.name,
                        originalName: item.originalName || item.name,
                        quantity: Number(item.quantity) || 1,
                        price: Number(item.price) || 0,
                        cost: Number(item.cost) || 0,
                        category: item.category || 'General',
                        promoDiscount: Number(item.promoDiscount) || 0,
                        appliedPromoName: item.appliedPromoName || null,
                        finalUnitPrice: Number(item.finalUnitPrice || item.price) || 0,
                        presentationId: item.presentationId || null,
                        presentationName: item.presentationName || null,
                        factorConversion: Number(item.factorConversion) > 0 
                            ? Number(item.factorConversion) 
                            : (isBulk ? (Number(item.unitsPerBulk) || 1) : (isMidBulk ? (Number(item.unitsPerMidBulk) || 1) : 1)),
                        isBulk,
                        unitsPerBulk: Number(item.unitsPerBulk) || 1,
                        bulkPrice: Number(item.bulkPrice) || 0,
                        bulkUnitName: item.bulkUnitName || '',
                        isMidBulk,
                        unitsPerMidBulk: Number(item.unitsPerMidBulk) || 1,
                        midBulkPrice: Number(item.midBulkPrice) || 0,
                        midBulkUnitName: item.midBulkUnitName || '',
                        batchNumber: item.batchNumber || null,
                        expirationDate: item.expirationDate || null,
                        es_controlado: Boolean(item.es_controlado)
                    };
                })
            };
            
            const isOfflineExplicit = typeof window !== 'undefined' && (localStorage.getItem('isaac_pos_is_offline_mode') === 'true' || !navigator.onLine);
            let shouldSaveOffline = isOfflineExplicit;
            let completedSale = null;

            if (!isOfflineExplicit) {
                try {
                    const isMobileApp = typeof window !== 'undefined' && Boolean(
                        (window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform()) || 
                        window.location.protocol === 'capacitor:' ||
                        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
                    );
                    const timeoutMs = isMobileApp ? 2500 : 3500;
                    try {
                        sessionStorage.setItem('last_local_printed_sale_id', String(deterministicId));
                        lanSyncService.markSalePrintedLocally(deterministicId);
                    } catch (err) {
                        console.warn('[usePOSHandlers] Error marcando ID impreso:', err?.message);
                    }
                    const response = await api.post('/sales', payload, { timeout: timeoutMs });
                    const resolvedTicketNum = Number(response.data?.dailyTicketNumber || response.data?.taxInfo?.dailyTicketNumber || optimisticTicketNumber);
                    completedSale = {
                        ...response.data,
                        dailyTicketNumber: resolvedTicketNum,
                        taxInfo: {
                            ...(response.data?.taxInfo || {}),
                            dailyTicketNumber: resolvedTicketNum
                        },
                        _autoPrint: true
                    };
                    try {
                        const trackerPayload = JSON.stringify({ date: todayKey, count: resolvedTicketNum, registerName: effRegisterName, registerId: effRegisterId });
                        localStorage.setItem(registerTrackerKey, trackerPayload);
                        localStorage.setItem('pos_daily_ticket_tracker', trackerPayload);
                        window.dispatchEvent(new CustomEvent('pos-daily-ticket-updated', { detail: { date: todayKey, count: resolvedTicketNum, nextTicketNumber: resolvedTicketNum + 1 } }));
                    } catch (err) {
                        console.warn('[usePOSHandlers] Error actualizando contador diario de ticket:', err?.message);
                    }
                    if (completedSale.id) {
                        try { sessionStorage.setItem('last_local_printed_sale_id', String(completedSale.id)); } catch { /* sessionStorage no disponible */ }
                    }
                    setLastSale(completedSale);
                    playSuccessSound();
                    speakAI('Venta cobrada con éxito.');
                } catch (netError) {
                    const isNetworkFail = !netError.response || 
                                          netError.code === 'ECONNABORTED' || 
                                          netError.code === 'ERR_NETWORK' || 
                                          netError.code === 'ETIMEDOUT' ||
                                          netError.code === 'ECONNREFUSED' ||
                                          (netError.response && netError.response.status >= 500) ||
                                          netError.message?.includes('Network') ||
                                          netError.message?.includes('timeout') ||
                                          netError.message?.includes('servidor');
                    if (isNetworkFail) {
                        shouldSaveOffline = true;
                    } else {
                        throw netError;
                    }
                }
            }

            if (shouldSaveOffline) {
                const mobileSeq = Math.floor(100000 + Math.random() * 900000);
                const offlineInvoiceNum = `MOV-01-${mobileSeq}`;
                
                const offlineSale = {
                    ...payload,
                    id: deterministicId,
                    invoiceNumber: payload.invoiceNumber || offlineInvoiceNum,
                    date: new Date().toISOString(),
                    isOffline: true,
                    status: 'pending_sync',
                    created_at: new Date().toISOString(),
                    _autoPrint: true
                };
                
                // 1. Save in primary POS indexedDB
                await db.put('sales', offlineSale);

                // 2. Enqueue in Dexie syncManager queue
                if (localDb && localDb.sales) {
                    try {
                        await localDb.sales.put(offlineSale);
                    } catch (dexErr) {
                        console.warn('Could not write to localDb.sales:', dexErr);
                    }
                }

                // 3. Decrement local stock immediately in BOTH IndexedDB engines (Dual Store Consistency)
                try {
                    for (const item of localCart) {
                        const rawId = String(item.productId || item.id || '').trim();
                        const cleanProdId = item.productId || rawId.replace(/__bulk$|__mid$|__w?pres_.*$|__srv_.*$/, '');
                        if (cleanProdId && !item.isCustom) {
                            const isBulk = Boolean(item.isBulk || rawId.endsWith('__bulk'));
                            const isMidBulk = Boolean(item.isMidBulk || rawId.endsWith('__mid'));
                            const mult = Number(item.factorConversion) > 0
                                ? Number(item.factorConversion)
                                : (isBulk ? (Number(item.unitsPerBulk) || 1) : (isMidBulk ? (Number(item.unitsPerMidBulk) || 1) : 1));
                            const unitsToDeduct = (Number(item.quantity) || 1) * mult;
                            const piecesToDeduct = Number(item.piecesToDeduct) || 0;

                            const computeNextUnits = (pObj, curStock, nextStock) => {
                                if (pObj.stockUnits === null || pObj.stockUnits === undefined || Number(pObj.stockUnits) <= 0) return pObj.stockUnits;
                                if (nextStock <= 0) return 0;
                                if (piecesToDeduct > 0) return Math.max(0, Math.round((Number(pObj.stockUnits) - piecesToDeduct) * 100) / 100);
                                if ((pObj.isSoldByWeight || pObj.stockUnit === 'kg') && unitsToDeduct > 0) {
                                    const avgW = (Number(pObj.unitsPerBulk) > 0 && Number(pObj.unitsPerBulk) !== 1)
                                        ? Number(pObj.unitsPerBulk)
                                        : (curStock > 0 ? (curStock / Number(pObj.stockUnits)) : 0);
                                    if (avgW > 0) return Math.max(0, Math.round((Number(pObj.stockUnits) - (unitsToDeduct / avgW)) * 100) / 100);
                                }
                                return pObj.stockUnits;
                            };

                            // A. Primary db store
                            const prod = await db.getById('products', cleanProdId);
                            if (prod) {
                                const currentStock = Number(prod.stockQuantity) || 0;
                                const newStock = Math.max(0, currentStock - unitsToDeduct);
                                const newUnits = computeNextUnits(prod, currentStock, newStock);
                                await db.put('products', { ...prod, stockQuantity: newStock, stockUnits: newUnits });
                            }

                            // B. Dexie localDb store
                            if (localDb && localDb.products) {
                                let dexProd = await localDb.products.get(cleanProdId);
                                if (!dexProd && !isNaN(Number(cleanProdId)) && Number(cleanProdId) > 0) {
                                    dexProd = await localDb.products.get(Number(cleanProdId));
                                }
                                if (dexProd) {
                                    const curDexStock = Number(dexProd.stockQuantity) || 0;
                                    const newDexStock = Math.max(0, curDexStock - unitsToDeduct);
                                    const newDexUnits = computeNextUnits(dexProd, curDexStock, newDexStock);
                                    await localDb.products.update(dexProd.id, { stockQuantity: newDexStock, stockUnits: newDexUnits });
                                }
                            }
                        }
                    }
                } catch (stkErr) {
                    console.warn('Could not decrement local stock:', stkErr);
                }

                completedSale = offlineSale;
                try {
                    const trackerPayload = JSON.stringify({ date: todayKey, count: optimisticTicketNumber, registerName: effRegisterName, registerId: effRegisterId });
                    localStorage.setItem(registerTrackerKey, trackerPayload);
                    localStorage.setItem('pos_daily_ticket_tracker', trackerPayload);
                    window.dispatchEvent(new CustomEvent('pos-daily-ticket-updated', { detail: { date: todayKey, count: optimisticTicketNumber, nextTicketNumber: optimisticTicketNumber + 1 } }));
                } catch (err) {
                    console.warn('[usePOSHandlers] Error actualizando contador diario offline:', err?.message);
                }
                if (completedSale.id) {
                    try { sessionStorage.setItem('last_local_printed_sale_id', String(completedSale.id)); } catch { /* sessionStorage no disponible */ }
                }
                setLastSale(offlineSale);
                showNotification('⚡ Venta registrada en MODO OFFLINE y guardada localmente', 'warning');
                playSuccessSound();
                speakAI('Venta guardada localmente.');
            }

            // 🌐 Clúster P2P: Propagar venta instantáneamente a todas las cajas de la red local
            if (completedSale) {
                try {
                    lanSyncService.broadcastSale(completedSale);
                } catch (p2pErr) {
                    console.warn('[usePOSHandlers] Aviso propagando venta P2P:', p2pErr?.message);
                }
            }

            setIsReceiptOpen(true);
            
            if (activeQuotationId) {
                try {
                    await api.put(`/quotations/${activeQuotationId}`, { status: 'converted' });
                    setActiveQuotationId(null);
                } catch (qError) {
                    console.warn('[usePOSHandlers] Error marcando cotización convertida:', qError?.message);
                }
            }

            clearPosState();
            setLocalCart([]);
            setDiscountActive(0);
            if (modalCleanup?.setIsCheckoutOpen) modalCleanup.setIsCheckoutOpen(false);
            fetchProducts();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error al procesar venta');
            playErrorSound();
            throw error;
        } finally {
            setProcessing(false);
        }
    };

    const handleHoldSale = () => {
        if (localCart.length === 0) return;
        const newHeld = {
            id: Date.now(),
            items: [...localCart],
            customer: selectedCustomer,
            customerName: activeCustomer?.name || '',
            discount: discountActive,
            timestamp: new Date().toISOString()
        };
        setHeldSales(prev => [...prev, newHeld]);
        
        // Reset POS State
        clearPosState();
        setLocalCart([]);
        setDiscountActive(0);
        
        toast.success('Venta pausada');
    };

    const handleCreateCustomer = async (data) => {
        try {
            setCreatingCustomer(true);
            const isOffline = typeof window !== 'undefined' && (localStorage.getItem('isaac_pos_is_offline_mode') === 'true' || !navigator.onLine);
            let newC = null;

            if (!isOffline) {
                try {
                    const res = await api.post('/customers', data, { timeout: 3500 });
                    newC = res.data.customer || res.data;
                    toast.success('Cliente creado exitosamente');
                } catch (netErr) {
                    if (netErr.response && netErr.response.status >= 400 && netErr.response.status < 500) {
                        throw netErr;
                    }
                    console.warn('Fallo de red al crear cliente online, creando en modo offline:', netErr.message);
                }
            }

            if (!newC) {
                const tempId = `cust_offline_${Date.now()}`;
                newC = {
                    ...data,
                    id: tempId,
                    creditLimit: Number(data.creditLimit) || 0,
                    creditBalance: 0,
                    isActive: true,
                    status: 'pending_sync',
                    created_at: new Date().toISOString()
                };

                // Guardar en IndexedDB primaria
                try {
                    await db.put('customers', newC);
                } catch (dbErr) {
                    console.error('Error guardando cliente en db.customers:', dbErr);
                }

                // Guardar en Dexie localDb
                if (localDb && localDb.customers) {
                    try {
                        await localDb.customers.put(newC);
                    } catch (dexErr) {
                        console.warn('Error guardando cliente en localDb.customers:', dexErr);
                    }
                }

                // Encolar acción en syncQueue para sincronización REST
                try {
                    await db.put('syncQueue', {
                        id: `sq_cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        endpoint: '/customers',
                        method: 'POST',
                        payload: data,
                        tempId: tempId,
                        tempLocalId: tempId,
                        timestamp: Date.now()
                    });
                } catch (sqErr) {
                    console.warn('[usePOSHandlers] Error encolando creación de cliente en syncQueue:', sqErr?.message);
                }

                toast.success('⚡ Cliente creado localmente (Modo Offline)');
            }

            if (typeof setShowNewCustomerModal === 'function') {
                setShowNewCustomerModal(false);
            }
            setSelectedCustomer(newC.id);
            playSuccessSound();
            await fetchCustomers();
            setSelectedCustomer(newC.id);
            return newC;
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error al crear cliente');
            playErrorSound();
            throw error;
        } finally {
            setCreatingCustomer(false);
        }
    };

    const handleUpdateCustomer = async (id, data) => {
        try {
            setCreatingCustomer(true);
            const isOffline = typeof window !== 'undefined' && (localStorage.getItem('isaac_pos_is_offline_mode') === 'true' || !navigator.onLine);
            let updatedC = null;

            if (!isOffline) {
                try {
                    const res = await api.put(`/customers/${id}`, data, { timeout: 4000 });
                    updatedC = res.data.customer || res.data;
                    toast.success('Cliente actualizado exitosamente');
                } catch (netErr) {
                    if (netErr.response && netErr.response.status >= 400 && netErr.response.status < 500) {
                        throw netErr;
                    }
                    console.warn('Fallo de red al actualizar cliente online, actualizando en modo offline:', netErr.message);
                }
            }

            if (!updatedC) {
                updatedC = {
                    ...data,
                    id: id,
                    status: 'pending_sync',
                    updated_at: new Date().toISOString()
                };

                // Actualizar en IndexedDB primaria
                try {
                    const existing = await db.getById('customers', id);
                    await db.put('customers', { ...existing, ...updatedC });
                } catch (dbErr) {
                    console.error('Error actualizando cliente en db.customers:', dbErr);
                }

                // Actualizar en Dexie localDb
                if (localDb && localDb.customers) {
                    try {
                        const existingDex = await localDb.customers.get(id);
                        await localDb.customers.put({ ...existingDex, ...updatedC });
                    } catch (dexErr) {
                        console.warn('Error actualizando cliente en localDb.customers:', dexErr);
                    }
                }

                // Encolar acción en syncQueue para sincronización REST
                try {
                    await db.put('syncQueue', {
                        endpoint: `/customers/${id}`,
                        method: 'PUT',
                        payload: data,
                        tempId: id,
                        timestamp: Date.now()
                    });
                } catch (sqErr) {
                    console.warn('[usePOSHandlers] Error encolando actualización de cliente en syncQueue:', sqErr?.message);
                }

                toast.success('⚡ Cliente actualizado localmente (Modo Offline)');
            }

            if (typeof setShowNewCustomerModal === 'function') {
                setShowNewCustomerModal(false);
            }
            playSuccessSound();
            await fetchCustomers();
            setSelectedCustomer(id);
            return updatedC;
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error al actualizar cliente');
            playErrorSound();
            throw error;
        } finally {
            setCreatingCustomer(false);
        }
    };

    const handleOpenDrawer = async (authorizedReason = null) => {
        const userRole = String(user?.role || '').toLowerCase();
        const isPrivileged = ['admin', 'superadmin', 'owner', 'dueño', 'master', 'supervisor'].includes(userRole);
        const requireSupervisor = businessSettings?.requireSupervisorForDrawer !== false;

        if (requireSupervisor && !isPrivileged && !authorizedReason) {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('request_supervisor_drawer'));
            }
            return;
        }

        const reason = authorizedReason || `Apertura manual por ${user?.name || userRole || 'Usuario'}`;
        api.post('/cash/drawer-open-event', { reason }).catch(() => {});
        const targetPrinter = localStorage.getItem('pos_station_printer') || businessSettings?.printerName || '';

        if (window.electronAPI && typeof window.electronAPI.openDrawer === 'function') {
            try {
                playDrawerSound();
                const res = await window.electronAPI.openDrawer(targetPrinter, businessSettings?.drawerSequence);
                if (res && res.success === false) {
                    showNotification('Configure o conecte una impresora térmica en Ajustes -> Impresoras', 'warning');
                    playErrorSound();
                } else {
                    toast.success('Abriendo gaveta...');
                }
            } catch (_err) {
                toast.error('Error al abrir gaveta');
                playErrorSound();
            }
        } else {
            try {
                playDrawerSound();
                const resp = await api.post('/settings/open-drawer', {
                    printerName: targetPrinter,
                    sequence: businessSettings?.drawerSequence
                });
                if (resp.data?.success) {
                    toast.success('Abriendo gaveta...');
                } else {
                    toast.error(resp.data?.error || 'Error al abrir gaveta');
                    playErrorSound();
                }
            } catch (err) {
                toast.error(err.response?.data?.error || 'Error al abrir gaveta');
                playErrorSound();
            }
        }
    };

    const handlePrintLast = async () => {
        try {
            setProcessing(true);
            const response = await api.get('/sales?limit=1');
            const sales = response.data.data || response.data.sales || response.data;
            if (sales && sales.length > 0) {
                setLastSale(sales[0]);
                setIsReceiptOpen(true);
                playSuccessSound();
            } else {
                toast.error('No hay ventas recientes');
                playErrorSound();
            }
        } catch (_error) {
            toast.error('Error al recuperar última venta');
            playErrorSound();
        } finally {
            setProcessing(false);
        }
    };

    return {
        processing,
        creatingCustomer,
        handleSaveQuotation,
        handleProcessSale,
        handleHoldSale,
        handleCreateCustomer,
        handleUpdateCustomer,
        handleOpenDrawer,
        handlePrintLast
    };
};
