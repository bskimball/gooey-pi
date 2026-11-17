import { describe, expect, it } from 'vitest'
import { interactivePreviewUrl, isProjectPreviewPartition, isProjectPreviewRequest, parseProjectPreview, projectPreviewUrl } from 'apex-core/interactive-preview'
import { interactivePreviewResponse, isAllowedRendererFrameUrl, isInteractivePreviewUrl } from '../../apps/desktop/electron/main/interactive-previews'

describe('project preview boundary', () => {
  it('parses only bounded, titled local project URLs', () => {
    expect(parseProjectPreview('{"title":" Agents ","url":"http://127.0.0.1:5173/agents?theme=dark"}')).toEqual({ title: 'Agents', url: 'http://127.0.0.1:5173/agents?theme=dark' })
    for (const url of ['http://localhost:5173/', 'https://[::1]:5173/']) expect(projectPreviewUrl(url)?.href).toBe(url)
    for (const url of ['https://example.com', 'http://localhost.evil.test', 'file:///tmp/a.html', 'javascript:alert(1)', 'http://user:pass@localhost:5173', 'http://192.168.1.2:3000']) {
      expect(parseProjectPreview(JSON.stringify({ title: 'Unsafe', url }))).toBeNull()
    }
    for (const source of ['{', 'null', '[]', '{"url":"http://localhost:5173"}', '{"title":"","url":"http://localhost"}', ' '.repeat(4097)]) expect(parseProjectPreview(source)).toBeNull()
  })

  it('uses nonpersistent partitions and restricts requests to the preview server, including HMR', () => {
    expect(isProjectPreviewPartition('apex-project-preview-12345678-1234-1234-1234-123456789abc')).toBe(true)
    for (const partition of ['persist:apex-project-preview-12345678-1234-1234-1234-123456789abc', 'apex-project-preview-', 'persist:apex-browser']) expect(isProjectPreviewPartition(partition)).toBe(false)
    const origin = 'http://127.0.0.1:5173'
    for (const url of [`${origin}/src/component.tsx`, 'ws://127.0.0.1:5173/?token=test']) expect(isProjectPreviewRequest(url, origin)).toBe(true)
    for (const url of ['http://127.0.0.1:5174/', 'https://example.com/', 'file:///tmp/a', 'prime-work://app/index.html', 'http://user@127.0.0.1:5173/']) expect(isProjectPreviewRequest(url, origin)).toBe(false)
  })
})

describe('interactive preview boundary', () => {
  it('serves bounded HTML with a restrictive response policy that authored meta tags cannot relax', async () => {
    const source = '<meta http-equiv="Content-Security-Policy" content="default-src *"><script>document.body.dataset.ready="yes"</script>'
    const response = interactivePreviewResponse({ url: interactivePreviewUrl(source), method: 'GET' })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(source)
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts')
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'")
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects wrong hosts, routes, credentials, duplicate parameters, and oversized sources', () => {
    for (const url of [
      'https://document/render?html=test', 'apex-preview://evil/render?html=test',
      'apex-preview://document/other?html=test', 'apex-preview://user@document/render?html=test',
      'apex-preview://document/render?html=a&html=b', 'apex-preview://document/render?html=a&other=b',
      'apex-preview://document/render?html=a#fragment', interactivePreviewUrl('x'.repeat(100_001)),
    ]) {
      expect(isInteractivePreviewUrl(url), url.slice(0, 100)).toBe(false)
      expect(interactivePreviewResponse({ url, method: 'GET' }).status).toBe(400)
    }
    expect(interactivePreviewResponse({ url: interactivePreviewUrl('safe'), method: 'POST' }).status).toBe(400)
  })

  it('allows only isolated preview documents and empty local frames', () => {
    expect(isAllowedRendererFrameUrl(interactivePreviewUrl('<p>hello</p>'))).toBe(true)
    expect(isAllowedRendererFrameUrl('about:blank')).toBe(true)
    for (const url of ['https://example.com', 'http://localhost:5173/', 'prime-work://app/index.html', 'file:///etc/passwd', 'data:text/html,hello']) {
      expect(isAllowedRendererFrameUrl(url)).toBe(false)
    }
  })
})
