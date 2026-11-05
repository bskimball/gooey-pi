import { useState, type ComponentProps } from 'react'
import type { ProjectRecord } from '@/types/api'
import { SpecialistsPanel } from './SpecialistsPanel'
import { ParallelWorkPanel } from './ParallelWorkPanel'
import { Segmented } from '../ui'

type Props = ComponentProps<typeof SpecialistsPanel> & { project?: ProjectRecord; onRefreshGit(): Promise<void> | void }

export function AgentsPanel({ project, onRefreshGit, ...specialists }: Props) {
  const [mode, setMode] = useState('coordination')
  return <div className="agents-workspace">
    <div className="agents-workspace__toolbar"><Segmented label="Agent workspace" value={mode} options={[{ value: 'coordination', label: 'Coordination' }, { value: 'alternatives', label: 'Alternatives' }]} onChange={setMode} /></div>
    {mode === 'coordination' ? <SpecialistsPanel {...specialists} /> : <ParallelWorkPanel key={`${project?.id}:${specialists.cwd}`} project={project} cwd={specialists.cwd} onRefreshGit={onRefreshGit} />}
  </div>
}
