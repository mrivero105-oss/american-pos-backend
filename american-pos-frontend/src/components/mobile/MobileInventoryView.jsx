import { useState, useEffect, useMemo, useRef, useDeferredValue, lazy, Suspense, useCallback } from 'react';
import {
  Search, 
  ArrowLeft, 
  Box, 
  Edit3, 
  Plus, 
  X, 
  RefreshCw, 
  ClipboardList, 
  CheckCircle2, 
  Scan, 
  Trash2, 
  Camera, 
  Package,
  Clock
} from 'lucide-react';
import api from '../../services/api';
import { db as primaryDb } from '../../services/db';
import localDb from '../../db/localDb';
import lanSyncService from '../../services/lanSyncService';
import MobileImageSearchModal from './MobileImageSearchModal';
import MobileQuickProductModal from './MobileQuickProductModal';
import { triggerHaptic } from '../../utils/haptics';
import { normalizeProductImage } from '../../utils/imageProcess';
import { VoiceMicButton } from '../../utils/voiceSearch';
import { useFuzzySearch } from '../../hooks/useFuzzySearch';
import VirtualProductList from '../common/VirtualProductList';
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

  // --- MODAL UNIFICADO DE CREACIÓN Y EDICIÓN COMPLETA DE PRODUCTO (MobileQuickProductModal) ---
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null); // null = nuevo, obj = editar
  const [productFormData, setProductFormData] = useState({
    isNew: true,
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
      isNew: true,
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
      isNew: false,
      id: p.id,
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

      const theoretical = Number(prod.stockQuantity ?? prod.stock ?? 0);
      const stockPayload = {
        stockQuantity: newStock,
        previousStock: theoretical,
        reason: 'Conteo físico móvil'
      };

      try {
        await api.patch(`/products/${id}/stock-count`, stockPayload, { timeout: 4500 });
        successCount++;
      } catch (err) {
        const httpStatus = err?.response?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          console.warn('[MobileInventoryView] Conteo rechazado por servidor:', err?.response?.data?.error || err?.message);
          continue;
        }
        console.warn('[MobileInventoryView] Error de red en conteo físico, encolando:', err?.message || err);
        try {
          await primaryDb.put('syncQueue', {
            id: `audit_${Date.now()}_${id}`,
            endpoint: `/products/${id}/stock-count`,
            method: 'PATCH',
            payload: stockPayload,
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
      <MobileQuickProductModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        T={T}
        isLight={isLight}
        productFormData={productFormData}
        setProductFormData={setProductFormData}
        handleSaveProduct={handleSaveProduct}
        isSavingProduct={isSavingProduct}
        isUploadingImage={isUploadingImage}
        handleProductImageUpload={handleImageUpload}
        onOpenImageSearch={() => setIsImageSearchModalOpen(true)}
        generateInternalEanBarcode={handleGenerateEanBarcode}
        isCustomCategoryMode={isCustomCategoryMode}
        setIsCustomCategoryMode={setIsCustomCategoryMode}
        selectableCategories={selectableCategories}
        exchangeRate={exchangeRate}
        triggerHaptic={triggerHaptic}
        canViewCosts={canViewCosts}
        onDelete={editingProduct && canDeleteProducts ? () => handleRequestDelete(editingProduct) : null}
      />

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
