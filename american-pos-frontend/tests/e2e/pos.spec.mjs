import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let srvHandle = null;
let isolatedUserDataDir = null;
let testPort = null;
const uiUsername = 'e2e_ui_admin';
let uiPassword = '';
const uiSupervisorPin = '1234';
const uiCashierUsername = 'e2e_ui_cashier';
let uiCashierPassword = '';
let uiProductBarcode = '';
let uiProductName = '';
let uiProductId = '';
let adminToken = '';

test.beforeAll(async () => {
  isolatedUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isaac-pos-ui-e2e-'));
  process.env.ISAAC_TEST_ISOLATED = '1';
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

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const backendPkgPath = path.resolve(__dirname, '../../../american-pos-backend/package.json');
  const backendRequire = createRequire(backendPkgPath);

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

  uiPassword = 'Ui_' + crypto.randomBytes(10).toString('hex');
  const passHash = bcrypt.hashSync(uiPassword, 8);
  const pinSha = crypto.createHash('sha256').update(uiSupervisorPin).digest('hex');
  const supervisorPinHash = bcrypt.hashSync(pinSha, 8);

  const existing = await User.findOne({ where: { username: uiUsername } });
  if (!existing) {
    await User.create({
      id: 'ui-e2e-admin-' + Date.now(),
      username: uiUsername,
      name: 'UI E2E Admin',
      email: 'ui_e2e@test.local',
      password: passHash,
      supervisorPin: supervisorPinHash,
      role: 'superadmin',
      status: 'active',
      companyId: '2',
      defaultCurrency: 'BOTH',
      permissions: {},
    });
  } else {
    await existing.update({
      password: passHash,
      supervisorPin: supervisorPinHash,
      role: 'superadmin',
      status: 'active',
      companyId: '2',
      failedLoginAttempts: 0,
      lockUntil: null,
    });
  }

  uiCashierPassword = 'UiCash_' + crypto.randomBytes(8).toString('hex');
  const cashierPassHash = bcrypt.hashSync(uiCashierPassword, 8);
  const existingCashier = await User.findOne({ where: { username: uiCashierUsername } });
  const cashierFields = {
    username: uiCashierUsername,
    name: 'UI E2E Cashier',
    email: 'ui_e2e_cashier@test.local',
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
    await User.create({
      id: 'ui-e2e-cashier-' + Date.now(),
      ...cashierFields,
    });
  } else {
    await existingCashier.update(cashierFields);
  }

  const baseUrl = `http://localhost:${testPort}`;
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uiUsername, password: uiPassword }),
  });
  expect(loginRes.status).toBe(200);
  const loginJson = await loginRes.json();
  adminToken = loginJson.token;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };

  const machineId = await licenseUtils.getMachineId();
  const licKey = licenseUtils.generateKeyV2(machineId, 30, 'days');
  const licRes = await fetch(`${baseUrl}/license/activate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ key: licKey, machineId }),
  });
  expect(licRes.status).toBe(200);

  await fetch(`${baseUrl}/settings/setup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ country: 'Venezuela', businessName: 'Isaac POS Test UI' }),
  });

  const suffix = Date.now();
  uiProductBarcode = `UIE2E${suffix}`;
  uiProductName = `Producto UI E2E ${suffix}`;
  const prodRes = await fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: uiProductName,
      barcode: uiProductBarcode,
      price: 15,
      cost: 8,
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
  expect(Number(createdProd.stockQuantity)).toBe(12);
});

test.afterAll(async () => {
  if (srvHandle && typeof srvHandle.stopServer === 'function') {
    await srvHandle.stopServer();
  }
  try {
    if (isolatedUserDataDir) {
      fs.rmSync(isolatedUserDataDir, { recursive: true, force: true });
    }
  } catch (_) {}
});

async function fetchProductStock(baseUrl, productId) {
  const res = await fetch(`${baseUrl}/products/${productId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  return Number(data.stockQuantity);
}

function attachPageWatchers(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const httpErrors = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (res.status() >= 400 && !url.includes('/favicon')) {
      const idx = httpErrors.length;
      const summary = `${res.status()} ${res.request().method()} ${url}`;
      httpErrors.push(summary);
      const body = await res.text().catch(() => '');
      if (body) {
        httpErrors[idx] = `${summary} -> ${body.slice(0, 240)}`;
      }
    }
  });

  return {
    pageErrors,
    consoleErrors,
    httpErrors,
    assertClean() {
      expect(pageErrors, `Page errors: ${pageErrors.join('; ')}`).toEqual([]);
      expect(httpErrors, `HTTP >=400 errors: ${httpErrors.join('; ')}`).toEqual([]);
      expect(consoleErrors, `Console errors: ${consoleErrors.join('; ')}`).toEqual([]);
    },
  };
}

async function dismissCashModalIfNeeded(page) {
  const openShiftBtn = page.getByRole('button', { name: /Confirmar Apertura e Iniciar Turno/i });
  try {
    await openShiftBtn.waitFor({ state: 'visible', timeout: 6_000 });
    await openShiftBtn.click();
    await expect(openShiftBtn).toBeHidden({ timeout: 10_000 });
  } catch {
    // El turno ya estaba abierto o el modal no apareció
  }

  const closeCashModalBtn = page.getByRole('button', { name: /Cerrar modal/i });
  try {
    if (await closeCashModalBtn.isVisible({ timeout: 1_500 })) {
      await closeCashModalBtn.click();
      await expect(closeCashModalBtn).toBeHidden({ timeout: 5_000 });
    }
  } catch {
    // Modal ya cerrado
  }
}

async function loginViaUi(page, baseUrl, username, password, { preLoginHttpErrors = null, dismissCash = true } = {}) {
  await page.goto(`${baseUrl}/#/login`, { waitUntil: 'domcontentloaded' });
  const userInput = page.locator('input[placeholder="Nombre de usuario"]');
  const passInput = page.locator('input[placeholder="••••••••"]');
  await expect(userInput).toBeVisible({ timeout: 15_000 });

  if (preLoginHttpErrors) {
    await page.waitForTimeout(900);
    expect(preLoginHttpErrors).toEqual([]);
  }

  await userInput.fill(username);
  await passInput.fill(password);
  const [authResp] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith('/auth/login') && res.request().method() === 'POST', { timeout: 15_000 }),
    page.locator('form button[type="submit"]').click(),
  ]);
  expect(authResp.status()).toBe(200);
  const authData = await authResp.json().catch(() => null);
  if (authData?.token && username === uiUsername) {
    adminToken = authData.token;
  }
  await page.waitForURL(/#\/pos/, { timeout: 20_000 });

  if (dismissCash) {
    await expect(page.getByText(uiProductName)).toBeVisible({ timeout: 20_000 });
    await dismissCashModalIfNeeded(page);
  }
}

async function addProductAndOpenCheckout(page, barcode) {
  const searchInput = page.locator('input[data-pos-search="true"]');
  await expect(searchInput).toBeVisible();
  await searchInput.fill(barcode);
  await searchInput.press('Enter');

  const checkoutBtn = page.getByRole('button', { name: /Cobrar \/ Pagar/i });
  if (!(await checkoutBtn.isVisible().catch(() => false))) {
    const viewTicketBtn = page.getByRole('button', { name: /Ver Ticket/i });
    await expect(viewTicketBtn).toBeVisible();
    await viewTicketBtn.click();
  }
  await expect(checkoutBtn).toBeVisible();
  await checkoutBtn.click();
}

test.describe.serial('E2E POS Integral', () => {
  test('1. Login sin 401, POS caja + cobro 1-clic con descuento exacto de stock, navegación limpia y sin bancos', async ({ page }) => {
    const watchers = attachPageWatchers(page);
    await page.addInitScript(() => {
      localStorage.setItem('initial_setup_completed', 'true');
    });

    const baseUrl = `http://localhost:${testPort}`;
    expect(await fetchProductStock(baseUrl, uiProductId)).toBe(12);

    await loginViaUi(page, baseUrl, uiUsername, uiPassword, {
      preLoginHttpErrors: watchers.httpErrors,
      dismissCash: true,
    });

    // Verificar ausencia total del módulo de bancos en navegación lateral
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/Bancos & Cuentas|Bancos & Tesorería/i);

    await addProductAndOpenCheckout(page, uiProductBarcode);

    // Ejecutar cobro 1-clic en Efectivo USD en CheckoutModal y esperar POST /sales exitoso
    const expressCashBtn = page.locator('button', { hasText: /Cobro Directo 1-Clic/i }).first();
    await expect(expressCashBtn).toBeVisible();
    const [saleResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/sales') && res.request().method() === 'POST', { timeout: 15_000 }),
      expressCashBtn.click(),
    ]);
    expect([200, 201]).toContain(saleResponse.status());

    // Esperar carrito vacío e inventario descontado exactamente 12 -> 11
    await expect(
      page.getByRole('button', { name: /Sin Productos|0 productos añadidos/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => fetchProductStock(baseUrl, uiProductId)).toBe(11);

    // Navegar por módulos clave y validar renderizado limpio sin ErrorBoundary ni errores HTTP
    for (const routeHash of ['#/inventory', '#/accounting', '#/sales-history', '#/settings']) {
      await page.goto(`${baseUrl}/${routeHash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const text = await page.locator('body').innerText();
      expect(text.trim().length).toBeGreaterThan(20);
      expect(text).not.toMatch(/Algo salió mal|Error inesperado en la interfaz/i);
    }

    // Verificar que intentar navegar a #/banks redirige a #/pos sin error
    await page.goto(`${baseUrl}/#/banks`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/#\/pos/, { timeout: 10_000 });

    watchers.assertClean();
  });

  test('2. Cobro Pago Mixto (11 -> 10), devolución con PIN supervisor y restitución exacta (10 -> 11)', async ({ page }) => {
    const watchers = attachPageWatchers(page);
    await page.addInitScript(() => {
      localStorage.setItem('initial_setup_completed', 'true');
    });

    const baseUrl = `http://localhost:${testPort}`;
    expect(await fetchProductStock(baseUrl, uiProductId)).toBe(11);

    await loginViaUi(page, baseUrl, uiUsername, uiPassword);
    await addProductAndOpenCheckout(page, uiProductBarcode);

    // Cambiar a vista Pago Mixto y auto-liquidar con Efectivo USD
    const splitTabBtn = page.locator('button[title*="Pago Mixto"]').first();
    await expect(splitTabBtn).toBeVisible({ timeout: 10_000 });
    await splitTabBtn.click();

    const flashCashBtn = page.locator('#flash-fill-cash');
    await expect(flashCashBtn).toBeVisible({ timeout: 10_000 });
    await flashCashBtn.click();

    const confirmMixedBtn = page.locator('button', { hasText: /COBRAR Y/i }).first();
    await expect(confirmMixedBtn).toBeEnabled({ timeout: 5_000 });

    const [mixedSaleResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/sales') && res.request().method() === 'POST', { timeout: 15_000 }),
      confirmMixedBtn.click(),
    ]);
    expect([200, 201]).toContain(mixedSaleResponse.status());
    const mixedSaleJson = await mixedSaleResponse.json();
    const mixedSaleId = mixedSaleJson?.id || mixedSaleJson?.sale?.id;
    expect(typeof mixedSaleId).toBe('string');
    const shortId = mixedSaleId.split('-')[0].toUpperCase();

    await expect(
      page.getByRole('button', { name: /Sin Productos|0 productos añadidos/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => fetchProductStock(baseUrl, uiProductId)).toBe(10);

    // Navegar a Historial de Ventas y devolver exactamente esa venta con PIN de supervisor
    await page.goto(`${baseUrl}/#/sales-history`, { waitUntil: 'domcontentloaded' });
    const saleRow = page.locator('tr', { hasText: `(${shortId})` }).first();
    await expect(saleRow).toBeVisible({ timeout: 15_000 });

    const refundBtn = saleRow.locator('button[title*="Anular"]').first();
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    // Llenar cantidad a devolver = 1 y motivo en RefundModal
    const returnQtyInput = page.locator('input[inputmode="decimal"]').first();
    await expect(returnQtyInput).toBeVisible({ timeout: 10_000 });
    await returnQtyInput.fill('1');
    await page.locator('textarea[placeholder*="Producto defectuoso"]').fill('Devolución E2E automatizada');
    await page.getByRole('button', { name: /Confirmar Devolución/i }).click();

    // Autorizar en SupervisorPinModal con PIN '1234'
    const pinInput = page.locator('input[placeholder="Introduce tu PIN"]');
    await expect(pinInput).toBeVisible({ timeout: 10_000 });
    await pinInput.fill(uiSupervisorPin);

    const authorizeBtn = page.getByRole('button', { name: 'Autorizar', exact: true });
    const [authRes, refundRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/auth/supervisor-authorize') && res.request().method() === 'POST', { timeout: 15_000 }),
      page.waitForResponse((res) => res.url().endsWith('/refunds') && res.request().method() === 'POST', { timeout: 15_000 }),
      authorizeBtn.click(),
    ]);
    expect(authRes.status()).toBe(200);
    expect([200, 201]).toContain(refundRes.status());

    // Verificar restitución exacta de stock 10 -> 11 en BD
    await expect.poll(() => fetchProductStock(baseUrl, uiProductId)).toBe(11);
    watchers.assertClean();
  });

  test('3. Movimiento de caja, Corte X, Cierre Z y bloqueo RBAC fail-closed para cajero', async ({ page }) => {
    const watchers = attachPageWatchers(page);
    await page.addInitScript(() => {
      localStorage.setItem('initial_setup_completed', 'true');
    });

    const baseUrl = `http://localhost:${testPort}`;
    await loginViaUi(page, baseUrl, uiUsername, uiPassword);

    // Abrir modal de Caja Registradora desde evento del sistema
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open_cash_modal')));
    const movementBtn = page.getByRole('button', { name: /Movimiento \/ Vale/i });
    await expect(movementBtn).toBeVisible({ timeout: 10_000 });
    await movementBtn.click();

    // Registrar movimiento de Ingreso $10
    await page.getByRole('button', { name: /^Ingreso$/i }).click();
    const amountInput = page.locator('form input[placeholder="0.00"]').last();
    await expect(amountInput).toBeVisible({ timeout: 10_000 });
    await amountInput.fill('10');
    await page.locator('textarea[placeholder*="distribuidor"]').fill('Ingreso fondo E2E');

    const [movRes] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/cash/movement') && res.request().method() === 'POST', { timeout: 15_000 }),
      page.getByRole('button', { name: 'REGISTRAR MOVIMIENTO', exact: true }).click(),
    ]);
    expect([200, 201]).toContain(movRes.status());
    await expect(movementBtn).toBeVisible({ timeout: 10_000 });

    // Consultar Corte X (Arqueo Parcial)
    await page.getByRole('button', { name: /CORTE X \(PARCIAL\)/i }).click();
    await expect(page.getByText(/CORTE X \(ARQUEO PARCIAL\)/i).first()).toBeVisible({ timeout: 10_000 });

    // Volver a Operaciones en Vivo y ejecutar Cierre Z completo
    await page.getByRole('button', { name: /OPERACIONES EN VIVO/i }).click();
    await page.getByRole('button', { name: 'Cerrar Caja', exact: true }).click();

    const confirmCloseBtn = page.getByRole('button', { name: /Confirmar y Cerrar Caja/i });
    await expect(confirmCloseBtn).toBeVisible({ timeout: 10_000 });
    const [closeRes] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/cash/close') && res.request().method() === 'POST', { timeout: 15_000 }),
      confirmCloseBtn.click(),
    ]);
    expect(closeRes.status()).toBe(200);

    await expect(page.getByText(/¡Caja Cerrada Exitosamente!/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Finalizar y Salir/i }).click();

    const closeReportBtn = page.getByRole('button', { name: /Cerrar Reporte/i });
    if (await closeReportBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await closeReportBtn.click();
    }

    // Si aparece el modal de identificación de terminal tras cerrar la caja sin nombre asignado, completarlo desde UI
    const setupNameInput = page.locator('input[placeholder*="Caja Principal"]');
    if (await setupNameInput.isVisible({ timeout: 2_500 }).catch(() => false)) {
      await setupNameInput.fill('Caja E2E');
      await page.getByRole('button', { name: /Guardar Identificador/i }).click();
      await expect(setupNameInput).toBeHidden({ timeout: 5_000 });
    }

    // Cerrar sesión del Superadmin y entrar como Cajero con permisos mínimos
    const userMenuBtn = page.locator('button[title="UI E2E Admin"]');
    await expect(userMenuBtn).toBeVisible({ timeout: 10_000 });
    await userMenuBtn.click({ timeout: 15_000 });
    await page.getByRole('button', { name: /Cerrar Sesión/i }).click();
    await page.waitForURL(/#\/login/, { timeout: 10_000 });

    await loginViaUi(page, baseUrl, uiCashierUsername, uiCashierPassword, { dismissCash: false });
    await page.waitForTimeout(600);

    // Validar bloqueo RBAC UI: un cajero nunca debe acceder a Ajustes, Contabilidad ni Licencias
    for (const restrictedHash of ['#/settings', '#/accounting', '#/licenses']) {
      await page.goto(`${baseUrl}/${restrictedHash}`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/#\/pos/, { timeout: 10_000 });
    }

    watchers.assertClean();
  });
});
