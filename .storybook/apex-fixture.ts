import type { ApexApi } from '../packages/core/src/types/api'
import { createStorySettings, createStoryMeta, createStoryModelCatalog } from './fixture-data'
import { createStoryEvents, registerStoryCleanup, unsupportedHostMethod } from './host-fixtures'

export type ApexStoryOverrides = { [Domain in keyof ApexApi]?: Partial<ApexApi[Domain]> }
const unsupported = (method: string) => () => unsupportedHostMethod(method)

/** All state belongs to this fixture instance. No host transport is imported. */
export function createApexStoryFixture(overrides: ApexStoryOverrides = {}): ApexApi {
  let settings = createStorySettings()
  let catalog = createStoryModelCatalog()
  function channel<T>() {
    const events = createStoryEvents<T>()
    registerStoryCleanup(events.reset)
    return events.subscribe
  }
  return {
    spaces: { list: async () => [], create: unsupported('spaces.create'), update: unsupported('spaces.update'), ...overrides.spaces },
    coordinator: { open: unsupported('coordinator.open'), close: unsupported('coordinator.close'), reset: unsupported('coordinator.reset'), ...overrides.coordinator },
    app: {
      getMeta: async () => createStoryMeta(),
      refreshHarnesses: async () => ({ meta: createStoryMeta(), settings }),
      openExternal: unsupported('app.openExternal'),
      revealPath: unsupported('app.revealPath'),
      openInVsCode: unsupported('app.openInVsCode'),
      resolveBrowserSource: unsupported('app.resolveBrowserSource'),
      readWorkspaceImage: unsupported('app.readWorkspaceImage'),
      popupMenu: unsupported('app.popupMenu'),
      setTitleBarTheme: async () => true,
      onOpenSettings: channel(),
      pathForFile: () => '',
      ...overrides.app,
    },
    updates: {
      getState: async () => ({ phase: 'unsupported' }),
      check: async () => ({ phase: 'unsupported' }),
      downloadAndInstall: unsupported('updates.downloadAndInstall'),
      onChanged: channel(),
      ...overrides.updates,
    },
    projects: {
      list: async () => [],
      listFiles: async () => ({ entries: [], skipped: 0 }),
      readTextFile: unsupported('projects.readTextFile'),
      listCheckouts: async () => ({ strategy: 'worktree', activePath: '/storybook/project', checkouts: [] }),
      executeCheckout: unsupported('projects.executeCheckout'),
      add: unsupported('projects.add'),
      grantInferred: unsupported('projects.grantInferred'),
      remove: unsupported('projects.remove'),
      touch: unsupported('projects.touch'),
      setPinned: unsupported('projects.setPinned'),
      updateScripts: unsupported('projects.updateScripts'),
      markSetupStarted: unsupported('projects.markSetupStarted'),
      finishSetup: unsupported('projects.finishSetup'),
      ...overrides.projects,
    },
    sessions: {
      create: unsupported('sessions.create'),
      list: async () => [],
      read: async () => [],
      reviewFinish: unsupported('sessions.reviewFinish'),
      finishTask: unsupported('sessions.finishTask'),
      listFinishedTasks: async () => [],
      createSideConversation: unsupported('sessions.createSideConversation'),
      listSideConversations: async () => [],
      getSideConversation: async () => null,
      prepareSideReturn: unsupported('sessions.prepareSideReturn'),
      previewRewind: unsupported('sessions.previewRewind'),
      rewind: unsupported('sessions.rewind'),
      listRunReceipts: async () => [],
      readRunFile: unsupported('sessions.readRunFile'),
      followUp: unsupported('sessions.followUp'),
      rename: unsupported('sessions.rename'),
      archive: unsupported('sessions.archive'),
      onChanged: channel(),
      runtimeOwners: async () => [],
      continueInVsCode: unsupported('sessions.continueInVsCode'),
      ...overrides.sessions,
    },
    specialists: { list: async () => [], track: async () => ({}), watchWorkers: async () => {}, onChanged: channel(), onWorkerChanged: channel(), ...overrides.specialists },
    runtime: { effectiveConfig: async () => ({ injectedCapabilities: [], instructionSources: [], skillDirs: [] }), ...overrides.runtime },
    agent: { start: unsupported('agent.start'), command: unsupported('agent.command'), stop: unsupported('agent.stop'), list: async () => [], onEvent: channel(), ...overrides.agent },
    providers: {
      catalog: async () => structuredClone(catalog),
      setEnabled: async (id, enabled) => {
        catalog = { ...catalog, providers: catalog.providers.map((p) => (p.id === id ? { ...p, enabled } : p)) }
        return structuredClone(catalog)
      },
      setDisabled: async (ids) => {
        catalog = { ...catalog, providers: catalog.providers.map((p) => ({ ...p, enabled: !ids.includes(p.id) })) }
        return structuredClone(catalog)
      },
      setModelEnabled: async (key, enabled) => {
        catalog = { ...catalog, models: catalog.models.map((m) => (m.key === key ? { ...m, enabled } : m)) }
        return structuredClone(catalog)
      },
      ...overrides.providers,
    },
    voice: {
      credentialStatus: async () => ({
        configured: { openai: false, groq: false, deepgram: false, 'self-hosted': false },
        source: {},
        storage: { available: false, message: 'Browser-only story fixture' },
      }),
      saveApiKey: unsupported('voice.saveApiKey'),
      deleteApiKey: unsupported('voice.deleteApiKey'),
      createRealtimeCall: unsupported('voice.createRealtimeCall'),
      transcribe: unsupported('voice.transcribe'),
      testSelfHosted: unsupported('voice.testSelfHosted'),
      executeTool: unsupported('voice.executeTool'),
      ...overrides.voice,
    },
    pets: { list: async () => [], sprite: async () => null, ...overrides.pets },
    terminal: {
      create: unsupported('terminal.create'),
      bindSession: unsupported('terminal.bindSession'),
      input: unsupported('terminal.input'),
      resize: unsupported('terminal.resize'),
      setActiveContext: unsupported('terminal.setActiveContext'),
      clearActiveContext: unsupported('terminal.clearActiveContext'),
      kill: unsupported('terminal.kill'),
      onData: channel(),
      onExit: channel(),
      ...overrides.terminal,
    },
    backgroundJobs: { list: async () => [], stop: unsupported('backgroundJobs.stop'), dismiss: unsupported('backgroundJobs.dismiss'), onEvent: channel(), ...overrides.backgroundJobs },
    git: {
      status: async () => ({ isRepo: false, files: [] }),
      diff: async (_cwd, path, staged = false) => ({ path, staged, text: '', truncated: false }),
      stage: unsupported('git.stage'),
      unstage: unsupported('git.unstage'),
      restore: unsupported('git.restore'),
      commit: unsupported('git.commit'),
      ...overrides.git,
    },
    plugins: {
      list: async () => ({ skills: [], warnings: [] }),
      install: unsupported('plugins.install'),
      installExtension: unsupported('plugins.installExtension'),
      setMcpSupport: unsupported('plugins.setMcpSupport'),
      connectMcp: unsupported('plugins.connectMcp'),
      setMcpEnabled: unsupported('plugins.setMcpEnabled'),
      mutateCapability: unsupported('plugins.mutateCapability'),
      ...overrides.plugins,
    },
    settings: {
      get: async () => structuredClone(settings),
      update: async (patch) => {
        settings = { ...settings, ...structuredClone(patch) }
        return structuredClone(settings)
      },
      resetBrowserData: async () => true,
      ...overrides.settings,
    },
    browser: {
      getExtensionStatus: async () => ({ connected: false, extensionPath: '', bridgePort: null, activeSessionKey: null, pairedTabCount: 0 }),
      onExtensionStatusChanged: channel(),
      setActiveSession: async () => {},
      setTabPaused: async () => null,
      setTabPicking: async () => null,
      popOutTab: unsupported('browser.popOutTab'),
      focusExtensionTab: unsupported('browser.focusExtensionTab'),
      captureSelection: unsupported('browser.captureSelection'),
      revealSelection: unsupported('browser.revealSelection'),
      clearSelection: async () => true,
      state: async () => ({ tabs: [] }),
      attachTab: unsupported('browser.attachTab'),
      selectTab: unsupported('browser.selectTab'),
      closeTab: unsupported('browser.closeTab'),
      setPreviewContext: async () => true,
      navigateTab: unsupported('browser.navigateTab'),
      onChanged: channel(),
      onPointer: channel(),
      onActivity: channel(),
      ...overrides.browser,
    },
    schedules: {
      list: async () => [],
      preview: unsupported('schedules.preview'),
      create: unsupported('schedules.create'),
      update: unsupported('schedules.update'),
      pause: unsupported('schedules.pause'),
      resume: unsupported('schedules.resume'),
      delete: unsupported('schedules.delete'),
      runNow: unsupported('schedules.runNow'),
      onChanged: channel(),
      ...overrides.schedules,
    },
  }
}
