import { useState, useMemo, useCallback } from 'react';
import api from '../../services/api';
import localDb from '../../db/localDb';
import { db as primaryDb } from '../../services/db';
import lanSyncService from '../../services/lanSyncService';
import mobilePrinterService from '../../services/mobilePrinterService';
import { normalizeProductImage } from '../../utils/imageProcess';
import { playSuccessSound, playErrorSound } from '../../utils/sounds';
import { triggerHaptic } from '../../utils/haptics';

const stripAccents = (str = '') =>
  String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const cleanWhatsAppPhone = (rawPhone) => {
  let clean = String(rawPhone || '').replace(/\D/g, '');
  if (!clean) return '';
  if (clean.startsWith('0') && clean.length === 11) {
    clean = '58' + clean.slice(1);
  } else if (clean.length === 10 && (clean.startsWith('414') || clean.startsWith('424') || clean.startsWith('412') || clean.startsWith('416') || clean.startsWith('426'))) {
    clean = '58' + clean;
  }
  return clean;
};

/**
 * Hook que encapsula los formularios rápidos móviles:
 * - Creación y edición rápida de productos (con compresión 500 px y cola offline)
 * - Búsqueda, selección y creación/edición rápida de clientes
 * - Envío ecológico por WhatsApp e impresión rápida de preventas
 */
export function useMobileQuickForms({
  isDollarCountry,
  exchangeRate,
  businessInfo,
  selectedCategory,
  normalizedCategories,
  customers,
  setCustomers,
  setProducts,
  countPendingOfflineSales,
  canEditCatalogMobile,
  canCreateProductsMobile,
  canViewCostsMobile,
  setIsQuickProductModalOpen,
  setUnregisteredBarcodeNotice,
  setIsCustomerSelectModalOpen,
  whatsAppModalData,
  setWhatsAppModalData,
  showToast
}) {
  // Producto rápido
  const [productFormData, setProductFormData] = useState({
    id: null,
    name: '',
    barcode: '',
    category: 'General',
    priceUSD: '',
    priceBS: '',
    costUSD: '',
    stock: '0',
    taxStatus: 'gravable',
    imageUri: '',
    isNew: false
  });
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Cliente rápido y selección
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerName, setCustomerName] = useState('Consumidor Final');
  const [customerDoc, setCustomerDoc] = useState(isDollarCountry ? '0000000000' : 'V-00000000');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCreatingCustomerInMobile, setIsCreatingCustomerInMobile] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    idDocument: '',
    phone: '',
    address: '',
    email: '',
    creditLimit: '0'
  });
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  // WhatsApp teléfono
  const [whatsAppPhoneInput, setWhatsAppPhoneInput] = useState('');

  const filteredCustomers = useMemo(() => {
    const rawQ = customerSearch.trim();
    if (!rawQ) return customers;
    const q = stripAccents(rawQ);
    const qDigits = rawQ.replace(/\D/g, '');
    const qAlphanum = rawQ.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    return customers.filter((c) => {
      const name = stripAccents(c.name || c.nombre || '');
      const rawDoc = String(c.identification || c.idDocument || c.doc || c.rif || '');
      const doc = stripAccents(rawDoc);
      const docDigits = rawDoc.replace(/\D/g, '');
      const docAlphanum = rawDoc.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const phone = stripAccents(c.phone || c.telefono || '');
      const phoneDigits = String(c.phone || c.telefono || '').replace(/\D/g, '');

      if (name.includes(q) || doc.includes(q) || phone.includes(q)) return true;
      if (qDigits.length >= 3 && docDigits.includes(qDigits)) return true;
      if (qAlphanum.length >= 3 && docAlphanum.includes(qAlphanum)) return true;
      if (qDigits.length >= 4 && phoneDigits.includes(qDigits)) return true;
      return false;
    });
  }, [customers, customerSearch]);

  const selectableCategories = useMemo(() => {
    const base = [
      ...normalizedCategories.filter((c) => c !== 'Todos'),
      'General', 'Alimentos', 'Bebidas', 'Charcutería', 'Golosinas',
      'Limpieza', 'Cuidado Personal', 'Farmacia', 'Varios'
    ];
    if (productFormData.category && productFormData.category.trim()) {
      base.unshift(productFormData.category.trim());
    }
    const seen = new Set();
    const out = [];
    for (const item of base) {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item.trim());
    }
    return out;
  }, [normalizedCategories, productFormData.category]);

  const handleSelectCustomer = useCallback((c) => {
    if (!c) {
      setSelectedCustomer(null);
      setCustomerName('Consumidor Final');
      setCustomerDoc(isDollarCountry ? '0000000000' : 'V-00000000');
      setCustomerPhone('');
      showToast('Cliente: Consumidor Final');
    } else {
      setSelectedCustomer(c);
      const name = c.name || c.nombre || 'Cliente';
      const doc = c.identification || c.idDocument || c.doc || c.rif || (isDollarCountry ? '0000000000' : 'V-00000000');
      const phone = c.phone || c.telefono || '';
      setCustomerName(name);
      setCustomerDoc(doc);
      setCustomerPhone(phone);
      if (phone) setWhatsAppPhoneInput(phone);
      showToast(`Cliente: ${name}`);
    }
    triggerHaptic(15);
    playSuccessSound();
    setIsCustomerSelectModalOpen(false);
    setIsCreatingCustomerInMobile(false);
  }, [isDollarCountry, setIsCustomerSelectModalOpen, showToast]);

  const handleSaveNewCustomer = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanName = newCustomerForm.name.trim();
    if (!cleanName) {
      showToast('⚠️ Ingresa el nombre del cliente');
      return;
    }

    setIsSavingCustomer(true);
    try {
      const cleanDoc = newCustomerForm.idDocument.trim() || (isDollarCountry ? '0000000000' : 'V-00000000');
      const cleanPhone = newCustomerForm.phone.trim();
      const cleanAddress = newCustomerForm.address.trim();
      const cleanCredit = parseFloat(newCustomerForm.creditLimit) || 0;

      const payload = {
        name: cleanName,
        idDocument: cleanDoc,
        phone: cleanPhone,
        address: cleanAddress,
        creditLimit: cleanCredit,
        creditBalance: 0,
        loyaltyPoints: 0,
        isActive: true
      };

      const isEditing = Boolean(newCustomerForm.id);
      if (isEditing) {
        let updatedCust = null;
        try {
          const res = await api.put(`/customers/${newCustomerForm.id}`, payload, { timeout: 4000 });
          updatedCust = res.data?.customer || res.data;
        } catch (netErr) {
          console.warn('Fallo de red al actualizar cliente online, modo local:', netErr);
        }

        const mergedCust = { ...payload, id: newCustomerForm.id, identification: cleanDoc, ...(updatedCust || {}) };
        if (localDb && localDb.customers) await localDb.customers.put(mergedCust).catch(() => {});
        if (!updatedCust) {
          try {
            await primaryDb.put('syncQueue', {
              id: `cust_update_${newCustomerForm.id}_${Date.now()}`,
              endpoint: `/customers/${newCustomerForm.id}`,
              method: 'PUT',
              payload,
              timestamp: Date.now()
            });
            countPendingOfflineSales();
          } catch { /* noop */ }
        }

        setCustomers((prev) => prev.map((c) => (String(c.id) === String(newCustomerForm.id) ? { ...c, ...mergedCust } : c)));
        if (selectedCustomer && String(selectedCustomer.id) === String(newCustomerForm.id)) {
          setSelectedCustomer(mergedCust);
          setCustomerName(cleanName);
          setCustomerDoc(cleanDoc);
          setCustomerPhone(cleanPhone);
        }
        triggerHaptic(25);
        playSuccessSound();
        showToast(`✅ Cliente "${cleanName}" actualizado con éxito`);
      } else {
        let createdCust = null;
        try {
          const res = await api.post('/customers', payload, { timeout: 4000 });
          createdCust = res.data?.customer || res.data;
        } catch (netErr) {
          console.warn('Fallo de red al crear cliente online, modo local:', netErr);
        }

        if (!createdCust || !createdCust.id) {
          const tempId = `cust_off_${Date.now()}`;
          createdCust = {
            ...payload,
            id: tempId,
            identification: cleanDoc,
            status: 'pending_sync',
            created_at: new Date().toISOString()
          };
          if (localDb && localDb.customers) await localDb.customers.put(createdCust).catch(() => {});
          try {
            await primaryDb.put('syncQueue', {
              id: `cust_sync_${Date.now()}`,
              tempLocalId: tempId,
              endpoint: '/customers',
              method: 'POST',
              payload,
              timestamp: Date.now()
            });
            countPendingOfflineSales();
          } catch { /* noop */ }
        }

        setCustomers((prev) => [createdCust, ...prev]);
        setSelectedCustomer(createdCust);
        setCustomerName(createdCust.name || cleanName);
        setCustomerDoc(createdCust.idDocument || createdCust.doc || createdCust.identification || cleanDoc);
        setCustomerPhone(createdCust.phone || cleanPhone);
        if (cleanPhone) setWhatsAppPhoneInput(cleanPhone);

        triggerHaptic(25);
        playSuccessSound();
        showToast(`✅ Cliente "${cleanName}" creado y seleccionado`);
      }

      setNewCustomerForm({ id: null, name: '', idDocument: '', phone: '', address: '', email: '', creditLimit: '0' });
      setIsCreatingCustomerInMobile(false);
      setIsCustomerSelectModalOpen(false);
    } catch (err) {
      console.error('Error al guardar cliente:', err);
      showToast('❌ Error al guardar cliente');
      playErrorSound();
    } finally {
      setIsSavingCustomer(false);
    }
  }, [newCustomerForm, isDollarCountry, selectedCustomer, setCustomers, countPendingOfflineSales, setIsCustomerSelectModalOpen, showToast]);

  const openEditProduct = useCallback((product) => {
    if (!canEditCatalogMobile) {
      showToast('No tienes permisos para editar productos', 'error');
      return;
    }
    const priceU = Number(product.price || product.precio || 0);
    const priceB = Number(product.priceBs) > 0 ? Number(product.priceBs) : (priceU * exchangeRate);
    const costU = Number(product.cost || product.costo || 0);
    const computedMargin = (product.margin !== undefined && product.margin !== null && String(product.margin) !== '')
      ? Number(product.margin).toFixed(1).replace(/\.0$/, '')
      : (costU > 0 && priceU > 0 ? (((priceU - costU) / costU) * 100).toFixed(1).replace(/\.0$/, '') : '');

    const upb = Number(product.unitsPerBulk || 0);
    const bp = Number(product.bulkPrice || 0);
    const upmb = Number(product.unitsPerMidBulk || 0);
    const mbp = Number(product.midBulkPrice || 0);

    setProductFormData({
      id: product.id,
      name: product.name || product.nombre || '',
      barcode: product.barcode || product.codigo_barras || '',
      category: product.category || product.categoria || 'General',
      priceUSD: priceU ? String(priceU) : '',
      priceBS: priceB ? String(priceB.toFixed(2)) : '',
      costUSD: costU > 0 ? String(costU) : '',
      margin: computedMargin,
      stock: String(product.stockQuantity ?? product.stock ?? 0),
      minStock: String(product.minStock ?? 2),
      stockUnit: product.stockUnit || 'und',
      isSoldByWeight: Boolean(product.isSoldByWeight),
      allowNegative: Boolean(product.allowNegative),
      taxStatus: product.taxStatus || 'gravable',
      imageUri: product.imageUrl || product.imageUri || product.image || '',
      bulkUnitName: product.bulkUnitName || 'Caja',
      unitsPerBulk: upb > 1 ? String(upb) : '',
      bulkPrice: bp > 0 ? String(bp) : '',
      bulkPriceBs: (product.bulkPriceBs && Number(product.bulkPriceBs) > 0) ? String(product.bulkPriceBs) : (bp > 0 ? String((bp * exchangeRate).toFixed(2)) : ''),
      bulkBarcode: product.bulkBarcode || '',
      bulkCost: product.bulkCost ? String(product.bulkCost) : '',
      enableMidBulk: Boolean(upmb > 1 || mbp > 0),
      midBulkUnitName: product.midBulkUnitName || 'Media Caja',
      unitsPerMidBulk: upmb > 1 ? String(upmb) : '',
      midBulkPrice: mbp > 0 ? String(mbp) : '',
      midBulkPriceBs: (product.midBulkPriceBs && Number(product.midBulkPriceBs) > 0) ? String(product.midBulkPriceBs) : (mbp > 0 ? String((mbp * exchangeRate).toFixed(2)) : ''),
      midBulkBarcode: product.midBulkBarcode || '',
      batchNumber: product.batchNumber || '',
      expirationDate: product.expirationDate || '',
      es_controlado: Boolean(product.es_controlado),
      principio_activo: product.principio_activo || '',
      description: product.description || '',
      isNew: false
    });
    setIsCustomCategoryMode(false);
    setIsQuickProductModalOpen(true);
  }, [exchangeRate, canEditCatalogMobile, setIsQuickProductModalOpen, showToast]);

  const openCreateProduct = useCallback((initialBarcode = '') => {
    if (!canCreateProductsMobile) {
      showToast('No tienes permisos para crear productos', 'error');
      return;
    }
    const rawBarcode = typeof initialBarcode === 'string' ? initialBarcode.trim() : '';
    setProductFormData({
      id: null,
      name: '',
      barcode: rawBarcode || `750${Math.floor(100000000 + Math.random() * 900000000)}`,
      category: selectedCategory !== 'Todos' ? selectedCategory : 'General',
      priceUSD: '',
      priceBS: '',
      costUSD: '',
      margin: '30',
      stock: '10',
      minStock: '2',
      stockUnit: 'und',
      isSoldByWeight: false,
      allowNegative: false,
      taxStatus: 'gravable',
      imageUri: '',
      bulkUnitName: 'Caja',
      unitsPerBulk: '',
      bulkPrice: '',
      bulkPriceBs: '',
      bulkBarcode: '',
      bulkCost: '',
      enableMidBulk: false,
      midBulkUnitName: 'Media Caja',
      unitsPerMidBulk: '',
      midBulkPrice: '',
      midBulkPriceBs: '',
      midBulkBarcode: '',
      batchNumber: '',
      expirationDate: '',
      es_controlado: false,
      principio_activo: '',
      description: '',
      isNew: true
    });
    setIsCustomCategoryMode(false);
    setUnregisteredBarcodeNotice(null);
    setIsQuickProductModalOpen(true);
  }, [canCreateProductsMobile, selectedCategory, setUnregisteredBarcodeNotice, setIsQuickProductModalOpen, showToast]);

  const copyBarcodeToClipboard = useCallback(async (codeToCopy) => {
    const text = String(codeToCopy || '').trim();
    if (!text) return;
    triggerHaptic(15);
    let ok = false;
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.PosNativeHardware?.copyToClipboard) {
      try {
        await window.Capacitor.Plugins.PosNativeHardware.copyToClipboard({ text });
        ok = true;
      } catch { /* fallback */ }
    }
    if (!ok) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        try {
          const el = document.createElement('textarea');
          el.value = text;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
        } catch { /* noop */ }
      }
    }
    showToast(`📋 Código copiado: ${text}`);
  }, [showToast]);

  const generateInternalEanBarcode = useCallback(() => {
    const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
    const code = `99${randomDigits}`;
    setProductFormData((prev) => ({ ...prev, barcode: code }));
    triggerHaptic(20);
    showToast('✨ Código interno generado');
  }, [showToast]);

  const handleProductImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showToast('⚠️ La imagen es demasiado pesada (máx 15MB)');
      return;
    }

    try {
      setIsUploadingImage(true);
      let base64 = '';
      try {
        base64 = await normalizeProductImage(file, { size: 500, mode: 'contain', quality: 0.84 });
      } catch {
        base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result || '');
          reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
          reader.readAsDataURL(file);
        });
      }

      let imgUri = '';
      try {
        const res = await api.post('/products/upload-image', {
          base64,
          productId: productFormData.id || 'new'
        }, { timeout: 6000 });
        imgUri = res.data?.imageUri || '';
        showToast('✅ Foto optimizada y cargada');
      } catch {
        imgUri = base64;
        showToast('⚡ Foto optimizada y guardada localmente (Offline)');
      }
      setProductFormData((prev) => ({ ...prev, imageUri: imgUri }));
    } catch (err) {
      console.error('Error subiendo imagen:', err);
      showToast('❌ Error al procesar imagen');
    } finally {
      setIsUploadingImage(false);
    }
  }, [productFormData.id, showToast]);

  const handleSaveProduct = useCallback(async (e) => {
    e?.preventDefault();
    if (productFormData.isNew && !canCreateProductsMobile) {
      showToast('⛔ No tienes permisos para crear productos', 'error');
      return;
    }
    if (!productFormData.isNew && !canEditCatalogMobile) {
      showToast('⛔ No tienes permisos para editar productos', 'error');
      return;
    }
    const name = productFormData.name.trim();
    const price = parseFloat(productFormData.priceUSD);
    const stock = parseFloat(productFormData.stock);
    const cost = canViewCostsMobile ? (parseFloat(productFormData.costUSD) || 0) : undefined;
    const margin = canViewCostsMobile
      ? (parseFloat(productFormData.margin) || (cost > 0 && price > 0 ? Number((((price - cost) / cost) * 100).toFixed(2)) : 0))
      : undefined;
    const barcode = productFormData.barcode.trim();

    if (!name) { showToast('El producto debe tener un nombre'); return; }
    if (isNaN(price) || price < 0) { showToast('Ingresa un precio válido en USD'); return; }
    if (isNaN(stock) || stock < 0) { showToast('Ingresa un stock numérico válido'); return; }

    setIsSavingProduct(true);
    const upb = parseFloat(productFormData.unitsPerBulk) || 1;
    const bp = parseFloat(productFormData.bulkPrice) || (upb > 1 && price > 0 ? Number((price * upb).toFixed(2)) : 0);
    const upmb = productFormData.enableMidBulk ? (parseFloat(productFormData.unitsPerMidBulk) || 0) : 0;
    const mbp = productFormData.enableMidBulk ? (parseFloat(productFormData.midBulkPrice) || 0) : 0;

    const payload = {
      name,
      nombre: name,
      barcode,
      category: productFormData.category || 'General',
      categoria: productFormData.category || 'General',
      price,
      precio: price,
      priceBs: price * exchangeRate,
      ...(canViewCostsMobile ? { cost, costo: cost, margin } : {}),
      stockQuantity: stock,
      stock,
      minStock: parseFloat(productFormData.minStock) || 0,
      stockUnit: productFormData.stockUnit || 'und',
      isSoldByWeight: Boolean(productFormData.isSoldByWeight),
      allowNegative: Boolean(productFormData.allowNegative),
      taxStatus: productFormData.taxStatus || 'gravable',
      imageUri: productFormData.imageUri || null,
      imageUrl: productFormData.imageUri || null,
      bulkUnitName: productFormData.bulkUnitName || 'Caja',
      unitsPerBulk: upb,
      bulkPrice: bp,
      bulkPriceBs: bp > 0 ? (bp * exchangeRate) : 0,
      bulkBarcode: productFormData.bulkBarcode ? productFormData.bulkBarcode.trim() : null,
      ...(canViewCostsMobile ? { bulkCost: parseFloat(productFormData.bulkCost) || ((cost || 0) * upb) } : {}),
      midBulkUnitName: productFormData.midBulkUnitName || 'Media Caja',
      unitsPerMidBulk: upmb,
      midBulkPrice: mbp,
      midBulkPriceBs: mbp > 0 ? (mbp * exchangeRate) : 0,
      midBulkBarcode: productFormData.midBulkBarcode ? productFormData.midBulkBarcode.trim() : null,
      batchNumber: productFormData.batchNumber ? productFormData.batchNumber.trim() : null,
      expirationDate: productFormData.expirationDate || null,
      es_controlado: Boolean(productFormData.es_controlado),
      principio_activo: productFormData.principio_activo ? productFormData.principio_activo.trim() : null,
      description: productFormData.description ? productFormData.description.trim() : null
    };

    try {
      let savedProd;
      if (productFormData.isNew) {
        const res = await api.post('/products', payload, { timeout: 5000 });
        savedProd = res.data?.product || res.data || { ...payload, id: `p_${Date.now()}` };
        setProducts((prev) => [savedProd, ...prev]);
        showToast(`✅ Producto "${name}" creado exitosamente`);
      } else {
        const prodId = productFormData.id;
        const res = await api.put(`/products/${prodId}`, payload, { timeout: 5000 });
        savedProd = res.data?.product || res.data || { ...payload, id: prodId };
        setProducts((prev) => prev.map((p) => (String(p.id) === String(prodId) ? { ...p, ...savedProd } : p)));
        showToast(`✅ "${name}" actualizado en el servidor PC`);
      }

      if (localDb && localDb.products) await localDb.products.put(savedProd).catch(() => {});
      try {
        if (lanSyncService.socket) {
          lanSyncService.socket.emit('product_updated', savedProd);
          lanSyncService.socket.emit('inventory_changed', { timestamp: Date.now() });
        }
      } catch { /* noop */ }
      setIsQuickProductModalOpen(false);
    } catch (err) {
      const httpStatus = err?.response?.status;
      if (httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.message || err?.response?.data?.error || `Operación rechazada por el servidor (${httpStatus})`;
        showToast(`⛔ ${msg}`);
        return;
      }
      const fallbackId = productFormData.isNew ? `off_prod_${Date.now()}` : productFormData.id;
      const fallbackProd = { ...payload, id: fallbackId };
      if (productFormData.isNew) {
        setProducts((prev) => [fallbackProd, ...prev]);
      } else {
        setProducts((prev) => prev.map((p) => (String(p.id) === String(fallbackId) ? { ...p, ...fallbackProd } : p)));
      }
      if (localDb && localDb.products) await localDb.products.put(fallbackProd).catch(() => {});
      try {
        await primaryDb.put('syncQueue', {
          id: `prod_sync_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          tempLocalId: fallbackId,
          endpoint: productFormData.isNew ? '/products' : `/products/${fallbackId}`,
          method: productFormData.isNew ? 'POST' : 'PUT',
          payload,
          createdAt: new Date().toISOString()
        });
        countPendingOfflineSales();
      } catch { /* noop */ }
      showToast('⚡ Guardado localmente en modo offline. Se sincronizará con la PC.');
      setIsQuickProductModalOpen(false);
    } finally {
      setIsSavingProduct(false);
    }
  }, [
    productFormData, canCreateProductsMobile, canEditCatalogMobile, canViewCostsMobile,
    exchangeRate, setProducts, countPendingOfflineSales, setIsQuickProductModalOpen, showToast
  ]);

  const shareReceiptWhatsApp = useCallback((sale) => {
    if (!sale) return;
    setWhatsAppModalData(sale);
    setWhatsAppPhoneInput(sale.customerPhone || '');
  }, [setWhatsAppModalData]);

  const sharePreSaleWhatsApp = useCallback((preSale) => {
    if (!preSale) return;
    const text = `*PREVENTA ENVIADA A CAJA*\n🔖 Código: *${preSale.code || preSale.id || ''}*\n👤 Cliente: ${preSale.customerName || 'Consumidor Final'}\n💵 Total Estimado: $${Number(preSale.totalUSD || 0).toFixed(2)}\n\nPuede acercarse a caja para cancelar su pedido.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }, []);

  const createPrintPreSaleBluetooth = useCallback((activeCurrencyMode) => (preSale) => {
    if (!preSale) return;
    mobilePrinterService.enqueueSalePrint({
      sale: preSale,
      businessSettings: { ...businessInfo, receiptWidth: localStorage.getItem('pos_mobile_paper_width') || '58mm' },
      exchangeRate,
      currencyMode: activeCurrencyMode
    });
    showToast('Imprimiendo ticket de preventa...');
  }, [businessInfo, exchangeRate, showToast]);

  const createConfirmSendWhatsApp = useCallback((generateEcoReceiptText) => () => {
    if (!whatsAppModalData) return;
    const phone = cleanWhatsAppPhone(whatsAppPhoneInput);
    if (!phone) {
      showToast('⚠️ Ingresa un número de WhatsApp válido');
      return;
    }
    const message = generateEcoReceiptText(whatsAppModalData);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    setWhatsAppModalData(null);
    showToast('Recibo digital enviado a WhatsApp');
  }, [whatsAppModalData, whatsAppPhoneInput, setWhatsAppModalData, showToast]);

  return {
    productFormData,
    setProductFormData,
    isCustomCategoryMode,
    setIsCustomCategoryMode,
    isSavingProduct,
    isUploadingImage,
    selectableCategories,
    openEditProduct,
    openCreateProduct,
    handleProductImageUpload,
    handleSaveProduct,
    generateInternalEanBarcode,
    copyBarcodeToClipboard,
    selectedCustomer,
    setSelectedCustomer,
    customerName,
    setCustomerName,
    customerDoc,
    setCustomerDoc,
    customerPhone,
    setCustomerPhone,
    customerSearch,
    setCustomerSearch,
    filteredCustomers,
    isCreatingCustomerInMobile,
    setIsCreatingCustomerInMobile,
    newCustomerForm,
    setNewCustomerForm,
    isSavingCustomer,
    handleSelectCustomer,
    handleSaveNewCustomer,
    whatsAppPhoneInput,
    setWhatsAppPhoneInput,
    cleanWhatsAppPhone,
    shareReceiptWhatsApp,
    sharePreSaleWhatsApp,
    createPrintPreSaleBluetooth,
    createConfirmSendWhatsApp
  };
}
