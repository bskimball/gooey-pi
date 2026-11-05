export type ParallelVariantId = 'a' | 'b'

export interface ParallelVariant {
  id: ParallelVariantId
  path: string
  branch: string
  prompt: string
  status: 'prepared' | 'running' | 'completed' | 'stopped' | 'error'
  sessionFile?: string
  runtimeId?: string
  error?: string
}

export interface ParallelRun {
  id: string
  projectId: string
  cwd: string
  targetBranch: string
  base: string
  createdAt: string
  maxMinutes: number
  status: 'preparing' | 'ready' | 'running' | 'stopped' | 'error' | 'promoted'
  variants: [ParallelVariant, ParallelVariant]
  error?: string
  promotedVariant?: ParallelVariantId
  promotedCommit?: string
}

export interface ParallelRunOptions {
  cwd: string
  baseRef: string
  prompts: [string, string]
  maxMinutes: number
}

export interface ParallelReview {
  id: string
  runId: string
  variantId: ParallelVariantId
  base: string
  head: string
  tree: string
  commit: string
  diff: string
  truncated: boolean
  files: string[]
}

export interface ParallelWorkApi {
  list(projectId: string): Promise<ParallelRun[]>
  create(projectId: string, options: ParallelRunOptions): Promise<ParallelRun | null>
  start(projectId: string, runId: string): Promise<ParallelRun>
  stop(projectId: string, runId: string): Promise<ParallelRun>
  review(projectId: string, runId: string, variantId: ParallelVariantId): Promise<ParallelReview>
  promote(projectId: string, runId: string, reviewId: string): Promise<ParallelRun>
}
