import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import { styles as pluginsStyles } from 'apex-ui/styles/plugins.stylex'
import { styles as activityStyles } from 'apex-ui/styles/activity.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as pagesStyles } from 'apex-ui/styles/pages.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { ArrowLeft, ArrowsClockwise, BookOpen, CaretRight, Check, FileCode, FileText, GitFork, Globe, MagicWand, MagnifyingGlass, Package, Palette, Plus, ShieldCheck, SlidersHorizontal, Sparkle, Trash, Warning, X } from '@/components/icons'
import * as stylex from '@stylexjs/stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TextArea } from '@astryxdesign/core/TextArea'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo, useState } from 'react'
import type { CapabilityMutationInput, ExtensionInstallInput, HarnessId, McpConnectionInput, McpStateInput, PluginWarning, SkillRecord } from '@/types/api'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { NETWORK_MCP_UNAVAILABLE_DETAIL } from '@/lib/mcp-policy'
import { ApexButton, EmptyState, IconButton, Modal, SelectControl } from '@/components/ui'
import { type McpScope, useAddCapabilityFlow } from './addCapabilityMachine'
import { usePluginOperation } from './pluginOperationMachine'

const MCP_STDIO_HELP: Record<HarnessId, string> = {
  pi: 'Pi starts this stdio MCP server through the pi-mcp-adapter extension (pi install npm:pi-mcp-adapter) in each new session.',
}

type DirectoryTab = 'plugins' | 'skills'

const PACKAGE_LABELS: Record<HarnessId, string> = { pi: 'Pi package' }
const PACKAGE_HELP: Record<HarnessId, string> = {
  pi: 'Install a Pi package containing extensions, skills, prompts, or themes with Pi’s package manager.',
}
const GITHUB_ISSUES_URL = 'https://github.com/am-will/gooey-pi/issues/new'
const MCP_SUPPORT_SKILL_ID = 'gooeypi-pi-mcp'

function capabilityDetailId(skill: SkillRecord): string {
  return `capability-detail-${skill.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128)}`
}

function SkillIcon({ skill }: { skill: SkillRecord }) {
  const common = { size: 16 }
  if (skill.icon === 'github') return <GitFork {...common}/>
  if (skill.icon === 'palette') return <Palette {...common}/>
  if (skill.icon === 'book-open') return <BookOpen {...common}/>
  if (skill.kind === 'mcp') return <Globe {...common}/>
  if (skill.kind === 'prompt') return <FileText {...common}/>
  if (skill.kind === 'skill') return <MagicWand {...common}/>
  return <Package {...common}/>
}

interface PluginsPageProps {
  harness: HarnessId
  skills: SkillRecord[]
  warnings: PluginWarning[]
  loading: boolean
  activeProjectPath?: string
  onRefresh(): Promise<void>
  askUserEnabled: boolean
  onSetAskUserEnabled(enabled: boolean): Promise<void>
  browserEnabled: boolean
  onSetBrowserEnabled(enabled: boolean): Promise<void>
  computerUseEnabled: boolean
  onSetComputerUseEnabled(enabled: boolean): Promise<void>
  onOpenExternal(url: string): void
  onInstall(source: string): Promise<{ ok: boolean; output: string }>
  onInstallExtension(input: ExtensionInstallInput): Promise<{ ok: boolean; output: string }>
  onSetMcpSupport(enabled: boolean): Promise<{ ok: boolean; output: string }>
  onConnectMcp(input: McpConnectionInput): Promise<{ ok: boolean; output: string }>
  onSetMcpEnabled(input: McpStateInput): Promise<{ ok: boolean; output: string }>
  onMutateCapability?(input: CapabilityMutationInput): Promise<{ ok: boolean; output: string }>
}

export function PluginsPage({ harness, skills, warnings, loading, activeProjectPath, askUserEnabled, onSetAskUserEnabled, browserEnabled, onSetBrowserEnabled, computerUseEnabled, onSetComputerUseEnabled, onOpenExternal, onRefresh, onInstall, onInstallExtension, onSetMcpSupport, onConnectMcp, onSetMcpEnabled, onMutateCapability = async () => ({ ok: false, output: 'Capability changes are unavailable.' }) }: PluginsPageProps) {
  const [tab, setTab] = useState<DirectoryTab>('plugins')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const instant = Boolean(useReducedMotion())
    || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion'))
    || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  const addFlow = useAddCapabilityFlow()
  const operation = usePluginOperation()
  const { snapshot: addSnapshot, send: sendAdd } = addFlow
  const addDraft = addSnapshot.context
  const addOpen = !addSnapshot.matches('closed')
  const adding = addSnapshot.matches('submitting')
  const busy = operation.busyId !== null
  const {
    confirmDisable,
    confirmRemove,
    computerUseAlert,
    mcpSupportAlert,
    mcpSupportNotice,
    capabilityAlert,
  } = operation
  const piMcpAdapterInstalled = skills.some((skill) => skill.id === 'gooeypi-pi-mcp' && skill.enabled)
  const canConfigureMcp = piMcpAdapterInstalled

  const visible = useMemo(() => skills.map((skill) => skill.id === 'gooeypi-ask-user'
    ? { ...skill, enabled: askUserEnabled }
    : skill.id === 'apex-browser' ? { ...skill, enabled: browserEnabled }
    : skill.id === 'gooeypi-computer-use' ? { ...skill, enabled: computerUseEnabled } : skill).filter((skill) => {
    const capability = skill.id === 'apex-browser' || skill.kind !== 'skill' && skill.kind !== 'prompt'
    return (tab === 'plugins' ? capability : !capability)
      && (filter === 'all' || filter === 'installed' && skill.enabled || filter === skill.location)
      && `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())
  }), [askUserEnabled, browserEnabled, computerUseEnabled, skills, tab, filter, query])

  const canAdd = addDraft.kind === 'bundle'
    ? Boolean(addDraft.source.trim())
    : addDraft.kind === 'extension'
      ? Boolean(addDraft.source.trim() && (addDraft.scope !== 'project' || activeProjectPath))
    : addDraft.kind === 'mcp' && canConfigureMcp && Boolean(
      addDraft.mcpName.trim()
      && addDraft.mcpCommand.trim()
      && (addDraft.scope !== 'project' || activeProjectPath),
    )

  const add = async () => {
    if (!canAdd || adding || !addDraft.kind) return
    const kind = addDraft.kind
    const scope: McpScope = addDraft.scope
    sendAdd({ type: 'SUBMIT' })
    try {
      const response = kind === 'bundle'
        ? await onInstall(addDraft.source.trim())
        : kind === 'extension'
          ? await onInstallExtension({ source: addDraft.source.trim(), scope, projectPath: scope === 'project' ? activeProjectPath : undefined })
          : await onConnectMcp({ name: addDraft.mcpName.trim(), scope, projectPath: scope === 'project' ? activeProjectPath : undefined, type: 'stdio', command: addDraft.mcpCommand.trim(), args: addDraft.mcpArgs.split('\n').map((arg) => arg.trim()).filter(Boolean) })
      sendAdd({ type: 'RESOLVE', ok: response.ok, output: response.output })
      if (response.ok && (kind === 'mcp' || kind === 'bundle')) await onRefresh()
    } finally {
      sendAdd({ type: 'FINISH' })
    }
  }

  const setAddField = (field: 'source' | 'mcpName' | 'mcpCommand' | 'mcpArgs' | 'scope', value: string) => sendAdd({ type: 'SET_FIELD', field, value })
  const openAdd = () => sendAdd({ type: 'OPEN' })
  const runOperation = async (skillId: string, run: () => Promise<void>) => {
    if (!operation.begin(skillId)) return
    try {
      await run()
    } finally {
      operation.finish()
    }
  }
  const setAskUser = (skill: SkillRecord, enabled: boolean) => runOperation(skill.id, async () => {
    await onSetAskUserEnabled(enabled)
    await onRefresh()
  })
  const setBrowser = (skill: SkillRecord, enabled: boolean) => runOperation(skill.id, async () => {
    await onSetBrowserEnabled(enabled)
    await onRefresh()
  })
  const setComputerUse = async (skill: SkillRecord, enabled: boolean) => {
    if (busy) return
    if (enabled && skill.availability?.available === false) {
      operation.setComputerUseAlert(skill.availability.detail)
      if (skill.availability.actionUrl) onOpenExternal(skill.availability.actionUrl)
      return
    }
    await runOperation(skill.id, async () => {
      await onSetComputerUseEnabled(enabled)
      await onRefresh()
    })
  }
  const setMcpSupport = (skill: SkillRecord, enabling: boolean) => runOperation(skill.id, async () => {
    operation.setMcpSupportNotice(enabling ? 'Installing Pi MCP Adapter…' : 'Disabling Pi MCP Adapter…')
    const response = await onSetMcpSupport(enabling)
    if (!response.ok) {
      const busyOutput = /lock file is already being held|settings are busy/i.test(response.output)
      operation.setMcpSupportAlert(busyOutput ? 'Pi settings are busy. Close any other Pi package operation and try again.' : response.output)
    } else {
      operation.setMcpSupportNotice(enabling ? 'Pi MCP Adapter installed.' : 'Pi MCP Adapter disabled.')
    }
  })
  const setMcp = (skill: SkillRecord, enabled: boolean) => runOperation(skill.id, async () => {
    const response = await onSetMcpEnabled({ name: skill.name, scope: skill.location === 'project' ? 'project' : 'user', projectPath: skill.location === 'project' ? activeProjectPath : undefined, enabled })
    if (!response.ok) operation.setCapabilityAlert(response.output)
  })
  const disableCapability = async (skill: SkillRecord) => {
    operation.confirm()
    if (skill.id === 'gooeypi-ask-user') await setAskUser(skill, false)
    else if (skill.id === 'apex-browser') await setBrowser(skill, false)
    else if (skill.id === 'gooeypi-computer-use') await setComputerUse(skill, false)
    else if (skill.id === MCP_SUPPORT_SKILL_ID) await setMcpSupport(skill, false)
    else if (skill.kind === 'mcp') await setMcp(skill, false)
    else if (skill.kind === 'package') await mutate(skill, 'disable')
  }
  const mutate = (skill: SkillRecord, action: CapabilityMutationInput['action']) => runOperation(skill.id, async () => {
    const response = await onMutateCapability({
      kind: skill.kind === 'mcp' ? 'mcp' : 'package',
      action,
      name: skill.name,
      ...(skill.kind === 'mcp' && action === 'remove' && skill.definitionKey !== undefined ? { definitionKey: skill.definitionKey } : {}),
      ...(skill.kind === 'package' ? { source: skill.source } : {}),
      scope: skill.location === 'project' ? 'project' : 'user',
      projectPath: skill.location === 'project' ? activeProjectPath : undefined,
    })
    if (!response.ok) operation.setCapabilityAlert(response.output)
  })
  const removeCapability = async (skill: SkillRecord) => {
    operation.confirm()
    await mutate(skill, 'remove')
  }
  const mcpStatusDetail = (skill: SkillRecord): string | undefined => {
    if (skill.kind !== 'mcp') return undefined
    if (skill.availability?.available === false) return skill.availability.detail
    if (harness === 'pi' && !piMcpAdapterInstalled) return 'Enable Pi MCP Adapter before changing this local MCP server.'
    return undefined
  }
  const capabilityControl = (skill: SkillRecord) => {
    if (skill.kind === 'mcp' && skill.availability?.available === false) {
      const external = skill.availability.detail.includes('managed outside Apex')
      const label = external ? `Externally managed ${skill.name}` : harness === 'pi' ? `Pi MCP Adapter required for ${skill.name}` : `Unavailable ${skill.name}`
      return <span className={`plugin-toggle ${stylex.props(pluginsStyles.pluginToggle).className ?? ""}`} role="img" aria-label={label} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    if (harness === 'pi' && skill.kind === 'mcp' && !piMcpAdapterInstalled) {
      return <span className={`plugin-toggle ${stylex.props(pluginsStyles.pluginToggle).className ?? ""}`} role="img" aria-label={`Pi MCP Adapter required for ${skill.name}`} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    const isBrowser = skill.id === 'apex-browser'
    const actionable = skill.id === 'gooeypi-ask-user' || isBrowser || skill.id === 'gooeypi-computer-use' || skill.id === MCP_SUPPORT_SKILL_ID || skill.kind === 'mcp' || skill.kind === 'package'
    if (!actionable) return <span className={[skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle', stylex.props(pluginsStyles.pluginToggle, skill.enabled && pluginsStyles.pluginToggleIsEnabled).className].filter(Boolean).join(' ')} aria-label={`${skill.enabled ? 'Enabled' : 'Unavailable'} ${skill.name}`}>{skill.enabled ? <Check size={14}/> : <Plus size={14}/>}</span>
    const updating = operation.busyId === skill.id
    const enable = () => {
      if (skill.id === 'gooeypi-ask-user') return setAskUser(skill, true)
      if (isBrowser) return setBrowser(skill, true)
      if (skill.id === 'gooeypi-computer-use') return setComputerUse(skill, true)
      if (skill.id === MCP_SUPPORT_SKILL_ID) return setMcpSupport(skill, true)
      if (skill.kind === 'package') return mutate(skill, 'enable')
      return setMcp(skill, true)
    }
    return <IconButton size="small" xstyle={[pluginsStyles.pluginToggle, skill.enabled && pluginsStyles.pluginToggleIsEnabled]} label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`} aria-pressed={skill.enabled} disabled={busy} title={skill.availability?.detail} className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} onClick={() => { if (skill.enabled) operation.requestDisable(skill); else void enable() }}><span className="plugin-toggle__icons">{updating ? <ArrowsClockwise className={`spin ${stylex.props(activityStyles.spin, overlaysStyles.spin).className ?? ""}`} size={14}/> : skill.enabled ? <><Check className="plugin-toggle__check" size={14}/><X className={`plugin-toggle__disable ${stylex.props(pluginsStyles.pluginToggleDisable).className ?? ""}`} size={14}/></> : <Plus className="plugin-toggle__plus" size={14}/>}</span></IconButton>
  }

  return (
    <div className={`page plugin-page scroll-area ${stylex.props(baseStyles.scrollArea, pagesStyles.page).className ?? ""}`}>
      <div className={`page-container plugin-container ${stylex.props(pagesStyles.pageContainer, pluginsStyles.pluginContainer, [responsiveStyles.pageContainer, responsiveLayoutStyles.pageContainerPageContainer]).className ?? ""}`}>
        <header className={`plugin-header ${stylex.props(pluginsStyles.pluginHeader, [responsiveStyles.pluginHeader, responsiveLayoutStyles.pluginHeader]).className ?? ""}`}>
          <div><span className="eyebrow">{HARNESS_SHORT_NAMES[harness]} capabilities</span><h1>Extend {HARNESS_SHORT_NAMES[harness]}</h1><p className={stylex.props(pagesStyles.prettyText).className}>Manage packages, extensions, MCP servers, and reusable skills for this harness.</p></div>
          <div>
            <ApexButton icon={<ArrowsClockwise className={[loading ? 'spin' : '', stylex.props((loading) && activityStyles.spin, (loading) && overlaysStyles.spin).className].filter(Boolean).join(' ')} size={13}/>} onClick={() => void onRefresh()}>Refresh</ApexButton>
            <ApexButton icon={<SlidersHorizontal size={13}/>} onClick={() => setFilter('installed')}>Manage</ApexButton>
            <ApexButton variant="primary" icon={<Plus size={14}/>} onClick={openAdd}>Add</ApexButton>
          </div>
        </header>
        <TabList xstyle={[pluginsStyles.directoryTabs]} value={tab} onChange={(value) => setTab(value as DirectoryTab)} role="tablist" size="sm" className="directory-tabs"><Tab value="plugins" label="Capabilities" /><Tab value="skills" label="Skills" /></TabList>
        <div className={`directory-tools ${stylex.props(pluginsStyles.directoryTools, [responsiveStyles.directoryTools, responsiveLayoutStyles.directoryTools]).className ?? ""}`}>
          <TextInput label={`Search ${tab === 'plugins' ? 'capabilities' : 'skills'}`} isLabelHidden placeholder={`Search ${tab === 'plugins' ? 'capabilities' : 'skills'}`} startIcon={<MagnifyingGlass size={14}/>} value={query} onChange={setQuery} containerClassName="page-search" containerXstyle={pagesStyles.pageSearch} controlXstyle={pagesStyles.pageSearchControl} />
          <SelectControl label="Directory filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All sources</option><option value="installed">Installed</option><option value="bundled">Bundled</option><option value="user">Personal</option><option value="project">Project</option><option value="system">System</option>
          </SelectControl>
        </div>
        {warnings.map((warning) => (
          <Banner xstyle={[inspectorStyles.pageInlineError]} key={`${warning.scope}:${warning.path}`} status="error" role="alert" className="page-inline-error" title={`${warning.scope === 'project' ? 'Project' : 'Personal'} ${warning.message} (${warning.path})`} />
        ))}
        {capabilityAlert ? <Banner xstyle={[inspectorStyles.pageInlineError]} status="error" role="alert" className="page-inline-error" title={capabilityAlert} /> : null}
        {computerUseAlert ? <Banner xstyle={[inspectorStyles.pageInlineError]} status="error" role="alert" className="page-inline-error" title={computerUseAlert} /> : null}
        {harness === 'pi' && mcpSupportAlert ? <Banner xstyle={[inspectorStyles.pageInlineError]} status="error" role="alert" className="page-inline-error" title={mcpSupportAlert} /> : null}
        {harness === 'pi' && mcpSupportNotice ? <Banner xstyle={[pluginsStyles.connectionWarning]} status="warning" role="status" className="connection-warning" title={mcpSupportNotice} /> : null}
        {harness === 'pi' && !piMcpAdapterInstalled ? <Banner xstyle={[pluginsStyles.connectionWarning]} status="warning" className="connection-warning" title="Pi core has no MCP client. Enable Pi MCP Adapter below before adding servers." /> : null}
        <Banner xstyle={[pluginsStyles.connectionWarning]} status="warning" className="connection-warning" title={NETWORK_MCP_UNAVAILABLE_DETAIL} />
        <div className={`directory-heading ${stylex.props(pluginsStyles.directoryHeading).className ?? ""}`}><h2>{filter === 'installed' ? 'Installed' : tab === 'plugins' ? 'Capabilities' : 'Skills'}</h2><span className={stylex.props(pagesStyles.tabularNums).className}>{visible.length} shown</span></div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${tab}:${filter}`}
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={instant ? undefined : { opacity: 0 }}
            transition={{ duration: instant ? 0 : 0.14, ease: [0.23, 1, 0.32, 1] }}
          >
            {visible.length ? (
              <div className={`directory-list ${stylex.props(pluginsStyles.directoryList, [responsiveStyles.directoryList, responsiveLayoutStyles.directoryList]).className ?? ""}`}>{visible.map((skill) => {
                const statusDetail = mcpStatusDetail(skill)
                return <article key={skill.id}>
                  <span className={[`directory-icon directory-icon--${skill.kind}`, stylex.props(pluginsStyles.directoryIcon, ((skill.kind === "mcp")) && pluginsStyles.directoryIconMcp, ((skill.kind === "prompt")) && pluginsStyles.directoryIconPrompt).className].filter(Boolean).join(' ')}><SkillIcon skill={skill}/></span>
                  <div><div><h3>{skill.name}</h3><span>{skill.location}</span></div><p id={statusDetail ? capabilityDetailId(skill) : undefined}>{skill.description}{statusDetail ? ` ${statusDetail}` : ''}</p></div>
                  <div className="capability-actions">
                    {skill.kind === 'package' || skill.kind === 'mcp' && skill.location !== 'bundled' && skill.location !== 'system' && skill.definitionRemovalAvailable !== false ? <IconButton size="small" className="plugin-remove" label={`Remove ${skill.name}`} disabled={busy} onClick={() => operation.requestRemove(skill)}><Trash size={13}/></IconButton> : null}
                    {capabilityControl(skill)}
                  </div>
                </article>
              })}</div>
            ) : <EmptyState icon={<Sparkle size={23}/>} title="Nothing here yet">Try another filter or add a capability package supported by {HARNESS_SHORT_NAMES[harness]}.</EmptyState>}
          </motion.div>
        </AnimatePresence>

        {confirmDisable ? <Modal title={`Disable ${confirmDisable.name}?`} onClose={() => operation.cancelConfirm()} footer={<><ApexButton variant="quiet" onClick={() => operation.cancelConfirm()}>Cancel</ApexButton><ApexButton variant="danger" onClick={() => void disableCapability(confirmDisable)}>Yes, disable</ApexButton></>}><p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>Are you sure? New sessions will no longer receive this capability until you enable it again. Installed files, server settings, and saved authorization are kept.</p></Modal> : null}
        {confirmRemove ? <Modal title={`Remove ${confirmRemove.name}?`} onClose={() => operation.cancelConfirm()} footer={<><ApexButton variant="quiet" onClick={() => operation.cancelConfirm()}>Cancel</ApexButton><ApexButton variant="danger" onClick={() => void removeCapability(confirmRemove)}>Yes, remove completely</ApexButton></>}><p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>Are you sure? This removes {confirmRemove.kind === 'mcp' ? 'only the server definition; Pi-owned authorization is not changed.' : 'the package registration and harness-managed files.'} Other packages and MCP entries will be kept.</p></Modal> : null}

        {addOpen ? (
          <Modal
            title={addDraft.kind ? `Add ${addDraft.kind === 'mcp' ? 'MCP server' : addDraft.kind === 'extension' ? 'extension' : PACKAGE_LABELS[harness].toLowerCase()}` : `Add a ${HARNESS_SHORT_NAMES[harness]} capability`}
            onClose={() => sendAdd({ type: 'CLOSE' })}
            footer={addDraft.kind
              ? <><ApexButton icon={<ArrowLeft size={13}/>} onClick={() => sendAdd({ type: 'BACK' })}>Back</ApexButton><ApexButton variant="primary" disabled={!canAdd || adding} onClick={() => void add()}>{adding ? (addDraft.kind === 'mcp' ? 'Saving…' : 'Installing…') : (addDraft.kind === 'mcp' ? 'Save local server' : addDraft.kind === 'extension' ? 'Install extension' : 'Install package')}</ApexButton></>
              : <ApexButton variant="quiet" onClick={() => sendAdd({ type: 'CLOSE' })}>Cancel</ApexButton>}
          >
            {addDraft.kind === null ? (
              <div className={`capability-choice-list ${stylex.props(pluginsStyles.capabilityChoiceList).className ?? ""}`}>
                <button type="button" disabled={!piMcpAdapterInstalled} onClick={() => sendAdd({ type: 'CHOOSE', kind: 'mcp' })}>
                  <span><Globe size={17}/></span><span><strong>Add MCP</strong><small>{!piMcpAdapterInstalled ? 'Enable Pi MCP Adapter first' : 'Add a local stdio server; network servers stay externally managed'}</small></span><CaretRight size={15}/>
                </button>
                <button type="button" onClick={() => sendAdd({ type: 'CHOOSE', kind: 'bundle' })}>
                  <span><Package size={17}/></span><span><strong>Add Package</strong><small>{PACKAGE_HELP[harness]}</small></span><CaretRight size={15}/>
                </button>
                <button type="button" onClick={() => sendAdd({ type: 'CHOOSE', kind: 'extension' })}>
                  <span><FileCode size={17}/></span><span><strong>Add Extension</strong><small>Install one local JavaScript or TypeScript extension module for {HARNESS_SHORT_NAMES[harness]}.</small></span><CaretRight size={15}/>
                </button>
                <p className={`capability-compatibility-note ${stylex.props(pluginsStyles.capabilityCompatibilityNote).className ?? ""}`}><Warning size={13}/><span>Not every third-party package, plugin, or extension will work in Apex. If something fails, <button type="button" onClick={() => onOpenExternal(GITHUB_ISSUES_URL)}>create a GitHub issue</button>.</span></p>
              </div>
            ) : addDraft.kind === 'bundle' ? (
              <div className={`add-tool-form ${stylex.props(pluginsStyles.addToolForm).className ?? ""}`}>
                <p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>{PACKAGE_HELP[harness]} This installs executable code; it does not connect to an arbitrary MCP endpoint.</p>
                <TextInput label={`${PACKAGE_LABELS[harness]} source`} value={addDraft.source} hasAutoFocus onChange={(value) => setAddField('source', value)} placeholder="npm:@scope/package" containerClassName="field" />
                <small className={`field-help ${stylex.props(pluginsStyles.fieldHelp).className ?? ""}`}>Examples: a Git URL, <code>npm:@scope/package</code>, or an absolute local folder path.</small>
              </div>
            ) : addDraft.kind === 'extension' ? (
              <div className={`add-tool-form ${stylex.props(pluginsStyles.addToolForm).className ?? ""}`}>
                <p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>Pi records a standalone local extension file through its native package manager. The original file remains the source of truth.</p>
                <TextInput label="Extension file" value={addDraft.source} hasAutoFocus onChange={(value) => setAddField('source', value)} placeholder="/absolute/path/to/my-extension.ts" containerClassName="field" />
                <small className={`field-help ${stylex.props(pluginsStyles.fieldHelp).className ?? ""}`}>Choose an absolute local <code>.ts</code>, <code>.js</code>, <code>.mjs</code>, or <code>.cjs</code> file. Extensions run with your user permissions.</small>
                <div className={`field ${stylex.props(overlaysStyles.field).className ?? ""}`}><span>Available in</span><SelectControl label="Available in" value={addDraft.scope} onChange={(event) => setAddField('scope', event.target.value)}><option value="user">All projects (personal)</option><option value="project" disabled={!activeProjectPath}>Current project</option></SelectControl></div>
                <Banner xstyle={[pluginsStyles.connectionWarning]} status="warning" className="connection-warning" title="Extension APIs differ between harnesses. Apex installs the file correctly, but CLI-specific UI may not render in the desktop app." />
              </div>
            ) : (
              <div className={`add-tool-form ${stylex.props(pluginsStyles.addToolForm).className ?? ""}`}>
                <p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>Add a local stdio server to pi-mcp-adapter’s configuration. HTTP/SSE servers and OAuth are managed outside Apex.</p>
                <TextInput label="Server name" value={addDraft.mcpName} hasAutoFocus onChange={(value) => setAddField('mcpName', value)} placeholder="my-local-tools" containerClassName="field" />
                <p className={`field-help ${stylex.props(pluginsStyles.fieldHelp).className ?? ""}`}>{MCP_STDIO_HELP[harness]}</p>
                <TextInput label="Executable" value={addDraft.mcpCommand} onChange={(value) => setAddField('mcpCommand', value)} placeholder="npx" containerClassName="field" />
                <TextArea label="Arguments (one per line)" value={addDraft.mcpArgs} onChange={(value) => setAddField('mcpArgs', value)} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/project'} containerClassName="field" />
                <div className={`field ${stylex.props(overlaysStyles.field).className ?? ""}`}><span>Available in</span><SelectControl label="Available in" value={addDraft.scope} onChange={(event) => setAddField('scope', event.target.value)}><option value="user">All projects (personal)</option><option value="project" disabled={!activeProjectPath}>Current project</option></SelectControl></div>
                <Banner xstyle={[pluginsStyles.connectionWarning]} status="warning" className="connection-warning" title="Only connect servers you trust. MCP tools can read data or run actions with your user permissions." />
              </div>
            )}
            {addDraft.output ? <pre className={`install-output ${stylex.props(pluginsStyles.installOutput).className ?? ""}`} role="status">{addDraft.output}</pre> : null}
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
