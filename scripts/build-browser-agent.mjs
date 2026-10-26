import { build } from 'vite'
import { isBuiltin } from 'node:module'
import { resolve } from 'node:path'

const root = resolve('.')
const result = await build({
  configFile: false,
  logLevel: 'silent',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: resolve(root, 'apps/desktop/browser-agent/index.ts'),
    outDir: resolve(root, 'out/browser-agent'),
    emptyOutDir: false,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: (id) => isBuiltin(id),
      output: {
        format: 'es',
        entryFileNames: 'runtime.mjs',
        banner: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
        inlineDynamicImports: true,
      },
    },
  },
})
const outputs = Array.isArray(result) ? result : [result]
let bytes = 0
let imports = 0
for (const output of outputs) {
  if (!('output' in output)) throw new Error('Browser agent build unexpectedly returned a watcher')
  for (const chunk of output.output) {
    if (chunk.type !== 'chunk') continue
    bytes += Buffer.byteLength(chunk.code)
    for (const imp of chunk.imports) {
      if (!isBuiltin(imp)) throw new Error(`Browser agent bundle left a non-builtin import external: ${imp}`)
      imports++
    }
  }
}
console.log(`Browser agent runtime built: ${bytes} bytes; ${imports} builtin imports, no non-builtin imports`)
