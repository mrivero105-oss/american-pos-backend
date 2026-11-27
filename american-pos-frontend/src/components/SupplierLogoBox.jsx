import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { getImageUrl } from '../utils/imageUtils';
import { getSupplierInitials } from '../utils/supplierTheme';

/**
 * Recuadro insignia para logotipos y avatares corporativos de proveedores
 */
export default function SupplierLogoBox({ 
    supplier, 
    onClick, 
    size = 'md', 
    className = '',
    showActionBadge = false,
    title = 'Clic para buscar o cambiar logotipo corporativo'
}) {
    const [imgError, setImgError] = useState(false);

    useEffect(() => {
        setImgError(false);
    }, [supplier?.logoUri]);

    const initials = getSupplierInitials(supplier?.name);
    const hasValidLogo = Boolean(supplier?.logoUri && !imgError);

    // Dimensionamiento proporcional y tipográfico
    const sizeConfig = {
        sm: {
            container: 'w-9 h-9 rounded-lg',
            text: 'text-[11px] font-bold',
            icon: 13,
            badge: 'w-3 h-3',
            badgeIcon: 7,
            padding: 'p-1'
        },
        md: {
            container: 'w-10 h-10 rounded-lg',
            text: 'text-xs font-bold tracking-wider',
            icon: 14,
            badge: 'w-3.5 h-3.5',
            badgeIcon: 8,
            padding: 'p-1'
        },
        lg: {
            container: 'w-12 h-12 rounded-xl',
            text: 'text-sm font-bold tracking-wider',
            icon: 16,
            badge: 'w-4 h-4',
            badgeIcon: 9,
            padding: 'p-1.5'
        }
    }[size] || {
        container: 'w-10 h-10 rounded-lg',
        text: 'text-xs font-bold tracking-wider',
        icon: 14,
        badge: 'w-3.5 h-3.5',
        badgeIcon: 8,
        padding: 'p-1'
    };

    return (
        <div 
            onClick={onClick}
            title={title}
            className={`relative group/logo ${sizeConfig.container} shrink-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-center overflow-hidden cursor-pointer transition-colors duration-150 hover:border-slate-400 dark:hover:border-slate-500 ${className}`}
        >
            {hasValidLogo ? (
                <div className={`w-full h-full ${sizeConfig.padding} flex items-center justify-center bg-white dark:bg-slate-900 transition-colors`}>
                    <img 
                        src={getImageUrl(supplier.logoUri)} 
                        alt={supplier?.name || 'Logo del proveedor'} 
                        className="w-full h-full object-contain transition-transform duration-150 group-hover/logo:scale-105"
                        onError={() => setImgError(true)}
                    />
                </div>
            ) : (
                <div className={`w-full h-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex flex-col items-center justify-center font-bold uppercase relative select-none border border-slate-200/50 dark:border-slate-700/50`}>
                    <span className={`${sizeConfig.text}`}>{initials}</span>
                </div>
            )}

            {/* Overlay interactivo al pasar el cursor */}
            {onClick && (
                <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex flex-col items-center justify-center opacity-0 group-hover/logo:opacity-100 transition-opacity duration-150 text-white z-10 pointer-events-none">
                    <Globe size={sizeConfig.icon} className="text-slate-200 mb-0.5" />
                    <span className="text-[7.5px] font-semibold tracking-tight text-white uppercase">Logo</span>
                </div>
            )}

            {/* Micro-insignia en esquina sólo si se solicita explícitamente */}
            {showActionBadge && onClick && (
                <div className={`absolute bottom-0.5 right-0.5 ${sizeConfig.badge} rounded-full bg-slate-700 text-white flex items-center justify-center shadow-xs border border-white dark:border-slate-900 opacity-80 group-hover/logo:opacity-0 transition-opacity z-5 pointer-events-none`}>
                    <Globe size={sizeConfig.badgeIcon} />
                </div>
            )}
        </div>
    );
}
