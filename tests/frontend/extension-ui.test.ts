import { describe, expect, it } from 'vitest'
import { blockingExtensionUiRequestId, parseExtensionUiRequest } from '../../src/lib/extension-ui'
import { parsePiFusionPairStatus, parsePiModeCommand, piModeFromCommand, piModeFromStatusText } from '../../src/lib/harness'
import { pendingExtensionUiForRuntime, type PendingExtensionUi } from '../../src/hooks/useExtensionUi'

describe('extension UI request parsing', () => {
  it('accepts a bounded multiple-choice request', () => {
    expect(parseExtensionUiRequest({
      type: 'extension_ui_request',
      id: 'question-1',
      method: 'select',
      title: 'Choose a release channel',
      options: ['Stable', 'Beta'],
      timeout: 30_000,
    })).toEqual({
      method: 'select',
      id: 'question-1',
      title: 'Choose a release channel',
      options: ['Stable', 'Beta'],
      timeout: 30_000,
    })
  })

  it('unwraps a grouped ask_user question marker for the questionnaire UI', () => {
    expect(parseExtensionUiRequest({
      type: 'extension_ui_request',
      id: 'question-1',
      method: 'select',
      title: 'Choose a release channel',
      options: ['__prime_ask_user__group-1:0:2', 'Stable', 'Beta', 'Other (type your own answer)'],
    })).toEqual({
      method: 'select',
      id: 'question-1',
      title: 'Choose a release channel',
      options: ['Stable', 'Beta', 'Other (type your own answer)'],
      questionnaire: { groupId: 'group-1', index: 0, total: 2 },
    })
  })

  it('rejects malformed or oversized options', () => {
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'select', title: 'Pick', options: [] })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'select', title: 'Pick', options: ['ok', 42] })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'select', title: 'Pick', options: ['x'.repeat(501)] })).toBeUndefined()
  })

  it('accepts plain selects beyond 32 options up to the 2000 bound', () => {
    const models = Array.from({ length: 40 }, (_, index) => `provider-${index % 3}/model-${index}`)
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'pick', method: 'select', title: 'Fusion lead model', options: models })).toMatchObject({ method: 'select', options: models })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'pick', method: 'select', title: 'Pick', options: Array.from({ length: 2_000 }, (_, index) => `m${index}`) })).toMatchObject({ method: 'select' })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'pick', method: 'select', title: 'Pick', options: Array.from({ length: 2_001 }, (_, index) => `m${index}`) })).toBeUndefined()
  })

  it('keeps the 32-option bound for grouped questionnaire questions', () => {
    const options = (count: number) => ['__prime_ask_user__group-1:0:2', ...Array.from({ length: count }, (_, index) => `Choice ${index}`)]
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'q', method: 'select', title: 'Pick', options: options(31) })).toMatchObject({ questionnaire: { groupId: 'group-1' } })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'q', method: 'select', title: 'Pick', options: options(32) })).toBeUndefined()
  })

  it('identifies blocking dialogs that must be cancelled when unusable, but never fire-and-forget methods', () => {
    const oversized = { type: 'extension_ui_request', id: 'big', method: 'select', title: 'Pick', options: Array.from({ length: 2_001 }, (_, index) => `m${index}`) }
    expect(parseExtensionUiRequest(oversized)).toBeUndefined()
    expect(blockingExtensionUiRequestId(oversized)).toBe('big')
    expect(blockingExtensionUiRequestId({ type: 'extension_ui_request', id: 'c', method: 'confirm', title: 'Continue?' })).toBe('c')
    expect(blockingExtensionUiRequestId({ type: 'extension_ui_request', id: 'n', method: 'notify', message: 'hi' })).toBeUndefined()
    expect(blockingExtensionUiRequestId({ type: 'extension_ui_request', id: 's', method: 'setStatus', statusKey: 'mode' })).toBeUndefined()
    expect(blockingExtensionUiRequestId({ type: 'extension_ui_request', method: 'select', title: 'Pick' })).toBeUndefined()
    expect(blockingExtensionUiRequestId({ type: 'message_end', id: 'x', method: 'select' })).toBeUndefined()
  })

  it('supports confirm and text input requests', () => {
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'confirm-1', method: 'confirm', title: 'Continue?', message: 'This will deploy.' })).toMatchObject({ method: 'confirm', id: 'confirm-1', title: 'Continue?', message: 'This will deploy.' })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'input-1', method: 'input', title: 'Name', placeholder: 'Project name' })).toMatchObject({ method: 'input', id: 'input-1', title: 'Name', placeholder: 'Project name' })
  })

  it('rejects requests that are not extension UI requests or lack an id, title, or method', () => {
    expect(parseExtensionUiRequest({ type: 'message_end', id: 'x', method: 'input', title: 'Name' })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', method: 'input', title: 'Name' })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'input', title: '   ' })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', title: 'Name', method: 7 })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', title: 'Name', method: 'progress' })).toBeUndefined()
  })

  it('drops out-of-range timeouts instead of the whole request', () => {
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'input', title: 'Name', timeout: 0 })).toEqual({ method: 'input', id: 'x', title: 'Name', placeholder: undefined, timeout: undefined })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'input', title: 'Name', timeout: 25 * 60 * 60 * 1_000 })).toMatchObject({ timeout: undefined })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'input', title: 'Name', timeout: '30000' })).toMatchObject({ timeout: undefined })
  })

  it('treats an unusable questionnaire marker as a plain option', () => {
    const request = (marker: string) => parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'select', title: 'Pick', options: [marker, 'Stable'] })
    expect(request('__prime_ask_user__group-1:0')).toMatchObject({ options: ['__prime_ask_user__group-1:0', 'Stable'] })
    expect(request('__prime_ask_user__:0:2')).toMatchObject({ options: ['__prime_ask_user__:0:2', 'Stable'] })
    expect(request('__prime_ask_user__group 1:0:2')).toMatchObject({ options: ['__prime_ask_user__group 1:0:2', 'Stable'] })
    expect(request('__prime_ask_user__group-1:1:1')).toMatchObject({ options: ['__prime_ask_user__group-1:1:1', 'Stable'] })
    expect(request('__prime_ask_user__group-1:0:6')).toMatchObject({ options: ['__prime_ask_user__group-1:0:6', 'Stable'] })
    expect(request('__prime_ask_user__group-1:0.5:2')).toMatchObject({ options: ['__prime_ask_user__group-1:0.5:2', 'Stable'] })
  })

  it('rejects a questionnaire marker with no visible options left', () => {
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'select', title: 'Pick', options: ['__prime_ask_user__group-1:0:2'] })).toBeUndefined()
  })

  it('rejects a confirm request without a message and an input request with an unusable placeholder', () => {
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'confirm', title: 'Continue?' })).toBeUndefined()
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'x', method: 'input', title: 'Name', placeholder: 42 })).toBeUndefined()
  })

  it('accepts an editor request with a bounded prefill', () => {
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'editor-1', method: 'editor', title: 'Edit the plan', prefill: 'step one' })).toEqual({ method: 'editor', id: 'editor-1', title: 'Edit the plan', prefill: 'step one' })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'editor-1', method: 'editor', title: 'Edit the plan' })).toEqual({ method: 'editor', id: 'editor-1', title: 'Edit the plan', prefill: undefined })
    expect(parseExtensionUiRequest({ type: 'extension_ui_request', id: 'editor-1', method: 'editor', title: 'Edit the plan', prefill: 'x'.repeat(32_001) })).toBeUndefined()
  })
})


describe('pending extension UI ownership', () => {
  it('retains background requests until their runtime becomes active', () => {
    const foreground: PendingExtensionUi = {
      runtimeId: 'runtime-a',
      request: { method: 'confirm', id: 'foreground', title: 'Continue?', message: 'Proceed' },
    }
    const background: PendingExtensionUi = {
      runtimeId: 'runtime-b',
      request: { method: 'input', id: 'background', title: 'Answer' },
    }
    const pending = new Map([
      [foreground.runtimeId, foreground],
      [background.runtimeId, background],
    ])

    expect(pendingExtensionUiForRuntime(pending, 'runtime-a')).toBe(foreground)
    expect(pendingExtensionUiForRuntime(pending, 'runtime-b')).toBe(background)
    expect(pendingExtensionUiForRuntime(pending, 'runtime-missing')).toBeNull()
    expect(pendingExtensionUiForRuntime(pending)).toBeNull()
  })

  it('parses Pi behavior mode commands and status labels', () => {
    expect(parsePiModeCommand('/mode fusion', 'pi')).toBe('/mode fusion')
    const pairCommand = '/mode fusion-set sidekick model Provider/Family/Model-ID'
    expect(parsePiModeCommand(pairCommand, 'pi')).toBe(pairCommand)
    expect(parsePiModeCommand('/mode fusion-set lead thinking xhigh', 'pi')).toBe('/mode fusion-set lead thinking xhigh')
    expect(piModeFromCommand(pairCommand)).toBeUndefined()
    expect(parsePiModeCommand('/orchestrate on', 'pi')).toBe('/orchestrate on')
    expect(piModeFromStatusText('Apex Orchestrate')).toBe('apex-orchestrate')
    expect(piModeFromStatusText('Fusion')).toBe('fusion')
    expect(piModeFromCommand('/mode apex-orchestrate')).toBe('apex-orchestrate')
    expect(piModeFromCommand('/orchestrate off')).toBe('apex')
  })

  it('validates the structured Fusion pair status without guessing', () => {
    const pair = { lead: { provider: 'openai', modelId: 'gpt-6-astra', thinking: 'xhigh' }, sidekick: { provider: 'claude-bridge', modelId: 'claude-opus-5-5', thinking: 'medium' } }
    expect(parsePiFusionPairStatus(JSON.stringify(pair))).toEqual(pair)
    expect(parsePiFusionPairStatus(undefined)).toBeUndefined()
    expect(parsePiFusionPairStatus('Lead openai/gpt-6-astra (xhigh); sidekick claude-bridge/claude-opus-5-5 (medium).')).toBeUndefined()
    expect(parsePiFusionPairStatus(JSON.stringify({ ...pair, sidekick: { ...pair.sidekick, thinking: 'ultra' } }))).toBeUndefined()
    expect(parsePiFusionPairStatus(JSON.stringify({ ...pair, lead: { ...pair.lead, modelId: '' } }))).toBeUndefined()
    expect(parsePiFusionPairStatus(JSON.stringify({ ...pair, lead: { ...pair.lead, provider: 'open\u001bai' } }))).toBeUndefined()
    expect(parsePiFusionPairStatus(JSON.stringify({ lead: pair.lead }))).toBeUndefined()
    expect(parsePiFusionPairStatus('null')).toBeUndefined()
  })
})
