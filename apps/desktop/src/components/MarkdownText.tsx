import { isValidElement, memo, useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import type { Components, UrlTransform } from 'react-markdown'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { openExternalUrl } from '@/lib/desktop-actions'
import { HtmlFence } from './HtmlFence'
import { WorkspaceImage } from './WorkspaceImage'

interface MarkdownTextProps {
  text: string
  /** Actively streaming text throttles Markdown re-parses to a coherent committed snapshot. */
  streaming?: boolean
}

async function openMarkdownLink(event: MouseEvent<HTMLAnchorElement>, href: string): Promise<string | null> {
  event.preventDefault()
  if (href.startsWith('#')) {
    try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }) } catch { /* malformed fragment */ }
    return null
  }
  if (window.prime) return openExternalUrl(window.prime.app, href)
  if (/^file:/i.test(href)) return 'Open this file from the desktop app.'
  window.open(href, '_blank', 'noopener,noreferrer')
  return null
}

function MarkdownLink({ href, children, ...props }: ComponentProps<'a'>) {
  const [failure, setFailure] = useState<string | null>(null)
  if (!href || !/^(https?:|mailto:|file:|#)/i.test(href)) {
    return <span className="markdown-link-unsupported" title={href ? `Project-relative link: ${href}` : undefined}>{children}</span>
  }
  return <>
    <a {...props} href={href} rel="noreferrer" onClick={(event) => { void openMarkdownLink(event, href).then(setFailure) }}><bdi>{children}</bdi></a>
    {failure ? <span role="alert"> {failure}</span> : null}
  </>
}

const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (/^file:/i.test(url)) return url
  if (node.tagName === 'img' && key === 'src') {
    if (/^[a-z]:[\\/]/i.test(url) || /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return url
  }
  return defaultUrlTransform(url)
}

const markdownPlugins = [remarkGfm]

/**
 * Each block resolves its own base direction from its first strong character.
 * The browser skips descendants that carry their own `dir`, so a paragraph
 * opening with LTR code still lays out RTL prose correctly.
 */
function htmlFenceSource(children: ReactNode): string | undefined {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return undefined
  const language = /language-([\w-]+)/.exec(children.props.className ?? '')?.[1]
  if (language !== 'html' && language !== 'htm') return undefined
  const body = children.props.children
  return typeof body === 'string' ? body : undefined
}

const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <MarkdownLink {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote {...props} dir="auto" />,
  code: ({ node: _node, children, ...props }) => <code {...props} dir="ltr">{children}</code>,
  h1: ({ node: _node, ...props }) => <h1 {...props} dir="auto" />,
  h2: ({ node: _node, ...props }) => <h2 {...props} dir="auto" />,
  h3: ({ node: _node, ...props }) => <h3 {...props} dir="auto" />,
  h4: ({ node: _node, ...props }) => <h4 {...props} dir="auto" />,
  h5: ({ node: _node, ...props }) => <h5 {...props} dir="auto" />,
  h6: ({ node: _node, ...props }) => <h6 {...props} dir="auto" />,
  img: ({ node: _node, ...props }) => <WorkspaceImage {...props} />,
  li: ({ node: _node, ...props }) => <li {...props} dir="auto" />,
  ol: ({ node: _node, ...props }) => <ol {...props} dir="auto" />,
  p: ({ node: _node, ...props }) => <p {...props} dir="auto" />,
  pre: ({ node: _node, children, ...props }) => {
    const source = htmlFenceSource(children)
    if (source !== undefined) return <HtmlFence source={source} />
    return <pre {...props} dir="ltr">{children}</pre>
  },
  td: ({ node: _node, ...props }) => <td {...props} dir="auto" />,
  th: ({ node: _node, ...props }) => <th {...props} dir="auto" />,
  ul: ({ node: _node, ...props }) => <ul {...props} dir="auto" />,
}

export const STREAMING_PARSE_INTERVAL_MS = 100

const INCOMPLETE_BLOCK_MARKER_LINE =
  /[ \t]*(?:(?:[-=*+_][ \t]*)+|(?:\d+[.)]|#{1,6}|(?:>[ \t]*)+)[ \t]*|`{3}[ \t]*[^\n`]*|`{1,2}[ \t]*|~{3}[ \t]*[^\n~]*|~{1,2}[ \t]*)[ \t]*\r?\n?$/
const INCOMPLETE_TRAILING_BLOCK_LINE = new RegExp(`(?:\\r?\\n${INCOMPLETE_BLOCK_MARKER_LINE.source})+$`)
const INCOMPLETE_INITIAL_BLOCK_LINE = new RegExp(`^${INCOMPLETE_BLOCK_MARKER_LINE.source}`)

/**
 * Holds back an incomplete trailing block-syntax line (such as a bare `-` Setext
 * underline / list marker, `### ` heading prefix, or half-typed code fence)
 * while streaming so CommonMark does not briefly promote the previous paragraph
 * into an `<h2>`, flash an `<hr>`, or add/remove a phantom code-fence line.
 */
export function stabilizeStreamingMarkdown(text: string): string {
  if (!text) return text
  const trimmed = text.replace(INCOMPLETE_TRAILING_BLOCK_LINE, '')
  if (trimmed !== text) return trimmed
  return INCOMPLETE_INITIAL_BLOCK_LINE.test(text) ? '' : text
}

export interface StreamingParseState {
  /** How much of the text is committed to the Markdown parser. */
  boundary: number
  lastParseAt: number
}

/**
 * Decides how much of a streaming message to hand to the Markdown parser: the
 * boundary advances at most every STREAMING_PARSE_INTERVAL_MS, including for
 * newline-heavy code and lists. Keep the previous coherent snapshot visible
 * between parses. Shrinking/replacing text and the final render can flush immediately.
 */
export function advanceStreamingParse(
  state: StreamingParseState,
  textLength: number,
  now: number,
): { state: StreamingParseState; delayMs?: number } {
  if (state.boundary >= textLength) {
    return state.boundary === textLength ? { state } : { state: { boundary: textLength, lastParseAt: now } }
  }
  const elapsed = now - state.lastParseAt
  if (elapsed >= STREAMING_PARSE_INTERVAL_MS) {
    return { state: { boundary: textLength, lastParseAt: now } }
  }
  return { state, delayMs: STREAMING_PARSE_INTERVAL_MS - elapsed }
}

/** Render model-authored Markdown without enabling raw HTML or remote images. */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false }: MarkdownTextProps) {
  const parseStateRef = useRef<StreamingParseState>({ boundary: text.length, lastParseAt: Date.now() })
  const [, setParseRevision] = useState(0)

  if (!streaming) {
    parseStateRef.current = { boundary: text.length, lastParseAt: Date.now() }
  } else {
    const immediate = advanceStreamingParse(parseStateRef.current, text.length, Date.now())
    if (immediate.state !== parseStateRef.current) {
      parseStateRef.current = immediate.state
    }
  }

  useEffect(() => {
    if (!streaming) {
      parseStateRef.current = { boundary: text.length, lastParseAt: Date.now() }
      return
    }
    const decide = (): number | undefined => {
      const current = parseStateRef.current
      const result = advanceStreamingParse(current, text.length, Date.now())
      if (result.state !== current) {
        parseStateRef.current = result.state
        setParseRevision((revision) => revision + 1)
      }
      return result.delayMs
    }
    const delayMs = decide()
    if (delayMs === undefined) return
    const timer = window.setTimeout(() => { decide() }, delayMs)
    return () => window.clearTimeout(timer)
  }, [streaming, text])

  const boundary = streaming ? Math.min(parseStateRef.current.boundary, text.length) : text.length
  const committedText = boundary === text.length ? text : text.slice(0, boundary)
  const parsedText = streaming ? stabilizeStreamingMarkdown(committedText) : committedText
  // Keep the committed Markdown subtree intact between parses. Rendering the
  // unparsed suffix as a sibling block makes punctuation and partial words
  // jump onto separate lines while tokens are still arriving.
  const markdown = useMemo(
    () => <ReactMarkdown remarkPlugins={markdownPlugins} skipHtml urlTransform={markdownUrlTransform} components={markdownComponents}>{parsedText}</ReactMarkdown>,
    [parsedText],
  )
  return <div className={streaming ? 'prose is-streaming' : 'prose'}>{markdown}</div>
})
