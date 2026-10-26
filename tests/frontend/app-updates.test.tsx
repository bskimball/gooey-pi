// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppUpdates } from '../../apps/desktop/src/hooks/useAppUpdates'
import type { AppUpdateState, PrimeWorkApi } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const reportError = vi.fn()

function Probe({ bridge, onAct, onCheck }: { bridge: PrimeWorkApi; onAct(act: () => Promise<void>): void; onCheck?(check: () => Promise<void>): void }) {
  const updates = useAppUpdates(bridge, reportError)
  onAct(updates.act)
  onCheck?.(updates.check)
  return <span data-phase={updates.state.phase}>{updates.state.version ?? ''}</span>
}

describe('useAppUpdates', () => {
  it.each(['available', 'downloaded'] as const)('never installs an %s update from an explicit check', async (phase) => {
    const bridge = {
      updates: {
        getState: vi.fn(async (): Promise<AppUpdateState> => ({ phase, version: '1.2.0' })),
        check: vi.fn(async (): Promise<AppUpdateState> => ({ phase, version: '1.2.0' })),
        downloadAndInstall: vi.fn(async () => true),
        onChanged: () => () => undefined,
      },
    } as unknown as PrimeWorkApi
    let check!: () => Promise<void>
    await act(async () => { root.render(<Probe bridge={bridge} onAct={() => undefined} onCheck={(next) => { check = next }} />) })
    await act(async () => { await check() })
    expect(bridge.updates.check).toHaveBeenCalledOnce()
    expect(bridge.updates.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('reports explicit check failures without rejecting into the UI', async () => {
    const failure = new Error('Network unavailable')
    const bridge = {
      updates: {
        getState: async (): Promise<AppUpdateState> => ({ phase: 'idle' }),
        check: vi.fn(async () => { throw failure }),
        onChanged: () => () => undefined,
      },
    } as unknown as PrimeWorkApi
    let check!: () => Promise<void>
    await act(async () => { root.render(<Probe bridge={bridge} onAct={() => undefined} onCheck={(next) => { check = next }} />) })
    await act(async () => { await expect(check()).resolves.toBeUndefined() })
    expect(reportError).toHaveBeenCalledWith(failure)
  })

  it('lets the main-process subscription be the only writer for pushed state', async () => {
    let push!: (state: AppUpdateState) => void
    let finishCheck!: (state: AppUpdateState) => void
    const bridge = {
      updates: {
        getState: vi.fn(async (): Promise<AppUpdateState> => ({ phase: 'idle' })),
        check: vi.fn(() => new Promise<AppUpdateState>((resolve) => { finishCheck = resolve })),
        downloadAndInstall: vi.fn(async () => true),
        onChanged: (callback: (state: AppUpdateState) => void) => { push = callback; return () => undefined },
      },
    } as unknown as PrimeWorkApi
    let action!: () => Promise<void>

    await act(async () => { root.render(<Probe bridge={bridge} onAct={(next) => { action = next }} />) })
    expect(container.firstElementChild?.getAttribute('data-phase')).toBe('idle')

    const pending = action()
    // A stale check response must not overwrite the newer pushed state.
    await act(async () => { push({ phase: 'available', version: '0.2.0' }) })
    finishCheck({ phase: 'checking' })
    await act(async () => { await pending })

    expect(container.firstElementChild?.getAttribute('data-phase')).toBe('available')
    expect(container.firstElementChild?.textContent).toBe('0.2.0')
  })
})
