import * as stylex from '@stylexjs/stylex'
import { styles as agentsStyles } from 'apex-ui/styles/agents.stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { useMemo, useState } from 'react'
import type { TranscriptMessage } from '@/types/api'
import { specialistEvidence } from '@/lib/specialist-evidence'
import { errorMessage } from '@/lib/errors'
import { CaretRight } from '../icons'

export function SpecialistFiles({ messages, cwd }: { messages: TranscriptMessage[]; cwd?: string }) {
  const { files } = useMemo(() => specialistEvidence(messages, cwd), [messages, cwd])
  const [error, setError] = useState('')
  if (!files.length) return null
  return <details className={`specialist-files ${stylex.props(agentsStyles.specialistFiles).className ?? ""}`}>
    <summary><CaretRight size={11} aria-hidden="true" className={`specialist-files__caret ${stylex.props(agentsStyles.specialistFilesCaret).className ?? ""}`} />Observed files <span>{files.length}</span></summary>
    <small>Tool references only, not file locks. Line numbers are recorded positions, not tracked edits.</small>
    <ul className={`scroll-area ${stylex.props(baseStyles.scrollArea).className ?? ""}`}>{files.map((file) => <li key={file.path}><button type="button" title={`Open ${file.path}${file.line ? `:${file.line}` : ''} in VS Code`} onClick={() => {
      setError('')
      if (!window.apex) { setError('Source navigation requires the Desktop app.'); return }
      void window.apex.app.openInVsCode(file.path, file.line).then((opened) => { if (!opened) setError('Could not open this source path. Confirm it still exists in a granted project.') }).catch((reason) => setError(errorMessage(reason)))
    }}><code>{file.path}{file.line ? `:${file.line}` : ''}</code><small>{file.tool}</small></button></li>)}</ul>
    {error ? <Banner status="error" role="alert" title={error} /> : null}
  </details>
}
