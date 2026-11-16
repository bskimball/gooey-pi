// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useCoordinatorRuntime } from '../../apps/desktop/src/hooks/useCoordinatorRuntime'
import type { ApexApi } from '../../apps/desktop/src/types/api'
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('sends current Space context and refuses a send after switching scope', async () => {
  let release: (value: unknown) => void = () => {}
  const list = vi
    .fn()
    .mockResolvedValueOnce([{ id: 'a', name: 'A', objective: 'Updated objective' }])
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
  const command = vi.fn().mockResolvedValue({ success: true })
  const bridge = {
    spaces: { list },
    agent: { onEvent: () => () => {}, command },
    coordinator: {
      open: vi.fn(async (id) => ({ attachmentId: id, eventSequence: 0, session: { id }, runtime: { runtimeId: id }, messages: [], pendingDialogs: [] })),
      close: vi.fn().mockResolvedValue(true),
    },
  } as unknown as ApexApi
  let runtime: ReturnType<typeof useCoordinatorRuntime>
  function Harness({ id }: { id: string }) {
    runtime = useCoordinatorRuntime(bridge, undefined, id)
    return <div>{runtime.state.phase}</div>
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Harness id="a" />))
    await act(async () => runtime.send('Proceed', []))
    expect(command.mock.calls[0][1].message).toContain('Updated objective')
    let pending: Promise<void>
    await act(async () => {
      pending = runtime.send('Later', [])
      await Promise.resolve()
    })
    await act(async () => root.render(<Harness id="b" />))
    await act(async () => {
      release([{ id: 'a', name: 'A', objective: 'old' }])
      await expect(pending!).rejects.toThrow('Space changed')
    })
    expect(command).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
  }
})

it('reuses the open coordinator when Activity remounts and closes it after the warm window', async () => {
  vi.useFakeTimers()
  const open = vi.fn(async () => ({ attachmentId: 'warm', eventSequence: 0, session: { id: 'warm' }, runtime: { runtimeId: 'warm' }, messages: [], pendingDialogs: [] }))
  const close = vi.fn().mockResolvedValue(true)
  const bridge = { agent: { onEvent: () => () => {} }, coordinator: { open, close } } as unknown as ApexApi
  function Harness() {
    return <div>{useCoordinatorRuntime(bridge, undefined, 'warm-space').state.phase}</div>
  }
  const container = document.createElement('div')
  try {
    const first = createRoot(container)
    await act(async () => first.render(<Harness />))
    expect(container.textContent).toBe('ready')
    act(() => first.unmount())
    const second = createRoot(container)
    act(() => second.render(<Harness />))
    expect(container.textContent).toBe('ready')
    expect(open).toHaveBeenCalledTimes(1)
    act(() => second.unmount())
    vi.advanceTimersByTime(10 * 60_000 - 1)
    expect(close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(close).toHaveBeenCalledWith('warm')
  } finally {
    vi.useRealTimers()
  }
})
