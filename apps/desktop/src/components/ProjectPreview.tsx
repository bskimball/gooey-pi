import * as stylex from '@stylexjs/stylex'
import { createElement, useEffect, useState } from 'react'
import { PROJECT_PREVIEW_PARTITION_PREFIX, type ProjectPreview as ProjectPreviewSpec } from 'apex-core/interactive-preview'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { ApexButton } from './ui'
import { useInteractiveChat } from './InteractiveChatContext'

const styles = stylex.create({
  card: { border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 8 },
  title: { flexGrow: 1, fontWeight: 600 },
  address: { display: 'block', padding: '0 8px 8px', color: 'var(--text-secondary)', fontSize: 'var(--chat-meta)', overflowWrap: 'anywhere' },
  note: { padding: 12, margin: 0 },
  frame: { display: 'flex', width: '100%', height: 360, border: 0 },
  enlarged: { height: 640 },
  hidden: { display: 'none' },
})

function PreviewGuest({ preview, enlarged, collapsed }: { preview: ProjectPreviewSpec; enlarged: boolean; collapsed: boolean }) {
  const [partition] = useState(() => `${PROJECT_PREVIEW_PARTITION_PREFIX}${crypto.randomUUID()}`)
  const [view, setView] = useState<HTMLElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    if (!view) return
    const ready = () => setStatus('ready')
    const failed = (event: Event) => {
      if ('isMainFrame' in event && event.isMainFrame === false) return
      if ('errorCode' in event && event.errorCode === -3) return
      setStatus('failed')
    }
    view.addEventListener('did-finish-load', ready)
    view.addEventListener('did-fail-load', failed)
    view.addEventListener('render-process-gone', failed)
    return () => {
      view.removeEventListener('did-finish-load', ready)
      view.removeEventListener('did-fail-load', failed)
      view.removeEventListener('render-process-gone', failed)
    }
  }, [view])
  return <div {...stylex.props(collapsed && styles.hidden)}>
    {status === 'loading' ? <p {...stylex.props(styles.note)} role="status">Loading project preview…</p> : null}
    {status === 'failed' ? <p {...stylex.props(styles.note)} role="alert">Preview unavailable. Check that the project server is running at the address above, then reload.</p> : null}
    {createElement('webview', {
      ref: setView,
      src: preview.url,
      partition,
      title: preview.title,
      'aria-label': preview.title,
      ...stylex.props(styles.frame, enlarged && styles.enlarged, status === 'failed' && styles.hidden),
      webpreferences: 'contextIsolation=yes,sandbox=yes,nodeIntegration=no',
    })}
  </div>
}

export function ProjectPreview({ preview }: { preview: ProjectPreviewSpec }) {
  const chat = useInteractiveChat()
  return <ProjectPreviewCard key={JSON.stringify([chat?.sessionKey, preview.url])} preview={preview} />
}

function ProjectPreviewCard({ preview }: { preview: ProjectPreviewSpec }) {
  const [running, setRunning] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const [revision, setRevision] = useState(0)
  const desktop = typeof window !== 'undefined' && Boolean(window.apex)
  return <figure {...stylex.props(transcriptStyles.htmlPreview, styles.card)} aria-label={`Project preview: ${preview.title}`}>
    <figcaption {...stylex.props(styles.header)}>
      <span {...stylex.props(styles.title)}>{preview.title}</span>
      {running ? <>
        <ApexButton onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>{collapsed ? 'Expand' : 'Collapse'}</ApexButton>
        <ApexButton onClick={() => setEnlarged((value) => !value)} aria-pressed={enlarged}>{enlarged ? 'Fit in chat' : 'Enlarge'}</ApexButton>
        <ApexButton onClick={() => setRevision((value) => value + 1)}>Reload preview</ApexButton>
        <ApexButton onClick={() => setRunning(false)}>Stop preview</ApexButton>
      </> : <ApexButton disabled={!desktop} onClick={() => { setCollapsed(false); setRunning(true) }}>Load preview</ApexButton>}
    </figcaption>
    <code {...stylex.props(styles.address)}>{preview.url}</code>
    {running ? <PreviewGuest key={`${preview.url}:${revision}`} preview={preview} enlarged={enlarged} collapsed={collapsed} />
      : <p {...stylex.props(styles.note)}>{desktop ? 'Loads a live page from your local project server. Preview controls run project code in an isolated browser, without Apex desktop access.' : 'Open this conversation in the Apex desktop app to interact with this project preview.'}</p>}
  </figure>
}
