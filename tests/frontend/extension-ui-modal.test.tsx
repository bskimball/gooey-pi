// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionUiModal } from '../../src/components/ExtensionUiModal'
import type { ExtensionUiRequest } from '../../src/lib/extension-ui'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0) })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => window.clearTimeout(id) })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const request: ExtensionUiRequest = {
  method: 'questionnaire',
  id: 'group-1',
  title: 'Project setup',
  total: 2,
  complete: true,
  questions: [
    { id: 'q1', title: 'Pick a framework', options: ['React', 'Vue'], index: 0 },
    { id: 'q2', title: 'Pick a language', options: ['TypeScript', 'JavaScript'], index: 1 },
  ],
}

function questionnaireElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.extension-questionnaire')
  if (!element) throw new Error('questionnaire not rendered')
  return element
}

function currentQuestionTitle(): string {
  return document.querySelector('.extension-questionnaire__question h3')?.textContent ?? ''
}

function pressKey(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}

async function clickButton(button: HTMLButtonElement): Promise<void> {
  button.focus()
  await act(async () => { button.click() })
}

describe('extension questionnaire keyboard handling', () => {
  it('leaves Tab to the focus trap instead of hijacking it for question navigation', async () => {
    await act(async () => { root.render(<ExtensionUiModal request={request} onRespond={vi.fn()} />) })
    const optionButton = questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button')!
    pressKey(optionButton, { key: 'Tab' })
    expect(currentQuestionTitle()).toBe('Pick a framework')
  })

  it('navigates questions with explicit keys only', async () => {
    await act(async () => { root.render(<ExtensionUiModal request={request} onRespond={vi.fn()} />) })
    const optionButton = questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button')!
    pressKey(optionButton, { key: 'ArrowRight' })
    expect(currentQuestionTitle()).toBe('Pick a framework')
    pressKey(optionButton, { key: 'ArrowRight', ctrlKey: true })
    expect(currentQuestionTitle()).toBe('Pick a language')
    const nextOption = questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button')!
    pressKey(nextOption, { key: 'ArrowLeft', ctrlKey: true })
    expect(currentQuestionTitle()).toBe('Pick a framework')
    pressKey(questionnaireElement(), { key: 'PageDown' })
    expect(currentQuestionTitle()).toBe('Pick a language')
    pressKey(questionnaireElement(), { key: 'PageUp' })
    expect(currentQuestionTitle()).toBe('Pick a framework')
  })

  it('keeps navigation focused after the final option auto-advances to the submit summary', async () => {
    await act(async () => { root.render(<ExtensionUiModal request={request} onRespond={vi.fn()} />) })
    await clickButton(questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button')!)
    expect(currentQuestionTitle()).toBe('Pick a language')

    await clickButton(questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button')!)
    expect(currentQuestionTitle()).toBe('')
    const summaryProgress = questionnaireElement().querySelector<HTMLButtonElement>('.extension-questionnaire__progress button:last-child')!
    expect(document.activeElement).toBe(summaryProgress)
    expect(summaryProgress.getAttribute('aria-current')).toBe('step')

    pressKey(document.activeElement as HTMLElement, { key: 'ArrowLeft', ctrlKey: true })
    expect(currentQuestionTitle()).toBe('Pick a language')

    await clickButton(summaryProgress)
    expect(currentQuestionTitle()).toBe('')
    pressKey(document.activeElement as HTMLElement, { key: 'PageUp' })
    expect(currentQuestionTitle()).toBe('Pick a language')
  })

  it('keeps caret movement in the context field when pressing bare arrow keys', async () => {
    await act(async () => { root.render(<ExtensionUiModal request={request} onRespond={vi.fn()} />) })
    const contextInput = questionnaireElement().querySelector<HTMLInputElement>('.extension-questionnaire__context input')!
    const event = pressKey(contextInput, { key: 'ArrowLeft' })
    expect(event.defaultPrevented).toBe(false)
    expect(currentQuestionTitle()).toBe('Pick a framework')
  })

  it('does not hijack printable keys when a button has focus', async () => {
    await act(async () => { root.render(<ExtensionUiModal request={request} onRespond={vi.fn()} />) })
    const optionButton = questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button')!
    const event = pressKey(optionButton, { key: 'a' })
    expect(event.defaultPrevented).toBe(false)
    const contextInput = questionnaireElement().querySelector<HTMLInputElement>('.extension-questionnaire__context input')!
    expect(contextInput.value).toBe('')
    // Digit shortcuts still select options from a focused button.
    pressKey(optionButton, { key: '2' })
    const selected = questionnaireElement().querySelector<HTMLButtonElement>('.extension-question__options button.is-selected')!
    expect(selected.textContent).toContain('Vue')
  })
})

describe('extension select search', () => {
  const models = Array.from({ length: 40 }, (_, index) => `${index % 2 ? 'openai' : 'claude-bridge'}/model-${index}`)
  const selectRequest: ExtensionUiRequest = { method: 'select', id: 'lead', title: 'Fusion lead model', options: ['openai/gpt-6-astra', ...models] }

  function searchInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('.extension-question__search input')
    if (!input) throw new Error('search not rendered')
    return input
  }

  async function typeQuery(value: string) {
    const input = searchInput()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function visibleOptions(): string[] {
    return [...document.querySelectorAll('.extension-question__options [role="option"]')].map((option) => option.textContent ?? '')
  }

  it('filters more than 32 options case-insensitively and answers with the exact provider/model', async () => {
    const onRespond = vi.fn()
    await act(async () => { root.render(<ExtensionUiModal request={selectRequest} onRespond={onRespond} />) })
    expect(visibleOptions()).toHaveLength(41)
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 10)) })
    expect(document.activeElement).toBe(searchInput())

    await typeQuery('OPENAI model-1')
    expect(visibleOptions()).toEqual(['openai/model-1', 'openai/model-11', 'openai/model-13', 'openai/model-15', 'openai/model-17', 'openai/model-19'])
    pressKey(searchInput(), { key: 'ArrowDown' })
    pressKey(searchInput(), { key: 'ArrowDown' })
    pressKey(searchInput(), { key: 'ArrowUp' })
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe('openai/model-11')
    expect(searchInput().getAttribute('aria-activedescendant')).toBe(document.querySelector('[role="option"][aria-selected="true"]')?.id)
    pressKey(searchInput(), { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith({ value: 'openai/model-11' })
  })

  it('shows a clear empty state and ignores Enter when nothing matches', async () => {
    const onRespond = vi.fn()
    await act(async () => { root.render(<ExtensionUiModal request={selectRequest} onRespond={onRespond} />) })
    await typeQuery('no-such-model')
    expect(visibleOptions()).toEqual([])
    expect(document.querySelector('.extension-question__empty')?.textContent).toContain('No options match “no-such-model”')
    const event = pressKey(searchInput(), { key: 'Enter' })
    expect(event.defaultPrevented).toBe(true)
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('cancels with Escape from the search field', async () => {
    const onRespond = vi.fn()
    await act(async () => { root.render(<ExtensionUiModal request={selectRequest} onRespond={onRespond} />) })
    pressKey(searchInput(), { key: 'Escape' })
    expect(onRespond).toHaveBeenCalledWith({ cancelled: true })
  })

  it('focuses the first short-select option so Enter answers instead of closing', async () => {
    const onRespond = vi.fn()
    await act(async () => { root.render(<ExtensionUiModal request={{ method: 'select', id: 'thinking', title: 'Sidekick thinking', options: ['low', 'medium', 'high'] }} onRespond={onRespond} />) })
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 10)) })
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    expect(document.activeElement).toBe(options[0])

    pressKey(options[0], { key: 'ArrowDown' })
    pressKey(options[1], { key: 'ArrowDown' })
    pressKey(options[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options[2])
    pressKey(options[2], { key: 'Home' })
    expect(document.activeElement).toBe(options[0])
    pressKey(options[0], { key: 'End' })
    pressKey(options[2], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(options[1])
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe('2medium')

    const event = pressKey(options[1], { key: 'Enter' })
    expect(event.defaultPrevented).toBe(true)
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ value: 'medium' })
  })

  it('keeps short selects as a numbered button list without search', async () => {
    const onRespond = vi.fn()
    await act(async () => { root.render(<ExtensionUiModal request={{ method: 'select', id: 'x', title: 'Thinking', options: ['high', 'medium'] }} onRespond={onRespond} />) })
    expect(document.querySelector('.extension-question__search')).toBeNull()
    expect(visibleOptions()).toEqual(['1high', '2medium'])
    await clickButton(document.querySelectorAll<HTMLButtonElement>('[role="option"]')[1])
    expect(onRespond).toHaveBeenCalledWith({ value: 'medium' })
  })
})
