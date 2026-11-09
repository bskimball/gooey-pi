import { useCallback, useLayoutEffect } from 'react'
import { useMachine } from '@xstate/react'
import type { PrimeWorkApi, VoiceTranscriptionProvider } from '@/types/api'
import { dictationMachine } from './dictationMachine'

export type DictationState = 'idle' | 'connecting' | 'recording' | 'transcribing'

export function useDictation(voice: PrimeWorkApi['voice'] | null | undefined, provider: VoiceTranscriptionProvider, onError: (message: string) => void) {
  const [snapshot, send, actor] = useMachine(dictationMachine)
  const state: DictationState = snapshot.matches('idle') ? 'idle'
    : snapshot.matches({ active: 'connecting' }) ? 'connecting'
      : snapshot.matches({ active: 'recording' }) ? 'recording' : 'transcribing'

  const cancel = useCallback(() => send({ type: 'CANCEL' }), [send])
  // Layout cleanup runs before useMachine's passive teardown stops the actor, so CANCEL still releases the mic on unmount.
  useLayoutEffect(() => cancel, [cancel])

  const start = useCallback(async () => {
    if (!voice || !actor.getSnapshot().matches('idle')) return
    return new Promise<void>((resolve) => send({ type: 'START', options: { voice, provider, onError }, resolve }))
  }, [voice, provider, onError, actor, send])

  const finish = useCallback(async (): Promise<string> => {
    if (!voice || !actor.getSnapshot().matches({ active: 'recording' })) return ''
    return new Promise<string>((resolve) => send({ type: 'FINISH', options: { voice, provider, onError }, resolve }))
  }, [voice, provider, onError, actor, send])

  return { state, start, finish, cancel }
}
