export type Point = { x: number; y: number }
export type ElementTarget = { ref: number } | (({ role: string; name?: string } | { role?: string; name: string }) & { nth?: number; intent?: string })
export type Target = Point | ElementTarget
export interface Expectation {
  url_includes?: string
  title_includes?: string
  text_includes?: string
  text_absent?: string
  element?: ElementTarget
  judge?: string
  timeout_ms?: number
}
type WithExpectation = { expect?: Expectation }
export type Step = (
  | { action: 'click'; target: Target; double?: boolean; button?: 'left' | 'right' | 'middle' }
  | { action: 'drag'; from: Target; to: Target; steps?: number }
  | { action: 'type'; target: ElementTarget; text: string; submit?: boolean; clear?: boolean }
  | { action: 'select'; target: ElementTarget; value: string }
  | { action: 'press'; key: string; modifiers?: string[]; repeat?: number }
  | { action: 'navigate'; url: string }
  | { action: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number; x?: number; y?: number }
  | { action: 'wait'; ms: number }
  | { action: 'expect'; expect: Expectation }
) &
  WithExpectation
export interface RunInput {
  tab_id?: string
  steps: Step[]
}
export interface PageElement {
  ref: number
  role: string
  name: string
  href?: string
  value?: string
  checked?: boolean
  disabled?: boolean
}
export interface Page {
  url: string
  title: string
  text?: string
  elements: PageElement[]
}
export interface Broker {
  call(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}
export interface Classifier {
  choose(state: string, candidates: PageElement[]): Promise<{ ref?: number; confidence: number }>
  holds(state: string, condition: string): Promise<number>
}
export interface RunOptions {
  intent?: string
  broker: Broker
  classifier?: Classifier
  signal?: AbortSignal
}
export interface StepResult {
  index: number
  action: Step['action']
  ok: boolean
  target?: Pick<PageElement, 'ref' | 'role' | 'name'>
  detail?: unknown
  error?: string
  candidates?: PageElement[]
}
export interface PageDiff {
  added: PageElement[]
  removed: PageElement[]
  changed: { before: PageElement; after: PageElement }[]
}
export interface RunResult {
  ok: boolean
  completed: number
  steps: StepResult[]
  page: { url: string; title: string }
  diff: PageDiff
  elapsed_ms: number
}
