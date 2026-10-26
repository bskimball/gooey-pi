// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AboutSettings, updateStatusCopy } from '../../apps/desktop/src/pages/settings/AboutSettings'
import type { AppMeta } from '../../apps/desktop/src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const meta: AppMeta = {
  version: '1.1.11',
  platform: 'darwin',
  homeDir: '/Users/you',
  harnesses: {
    pi: { path: null, version: null },
  },
}

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
})

describe('About settings updates', () => {
  it('checks for updates from the About page', async () => {
    const onCheckForUpdates = vi.fn(async () => undefined)
    await act(async () => {
      root.render(<AboutSettings meta={meta} updateState={{ phase: 'idle' }} onCheckForUpdates={onCheckForUpdates} onOpenDocs={vi.fn()} />)
    })

    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Check for updates'))
    expect(button).toBeDefined()
    await act(async () => { button?.click(); await Promise.resolve() })
    expect(onCheckForUpdates).toHaveBeenCalledOnce()
  })

  it('shows update progress and disables duplicate checks while checking', async () => {
    await act(async () => {
      root.render(<AboutSettings meta={meta} updateState={{ phase: 'checking' }} onCheckForUpdates={vi.fn()} onOpenDocs={vi.fn()} />)
    })

    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Checking')) as HTMLButtonElement | undefined
    expect(button?.disabled).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Checking GitHub Releases…')
  })

  it.each(['unsupported', 'downloading'] as const)('disables checks while %s', async (phase) => {
    const onCheckForUpdates = vi.fn(async () => undefined)
    await act(async () => {
      root.render(<AboutSettings meta={meta} updateState={{ phase }} onCheckForUpdates={onCheckForUpdates} onOpenDocs={vi.fn()} />)
    })
    const button = container.querySelector<HTMLButtonElement>('.settings-row button')
    expect(button?.disabled).toBe(true)
    await act(async () => { button?.click() })
    expect(onCheckForUpdates).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')?.textContent).toBeTruthy()
  })

  it('describes progress and failure states', () => {
    expect(updateStatusCopy({ phase: 'downloading', version: '1.2.0', percent: 42 }, '1.1.11')).toContain('42%')
    expect(updateStatusCopy({ phase: 'downloading', version: '1.2.0' }, '1.1.11')).toContain('Downloading Apex 1.2.0')
    expect(updateStatusCopy({ phase: 'downloaded', version: '1.2.0' }, '1.1.11')).toContain('ready to install')
    expect(updateStatusCopy({ phase: 'error', message: 'Network unavailable' }, '1.1.11')).toBe('Network unavailable')
    expect(updateStatusCopy({ phase: 'error' }, '1.1.11')).toBe('The update check failed.')
    expect(updateStatusCopy({ phase: 'unsupported', message: 'Source build' }, '1.1.11')).toBe('Source build')
  })

  it('describes available and current versions', () => {
    expect(updateStatusCopy({ phase: 'available', version: '1.2.0' }, '1.1.11')).toBe('Apex 1.2.0 is available.')
    expect(updateStatusCopy({ phase: 'not-available' }, '1.1.11')).toBe('Apex 1.1.11 is up to date.')
  })
})
