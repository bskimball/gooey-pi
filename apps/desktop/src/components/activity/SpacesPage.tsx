import * as stylex from '@stylexjs/stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TextArea } from '@astryxdesign/core/TextArea'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Folder, Globe, Plus, PencilSimple, Stack, X } from '@/components/icons'
import { styles } from './spaces-page.stylex'
import { ActivityCoordinator } from './ActivityCoordinator'
import { ChiefOfStaffOpening } from './ChiefOfStaffOpening'
import { ApexButton, IconButton, SelectControl } from '@/components/ui'
import type { ActivityPageProps } from '@/pages/ActivityPage'
import type { SpaceRecord } from '@/types/api'


const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function SpacesPage({ bridge, sessions, projects, controls, showReasoning, showTools, messageEnterAction, renderInspector, contentRef, contentInert }: ActivityPageProps) {
  const instant = Boolean(useReducedMotion()) || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) || Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
  const [spaces, setSpaces] = useState<SpaceRecord[]>([])
  const [selectedId, setSelectedId] = useState<string>('global')
  // The embedded Chief portals its chat actions here so they share the toolbar line.
  const [chatActions, setChatActions] = useState<HTMLSpanElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string>()
  const [listRevision, setListRevision] = useState(0)
  const [refreshError, setRefreshError] = useState<string>()
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [projectId, setProjectId] = useState('')
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [threadQuery, setThreadQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const mutationGeneration = useRef(0)
  useEffect(() => {
    let active = true
    if (!bridge) return
    setLoading(true)
    setListError(undefined)
    bridge.spaces
      .list()
      .then((records) => {
        if (active) {
          setSpaces(records)
          let saved: string | null = null
          try {
            saved = window.localStorage.getItem('apex.activity.selected-space')
          } catch {
            /* storage can be unavailable */
          }
          const resolved = saved && (saved === 'global' || records.some((item) => item.id === saved)) ? saved : (records[0]?.id ?? 'global')
          setSelectedId(resolved)
          try {
            window.localStorage.setItem('apex.activity.selected-space', resolved)
          } catch {
            /* storage can be unavailable */
          }
        }
      })
      .catch((reason: unknown) => {
        if (active) setListError(message(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [bridge, listRevision])
  useEffect(() => {
    if (!bridge || loading || listError) return
    let active = true
    const refresh = () => {
      const generation = mutationGeneration.current
      void bridge.spaces
        .list()
        .then((records) => {
          if (active && generation === mutationGeneration.current) {
            setSpaces(records)
            setRefreshError(undefined)
          }
        })
        .catch((reason: unknown) => {
          if (active && generation === mutationGeneration.current) setRefreshError(message(reason))
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [bridge, sessions, loading, listError, refreshRevision])
  const space = spaces.find((item) => item.id === selectedId)
  const project = projects.find((item) => item.id === space?.projectId)
  const scoped = useMemo(
    () => sessions.filter((session) => session.role !== 'coordinator' && session.depth === 0 && !!project && [project.path, project.primaryFolder, ...project.folders].includes(session.projectPath)),
    [sessions, project],
  )
  const linked = scoped.filter((session) => space?.sessionIds.includes(session.id))
  const candidates = scoped.filter((session) => !session.archived && !space?.sessionIds.includes(session.id) && session.title.toLowerCase().includes(threadQuery.trim().toLowerCase()))
  const save = async (changes: { objective?: string; addSessionIds?: string[]; removeSessionIds?: string[] }) => {
    if (!bridge || !space || saving) return
    mutationGeneration.current += 1
    setSaving(true)
    setError(undefined)
    try {
      const updated = await bridge.spaces.update(space.id, changes)
      setSpaces((all) => all.map((item) => (item.id === updated.id ? updated : item)))
      setEditing(false)
    } catch (reason) {
      setError(message(reason))
    } finally {
      mutationGeneration.current += 1
      setSaving(false)
    }
  }
  const create = async () => {
    if (!bridge || !name.trim() || !projectId || saving) return
    mutationGeneration.current += 1
    setSaving(true)
    setError(undefined)
    try {
      const created = await bridge.spaces.create({ name: name.trim(), objective: objective.trim(), projectId })
      setSpaces((all) => [...all, created])
      choose(created.id)
      setCreating(false)
      setName('')
      setObjective('')
    } catch (reason) {
      setError(message(reason))
    } finally {
      mutationGeneration.current += 1
      setSaving(false)
    }
  }
  const choose = (id: string) => {
    setSelectedId(id)
    try {
      window.localStorage.setItem('apex.activity.selected-space', id)
    } catch {
      /* storage can be unavailable */
    }
    setEditing(false)
    setLinking(false)
    setThreadQuery('')
    setCreating(false)
    setError(undefined)
  }
  const startCreating = () => {
    setCreating(true)
    setEditing(false)
    setLinking(false)
    setError(undefined)
    setObjective('')
  }
  const sidebar = (
    <div {...stylex.props(styles.sidebar)}>
      <section {...stylex.props(styles.section)} aria-label="Spaces">
        <div {...stylex.props(styles.sectionHeading)}>
          <h3 {...stylex.props(styles.sectionTitle)}>Spaces</h3>
          <span {...stylex.props(styles.count)}>{spaces.length}</span>
        </div>
        <nav {...stylex.props(styles.nav)} aria-label="Choose a space">
          <button type="button" {...stylex.props(styles.navButton, selectedId === 'global' && styles.navSelected)} disabled={saving} onClick={() => choose('global')} aria-pressed={selectedId === 'global'}>
            <span {...stylex.props(styles.navContent)}><Globe size={16} /><span {...stylex.props(styles.navLabel)}>Global Chief</span>{selectedId === 'global' ? <Check size={13} {...stylex.props(styles.selectedIcon)} /> : null}</span>
          </button>
          {loading || listError ? <div {...stylex.props(styles.section)}>
            <p {...stylex.props(styles.muted)} role="status">{loading ? 'Loading spaces...' : 'Space list unavailable'}</p>
            {listError ? <ApexButton compact onClick={() => setListRevision((value) => value + 1)}>Retry</ApexButton> : null}
          </div> : spaces.map((item) => (
            <button type="button" key={item.id} {...stylex.props(styles.navButton, selectedId === item.id && styles.navSelected)} disabled={saving} onClick={() => choose(item.id)} aria-pressed={selectedId === item.id} title={item.name}>
              <span {...stylex.props(styles.navContent)}><Stack size={16} /><span {...stylex.props(styles.navLabel)}>{item.name}</span>{selectedId === item.id ? <Check size={13} {...stylex.props(styles.selectedIcon)} /> : null}</span>
            </button>
          ))}
        </nav>
        {refreshError ? <div {...stylex.props(styles.section)}><Banner status="error" role="status" title={`Spaces could not refresh: ${refreshError}`} /><ApexButton compact onClick={() => setRefreshRevision((value) => value + 1)}>Retry</ApexButton></div> : null}
      </section>
      {!creating && !loading && !listError ? <>
        <section {...stylex.props(styles.section, styles.divider)} aria-label="Context">
          <h3 {...stylex.props(styles.sectionTitle)}>Context</h3>
          <div {...stylex.props(styles.scope)}>{space ? <Folder size={14} /> : <Globe size={14} />}<span>{space ? project?.name ?? 'Unavailable project' : 'All authorized projects'}</span></div>
          <p {...stylex.props(styles.muted)}>{space ? 'Chief of Staff can work across this project. Linked threads give it shared context.' : 'Chief of Staff coordinates work across your projects. Choose a Space for a focused objective.'}</p>
        </section>
        {space ? <>
          <section {...stylex.props(styles.section)} aria-label="Space objective">
            <div {...stylex.props(styles.sectionHeading)}>
              <h3 {...stylex.props(styles.sectionTitle)}>Objective</h3>
              {!editing ? <IconButton label="Edit objective" disabled={saving} onClick={() => { setObjective(space.objective); setEditing(true); setLinking(false); setError(undefined) }}><PencilSimple size={14} /></IconButton> : null}
            </div>
            {editing ? <form {...stylex.props(styles.editForm)} onSubmit={(event) => { event.preventDefault(); void save({ objective }) }}>
              <TextArea label="Objective" value={objective} onChange={setObjective} />
              <div {...stylex.props(styles.actions)}><ApexButton type="submit" compact disabled={saving}>Save</ApexButton><ApexButton variant="quiet" compact type="button" disabled={saving} onClick={() => { setEditing(false); setError(undefined) }}>Cancel</ApexButton></div>
            </form> : <p {...stylex.props(styles.objectiveText)}>{space.objective || 'Add an objective for this space.'}</p>}
          </section>
          <section {...stylex.props(styles.section, styles.divider)} aria-label="Linked threads">
            <div {...stylex.props(styles.sectionHeading)}>
              <h3 {...stylex.props(styles.sectionTitle)}>{linked.length} linked {linked.length === 1 ? 'thread' : 'threads'}</h3>
            </div>
            <ApexButton variant="quiet" compact xstyle={styles.manageButton} aria-expanded={linking} disabled={saving} onClick={() => { setLinking(!linking); setThreadQuery(''); setEditing(false); setError(undefined) }}>{linking ? 'Done managing' : 'Manage linked threads'}</ApexButton>
            {linking ? <div {...stylex.props(styles.linkList)}>
              {linked.length ? <div {...stylex.props(styles.threadList)}>
                {linked.map((item) => <div key={item.id} {...stylex.props(styles.threadRow)}>
                  <span {...stylex.props(styles.threadTitle)}>{item.title}</span>
                  <IconButton label={'Unlink ' + item.title} title="Unlink thread" xstyle={styles.remove} disabled={saving} onClick={() => void save({ removeSessionIds: [item.id] })}><X size={13} /></IconButton>
                </div>)}
              </div> : <p {...stylex.props(styles.muted)}>No threads linked yet.</p>}
              <TextInput label="Find a thread to link" value={threadQuery} onChange={setThreadQuery} />
              {candidates.slice(0, 100).map((item) => <ApexButton key={item.id} variant="quiet" xstyle={styles.linkButton} disabled={saving} aria-label={'Link ' + item.title} icon={<Plus size={13} />} onClick={() => void save({ addSessionIds: [item.id] })}>{item.title}</ApexButton>)}
              {!candidates.length ? <p {...stylex.props(styles.muted)}>{threadQuery.trim() ? 'No matching threads in this project.' : 'No other threads to link.'}</p> : null}
              {candidates.length > 100 ? <p {...stylex.props(styles.muted)}>Showing 100 threads. Search to narrow the list.</p> : null}
            </div> : null}
          </section>
        </> : null}
        {error ? <Banner status="error" role="alert" title={error} /> : null}
      </> : null}
    </div>
  )
  return (
    <>
      <div ref={contentRef} inert={contentInert} className={['activity-main', stylex.props(styles.page).className].filter(Boolean).join(' ')}>
        <header {...stylex.props(styles.toolbar)}>
          <div {...stylex.props(styles.identity)}>
            <span {...stylex.props(styles.kicker)}>Spaces</span>
            <h2 {...stylex.props(styles.title)}>{creating ? 'New space' : space?.name ?? 'Global Chief of Staff'}</h2>
            {!creating ? <div {...stylex.props(styles.scope)}>
              {space ? <Folder size={13} /> : <Globe size={13} />}
              <span>{space ? 'Project: ' + (project?.name ?? 'Unavailable project') : 'All authorized projects'}</span>
            </div> : null}
          </div>
          <div {...stylex.props(styles.actions)}>
            <span ref={setChatActions} {...stylex.props(styles.chatActions)} />
            <ApexButton variant="quiet" compact icon={<Plus size={14} />} disabled={saving} onClick={startCreating}>New space</ApexButton>
          </div>
        </header>
        {creating && error ? <Banner status="error" role="alert" title={error} /> : null}
        {listError ? <><Banner status="error" role="alert" title={`Could not load Spaces: ${listError}`} /><ApexButton compact onClick={() => setListRevision((value) => value + 1)}>Retry</ApexButton></> : null}
        {loading ? <div {...stylex.props(styles.content)}><ChiefOfStaffOpening /></div> : listError ? null : selectedId !== 'global' && !space && !creating ? (
          <Banner status="error" role="alert" title="This Space is no longer available. Choose another Space or Global Chief." />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {creating ? (
              <motion.form
                key="creating"
                initial={instant ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={instant ? undefined : { opacity: 0, y: -2, transition: { duration: 0.115, ease: [0.2, 0, 0, 1] } }}
                transition={instant ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                {...stylex.props(styles.form)}
                onSubmit={(event) => { event.preventDefault(); void create() }}
              >
                <h3 {...stylex.props(styles.formTitle)}>Keep related work together</h3>
                <p {...stylex.props(styles.muted)}>Give this space an objective and a project. Its Chief of Staff will keep the conversation and delegated work in one place.</p>
                <TextInput label="Name" value={name} onChange={setName} isRequired />
                <label {...stylex.props(styles.field)}>Project
                  <SelectControl label="Space project" value={projectId} onChange={(event) => setProjectId(event.target.value)} fullWidth>
                    <option value="">Choose a project</option>
                    {projects.filter((item) => !item.inferred && !item.readOnly).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </SelectControl>
                </label>
                <TextArea label="Objective" value={objective} onChange={setObjective} />
                <div {...stylex.props(styles.actions)}>
                  <ApexButton variant="primary" type="submit" disabled={saving || !name.trim() || !projectId}>Create space</ApexButton>
                  <ApexButton variant="quiet" type="button" disabled={saving} onClick={() => { setCreating(false); setError(undefined) }}>Cancel</ApexButton>
                </div>
              </motion.form>
            ) : (
              <motion.div
                key="coordinator"
                initial={instant ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={instant ? undefined : { opacity: 0, y: -2, transition: { duration: 0.115, ease: [0.2, 0, 0, 1] } }}
                transition={instant ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                {...stylex.props(styles.content)}
              >
                <ActivityCoordinator key={selectedId} embedded actionsTarget={chatActions} bridge={bridge ?? null} controls={controls} showReasoning={showReasoning} showTools={showTools} messageEnterAction={messageEnterAction} spaceId={space?.id} projectName={project?.name} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
      {renderInspector ? renderInspector(sidebar) : sidebar}
    </>
  )
}
