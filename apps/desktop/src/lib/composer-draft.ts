export interface ComposerDraftSnapshot {
  text: string
  model?: string
  effort?: string
  fast?: boolean
}

const LEGACY_COMPOSER_DRAFT_KEY = 'prime-work.composer-draft'
const COMPOSER_DRAFT_PREFIX = 'prime-work.composer-draft.v2:'

export function composerDraftStorageKey(scope: string): string {
  return `${COMPOSER_DRAFT_PREFIX}${scope}`
}

/** Model, effort, and fast mode ride along with typed text; alone they are not a draft. */
function emptyDraft(snapshot: ComposerDraftSnapshot): boolean {
  return !snapshot.text
}

/** Snapshot the composer's current DOM value so a crash-and-reload keeps the draft. */
export function saveComposerDraftFromDom(): void {
  try {
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea:not([data-isolated-draft])')
    if (textarea?.value) window.sessionStorage.setItem(LEGACY_COMPOSER_DRAFT_KEY, textarea.value)
  } catch { /* storage unavailable */ }
}

export function saveComposerDraft(scope: string, snapshot: ComposerDraftSnapshot, isolated = false): void {
  try {
    const key = composerDraftStorageKey(scope)
    const previous = readComposerDraft(scope, isolated)
    const next: ComposerDraftSnapshot = {
      text: snapshot.text,
      model: snapshot.model || previous?.model,
      effort: snapshot.effort ?? previous?.effort,
      fast: snapshot.fast ?? previous?.fast,
    }
    if (emptyDraft(next)) {
      window.sessionStorage.removeItem(key)
      if (!isolated) window.sessionStorage.removeItem(LEGACY_COMPOSER_DRAFT_KEY)
      return
    }
    window.sessionStorage.setItem(key, JSON.stringify(next))
    if (!isolated) window.sessionStorage.setItem(LEGACY_COMPOSER_DRAFT_KEY, next.text)
  } catch { /* storage unavailable */ }
}

/** A late failed submission must not replace text typed in a newer composer. */
export function restoreComposerDraft(scope: string, snapshot: ComposerDraftSnapshot, isolated = false): void {
  try {
    if (!window.sessionStorage.getItem(composerDraftStorageKey(scope))) saveComposerDraft(scope, snapshot, isolated)
  } catch { /* storage unavailable */ }
}

export function readComposerDraft(scope: string, isolated = false): ComposerDraftSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(composerDraftStorageKey(scope))
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && typeof (parsed as ComposerDraftSnapshot).text === 'string') {
        return parsed as ComposerDraftSnapshot
      }
    }
    if (isolated) return null
    const legacy = window.sessionStorage.getItem(LEGACY_COMPOSER_DRAFT_KEY)
    return legacy ? { text: legacy } : null
  } catch {
    return null
  }
}

export function clearComposerDraft(scope: string, isolated = false): void {
  try {
    window.sessionStorage.removeItem(composerDraftStorageKey(scope))
    if (!isolated) window.sessionStorage.removeItem(LEGACY_COMPOSER_DRAFT_KEY)
  } catch { /* storage unavailable */ }
}

/** Read and clear a preserved crash draft; returns '' when none exists. */
export function takeComposerDraft(): string {
  try {
    const draft = window.sessionStorage.getItem(LEGACY_COMPOSER_DRAFT_KEY) ?? ''
    if (draft) window.sessionStorage.removeItem(LEGACY_COMPOSER_DRAFT_KEY)
    return draft
  } catch { return '' }
}
