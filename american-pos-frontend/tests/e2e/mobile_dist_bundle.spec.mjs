import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distMobileDir = path.resolve(__dirname, '../../dist-mobile');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon'
};

let staticServer = null;
let baseUrl = '';

test.describe('Mobile Bundle Real (dist-mobile / MobileApp.jsx) Smoke & Integrity E2E', () => {
  test.beforeAll(async () => {
    expect(
      fs.existsSync(path.join(distMobileDir, 'index.html')),
      'dist-mobile/index.html debe haberse compilado previamente con npm run build:mobile'
    ).toBe(true);

    staticServer = http.createServer((req, res) => {
      const cleanPath = String(req.url || '/').split('?')[0];
      const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
      let filePath = path.resolve(distMobileDir, rel);
      if (!filePath.startsWith(distMobileDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distMobileDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });

    await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
    const addr = staticServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  test.afterAll(async () => {
    if (staticServer) {
      await new Promise((resolve) => staticServer.close(resolve));
    }
  });

  test('arranca MobileApp.jsx en viewport 390x844 sin errores fatales, sin SW contradictorio y sin overflow horizontal', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));

    // Interceptar peticiones de licencia/salud para validar montaje determinístico sin backend externo
    await page.route('**/license/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: true, status: 'active', plan: 'PRO', machineId: 'e2e-mobile-dist' })
      })
    );
    await page.route('**/hello', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ready', dbReady: true, server: 'isaac-pos', serverFingerprint: 'e2e-fp-dist' })
      })
    );
    await page.route('**/settings/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({})
      })
    );
    await page.route('**/auth/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) })
    );

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Isaac POS Mobile/i);

    // Esperar a que pase el splash (200ms) y monte #root con contenido real
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return Boolean(root && root.children.length > 0 && root.innerText.trim().length > 10);
    }, { timeout: 15000 });

    // Confirmar que dist-mobile/index.html NO intentó registrar /sw.js
    const htmlSource = fs.readFileSync(path.join(distMobileDir, 'index.html'), 'utf8');
    expect(htmlSource).not.toContain("serviceWorker.register('/sw.js')");

    // Cero excepciones no capturadas en MobileApp.jsx
    expect(pageErrors, `Errores JS en dist-mobile: ${pageErrors.join(' | ')}`).toEqual([]);

    // Cero overflow horizontal en 390px
    const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowPx).toBeLessThanOrEqual(2);

    await context.close();
  });
});
