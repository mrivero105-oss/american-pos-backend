import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendPkgPath = path.resolve(__dirname, '../../../american-pos-backend/package.json');
const backendRequire = createRequire(backendPkgPath);

let srvHandle = null;
let gatewayServer = null;
let gatewayStore = null;
let gatewayBaseUrl = '';
const adminApiSecret = 'e2e_gw_admin_' + crypto.randomBytes(12).toString('hex');

let isolatedUserDataDir = null;
let testPort = null;
const uiUsername = 'e2e_mob_admin';
let uiPassword = '';
const uiCashierUsername = 'e2e_mob_cashier';
let uiCashierPassword = '';
let uiProductBarcode = '';
let uiProductName = '';
let uiProductId = '';
let adminToken = '';
let serverMachineId = '';

test.beforeAll(async () => {
  isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-mob-e2e-'));
  process.env.ISAAC_TEST_ISOLATED = '1';
  process.env.ALLOW_ONLINE_LICENSE_TEST = '1';
  process.env.NODE_ENV = 'test';
  process.env.DB_NAME_FORCE = 'americanpos_test';
  process.env.DISABLE_BACKGROUND_WORKERS = 'true';
  process.env.USER_DATA_PATH = isolatedUserDataDir;
  process.env.OWNER_SECRET_KEY = process.env.OWNER_SECRET_KEY || crypto.randomBytes(16).toString('hex');
  process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
  process.env.AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || crypto.randomBytes(32).toString('hex');

  const { publicKey: testRsaPub, privateKey: testRsaPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.LICENSE_PUBLIC_KEY_PEM = testRsaPub;
  process.env.LICENSE_PRIVATE_KEY_PEM = testRsaPriv;

  // Iniciar Gateway de Licencias en línea real con par RSA efímero
  const gwServerMod = backendRequire(path.resolve(__dirname, '../../../cloud_license_server/node-server/server.js'));
  const gwStoreMod = backendRequire(path.resolve(__dirname, '../../../cloud_license_server/node-server/licenseStore.js'));
  const gwDbPath = path.join(isolatedUserDataDir, 'gateway_licenses.db.json');
  gatewayStore = new gwStoreMod.LicenseStore({ jsonPath: gwDbPath });
  const { app: gwApp } = await gwServerMod.createLicenseGatewayApp({
    store: gatewayStore,
    privateKeyPem: testRsaPriv,
    adminEmail: 'e2e_provider@isaacpos.test',
    adminPassword: 'GwPwd_' + crypto.randomBytes(8).toString('hex'),
    adminJwtSecret: crypto.randomBytes(32).toString('hex'),
    adminApiSecret,
    autoRegisterActive: false,
    defaultGraceDays: 0,
  });
  gatewayServer = await new Promise((resolve) => {
    const s = gwApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const gwAddr = gatewayServer.address();
  gatewayBaseUrl = `http://127.0.0.1:${gwAddr.port}`;

  const DbConfigManager = backendRequire('./config/dbConfigManager');
  expect(DbConfigManager.getConfig().database).toBe('americanpos_test');

  const { startServer } = backendRequire('./index');
  const bcrypt = backendRequire('bcryptjs');
  const licenseUtils = backendRequire('./utils/licenseUtils');

  srvHandle = await startServer([0], isolatedUserDataDir);
  testPort = srvHandle.mainPort;
  const dbReady = await srvHandle.dbInitPromise;
  expect(dbReady).toBe(true);

  const { User, CashShift, Product } = backendRequire('./database/models');

  await CashShift.update(
    { status: 'closed', closedAt: new Date().toISOString() },
    { where: { status: 'open' } }
  );

  const harnessUsername = 'e2e_mob_harness';
  const harnessPassword = 'MobHarness_' + crypto.randomBytes(8).toString('hex');
  const harnessHash = bcrypt.hashSync(harnessPassword, 8);
  const existingHarness = await User.findOne({ where: { username: harnessUsername } });
  if (!existingHarness) {
    await User.create({
      id: 'ui-mob-harness-' + Date.now(),
      username: harnessUsername,
      name: 'Mobile E2E Harness',
      email: 'ui_mob_harness@test.local',
      password: harnessHash,
      role: 'superadmin',
      status: 'active',
      companyId: '2',
      defaultCurrency: 'BOTH',
      permissions: {},
    });
  } else {
    await existingHarness.update({ password: harnessHash, role: 'superadmin', status: 'active', failedLoginAttempts: 0, lockUntil: null });
  }

  uiPassword = 'MobAdm_' + crypto.randomBytes(8).toString('hex');
  const passHash = bcrypt.hashSync(uiPassword, 8);
  const existing = await User.findOne({ where: { username: uiUsername } });
  if (!existing) {
    await User.create({
      id: 'ui-mob-admin-' + Date.now(),
      username: uiUsername,
      name: 'Mobile E2E Admin',
      email: 'ui_mob_admin@test.local',
      password: passHash,
      role: 'superadmin',
      status: 'active',
      companyId: '2',
      defaultCurrency: 'BOTH',
      permissions: {},
    });
  } else {
    await existing.update({ password: passHash, role: 'superadmin', status: 'active', failedLoginAttempts: 0, lockUntil: null });
  }

  uiCashierPassword = 'MobCash_' + crypto.randomBytes(8).toString('hex');
  const cashierPassHash = bcrypt.hashSync(uiCashierPassword, 8);
  const existingCashier = await User.findOne({ where: { username: uiCashierUsername } });
  const cashierFields = {
    username: uiCashierUsername,
    name: 'Mobile E2E Cashier',
    email: 'ui_mob_cashier@test.local',
    password: cashierPassHash,
    role: 'cashier',
    status: 'active',
    companyId: '2',
    defaultCurrency: 'BOTH',
    permissions: { canAccessPOS: true },
    failedLoginAttempts: 0,
    lockUntil: null,
  };
  if (!existingCashier) {
    await User.create({ id: 'ui-mob-cashier-' + Date.now(), ...cashierFields });
  } else {
    await existingCashier.update(cashierFields);
  }

  const baseUrl = `http://localhost:${testPort}`;
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: harnessUsername, password: harnessPassword }),
  });
  expect(loginRes.status).toBe(200);
  adminToken = (await loginRes.json()).token;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
  serverMachineId = await licenseUtils.getMachineId();
  const licKey = licenseUtils.generateKeyV2(serverMachineId, 30, 'days');
  const licRes = await fetch(`${baseUrl}/license/activate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: licKey, machineId: serverMachineId }),
  });
  expect(licRes.status).toBe(200);

  await fetch(`${baseUrl}/settings/setup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ country: 'Venezuela', businessName: 'Isaac POS E2E Móvil' }),
  });

  const suffix = Date.now();
  uiProductBarcode = `MOBE2E${suffix}`;
  uiProductName = `Producto Móvil E2E ${suffix}`;
  const prodRes = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: uiProductName,
      barcode: uiProductBarcode,
      price: 10,
      cost: 5,
      stockQuantity: 12,
      minStock: 2,
      category: 'General',
      taxStatus: 'exento',
      stockUnit: 'unit',
      isSoldByWeight: false,
      isFractional: false,
    }),
  });
  expect(prodRes.status).toBe(201);
  const createdProd = await prodRes.json();
  uiProductId = createdProd.id;
  expect(await Product.findByPk(uiProductId)).toBeTruthy();
});

test.afterAll(async () => {
  if (uiProductId && adminToken && testPort) {
    await fetch(`http://localhost:${testPort}/products/${uiProductId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).catch(() => {});
  }
  if (srvHandle && typeof srvHandle.stopServer === 'function') {
    await srvHandle.stopServer({ closeDb: false });
  }
  if (gatewayServer) {
    await new Promise((resolve) => gatewayServer.close(() => resolve()));
  }
  if (gatewayStore && typeof gatewayStore.close === 'function') {
    await gatewayStore.close();
  }
  try {
    if (isolatedUserDataDir) {
      fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    }
  } catch { /* Directorio temporal ya limpiado */ }
});

async function fetchProductStock(baseUrl, productId) {
  const res = await fetch(`${baseUrl}/products/${productId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return Number(data.stockQuantity);
}

test.describe.serial('E2E POS Móvil, Offline Sync, Licencias Cloud y RBAC Negativo', () => {
  test('1. Terminal Móvil (#/mobile): login, selección en catálogo y venta real con descuento en PG', async ({ page }) => {
    const baseUrl = `http://localhost:${testPort}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((srvUrl) => {
      localStorage.setItem('initial_setup_completed', 'true');
      localStorage.setItem('isaac_pos_server_ip', srvUrl);
    }, baseUrl);

    await page.goto(`${baseUrl}/#/mobile`, { waitUntil: 'domcontentloaded' });

    const userInput = page.locator('input[placeholder="Ingresa tu usuario"]');
    const passInput = page.locator('input[placeholder="••••••••"]');
    await expect(userInput).toBeVisible({ timeout: 20_000 });
    await userInput.fill(uiUsername);
    await passInput.fill(uiPassword);

    const [loginResp] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/auth/login') && res.request().method() === 'POST', { timeout: 15_000 }),
      page.getByRole('button', { name: /Ingresar a Terminal Móvil/i }).click(),
    ]);
    expect(loginResp.status()).toBe(200);

    // Abrir turno de 'Caja Móvil' desde la pestaña Caja antes de facturar
    const cashNavBtn = page.getByRole('button', { name: /^Caja$/i }).first();
    await expect(cashNavBtn).toBeVisible({ timeout: 15_000 });
    await cashNavBtn.click();

    await expect(page.getByRole('heading', { name: /Caja y Turno/i })).toBeVisible({ timeout: 15_000 });
    const openMobileCashBtn = page.getByRole('button', { name: /Abrir Turno/i }).first();
    await expect(openMobileCashBtn.or(page.getByText(/Turno Activo/i)).first()).toBeVisible({ timeout: 15_000 });

    if (await openMobileCashBtn.isVisible().catch(() => false)) {
      await openMobileCashBtn.click();
      const confirmMobileShiftBtn = page.getByRole('button', { name: /Confirmar e Iniciar Turno/i });
      await expect(confirmMobileShiftBtn).toBeVisible({ timeout: 8_000 });
      await Promise.all([
        page.waitForResponse((res) => res.url().includes('/cash/open') && res.request().method() === 'POST', { timeout: 10_000 }),
        confirmMobileShiftBtn.click(),
      ]);
      await expect(page.getByText(/Turno Activo/i).first()).toBeVisible({ timeout: 10_000 });
    }

    const backToPosBtn = page.getByRole('button', { name: /Volver a Terminal POS/i }).first();
    await expect(backToPosBtn).toBeVisible({ timeout: 8_000 });
    await backToPosBtn.click();

    const mobileSearchInput = page.locator('input[placeholder*="Buscar producto"]');
    await expect(mobileSearchInput).toBeVisible({ timeout: 20_000 });
    await mobileSearchInput.fill(uiProductName);

    const productItem = page.getByText(uiProductName).first();
    await expect(productItem).toBeVisible({ timeout: 15_000 });
    await productItem.click();

    const payDockBtn = page.getByRole('button', { name: /Cobrar/i }).first();
    await expect(payDockBtn).toBeVisible({ timeout: 10_000 });
    await payDockBtn.click();

    const submitMobileSaleBtn = page.getByRole('button', { name: /REGISTRAR FACTURA EN SERVIDOR/i });
    await expect(submitMobileSaleBtn).toBeVisible({ timeout: 10_000 });

    const [mobileSaleResp] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/sales') && res.request().method() === 'POST', { timeout: 15_000 }),
      submitMobileSaleBtn.click(),
    ]);
    expect([200, 201]).toContain(mobileSaleResp.status());

    await expect.poll(() => fetchProductStock(baseUrl, uiProductId), { timeout: 15_000 }).toBe(11);
  });

  test('2. Venta Offline en Desktop + Reconciliación y Sincronización automática al reconectar', async ({ page }) => {
    const baseUrl = `http://localhost:${testPort}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('initial_setup_completed', 'true');
    });

    await page.goto(`${baseUrl}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder="Nombre de usuario"]').fill(uiUsername);
    await page.locator('input[placeholder="••••••••"]').fill(uiPassword);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/#\/pos/, { timeout: 20_000 });
    const searchInput = page.locator('input[data-pos-search="true"]');
    await expect(searchInput).toBeVisible({ timeout: 20_000 });

    const openShiftBtn = page.getByRole('button', { name: /Confirmar Apertura e Iniciar Turno/i });
    if (await openShiftBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await openShiftBtn.click();
      await expect(openShiftBtn).toBeHidden({ timeout: 10_000 });
    }
    const closeCashModalBtn = page.getByRole('button', { name: /Cerrar modal/i });
    if (await closeCashModalBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await closeCashModalBtn.click();
    }

    // Simular desconexión únicamente sobre endpoints /sales para forzar cola offline local
    await page.route((url) => url.pathname.startsWith('/sales'), (route) => route.abort('failed'));

    await searchInput.fill(uiProductBarcode);
    await searchInput.press('Enter');
    await expect(page.getByText(uiProductName).first()).toBeVisible({ timeout: 10_000 });

    const viewTicketBtn = page.getByRole('button', { name: /Ver Ticket/i });
    if (await viewTicketBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await viewTicketBtn.click();
    }

    const checkoutBtn = page.getByRole('button', { name: /Cobrar \/ Pagar/i }).first();
    await expect(checkoutBtn).toBeVisible({ timeout: 15_000 });
    await checkoutBtn.click();

    const expressCashBtn = page.locator('button', { hasText: /Cobro Directo 1-Clic/i }).first();
    await expect(expressCashBtn).toBeVisible();
    await expressCashBtn.click();

    // Confirmar aviso de venta guardada offline y que aún no se descontó en PostgreSQL
    await expect(page.getByText(/Offline|Pendiente de sincronizar/i).first()).toBeVisible({ timeout: 10_000 });
    expect(await fetchProductStock(baseUrl, uiProductId)).toBe(11);

    // Restablecer red y disparar sincronización en vivo
    await page.unrouteAll({ behavior: 'wait' });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('lan-sync-trigger'));
    });

    await expect.poll(() => fetchProductStock(baseUrl, uiProductId), { timeout: 20_000 }).toBe(10);
  });

  test('3. Suspensión remota desde License Gateway -> Bloqueo en ActivationPortal -> Reactivación en vivo', async ({ page }) => {
    const baseUrl = `http://localhost:${testPort}`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

    // Registrar equipo en Gateway real y suspender remotamente (graceDays=0)
    const regGw = await fetch(`${gatewayBaseUrl}/admin/licenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': adminApiSecret },
      body: JSON.stringify({
        machineId: serverMachineId,
        customerName: 'Comercio E2E Cloud',
        graceDays: 0,
        status: 'active',
      }),
    });
    expect(regGw.status).toBe(200);

    const cfgResp = await fetch(`${baseUrl}/license/online-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ gatewayUrl: gatewayBaseUrl }),
    });
    expect(cfgResp.status).toBe(200);

    const suspGw = await fetch(`${gatewayBaseUrl}/admin/licenses/${encodeURIComponent(serverMachineId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': adminApiSecret },
      body: JSON.stringify({ status: 'suspended', reason: 'Suspensión E2E por falta de pago' }),
    });
    expect(suspGw.status).toBe(200);

    // Ejecutar sync-online y abrir POS en navegador para comprobar bloqueo ActivationPortal
    const syncSusp = await fetch(`${baseUrl}/license/sync-online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId: serverMachineId }),
    });
    expect(syncSusp.status).toBe(200);
    const syncJson = await syncSusp.json();
    expect(syncJson.suspended).toBe(true);

    await page.addInitScript(() => {
      localStorage.setItem('initial_setup_completed', 'true');
    });
    await page.goto(`${baseUrl}/#/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Licencia Suspendida/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Suspensión E2E por falta de pago')).toBeVisible({ timeout: 10_000 });

    // Reactivar licencia en Gateway remoto y verificar recuperación desde botón en ActivationPortal
    const reactGw = await fetch(`${gatewayBaseUrl}/admin/licenses/${encodeURIComponent(serverMachineId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': adminApiSecret },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(reactGw.status).toBe(200);

    const verifyOnlineBtn = page.getByRole('button', { name: /Verificar Estado en Línea Ahora/i });
    await expect(verifyOnlineBtn).toBeVisible();
    await verifyOnlineBtn.click();

    // Debe desbloquear y permitir llegar a la pantalla de login
    await expect(page.locator('input[placeholder="Nombre de usuario"]')).toBeVisible({ timeout: 15_000 });

    // Limpiar configuración gateway en BD test
    await fetch(`${baseUrl}/license/online-config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ gatewayUrl: '' }),
    });
  });

  test('4. RBAC Negativo completo (UI + API 403) para usuario Cajero', async ({ page }) => {
    const baseUrl = `http://localhost:${testPort}`;
    await page.addInitScript(() => {
      localStorage.setItem('initial_setup_completed', 'true');
    });

    await page.goto(`${baseUrl}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder="Nombre de usuario"]').fill(uiCashierUsername);
    await page.locator('input[placeholder="••••••••"]').fill(uiCashierPassword);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/#\/pos/, { timeout: 20_000 });

    // Validación UI de rutas protegidas
    for (const restrictedHash of ['#/settings', '#/users', '#/licenses', '#/accounting', '#/audit']) {
      await page.goto(`${baseUrl}/${restrictedHash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/#\/pos/, { timeout: 10_000 });
    }

    // Validación API negativa directa desde sesión activa del cajero (cookies HttpOnly incluidas)
    const apiStatuses = await page.evaluate(async ({ base, prodId }) => {
      const checks = [
        fetch(`${base}/products`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hack', price: 1 }),
        }),
        fetch(`${base}/products/${prodId}/lots`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lotNumber: 'L1', quantity: 5 }),
        }),
        fetch(`${base}/cash/station-categories`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowedCategories: [] }),
        }),
        fetch(`${base}/production/recipes`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hack' }),
        }),
        fetch(`${base}/license/cleanup`, {
          method: 'DELETE',
          credentials: 'include',
        }),
      ];
      const responses = await Promise.all(checks);
      return responses.map((r) => r.status);
    }, { base: baseUrl, prodId: uiProductId });

    for (const st of apiStatuses) {
      expect(st).toBe(403);
    }
  });
});
