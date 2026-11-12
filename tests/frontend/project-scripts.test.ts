import { describe, expect, it } from 'vitest'
import { initialTransition, transition } from 'xstate'
import { activeProjectScriptKind, ProjectScriptBusyError, setupNeedsRun } from '../../apps/desktop/src/lib/project-scripts'
import { isProjectScriptBusy, projectScriptFinishEvent, projectScriptMachine, type ProjectScriptEvent, type ProjectScriptRun } from '../../apps/desktop/src/components/projectScriptMachine'

describe('project script helpers', () => {
  it('only exposes the active run kind for the selected project', () => {
    const run = { projectId: 'project-a', kind: 'run' as const }
    expect(activeProjectScriptKind(run, 'project-a')).toBe('run')
    expect(activeProjectScriptKind(run, 'project-b')).toBeUndefined()
    expect(activeProjectScriptKind(run)).toBeUndefined()
  })

  it.each([
    [undefined, false],
    [{ setup: '', run: '' }, false],
    [{ setup: 'npm install', run: 'npm run dev' }, true],
    [{ setup: 'npm install', run: 'npm run dev', setupLastRun: 'npm ci', setupLastExitCode: 0 }, true],
    [{ setup: 'npm install', run: 'npm run dev', setupLastRun: 'npm install' }, false],
    [{ setup: 'x', run: '', setupLastRun: 'x' }, false],
    [{ setup: 'x', run: '', setupLastRun: 'y' }, true],
    [{ setup: 'npm install', run: 'npm run dev', setupLastRun: 'npm install', setupLastExitCode: 0 }, false],
  ])('reports whether setup needs to run for %j', (scripts, expected) => {
    expect(setupNeedsRun(scripts)).toBe(expected)
  })

  it('exposes a typed busy error', () => {
    const error = new ProjectScriptBusyError()
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('already starting or running')
  })
})

describe('project script lifecycle machine', () => {
  const run = (kind: ProjectScriptRun['kind']): ProjectScriptRun => ({ requestId: 'r1', projectId: 'project-a', harness: 'pi', kind, command: 'npm run dev', ownsDrawer: true })
  const fold = (events: ProjectScriptEvent[]) => events.reduce((snapshot, event) => transition(projectScriptMachine, snapshot, event)[0], initialTransition(projectScriptMachine)[0])

  it('records a setup terminal start failure as setupFailed with its error, and clears it on the next request', () => {
    const failed = fold([{ type: 'REQUEST' }, { type: 'START', run: run('setup') }, { type: 'TAB_STARTED', tabId: 't1' }, projectScriptFinishEvent({ error: 'spawn failed' })])
    expect(failed.matches('setupFailed')).toBe(true)
    expect(failed.context.setupFailure).toEqual({ projectId: 'project-a', error: 'spawn failed' })
    expect(failed.context.run).toBeUndefined()
    const retried = transition(projectScriptMachine, failed, { type: 'REQUEST' })[0]
    expect(retried.matches('starting')).toBe(true)
    expect(retried.context.setupFailure).toBeUndefined()
  })

  it('treats a run terminal start failure as idle, and cancellation as idle without an exit code', () => {
    expect(fold([{ type: 'REQUEST' }, { type: 'START', run: run('run') }, projectScriptFinishEvent({ error: 'spawn failed' })]).matches('idle')).toBe(true)
    expect(fold([{ type: 'REQUEST' }, { type: 'START', run: run('setup') }, projectScriptFinishEvent({ cancelled: true })]).matches('idle')).toBe(true)
  })

  it('records a real exit code and ignores events once the run has finished', () => {
    const exited = fold([{ type: 'REQUEST' }, { type: 'START', run: run('run') }, projectScriptFinishEvent({ exitCode: 3 })])
    expect(exited.matches('exited')).toBe(true)
    expect(exited.context.exitCode).toBe(3)
    expect(isProjectScriptBusy(exited)).toBe(false)
    expect(transition(projectScriptMachine, exited, { type: 'CANCEL' })[0].matches('exited')).toBe(true)
  })

  it('reports starting as busy until the run starts or the request is aborted', () => {
    const starting = fold([{ type: 'REQUEST' }])
    expect(isProjectScriptBusy(starting)).toBe(true)
    expect(isProjectScriptBusy(transition(projectScriptMachine, starting, { type: 'ABORT' })[0])).toBe(false)
  })
})
