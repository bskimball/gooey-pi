import { describe, expect, it } from 'vitest'
import { parseMcpAuthenticationCommand } from '../../apps/desktop/src/lib/mcp-policy'

describe('Pi MCP authentication command routing', () => {
  it('extracts a bounded adapter authentication target', () => {
    expect(parseMcpAuthenticationCommand('/mcp-auth docs', 'pi')).toEqual({ server: 'docs' })
    expect(parseMcpAuthenticationCommand('/mcp-auth', 'pi')).toEqual({})
  })

  it('blocks unsafe targets instead of forwarding them', () => {
    expect(parseMcpAuthenticationCommand('/mcp-auth ../docs', 'pi')).toEqual({})
    expect(parseMcpAuthenticationCommand('/mcp-auth __proto__', 'pi')).toEqual({})
  })

  it('leaves other MCP commands alone', () => {
    expect(parseMcpAuthenticationCommand('/mcp list', 'pi')).toBeUndefined()
    expect(parseMcpAuthenticationCommand('/mcp', 'pi')).toBeUndefined()
  })
})
