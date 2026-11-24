import { Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, Copy, Plus, Printer, X, Zap } from 'lucide-react';
import BiometricEnrollModal from '../BiometricEnrollModal';
import SupervisorAuthModal from './SupervisorAuthModal';
import MobileCheckoutModal from './MobileCheckoutModal';
import MobileReceiptModal from './MobileReceiptModal';
import MobileQuickProductModal from './MobileQuickProductModal';
import MobilePriceCardModal from './MobilePriceCardModal';
import MobileImagePreviewModal from './MobileImagePreviewModal';
import MobileQuickItemModal from './MobileQuickItemModal';
import MobileHeldSalesModal from './MobileHeldSalesModal';
import MobileSideNav from './MobileSideNav';
import MobilePreSaleSentModal from './MobilePreSaleSentModal';
import MobileWhatsAppReceiptModal from './MobileWhatsAppReceiptModal';
import MobilePriceCheckerModal from './MobilePriceCheckerModal';
import MobileCustomerSelectModal from './MobileCustomerSelectModal';
import MobileTableSelectModal from './MobileTableSelectModal';

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
    isCheckoutOpen,
    setIsCheckoutOpen,
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
    setIsCustomerSelectModalOpen,
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
    printedReceipt,
    setPrintedReceipt,
    handlePrintBluetoothReceipt,
    setIsThermalPrinterModalOpen,
    isThermalPrinterModalOpen,
    shareReceiptWhatsApp,
    printerSpoolerStatus,
    preSaleSentModal,
    setPreSaleSentModal,
    printPreSaleBluetoothReceipt,
    sharePreSaleWhatsApp,
    whatsAppModalData,
    setWhatsAppModalData,
    whatsAppPhoneInput,
    setWhatsAppPhoneInput,
    handleConfirmSendWhatsApp,
    isGeneratingWhatsApp,
    whatsAppMessagePreview,
    generateEcoReceiptText,
    cleanWhatsAppPhone,
    // Variantes / Bultos / Farmacia / Cantidades
    selectedProductForVariant,
    setSelectedProductForVariant,
    selectedProductForBulk,
    setSelectedProductForBulk,
    handleSelectBulkPresentation,
    selectedProductForControlledMed,
    setSelectedProductForControlledMed,
    isQuantityModalOpen,
    setIsQuantityModalOpen,
    quantityModalItem,
    setQuantityModalItem,
    handleApplyQuantity,
    // Escáner / Producto rápido / Imágenes
    isScannerOpen,
    setIsScannerOpen,
    scannerTarget,
    setScannerTarget,
    posMode,
    setPosMode,
    handleBarcodeScanned,
    openCreateProduct,
    openEditProduct,
    canCreateProducts = true,
    canViewCosts = true,
    isQuickProductModalOpen,
    setIsQuickProductModalOpen,
    productFormData,
    setProductFormData,
    handleSaveProduct,
    isSavingProduct,
    isUploadingImage,
    handleProductImageUpload,
    isImageSearchModalOpen,
    setIsImageSearchModalOpen,
    generateInternalEanBarcode,
    isCustomCategoryMode,
    setIsCustomCategoryMode,
    selectableCategories,
    unregisteredBarcodeNotice,
    setUnregisteredBarcodeNotice,
    copyBarcodeToClipboard,
    priceCheckerProduct,
    setPriceCheckerProduct,
    isPriceCheckerModalOpen,
    setIsPriceCheckerModalOpen,
    priceCheckerSearch,
    setPriceCheckerSearch,
    previewProductImage,
    setPreviewProductImage,
    // Ítem manual y en espera
    isManualItemModalOpen,
    setIsManualItemModalOpen,
    manualItemName,
    setManualItemName,
    manualItemPrice,
    setManualItemPrice,
    manualItemPriceBS,
    setManualItemPriceBS,
    manualItemQty,
    setManualItemQty,
    handleAddManualItem,
    isHeldSalesModalOpen,
    setIsHeldSalesModalOpen,
    // Navegación / Biometría / Alertas / Mesas / Clientes
    isSideNavOpen,
    setIsSideNavOpen,
    socketConnected,
    pendingSalesCount,
    drawerSearch,
    setDrawerSearch,
    filteredNavSections,
    activeModule,
    setActiveModule,
    setIsBiometricsModalOpen,
    isBiometricsModalOpen,
    setEnrolledBioUser,
    isAudioMuted,
    setIsAudioMuted,
    toggleSoundMute,
    theme,
    setTheme,
    logout,
    toastMsg,
    supervisorAuthRequest,
    setSupervisorAuthRequest,
    lastHardwareScan,
    isTableSelectModalOpen,
    setIsTableSelectModalOpen,
    selectedTable,
    setSelectedTable,
    orderNotes,
    setOrderNotes,
    isCustomerSelectModalOpen,
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

  return (
    <>
      {isCheckoutOpen && (
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
      )}

      {printedReceipt && (
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
      )}

      {previewProductImage && (
        <MobileImagePreviewModal
          previewProductImage={previewProductImage}
          onClose={() => setPreviewProductImage(null)}
          onEditProduct={openEditProduct}
          triggerHaptic={triggerHaptic}
          T={T}
          isDollarCountry={isDollarCountry}
        />
      )}

      {isManualItemModalOpen && (
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
      )}

      {isHeldSalesModalOpen && (
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

      <BiometricEnrollModal
        isOpen={isBiometricsModalOpen}
        onClose={() => setIsBiometricsModalOpen(false)}
        onEnrolledChange={(cred) => {
          setEnrolledBioUser(cred);
          if (cred) showToast('Huella vinculada con éxito');
        }}
      />

      {toastMsg && (
        <div className="fixed bottom-5 right-5 bg-slate-900 border border-slate-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow-2xl z-50 flex items-center gap-2 animate-slideUp">
          <CheckCircle size={15} className="text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {supervisorAuthRequest && (
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

      {preSaleSentModal && (
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
      )}

      {whatsAppModalData && (
        <MobileWhatsAppReceiptModal
          whatsAppModalData={whatsAppModalData}
          onClose={() => setWhatsAppModalData(null)}
          T={T}
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
      )}

      {isPriceCheckerModalOpen && (
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
      )}

      {isCustomerSelectModalOpen && (
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
      )}
    </>
  );
}
