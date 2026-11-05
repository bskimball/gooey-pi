/** Original-source metadata reported by the selected element, not a generated script stack. */
export interface BrowserSourceHint {
  kind: 'explicit' | 'astro' | 'svelte'
  path: string
  line?: number
}

export type BrowserSourceResult = { kind: 'resolved'; path: string; line?: number; evidence: BrowserSourceHint['kind'] } | { kind: 'unknown'; reason: string }

export function parseBrowserSourceHint(value: unknown): BrowserSourceHint | undefined {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('path' in value)) return undefined
  const { kind, path } = value
  const line = 'line' in value ? value.line : undefined
  if (kind !== 'explicit' && kind !== 'astro' && kind !== 'svelte') return undefined
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) return undefined
  if (line === undefined) return { kind, path }
  if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1 || line > 2_147_483_647) return undefined
  return { kind, path, line }
}
