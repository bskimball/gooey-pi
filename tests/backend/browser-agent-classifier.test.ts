import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClassifier } from '../../apps/desktop/browser-agent/classifier'

const home = vi.hoisted(() => ({ directory: '' }))
vi.mock('node:os', async (importOriginal) => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => home.directory }))
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apex-classifier-'))
  home.directory = root
  vi.stubEnv('PI_CODING_AGENT_DIR', root)
  vi.stubEnv('APEX_BROWSER_AGENT_CLASSIFIER', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})
function registry(answer: unknown = { type: 'bool', probability: 0.9 }) {
  return { getModelOfType: vi.fn(() => ({ id: 'test-model' })), classify: vi.fn(async () => ({ stopReason: 'stop', answers: { decision: answer } })) }
}
const candidates = [{ ref: 7, role: 'button', name: 'Save' }]

describe('host classifier', () => {
  it('parses an env override at the first slash and bypasses config', async () => {
    writeFileSync(join(root, 'jev.json'), 'invalid')
    vi.stubEnv('APEX_BROWSER_AGENT_CLASSIFIER', ' custom/family/model ')
    const host = registry({ type: 'choice', choice: 'ref_7', confidence: 0.8 })
    expect(await createClassifier(host)?.choose('save', candidates)).toEqual({ ref: 7, confidence: 0.8 })
    expect(host.getModelOfType).toHaveBeenCalledWith('classifier', 'custom', 'family/model')
    expect(host.classify).toHaveBeenCalledWith({ id: 'test-model' }, expect.objectContaining({ questions: { decision: expect.objectContaining({ type: 'choice', criteria: expect.objectContaining({ none: expect.any(String), ref_7: expect.any(String) }) }) } }), expect.objectContaining({ timeoutMs: 30000, maxRetries: 0 }))
  })
  it.each(['no-slash', '/model', 'provider/'])('rejects invalid override %s', (value) => {
    vi.stubEnv('APEX_BROWSER_AGENT_CLASSIFIER', value)
    expect(() => createClassifier(registry())).toThrow('provider/model')
  })
  it.each(['$APEX_CLASSIFIER_TEST_KEY', '${APEX_CLASSIFIER_TEST_KEY}'])('resolves config key reference %s', async (apiKey) => {
    writeFileSync(join(root, 'jev.json'), JSON.stringify({ provider: 'cloudflare-workers-ai', apiKey }))
    vi.stubEnv('APEX_CLASSIFIER_TEST_KEY', ' fixture-key ')
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ' account ')
    const host = registry()
    expect(await createClassifier(host)?.holds('page', 'saved')).toBe(0.9)
    expect(host.getModelOfType).toHaveBeenCalledWith('classifier', 'cloudflare-workers-ai', 'typesafe/jev')
    expect(host.classify).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ apiKey: 'fixture-key', env: { CLOUDFLARE_ACCOUNT_ID: 'account' } }))
  })
  it('prefers PI_CODING_AGENT_DIR to XDG, then uses XDG/pi when PI is unset', () => {
    const xdg = join(root, 'xdg')
    mkdirSync(join(xdg, 'pi'), { recursive: true })
    writeFileSync(join(xdg, 'pi', 'jev.json'), JSON.stringify({ provider: 'xdg', model: 'selected' }))
    vi.stubEnv('XDG_CONFIG_HOME', xdg)
    const first = registry()
    createClassifier(first)
    expect(first.getModelOfType).toHaveBeenCalledWith('classifier', 'typesafe', 'jev-latest')
    vi.stubEnv('PI_CODING_AGENT_DIR', undefined)
    const second = registry()
    createClassifier(second)
    expect(second.getModelOfType).toHaveBeenCalledWith('classifier', 'xdg', 'selected')
  })
  it('falls back to ~/.pi when neither config directory override is set', () => {
    mkdirSync(join(root, '.pi'))
    writeFileSync(join(root, '.pi', 'jev.json'), JSON.stringify({ provider: 'home', model: 'selected' }))
    vi.stubEnv('PI_CODING_AGENT_DIR', undefined)
    vi.stubEnv('XDG_CONFIG_HOME', undefined)
    const host = registry()
    createClassifier(host)
    expect(host.getModelOfType).toHaveBeenCalledWith('classifier', 'home', 'selected')
  })
  it('does not send an unresolved env key and maps none to no ref', async () => {
    writeFileSync(join(root, 'jev.json'), JSON.stringify({ apiKey: '$APEX_CLASSIFIER_MISSING_KEY' }))
    vi.stubEnv('APEX_CLASSIFIER_MISSING_KEY', undefined)
    const host = registry({ type: 'choice', choice: 'none', confidence: 1 })
    expect(await createClassifier(host)?.choose('save', candidates)).toEqual({ ref: undefined, confidence: 1 })
    expect(host.classify.mock.calls[0]).toBeDefined()
    expect(host.classify).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.not.objectContaining({ apiKey: expect.anything() }))
  })
  it('returns undefined for missing host capability or model', () => {
    for (const host of [undefined, {}, { getModelOfType: () => ({}) }, { ...registry(), getModelOfType: () => undefined }]) expect(createClassifier(host)).toBeUndefined()
  })
  it.each(['broken', '[]', '{"provider":2}', '{"model":""}', '{"provider":""}', '{"apiKey":true}'])('rejects malformed config %s', (contents) => {
    writeFileSync(join(root, 'jev.json'), contents)
    expect(() => createClassifier(registry())).toThrow(/jev.json/)
  })
  it('never leaks provider error text', async () => {
    for (const classify of [async () => { throw new Error('secret-key-123') }, async () => ({ stopReason: 'error', error: 'secret-key-123' })]) {
      await expect(createClassifier({ ...registry(), classify })?.holds('', 'condition')).rejects.toThrow(/Classifier (request failed|returned no usable answer)/)
      await expect(createClassifier({ ...registry(), classify })?.holds('', 'condition')).rejects.not.toThrow('secret-key-123')
    }
  })
  it.each([{ type: 'bool', probability: 'wrong' }, { type: 'choice', choice: 'invented', confidence: 1 }, { type: 'choice', choice: 'ref_7', confidence: 'wrong' }])('rejects malformed answers %j', async (answer) => {
    const judge = createClassifier(registry(answer))
    await expect(answer.type === 'bool' ? judge?.holds('', '') : judge?.choose('', candidates)).rejects.toThrow('invalid')
  })
  it('aborts without asking the host', async () => {
    const host = registry()
    const controller = new AbortController()
    controller.abort()
    await expect(createClassifier(host, controller.signal)?.holds('', '')).rejects.toThrow()
    expect(host.classify).not.toHaveBeenCalled()
  })
})
