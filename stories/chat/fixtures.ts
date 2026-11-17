import { createApexStoryFixture, installHostFixture } from '../../.storybook/host-fixtures'
import { image } from './data'

/** No host transport. Every unmodeled method retains the explicit unsupported failure. */
export function installChatFixture() {
  installHostFixture(
    createApexStoryFixture({
      projects: {
        listFiles: async () => ({
          entries: [
            { path: 'src/Chat.tsx', type: 'file' },
            { path: 'src/components', type: 'directory' },
            { path: 'README.md', type: 'file' },
          ],
          skipped: 2,
        }),
      },
      app: {
        readWorkspaceImage: async (_cwd, path) => {
          if (path === 'loading.png') return new Promise(() => {})
          if (path !== 'sample.png') throw new Error('Sample image unavailable')
          return image
        },
      },
      sessions: {
        readRunFile: async (_session, _entry, path) => {
          if (path === 'loading.txt') return new Promise(() => {})
          if (path === 'missing.txt') throw new Error('Saved file unavailable in sample snapshot')
          if (path === 'binary.png') return { before: null, after: { kind: 'file', binary: true, size: 4096, base64: '' } }
          if (path === 'link') return { before: null, after: { kind: 'symlink', target: 'src/Chat.tsx' } }
          const before = 'export const ready = false\n'
          const after = path === 'large.txt' ? 'sample line\n'.repeat(4100) : 'export const ready = true\n'
          return { before: { kind: 'file', binary: false, size: before.length, base64: btoa(before) }, after: { kind: 'file', binary: false, size: after.length, base64: btoa(after) } }
        },
      },
    }),
  )
}
export function withoutHost() {
  const previous = Object.getOwnPropertyDescriptor(window, 'apex')
  Object.defineProperty(window, 'apex', { configurable: true, value: undefined })
  return () => {
    if (previous) Object.defineProperty(window, 'apex', previous)
    else Reflect.deleteProperty(window, 'apex')
  }
}
