import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Patch Tailwind v4 color-mix on custom CSS variables for Electron 22 / Chromium 108
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
        const prop = propMatch[1];
        items.push({ fullBlock, sel, prop, shade, alpha });
      }
    }
  }

  items.forEach(item => {
    const escapedSel = item.sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ruleRegex = new RegExp('([^{}]*?' + escapedSel + '[^{}]*?)\\{([^{}]*?' + item.prop + '\\s*:\\s*var\\(--color-primary-' + item.shade + '\\)[^{}]*?)\\}');
    const match = ruleRegex.exec(css);
    if (match) {
      const fullRule = match[0];
      const selList = match[1];
      const body = match[2];
      
      const selectors = selList.split(',').map(s => s.trim());
      if (selectors.includes(item.sel)) {
        const remaining = selectors.filter(s => s !== item.sel);
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

function electronChromiumColorFixPlugin() {
  return {
    name: 'electron-chromium-108-color-fix',
    enforce: 'post',
    generateBundle(options, bundle) {
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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electronChromiumColorFixPlugin()
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: true
  },
  server: {
    host: true,
    port: 5173,
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
      '/Isaac-POS-Mobile.apk': 'http://localhost:3005',
      '/audit': 'http://localhost:3005',
      '/catalog': 'http://localhost:3005',
      '/ai': 'http://localhost:3005',
      '/public-catalog': 'http://localhost:3005',
      '/promotions': 'http://localhost:3005',
      '/stock-alerts': 'http://localhost:3005',
      '/services': 'http://localhost:3005',
      '/messages': 'http://localhost:3005',
      '/lan': 'http://localhost:3005',
      '/scanner': 'http://localhost:3005',
      '/recharges': 'http://localhost:3005',
      '/api': 'http://localhost:3005',
      '/lots': 'http://localhost:3005',
      '/whatsapp': 'http://localhost:3005',
      '/display_ads': 'http://localhost:3005',
      '/socket.io': { target: 'http://localhost:3005', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: ['es2020', 'chrome108'],
    cssTarget: 'chrome108',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-icons': ['lucide-react'],
          'vendor-docs': ['jspdf', 'html2canvas-pro'],
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion'],
          'vendor-zxing': ['@zxing/library'],
          'vendor-realtime': ['socket.io-client'],
          'vendor-capacitor': ['@capacitor/core', '@capacitor/clipboard', '@capgo/capacitor-updater'],
          'vendor-qr': ['qrcode', 'jsbarcode'],
          'vendor-state': ['zustand', 'dexie'],
          'vendor-utils': ['axios', 'date-fns', 'uuid', 'fuse.js']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'react-window', 'fuse.js']
  },
  base: './'
});
