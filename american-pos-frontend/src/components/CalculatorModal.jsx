import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Delete, Divide, Minus, Plus, X as Multiply, Equal, Percent, Calculator } from 'lucide-react';
import BaseModal from './BaseModal';
import { toast } from 'react-hot-toast';

export default function CalculatorModal({ isOpen, onClose }) {
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');
  const [isNewNumber, setIsNewNumber] = useState(true);
  const modalRef = useRef(null);
  const lastEscTime = useRef(0);




  const calculate = useCallback((a, b, op) => {
    const n1 = parseFloat(a);
    const n2 = parseFloat(b);
    switch (op) {
      case '+': return n1 + n2;
      case '-': return n1 - n2;
      case '*': return n1 * n2;
      case '/': return n2 !== 0 ? n1 / n2 : 'Error';
      default: return n2;
    }
  }, []);

  const handleAction = useCallback((action) => {
    if (action === 'C') {
      setDisplay('0');
      setEquation('');
      setIsNewNumber(true);
    } else if (action === 'back') {
      if (display === 'Error' || (display.length === 2 && display.startsWith('-'))) {
        setDisplay('0');
        setIsNewNumber(true);
      } else if (display.length > 1) {
        setDisplay(display.slice(0, -1));
      } else {
        setDisplay('0');
        setIsNewNumber(true);
      }
    } else if (action === '=') {
      if (!equation) return;
      const [val1, op] = equation.split(' ');
      const result = calculate(val1, display, op);
      setDisplay(String(result));
      setEquation('');
      setIsNewNumber(true);
    } else if (action === '%') {
      if (equation) {
        const [val1, op] = equation.split(' ');
        if (op === '+' || op === '-') {
          const percentageValue = (parseFloat(val1) * parseFloat(display)) / 100;
          setDisplay(String(percentageValue));
        } else {
          setDisplay(String(parseFloat(display) / 100));
        }
      } else {
        setDisplay(String(parseFloat(display) / 100));
      }
      setIsNewNumber(true);
    } else if (['+', '-', '*', '/'].includes(action)) {
      if (equation && !isNewNumber) {
        // Calculate intermediate result for chain operations (e.g., 1 + 2 + 3)
        const [val1, op] = equation.split(' ');
        const result = calculate(val1, display, op);
        setDisplay(String(result));
        setEquation(`${result} ${action}`);
      } else {
        setEquation(`${display} ${action}`);
      }
      setIsNewNumber(true);
    } else if (action === '.') {
      if (isNewNumber) {
        setDisplay('0.');
        setIsNewNumber(false);
      } else if (!display.includes('.')) {
        setDisplay(display + '.');
      }
    } else {
      // Number
      if (isNewNumber) {
        setDisplay(action);
        setIsNewNumber(false);
      } else {
        setDisplay(display === '0' ? action : display + action);
      }
    }
  }, [display, equation, isNewNumber, calculate]);

  useEffect(() => {
    if (!isOpen) return;

    if (modalRef.current) {
      modalRef.current.focus();
    }

    const handleKeyDown = (e) => {
      const keys = ['0','1','2','3','4','5','6','7','8','9','.', '+', '-', '*', '/', 'Enter', 'Backspace', 'Escape', 'c', 'C', '%', '='];
      
      if (keys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (e.key >= '0' && e.key <= '9') handleAction(e.key);
      if (e.key === '.') handleAction('.');
      if (e.key === '+') handleAction('+');
      if (e.key === '-') handleAction('-');
      if (e.key === '*') handleAction('*');
      if (e.key === '/') handleAction('/');
      if (e.key === '%') handleAction('%');
      if (e.key === 'Enter' || e.key === '=') handleAction('=');
      if (e.key === 'Backspace') handleAction('back');
      if (e.key === 'Escape') {
        const now = Date.now();
        if (now - lastEscTime.current < 500) {
          toast.dismiss('calc-esc-toast');
          onClose();
        } else {
          handleAction('C');
          toast('Presiona ESC de nuevo para cerrar', {
            id: 'calc-esc-toast',
            duration: 2000,
            icon: '⌨️',
            style: {
              background: '#1e293b',
              color: '#f8fafc',
              fontSize: '13px',
              fontWeight: '900',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            },
          });
          lastEscTime.current = now;
        }
      }
      if (e.key === 'c' || e.key === 'C') handleAction('C');
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, handleAction, onClose]);

  if (!isOpen) return null;

  const CalcButton = ({ value, action, className = "", icon: Icon }) => (
    <button
      onClick={() => handleAction(action || value)}
      className={`h-12 sm:h-16 rounded-2xl font-black text-base sm:text-lg transition-all active:scale-95 flex items-center justify-center cursor-pointer ${className}`}
    >
      {Icon ? <Icon size={20} className="sm:w-6 sm:h-6" /> : value}
    </button>
  );

  return (
    <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        disableEscClose={true}
        maxWidth="max-w-[340px]"
        className="bg-white dark:bg-slate-900 overflow-hidden outline-none magical-shadow border border-white/20 dark:border-white/5 max-h-[95dvh] flex flex-col"
    >
            {/* Header */}
            <div className="px-5 sm:px-6 py-3.5 sm:py-4 flex justify-between items-center bg-slate-50/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2 text-primary-500">
                <Calculator size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest">Calculadora</span>
              </div>
              <button 
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center hover:bg-red-500/10 text-slate-400 hover:text-red-500 rounded-xl transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Display */}
            <div className="px-5 sm:px-8 py-4 sm:py-7 flex flex-col items-end gap-1">
              <div className="h-4 text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums uppercase tracking-widest">
                {equation}
              </div>
              <div className="text-4xl sm:text-5xl font-black text-slate-800 dark:text-white tabular-nums tracking-tighter truncate w-full text-right">
                {display}
              </div>
            </div>

            {/* Keys Grid */}
            <div className="p-4 sm:p-6 grid grid-cols-4 gap-2 sm:gap-3 bg-slate-50 dark:bg-midnight-950/50 pb-safe">
              {/* Row 1 */}
              <CalcButton value="C" className="bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400" />
              <CalcButton action="back" icon={Delete} className="bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400" />
              <CalcButton action="%" icon={Percent} className="bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400" />
              <CalcButton action="/" icon={Divide} className="bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400" />

              {/* Row 2 */}
              <CalcButton value="7" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="8" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="9" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton action="*" icon={Multiply} className="bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400" />

              {/* Row 3 */}
              <CalcButton value="4" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="5" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="6" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton action="-" icon={Minus} className="bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400" />

              {/* Row 4 */}
              <CalcButton value="1" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="2" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="3" className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton action="+" icon={Plus} className="bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400" />

              {/* Row 5 */}
              <CalcButton value="0" className="col-span-2 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton value="." className="bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 shadow-sm" />
              <CalcButton action="=" icon={Equal} className="bg-primary-600 text-white shadow-lg shadow-primary-500/40" />
            </div>
    </BaseModal>
  );
}
