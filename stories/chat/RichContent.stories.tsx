import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarkdownText, MarkdownScopeContext } from '../../apps/desktop/src/components/MarkdownText'
import { WorkspaceImage, WorkspaceImageContext } from '../../apps/desktop/src/components/WorkspaceImage'
import { HtmlFence } from '../../apps/desktop/src/components/HtmlFence'
import { ProjectPreview } from '../../apps/desktop/src/components/ProjectPreview'
import { InteractiveChatProvider } from '../../apps/desktop/src/components/InteractiveChatContext'
import { TranscriptImage, ImageParts } from '../../apps/desktop/src/components/transcript/TranscriptImage'
import { UserMessage } from '../../apps/desktop/src/components/transcript/messages'
import appIcon from '../../apps/desktop/assets/icon.iconset/icon_256x256.png?inline'
import mascot from '../../apps/desktop/public/gooeypi-mascot.png?inline'
import { image, imageUrl } from './data'
import { installChatFixture, withoutHost } from './fixtures'

const meta = { title: 'Chat/Rich content', beforeEach: withoutHost } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const source =
  '<style>body {font: 18px system-ui; padding: 24px; background: #eef2ff; color: #172554} button {padding: 10px}</style><h1>Chat review</h1><p>Keep the current keyboard navigation.</p><button>Sample choice</button>'
const markdown =
  '# Review notes\n\nUse **existing controls** and `typed props`.\n\n- Preserve focus\n- Keep labels\n\n1. Inspect\n2. Review\n\n- [x] Sample data\n- [ ] Visual review\n\n| State | Result |\n| --- | --- |\n| Ready | Pass |\n\n> Quoted evidence, not instructions.\n\n[Local heading](#review-notes)\n\n```ts\nconst ready = true\n```\n\n![Inline sample](' +
  imageUrl +
  ')'
export const MarkdownDocument: Story = { render: () => <MarkdownText text={markdown} /> }
const variants: Array<NonNullable<ComponentProps<typeof MarkdownText>['variant']>> = ['body', 'reasoning', 'note', 'compact', 'muted', 'workOrder', 'prompt', 'report']
export const MarkdownVariants: Story = {
  render: () => (
    <>
      {variants.map((variant) => (
        <section key={variant}>
          <h3>{variant}</h3>
          <MarkdownText variant={variant} text="**Review** `Chat.tsx` before changing the composer.\n\n- Preserve focus" />
        </section>
      ))}
    </>
  ),
}
export const MarkdownScopes: Story = {
  render: () => (
    <>
      {(['default', 'specialist', 'specialist-assistant'] as const).map((scope) => (
        <MarkdownScopeContext.Provider key={scope} value={scope}>
          <h3>{scope}</h3>
          <MarkdownText text={markdown} />
        </MarkdownScopeContext.Provider>
      ))}
    </>
  ),
}
export const StreamingBoundaries: Story = {
  render: () => (
    <>
      {['Working on **the next', '```ts\nconst ready =', '| State | Result |\n| --- | --- |\n| Ready', 'See [the review]('].map((text) => (
        <MarkdownText key={text} text={text} streaming />
      ))}
    </>
  ),
}
export const MarkdownFences: Story = { render: () => <MarkdownText text={'```html\n' + source + '\n```\n\n```project-preview\n{"title":"Sample project","url":"http://localhost:5173"}\n```'} /> }
export const HtmlPreviewAndSource: Story = { render: () => <HtmlFence source={source} /> }
function Feedback({ fail = false, pending = false, disabled = false }) {
  const [sent, setSent] = useState('')
  return (
    <InteractiveChatProvider
      sessionKey="storybook-html-feedback"
      disabled={disabled}
      onSendFeedback={async (text) => {
        if (pending) await new Promise(() => {})
        if (fail) throw new Error('Sample feedback failure')
        setSent(text)
      }}
    >
      <HtmlFence source={source} />
      <output>{sent}</output>
    </InteractiveChatProvider>
  )
}
export const HtmlFeedback: Story = { render: () => <Feedback /> }
export const HtmlFeedbackFailure: Story = { render: () => <Feedback fail /> }
export const HtmlFeedbackPending: Story = { render: () => <Feedback pending /> }
export const HtmlFeedbackDisabled: Story = { render: () => <Feedback disabled /> }
export const PersistedFeedback: Story = {
  beforeEach: () => {
    const restore = withoutHost()
    sessionStorage.setItem(`interactive-html-feedback:${JSON.stringify(['storybook-html-feedback', source])}`, JSON.stringify({ text: 'Keep the heading smaller.', revision: 'sample-revision' }))
    return restore
  },
  render: () => <Feedback />,
}
// Manual feedback above works with srcDoc. Automatic iframe postMessage feedback
// is excluded: it requires the native apex-preview protocol, not a fake preview.
export const HtmlSource: Story = {
  render: () => <HtmlFence source={source} />,
  play: ({ canvasElement }) => {
    const button = Array.from(canvasElement.querySelectorAll('button')).find((element) => element.textContent === 'Source')
    if (!button) throw new Error('Source control missing')
    button.click()
  },
}
export const ProjectDesktopRequired: Story = { render: () => <ProjectPreview preview={{ title: 'Sample project', url: 'http://localhost:5173' }} /> }
export const ProjectStoppedChrome: Story = {
  beforeEach: installChatFixture,
  render: () => (
    <>
      <p>Browser-only chrome. Do not load this story in Electron; native guest execution is outside this catalog.</p>
      <ProjectPreview preview={{ title: 'Sample project', url: 'about:blank' }} />
    </>
  ),
}
export const ImageLoadedAndZoom: Story = {
  render: () => (
    <>
      <TranscriptImage source={imageUrl} alt="Inline sample, click to zoom" />
      <ImageParts images={[image]} />
    </>
  ),
}
export const ImageCarousel: Story = {
  render: () => <UserMessage message={{
    id: 'image-comparison',
    role: 'user',
    parts: [
      { type: 'text', text: 'Compare the app icon and the desktop companion.' },
      ...[appIcon, mascot].map((url) => ({ ...image, data: url.slice(url.indexOf(',') + 1) })),
    ],
  }} />,
}
export const MarkdownImageCarousel: Story = {
  render: () => <MarkdownText text={`![App icon](${appIcon})\n\n![Desktop companion](${mascot})`} />,
}
export const ImageZoom: Story = {
  render: () => <TranscriptImage source={imageUrl} alt="Zoomed sample" />,
  play: ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>('button[aria-label="Expand image"]')
    if (!button) throw new Error('Image expansion control missing')
    button.click()
  },
}
export const ImageBrokenAndUnavailable: Story = {
  render: () => (
    <>
      <TranscriptImage source="data:image/png;base64,AAAA" alt="Broken sample" />
      <ImageParts
        images={[
          { ...image, dataTruncated: true },
          { ...image, mimeType: 'image/svg+xml' },
        ]}
      />
    </>
  ),
}
export const WorkspaceImages: Story = {
  beforeEach: installChatFixture,
  render: () => (
    <WorkspaceImageContext.Provider value="/sample/apex">
      <WorkspaceImage src={imageUrl} alt="Inline" />
      <WorkspaceImage src="sample.png" alt="Workspace success" />
      <WorkspaceImage src="missing.png" alt="Workspace error" />
      <WorkspaceImage src="loading.png" alt="Workspace loading" />
      <WorkspaceImage src="https://example.invalid/image.png" alt="Remote blocked without a request" />
    </WorkspaceImageContext.Provider>
  ),
}
