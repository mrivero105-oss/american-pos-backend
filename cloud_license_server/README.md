# Servidor Central de Licencias en Línea (Isaac POS)

Este directorio contiene el Gateway centralizado para validar **heartbeats firmados con RSA-2048**, mantener una **gracia offline configurable (7 días por defecto)** y **suspender/reactivar licencias remotamente** sin almacenar ninguna llave privada ni credenciales maestras en los equipos de los clientes.

---

## Cómo funciona la seguridad

1. **Instalador / PC del cliente**: solo contiene `public.pem` y la URL pública de tu Gateway (`LICENSE_GATEWAY_URL` o guardada desde **Licencias -> Control en Línea**). Jamás recibe `private.pem` ni credenciales administrativas.
2. **Servidor en la nube (este proyecto)**: guarda tu llave privada RSA-2048 (`LICENSE_PRIVATE_KEY_PEM`) y cada vez que un POS consulta `/heartbeat`, firma un **Lease Token (`typ: license_lease`, `v: 2`)** con el estado vigente (`active`, `suspended`, `revoked`), la fecha del servidor y `graceUntil`.
3. **Gracia y suspensión**:
   - Sin conexión temporal, el POS sigue operando hasta agotar su gracia de 7 días (con detección anti-retroceso de reloj).
   - Al recibir un lease con `status: suspended` o `revoked`, el POS **bloquea el acceso inmediatamente** y muestra el motivo configurado en `ActivationPortal`.
   - Si no hay Gateway configurado en un equipo, el POS opera 100% en modo offline clásico sin restricciones remotas.

---

## Opción A — Despliegue en Supabase Edge Function (Costo cero / Serverless)

1. Ejecuta el SQL de [supabase_licenses_schema.sql](./supabase_licenses_schema.sql) en el **SQL Editor** de tu proyecto Supabase (crea `cloud_licenses`, `cloud_license_events` y habilita RLS estricto).
2. Crea un usuario administrador para ti en **Authentication -> Users** en tu panel de Supabase.
3. Configura los secretos de la Edge Function (`supabase secrets set`):
   - `ADMIN_EMAILS=tu_correo_proveedor@dominio.com`
   - `AUTO_REGISTER_ACTIVE=true` *(opcional, `"false"` exige dar de alta el HWID antes)*
   - `DEFAULT_GRACE_DAYS=7`
   - `LICENSE_PRIVATE_KEY_PEM`: pega el contenido de `C:\Users\mrive\IsaacPOS-Llaves-Privadas\private.pem` (en formato PKCS#8 `-----BEGIN PRIVATE KEY-----`).
4. Despliega la función ubicada en `supabase/functions/license-gateway/index.ts`:
   ```bash
   supabase functions deploy license-gateway --no-verify-jwt
   ```
   *(El `--no-verify-jwt` permite que `/heartbeat` reciba peticiones de terminales POS y que el propio código de la Edge Function valide JWT de administrador o `x-admin-secret` en `/admin/*`)*.
5. Tu URL del Gateway será:
   `https://<TU_PROJECT_REF>.supabase.co/functions/v1/license-gateway`

---

## Opción B — Servidor Node.js / Express (VPS, Railway, Render o Coolify)

1. Copia [node-server/.env.example](./node-server/.env.example) a `node-server/.env` y define:
   - `LICENSE_PRIVATE_KEY_PEM` (o `LICENSE_PRIVATE_KEY_FILE`)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET`
   - Opcionalmente `DATABASE_URL` para usar PostgreSQL; si se omite, persiste de forma atómica en `node-server/data/licenses.db.json`.
2. Instala dependencias e inicia:
   ```bash
   cd node-server
   npm install
   npm start
   ```

---

## Cómo conectar los equipos y controlar clientes

1. En un POS cliente (o en tu propia consola Master): entra a **Licencias -> Control en Línea (Proveedor)**, ingresa la URL de tu Gateway y pulsa **Guardar Gateway**.
2. Inicia sesión en esa misma pestaña con tu correo y contraseña de proveedor configurados en el Gateway para ver todos los equipos reportando, emitir altas, **Suspender** con motivo personalizado, **Reactivar** o **Revocar**.
