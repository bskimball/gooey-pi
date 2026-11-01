export const SELECTION_CHAR_LIMIT = 8000

export interface SelectionReference {
  path: string
  startLine: number
  endLine: number
  languageId: string
  text: string
}

export interface DiagnosticReference {
  path: string
  startLine: number
  endLine: number
  severity: string
  source?: string
  code?: string | number
  message: string
  lineText: string
}

/** A fence longer than any backtick run inside the text, so the text cannot close it early. */
function fenced(text: string, info = ''): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${info}\n${text}\n${fence}`
}

const lineRange = (startLine: number, endLine: number) => startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`

/** Draft text for "Ask Apex about selection"; the user finishes the question and sends it. */
export function selectionPrompt({ path, startLine, endLine, languageId, text }: SelectionReference): string {
  const truncated = text.length > SELECTION_CHAR_LIMIT
  const body = truncated ? text.slice(0, SELECTION_CHAR_LIMIT) : text
  return `${path}, ${lineRange(startLine, endLine)}:\n${fenced(body, languageId)}\n${truncated ? `(Selection truncated to the first ${SELECTION_CHAR_LIMIT} of ${text.length} characters.)\n` : ''}\n`
}

/** Draft text for "Fix with Apex"; the user may edit it before sending. */
export function diagnosticPrompt({ path, startLine, endLine, severity, source, code, message, lineText }: DiagnosticReference): string {
  const origin = [source, code === undefined ? undefined : String(code)].filter(Boolean).join(' ')
  return `Fix this ${severity} in ${path}, ${lineRange(startLine, endLine)}${origin ? ` (${origin})` : ''}:\n${fenced(message.slice(0, SELECTION_CHAR_LIMIT))}\n${message.length > SELECTION_CHAR_LIMIT ? `(Message truncated to the first ${SELECTION_CHAR_LIMIT} of ${message.length} characters.)\n` : ''}Surrounding line:\n${fenced(lineText.slice(0, 1000))}\n`
}
