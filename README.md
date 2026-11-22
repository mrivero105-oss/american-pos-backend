# Isaac POS V24.04 Ultra

Plataforma comercial Punto de Venta (POS) + ERP multi-vertical orientada a operación **100% offline-first en red local (LAN)** sobre PostgreSQL 16, con escritorio Windows (Electron), terminal móvil Android nativa (Capacitor) y servidor opcional de licenciamiento remoto RSA-2048.

## Arquitectura del Monorepo

- `american-pos-backend/`: API Express + Socket.IO + Sequelize (PostgreSQL 16), motor de precisión aritmética (`VortexMathEngine`), facturación/contabilidad automática, impresión térmica/red/fiscal, respaldos cifrados AES-256-GCM y proceso principal de Electron (`main.js`).
- `american-pos-frontend/`: SPA React 18 + Vite 7 + Tailwind CSS v4 + IndexedDB/Android SQLite WAL (`unifiedDb` / `syncManager`) + app móvil Android Capacitor (`android/`).
- `cloud_license_server/`: Gateway remoto de validación y suspensión de licencias RSA-2048 en dos runtimes (`node-server/` Express + `supabase/functions/license-gateway/` Edge Function).
- `generator_apk_project/`: Aplicación Android auxiliar para generación de llaves RSA v2.

## Requisitos de Entorno

- **Node.js** 20+ (CI ejecuta Node 24)
- **PostgreSQL 16** (servidor principal en Windows 10/11 64-bit; las cajas cliente LAN operan en Windows 7/8.1/10/11 o Android 7+)
- **Android SDK / JDK 17** (solo para compilar APK en `american-pos-frontend/android`)

## Configuración de Secretos

Nunca commitees archivos `.env`, `secrets.vault.json`, `db-config.json`, `keystore.properties`, ni llaves `.jks` / `.pfx` / `*private*.pem`.

- Backend: copia `american-pos-backend/.env.example` (o `.env.caja_secundaria_ejemplo`) y configura `JWT_SECRET`, `SYNC_SECRET_KEY`, `BACKUP_ENCRYPTION_KEY`, `AUDIT_HMAC_SECRET`, `OWNER_SECRET_KEY` y credenciales de PostgreSQL. En Windows de producción los secretos se migran a `secrets.vault.json` cifrado con DPAPI.
- Gateway de Licencias: configura `LICENSE_PRIVATE_KEY_PEM`, `LICENSE_PUBLIC_KEY_PEM`, `ADMIN_JWT_SECRET` (>=32 chars), `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (scrypt) y `ADMIN_ALLOWED_ORIGINS`.

## Comandos Principales

### Desarrollo
```bash
# Backend (puerto 3005 por defecto)
npm --prefix american-pos-backend run dev

# Frontend Web/Desktop (Vite 5173)
npm --prefix american-pos-frontend run dev

# Frontend Móvil (Vite 5174)
npm --prefix american-pos-frontend run dev:mobile
```

### Compilación
```bash
# Bundle Web + Desktop (copiado a american-pos-backend/public)
npm --prefix american-pos-frontend run build

# Bundle Móvil optimizado (dist-mobile/)
npm --prefix american-pos-frontend run build:mobile

# Instaladores Windows (Modern Electron 31 / Legacy Electron 22)
npm --prefix american-pos-backend run build:modern
npm --prefix american-pos-backend run build:legacy
```

### Pruebas y Calidad (100% Aisladas en `americanpos_test`)
Todas las suites de prueba utilizan `ISAAC_TEST_ISOLATED=1` y `DB_NAME_FORCE=americanpos_test` para no tocar jamás la base de datos operativa.

```bash
# Suite completa (Frontend ESLint + Vitest + Backend PG16 + Online Licensing + Playwright E2E)
node american-pos-backend/scripts/run_all_tests.cjs

# Solo Backend + Frontend sin Playwright
node american-pos-backend/scripts/run_all_tests.cjs --no-e2e

# Linter estricto y pruebas unitarias Frontend
npm --prefix american-pos-frontend run lint -- --max-warnings=0
npm --prefix american-pos-frontend run test:unit
```
