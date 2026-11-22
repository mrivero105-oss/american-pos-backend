import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import {
    Store, 
    Shield as ShieldIcon, 
    Loader2, 
    CreditCard, 
    Printer, 
    Database, 
    Banknote, 
    SlidersHorizontal, 
    HardDrive, 
    MessageSquare, 
    Search, 
    Volume2
} from 'lucide-react';
import { db } from '../services/db';
import { syncManager } from '../services/syncManager';
import ConfirmModal from '../components/ConfirmModal';
import { isDollarOnlyCountry } from '../utils/format';

// Modular Components
import RateSettings from '../components/settings/RateSettings';
import BusinessSettings from '../components/settings/BusinessSettings';
import TaxSettings from '../components/settings/TaxSettings';
import PaymentMethodSettings from '../components/settings/PaymentMethodSettings';
import BackupSettings from '../components/settings/BackupSettings';
import OfflineSalesSettings from '../components/settings/OfflineSalesSettings';
import RegionSettings from '../components/settings/RegionSettings';
import SecuritySettings from '../components/settings/SecuritySettings';
import WhatsappBotSettings from '../components/settings/WhatsappBotSettings';
import StartupSettings from '../components/settings/StartupSettings';
import GithubUpdaterSettings from '../components/settings/GithubUpdaterSettings';
import EmailSettings from '../components/settings/EmailSettings';
import PrinterSettings from '../components/settings/PrinterSettings';
import VoiceSoundSettings from '../components/settings/VoiceSoundSettings';
import SupervisorPinModal from '../components/SupervisorPinModal';
import QuickSettingsFinder from '../components/settings/QuickSettingsFinder';

import { useAuth } from '../hooks/AuthContext';

const SETTINGS_TABS = [
    { id: 'business', label: 'Identidad & Negocio', icon: Store, desc: 'Perfil, Región & Datos', color: 'from-blue-500 to-indigo-600', badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
    { id: 'printers', label: 'Impresoras & Periféricos', icon: Printer, desc: 'USB, Red & Réplica Multicaja', color: 'from-blue-600 to-cyan-600', badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
    { id: 'billing', label: 'Finanzas & Pagos', icon: CreditCard, desc: 'Tasa BCV, IVA & Métodos', color: 'from-emerald-500 to-teal-600', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    { id: 'security', label: 'Seguridad & Acceso', icon: ShieldIcon, desc: 'Bloqueo & Supervisor', color: 'from-amber-500 to-orange-600', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    { id: 'system', label: 'Sistema & Respaldos', icon: Database, desc: 'BBDD, WhatsApp & USB', color: 'from-purple-500 to-pink-600', badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400' },
];

export default function Settings() {
    const { user } = useAuth();
    const isOwnerUser = ['owner', 'dueño', 'dueno', 'superadmin'].includes((user?.role || '').toLowerCase());
    const [searchParams, setSearchParams] = useSearchParams();
    const tabFromUrl = searchParams.get('tab');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState(
        SETTINGS_TABS.some(t => t.id === tabFromUrl) ? tabFromUrl : 'business'
    );
    const [subTabSystem, setSubTabSystem] = useState('backups');
    const [isQuickFinderOpen, setIsQuickFinderOpen] = useState(false);
    const [showRegionSettings, setShowRegionSettings] = useState(false);

    const handleQuickSelectSetting = (setting) => {
        if (setting?.triggerOpen) {
            setIsQuickFinderOpen(true);
            return;
        }
        if (setting?.id === 'biz_country_region' || setting?.targetElementId === 'region-settings-card') {
            setShowRegionSettings(true);
        }
        if (setting?.tab) {
            handleTabChange(setting.tab);
        }
        if (setting?.subTab) {
            setSubTabSystem(setting.subTab);
        }
    };

    const getCountryFlag = (country) => {
        if (!country) return '🇻🇪';
        const c = String(country).toLowerCase();
        if (c.includes('ecuador')) return '🇪🇨';
        if (c.includes('panam')) return '🇵🇦';
        if (c.includes('eeuu') || c.includes('usa') || c.includes('united') || c.includes('estados unidos')) return '🇺🇸';
        if (c.includes('colombia')) return '🇨🇴';
        if (c.includes('venezuela')) return '🇻🇪';
        return '🌐';
    };

    // Rate & Currency Mode
    const [rate, setRate] = useState('');
    const [currencyMode, setCurrencyMode] = useState('BOTH');

    // Business
    const [business, setBusiness] = useState({
        name: '', rif: '', address: '', phone: '', email: '',
        logo: '', receiptHeader: '', receiptFooter: '',
        receiptWidth: '80mm', printMode: 'RAW', openDrawerOnPrint: true,
        openDrawerOnlyCash: true, requireSupervisorForDrawer: true,
        printerName: '', drawerSequence: '27,112,48,25,250',
        broadcastPrintingEnabled: false, networkPrinterEnabled: false
    });

    // Taxes
    const [taxes, setTaxes] = useState({
        ivaEnabled: true, ivaRate: 16,
        igtfEnabled: false, igtfRate: 3
    });

    // Payment Methods
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [systemPrinters, setSystemPrinters] = useState([]);
    const [refreshingPrinters, setRefreshingPrinters] = useState(false);
    const [offlineSales, setOfflineSales] = useState([]);
    const [syncingOffline, setSyncingOffline] = useState(false);

    // Backups
    const [pgBackups, setPgBackups] = useState([]);
    const [generatingBackup, setGeneratingBackup] = useState(false);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: '', data: null });

    useEffect(() => {
        if (SETTINGS_TABS.some(t => t.id === tabFromUrl)) {
            setActiveTab(tabFromUrl);
        }
    }, [tabFromUrl]);

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        if (tabId === 'business') {
            setSearchParams({}, { replace: true });
        } else {
            setSearchParams({ tab: tabId }, { replace: true });
        }
    };

    const fetchOfflineSales = async () => {
        try {
            const sales = await db.getAll('sales');
            setOfflineSales((Array.isArray(sales) ? sales : []).filter(s => s.status === 'pending'));
        } catch (err) { console.error(err); }
    };

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const [rateRes, bizRes, taxRes, payRes] = await Promise.all([
                api.get('/settings/rate').catch(() => null),
                api.get('/settings/business').catch(() => null),
                api.get('/settings/taxes').catch(() => null),
                api.get('/settings/payment-methods').catch(() => null)
            ]);
            
            if (rateRes && rateRes.data) {
                setRate(rateRes.data.rate || '');
                setCurrencyMode(rateRes.data.currencyMode || 'BOTH');
                localStorage.setItem('pos_exchange_rate', String(rateRes.data.rate || ''));
                localStorage.setItem('pos_currency_mode', rateRes.data.currencyMode || 'BOTH');
            } else {
                setRate(localStorage.getItem('pos_exchange_rate') || '');
                setCurrencyMode(localStorage.getItem('pos_currency_mode') || 'BOTH');
            }

            if (bizRes && bizRes.data) {
                setBusiness(bizRes.data);
                localStorage.setItem('pos_business_settings', JSON.stringify(bizRes.data));
                localStorage.setItem('pos_broadcast_print_enabled', String(bizRes.data.broadcastPrintingEnabled === true));
                if (bizRes.data.businessMode) {
                    localStorage.setItem('pos_business_mode', bizRes.data.businessMode);
                    window.dispatchEvent(new Event('business_mode_changed'));
                }
                if (bizRes.data.country) {
                    localStorage.setItem('pos_country', bizRes.data.country);
                }
            } else {
                try {
                    const savedBiz = JSON.parse(localStorage.getItem('pos_business_settings') || '{}');
                    if (savedBiz && Object.keys(savedBiz).length > 0) {
                        setBusiness(savedBiz);
                        localStorage.setItem('pos_broadcast_print_enabled', String(savedBiz.broadcastPrintingEnabled === true));
                    }
                } catch (caughtErr) { console.warn('[Settings] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            }

            if (taxRes && taxRes.data) {
                setTaxes(taxRes.data);
                localStorage.setItem('pos_tax_settings', JSON.stringify(taxRes.data));
            } else {
                try {
                    const savedTaxes = JSON.parse(localStorage.getItem('pos_tax_settings') || '{}');
                    if (savedTaxes && Object.keys(savedTaxes).length > 0) setTaxes(savedTaxes);
                } catch (caughtErr) { console.warn('[Settings] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            }

            if (payRes && payRes.data) {
                setPaymentMethods(payRes.data || []);
                localStorage.setItem('pos_payment_methods', JSON.stringify(payRes.data));
            } else {
                try {
                    const savedPay = JSON.parse(localStorage.getItem('pos_payment_methods') || '[]');
                    if (savedPay && savedPay.length > 0) setPaymentMethods(savedPay);
                } catch (caughtErr) { console.warn('[Settings] Error parseando JSON local:', caughtErr?.message || caughtErr); }
            }
        } catch (error) { 
            console.error(error); 
        } finally { 
            setLoading(false); 
        }
    };

    const handleSaveRate = async (e) => {
        if (e) e.preventDefault();
        try {
            setSaving(true);
            localStorage.setItem('pos_exchange_rate', String(rate));
            localStorage.setItem('pos_currency_mode', currencyMode);
            await api.post('/settings/rate', { rate, currencyMode });
            toast.success('Configuración de tasa guardada con éxito');
        } catch (_error) { 
            toast.success('Tasa guardada localmente'); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleSaveBusiness = async (e) => {
        if (e) e.preventDefault();
        try {
            setSaving(true);
            localStorage.setItem('pos_business_settings', JSON.stringify(business));
            localStorage.setItem('pos_business_info', JSON.stringify(business));
            localStorage.setItem('pos_broadcast_print_enabled', String(business.broadcastPrintingEnabled === true));
            if (business.name) {
                localStorage.setItem('pos_business_name', business.name);
            }
            if (business.businessMode) {
                localStorage.setItem('pos_business_mode', business.businessMode);
                window.dispatchEvent(new Event('business_mode_changed'));
            }
            if (business.country) {
                localStorage.setItem('pos_country', business.country);
            }
            if (business.cashClosureMode) {
                localStorage.setItem('pos_cash_closure_mode', business.cashClosureMode);
            }
            await api.post('/settings/business', business);
            if (typeof BroadcastChannel !== 'undefined') {
                try {
                    const bc = new BroadcastChannel('isaac_pos_display_sync');
                    bc.postMessage({ type: 'BUSINESS_SETTINGS_UPDATED', payload: business });
                    bc.close();
                } catch (caughtErr) { console.warn('[Settings] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }
            }
            toast.success('Datos y logotipo del negocio actualizados correctamente');
        } catch (_error) { 
            toast.success('Datos del negocio guardados localmente'); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleSaveTaxes = async (e) => {
        if (e) e.preventDefault();
        try {
            setSaving(true);
            localStorage.setItem('pos_tax_settings', JSON.stringify(taxes));
            await api.post('/settings/taxes', taxes);
            toast.success('Configuración de impuestos guardada');
        } catch (_error) { 
            toast.success('Impuestos guardados localmente'); 
        } finally { 
            setSaving(false); 
        }
    };

    const handleSavePaymentMethods = async () => {
        try {
            setSaving(true);
            localStorage.setItem('pos_payment_methods', JSON.stringify(paymentMethods));
            await api.post('/settings/payment-methods', { paymentMethods });
            window.dispatchEvent(new CustomEvent('payment_methods_updated', { detail: paymentMethods }));
            if (typeof BroadcastChannel !== 'undefined') {
                try {
                    const bc = new BroadcastChannel('isaac_pos_display_sync');
                    bc.postMessage({ type: 'PAYMENT_METHODS_UPDATED', payload: paymentMethods });
                    bc.close();
                } catch (caughtErr) { console.warn('[Settings] Error propagando evento de sincronización:', caughtErr?.message || caughtErr); }
            }
            toast.success('Métodos de pago actualizados exitosamente');
        } catch (_error) { 
            toast.success('Métodos de pago guardados localmente'); 
        } finally { 
            setSaving(false); 
        }
    };

    const addPaymentMethod = () => {
        const newMethod = { id: 'method_' + Date.now(), name: '', icon: 'CreditCard', type: 'DIGITAL', currency: 'USD', defaultCurrency: 'USD' };
        setPaymentMethods([...paymentMethods, newMethod]);
    };

    const updatePaymentMethod = (id, field, value) => {
        setPaymentMethods(paymentMethods.map(m => {
            if (m.id === id) {
                if (field === 'currency') {
                    return { ...m, currency: value, defaultCurrency: value };
                }
                return { ...m, [field]: value };
            }
            return m;
        }));
    };

    const removePaymentMethod = (id) => {
        setPaymentMethods(paymentMethods.filter(m => m.id !== id));
    };

    const movePaymentMethod = (index, direction) => {
        const newMethods = [...paymentMethods];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newMethods.length) return;
        [newMethods[index], newMethods[targetIndex]] = [newMethods[targetIndex], newMethods[index]];
        setPaymentMethods(newMethods);
    };

    const handleManualSync = async () => {
        try {
            setSyncingOffline(true);
            const result = await syncManager.syncPendingSales();
            if (result.status === 'complete') {
                if (result.synced > 0) toast.success(`Sincronización completa: ${result.synced} ventas subidas`);
                else if (result.errors > 0) toast.error(`Error al sincronizar: ${result.errors} fallidos`);
                else toast('No hay ventas pendientes');
            }
            fetchOfflineSales();
        } catch (_err) { toast.error('Error durante la sincronización'); } finally { setSyncingOffline(false); }
    };

    const fetchPgBackups = async () => {
        try {
            const res = await api.get('/backup/list');
            setPgBackups(res.data.backups || []);
        } catch (error) { console.error(error); }
    };

    const handleGeneratePgBackup = async () => {
        try {
            setGeneratingBackup(true);
            toast.loading('Generando snapshot en bóveda (Base de datos + imágenes)... Por favor espere.', { id: 'pg_backup' });
            await api.post('/backup/generate', {}, { timeout: 600000 });
            localStorage.setItem('isaac_pos_last_backup', new Date().toISOString());
            toast.success('¡Instantánea en bóveda generada exitosamente!', { id: 'pg_backup' });
            fetchPgBackups();
        } catch (error) {
            console.error('Error al generar snapshot:', error);
            const msg = error.response?.data?.error || (error.code === 'ECONNABORTED' ? 'Tiempo de espera agotado. El servidor sigue procesando el archivo en segundo plano.' : error.message);
            toast.error(`Error: ${msg}`, { id: 'pg_backup' });
            fetchPgBackups();
        } finally {
            setGeneratingBackup(false);
        }
    };

    const handleExportFullDatabase = async () => {
        try {
            setGeneratingBackup(true);
            toast.loading('Empaquetando base de datos completa con imágenes (.zip)... Esto puede tomar 1 minuto.', { id: 'export_db' });
            const res = await api.post('/backup/generate', {}, { timeout: 600000 });
            localStorage.setItem('isaac_pos_last_backup', new Date().toISOString());
            const filename = res.data?.file;
            if (filename) {
                toast.loading('Descargando archivo ZIP a tu equipo / USB...', { id: 'export_db' });
                await handleDownloadPgBackup(filename);
                toast.success('¡Base de datos exportada y descargada exitosamente!', { id: 'export_db' });
                fetchPgBackups();
            } else {
                toast.success('Respaldo generado en bóveda', { id: 'export_db' });
                fetchPgBackups();
            }
        } catch (error) {
            console.error('Error al exportar BD:', error);
            const msg = error.response?.data?.error || (error.code === 'ECONNABORTED' ? 'Tiempo de espera agotado al empaquetar. El archivo se generó en la bóveda.' : error.message);
            toast.error(`Error: ${msg}`, { id: 'export_db' });
            fetchPgBackups();
        } finally {
            setGeneratingBackup(false);
        }
    };

    const [runningMaintenance, setRunningMaintenance] = useState(false);

    const handleRunAutoMaintenance = async () => {
        try {
            setRunningMaintenance(true);
            toast.loading('Ejecutando optimización de base de datos y VACUUM ANALYZE...', { id: 'db_maint' });
            const res = await api.post('/system/maintenance/run', {});
            if (res.data && res.data.success) {
                const dur = res.data.durationMs;
                const idx = res.data.indexResult?.createdCount || 0;
                toast.success(`¡Base de datos optimizada en ${dur}ms! (${idx} índices activos, VACUUM ejecutado)`, { id: 'db_maint' });
            } else {
                toast.error(res.data?.error || 'No se pudo completar el mantenimiento', { id: 'db_maint' });
            }
        } catch (error) {
            console.error('Error in maintenance:', error);
            toast.error(`Error: ${error.response?.data?.error || error.message}`, { id: 'db_maint' });
        } finally {
            setRunningMaintenance(false);
        }
    };

    const handleDownloadPgBackup = async (filename) => {
        try {
            toast.loading('Descargando copia de seguridad...', { id: 'download_pg' });
            const response = await api.get(`/backup/download/${encodeURIComponent(filename)}`, { responseType: 'blob', timeout: 600000 });
            
            const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(downloadUrl);
            toast.success('Descarga completada correctamente', { id: 'download_pg' });
        } catch (error) {
            console.error('Error al descargar el respaldo:', error);
            toast.error('Error al descargar el respaldo', { id: 'download_pg' });
        }
    };

    const handleRestorePgBackup = async (filename) => {
        try {
            setSaving(true);
            toast.loading(`Restaurando copia de seguridad...`, { id: 'restore_pg' });
            await api.post(`/backup/restore/${encodeURIComponent(filename)}`, {}, { timeout: 600000 });
            toast.success('Restauración completa. Reiniciando...', { id: 'restore_pg' });
            setTimeout(() => window.location.reload(), 3000);
        } catch (error) {
            console.error('Restore error:', error);
            const msg = error.response?.data?.error || error.message;
            toast.error(`Error al restaurar: ${msg}`, { id: 'restore_pg' });
        } finally {
            setSaving(false);
        }
    };

    const handleDeletePgBackup = async (filename) => {
        try {
            setSaving(true);
            await api.delete(`/backup/${encodeURIComponent(filename)}`);
            toast.success('Archivo eliminado correctamente');
            fetchPgBackups();
        } catch (error) {
            const msg = error.response?.data?.error || 'Error al eliminar el archivo';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleRestorePgBackupByPath = async (filePath) => {
        try {
            setSaving(true);
            toast.loading(`Restaurando copia de seguridad...`, { id: 'restore_pg_path' });
            await api.post('/backup/restore-path', { filePath }, { timeout: 600000 });
            toast.success('Restauración completa. Reiniciando...', { id: 'restore_pg_path' });
            setTimeout(() => window.location.reload(), 3000);
        } catch (error) {
            const errorMsg = error.response?.data?.error || error.message || 'Error al restaurar';
            toast.error(errorMsg, { id: 'restore_pg_path' });
        } finally {
            setSaving(false);
        }
    };

    const handleRestorePgBackupByUpload = async (file) => {
        try {
            setSaving(true);
            toast.loading('Subiendo archivo de respaldo...', { id: 'upload_backup' });
            
            const formData = new FormData();
            formData.append('file', file);
            
            const uploadRes = await api.post('/backup/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                },
                timeout: 600000
            });
            
            const uploadedFilename = uploadRes.data.file;
            toast.loading('Archivo subido. Restaurando...', { id: 'upload_backup' });
            
            await api.post(`/backup/restore/${uploadedFilename}`, {}, { timeout: 600000 });
            toast.success('Restauración completa. Reiniciando...', { id: 'upload_backup' });
            setTimeout(() => window.location.reload(), 3000);
        } catch (error) {
            const errorMsg = error.response?.data?.error || error.message || 'Error al subir/restaurar el archivo';
            toast.error(errorMsg, { id: 'upload_backup' });
        } finally {
            setSaving(false);
        }
    };

    const handleExploreBackupFolder = async () => {
        try {
            toast.loading('Abriendo carpeta de respaldos...', { id: 'explore_backup' });
            await api.post('/backup/explore');
            toast.success('Carpeta de respaldos abierta en Windows', { id: 'explore_backup' });
        } catch (err) {
            console.error('Error al abrir carpeta de respaldos:', err);
            toast.error('No se pudo abrir la carpeta en Windows', { id: 'explore_backup' });
        }
    };

    const handleManualRestoreBackup = async () => {
        try {
            if (window.electronAPI && typeof window.electronAPI.selectBackupFile === 'function') {
                const result = await window.electronAPI.selectBackupFile();
                if (result.canceled) return;
                if (result.error) {
                    toast.error(`Error al seleccionar archivo: ${result.error}`);
                    return;
                }
                const { filePath } = result;
                
                setConfirmModal({
                    isOpen: true,
                    type: 'restore_path',
                    data: filePath
                });
            } else {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.zip,.sql,.json,.enc';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    setConfirmModal({
                        isOpen: true,
                        type: 'restore_upload',
                        data: file
                    });
                };
                input.click();
            }
        } catch (error) {
            console.error('Manual restore error:', error);
            toast.error('Error al iniciar restauración manual');
        }
    };

    const triggerConfirm = (type, data) => {
        setConfirmModal({ isOpen: true, type, data });
    };

    const fetchSystemPrinters = async () => {
        setRefreshingPrinters(true);
        let found = [];
        // 1. Intentar va Electron IPC si est disponible
        if (window.electronAPI && typeof window.electronAPI.getPrinters === 'function') {
            try {
                const elPrinters = await window.electronAPI.getPrinters();
                if (Array.isArray(elPrinters) && elPrinters.length > 0) {
                    found = elPrinters;
                }
            } catch (e) {
                console.warn('Electron getPrinters error:', e);
            }
        }
        // 2. Si no hay impresoras detectadas por Electron o estamos en navegador web, consultar backend API
        if (!found || found.length === 0) {
            try {
                const res = await api.get('/settings/system-printers');
                if (res.data?.success && Array.isArray(res.data.printers)) {
                    found = res.data.printers;
                }
            } catch (e) {
                console.warn('Backend get system-printers error:', e);
            }
        }
        setSystemPrinters(found || []);
        setRefreshingPrinters(false);
        return found || [];
    };

    const handleTestPrint = async () => {
        const targetPrinter = localStorage.getItem('pos_station_printer') || business.printerName || '';
        
        let res;
        const ESC = '\x1b';
        const FS = '\x1c';
        const GS = '\x1d';
        const cols = business.receiptWidth === '58mm' ? 32 : 48;
        
        let testTicket = ESC + '@' + FS + '.' + ESC + 't\x00';
        testTicket += ESC + 'a\x01';
        testTicket += ESC + 'E\x01';
        testTicket += 'PRUEBA DE IMPRESION\n';
        testTicket += ESC + 'E\x00';
        testTicket += (business.name || 'ISAAC POS PC').toUpperCase() + '\n';
        testTicket += 'Dispositivo Configurado Correctamente\n';
        testTicket += '-'.repeat(cols) + '\n';
        testTicket += ESC + 'a\x00';
        testTicket += 'ESTADO: ACTIVO\n';
        testTicket += 'IMPRESORA: ' + (targetPrinter || 'Auto-detectada') + '\n';
        testTicket += 'ANCHO : ' + (cols === 32 ? '58mm (32 cols)' : '80mm (48 cols)') + '\n';
        testTicket += '-'.repeat(cols) + '\n';
        testTicket += ESC + 'a\x01';
        testTicket += 'Listo para facturar!\n\n\n\n\n' + GS + 'V\x01';

        if (window.electronAPI && typeof window.electronAPI.printRaw === 'function') {
            if (business.printMode === 'RAW') {
                res = await window.electronAPI.printRaw(testTicket, targetPrinter);
            } else {
                const testHtml = `
                    <html>
                        <body style="font-family: 'Courier New', monospace; width: ${business.receiptWidth || '72mm'}; margin: 0 auto; text-align: center;">
                            <h3>TEST SILENT PRINT</h3>
                            <p>${business.name || 'Isaac POS'}</p>
                            <p>Impresora: ${targetPrinter || 'Auto-detectada'}</p>
                            <p>Dispositivo Configurado OK</p>
                            <hr style="border: 1px dashed #000;" />
                        </body>
                    </html>
                `;
                res = await window.electronAPI.printSilent(testHtml, targetPrinter);
            }
        } else {
            // Envío directo a través del Spooler de Windows vía Backend API
            try {
                const resp = await api.post('/settings/print-raw', {
                    content: testTicket,
                    printerName: targetPrinter,
                    printMode: business.printMode
                });
                res = { success: resp.data?.success, error: resp.data?.error };
            } catch (err) {
                res = { success: false, error: err.response?.data?.error || err.message };
            }
        }
        
        res?.success ? toast.success('Prueba de impresión enviada a la impresora') : toast.error(res?.error || 'Error al imprimir');
    };

    const [isSupervisorDrawerOpen, setIsSupervisorDrawerOpen] = useState(false);

    const handleTestDrawer = () => {
        const targetPrinter = localStorage.getItem('pos_station_printer') || business.printerName;
        if (!targetPrinter) return toast.error('Seleccione una impresora para enviar pulso');
        setIsSupervisorDrawerOpen(true);
    };

    const handleExecuteOpenDrawer = async (approvalId) => {
        const targetPrinter = localStorage.getItem('pos_station_printer') || business.printerName;
        if (!targetPrinter) return toast.error('Seleccione una impresora para enviar pulso');
        
        let res;
        if (window.electronAPI && typeof window.electronAPI.openDrawer === 'function') {
            res = await window.electronAPI.openDrawer(targetPrinter, business.drawerSequence);
        } else {
            try {
                const resp = await api.post('/settings/open-drawer', {
                    printerName: targetPrinter,
                    sequence: business.drawerSequence,
                    supervisorApprovalId: approvalId
                });
                res = { success: resp.data?.success, error: resp.data?.error };
            } catch (err) {
                res = { success: false, error: err.response?.data?.error || err.message };
            }
        }
        res?.success ? toast.success('Gaveta abierta con autorización de supervisor') : toast.error(res?.error || 'Error al abrir gaveta');
    };

    useEffect(() => {
        fetchSettings();
        fetchOfflineSales();
        fetchPgBackups();
        fetchSystemPrinters();
    }, []);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[500px]">
                <div className="flex flex-col items-center gap-6">
                    <Loader2 size={48} className="text-primary-500 animate-spin" />
                    <p className="text-primary-400 font-black text-xs uppercase tracking-widest">Cargando Panel de Control...</p>
                </div>
            </div>
        );
    }

    const isInitialSetupDone = localStorage.getItem('initial_setup_completed') === 'true' || Boolean(business?.country && business?.name && business.name.trim() !== '');

    return (
        <div className="space-y-6 sm:space-y-8 pb-24 pb-safe animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 sm:gap-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xs">
                <div>
                    <div className="flex items-center gap-3 mb-1.5">
                        <div className="w-1.5 h-6 sm:h-7 bg-primary-600 rounded-full shrink-0"></div>
                        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                            Configuración del Sistema
                        </h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/50 border border-primary-200 dark:border-primary-800/60 px-2.5 py-1 rounded-lg">
                           <SlidersHorizontal size={13} /> Panel General
                        </span>
                        {business.name && (
                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                Sucursal / Razón Social: <strong className="font-semibold text-slate-900 dark:text-white">{business.name}</strong>
                            </span>
                        )}
                    </div>
                </div>

                {/* System Status Indicators & Quick Search */}
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsQuickFinderOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors cursor-pointer shadow-2xs group"
                        title="Buscar ajuste rápido (Ctrl + K)"
                    >
                        <Search size={14} className="text-slate-500 dark:text-slate-400 group-hover:text-primary-600 transition-colors" />
                        <span>Buscar Ajuste</span>
                        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-300 shadow-2xs">
                            Ctrl K
                        </kbd>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            if (isOwnerUser) {
                                setShowRegionSettings(prev => !prev);
                                handleTabChange('business');
                            }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors ${
                            isOwnerUser ? 'hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer' : ''
                        }`}
                        title={isOwnerUser ? "Configuración de País & Región" : undefined}
                    >
                        <span>{getCountryFlag(business.country)}</span>
                        <span className="font-semibold">
                            {business.country ? business.country.toUpperCase() : 'VENEZUELA'}
                        </span>
                    </button>

                    {!isDollarOnlyCountry(business.country || localStorage.getItem('pos_country')) ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200">
                            <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="font-mono font-semibold">
                                {rate ? `Bs. ${Number(rate).toFixed(2)}` : 'Tasa Auto'}
                            </span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200">
                            <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" />
                            <span className="font-mono font-semibold">
                                USD ($)
                            </span>
                        </div>
                    )}

                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span>Online</span>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
                {SETTINGS_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;

                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => handleTabChange(tab.id)}
                            className={`p-3 sm:p-3.5 rounded-xl border text-left relative cursor-pointer transition-colors min-h-[58px] ${
                                isActive
                                    ? 'bg-primary-600 text-white border-primary-600 shadow-xs'
                                    : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 shadow-2xs'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                }`}>
                                    <Icon size={16} />
                                </div>
                                {isActive && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                                )}
                            </div>
                            <h3 className={`text-xs font-bold leading-snug line-clamp-1 ${isActive ? 'text-white' : 'text-slate-900 dark:text-white'}`} title={tab.label}>
                                {tab.label}
                            </h3>
                            <p className={`text-[11px] font-normal mt-0.5 truncate ${isActive ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                                {tab.id === 'business'
                                    ? 'Perfil Fiscal & Datos'
                                    : tab.id === 'billing' && isDollarOnlyCountry(business.country || localStorage.getItem('pos_country'))
                                        ? 'IVA, Moneda USD & Métodos'
                                        : tab.desc}
                            </p>
                        </button>
                    );
                })}
            </div>

            {/* Content Area */}
            <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
                {/* 1. IDENTIDAD & NEGOCIO */}
                {activeTab === 'business' && (
                    <div className="space-y-8">
                        {isOwnerUser && (!isInitialSetupDone || showRegionSettings) && (
                            <div className="relative">
                                {isInitialSetupDone && (
                                    <button
                                        type="button"
                                        onClick={() => setShowRegionSettings(false)}
                                        className="absolute top-5 right-5 z-10 px-3 py-1 text-xs font-bold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                                    >
                                        Ocultar
                                    </button>
                                )}
                                <RegionSettings
                                    currentCountry={business.country}
                                    onRegionChanged={() => {
                                        fetchSettings();
                                        if (isInitialSetupDone) setShowRegionSettings(false);
                                    }}
                                />
                            </div>
                        )}
                        <BusinessSettings
                            business={business}
                            setBusiness={setBusiness}
                            systemPrinters={systemPrinters}
                            saving={saving}
                            onSave={handleSaveBusiness}
                            onTestPrint={handleTestPrint}
                            onTestDrawer={handleTestDrawer}
                        />
                    </div>
                )}

                {/* 2. IMPRESORAS & PERIFÉRICOS */}
                {activeTab === 'printers' && (
                    <PrinterSettings
                        business={business}
                        setBusiness={setBusiness}
                        systemPrinters={systemPrinters}
                        saving={saving}
                        onSave={handleSaveBusiness}
                        onTestPrint={handleTestPrint}
                        onTestDrawer={handleTestDrawer}
                        onRefreshPrinters={fetchSystemPrinters}
                        refreshingPrinters={refreshingPrinters}
                    />
                )}

                {/* 3. FINANZAS & PAGOS */}
                {activeTab === 'billing' && (
                    <div className="space-y-6 lg:space-y-8">
                        {/* Fila Superior: Divisa & Tasa + Esquema Tributario */}
                        <div className={`grid grid-cols-1 ${!isDollarOnlyCountry(business.country || localStorage.getItem('pos_country')) ? 'lg:grid-cols-2' : 'max-w-2xl'} gap-6 lg:gap-8 items-start`}>
                            <RateSettings
                                rate={rate}
                                setRate={setRate}
                                currencyMode={currencyMode}
                                setCurrencyMode={setCurrencyMode}
                                saving={saving}
                                onSave={handleSaveRate}
                                country={business.country}
                            />
                            <TaxSettings
                                taxes={taxes}
                                setTaxes={setTaxes}
                                saving={saving}
                                onSave={handleSaveTaxes}
                                country={business.country}
                            />
                        </div>

                        {/* Fila Inferior: Métodos de Pago a Ancho Completo */}
                        <div>
                            <PaymentMethodSettings
                                paymentMethods={paymentMethods}
                                addPaymentMethod={addPaymentMethod}
                                updatePaymentMethod={updatePaymentMethod}
                                removePaymentMethod={removePaymentMethod}
                                movePaymentMethod={movePaymentMethod}
                                saving={saving}
                                onSave={handleSavePaymentMethods}
                                country={business.country}
                            />
                        </div>
                    </div>
                )}

                {/* 3. SEGURIDAD & SESIÓN */}
                {activeTab === 'security' && (
                    <div className="space-y-8">
                        <SecuritySettings />
                    </div>
                )}

                {/* 4. SISTEMA & RESPALDOS */}
                {activeTab === 'system' && (
                    <div className="space-y-6">
                        {/* Sub-tabs selector */}
                        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-150 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 w-fit">
                            <button
                                type="button"
                                onClick={() => setSubTabSystem('backups')}
                                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                                    subTabSystem === 'backups'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <HardDrive size={15} />
                                <span>Bóveda & Servidor</span>
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${subTabSystem === 'backups' ? 'bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                    {pgBackups.length}
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setSubTabSystem('communications')}
                                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                                    subTabSystem === 'communications'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <MessageSquare size={15} />
                                <span>Comunicaciones & Alertas</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setSubTabSystem('voice')}
                                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                                    subTabSystem === 'voice'
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs border border-slate-200/80 dark:border-slate-700'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Volume2 size={15} />
                                <span>Voz de Asistente</span>
                            </button>
                        </div>

                        {/* Sub-tab 1: Bóveda & Servidor */}
                        {subTabSystem === 'backups' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <BackupSettings
                                    backups={pgBackups}
                                    generating={generatingBackup}
                                    onGenerate={handleGeneratePgBackup}
                                    onDownload={handleDownloadPgBackup}
                                    onRestore={(f) => triggerConfirm('restore', f)}
                                    onDelete={(f) => triggerConfirm('delete', f)}
                                    onRestoreManual={handleManualRestoreBackup}
                                    onExport={handleExportFullDatabase}
                                    onMaintenance={handleRunAutoMaintenance}
                                    runningMaintenance={runningMaintenance}
                                    onExploreFolder={handleExploreBackupFolder}
                                    onRefreshBackups={fetchPgBackups}
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                                    <StartupSettings />
                                    <GithubUpdaterSettings />
                                </div>
                                <VoiceSoundSettings />
                                {offlineSales.length > 0 && (
                                    <OfflineSalesSettings
                                        offlineSales={offlineSales}
                                        syncing={syncingOffline}
                                        onSync={handleManualSync}
                                    />
                                )}
                            </div>
                        )}

                        {/* Sub-tab: Voz de IA & Sonido */}
                        {subTabSystem === 'voice' && (
                            <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl">
                                <VoiceSoundSettings />
                            </div>
                        )}

                        {/* Sub-tab 2: Comunicaciones & Alertas */}
                        {subTabSystem === 'communications' && (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8 animate-in fade-in duration-300">
                                <WhatsappBotSettings />
                                <EmailSettings
                                    business={business}
                                    setBusiness={setBusiness}
                                    saving={saving}
                                    onSave={handleSaveBusiness}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Confirm Modal */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={['restore', 'restore_path', 'restore_upload'].includes(confirmModal.type) ? 'Restaurar Base de Datos' : 'Eliminar Respaldo'}
                message={['restore', 'restore_path', 'restore_upload'].includes(confirmModal.type)
                    ? '¿Estás seguro de restaurar esta base de datos? Se reemplazarán los datos actuales y el sistema se reiniciará.'
                    : 'Esta acción no se puede deshacer.'}
                variant={['restore', 'restore_path', 'restore_upload'].includes(confirmModal.type) ? 'warning' : 'danger'}
                onConfirm={() => {
                    if (confirmModal.type === 'restore') handleRestorePgBackup(confirmModal.data);
                    else if (confirmModal.type === 'restore_path') handleRestorePgBackupByPath(confirmModal.data);
                    else if (confirmModal.type === 'restore_upload') handleRestorePgBackupByUpload(confirmModal.data);
                    else handleDeletePgBackup(confirmModal.data);
                    setConfirmModal({ isOpen: false, type: '', data: null });
                }}
                onClose={() => setConfirmModal({ isOpen: false, type: '', data: null })}
            />

            {/* Modal de Autorización de Supervisor para Apertura de Gaveta en Configuración */}
            {isSupervisorDrawerOpen && (
                <SupervisorPinModal
                    isOpen={isSupervisorDrawerOpen}
                    onClose={() => setIsSupervisorDrawerOpen(false)}
                    onApprove={(approvalId) => {
                        setIsSupervisorDrawerOpen(false);
                        handleExecuteOpenDrawer(approvalId);
                    }}
                    actionType="APERTURA DE GAVETA (CONFIGURACIÓN)"
                    referenceId="SETTINGS_DRAWER_TEST"
                />
            )}

            {/* Modal de Búsqueda Rápida de Ajustes (Ctrl + K) */}
            <QuickSettingsFinder
                isOpen={isQuickFinderOpen}
                onClose={() => setIsQuickFinderOpen(false)}
                onSelectSetting={handleQuickSelectSetting}
                isOwnerUser={isOwnerUser}
            />
        </div>
    );
}
