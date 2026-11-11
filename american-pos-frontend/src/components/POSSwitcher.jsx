import { lazy, Suspense } from 'react';
import { usePos } from '../hooks/PosContext';
import { RefreshCw } from 'lucide-react';

const PharmacyPOSView = lazy(() => import('../pages/PharmacyPOSView'));
const POSOriginal = lazy(() => import('../pages/POS_OriginalBackup'));
const ClothingPOSView = lazy(() => import('./clothing/ClothingPOSView'));

const POSLoader = () => (
  <div className="w-full h-dvh min-h-dvh bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center gap-3">
    <RefreshCw className="animate-spin text-primary-500" size={36} />
    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Iniciando Terminal POS...</span>
  </div>
);

export default function POSSwitcher() {
  const { businessMode } = usePos();
  const mode = (businessMode || localStorage.getItem('pos_business_mode') || 'STANDARD').toUpperCase();

  return (
    <Suspense fallback={<POSLoader />}>
      {mode === 'CLOTHING' && <ClothingPOSView />}
      {mode === 'PHARMACY' && <PharmacyPOSView />}
      {mode !== 'CLOTHING' && mode !== 'PHARMACY' && <POSOriginal />}
    </Suspense>
  );
}
