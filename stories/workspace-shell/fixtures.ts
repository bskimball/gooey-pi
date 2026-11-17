import type { BackgroundJob, GitStatus, ProjectRecord, SessionRecord, SpecialistRosterEntry, TranscriptMessage } from '../../apps/desktop/src/types/api'

export const noop = () => {}
export const done = async () => {}
export const project: ProjectRecord = {
  id: 'storybook-project',
  harness: 'pi',
  name: 'Atlas workspace',
  path: '/story/atlas',
  folders: ['/story/atlas'],
  primaryFolder: '/story/atlas',
  pinned: true,
  createdAt: '2026-11-01T10:00:00Z',
  lastOpenedAt: '2026-11-16T10:00:00Z',
  sessionCount: 6,
  gitBranch: 'feature/navigation',
  scripts: { setup: 'npm ci', run: 'npm run dev' },
}
export const sessions: SessionRecord[] = ['running', 'waiting', 'failed', 'complete', 'idle'].map((status, index) => ({
  id: `story-session-${index}`,
  harness: 'pi',
  filePath: `/story/sessions/${index}.jsonl`,
  projectPath: project.path,
  title: ['Refine workspace navigation', 'Choose a migration strategy', 'Investigate failed release check', 'Review keyboard accessibility', 'Document browser integration'][index]!,
  createdAt: '2026-11-16T09:00:00Z',
  updatedAt: '2026-11-16T10:00:00Z',
  status: status === 'running' || status === 'waiting' || status === 'failed' || status === 'complete' ? status : 'idle',
  depth: 0,
  unread: index === 2,
  preview: 'Keep existing behavior and verify the narrow layout.',
}))
export const session = sessions[0]!
export const specialists: SpecialistRosterEntry[] = ['running', 'waiting', 'done', 'error', 'stopped', 'closed'].map((status, index) => ({
  id: `worker-${index}`,
  agent: ['Builder', 'Inspector', 'Reviewer', 'Researcher', 'Tester', 'Writer'][index]!,
  mission: 'Check navigation, focus restoration, and responsive layout',
  model: 'claude-sonnet-4-5',
  status: status === 'running' || status === 'waiting' || status === 'done' || status === 'error' || status === 'stopped' ? status : 'closed',
}))
export const cleanGit: GitStatus = { isRepo: true, branch: 'feature/navigation', upstream: 'origin/main', ahead: 2, behind: 1, files: [] }
export const dirtyGit: GitStatus = {
  ...cleanGit,
  files: [
    { path: 'src/navigation.tsx', status: 'M', staged: false, additions: 18, deletions: 5 },
    { path: 'src/navigation.test.ts', status: 'A', staged: true, additions: 42, deletions: 0 },
  ],
}
export const job: BackgroundJob = {
  key: 'story-job',
  id: 'bg_1',
  sessionFile: session.filePath,
  title: 'Navigation checks',
  command: 'npm run test:navigation',
  cwd: project.path,
  persistent: false,
  startedAt: 1794823200000,
  status: 'running',
  exitCode: null,
  signal: null,
  stopping: false,
  connected: true,
}
export const messages: TranscriptMessage[] = []
