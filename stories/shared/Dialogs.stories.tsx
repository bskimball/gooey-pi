import { sharedFrame } from './frame'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ApexButton, EmptyState } from '../../packages/ui/src/ui'
import { Modal } from '../../packages/ui/src/Modal'
import { ErrorBoundary } from '../../packages/ui/src/ErrorBoundary'

function DialogDemo({ overflow = false }: { overflow?: boolean }) {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState('Keyboard navigation review')
  return (
    <>
      <ApexButton onClick={() => setOpen(true)}>Open session settings</ApexButton>
      <p role="status">Session: {name}</p>
      {open && (
        <Modal
          title="Session settings"
          onClose={() => setOpen(false)}
          footer={
            <>
              <ApexButton onClick={() => setOpen(false)}>Cancel</ApexButton>
              <ApexButton variant="primary" onClick={() => setOpen(false)}>
                Save
              </ApexButton>
            </>
          }
        >
          <TextInput label="Session name" value={name} onChange={setName} />
          <p>Escape dismisses the dialog. Reopen it to check focus restoration and Tab containment.</p>
          {overflow && Array.from({ length: 30 }, (_, index) => <p key={index}>Review item {index + 1}: preserve keyboard focus when changing sessions and returning to the composer.</p>)}
        </Modal>
      )}
    </>
  )
}
function ThrowingChild({ failed }: { failed: boolean }) {
  if (failed) throw new Error('Intentional Storybook render failure')
  return <EmptyState title="Conversation recovered">Your draft is still available.</EmptyState>
}
function BoundaryDemo({ failure = false, staticFallback = false }: { failure?: boolean; staticFallback?: boolean }) {
  const [failed, setFailed] = useState(failure)
  const [caught, setCaught] = useState(false)
  return (
    <>
      <p>Intentional errors are logged by the real ErrorBoundary. Caught: {String(caught)}</p>
      <ErrorBoundary
        onCatch={() => setCaught(true)}
        fallback={
          staticFallback ? (
            <EmptyState role="alert" title="Conversation could not render">
              Your draft has been preserved.
            </EmptyState>
          ) : (
            (reset) => (
              <EmptyState
                role="alert"
                title="Conversation could not render"
                action={
                  <ApexButton
                    onClick={() => {
                      setFailed(false)
                      reset()
                    }}
                  >
                    Retry
                  </ApexButton>
                }
              >
                Retry rendering without losing your draft.
              </EmptyState>
            )
          )
        }
      >
        <ThrowingChild failed={failed} />
      </ErrorBoundary>
    </>
  )
}
const meta = { decorators: [sharedFrame], title: 'Shared/Dialogs', component: DialogDemo } satisfies Meta<typeof DialogDemo>
export default meta
type Story = StoryObj<typeof meta>
export const ModalWithFooter = {} satisfies Story
export const Overflow = { args: { overflow: true } } satisfies Story
export const HealthyBoundary = { render: () => <BoundaryDemo /> } satisfies Story
export const StaticErrorFallback = { render: () => <BoundaryDemo failure staticFallback /> } satisfies Story
export const RetryErrorFallback = { render: () => <BoundaryDemo failure /> } satisfies Story
export const DarkModal = { globals: { theme: 'dark' } } satisfies Story
export const NarrowModal = { globals: { viewport: { value: 'narrow', isRotated: false } } } satisfies Story
