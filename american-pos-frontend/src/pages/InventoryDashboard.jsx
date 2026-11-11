import { useState } from 'react';
import { Package, TrendingUp, PackageCheck, Layers } from 'lucide-react';
import { InventoryList } from './Inventory';
import SmartStockEntry from './SmartStockEntry';
import PurchaseReceipts from './PurchaseReceipts';

export default function InventoryDashboard() {
    const [activeTab, setActiveTab] = useState('list'); // 'list', 'smart-entry', 'receipts'

    const tabs = [
        { id: 'list', label: 'Catálogo de Artículos', icon: Package },
        { id: 'smart-entry', label: 'Reposición & Entrada', icon: TrendingUp },
        { id: 'receipts', label: 'Albaranes de Entrada', icon: PackageCheck },
    ];

    return (
        <div className="space-y-4 pb-24 pb-safe animate-in fade-in duration-300">
            {/* Top Navigation Bar */}
            <div className="mx-1 sm:mx-4 lg:mx-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-xl shadow-xs">
                <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
                    {/* Module Breadcrumb & Active Indicator */}
                    <div className="hidden lg:flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                            <Layers size={16} />
                        </div>
                        <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block leading-tight">
                                Gestión de Almacén
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white tracking-tight block">
                                Inventario y Stock
                            </span>
                        </div>
                    </div>

                    {/* Navigation Tabs Segmented Group */}
                    <div className="flex items-center overflow-x-auto p-1 rounded-lg w-full sm:w-auto bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 gap-1 text-xs">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`shrink-0 flex items-center justify-center gap-2 px-3.5 py-1.5 h-8 rounded-md font-medium transition-all cursor-pointer ${
                                        isActive 
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold' 
                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <Icon size={14} className={isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'} />
                                    <span className="whitespace-nowrap">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="relative">
                {activeTab === 'list' && <InventoryList />}
                {activeTab === 'smart-entry' && <SmartStockEntry />}
                {activeTab === 'receipts' && <PurchaseReceipts />}
            </div>
        </div>
    );
}
