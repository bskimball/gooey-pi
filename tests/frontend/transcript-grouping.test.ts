import { describe, expect, it } from 'vitest'
import { createAssistantTurnCoalescer } from '../../src/components/transcript/grouping'
import type { TranscriptMessage } from '../../src/types/api'

const message = (id: string, role: TranscriptMessage['role'], text = id): TranscriptMessage => ({
  id, role, timestamp: 100, parts: [{ type: 'text', text }],
})

describe('incremental assistant grouping', () => {
  it('preserves settled groups while the newest turn streams', () => {
    const coalesce = createAssistantTurnCoalescer()
    const history = Array.from({ length: 50 }, (_, index) => [
      message(`user-${index}`, 'user'), message(`first-${index}`, 'assistant'), message(`last-${index}`, 'assistant'),
    ]).flat()
    const prompt = message('prompt', 'user')
    const first = coalesce([...history, prompt, { ...message('live', 'assistant'), streaming: true }])
    for (let update = 0; update < 10; update++) {
      const next = coalesce([...history, prompt, { ...message('live', 'assistant', String(update)), streaming: true }])
      for (let index = 0; index < first.length - 1; index++) expect(next[index]).toBe(first[index])
      expect(next.at(-1)).not.toBe(first.at(-1))
    }
  })

  it('rebuilds only changed groups and preserves completion and ordering semantics', () => {
    const coalesce = createAssistantTurnCoalescer()
    const first = { ...message('a', 'assistant'), startedAt: 50, completedAt: 200 }
    const second = { ...message('b', 'assistant'), completedAt: 300 }
    const prompt = message('u', 'user')
    const after = [message('c', 'assistant'), message('d', 'assistant')]
    const before = coalesce([first, second, prompt, ...after])
    expect(before[0]).toMatchObject({ id: 'a', startedAt: 50, completedAt: 300, streaming: false })
    const changed = coalesce([first, { ...second, streaming: true }, prompt, ...after])
    expect(changed[0]).not.toBe(before[0])
    expect(changed[0]).toMatchObject({ completedAt: undefined, streaming: true, parts: [...first.parts, ...second.parts] })
    expect(changed[2]).toBe(before[2])
    const reordered = coalesce([second, first, prompt, ...after])
    expect(reordered[0]).toMatchObject({ id: 'b', completedAt: 200, parts: [...second.parts, ...first.parts] })
    expect(reordered[2]).toBe(before[2])
  })

  it('does not reuse removed or replaced groups after switching transcripts', () => {
    const coalesce = createAssistantTurnCoalescer()
    const segments = [message('a', 'assistant'), message('b', 'assistant')]
    const grouped = coalesce(segments)
    const ungrouped = [message('u', 'user')]
    expect(coalesce(ungrouped)).toBe(ungrouped)
    expect(coalesce(segments)[0]).not.toBe(grouped[0])
    expect(coalesce([message('a', 'assistant', 'Replacement'), segments[1]])[0].parts[0]).toEqual({ type: 'text', text: 'Replacement' })
  })
})
