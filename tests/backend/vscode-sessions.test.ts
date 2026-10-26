import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_READ_FRAME_LIMIT_BYTES } from 'apex-core/jsonl-limits'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiRpc } from '../../packages/vscode/src/pi-rpc'
import { listSessions, sessionBucket, sessionTranscriptOps } from '../../packages/vscode/src/session-catalog'
import { applyOps } from '../../packages/vscode/webview/transcript'

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [], openTextDocument: vi.fn(), asRelativePath: vi.fn(() => 'src/file.ts') },
  window: { tabGroups: { all: [] }, activeTextEditor: undefined, showTextDocument: vi.fn() },
  languages: { getDiagnostics: vi.fn() },
  Uri: { parse: (value: string) => ({ scheme: value.split(':')[0], toString: () => value }) },
  Range: class {
    start: { line: number; character: number }
    end: { line: number; character: number }
    constructor(startLine: number, startColumn: number, endLine: number, endColumn: number) {
      this.start = { line: startLine, character: startColumn }
      this.end = { line: endLine, character: endColumn }
    }
  },
  TabInputText: class {},
  TabInputTextDiff: class {},
  TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
}))

import * as vscode from 'vscode'
import { ApexSession } from '../../packages/vscode/src/apex-session'
import { editorContext, editorFileContext, editorRequest } from '../../packages/vscode/src/editor'
import editorExtension from '../../packages/vscode/src/editor-extension'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
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
    await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    paths.push(path)
  }
  return { cwd, root, paths }
}

describe('VS Code RPC framing', () => {
  it('rejects pending commands and terminates Pi on an oversized unterminated frame', async () => {
    const onRecord = vi.fn()
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const rpc = new PiRpc(
      { file: process.execPath, args: ['-e', `process.stdout.write('x'.repeat(${RPC_READ_FRAME_LIMIT_BYTES + 1})); setInterval(() => {}, 1000)`] },
      [],
      process.cwd(),
      onRecord,
      () => resolveExit(),
    )
    try {
      await expect(rpc.command('get_state')).rejects.toThrow('RPC record exceeded the maximum frame size')
      await exited
      expect(onRecord).not.toHaveBeenCalled()
    } finally {
      rpc.dispose()
    }
  })
})

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
    await appendFile(paths[0], `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    const ops = await sessionTranscriptOps(paths[0])
    const messages = applyOps([], ops)
    expect(messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({ type: 'toolResult', name: 'read', text: 'File contents', isError: false }))
  })

  it('preserves standalone agent identity and saved timestamps', async () => {
    const { paths } = await fixture()
    await appendFile(
      paths[0],
      `${[
        { type: 'custom_message', id: 'boundary', parentId: 'n', display: true, customType: 'goal_context', content: 'Goal' },
        {
          type: 'custom_message',
          id: 'agent',
          parentId: 'boundary',
          display: true,
          customType: 'agent_message',
          content: 'Peer answer',
          details: { from: { sessionName: 'Oracle' } },
          timestamp: '2026-01-02T00:00:00.000Z',
        },
        { type: 'message', id: 'after', parentId: 'agent', timestamp: '2026-01-03T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'After peer' }] } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n')}\n`,
    )
    const messages = applyOps([], await sessionTranscriptOps(paths[0]))
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'goal', 'agent', 'assistant'])
    expect(messages[3]).toMatchObject({ agentName: 'Oracle', timestamp: '2026-01-02T00:00:00.000Z' })
    expect(messages[1].timestamp).toBe('2026-01-01T00:00:00.000Z')
    expect(messages[4].timestamp).toBe('2026-01-03T00:00:00.000Z')
  })

  it.each(['starting', 'busy'])('rejects a switch while %s without invoking RPC', async (mode) => {
    const command = vi.fn()
    // Exercise the host boundary without constructing VS Code UI or starting a child process.
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { rpc: { command }, state: { status: mode === 'starting' ? 'starting' : 'ready', isStreaming: mode === 'busy' } })
    await expect(session.switchSession('/unused.jsonl')).rejects.toThrow('Cannot switch sessions while Pi is starting, busy, or not running.')
    expect(command).not.toHaveBeenCalled()
  })
})

describe('VS Code editor integration', () => {
  it('reports no active editor explicitly', () => {
    expect(editorContext()).toMatchObject({ active: null, tabs: [], workspaceFolders: [] })
    expect(editorFileContext()).toBeNull()
  })

  it('summarizes the active file, dirty state and exclusive selection end for display', () => {
    const editor = {
      document: { uri: { path: '/project/src/file.ts' }, isDirty: true },
      selections: [{ isEmpty: false, start: { line: 2, character: 0 }, end: { line: 5, character: 0 } }],
    }
    Object.assign(vscode.window, { activeTextEditor: editor })
    try {
      expect(editorFileContext()).toEqual({ name: 'file.ts', path: 'src/file.ts', dirty: true, selection: { startLine: 3, endLine: 5, count: 1 } })
      editor.document.isDirty = false
      editor.selections = []
      expect(editorFileContext()).toMatchObject({ dirty: false, selection: null })
    } finally {
      Object.assign(vscode.window, { activeTextEditor: undefined })
    }
  })

  it('reads the editor buffer with unsaved state and version rather than disk contents', async () => {
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
      uri: { toString: () => 'file:///project/file.ts', fsPath: '/project/file.ts' },
      languageId: 'typescript',
      isDirty: true,
      version: 7,
      lineCount: 2,
      lineAt: () => ({ text: 'unsaved content' }),
      getText: () => 'unsaved content',
    } as unknown as vscode.TextDocument)
    expect(await editorRequest('editor.read', { uri: 'file:///project/file.ts', line: 2 })).toMatchObject({ text: 'unsaved content', dirty: true, version: 7, line: 2, endLine: 2, truncated: false })
    await expect(editorRequest('editor.read', { uri: 'file:///project/file.ts', line: 3 })).rejects.toThrow('line exceeds')
    await expect(editorRequest('editor.read', { uri: 'file:///project/file.ts', line: 0 })).rejects.toThrow('positive integer')
  })

  it('reveals a requested range without changing the document', async () => {
    const revealRange = vi.fn()
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({ revealRange } as unknown as vscode.TextEditor)
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
      uri: { toString: () => 'file:///project/file.ts', fsPath: '/project/file.ts' },
      languageId: 'typescript',
      isDirty: true,
      version: 7,
      lineCount: 2,
      lineAt: () => ({ text: 'unsaved content' }),
    } as unknown as vscode.TextDocument)
    const result = await editorRequest('editor.open', { uri: 'file:///project/file.ts', line: 2, column: 3, endLine: 2, endColumn: 8 })
    expect(result).toMatchObject({ dirty: true, version: 7, range: { start: { line: 2, column: 3 }, end: { line: 2, column: 8 } } })
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preserveFocus: true, selection: expect.objectContaining({ start: { line: 1, character: 2 }, end: { line: 1, character: 7 } }) }),
    )
    expect(revealRange).toHaveBeenCalledOnce()
    await expect(editorRequest('editor.open', { uri: 'file:///project/file.ts', column: 100 })).rejects.toThrow('Column exceeds')
  })

  it('returns diagnostics in 1-based coordinates', async () => {
    vi.mocked<(uri: vscode.Uri) => vscode.Diagnostic[]>(vscode.languages.getDiagnostics).mockReturnValue([
      {
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
        message: 'Unknown name',
        severity: 0,
        source: 'ts',
        code: 2304,
      },
    ] as vscode.Diagnostic[])
    expect(await editorRequest('editor.diagnostics', { uri: 'file:///project/file.ts' })).toMatchObject({
      diagnostics: [{ start: { line: 3, column: 5 }, end: { line: 3, column: 9 }, severity: 'error', message: 'Unknown name' }],
    })
  })

  it.each(['automatic', 'send now'])('retains message-time context for %s queue delivery', async (mode) => {
    const command = vi.fn().mockResolvedValue({})
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      rpc: { command },
      seq: 0,
      promptToken: 0,
      state: { isStreaming: true, commands: [], queued: [] },
      update(patch: object) {
        Object.assign(this.state, patch)
      },
      addOp: vi.fn(),
      guard: (fn: () => Promise<unknown>) => fn(),
    })
    await session.send('Look here', [], 'queue', '\nCAPTURED_EDITOR')
    expect(command).not.toHaveBeenCalled()
    if (mode === 'automatic') {
      session.state.isStreaming = false
      session.flushQueue()
      expect(command).toHaveBeenCalledWith('prompt', { message: 'Look here\nCAPTURED_EDITOR' })
    } else {
      await session.handle({ type: 'sendQueued', id: session.state.queued[0].id })
      expect(command).toHaveBeenCalledWith('prompt', { message: 'Look here\nCAPTURED_EDITOR', streamingBehavior: 'steer' })
    }
    expect(session.state.queued).toEqual([])
  })

  it('registers editor tools and sends authenticated calls to the bridge', async () => {
    vi.stubEnv('PRIME_WORK_BROWSER_URL', 'http://127.0.0.1:12345/v1/call')
    vi.stubEnv('PRIME_WORK_BROWSER_TOKEN', 'test-token')
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, result: { dirty: true, text: 'buffer' } }) })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const registerTool = vi.fn()
      editorExtension({ registerTool })
      expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(['editor_context', 'editor_read', 'editor_diagnostics', 'editor_open'])
      const result = await registerTool.mock.calls[1][0].execute('call', { uri: 'file:///project/file.ts' })
      expect(JSON.parse(result.content[0].text)).toEqual({ dirty: true, text: 'buffer' })
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:12345/v1/call',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'editor.read', params: { uri: 'file:///project/file.ts' } }),
        }),
      )
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
})
