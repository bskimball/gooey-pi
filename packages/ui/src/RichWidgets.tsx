import * as stylex from '@stylexjs/stylex'
import { memo, useState } from 'react'
import { Check, CheckCircle, Gauge, Info, Lightning, Sparkle, Stack, Warning, WarningCircle, X } from './icons'
import { styles } from './styles/rich-widgets.stylex'
import { ApexButton } from './ui'

export type WidgetTone = 'info' | 'success' | 'warning' | 'danger' | 'tip'

export interface CalloutWidgetSpec {
  type: 'callout'
  tone?: WidgetTone
  title: string
  body: string
  badge?: string
  meta?: string
  actions?: Array<{ label: string; feedback: string; primary?: boolean }>
}

export interface MetricItemSpec {
  label: string
  value: string
  delta?: string
  trend?: 'up' | 'down' | 'neutral'
  detail?: string
}

export interface MetricsWidgetSpec {
  type: 'metrics'
  title?: string
  badge?: string
  items: MetricItemSpec[]
}

export interface ComparisonOptionSpec {
  name: string
  summary?: string
  badge?: string
  recommended?: boolean
  pros?: string[]
  cons?: string[]
  metrics?: Record<string, string>
  feedback?: string
}

export interface ComparisonWidgetSpec {
  type: 'comparison'
  title?: string
  badge?: string
  options: ComparisonOptionSpec[]
}

export interface StepItemSpec {
  title: string
  detail?: string
  status?: 'done' | 'active' | 'pending' | 'warning' | 'error'
  meta?: string
}

export interface StepsWidgetSpec {
  type: 'steps'
  title?: string
  badge?: string
  layout?: 'vertical' | 'horizontal'
  steps: StepItemSpec[]
}

export interface ChecklistItemSpec {
  label: string
  detail?: string
  checked?: boolean
  status?: 'pass' | 'fail' | 'pending'
}

export interface ChecklistWidgetSpec {
  type: 'checklist'
  title?: string
  badge?: string
  items: ChecklistItemSpec[]
}

export interface KeyValueItemSpec {
  key: string
  value: string
  mono?: boolean
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
}

export interface KeyValueWidgetSpec {
  type: 'kv'
  title?: string
  badge?: string
  items: KeyValueItemSpec[]
}

export type RichWidgetSpec =
  | CalloutWidgetSpec
  | MetricsWidgetSpec
  | ComparisonWidgetSpec
  | StepsWidgetSpec
  | ChecklistWidgetSpec
  | KeyValueWidgetSpec

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown, max = 1_200): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

const strList = (value: unknown, maxItems = 12): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const out = value.map((item) => str(item, 400)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
  return out.length ? out : undefined
}

const TONES = new Set<WidgetTone>(['info', 'success', 'warning', 'danger', 'tip'])
const STEP_STATUSES = new Set(['done', 'active', 'pending', 'warning', 'error'] as const)

/**
 * Strictly validates an untrusted JSON string from an `apex-ui` / `apex-widget`
 * markdown fence into a typed native React widget specification.
 * Returns null if the JSON is incomplete, malformed, or does not match a known widget.
 */
export function parseRichWidget(source: string): RichWidgetSpec | null {
  if (!source.trim() || source.length > 50_000) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const type = str(parsed.type, 32)
  if (!type) return null

  if (type === 'callout') {
    const title = str(parsed.title, 240)
    const body = str(parsed.body, 4_000)
    if (!title || !body) return null
    const rawTone = str(parsed.tone, 24) as WidgetTone | undefined
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions
          .filter(isRecord)
          .map((item) => {
            const label = str(item.label, 80)
            const feedback = str(item.feedback, 1_000)
            return label && feedback ? { label, feedback, primary: item.primary === true } : null
          })
          .filter((item): item is { label: string; feedback: string; primary: boolean } => Boolean(item))
          .slice(0, 4)
      : undefined
    return {
      type: 'callout',
      tone: rawTone && TONES.has(rawTone) ? rawTone : 'info',
      title,
      body,
      badge: str(parsed.badge, 60),
      meta: str(parsed.meta, 200),
      actions: actions?.length ? actions : undefined,
    }
  }

  if (type === 'metrics') {
    if (!Array.isArray(parsed.items)) return null
    const items = parsed.items
      .filter(isRecord)
      .map((item): MetricItemSpec | null => {
        const label = str(item.label, 80)
        const value = typeof item.value === 'number' ? String(item.value) : str(item.value, 80)
        if (!label || !value) return null
        const trend = item.trend === 'up' || item.trend === 'down' || item.trend === 'neutral' ? item.trend : undefined
        return { label, value, delta: str(item.delta, 40), trend, detail: str(item.detail, 180) }
      })
      .filter((item): item is MetricItemSpec => Boolean(item))
      .slice(0, 12)
    if (!items.length) return null
    return { type: 'metrics', title: str(parsed.title, 200), badge: str(parsed.badge, 60), items }
  }

  if (type === 'comparison') {
    if (!Array.isArray(parsed.options)) return null
    const options = parsed.options
      .filter(isRecord)
      .map((item): ComparisonOptionSpec | null => {
        const name = str(item.name, 120)
        if (!name) return null
        const metrics: Record<string, string> = {}
        if (isRecord(item.metrics)) {
          for (const [k, v] of Object.entries(item.metrics).slice(0, 8)) {
            const val = typeof v === 'number' ? String(v) : str(v, 100)
            if (k.trim() && val) metrics[k.trim().slice(0, 60)] = val
          }
        }
        return {
          name,
          summary: str(item.summary, 400),
          badge: str(item.badge, 40),
          recommended: item.recommended === true,
          pros: strList(item.pros, 6),
          cons: strList(item.cons, 6),
          metrics: Object.keys(metrics).length ? metrics : undefined,
          feedback: str(item.feedback, 500),
        }
      })
      .filter((item): item is ComparisonOptionSpec => Boolean(item))
      .slice(0, 4)
    if (!options.length) return null
    return { type: 'comparison', title: str(parsed.title, 200), badge: str(parsed.badge, 60), options }
  }

  if (type === 'steps') {
    if (!Array.isArray(parsed.steps)) return null
    const steps = parsed.steps
      .filter(isRecord)
      .map((item): StepItemSpec | null => {
        const title = str(item.title, 160)
        if (!title) return null
        const rawStatus = str(item.status, 20) as StepItemSpec['status'] | undefined
        return {
          title,
          detail: str(item.detail, 400),
          status: rawStatus && STEP_STATUSES.has(rawStatus) ? rawStatus : 'pending',
          meta: str(item.meta, 60),
        }
      })
      .filter((item): item is StepItemSpec => Boolean(item))
      .slice(0, 12)
    if (!steps.length) return null
    return {
      type: 'steps',
      title: str(parsed.title, 200),
      badge: str(parsed.badge, 60),
      layout: parsed.layout === 'horizontal' ? 'horizontal' : 'vertical',
      steps,
    }
  }

  if (type === 'checklist') {
    if (!Array.isArray(parsed.items)) return null
    const items = parsed.items
      .filter(isRecord)
      .map((item): ChecklistItemSpec | null => {
        const label = str(item.label, 240)
        if (!label) return null
        const status = item.status === 'pass' || item.status === 'fail' || item.status === 'pending' ? item.status : undefined
        return { label, detail: str(item.detail, 300), checked: item.checked === true || status === 'pass', status }
      })
      .filter((item): item is ChecklistItemSpec => Boolean(item))
      .slice(0, 20)
    if (!items.length) return null
    return { type: 'checklist', title: str(parsed.title, 200), badge: str(parsed.badge, 60), items }
  }

  if (type === 'kv') {
    if (!Array.isArray(parsed.items)) return null
    const items = parsed.items
      .filter(isRecord)
      .map((item): KeyValueItemSpec | null => {
        const key = str(item.key, 100)
        const value = typeof item.value === 'number' || typeof item.value === 'boolean' ? String(item.value) : str(item.value, 600)
        if (!key || !value) return null
        const tone = item.tone === 'accent' || item.tone === 'success' || item.tone === 'warning' || item.tone === 'danger' ? item.tone : 'default'
        return { key, value, mono: item.mono === true, tone }
      })
      .filter((item): item is KeyValueItemSpec => Boolean(item))
      .slice(0, 20)
    if (!items.length) return null
    return { type: 'kv', title: str(parsed.title, 200), badge: str(parsed.badge, 60), items }
  }

  return null
}

function toneIcon(tone: WidgetTone) {
  switch (tone) {
    case 'success': return <CheckCircle size={14} weight="fill" />
    case 'warning': return <Warning size={14} weight="fill" />
    case 'danger': return <WarningCircle size={14} weight="fill" />
    case 'tip': return <Sparkle size={14} weight="fill" />
    default: return <Info size={14} weight="fill" />
  }
}

export interface RichWidgetProps {
  widget: RichWidgetSpec
  /** Optional callback wired to InteractiveChatContext.onSendFeedback for interactive cards. */
  onAction?(feedback: string): Promise<void> | void
  actionsDisabled?: boolean
}

function CalloutWidget({ widget, onAction, actionsDisabled }: { widget: CalloutWidgetSpec; onAction?: RichWidgetProps['onAction']; actionsDisabled?: boolean }) {
  const [sent, setSent] = useState<string | null>(null)
  const tone = widget.tone ?? 'info'
  return (
    <section
      aria-label={widget.title}
      {...stylex.props(
        styles.shell,
        (tone === 'info' || tone === 'tip') && styles.shellToneInfo,
        tone === 'success' && styles.shellToneSuccess,
        tone === 'warning' && styles.shellToneWarning,
        tone === 'danger' && styles.shellToneDanger,
      )}
    >
      <header {...stylex.props(styles.header)}>
        <span
          {...stylex.props(
            styles.iconBadge,
            tone === 'success' && styles.iconBadgeSuccess,
            tone === 'warning' && styles.iconBadgeWarning,
            tone === 'danger' && styles.iconBadgeDanger,
          )}
          aria-hidden="true"
        >
          {toneIcon(tone)}
        </span>
        <h4 {...stylex.props(styles.title)}>{widget.title}</h4>
        {widget.badge ? (
          <span
            {...stylex.props(
              styles.badge,
              (tone === 'info' || tone === 'tip') && styles.badgeAccent,
              tone === 'success' && styles.badgeSuccess,
              tone === 'warning' && styles.badgeWarning,
              tone === 'danger' && styles.badgeDanger,
            )}
          >
            {widget.badge}
          </span>
        ) : null}
      </header>
      <p {...stylex.props(styles.body)}>{widget.body}</p>
      {widget.meta ? <p {...stylex.props(styles.metaText)}>{widget.meta}</p> : null}
      {widget.actions?.length && onAction ? (
        <div {...stylex.props(styles.actionRow)}>
          {widget.actions.map((action, index) => (
            <ApexButton
              key={`${action.label}-${index}`}
              compact
              variant={action.primary ? 'primary' : 'secondary'}
              disabled={actionsDisabled || sent !== null}
              onClick={() => {
                setSent(action.label)
                void onAction(action.feedback)
              }}
            >
              {sent === action.label ? `Sent: ${action.label}` : action.label}
            </ApexButton>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function MetricsWidget({ widget }: { widget: MetricsWidgetSpec }) {
  return (
    <section aria-label={widget.title ?? 'Metrics summary'} {...stylex.props(styles.shell)}>
      {widget.title || widget.badge ? (
        <header {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.iconBadge)} aria-hidden="true"><Gauge size={14} /></span>
          {widget.title ? <h4 {...stylex.props(styles.title)}>{widget.title}</h4> : null}
          {widget.badge ? <span {...stylex.props(styles.badge)}>{widget.badge}</span> : null}
        </header>
      ) : null}
      <div {...stylex.props(styles.metricsGrid)}>
        {widget.items.map((item, index) => (
          <div key={`${item.label}-${index}`} {...stylex.props(styles.metricTile)}>
            <span {...stylex.props(styles.metricLabel)}>{item.label}</span>
            <div {...stylex.props(styles.metricValueRow)}>
              <span {...stylex.props(styles.metricValue)}>{item.value}</span>
              {item.delta ? (
                <span
                  {...stylex.props(
                    styles.metricDelta,
                    item.trend === 'up' && styles.metricDeltaUp,
                    item.trend === 'down' && styles.metricDeltaDown,
                  )}
                >
                  {item.delta}
                </span>
              ) : null}
            </div>
            {item.detail ? <span {...stylex.props(styles.metricDetail)}>{item.detail}</span> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function ComparisonWidget({ widget, onAction, actionsDisabled }: { widget: ComparisonWidgetSpec; onAction?: RichWidgetProps['onAction']; actionsDisabled?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <section aria-label={widget.title ?? 'Comparison'} {...stylex.props(styles.shell)}>
      {widget.title || widget.badge ? (
        <header {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.iconBadge)} aria-hidden="true"><Stack size={14} /></span>
          {widget.title ? <h4 {...stylex.props(styles.title)}>{widget.title}</h4> : null}
          {widget.badge ? <span {...stylex.props(styles.badge)}>{widget.badge}</span> : null}
        </header>
      ) : null}
      <div {...stylex.props(styles.comparisonGrid)}>
        {widget.options.map((option, index) => {
          const isPicked = picked === option.name
          return (
            <div key={`${option.name}-${index}`} {...stylex.props(styles.optionCard, option.recommended && styles.optionCardRecommended)}>
              <div {...stylex.props(styles.optionHeader)}>
                <h5 {...stylex.props(styles.optionName)}>{option.name}</h5>
                {option.badge || option.recommended ? (
                  <span {...stylex.props(styles.badge, option.recommended && styles.badgeAccent)}>
                    {option.badge ?? 'Recommended'}
                  </span>
                ) : null}
              </div>
              {option.summary ? <p {...stylex.props(styles.optionSummary)}>{option.summary}</p> : null}
              {option.pros?.length || option.cons?.length ? (
                <ul {...stylex.props(styles.prosConsList)}>
                  {option.pros?.map((pro, proIndex) => (
                    <li key={`pro-${proIndex}`} {...stylex.props(styles.proItem)}>
                      <Check size={12} weight="bold" {...stylex.props(styles.proIcon)} aria-hidden="true" />
                      <span>{pro}</span>
                    </li>
                  ))}
                  {option.cons?.map((con, conIndex) => (
                    <li key={`con-${conIndex}`} {...stylex.props(styles.proItem)}>
                      <X size={12} weight="bold" {...stylex.props(styles.conIcon)} aria-hidden="true" />
                      <span>{con}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {option.metrics ? (
                <div {...stylex.props(styles.optionMetrics)}>
                  {Object.entries(option.metrics).map(([key, value]) => (
                    <div key={key} {...stylex.props(styles.optionMetricRow)}>
                      <span {...stylex.props(styles.kvKey)}>{key}</span>
                      <span {...stylex.props(styles.kvValue)}>{value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {onAction ? (
                <div {...stylex.props(styles.optionFooter)}>
                  <ApexButton
                    compact
                    variant={option.recommended || isPicked ? 'primary' : 'secondary'}
                    disabled={actionsDisabled || picked !== null}
                    icon={isPicked ? <Check size={12} weight="bold" /> : undefined}
                    onClick={() => {
                      setPicked(option.name)
                      void onAction(option.feedback ?? `Let's go with ${option.name}.`)
                    }}
                  >
                    {isPicked ? 'Selected' : `Choose ${option.name}`}
                  </ApexButton>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function StepsWidget({ widget }: { widget: StepsWidgetSpec }) {
  const horizontal = widget.layout === 'horizontal'
  return (
    <section aria-label={widget.title ?? 'Steps'} {...stylex.props(styles.shell)}>
      {widget.title || widget.badge ? (
        <header {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.iconBadge)} aria-hidden="true"><Lightning size={14} /></span>
          {widget.title ? <h4 {...stylex.props(styles.title)}>{widget.title}</h4> : null}
          {widget.badge ? <span {...stylex.props(styles.badge)}>{widget.badge}</span> : null}
        </header>
      ) : null}
      <ol {...stylex.props(styles.stepsList, horizontal && styles.stepsHorizontal)}>
        {widget.steps.map((step, index) => {
          const isLast = index === widget.steps.length - 1
          const dot = (
            <span
              {...stylex.props(
                styles.stepDot,
                step.status === 'done' && styles.stepDotDone,
                step.status === 'active' && styles.stepDotActive,
                step.status === 'warning' && styles.stepDotWarning,
                step.status === 'error' && styles.stepDotError,
              )}
              aria-hidden="true"
            >
              {step.status === 'done' ? <Check size={11} weight="bold" /> : step.status === 'error' ? <X size={11} weight="bold" /> : index + 1}
            </span>
          )
          if (horizontal) {
            return (
              <li key={`${step.title}-${index}`} {...stylex.props(styles.stepCardHorizontal)}>
                <div {...stylex.props(styles.stepHeaderRow)}>
                  {dot}
                  {step.meta ? <span {...stylex.props(styles.stepMeta)}>{step.meta}</span> : null}
                </div>
                <span {...stylex.props(styles.stepTitle)}>{step.title}</span>
                {step.detail ? <span {...stylex.props(styles.stepDetail)}>{step.detail}</span> : null}
              </li>
            )
          }
          return (
            <li key={`${step.title}-${index}`} {...stylex.props(styles.stepItem)}>
              <div {...stylex.props(styles.stepRail)}>
                {dot}
                {isLast ? null : <span {...stylex.props(styles.stepConnector)} aria-hidden="true" />}
              </div>
              <div {...stylex.props(styles.stepContent, isLast && styles.stepContentLast)}>
                <div {...stylex.props(styles.stepHeaderRow)}>
                  <span {...stylex.props(styles.stepTitle)}>{step.title}</span>
                  {step.meta ? <span {...stylex.props(styles.stepMeta)}>{step.meta}</span> : null}
                </div>
                {step.detail ? <span {...stylex.props(styles.stepDetail)}>{step.detail}</span> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function ChecklistWidget({ widget }: { widget: ChecklistWidgetSpec }) {
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(widget.items.map((item, index) => [index, Boolean(item.checked)])),
  )
  const doneCount = widget.items.filter((_, index) => checkedMap[index]).length
  return (
    <section aria-label={widget.title ?? 'Checklist'} {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.iconBadge, doneCount === widget.items.length && styles.iconBadgeSuccess)} aria-hidden="true">
          <CheckCircle size={14} />
        </span>
        <h4 {...stylex.props(styles.title)}>{widget.title ?? 'Checklist'}</h4>
        <span {...stylex.props(styles.badge, doneCount === widget.items.length && styles.badgeSuccess)}>
          {widget.badge ?? `${doneCount}/${widget.items.length}`}
        </span>
      </header>
      <ul {...stylex.props(styles.checklist)}>
        {widget.items.map((item, index) => {
          const checked = Boolean(checkedMap[index])
          const failed = item.status === 'fail' && !checked
          return (
            <li key={`${item.label}-${index}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                {...stylex.props(styles.checklistItem)}
                onClick={() => setCheckedMap((prev) => ({ ...prev, [index]: !prev[index] }))}
              >
                <span
                  {...stylex.props(
                    styles.checklistBox,
                    checked && styles.checklistBoxChecked,
                    failed && styles.checklistBoxFail,
                  )}
                  aria-hidden="true"
                >
                  {checked ? <Check size={11} weight="bold" /> : failed ? <X size={11} weight="bold" /> : null}
                </span>
                <span {...stylex.props(styles.checklistText)}>
                  <span {...stylex.props(checked && styles.checklistLabelChecked)}>{item.label}</span>
                  {item.detail ? <span {...stylex.props(styles.stepDetail)}>{item.detail}</span> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function KeyValueWidget({ widget }: { widget: KeyValueWidgetSpec }) {
  return (
    <section aria-label={widget.title ?? 'Details'} {...stylex.props(styles.shell)}>
      {widget.title || widget.badge ? (
        <header {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.iconBadge)} aria-hidden="true"><Info size={14} /></span>
          {widget.title ? <h4 {...stylex.props(styles.title)}>{widget.title}</h4> : null}
          {widget.badge ? <span {...stylex.props(styles.badge)}>{widget.badge}</span> : null}
        </header>
      ) : null}
      <dl {...stylex.props(styles.kvList)}>
        {widget.items.map((item, index) => (
          <div key={`${item.key}-${index}`} {...stylex.props(styles.kvRow, index > 0 && styles.kvRowDivider)}>
            <dt {...stylex.props(styles.kvKey)}>{item.key}</dt>
            <dd
              {...stylex.props(
                styles.kvValue,
                item.mono && styles.kvMono,
                item.tone === 'accent' && styles.badgeAccent,
                item.tone === 'success' && styles.metricDeltaUp,
                item.tone === 'danger' && styles.metricDeltaDown,
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export const RichWidget = memo(function RichWidget({ widget, onAction, actionsDisabled }: RichWidgetProps) {
  switch (widget.type) {
    case 'callout':
      return <CalloutWidget widget={widget} onAction={onAction} actionsDisabled={actionsDisabled} />
    case 'metrics':
      return <MetricsWidget widget={widget} />
    case 'comparison':
      return <ComparisonWidget widget={widget} onAction={onAction} actionsDisabled={actionsDisabled} />
    case 'steps':
      return <StepsWidget widget={widget} />
    case 'checklist':
      return <ChecklistWidget widget={widget} />
    case 'kv':
      return <KeyValueWidget widget={widget} />
  }
})

export function StreamingWidgetSkeleton() {
  return (
    <div {...stylex.props(styles.skeleton)} role="status" aria-label="Rendering visual component">
      <span {...stylex.props(styles.skeletonLabel)}>
        <Sparkle size={12} aria-hidden="true" /> Rendering component…
      </span>
      <div {...stylex.props(styles.skeletonBar)} style={{ width: '62%' }} />
      <div {...stylex.props(styles.skeletonBar)} style={{ width: '88%' }} />
    </div>
  )
}
