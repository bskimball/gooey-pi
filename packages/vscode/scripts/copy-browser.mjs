import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('..', import.meta.url))
const desktop = resolve(process.env.PI_DESKTOP_DIR || resolve(__dirname, '../../apps/desktop'))
await mkdir('dist/extensions', { recursive: true })
await cp(resolve(desktop, 'assets/extensions/apex-editor.ts'), 'dist/extensions/editor-extension.ts')
await cp(resolve(desktop, 'assets/extensions/apex-browser.ts'), 'dist/extensions/apex-browser.ts')
const browserExtension = resolve(__dirname, '../../packages/browser-extension')
await cp(browserExtension, 'dist/browser-extension', {
  recursive: true,
  filter: (src) => !src.endsWith('package.json'),
})
