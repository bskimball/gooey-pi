import { useMemo, useState } from 'react'
import type { TranscriptMessage } from '@/types/api'
import { observedPath, specialistEvidence } from '@/lib/specialist-evidence'
import { specialistStatusLabel } from '@/lib/specialist-status'
import { errorMessage } from '@/lib/errors'
import type { PiSpecialistSession } from './SpecialistsPanel'

export function SpecialistMatrix({ specialists, activeId, onSelect, cwd }: { specialists: PiSpecialistSession[]; activeId: string; onSelect(id: string): void; cwd?: string }) {
  const rows = useMemo(() => specialists.map((spec) => ({ spec, evidence: specialistEvidence(spec.messages, spec.cwd ? observedPath(spec.cwd, cwd) : cwd) })), [specialists, cwd])
  return <div className="specialist-matrix scroll-area" role="tablist" aria-label="Session specialists" aria-orientation="vertical">
    {rows.map(({ spec, evidence }, index) => <button key={spec.id} type="button" role="tab" aria-selected={spec.id === activeId} tabIndex={spec.id === activeId ? 0 : -1} className={`specialist-matrix__row is-${spec.status} ${spec.id === activeId ? 'is-active' : ''}`} onClick={() => onSelect(spec.id)} onKeyDown={(event) => {
      const next = { ArrowDown: (index + 1) % rows.length, ArrowRight: (index + 1) % rows.length, ArrowUp: (index - 1 + rows.length) % rows.length, ArrowLeft: (index - 1 + rows.length) % rows.length, Home: 0, End: rows.length - 1 }[event.key]
      if (next === undefined) return
      event.preventDefault(); onSelect(rows[next].spec.id)
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }}>
      <span className="specialist-matrix__identity"><strong>{spec.agent}</strong><small>{spec.id}</small></span>
      <span className="run-state">{spec.waitingForInput ? 'Waiting for input' : specialistStatusLabel[spec.status]}</span>
      <span className="specialist-matrix__task" title={spec.prompt}>{spec.mission || 'No task recorded'}</span>
      <span className="specialist-matrix__evidence">{evidence.files.length} file references · {spec.activity || 'No active tool recorded'}</span>
      <span className={`specialist-matrix__issue ${spec.killReason || evidence.issue ? 'has-issue' : ''}`}>{spec.waitingForInput ? 'Input requested by this worker' : spec.killReason || (evidence.issue ? `Last recorded error: ${evidence.issue}` : 'No blocker recorded')}</span>
    </button>)}
  </div>
}

export function SpecialistFiles({ messages, cwd }: { messages: TranscriptMessage[]; cwd?: string }) {
  const { files } = useMemo(() => specialistEvidence(messages, cwd), [messages, cwd])
  const [error, setError] = useState('')
  if (!files.length) return <small className="specialist-files__empty">No source paths recorded yet.</small>
  return <details className="specialist-files">
    <summary>Observed files <span>{files.length}</span></summary>
    <small>Tool references only, not file locks. Line numbers are recorded positions, not tracked edits.</small>
    <ul>{files.map((file) => <li key={file.path}><button type="button" title={`Open ${file.path}${file.line ? `:${file.line}` : ''} in VS Code`} onClick={() => {
      setError('')
      if (!window.prime) { setError('Source navigation requires the Desktop app.'); return }
      void window.prime.app.openInVsCode(file.path, file.line).then((opened) => { if (!opened) setError('Could not open this source path. Confirm it still exists in a granted project.') }).catch((reason) => setError(errorMessage(reason)))
    }}><code>{file.path}{file.line ? `:${file.line}` : ''}</code><small>{file.tool}</small></button></li>)}</ul>
    {error ? <p className="changes-error" role="alert">{error}</p> : null}
  </details>
}
