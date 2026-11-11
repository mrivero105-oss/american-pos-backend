/* global process */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

async function runBuild() {
  try {
    await build({
      plugins: [
        react(),
        tailwindcss()
      ],
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom', 'react-router-dom'],
              'vendor-icons': ['lucide-react'],
              'vendor-charts': ['recharts'],
              'vendor-docs': ['jspdf', 'html2canvas'],
              'vendor-motion': ['framer-motion'],
              'vendor-db': ['dexie'],
              'vendor-zxing': ['@zxing/library', '@zxing/browser'],
              'vendor-utils': ['axios', 'date-fns', 'uuid', 'fuse.js']
            }
          }
        }
      },
      optimizeDeps: {
        include: ['react-window', 'fuse.js']
      },
      base: './'
    })
    console.log('Build completed successfully!')
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

runBuild()
