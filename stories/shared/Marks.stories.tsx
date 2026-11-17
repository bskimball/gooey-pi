import { sharedFrame } from './frame'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PiMark, PiWelcomeMark, GooeyPiMark } from '../../packages/ui/src/ui'
import * as icons from '../../packages/ui/src/icons'

function Marks() {
  return (
    <section aria-label="Apex brand marks">
      {[24, 48, 88].map((size) => (
        <div key={size}>
          <h3>{size}px</h3>
          <PiMark size={size} />
          <PiWelcomeMark size={size} />
          <GooeyPiMark size={size} />
        </div>
      ))}
    </section>
  )
}
function IconGallery() {
  const { IconContext, ...wrappers } = icons
  return (
    <IconContext.Provider value={{ color: 'currentColor' }}>
      <section aria-label="All exported icons">
        <p>Every named wrapper, regular 16px, bold 24px, filled 32px, and mirrored 24px. Color inherits the current Apex theme.</p>
        {Object.entries(wrappers).map(([name, Icon]) => (
          <div key={name}>
            <span>{name} </span>
            <Icon size={16} />
            <Icon size={24} weight="bold" />
            <Icon size={32} weight="fill" />
            <Icon size={24} mirrored />
          </div>
        ))}
      </section>
    </IconContext.Provider>
  )
}
const meta = { decorators: [sharedFrame], title: 'Shared/Marks', component: Marks } satisfies Meta<typeof Marks>
export default meta
type Story = StoryObj<typeof meta>
export const BrandSizes = {} satisfies Story
export const ReducedMotion = { globals: { motion: 'reduced' } } satisfies Story
export const IconExportGallery = { render: () => <IconGallery /> } satisfies Story
export const DarkIcons = { render: () => <IconGallery />, globals: { theme: 'dark' } } satisfies Story
