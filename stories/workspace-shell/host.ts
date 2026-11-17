import { createApexStoryFixture } from '../../.storybook/apex-fixture'
import { createStoryEvents, installHostFixture, registerStoryCleanup } from '../../.storybook/host-fixtures'
import type { TerminalDataEvent, TerminalExitEvent } from '../../apps/desktop/src/types/api'
import { dirtyGit, done, noop, project, sessions } from './fixtures'

export function installWorkspaceHost(state: 'ready' | 'loading' | 'failure' | 'empty' = 'ready') {
  const data = createStoryEvents<TerminalDataEvent>()
  const exit = createStoryEvents<TerminalExitEvent>()
  registerStoryCleanup(() => {
    data.reset()
    exit.reset()
  })
  let nextTerminal = 0
  let gitStatus = structuredClone(dirtyGit)
  const getGitStatus = () => structuredClone(gitStatus)
  const setStaged = (paths: string[], staged: boolean) => {
    gitStatus = { ...gitStatus, files: gitStatus.files.map((file) => (paths.includes(file.path) ? { ...file, staged } : file)) }
    return true
  }
  const host = createApexStoryFixture({
    app: {
      popupMenu: async () => true,
      resolveBrowserSource: async () =>
        state === 'failure'
          ? { kind: 'unknown', reason: 'Fixture: source is outside the granted workspace' }
          : { kind: 'resolved', path: '/story/atlas/src/navigation.tsx', line: 12, evidence: 'explicit' },
      openInVsCode: async () => state !== 'failure',
      openExternal: async () => true,
      revealPath: async () => true,
    },
    projects: {
      list: async () => [project],
      listFiles: async () => {
        if (state === 'loading') return new Promise(() => {})
        if (state === 'failure') throw new Error('Fixture: project access expired')
        return {
          entries:
            state === 'empty'
              ? []
              : [
                  { path: 'src', type: 'directory' },
                  { path: 'src/navigation.tsx', type: 'file' },
                  { path: 'src/navigation.test.ts', type: 'file' },
                  { path: 'README.md', type: 'file' },
                ],
          skipped: 0,
        }
      },
      readTextFile: async (root, path) => {
        if (state === 'failure') throw new Error('Fixture: file unavailable')
        return { path: `${root}/${path}`, text: 'export function navigationLabel() {\n  return "Workspace"\n}\n', truncated: false }
      },
    },
    sessions: { list: async () => sessions },
    runtime: {
      effectiveConfig: async () => {
        if (state === 'loading') return new Promise(() => {})
        if (state === 'failure') throw new Error('Fixture: configuration unavailable')
        return {
          instructionSources: [{ scope: 'project', kind: 'AGENTS.md', path: '/story/atlas/AGENTS.md', bytes: 920 }],
          skillDirs: [{ path: '/story/atlas/.agents/skills', count: 8 }],
          injectedCapabilities: [
            { capability: 'browser', filename: 'browser.ts', present: true },
            { capability: 'schedule', filename: 'schedule.ts', present: false },
          ],
        }
      },
    },
    git: {
      status: async () => getGitStatus(),
      diff: async (_cwd, path, staged) => {
        if (state === 'loading') return new Promise(() => {})
        if (state === 'failure') throw new Error('Fixture: diff unavailable')
        return {
          path,
          staged: !!staged,
          text: 'diff --git a/src/navigation.tsx b/src/navigation.tsx\n--- a/src/navigation.tsx\n+++ b/src/navigation.tsx\n@@ -1,2 +1,3 @@\n export function navigationLabel() {\n-  return "Home"\n+  return "Workspace"\n+}\n',
          truncated: false,
        }
      },
      stage: async (_cwd, paths) => setStaged(paths, true),
      unstage: async (_cwd, paths) => setStaged(paths, false),
      restore: async (_cwd, paths) => {
        gitStatus = { ...gitStatus, files: gitStatus.files.filter((file) => !paths.includes(file.path)) }
        return true
      },
      commit: async () => {
        if (state === 'failure') return { ok: false, output: 'Fixture: commit rejected', reason: 'blocked' }
        if (!gitStatus.files.some((file) => file.staged)) return { ok: false, output: 'Fixture: no staged changes', reason: 'blocked' }
        gitStatus = { ...gitStatus, ahead: (gitStatus.ahead ?? 0) + 1, files: gitStatus.files.filter((file) => !file.staged) }
        return { ok: true, output: 'Fixture commit recorded in memory only' }
      },
    },
    terminal: {
      create: async () => {
        if (state === 'failure') throw new Error('Fixture: shell unavailable')
        const terminalId = `story-terminal-${++nextTerminal}`
        const timer = setTimeout(() => data.emit({ terminalId, data: '\u001b[32mAtlas fixture shell\u001b[0m\r\n$ ' }), 50)
        registerStoryCleanup(() => clearTimeout(timer))
        return { terminalId, shell: 'fixture-shell' }
      },
      input: (terminalId, text) => {
        data.emit({ terminalId, data: text === '\r' ? '\r\nFixture input received. No command executed.\r\n$ ' : text })
      },
      onData: data.subscribe,
      onExit: exit.subscribe,
      bindSession: async () => true,
      resize: noop,
      setActiveContext: noop,
      clearActiveContext: noop,
      kill: async () => true,
    },
    specialists: { watchWorkers: done },
  })
  installHostFixture(host)
  return { data, exit }
}
