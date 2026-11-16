import { createContext, useContext, type ReactNode } from 'react'

export interface InteractiveChatContextValue {
  sessionKey: string
  onSendFeedback: (text: string) => Promise<void>
  disabled?: boolean
}

const InteractiveChatContext = createContext<InteractiveChatContextValue | null>(null)

export function InteractiveChatProvider({ children, ...value }: InteractiveChatContextValue & { children: ReactNode }) {
  return <InteractiveChatContext.Provider value={value}>{children}</InteractiveChatContext.Provider>
}

export function useInteractiveChat() {
  return useContext(InteractiveChatContext)
}
