import * as Effect from 'effect/Effect'
import { requireString } from 'apex-core/validation'
import { describeEffectiveRunConfig } from './effective-run-config'
import type { ExtensionPathContext } from './extension-manifest'
import type { ProjectService } from './projects'

/** Owns only read-only config requests; XState remains the application lifecycle owner. */
export function createEffectiveConfigIpc(services: {
  projects: Pick<ProjectService, 'authorizeReadOnlyCwd'>
  extensionPathContext: ExtensionPathContext
}) {
  const shutdown = new AbortController()
  const pending = new Set<Promise<unknown>>()

  return {
    run(cwd: unknown) {
      const program = Effect.gen(function* () {
        const requested = yield* Effect.try({
          try: () => requireString(cwd, 'cwd', { min: 1, max: 4096 }),
          catch: (error) => error,
        })
        const authorized = yield* Effect.tryPromise({
          try: () => services.projects.authorizeReadOnlyCwd(requested),
          catch: (error) => error,
        })
        return yield* Effect.try({
          try: () => describeEffectiveRunConfig({
            cwd: authorized,
            harness: 'pi',
            extensionContext: services.extensionPathContext,
          }),
          catch: (error) => error,
        })
      })
      const result = Effect.runPromise(program, { signal: shutdown.signal })
      pending.add(result)
      void result.then(() => pending.delete(result), () => pending.delete(result))
      return result
    },
    async dispose() {
      // Authorization may still finish its read, but interruption prevents the subsequent scan.
      shutdown.abort()
      await Promise.allSettled(pending)
    },
  }
}
