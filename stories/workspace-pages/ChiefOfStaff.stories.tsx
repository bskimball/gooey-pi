import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActivityCoordinator } from '../../apps/desktop/src/components/activity/ActivityCoordinator'
import { installWorkspaceHost } from '../workspace-shell/host'

const meta = {
  title: 'Workspace/ChiefOfStaff',
  beforeEach: () => {
    installWorkspaceHost()
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ActivityCoordinator>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <ActivityCoordinator bridge={null} embedded />,
}
