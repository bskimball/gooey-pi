import stylex from '@stylexjs/unplugin'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Fully minify production code: Electron never consumes readable output,
    // and less source is faster for V8 to read, parse, and compile at startup.
    build: { lib: { entry: 'apps/desktop/electron/main/index.ts' }, minify: 'esbuild', reportCompressedSize: false },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'apps/desktop/electron/preload/index.ts', formats: ['cjs'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } },
      reportCompressedSize: false,
    },
  },
  renderer: {
    root: resolve('apps/desktop'),
    plugins: [
      stylex.vite({
        runtimeInjection: false,
        unstable_moduleResolution: { type: 'commonJS', rootDir: fileURLToPath(new URL('.', import.meta.url)) },
        useCSSLayers: {
          before: ['reset', 'apex-base', 'astryx-base', 'astryx-theme', 'apex'],
          after: ['apex-responsive'],
          prefix: 'stylex',
        },
      }),
      react(),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./apps/desktop/src', import.meta.url)) } },
    // Full minification, but function names survive so the React component
    // stacks ErrorBoundary logs stay readable; no sourcemap can restore those,
    // since React reads them from the function names at runtime. Costs ~4% of
    // renderer bytes, far less than keeping every identifier (~40%).
    esbuild: { keepNames: true },
    build: {
      minify: 'esbuild',
      reportCompressedSize: false,
      outDir: resolve('out/renderer'),
      rollupOptions: {
        input: resolve('apps/desktop/index.html'),
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/@xterm/')) return 'terminal-vendor'
            if (id.includes('/@phosphor-icons/')) return 'icons-vendor'
            if (
              id.includes('/@stylexjs/') ||
              /\/@astryxdesign\/core\/dist\/(?:Layer|Popover|Selector|Button|Icon|Indicator|VisuallyHidden|utils|i18n|theme|privateAttributes|internal)(?:\/|\.js$)/.test(id)
            ) {
              return 'astryx-core'
            }
            if (id.includes('/react-markdown/') || id.includes('/remark-') || id.includes('/unified/')) return 'markdown-vendor'
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react-vendor'
            return undefined
          },
        },
      },
    },
  },
})
