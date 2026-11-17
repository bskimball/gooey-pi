import * as stylex from '@stylexjs/stylex'
import { styles as transcriptStyles } from 'apex-ui/styles/transcript.stylex'
import { styles as markdownStyles } from 'apex-ui/styles/markdown.stylex'
import { cloneElement, createContext, isValidElement, memo, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { Components, ExtraProps, UrlTransform } from 'react-markdown'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { openExternalUrl } from '@/lib/desktop-actions'
import { HtmlFence } from './HtmlFence'
import { ProjectPreview } from './ProjectPreview'
import { parseProjectPreview } from 'apex-core/interactive-preview'
import { WorkspaceImage } from './WorkspaceImage'

interface MarkdownTextProps {
  text: string
  /** Actively streaming text throttles Markdown re-parses to a coherent committed snapshot. */
  streaming?: boolean
  variant?: 'body' | 'reasoning' | 'note' | 'compact' | 'muted' | 'workOrder' | 'prompt' | 'report'
}

export const MarkdownScopeContext = createContext<'default' | 'specialist' | 'specialist-assistant'>('default')

const MarkdownRenderContext = createContext<{ streaming: boolean; variant: NonNullable<MarkdownTextProps['variant']>; specialist: boolean; assistant: boolean }>({ streaming: false, variant: 'body', specialist: false, assistant: false })

async function openMarkdownLink(event: MouseEvent<HTMLAnchorElement>, href: string): Promise<string | null> {
  event.preventDefault()
  if (href.startsWith('#')) {
    try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }) } catch { /* malformed fragment */ }
    return null
  }
  if (window.apex) return openExternalUrl(window.apex.app, href)
  if (/^file:/i.test(href)) return 'Open this file from the desktop app.'
  window.open(href, '_blank', 'noopener,noreferrer')
  return null
}

function MarkdownLink({ href, children, ...props }: ComponentProps<'a'>) {
  const [failure, setFailure] = useState<string | null>(null)
  if (!href || !/^(https?:|mailto:|file:|#)/i.test(href)) {
    return <span className={`markdown-link-unsupported ${stylex.props(transcriptStyles.markdownLinkUnsupported).className ?? ""}`} title={href ? `Project-relative link: ${href}` : undefined}>{children}</span>
  }
  return <>
    <a {...props} className={[props.className, stylex.props(markdownStyles.link).className].filter(Boolean).join(' ')} href={href} rel="noreferrer" onClick={(event) => { void openMarkdownLink(event, href).then(setFailure) }}><bdi {...stylex.props(markdownStyles.linkText)}>{children}</bdi></a>
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
function fenceSource(children: ReactNode, languages: readonly string[]): string | undefined {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return undefined
  const language = /language-([\w-]+)/.exec(children.props.className ?? '')?.[1]
  if (!language || !languages.includes(language)) return undefined
  const body = children.props.children
  return typeof body === 'string' ? body : undefined
}

type MarkdownAstNode = { type: string; tagName?: string; data?: Record<string, unknown>; children?: MarkdownAstNode[] }

function markdownEdges() {
  return (tree: { children: MarkdownAstNode[] }) => {
    const blocks = tree.children.filter((node) => node.type === 'element')
    const first = blocks[0]
    const last = blocks.at(-1)
    if (first) first.data = { ...first.data, proseFirst: true }
    if (!last) return
    last.data = { ...last.data, proseLast: true }
    let cursor: MarkdownAstNode | undefined = last
    if (last.tagName === 'ul' || last.tagName === 'ol') cursor = last.children?.filter((node) => node.tagName === 'li').at(-1)
    else if (['pre', 'table', 'hr'].includes(last.tagName ?? '')) cursor = undefined
    if (cursor) cursor.data = { ...cursor.data, proseCursor: true }
  }
}

const markdownRehypePlugins = [markdownEdges]

type MarkdownBlockTag = 'p' | 'blockquote' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'li' | 'pre' | 'table' | 'td' | 'th' | 'hr' | 'strong'

function useMarkdownStyles(Tag: MarkdownBlockTag, node?: ExtraProps['node']): stylex.StyleXStyles {
  const rendering = useContext(MarkdownRenderContext)
  const block = ['p', 'ul', 'ol', 'blockquote', 'pre', 'table'].includes(Tag)
  const heading = ['h1', 'h2', 'h3', 'h4'].includes(Tag)
  const anyHeading = heading || Tag === 'h5' || Tag === 'h6'
  const reasoning = rendering.variant === 'reasoning'
  const workOrder = rendering.variant === 'workOrder'
  return [
    block && markdownStyles.block,
    Tag === 'p' && markdownStyles.paragraph,
    heading && markdownStyles.heading,
    Tag === 'h1' && markdownStyles.h1,
    Tag === 'h2' && markdownStyles.h2,
    (Tag === 'h3' || Tag === 'h4') && markdownStyles.h3,
    (Tag === 'ul' || Tag === 'ol') && markdownStyles.list,
    Tag === 'li' && markdownStyles.item,
    Tag === 'blockquote' && markdownStyles.quote,
    Tag === 'pre' && markdownStyles.pre,
    Tag === 'table' && markdownStyles.table,
    (Tag === 'td' || Tag === 'th') && markdownStyles.cell,
    Tag === 'th' && markdownStyles.headerCell,
    Tag === 'hr' && markdownStyles.rule,
    rendering.streaming && (Tag === 'p' || heading) && markdownStyles.streamingText,
    reasoning && block && Tag !== 'table' && markdownStyles.reasoningBlock,
    reasoning && anyHeading && markdownStyles.reasoningHeading,
    reasoning && Tag === 'strong' && markdownStyles.reasoningStrong,
    rendering.assistant && block && markdownStyles.specialistBlock,
    workOrder && block && markdownStyles.specialistUserBlock,
    workOrder && heading && markdownStyles.specialistUserHeading,
    workOrder && Tag === 'pre' && markdownStyles.specialistUserPre,
    rendering.specialist && (Tag === 'pre' || Tag === 'table') && markdownStyles.specialistScroll,
    node?.data && 'proseFirst' in node.data && node.data.proseFirst === true && markdownStyles.firstBlock,
    node?.data && 'proseLast' in node.data && node.data.proseLast === true && markdownStyles.lastBlock,
    rendering.streaming && rendering.variant === 'body' && node?.data && 'proseCursor' in node.data && node.data.proseCursor === true && markdownStyles.cursor,
  ]
}

function MarkdownBlock({ as: Tag, node, className, ...props }: HTMLAttributes<HTMLElement> & ExtraProps & { as: MarkdownBlockTag }) {
  const applied = stylex.props(useMarkdownStyles(Tag, node))
  const direction = Tag === 'pre' ? 'ltr' : 'auto'
  const preserveDirection = Tag === 'table' || Tag === 'hr' || Tag === 'strong'
  return <Tag {...props} className={[className, applied.className].filter(Boolean).join(' ')} dir={preserveDirection ? undefined : direction} />
}

function MarkdownCode({ node: _node, block = false, className, ...props }: ComponentProps<'code'> & ExtraProps & { block?: boolean }) {
  return <code {...props} className={[className, stylex.props(markdownStyles.code, block && markdownStyles.blockCode).className].filter(Boolean).join(' ')} dir="ltr" />
}

function MarkdownPre({ node, children, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const sourceXstyle = useMarkdownStyles('pre')
  const source = fenceSource(children, ['html', 'htm'])
  const projectSource = fenceSource(children, ['apex-preview'])
  const project = projectSource === undefined ? null : parseProjectPreview(projectSource)
  if (project) return <ProjectPreview key={project.url} preview={project} />
  if (source !== undefined) return <HtmlFence source={source} sourceXstyle={sourceXstyle} xstyle={[node?.data && 'proseFirst' in node.data && node.data.proseFirst === true && markdownStyles.firstBlock, node?.data && 'proseLast' in node.data && node.data.proseLast === true && markdownStyles.lastBlock]} />
  return <MarkdownBlock {...props} node={node} as="pre">{isValidElement<{ block?: boolean }>(children) ? cloneElement(children, { block: true }) : children}</MarkdownBlock>
}

const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <MarkdownLink {...props} />,
  blockquote: (props) => <MarkdownBlock {...props} as="blockquote" />,
  code: MarkdownCode,
  h1: (props) => <MarkdownBlock {...props} as="h1" />,
  h2: (props) => <MarkdownBlock {...props} as="h2" />,
  h3: (props) => <MarkdownBlock {...props} as="h3" />,
  h4: (props) => <MarkdownBlock {...props} as="h4" />,
  h5: (props) => <MarkdownBlock {...props} as="h5" />,
  h6: (props) => <MarkdownBlock {...props} as="h6" />,
  img: ({ node: _node, ...props }) => <WorkspaceImage {...props} />,
  li: (props) => <MarkdownBlock {...props} as="li" />,
  ol: (props) => <MarkdownBlock {...props} as="ol" />,
  p: (props) => <MarkdownBlock {...props} as="p" />,
  pre: MarkdownPre,
  table: (props) => <MarkdownBlock {...props} as="table" />,
  td: (props) => <MarkdownBlock {...props} as="td" />,
  th: (props) => <MarkdownBlock {...props} as="th" />,
  ul: (props) => <MarkdownBlock {...props} as="ul" />,
  hr: (props) => <MarkdownBlock {...props} as="hr" />,
  strong: (props) => <MarkdownBlock {...props} as="strong" />,
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
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, variant = 'body' }: MarkdownTextProps) {
  const scope = useContext(MarkdownScopeContext)
  const rendering = useMemo(() => ({ streaming, variant, specialist: scope !== 'default', assistant: scope === 'specialist-assistant' }), [streaming, variant, scope])
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
    () => <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={markdownRehypePlugins} skipHtml urlTransform={markdownUrlTransform} components={markdownComponents}>{parsedText}</ReactMarkdown>,
    [parsedText],
  )
  const applied = stylex.props(
    transcriptStyles.prose,
    streaming && markdownStyles.tightRoot,
    variant === 'reasoning' && markdownStyles.reasoningRoot,
    variant === 'compact' && markdownStyles.compactRoot,
    variant === 'note' && markdownStyles.noteRoot,
    variant === 'muted' && markdownStyles.mutedRoot,
    rendering.assistant && markdownStyles.specialistRoot,
    variant === 'workOrder' && markdownStyles.specialistUserRoot,
    variant === 'prompt' && markdownStyles.promptRoot,
    variant === 'report' && markdownStyles.reportRoot,
    rendering.specialist && variant === 'note' && markdownStyles.specialistNoteRoot,
    rendering.specialist && variant === 'reasoning' && markdownStyles.specialistReasoningRoot,
  )
  return <MarkdownRenderContext.Provider value={rendering}><div className={[streaming ? 'prose is-streaming' : 'prose', applied.className].filter(Boolean).join(' ')}>{markdown}</div></MarkdownRenderContext.Provider>
})
