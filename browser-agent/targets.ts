import type { Classifier, Page, PageDiff, PageElement, Target } from './types'

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()
const string = (value: unknown): string => (typeof value === 'string' ? value : '')

function role(element: Record<string, unknown>): string {
  if (typeof element.role === 'string' && element.role.trim()) return normalize(element.role)
  const tag = normalize(string(element.tag))
  const type = normalize(string(element.inputType)) || 'text'
  if (tag === 'a' && typeof element.href === 'string') return 'link'
  if (tag === 'button' || tag === 'summary' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return 'button'
  if (tag === 'textarea' || element.contenteditable === true || element.contenteditable === 'true' || element.contentEditable === true) return 'textbox'
  if (tag === 'select') return 'combobox'
  if (tag === 'input') {
    if (type === 'checkbox' || type === 'radio') return type
    if (['text', 'email', 'search', 'password', 'tel', 'url', 'number', 'none'].includes(type)) return 'textbox'
  }
  return tag
}

export function parsePage(raw: unknown): Page {
  if (!record(raw) || typeof raw.url !== 'string' || typeof raw.title !== 'string' || !Array.isArray(raw.elements)) throw new Error('Browser read returned an invalid page')
  const elements = raw.elements.map((entry): PageElement => {
    if (!record(entry) || !Number.isSafeInteger(entry.ref) || Number(entry.ref) < 0 || typeof entry.name !== 'string') throw new Error('Browser read returned an invalid element')
    return {
      ref: Number(entry.ref),
      role: role(entry),
      name: entry.name,
      ...(typeof entry.href === 'string' ? { href: entry.href } : {}),
      ...(typeof entry.value === 'string' ? { value: entry.value } : {}),
      checked: entry.checked === true,
      disabled: entry.disabled === true,
    }
  })
  return { url: raw.url, title: raw.title, text: typeof raw.text === 'string' ? raw.text : undefined, elements }
}

export class TargetError extends Error {
  constructor(
    message: string,
    readonly candidates: PageElement[],
  ) {
    super(message)
  }
}

export function matches(target: Target, elements: PageElement[]): PageElement[] {
  if ('ref' in target) return elements.filter((element) => element.ref === target.ref)
  const scored = elements
    .flatMap((element) => {
      if (target.role && normalize(target.role) !== normalize(element.role)) return []
      const name = normalize(element.name)
      const wanted = target.name === undefined ? undefined : normalize(target.name)
      const score = wanted === undefined || name === wanted ? 0 : name.startsWith(wanted) ? 1 : name.includes(wanted) ? 2 : -1
      return score < 0 ? [] : [{ element, score: score + (element.disabled ? 10 : 0) }]
    })
    .sort((a, b) => a.score - b.score)
  const best = scored.filter((item) => item.score === scored[0]?.score).map((item) => item.element)
  return target.nth === undefined ? best : best.slice(target.nth, target.nth + 1)
}

export async function resolveTarget(target: Target, page: Page, intent: string, classifier?: Classifier): Promise<PageElement> {
  const candidates = matches(target, page.elements)
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1 && classifier) {
    try {
      const answer = await classifier.choose(JSON.stringify({ intent: 'intent' in target ? target.intent || intent : intent, target }), candidates)
      const chosen = candidates.find((candidate) => candidate.ref === answer.ref)
      if (chosen && Number.isFinite(answer.confidence) && answer.confidence >= 0.8 && answer.confidence <= 1) return chosen
    } catch {
      throw new TargetError('Target is ambiguous and classifier resolution failed', candidates.slice(0, 10))
    }
  }
  throw new TargetError(candidates.length ? 'Target is ambiguous; specify nth or a more precise name' : 'No matching target', candidates.slice(0, 10))
}

export function pageDiff(before: Page, after: Page): PageDiff {
  const key = (element: PageElement): string => JSON.stringify([element.role, element.name, element.href ?? ''])
  // Keep duplicate keys in document order instead of collapsing repeated links.
  const buckets = new Map<string, PageElement[]>()
  for (const element of before.elements) buckets.set(key(element), [...(buckets.get(key(element)) ?? []), element])
  const diff: PageDiff = { added: [], removed: [], changed: [] }
  for (const element of after.elements) {
    const previous = buckets.get(key(element))?.shift()
    if (!previous) diff.added.push(element)
    else if (previous.value !== element.value || previous.checked !== element.checked || previous.disabled !== element.disabled) diff.changed.push({ before: previous, after: element })
  }
  diff.removed = [...buckets.values()].flat()
  return { added: diff.added.slice(0, 20), removed: diff.removed.slice(0, 20), changed: diff.changed.slice(0, 20) }
}
