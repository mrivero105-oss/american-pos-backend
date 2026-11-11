import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Hook para permitir desplazamiento horizontal EXCLUSIVAMENTE mediante la rueda del ratón (scroll wheel).
 * Elimina auto-desplazamientos por hover en bordes (Edge Glide) y arrastres artificiales por clic.
 */
export default function useHorizontalScroll() {
    const [element, setElement] = useState(null);
    const elementRef = useRef(null);

    const refCallback = useCallback((node) => {
        elementRef.current = node;
        setElement(node);
    }, []);

    useEffect(() => {
        const el = element;
        if (!el) return;

        // Desplazamiento horizontal controlado únicamente por rueda de ratón o touchpad
        const onWheel = (e) => {
            if (el.scrollWidth <= el.clientWidth) return;

            const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
            if (delta !== 0) {
                e.preventDefault();
                el.scrollLeft += delta * 1.1;
            }
        };

        el.addEventListener("wheel", onWheel, { passive: false });

        return () => {
            el.removeEventListener("wheel", onWheel);
        };
    }, [element]);

    return refCallback;
}

