import type {} from 'react/canary'
import { addTransitionType, startTransition, ViewTransition, type ReactElement } from 'react'

export function transitionWorkspace(change: () => void) {
  startTransition(() => {
    addTransitionType('workspace-navigation')
    change()
  })
}

// Capture the outgoing pixels so editors, terminals and browser panes can unmount normally.
export function WorkspaceTransition({ part, children }: { part: 'workspace-body' | 'workspace-title'; children: ReactElement }) {
  return (
    <ViewTransition name={part} default="none" update={{ default: 'none', 'workspace-navigation': 'auto' }}>
      {children}
    </ViewTransition>
  )
}
