import { useEffect, useState } from 'react'
import type { HarnessId, ProjectFileEntry } from '@/types/api'

const FRESH_FOR_MS = 15_000
const cache = new Map<string, { entries: ProjectFileEntry[]; loadedAt: number }>()

/**
 * Lists project files for `@` completion. Loads only while `active` is true and
 * reuses a recent listing so typing does not rescan the tree.
 */
export function useProjectFileIndex(root: string | undefined, harness: HarnessId, active: boolean): ProjectFileEntry[] | undefined {
  const key = root ? `${harness}:${root}` : undefined
  const [entries, setEntries] = useState(() => (key ? cache.get(key)?.entries : undefined))

  useEffect(() => {
    if (!key || !root) { setEntries(undefined); return }
    const cached = cache.get(key)
    setEntries(cached?.entries)
    const listFiles = typeof window === 'undefined' ? undefined : window.prime?.projects.listFiles
    if (!active || !listFiles || (cached && Date.now() - cached.loadedAt < FRESH_FOR_MS)) return
    let current = true
    listFiles(root, harness).then((listing) => {
      cache.set(key, { entries: listing.entries, loadedAt: Date.now() })
      if (current) setEntries(listing.entries)
    }).catch(() => undefined)
    return () => { current = false }
  }, [active, harness, key, root])

  return entries
}
