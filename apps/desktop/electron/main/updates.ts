import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { createActor, type ActorRefFrom } from 'xstate'
import type { AppUpdateState } from '../../src/types/api'
import { updateMachine } from './updateMachine'

export const DEFAULT_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000
const INITIAL_CHECK_DELAY_MS = 8_000

export interface UpdateAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update', listener: () => void): this
  on(event: 'update-available' | 'update-not-available' | 'update-downloaded', listener: (info: UpdateInfo) => void): this
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateServiceOptions {
  enabled: boolean
  checkIntervalMs?: number
  initialCheckDelayMs?: number
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
  setTimeout?: typeof globalThis.setTimeout
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 240) || 'Update check failed'
}

export interface ManualUpdateNotification {
  type: 'info' | 'error'
  message: string
  detail?: string
}

export function manualUpdateNotification(state: AppUpdateState): ManualUpdateNotification {
  if (state.phase === 'error') return {
    type: 'error',
    message: 'Apex Update Check Failed',
    detail: state.message,
  }
  if (state.phase === 'unsupported') return {
    type: 'info',
    message: 'Apex Updates Unavailable',
    detail: state.message ?? 'Automatic updates are available in installed builds.',
  }
  const available = state.phase === 'available' || state.phase === 'downloading' || state.phase === 'downloaded'
  return {
    type: 'info',
    message: available ? 'Apex Update Available' : 'No Apex Update Available',
  }
}

/** Coalesces manual "Check for Updates…" clicks so concurrent clicks cannot queue dialogs. */
export function createManualUpdateCheck(
  check: () => Promise<AppUpdateState>,
  notify: (notification: ManualUpdateNotification) => void | Promise<void>,
): () => void {
  let inFlight = false
  return () => {
    if (inFlight) return
    inFlight = true
    void check()
      .then((state) => notify(manualUpdateNotification(state)))
      .catch((error) => notify({ type: 'error', message: 'Apex Update Check Failed', detail: errorMessage(error) }))
      .finally(() => { inFlight = false })
  }
}

export function getAutoUpdater(): AppUpdater {
  // electron-updater is CommonJS; accessing through its default export keeps
  // the bundled Electron ESM output compatible with both Node module modes.
  return electronUpdater.autoUpdater
}

export class UpdateService {
  private readonly actor: ActorRefFrom<typeof updateMachine>
  private publishedState: AppUpdateState
  private sink: ((state: AppUpdateState) => void) | null = null
  private interval: ReturnType<typeof globalThis.setInterval> | null = null
  private initialTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private readonly setIntervalFn: typeof globalThis.setInterval
  private readonly clearIntervalFn: typeof globalThis.clearInterval
  private readonly setTimeoutFn: typeof globalThis.setTimeout

  constructor(updater: UpdateAdapter, private readonly options: UpdateServiceOptions) {
    this.publishedState = options.enabled ? { phase: 'idle' } : { phase: 'unsupported', message: 'Automatic updates are available in installed builds.' }
    this.setIntervalFn = options.setInterval ?? globalThis.setInterval
    this.clearIntervalFn = options.clearInterval ?? globalThis.clearInterval
    this.setTimeoutFn = options.setTimeout ?? globalThis.setTimeout
    this.actor = createActor(updateMachine, { input: {
      enabled: options.enabled,
      updater,
      publish: (state) => {
        this.publishedState = state
        this.sink?.(this.getState())
      },
      stopScheduledChecks: () => this.stopScheduledChecks(),
    } }).start()
    if (!options.enabled) return

    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.on('checking-for-update', () => this.actor.send({ type: 'CHECKING' }))
    updater.on('update-available', (info) => this.actor.send({ type: 'AVAILABLE', version: info.version }))
    updater.on('download-progress', (progress) => this.actor.send({ type: 'PROGRESS', percent: progress.percent }))
    updater.on('update-downloaded', (info) => this.actor.send({ type: 'DOWNLOADED', version: info.version }))
    updater.on('update-not-available', (info) => this.actor.send({ type: 'NOT_AVAILABLE', version: info.version }))
    updater.on('error', (error) => this.actor.send({ type: 'ERROR', error }))
  }

  start(): void {
    if (!this.options.enabled || this.interval || this.initialTimer) return
    this.initialTimer = this.setTimeoutFn(() => {
      this.initialTimer = null
      this.runScheduledCheck()
    }, this.options.initialCheckDelayMs ?? INITIAL_CHECK_DELAY_MS)
    this.initialTimer.unref?.()
    this.interval = this.setIntervalFn(() => { this.runScheduledCheck() }, this.options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS)
    this.interval.unref?.()
  }

  isEnabled(): boolean {
    return this.options.enabled
  }

  dispose(): void {
    this.stopScheduledChecks()
    this.sink = null
  }

  getState(): AppUpdateState {
    return structuredClone(this.publishedState)
  }

  setEventSink(sink: ((state: AppUpdateState) => void) | null): void {
    this.sink = sink
  }

  check(): Promise<AppUpdateState> {
    let resolve!: (value: AppUpdateState | PromiseLike<AppUpdateState>) => void
    let result = new Promise<AppUpdateState>((done) => { resolve = done })
    this.actor.send({ type: 'CHECK', reply: (promise) => { result = promise; resolve(promise) } })
    return result
  }

  downloadAndInstall(): Promise<boolean> {
    let resolve!: (value: boolean | PromiseLike<boolean>) => void
    let result = new Promise<boolean>((done) => { resolve = done })
    this.actor.send({ type: 'DOWNLOAD', reply: (promise) => { result = promise; resolve(promise) } })
    return result
  }

  private runScheduledCheck(): void {
    if (this.publishedState.phase === 'downloaded') {
      this.stopScheduledChecks()
      return
    }
    void this.check()
  }

  private stopScheduledChecks(): void {
    if (this.interval) this.clearIntervalFn(this.interval)
    if (this.initialTimer) clearTimeout(this.initialTimer)
    this.interval = null
    this.initialTimer = null
  }
}
