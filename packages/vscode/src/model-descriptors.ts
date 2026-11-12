import type { ModelDescriptor, ProviderDescriptor, ThinkingLevel } from './protocol'

type Json = Record<string, unknown>

const REASONING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high']

/** Maps one `get_available_models` entry from pi RPC onto the webview's model descriptor. */
export function describeModel(raw: Json): ModelDescriptor {
  const provider = String(raw.provider)
  const id = String(raw.id)
  const reasoning = raw.reasoning === true
  return {
    key: `${provider}/${id}`,
    provider,
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    reasoning,
    input: Array.isArray(raw.input) ? raw.input.filter((kind): kind is 'text' | 'image' => kind === 'text' || kind === 'image') : ['text'],
    contextWindow: Number(raw.contextWindow) || 0,
    maxTokens: Number(raw.maxTokens) || 0,
    availableThinkingLevels: reasoning ? REASONING_LEVELS : ['off'],
    fastModeSupported: false,
    available: true,
  }
}

export function describeProviders(models: ModelDescriptor[]): ProviderDescriptor[] {
  const counts = new Map<string, number>()
  for (const model of models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1)
  return [...counts].map(([id, count]) => ({ id, name: id, authMethod: 'external', configured: true, modelCount: count, availableModelCount: count, enabled: true }))
}
