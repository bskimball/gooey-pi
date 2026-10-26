import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('..', import.meta.url))
const desktop = resolve(process.env.PI_DESKTOP_DIR || resolve(__dirname, '../../'))
await mkdir('dist/extensions', { recursive: true })
await cp(resolve(__dirname, 'src/editor-extension.ts'), 'dist/extensions/editor-extension.ts')
await cp(resolve(desktop, 'assets/extensions/omp-work-browser.ts'), 'dist/extensions/omp-work-browser.ts')
await cp(resolve(desktop, 'resources/browser-extension'), 'dist/browser-extension', { recursive: true })
