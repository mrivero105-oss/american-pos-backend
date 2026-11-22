import { lazy, Suspense } from 'react';
import { useBusinessSettingsStore } from '../stores/useBusinessSettingsStore';
import { RefreshCw } from 'lucide-react';

const POSStandard = lazy(() => import('../pages/StandardPOSView'));
const PharmacyPOSView = lazy(() => import('../pages/PharmacyPOSView'));
const ClothingPOSView = lazy(() => import('./clothing/ClothingPOSView'));

const POSLoader = () => (
  <div className="w-full h-dvh min-h-dvh bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center gap-3">
    <RefreshCw className="animate-spin text-primary-500" size={36} />
    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Iniciando Terminal POS...</span>
  </div>
);

export default function POSSwitcher() {
  const businessMode = useBusinessSettingsStore((s) => s.businessMode);
  const mode = (businessMode || localStorage.getItem('pos_business_mode') || 'STANDARD').toUpperCase();

  if (mode === 'CLOTHING') {
    return (
      <Suspense fallback={<POSLoader />}>
        <ClothingPOSView />
      </Suspense>
    );
  }

  if (mode === 'PHARMACY') {
    return (
      <Suspense fallback={<POSLoader />}>
        <PharmacyPOSView />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<POSLoader />}>
      <POSStandard />
    </Suspense>
  );
}
