-- ============================================================================
-- ISAAC POS - Esquema Oficial de Nube Independiente por Cliente (Supabase)
-- Ejecutar 1 sola vez en el SQL Editor del proyecto Supabase propio del comercio.
-- Script 100% idempotente (seguro de re-ejecutar).
-- ============================================================================

-- 1. Configuración y tasa de cambio en tiempo real (24/7)
CREATE TABLE IF NOT EXISTS public.cloud_configuracion (
    id TEXT PRIMARY KEY DEFAULT 'general',
    tasa_cambio NUMERIC(14, 4) NOT NULL DEFAULT 1.0,
    ultima_actualizacion_tasa TIMESTAMPTZ,
    nombre_negocio TEXT NOT NULL DEFAULT 'Comercio POS',
    rif_cedula TEXT DEFAULT '',
    direccion TEXT DEFAULT '',
    modo_moneda TEXT NOT NULL DEFAULT 'BOTH',
    iva_porcentaje NUMERIC(6, 2) NOT NULL DEFAULT 16.0,
    igtf_porcentaje NUMERIC(6, 2) NOT NULL DEFAULT 3.0,
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Catálogo de productos sincronizados
CREATE TABLE IF NOT EXISTS public.cloud_productos (
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL DEFAULT 'principal',
    codigo_barra TEXT DEFAULT '',
    nombre TEXT NOT NULL DEFAULT '',
    categoria TEXT DEFAULT 'General',
    precio_venta NUMERIC(14, 2) NOT NULL DEFAULT 0,
    stock_actual NUMERIC(14, 4) NOT NULL DEFAULT 0,
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cloud_productos_sucursal ON public.cloud_productos (sucursal_id);

-- 3. Clientes y cuentas por cobrar
CREATE TABLE IF NOT EXISTS public.cloud_clientes (
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL DEFAULT 'principal',
    nombre TEXT NOT NULL DEFAULT '',
    identificacion TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    direccion TEXT DEFAULT '',
    limite_credito NUMERIC(14, 2) NOT NULL DEFAULT 0,
    saldo_pendiente NUMERIC(14, 2) NOT NULL DEFAULT 0,
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Ventas / Facturas respaldadas en la nube
CREATE TABLE IF NOT EXISTS public.cloud_ventas (
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL DEFAULT 'principal',
    numero_factura TEXT DEFAULT '',
    cliente_nombre TEXT DEFAULT 'Consumidor Final',
    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
    impuesto NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    metodo_pago TEXT DEFAULT 'EFECTIVO',
    items_detalle JSONB NOT NULL DEFAULT '[]'::jsonb,
    fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cloud_ventas_fecha ON public.cloud_ventas (fecha_hora DESC);

-- 5. Cierres de caja (Cierre Z)
CREATE TABLE IF NOT EXISTS public.cloud_cierres_caja (
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL DEFAULT 'principal',
    cajero_nombre TEXT DEFAULT 'Cajero',
    monto_apertura NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_ventas NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_efectivo NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_electronico NUMERIC(14, 2) NOT NULL DEFAULT 0,
    diferencia NUMERIC(14, 2) NOT NULL DEFAULT 0,
    fecha_apertura TIMESTAMPTZ,
    fecha_cierre TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cloud_cierres_fecha ON public.cloud_cierres_caja (fecha_cierre DESC);

-- 6. Seguridad RLS (Row Level Security):
--    - Solo la tabla cloud_configuracion permite lectura anónima (para tasa 24/7 en móviles del comercio).
--    - Ventas, productos, clientes y cierres quedan protegidos (solo accesibles por service_role del PC servidor).
ALTER TABLE public.cloud_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_cierres_caja ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_anon_read_cloud_config" ON public.cloud_configuracion;
CREATE POLICY "allow_anon_read_cloud_config"
    ON public.cloud_configuracion
    FOR SELECT
    TO anon, authenticated
    USING (id = 'general');

-- 7. Habilitar Realtime en cloud_configuracion para actualización instantánea de tasa en móviles
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'cloud_configuracion'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.cloud_configuracion;
    END IF;
END $$;

-- 8. Bucket público de imágenes de productos del comercio (solo lectura pública, escritura vía service_role)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;
