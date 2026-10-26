import { isBuiltin } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: resolve(__dirname, 'src/extension.ts'),
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: (id) => id === 'vscode' || isBuiltin(id),
      output: { format: 'cjs', entryFileNames: 'extension.js', inlineDynamicImports: true },
    },
  },
})
