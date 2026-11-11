import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { ShoppingBag, Search, PackageOpen } from 'lucide-react';
import CustomerAIChat from '../components/CustomerAIChat';
import { isDollarOnlyCountry } from '../utils/format';

const PublicStore = () => {
    const { companyId } = useParams();
    const [storeData, setStoreData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const fetchStore = async () => {
            try {
                // Determine base URL since this runs without auth config
                const currentPort = window.location.port;
                const devPorts = ['5173', '5174', '5175'];
                let targetPort = devPorts.includes(currentPort) ? '3005' : (currentPort || '3005');
                const baseUrl = `${window.location.protocol}//${window.location.hostname}:${targetPort}`;

                const { data } = await axios.get(`${baseUrl}/public-catalog/${companyId}`);
                setStoreData(data);
            } catch (error) {
                console.error('Error fetching store:', error);
            } finally {
                setLoading(false);
            }
        };

        if (companyId) fetchStore();
    }, [companyId]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                <p className="text-slate-400">Cargando catálogo...</p>
            </div>
        );
    }

    if (!storeData) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-center p-4">
                <PackageOpen size={64} className="text-slate-600 mb-4" />
                <h1 className="text-2xl font-bold text-white mb-2">Comercio no encontrado</h1>
                <p className="text-slate-400">Verifica que el enlace sea correcto.</p>
            </div>
        );
    }

    const { business, products } = storeData;

    const filteredProducts = products.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        p.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200">
            {/* Header */}
            <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-xl">
                <div className="max-w-6xl mx-auto px-4 py-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">
                                <ShoppingBag size={28} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white">{business.name}</h1>
                                {business.address && <p className="text-sm text-slate-400">{business.address}</p>}
                            </div>
                        </div>
                        <div className="relative w-full md:w-96">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input 
                                type="text"
                                placeholder="Buscar productos..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>
                    </div>
                </div>
            </header>

            {/* Product Grid */}
            <main className="max-w-6xl mx-auto px-4 py-8">
                {filteredProducts.length === 0 ? (
                    <div className="text-center py-20 text-slate-500">
                        <PackageOpen size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No se encontraron productos.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                        {filteredProducts.map(product => {
                            let priceDisplay = '';
                            const isDollarCountry = isDollarOnlyCountry(business?.country || localStorage.getItem('pos_country'));
                            if (isDollarCountry || business.currencyMode === 'USD') {
                                priceDisplay = `$${product.price.toFixed(2)}`;
                            } else if (business.currencyMode === 'VES') {
                                priceDisplay = `Bs. ${(product.price * business.rate).toFixed(2)}`;
                            } else {
                                priceDisplay = `$${product.price.toFixed(2)} / Bs. ${(product.price * business.rate).toFixed(2)}`;
                            }

                            return (
                                <div key={product.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors group">
                                    <div className="aspect-square bg-slate-800 relative overflow-hidden flex items-center justify-center">
                                        {product.imageUrl ? (
                                            <img 
                                                src={product.imageUrl.startsWith('http') ? product.imageUrl : `${window.location.protocol}//${window.location.hostname}:3005${product.imageUrl}`} 
                                                alt={product.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <ShoppingBag size={40} className="text-slate-600" />
                                        )}
                                        {!product.hasStock && (
                                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                                <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">AGOTADO</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-4">
                                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{product.category}</p>
                                        <h3 className="text-sm font-semibold text-white mb-2 line-clamp-2">{product.name}</h3>
                                        <p className="text-lg font-bold text-blue-400">{priceDisplay}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* AI Chat Widget */}
            <CustomerAIChat companyId={companyId} businessName={business.name} />
        </div>
    );
};

export default PublicStore;
