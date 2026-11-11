import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3005',
        ws: true
      },
      '/auth': 'http://localhost:3005',
      '/products': 'http://localhost:3005',
      '/sales': 'http://localhost:3005',
      '/customers': {
        target: 'http://localhost:3005',
        changeOrigin: true
      },
      '/suppliers': {
        target: 'http://localhost:3005',
        changeOrigin: true
      },
      '/cash': 'http://localhost:3005',
      '/reports': 'http://localhost:3005',
      '/settings': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      },
      '/sync': 'http://localhost:3005',
      '/purchase-orders': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      },
      '/refunds': 'http://localhost:3005',
      '/users': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      },
      '/backup': {
        target: 'http://localhost:3005',
        changeOrigin: true
      },
      '/debug': 'http://localhost:3005',
      '/license': 'http://localhost:3005',
      '/expenses': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      },
      '/product_images': 'http://localhost:3005',
      '/supplier_logos': 'http://localhost:3005',
      '/branches': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      },
      '/quotations': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      },
      '/stock-intelligence': 'http://localhost:3005',
      '/delivery-notes': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.indexOf('text/html') !== -1) {
            return '/index.html';
          }
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  optimizeDeps: {
    include: ['react-window', 'fuse.js']
  },
  base: './'
})
