import fs from 'fs';
import path from 'path';
import process from 'node:process';
import react from '@vitejs/plugin-react';
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
        return html
          .replace('/src/main.jsx', '/src/mobile-main.jsx')
          .replace('<title>Isaac POS V24.04</title>', '<title>Isaac POS Mobile</title>');
      }
    },
    closeBundle() {
      const nestedApk = path.resolve(process.cwd(), 'dist-mobile', 'Isaac-POS-Mobile.apk');
      if (fs.existsSync(nestedApk)) {
        try {
          fs.unlinkSync(nestedApk);
        } catch (err) {
          console.warn('[vite.mobile] No se pudo limpiar APK anidado:', err?.message);
        }
      }
    }
  };
}

export default defineConfig(({ command }) => ({
  ...(command === 'build' && process.env.VITE_ALLOW_EMBED_SUPABASE !== 'true'
    ? {
        define: {
          'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
          'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('')
        }
      }
    : {}),
  plugins: [
    mobileEntrypointHtmlPlugin(),
    react(),
    tailwindcss()
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
            ['vendor-zxing', ['/node_modules/@zxing/library/']],
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
}));
