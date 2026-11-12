import { ArrowLeft, ArrowsClockwise, BookOpen, CaretRight, Check, FileCode, FileText, GitFork, Globe, MagicWand, MagnifyingGlass, Package, Palette, Plus, ShieldCheck, SlidersHorizontal, Sparkle, Trash, Warning, X } from '@/components/icons'
import { useMemo, useState } from 'react'
import type { CapabilityMutationInput, ExtensionInstallInput, HarnessId, McpConnectionInput, McpStateInput, PluginWarning, SkillRecord } from '@/types/api'
import { HARNESS_SHORT_NAMES } from '@/lib/harness'
import { NETWORK_MCP_UNAVAILABLE_DETAIL } from '@/lib/mcp-policy'
import { EmptyState, Modal } from '@/components/ui'
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
  const addFlow = useAddCapabilityFlow()
  const operation = usePluginOperation()
  const { snapshot: addSnapshot, send: sendAdd } = addFlow
  const addDraft = addSnapshot.context
  const addOpen = !addSnapshot.matches('closed')
  const adding = addSnapshot.matches('submitting')
  const busy = operation.busyId !== null
  const [computerUseAlert, setComputerUseAlert] = useState('')
  const [mcpSupportAlert, setMcpSupportAlert] = useState('')
  const [mcpSupportNotice, setMcpSupportNotice] = useState('')
  const [confirmDisable, setConfirmDisable] = useState<SkillRecord | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<SkillRecord | null>(null)
  const [capabilityAlert, setCapabilityAlert] = useState('')
  const piMcpAdapterInstalled = skills.some((skill) => skill.id === 'gooeypi-pi-mcp' && skill.enabled)
  const canConfigureMcp = piMcpAdapterInstalled

  const visible = useMemo(() => skills.map((skill) => skill.id === 'gooeypi-ask-user'
    ? { ...skill, enabled: askUserEnabled }
    : skill.id === 'prime-work-browser' ? { ...skill, enabled: browserEnabled }
    : skill.id === 'gooeypi-computer-use' ? { ...skill, enabled: computerUseEnabled } : skill).filter((skill) => {
    const capability = skill.id === 'prime-work-browser' || skill.kind !== 'skill' && skill.kind !== 'prompt'
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
      setComputerUseAlert(skill.availability.detail)
      if (skill.availability.actionUrl) onOpenExternal(skill.availability.actionUrl)
      return
    }
    setComputerUseAlert('')
    await runOperation(skill.id, async () => {
      await onSetComputerUseEnabled(enabled)
      await onRefresh()
    })
  }
  const setMcpSupport = (skill: SkillRecord, enabling: boolean) => runOperation(skill.id, async () => {
    setMcpSupportAlert('')
    setMcpSupportNotice(enabling ? 'Installing Pi MCP Adapter…' : 'Disabling Pi MCP Adapter…')
    const response = await onSetMcpSupport(enabling)
    if (!response.ok) {
      const busyOutput = /lock file is already being held|settings are busy/i.test(response.output)
      setMcpSupportAlert(busyOutput ? 'Pi settings are busy. Close any other Pi package operation and try again.' : response.output)
      setMcpSupportNotice('')
    } else {
      setMcpSupportNotice(enabling ? 'Pi MCP Adapter installed.' : 'Pi MCP Adapter disabled.')
    }
  })
  const mcpServerName = (skill: SkillRecord): string => skill.id.startsWith('prime-mcp-') ? skill.id.slice('prime-mcp-'.length) : skill.name
  const setMcp = (skill: SkillRecord, enabled: boolean) => runOperation(skill.id, async () => {
    setCapabilityAlert('')
    if (skill.id.startsWith('prime-mcp-')) {
      const response = await onMutateCapability({ kind: 'mcp', action: enabled ? 'enable' : 'disable', name: mcpServerName(skill), scope: 'user' })
      if (!response.ok) setCapabilityAlert(response.output)
    } else {
      const response = await onSetMcpEnabled({ name: skill.name, scope: skill.location === 'project' ? 'project' : 'user', projectPath: skill.location === 'project' ? activeProjectPath : undefined, enabled })
      if (!response.ok) setCapabilityAlert(response.output)
    }
  })
  const disableCapability = async (skill: SkillRecord) => {
    setConfirmDisable(null)
    if (skill.id === 'gooeypi-ask-user') await setAskUser(skill, false)
    else if (skill.id === 'prime-work-browser') await setBrowser(skill, false)
    else if (skill.id === 'gooeypi-computer-use') await setComputerUse(skill, false)
    else if (skill.id === MCP_SUPPORT_SKILL_ID) await setMcpSupport(skill, false)
    else if (skill.kind === 'mcp') await setMcp(skill, false)
    else if (skill.kind === 'package') await mutate(skill, 'disable')
  }
  const mutate = (skill: SkillRecord, action: CapabilityMutationInput['action']) => runOperation(skill.id, async () => {
    setCapabilityAlert('')
    const response = await onMutateCapability({
      kind: skill.kind === 'mcp' ? 'mcp' : 'package',
      action,
      name: skill.kind === 'mcp' ? mcpServerName(skill) : skill.name,
      ...(skill.kind === 'mcp' && action === 'remove' && skill.definitionKey !== undefined ? { definitionKey: skill.definitionKey } : {}),
      ...(skill.kind === 'package' ? { source: skill.source } : {}),
      scope: skill.location === 'project' ? 'project' : 'user',
      projectPath: skill.location === 'project' ? activeProjectPath : undefined,
    })
    if (!response.ok) setCapabilityAlert(response.output)
  })
  const removeCapability = async (skill: SkillRecord) => {
    setConfirmRemove(null)
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
      return <span className="plugin-toggle" role="img" aria-label={label} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    if (harness === 'pi' && skill.kind === 'mcp' && !piMcpAdapterInstalled) {
      return <span className="plugin-toggle" role="img" aria-label={`Pi MCP Adapter required for ${skill.name}`} aria-describedby={capabilityDetailId(skill)}><ShieldCheck aria-hidden="true" size={14}/></span>
    }
    const isBrowser = skill.id === 'prime-work-browser'
    const actionable = skill.id === 'gooeypi-ask-user' || isBrowser || skill.id === 'gooeypi-computer-use' || skill.id === MCP_SUPPORT_SKILL_ID || skill.kind === 'mcp' || skill.kind === 'package'
    if (!actionable) return <span className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={`${skill.enabled ? 'Enabled' : 'Unavailable'} ${skill.name}`}>{skill.enabled ? <Check size={14}/> : <Plus size={14}/>}</span>
    const updating = operation.busyId === skill.id
    const enable = () => {
      if (skill.id === 'gooeypi-ask-user') return setAskUser(skill, true)
      if (isBrowser) return setBrowser(skill, true)
      if (skill.id === 'gooeypi-computer-use') return setComputerUse(skill, true)
      if (skill.id === MCP_SUPPORT_SKILL_ID) return setMcpSupport(skill, true)
      if (skill.kind === 'package') return mutate(skill, 'enable')
      return setMcp(skill, true)
    }
    return <button type="button" className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`} aria-pressed={skill.enabled} disabled={busy} title={skill.availability?.detail} onClick={() => { if (skill.enabled) setConfirmDisable(skill); else void enable() }}>{updating ? <ArrowsClockwise className="spin" size={14}/> : skill.enabled ? <><Check className="plugin-toggle__check" size={14}/><X className="plugin-toggle__disable" size={14}/></> : <Plus className="plugin-toggle__plus" size={14}/>}</button>
  }

  return (
    <div className="page plugin-page scroll-area">
      <div className="page-container plugin-container">
        <header className="plugin-header">
          <div><span className="eyebrow">{HARNESS_SHORT_NAMES[harness]} capabilities</span><h1>Extend {HARNESS_SHORT_NAMES[harness]}</h1><p>Manage packages, extensions, MCP servers, and reusable skills for this harness.</p></div>
          <div>
            <button type="button" className="button" onClick={() => void onRefresh()}><ArrowsClockwise className={loading ? 'spin' : ''} size={13}/> Refresh</button>
            <button type="button" className="button" onClick={() => setFilter('installed')}><SlidersHorizontal size={13}/> Manage</button>
            <button type="button" className="button button--primary" onClick={openAdd}><Plus size={14}/> Add</button>
          </div>
        </header>
        <div className="directory-tabs">
          <button type="button" className={tab === 'plugins' ? 'is-active' : ''} onClick={() => setTab('plugins')}>Capabilities</button>
          <button type="button" className={tab === 'skills' ? 'is-active' : ''} onClick={() => setTab('skills')}>Skills</button>
        </div>
        <div className="directory-tools">
          <label className="page-search"><MagnifyingGlass size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab === 'plugins' ? 'capabilities' : 'skills'}`}/></label>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Directory filter">
            <option value="all">All sources</option><option value="installed">Installed</option><option value="bundled">Bundled</option><option value="user">Personal</option><option value="project">Project</option><option value="system">System</option>
          </select>
        </div>
        {warnings.map((warning) => (
          <p key={`${warning.scope}:${warning.path}`} className="page-inline-error" role="alert">
            <Warning size={13} /> {warning.scope === 'project' ? 'Project' : 'Personal'} {warning.message} ({warning.path})
          </p>
        ))}
        {capabilityAlert ? <p className="page-inline-error" role="alert"><Warning size={13}/> {capabilityAlert}</p> : null}
        {computerUseAlert ? <p className="page-inline-error" role="alert"><Warning size={13}/> {computerUseAlert}</p> : null}
        {harness === 'pi' && mcpSupportAlert ? <p className="page-inline-error" role="alert"><Warning size={13}/> {mcpSupportAlert}</p> : null}
        {harness === 'pi' && mcpSupportNotice ? <p className="connection-warning" role="status">{operation.busyId === MCP_SUPPORT_SKILL_ID ? <ArrowsClockwise className="spin" size={13}/> : <ShieldCheck size={13}/>} {mcpSupportNotice}</p> : null}
        {harness === 'pi' && !piMcpAdapterInstalled ? <p className="connection-warning"><ShieldCheck size={13}/> Pi core has no MCP client. Enable Pi MCP Adapter below before adding servers.</p> : null}
        <p className="connection-warning"><ShieldCheck size={13}/> {NETWORK_MCP_UNAVAILABLE_DETAIL}</p>
        <div className="directory-heading"><h2>{filter === 'installed' ? 'Installed' : tab === 'plugins' ? 'Capabilities' : 'Skills'}</h2><span>{visible.length} shown</span></div>
        {visible.length ? (
          <div className="directory-list">{visible.map((skill) => {
            const statusDetail = mcpStatusDetail(skill)
            return <article key={skill.id}>
              <span className={`directory-icon directory-icon--${skill.kind}`}><SkillIcon skill={skill}/></span>
              <div><div><h3>{skill.name}</h3><span>{skill.location}</span></div><p id={statusDetail ? capabilityDetailId(skill) : undefined}>{skill.description}{statusDetail ? ` ${statusDetail}` : ''}</p></div>
              <div className="capability-actions">
                {skill.kind === 'package' || skill.kind === 'mcp' && skill.location !== 'bundled' && skill.location !== 'system' && skill.definitionRemovalAvailable !== false ? <button type="button" className="plugin-remove" aria-label={`Remove ${skill.name}`} disabled={busy} onClick={() => setConfirmRemove(skill)}><Trash size={13}/></button> : null}
                {capabilityControl(skill)}
              </div>
            </article>
          })}</div>
        ) : <EmptyState icon={<Sparkle size={23}/>} title="Nothing here yet">Try another filter or add a capability package supported by {HARNESS_SHORT_NAMES[harness]}.</EmptyState>}

        {confirmDisable ? <Modal title={`Disable ${confirmDisable.name}?`} onClose={() => setConfirmDisable(null)} footer={<><button type="button" className="button" onClick={() => setConfirmDisable(null)}>Cancel</button><button type="button" className="button button--danger" onClick={() => void disableCapability(confirmDisable)}>Yes, disable</button></>}><p className="modal-intro">Are you sure? New sessions will no longer receive this capability until you enable it again. Installed files, server settings, and saved authorization are kept.</p></Modal> : null}
        {confirmRemove ? <Modal title={`Remove ${confirmRemove.name}?`} onClose={() => setConfirmRemove(null)} footer={<><button type="button" className="button" onClick={() => setConfirmRemove(null)}>Cancel</button><button type="button" className="button button--danger" onClick={() => void removeCapability(confirmRemove)}>Yes, remove completely</button></>}><p className="modal-intro">Are you sure? This removes {confirmRemove.kind === 'mcp' ? 'only the server definition; Pi-owned authorization is not changed.' : 'the package registration and harness-managed files.'} Other packages and MCP entries will be kept.</p></Modal> : null}

        {addOpen ? (
          <Modal
            title={addDraft.kind ? `Add ${addDraft.kind === 'mcp' ? 'MCP server' : addDraft.kind === 'extension' ? 'extension' : PACKAGE_LABELS[harness].toLowerCase()}` : `Add a ${HARNESS_SHORT_NAMES[harness]} capability`}
            onClose={() => sendAdd({ type: 'CLOSE' })}
            footer={addDraft.kind
              ? <><button type="button" className="button" onClick={() => sendAdd({ type: 'BACK' })}><ArrowLeft size={13}/> Back</button><button type="button" className="button button--primary" disabled={!canAdd || adding} onClick={() => void add()}>{adding ? (addDraft.kind === 'mcp' ? 'Saving…' : 'Installing…') : (addDraft.kind === 'mcp' ? 'Save local server' : addDraft.kind === 'extension' ? 'Install extension' : 'Install package')}</button></>
              : <button type="button" className="button" onClick={() => sendAdd({ type: 'CLOSE' })}>Cancel</button>}
          >
            {addDraft.kind === null ? (
              <div className="capability-choice-list">
                <button type="button" disabled={!piMcpAdapterInstalled} onClick={() => sendAdd({ type: 'CHOOSE', kind: 'mcp' })}>
                  <span><Globe size={17}/></span><span><strong>Add MCP</strong><small>{!piMcpAdapterInstalled ? 'Enable Pi MCP Adapter first' : 'Add a local stdio server; network servers stay externally managed'}</small></span><CaretRight size={15}/>
                </button>
                <button type="button" onClick={() => sendAdd({ type: 'CHOOSE', kind: 'bundle' })}>
                  <span><Package size={17}/></span><span><strong>Add Package</strong><small>{PACKAGE_HELP[harness]}</small></span><CaretRight size={15}/>
                </button>
                <button type="button" onClick={() => sendAdd({ type: 'CHOOSE', kind: 'extension' })}>
                  <span><FileCode size={17}/></span><span><strong>Add Extension</strong><small>Install one local JavaScript or TypeScript extension module for {HARNESS_SHORT_NAMES[harness]}.</small></span><CaretRight size={15}/>
                </button>
                <p className="capability-compatibility-note"><Warning size={13}/><span>Not every third-party package, plugin, or extension will work in Apex. If something fails, <button type="button" onClick={() => onOpenExternal(GITHUB_ISSUES_URL)}>create a GitHub issue</button>.</span></p>
              </div>
            ) : addDraft.kind === 'bundle' ? (
              <div className="add-tool-form">
                <p className="modal-intro">{PACKAGE_HELP[harness]} This installs executable code; it does not connect to an arbitrary MCP endpoint.</p>
                <label className="field"><span>{PACKAGE_LABELS[harness]} source</span><input autoFocus value={addDraft.source} onChange={(event) => setAddField('source', event.target.value)} placeholder="npm:@scope/package"/></label>
                <small className="field-help">Examples: a Git URL, <code>npm:@scope/package</code>, or an absolute local folder path.</small>
              </div>
            ) : addDraft.kind === 'extension' ? (
              <div className="add-tool-form">
                <p className="modal-intro">Pi records a standalone local extension file through its native package manager. The original file remains the source of truth.</p>
                <label className="field"><span>Extension file</span><input autoFocus value={addDraft.source} onChange={(event) => setAddField('source', event.target.value)} placeholder="/absolute/path/to/my-extension.ts"/></label>
                <small className="field-help">Choose an absolute local <code>.ts</code>, <code>.js</code>, <code>.mjs</code>, or <code>.cjs</code> file. Extensions run with your user permissions.</small>
                <label className="field"><span>Available in</span><select value={addDraft.scope} onChange={(event) => setAddField('scope', event.target.value)}><option value="user">All projects (personal)</option><option value="project" disabled={!activeProjectPath}>Current project</option></select></label>
                <p className="connection-warning"><ShieldCheck size={13}/> Extension APIs differ between harnesses. Apex installs the file correctly, but CLI-specific UI may not render in the desktop app.</p>
              </div>
            ) : (
              <div className="add-tool-form">
                <p className="modal-intro">Add a local stdio server to pi-mcp-adapter’s configuration. HTTP/SSE servers and OAuth are managed outside Apex.</p>
                <label className="field"><span>Server name</span><input autoFocus value={addDraft.mcpName} onChange={(event) => setAddField('mcpName', event.target.value)} placeholder="my-local-tools"/></label>
                <p className="field-help">{MCP_STDIO_HELP[harness]}</p>
                <label className="field"><span>Executable</span><input value={addDraft.mcpCommand} onChange={(event) => setAddField('mcpCommand', event.target.value)} placeholder="npx"/></label>
                <label className="field"><span>Arguments <small>(one per line)</small></span><textarea value={addDraft.mcpArgs} onChange={(event) => setAddField('mcpArgs', event.target.value)} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/project'}/></label>
                <label className="field"><span>Available in</span><select value={addDraft.scope} onChange={(event) => setAddField('scope', event.target.value)}><option value="user">All projects (personal)</option><option value="project" disabled={!activeProjectPath}>Current project</option></select></label>
                <p className="connection-warning"><ShieldCheck size={13}/> Only connect servers you trust. MCP tools can read data or run actions with your user permissions.</p>
              </div>
            )}
            {addDraft.output ? <pre className="install-output" role="status">{addDraft.output}</pre> : null}
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
