import { useEffect } from 'react';

/**
 * Hook para escalar la interfaz en pantallas de baja resolución (ej. 1024x768)
 * utilizando CSS zoom nativo de Chromium sin romper position: fixed.
 */
export function useWin7Zoom() {
    useEffect(() => {
        // Garantizar que la raíz siempre mantenga escalado nativo (zoom: 1)
        // para evitar la rotura de coordenadas position: fixed, modales y framer-motion.
        if (document.documentElement.style.zoom !== '1') {
            document.documentElement.style.zoom = '1';
        }
        return () => {
            document.documentElement.style.zoom = '1';
        };
    }, []);
}
