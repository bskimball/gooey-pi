import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { HarnessId } from '../../src/types/api'

export type WorkspaceUseOwner =
  | { kind: 'agent'; harness: HarnessId; runtimeId: string }
  | { kind: 'terminal'; terminalId: string }

export interface WorkspaceUseLease {
  release(): void
}

function describeOwners(owners: readonly WorkspaceUseOwner[]): string {
  const terminals = owners.filter((owner) => owner.kind === 'terminal')
  const agents = owners.filter((owner) => owner.kind === 'agent')
  const details: string[] = []
  if (terminals.length) details.push(`${terminals.length} terminal${terminals.length === 1 ? '' : 's'}`)
  if (agents.length) {
    const harnesses = [...new Set(agents.map((owner) => owner.harness))]
    details.push(`${agents.length} agent${agents.length === 1 ? '' : 's'} (${harnesses.join(', ')})`)
  }
  return details.join(' and ')
}

export class RepositoryUseError extends Error {
  readonly code = 'active-work'

  constructor(readonly owners: readonly WorkspaceUseOwner[], operation = 'Branch checkout') {
    const hasTerminal = owners.some((owner) => owner.kind === 'terminal')
    const hasAgent = owners.some((owner) => owner.kind === 'agent')
    const hint = hasTerminal && hasAgent
      ? 'Close the terminal or wait for the agent to finish.'
      : hasTerminal
        ? 'Close the terminal.'
        : 'Wait for the agent to finish.'
    super(`${operation} is unavailable while ${describeOwners(owners)} ${owners.length === 1 ? 'is' : 'are'} using this folder. ${hint}`)
    this.name = 'RepositoryUseError'
  }
}

interface WorkspaceUse {
  path: string
  owner: WorkspaceUseOwner
  retireIfIdle?: () => Promise<boolean>
}

function canonical(path: string): string {
  let result: string
  try { result = realpathSync(path) } catch { result = resolve(path) }
  return process.platform === 'win32' ? result.toLowerCase() : result
}

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}
function overlaps(a: string, b: string): boolean { return contains(a, b) || contains(b, a) }

export class RepositoryUseGate {
  private readonly workspaceUses = new Set<WorkspaceUse>()
  private readonly activeCheckouts = new Set<string>()
  private changed: Promise<void> = Promise.resolve()
  private signalChanged: () => void = () => undefined
  private readonly admissions = new Map<string, Promise<void>>()

  constructor() {
    this.resetChangedSignal()
  }

  async beginWorkspaceUse(
    pathValue: string,
    owner: WorkspaceUseOwner,
    retireIfIdle?: () => Promise<boolean>,
  ): Promise<WorkspaceUseLease> {
    const path = canonical(pathValue)
    while ([...this.activeCheckouts].some((root) => overlaps(root, path))) await this.changed
    const use = { path, owner, retireIfIdle }
    this.workspaceUses.add(use)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.workspaceUses.delete(use)
        this.notifyChanged()
      },
    }
  }

  async runBranchCheckout<T>(rootValue: string, action: () => Promise<T>): Promise<T> {
    const root = canonical(rootValue)
    let releaseAdmission!: () => void
    const previousAdmission = this.admissions.get(root) ?? Promise.resolve()
    const admission = new Promise<void>((release) => { releaseAdmission = release })
    this.admissions.set(root, admission)
    await previousAdmission
    try {
      while ([...this.activeCheckouts].some((active) => overlaps(active, root))) await this.changed
      this.activeCheckouts.add(root)
      try {
        const owners: WorkspaceUseOwner[] = []
        for (const use of [...this.workspaceUses].filter((candidate) => contains(root, candidate.path))) {
          if (!use.retireIfIdle || !await use.retireIfIdle()) owners.push(use.owner)
        }
        if (owners.length) throw new RepositoryUseError(owners)
        return await action()
      } finally {
        this.activeCheckouts.delete(root)
        this.notifyChanged()
      }
    } finally {
      releaseAdmission()
      if (this.admissions.get(root) === admission) this.admissions.delete(root)
    }
  }

  /** Reserve a checkout against new local users while allowing only its owning runtime. */
  async runExclusiveWorktree<T>(rootValue: string, runtimeId: string, action: () => Promise<T>): Promise<T> {
    const root = canonical(rootValue)
    while ([...this.activeCheckouts].some((active) => overlaps(active, root))) await this.changed
    this.activeCheckouts.add(root)
    try {
      if (!this.hasRuntime(root, runtimeId)) throw new Error('The owning runtime is not registered for this worktree')
      const conflicts = this.overlappingOwners(root, runtimeId)
      if (conflicts.length) throw new RepositoryUseError(conflicts, 'Checkpoint restore')
      return await action()
    } finally {
      this.activeCheckouts.delete(root)
      this.notifyChanged()
    }
  }

  hasRuntime(rootValue: string, runtimeId: string): boolean {
    const root = canonical(rootValue)
    return [...this.workspaceUses].some((use) => overlaps(root, use.path) && use.owner.kind === 'agent' && use.owner.runtimeId === runtimeId)
  }

  overlappingOwners(rootValue: string, runtimeId: string): WorkspaceUseOwner[] {
    const root = canonical(rootValue)
    return [...this.workspaceUses]
      .filter((use) => overlaps(root, use.path) && !(use.owner.kind === 'agent' && use.owner.runtimeId === runtimeId))
      .map((use) => use.owner)
  }

  private resetChangedSignal(): void {
    this.changed = new Promise<void>((resolveChanged) => { this.signalChanged = resolveChanged })
  }

  private notifyChanged(): void {
    this.signalChanged()
    this.resetChangedSignal()
  }
}
