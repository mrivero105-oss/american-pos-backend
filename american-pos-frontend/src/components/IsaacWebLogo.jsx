import logoLight from '../assets/isaac-logo-horizontal.png';
import logoDark from '../assets/isaac-logo-horizontal-dark.png';

/**
 * Logo Oficial de la Web Isaac POS (isaacventas.com)
 * Banner horizontal corporativo con circuitos y sello de ventas.
 * Adaptado dinámicamente para temas claro y oscuro con empaquetado offline nativo.
 */
export default function IsaacWebLogo({ 
  isLight = null, 
  variant = 'auto', // 'auto' | 'light' | 'dark'
  className = "", 
  height = "h-7 sm:h-8",
  imgClassName = "max-w-[145px] sm:max-w-[180px]",
  style = {}
}) {
  const resolvedVariant = isLight === true ? 'light' : isLight === false ? 'dark' : variant;

  return (
    <div className={`flex items-center select-none ${className}`}>
      {/* Versión para fondo claro */}
      {(resolvedVariant === 'auto' || resolvedVariant === 'light') && (
        <img
          src={logoLight}
          alt="Isaac POS • Sistema de Facturación"
          className={`${height} w-auto ${imgClassName} object-contain select-none pointer-events-none transition-opacity duration-200 ${
            resolvedVariant === 'auto' ? 'dark:hidden block' : 'block'
          }`}
          style={{
            imageRendering: '-webkit-optimize-contrast',
            ...style
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

      {/* Versión para fondo oscuro */}
      {(resolvedVariant === 'auto' || resolvedVariant === 'dark') && (
        <img
          src={logoDark}
          alt="Isaac POS • Sistema de Facturación"
          className={`${height} w-auto ${imgClassName} object-contain select-none pointer-events-none transition-opacity duration-200 ${
            resolvedVariant === 'auto' ? 'hidden dark:block' : 'block'
          }`}
          style={{
            imageRendering: '-webkit-optimize-contrast',
            ...style
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
