import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
    Cloud,
    CloudOff,
    CheckCircle2,
    AlertTriangle,
    RefreshCw,
    Eye,
    EyeOff,
    Copy,
    Code2,
    Trash2,
    Save,
    ShieldCheck,
    Database
} from 'lucide-react';
import api, { getBaseUrl } from '../../services/api';
import { setRuntimeCloudConfig, clearRuntimeCloudConfig } from '../../config/supabaseConfig';

export default function CloudSupabaseSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);

    const [configured, setConfigured] = useState(false);
    const [clientRealtimeConfigured, setClientRealtimeConfigured] = useState(false);
    const [hasServiceKey, setHasServiceKey] = useState(false);
    const [serviceKeyMasked, setServiceKeyMasked] = useState('');

    const [supabaseUrl, setSupabaseUrl] = useState('');
    const [anonKey, setAnonKey] = useState('');
    const [serviceKey, setServiceKey] = useState('');
    const [branchId, setBranchId] = useState('principal');
    const [showServiceKey, setShowServiceKey] = useState(false);

    const [testResult, setTestResult] = useState(null);
    const [schemaSql, setSchemaSql] = useState('');
    const [showSqlPreview, setShowSqlPreview] = useState(false);
    const [loadingSql, setLoadingSql] = useState(false);

    const fetchConfig = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/sync/cloud-config');
            setConfigured(Boolean(data?.configured));
            setClientRealtimeConfigured(Boolean(data?.clientRealtimeConfigured));
            setHasServiceKey(Boolean(data?.hasServiceKey));
            setServiceKeyMasked(data?.serviceKeyMasked || '');
            setSupabaseUrl(data?.supabaseUrl || '');
            setAnonKey(data?.anonKey || '');
            setBranchId(data?.branchId || 'principal');
            setServiceKey('');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'No se pudo cargar la configuración de Nube Supabase');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const handleTestConnection = async () => {
        if (!supabaseUrl.trim()) {
            toast.error('Ingresa la URL del proyecto Supabase (https://...supabase.co)');
            return;
        }
        if (!serviceKey.trim() && !hasServiceKey) {
            toast.error('Ingresa la Service Role Key para validar la conexión');
            return;
        }
        try {
            setTesting(true);
            setTestResult(null);
            const { data } = await api.post('/sync/cloud-config/test', {
                supabaseUrl: supabaseUrl.trim(),
                serviceKey: serviceKey.trim() || undefined,
                anonKey: anonKey.trim() || undefined
            });
            setTestResult(data);
            if (data?.ok) {
                toast.success('Conexión verificada: todas las tablas cloud_* y Storage están listos.');
            } else if (Array.isArray(data?.missingTables) && data.missingTables.length > 0) {
                toast.error(`Faltan ${data.missingTables.length} tabla(s) en tu Supabase. Usa "Copiar SQL de Instalación".`);
            } else {
                toast.error('Conexión parcial: revisa el detalle de tablas, Storage y Anon Key.');
            }
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'Error probando conexión con Supabase';
            toast.error(msg);
            setTestResult({ ok: false, error: msg });
        } finally {
            setTesting(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!supabaseUrl.trim()) {
            toast.error('La URL del proyecto Supabase es obligatoria.');
            return;
        }
        if (!serviceKey.trim() && !hasServiceKey) {
            toast.error('La Service Role Key es obligatoria la primera vez.');
            return;
        }
        try {
            setSaving(true);
            const { data } = await api.put('/sync/cloud-config', {
                supabaseUrl: supabaseUrl.trim(),
                anonKey: anonKey.trim(),
                serviceKey: serviceKey.trim() || undefined,
                branchId: branchId.trim() || 'principal'
            });
            setConfigured(Boolean(data?.configured));
            setClientRealtimeConfigured(Boolean(data?.clientRealtimeConfigured));
            setHasServiceKey(Boolean(data?.hasServiceKey));
            setServiceKeyMasked(data?.serviceKeyMasked || '');
            setServiceKey('');
            if (data?.clientConfig) {
                setRuntimeCloudConfig(data.clientConfig, api?.defaults?.baseURL || getBaseUrl());
            }
            toast.success('Nube Supabase guardada cifrada (DPAPI) y propagada a los terminales.');
        } catch (err) {
            toast.error(err?.response?.data?.error || err?.message || 'Error guardando configuración');
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            setDisconnecting(true);
            await api.delete('/sync/cloud-config');
            setConfigured(false);
            setClientRealtimeConfigured(false);
            setHasServiceKey(false);
            setServiceKeyMasked('');
            setSupabaseUrl('');
            setAnonKey('');
            setServiceKey('');
            setBranchId('principal');
            setTestResult(null);
            setConfirmDisconnect(false);
            clearRuntimeCloudConfig();
            toast.success('Nube Supabase desconectada. Este local opera ahora 100% en modo local.');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Error desconectando la nube Supabase');
        } finally {
            setDisconnecting(false);
        }
    };

    const loadSchemaSql = async () => {
        if (schemaSql) return schemaSql;
        setLoadingSql(true);
        try {
            const { data } = await api.get('/sync/cloud-schema-sql');
            const sqlText = data?.sql || '';
            setSchemaSql(sqlText);
            return sqlText;
        } catch (err) {
            toast.error(err?.response?.data?.error || 'No se pudo cargar el script SQL');
            return '';
        } finally {
            setLoadingSql(false);
        }
    };

    const handleCopySql = async () => {
        const sqlText = await loadSchemaSql();
        if (!sqlText) return;
        try {
            await navigator.clipboard.writeText(sqlText);
            toast.success('SQL copiado. Pégalo y ejecútalo en el SQL Editor de tu proyecto Supabase.');
        } catch {
            setShowSqlPreview(true);
            toast('Selecciona y copia el SQL desde la vista previa.', { icon: '📋' });
        }
    };

    const handleToggleSqlPreview = async () => {
        if (!showSqlPreview && !schemaSql) {
            await loadSchemaSql();
        }
        setShowSqlPreview((prev) => !prev);
    };

    return (
        <div
            id="cloud-supabase-settings-card"
            className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-5"
        >
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-xl shrink-0 ${configured ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                        {configured ? <Cloud size={22} /> : <CloudOff size={22} />}
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-black text-slate-900 dark:text-white">
                                Nube Independiente del Comercio (Supabase)
                            </h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                                configured
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                    : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                            }`}>
                                {configured ? 'Conectado' : 'Solo Local'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                            Conecta el proyecto Supabase propio de este negocio para sincronizar ventas, catálogo, imágenes y tasa 24/7 con total aislamiento entre clientes. Los teléfonos Android descubren esta nube automáticamente al enlazar con esta PC.
                        </p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="py-8 flex items-center justify-center gap-2 text-xs font-bold text-slate-500">
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Cargando estado de nube...</span>
                </div>
            ) : (
                <form onSubmit={handleSave} className="space-y-4">
                    {/* Banner de seguridad DPAPI + Aislamiento */}
                    <div className="p-3.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/25 border border-sky-200/80 dark:border-sky-800/40 flex items-start gap-2.5 text-xs text-sky-900 dark:text-sky-200">
                        <ShieldCheck size={17} className="shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
                        <div className="space-y-0.5 leading-snug">
                            <p className="font-bold">Aislamiento 100% por comercio y bóveda cifrada DPAPI</p>
                            <p className="text-[11px] opacity-90">
                                La <strong>Service Role Key</strong> jamás sale de esta PC ni se envía a los teléfonos. Solo la URL y la <strong>Anon Key</strong> (lectura restringida por RLS) se comparten con los terminales en red local.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label htmlFor="cloud-supabase-url" className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                                URL del Proyecto Supabase (HTTPS)
                            </label>
                            <input
                                id="cloud-supabase-url"
                                type="url"
                                value={supabaseUrl}
                                onChange={(e) => setSupabaseUrl(e.target.value)}
                                placeholder="https://tu-proyecto.supabase.co"
                                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-white text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="cloud-branch-id" className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                                Identificador de Sucursal (`branchId`)
                            </label>
                            <input
                                id="cloud-branch-id"
                                type="text"
                                value={branchId}
                                onChange={(e) => setBranchId(e.target.value)}
                                placeholder="principal"
                                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-white text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <label htmlFor="cloud-anon-key" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Anon / Publishable Key (para tasa 24/7 e imágenes en móviles)
                            </label>
                            <span className={`text-[10px] font-bold ${clientRealtimeConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                {clientRealtimeConfigured ? 'Realtime Móvil Activo' : 'Opcional para tasa 24/7'}
                            </span>
                        </div>
                        <input
                            id="cloud-anon-key"
                            type="text"
                            value={anonKey}
                            onChange={(e) => setAnonKey(e.target.value)}
                            placeholder="sb_publishable_... o eyJhbGciOi..."
                            className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-white text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <label htmlFor="cloud-service-key" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Service Role Key (privada del servidor PC)
                            </label>
                            {hasServiceKey && (
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                    Guardada cifrada: {serviceKeyMasked}
                                </span>
                            )}
                        </div>
                        <div className="relative">
                            <input
                                id="cloud-service-key"
                                type={showServiceKey ? 'text' : 'password'}
                                value={serviceKey}
                                onChange={(e) => setServiceKey(e.target.value)}
                                placeholder={hasServiceKey ? 'Déjala vacía para conservar la llave cifrada actual' : 'sb_secret_... o eyJhbGciOi...'}
                                className="w-full min-h-[42px] pl-3 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-900 dark:text-white text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                            <button
                                type="button"
                                onClick={() => setShowServiceKey((prev) => !prev)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                                aria-label={showServiceKey ? 'Ocultar Service Key' : 'Mostrar Service Key'}
                            >
                                {showServiceKey ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Acciones principales */}
                    <div className="flex flex-wrap items-center gap-2.5 pt-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold inline-flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50 active:scale-95 transition-all"
                        >
                            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                            <span>{saving ? 'Guardando...' : 'Guardar y Activar Nube'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleTestConnection}
                            disabled={testing}
                            className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-extrabold inline-flex items-center gap-2 border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-50 active:scale-95 transition-all"
                        >
                            {testing ? <RefreshCw size={15} className="animate-spin" /> : <Database size={15} />}
                            <span>{testing ? 'Probando...' : 'Probar Conexión'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleCopySql}
                            disabled={loadingSql}
                            className="min-h-[42px] px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95 transition-all"
                        >
                            <Copy size={14} />
                            <span>Copiar SQL de Instalación</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleToggleSqlPreview}
                            className="min-h-[42px] px-3 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                            <Code2 size={14} />
                            <span>{showSqlPreview ? 'Ocultar SQL' : 'Ver SQL'}</span>
                        </button>

                        {configured && (
                            confirmDisconnect ? (
                                <div className="flex items-center gap-2 ml-auto">
                                    <button
                                        type="button"
                                        onClick={handleDisconnect}
                                        disabled={disconnecting}
                                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                                    >
                                        {disconnecting ? 'Desconectando...' : 'Confirmar Desconexión'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDisconnect(false)}
                                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setConfirmDisconnect(true)}
                                    className="min-h-[42px] px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/50 text-xs font-extrabold inline-flex items-center gap-1.5 sm:ml-auto cursor-pointer"
                                >
                                    <Trash2 size={14} />
                                    <span>Desconectar Nube</span>
                                </button>
                            )
                        )}
                    </div>

                    {/* Resultado de diagnóstico de conexión */}
                    {testResult && (
                        <div className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                            testResult.ok
                                ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-900 dark:text-emerald-200'
                                : 'bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200'
                        }`}>
                            <div className="flex items-center gap-2 font-extrabold">
                                {testResult.ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
                                <span>{testResult.ok ? 'Proyecto Supabase listo para producción' : (testResult.error || 'Se detectaron elementos pendientes en Supabase')}</span>
                            </div>

                            {Array.isArray(testResult.tables) && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pt-1">
                                    {testResult.tables.map((tb) => (
                                        <div
                                            key={tb.name}
                                            className={`px-2.5 py-1.5 rounded-lg border font-mono text-[11px] flex items-center justify-between gap-2 ${
                                                tb.ok
                                                    ? 'bg-white/70 dark:bg-slate-900/60 border-emerald-200 dark:border-emerald-800/40'
                                                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/40 text-rose-700 dark:text-rose-300'
                                            }`}
                                        >
                                            <span className="truncate">{tb.name}</span>
                                            <span className="font-bold shrink-0">{tb.ok ? 'OK' : `ERR ${tb.status || ''}`}</span>
                                        </div>
                                    ))}
                                    {testResult.bucket && (
                                        <div
                                            className={`px-2.5 py-1.5 rounded-lg border font-mono text-[11px] flex items-center justify-between gap-2 ${
                                                testResult.bucket.ok
                                                    ? 'bg-white/70 dark:bg-slate-900/60 border-emerald-200 dark:border-emerald-800/40'
                                                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/40 text-rose-700 dark:text-rose-300'
                                            }`}
                                        >
                                            <span className="truncate">bucket:product-images</span>
                                            <span className="font-bold shrink-0">{testResult.bucket.ok ? 'OK' : 'FALTA'}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {testResult.anonCheck?.tested && !testResult.anonCheck.ok && (
                                <p className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold">
                                    Aviso Anon Key: {testResult.anonCheck.error || 'No pudo leer cloud_configuracion (ejecuta el SQL para habilitar la política RLS allow_anon_read_cloud_config).'}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Vista previa del SQL de inicialización */}
                    {showSqlPreview && (
                        <div className="space-y-1.5">
                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                Pega este script en Supabase → SQL Editor → New Query → Run (solo 1 vez por cliente nuevo):
                            </p>
                            <pre className="p-3 rounded-xl bg-slate-950 text-slate-200 text-[11px] font-mono overflow-x-auto max-h-64 border border-slate-800 select-text">
                                {schemaSql || 'Cargando SQL...'}
                            </pre>
                        </div>
                    )}
                </form>
            )}
        </div>
    );
}
