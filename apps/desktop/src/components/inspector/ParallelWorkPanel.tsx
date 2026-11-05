import { useEffect, useRef, useState } from 'react'
import type { ParallelRun, ParallelReview, ParallelVariantId, ProjectRecord } from '@/types/api'
import { errorMessage } from '@/lib/errors'
import { ArrowsClockwise, GitBranch } from '../icons'
import { IconButton } from '../ui'

export function ParallelWorkPanel({ project, cwd, onRefreshGit }: { project?: ProjectRecord; cwd?: string; onRefreshGit(): Promise<void> | void }) {
  const [runs, setRuns] = useState<ParallelRun[]>([])
  const [selected, setSelected] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [prompts, setPrompts] = useState<[string, string]>(['', ''])
  const [baseRef, setBaseRef] = useState('HEAD')
  const [maxMinutes, setMaxMinutes] = useState(15)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [reviews, setReviews] = useState<Partial<Record<ParallelVariantId, ParallelReview>>>({})
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  const mounted = useRef(false)
  const request = useRef(0)
  const busy = useRef(false)
  const run = runs.find((item) => item.id === selected) ?? runs[0]
  const allowed = Boolean(project && !project.readOnly && !project.inferred && cwd)

  useEffect(() => {
    mounted.current = true
    let loading = false
    const load = async () => {
      if (loading || busy.current || !allowed || !project || !window.prime?.parallel) return
      loading = true
      const version = ++request.current
      try {
        const items = await window.prime.parallel.list(project.id)
        if (mounted.current && request.current === version) setRuns(items)
      } catch (reason) { if (mounted.current && request.current === version) setError(errorMessage(reason)) }
      finally { loading = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 1500)
    return () => { mounted.current = false; ++request.current; window.clearInterval(timer) }
  }, [project?.id, allowed])

  const perform = async (label: string, action: () => Promise<void>) => {
    if (busy.current || !window.prime?.parallel || !project) return
    busy.current = true; ++request.current; setPending(label); setError('')
    try { await action() }
    catch (reason) { if (mounted.current) setError(errorMessage(reason)) }
    finally { busy.current = false; if (mounted.current) setPending('') }
  }
  const replace = (updated: ParallelRun) => {
    if (!mounted.current) return
    setRuns((current) => [updated, ...current.filter((item) => item.id !== updated.id)])
    setSelected(updated.id)
  }
  const resetReviews = () => { setReviews({}); setReviewed(new Set()) }
  const create = () => perform('Preparing worktrees', async () => {
    if (!project || !cwd) return
    const next = await window.prime.parallel.create(project.id, { cwd, baseRef, prompts, maxMinutes })
    if (next && mounted.current) { replace(next); setCreating(false); resetReviews() }
  })
  const review = (variant: ParallelVariantId) => perform(`Reviewing ${variant.toUpperCase()}`, async () => {
    if (!project || !run) return
    const snapshot = await window.prime.parallel.review(project.id, run.id, variant)
    if (mounted.current) { setReviews((current) => ({ ...current, [variant]: snapshot })); setReviewed((current) => { const next = new Set(current); if (reviews[variant]) next.delete(reviews[variant].id); return next }) }
  })
  const promote = (snapshot: ParallelReview) => perform('Confirm promotion', async () => {
    if (!project || !run || !reviewed.has(snapshot.id) || snapshot.truncated) return
    replace(await window.prime.parallel.promote(project.id, run.id, snapshot.id))
    await onRefreshGit()
  })

  if (!allowed) return <div className="parallel-empty"><GitBranch size={24} /><h3>Compare two alternatives</h3><p>Select an explicitly added Git project to prepare isolated worktrees and sessions.</p></div>
  if (!window.prime?.parallel) return <div className="parallel-empty"><p>Parallel work requires the current Desktop build.</p></div>
  const running = run?.status === 'running' || run?.variants.some((variant) => Boolean(variant.runtimeId))
  return <div className="parallel-panel inspector-scroll scroll-area">
    <div className="parallel-toolbar"><strong>Parallel alternatives</strong><IconButton label="Refresh alternatives" disabled={Boolean(pending)} onClick={() => void perform('Refreshing', async () => { if (project) setRuns(await window.prime.parallel.list(project.id)) })}><ArrowsClockwise size={14} /></IconButton><button type="button" className="button button--compact" disabled={Boolean(pending)} onClick={() => setCreating(true)}>New pair</button></div>
    <p className="parallel-note">Two sessions, one recorded base. Worktrees isolate files, not credentials, network calls, or other external side effects.</p>
    {error ? <p className="changes-error" role="alert">{error}</p> : null}
    {pending ? <p className="parallel-note" role="status">{pending}…</p> : null}
    {creating || !runs.length ? <form className="parallel-form" onSubmit={(event) => { event.preventDefault(); void create() }}>
      <label className="field"><span>Base revision</span><input value={baseRef} maxLength={255} onChange={(event) => setBaseRef(event.target.value)} disabled={Boolean(pending)} /><small>Must resolve to this checkout's current HEAD. Uncommitted files are never copied.</small></label>
      <label className="field"><span>Alternative A</span><textarea rows={3} value={prompts[0]} maxLength={32_000} onChange={(event) => setPrompts([event.target.value, prompts[1]])} disabled={Boolean(pending)} placeholder="Describe the first approach" required /></label>
      <label className="field"><span>Alternative B</span><textarea rows={3} value={prompts[1]} maxLength={32_000} onChange={(event) => setPrompts([prompts[0], event.target.value])} disabled={Boolean(pending)} placeholder="Describe the second approach" required /></label>
      <label className="field"><span>Pair time limit, minutes</span><input type="number" min={1} max={60} step={1} value={maxMinutes} onChange={(event) => setMaxMinutes(Number(event.target.value))} disabled={Boolean(pending)} required /><small>At most two alternative runtimes at once. Both use your configured Pi default model.</small></label>
      <div className="parallel-actions">{runs.length ? <button type="button" className="button" onClick={() => setCreating(false)} disabled={Boolean(pending)}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={Boolean(pending) || !baseRef.trim() || prompts.some((value) => !value.trim()) || !Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 60}>Choose folder and prepare</button></div>
      <small className="parallel-note">Preparation creates branches and worktrees. No model prompt is sent until you start the pair.</small>
    </form> : null}
    {run && !creating ? <>
      <label className="field"><span>Pair</span><select aria-label="Parallel pair" value={run.id} disabled={Boolean(pending)} onChange={(event) => { setSelected(event.target.value); resetReviews() }}>{runs.map((item) => <option value={item.id} key={item.id}>{item.createdAt.slice(0, 16).replace('T', ' ')} · {item.status} · {item.id.slice(0, 8)}</option>)}</select></label>
      <div className="parallel-base"><span>Target <strong>{run.targetBranch}</strong></span><code title={run.base}>Base {run.base}</code><small title={run.cwd}>{run.cwd}</small><span>{run.status} · {run.maxMinutes} minute limit</span></div>
      {run.error ? <p className="parallel-note" role="status">{run.error}</p> : null}
      <div className="parallel-actions">
        <button type="button" className="button button--primary" disabled={Boolean(pending) || run.status !== 'ready' || runs.some((item) => item.status === 'running')} onClick={() => void perform('Starting both alternatives', async () => { if (project) { resetReviews(); replace(await window.prime.parallel.start(project.id, run.id)) } })}>Start both sessions</button>
        <button type="button" className="button" disabled={Boolean(pending) || !running} onClick={() => void perform('Stopping both alternatives', async () => { if (project) replace(await window.prime.parallel.stop(project.id, run.id)) })}>Stop both</button>
      </div>
      <div className="parallel-variants">{run.variants.map((variant) => {
        const snapshot = reviews[variant.id]
        return <section className="parallel-variant" key={variant.id} aria-label={`Alternative ${variant.id.toUpperCase()}`}>
          <header><h3>Alternative {variant.id.toUpperCase()}</h3><span className={`run-state is-${variant.status}`}>{variant.status}</span></header>
          <p className="parallel-prompt">{variant.prompt}</p>
          <details><summary>Worktree and session</summary><code>{variant.branch}</code><code>{variant.path}</code>{variant.sessionFile ? <code>{variant.sessionFile}</code> : <small>Session starts when the pair runs.</small>}</details>
          {variant.error ? <p className="changes-error" role="alert">{variant.error}</p> : null}
          <div className="parallel-actions"><button type="button" className="button button--compact" disabled={Boolean(pending)} onClick={() => void window.prime.app.openInVsCode(variant.path).then((ok) => { if (!ok) setError('Could not open the worktree in VS Code.') }).catch((reason) => setError(errorMessage(reason)))}>Open worktree</button><button type="button" className="button button--compact" disabled={Boolean(pending) || Boolean(running) || run.status === 'preparing' || run.status === 'promoted'} onClick={() => void review(variant.id)}>Review {variant.id.toUpperCase()}</button></div>
          {snapshot ? <div className="parallel-review">
            <p><strong>{snapshot.files.length} changed files</strong> · <code title={snapshot.commit}>{snapshot.commit.slice(0, 12)}</code></p>
            {snapshot.files.length ? <ul>{snapshot.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul> : <p>No changes from the recorded base.</p>}
            <pre className="parallel-diff" aria-label={`Alternative ${variant.id.toUpperCase()} snapshot diff`}>{snapshot.diff || 'No differences.'}</pre>
            {snapshot.truncated ? <p className="changes-error" role="alert">This diff exceeds the review limit. Promotion is disabled; use a Git client for the complete review.</p> : null}
            <label className="parallel-review-check"><input type="checkbox" checked={reviewed.has(snapshot.id)} disabled={Boolean(pending) || snapshot.truncated || run.status === 'promoted'} onChange={(event) => setReviewed((current) => { const next = new Set(current); if (event.target.checked) next.add(snapshot.id); else next.delete(snapshot.id); return next })} /><span>I reviewed this exact snapshot.</span></label>
            <button type="button" className="button button--primary" disabled={Boolean(pending) || Boolean(running) || run.status === 'promoted' || snapshot.truncated || !snapshot.files.length || !reviewed.has(snapshot.id)} onClick={() => void promote(snapshot)}>Promote {variant.id.toUpperCase()}…</button>
          </div> : null}
        </section>
      })}</div>
      {run.status === 'promoted' ? <p className="parallel-note" role="status">Alternative {run.promotedVariant?.toUpperCase()} promoted locally. Both worktrees and sessions are preserved. Nothing was pushed.</p> : <p className="parallel-note">Compare A and B against the same base. Promotion fast-forwards only a clean, unchanged target after confirmation; it never rolls back execution.</p>}
    </> : null}
  </div>
}
