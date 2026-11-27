import logoLight from '../assets/isaac-logo-horizontal.webp';
import logoDark from '../assets/isaac-logo-horizontal-dark.webp';
import emblemLight from '../assets/isaac-emblem.webp';
import emblemDark from '../assets/isaac-emblem-dark.webp';

/**
 * Logo Oficial de Isaac POS (isaacventas.com)
 * Adaptado dinámicamente para todos los tipos de fondo del sistema:
 * - Fondos claros (Studio central, Swiss, modales blancos): logotipo con texto azul marino/gris de alto contraste.
 * - Fondos oscuros (Chasis Studio, Titanium, Login, Splash): logotipo con texto blanco brillante luminiscente.
 * - Modo compacto/colapsado: emblema oficial con circuitos y sello de ventas.
 */
export default function Logo({
    className = "",
    imgClassName = "",
    compact = false,
    hideText = false,
    lightText = false,
    darkText = false,
    size = "md",
    variant = "auto",
    style = {}
}) {
    // Resolver variante según props explícitas o modo automático (Tailwind dark)
    const effectiveVariant = lightText ? 'dark' : darkText ? 'light' : variant;
    const isCompact = compact || hideText;

    // Dimensiones proporcionales para el emblema compacto (Barra lateral cerrada de 68px o avatares)
    const emblemSizeMap = {
        sm: 'w-8 h-8 sm:w-9 sm:h-9',
        md: 'w-10 h-10 sm:w-11 sm:h-11',
        lg: 'w-12 h-12 sm:w-13 sm:h-13',
        xl: 'w-14 h-14 sm:w-16 sm:h-16'
    };

    // Dimensiones proporcionales para el logotipo horizontal (aspect ratio ~3.18:1)
    const horizontalSizeMap = {
        sm: 'h-8 sm:h-9 max-w-[170px]',
        md: 'h-10 sm:h-11 max-w-[200px]',
        sidebar: 'h-[58px] sm:h-[64px] lg:h-[70px] w-auto max-w-[215px] xl:max-w-[235px]',
        lg: 'h-12 sm:h-14 lg:h-16 max-w-[280px]',
        xl: 'h-16 sm:h-18 lg:h-20 max-w-[360px] lg:max-w-[420px]',
        hero: 'h-16 sm:h-20 lg:h-24 max-w-[380px] sm:max-w-[460px] lg:max-w-[520px]'
    };

    // Caso 1: Modo Compacto / Emblema Colapsado (Barra lateral cerrada, iconos, avatares de marca)
    if (isCompact) {
        const emblemClass = emblemSizeMap[size] || emblemSizeMap.md;
        return (
            <div className={`relative flex items-center justify-center shrink-0 group select-none ${className}`} style={style}>
                {/* Emblema Fondo Claro */}
                {(effectiveVariant === 'auto' || effectiveVariant === 'light') && (
                    <img 
                        src={emblemLight} 
                        alt="Isaac POS" 
                        className={`isaac-emblem-light ${emblemClass} ${imgClassName} object-contain transition-transform group-hover:scale-105 duration-200 pointer-events-none drop-shadow-sm ${
                            effectiveVariant === 'auto' ? 'dark:hidden block' : 'block'
                        }`}
                        loading="eager"
                        decoding="async"
                        onError={(e) => {
                            if (e.target.src !== '/isaac-emblem.png') {
                                e.target.src = '/isaac-emblem.png';
                            }
                        }}
                    />
                )}
                {/* Emblema Fondo Oscuro */}
                {(effectiveVariant === 'auto' || effectiveVariant === 'dark') && (
                    <img 
                        src={emblemDark} 
                        alt="Isaac POS" 
                        className={`isaac-emblem-dark ${emblemClass} ${imgClassName} object-contain transition-transform group-hover:scale-105 duration-200 pointer-events-none drop-shadow-sm ${
                            effectiveVariant === 'auto' ? 'hidden dark:block' : 'block'
                        }`}
                        loading="eager"
                        decoding="async"
                        onError={(e) => {
                            if (e.target.src !== '/isaac-emblem-dark.png') {
                                e.target.src = '/isaac-emblem-dark.png';
                            }
                        }}
                    />
                )}
            </div>
        );
    }

    // Caso 2: Logotipo Oficial Horizontal Completo de isaacventas.com
    const sizeClass = horizontalSizeMap[size] || horizontalSizeMap.md;

    return (
        <div className={`relative flex items-center justify-center select-none ${className}`} style={style}>
            {/* Logotipo para fondos claros */}
            {(effectiveVariant === 'auto' || effectiveVariant === 'light') && (
                <img
                    src={logoLight}
                    alt="Isaac POS • Sistema de Facturación"
                    className={`isaac-logo-light ${sizeClass} ${imgClassName} w-auto object-contain pointer-events-none transition-opacity duration-200 ${
                        effectiveVariant === 'auto' ? 'dark:hidden block' : 'block'
                    }`}
                    style={{
                        imageRendering: '-webkit-optimize-contrast',
                        filter: 'contrast(1.08) saturate(1.12) drop-shadow(0 2px 8px rgba(2,132,199,0.12))'
                    }}
                    loading="eager"
                    decoding="async"
                    onError={(e) => {
                        if (e.target.src !== '/isaac-logo-horizontal.png') {
                            e.target.src = '/isaac-logo-horizontal.png';
                        }
                    }}
                />
            )}

            {/* Logotipo para fondos oscuros */}
            {(effectiveVariant === 'auto' || effectiveVariant === 'dark') && (
                <img
                    src={logoDark}
                    alt="Isaac POS • Sistema de Facturación"
                    className={`isaac-logo-dark ${sizeClass} ${imgClassName} w-auto object-contain pointer-events-none transition-opacity duration-200 drop-shadow-[0_2px_14px_rgba(0,229,255,0.32)] ${
                        effectiveVariant === 'auto' ? 'hidden dark:block' : 'block'
                    }`}
                    style={{
                        imageRendering: '-webkit-optimize-contrast',
                        filter: 'brightness(1.08) contrast(1.12)'
                    }}
                    loading="eager"
                    decoding="async"
                    onError={(e) => {
                        if (e.target.src !== '/isaac-logo-horizontal-dark.png') {
                            e.target.src = '/isaac-logo-horizontal-dark.png';
                        }
                    }}
                />
            )}
        </div>
    );
}
