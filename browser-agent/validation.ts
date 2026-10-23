import { record } from './targets'
import type { Expectation, RunInput, Target } from './types'

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
}
function integer(value: unknown, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be an integer from ${min} to ${max}`)
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`)
}
function target(value: unknown, coordinates = false): asserts value is Target {
  if (!record(value)) throw new Error('target must be an object')
  if ('x' in value || 'y' in value) {
    if (!coordinates) throw new Error('Coordinate target is not supported for this action')
    fields(value, ['x', 'y'])
    for (const key of ['x', 'y']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 20000) throw new Error(`${key} must be finite and from 0 to 20000`)
    return
  }
  if ('ref' in value) {
    integer(value.ref, 0, 999, 'ref')
    if (['role', 'name', 'nth', 'intent'].some((key) => value[key] !== undefined)) throw new Error('target must use ref alone, or role/name with optional nth/intent')
    fields(value, ['ref'])
    return
  }
  fields(value, ['role', 'name', 'nth', 'intent'])
  if (typeof value.role !== 'string' && typeof value.name !== 'string') throw new Error('target needs role or name')
  for (const key of ['role', 'name', 'intent']) if (value[key] !== undefined) text(value[key], key)
  if (!String(value.role ?? value.name).trim()) throw new Error('target role or name must not be empty')
  if (value.nth !== undefined) integer(value.nth, 0, 999, 'nth')
}
function expectation(value: unknown): asserts value is Expectation {
  if (!record(value)) throw new Error('expect must be an object')
  fields(value, ['url_includes', 'title_includes', 'text_includes', 'text_absent', 'element', 'judge', 'timeout_ms'])
  for (const key of ['url_includes', 'title_includes', 'text_includes', 'text_absent', 'judge']) if (value[key] !== undefined) text(value[key], key)
  if (value.element !== undefined) target(value.element)
  if (value.timeout_ms !== undefined) integer(value.timeout_ms, 0, 10000, 'timeout_ms')
  if (!['url_includes', 'title_includes', 'text_includes', 'text_absent', 'element', 'judge'].some((key) => value[key] !== undefined)) throw new Error('expect needs a condition')
}
export function validateInput(value: unknown): asserts value is RunInput {
  if (!record(value) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 25) throw new Error('steps must contain 1 to 25 steps')
  fields(value, ['steps', 'tab_id'])
  if (value.tab_id !== undefined) text(value.tab_id, 'tab_id')
  for (const step of value.steps) {
    if (!record(step)) throw new Error('Each step must be an object')
    const allowed: Record<string, string[]> = {
      click: ['target', 'double', 'button'], drag: ['from', 'to', 'steps'], type: ['target', 'text', 'submit', 'clear'], select: ['target', 'value'],
      press: ['key', 'modifiers', 'repeat'], navigate: ['url'], scroll: ['direction', 'amount', 'x', 'y'], wait: ['ms'], expect: [],
    }
    if (typeof step.action === 'string' && allowed[step.action]) fields(step, ['action', 'expect', ...allowed[step.action]])
    if (step.expect !== undefined) expectation(step.expect)
    switch (step.action) {
      case 'click':
        target(step.target, true)
        if (step.double !== undefined && typeof step.double !== 'boolean') throw new Error('double must be boolean')
        if (step.button !== undefined && (typeof step.button !== 'string' || !['left', 'right', 'middle'].includes(step.button))) throw new Error('Invalid button')
        break
      case 'drag':
        target(step.from, true)
        target(step.to, true)
        if (step.steps !== undefined) integer(step.steps, 1, 50, 'steps')
        break
      case 'type':
        target(step.target)
        text(step.text, 'text')
        for (const key of ['submit', 'clear']) if (step[key] !== undefined && typeof step[key] !== 'boolean') throw new Error(`${key} must be boolean`)
        break
      case 'select':
        target(step.target)
        text(step.value, 'value')
        break
      case 'navigate':
        text(step.url, 'url')
        break
      case 'press':
        text(step.key, 'key')
        if (step.repeat !== undefined) integer(step.repeat, 1, 200, 'repeat')
        if (step.modifiers !== undefined && (!Array.isArray(step.modifiers) || !step.modifiers.every((item) => typeof item === 'string'))) throw new Error('modifiers must be strings')
        break
      case 'scroll':
        if (!['up', 'down', 'left', 'right'].includes(String(step.direction))) throw new Error('Invalid scroll direction')
        for (const key of ['amount', 'x', 'y']) if (step[key] !== undefined && (typeof step[key] !== 'number' || !Number.isFinite(step[key]))) throw new Error(`${key} must be finite`)
        break
      case 'wait':
        integer(step.ms, 0, 5000, 'ms')
        break
      case 'expect':
        expectation(step.expect)
        break
      default:
        throw new Error('Unknown step action')
    }
  }
}
