import * as stylex from '@stylexjs/stylex'
import { styles as annotationContextStyles } from 'apex-ui/styles/annotation-source-context.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as annotationSourceStyles } from 'apex-ui/styles/annotation-source.stylex'
import { useCallback, useEffect, useState } from 'react'
import { useMachine } from '@xstate/react'
import type { BrowserAnnotationElement, BrowserSourceResult } from '@/types/api'
import { MAX_COMMENT_LENGTH } from '@/lib/browser-annotations'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { ChatCircleText, X } from '../icons'
import { ApexButton, IconButton } from '../ui'
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
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [snapshot, send] = useMachine(annotationSourceMachine)
  const { source, error } = snapshot.context
  const opening = snapshot.matches('opening')
  const resolveSource = useCallback(async (): Promise<BrowserSourceResult> => {
    if (!element.sourceHint) return { kind: 'unknown', reason: 'This element has no usable original-source metadata. Visual context can still be attached.' }
    if (!cwd || !window.apex) return { kind: 'unknown', reason: 'Open a granted workspace to validate this source location.' }
    try {
      return await window.apex.app.resolveBrowserSource(cwd, element.sourceHint)
    } catch {
      return { kind: 'unknown', reason: 'Source validation failed. Visual context can still be attached.' }
    }
  }, [cwd, element.sourceHint])

  useEffect(() => {
    send({
      type: 'CHECK',
      resolveSource,
      openInVsCode: (path, line) => window.apex.app.openInVsCode(path, line),
    })
  }, [resolveSource, send])

  const openSource = () => {
    send({ type: 'OPEN_IN_VSCODE' })
  }
  const save = () => source.kind !== 'checking' && text.trim().length > 0 && onSave(source)

  return (
    <div className={`annotation-layer ${stylex.props(inspectorStyles.annotationLayer).className ?? ""}`}>
      <div
        className={`annotation-popover ${stylex.props(inspectorStyles.annotationPopover, annotationContextStyles.popoverWithSource).className ?? ""}`}
        role="dialog"
        aria-label="Comment on selected element"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
            requestAnimationFrame(() => { if (returnFocus?.isConnected) returnFocus.focus() })
          }
        }}
      >
        <div>
          <ChatCircleText size={14} />
          <strong>Comment on element {index}</strong>
          <IconButton label="Discard annotation" onClick={onCancel}>
            <X size={13} />
          </IconButton>
        </div>
        <section className={`annotation-source ${stylex.props(annotationSourceStyles.annotationSource).className ?? ""}`} aria-label="Selected element source" aria-live="polite">
          {element.component ? (
            <p {...stylex.props(annotationContextStyles.sourceParagraph)}>
              Component reported by page: <strong>{element.component}</strong>
            </p>
          ) : null}
          {source.kind === 'checking' ? <p {...stylex.props(annotationContextStyles.sourceParagraph)}>Checking source…</p> : null}
          {source.kind === 'unknown' ? (
            <>
              <strong>Source unknown</strong>
              <p {...stylex.props(annotationContextStyles.sourceParagraph)}>{source.reason}</p>
              <details>
                <summary>Source metadata support</summary>
                <p {...stylex.props(annotationContextStyles.sourceParagraph)}>
                  The picker reads source stamps on this element: Astro attributes, Svelte development metadata, or explicit <code {...stylex.props(annotationContextStyles.sourceCode)}>data-source-file</code> and optional 1-based{' '}
                  <code {...stylex.props(annotationContextStyles.sourceCode)}>data-source-line</code>. Paths must be local and inside the active workspace. React component names alone do not establish an original source location.
                </p>
              </details>
            </>
          ) : null}
          {source.kind === 'resolved' ? (
            <>
              <strong>Page-reported source</strong>
              <code {...stylex.props(annotationContextStyles.sourceCode)}>
                {source.path}
                {source.line === undefined ? '' : `:${source.line}`}
              </code>
              <p {...stylex.props(annotationContextStyles.sourceParagraph)}>{source.evidence} metadata · file checked in this workspace. Recorded positions may be stale after edits.</p>
              <ApexButton
                xstyle={[annotationContextStyles.sourceButton, annotationContextStyles.popoverButton]}
                disabled={opening}
                onClick={openSource}
              >
                {opening ? 'Opening…' : 'Open source in VS Code'}
              </ApexButton>
            </>
          ) : null}
          {error ? <p {...stylex.props(annotationContextStyles.sourceParagraph, annotationContextStyles.sourceAlert)} role="alert">{error}</p> : null}
        </section>
        <textarea
          {...stylex.props(annotationContextStyles.commentFocus)}
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
        <p className={`annotation-popover__hints ${stylex.props(inspectorStyles.annotationPopoverHints, annotationSourceStyles.annotationPopoverHints).className ?? ""}`}>
          <span>
            <kbd>{platform === 'darwin' ? '↩' : 'Enter'}</kbd> add to chat
          </span>
          <span>
            <kbd>{shortcutLabel(platform, ['Primary', 'Enter'])}</kbd> send now
          </span>
        </p>
        <div>
          <ApexButton xstyle={annotationContextStyles.popoverButton} onClick={onCancel}>
            Cancel
          </ApexButton>
          <ApexButton xstyle={annotationContextStyles.popoverButton} variant="primary" disabled={!text.trim() || source.kind === 'checking'} onClick={save}>
            Add comment
          </ApexButton>
        </div>
      </div>
    </div>
  )
}
