import { describe, expect, it } from 'vitest'
import { MAX_SYNTAX_HIGHLIGHTS, tokenizeSyntax } from '../../apps/desktop/src/components/transcript/syntax'

describe('transcript syntax tokenizer', () => {
  it('bounds styled fragments without dropping any text from large output', () => {
    const input = Array.from({ length: 20_000 }, () => '"same":"same"').join(',')
    const tokens = tokenizeSyntax(input)

    expect(tokens.map((token) => token.text).join('')).toBe(input)
    expect(tokens.filter((token) => token.kind !== 'plain')).toHaveLength(MAX_SYNTAX_HIGHLIGHTS)
    expect(tokens.length).toBeLessThanOrEqual(MAX_SYNTAX_HIGHLIGHTS * 2 + 1)
  })
})
