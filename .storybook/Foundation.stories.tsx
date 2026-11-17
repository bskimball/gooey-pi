import type { Meta, StoryObj } from '@storybook/react-vite'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { ApexButton, EmptyState, Segmented, SelectControl } from '../packages/ui/src/ui'

const styles = stylex.create({
  gallery: { display: 'grid', gap: 24, maxWidth: 920, padding: 24, color: 'var(--text)', backgroundColor: 'var(--canvas)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  swatch: { padding: 16, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' },
  muted: { color: 'var(--text-secondary)' },
  gradientChip: { padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-raised)', backgroundImage: 'var(--gradient-apex)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-apex)', boxShadow: 'var(--shadow-control)' },
  warningChip: { padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-raised)', backgroundImage: 'var(--gradient-warning)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-warning)' },
  dangerChip: { padding: 12, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-raised)', backgroundImage: 'var(--gradient-danger)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-danger)' },
})

function FoundationGallery() {
  const [branch, setBranch] = useState('main')
  const [view, setView] = useState('chat')
  return (
    <main {...stylex.props(styles.gallery)}>
      <header>
        <h1>Apex foundations</h1>
        <p {...stylex.props(styles.muted)}>Production controls, type and tokens. Compare light and dark with the toolbar.</p>
      </header>
      <section aria-label="Typography">
        <h2>Typography and content</h2>
        <p>The quick brown fox jumps over the lazy dog. 0123456789</p>
        <p lang="fa" dir="rtl">
          نمایش متن فارسی برای بررسی قلم و خوانایی
        </p>
        <code>const state = 'ready'</code>
      </section>
      <section aria-label="Surface and text tokens" {...stylex.props(styles.row)}>
        <div {...stylex.props(styles.swatch)}>Surface · primary text</div>
        <div {...stylex.props(styles.swatch, styles.muted)}>Surface · secondary text</div>
      </section>
      <section aria-label="Gradient tokens" {...stylex.props(styles.row)}>
        <div {...stylex.props(styles.gradientChip)}>Apex gradient · control shadow</div>
        <div {...stylex.props(styles.warningChip)}>Warning gradient</div>
        <div {...stylex.props(styles.dangerChip)}>Danger gradient</div>
      </section>
      <section aria-label="Selection controls" {...stylex.props(styles.row)}>
        <SelectControl label="Branch" value={branch} onChange={(event) => setBranch(event.target.value)}>
          <option value="main">main</option>
          <option value="feature">feature/preview</option>
        </SelectControl>
        <Segmented label="View" value={view} options={[{ value: 'chat', label: 'Chat' }, { value: 'agents', label: 'Agents' }]} onChange={setView} />
      </section>
      <section aria-label="Button variants" {...stylex.props(styles.row)}>
        <ApexButton variant="primary">Primary</ApexButton>
        <ApexButton>Default</ApexButton>
        <ApexButton variant="quiet">Quiet</ApexButton>
        <ApexButton variant="danger">Danger</ApexButton>
        <ApexButton disabled>Disabled</ApexButton>
      </section>
      <EmptyState title="Nothing here yet">A consistent empty state keeps the next step clear.</EmptyState>
    </main>
  )
}

const meta = { title: 'Foundations/Overview', component: FoundationGallery } satisfies Meta<typeof FoundationGallery>
export default meta
type Story = StoryObj<typeof meta>
export const Light: Story = { globals: { theme: 'light' } }
export const Dark: Story = { globals: { theme: 'dark' } }
