import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface InteractiveChatContextValue {
  sessionKey: string
  onSendFeedback: (text: string) => Promise<void>
  disabled?: boolean
}

const InteractiveChatContext = createContext<InteractiveChatContextValue | null>(null)

export function InteractiveChatProvider({ children, sessionKey, disabled, onSendFeedback }: InteractiveChatContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ sessionKey, disabled, onSendFeedback }), [sessionKey, disabled, onSendFeedback])
  return <InteractiveChatContext.Provider value={value}>{children}</InteractiveChatContext.Provider>
}

export function useInteractiveChat() {
  return useContext(InteractiveChatContext)
}
