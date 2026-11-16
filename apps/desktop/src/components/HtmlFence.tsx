import * as stylex from '@stylexjs/stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { TextArea } from '@astryxdesign/core/TextArea'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as markdownStyles } from 'apex-ui/styles/markdown.stylex'
import { useEffect, useRef, useState } from 'react'
import { ApexButton } from './ui'
import { interactivePreviewUrl } from 'apex-core/interactive-preview'
import { useInteractiveChat, type InteractiveChatContextValue } from './InteractiveChatContext'

const PREVIEW_LIMIT = 100_000
const PREVIEW_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">`

const cardStyles = stylex.create({
  controls: { display: 'flex', gap: 8, padding: 8, flexWrap: 'wrap' },
  feedback: { display: 'flex', flexDirection: 'column', gap: 8, padding: 8 },
  textarea: { display: 'block', width: '100%', minHeight: 64, boxSizing: 'border-box', color: 'inherit', backgroundColor: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: 8, resize: 'vertical' },
  submit: { alignSelf: 'flex-start' },
  enlarged: { height: 640 },
})

export function htmlPreviewDocument(source: string): string {
  return `<!doctype html><html><head>${PREVIEW_POLICY}</head><body>${source}</body></html>`
}

type Props = { source: string; xstyle?: stylex.StyleXStyles; sourceXstyle?: stylex.StyleXStyles }

function readDraft(key: string | null): { text: string; revision: string } | null {
  try {
    const value: unknown = key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null
    return value && typeof value === 'object' && 'text' in value && typeof value.text === 'string'
      && 'revision' in value && typeof value.revision === 'string' ? { text: value.text, revision: value.revision } : null
  } catch { return null }
}

function saveDraft(key: string | null, text: string): string | null {
  try {
    if (!key) return null
    const revision = crypto.randomUUID()
    sessionStorage.setItem(key, JSON.stringify({ text, revision }))
    return revision
  } catch { return null }
}

export function HtmlFence(props: Props) {
  const chat = useInteractiveChat()
  return <HtmlFenceCard key={JSON.stringify([chat?.sessionKey, props.source])} {...props} chat={chat} />
}

function HtmlFenceCard({ source, xstyle, sourceXstyle, chat }: Props & { chat: InteractiveChatContextValue | null }) {
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [revision, setRevision] = useState(0)
  const [enlarged, setEnlarged] = useState(false)
  const desktopPreview = typeof window !== 'undefined' && Boolean(window.apex)
  const draftKey = chat ? `interactive-html-feedback:${JSON.stringify([chat.sessionKey, source])}` : null
  const [initialDraft] = useState(() => readDraft(draftKey))
  const [draft, setDraft] = useState(initialDraft?.text ?? '')
  const draftRevision = useRef(initialDraft?.revision ?? null)
  const [status, setStatus] = useState<'idle' | 'prepared' | 'sending' | 'sent' | 'failed'>('idle')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const userEdited = useRef(Boolean(draft))
  const sendingRef = useRef(false)
  const feedbackEnabled = desktopPreview && Boolean(chat && !chat.disabled)
  useEffect(() => {
    if (!feedbackEnabled) return
    const receive = (event: MessageEvent<unknown>) => {
      const frameWindow = frameRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow || sendingRef.current || userEdited.current) return
      const data = event.data
      if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'apex:feedback'
        || !('text' in data) || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) return
      setDraft(data.text)
      setStatus('prepared')
      draftRevision.current = saveDraft(draftKey, data.text)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [feedbackEnabled, draftKey])
  if (source.length > PREVIEW_LIMIT) {
    return <pre className={`html-preview__source ${stylex.props(transcriptStyles.htmlPreviewSource, sourceXstyle, xstyle).className ?? ''}`} dir="ltr"><code {...stylex.props(markdownStyles.code, markdownStyles.blockCode)}>{source}</code></pre>
  }
  async function sendFeedback() {
    if (!chat || chat.disabled || !draft.trim() || sendingRef.current) return
    const text = draft.trim()
    const submittedRevision = draftRevision.current
    sendingRef.current = true
    setStatus('sending')
    try {
      await chat.onSendFeedback(text)
      setDraft('')
      userEdited.current = false
      try { if (draftKey && submittedRevision && readDraft(draftKey)?.revision === submittedRevision) sessionStorage.removeItem(draftKey) } catch { /* Storage is optional. */ }
      setStatus('sent')
    } catch {
      userEdited.current = true
      setStatus('failed')
    } finally {
      sendingRef.current = false
    }
  }
  return <figure className={`html-preview ${stylex.props(transcriptStyles.htmlPreview, xstyle).className ?? ''}`}>
    <div {...stylex.props(cardStyles.controls)}>
      <ApexButton onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>{expanded ? 'Collapse' : 'Expand'}</ApexButton>
      <ApexButton onClick={() => setShowSource((open) => !open)}>{showSource ? 'Preview' : 'Source'}</ApexButton>
      <ApexButton onClick={() => setEnlarged((value) => !value)} aria-pressed={enlarged}>{enlarged ? 'Fit in chat' : 'Enlarge'}</ApexButton>
      <ApexButton onClick={() => setRevision((value) => value + 1)}>Reset preview</ApexButton>
    </div>
    {expanded && !showSource ? <iframe
      ref={frameRef}
      key={revision}
      className={`html-preview__frame ${stylex.props(transcriptStyles.htmlPreviewFrame, enlarged && cardStyles.enlarged).className ?? ''}`}
      sandbox={desktopPreview ? 'allow-scripts' : ''}
      referrerPolicy="no-referrer"
      src={desktopPreview ? interactivePreviewUrl(source) : undefined}
      srcDoc={desktopPreview ? undefined : htmlPreviewDocument(source)}
      title="Interactive HTML preview"
    /> : null}
    {expanded && showSource ? <pre className={`html-preview__source ${stylex.props(transcriptStyles.htmlPreviewSource, sourceXstyle).className ?? ''}`} dir="ltr"><code {...stylex.props(markdownStyles.code, markdownStyles.blockCode)}>{source}</code></pre> : null}
    {chat ? <div {...stylex.props(cardStyles.feedback)}>
      <TextArea
        label="Feedback"
        controlXstyle={cardStyles.textarea}
        value={draft}
        maxLength={4000}
        isDisabled={status === 'sending'}
        onChange={(value) => {
          userEdited.current = Boolean(value)
          setDraft(value)
          setStatus('idle')
          draftRevision.current = saveDraft(draftKey, value)
        }}
        placeholder="Describe your choice or changes"
      />
      <ApexButton xstyle={cardStyles.submit} disabled={chat.disabled || status === 'sending' || !draft.trim()} onClick={() => void sendFeedback()}>{status === 'sending' ? 'Sending…' : 'Send feedback'}</ApexButton>
      {status === 'prepared' ? <span role="status">Preview choice prepared. Review it before sending.</span> : null}
      {status === 'sent' ? <span role="status">Sent to this conversation</span> : null}
      {status === 'failed' ? <Banner status="error" role="alert" title="Could not send feedback. Try again." /> : null}
    </div> : null}
  </figure>
}
