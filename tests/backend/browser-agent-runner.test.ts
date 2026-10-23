import { describe, expect, it, vi } from 'vitest'
import { runSteps } from '../../browser-agent/runner'
import { matches, pageDiff, parsePage } from '../../browser-agent/targets'
import { validateInput } from '../../browser-agent/validation'
import type { Broker, Classifier, Expectation } from '../../browser-agent/types'

function browser() {
  let generation = 0
  let saved = false
  let value = ''
  const call = vi.fn<Broker['call']>(async (method, params) => {
    if (method === 'read_page') {
      generation += 10
      return { url: 'https://example.test/ticket', title: 'Ticket', text: saved ? 'Ticket saved' : 'Draft', elements: [
        { ref: generation, tag: 'button', name: 'Save' },
        { ref: generation + 1, tag: 'button', name: 'Save & Close' },
        { ref: generation + 2, tag: 'select', name: 'Status', value },
        { ref: generation + 3, tag: 'input', name: 'Subject', value },
        ...[4, 5].map((n) => ({ ref: generation + n, tag: 'a', href: `/edit/${n}`, name: 'Edit' })),
      ] }
    }
    if (method === 'click' || method === 'type') {
      expect(params.ref).toBeGreaterThanOrEqual(generation)
      expect(params.ref).toBeLessThan(generation + 6)
      expect(params.glide).toBe(false)
      if (method === 'click' && params.ref === generation) saved = true
      if (method === 'type') value = String(params.text)
    }
    if (method === 'evaluate') {
      expect(String(params.code)).toContain(`Refs[${generation + (String(params.code).includes('SELECT') ? 2 : 3)}]`)
      return { ok: true, value: JSON.stringify('Open') }
    }
    return { ok: true }
  })
  return { call }
}
const classifier = (confidence: number, ref?: number): Classifier => ({ choose: async () => ({ confidence, ref }), holds: async () => confidence })

describe('browser step execution', () => {
  it('batches canvas clicks, drag and repeated keys without intermediate reads', async () => {
    const call = vi.fn<Broker['call']>(async (method) => method === 'read_page' ? { url: 'https://canvas.test', title: 'Canvas', elements: [] } : { ok: true })
    const result = await runSteps({ steps: [
      { action: 'click', target: { x: 1.5, y: 2 }, double: true, button: 'right' },
      { action: 'drag', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } },
      { action: 'press', key: 'ArrowRight', repeat: 20 },
      { action: 'wait', ms: 0 },
    ] }, { broker: { call } })
    expect(result).toMatchObject({ ok: true, completed: 4, page: { title: 'Canvas' } })
    expect(call.mock.calls.map(([method]) => method)).toEqual(['read_page', 'click', 'drag', 'press_key', 'read_page'])
    expect(call.mock.calls[1][1]).toMatchObject({ x: 1.5, y: 2, double: true, button: 'right', glide: false })
    expect(call.mock.calls[2][1]).toMatchObject({ x: 1, y: 2, to_x: 30, to_y: 40, steps: 12 })
    expect(call.mock.calls[3][1]).toMatchObject({ repeat: 20 })
  })
  it.each([
    { action: 'click', target: { x: -1, y: 1 } },
    { action: 'click', target: { x: Infinity, y: 1 } },
    { action: 'click', target: { x: 1, y: 20001 } },
    { action: 'click', target: { x: 1 } },
    { action: 'click', target: { ref: 1, x: 1, y: 2 } },
    { action: 'press', key: 'ArrowRight', repeat: 0 },
    { action: 'press', key: 'ArrowRight', repeat: 201 },
    { action: 'press', key: 'ArrowRight', repeat: 1.5 },
    { action: 'drag', from: { x: 1, y: 2 }, to: { x: 2, y: 3 }, steps: 51 },
  ])('rejects invalid canvas input %j', (step) => {
    expect(() => validateInput({ steps: [step] })).toThrow()
  })
  it('uses exact names and fresh refs for select, clear, type and click, then verifies the saved page', async () => {
    const broker = browser()
    const result = await runSteps({ tab_id: 'tab', steps: [
      { action: 'select', target: { name: 'Status' }, value: 'Open' },
      { action: 'type', target: { role: 'textbox', name: 'Subject' }, text: 'New subject', clear: true, submit: true },
      { action: 'click', target: { name: 'Save' }, expect: { text_includes: 'Ticket saved', text_absent: 'Draft', url_includes: '/ticket', title_includes: 'Ticket', element: { role: 'button', name: 'Save' } } },
    ] }, { broker })
    expect(result).toMatchObject({ ok: true, completed: 3, page: { title: 'Ticket' } })
    expect(result.steps[2].target?.name).toBe('Save')
    expect(result.diff.changed.map((change) => change.after.name)).toEqual(['Status', 'Subject'])
    expect(broker.call.mock.calls.every(([, params]) => params.tabId === 'tab')).toBe(true)
  })

  it.each([0.79, 0.8, 1, 1.01, Number.NaN])('only resolves ambiguity at a valid confidence: %s', async (confidence) => {
    const result = await runSteps({ steps: [{ action: 'click', target: { name: 'Edit' } }] }, { broker: browser(), classifier: classifier(confidence, 15) })
    expect(result.ok).toBe(confidence >= 0.8 && confidence <= 1)
  })
  it('rejects none, missing and failing classifiers; bounds candidates and stops immediately', async () => {
    for (const judge of [undefined, classifier(1), { ...classifier(1), choose: async () => { throw new Error('provider secret') } }]) {
      const broker: Broker = { call: vi.fn(async () => ({ url: '', title: '', elements: Array.from({ length: 12 }, (_, ref) => ({ ref, tag: 'button', name: 'Edit' })) })) }
      const result = await runSteps({ steps: [{ action: 'click', target: { name: 'Edit' } }, { action: 'navigate', url: 'https://unused.test' }] }, { broker, classifier: judge })
      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].candidates).toHaveLength(10)
      expect(result.steps[0].error).toContain('ambiguous')
      expect(result.steps[0].error).not.toContain('secret')
    }
  })
  it('selects nth and reports no matching target', async () => {
    expect((await runSteps({ steps: [{ action: 'click', target: { name: 'Edit', nth: 1 } }] }, { broker: browser() })).steps[0].target?.ref).toBe(15)
    expect((await runSteps({ steps: [{ action: 'click', target: { name: 'Missing' } }] }, { broker: browser() })).steps[0].error).toBe('No matching target')
  })
  it.each<Expectation>([{ url_includes: 'absent' }, { title_includes: 'absent' }, { text_includes: 'absent' }, { text_absent: 'Draft' }, { element: { name: 'absent' } }])('times out an unmet expectation %j', async (condition) => {
    const result = await runSteps({ steps: [{ action: 'expect', expect: { ...condition, timeout_ms: 0 } }] }, { broker: browser() })
    expect(result.steps[0].error).toBe('Expectation timed out')
  })
  it('polls until evidence arrives', async () => {
    let reads = 0
    const broker: Broker = { call: async () => ({ url: '', title: '', elements: [], text: ++reads >= 3 ? 'Ready' : '' }) }
    expect((await runSteps({ steps: [{ action: 'expect', expect: { text_includes: 'Ready', timeout_ms: 40 } }] }, { broker })).ok).toBe(true)
  })
  it.each([undefined, 0.69, 0.7, 1.1, Number.NaN])('checks judge probability %s', async (probability) => {
    const result = await runSteps({ steps: [{ action: 'expect', expect: { judge: 'Saved' } }] }, { broker: browser(), classifier: probability === undefined ? undefined : classifier(probability) })
    expect(result.ok).toBe(probability === 0.7)
    if (probability === undefined) expect(result.steps[0].error).toContain('requires an available classifier')
  })
  it('dispatches navigation, keys, scroll and wait in order', async () => {
    const broker = browser()
    const result = await runSteps({ steps: [{ action: 'navigate', url: 'https://example.test' }, { action: 'press', key: 'Enter', modifiers: ['Control'] }, { action: 'scroll', direction: 'down', amount: 2, x: 3, y: 4 }, { action: 'wait', ms: 0 }] }, { broker })
    expect(result.completed).toBe(4)
    expect(broker.call.mock.calls.filter(([method]) => method !== 'read_page').map(([method]) => method)).toEqual(['navigate', 'press_key', 'scroll'])
  })
  it('honors abort before acting and during wait', async () => {
    const broker = browser()
    const controller = new AbortController()
    controller.abort()
    expect((await runSteps({ steps: [{ action: 'wait', ms: 0 }] }, { broker, signal: controller.signal })).steps[0].error).toBe('Browser batch aborted')
    expect(broker.call).not.toHaveBeenCalled()
    const pending = runSteps({ steps: [{ action: 'wait', ms: 5000 }] }, { broker, signal: AbortSignal.timeout(20) })
    expect((await pending).steps[0].error).toBe('Browser batch aborted')
  })
  it.each([{ ok: false }, { error: 'offline' }])('stops on broker errors %j', async (response) => {
    const result = await runSteps({ steps: [{ action: 'wait', ms: 0 }] }, { broker: { call: async () => response } })
    expect(result.ok).toBe(false)
  })
  it.each([{ ok: true }, { ok: true, value: 'not JSON' }])('rejects invalid evaluate responses %j', async (response) => {
    const original = browser()
    const broker: Broker = { call: (method, params) => method === 'evaluate' ? Promise.resolve(response) : original.call(method, params) }
    expect((await runSteps({ steps: [{ action: 'select', target: { name: 'Status' }, value: 'Open' }] }, { broker })).steps[0].error).toContain('Browser evaluate')
  })
})

describe('page semantics', () => {
  it('derives implicit roles and rejects malformed pages', () => {
    const tags = [ ['a', 'link', { href: '/' }], ['summary', 'button', {}], ['textarea', 'textbox', {}], ['div', 'textbox', { contentEditable: true }], ['select', 'combobox', {}], ['input', 'checkbox', { inputType: 'checkbox' }], ['input', 'radio', { inputType: 'radio' }], ['input', 'button', { inputType: 'submit' }], ['input', 'textbox', {}], ['input', 'input', { inputType: 'color' }], ['div', 'heading', { role: ' Heading ' }] ] as const
    const page = parsePage({ url: '', title: '', elements: tags.map(([tag, , extra], ref) => ({ ref, name: 'Name', tag, ...extra })) })
    expect(page.elements.map((el) => el.role)).toEqual(tags.map(([, role]) => role))
    for (const raw of [null, {}, { url: '', title: '', elements: [{ ref: -1, name: 'bad' }] }]) expect(() => parsePage(raw)).toThrow('invalid')
  })
  it('ranks exact then prefix then substring, with disabled matches last', () => {
    const elements = [{ ref: 0, role: 'button', name: 'Please Save' }, { ref: 1, role: 'button', name: 'Save & Close' }, { ref: 2, role: 'button', name: 'Save', disabled: true }]
    expect(matches({ name: ' save ' }, elements).map((el) => el.ref)).toEqual([1])
    expect(matches({ ref: 2 }, elements)).toEqual([elements[2]])
    expect(matches({ role: 'link' }, elements)).toEqual([])
  })
  it('diffs additions, removals and duplicate-key changes without treating ref churn as changes', () => {
    const before = { url: '', title: '', elements: [{ ref: 1, role: 'link', name: 'Edit', value: 'old' }, { ref: 2, role: 'link', name: 'Edit' }, { ref: 3, role: 'button', name: 'Delete' }] }
    const after = { ...before, elements: [{ ref: 10, role: 'link', name: 'Edit', value: 'new' }, { ref: 11, role: 'link', name: 'Edit' }, { ref: 12, role: 'button', name: 'Saved' }] }
    expect(pageDiff(before, after)).toEqual({ added: [after.elements[2]], removed: [before.elements[2]], changed: [{ before: before.elements[0], after: after.elements[0] }] })
  })
})

describe('step validation', () => {
  it.each([
    [{ action: 'click' }, 'target'], [{ action: 'type', target: { name: 'X' } }, 'text'], [{ action: 'select', target: { name: 'X' } }, 'value'], [{ action: 'navigate' }, 'url'], [{ action: 'press' }, 'key'], [{ action: 'scroll' }, 'direction'], [{ action: 'wait' }, 'ms'], [{ action: 'expect' }, 'expect'],
    [{ action: 'unknown' }, 'Unknown'], [null, 'object'], [{ action: 'click', target: {} }, 'role or name'], [{ action: 'click', target: { name: '' } }, 'empty'], [{ action: 'click', target: { ref: 1, name: 'X' } }, 'ref alone'], [{ action: 'click', target: { ref: 1000 } }, 'ref'], [{ action: 'click', target: { name: 'X', nth: -1 } }, 'nth'], [{ action: 'click', target: { name: 'X', role: 1 } }, 'role'],
    [{ action: 'type', target: { name: 'X' }, text: '', clear: 1 }, 'clear'], [{ action: 'type', target: { name: 'X' }, text: '', submit: 1 }, 'submit'], [{ action: 'press', key: 'A', modifiers: [1] }, 'modifiers'], [{ action: 'scroll', direction: 'up', amount: Number.NaN }, 'finite'], [{ action: 'scroll', direction: 'up', x: Infinity }, 'finite'], [{ action: 'scroll', direction: 'up', y: '3' }, 'finite'], [{ action: 'wait', ms: 5001 }, 'ms'], [{ action: 'expect', expect: {} }, 'condition'], [{ action: 'expect', expect: { judge: 1 } }, 'judge'], [{ action: 'expect', expect: { text_includes: '', timeout_ms: 10001 } }, 'timeout_ms'],
  ])('rejects %j with a field-specific error', (step, message) => {
    expect(() => validateInput({ steps: [step] })).toThrow(String(message))
  })
  it('enforces batch bounds and tab type', () => {
    for (const steps of [[], Array.from({ length: 26 }, () => ({ action: 'wait', ms: 0 }))]) expect(() => validateInput({ steps })).toThrow('1 to 25')
    expect(() => validateInput({ tab_id: 3, steps: [{ action: 'wait', ms: 0 }] })).toThrow('tab_id')
  })
})
