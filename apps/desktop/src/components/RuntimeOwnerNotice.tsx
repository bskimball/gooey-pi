import { useEffect, useState } from 'react'
import type { ApexApi, RuntimeOwnerView } from '@/types/api'
import { Laptop } from './icons'

const POLL_MS = 10_000
const NO_OWNERS: ReadonlyMap<string, RuntimeOwnerView> = new Map()

function indexOwners(owners: readonly RuntimeOwnerView[]): Map<string, RuntimeOwnerView> {
  const bySession = new Map<string, RuntimeOwnerView>()
  for (const owner of owners) for (const session of owner.sessions) if (!bySession.has(session)) bySession.set(session, owner)
  return bySession
}

const ownershipKey = (owners: ReadonlyMap<string, RuntimeOwnerView>) => [...owners].map(([session, owner]) => `${session}\0${owner.label}`).sort().join('\n')

/**
 * Sessions held by other live Apex apps (VS Code windows or another desktop
 * instance), keyed by session file path. Refreshed on window focus and every
 * few seconds; the map keeps its identity while ownership is unchanged.
 */
export function useRuntimeOwners(bridge: ApexApi | null, activeSessionPath?: string): { owners: ReadonlyMap<string, RuntimeOwnerView>; activeOwner?: RuntimeOwnerView } {
  const [owners, setOwners] = useState(NO_OWNERS)
  useEffect(() => {
    const read = bridge?.sessions.runtimeOwners
    if (!read) return
    let current = true
    const refresh = () => {
      void read().then((list) => {
        if (!current) return
        const next = indexOwners(list)
        setOwners((previous) => ownershipKey(previous) === ownershipKey(next) ? previous : next)
      }).catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [bridge])
  return { owners, activeOwner: activeSessionPath ? owners.get(activeSessionPath) : undefined }
}

/** Shown above the composer while another Apex app's Pi runtime holds the active session. */
export function RuntimeOwnerNotice({ owner }: { owner: RuntimeOwnerView }) {
  const handOff = owner.app === 'vscode'
    ? 'To continue here, run “Apex: Continue in Apex Desktop” in that VS Code window.'
    : 'Stop its run or close it in that window to continue here.'
  return (
    <div className="runtime-owner-notice" role="status">
      <Laptop size={14} aria-hidden="true" />
      <span><strong>Open in {owner.label}.</strong> {handOff}</span>
    </div>
  )
}
