import type { StorybookConfig } from '@storybook/react-vite'
import stylex from '@stylexjs/unplugin'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  addons: ['storybook/viewport'],
  stories: [
    './**/*.stories.@(ts|tsx)',
    '../stories/**/*.stories.@(ts|tsx)',
    '../packages/ui/src/**/*.stories.@(ts|tsx)',
    '../apps/desktop/src/**/*.stories.@(ts|tsx)',
    '../packages/vscode/webview/**/*.stories.@(ts|tsx)',
  ],
  staticDirs: [{ from: '../apps/desktop/public', to: '/' }],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite')
    return mergeConfig(config, {
      // Deliberately do not load electron.vite.config.ts or its build entries.
      plugins: [
        {
          name: 'apex-storybook-host-boundary',
          enforce: 'pre',
          resolveId(id: string, importer?: string) {
            const normalized = id.replaceAll('\\', '/')
            const resolved = importer && id.startsWith('.') ? resolve(dirname(importer), id).replaceAll('\\', '/') : normalized
            if (/\/packages\/vscode\/webview\/host(?:\.ts)?$/.test(resolved)) {
              return fileURLToPath(new URL('./vscode-host-fixture.ts', import.meta.url))
            }
            if (id === 'electron' || id.startsWith('node:') || /(?:electron\/(?:main|preload)|webview\/host)(?:\/|\.|$)/.test(normalized)) {
              throw new Error(`Storybook cannot import native host module: ${id}. Pass a typed fixture at the host boundary.`)
            }
          },
          load(id: string) {
            // Also catch relative imports such as the VS Code entry's './host'.
            const normalized = id.replaceAll('\\', '/')
            if (/(?:electron\/(?:main|preload)|webview\/host)(?:\/|\.|$)/.test(normalized)) {
              throw new Error(`Storybook cannot load native host module: ${id}. Pass a typed fixture at the host boundary.`)
            }
          },
        },
        stylex.vite({
          runtimeInjection: false,
          unstable_moduleResolution: { type: 'commonJS', rootDir: root },
          useCSSLayers: {
            before: ['reset', 'apex-base', 'astryx-base', 'astryx-theme', 'apex'],
            after: ['apex-responsive'],
            prefix: 'stylex',
          },
        }),
        react({ jsxRuntime: 'automatic' }),
      ],
      resolve: {
        alias: { '@': fileURLToPath(new URL('../apps/desktop/src', import.meta.url)) },
        dedupe: ['react', 'react-dom'],
      },
      esbuild: { keepNames: true, jsx: 'automatic' },
    })
  },
}
export default config
