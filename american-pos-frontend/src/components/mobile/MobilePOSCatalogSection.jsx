import {
    LayoutGrid,
    List,
    Plus,
    RefreshCw,
    Search,
    ShoppingCart
} from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';
import MobileProductCard from './MobileProductCard';
import VirtualProductList from '../common/VirtualProductList';

const computeMobileCatalogColumns = (width) => {
    if (width >= 1220) return 6;
    if (width >= 960) return 5;
    if (width >= 720) return 4;
    if (width >= 480) return 3;
    return 2;
};

export default function MobilePOSCatalogSection({
    T,
    isLight,
    normalizedCategories,
    selectedCategory,
    setSelectedCategory,
    categoryCounts,
    toggleCatalogLayout,
    catalogLayout,
    catalogScrollRef,
    handleCatalogTouchStart,
    handleCatalogTouchMove,
    handleCatalogTouchEnd,
    pullIndicatorRef,
    isPullRefreshing,
    filteredProducts,
    products,
    openCreateProduct,
    setIsManualItemModalOpen,
    cartCommittedUnitsMap,
    exchangeRate,
    businessMode,
    posMode,
    addToCart,
    decrementFromCard,
    handleOpenBulkPicker,
    handlePriceCheck,
    openEditProduct,
    handlePreviewImage
}) {
    const isList = catalogLayout === 'list';

    return (
        <>
            {/* Riel de Categorías tipo Cápsula + Conmutador Rápido Lista / Fotos */}
            <div className={`pos-catalog-toolbar px-3 py-1.5 shrink-0 border-b flex items-center gap-2 ${T.border} ${isLight ? 'bg-white' : 'bg-[#0b0e14]'}`}>
                <div
                    className="pos-category-strip flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 touch-pan-x overscroll-contain select-none"
                    onWheel={(e) => {
                        if (e.deltaY !== 0) {
                            e.currentTarget.scrollLeft += e.deltaY;
                        }
                    }}
                >
                    {normalizedCategories.map(cat => {
                        const isActive = selectedCategory === cat;
                        const count = categoryCounts[cat] ?? 0;
                        return (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => {
                                    triggerHaptic(8);
                                    setSelectedCategory(cat);
                                }}
                                className={`px-3 py-1 rounded-full text-xs font-extrabold whitespace-nowrap transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 border ${
                                    isActive
                                        ? (isLight
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                            : 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-2xs')
                                        : (isLight
                                            ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                            : 'bg-[#131924] text-slate-300 border-[#232d3f] hover:border-slate-600')
                                }`}
                            >
                                <span>{cat}</span>
                                <span
                                    className={`px-1.5 py-0.5 rounded-full text-[9.5px] font-mono font-black leading-none ${
                                        isActive
                                            ? (isLight ? 'bg-white/20 text-white' : 'bg-black/20 text-slate-950')
                                            : (isLight ? 'bg-white text-slate-600' : 'bg-[#0b0e14] text-slate-400')
                                    }`}
                                >
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Conmutador Táctico Lista vs Cuadrícula */}
                <button
                    type="button"
                    onClick={toggleCatalogLayout}
                    className={`h-8 px-2.5 rounded-full border flex items-center justify-center gap-1 shrink-0 text-xs font-bold transition-transform cursor-pointer active:scale-95 ${
                        isLight
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                            : 'bg-[#131924] hover:bg-[#1a2230] text-slate-200 border-[#232d3f]'
                    }`}
                    title={isList ? 'Cambiar a cuadrícula con fotos' : 'Cambiar a lista táctica rápida'}
                >
                    {isList ? (
                        <>
                            <LayoutGrid size={13} className="text-emerald-400" />
                            <span className="text-[10.5px] font-extrabold hidden xs:inline">Fotos</span>
                        </>
                    ) : (
                        <>
                            <List size={13} className="text-emerald-400" />
                            <span className="text-[10.5px] font-extrabold hidden xs:inline">Lista</span>
                        </>
                    )}
                </button>
            </div>

            {/* Grid/Lista de Productos Virtualizada O(1) con @tanstack/react-virtual */}
            <div
                id="mobile-product-catalog"
                ref={catalogScrollRef}
                onTouchStart={handleCatalogTouchStart}
                onTouchMove={handleCatalogTouchMove}
                onTouchEnd={handleCatalogTouchEnd}
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 sm:p-3.5 md:p-4 pt-2.5 pb-6 custom-scrollbar"
                style={{ WebkitOverflowScrolling: 'touch' }}
            >
                {/* Indicador Visual Interactivo de Pull-to-Refresh */}
                <div
                    ref={pullIndicatorRef}
                    className="w-full flex items-center justify-center transition-all overflow-hidden mb-2 pointer-events-none"
                    style={{ height: isPullRefreshing ? '44px' : '0px', opacity: isPullRefreshing ? 1 : 0 }}
                >
                    <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0a0d12] text-white border border-[#1e242e] text-xs font-bold shadow-xs">
                        <RefreshCw
                            size={14}
                            className={isPullRefreshing ? 'animate-spin text-emerald-400' : 'text-emerald-400'}
                        />
                        <span>{isPullRefreshing ? 'Sincronizando con PC...' : 'Actualizar catálogo'}</span>
                    </div>
                </div>

                {filteredProducts.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs sm:text-sm text-center px-4">
                        <Search size={28} className="text-slate-600 mb-2" />
                        <p className="font-bold">{products.length === 0 ? 'Catálogo Local Listo' : 'No se encontraron productos'}</p>
                        <p className="text-slate-600 text-xs mb-3">
                            {products.length === 0
                                ? 'Puedes vender ítems directos o registrar productos en modo local'
                                : 'Intenta con otro término o categoría'}
                        </p>
                        {products.length === 0 && (
                            <div className="flex flex-wrap items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openCreateProduct()}
                                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform cursor-pointer"
                                >
                                    <Plus size={14} />
                                    <span>Crear Producto</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsManualItemModalOpen(true)}
                                    className={`px-3.5 py-2 ${T.btnGhost} rounded-xl font-bold text-xs flex items-center gap-1.5 active:scale-95 transition-transform cursor-pointer`}
                                >
                                    <ShoppingCart size={14} />
                                    <span>Ítem Rápido</span>
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <VirtualProductList
                        items={filteredProducts}
                        scrollElementRef={catalogScrollRef}
                        columns={isList ? 1 : computeMobileCatalogColumns}
                        gap={isList ? 8 : 11}
                        estimateSize={isList ? 92 : 216}
                        overscan={4}
                        layoutKey={catalogLayout}
                        renderItem={(product) => (
                            <MobileProductCard
                                product={product}
                                layout={isList ? 'list' : 'grid'}
                                cartQuantity={cartCommittedUnitsMap.get(String(product.id)) || 0}
                                exchangeRate={exchangeRate}
                                businessMode={businessMode}
                                posMode={posMode}
                                isLight={isLight}
                                T={T}
                                onAddToCart={addToCart}
                                onDecrementFromCart={decrementFromCard}
                                onOpenBulkPicker={handleOpenBulkPicker}
                                onPriceCheck={handlePriceCheck}
                                onEditProduct={openEditProduct}
                                onPreviewImage={handlePreviewImage}
                            />
                        )}
                    />
                )}
            </div>
        </>
    );
}
