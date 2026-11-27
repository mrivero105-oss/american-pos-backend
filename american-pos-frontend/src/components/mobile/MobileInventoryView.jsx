import { useState, useEffect, useMemo, useRef, useDeferredValue, lazy, Suspense, useCallback } from 'react';
import {
  Search, 
  ArrowLeft, 
  Box, 
  Edit3, 
  Plus, 
  Save, 
  X, 
  RefreshCw, 
  ClipboardList, 
  CheckCircle2, 
  Scan, 
  Trash2, 
  Camera, 
  Percent, 
  Package,
  Clock
} from 'lucide-react';
import api from '../../services/api';
import { db as primaryDb } from '../../services/db';
import localDb from '../../db/localDb';
import lanSyncService from '../../services/lanSyncService';
import CachedImage from '../CachedImage';
import MobileImageSearchModal from './MobileImageSearchModal';
import { triggerHaptic } from '../../utils/haptics';
import { normalizeProductImage } from '../../utils/imageProcess';
import { VoiceMicButton } from '../../utils/voiceSearch';
import { useFuzzySearch } from '../../hooks/useFuzzySearch';
import VirtualProductList from '../common/VirtualProductList';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';
import { useOfflineQueueCounts } from '../../hooks/useOfflineQueueCounts';

const MobileBarcodeScannerModal = lazy(() => import('../MobileBarcodeScannerModal'));

const MOBILE_INVENTORY_COLUMNS = { default: 1, md: 2, xl: 3 };

export default function MobileInventoryView({
  products = [],
  categories = [],
  exchangeRate = 950,
  T,
  isLight,
  canCreateProducts = true,
  canManageInventory = true,
  canDeleteProducts = true,
  canAdjustStock = true,
  canViewCosts = true,
  onBackToPOS,
  onOpenSyncCenter = null,
  onProductUpdated,
  onProductCreated,
  onProductDeleted,
  showToast
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState('Todos');
  const [stockFilter, setStockFilter] = useState('all'); // 'all' | 'low' | 'out'
  const { counts: offlineCounts } = useOfflineQueueCounts();

  // --- MODAL DE CREACIÓN Y EDICIÓN COMPLETA DE PRODUCTO ---
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const {
    modalOverlayStyle,
    modalCardMaxHeightStyle,
    handleFieldFocusCapture,
    handleFormKeyDown
  } = useMobileKeyboardViewport({ enabled: isProductModalOpen });
  const [editingProduct, setEditingProduct] = useState(null); // null = nuevo, obj = editar
  const [productFormData, setProductFormData] = useState({
    name: '',
    barcode: '',
    category: 'General',
    costUSD: '',
    margin: '30',
    priceUSD: '',
    priceBS: '',
    stock: '10',
    minStock: '2',
    taxStatus: 'gravable',
    imageUri: ''
  });
  const [isCustomCategoryMode, setIsCustomCategoryMode] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isImageSearchModalOpen, setIsImageSearchModalOpen] = useState(false);
  const fileInputRef = useRef(null);

  // --- MODAL DE CONFIRMACIÓN DE ELIMINACIÓN ---
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { product }
  const [isDeleting, setIsDeleting] = useState(false);

  // --- MODO CONTEO FÍSICO / AUDITORÍA DE INVENTARIO ---
  const [isAuditMode, setIsAuditMode] = useState(false);
  const [auditCounts, setAuditCounts] = useState({}); // { [productId]: countedQty }
  const [auditScanInput, setAuditScanInput] = useState('');
  const [isApplyingAudit, setIsApplyingAudit] = useState(false);
  const [isAuditScannerOpen, setIsAuditScannerOpen] = useState(false);
  const auditInputRef = useRef(null);

  // Lista de categorías normalizadas y seleccionables
  const selectableCategories = useMemo(() => {
    const set = new Set();
    categories.forEach(c => {
      if (c && c !== 'Todos') set.add(c);
    });
    products.forEach(p => {
      const c = p.category || p.categoria;
      if (c && c !== 'Todos') set.add(c);
    });
    const arr = Array.from(set).filter(Boolean);
    if (!arr.includes('General')) arr.unshift('General');
    return arr;
  }, [categories, products]);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const inventoryScrollRef = useRef(null);

  // Búsqueda off-main-thread con pre-indexado O(1) por categoría/barcode para 5.000+ SKUs
  const fuzzyInventoryProducts = useFuzzySearch(products, deferredSearchQuery, {
    category: selectedCat === 'Todos' ? '' : selectedCat,
    maxResults: 1000,
    enableSemantic: false
  });

  // Orden reactivo + filtro rápido de Stock Bajo / Agotados
  const filteredProducts = useMemo(() => {
    const hasQuery = Boolean(deferredSearchQuery && deferredSearchQuery.trim());
    const byStock = stockFilter === 'all'
      ? fuzzyInventoryProducts
      : fuzzyInventoryProducts.filter((p) => {
          const isService = Boolean(p.isService || String(p.category || p.categoria || '').trim().toLowerCase() === 'servicios');
          if (isService) return false;
          const st = Number(p.stockQuantity ?? p.stock ?? 0);
          const lowThreshold = Math.max(1, Number(p.minStock ?? 5) || 5);
          if (stockFilter === 'out') return st <= 0;
          if (stockFilter === 'low') return st > 0 && st <= lowThreshold;
          return true;
        });

    return [...byStock].sort((a, b) => {
      const isServiceA = Boolean(a.isService || String(a.category || a.categoria || '').trim().toLowerCase() === 'servicios');
      const isServiceB = Boolean(b.isService || String(b.category || b.categoria || '').trim().toLowerCase() === 'servicios');
      const stockA = Number(a.stockQuantity ?? a.stock ?? 0);
      const stockB = Number(b.stockQuantity ?? b.stock ?? 0);
      const outA = (!isServiceA && stockA <= 0) ? 1 : 0;
      const outB = (!isServiceB && stockB <= 0) ? 1 : 0;
      if (outA !== outB) return outA - outB;
      if (hasQuery) return 0;
      const nameA = (a.name || a.nombre || '').toLowerCase();
      const nameB = (b.name || b.nombre || '').toLowerCase();
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });
  }, [fuzzyInventoryProducts, deferredSearchQuery, stockFilter]);

  useEffect(() => {
    if (inventoryScrollRef.current) {
      inventoryScrollRef.current.scrollTop = 0;
    }
  }, [deferredSearchQuery, selectedCat, stockFilter]);

  // Métricas rápidas de inventario (consistentes con los chips de filtro)
  const stats = useMemo(() => {
    let outCount = 0;
    let lowCount = 0;
    products.forEach(p => {
      const isService = Boolean(p.isService || String(p.category || p.categoria || '').trim().toLowerCase() === 'servicios');
      if (isService) return;
      const st = Number(p.stockQuantity ?? p.stock ?? 0);
      const lowThreshold = Math.max(1, Number(p.minStock ?? 5) || 5);
      if (st <= 0) outCount++;
      else if (st <= lowThreshold) lowCount++;
    });
    return { total: products.length, outOfStock: outCount, lowStock: lowCount };
  }, [products]);

  // Métricas del Conteo Físico
  const auditStats = useMemo(() => {
    const auditedIds = Object.keys(auditCounts);
    let totalDifferences = 0;
    let discrepanciesCount = 0;

    auditedIds.forEach(id => {
      const prod = products.find(p => String(p.id) === String(id));
      if (prod) {
        const theoretical = Number(prod.stockQuantity ?? prod.stock ?? 0);
        const physical = Number(auditCounts[id]);
        const diff = physical - theoretical;
        if (diff !== 0) {
          discrepanciesCount++;
          totalDifferences += diff;
        }
      }
    });

    return {
      auditedTotal: auditedIds.length,
      discrepanciesCount,
      totalDifferences
    };
  }, [auditCounts, products]);

  // Abrir Modal para Crear Producto Nuevo
  const handleOpenCreateProduct = () => {
    triggerHaptic(20);
    setEditingProduct(null);
    setProductFormData({
      name: '',
      barcode: `750${Math.floor(100000000 + Math.random() * 900000000)}`,
      category: selectedCat !== 'Todos' ? selectedCat : 'General',
      costUSD: '',
      margin: '30',
      priceUSD: '',
      priceBS: '',
      stock: '10',
      minStock: '2',
      taxStatus: 'gravable',
      imageUri: '',
      // Presentaciones al mayor / empaque
      bulkUnitName: 'Caja',
      unitsPerBulk: '',
      bulkPrice: '',
      bulkBarcode: '',
      enableMidBulk: false,
      midBulkUnitName: 'Media Caja',
      unitsPerMidBulk: '',
      midBulkPrice: '',
      midBulkBarcode: ''
    });
    setIsCustomCategoryMode(false);
    setIsProductModalOpen(true);
  };

  // Abrir Modal para Editar Producto Completo
  const handleOpenEditProduct = (p) => {
    triggerHaptic(20);
    setEditingProduct(p);

    const priceU = Number(p.price || p.precio || 0);
    const priceB = Number(p.priceBs) > 0 ? Number(p.priceBs) : (priceU * exchangeRate);
    const costU = Number(p.cost || p.costo || 0);
    const computedMargin = (p.margin !== undefined && p.margin !== null && String(p.margin) !== '')
      ? Number(p.margin).toFixed(1).replace(/\.0$/, '')
      : (costU > 0 && priceU > 0 ? (((priceU - costU) / costU) * 100).toFixed(1).replace(/\.0$/, '') : '30');

    const upb = Number(p.unitsPerBulk || 0);
    const bp = Number(p.bulkPrice || 0);
    const upmb = Number(p.unitsPerMidBulk || 0);
    const mbp = Number(p.midBulkPrice || 0);

    setProductFormData({
      name: p.name || p.nombre || '',
      barcode: p.barcode || p.codigo_barras || '',
      category: p.category || p.categoria || 'General',
      costUSD: costU > 0 ? String(costU) : '',
      margin: computedMargin,
      priceUSD: priceU ? String(priceU) : '',
      priceBS: priceB ? String(priceB.toFixed(2)) : '',
      stock: String(p.stockQuantity ?? p.stock ?? 0),
      minStock: String(p.minStock ?? 2),
      taxStatus: p.taxStatus || 'gravable',
      imageUri: p.imageUrl || p.imageUri || p.image || '',
      // Presentaciones al mayor / empaque
      bulkUnitName: p.bulkUnitName || 'Caja',
      unitsPerBulk: upb > 1 ? String(upb) : '',
      bulkPrice: bp > 0 ? String(bp) : '',
      bulkBarcode: p.bulkBarcode || '',
      enableMidBulk: Boolean(upmb > 1 || mbp > 0),
      midBulkUnitName: p.midBulkUnitName || 'Media Caja',
      unitsPerMidBulk: upmb > 1 ? String(upmb) : '',
      midBulkPrice: mbp > 0 ? String(mbp) : '',
      midBulkBarcode: p.midBulkBarcode || ''
    });
    setIsCustomCategoryMode(false);
    setIsProductModalOpen(true);
  };

  // Generar Código EAN Interno
  const handleGenerateEanBarcode = () => {
    const randomDigits = Math.floor(Math.random() * 90000000000) + 10000000000;
    const code = `99${randomDigits}`;
    setProductFormData(prev => ({ ...prev, barcode: code }));
    triggerHaptic(20);
    showToast?.('✨ Código interno EAN generado');
  };

  // Subir o Cambiar Foto de Producto
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      showToast?.('⚠️ La imagen es demasiado pesada (máx 12MB)');
      return;
    }

    setIsUploadingImage(true);
    try {
      let base64 = '';
      try {
        // Comprime y estandariza fotos de cámara móvil a 500x500 WebP/JPEG (~25-40 KB)
        base64 = await normalizeProductImage(file, { size: 500, mode: 'contain', quality: 0.84 });
      } catch (_normErr) {
        base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });
      }

      let imgUri = '';
      try {
        const res = await api.post('/products/upload-image', {
          base64,
          productId: editingProduct?.id || 'new'
        }, { timeout: 6000 });
        imgUri = res.data?.imageUri || '';
        showToast?.('✅ Foto optimizada y cargada con éxito');
      } catch (_uploadErr) {
        imgUri = base64;
        showToast?.('⚡ Foto optimizada guardada localmente');
      }
      setProductFormData(prev => ({ ...prev, imageUri: imgUri }));
    } catch (_err) {
      showToast?.('❌ Error al procesar imagen');
    } finally {
      setIsUploadingImage(false);
    }
  };

  // Guardar Cambios de Producto (Crear o Actualizar)
  const handleSaveProduct = async (e) => {
    e?.preventDefault();
    if (!editingProduct && !canCreateProducts) {
      showToast?.('⛔ No tienes permisos para crear productos');
      return;
    }
    if (editingProduct && !canManageInventory) {
      showToast?.('⛔ No tienes permisos para editar productos');
      return;
    }
    const name = productFormData.name.trim();
    const price = parseFloat(productFormData.priceUSD);
    const stock = parseFloat(productFormData.stock);
    const cost = canViewCosts ? (parseFloat(productFormData.costUSD) || 0) : undefined;
    const margin = canViewCosts
      ? (parseFloat(productFormData.margin) || (cost > 0 && price > 0 ? Number((((price - cost) / cost) * 100).toFixed(2)) : 0))
      : undefined;
    const barcode = productFormData.barcode.trim();
    const minStock = parseFloat(productFormData.minStock) || 0;

    if (!name) {
      showToast?.('El producto debe tener un nombre');
      return;
    }
    if (isNaN(price) || price < 0) {
      showToast?.('Ingresa un precio válido en USD');
      return;
    }
    if (isNaN(stock) || stock < 0) {
      showToast?.('Ingresa un stock numérico válido');
      return;
    }

    setIsSavingProduct(true);
    const unitsPerBulk = parseFloat(productFormData.unitsPerBulk) || 0;
    const bulkPrice = parseFloat(productFormData.bulkPrice) || 0;
    const bulkPriceBs = bulkPrice > 0 ? (bulkPrice * exchangeRate) : 0;
    const bulkUnitName = productFormData.bulkUnitName?.trim() || 'Caja';
    const bulkBarcode = productFormData.bulkBarcode?.trim() || null;

    const enableMidBulk = Boolean(productFormData.enableMidBulk);
    const unitsPerMidBulk = enableMidBulk ? (parseFloat(productFormData.unitsPerMidBulk) || 0) : 0;
    const midBulkPrice = enableMidBulk ? (parseFloat(productFormData.midBulkPrice) || 0) : 0;
    const midBulkPriceBs = midBulkPrice > 0 ? (midBulkPrice * exchangeRate) : 0;
    const midBulkUnitName = enableMidBulk ? (productFormData.midBulkUnitName?.trim() || 'Media Caja') : 'Media Caja';
    const midBulkBarcode = enableMidBulk ? (productFormData.midBulkBarcode?.trim() || null) : null;

    const payload = {
      name,
      nombre: name,
      barcode,
      category: productFormData.category || 'General',
      categoria: productFormData.category || 'General',
      price,
      precio: price,
      priceBs: price * exchangeRate,
      ...(canViewCosts ? { cost, costo: cost, margin } : {}),
      stockQuantity: stock,
      stock: stock,
      minStock,
      taxStatus: productFormData.taxStatus,
      imageUri: productFormData.imageUri || null,
      imageUrl: productFormData.imageUri || null,
      // Presentaciones al mayor / empaque
      bulkUnitName,
      unitsPerBulk: unitsPerBulk > 1 ? unitsPerBulk : 0,
      bulkPrice: bulkPrice > 0 ? bulkPrice : 0,
      bulkPriceBs: bulkPriceBs > 0 ? bulkPriceBs : 0,
      bulkBarcode,
      midBulkUnitName,
      unitsPerMidBulk: unitsPerMidBulk > 1 ? unitsPerMidBulk : 0,
      midBulkPrice: midBulkPrice > 0 ? midBulkPrice : 0,
      midBulkPriceBs: midBulkPriceBs > 0 ? midBulkPriceBs : 0,
      midBulkBarcode
    };

    try {
      let savedProd;
      if (editingProduct) {
        // ACTUALIZAR PRODUCTO EXISTENTE
        const prodId = editingProduct.id;
        const res = await api.put(`/products/${prodId}`, payload, { timeout: 5000 });
        savedProd = res.data?.product || res.data || { ...editingProduct, ...payload, id: prodId };
        
        onProductUpdated?.(savedProd);
        showToast?.(`✅ "${name}" actualizado y sincronizado en PC`);
      } else {
        // CREAR NUEVO PRODUCTO
        const res = await api.post('/products', payload, { timeout: 5000 });
        savedProd = res.data?.product || res.data || { ...payload, id: `p_${Date.now()}` };
        
        onProductCreated?.(savedProd);
        showToast?.(`✅ Producto "${name}" creado exitosamente`);
      }

      // Actualizar almacenamiento local
      try {
        if (localDb && localDb.products) {
          await localDb.products.put(savedProd);
        }
        await primaryDb.put('products', savedProd);
      } catch (caughtErr) { console.warn('[MobileInventoryView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

      // Emitir eventos en tiempo real al Socket.IO
      try {
        if (lanSyncService && lanSyncService.socket) {
          lanSyncService.socket.emit('product_updated', savedProd);
          lanSyncService.socket.emit('inventory_changed', { timestamp: Date.now() });
        }
      } catch (caughtErr) { console.warn('[MobileInventoryView] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

      setIsProductModalOpen(false);
      setEditingProduct(null);
    } catch (err) {
      const httpStatus = err?.response?.status;
      if (httpStatus >= 400 && httpStatus < 500) {
        const msg = err?.response?.data?.message || err?.response?.data?.error || `Operación rechazada por el servidor (${httpStatus})`;
        showToast?.(`⛔ ${msg}`);
        return;
      }
      console.warn('Servidor PC inaccesible, guardando producto offline:', err);
      const fallbackId = editingProduct ? editingProduct.id : `off_prod_${Date.now()}`;
      const fallbackProd = { ...payload, id: fallbackId };

      if (editingProduct) {
        onProductUpdated?.(fallbackProd);
      } else {
        onProductCreated?.(fallbackProd);
      }

      try {
        if (localDb && localDb.products) {
          await localDb.products.put(fallbackProd);
        }
        await primaryDb.put('products', fallbackProd);
        await primaryDb.put('syncQueue', {
          id: `prod_sync_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          tempLocalId: fallbackId,
          endpoint: editingProduct ? `/products/${fallbackId}` : '/products',
          method: editingProduct ? 'PUT' : 'POST',
          payload,
          createdAt: new Date().toISOString()
        });
      } catch (caughtErr) { console.warn('[MobileInventoryView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }

      showToast?.(`⚡ Guardado offline en teléfono. Se sincronizará con la PC.`);
      setIsProductModalOpen(false);
      setEditingProduct(null);
    } finally {
      setIsSavingProduct(false);
    }
  };

  // Solicitar Eliminación de Producto
  const handleRequestDelete = (p) => {
    setDeleteConfirm({
      product: p,
      message: `¿Estás seguro de que deseas eliminar permanentemente el producto "${p.name || p.nombre}" del inventario?`
    });
  };

  // Ejecutar Eliminación de Producto
  const handleExecuteDelete = async () => {
    if (!deleteConfirm?.product) return;
    const p = deleteConfirm.product;
    const prodId = p.id;
    setIsDeleting(true);

    try {
      await api.delete(`/products/${prodId}`, { timeout: 4000 });
      onProductDeleted?.(prodId);

      try {
        if (localDb && localDb.products) {
          await localDb.products.delete(prodId);
        }
        await primaryDb.delete('products', prodId);
      } catch (caughtErr) { console.warn('[MobileInventoryView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

      try {
        if (lanSyncService && lanSyncService.socket) {
          lanSyncService.socket.emit('inventory_changed', { timestamp: Date.now() });
        }
      } catch (caughtErr) { console.warn('[MobileInventoryView] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }

      showToast?.(`✅ Producto "${p.name || p.nombre}" eliminado`);
      setDeleteConfirm(null);
      if (editingProduct?.id === prodId) {
        setIsProductModalOpen(false);
        setEditingProduct(null);
      }
    } catch (err) {
      console.error('Error al eliminar producto:', err);
      const msg = err.response?.data?.error || err.response?.data?.message || 'Error al eliminar producto';
      showToast?.(`❌ ${msg}`);
      setDeleteConfirm(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Registrar escaneo en Modo Conteo Físico (soporta lector manual, pistola BT y cámara en ráfaga)
  const processAuditBarcode = useCallback((rawCode) => {
    const query = String(rawCode || '').trim();
    if (!query) return false;
    const qLower = query.toLowerCase();

    const found = products.find(p => 
      (p.barcode && String(p.barcode).toLowerCase() === qLower) ||
      (p.codigo_barras && String(p.codigo_barras).toLowerCase() === qLower) ||
      (p.bulkBarcode && String(p.bulkBarcode).toLowerCase() === qLower) ||
      (p.name && p.name.toLowerCase() === qLower) ||
      (p.nombre && p.nombre.toLowerCase() === qLower)
    ) || products.find(p =>
      (p.name && p.name.toLowerCase().includes(qLower)) ||
      (p.nombre && p.nombre.toLowerCase().includes(qLower))
    );

    if (found) {
      triggerHaptic(25);
      const prodId = String(found.id);
      const currentTheoretical = Number(found.stockQuantity ?? found.stock ?? 0);
      setAuditCounts((prev) => {
        const currentCount = prev[prodId] !== undefined ? Number(prev[prodId]) : currentTheoretical;
        const nextCount = currentCount + 1;
        showToast?.(`+1 ${found.name || found.nombre} (Contado: ${nextCount})`);
        return {
          ...prev,
          [prodId]: nextCount
        };
      });
      setAuditScanInput('');
      return true;
    }

    triggerHaptic(60);
    showToast?.(`Producto no encontrado para el código: ${query}`);
    return false;
  }, [products, showToast]);

  const handleAuditScanSubmit = (e) => {
    e?.preventDefault();
    processAuditBarcode(auditScanInput);
  };

  // Modificar conteo manual de un producto en auditoría
  const handleSetAuditCount = (prodId, count) => {
    triggerHaptic(15);
    const parsed = Math.max(0, parseFloat(count) || 0);
    setAuditCounts(prev => ({
      ...prev,
      [String(prodId)]: parsed
    }));
  };

  // Aplicar ajustes del conteo físico
  const handleApplyAuditAdjustments = async () => {
    const auditedIds = Object.keys(auditCounts);
    if (auditedIds.length === 0) {
      showToast?.('No has registrado ningún producto en el conteo');
      return;
    }

    const changedProducts = auditedIds.filter(id => {
      const prod = products.find(p => String(p.id) === String(id));
      if (!prod) return false;
      const theoretical = Number(prod.stockQuantity ?? prod.stock ?? 0);
      return Number(auditCounts[id]) !== theoretical;
    });

    if (changedProducts.length === 0) {
      showToast?.('El conteo físico coincide exactamente con el sistema.');
      setIsAuditMode(false);
      setAuditCounts({});
      return;
    }

    setIsApplyingAudit(true);
    let successCount = 0;

    for (const id of changedProducts) {
      const prod = products.find(p => String(p.id) === String(id));
      if (!prod) continue;
      const newStock = Number(auditCounts[id]);
      const updatedProd = {
        ...prod,
        stockQuantity: newStock,
        stock: newStock
      };

      try {
        await api.put(`/products/${id}`, { stockQuantity: newStock }, { timeout: 3500 });
        successCount++;
      } catch (err) {
        console.warn('[MobileInventoryView] Error capturado en operación:', err?.message || err);
        try {
          await primaryDb.put('syncQueue', {
            id: `audit_${Date.now()}_${id}`,
            endpoint: `/products/${id}`,
            method: 'PUT',
            payload: { stockQuantity: newStock },
            createdAt: new Date().toISOString()
          });
          successCount++;
        } catch (caughtErr) { console.warn('[MobileInventoryView] Error encolando operación en syncQueue:', caughtErr?.message || caughtErr); }
      }

      try {
        await primaryDb.put('products', updatedProd);
        if (localDb && localDb.products) {
          await localDb.products.put(updatedProd);
        }
      } catch (caughtErr) { console.warn('[MobileInventoryView] Error en almacenamiento local IndexedDB:', caughtErr?.message || caughtErr); }

      onProductUpdated?.(updatedProd);
    }

    if (lanSyncService && lanSyncService.socket) {
      lanSyncService.socket.emit('inventory_changed');
    }

    setIsApplyingAudit(false);
    setIsAuditMode(false);
    setAuditCounts({});
    showToast?.(`✅ Conteo físico aplicado con éxito a ${successCount} productos`);
  };

  return (
    <div className={`flex flex-col h-full ${T.cardBg} animate-fadeIn`}>
      {/* 1. HEADER DE INVENTARIO */}
      <div className={`p-3.5 border-b ${T.border} flex items-center justify-between shrink-0 ${T.subPanelBg}`}>
        <div className="flex items-center gap-2">
          <button 
            onClick={onBackToPOS}
            className={`p-1.5 rounded-xl ${T.btnGhost} flex items-center gap-1 text-xs font-bold cursor-pointer`}
            title="Volver a Terminal POS"
          >
            <ArrowLeft size={16} />
            <span className="hidden xs:inline">POS</span>
          </button>
          <div>
            <h2 className={`font-black text-sm sm:text-base ${T.textPrimary} flex items-center gap-1.5`}>
              <Box size={16} className="text-blue-500 shrink-0" />
              <span>Inventario</span>
            </h2>
            <p className={`text-[10px] ${T.textMuted}`}>
              {stats.total} productos registrados
            </p>
          </div>
        </div>

        {/* Acciones del Header: Badge pendientes + Botón + Nuevo + Botón Conteo */}
        <div className="flex items-center gap-1.5 shrink-0">
          {offlineCounts.inventory > 0 && (
            <button
              type="button"
              onClick={() => onOpenSyncCenter?.()}
              className="px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-500 text-[10px] font-black flex items-center gap-1 cursor-pointer active:scale-95"
              title="Cambios de inventario pendientes por sincronizar"
            >
              <Clock size={11} />
              <span>{offlineCounts.inventory}</span>
            </button>
          )}
          {canCreateProducts && (
            <button
              type="button"
              onClick={handleOpenCreateProduct}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <Plus size={14} />
              <span>+ Nuevo</span>
            </button>
          )}

          {canAdjustStock && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(20);
                setIsAuditMode(prev => !prev);
                if (!isAuditMode) {
                  setTimeout(() => auditInputRef.current?.focus(), 200);
                }
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap ${
                isAuditMode 
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' 
                  : `${T.btnGhost} text-amber-500 hover:bg-amber-500/10`
              }`}
              title="Toma de Inventario / Conteo Físico"
            >
              <ClipboardList size={14} />
              <span className="hidden sm:inline">{isAuditMode ? 'Terminar' : 'Conteo'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. PANEL DE CONTEO FÍSICO / AUDITORÍA EN TIEMPO REAL */}
      {isAuditMode && (
        <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 shrink-0 space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <p className="text-xs font-black text-amber-700 dark:text-amber-300">
                Toma de Inventario en Curso
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <span className={T.textSecondary}>
                Auditados: <b className="text-slate-900 dark:text-white">{auditStats.auditedTotal}</b>
              </span>
              {auditStats.discrepanciesCount > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-700 dark:text-rose-300 font-black">
                  {auditStats.discrepanciesCount} con diferencias
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleAuditScanSubmit} className="flex items-center gap-1.5">
            <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl ${T.inputBg} border border-amber-500/30 min-h-[44px]`}>
              <Scan size={15} className="text-amber-400 shrink-0" />
              <input 
                ref={auditInputRef}
                type="text"
                enterKeyHint="done"
                placeholder="Escanear código para contar (+1)..."
                value={auditScanInput}
                onChange={(e) => setAuditScanInput(e.target.value)}
                className={`bg-transparent flex-1 text-base sm:text-sm outline-none ${T.textPrimary} font-bold`}
              />
              {auditScanInput && (
                <button type="button" onClick={() => setAuditScanInput('')} className={T.textMuted}>
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setIsAuditScannerOpen(true);
              }}
              title="Abrir cámara para conteo físico (+1)"
              aria-label="Escanear con cámara para conteo"
              className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/40 font-black text-xs flex items-center justify-center gap-1 cursor-pointer shadow-md transition-all active:scale-95 shrink-0"
            >
              <Camera size={16} />
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer shadow-md transition-all active:scale-95 shrink-0"
            >
              Contar
            </button>
          </form>

          {auditStats.auditedTotal > 0 && (
            <button
              type="button"
              onClick={handleApplyAuditAdjustments}
              disabled={isApplyingAudit}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all disabled:opacity-50"
            >
              {isApplyingAudit ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              <span>
                {isApplyingAudit ? 'Aplicando Ajustes a Servidor...' : `Aplicar Ajustes de Conteo (${auditStats.discrepanciesCount} diferencias)`}
              </span>
            </button>
          )}
        </div>
      )}

      {/* 3. BARRA DE BÚSQUEDA Y CATEGORÍAS */}
      <div className={`p-2.5 border-b ${T.border} space-y-2 shrink-0 ${T.subPanelBg}`}>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${T.inputBg} border ${T.border}`}>
          <Search size={14} className={T.textMuted} />
          <input 
            type="text"
            enterKeyHint="search"
            autoComplete="on"
            autoCorrect="on"
            spellCheck={true}
            placeholder="Buscar o dictar producto o código..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`bg-transparent flex-1 text-base sm:text-sm outline-none ${T.textPrimary} font-medium select-text`}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className={T.textMuted}>
              <X size={13} />
            </button>
          )}
          <VoiceMicButton
            size={14}
            prompt="Di el producto que buscas en inventario..."
            onResult={(spokenText) => setSearchQuery(spokenText)}
            onError={(errMsg) => showToast?.(`🎤 ${errMsg}`)}
          />
        </div>

        {/* Filtros Rápidos de Stock: Todos | Stock Bajo | Agotados */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setStockFilter('all');
            }}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-black whitespace-nowrap transition-all cursor-pointer border ${
              stockFilter === 'all'
                ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                : `${T.btnGhost} ${T.border} ${T.textMuted}`
            }`}
          >
            Todos ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setStockFilter(prev => (prev === 'low' ? 'all' : 'low'));
            }}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-black whitespace-nowrap transition-all cursor-pointer border ${
              stockFilter === 'low'
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-xs'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
            }`}
          >
            Stock Bajo ({stats.lowStock})
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              setStockFilter(prev => (prev === 'out' ? 'all' : 'out'));
            }}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-black whitespace-nowrap transition-all cursor-pointer border ${
              stockFilter === 'out'
                ? 'bg-rose-600 text-white border-rose-500 shadow-xs'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
            }`}
          >
            Agotados ({stats.outOfStock})
          </button>
        </div>

        {/* Chips de Categorías */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          {['Todos', ...selectableCategories].map((cat, idx) => {
            const isSelected = selectedCat === cat;
            return (
              <button
                key={idx}
                onClick={() => setSelectedCat(cat)}
                className={`px-3 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected 
                    ? 'bg-blue-600 text-white shadow-xs' 
                    : `${T.btnGhost} ${T.textMuted}`
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. LISTADO VIRTUALIZADO DE PRODUCTOS */}
      <div
        ref={inventoryScrollRef}
        className="flex-1 overflow-y-auto p-2.5 sm:p-3 custom-scrollbar"
      >
        {filteredProducts.length === 0 ? (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center p-6 text-center space-y-2">
            <Box size={36} className={T.textMuted} />
            <p className={`font-bold text-xs sm:text-sm ${T.textPrimary}`}>No se encontraron productos</p>
            <p className={`text-[11px] ${T.textMuted}`}>Usa el botón &ldquo;+ Nuevo&rdquo; para agregar un producto</p>
          </div>
        ) : (
          <VirtualProductList
            items={filteredProducts}
            scrollElementRef={inventoryScrollRef}
            columns={MOBILE_INVENTORY_COLUMNS}
            breakpointSource="window"
            gap={10}
            estimateSize={isAuditMode ? 156 : 148}
            overscan={4}
            layoutKey={isAuditMode ? 'audit' : 'normal'}
            itemWrapperClassName="h-full flex flex-col"
            renderItem={(p) => {
              const prodId = String(p.id);
              const theoreticalStock = Number(p.stockQuantity ?? p.stock ?? 0);
              const priceUSD = Number(p.price ?? p.precio ?? 0);
              const priceBS = Number(p.priceBs) > 0 ? Number(p.priceBs) : (priceUSD * exchangeRate);
              const costUSD = Number(p.cost || p.costo || 0);
              const margin = (p.margin !== undefined && p.margin !== null && String(p.margin) !== '')
                ? Number(p.margin)
                : (costUSD > 0 && priceUSD > 0 ? (((priceUSD - costUSD) / costUSD) * 100) : null);
              const isExhausted = theoreticalStock <= 0;

              // Datos de auditoría
              const isAudited = auditCounts[prodId] !== undefined;
              const physicalStock = isAudited ? auditCounts[prodId] : theoreticalStock;
              const difference = physicalStock - theoreticalStock;

              return (
                <div 
                  className={`${T.ticketItemBg} h-full p-3 rounded-2xl flex flex-col justify-between gap-2.5 border ${
                    isAuditMode && isAudited 
                      ? difference === 0 
                        ? 'border-emerald-500/40 bg-emerald-500/5' 
                        : 'border-amber-500/50 bg-amber-500/5'
                      : `${T.border} hover:border-blue-500/30`
                  } transition-all shadow-2xs`}
                >
                  {/* Fila Superior: Nombre, Badges y Precios */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-black text-xs sm:text-sm ${T.textPrimary} truncate`}>
                        {p.name || p.nombre}
                      </h4>

                      <div className="flex items-center gap-1.5 mt-1 text-[11px] flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md text-[9.5px] font-black ${
                          isExhausted 
                            ? 'bg-rose-500/20 text-rose-500' 
                            : theoreticalStock <= 5 
                            ? 'bg-amber-500/20 text-amber-500' 
                            : 'bg-emerald-500/20 text-emerald-500'
                        }`}>
                          {isExhausted ? 'Agotado' : `${theoreticalStock.toFixed(0)} en sistema`}
                        </span>
                        <span className={`text-[10px] ${T.textMuted} truncate`}>
                          {p.category || p.categoria || 'General'}
                        </span>
                        {p.barcode && (
                          <span className={`text-[9.5px] font-mono ${T.textMuted} truncate`}>
                            #{p.barcode}
                          </span>
                        )}
                        {Number(p.unitsPerBulk) > 1 && Number(p.bulkPrice) > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-300 font-bold text-[9px] flex items-center gap-1 border border-purple-500/20">
                            <Package size={10} />
                            {p.bulkUnitName || 'Caja'} x{Number(p.unitsPerBulk)} (${Number(p.bulkPrice).toFixed(2)})
                          </span>
                        )}
                      </div>

                      {/* Información de Costo y Margen de Ganancia (solo con permiso canViewCosts) */}
                      {canViewCosts && (costUSD > 0 || margin !== null) && (
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 font-semibold">
                          {costUSD > 0 && <span>Costo: ${costUSD.toFixed(2)}</span>}
                          {margin !== null && (
                            <span className="text-emerald-500 font-bold">
                              Margen: {margin.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Precios Destacados */}
                    <div className="text-right shrink-0">
                      <div className="font-black text-sm text-emerald-500">
                        ${priceUSD.toFixed(2)}
                      </div>
                      <div className={`text-[10px] font-semibold ${T.textSecondary}`}>
                        Bs. {priceBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  {/* Fila Inferior: Conteo Físico O Barra de Acciones */}
                  {isAuditMode ? (
                    <div className="pt-2 border-t border-dashed border-slate-700/30 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold text-slate-400 mr-1">Físico:</span>
                        <button
                          type="button"
                          onClick={() => handleSetAuditCount(prodId, physicalStock - 1)}
                          className="w-11 h-11 rounded-lg bg-slate-800 text-white font-black text-sm flex items-center justify-center hover:bg-slate-700 cursor-pointer active:scale-95"
                        >
                          -
                        </button>
                        <input 
                          type="number"
                          value={physicalStock}
                          onChange={(e) => handleSetAuditCount(prodId, e.target.value)}
                          className="w-14 h-11 text-center text-xs font-black bg-slate-900 border border-slate-700 rounded-lg text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleSetAuditCount(prodId, physicalStock + 1)}
                          className="w-11 h-11 rounded-lg bg-slate-800 text-white font-black text-sm flex items-center justify-center hover:bg-slate-700 cursor-pointer active:scale-95"
                        >
                          +
                        </button>
                      </div>

                      {difference === 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                          Exacto (0)
                        </span>
                      ) : difference > 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400 text-[10px] font-bold">
                          +{difference} Sobrante
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 text-[10px] font-bold">
                          {difference} Faltante
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className={`pt-2 border-t ${T.border} flex items-center justify-between gap-1.5`}>
                      <span className={`text-[10px] ${T.textMuted} font-mono truncate`}>
                        {p.taxStatus === 'exento' ? 'Exento' : 'Gravable'}
                      </span>

                      {/* Botones de Acción: Editar y Eliminar según permisos granulares */}
                      <div className="flex items-center gap-1.5">
                        {canDeleteProducts && (
                          <button
                            onClick={() => handleRequestDelete(p)}
                            className={`p-2 rounded-xl ${T.btnGhost} text-rose-500 hover:bg-rose-500/15 transition-all flex items-center justify-center cursor-pointer`}
                            title="Eliminar Producto"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}

                        {canManageInventory && (
                          <button
                            onClick={() => handleOpenEditProduct(p)}
                            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                            title="Editar Producto Completo"
                          >
                            <Edit3 size={13} />
                            <span>Editar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }}
          />
        )}
      </div>

      {/* 5. MODAL: CREAR / EDITAR PRODUCTO COMPLETO */}
      {isProductModalOpen && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4 backdrop-blur-xs animate-fadeIn overflow-y-auto"
          style={modalOverlayStyle}
        >
          <div
            className={`w-full max-w-md sm:max-w-lg ${T.modalCard} rounded-2xl sm:rounded-xl p-4 sm:p-5 shadow-2xl space-y-3.5 max-h-[92dvh] overflow-y-auto custom-scrollbar my-auto`}
            style={modalCardMaxHeightStyle}
          >
            {/* Header del Modal */}
            <div className={`flex items-center justify-between border-b ${T.border} pb-3`}>
              <div className="flex items-center gap-2">
                {editingProduct ? (
                  <Edit3 size={18} className="text-amber-500 shrink-0" />
                ) : (
                  <Plus size={18} className="text-blue-500 shrink-0" />
                )}
                <div>
                  <h3 className={`font-bold text-sm sm:text-base ${T.textPrimary}`}>
                    {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                  </h3>
                  <p className={`text-[10px] ${T.textMuted}`}>
                    {editingProduct ? `Modificando: ${editingProduct.name || editingProduct.nombre}` : 'Ingresa los datos del nuevo producto'}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsProductModalOpen(false)} 
                className={`p-1 rounded-lg ${T.btnGhost} text-slate-400 hover:text-rose-500`}
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleSaveProduct}
              onKeyDown={handleFormKeyDown}
              onFocusCapture={handleFieldFocusCapture}
              className="space-y-3"
            >
              {/* Foto del Producto */}
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div 
                    onClick={() => !isUploadingImage && fileInputRef.current?.click()}
                    className={`w-14 h-14 rounded-xl border overflow-hidden flex flex-col items-center justify-center relative cursor-pointer transition-colors ${
                      isLight 
                        ? 'bg-slate-50 border-slate-300 text-slate-400 hover:border-slate-400' 
                        : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'
                    }`}
                    title="Toca para subir foto"
                  >
                    {productFormData.imageUri ? (
                      <CachedImage 
                        src={productFormData.imageUri} 
                        alt="Producto" 
                        className="w-full h-full object-contain p-1 bg-white"
                      />
                    ) : (
                      <Camera size={18} />
                    )}
                    {isUploadingImage && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <RefreshCw size={14} className="animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  {productFormData.imageUri && (
                    <button
                      type="button"
                      onClick={() => setProductFormData(p => ({ ...p, imageUri: '' }))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center shadow-xs cursor-pointer"
                      title="Quitar foto"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <span className={`text-[11px] font-bold ${T.textSecondary} block mb-1`}>
                    Foto del Producto
                  </span>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageUpload}
                    className="hidden" 
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingImage}
                      className={`h-8.5 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-colors ${
                        isLight
                          ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                      title="Subir archivo o tomar foto con la cámara"
                    >
                      <Camera size={13} />
                      <span>{productFormData.imageUri ? 'Cambiar Foto' : 'Subir Foto'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(15);
                        setIsImageSearchModalOpen(true);
                      }}
                      className={`h-8.5 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-colors ${
                        isLight
                          ? 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-300'
                          : 'bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border-sky-500/30'
                      }`}
                      title="Buscar imagen comercial del producto en Google / Catálogo Web"
                    >
                      <Search size={13} />
                      <span>Buscar Imagen</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Nombre del Producto */}
              <div className="space-y-1">
                <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                  Nombre del Producto *
                </label>
                <input 
                  type="text" 
                  enterKeyHint="next"
                  required
                  value={productFormData.name}
                  onChange={(e) => setProductFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ej: Aceite Amanecer 500 ml"
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                />
              </div>

              {/* Código de Barras y Categoría */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider`}>
                      Código de Barras
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateEanBarcode}
                      className="text-[10px] font-bold text-blue-500 hover:underline cursor-pointer"
                    >
                      Generar EAN
                    </button>
                  </div>
                  <input 
                    type="text" 
                    enterKeyHint="next"
                    value={productFormData.barcode}
                    onChange={(e) => setProductFormData(p => ({ ...p, barcode: e.target.value }))}
                    placeholder="Escanear o escribir..."
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-mono font-bold outline-none`}
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider`}>
                      Categoría
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCustomCategoryMode(prev => !prev)}
                      className="text-[10px] font-bold text-blue-500 hover:underline cursor-pointer"
                    >
                      {isCustomCategoryMode ? 'Ver lista' : '+ Nueva'}
                    </button>
                  </div>
                  {isCustomCategoryMode ? (
                    <input 
                      type="text" 
                      enterKeyHint="next"
                      value={productFormData.category}
                      onChange={(e) => setProductFormData(p => ({ ...p, category: e.target.value }))}
                      placeholder="Nueva categoría..."
                      autoFocus
                      className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                    />
                  ) : (
                    <select
                      value={productFormData.category || 'General'}
                      onChange={(e) => setProductFormData(p => ({ ...p, category: e.target.value }))}
                      className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none cursor-pointer`}
                    >
                      {selectableCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* COSTO Y MARGEN DE GANANCIA (BIDIRECCIONAL INTELIGENTE - solo canViewCosts) */}
              {canViewCosts && (
              <div className="p-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 space-y-2">
                <div className="flex items-center gap-1.5 text-blue-500 text-xs font-black">
                  <Percent size={14} />
                  <span>Costo y Margen de Ganancia</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                      Costo ($ USD)
                    </label>
                    <div className="relative">
                      <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${T.textMuted}`}>$</span>
                      <input 
                        type="number" 
                        inputMode="decimal"
                        enterKeyHint="next"
                        step="0.01" 
                        value={productFormData.costUSD}
                        onChange={(e) => {
                          const val = e.target.value;
                          const costNum = parseFloat(val) || 0;
                          setProductFormData(p => {
                            const marginNum = parseFloat(p.margin);
                            if (costNum > 0 && !isNaN(marginNum) && String(p.margin).trim() !== '') {
                              const nextUsd = (costNum * (1 + marginNum / 100)).toFixed(2);
                              const nextBs = (parseFloat(nextUsd) * exchangeRate).toFixed(2);
                              return { ...p, costUSD: val, priceUSD: nextUsd, priceBS: nextBs };
                            }
                            return { ...p, costUSD: val };
                          });
                        }}
                        placeholder="0.00"
                        className={`w-full min-h-[44px] pl-6 pr-2.5 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                      Margen Ganancia (%)
                    </label>
                    <div className="relative">
                      <input 
                        type="number" 
                        inputMode="decimal"
                        enterKeyHint="next"
                        step="0.1" 
                        value={productFormData.margin ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const marginNum = parseFloat(val);
                          setProductFormData(p => {
                            const costNum = parseFloat(p.costUSD) || 0;
                            if (costNum > 0 && !isNaN(marginNum)) {
                              const nextUsd = (costNum * (1 + marginNum / 100)).toFixed(2);
                              const nextBs = (parseFloat(nextUsd) * exchangeRate).toFixed(2);
                              return { ...p, margin: val, priceUSD: nextUsd, priceBS: nextBs };
                            }
                            return { ...p, margin: val };
                          });
                        }}
                        placeholder="30"
                        className={`w-full min-h-[44px] pl-3 pr-6 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                      />
                      <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${T.textMuted}`}>%</span>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Precios: USD y Bs */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Precio de Venta ($ USD) *
                  </label>
                  <div className="relative">
                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-500`}>$</span>
                    <input 
                      type="number" 
                      inputMode="decimal"
                      enterKeyHint="next"
                      step="0.01" 
                      required
                      value={productFormData.priceUSD}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const costNum = parseFloat(p.costUSD) || 0;
                          const nextMargin = (costNum > 0 && num > 0)
                            ? (((num - costNum) / costNum) * 100).toFixed(1).replace(/\.0$/, '')
                            : p.margin;
                          return {
                            ...p,
                            priceUSD: val,
                            priceBS: num > 0 ? (num * exchangeRate).toFixed(2) : '',
                            margin: nextMargin
                          };
                        });
                      }}
                      placeholder="0.00"
                      className={`w-full min-h-[44px] pl-6 pr-2.5 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-black outline-none`}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Precio de Venta (Bs)
                  </label>
                  <div className="relative">
                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold ${T.textMuted}`}>Bs</span>
                    <input 
                      type="number" 
                      inputMode="decimal"
                      enterKeyHint="next"
                      step="0.1" 
                      value={productFormData.priceBS}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const nextUsdNum = num > 0 && exchangeRate > 0 ? (num / exchangeRate) : 0;
                          const costNum = parseFloat(p.costUSD) || 0;
                          const nextMargin = (costNum > 0 && nextUsdNum > 0)
                            ? (((nextUsdNum - costNum) / costNum) * 100).toFixed(1).replace(/\.0$/, '')
                            : p.margin;
                          return {
                            ...p,
                            priceBS: val,
                            priceUSD: nextUsdNum > 0 ? nextUsdNum.toFixed(2) : '',
                            margin: nextMargin
                          };
                        });
                      }}
                      placeholder="0.00"
                      className={`w-full min-h-[44px] pl-7 pr-2.5 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-bold outline-none`}
                    />
                  </div>
                </div>
              </div>

              {/* Stock Disponible y Botones de Ajuste Rápido */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Stock Disponible
                  </label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    enterKeyHint="next"
                    step="any" 
                    value={productFormData.stock}
                    onChange={(e) => setProductFormData(p => ({ ...p, stock: e.target.value }))}
                    placeholder="0"
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-base sm:text-sm font-black outline-none`}
                  />
                </div>

                <div className="space-y-1">
                  <label className={`text-[10px] font-extrabold ${T.textSecondary} uppercase tracking-wider block`}>
                    Ajuste Rápido de Stock
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {[-10, -1, 1, 10].map(delta => (
                      <button
                        type="button"
                        key={delta}
                        onClick={() => {
                          const cur = parseFloat(productFormData.stock) || 0;
                          setProductFormData(p => ({ ...p, stock: String(Math.max(0, Number((cur + delta).toFixed(3)))) }));
                        }}
                        className={`py-1.5 rounded-xl text-[11px] font-bold border ${T.btnGhost} flex items-center justify-center cursor-pointer active:scale-95`}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Impuesto / IVA */}
              <div className={`flex items-center justify-between p-2.5 rounded-xl border ${T.border}`}>
                <span className={`text-xs font-bold ${T.textPrimary}`}>Impuesto (IVA)</span>
                <div className={`inline-flex p-0.5 rounded-lg border ${isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'}`}>
                  <button
                    type="button"
                    onClick={() => setProductFormData(p => ({ ...p, taxStatus: 'gravable' }))}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      productFormData.taxStatus === 'gravable'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : T.textMuted
                    }`}
                  >
                    Gravable (Impuesto)
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductFormData(p => ({ ...p, taxStatus: 'exento' }))}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      productFormData.taxStatus === 'exento'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : T.textMuted
                    }`}
                  >
                    Exento
                  </button>
                </div>
              </div>

              {/* Presentación al Mayor: Venta por Caja / Bulto / Media Caja */}
              <div className={`p-3 rounded-2xl border ${
                isLight ? 'bg-purple-50/50 border-purple-200/80' : 'bg-purple-950/20 border-purple-800/40'
              } space-y-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Package size={15} className="text-purple-500 shrink-0" />
                    <div>
                      <h4 className={`text-xs font-black ${T.textPrimary}`}>Venta por Caja / Bulto</h4>
                      <p className={`text-[10px] ${T.textMuted}`}>Permite vender por caja o media caja en POS</p>
                    </div>
                  </div>
                  {productFormData.unitsPerBulk && productFormData.bulkPrice ? (
                    <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-600 dark:text-purple-300 text-[10px] font-black">
                      Activo
                    </span>
                  ) : (
                    <span className={`text-[10px] font-bold ${T.textMuted}`}>Opcional</span>
                  )}
                </div>

                {/* Tipo de Empaque y Unidades por Caja */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
                      Empaque
                    </label>
                    <input 
                      type="text" 
                      value={productFormData.bulkUnitName}
                      onChange={(e) => setProductFormData(p => ({ ...p, bulkUnitName: e.target.value }))}
                      placeholder="Caja, Bulto, Display"
                      className={`w-full px-2.5 py-1.5 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-bold outline-none`}
                    />
                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-0.5">
                      {['Caja', 'Bulto', 'Display', 'Fardo'].map(tipo => (
                        <button
                          type="button"
                          key={tipo}
                          onClick={() => setProductFormData(p => ({ ...p, bulkUnitName: tipo }))}
                          className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold cursor-pointer transition-colors ${
                            productFormData.bulkUnitName === tipo
                              ? 'bg-purple-600 text-white'
                              : `${T.btnGhost} ${T.textMuted}`
                          }`}
                        >
                          {tipo}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
                      Unidades x {productFormData.bulkUnitName || 'Caja'}
                    </label>
                    <input 
                      type="number" 
                      min="2"
                      step="1"
                      value={productFormData.unitsPerBulk}
                      onChange={(e) => {
                        const val = e.target.value;
                        const unitsNum = parseFloat(val) || 0;
                        setProductFormData(p => {
                          const retailPrice = parseFloat(p.priceUSD) || 0;
                          let suggestedBulk = p.bulkPrice;
                          // Si no hay precio de caja o es 0, sugerir precio con 10% de descuento al mayor
                          if ((!suggestedBulk || suggestedBulk === '0') && retailPrice > 0 && unitsNum > 1) {
                            suggestedBulk = (retailPrice * unitsNum * 0.90).toFixed(2);
                          }
                          return {
                            ...p,
                            unitsPerBulk: val,
                            bulkPrice: suggestedBulk,
                            unitsPerMidBulk: p.enableMidBulk && unitsNum > 1 ? String(Math.floor(unitsNum / 2)) : p.unitsPerMidBulk
                          };
                        });
                      }}
                      placeholder="Ej: 20, 24"
                      className={`w-full px-2.5 py-1.5 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-black outline-none`}
                    />
                  </div>
                </div>

                {/* Precio de Caja en USD y cálculo de ahorro */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
                      Precio {productFormData.bulkUnitName || 'Caja'} ($ USD)
                    </label>
                    {(() => {
                      const uNum = parseFloat(productFormData.unitsPerBulk) || 0;
                      const bPrice = parseFloat(productFormData.bulkPrice) || 0;
                      const rPrice = parseFloat(productFormData.priceUSD) || 0;
                      if (uNum > 1 && bPrice > 0) {
                        const unitInBox = bPrice / uNum;
                        const retailTotal = rPrice * uNum;
                        const pctSavings = retailTotal > 0 ? (((retailTotal - bPrice) / retailTotal) * 100) : 0;
                        return (
                          <span className="text-[10px] font-bold text-emerald-500">
                            ${unitInBox.toFixed(2)} c/u {pctSavings > 0 ? `(-${pctSavings.toFixed(0)}%)` : ''}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div className="relative">
                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${T.textMuted}`}>$</span>
                    <input 
                      type="number" 
                      step="0.01"
                      value={productFormData.bulkPrice}
                      onChange={(e) => setProductFormData(p => ({ ...p, bulkPrice: e.target.value }))}
                      placeholder="0.00"
                      className={`w-full pl-6 pr-3 py-1.5 rounded-xl ${T.inputBg} border ${T.border} text-emerald-500 text-xs font-black outline-none`}
                    />
                  </div>

                  {/* Botones de sugerencia rápida según precio unitario */}
                  {(() => {
                    const uNum = parseFloat(productFormData.unitsPerBulk) || 0;
                    const rPrice = parseFloat(productFormData.priceUSD) || 0;
                    if (uNum > 1 && rPrice > 0) {
                      const retailSum = rPrice * uNum;
                      return (
                        <div className="flex items-center gap-1.5 pt-1">
                          <span className={`text-[9px] ${T.textMuted} font-bold`}>Sugerir:</span>
                          {[-5, -10, -15].map(disc => {
                            const discPrice = (retailSum * (1 + disc / 100)).toFixed(2);
                            return (
                              <button
                                type="button"
                                key={disc}
                                onClick={() => setProductFormData(p => ({ ...p, bulkPrice: discPrice }))}
                                className={`px-2 py-0.5 rounded-lg text-[9px] font-bold border ${T.btnGhost} text-purple-600 dark:text-purple-300 hover:bg-purple-500/10 cursor-pointer`}
                              >
                                {disc}% (${discPrice})
                              </button>
                            );
                          })}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                {/* Código de barras de la caja */}
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
                    Código de Barras de la Caja (Opcional)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input 
                      type="text" 
                      value={productFormData.bulkBarcode}
                      onChange={(e) => setProductFormData(p => ({ ...p, bulkBarcode: e.target.value }))}
                      placeholder="Escanear o ingresar código del empaque"
                      className={`flex-1 px-2.5 py-1.5 rounded-xl ${T.inputBg} border ${T.border} font-mono ${T.textPrimary} text-xs font-bold outline-none`}
                    />
                    {productFormData.barcode && !productFormData.bulkBarcode && (
                      <button
                        type="button"
                        onClick={() => setProductFormData(p => ({ ...p, bulkBarcode: `${p.barcode}C` }))}
                        className={`px-2 py-1.5 rounded-xl text-[10px] font-bold border ${T.btnGhost} text-purple-500 cursor-pointer whitespace-nowrap`}
                        title="Asignar código sugerido derivado"
                      >
                        Auto
                      </button>
                    )}
                  </div>
                </div>

                {/* Toggle para Media Caja / Medio Empaque */}
                <div className="pt-2 border-t border-dashed border-purple-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-bold ${T.textPrimary}`}>
                      ¿Vender también por Media Caja?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextState = !productFormData.enableMidBulk;
                        setProductFormData(p => {
                          const uNum = parseFloat(p.unitsPerBulk) || 0;
                          const bPrice = parseFloat(p.bulkPrice) || 0;
                          return {
                            ...p,
                            enableMidBulk: nextState,
                            unitsPerMidBulk: nextState && (!p.unitsPerMidBulk || p.unitsPerMidBulk === '0') && uNum > 1
                              ? String(Math.floor(uNum / 2))
                              : p.unitsPerMidBulk,
                            midBulkPrice: nextState && (!p.midBulkPrice || p.midBulkPrice === '0') && bPrice > 0
                              ? (bPrice / 2).toFixed(2)
                              : p.midBulkPrice
                          };
                        });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-colors cursor-pointer ${
                        productFormData.enableMidBulk
                          ? 'bg-purple-600 text-white shadow-xs'
                          : `${T.btnGhost} ${T.textMuted}`
                      }`}
                    >
                      {productFormData.enableMidBulk ? '✓ Activado' : 'No'}
                    </button>
                  </div>

                  {productFormData.enableMidBulk && (
                    <div className="grid grid-cols-2 gap-2 pt-1 animate-fadeIn">
                      <div className="space-y-1">
                        <label className={`text-[9.5px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
                          Unidades Media
                        </label>
                        <input 
                          type="number" 
                          min="1"
                          step="1"
                          value={productFormData.unitsPerMidBulk}
                          onChange={(e) => setProductFormData(p => ({ ...p, unitsPerMidBulk: e.target.value }))}
                          placeholder="Ej: 10"
                          className={`w-full px-2.5 py-1.5 rounded-xl ${T.inputBg} border ${T.border} ${T.textPrimary} text-xs font-black outline-none`}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className={`text-[9.5px] font-bold ${T.textSecondary} uppercase tracking-wider block`}>
                          Precio Media ($ USD)
                        </label>
                        <div className="relative">
                          <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${T.textMuted}`}>$</span>
                          <input 
                            type="number" 
                            step="0.01"
                            value={productFormData.midBulkPrice}
                            onChange={(e) => setProductFormData(p => ({ ...p, midBulkPrice: e.target.value }))}
                            placeholder="0.00"
                            className={`w-full pl-6 pr-2.5 py-1.5 rounded-xl ${T.inputBg} border ${T.border} text-emerald-500 text-xs font-black outline-none`}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Botones del Formulario: Guardar y Eliminar */}
              <div className="pt-2 flex items-center gap-2">
                {editingProduct && canDeleteProducts && (
                  <button
                    type="button"
                    onClick={() => handleRequestDelete(editingProduct)}
                    className="p-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 font-bold transition-all cursor-pointer flex items-center justify-center shrink-0"
                    title="Eliminar este producto"
                  >
                    <Trash2 size={16} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className={`flex-1 min-h-[44px] rounded-xl ${T.btnGhost} font-bold text-xs uppercase transition-all`}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSavingProduct}
                  className="flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                >
                  {isSavingProduct ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      <span>{editingProduct ? 'Guardar Cambios' : 'Crear Producto'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MODAL: CONFIRMACIÓN DE ELIMINACIÓN */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/85 z-60 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
          <div className={`w-full max-w-sm ${T.modalCard} rounded-xl p-5 shadow-2xl space-y-4 border border-rose-500/40`}>
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-rose-500/20 text-rose-500">
                <Trash2 size={24} />
              </div>

              <h3 className={`font-bold text-base ${T.textPrimary}`}>
                ¿Eliminar Producto?
              </h3>

              <p className={`text-xs ${T.textSecondary} leading-relaxed`}>
                {deleteConfirm.message}
              </p>

              <div className={`w-full p-2.5 rounded-lg ${T.ticketItemBg} text-xs font-mono font-bold ${T.textPrimary}`}>
                {deleteConfirm.product?.name || deleteConfirm.product?.nombre}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
                className={`flex-1 min-h-[40px] rounded-lg ${T.btnGhost} font-semibold text-xs transition-colors`}
              >
                Cancelar
              </button>

              <button
                onClick={handleExecuteDelete}
                disabled={isDeleting}
                className="flex-1 min-h-[40px] rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-colors cursor-pointer"
              >
                {isDeleting ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Sí, Eliminar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE BÚSQUEDA DE IMÁGENES COMERCIALES / WEB */}
      {isImageSearchModalOpen && (
        <MobileImageSearchModal
          isOpen={isImageSearchModalOpen}
          onClose={() => setIsImageSearchModalOpen(false)}
          productName={productFormData.name}
          productCategory={productFormData.category}
          productId={editingProduct?.id || 'new'}
          onImageSelected={(uri) => {
            setProductFormData(prev => ({ ...prev, imageUri: uri }));
            setIsImageSearchModalOpen(false);
            if (showToast) showToast('✅ Imagen comercial asignada con éxito');
          }}
          T={T}
        />
      )}

      {/* ESCÁNER DE CÁMARA DIRECTO PARA CONTEO FÍSICO (+1 EN RÁFAGA) */}
      {isAuditScannerOpen && (
        <Suspense fallback={null}>
          <MobileBarcodeScannerModal
            isOpen={isAuditScannerOpen}
            onClose={() => setIsAuditScannerOpen(false)}
            initialBurstMode={true}
            targetMode="LOOKUP"
            title="Conteo Físico por Cámara"
            subtitle="Escanea productos continuamente (+1 por lectura)"
            products={products}
            onBarcodeScanned={(code) => {
              processAuditBarcode(code);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
