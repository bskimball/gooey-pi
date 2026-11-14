import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RPC_READ_FRAME_LIMIT_BYTES } from 'apex-core/jsonl-limits'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnosticPrompt, selectionPrompt, SELECTION_CHAR_LIMIT } from '../../packages/vscode/src/editor-prompts'
import { gitStatusFromRepository, GIT_ENTRY_LIMIT, type GitRepository } from '../../packages/vscode/src/git-status'
import { PiRpc } from '../../packages/vscode/src/pi-rpc'
import { sessionPathFromUri } from '../../packages/vscode/src/extension'
import { assertSessionFree, VsCodeRuntimeOwner } from '../../packages/vscode/src/runtime-owner'
import * as runtimeOwners from 'apex-core/sessions/runtime-owners'
import { listSessions, readSessionTranscript, sessionBucket, sessionTranscriptOps, workspacePath } from '../../packages/vscode/src/session-catalog'
import { applyOps } from '../../packages/vscode/webview/transcript'
import { createActor, initialTransition, transition } from 'xstate'
import { apexSessionConnectionMachine, canAct, hostConnection, type ApexConnectionEvent } from '../../packages/vscode/src/apexSessionConnectionMachine'
import {
  attachedSessionMachine,
  canAttachedPublish,
  canAttachedReceiveEvents,
  isAttachedConnected,
  isAttachedConnecting,
  isAttachedDisposed,
} from '../../packages/vscode/src/attachedSessionMachine'
import {
  hasPiRpcFrameFailed,
  isPiRpcExited,
  isPiRpcRunning,
  isPiRpcStopping,
  piRpcMachine,
} from '../../packages/vscode/src/piRpcMachine'
import type { AttachedSession } from '../../packages/vscode/src/attached-session'

vi.mock('vscode', () => ({
  env: { openExternal: vi.fn() },
  workspace: { workspaceFolders: [], openTextDocument: vi.fn(), findFiles: vi.fn(), asRelativePath: vi.fn(() => 'src/file.ts'), getConfiguration: vi.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })) },
  window: { tabGroups: { all: [] }, activeTextEditor: undefined, showTextDocument: vi.fn(), setStatusBarMessage: vi.fn() },
  languages: { getDiagnostics: vi.fn() },
  Uri: {
    parse: (value: string) => ({ scheme: value.split(':')[0], authority: new URL(value).hostname, fsPath: /^file:/i.test(value) ? fileURLToPath(value, { windows: /^file:\/\/\/\w:/i.test(value) }) : value, toString: () => value }),
    file: (path: string) => ({ scheme: 'file', fsPath: path, toString: () => pathToFileURL(path).href }),
  },
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
import { editorContext, editorFileContext, editorRequest, scopedEditorRequest } from '../../packages/vscode/src/editor'
import editorExtension from '../../apps/desktop/assets/extensions/apex-editor'

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

/** Connection actor a hand-built ApexSession fixture needs, advanced through the given lifecycle events. */
function connectionIn(...events: ApexConnectionEvent[]) {
  const actor = createActor(apexSessionConnectionMachine).start()
  for (const event of events) actor.send(event)
  return actor
}

/** Connection actor that has begun attaching to a Desktop session, then advanced through the given events. */
function desktopIn(path: string, ...events: ApexConnectionEvent[]) {
  return connectionIn({ type: 'ATTACH_DESKTOP', path, resumeLocal: false }, ...events)
}

describe('VS Code handoff lifecycle', () => {
  it('opens local file links within the workspace and reports denied or failed opens', async () => {
    const { cwd, root } = await fixture()
    await mkdir(cwd)
    const path = join(cwd, 'Migration plan #1.docx')
    const outside = join(root, 'outside.docx')
    await writeFile(path, 'sample file')
    await writeFile(outside, 'outside file')
    const session = Object.create(ApexSession.prototype)
    const notice = vi.fn()
    Object.defineProperty(session, 'cwd', { value: cwd })
    Object.assign(session, { connectionActor: connectionIn(), notice })
    const openExternal = vi.mocked(vscode.env.openExternal).mockReset().mockResolvedValue(true)
    await session.handle({ type: 'openExternal', url: pathToFileURL(path).href })
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal.mock.calls[0][0].toString()).toBe(pathToFileURL(path).href)
    for (const url of [pathToFileURL(outside).href, pathToFileURL(join(cwd, 'missing.docx')).href, 'file://remote.example/share/plan.docx']) {
      await session.handle({ type: 'openExternal', url })
      await session.handle({ type: 'openExternal', url: url.replace(/^file:/, 'FILE:') })
    }
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(notice).toHaveBeenCalledTimes(6)
    await session.handle({ type: 'openExternal', url: pathToFileURL(path).href.replace(/^file:/, 'FiLe:') })
    expect(openExternal).toHaveBeenCalledTimes(2)
    expect(openExternal.mock.calls[1][0].toString()).toBe(pathToFileURL(path).href)
    openExternal.mockResolvedValue(false)
    await session.handle({ type: 'openExternal', url: pathToFileURL(path).href })
    expect(notice).toHaveBeenLastCalledWith(expect.stringContaining('could not open'))
  })

  it('opens an observed source line through the webview host without escaping its workspace', async () => {
    const { cwd, root } = await fixture()
    await mkdir(cwd)
    const path = join(cwd, 'file.ts')
    Object.assign(vscode.workspace, { workspaceFolders: [{ uri: vscode.Uri.file(cwd) }] })
    await writeFile(path, 'one\ntwo\nthree')
    const revealRange = vi.fn()
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({ uri: vscode.Uri.file(path), lineCount: 3, languageId: 'typescript', version: 1, isDirty: false, lineAt: () => ({ text: 'line' }) } as never)
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({ revealRange } as never)
    const session = Object.create(ApexSession.prototype)
    const post = vi.fn()
    Object.defineProperty(session, 'cwd', { value: cwd })
    Object.assign(session, { connectionActor: connectionIn(), post })
    await session.handle({ type: 'editor:open', requestId: 1, path, line: 2 })
    expect(post).toHaveBeenLastCalledWith({ type: 'editor:opened', requestId: 1 })
    expect(revealRange.mock.calls[0][0].start.line).toBe(1)
    await session.handle({ type: 'editor:open', requestId: 2, path, line: 0 })
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'editor:opened', requestId: 2, error: expect.any(String) })
    const outside = join(root, 'outside.ts')
    await writeFile(outside, 'private')
    await session.handle({ type: 'editor:open', requestId: 3, path: outside, line: 1 })
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 3, error: expect.any(String) })
    expect(revealRange).toHaveBeenCalledTimes(1)
  })

  it.each(['C:\\Users\\a+b&c%20#名\\session.jsonl', '/work/a+b&c=%25 #名/session.jsonl'])('decodes the handoff path once: %s', (path) => {
    const wireQuery = `session=${encodeURIComponent(path)}`
    // vscode.Uri exposes an already percent-decoded query, not a WHATWG query.
    expect(sessionPathFromUri({ path: '/open', query: decodeURIComponent(wireQuery) })).toBe(path)
    expect(sessionPathFromUri({ path: '/attach', query: decodeURIComponent(wireQuery) })).toBe(path)
    expect(sessionPathFromUri({ path: '/other', query: decodeURIComponent(wireQuery) })).toBeNull()
  })

  it('removes the owner only after an in-flight publication finishes and never republishes after disposal', async () => {
    let finish!: () => void
    const publish = vi.spyOn(runtimeOwners, 'publishRuntimeOwner').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const remove = vi.spyOn(runtimeOwners, 'removeRuntimeOwner').mockImplementation(() => undefined)
    const acquire = vi.spyOn(runtimeOwners, 'acquireRuntimeSession').mockReturnValue(() => undefined)
    const owner = new VsCodeRuntimeOwner(() => '/repo')
    try {
      owner.set('/repo/session.jsonl')
      await Promise.resolve()
      expect(publish).toHaveBeenCalledOnce()
      const disposed = owner.dispose()
      owner.set('/repo/late.jsonl')
      expect(remove).not.toHaveBeenCalled()
      finish()
      await disposed
      await Promise.resolve()
      expect(remove).toHaveBeenCalledOnce()
      expect(publish).toHaveBeenCalledOnce()
    } finally {
      await owner.dispose()
      publish.mockRestore()
      remove.mockRestore()
      acquire.mockRestore()
    }
  })

  it('reserves before a VS Code attach and releases only the confirmed outgoing session', async () => {
    const released: string[] = []
    const acquire = vi.spyOn(runtimeOwners, 'acquireRuntimeSession').mockImplementation((path) => () => { released.push(path) })
    const publish = vi.spyOn(runtimeOwners, 'publishRuntimeOwner').mockResolvedValue(undefined)
    const remove = vi.spyOn(runtimeOwners, 'removeRuntimeOwner').mockImplementation(() => undefined)
    const owner = new VsCodeRuntimeOwner(() => '/repo')
    try {
      owner.set('/repo/old.jsonl')
      const finish = owner.reserve('/repo/next.jsonl')
      expect(acquire).toHaveBeenCalledTimes(2)
      owner.set('/repo/old.jsonl')
      expect(released).toEqual([])
      owner.set('/repo/next.jsonl')
      expect(released).toHaveLength(1)
      finish()
      expect(released).toHaveLength(1)
      owner.set(null) // Only the exit/detach callback is allowed to do this.
      expect(released).toHaveLength(2)
    } finally {
      await owner.dispose()
      acquire.mockRestore()
      publish.mockRestore()
      remove.mockRestore()
    }
  })

  it('refuses standalone takeover without asking Desktop to release its runtime', async () => {
    const session = join(tmpdir(), 'held.jsonl')
    const assertFree = vi.spyOn(runtimeOwners, 'assertSessionNotOwnedElsewhere').mockRejectedValue(new Error('Open in Apex desktop'))
    const request = vi.spyOn(runtimeOwners, 'requestSessionRelease')
    try {
      await expect(assertSessionFree(session)).rejects.toThrow('Open in Apex desktop')
      expect(request).not.toHaveBeenCalled()
    } finally { assertFree.mockRestore(); request.mockRestore() }
  })

  it('retains Desktop attachment intent through repeated failed reconnects', async () => {
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { connectionActor: desktopIn('/desktop-session.jsonl', { type: 'DESKTOP_UNAVAILABLE', path: '/desktop-session.jsonl', error: 'Desktop is closed.' }), state: {}, post: vi.fn(), attachDesktop: vi.fn().mockResolvedValue(false) })
    await session.start()
    expect(session.state).toMatchObject({ status: 'exited', connection: 'desktop' })
    await session.start()
    expect(session.attachDesktop).toHaveBeenCalledTimes(2)
    expect(session.connectionActor.getSnapshot().context.path).toBe('/desktop-session.jsonl')
  })

  it('rejects an attachment during a standalone run without changing state, ownership, or the running RPC', async () => {
    const state = { status: 'ready', connection: 'standalone', isStreaming: true }
    const rpc = { dispose: vi.fn() }
    const owner = { set: vi.fn() }
    const connectionActor = connectionIn({ type: 'LOCAL_STARTED' })
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { state, rpc, owner, connectionActor, launchGeneration: 3, post: vi.fn(), attachDesktop: vi.fn() })
    Object.assign(vscode.window, { showWarningMessage: vi.fn() })
    await session.openFromDesktop('/desktop-session.jsonl', true)
    expect(session.state).toBe(state)
    expect(state).toEqual({ status: 'ready', connection: 'standalone', isStreaming: true })
    expect(connectionActor.getSnapshot().context.path).toBeUndefined()
    expect(session.rpc).toBe(rpc)
    expect(session.launchGeneration).toBe(3)
    expect(rpc.dispose).not.toHaveBeenCalled()
    expect(owner.set).not.toHaveBeenCalled()
    expect(session.attachDesktop).not.toHaveBeenCalled()
    expect(session.post).not.toHaveBeenCalled()
  })

  it('does not fall back to standalone when an attachment-only URI cannot connect', async () => {
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { connectionActor: connectionIn(), state: {}, launchGeneration: 0, stopping: Promise.resolve(), owner: { set: vi.fn() }, post: vi.fn(), attachDesktop: vi.fn().mockResolvedValue(false), switchSession: vi.fn(), start: vi.fn() })
    const warning = vi.fn()
    Object.assign(vscode.window, { showWarningMessage: warning })
    await session.openFromDesktop('/desktop-session.jsonl', true)
    expect(session.connectionActor.getSnapshot().context.path).toBe('/desktop-session.jsonl')
    expect(session.state).toMatchObject({ status: 'exited', connection: 'desktop' })
    expect(session.switchSession).not.toHaveBeenCalled()
    expect(session.start).not.toHaveBeenCalled()
  })

  it('opens a transfer without waiting on stale startup state from a previous Desktop attachment', async () => {
    vi.useFakeTimers()
    const session = Object.create(ApexSession.prototype)
    const attached = {} as AttachedSession
    Object.assign(session, {
      state: { status: 'starting', isStreaming: false },
      connectionActor: desktopIn('/desktop-session.jsonl', { type: 'ATTACHED', path: '/desktop-session.jsonl', view: attached }),
      attachDesktop: vi.fn(), switchSession: vi.fn().mockResolvedValue(undefined),
    })
    const opening = session.openFromDesktop('/desktop-session.jsonl')
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(session.switchSession).toHaveBeenCalledWith('/desktop-session.jsonl', false)
      expect(session.attachDesktop).not.toHaveBeenCalled()
    } finally {
      await vi.runAllTimersAsync()
      await opening
      vi.useRealTimers()
    }
  })

  it('keeps the current attached view when a standalone transfer is still owned elsewhere', async () => {
    const assertFree = vi.spyOn(runtimeOwners, 'assertSessionNotOwnedElsewhere').mockRejectedValue(new Error('Open in Apex desktop'))
    const attached = { dispose: vi.fn() } as unknown as AttachedSession
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { connectionActor: desktopIn('/desktop-session.jsonl', { type: 'ATTACHED', path: '/desktop-session.jsonl', view: attached }), attachDesktop: vi.fn(), start: vi.fn() })
    try {
      await expect(session.switchSession('/desktop-session.jsonl', false)).rejects.toThrow('Open in Apex desktop')
      expect(session.attached).toBe(attached)
      expect(attached.dispose).not.toHaveBeenCalled()
      expect(session.attachDesktop).not.toHaveBeenCalled()
      expect(session.start).not.toHaveBeenCalled()
    } finally { assertFree.mockRestore() }
  })

  it('hands a session to Desktop after its attached view disconnects', async () => {
    const { cwd } = await fixture()
    const view = {} as AttachedSession
    const info = vi.fn()
    Object.assign(vscode.window, { showInformationMessage: info, showWarningMessage: vi.fn() })
    const session = Object.create(ApexSession.prototype)
    const newSession = vi.fn(async () => { session.currentPath = '/next-session.jsonl' })
    const connectionActor = connectionIn({ type: 'ATTACH_DESKTOP', path: '/desktop-session.jsonl', resumeLocal: false }, { type: 'ATTACHED', path: '/desktop-session.jsonl', view })
    Object.assign(vscode.workspace, { workspaceFolders: [{ uri: vscode.Uri.file(cwd) }] })
    Object.assign(session, { currentPath: '/desktop-session.jsonl', state: { status: 'ready', isStreaming: false }, connectionActor, post: vi.fn(), newSession })
    connectionActor.send({ type: 'DESKTOP_DISCONNECTED', view, error: 'Desktop closed.' })
    expect(session.attached).toBeUndefined()
    await session.continueInDesktop()
    expect(newSession).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('is free to continue in Apex desktop'))
  })

  it('leaves attachment as unavailable when Desktop disconnects before the attach completes', () => {
    const connectionActor = desktopIn('/desktop-session.jsonl')
    connectionActor.send({ type: 'DESKTOP_DISCONNECTED', view: {} as AttachedSession, error: 'Desktop closed.' })
    expect(connectionActor.getSnapshot()).toMatchObject({ context: { path: '/desktop-session.jsonl', view: undefined, error: 'Desktop closed.' } })
    expect(connectionActor.getSnapshot().matches('desktopUnavailable')).toBe(true)
    const local = connectionIn({ type: 'LOCAL_STARTED' }, { type: 'ATTACH_DESKTOP', path: '/desktop-session.jsonl', resumeLocal: true })
    local.send({ type: 'DESKTOP_DISCONNECTED', view: {} as AttachedSession, error: 'Desktop closed.' })
    expect(canAct(local.getSnapshot())).toBe(true)
    expect(hostConnection(local.getSnapshot())).toMatchObject({ status: 'ready', connection: 'standalone' })
    expect(local.getSnapshot().context.path).toBeUndefined()
  })

  it('overrides inherited Desktop editor credentials in a real standalone Pi child', async () => {
    vi.stubEnv('APEX_EDITOR_URL', 'http://inherited-desktop')
    vi.stubEnv('APEX_EDITOR_TOKEN', 'inherited-fixture-token')
    const rpc = new PiRpc({ file: process.execPath, args: ['-e', `require('node:readline').createInterface({ input: process.stdin }).on('line', line => { const c = JSON.parse(line); process.stdout.write(JSON.stringify({type:'response',id:c.id,success:true,data:{url:process.env.APEX_EDITOR_URL,token:process.env.APEX_EDITOR_TOKEN}})+'\\n') })`] }, [], process.cwd(), () => undefined, () => undefined, { APEX_BROWSER_URL: 'http://own-editor', APEX_BROWSER_TOKEN: 'own-fixture-token' })
    try { expect(await rpc.command('get_state')).toEqual({ url: 'http://own-editor', token: 'own-fixture-token' }) }
    finally { await rpc.dispose(); vi.unstubAllEnvs() }
  })

  it('keeps ownership through a child shutdown flush', async () => {
    const exited = vi.fn()
    const rpc = new PiRpc(
      { file: process.execPath, args: ['-e', `
        process.stdin.resume();
        process.stdin.once('data', data => {
          const request = JSON.parse(data);
          process.stdout.write(JSON.stringify({ type: 'response', id: request.id, success: true }) + '\\n');
        });
        process.stdin.on('end', () => setTimeout(() => process.exit(0), 150));
      `] },
      [], process.cwd(), () => undefined, exited,
    )
    await rpc.command('get_state')
    const owner = { dispose: vi.fn(async () => { expect(exited).toHaveBeenCalledOnce() }) }
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      rpc, owner, connectionActor: connectionIn(), stopping: Promise.resolve(), launchGeneration: 0,
      browser: { stop: vi.fn(async () => undefined) }, statusItem: { dispose: vi.fn() },
    })
    const shutdown = session.dispose()
    expect(session.dispose()).toBe(shutdown)
    await Promise.resolve()
    expect(owner.dispose).not.toHaveBeenCalled()
    expect(exited).not.toHaveBeenCalled()
    await shutdown
    expect(owner.dispose).toHaveBeenCalledOnce()
    await rpc.dispose()
    expect(exited).toHaveBeenCalledOnce()
  })

  it('does not clear ownership or restart while a previous child is stopping', async () => {
    let finish!: () => void
    const previous = { dispose: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) }
    const owner = { set: vi.fn() }
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      connectionActor: connectionIn(),
      rpc: previous, owner, stopping: Promise.resolve(), launchGeneration: 0,
      browser: { capability: { revoke: vi.fn() }, start: vi.fn() },
    })
    const starting = session.start()
    await Promise.resolve()
    expect(previous.dispose).toHaveBeenCalledOnce()
    expect(owner.set).not.toHaveBeenCalled()
    expect(session.browser.start).not.toHaveBeenCalled()
    // Supersede this launch while the old child is still exiting.
    session.launchGeneration++
    finish()
    await starting
    expect(owner.set).not.toHaveBeenCalled()
    expect(session.browser.start).not.toHaveBeenCalled()
  })

  it('reports ready with a notice when reading Pi state fails after launch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'apex-fake-pi-'))
    directories.push(directory)
    // A stdin-only stand-in for pi: start() spawns it for real, but refreshAll is stubbed to reject.
    const script = join(directory, 'pi.js')
    await writeFile(script, 'process.stdin.resume()\n')
    const configuration = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => (key === 'piPath' ? script : fallback) } as never)
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      connectionActor: connectionIn(), state: { status: 'starting', isStreaming: false }, post: vi.fn(),
      ops: [], pendingOps: [], latestToolUpdate: new Map(), statuses: new Map(), uiQueue: [], seq: 0, currentPath: null,
      launchGeneration: 0, stopping: Promise.resolve(), browserSessionKey: '/project', browserPortNotice: false,
      owner: { set: vi.fn() }, statusItem: { hide: vi.fn() }, distDirectory: directory,
      browser: {
        bridge: { port: 29301 }, extensionPath: join(directory, 'extension'), start: vi.fn(async () => undefined),
        capability: { revoke: vi.fn(), environmentFor: () => ({ APEX_BROWSER_TOKEN: 'fixture-token' }) },
        service: { setActiveSession: vi.fn(async () => undefined) },
      },
      refreshAll: vi.fn().mockRejectedValue(new Error('state unavailable')),
    })
    try {
      await session.start()
      await session.startup
      expect(session.refreshAll).toHaveBeenCalledOnce()
      expect(canAct(session.connectionActor.getSnapshot())).toBe(true)
      expect(session.state).toMatchObject({ status: 'ready', connection: 'standalone' })
      expect(session.pendingOps.at(-1)).toMatchObject({ kind: 'notice', text: "Could not read Pi's state: state unavailable" })
    } finally {
      await session.rpc?.dispose()
      configuration.mockRestore()
    }
  })
})

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

describe('VS Code mode status', () => {
  it('publishes runtime Hydra status changes and removals to the webview', () => {
    const post = vi.fn()
    const refreshState = vi.fn().mockResolvedValue(undefined)
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      post,
      connectionActor: connectionIn({ type: 'LOCAL_STARTED' }),
      state: { statuses: {} },
      statuses: new Map(),
      statusItem: { show: vi.fn(), hide: vi.fn() },
      refreshState,
      guard: (fn: () => Promise<unknown>) => fn(),
    })

    session.onRecord({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'mode', statusText: 'Apex' })
    session.onRecord({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'hydra', statusText: 'hydra:max' })
    expect(post).toHaveBeenLastCalledWith({ type: 'state', state: { statuses: { mode: 'Apex', hydra: 'hydra:max' }, status: 'ready', connection: 'standalone' } })
    session.onRecord({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'hydra' })
    expect(post).toHaveBeenLastCalledWith({ type: 'state', state: { statuses: { mode: 'Apex' }, status: 'ready', connection: 'standalone' } })
    expect(refreshState).toHaveBeenCalledTimes(3)
  })
})

describe('VS Code saved sessions', () => {
  it('closes the session picker and surfaces a notice when an explicit refresh fails, while ignoring superseded fetches', async () => {
    const { createActor } = await import('xstate')
    const { sessionPickerMachine } = await import('../../packages/vscode/webview/sessionPickerMachine')
    const onNotice = vi.fn()
    let resolveFirst!: (value: import('../../packages/vscode/webview/sessionPickerMachine').ListedSessions) => void
    let rejectSecond!: (error: Error) => void

    const actor = createActor(sessionPickerMachine).start()
    try {
      actor.send({ type: 'OPEN' })
      expect(actor.getSnapshot().matches({ disclosure: 'open' })).toBe(true)

      actor.send({
        type: 'REFRESH',
        reportError: true,
        listSessions: () => new Promise((resolve) => { resolveFirst = resolve }),
        onNotice,
      })
      actor.send({
        type: 'REFRESH',
        reportError: true,
        listSessions: () => new Promise((_, reject) => { rejectSecond = reject }),
        onNotice,
      })

      resolveFirst({
        sessions: [{ path: '/stale.jsonl', id: 'stale', title: 'Stale', preview: '', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 1 }],
        currentPath: '/stale.jsonl',
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(actor.getSnapshot().context.items).toEqual([])
      expect(actor.getSnapshot().matches({ catalog: 'loading' })).toBe(true)

      rejectSecond(new Error('Catalog read failed'))
      await Promise.resolve()
      await Promise.resolve()
      expect(actor.getSnapshot().matches({ disclosure: 'closed', catalog: 'idle' })).toBe(true)
      expect(onNotice).toHaveBeenCalledExactlyOnceWith('Catalog read failed')
    } finally {
      actor.stop()
    }
  })

  it('reads header, first-user preview, name, timestamps and message count', async () => {
    const { cwd, root, paths } = await fixture()
    expect(await listSessions(cwd, root)).toEqual([{ path: paths[0], id: 'session-0', title: 'Named 0', preview: 'First prompt', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 2 }])
  })

  it('uppercases only Windows drive letters from VS Code workspace paths', () => {
    expect(workspacePath('c:\\Users\\dev\\project', 'win32')).toBe('C:\\Users\\dev\\project')
    expect(workspacePath('C:\\Users\\dev\\project', 'win32')).toBe('C:\\Users\\dev\\project')
    expect(workspacePath('/users/dev/project', 'darwin')).toBe('/users/dev/project')
  })

  it.runIf(process.platform === 'win32')('lists sessions recorded with a different drive-letter case than the workspace', async () => {
    const { cwd, root, paths } = await fixture()
    const lowerDrive = cwd.replace(/^[A-Z](?=:)/, (drive) => drive.toLowerCase())
    expect((await listSessions(lowerDrive, root)).map((session) => session.path)).toEqual([paths[0]])
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

  it('resolves rpc-worker transcripts and rejects paths outside the Pi session root', async () => {
    const { cwd, root } = await fixture()
    const workerDir = join(root, 'rpc-workers', 'worker-abc')
    await mkdir(workerDir, { recursive: true })
    const workerFile = join(workerDir, '2026-01-01T00-00-00-000Z_worker.jsonl')
    const entries = [
      { type: 'session', version: 3, id: 'worker-abc', cwd, timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Worker mission' }] } },
      { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Worker findings' }] } },
    ]
    await writeFile(workerFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    const loaded = await readSessionTranscript(join(workerDir, 'worker.jsonl'), root)
    expect(loaded).toHaveLength(2)
    expect(loaded[1]?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Worker findings' }))
    const rootLevelFile = join(root, 'outside.jsonl')
    await writeFile(rootLevelFile, '{}')
    await expect(readSessionTranscript(rootLevelFile, root)).rejects.toThrow('outside the Pi session directory')
    const externalDir = await mkdtemp(join(tmpdir(), 'apex-vscode-external-'))
    directories.push(externalDir)
    const externalFile = join(externalDir, '2026-01-01T00-00-00-000Z_ext.jsonl')
    await writeFile(externalFile, '{}')
    await expect(readSessionTranscript(externalFile, root)).rejects.toThrow('outside the Pi session directory')

    const post = vi.fn()
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { connectionActor: connectionIn(), post })
    await session.handle({ type: 'sessions:read', requestId: 42, path: '' })
    expect(post).toHaveBeenCalledWith({ type: 'sessions:read', requestId: 42, messages: [], error: 'Invalid session path.' })
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
    Object.assign(session, { rpc: { command }, connectionActor: mode === 'busy' ? connectionIn({ type: 'LOCAL_STARTED' }) : connectionIn(), state: { status: mode === 'starting' ? 'starting' : 'ready', isStreaming: mode === 'busy' } })
    await expect(session.switchSession('/unused.jsonl')).rejects.toThrow('Cannot switch sessions while Pi is starting, busy, or not running.')
    expect(command).not.toHaveBeenCalled()
  })

  it('does not report ready when local Pi exits during the restart that precedes a switch', async () => {
    const connectionActor = desktopIn('/desktop-session.jsonl', { type: 'DESKTOP_UNAVAILABLE', path: '/desktop-session.jsonl', error: 'Desktop is closed.' })
    let session: any
    // Stands in for start(): the child exits before the restart settles, and the host publishes state afterwards.
    const restart = vi.fn(async () => {
      connectionActor.send({ type: 'START_LOCAL' })
      connectionActor.send({ type: 'LOCAL_EXITED', error: 'Pi stopped (exit code 1).' })
      session.update({ isStreaming: false })
    })
    session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      connectionActor, post: vi.fn(),
      state: { status: 'ready', isStreaming: false }, rpc: undefined, startup: Promise.resolve(),
      attachDesktop: vi.fn().mockResolvedValue(false), start: restart, refreshAll: vi.fn().mockResolvedValue(undefined),
    })
    await expect(session.switchSession('/next-session.jsonl')).rejects.toThrow('Cannot switch sessions while Pi is starting, busy, or not running.')
    expect(restart).toHaveBeenCalledOnce()
    expect(canAct(connectionActor.getSnapshot())).toBe(false)
    expect(session.state).toMatchObject({ status: 'exited', connection: 'standalone', error: 'Pi stopped (exit code 1).' })
    expect(hostConnection(connectionActor.getSnapshot()).status).toBe('exited')
  })
})

describe('VS Code editor integration', () => {
  it.runIf(process.platform === 'win32')('lists workspace files when VS Code supplies lowercase drive letters', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders
    Object.assign(vscode.workspace, { workspaceFolders: [{ uri: { fsPath: 'c:\\work\\project' } }] })
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      { fsPath: 'c:\\work\\project\\src\\file.ts' },
      { fsPath: 'd:\\other\\src\\file.ts' },
    ] as vscode.Uri[])
    const post = vi.fn()
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, { connectionActor: connectionIn(), post })
    try {
      await session.handle({ type: 'listFiles', requestId: 1 })
      expect(post).toHaveBeenCalledWith({ type: 'files', requestId: 1, entries: [
        { path: 'src', type: 'directory' },
        { path: 'src/file.ts', type: 'file' },
      ] })
    } finally {
      Object.assign(vscode.workspace, { workspaceFolders })
      vi.mocked(vscode.workspace.findFiles).mockReset()
    }
  })

  it('binds attached editor reads to the negotiated workspace and retains unsaved buffer versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'apex-editor-scope-'))
    directories.push(root)
    const project = join(root, 'project')
    await mkdir(project)
    const file = join(project, 'file.ts')
    const outside = join(root, 'outside.ts')
    await writeFile(file, 'disk content')
    await writeFile(outside, 'outside content')
    Object.assign(vscode.workspace, { workspaceFolders: [{ uri: vscode.Uri.file(project), name: 'project' }] })
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({ uri: vscode.Uri.file(file), languageId: 'typescript', isDirty: true, version: 12, lineCount: 1, lineAt: () => ({ text: 'unsaved buffer' }), getText: () => 'unsaved buffer' } as unknown as vscode.TextDocument)
    try {
      expect(await scopedEditorRequest(project, 'editor.read', { cwd: project, uri: pathToFileURL(file).href })).toMatchObject({ text: 'unsaved buffer', version: 12, dirty: true })
      await expect(scopedEditorRequest(project, 'editor.read', { cwd: root, uri: pathToFileURL(file).href })).rejects.toThrow('workspace does not match')
      await expect(scopedEditorRequest(project, 'editor.read', { cwd: project, uri: pathToFileURL(outside).href })).rejects.toThrow('outside the attached workspace')
      Object.assign(vscode.workspace, { workspaceFolders: [] })
      await expect(scopedEditorRequest(project, 'editor.read', { cwd: project, uri: pathToFileURL(file).href })).rejects.toThrow('no longer open')
    } finally { Object.assign(vscode.workspace, { workspaceFolders: [] }) }
  })

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
      connectionActor: connectionIn(),
      rpc: { command },
      seq: 0,
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

  it('keeps queued prompts paused when an extension cancels a new session', async () => {
    const command = vi.fn().mockResolvedValue({ cancelled: true })
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      connectionActor: connectionIn(),
      rpc: { command },
      seq: 0,
      state: { isStreaming: true, commands: [], queued: [] },
      update(patch: object) { Object.assign(this.state, patch) },
      addOp: vi.fn(),
      notice: vi.fn(),
      guard: (fn: () => Promise<unknown>) => fn(),
    })
    await session.send('Hold this', [], 'queue', '')
    session.state.isStreaming = false
    await session.newSession()
    session.flushQueue()
    expect(command).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledWith('new_session')
    expect(session.state.queued).toHaveLength(1)
  })

  it('registers editor tools and sends authenticated calls to the bridge', async () => {
    vi.stubEnv('APEX_EDITOR_URL', undefined)
    vi.stubEnv('APEX_EDITOR_TOKEN', undefined)
    vi.stubEnv('APEX_BROWSER_URL', 'http://127.0.0.1:12345/v1/call')
    vi.stubEnv('APEX_BROWSER_TOKEN', 'test-token')
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

  it('quotes a bounded selection in a fence its own backticks cannot close', () => {
    const prompt = selectionPrompt({ path: 'src/a.ts', startLine: 3, endLine: 5, languageId: 'ts', text: '```\nx' })
    expect(prompt).toBe('src/a.ts, lines 3-5:\n````ts\n```\nx\n````\n\n')
    const long = selectionPrompt({ path: 'a', startLine: 1, endLine: 1, languageId: 'ts', text: 'y'.repeat(SELECTION_CHAR_LIMIT + 5) })
    expect(long).toContain(`first ${SELECTION_CHAR_LIMIT} of ${SELECTION_CHAR_LIMIT + 5} characters`)
  })

  it('describes a diagnostic with its origin and surrounding line', () => {
    const prompt = diagnosticPrompt({ path: 'a.ts', startLine: 2, endLine: 2, severity: 'error', source: 'ts', code: 2304, message: 'Cannot find name', lineText: 'foo()' })
    expect(prompt).toContain('Fix this error in a.ts, line 2 (ts 2304)')
    expect(prompt).toContain('Cannot find name')
    expect(prompt).toContain('foo()')
  })

  it('maps vscode.git changes without inventing counts and bounds the list', () => {
    const change = (status: number, name: string) => ({ uri: { fsPath: name }, status })
    const repository: GitRepository = {
      rootUri: { fsPath: '/r' },
      state: {
        HEAD: { name: 'main' },
        indexChanges: [change(1, 'new.ts')],
        workingTreeChanges: [change(5, 'a.ts'), change(7, 'u.ts'), change(8, 'ignored.ts')],
        mergeChanges: [],
        untrackedChanges: [change(7, 'u2.ts')],
        onDidChange: () => ({ dispose() {} }),
      },
    }
    expect(gitStatusFromRepository(repository, path => path)).toEqual({
      isRepo: true,
      branch: 'main',
      lineCounts: false,
      files: [
        { path: 'new.ts', status: 'A', staged: true, additions: 0, deletions: 0 },
        { path: 'a.ts', status: 'M', staged: false, additions: 0, deletions: 0 },
        { path: 'u.ts', status: '??', staged: false, additions: 0, deletions: 0 },
        { path: 'u2.ts', status: '??', staged: false, additions: 0, deletions: 0 },
      ],
    })
    repository.state.workingTreeChanges = Array.from({ length: GIT_ENTRY_LIMIT + 1 }, (_, index) => change(5, `f${index}`))
    const bounded = gitStatusFromRepository(repository, path => path)
    expect(bounded.files).toHaveLength(GIT_ENTRY_LIMIT)
    expect(bounded.truncated).toBe(true)
  })

  it('routes /compact and /compact <instructions> to the compact RPC command without user bubbles or editor context', async () => {
    let finishCompact!: () => void
    const command = vi.fn(() => new Promise<object>((resolve) => { finishCompact = () => resolve({}) }))
    const addOp = vi.fn()
    const refreshStats = vi.fn().mockResolvedValue(undefined)
    const refreshState = vi.fn().mockResolvedValue(undefined)
    const flushQueue = vi.fn()
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      rpc: { command },
      seq: 0,
      state: { isStreaming: false, commands: [], queued: [] },
      update(patch: object) {
        Object.assign(this.state, patch)
      },
      addOp,
      refreshStats,
      refreshState,
      flushQueue,
      guard: (fn: () => Promise<unknown>) => fn(),
    })

    const bare = session.send('/compact', [], 'queue', '\nCAPTURED_EDITOR')
    expect(session.state.isStreaming).toBe(true)
    expect(addOp).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledWith('compact', {})
    finishCompact()
    await bare
    expect(session.state.isStreaming).toBe(false)
    expect(refreshStats).toHaveBeenCalledOnce()
    expect(refreshState).toHaveBeenCalledOnce()
    expect(flushQueue).toHaveBeenCalledOnce()

    const instructed = session.send('  /compact   keep API contracts  ', [], 'queue', '\nCAPTURED_EDITOR')
    expect(command).toHaveBeenLastCalledWith('compact', { customInstructions: 'keep API contracts' })
    finishCompact()
    await instructed
  })

  it('queues /compact while streaming even under steer or sendQueued, then runs compact on settle', async () => {
    const command = vi.fn().mockResolvedValue({})
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      connectionActor: connectionIn(),
      rpc: { command },
      seq: 0,
      queuePaused: false,
      state: { isStreaming: true, commands: [], queued: [] },
      update(patch: object) {
        Object.assign(this.state, patch)
      },
      addOp: vi.fn(),
      refreshStats: vi.fn().mockResolvedValue(undefined),
      refreshState: vi.fn().mockResolvedValue(undefined),
      guard: (fn: () => Promise<unknown>) => fn(),
    })

    await session.send('/compact focus on tests', [], 'steer', '\nCAPTURED_EDITOR')
    expect(command).not.toHaveBeenCalled()
    expect(session.state.queued).toEqual([expect.objectContaining({ text: '/compact focus on tests', intent: 'queue' })])
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Apex: Compaction will run when the current turn finishes.', 6000)

    await session.handle({ type: 'sendQueued', id: session.state.queued[0].id })
    expect(command).not.toHaveBeenCalled()
    expect(session.state.queued).toHaveLength(1)

    session.onRecord({ type: 'agent_settled' })
    await Promise.resolve()
    expect(command).toHaveBeenCalledWith('compact', { customInstructions: 'focus on tests' })
    expect(session.state.queued).toEqual([])
  })

  it('avoids duplicate error notices when Pi already emitted compaction_end before rejecting compact', async () => {
    const notice = vi.fn()
    const session = Object.create(ApexSession.prototype)
    const command = vi.fn(async () => {
      session.onRecord({ type: 'compaction_start', reason: 'manual' })
      session.onRecord({ type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false, errorMessage: 'Compaction failed: Nothing to compact (session too small)' })
      throw new Error('Nothing to compact (session too small)')
    })
    Object.assign(session, {
      rpc: { command },
      seq: 0,
      state: { isStreaming: false, commands: [], queued: [] },
      update(patch: object) {
        Object.assign(this.state, patch)
      },
      appendEvent: vi.fn(),
      notice,
      refreshStats: vi.fn().mockResolvedValue(undefined),
      refreshState: vi.fn().mockResolvedValue(undefined),
      flushQueue: vi.fn(),
      guard: (fn: () => Promise<unknown>) => fn(),
    })

    await session.send('/compact', [], 'queue', '')
    expect(notice).not.toHaveBeenCalled()
    expect(session.state.isStreaming).toBe(false)

    command.mockRejectedValueOnce(new Error('Pi exited (code 1)'))
    await session.send('/compact', [], 'queue', '')
    expect(notice).toHaveBeenCalledWith('Pi exited (code 1)')
  })

  it('holds steers, image prompts, and sendQueued while manual compaction is running, then flushes them after compact settles', async () => {
    let finishCompact!: () => void
    const command = vi.fn((type: string) => (type === 'compact' ? new Promise<object>((resolve) => { finishCompact = () => resolve({}) }) : Promise.resolve({})))
    const addOp = vi.fn()
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      connectionActor: connectionIn(),
      rpc: { command },
      seq: 0,
      queuePaused: false,
      state: { isStreaming: false, commands: [], queued: [] },
      update(patch: object) {
        Object.assign(this.state, patch)
      },
      addOp,
      refreshStats: vi.fn().mockResolvedValue(undefined),
      refreshState: vi.fn().mockResolvedValue(undefined),
      guard: (fn: () => Promise<unknown>) => fn(),
    })

    const compactRun = session.send('/compact', [], 'queue', '')
    expect(session.state.isStreaming).toBe(true)

    const image = { type: 'image' as const, mimeType: 'image/png', data: 'aGVsbG8=' }
    await session.send('Steer during compact', [], 'steer', '\nSTEER_CTX')
    await session.send('Image during compact', [image], 'queue', '\nIMAGE_CTX')
    await session.handle({ type: 'sendQueued', id: session.state.queued[0].id })

    // Neither prompt nor user bubbles may be sent while manual compaction is active.
    expect(command).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledWith('compact', {})
    expect(addOp).not.toHaveBeenCalled()
    expect(session.state.queued).toHaveLength(2)

    finishCompact()
    await compactRun
    expect(command).toHaveBeenNthCalledWith(2, 'prompt', { message: 'Steer during compact\nSTEER_CTX' })
    expect(session.state.queued).toHaveLength(1)

    session.onRecord({ type: 'agent_settled' })
    await Promise.resolve()
    expect(command).toHaveBeenNthCalledWith(3, 'prompt', { message: 'Image during compact\nIMAGE_CTX', images: [image] })
    expect(session.state.queued).toEqual([])
  })

  it('settles extension-triggered manual compaction on compaction_end while keeping auto-compaction busy until agent_settled', async () => {
    const command = vi.fn().mockResolvedValue({})
    const refreshState = vi.fn().mockResolvedValue(undefined)
    const session = Object.create(ApexSession.prototype)
    Object.assign(session, {
      rpc: { command },
      seq: 0,
      queuePaused: false,
      state: { isStreaming: false, commands: [], queued: [] },
      update(patch: object) {
        Object.assign(this.state, patch)
      },
      addOp: vi.fn(),
      appendEvent: vi.fn(),
      refreshStats: vi.fn().mockResolvedValue(undefined),
      refreshState,
      guard: (fn: () => Promise<unknown>) => fn(),
    })

    // Active run followed by auto-compaction stays streaming until agent_settled.
    session.onRecord({ type: 'agent_start' })
    expect(session.turnActor.getSnapshot().value).toBe('streaming')
    session.onRecord({ type: 'compaction_start', reason: 'threshold' })
    expect(session.turnActor.getSnapshot().value).toBe('compacting')
    session.onRecord({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false })
    expect(session.turnActor.getSnapshot().value).toBe('streaming')
    expect(session.state.isStreaming).toBe(true)
    session.onRecord({ type: 'agent_settled' })
    expect(session.turnActor.getSnapshot().value).toBe('idle')
    expect(session.state.isStreaming).toBe(false)

    // Extension-triggered manual compaction has no host compact promise and no trailing agent_settled,
    // and an idle extension command may emit compaction_start before resolving with disposition=handled.
    command.mockImplementationOnce(async () => {
      session.onRecord({ type: 'compaction_start', reason: 'manual' })
      return { disposition: 'handled' }
    })
    session.state.commands = [{ name: 'extcompact', source: 'extension' }]
    await session.send('/extcompact', [], 'queue', '')
    expect(session.state.isStreaming).toBe(true)
    await session.send('After extension compact', [], 'steer', '\nEXT_CTX')
    expect(command).toHaveBeenCalledTimes(1)
    expect(session.state.queued).toHaveLength(1)

    session.onRecord({ type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false })
    expect(refreshState).toHaveBeenCalled()
    expect(command).toHaveBeenLastCalledWith('prompt', { message: 'After extension compact\nEXT_CTX' })
    expect(session.state.queued).toEqual([])
  })

  it('transitions piRpcMachine through running, stopping, exited, and frameFailed', () => {
    let snap = initialTransition(piRpcMachine)[0]
    expect(isPiRpcRunning(snap)).toBe(true)
    expect(hasPiRpcFrameFailed(snap)).toBe(false)

    snap = transition(piRpcMachine, snap, { type: 'FRAME_ERROR' })[0]
    expect(isPiRpcRunning(snap)).toBe(true)
    expect(hasPiRpcFrameFailed(snap)).toBe(true)

    snap = transition(piRpcMachine, snap, { type: 'DISPOSE' })[0]
    expect(isPiRpcStopping(snap)).toBe(true)

    snap = transition(piRpcMachine, snap, { type: 'CLOSE' })[0]
    expect(isPiRpcExited(snap)).toBe(true)
    expect(isPiRpcRunning(snap)).toBe(false)

    // DISPOSE after CLOSE does not re-enter stopping
    snap = transition(piRpcMachine, snap, { type: 'DISPOSE' })[0]
    expect(isPiRpcExited(snap)).toBe(true)
  })

  it('transitions attachedSessionMachine and queues overlapping refreshes without publishing after disconnect/dispose', () => {
    let snap = initialTransition(attachedSessionMachine)[0]
    expect(isAttachedConnecting(snap)).toBe(true)
    expect(canAttachedPublish(snap)).toBe(false)
    expect(canAttachedReceiveEvents(snap)).toBe(true)

    snap = transition(attachedSessionMachine, snap, { type: 'CONNECTED' })[0]
    expect(isAttachedConnected(snap)).toBe(true)
    expect(canAttachedPublish(snap)).toBe(false)

    snap = transition(attachedSessionMachine, snap, { type: 'REPLAY' })[0]
    expect(canAttachedPublish(snap)).toBe(true)

    // Overlapping refreshes queue in context and drain cleanly
    snap = transition(attachedSessionMachine, snap, { type: 'REFRESH_REQUESTED' })[0]
    expect(snap.context).toEqual({ refreshInFlight: true, refreshPending: false })
    snap = transition(attachedSessionMachine, snap, { type: 'REFRESH_REQUESTED' })[0]
    expect(snap.context).toEqual({ refreshInFlight: true, refreshPending: true })
    snap = transition(attachedSessionMachine, snap, { type: 'REFRESH_FINISHED' })[0]
    expect(snap.context).toEqual({ refreshInFlight: true, refreshPending: false })
    snap = transition(attachedSessionMachine, snap, { type: 'REFRESH_FINISHED' })[0]
    expect(snap.context).toEqual({ refreshInFlight: false, refreshPending: false })

    // Disconnecting blocks publishing and clears refresh flags
    snap = transition(attachedSessionMachine, snap, { type: 'REFRESH_REQUESTED' })[0]
    snap = transition(attachedSessionMachine, snap, { type: 'DISCONNECT' })[0]
    expect(isAttachedConnected(snap)).toBe(false)
    expect(canAttachedPublish(snap)).toBe(false)
    expect(canAttachedReceiveEvents(snap)).toBe(false)
    expect(snap.context).toEqual({ refreshInFlight: false, refreshPending: false })

    // REPLAY after DISCONNECT is a no-op
    snap = transition(attachedSessionMachine, snap, { type: 'REPLAY' })[0]
    expect(canAttachedPublish(snap)).toBe(false)

    snap = transition(attachedSessionMachine, snap, { type: 'DISPOSE' })[0]
    expect(isAttachedDisposed(snap)).toBe(true)
  })
})
