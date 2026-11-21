import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { MarkdownText } from '../../apps/desktop/src/components/MarkdownText'
import { InteractiveChatProvider } from '../../apps/desktop/src/components/InteractiveChatContext'
import { withoutHost } from './fixtures'

const meta = {
  title: 'Chat/Native React widgets',
  beforeEach: withoutHost,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const fullThreadMarkdown = `Here is a visual breakdown of the release readiness check and the two rollout options.

\`\`\`apex-ui
{
  "type": "callout",
  "tone": "tip",
  "title": "Native React components render directly in the thread",
  "badge": "apex-ui",
  "body": "These cards are first-class React + StyleX components hydrated directly inside MarkdownText—no iframe chrome, full theme token inheritance, and interactive actions wired back into the chat.",
  "meta": "Supports callout, metrics, comparison, steps, checklist, and kv blocks.",
  "actions": [
    { "label": "Adopt this pattern", "feedback": "Let's adopt the native apex-ui widget pattern for agent responses.", "primary": true },
    { "label": "Ask a follow-up", "feedback": "Can we also add a chart widget?" }
  ]
}
\`\`\`

\`\`\`apex-ui
{
  "type": "metrics",
  "title": "Build & verification snapshot",
  "badge": "local run",
  "items": [
    { "label": "Typecheck", "value": "0 errors", "delta": "2.4s", "trend": "up", "detail": "Desktop + packages/ui" },
    { "label": "Unit tests", "value": "148 / 148", "delta": "+12", "trend": "up", "detail": "All frontend suites green" },
    { "label": "Bundle delta", "value": "+6.8 kB", "delta": "gzip", "trend": "neutral", "detail": "Within release budget" }
  ]
}
\`\`\`

\`\`\`apex-ui
{
  "type": "comparison",
  "title": "Choose a rollout strategy",
  "badge": "2 options",
  "options": [
    {
      "name": "Ship native widgets first",
      "recommended": true,
      "summary": "Typed JSON fences rendered as themed React + StyleX components with interactive chat callbacks.",
      "pros": ["Zero iframe overhead", "Matches light, dark, and VS Code themes", "Safe by construction (schema-validated)"],
      "cons": ["Fixed catalog of widget primitives"],
      "metrics": { "Latency": "Instant", "Security": "No eval" },
      "feedback": "Let's ship the native React widget catalog first."
    },
    {
      "name": "Ad-hoc JSX sandbox",
      "summary": "Compile arbitrary agent-authored JSX into an isolated iframe runtime.",
      "pros": ["Unlimited custom layouts"],
      "cons": ["Iframe height & theme mismatch", "Requires in-browser transpiler"],
      "metrics": { "Latency": "150–300ms", "Security": "Sandbox iframe" },
      "feedback": "Let's add a sandboxed JSX runtime too."
    }
  ]
}
\`\`\`

\`\`\`apex-ui
{
  "type": "steps",
  "title": "Rollout pipeline",
  "layout": "horizontal",
  "steps": [
    { "title": "Schema parse", "detail": "Validate JSON fence safely", "status": "done", "meta": "Step 1" },
    { "title": "Render React", "detail": "Hydrate native StyleX card", "status": "active", "meta": "Step 2" },
    { "title": "Send feedback", "detail": "Route clicks to chat context", "status": "pending", "meta": "Step 3" }
  ]
}
\`\`\`

\`\`\`apex-ui
{
  "type": "checklist",
  "title": "Interactive pre-merge checklist",
  "items": [
    { "label": "Questions & ask-me panel redesigned in Storybook", "checked": true },
    { "label": "AskUserCard matches inline questionnaire visual system", "checked": true },
    { "label": "Verify dark mode contrast and narrow viewport wrapping", "detail": "Click any item to toggle it locally" }
  ]
}
\`\`\`

\`\`\`apex-ui
{
  "type": "kv",
  "title": "Component contract",
  "badge": "apex-ui",
  "items": [
    { "key": "Fence language", "value": "apex-ui (alias: apex-widget)", "mono": true },
    { "key": "Renderer", "value": "packages/ui/src/RichWidgets.tsx", "mono": true },
    { "key": "Fallback", "value": "Skeleton while streaming; code block if invalid JSON", "tone": "success" }
  ]
}
\`\`\`
`

function MainThreadDemo() {
  const [lastFeedback, setLastFeedback] = useState<string | null>(null)
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <InteractiveChatProvider
        sessionKey="storybook-rich-widgets"
        onSendFeedback={async (text) => {
          setLastFeedback(text)
        }}
      >
        <MarkdownText text={fullThreadMarkdown} />
      </InteractiveChatProvider>
      {lastFeedback ? (
        <p role="status" style={{ marginTop: 12, fontSize: 12, color: 'var(--apex)' }}>
          Interactive callback received: <strong>{lastFeedback}</strong>
        </p>
      ) : null}
    </div>
  )
}

export const AllMainThreadWidgets: Story = {
  render: () => <MainThreadDemo />,
}

export const DarkMainThreadWidgets: Story = {
  globals: { theme: 'dark' },
  render: () => <MainThreadDemo />,
}

export const StreamingAndFallback: Story = {
  render: () => (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      <section>
        <h3>Mid-stream incomplete apex-ui fence</h3>
        <MarkdownText text={'```apex-ui\n{"type":"metrics","title":"Loading...'} streaming />
      </section>
      <section>
        <h3>Malformed finished fence (graceful code fallback)</h3>
        <MarkdownText text={'```apex-ui\n{"type":"unknown_widget"}\n```'} />
      </section>
    </div>
  ),
}
