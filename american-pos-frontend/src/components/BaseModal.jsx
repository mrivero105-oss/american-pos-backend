import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Reusable accessible modal component handling Framer Motion animations,
 * Z-index portal mounting, Esc-to-close, overlay clicks, and keyboard focus trapping.
 */
export default function BaseModal({
  isOpen,
  onClose,
  maxWidth = 'max-w-md',
  zIndex = 'z-[100000]',
  className = '',
  backdropStyle = 'bg-slate-950/70',
  padding = 'p-3 sm:p-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]',
  disableOutsideClick = false,
  disableEscClose = false,
  ariaLabel = 'Ventana de diálogo',
  ariaLabelledBy,
  children
}) {
    const dialogRef = useRef(null);
    const previousFocusRef = useRef(null);
    const onCloseRef = useRef(onClose);
    const disableEscCloseRef = useRef(disableEscClose);

    useEffect(() => {
        onCloseRef.current = onClose;
        disableEscCloseRef.current = disableEscClose;
    }, [onClose, disableEscClose]);

    useEffect(() => {
        if (!isOpen) return undefined;
        previousFocusRef.current = typeof document !== 'undefined' ? document.activeElement : null;

        const focusTimer = setTimeout(() => {
            const container = dialogRef.current;
            if (!container) return;
            // No robar foco si el modal hijo ya enfocó un input específico dentro del diálogo
            if (document.activeElement && container.contains(document.activeElement) && document.activeElement !== container) {
                return;
            }
            const firstFocusable = container.querySelector(FOCUSABLE_SELECTOR);
            if (firstFocusable && typeof firstFocusable.focus === 'function') {
                firstFocusable.focus();
            } else {
                container.focus();
            }
        }, 10);

        const handleKeyDown = (e) => {
            if ((e.key === 'Escape' || e.key === 'Esc') && onCloseRef.current && !disableEscCloseRef.current) {
                e.preventDefault();
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (e.key === 'Tab') {
                const container = dialogRef.current;
                if (!container) return;
                const nodes = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
                    (el) => el.offsetParent !== null
                );
                if (nodes.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = nodes[0];
                const last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            clearTimeout(focusTimer);
            window.removeEventListener('keydown', handleKeyDown, true);
            const prev = previousFocusRef.current;
            if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
                prev.focus();
            }
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div className={`fixed inset-0 ${zIndex} flex items-center justify-center ${backdropStyle} ${padding} overflow-y-auto overscroll-contain`}>
                    <div
                        className="fixed inset-0 z-0"
                        aria-hidden="true"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!disableOutsideClick && onClose) {
                                onClose();
                            }
                        }}
                    />

                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={ariaLabelledBy ? undefined : ariaLabel}
                        aria-labelledby={ariaLabelledBy}
                        tabIndex={-1}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className={`modal-solid bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl shadow-xl w-full max-h-[90dvh] sm:max-h-[92vh] flex flex-col relative border border-slate-200 dark:border-slate-800 z-10 overflow-hidden focus:outline-none ${maxWidth} ${className}`}
                    >
                        {children}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
