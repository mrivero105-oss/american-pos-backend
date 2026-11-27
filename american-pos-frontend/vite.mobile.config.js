import fs from 'fs';
import path from 'path';
import process from 'node:process';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Plugin que inyecta el punto de entrada móvil (/src/mobile-main.jsx) en memoria
 * sin modificar el index.html original utilizado por la versión Desktop,
 * y excluye cualquier archivo .apk de dist-mobile para evitar APKs anidados.
 */
function mobileEntrypointHtmlPlugin() {
  return {
    name: 'isaac-pos-mobile-entrypoint',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Remover el bloque de registro de Service Worker PWA en el bundle nativo móvil (dist-mobile)
        // para eliminar la contradicción con MobileApp.jsx (que desregistra SW heredados en APK/Capacitor).
        const withoutSwRegistration = html.replace(
          /<script>\s*if\s*\('serviceWorker'\s+in\s+navigator[\s\S]*?<\/script>/i,
          `<script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          for (const reg of regs) reg.unregister().catch(() => {});
        }).catch(() => {});
      }
    </script>`
        );
        return withoutSwRegistration
          .replace('/src/main.jsx', '/src/mobile-main.jsx')
          .replace('<title>Isaac POS V24.04</title>', '<title>Isaac POS Mobile</title>');
      }
    },
    closeBundle() {
      const distDir = path.resolve(process.cwd(), 'dist-mobile');
      // Limpiar APK anidado y duplicados de public/ innecesarios en el APK/OTA (logos importados como WebP vía src/assets)
      const redundantMobileFiles = [
        'Isaac-POS-Mobile.apk',
        'isaac-logo-horizontal.png',
        'isaac-logo-horizontal-dark.png',
        'isaac-emblem.png',
        'isaac-emblem-dark.png',
        'favicon.ico',
        'splash.html',
        path.join('assets', 'icon.png')
      ];
      for (const rel of redundantMobileFiles) {
        const target = path.join(distDir, rel);
        if (fs.existsSync(target)) {
          try {
            fs.unlinkSync(target);
          } catch (err) {
            console.warn(`[vite.mobile] No se pudo limpiar ${rel}:`, err?.message);
          }
        }
      }
    }
  };
}

// Patch Tailwind v4 color-mix on custom CSS variables for older Android WebViews (Chromium 108+)
function patchTailwindPrimaryOpacity(css) {
  const regex = /@supports\s*\(color:color-mix\(in lab,red,red\)\)\{([^{}]+)\{([^{}]+)\}\}/g;
  const items = [];
  let m;
  while ((m = regex.exec(css)) !== null) {
    const fullBlock = m[0];
    const sel = m[1].trim();
    const decls = m[2].trim();
    const primaryMatch = decls.match(/var\(--color-primary-(\d+)\)\s*(\d+)%/);
    if (primaryMatch) {
      const shade = primaryMatch[1];
      const pct = parseInt(primaryMatch[2], 10);
      const alpha = (pct / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      const propMatch = decls.match(/([a-z-]+)\s*:/);
      if (propMatch) {
        items.push({ fullBlock, sel, prop: propMatch[1], shade, alpha });
      }
    }
  }

  items.forEach((item) => {
    const escapedSel = item.sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleRegex = new RegExp('([^{}]*?' + escapedSel + '[^{}]*?)\\{([^{}]*?' + item.prop + '\\s*:\\s*var\\(--color-primary-' + item.shade + '\\)[^{}]*?)\\}');
    const match = ruleRegex.exec(css);
    if (match) {
      const fullRule = match[0];
      const selList = match[1];
      const body = match[2];
      const selectors = selList.split(',').map((s) => s.trim());
      if (selectors.includes(item.sel)) {
        const remaining = selectors.filter((s) => s !== item.sel);
        const newRules = [];
        if (remaining.length > 0) {
          newRules.push(remaining.join(',') + '{' + body + '}');
        }
        const newBody = body.replace(
          new RegExp(item.prop + '\\s*:\\s*var\\(--color-primary-' + item.shade + '\\)'),
          item.prop + ':rgba(var(--app-primary-' + item.shade + '-rgb),' + item.alpha + ')'
        );
        newRules.push(item.sel + '{' + newBody + '}');
        css = css.replace(fullRule, newRules.join(''));
      }
    }
    css = css.replace(item.fullBlock, '');
  });

  return css;
}

function webViewColorFixPlugin() {
  return {
    name: 'mobile-webview-chromium-108-color-fix',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        if (fileName.endsWith('.css')) {
          const chunk = bundle[fileName];
          if (chunk && chunk.source) {
            chunk.source = patchTailwindPrimaryOpacity(chunk.source.toString());
          }
        }
      }
    }
  };
}

function readAndroidApkVersionCode() {
  try {
    const gradlePath = path.resolve(process.cwd(), 'android', 'app', 'build.gradle');
    if (fs.existsSync(gradlePath)) {
      const content = fs.readFileSync(gradlePath, 'utf8');
      const match = content.match(/\bversionCode\s+(\d+)/);
      if (match) return match[1];
    }
  } catch {
    // Fallback silencioso
  }
  return '0';
}

function compareDotSemver(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function readMobileBaseVersion() {
  let pkgVer = '24.4.0';
  let gradleVer = '';
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version) {
        pkgVer = pkg.version.replace(/^(\d+)\.0*(\d+)/, '$1.$2');
      }
    }
  } catch {
    // Fallback silencioso
  }
  try {
    const gradlePath = path.resolve(process.cwd(), 'android', 'app', 'build.gradle');
    if (fs.existsSync(gradlePath)) {
      const gradleSrc = fs.readFileSync(gradlePath, 'utf8');
      const m = gradleSrc.match(/\bversionName\s+["']([^"']+)["']/);
      if (m) gradleVer = m[1].trim();
    }
  } catch {
    // Fallback silencioso
  }
  // Garantizar que la versión base del OTA nunca sea menor que versionName del APK nativo
  return (gradleVer && compareDotSemver(gradleVer, pkgVer) > 0) ? gradleVer : pkgVer;
}

function writeBuildVersionMarkerPlugin(buildVersion) {
  return {
    name: 'isaac-pos-mobile-build-version-marker',
    closeBundle() {
      try {
        const markerPath = path.resolve(process.cwd(), 'dist-mobile', '.build-version');
        fs.writeFileSync(markerPath, JSON.stringify({ version: buildVersion, createdAt: Date.now() }), 'utf8');
      } catch (err) {
        console.warn('[vite.mobile] No se pudo escribir .build-version:', err?.message);
      }
    }
  };
}

export default defineConfig(({ command }) => {
  const apkVersionCode = readAndroidApkVersionCode();
  const mobileBuildVersion =
    process.env.MOBILE_BUILD_VERSION ||
    `${readMobileBaseVersion()}.${Math.floor(Date.now() / 1000)}`;
  const otaPublicBaseUrl = String(
    process.env.VITE_OTA_PUBLIC_BASE_URL ||
    (process.env.VITE_SUPABASE_URL ? `${String(process.env.VITE_SUPABASE_URL).trim().replace(/\/+$/, '')}/storage/v1/object/public/app-updates` : '')
  ).trim().replace(/\/+$/, '');
  const baseDefine = {
    'import.meta.env.VITE_APK_VERSION_CODE': JSON.stringify(apkVersionCode),
    'import.meta.env.VITE_MOBILE_BUILD_VERSION': JSON.stringify(mobileBuildVersion),
    'import.meta.env.VITE_OTA_PUBLIC_BASE_URL': JSON.stringify(otaPublicBaseUrl),
    ...(command === 'build' && process.env.VITE_ALLOW_EMBED_SUPABASE !== 'true'
      ? {
          'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
          'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('')
        }
      : {})
  };
  return {
  define: baseDefine,
  plugins: [
    mobileEntrypointHtmlPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    webViewColorFixPlugin(),
    ...(command === 'build' ? [writeBuildVersionMarkerPlugin(mobileBuildVersion)] : [])
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: true
  },
  server: {
    host: true,
    port: 5174,
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/dist-mobile/**', '**/.gradle/**']
    },
    proxy: {
      '/hello': 'http://localhost:3005',
      '/auth': 'http://localhost:3005',
      '/products': 'http://localhost:3005',
      '/sales': 'http://localhost:3005',
      '/customers': 'http://localhost:3005',
      '/suppliers': 'http://localhost:3005',
      '/cash': 'http://localhost:3005',
      '/reports': 'http://localhost:3005',
      '/settings': 'http://localhost:3005',
      '/sync': 'http://localhost:3005',
      '/system': 'http://localhost:3005',
      '/purchase-orders': 'http://localhost:3005',
      '/refunds': 'http://localhost:3005',
      '/users': 'http://localhost:3005',
      '/backup': 'http://localhost:3005',
      '/license': 'http://localhost:3005',
      '/expenses': 'http://localhost:3005',
      '/fiscal': 'http://localhost:3005',
      '/warehouses': 'http://localhost:3005',
      '/bi': 'http://localhost:3005',
      '/accounting': 'http://localhost:3005',
      '/payroll': 'http://localhost:3005',
      '/production': 'http://localhost:3005',
      '/collections': 'http://localhost:3005',
      '/assets': 'http://localhost:3005',
      '/stock-intelligence': 'http://localhost:3005',
      '/quotations': 'http://localhost:3005',
      '/delivery-notes': 'http://localhost:3005',
      '/invoices': 'http://localhost:3005',
      '/uploads': 'http://localhost:3005',
      '/product_images': 'http://localhost:3005',
      '/supplier_logos': 'http://localhost:3005',
      '/version.json': 'http://localhost:3005',
      '/api/app-update-info': 'http://localhost:3005',
      '/dist.zip': 'http://localhost:3005',
      '/Isaac-POS-Mobile.apk': 'http://localhost:3005'
    }
  },
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    sourcemap: false,
    target: ['es2020', 'chrome108'],
    cssTarget: 'chrome108',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('commonjsHelpers')) return 'vendor-react';
          if (!normalized.includes('/node_modules/')) return undefined;
          const rules = [
            ['vendor-react', ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/react-router/', '/node_modules/react-router-dom/', '/node_modules/@remix-run/router/', '/node_modules/scheduler/', '/node_modules/zustand/']],
            ['vendor-icons', ['/node_modules/lucide-react/']],
            ['vendor-motion', ['/node_modules/framer-motion/', '/node_modules/motion-dom/', '/node_modules/motion-utils/']],
            ['vendor-virtual', ['/node_modules/@tanstack/react-virtual/', '/node_modules/@tanstack/virtual-core/']],
            ['vendor-realtime', ['/node_modules/socket.io-client/', '/node_modules/engine.io-client/', '/node_modules/socket.io-parser/']],
            ['vendor-capacitor', ['/node_modules/@capacitor/core/', '/node_modules/@capacitor/clipboard/', '/node_modules/@capgo/capacitor-updater/']],
            ['vendor-qr', ['/node_modules/qrcode/', '/node_modules/jsbarcode/']],
            ['vendor-utils', ['/node_modules/axios/', '/node_modules/date-fns/', '/node_modules/uuid/']]
          ];
          for (const [chunkName, patterns] of rules) {
            if (patterns.some((p) => normalized.includes(p))) return chunkName;
          }
          return undefined;
        }
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand']
  },
  base: './'
  };
});
