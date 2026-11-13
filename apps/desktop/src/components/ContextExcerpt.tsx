import { useRef, useState, type ReactNode } from 'react'
import { EXCERPT_LIMIT, useTaskWorkflowContext } from '@/lib/task-context'
import { ApexButton } from './ui'

/** Only the marked evidence region participates, never adjacent tool/thought UI. */
export function ContextExcerpt({ children, source, path, range, text, plainText = false }: { children: ReactNode; source: string; path?: string; range?: string; text: string; plainText?: boolean }) {
  const workflow = useTaskWorkflowContext()
  const region = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState('')
  const [selectedRange, setSelectedRange] = useState<string>()
  const [manual, setManual] = useState(false)
  const [error, setError] = useState('')
  const [attached, setAttached] = useState(false)
  const capture = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !region.current?.contains(selection.anchorNode) || !region.current.contains(selection.focusNode)) return
    const selectedSpan = selection.getRangeAt(0)
    // Range text preserves the raw file's BOM and CRLF, unlike rendered selection text.
    const value = plainText ? selectedSpan.toString() : selection.toString()
    setAttached(false)
    if (value.length > EXCERPT_LIMIT) { setError('Select a shorter excerpt. The limit is 32,768 characters.'); setSelected(''); return }
    const lineFor = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-context-line]')
    const startLine = lineFor(selection.getRangeAt(0).startContainer)
    const endLine = lineFor(selection.getRangeAt(0).endContainer)
    const start = Number(startLine?.dataset.contextLine)
    const end = Number(endLine?.dataset.contextLine)
    const label = startLine?.dataset.contextLineKind ?? 'lines'
    let resolvedRange = start > 0 && end > 0 ? `${label} ${start}–${end}` : undefined
    if (plainText && region.current.textContent === text) {
      const prefix = document.createRange()
      prefix.selectNodeContents(region.current)
      prefix.setEnd(selectedSpan.startContainer, selectedSpan.startOffset)
      const offset = prefix.toString().length
      if (text.slice(offset, offset + value.length) === value) {
        const lineAt = (position: number) => {
          let line = 1
          for (const newline of text.matchAll(/\r\n|\r|\n/g)) {
            if (newline.index + newline[0].length > position) break
            line += 1
          }
          return line
        }
        resolvedRange = `lines ${lineAt(offset)}–${lineAt(offset + Math.max(0, value.length - 1))}`
      }
    }
    setSelectedRange(resolvedRange)
    setSelected(value); setError('')
  }
  const attach = (intent: string) => {
    if (!selected.trim()) return
    workflow?.attach({ source: `${source} · ${intent}`, path, range: selectedRange ?? range, text: selected, sessionFile: workflow.sessionFile })
    setSelected(''); setManual(false); setAttached(true)
  }
  if (!workflow) return children
  return <div className="context-excerpt">
    <div ref={region} onMouseUp={capture} onKeyUp={capture}>{children}</div>
    {workflow ? <div className="context-excerpt__actions">
      {!selected && !manual ? <ApexButton compact variant="quiet" onClick={() => setManual(true)}>Select excerpt…</ApexButton> : null}
      {manual ? <label className="field"><span>Select text with the keyboard, or enter an exact excerpt</span><textarea autoFocus aria-label="Exact excerpt" maxLength={EXCERPT_LIMIT} value={selected} onChange={(event) => { const value = event.target.value; if (!value || text.includes(value)) { setSelected(value); setSelectedRange(undefined); setError('') } else setError('Use an exact excerpt from this content.') }} /></label> : null}
      {selected ? <><ApexButton compact onMouseDown={(event) => event.preventDefault()} onClick={() => attach('Ask about this')}>Ask about this</ApexButton><ApexButton compact onClick={() => attach('Request a change')}>Request a change</ApexButton>{source.startsWith('Assistant') ? <><ApexButton compact disabled={workflow.pending} onClick={() => workflow.createSide(selected)}>Side conversation</ApexButton>{workflow.isSide ? <ApexButton compact disabled={workflow.pending} onClick={() => workflow.bringBack(selected)}>Bring back</ApexButton> : null}</> : null}</> : null}
      {manual || selected ? <ApexButton compact variant="quiet" onClick={() => { setManual(false); setSelected(''); setError('') }}>Cancel selection</ApexButton> : null}
      {attached ? <span role="status">Added to composer</span> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div> : null}
  </div>
}
