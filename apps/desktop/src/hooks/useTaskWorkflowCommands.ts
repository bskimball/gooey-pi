import { useEffect, useRef, useState, type RefObject } from 'react'
import { appendTaskContext } from '@/lib/task-context'
import { useTaskWorkflows } from './useTaskWorkflows'

type Location = { generation: number; sessionFile?: string }
type SideQuestion = { text: string; source: Location }
type SideSubmission = { text: string; target: Location }
type RecoveredDraft = { sessionFile: string; id: number; text: string }
type Options = Parameters<typeof useTaskWorkflows>[0] & {
  workspaceRef: RefObject<Location>
  onSend(prompt: string): Promise<void>
}

/** Composer commands compose the existing task actions; they never start or select runtimes themselves. */
export function useTaskWorkflowCommands({ workspaceRef, onSend, ...options }: Options) {
  const question = useRef<SideQuestion | undefined>(undefined)
  const [submission, setSubmission] = useState<SideSubmission>()
  const submitted = useRef<SideSubmission | undefined>(undefined)
  const [recovered, setRecovered] = useState<RecoveredDraft>()
  const recover = (sessionFile: string | undefined, text: string) => {
    if (sessionFile) setRecovered({ sessionFile, id: -Date.now(), text })
  }
  const workflow = useTaskWorkflows({
    ...options,
    selectSession: async (session) => {
      // Only navigation completed by createSide can consume this question, not a sidebar click.
      const pending = question.current
      question.current = undefined
      const source = workspaceRef.current
      const stillAtSource = pending && source.generation === pending.source.generation && source.sessionFile === pending.source.sessionFile
      try {
        const navigation = options.selectSession(session)
        const target = { ...workspaceRef.current }
        await navigation
        if (!pending) return
        if (!stillAtSource || target.sessionFile !== session.filePath
          || workspaceRef.current.generation !== target.generation || workspaceRef.current.sessionFile !== target.sessionFile) {
          recover(pending.source.sessionFile, `/btw ${pending.text}`)
          return
        }
        setSubmission({ text: pending.text, target })
      } catch (error) {
        if (pending) recover(pending.source.sessionFile, `/btw ${pending.text}`)
        throw error
      }
    },
  })
  useEffect(() => {
    // A failed creation never reaches selectSession. Preserve the user's command for retry.
    if (!workflow.pending && question.current) {
      const pending = question.current
      question.current = undefined
      recover(pending.source.sessionFile, `/btw ${pending.text}`)
    }
    if (!submission || submitted.current === submission) return
    const current = workspaceRef.current
    if (current.generation !== submission.target.generation || current.sessionFile !== submission.target.sessionFile) {
      setSubmission(undefined)
      recover(submission.target.sessionFile, submission.text)
      return
    }
    if (workflow.pending || options.busy || workflow.context.sessionFile !== submission.target.sessionFile) return
    submitted.current = submission
    setSubmission(undefined)
    const excerpts = workflow.context.excerpts
    void onSend(appendTaskContext(submission.text, excerpts)).then(
      () => workflow.context.remove(excerpts.map((excerpt) => excerpt.id)),
      (error: unknown) => { recover(submission.target.sessionFile, submission.text); options.reportError(error) },
    )
  })
  const createSideWithQuestion = (text?: string) => {
    if (!workflow.context.sessionFile || options.session?.harness !== 'pi' || workflow.pending || question.current) return
    if (text?.trim()) question.current = { text: text.trim(), source: { ...workspaceRef.current } }
    workflow.createSide()
  }
  return {
    ...workflow,
    createSideWithQuestion,
    insertDraft: recovered?.sessionFile === options.session?.filePath ? recovered : workflow.insertDraft,
    draftInserted: (id: number) => {
      if (recovered?.id === id) setRecovered(undefined)
      else workflow.draftInserted(id)
    },
  }
}
