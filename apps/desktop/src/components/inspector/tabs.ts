import type { InspectorTab } from '@/types/api'
import { Folder, GitDiff, Globe, Info, Robot } from '../icons'

export const inspectorTabs: Array<{ id: InspectorTab; label: string; Icon: typeof Info }> = [
  { id: 'changes', label: 'Changes', Icon: GitDiff },
  { id: 'summary', label: 'Overview', Icon: Info },
  { id: 'specialists', label: 'Agents', Icon: Robot },
  { id: 'files', label: 'Files', Icon: Folder },
  { id: 'browser', label: 'Browser', Icon: Globe },
]
