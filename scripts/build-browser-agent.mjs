import { build } from 'esbuild'
import { isBuiltin } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const directory = resolve('out/browser-agent')
await mkdir(directory, { recursive: true })
const result = await build({
  entryPoints: ['browser-agent/index.ts'],
  outfile: resolve(directory, 'runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  metafile: true,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})
await writeFile(resolve(directory, 'metafile.json'), JSON.stringify(result.metafile, null, 2))
const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports)
const unexpected = imports.filter((item) => !isBuiltin(item.path))
if (unexpected.length) throw new Error(`Browser agent bundle has non-builtin imports: ${unexpected.map((item) => item.path).join(', ')}`)
const bytes = Object.values(result.metafile.outputs).reduce((total, output) => total + output.bytes, 0)
console.log(`Browser agent runtime built: ${bytes} bytes; ${imports.length} builtin imports, no non-builtin imports`)
