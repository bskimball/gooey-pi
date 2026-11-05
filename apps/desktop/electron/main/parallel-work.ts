import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ParallelRun, ParallelReview, ParallelVariant, ParallelVariantId } from '../../src/types/api'
import { isPathWithin, isRecord, rejectUnknownKeys, requireId, requireRecord, requireString } from 'apex-core/validation'
import type { AgentRpcManager } from './agent-rpc'
import type { ProjectService } from './projects'
import type { RepositoryUseGate } from './repository-use-gate'
import { resolveGitRepositoryRoot } from './git'
import { createParallelWorktree, parallelBranch, parallelHead, parallelSnapshot, parallelTree, promoteParallelSnapshot, requireCleanParallelTarget, requireParallelWorktree } from './git-parallel'

interface Dependencies {
  file: string
  projects: Pick<ProjectService, 'resolveCheckoutProject' | 'authorizeCwd' | 'adoptCheckoutWorktree'>
  agents: Pick<AgentRpcManager, 'start' | 'runPromptToCompletion' | 'stop' | 'has' | 'list' | 'pinAttachment'>
  gate: RepositoryUseGate
  chooseDirectory(): Promise<string | null>
  confirmPromotion(run: ParallelRun, review: ParallelReview): Promise<boolean>
}
interface Execution {
  run: ParallelRun
  ids: Set<string>
  stopping: boolean
  done: Promise<void>
  timer?: NodeJS.Timeout
}
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
const runStates = new Set(['preparing', 'ready', 'running', 'stopped', 'error', 'promoted'])
const variantStates = new Set(['prepared', 'running', 'completed', 'stopped', 'error'])

function storedRun(value: unknown): ParallelRun {
  const run = requireRecord(value, 'parallel run')
  for (const name of ['id', 'projectId', 'cwd', 'targetBranch', 'base', 'createdAt']) requireString(run[name], name, { min: 1, max: 4096 })
  if (typeof run.status !== 'string' || !runStates.has(run.status) || typeof run.maxMinutes !== 'number' || !Number.isInteger(run.maxMinutes) || run.maxMinutes < 1 || run.maxMinutes > 60) throw new Error('Invalid saved parallel run')
  if (!Array.isArray(run.variants) || run.variants.length !== 2) throw new Error('Invalid saved alternatives')
  for (const [index, value] of run.variants.entries()) {
    const variant = requireRecord(value, 'alternative')
    if (variant.id !== (index === 0 ? 'a' : 'b') || typeof variant.status !== 'string' || !variantStates.has(variant.status)) throw new Error('Invalid saved alternative')
    for (const name of ['path', 'branch', 'prompt']) requireString(variant[name], name, { min: 1, max: 32_000 })
    for (const name of ['sessionFile', 'runtimeId', 'error']) if (variant[name] !== undefined) requireString(variant[name], name, { max: 32_000 })
  }
  const cwd = String(run.cwd)
  if (!/^[a-f0-9]{40,64}$/.test(String(run.base))) throw new Error('Invalid saved base revision')
  const paths = run.variants.map((variant) => String(variant.path))
  if (paths.some((path) => isPathWithin(cwd, path) || isPathWithin(path, cwd)) || isPathWithin(paths[0], paths[1]) || isPathWithin(paths[1], paths[0])) throw new Error('Saved alternative worktrees must be separate from one another and the target')
  for (const name of ['error', 'promotedCommit']) if (run[name] !== undefined) requireString(run[name], name, { max: 32_000 })
  if (run.promotedVariant !== undefined && run.promotedVariant !== 'a' && run.promotedVariant !== 'b') throw new Error('Invalid saved winner')
  return run as unknown as ParallelRun
}

export class ParallelWorkService {
  private readonly runs = new Map<string, ParallelRun>()
  private readonly reviews = new Map<string, ParallelReview>()
  private readonly ready: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  private operations: Promise<unknown> = Promise.resolve()
  private execution?: Execution
  private closed = false

  constructor(private readonly deps: Dependencies) {
    this.ready = this.load()
    void this.ready.catch(() => undefined)
  }

  private async load() {
    let raw: string
    try { raw = await readFile(this.deps.file, 'utf8') }
    catch (error) { if (isRecord(error) && error.code === 'ENOENT') return; throw error }
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) throw new Error('Invalid parallel-work history')
    for (const item of data) {
      const run = storedRun(item)
      if (run.status === 'running' || run.status === 'preparing') {
        run.status = 'stopped'
        run.error = 'Desktop restarted. Worktrees were preserved; no commands were replayed.'
        for (const variant of run.variants) if (variant.status === 'running') variant.status = 'stopped'
      }
      for (const variant of run.variants) delete variant.runtimeId
      this.runs.set(run.id, run)
    }
  }

  private save(): Promise<void> {
    const text = JSON.stringify([...this.runs.values()])
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.deps.file), { recursive: true })
      const temporary = `${this.deps.file}.${randomUUID()}.tmp`
      await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.deps.file)
    })
    this.writes = write.catch(() => undefined)
    return write
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(async () => { await this.ready; if (this.closed) throw new Error('Desktop is shutting down'); return operation() })
    this.operations = next.catch(() => undefined)
    return next
  }

  private async requireRun(projectValue: unknown, runValue: unknown): Promise<ParallelRun> {
    await this.ready
    const project = await this.deps.projects.resolveCheckoutProject(requireId(projectValue, 'project id'))
    const run = this.runs.get(requireId(runValue, 'parallel run id'))
    if (!run || run.projectId !== project.id) throw new Error('Parallel run is not part of this project')
    await this.deps.projects.authorizeCwd(run.cwd)
    if (!project.folders.some((folder) => resolve(folder) === resolve(run.cwd))) throw new Error('The original project checkout is no longer granted')
    return run
  }

  async list(projectId: unknown): Promise<ParallelRun[]> {
    await this.ready
    const project = await this.deps.projects.resolveCheckoutProject(requireId(projectId, 'project id'))
    return structuredClone([...this.runs.values()].filter((run) => run.projectId === project.id).reverse())
  }

  create(projectId: unknown, raw: unknown): Promise<ParallelRun | null> {
    return this.serial(async () => {
      const project = await this.deps.projects.resolveCheckoutProject(requireId(projectId, 'project id'))
      const options = requireRecord(raw, 'parallel work options')
      rejectUnknownKeys(options, ['cwd', 'baseRef', 'prompts', 'maxMinutes'], 'parallel work options')
      const cwd = await this.deps.projects.authorizeCwd(requireString(options.cwd, 'cwd', { min: 1, max: 4096 }))
      if (resolve(await resolveGitRepositoryRoot(cwd)) !== resolve(cwd) || !project.folders.some((folder) => resolve(folder) === resolve(cwd))) throw new Error('Select a granted repository checkout root')
      if (resolve(project.primaryFolder) !== resolve(cwd)) throw new Error('Select this checkout as the active project folder before creating alternatives')
      const baseRef = requireString(options.baseRef, 'base revision', { min: 1, max: 255 })
      if (!Array.isArray(options.prompts) || options.prompts.length !== 2) throw new Error('Exactly two alternative prompts are required')
      const prompts = options.prompts.map((prompt) => requireString(prompt, 'prompt', { min: 1, max: 32_000, trim: true }))
      const maxMinutes = options.maxMinutes
      if (typeof maxMinutes !== 'number' || !Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 60) throw new Error('Time limit must be 1–60 minutes')
      const base = await parallelHead(cwd, baseRef)
      const targetBranch = await parallelBranch(cwd)
      await requireCleanParallelTarget(cwd, base, targetBranch)
      const choice = await this.deps.chooseDirectory()
      if (!choice) return null
      const directory = await realpath(choice)
      if (isPathWithin(cwd, resolve(directory))) throw new Error('Choose a worktree parent outside the target checkout')
      const id = randomUUID()
      const variant = (idValue: ParallelVariantId, prompt: string): ParallelVariant => ({ id: idValue, path: join(directory, `apex-${id}`, idValue), branch: `apex/alternative-${id}/${idValue}`, prompt, status: 'prepared' })
      const run: ParallelRun = { id, projectId: project.id, cwd, base, targetBranch, maxMinutes, createdAt: new Date().toISOString(), status: 'preparing', variants: [variant('a', prompts[0]), variant('b', prompts[1])] }
      this.runs.set(id, run)
      await this.save()
      try {
        await this.deps.gate.runBranchCheckout(cwd, async () => {
          await requireCleanParallelTarget(cwd, base, targetBranch)
          for (const candidate of run.variants) {
            await mkdir(dirname(candidate.path), { recursive: true })
            await createParallelWorktree(cwd, candidate.path, candidate.branch, base)
            await this.deps.projects.adoptCheckoutWorktree(project.id, cwd, candidate.path, false)
          }
        })
        run.status = 'ready'
      } catch (error) { run.status = 'error'; run.error = `${reason(error)} Any created worktrees were preserved at the recorded paths.` }
      await this.save()
      return structuredClone(run)
    })
  }

  start(projectId: unknown, runId: unknown): Promise<ParallelRun> {
    return this.serial(async () => {
      const run = await this.requireRun(projectId, runId)
      if (run.status !== 'ready') throw new Error('Only newly prepared alternatives can start. Create a new pair to run again.')
      if (this.execution) throw new Error('Only one pair (two alternative runtimes) may run at a time')
      for (const variant of run.variants) {
        await this.deps.projects.authorizeCwd(variant.path)
        await requireParallelWorktree(run.cwd, variant.path, variant.branch, run.base)
      }
      run.status = 'running'
      for (const variant of run.variants) variant.status = 'running'
      await this.save()
      const execution: Execution = { run, ids: new Set(), stopping: false, done: Promise.resolve() }
      this.execution = execution
      execution.timer = setTimeout(() => { void this.halt(execution, 'Time limit reached; files and sessions were preserved.').catch(() => undefined) }, run.maxMinutes * 60_000)
      execution.timer.unref()
      execution.done = this.execute(execution)
      void execution.done.catch(() => undefined)
      return structuredClone(run)
    })
  }

  private async execute(execution: Execution): Promise<void> {
    const run = execution.run
    try {
      await Promise.all(run.variants.map(async (variant) => {
        let release: (() => void) | undefined
        try {
          const runtime = await this.deps.agents.start({ cwd: variant.path })
          execution.ids.add(runtime.runtimeId)
          variant.runtimeId = runtime.runtimeId
          variant.sessionFile = runtime.sessionFile
          release = this.deps.agents.pinAttachment(runtime.runtimeId)
          await this.save()
          if (!execution.stopping) {
            await this.deps.agents.runPromptToCompletion(runtime.runtimeId, `${variant.prompt}\n\nWork only in this alternative worktree: ${variant.path}. Base revision: ${run.base}. Do not merge, push, or modify the other alternative or target checkout. Summarize changes and validation when finished.`, run.maxMinutes * 60_000)
          }
          variant.status = execution.stopping ? 'stopped' : 'completed'
        } catch (error) {
          variant.status = execution.stopping ? 'stopped' : 'error'
          if (!execution.stopping) variant.error = reason(error)
        } finally {
          release?.()
          if (variant.runtimeId) {
            variant.sessionFile = this.deps.agents.list().find((runtime) => runtime.runtimeId === variant.runtimeId)?.sessionFile ?? variant.sessionFile
            const stopped = await this.stopRuntime(variant.runtimeId)
            if (!stopped) { variant.status = 'error'; variant.error = 'Could not confirm runtime shutdown. Review is blocked until it exits.' }
            else { execution.ids.delete(variant.runtimeId); delete variant.runtimeId }
          }
        }
      }))
      run.status = run.variants.some((variant) => variant.status === 'error') ? 'error' : 'stopped'
    } finally {
      clearTimeout(execution.timer)
      if (!execution.ids.size && this.execution === execution) this.execution = undefined
      await this.save()
    }
  }

  private async stopRuntime(id: string): Promise<boolean> {
    if (!this.deps.agents.has(id)) return true
    return await this.deps.agents.stop(id).catch(() => false) || !this.deps.agents.has(id)
  }

  private async halt(execution: Execution, message: string): Promise<void> {
    execution.stopping = true
    execution.run.error = message
    await Promise.allSettled([...execution.ids].map((id) => this.stopRuntime(id)))
    await execution.done
    // A failed kill remains tracked and can be retried by Stop.
    for (const variant of execution.run.variants) {
      if (variant.runtimeId && await this.stopRuntime(variant.runtimeId)) {
        execution.ids.delete(variant.runtimeId); delete variant.runtimeId
      }
    }
    if (!execution.ids.size && this.execution === execution) this.execution = undefined
    await this.save()
  }

  async stop(projectId: unknown, runId: unknown): Promise<ParallelRun> {
    const run = await this.requireRun(projectId, runId)
    if (this.execution?.run.id === run.id) await this.halt(this.execution, 'Stopped by user; files and sessions were preserved.')
    return structuredClone(run)
  }

  private requireSettled(run: ParallelRun) {
    if (run.status === 'preparing' || run.status === 'running' || this.execution?.run.id === run.id) throw new Error('Stop both alternative runtimes before review or promotion')
    if (run.status === 'promoted') throw new Error('This pair already has a promoted alternative')
  }

  review(projectId: unknown, runId: unknown, variantValue: unknown): Promise<ParallelReview> {
    return this.serial(async () => {
      const run = await this.requireRun(projectId, runId)
      this.requireSettled(run)
      if (variantValue !== 'a' && variantValue !== 'b') throw new TypeError('Invalid alternative')
      const variant = run.variants[variantValue === 'a' ? 0 : 1]
      await this.deps.projects.authorizeCwd(variant.path)
      return this.deps.gate.runBranchCheckout(variant.path, async () => {
        await requireParallelWorktree(run.cwd, variant.path, variant.branch, run.base)
        const snapshot = await parallelSnapshot(variant.path, run.base, variant.id.toUpperCase())
        const review: ParallelReview = { ...snapshot, id: randomUUID(), runId: run.id, variantId: variant.id, base: run.base }
        for (const [id, previous] of this.reviews) if (previous.runId === run.id && previous.variantId === variant.id) this.reviews.delete(id)
        this.reviews.set(review.id, review)
        return structuredClone(review)
      })
    })
  }

  promote(projectId: unknown, runId: unknown, reviewValue: unknown): Promise<ParallelRun> {
    return this.serial(async () => {
      const run = await this.requireRun(projectId, runId)
      if (run.promotedCommit) {
        if (await parallelHead(run.cwd) !== run.promotedCommit || await parallelBranch(run.cwd) !== run.targetBranch) throw new Error('Previous promotion outcome requires inspection. No command was replayed.')
        run.status = 'promoted'; await this.save(); return structuredClone(run)
      }
      this.requireSettled(run)
      const review = this.reviews.get(requireId(reviewValue, 'review id'))
      if (!review || review.runId !== run.id) throw new Error('Review this alternative again before promotion')
      if (review.truncated) throw new Error('The snapshot diff is incomplete and cannot be promoted here')
      const variant = run.variants[review.variantId === 'a' ? 0 : 1]
      await this.deps.projects.authorizeCwd(variant.path)
      return this.deps.gate.runBranchCheckout(variant.path, () => this.deps.gate.runBranchCheckout(run.cwd, async () => {
        const validate = async () => {
          await requireCleanParallelTarget(run.cwd, run.base, run.targetBranch)
          await requireParallelWorktree(run.cwd, variant.path, variant.branch, run.base)
          const current = await parallelTree(variant.path)
          if (current.tree !== review.tree || current.head !== review.head) throw new Error('The candidate changed since review. Review the new snapshot before promotion.')
        }
        await validate()
        if (!await this.deps.confirmPromotion(structuredClone(run), structuredClone(review))) return structuredClone(run)
        await validate()
        run.promotedCommit = review.commit
        run.promotedVariant = variant.id
        await this.save()
        try {
          await promoteParallelSnapshot(run.cwd, review.commit)
          run.status = 'promoted'
          delete run.error
        } catch (error) { run.status = 'error'; run.error = `Promotion outcome requires inspection: ${reason(error)}`; await this.save(); throw error }
        await this.save()
        return structuredClone(run)
      }))
    })
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.execution) await this.halt(this.execution, 'Desktop closed; files and sessions were preserved.')
    await this.operations
    await this.writes
  }
}
