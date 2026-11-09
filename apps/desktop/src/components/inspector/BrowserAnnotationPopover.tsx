import { useCallback, useEffect } from 'react'
import { useMachine } from '@xstate/react'
import type { BrowserAnnotationElement, BrowserSourceResult } from '@/types/api'
import { MAX_COMMENT_LENGTH } from '@/lib/browser-annotations'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { ChatCircleText, X } from '../icons'
import { annotationSourceMachine } from './browserAnnotationMachine'

interface Props {
  element: BrowserAnnotationElement
  cwd?: string
  index: number
  platform: NodeJS.Platform
  text: string
  onTextChange(value: string): void
  onCancel(): void
  onSave(source: BrowserSourceResult): boolean
  onRequestSend(): void
}

export function BrowserAnnotationPopover({ element, cwd, index, platform, text, onTextChange, onCancel, onSave, onRequestSend }: Props) {
  const [snapshot, send] = useMachine(annotationSourceMachine)
  const { source, error } = snapshot.context
  const opening = snapshot.matches('opening')
  const resolveSource = useCallback(async (): Promise<BrowserSourceResult> => {
    if (!element.sourceHint) return { kind: 'unknown', reason: 'This element has no usable original-source metadata. Visual context can still be attached.' }
    if (!cwd || !window.prime) return { kind: 'unknown', reason: 'Open a granted workspace to validate this source location.' }
    try {
      return await window.prime.app.resolveBrowserSource(cwd, element.sourceHint)
    } catch {
      return { kind: 'unknown', reason: 'Source validation failed. Visual context can still be attached.' }
    }
  }, [cwd, element.sourceHint])

  useEffect(() => {
    send({
      type: 'CHECK',
      resolveSource,
      openInVsCode: (path, line) => window.prime.app.openInVsCode(path, line),
    })
  }, [resolveSource, send])

  const openSource = () => {
    send({ type: 'OPEN_IN_VSCODE' })
  }
  const save = () => source.kind !== 'checking' && text.trim().length > 0 && onSave(source)

  return (
    <div className="annotation-layer">
      <div
        className="annotation-popover"
        role="dialog"
        aria-label="Comment on selected element"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <div>
          <ChatCircleText size={14} />
          <strong>Comment on element {index}</strong>
          <button type="button" aria-label="Discard annotation" onClick={onCancel}>
            <X size={13} />
          </button>
        </div>
        <section className="annotation-source" aria-label="Selected element source" aria-live="polite">
          {element.component ? (
            <p>
              Component reported by page: <strong>{element.component}</strong>
            </p>
          ) : null}
          {source.kind === 'checking' ? <p>Checking source…</p> : null}
          {source.kind === 'unknown' ? (
            <>
              <strong>Source unknown</strong>
              <p>{source.reason}</p>
              <details>
                <summary>Source metadata support</summary>
                <p>
                  The picker reads source stamps on this element: Astro attributes, Svelte development metadata, or explicit <code>data-source-file</code> and optional 1-based{' '}
                  <code>data-source-line</code>. Paths must be local and inside the active workspace. React component names alone do not establish an original source location.
                </p>
              </details>
            </>
          ) : null}
          {source.kind === 'resolved' ? (
            <>
              <strong>Page-reported source</strong>
              <code>
                {source.path}
                {source.line === undefined ? '' : `:${source.line}`}
              </code>
              <p>{source.evidence} metadata · file checked in this workspace. Recorded positions may be stale after edits.</p>
              <button
                className="button"
                type="button"
                disabled={opening}
                onClick={openSource}
              >
                {opening ? 'Opening…' : 'Open source in VS Code'}
              </button>
            </>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </section>
        <textarea
          autoFocus
          aria-label="Element comment"
          maxLength={MAX_COMMENT_LENGTH}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            if (save() && (event.ctrlKey || event.metaKey)) onRequestSend()
          }}
          placeholder="Describe what should change…"
        />
        <p className="annotation-popover__hints">
          <span>
            <kbd>{platform === 'darwin' ? '↩' : 'Enter'}</kbd> add to chat
          </span>
          <span>
            <kbd>{shortcutLabel(platform, ['Primary', 'Enter'])}</kbd> send now
          </span>
        </p>
        <div>
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--primary" disabled={!text.trim() || source.kind === 'checking'} onClick={save}>
            Add comment
          </button>
        </div>
      </div>
    </div>
  )
}
