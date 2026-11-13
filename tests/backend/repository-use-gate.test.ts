import { describe, expect, it } from 'vitest'
import { RepositoryUseGate } from '../../apps/desktop/electron/main/repository-use-gate'

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('RepositoryUseGate', () => {
  it('reserves a worktree against overlapping owners and new ancestor users', async () => {
    const gate = new RepositoryUseGate()
    const owner = { kind: 'agent' as const, harness: 'pi' as const, runtimeId: 'owner' }
    const agent = await gate.beginWorkspaceUse('/repo/worktree', owner)
    await expect(gate.runExclusiveWorktree('/repo/worktree', 'missing', async () => undefined)).rejects.toThrow('owning runtime is not registered')
    const other = await gate.beginWorkspaceUse('/repo', { kind: 'terminal', terminalId: 'other' })
    await expect(gate.runExclusiveWorktree('/repo/worktree', 'owner', async () => undefined)).rejects.toMatchObject({ code: 'active-work' })
    other.release()
    const started = deferred(); const finish = deferred()
    const exclusive = gate.runExclusiveWorktree('/repo/worktree', 'owner', async () => { started.resolve(); await finish.promise })
    await started.promise
    let admitted = false
    const waiting = gate.beginWorkspaceUse('/repo', { kind: 'terminal', terminalId: 'new' }).then((lease) => { admitted = true; return lease })
    await Promise.resolve()
    expect(admitted).toBe(false)
    finish.resolve(); await exclusive
    const lease = await waiting
    expect(admitted).toBe(true)
    lease.release(); agent.release()
  })

  it('retires an idle resident agent before branch checkout', async () => {
    const gate = new RepositoryUseGate()
    let lease!: { release(): void }
    const retireIfIdle = async (): Promise<boolean> => {
      lease.release()
      return true
    }
    lease = await gate.beginWorkspaceUse('/repo/packages/app', { kind: 'agent', harness: 'pi', runtimeId: 'runtime-1' }, retireIfIdle)

    await expect(gate.runBranchCheckout('/repo', async () => 'changed')).resolves.toBe('changed')
  })

  it('refuses a branch checkout while an agent is busy', async () => {
    const gate = new RepositoryUseGate()
    const lease = await gate.beginWorkspaceUse(
      '/repo/packages/app',
      { kind: 'agent', harness: 'pi', runtimeId: 'runtime-1' },
      async () => false,
    )

    await expect(gate.runBranchCheckout('/repo', async () => 'changed')).rejects.toMatchObject({ code: 'active-work' })
    lease.release()
  })

  it('names mixed workspace owners blocking branch checkout', async () => {
    const gate = new RepositoryUseGate()
    const terminal = await gate.beginWorkspaceUse('/repo', { kind: 'terminal', terminalId: 'terminal-1' })
    const first = await gate.beginWorkspaceUse('/repo', { kind: 'agent', harness: 'pi', runtimeId: 'first-runtime' })
    const second = await gate.beginWorkspaceUse('/repo', { kind: 'agent', harness: 'pi', runtimeId: 'second-runtime' })

    await expect(gate.runBranchCheckout('/repo', async () => 'changed')).rejects.toMatchObject({
      message: 'Branch checkout is unavailable while 1 terminal and 2 agents (pi) are using this folder. Close the terminal or wait for the agent to finish.',
    })
    terminal.release()
    first.release()
    second.release()
  })

  it('holds new workspace users until a branch checkout finishes', async () => {
    const gate = new RepositoryUseGate()
    const checkoutStarted = deferred()
    const releaseCheckout = deferred()
    const checkout = gate.runBranchCheckout('/repo', async () => {
      checkoutStarted.resolve()
      await releaseCheckout.promise
    })
    await checkoutStarted.promise

    let admitted = false
    const leasePromise = gate.beginWorkspaceUse('/repo', { kind: 'terminal', terminalId: 'terminal-1' }).then((lease) => {
      admitted = true
      return lease
    })
    await Promise.resolve()
    expect(admitted).toBe(false)

    releaseCheckout.resolve()
    await checkout
    const lease = await leasePromise
    expect(admitted).toBe(true)
    lease.release()
  })

  it('does not serialize unrelated repositories', async () => {
    const gate = new RepositoryUseGate()
    const checkoutStarted = deferred()
    const releaseCheckout = deferred()
    const checkout = gate.runBranchCheckout('/repo-a', async () => {
      checkoutStarted.resolve()
      await releaseCheckout.promise
    })
    await checkoutStarted.promise

    const lease = await gate.beginWorkspaceUse('/repo-b', { kind: 'terminal', terminalId: 'terminal-2' })
    lease.release()
    await expect(gate.runBranchCheckout('/repo-b', async () => 'other')).resolves.toBe('other')
    releaseCheckout.resolve()
    await checkout
  })
})
