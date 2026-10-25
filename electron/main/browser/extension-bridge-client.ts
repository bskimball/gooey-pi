const DEFAULT_BROKER = 'http://127.0.0.1:29301'

export async function probeBroker(base = DEFAULT_BROKER): Promise<
  { running: false } | { running: true; kind: 'desktop' | 'vscode'; version: number }
> {
  try {
    const response = await fetch(`${base}/v1/extension/status`, { signal: AbortSignal.timeout(500) })
    const value: unknown = await response.json()
    if (response.ok && value && typeof value === 'object' && 'ok' in value && value.ok === true && 'bridge' in value && value.bridge === 'apex' && 'version' in value && value.version === 1 && 'kind' in value && (value.kind === 'desktop' || value.kind === 'vscode')) {
      return { running: true, kind: value.kind, version: value.version }
    }
  } catch { /* An absent or incompatible broker is not an error. */ }
  return { running: false }
}

export async function callMethod(method: string, params: Record<string, unknown>, token: string, base = DEFAULT_BROKER, sessionKey?: string): Promise<unknown> {
  const response = await fetch(`${base}/v1/extension/execute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params, sessionKey }),
    signal: AbortSignal.timeout(30_000),
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    throw new Error(value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : `Broker returned ${response.status}`)
  }
  if (!value || typeof value !== 'object' || !('result' in value)) throw new Error('Invalid broker result')
  return value.result
}
