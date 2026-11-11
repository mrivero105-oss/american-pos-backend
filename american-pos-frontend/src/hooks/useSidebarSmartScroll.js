import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Hook para navegación y desplazamiento ultra-rápido y suave en el menú lateral.
 * Optimizado para usuarios con ratón sin rueda de scroll (scroll wheel rota/dañada).
 */
export default function useSidebarSmartScroll() {
    const containerRef = useRef(null);
    const [canScrollUp, setCanScrollUp] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);
    const [isHoveringTop, setIsHoveringTop] = useState(false);
    const [isHoveringBottom, setIsHoveringBottom] = useState(false);

    const rafIdRef = useRef(null);
    const speedRef = useRef(0);

    // Comprobar si hay contenido desbordado arriba / abajo
    const checkScrollOverflow = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const hasScroll = el.scrollHeight > el.clientHeight + 4;
        setCanScrollUp(hasScroll && el.scrollTop > 8);
        setCanScrollDown(hasScroll && el.scrollTop + el.clientHeight < el.scrollHeight - 8);
    }, []);

    // Ciclo de animación de 60fps / 120fps fluido y rápido
    const startScrollLoop = useCallback(() => {
        if (rafIdRef.current) return;
        const step = () => {
            const el = containerRef.current;
            if (el && speedRef.current !== 0) {
                el.scrollTop += speedRef.current;
                checkScrollOverflow();
            }
            if (speedRef.current !== 0) {
                rafIdRef.current = requestAnimationFrame(step);
            } else {
                rafIdRef.current = null;
            }
        };
        rafIdRef.current = requestAnimationFrame(step);
    }, [checkScrollOverflow]);

    const stopScrollLoop = useCallback(() => {
        speedRef.current = 0;
        setIsHoveringTop(false);
        setIsHoveringBottom(false);
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }, []);

    // Desplazamiento ultra-rápido en los indicadores superior / inferior
    const startFastScrollUp = useCallback(() => {
        speedRef.current = -26;
        setIsHoveringTop(true);
        startScrollLoop();
    }, [startScrollLoop]);

    const startFastScrollDown = useCallback(() => {
        speedRef.current = 26;
        setIsHoveringBottom(true);
        startScrollLoop();
    }, [startScrollLoop]);

    // Manejador de movimiento del cursor (Hover Edge-Scroll rápido y responsivo)
    const handleMouseMove = useCallback((e) => {
        const el = containerRef.current;
        if (!el) return;

        // Si el contenido cabe sin scroll, detener
        if (el.scrollHeight <= el.clientHeight) {
            stopScrollLoop();
            return;
        }

        const rect = el.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const height = rect.height;

        // Zona de activación amplia: 28% de la altura o hasta 160px
        const threshold = Math.min(height * 0.28, 160);

        if (mouseY < threshold && mouseY >= 0) {
            // Zona superior: scroll ágil hacia arriba
            const factor = Math.max(0, (threshold - mouseY) / threshold);
            // Velocidad dinámica: de 5px hasta 30px por frame
            const baseSpeed = 5 + Math.pow(factor, 1.2) * 25;
            // Si el cursor además se mueve activamente hacia arriba, dar impulso
            const movementBoost = e.movementY < 0 ? Math.min(Math.abs(e.movementY) * 2, 12) : 0;
            speedRef.current = -(baseSpeed + movementBoost);
            setIsHoveringTop(true);
            setIsHoveringBottom(false);
            startScrollLoop();
        } else if (mouseY > height - threshold && mouseY <= height) {
            // Zona inferior: scroll ágil hacia abajo
            const factor = Math.max(0, (mouseY - (height - threshold)) / threshold);
            // Velocidad dinámica: de 5px hasta 30px por frame
            const baseSpeed = 5 + Math.pow(factor, 1.2) * 25;
            // Si el cursor además se mueve activamente hacia abajo, dar impulso
            const movementBoost = e.movementY > 0 ? Math.min(e.movementY * 2, 12) : 0;
            speedRef.current = baseSpeed + movementBoost;
            setIsHoveringTop(false);
            setIsHoveringBottom(true);
            startScrollLoop();
        } else {
            // Zona neutra intermedia para navegación/lectura
            stopScrollLoop();
        }
    }, [startScrollLoop, stopScrollLoop]);

    const handleMouseLeave = useCallback(() => {
        stopScrollLoop();
    }, [stopScrollLoop]);

    // Métodos para saltos grandes con clic en las flechas
    const scrollUpStep = useCallback(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollBy({ top: -350, behavior: 'smooth' });
    }, []);

    const scrollDownStep = useCallback(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollBy({ top: 350, behavior: 'smooth' });
    }, []);

    // Drag-to-scroll ágil en áreas libres
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let isDown = false;
        let startY = 0;
        let scrollTop = 0;

        const onMouseDown = (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('a') || e.target.closest('button')) {
                return;
            }
            isDown = true;
            startY = e.pageY - el.offsetTop;
            scrollTop = el.scrollTop;
            el.style.cursor = 'grab';
        };

        const onMouseMoveDrag = (e) => {
            if (!isDown) return;
            const y = e.pageY - el.offsetTop;
            const walk = (y - startY) * 2.2;
            if (Math.abs(walk) > 2) {
                el.scrollTop = scrollTop - walk;
                checkScrollOverflow();
            }
        };

        const onMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            el.style.cursor = '';
        };

        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMoveDrag);
        window.addEventListener('mouseup', onMouseUp);
        el.addEventListener('scroll', checkScrollOverflow, { passive: true });

        checkScrollOverflow();
        const timer = setTimeout(checkScrollOverflow, 300);
        window.addEventListener('resize', checkScrollOverflow);

        return () => {
            clearTimeout(timer);
            el.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMoveDrag);
            window.removeEventListener('mouseup', onMouseUp);
            el.removeEventListener('scroll', checkScrollOverflow);
            window.removeEventListener('resize', checkScrollOverflow);
            stopScrollLoop();
        };
    }, [checkScrollOverflow, stopScrollLoop]);

    return {
        containerRef,
        canScrollUp,
        canScrollDown,
        isHoveringTop,
        isHoveringBottom,
        handleMouseMove,
        handleMouseLeave,
        scrollUpStep,
        scrollDownStep,
        startFastScrollUp,
        startFastScrollDown,
        stopScrollLoop
    };
}
