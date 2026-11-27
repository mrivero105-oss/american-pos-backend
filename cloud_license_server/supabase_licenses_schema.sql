-- ============================================================================
-- ISAAC POS - Esquema SQL para Servidor Central de Licencias (Supabase / PG)
-- Incluye RLS estricto: solo el Gateway (service_role) puede leer o escribir.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cloud_licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id TEXT NOT NULL,
    machine_id_norm TEXT NOT NULL UNIQUE,
    customer_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    suspend_reason TEXT,
    grace_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_days >= 0 AND grace_days <= 365),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    app_version TEXT,
    server_machine_id TEXT,
    last_ip TEXT,
    last_seen_at TIMESTAMPTZ,
    grace_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cloud_license_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id_norm TEXT NOT NULL REFERENCES public.cloud_licenses(machine_id_norm) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    reason TEXT,
    actor TEXT,
    ip_address TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_licenses_status ON public.cloud_licenses(status);
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_last_seen ON public.cloud_licenses(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_license_events_mid_created ON public.cloud_license_events(machine_id_norm, created_at DESC);

-- Trigger para mantener updated_at actualizado automáticamente
CREATE OR REPLACE FUNCTION public.set_cloud_license_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cloud_licenses_updated_at ON public.cloud_licenses;
CREATE TRIGGER trg_cloud_licenses_updated_at
    BEFORE UPDATE ON public.cloud_licenses
    FOR EACH ROW
    EXECUTE FUNCTION public.set_cloud_license_updated_at();

-- Seguridad estricta RLS: deniega acceso directo a anon y authenticated.
-- Únicamente la Edge Function / Backend con service_role opera sobre estas tablas.
ALTER TABLE public.cloud_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_license_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cloud_licenses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cloud_license_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cloud_licenses TO service_role;
GRANT ALL ON TABLE public.cloud_license_events TO service_role;
