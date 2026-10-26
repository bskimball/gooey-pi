import { createModels, type Models, type Provider } from '@earendil-works/pi-ai/models'

export type HostModel = ReturnType<Provider['getModels']>[number]
export type HostRegistry = Pick<Provider, 'stream' | 'streamSimple'> &
  Pick<Models, 'classify' | 'getModelOfType'> & {
    getAvailable(): HostModel[]
    find(provider: string, id: string): HostModel | undefined
  }

/** Credentials and transport remain owned by the host, including OAuth refresh. */
export function hostModels(host: HostRegistry, selected: HostModel) {
  const models = createModels()
  for (const id of new Set([...host.getAvailable().map((model) => model.provider), selected.provider])) {
    models.setProvider({
      id,
      name: 'Host Pi transport',
      auth: { apiKey: { name: 'Host-managed auth', resolve: async () => ({ auth: {} }) } },
      getModels: () => {
        const available = host.getAvailable().filter((model) => model.provider === id)
        return id === selected.provider && !available.some((model) => model.id === selected.id) ? [...available, selected] : available
      },
      stream: (model, context, options) => host.stream(model, context, options),
      streamSimple: (model, context, options) => host.streamSimple(model, context, options),
    })
  }
  return models
}
