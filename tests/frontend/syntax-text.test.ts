import { describe, expect, it } from 'vitest'
import { tokenizeSyntaxText } from '../../apps/desktop/src/lib/syntax-text'

describe('tool syntax tokenization', () => {
  it('classifies identical strings according to their positions and records their offsets', () => {
    const input = '{"same": "same", "enabled": true, "count": -12.5}'
    const tokens = tokenizeSyntaxText(input)

    expect(tokens.map(({ text, kind }) => [text, kind])).toEqual([
      ['{', 'plain'], ['"same"', 'key'], [': ', 'plain'], ['"same"', 'string'], [', ', 'plain'],
      ['"enabled"', 'key'], [': ', 'plain'], ['true', 'keyword'], [', ', 'plain'],
      ['"count"', 'key'], [': ', 'plain'], ['-12.5', 'number'], ['}', 'plain'],
    ])
    expect(tokens.map((token) => input.slice(token.start, token.end)).join('')).toBe(input)
  })
})
