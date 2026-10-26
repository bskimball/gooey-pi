import { describe, expect, it, vi } from 'vitest'
import { ScheduledRunExecutor } from '../../apps/desktop/electron/main/schedules/executor'
import { ScheduleBlockedError } from '../../apps/desktop/electron/main/schedules/service'
import type { AutomationScheduleRecord, HarnessId } from '../../apps/desktop/src/types/api'

function task(harness: HarnessId, prompt: string): AutomationScheduleRecord {
  return {
    schemaVersion: 1,
    id: `task-${harness}`,
    harness,
    revision: 1,
    title: 'MCP policy probe',
    prompt,
    target: { kind: 'project', projectId: `project-${harness}` },
    timing: { kind: 'once', at: '2026-08-15T22:00:00.000Z' },
    execution: { model: 'auto', thinking: 'auto', speed: 'normal' },
    status: 'active',
    createdBy: 'user',
    createdAt: '2026-08-15T21:00:00.000Z',
    updatedAt: '2026-08-15T21:00:00.000Z',
    runs: [],
  }
}

function fixture() {
  const projects = { list: vi.fn().mockResolvedValue([{ id: 'project-pi', path: '/project', primaryFolder: '/project', folders: ['/project'] }]), authorizeCwd: vi.fn(async (cwd: string) => cwd) }
  const sessions = { harness: 'pi', list: vi.fn().mockResolvedValue([{ id: 'session', filePath: '/session.jsonl', projectPath: '/project' }]), requireSessionPath: vi.fn(async (path: string) => path) }
  const runtime = { runtimeId: 'runtime', serviceTier: 'priority', thinkingLevel: 'high' }
  const agents = {
    startUnattended: vi.fn().mockResolvedValue(runtime), command: vi.fn().mockResolvedValue(undefined),
    runPromptToCompletion: vi.fn().mockResolvedValue({ sessionId: 'session', sessionFile: '/session.jsonl' }),
    stop: vi.fn().mockResolvedValue(undefined), getForSession: vi.fn(), list: vi.fn().mockReturnValue([]),
  }
  const providers = { requireAvailableModel: vi.fn().mockResolvedValue({ name: 'Model', availableThinkingLevels: ['high'], fastModeSupported: true }) }
  const executor = new ScheduledRunExecutor(projects as never, sessions as never, agents as never, providers as never, () => new Set())
  return { projects, sessions, agents, providers, executor }
}

describe('ScheduledRunExecutor execution', () => {
  it('starts a new unattended thread, names it and stops it after completion', async () => {
    const { executor, agents } = fixture()
    const scheduled = task('pi', 'Summarize changes')
    scheduled.execution = { model: 'provider/model', thinking: 'high', speed: 'fast' }
    await expect(executor.run(scheduled)).resolves.toEqual({ sessionId: 'session', sessionFile: '/session.jsonl' })
    expect(agents.startUnattended).toHaveBeenCalledWith({ cwd: '/project', model: 'provider/model', thinking: 'high', fast: true })
    expect(agents.command).toHaveBeenCalledWith('runtime', { type: 'set_session_name', name: expect.stringContaining(scheduled.title) })
    expect(agents.runPromptToCompletion).toHaveBeenCalledWith('runtime', scheduled.prompt)
    expect(agents.stop).toHaveBeenCalledWith('runtime')
  })

  it('continues if naming fails, but propagates prompt errors and still stops', async () => {
    const { executor, agents } = fixture()
    agents.command.mockRejectedValue(new Error('name unavailable'))
    agents.runPromptToCompletion.mockRejectedValue('prompt failed')
    await expect(executor.run(task('pi', 'Work'))).rejects.toThrow('prompt failed')
    expect(agents.stop).toHaveBeenCalledOnce()
  })

  it('resumes an existing thread after stopping its idle runtime', async () => {
    const { executor, agents } = fixture()
    const scheduled = task('pi', 'Work')
    scheduled.target = { kind: 'session', projectId: 'project-pi', sessionId: 'session' }
    agents.getForSession.mockReturnValue({ runtimeId: 'old' })
    agents.list.mockReturnValue([{ runtimeId: 'old', isStreaming: false, isCompacting: false }])
    await expect(executor.run(scheduled)).resolves.toMatchObject({ sessionId: 'session' })
    expect(agents.stop.mock.calls).toEqual([['old'], ['runtime']])
    expect(agents.startUnattended).toHaveBeenCalledWith(expect.objectContaining({ sessionPath: '/session.jsonl' }))
    expect(agents.command).not.toHaveBeenCalled()
  })

  it('serializes concurrent runs in the same thread and releases the lock after failure', async () => {
    const { executor, agents } = fixture()
    const scheduled = task('pi', 'Work')
    scheduled.target = { kind: 'session', projectId: 'project-pi', sessionId: 'session' }
    let rejectFirst!: (error: Error) => void
    agents.runPromptToCompletion.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject }))
    const first = executor.run(scheduled)
    const rejection = expect(first).rejects.toThrow('failed')
    await vi.waitFor(() => expect(agents.runPromptToCompletion).toHaveBeenCalledOnce())
    const second = executor.run(scheduled)
    expect(agents.startUnattended).toHaveBeenCalledOnce()
    rejectFirst(new Error('failed'))
    await rejection
    await expect(second).resolves.toMatchObject({ sessionId: 'session' })
    expect(agents.startUnattended).toHaveBeenCalledTimes(2)
  })

  it.each(['lease held', 'unexpected failure'])('classifies resumed-thread failure: %s', async (message) => {
    const { executor, agents } = fixture()
    const scheduled = task('pi', 'Work')
    scheduled.target = { kind: 'session', projectId: 'project-pi', sessionId: 'session' }
    agents.startUnattended.mockRejectedValue(new Error(message))
    await expect(executor.run(scheduled)).rejects.toThrow(message === 'lease held' ? 'The thread is active in another client' : message)
    expect(agents.stop).not.toHaveBeenCalled()
  })

  it('rejects unsupported model settings and runtime settings that were not applied', async () => {
    const { executor, agents } = fixture()
    await expect(executor.validateExecution({ model: 'model', thinking: 'low', speed: 'normal' })).rejects.toThrow('does not support low reasoning')
    const scheduled = task('pi', 'Work')
    scheduled.execution.speed = 'fast'
    agents.startUnattended.mockResolvedValue({ runtimeId: 'runtime', serviceTier: 'standard', thinkingLevel: 'high' })
    await expect(executor.run(scheduled)).rejects.toThrow('Fast mode is unavailable')
    expect(agents.stop).toHaveBeenCalledWith('runtime')
    scheduled.execution = { model: 'auto', thinking: 'low', speed: 'normal' }
    await expect(executor.run(scheduled)).rejects.toThrow('could not be applied')
    expect(agents.runPromptToCompletion).not.toHaveBeenCalled()
  })

  it('blocks missing, inferred, archived and moved targets before starting', async () => {
    const { executor, projects, sessions, agents } = fixture()
    const target = { kind: 'session', projectId: 'project-pi', sessionId: 'session' } as const
    projects.list.mockResolvedValueOnce([])
    await expect(executor.validateTarget(target)).rejects.toThrow('project is no longer available')
    projects.list.mockResolvedValueOnce([{ id: 'project-pi', inferred: true }] as never)
    await expect(executor.validateTarget(target)).rejects.toThrow('Grant this inferred project')
    sessions.list.mockResolvedValueOnce([])
    await expect(executor.validateTarget(target)).rejects.toThrow('thread is no longer available')
    sessions.list.mockResolvedValueOnce([{ id: 'session', archived: true }] as never)
    await expect(executor.validateTarget(target)).rejects.toThrow('Restore the archived thread')
    sessions.list.mockResolvedValueOnce([{ id: 'session', projectPath: '/elsewhere' }] as never)
    await expect(executor.validateTarget(target)).rejects.toThrow('no longer belongs')
    expect(agents.startUnattended).not.toHaveBeenCalled()
  })
})

describe('ScheduledRunExecutor MCP auth policy', () => {
  it.each([
    ['pi', '/mcp-auth files'],
  ] as const)('rejects a persisted %s auth task before project lookup or runtime start', async (harness, prompt) => {
    const projects = { list: vi.fn(), authorizeCwd: vi.fn() }
    const sessions = { harness, list: vi.fn(), requireSessionPath: vi.fn() }
    const agents = { startUnattended: vi.fn() }
    const providers = { requireAvailableModel: vi.fn() }
    const executor = new ScheduledRunExecutor(projects as never, sessions as never, agents as never, providers as never, () => new Set())

    const result = executor.run(task(harness, prompt))
    await expect(result).rejects.toBeInstanceOf(ScheduleBlockedError)
    await expect(result).rejects.toThrow('Network MCP authentication is managed outside Apex')
    expect(projects.list).not.toHaveBeenCalled()
    expect(agents.startUnattended).not.toHaveBeenCalled()
  })
})
