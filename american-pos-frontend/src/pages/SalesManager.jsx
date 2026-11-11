import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { History, FileText, FileBadge, Layers } from 'lucide-react';

import SalesHistory from './SalesHistory';
import Quotations from './Quotations';
import DeliveryNotes from './DeliveryNotes';

export default function SalesManager() {
    const location = useLocation();
    const navigate = useNavigate();
    
    // Determine active tab based on the current URL
    const getTabFromPath = (path) => {
        if (path.includes('quotations')) return 'quotations';
        if (path.includes('delivery-notes')) return 'delivery_notes';
        return 'sales';
    };

    const [activeTab, setActiveTab] = useState(getTabFromPath(location.pathname));

    // Listen to URL changes
    useEffect(() => {
        setActiveTab(getTabFromPath(location.pathname));
    }, [location.pathname]);

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        if (tabId === 'sales') navigate('/sales-manager', { replace: true });
        else if (tabId === 'quotations') navigate('/quotations', { replace: true });
        else if (tabId === 'delivery_notes') navigate('/delivery-notes', { replace: true });
    };

    const tabs = [
        { 
            id: 'sales', 
            label: 'Historial de Ventas', 
            subtitle: 'Registro Maestro',
            icon: History, 
            component: <SalesHistory /> 
        },
        { 
            id: 'quotations', 
            label: 'Cotizaciones', 
            subtitle: 'Propuestas y Presupuestos',
            icon: FileText, 
            component: <Quotations /> 
        },
        { 
            id: 'delivery_notes', 
            label: 'Albaranes', 
            subtitle: 'Notas de Entrega',
            icon: FileBadge, 
            component: <DeliveryNotes /> 
        }
    ];

    const currentTab = tabs.find(t => t.id === activeTab) || tabs[0];

    return (
        <div className="animate-in fade-in duration-300 pb-safe space-y-4">
            {/* Top Navigation Bar / Tabs Plate */}
            <div className="mx-1 sm:mx-4 lg:mx-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-xl shadow-xs">
                <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
                    {/* Module Breadcrumb & Active Indicator */}
                    <div className="hidden lg:flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                            <Layers size={16} />
                        </div>
                        <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block leading-tight">
                                Gestor Comercial
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white tracking-tight block">
                                {currentTab.label}
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
                                    onClick={() => handleTabChange(tab.id)}
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

            {/* Active Component Container */}
            <div className="relative">
                {currentTab.component}
            </div>
        </div>
    );
}
