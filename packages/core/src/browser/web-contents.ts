import type { EventEmitter } from 'node:events'

export interface NativeImageLike {
  toJPEG(quality: number): Buffer
  toPNG(): Buffer
  getSize(): { width: number; height: number }
  resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): NativeImageLike
}

/** Only the guest operations used by the shared browser adapter. */
export interface WebContentsLike extends EventEmitter {
  id: number
  isDestroyed(): boolean
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  canGoBack(): boolean
  canGoForward(): boolean
  focus(): void
  loadURL(url: string): Promise<void>
  goBack(): void
  goForward(): void
  reload(): void
  executeJavaScript(script: string): Promise<unknown>
  insertText(text: string): Promise<void>
  capturePage(): Promise<NativeImageLike>
  debugger: {
    isAttached(): boolean
    attach(version?: string): void
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
  }
}
