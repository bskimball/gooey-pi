import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from '../../apps/desktop/src/components/MarkdownText'
import { applyVisualPreviewGuideline, VISUAL_PREVIEW_GUIDELINE } from '../../apps/desktop/assets/extensions/apex-visual-previews'

describe('chat Markdown rendering', () => {
  it('groups consecutive image paragraphs and retains text around individual inline images', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const html = renderToStaticMarkup(createElement(MarkdownText, {
      text: `![First](${src})\n\n![Second](${src})\n\nSee ![Detail](${src}) here.`,
    }))
    expect(html.match(/aria-roledescription="carousel"/g)).toHaveLength(1)
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(2)
    expect(html).toMatch(/<p\b[^>]*>See <button[^>]*>[\s\S]*?alt="Detail"[\s\S]*?<\/button> here\.<\/p>/)
  })

  it('renders common Markdown structures instead of exposing their markers', () => {
    const html = renderToStaticMarkup(createElement(MarkdownText, {
      text: '## Result\n\n**Done** with `code`.\n\n- one\n- two\n\n```ts\nconst ok = true\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    }))

    expect(html).toMatch(/<h2\b[^>]*dir="auto"[^>]*>Result<\/h2>/)
    expect(html).toMatch(/<strong\b[^>]*>Done<\/strong>/)
    expect(html).toMatch(/<ul\b[^>]*dir="auto"/)
    expect(html).toMatch(/<pre\b[^>]*dir="ltr"[^>]*><code\b[^>]*class="language-ts\b/)
    expect(html).toMatch(/<table\b/)
  })

  it('preserves local file URLs as clickable links without enabling unsafe schemes', () => {
    const url = 'file:///C:/Users/bskim/Work/output/holt-logistics/Holt-Logistics-IBMi-Migration-Plan-v0.1.docx'
    const html = renderToStaticMarkup(createElement(MarkdownText, { text: `[Migration plan](${url})` }))
    expect(html).toContain(`href="${url}"`)
    expect(html).not.toContain('markdown-link-unsupported')
    for (const href of ['javascript:alert(1)', 'data:text/html,bad', 'vbscript:bad']) {
      const unsafe = renderToStaticMarkup(createElement(MarkdownText, { text: `[Unsafe](${href})` }))
      expect(unsafe).not.toContain('<a')
    }
  })

  it('renders fenced HTML as a sandboxed preview and still strips raw HTML', () => {
    const html = renderToStaticMarkup(createElement(MarkdownText, {
      text: 'Option A\n\n```html\n<section><h1>Mineral</h1></section>\n```\n\n<script>bad()</script>',
    }))
    expect(html).toMatch(/class="html-preview(?:\s|")/)
    expect(html).toContain('sandbox=""')
    expect(html).toContain('Mineral')
    expect(html).toContain('default-src &#x27;none&#x27;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<section>')
  })

  it('asks the agent for HTML option previews without duplicating the guideline', () => {
    const guidelines = ['Keep answers short.']
    const event = { systemPromptOptions: { promptGuidelines: guidelines } }
    applyVisualPreviewGuideline(event)
    applyVisualPreviewGuideline(event)
    expect(guidelines).toEqual(['Keep answers short.', VISUAL_PREVIEW_GUIDELINE])
    applyVisualPreviewGuideline({})
  })

  it('does not enable raw HTML or remote image loading', () => {
    const html = renderToStaticMarkup(createElement(MarkdownText, {
      text: '<script>bad()</script>\n\n![tracking](https://example.com/pixel.png)',
    }))

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('[Image: tracking]')

    const relative = renderToStaticMarkup(createElement(MarkdownText, { text: '[App](src/App.tsx)' }))
    expect(relative).not.toContain('<a')
    expect(relative).toContain('markdown-link-unsupported')
  })
})
