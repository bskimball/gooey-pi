// @vitest-environment jsdom

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from '../../apps/desktop/src/components/MarkdownText'

function render(text: string): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(MarkdownText, { text })), 'text/html')
}

describe('Markdown text direction', () => {
  it('lets each paragraph of a mixed English and Persian message pick its own direction', () => {
    const document = render('**Cursor**\n\nاین فایل را ببینید (`file-name.md`):')

    expect(document.querySelector('.prose')?.hasAttribute('dir')).toBe(false)
    expect([...document.querySelectorAll('p')].map((element) => [element.dir, element.textContent])).toEqual([
      ['auto', 'Cursor'],
      ['auto', 'این فایل را ببینید (file-name.md):'],
    ])
    expect(document.querySelector('p strong')?.textContent).toBe('Cursor')
    expect(document.querySelector('p code[dir="ltr"]')?.textContent).toBe('file-name.md')
  })

  it('renders RTL prose with isolated LTR code, URLs, and code blocks', () => {
    const document = render('مسیر `src/App.tsx` و https://example.com را بررسی کنید.\n\n```ts\nconst answer = true\n```')

    expect(document.querySelector('p[dir="auto"]')?.textContent).toContain('مسیر src/App.tsx')
    expect(document.querySelector('p code[dir="ltr"]')?.textContent).toBe('src/App.tsx')
    expect(document.querySelector('a > bdi')?.textContent).toBe('https://example.com')
    expect(document.querySelector('pre[dir="ltr"] > code.language-ts[dir="ltr"]')?.textContent).toContain('const answer = true')
  })

  it('keeps code-first paragraphs auto-directed so the LTR code does not decide the base direction', () => {
    const document = render('`src/App.tsx` سپس ادامه دهید.')
    const paragraph = document.querySelector('p')

    expect(paragraph?.dir).toBe('auto')
    expect(paragraph?.textContent).toBe('src/App.tsx سپس ادامه دهید.')
    expect(paragraph?.firstElementChild?.matches('code[dir="ltr"]')).toBe(true)
  })

  it('auto-directs lists, headings, blockquotes, and table cells', () => {
    const document = render([
      '# عنوان', '', '- مورد اول', '', '1. First item', '', '> نقل قول', '',
      '| Header | سرستون |', '| --- | --- |', '| cell | سلول |',
    ].join('\n'))

    for (const tag of ['h1', 'ul', 'li', 'ol', 'blockquote', 'th', 'td']) {
      const elements = [...document.querySelectorAll(tag)]
      expect(elements.length).toBeGreaterThan(0)
      expect(elements.every((element) => element.getAttribute('dir') === 'auto')).toBe(true)
    }
    expect(document.querySelector('h1')?.textContent).toBe('عنوان')
    expect([...document.querySelectorAll('li')].map((element) => element.textContent)).toEqual(['مورد اول', 'First item'])
    expect([...document.querySelectorAll('th')].map((element) => element.textContent)).toEqual(['Header', 'سرستون'])
    expect([...document.querySelectorAll('td')].map((element) => element.textContent)).toEqual(['cell', 'سلول'])
  })
})
