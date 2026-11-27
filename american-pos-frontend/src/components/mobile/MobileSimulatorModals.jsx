import { Suspense, lazy, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, Check, Copy, Plus, Printer, RefreshCw, Wifi, X, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import MobileSideNav from './MobileSideNav';
import { useMobileKeyboardViewport } from '../../hooks/useMobileKeyboardViewport';
import { useMobileModalStore } from '../../store/useMobileModalStore';

const BiometricEnrollModal = lazy(() => import('../BiometricEnrollModal'));
const ExchangeRateModal = lazy(() => import('../ExchangeRateModal'));
const SupervisorAuthModal = lazy(() => import('./SupervisorAuthModal'));
const MobileCheckoutModal = lazy(() => import('./MobileCheckoutModal'));
const MobileReceiptModal = lazy(() => import('./MobileReceiptModal'));
const MobileQuickProductModal = lazy(() => import('./MobileQuickProductModal'));
const MobilePriceCardModal = lazy(() => import('./MobilePriceCardModal'));
const MobileImagePreviewModal = lazy(() => import('./MobileImagePreviewModal'));
const MobileQuickItemModal = lazy(() => import('./MobileQuickItemModal'));
const MobileHeldSalesModal = lazy(() => import('./MobileHeldSalesModal'));
const MobilePreSaleSentModal = lazy(() => import('./MobilePreSaleSentModal'));
const MobileWhatsAppReceiptModal = lazy(() => import('./MobileWhatsAppReceiptModal'));
const MobilePriceCheckerModal = lazy(() => import('./MobilePriceCheckerModal'));
const MobileCustomerSelectModal = lazy(() => import('./MobileCustomerSelectModal'));
const MobileTableSelectModal = lazy(() => import('./MobileTableSelectModal'));
const MobileBarcodeScannerModal = lazy(() => import('../MobileBarcodeScannerModal'));
const MobileVariantPickerModal = lazy(() => import('./MobileVariantPickerModal'));
const MobileControlledMedModal = lazy(() => import('./MobileControlledMedModal'));
const MobileImageSearchModal = lazy(() => import('./MobileImageSearchModal'));
const MobileThermalPrinterModal = lazy(() => import('./MobileThermalPrinterModal'));
const MobileQuantityModal = lazy(() => import('./MobileQuantityModal'));
const MobileBulkSelectModal = lazy(() => import('./MobileBulkSelectModal'));

/**
 * Capa modular de modales, barras flotantes, menú lateral y overlays para el POS Móvil.
 */
export default function MobileSimulatorModals(props) {
  // Suscripción atómica directa al store de modales (evita prop-drilling y re-renders del padre MobilePOSSimulator)
  const {
    showServerModal,
    isCheckoutOpen,
    printedReceipt,
    isThermalPrinterModalOpen,
    preSaleSentModal,
    whatsAppModalData,
    selectedProductForVariant,
    selectedProductForBulk,
    selectedProductForControlledMed,
    isQuantityModalOpen,
    quantityModalItem,
    isScannerOpen,
    scannerTarget,
    isQuickProductModalOpen,
    isImageSearchModalOpen,
    unregisteredBarcodeNotice,
    priceCheckerProduct,
    isPriceCheckerModalOpen,
    previewProductImage,
    isManualItemModalOpen,
    isHeldSalesModalOpen,
    isSideNavOpen,
    isBiometricsModalOpen,
    isExchangeRateModalOpen,
    supervisorAuthRequest,
    isTableSelectModalOpen,
    isCustomerSelectModalOpen,
    setModalField
  } = useMobileModalStore(
    useShallow((s) => ({
      showServerModal: s.showServerModal,
      isCheckoutOpen: s.isCheckoutOpen,
      printedReceipt: s.printedReceipt,
      isThermalPrinterModalOpen: s.isThermalPrinterModalOpen,
      preSaleSentModal: s.preSaleSentModal,
      whatsAppModalData: s.whatsAppModalData,
      selectedProductForVariant: s.selectedProductForVariant,
      selectedProductForBulk: s.selectedProductForBulk,
      selectedProductForControlledMed: s.selectedProductForControlledMed,
      isQuantityModalOpen: s.isQuantityModalOpen,
      quantityModalItem: s.quantityModalItem,
      isScannerOpen: s.isScannerOpen,
      scannerTarget: s.scannerTarget,
      isQuickProductModalOpen: s.isQuickProductModalOpen,
      isImageSearchModalOpen: s.isImageSearchModalOpen,
      unregisteredBarcodeNotice: s.unregisteredBarcodeNotice,
      priceCheckerProduct: s.priceCheckerProduct,
      isPriceCheckerModalOpen: s.isPriceCheckerModalOpen,
      previewProductImage: s.previewProductImage,
      isManualItemModalOpen: s.isManualItemModalOpen,
      isHeldSalesModalOpen: s.isHeldSalesModalOpen,
      isSideNavOpen: s.isSideNavOpen,
      isBiometricsModalOpen: s.isBiometricsModalOpen,
      isExchangeRateModalOpen: s.isExchangeRateModalOpen,
      supervisorAuthRequest: s.supervisorAuthRequest,
      isTableSelectModalOpen: s.isTableSelectModalOpen,
      isCustomerSelectModalOpen: s.isCustomerSelectModalOpen,
      setModalField: s.setModalField
    }))
  );

  const {
    setShowServerModal,
    setIsCheckoutOpen,
    setPrintedReceipt,
    setIsThermalPrinterModalOpen,
    setPreSaleSentModal,
    setWhatsAppModalData,
    setSelectedProductForVariant,
    setSelectedProductForBulk,
    setSelectedProductForControlledMed,
    setIsQuantityModalOpen,
    setQuantityModalItem,
    setIsScannerOpen,
    setScannerTarget,
    setIsQuickProductModalOpen,
    setIsImageSearchModalOpen,
    setUnregisteredBarcodeNotice,
    setPriceCheckerProduct,
    setIsPriceCheckerModalOpen,
    setPreviewProductImage,
    setIsManualItemModalOpen,
    setIsHeldSalesModalOpen,
    setIsSideNavOpen,
    setIsBiometricsModalOpen,
    setIsExchangeRateModalOpen,
    setSupervisorAuthRequest,
    setIsTableSelectModalOpen,
    setIsCustomerSelectModalOpen
  } = useMemo(() => ({
    setShowServerModal: (v) => setModalField('showServerModal', v),
    setIsCheckoutOpen: (v) => setModalField('isCheckoutOpen', v),
    setPrintedReceipt: (v) => setModalField('printedReceipt', v),
    setIsThermalPrinterModalOpen: (v) => setModalField('isThermalPrinterModalOpen', v),
    setPreSaleSentModal: (v) => setModalField('preSaleSentModal', v),
    setWhatsAppModalData: (v) => setModalField('whatsAppModalData', v),
    setSelectedProductForVariant: (v) => setModalField('selectedProductForVariant', v),
    setSelectedProductForBulk: (v) => setModalField('selectedProductForBulk', v),
    setSelectedProductForControlledMed: (v) => setModalField('selectedProductForControlledMed', v),
    setIsQuantityModalOpen: (v) => setModalField('isQuantityModalOpen', v),
    setQuantityModalItem: (v) => setModalField('quantityModalItem', v),
    setIsScannerOpen: (v) => setModalField('isScannerOpen', v),
    setScannerTarget: (v) => setModalField('scannerTarget', v),
    setIsQuickProductModalOpen: (v) => setModalField('isQuickProductModalOpen', v),
    setIsImageSearchModalOpen: (v) => setModalField('isImageSearchModalOpen', v),
    setUnregisteredBarcodeNotice: (v) => setModalField('unregisteredBarcodeNotice', v),
    setPriceCheckerProduct: (v) => setModalField('priceCheckerProduct', v),
    setIsPriceCheckerModalOpen: (v) => setModalField('isPriceCheckerModalOpen', v),
    setPreviewProductImage: (v) => setModalField('previewProductImage', v),
    setIsManualItemModalOpen: (v) => setModalField('isManualItemModalOpen', v),
    setIsHeldSalesModalOpen: (v) => setModalField('isHeldSalesModalOpen', v),
    setIsSideNavOpen: (v) => setModalField('isSideNavOpen', v),
    setIsBiometricsModalOpen: (v) => setModalField('isBiometricsModalOpen', v),
    setIsExchangeRateModalOpen: (v) => setModalField('isExchangeRateModalOpen', v),
    setSupervisorAuthRequest: (v) => setModalField('supervisorAuthRequest', v),
    setIsTableSelectModalOpen: (v) => setModalField('isTableSelectModalOpen', v),
    setIsCustomerSelectModalOpen: (v) => setModalField('isCustomerSelectModalOpen', v)
  }), [setModalField]);

  const {
    T,
    isLight,
    isOledMode,
    exchangeRate,
    businessInfo,
    user,
    isDollarCountry,
    triggerHaptic,
    playScanSound,
    showToast,
    getImageUrl,
    isUnlimitedStockProduct,
    products,
    cart,
    addToCart,
    heldSales,
    handleDeleteHeldSale,
    handleRestoreHeldSale,
    // Checkout
    documentType,
    setDocumentType,
    totalUSD,
    baseTotalUSD = null,
    totalBS,
    taxUSD,
    taxLabel = 'IVA',
    effectiveIvaRate = 16,
    isIvaEnabled = true,
    currentIgtfUSD = 0,
    igtfRate = 3,
    isIgtfEnabled = false,
    customerDoc,
    setCustomerDoc,
    customerName,
    setCustomerName,
    setCustomerSearch,
    setIsCreatingCustomerInMobile,
    isProcessingSale,
    handleSaveQuotation,
    checkoutMode,
    setCheckoutMode,
    selectedMethod,
    handleSelectPaymentMethod,
    cashAccumulateMode,
    setCashAccumulateMode,
    amountPaidUSD,
    setAmountPaidUSD,
    amountPaidBS,
    setAmountPaidBS,
    totalPaidInUSD,
    paidUSD,
    paidBS,
    changeUSD,
    changeBS,
    splitPayments,
    setSplitPayments,
    splitPaidUSD,
    splitRemainingUSD,
    splitChangeUSD,
    splitChangeBS = 0,
    paymentReference,
    setPaymentReference,
    handleConfirmSale,
    // Recibos / Impresora / WhatsApp
    handlePrintBluetoothReceipt,
    shareReceiptWhatsApp,
    printerSpoolerStatus,
    printPreSaleBluetoothReceipt,
    sharePreSaleWhatsApp,
    whatsAppPhoneInput,
    setWhatsAppPhoneInput,
    handleConfirmSendWhatsApp,
    isGeneratingWhatsApp,
    whatsAppMessagePreview,
    generateEcoReceiptText,
    cleanWhatsAppPhone,
    // Variantes / Bultos / Farmacia / Cantidades
    handleSelectBulkPresentation,
    handleApplyQuantity,
    // Escáner / Producto rápido / Imágenes
    posMode,
    setPosMode,
    handleBarcodeScanned,
    openCreateProduct,
    openEditProduct,
    canCreateProducts = true,
    canViewCosts = true,
    productFormData,
    setProductFormData,
    handleSaveProduct,
    isSavingProduct,
    isUploadingImage,
    handleProductImageUpload,
    generateInternalEanBarcode,
    isCustomCategoryMode,
    setIsCustomCategoryMode,
    selectableCategories,
    copyBarcodeToClipboard,
    priceCheckerSearch,
    setPriceCheckerSearch,
    // Ítem manual y en espera
    manualItemName,
    setManualItemName,
    manualItemPrice,
    setManualItemPrice,
    manualItemPriceBS,
    setManualItemPriceBS,
    manualItemQty,
    setManualItemQty,
    handleAddManualItem,
    // Navegación / Biometría / Alertas / Mesas / Clientes / Servidor PC
    mobileServerIp = '',
    setMobileServerIp = () => {},
    serverFeedback = null,
    isTestingServer = false,
    handleAutoDiscoverServer = () => {},
    handleTestAndSaveServer = () => {},
    socketConnected,
    pendingSalesCount,
    drawerSearch,
    setDrawerSearch,
    filteredNavSections,
    activeModule,
    setActiveModule,
    canManageSettings = false,
    activeCurrencyMode = 'USD',
    onExchangeRateUpdated = () => {},
    setEnrolledBioUser,
    isAudioMuted,
    setIsAudioMuted,
    toggleSoundMute,
    theme,
    setTheme,
    logout,
    lastHardwareScan,
    selectedTable,
    setSelectedTable,
    orderNotes,
    setOrderNotes,
    customers,
    isCreatingCustomerInMobile,
    customerSearch,
    filteredCustomers,
    handleSelectCustomer,
    newCustomerForm,
    setNewCustomerForm,
    handleSaveNewCustomer,
    isSavingCustomer
  } = props;

  const {
    modalOverlayStyle: serverModalOverlayStyle,
    modalCardMaxHeightStyle: serverModalCardStyle,
    handleFieldFocusCapture: handleServerFocusCapture
  } = useMobileKeyboardViewport({ enabled: Boolean(showServerModal) });

  return (
    <>
      {isCheckoutOpen && (
        <Suspense fallback={null}>
          <MobileCheckoutModal
            isOpen={isCheckoutOpen}
            onClose={() => setIsCheckoutOpen(false)}
            T={T}
            isLight={isLight}
            documentType={documentType}
            setDocumentType={setDocumentType}
            totalUSD={totalUSD}
            baseTotalUSD={baseTotalUSD}
            totalBS={totalBS}
            taxUSD={taxUSD}
            taxLabel={taxLabel}
            effectiveIvaRate={effectiveIvaRate}
            isIvaEnabled={isIvaEnabled}
            currentIgtfUSD={currentIgtfUSD}
            igtfRate={igtfRate}
            isIgtfEnabled={isIgtfEnabled}
            exchangeRate={exchangeRate}
            customerDoc={customerDoc}
            setCustomerDoc={setCustomerDoc}
            customerName={customerName}
            setCustomerName={setCustomerName}
            onOpenCustomerSelect={() => {
              triggerHaptic(10);
              setCustomerSearch('');
              setIsCreatingCustomerInMobile(false);
              setIsCustomerSelectModalOpen(true);
            }}
            isProcessingSale={isProcessingSale}
            handleSaveQuotation={handleSaveQuotation}
            checkoutMode={checkoutMode}
            setCheckoutMode={setCheckoutMode}
            selectedMethod={selectedMethod}
            handleSelectPaymentMethod={handleSelectPaymentMethod}
            cashAccumulateMode={cashAccumulateMode}
            setCashAccumulateMode={setCashAccumulateMode}
            amountPaidUSD={amountPaidUSD}
            setAmountPaidUSD={setAmountPaidUSD}
            amountPaidBS={amountPaidBS}
            setAmountPaidBS={setAmountPaidBS}
            totalPaidInUSD={totalPaidInUSD}
            paidUSD={paidUSD}
            paidBS={paidBS}
            changeUSD={changeUSD}
            changeBS={changeBS}
            isDollarCountry={isDollarCountry}
            splitPayments={splitPayments}
            setSplitPayments={setSplitPayments}
            splitPaidUSD={splitPaidUSD}
            splitRemainingUSD={splitRemainingUSD}
            splitChangeUSD={splitChangeUSD}
            splitChangeBS={splitChangeBS}
            pagoMovilPhone={businessInfo?.pagoMovilPhone || ''}
            pagoMovilId={businessInfo?.pagoMovilId || ''}
            pagoMovilBank={businessInfo?.pagoMovilBank || ''}
            businessInfo={businessInfo}
            paymentReference={paymentReference}
            setPaymentReference={setPaymentReference}
            handleConfirmSale={handleConfirmSale}
            triggerHaptic={triggerHaptic}
            playScanSound={playScanSound}
          />
        </Suspense>
      )}

      {printedReceipt && (
        <Suspense fallback={null}>
          <MobileReceiptModal
            receipt={printedReceipt}
            onClose={() => setPrintedReceipt(null)}
            businessInfo={businessInfo}
            user={user}
            onPrintBluetooth={handlePrintBluetoothReceipt}
            onOpenThermalPrinterSettings={() => setIsThermalPrinterModalOpen(true)}
            onShareWhatsApp={shareReceiptWhatsApp}
            triggerHaptic={triggerHaptic}
          />
        </Suspense>
      )}

      {selectedProductForVariant && (
        <Suspense fallback={null}>
          <MobileVariantPickerModal
            product={selectedProductForVariant}
            isOpen={Boolean(selectedProductForVariant)}
            onClose={() => setSelectedProductForVariant(null)}
            onAddToCart={(variantItem, qty) => {
              addToCart(variantItem, qty);
            }}
            exchangeRate={exchangeRate}
            T={T}
          />
        </Suspense>
      )}

      {selectedProductForBulk && (
        <Suspense fallback={null}>
          <MobileBulkSelectModal
            isOpen={Boolean(selectedProductForBulk)}
            product={selectedProductForBulk}
            onClose={() => setSelectedProductForBulk(null)}
            onConfirmSelection={handleSelectBulkPresentation}
            exchangeRate={exchangeRate}
            T={T}
            isLight={isLight}
          />
        </Suspense>
      )}

      {selectedProductForControlledMed && (
        <Suspense fallback={null}>
          <MobileControlledMedModal
            product={selectedProductForControlledMed}
            isOpen={Boolean(selectedProductForControlledMed)}
            onClose={() => setSelectedProductForControlledMed(null)}
            onConfirm={(recipeData) => {
              addToCart({
                ...selectedProductForControlledMed,
                recipe: recipeData
              });
              showToast(`💊 Récipe validado para ${selectedProductForControlledMed.name || selectedProductForControlledMed.nombre}`);
            }}
            T={T}
          />
        </Suspense>
      )}

      {isThermalPrinterModalOpen && (
        <Suspense fallback={null}>
          <MobileThermalPrinterModal
            isOpen={isThermalPrinterModalOpen}
            onClose={() => setIsThermalPrinterModalOpen(false)}
            T={T}
            isLight={isLight}
            showToast={showToast}
            businessInfo={businessInfo}
          />
        </Suspense>
      )}

      {isQuantityModalOpen && (
        <Suspense fallback={null}>
          <MobileQuantityModal
            isOpen={isQuantityModalOpen}
            onClose={() => {
              setIsQuantityModalOpen(false);
              setQuantityModalItem(null);
            }}
            item={quantityModalItem}
            onApplyQuantity={handleApplyQuantity}
            T={T}
            isLight={isLight}
          />
        </Suspense>
      )}

      {printerSpoolerStatus?.pendingCount > 0 && (
        <div className="fixed bottom-20 left-4 z-40 bg-slate-900 text-white border border-blue-500/40 px-3.5 py-2 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs animate-fadeIn">
          <div className="relative flex items-center justify-center">
            <Printer size={15} className="text-blue-400 animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500 animate-ping" />
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-[11px] leading-tight text-blue-300">
              Imprimiendo en segundo plano
            </p>
            <p className="text-[10px] text-slate-400 leading-tight">
              {printerSpoolerStatus.activeJob?.invoiceNumber ? `Ticket #${printerSpoolerStatus.activeJob.invoiceNumber}` : 'Procesando cola...'} ({printerSpoolerStatus.pendingCount} pend.)
            </p>
          </div>
        </div>
      )}

      {isScannerOpen && (
        <Suspense fallback={null}>
          <MobileBarcodeScannerModal
            isOpen={isScannerOpen}
            onClose={() => {
              setIsScannerOpen(false);
              setScannerTarget('cart');
            }}
            targetMode={scannerTarget === 'product_barcode' ? 'ASSIGN' : 'CART'}
            title={scannerTarget === 'product_barcode' ? 'Asignar Código' : (posMode === 'PRICE_CHECKER' ? 'Consultor de Precios' : 'Escáner Móvil')}
            subtitle={scannerTarget === 'product_barcode' ? 'Apunta al código para asociarlo al producto' : (posMode === 'PRICE_CHECKER' ? 'Escanea para consultar precio y stock al instante' : 'Apunta al código de barras')}
            products={products || []}
            onVisionMatch={(prod) => {
              if (prod) {
                if (posMode === 'PRICE_CHECKER') {
                  setPriceCheckerProduct(prod);
                } else {
                  addToCart(prod);
                  showToast(`🛒 +1 ${prod.name || prod.nombre}`);
                }
              }
            }}
            onBarcodeScanned={(code) => {
              handleBarcodeScanned(code);
            }}
            onSaveNewProduct={(code) => {
              openCreateProduct(code);
            }}
          />
        </Suspense>
      )}

      {isQuickProductModalOpen && (
        <Suspense fallback={null}>
          <MobileQuickProductModal
            isOpen={isQuickProductModalOpen}
            onClose={() => setIsQuickProductModalOpen(false)}
            T={T}
            isLight={isLight}
            productFormData={productFormData}
            setProductFormData={setProductFormData}
            handleSaveProduct={handleSaveProduct}
            isSavingProduct={isSavingProduct}
            isUploadingImage={isUploadingImage}
            handleProductImageUpload={handleProductImageUpload}
            onOpenImageSearch={() => setIsImageSearchModalOpen(true)}
            generateInternalEanBarcode={generateInternalEanBarcode}
            setScannerTarget={setScannerTarget}
            setIsScannerOpen={setIsScannerOpen}
            isCustomCategoryMode={isCustomCategoryMode}
            setIsCustomCategoryMode={setIsCustomCategoryMode}
            selectableCategories={selectableCategories}
            exchangeRate={exchangeRate}
            triggerHaptic={triggerHaptic}
            canViewCosts={canViewCosts}
          />
        </Suspense>
      )}

      {isImageSearchModalOpen && (
        <Suspense fallback={null}>
          <MobileImageSearchModal
            isOpen={isImageSearchModalOpen}
            onClose={() => setIsImageSearchModalOpen(false)}
            productName={productFormData.name}
            productCategory={productFormData.category}
            productId={productFormData.id || 'new'}
            onImageSelected={(uri) => {
              setProductFormData((prev) => ({ ...prev, imageUri: uri }));
              showToast('✅ Foto asignada con éxito');
            }}
            T={T}
          />
        </Suspense>
      )}

      {unregisteredBarcodeNotice && (
        <div className="fixed bottom-20 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md bg-slate-950 border border-amber-500/40 rounded-2xl p-3 shadow-2xl z-40 animate-slideUp flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                <AlertTriangle size={15} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Código No Registrado</p>
                <p className="text-xs font-mono font-black text-amber-300 truncate">
                  {unregisteredBarcodeNotice.barcode}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUnregisteredBarcodeNotice(null)}
              className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-white/10">
            <button
              type="button"
              onClick={() => copyBarcodeToClipboard(unregisteredBarcodeNotice.barcode)}
              className="flex-1 py-1.5 px-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[11px] font-bold uppercase flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
            >
              <Copy size={12} />
              <span>Copiar Código</span>
            </button>
            {canCreateProducts && (
              <button
                type="button"
                onClick={() => {
                  openCreateProduct(unregisteredBarcodeNotice.barcode);
                }}
                className="flex-1 py-1.5 px-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all shadow-md"
              >
                <Plus size={12} />
                <span>Crear Producto</span>
              </button>
            )}
          </div>
        </div>
      )}

      {priceCheckerProduct && !isPriceCheckerModalOpen && (
        <Suspense fallback={null}>
          <MobilePriceCardModal
            product={priceCheckerProduct}
            onClose={() => setPriceCheckerProduct(null)}
            T={T}
            getImageUrl={getImageUrl}
            exchangeRate={exchangeRate}
            addToCart={addToCart}
            showToast={showToast}
            onOpenScanner={() => {
              setPriceCheckerProduct(null);
              setIsScannerOpen(true);
            }}
          />
        </Suspense>
      )}

      {previewProductImage && (
        <Suspense fallback={null}>
          <MobileImagePreviewModal
            previewProductImage={previewProductImage}
            onClose={() => setPreviewProductImage(null)}
            onEditProduct={openEditProduct}
            triggerHaptic={triggerHaptic}
            T={T}
            isDollarCountry={isDollarCountry}
          />
        </Suspense>
      )}

      {isManualItemModalOpen && (
        <Suspense fallback={null}>
          <MobileQuickItemModal
            isOpen={isManualItemModalOpen}
            onClose={() => setIsManualItemModalOpen(false)}
            T={T}
            manualItemName={manualItemName}
            setManualItemName={setManualItemName}
            manualItemPrice={manualItemPrice}
            setManualItemPrice={setManualItemPrice}
            manualItemPriceBS={manualItemPriceBS}
            setManualItemPriceBS={setManualItemPriceBS}
            manualItemQty={manualItemQty}
            setManualItemQty={setManualItemQty}
            exchangeRate={exchangeRate}
            handleAddManualItem={handleAddManualItem}
          />
        </Suspense>
      )}

      {isHeldSalesModalOpen && (
        <Suspense fallback={null}>
          <MobileHeldSalesModal
            isOpen={isHeldSalesModalOpen}
            onClose={() => setIsHeldSalesModalOpen(false)}
            T={T}
            heldSales={heldSales}
            currentCartCount={cart.length}
            handleDeleteHeldSale={handleDeleteHeldSale}
            handleRestoreHeldSale={handleRestoreHeldSale}
            triggerHaptic={triggerHaptic}
          />
        </Suspense>
      )}

      <MobileSideNav
        isOpen={isSideNavOpen}
        onClose={() => setIsSideNavOpen(false)}
        triggerHaptic={triggerHaptic}
        T={T}
        isLight={isLight}
        isOledMode={isOledMode}
        socketConnected={socketConnected}
        pendingSalesCount={pendingSalesCount}
        businessInfo={businessInfo}
        exchangeRate={exchangeRate}
        canManageSettings={canManageSettings}
        onOpenExchangeRateModal={() => setIsExchangeRateModalOpen(true)}
        user={user}
        drawerSearch={drawerSearch}
        setDrawerSearch={setDrawerSearch}
        filteredNavSections={filteredNavSections}
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        posMode={posMode}
        setPosMode={setPosMode}
        onOpenThermalPrinterSettings={() => setIsThermalPrinterModalOpen(true)}
        onOpenBiometricsModal={() => setIsBiometricsModalOpen(true)}
        isAudioMuted={isAudioMuted}
        setIsAudioMuted={setIsAudioMuted}
        toggleSoundMute={toggleSoundMute}
        playScanSound={playScanSound}
        showToast={showToast}
        theme={theme}
        setTheme={setTheme}
        logout={logout}
      />

      {isBiometricsModalOpen && (
        <Suspense fallback={null}>
          <BiometricEnrollModal
            isOpen={isBiometricsModalOpen}
            onClose={() => setIsBiometricsModalOpen(false)}
            onEnrolledChange={(cred) => {
              setEnrolledBioUser(cred);
              if (cred) showToast('Huella vinculada con éxito');
            }}
          />
        </Suspense>
      )}

      {supervisorAuthRequest && (
        <Suspense fallback={null}>
          <SupervisorAuthModal
            isOpen={Boolean(supervisorAuthRequest)}
            onClose={() => setSupervisorAuthRequest(null)}
            onAuthorized={(approvalData) => {
              const cb = supervisorAuthRequest.onAuthorized;
              setSupervisorAuthRequest(null);
              cb?.(approvalData);
            }}
            actionType={supervisorAuthRequest.actionType || 'pos_override'}
            referenceId={supervisorAuthRequest.referenceId || null}
            title={supervisorAuthRequest.title}
            reason={supervisorAuthRequest.reason}
            isLight={isLight}
            T={T}
          />
        </Suspense>
      )}

      <AnimatePresence>
        {lastHardwareScan && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -25, scale: 0.95 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 text-emerald-400 border border-emerald-500/50 px-4 py-2 rounded-full shadow-2xl flex items-center gap-2.5 text-xs font-black backdrop-blur-md pointer-events-none"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <Zap size={14} className="text-emerald-400 shrink-0" />
            <span className="truncate max-w-[240px]">
              🔫 Pistola: {lastHardwareScan.code}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {isTableSelectModalOpen && (
        <Suspense fallback={null}>
          <MobileTableSelectModal
            isOpen={isTableSelectModalOpen}
            onClose={() => setIsTableSelectModalOpen(false)}
            currentTable={selectedTable}
            currentNotes={orderNotes}
            onSave={({ table, notes }) => {
              setSelectedTable(table);
              setOrderNotes(notes);
              if (table) {
                showToast(`🍽️ Asignada: ${table}${notes ? ` (${notes})` : ''}`);
              } else {
                showToast('ℹ️ Venta libre (Sin mesa)');
              }
            }}
            T={T}
            triggerHaptic={triggerHaptic}
          />
        </Suspense>
      )}

      {preSaleSentModal && (
        <Suspense fallback={null}>
          <MobilePreSaleSentModal
            preSaleSentModal={preSaleSentModal}
            onClose={() => setPreSaleSentModal(null)}
            T={T}
            businessInfo={businessInfo}
            printPreSaleBluetoothReceipt={printPreSaleBluetoothReceipt}
            showToast={showToast}
            onOpenThermalPrinterSettings={() => setIsThermalPrinterModalOpen(true)}
            sharePreSaleWhatsApp={sharePreSaleWhatsApp}
            triggerHaptic={triggerHaptic}
          />
        </Suspense>
      )}

      {whatsAppModalData && (
        <Suspense fallback={null}>
          <MobileWhatsAppReceiptModal
            whatsAppModalData={whatsAppModalData}
            onClose={() => setWhatsAppModalData(null)}
            T={T}
            businessInfo={businessInfo}
            whatsAppPhoneInput={whatsAppPhoneInput}
            setWhatsAppPhoneInput={setWhatsAppPhoneInput}
            exchangeRate={exchangeRate}
            handleConfirmSendWhatsApp={handleConfirmSendWhatsApp}
            isGeneratingWhatsApp={isGeneratingWhatsApp}
            whatsAppMessagePreview={whatsAppMessagePreview}
            generateEcoReceiptText={generateEcoReceiptText}
            cleanWhatsAppPhone={cleanWhatsAppPhone}
            showToast={showToast}
            triggerHaptic={triggerHaptic}
          />
        </Suspense>
      )}

      {isPriceCheckerModalOpen && (
        <Suspense fallback={null}>
          <MobilePriceCheckerModal
            isOpen={isPriceCheckerModalOpen}
            onClose={() => {
              setIsPriceCheckerModalOpen(false);
              setPriceCheckerProduct(null);
              setPriceCheckerSearch('');
            }}
            T={T}
            priceCheckerSearch={priceCheckerSearch}
            setPriceCheckerSearch={setPriceCheckerSearch}
            onOpenScanner={() => setIsScannerOpen(true)}
            setScannerTarget={setScannerTarget}
            setPosMode={setPosMode}
            isDollarCountry={isDollarCountry}
            triggerHaptic={triggerHaptic}
            priceCheckerProduct={priceCheckerProduct}
            setPriceCheckerProduct={setPriceCheckerProduct}
            getImageUrl={getImageUrl}
            exchangeRate={exchangeRate}
            addToCart={addToCart}
            showToast={showToast}
            products={products}
            isUnlimitedStockProduct={isUnlimitedStockProduct}
          />
        </Suspense>
      )}

      {isCustomerSelectModalOpen && (
        <Suspense fallback={null}>
          <MobileCustomerSelectModal
            isOpen={isCustomerSelectModalOpen}
            onClose={() => {
              setIsCustomerSelectModalOpen(false);
              setIsCreatingCustomerInMobile(false);
            }}
            T={T}
            customers={customers}
            customerName={customerName}
            isDollarCountry={isDollarCountry}
            isCreatingCustomerInMobile={isCreatingCustomerInMobile}
            setIsCreatingCustomerInMobile={setIsCreatingCustomerInMobile}
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            filteredCustomers={filteredCustomers}
            handleSelectExistingCustomer={handleSelectCustomer}
            newCustomerData={newCustomerForm}
            setNewCustomerData={setNewCustomerForm}
            handleCreateCustomerSubmit={handleSaveNewCustomer}
            isSavingCustomer={isSavingCustomer}
            triggerHaptic={triggerHaptic}
          />
        </Suspense>
      )}

      {isExchangeRateModalOpen && (
        <Suspense fallback={null}>
          <ExchangeRateModal
            isOpen={isExchangeRateModalOpen}
            onClose={() => setIsExchangeRateModalOpen(false)}
            currentRate={exchangeRate}
            currencyMode={activeCurrencyMode}
            onRateUpdated={onExchangeRateUpdated}
          />
        </Suspense>
      )}

      {/* Modal Global de Configuración de IP de Servidor PC (accesible tanto desde Login como desde Sincronización PC) */}
      {showServerModal && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-end sm:items-center justify-center p-3 sm:p-4 animate-fadeIn overflow-y-auto"
          style={serverModalOverlayStyle}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="IP de la Computadora"
            className={`w-full max-w-xs ${T.modalCard} rounded-2xl p-5 border ${T.border} shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto my-auto`}
            style={serverModalCardStyle}
            onFocusCapture={handleServerFocusCapture}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="text-blue-500" size={18} />
                <h3 className={`text-xs font-black uppercase tracking-wider ${T.textPrimary}`}>IP de la Computadora</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                className={`p-2 rounded-lg ${T.btnGhost} text-slate-400 cursor-pointer`}
              >
                <X size={16} />
              </button>
            </div>

            <p className={`text-[11px] ${T.textSecondary} leading-relaxed`}>
              Dirección IP de tu PC principal donde corre el sistema Isaac POS (o dominio HTTPS en la nube):
            </p>

            <div>
              <label className={`text-[10px] font-bold uppercase tracking-wider ${T.textMuted} block mb-1`}>IP / Puerto</label>
              <input
                type="text"
                enterKeyHint="go"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={mobileServerIp}
                onChange={(e) => setMobileServerIp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isTestingServer && String(mobileServerIp || '').trim()) {
                    e.preventDefault();
                    handleTestAndSaveServer(mobileServerIp);
                  }
                }}
                placeholder="192.168.1.30:3005"
                className={`w-full min-h-[44px] ${T.inputBg} border rounded-xl px-3 py-2.5 text-base sm:text-sm font-mono font-bold outline-none focus:border-blue-500`}
              />
            </div>

            {serverFeedback && (
              <div
                className={`p-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 ${
                  serverFeedback.ok ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                }`}
              >
                {serverFeedback.ok ? <Check size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
                <span>{serverFeedback.msg}</span>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isTestingServer}
                onClick={handleAutoDiscoverServer}
                className={`flex-1 min-h-[44px] py-2.5 rounded-xl border ${T.border} ${T.btnGhost} text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer`}
              >
                {isTestingServer ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                <span>Auto-Buscar</span>
              </button>
              <button
                type="button"
                disabled={isTestingServer}
                onClick={() => handleTestAndSaveServer(mobileServerIp)}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase flex items-center justify-center gap-1 shadow-md shadow-blue-600/30 cursor-pointer"
              >
                {isTestingServer ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                <span>Guardar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
