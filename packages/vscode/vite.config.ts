import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The webview renders pi-desktop's own components and styles, so it tracks the Apex desktop look.
const piDesktop = resolve(process.env.PI_DESKTOP_DIR ?? resolve(__dirname, '../../apps/desktop'))

export default defineConfig({
  root: resolve(__dirname, 'webview'),
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: { '@': resolve(piDesktop, 'src') },
    // pi-desktop's dependencies resolve from its node_modules; React must stay a single copy.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'webview/main.tsx'),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (asset) => asset.names?.some((name) => name.endsWith('.css')) ? 'main.css' : 'assets/[name]-[hash][extname]',
        inlineDynamicImports: true,
      },
    },
  },
})
