import { setTimeout as delay } from 'node:timers/promises'
import { matches, pageDiff, parsePage, record, resolveTarget, TargetError } from './targets'
import { validateInput } from './validation'
import type { Expectation, Page, RunInput, RunOptions, RunResult, StepResult } from './types'

// A shared broker owns the page ref table. Serialize batches on that broker so our
// own concurrent calls cannot replace refs between read and action.
const queues = new WeakMap<object, Promise<unknown>>()
export async function runSteps(input: RunInput, options: RunOptions): Promise<RunResult> {
  validateInput(input)
  return withBrokerLock(options.broker, () => execute(input, options))
}

/** Standalone task reads must not replace refs during another batch's action. */
export async function withBrokerLock<T>(broker: RunOptions['broker'], action: () => Promise<T>): Promise<T> {
  const previous = queues.get(broker) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(action)
  queues.set(broker, run)
  try {
    return await run
  } finally {
    if (queues.get(broker) === run) queues.delete(broker)
  }
}

async function execute(input: RunInput, { broker, classifier, signal, intent }: RunOptions): Promise<RunResult> {
  const started = Date.now()
  let page: Page = { url: '', title: '', elements: [] }
  let before = page
  let stale = true
  const steps: StepResult[] = []
  const call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    signal?.throwIfAborted()
    const result = await broker.call(method, { ...params, tabId: input.tab_id }, signal)
    if (record(result) && (result.ok === false || typeof result.error === 'string')) throw new Error(typeof result.error === 'string' ? result.error : 'Browser action failed')
    return result
  }
  const evaluate = async (code: string): Promise<unknown> => {
    const result = await call('evaluate', { code })
    if (!record(result) || result.ok !== true || typeof result.value !== 'string') throw new Error('Browser evaluate returned an invalid result')
    try {
      return JSON.parse(result.value)
    } catch {
      throw new Error('Browser evaluate returned invalid JSON')
    }
  }
  const read = async (text = false): Promise<Page> => {
    const raw = await call('read_page', { mode: text ? 'text' : 'interactive' })
    // Older brokers omit editable metadata and textarea values. Enrich only
    // those reads; do not change the broker's ref table or expose passwords.
    if (record(raw) && Array.isArray(raw.elements) && raw.elements.some((el) => record(el) && (el.tag === 'textarea' || !['input', 'button', 'a', 'select', 'summary'].includes(String(el.tag))))) {
      const metadata = await evaluate(
        `return (window.__primeWorkAgentRefs || []).map((el, ref) => ({ref, contenteditable: el.isContentEditable === true, ...(el.tagName === 'TEXTAREA' ? {value: el.value.slice(0, 120)} : {})}));`,
      )
      if (Array.isArray(metadata)) {
        for (const el of raw.elements) {
          if (!record(el)) continue
          const extra = metadata.find((item) => record(item) && item.ref === el.ref)
          if (record(extra)) {
            el.contenteditable = extra.contenteditable
            if (typeof extra.value === 'string') el.value = extra.value
          }
        }
      }
    }
    page = parsePage(raw)
    stale = false
    return page
  }
  const check = async (expect: Expectation): Promise<void> => {
    const deadline = Date.now() + (expect.timeout_ms ?? 2000)
    for (;;) {
      const current = await read(expect.text_includes !== undefined || expect.text_absent !== undefined)
      const passed =
        (expect.url_includes === undefined || current.url.includes(expect.url_includes)) &&
        (expect.title_includes === undefined || current.title.includes(expect.title_includes)) &&
        (expect.text_includes === undefined || current.text?.includes(expect.text_includes)) &&
        (expect.text_absent === undefined || (current.text !== undefined && !current.text.includes(expect.text_absent))) &&
        (expect.element === undefined || matches(expect.element, current.elements).length > 0)
      if (passed) break
      if (Date.now() >= deadline) throw new Error('Expectation timed out')
      await delay(Math.min(250, Math.max(0, deadline - Date.now())), undefined, { signal })
    }
    if (expect.judge !== undefined) {
      if (!classifier) throw new Error('Expectation judge requires an available classifier')
      const probability = await classifier.holds(JSON.stringify({ ...page, text: page.text?.slice(0, 6000) }), expect.judge)
      if (!Number.isFinite(probability) || probability < 0.7 || probability > 1) throw new Error('Classifier did not confirm the expectation at probability >= 0.7')
    }
  }
  for (const [index, step] of input.steps.entries()) {
    const result: StepResult = { index, action: step.action, ok: false }
    steps.push(result)
    try {
      signal?.throwIfAborted()
      if (index === 0) before = await read()
      const target = 'target' in step && !('x' in step.target) ? await resolveTarget(step.target, index === 0 ? page : await read(), intent || step.action, classifier) : undefined
      stale = true
      if (target) result.target = { ref: target.ref, role: target.role, name: target.name }
      switch (step.action) {
        case 'click':
          await call('click', { ...('x' in step.target ? step.target : { ref: target?.ref }), double: step.double, button: step.button, glide: false })
          break
        case 'drag': {
          const current = (!('x' in step.from) || !('x' in step.to)) && index !== 0 ? await read() : page
          const from = 'x' in step.from ? step.from : { ref: (await resolveTarget(step.from, current, intent || 'drag', classifier)).ref }
          const to = 'x' in step.to ? { to_x: step.to.x, to_y: step.to.y } : { to_ref: (await resolveTarget(step.to, current, intent || 'drag', classifier)).ref }
          stale = true
          await call('drag', { ...from, ...to, steps: step.steps ?? 12 })
          break
        }
        case 'type':
          if (step.clear)
            await evaluate(
              `const el = window.__primeWorkAgentRefs[${target?.ref}]; if (!el || !el.isConnected) throw new Error('Stale target'); el.focus(); if (typeof el.select === 'function') el.select(); else if (el.isContentEditable) { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); } else throw new Error('Target cannot be cleared'); return true;`,
            )
          await call('type', { ref: target?.ref, text: step.text, submit: step.submit, glide: false })
          break
        case 'select':
          result.detail = await evaluate(
            `const el = window.__primeWorkAgentRefs[${target?.ref}]; if (!el || !el.isConnected || el.tagName !== 'SELECT') throw new Error('Target is not a connected select'); const value = ${JSON.stringify(step.value)}; const option = Array.from(el.options).find(o => o.value === value) || Array.from(el.options).find(o => o.text.trim() === value.trim()); if (!option || option.disabled || el.disabled) throw new Error('Option unavailable'); el.value = option.value; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return option.text;`,
          )
          break
        case 'press':
          await call('press_key', { key: step.key, modifiers: step.modifiers, repeat: step.repeat })
          break
        case 'navigate':
          await call('navigate', { url: step.url })
          break
        case 'scroll':
          await call('scroll', { direction: step.direction, amount: step.amount, x: step.x, y: step.y })
          break
        case 'wait':
          await delay(step.ms, undefined, { signal })
          break
        case 'expect':
          break
        default: {
          const exhaustive: never = step
          throw new Error(`Unknown step: ${exhaustive}`)
        }
      }
      const coordinateOnly = (step.action === 'click' && 'x' in step.target) || (step.action === 'drag' && 'x' in step.from && 'x' in step.to) || step.action === 'press' || step.action === 'wait'
      if (step.action !== 'expect' && !coordinateOnly && !step.expect) await read()
      if (step.expect) await check(step.expect)
      result.ok = true
    } catch (error) {
      result.error = signal?.aborted ? 'Browser batch aborted' : error instanceof Error ? error.message : String(error)
      if (error instanceof TargetError) result.candidates = error.candidates
      break
    }
  }
  if (stale) {
    try { await read() } catch (error) {
      const last = steps[steps.length - 1]
      last.ok = false
      last.error ??= error instanceof Error ? error.message : String(error)
    }
  }
  return {
    ok: steps.every((step) => step.ok),
    completed: steps.filter((step) => step.ok).length,
    steps,
    page: { url: page.url, title: page.title },
    diff: pageDiff(before, page),
    elapsed_ms: Date.now() - started,
  }
}
