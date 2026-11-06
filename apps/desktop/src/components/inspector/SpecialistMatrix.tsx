import { useMemo, useState } from 'react'
import type { TranscriptMessage } from '@/types/api'
import { specialistEvidence } from '@/lib/specialist-evidence'
import { errorMessage } from '@/lib/errors'

export function SpecialistFiles({ messages, cwd }: { messages: TranscriptMessage[]; cwd?: string }) {
  const { files } = useMemo(() => specialistEvidence(messages, cwd), [messages, cwd])
  const [error, setError] = useState('')
  if (!files.length) return null
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
