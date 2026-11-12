import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXTENSION_INJECTIONS, SHIPPED_EXTENSION_FILENAMES, resolveExtensionPath, type ExtensionInjection } from '../../apps/desktop/electron/main/extension-manifest'
import type { ApexExtensionApi } from '../../apps/desktop/assets/extensions/apex-browser'
import type { PiFastModeExtensionApi } from '../../apps/desktop/assets/extensions/pi-work-fast-mode'

type Registration = { kind: 'tool' | 'command' | 'event'; name: string }

interface Fixture {
  api: object
  registrations: Registration[]
}

type PiFixtureApi = PiFastModeExtensionApi & Omit<ApexExtensionApi, 'typebox'>

function apexHost(): Fixture {
  const registrations: Registration[] = []
  const schema = (kind: string) => (...args: unknown[]) => ({ kind, args })
  const target: ApexExtensionApi = {
    typebox: {
      Type: {
        Object: schema('object'),
        String: schema('string'),
        Number: schema('number'),
        Boolean: schema('boolean'),
        Array: schema('array'),
        Enum: schema('enum'),
        Optional: schema('optional'),
      },
    },
    registerTool: (tool) => { registrations.push({ kind: 'tool', name: tool.name }) },
  }
  const api = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'symbol' || property === 'then' || property === 'constructor') return Reflect.get(object, property, receiver)
      if (!(property in object)) throw new Error(`OMP fixture does not inject ${String(property)}`)
      return Reflect.get(object, property, receiver)
    },
  })
  return { api, registrations }
}

function piHost(): Fixture {
  const registrations: Registration[] = []
  const target: PiFixtureApi = {
    registerTool: (tool) => { registrations.push({ kind: 'tool', name: tool.name }) },
    registerCommand: (name: string) => { registrations.push({ kind: 'command', name }) },
    on: (event: string) => { registrations.push({ kind: 'event', name: event }) },
  }
  const api = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'symbol' || property === 'then' || property === 'constructor') return Reflect.get(object, property, receiver)
      // Model the absent optional shim that shipped files probe before using their dynamic-import fallback.
      if (property === 'typebox') return undefined
      if (!(property in object)) throw new Error(`Pi fixture does not inject ${String(property)}`)
      return Reflect.get(object, property, receiver)
    },
  })
  return { api, registrations }
}

const fixtureFactories = { pi: piHost }

const expectedRegistrations: Record<string, Registration[]> = {
  'apex-editor.ts': ['editor_context', 'editor_read', 'editor_diagnostics', 'editor_open'].map((name) => ({ kind: 'tool', name })),
  'apex-browser-agent.ts': [{ kind: 'tool', name: 'browser_task' }, { kind: 'tool', name: 'browser_run' }],
  'apex-browser.ts': [
    ...['terminal_read', 'browser_tabs', 'browser_navigate', 'browser_screenshot', 'browser_read_page', 'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_evaluate'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'apex-ask-user.ts': [{ kind: 'tool', name: 'ask_user' }],
  'apex-collaboration.ts': [
    ...['gooeypi_session_list', 'gooeypi_session_models', 'gooeypi_session_create', 'gooeypi_session_read', 'gooeypi_session_send', 'gooeypi_session_wait'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'apex-schedules.ts': [
    ...['scheduled_tasks_list', 'scheduled_task_create_once', 'scheduled_task_create_recurring', 'scheduled_task_update', 'scheduled_task_manage'].map((name) => ({ kind: 'tool' as const, name })),
  ],
  'pi-work-fast-mode.ts': [
    { kind: 'command', name: 'gooeypi-fast-mode' },
    { kind: 'event', name: 'before_provider_request' },
  ],
  'apex-visual-previews.ts': [{ kind: 'event', name: 'before_agent_start' }],
}

const brokerVariables: Partial<Record<ExtensionInjection['capability'], readonly [string, string]>> = {
  editor: ['APEX_EDITOR_URL', 'APEX_EDITOR_TOKEN'],
  browser: ['APEX_BROWSER_URL', 'APEX_BROWSER_TOKEN'],
  browserAgent: ['APEX_BROWSER_URL', 'APEX_BROWSER_TOKEN'],
  schedule: ['APEX_SCHEDULE_URL', 'APEX_SCHEDULE_TOKEN'],
  collaboration: ['GOOEYPI_COLLABORATION_URL', 'GOOEYPI_COLLABORATION_TOKEN'],
}

const UNPREFIXED_TOOLS = [
  'editor_context', 'editor_read', 'editor_diagnostics', 'editor_open',
  'browser_run', 'browser_task',
  'ask_user', 'terminal_read', 'browser_tabs', 'browser_navigate', 'browser_screenshot', 'browser_read_page',
  'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_evaluate',
  'scheduled_tasks_list', 'scheduled_task_create_once', 'scheduled_task_create_recurring',
  'scheduled_task_update', 'scheduled_task_manage',
]

async function loadExtension(injection: ExtensionInjection, configured: boolean) {
  vi.resetModules()
  vi.unstubAllEnvs()
  // A shell launched from inside Apex inherits live broker variables; clear them so the
  // unconfigured case really runs without a broker.
  for (const [url, token] of Object.values(brokerVariables)) {
    vi.stubEnv(url, undefined)
    vi.stubEnv(token, undefined)
  }
  const variables = brokerVariables[injection.capability]
  if (configured && variables) {
    vi.stubEnv(variables[0], 'http://127.0.0.1:1/')
    vi.stubEnv(variables[1], 'inert-test-token')
  }
  const url = pathToFileURL(join(process.cwd(), 'apps', 'desktop', 'assets', 'extensions', injection.filename)).href
  return (await import(url)).default as (api: object) => void | Promise<void>
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('shipped extension contracts', () => {
  it('resolves monorepo development assets without changing fixture or packaged roots', () => {
    const filename = SHIPPED_EXTENSION_FILENAMES[0]
    const context = { isPackaged: false, appPath: process.cwd(), resourcesPath: '/packaged/resources' }
    expect(resolveExtensionPath(filename, context)).toBe(join(process.cwd(), 'apps', 'desktop', 'assets', 'extensions', filename))
    expect(resolveExtensionPath(filename, { ...context, appPath: '/synthetic/app' })).toBe(join('/synthetic/app', 'assets', 'extensions', filename))
    expect(resolveExtensionPath(filename, { ...context, isPackaged: true })).toBe(join(context.resourcesPath, 'extensions', filename))
  })

  it('initializes every manifest injection against its genuine host surface', async () => {
    for (const filename of SHIPPED_EXTENSION_FILENAMES) {
      expect(expectedRegistrations[filename], `Missing registration contract for ${filename}`).toBeDefined()
    }
    for (const [harness, injections] of Object.entries(EXTENSION_INJECTIONS)) {
      for (const injection of injections) {
        for (const configured of [false, true]) {
          const fixture = fixtureFactories[harness as keyof typeof fixtureFactories]()
          const factory = await loadExtension(injection, configured)
          await factory(fixture.api)
          const expected = expectedRegistrations[injection.filename]
          expect(fixture.registrations, `${harness}/${injection.filename} configured=${configured}`).toEqual(
            configured || !brokerVariables[injection.capability] ? expected : [],
          )
        }
      }
    }
  })

  it('rejects an extension that reaches for a capability its host does not inject', () => {
    const badExtension = (api: ApexExtensionApi) => {
      api.typebox!.Type.Object({})
    }
    expect(() => badExtension(apexHost().api as ApexExtensionApi)).not.toThrow()
    expect(() => badExtension(piHost().api as ApexExtensionApi)).toThrow()
  })

  it('keeps tool registrations namespaced', () => {
    // Browser tools use their public browser_* names; other tools retain their existing contracts.
    for (const registrations of Object.values(expectedRegistrations)) {
      for (const registration of registrations) {
        if (registration.kind !== 'tool') continue
        expect(registration.name.startsWith('gooeypi_') || UNPREFIXED_TOOLS.includes(registration.name)).toBe(true)
      }
    }
  })

  it('rejects properties outside each host fixture from the proxy trap', () => {
    for (const [harness, factory] of Object.entries(fixtureFactories)) {
      const fixture = factory()
      expect(() => Reflect.get(fixture.api, 'unsupportedCapability'), harness).toThrow('Pi fixture does not inject unsupportedCapability')
    }
  })

  it('derives the shipped inventory from the actual extension directory', () => {
    const actual = readdirSync(join(process.cwd(), 'apps', 'desktop', 'assets', 'extensions'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => entry.name)
      .sort()
    expect(SHIPPED_EXTENSION_FILENAMES).toEqual(actual)
  })
})

describe('describeEffectiveRunConfig', () => {
  it('reports instruction sources and capability presence without touching Pi credential files', async () => {
    const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { describeEffectiveRunConfig } = await import('../../apps/desktop/electron/main/effective-run-config')
    const root = mkdtempSync(join(tmpdir(), 'effective-config-'))
    try {
      const project = join(root, 'repo', 'pkg')
      const agentDir = join(root, 'agent')
      const assets = join(root, 'resources', 'extensions')
      for (const dir of [project, join(project, '.agents', 'skills', 'one'), agentDir, assets, join(root, 'repo', '.git')]) mkdirSync(dir, { recursive: true })
      writeFileSync(join(project, 'AGENTS.md'), 'project')
      writeFileSync(join(project, 'CLAUDE.md'), 'shadowed by AGENTS.md')
      writeFileSync(join(root, 'repo', 'AGENTS.md'), 'target!')
      writeFileSync(join(root, 'repo', 'AGENTS.override.md'), 'override')
      writeFileSync(join(root, 'AGENTS.md'), 'above the git root')
      writeFileSync(join(agentDir, 'AGENTS.md'), 'global')
      writeFileSync(join(agentDir, 'SYSTEM.md'), 'sys')
      writeFileSync(join(agentDir, 'auth.json'), '{"secret":true}')
      writeFileSync(join(assets, 'apex-ask-user.ts'), '')
      const result = describeEffectiveRunConfig({ cwd: project, harness: 'pi', home: join(root, 'home'), agentDir, extensionContext: { isPackaged: true, appPath: root, resourcesPath: join(root, 'resources') } })
      expect(result.instructionSources.map(({ scope, kind, bytes }) => [scope, kind, bytes])).toEqual([['user', 'AGENTS.md', 6], ['project', 'AGENTS.md', 7], ['parent', 'AGENTS.override.md', 8], ['user', 'SYSTEM.md', 3]])
      const linked = join(root, 'linked')
      mkdirSync(linked)
      try {
        symlinkSync(join(root, 'repo', 'AGENTS.md'), join(linked, 'CLAUDE.md'))
      } catch {
        return // symlinks need privileges on Windows
      }
      const viaSymlink = describeEffectiveRunConfig({ cwd: linked, harness: 'pi', home: join(root, 'home'), agentDir: join(root, 'none'), extensionContext: { isPackaged: true, appPath: root, resourcesPath: join(root, 'resources') } })
      expect(viaSymlink.instructionSources.map(({ kind, bytes }) => [kind, bytes]).slice(0, 1)).toEqual([['CLAUDE.md', 7]])
      expect(result.skillDirs).toEqual([{ path: join(project, '.agents', 'skills'), count: 1 }])
      expect(result.injectedCapabilities.find(({ capability }) => capability === 'askUser')?.present).toBe(true)
      expect(result.injectedCapabilities.find(({ capability }) => capability === 'schedule')?.present).toBe(false)
      expect(JSON.stringify(result)).not.toContain('auth.json')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
