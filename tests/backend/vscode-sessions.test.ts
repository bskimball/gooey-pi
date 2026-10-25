import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listSessions, sessionBucket, sessionTranscriptOps } from '../../packages/vscode/src/session-catalog'
import { applyOps } from '../../packages/vscode/webview/transcript'

vi.mock('vscode', () => ({ workspace: { workspaceFolders: [] }, window: {} }))
import { ApexSession } from '../../packages/vscode/src/apex-session'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture(count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'apex-vscode-sessions-'))
  directories.push(root)
  const cwd = join(root, 'project')
  const bucket = sessionBucket(cwd, root)
  await mkdir(bucket, { recursive: true })
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
    const path = join(bucket, `${timestamp.replace(/[:.]/g, '-')}_${i}.jsonl`)
    const entries = [
      { type: 'session', version: 3, id: `session-${i}`, cwd, timestamp },
      { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: 'First\n prompt' }] } },
      { type: 'message', id: 'a', parentId: 'u', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'Saved answer' }] } },
      { type: 'session_info', id: 'n', parentId: 'a', timestamp, name: `Named ${i}` },
    ]
    await writeFile(path, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`)
    paths.push(path)
  }
  return { cwd, root, paths }
}

describe('VS Code saved sessions', () => {
  it('reads header, first-user preview, name, timestamps and message count', async () => {
    const { cwd, root, paths } = await fixture()
    expect(await listSessions(cwd, root)).toEqual([{ path: paths[0], id: 'session-0', title: 'Named 0', preview: 'First prompt', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 2 }])
  })

  it('sorts newest first before capping at 50', async () => {
    const { cwd, root } = await fixture(53)
    const sessions = await listSessions(cwd, root)
    expect(sessions).toHaveLength(50)
    expect(sessions[0].id).toBe('session-52')
    expect(sessions[49].id).toBe('session-3')
  })

  it('replays saved assistant content through the live event reducer', async () => {
    const { paths } = await fixture()
    const ops = await sessionTranscriptOps(paths[0])
    expect(ops[0]).toMatchObject({ kind: 'saved', message: { role: 'user' } })
    const messages = applyOps([], ops)
    expect(messages[1].parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Saved answer' }))
    expect(messages[1].streaming).not.toBe(true)
  })

  it('keeps persisted tool results in the live projection', async () => {
    const { paths } = await fixture()
    const entries = [
      { type: 'message', id: 'call', parentId: 'n', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'README.md' } }] } },
      { type: 'message', id: 'result', parentId: 'call', message: { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read', content: [{ type: 'text', text: 'File contents' }], isError: false } },
    ]
    await appendFile(paths[0], `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`)
    const ops = await sessionTranscriptOps(paths[0])
    const messages = applyOps([], ops)
    expect(messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'toolResult', name: 'read', text: 'File contents', isError: false }))
  })

  it('preserves standalone agent identity and saved timestamps', async () => {
    const { paths } = await fixture()
    await appendFile(paths[0], `${[
      { type: 'custom_message', id: 'boundary', parentId: 'n', display: true, customType: 'goal_context', content: 'Goal' },
      { type: 'custom_message', id: 'agent', parentId: 'boundary', display: true, customType: 'agent_message', content: 'Peer answer', details: { from: { sessionName: 'Oracle' } }, timestamp: '2026-01-02T00:00:00.000Z' },
      { type: 'message', id: 'after', parentId: 'agent', timestamp: '2026-01-03T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'After peer' }] } },
    ].map(entry => JSON.stringify(entry)).join('\n')}\n`)
    const messages = applyOps([], await sessionTranscriptOps(paths[0]))
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'goal', 'agent', 'assistant'])
    expect(messages[3]).toMatchObject({ agentName: 'Oracle', timestamp: '2026-01-02T00:00:00.000Z' })
    expect(messages[1].timestamp).toBe('2026-01-01T00:00:00.000Z')
    expect(messages[4].timestamp).toBe('2026-01-03T00:00:00.000Z')
  })

  it.each(['starting', 'busy'])('rejects a switch while %s without invoking RPC', async mode => {
    const command = vi.fn()
    // Exercise the host boundary without constructing VS Code UI or starting a child process.
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { rpc: { command }, state: { status: mode === 'starting' ? 'starting' : 'ready', isStreaming: mode === 'busy' } })
    await expect(session.switchSession('/unused.jsonl')).rejects.toThrow('Cannot switch sessions while Pi is starting, busy, or not running.')
    expect(command).not.toHaveBeenCalled()
  })
})
