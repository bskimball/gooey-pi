import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { TerminalDrawer } from '../../apps/desktop/src/components/TerminalDrawer'
import { BackgroundJobView } from '../../apps/desktop/src/components/BackgroundJobView'
import { BackgroundJobOutput } from '../../apps/desktop/src/hooks/useBackgroundJobs'
import type { BackgroundJob } from '../../apps/desktop/src/types/api'
import { ApexButton } from '../../apps/desktop/src/components/ui'
import { job, noop, project, session } from './fixtures'
import { installWorkspaceHost } from './host'

let terminalEvents: ReturnType<typeof installWorkspaceHost> | undefined
const meta = {
  title: 'Workspace/Terminal',
  beforeEach: () => {
    terminalEvents = installWorkspaceHost()
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
function createOutput() {
  const output = new BackgroundJobOutput()
  output.reset(job.key, '\u001b[36mNavigation suite\u001b[0m\r\n\u001b[32m✓\u001b[0m restores focus after inspector closes\r\n')
  return {
    output,
    append(reset: boolean) {
      const data = reset ? '\u001b[33mOutput reset. Re-running fixtures.\u001b[0m\r\n' : '\u001b[32m✓\u001b[0m keyboard navigation passed\r\n'
      if (reset) output.reset(job.key, data)
      else output.append(job.key, data)
    },
  }
}
function Drawer({ jobsOnly = false, empty = false }: { jobsOnly?: boolean; empty?: boolean }) {
  const [height, setHeight] = useState(360)
  const [visible, setVisible] = useState(true)
  const [jobs, setJobs] = useState<BackgroundJob[]>(empty ? [] : [job])
  const [stream] = useState(createOutput)
  const [error, setError] = useState('')
  return (
    <div style={{ height: 620, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        <ApexButton onClick={() => setVisible(true)}>Open terminal</ApexButton>
        <ApexButton onClick={() => stream.append(false)}>Append output</ApexButton>
        <ApexButton onClick={() => stream.append(true)}>Reset output</ApexButton>
        <ApexButton onClick={() => terminalEvents?.exit.emit({ terminalId: 'story-terminal-1', exitCode: 0 })}>Simulate shell exit</ApexButton>
        <output>{error}</output>
      </div>
      <TerminalDrawer
        visible={visible}
        cwd={project.path}
        sessionPath={session.filePath}
        startEmpty={jobsOnly || empty}
        jobs={jobs}
        jobOutput={stream.output}
        onStopJob={(key) => setJobs((current) => current.map((item) => (item.key === key ? { ...item, status: 'killed', signal: 'SIGTERM', connected: false } : item)))}
        onDismissJob={(key) => setJobs((current) => current.filter((item) => item.key !== key))}
        height={height}
        minHeight={180}
        maxHeight={580}
        defaultHeight={360}
        onHeightChange={setHeight}
        onClose={() => setVisible(false)}
        onError={setError}
        onOpenLink={noop}
      />
    </div>
  )
}
export const InteractiveShell: Story = { render: () => <Drawer /> }
export const BackgroundJobs: Story = { render: () => <Drawer jobsOnly /> }
export const EmptyDrawer: Story = { render: () => <Drawer empty /> }
export const ShellFailure: Story = {
  beforeEach: () => {
    terminalEvents = installWorkspaceHost('failure')
  },
  render: () => <Drawer />,
}
function Mirror({ status }: { status: BackgroundJob['status'] }) {
  const [stream] = useState(createOutput)
  return (
    <div style={{ height: 400, display: 'flex', flexDirection: 'column' }}>
      <div>
        <ApexButton onClick={() => stream.append(false)}>Append ANSI output</ApexButton>
        <ApexButton onClick={() => stream.append(true)}>Reset</ApexButton>
      </div>
      <BackgroundJobView
        job={{ ...job, status, exitCode: status === 'completed' ? 0 : status === 'failed' ? 1 : null, signal: status === 'killed' ? 'SIGTERM' : null }}
        output={stream.output}
        visible
        onOpenLink={noop}
      />
    </div>
  )
}
export const RunningOutput: Story = { render: () => <Mirror status="running" /> }
export const CompletedOutput: Story = { render: () => <Mirror status="completed" /> }
export const FailedOutput: Story = { render: () => <Mirror status="failed" /> }
export const KilledOutput: Story = { render: () => <Mirror status="killed" /> }
