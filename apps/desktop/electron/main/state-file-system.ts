import { open, rename, unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { isRecord } from 'apex-core/validation'

export interface JsonStateStoreFileHandle {
  writeFile(data: string | Uint8Array, options: { encoding: 'utf8' }): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface JsonStateStoreFileSystem {
  open(path: string, flags: string, mode?: number): Promise<JsonStateStoreFileHandle>
  rename(oldPath: string, newPath: string): Promise<void>
  unlink(path: string): Promise<void>
}

export const nodeFileSystem: JsonStateStoreFileSystem = { open, rename, unlink }

export async function renameStateFile(fileSystem: JsonStateStoreFileSystem, oldPath: string, newPath: string, platform: NodeJS.Platform): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fileSystem.rename(oldPath, newPath)
      return
    } catch (error) {
      if (platform !== 'win32' || !isRecord(error) || error.code !== 'EPERM' || attempt >= 5) throw error
      // Windows readers can temporarily deny replacement. Retry the same rename, never the state mutation.
      await delay(10 * 2 ** attempt)
    }
  }
}
