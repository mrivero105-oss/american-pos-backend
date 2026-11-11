import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Reusable modal component that handles Framer Motion animations,
 * Z-index management, Esc-to-close, and overlay clicks.
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
  children 
}) {
    useEffect(() => {
        if (isOpen && onClose && !disableEscClose) {
            const handleEsc = (e) => {
                if (e.key === 'Escape' || e.key === 'Esc') {
                    // Prevenir comportamientos default cuando un modal está abierto
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                }
            };
            window.addEventListener('keydown', handleEsc, true);
            return () => window.removeEventListener('keydown', handleEsc, true);
        }
    }, [isOpen, onClose, disableEscClose]);

    if (!isOpen) return null;

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <div className={`fixed inset-0 ${zIndex} flex items-center justify-center ${backdropStyle} ${padding} overflow-y-auto overscroll-contain`}>
                    {/* Background overlay to capture clicks */}
                    <div 
                        className="fixed inset-0 z-0" 
                        onClick={(e) => {
                            // Evitar burbujeo y cerrar si no está deshabilitado
                            e.stopPropagation();
                            if (!disableOutsideClick && onClose) {
                                onClose();
                            }
                        }} 
                    />
                    
                    {/* Modal Content container */}
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className={`modal-solid bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl shadow-xl w-full max-h-[90dvh] sm:max-h-[92vh] flex flex-col relative border border-slate-200 dark:border-slate-800 z-10 overflow-hidden ${maxWidth} ${className}`}
                    >
                        {children}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
