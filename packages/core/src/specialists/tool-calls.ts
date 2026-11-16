import type { MessagePart } from '../types/api'

export type ToolResultPart = Extract<MessagePart, { type: 'toolResult' }>

/**
 * Pairs toolCall indices in `flatParts` with their matching toolResult parts using
 * run-based positional pairing so parallel same-tool calls don't steal each other's
 * results, while orphaned earlier calls before a later batch still align from the tail.
 */
export function pairToolCalls(flatParts: readonly MessagePart[]): Map<number, ToolResultPart> {
  const paired = new Map<number, ToolResultPart>()
  const openCallsByName = new Map<string, number[]>()
  const resultsByName = new Map<string, ToolResultPart[]>()
  const openOrder: Array<{ index: number; name: string }> = []

  const flush = (name: string, hasLaterCall: boolean) => {
    const calls = openCallsByName.get(name)
    const results = resultsByName.get(name)
    if (calls && calls.length > 0 && results && results.length > 0) {
      const m = calls.length
      const n = results.length
      if (n >= m || !hasLaterCall) {
        const limit = Math.min(m, n)
        for (let i = 0; i < limit; i += 1) {
          paired.set(calls[i]!, results[i]!)
        }
      } else {
        const offset = m - n
        for (let i = 0; i < n; i += 1) {
          paired.set(calls[offset + i]!, results[i]!)
        }
      }
    }
    openCallsByName.delete(name)
    resultsByName.delete(name)
  }

  for (let index = 0; index < flatParts.length; index += 1) {
    const part = flatParts[index]!
    if (part.type === 'toolCall') {
      if ((resultsByName.get(part.name)?.length ?? 0) > 0) {
        flush(part.name, true)
      }
      let calls = openCallsByName.get(part.name)
      if (!calls) {
        calls = []
        openCallsByName.set(part.name, calls)
      }
      calls.push(index)
      openOrder.push({ index, name: part.name })
    } else if (part.type === 'toolResult') {
      if (part.name !== undefined) {
        if ((openCallsByName.get(part.name)?.length ?? 0) > 0) {
          let results = resultsByName.get(part.name)
          if (!results) {
            results = []
            resultsByName.set(part.name, results)
          }
          results.push(part)
        }
      } else {
        for (let cursor = openOrder.length - 1; cursor >= 0; cursor -= 1) {
          const name = openOrder[cursor]!.name
          const openCount = openCallsByName.get(name)?.length ?? 0
          const resultCount = resultsByName.get(name)?.length ?? 0
          if (openCount > resultCount) {
            let results = resultsByName.get(name)
            if (!results) {
              results = []
              resultsByName.set(name, results)
            }
            results.push(part)
            break
          }
        }
      }
    }
  }

  for (const name of openCallsByName.keys()) {
    flush(name, false)
  }
  return paired
}

function skipStringLiteral(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]!
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  return source.length
}

function skipWsAndComments(source: string, start: number): number {
  let i = start
  while (i < source.length) {
    const ch = source[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    break
  }
  return i
}

export function parseStaticObjectLiteral(source: string): Record<string, unknown> | undefined {
  let pos = 0

  const skip = () => {
    pos = skipWsAndComments(source, pos)
  }

  const parseString = (): string | undefined => {
    const quote = source[pos]
    if (quote !== '"' && quote !== "'" && quote !== '`') return undefined
    pos += 1
    let out = ''
    while (pos < source.length) {
      const ch = source[pos]!
      if (ch === '\\') {
        const next = source[pos + 1]
        if (next === undefined) return undefined
        if (next === 'n') out += '\n'
        else if (next === 'r') out += '\r'
        else if (next === 't') out += '\t'
        else if (next === 'b') out += '\b'
        else if (next === 'f') out += '\f'
        else if (next === 'u') {
          const hex = source.slice(pos + 2, pos + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined
          out += String.fromCharCode(parseInt(hex, 16))
          pos += 4
        } else {
          out += next
        }
        pos += 2
        continue
      }
      if (quote === '`' && ch === '$' && source[pos + 1] === '{') return undefined
      if (ch === quote) {
        pos += 1
        return out
      }
      out += ch
      pos += 1
    }
    return undefined
  }

  const parseValue = (): { ok: true; value: unknown } | { ok: false } => {
    skip()
    if (pos >= source.length) return { ok: false }
    const ch = source[pos]!
    if (ch === '{') {
      const obj = parseObject()
      return obj ? { ok: true, value: obj } : { ok: false }
    }
    if (ch === '[') {
      pos += 1
      const arr: unknown[] = []
      while (pos < source.length) {
        skip()
        if (source[pos] === ']') {
          pos += 1
          return { ok: true, value: arr }
        }
        const elem = parseValue()
        if (!elem.ok) return { ok: false }
        arr.push(elem.value)
        skip()
        if (source[pos] === ',') {
          pos += 1
          continue
        }
        if (source[pos] === ']') {
          pos += 1
          return { ok: true, value: arr }
        }
        return { ok: false }
      }
      return { ok: false }
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const str = parseString()
      return str !== undefined ? { ok: true, value: str } : { ok: false }
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const numMatch = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(pos))
      if (!numMatch) return { ok: false }
      pos += numMatch[0].length
      return { ok: true, value: Number(numMatch[0]) }
    }
    const kwMatch = /^(true|false|null|undefined)\b/.exec(source.slice(pos))
    if (kwMatch) {
      pos += kwMatch[0].length
      const kw = kwMatch[1]
      return { ok: true, value: kw === 'true' ? true : kw === 'false' ? false : kw === 'null' ? null : undefined }
    }
    return { ok: false }
  }

  const parseObject = (): Record<string, unknown> | undefined => {
    skip()
    if (source[pos] !== '{') return undefined
    pos += 1
    const result: Record<string, unknown> = {}
    while (pos < source.length) {
      skip()
      if (source[pos] === '}') {
        pos += 1
        return result
      }
      let key: string | undefined
      const ch = source[pos]
      if (ch === '"' || ch === "'" || ch === '`') {
        key = parseString()
      } else {
        const idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(pos))
        if (idMatch) {
          key = idMatch[0]
          pos += key.length
        }
      }
      if (key === undefined) return undefined
      skip()
      if (source[pos] !== ':') return undefined
      pos += 1
      const val = parseValue()
      if (!val.ok) return undefined
      result[key] = val.value
      skip()
      if (source[pos] === ',') {
        pos += 1
        continue
      }
      if (source[pos] === '}') {
        pos += 1
        return result
      }
      return undefined
    }
    return undefined
  }

  const parsed = parseObject()
  if (!parsed) return undefined
  skip()
  return pos === source.length ? parsed : undefined
}

/** Extracts static `tools.<name>({ ... })` calls from codemode source without evaluating code. */
export function extractStaticToolCalls(code: string, toolNames: ReadonlySet<string>): Array<{ name: string; args: Record<string, unknown> }> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let i = 0
  while (i < code.length) {
    const ch = code[i]!
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipStringLiteral(code, i)
      continue
    }
    if (ch === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      i = skipWsAndComments(code, i)
      continue
    }
    if (code.startsWith('tools.', i) && (i === 0 || !/[A-Za-z0-9_$]/.test(code[i - 1]!))) {
      const afterDot = i + 6
      const nameMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(code.slice(afterDot))
      if (nameMatch && toolNames.has(nameMatch[1]!)) {
        const name = nameMatch[1]!
        const openParen = skipWsAndComments(code, afterDot + name.length)
        if (code[openParen] === '(') {
          const objStart = skipWsAndComments(code, openParen + 1)
          if (code[objStart] === '{') {
            let depth = 0
            let j = objStart
            while (j < code.length) {
              const c = code[j]!
              if (c === '"' || c === "'" || c === '`') {
                j = skipStringLiteral(code, j)
                continue
              }
              if (c === '/' && (code[j + 1] === '/' || code[j + 1] === '*')) {
                j = skipWsAndComments(code, j)
                continue
              }
              if (c === '{') depth += 1
              else if (c === '}') {
                depth -= 1
                if (depth === 0) {
                  const objText = code.slice(objStart, j + 1)
                  const parsed = parseStaticObjectLiteral(objText)
                  if (parsed) calls.push({ name, args: parsed })
                  j += 1
                  break
                }
              }
              j += 1
            }
            i = j
            continue
          }
        }
      }
    }
    i += 1
  }
  return calls
}
