import { describe, expect, it } from 'vitest'
import { interactivePreviewUrl } from 'apex-core/interactive-preview'
import { interactivePreviewResponse, isAllowedRendererFrameUrl, isInteractivePreviewUrl } from '../../apps/desktop/electron/main/interactive-previews'

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
