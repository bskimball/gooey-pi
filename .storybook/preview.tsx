import { setReducedMotion } from './motion-preference'
import { VSCodeTheme } from './vscode-theme'
import type { Preview } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { IconContext } from '../packages/ui/src/icons'
import '../packages/ui/src/ui'
import '../apps/desktop/src/styles.css'
import { createApexStoryFixture, installHostFixture, installVoiceMediaFixture, resetStoryEnvironment } from './host-fixtures'

const preview: Preview = {
  initialGlobals: { theme: 'light', motion: 'reduced', viewport: { value: 'wide', isRotated: false } },
  globalTypes: {
    theme: { description: 'Apex color theme', toolbar: { icon: 'paintbrush', items: ['light', 'dark'], dynamicTitle: true } },
    motion: { description: 'Motion preference', toolbar: { icon: 'play', items: ['reduced', 'full'], dynamicTitle: true } },
  },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    viewport: {
      options: {
        narrow: { name: 'Narrow', styles: { width: '360px', height: '800px' }, type: 'mobile' },
        wide: { name: 'Wide', styles: { width: '1280px', height: '900px' }, type: 'desktop' },
      },
    },
  },
  beforeEach() {
    resetStoryEnvironment()
    installHostFixture(createApexStoryFixture())
    installVoiceMediaFixture()
    return resetStoryEnvironment
  },
  decorators: [
    (Story, context) => {
      const reduced = context.globals.motion !== 'full'
      setReducedMotion(reduced)
      const story = context.title.startsWith('VS Code/') ? (
        <VSCodeTheme dark={context.globals.theme === 'dark'}>
          <Story />
        </VSCodeTheme>
      ) : (
        <Story />
      )
      document.documentElement.dataset.theme = context.globals.theme === 'dark' ? 'dark' : 'light'
      document.documentElement.dataset.astryxTheme = 'apex'
      document.documentElement.classList.toggle('reduce-motion', reduced)
      return (
        // Motion's useReducedMotion snapshots the preference on mount.
        <MotionConfig key={String(reduced)} reducedMotion={reduced ? 'always' : 'user'}>
          <IconContext.Provider value={{ weight: 'regular' }}>
            {reduced && (
              <style>{`
            html.reduce-motion *, html.reduce-motion *::before, html.reduce-motion *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              animation-delay: 0ms !important;
              transition-duration: 0ms !important;
              transition-delay: 0ms !important;
              scroll-behavior: auto !important;
            }
          `}</style>
            )}
            {story}
          </IconContext.Provider>
        </MotionConfig>
      )
    },
  ],
}
export default preview
