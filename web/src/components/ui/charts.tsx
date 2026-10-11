import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function buildPath(values: number[], w: number, h: number, max: number, pad = 2) {
  if (values.length < 2 || w <= 0) return { line: '', area: '' }
  const step = w / (values.length - 1)
  const y = (v: number) => pad + (h - pad * 2) * (1 - Math.min(v, max) / max)
  let line = `M0,${y(values[0]).toFixed(1)}`
  for (let i = 1; i < values.length; i++) {
    // gentle smoothing with midpoint curves
    const x0 = (i - 1) * step
    const x1 = i * step
    const cx = (x0 + x1) / 2
    line += ` C${cx.toFixed(1)},${y(values[i - 1]).toFixed(1)} ${cx.toFixed(1)},${y(values[i]).toFixed(1)} ${x1.toFixed(1)},${y(values[i]).toFixed(1)}`
  }
  return { line, area: `${line} L${w},${h} L0,${h} Z` }
}

/** Tiny trend line for KPI cards. */
export function Sparkline({
  values,
  max = 100,
  color = 'var(--accent)',
  height = 36,
  className,
}: {
  values: number[]
  max?: number
  color?: string
  height?: number
  className?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const effMax = Math.max(max, ...values, 1e-9)
  const { line, area } = useMemo(() => buildPath(values, width, height, effMax), [values, width, height, effMax])
  return (
    <div ref={ref} className={cn('w-full', className)} style={{ height }} aria-hidden>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}

export interface Series {
  key: string
  label: string
  color: string
  values: number[]
}

/** Multi-series area chart with gridlines, axis labels and a hover readout. */
export function AreaChart({
  series,
  timestamps,
  height = 180,
  max,
  format = (v) => `${Math.round(v)}%`,
  ariaLabel,
}: {
  series: Series[]
  timestamps: number[]
  height?: number
  max?: number
  format?: (v: number) => string
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const axisW = 44
  const plotW = Math.max(0, width - axisW)
  const allVals = series.flatMap((s) => s.values)
  const rawMax = max ?? Math.max(1, ...allVals)
  const niceMax = max ?? niceCeil(rawMax * 1.15)
  const n = Math.max(...series.map((s) => s.values.length), 0)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => niceMax * t)
  const baseId = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const ids = series.map((s) => `${baseId}-${s.key}`)

  const onMove = (e: React.PointerEvent) => {
    if (n < 2 || plotW <= 0) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left - axisW
    setHover(Math.max(0, Math.min(n - 1, Math.round((x / plotW) * (n - 1)))))
  }

  const hx = hover != null && n > 1 ? axisW + (hover / (n - 1)) * plotW : 0
  return (
    <div
      ref={ref}
      className="relative w-full touch-pan-y select-none"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block">
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={ids[i]} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => {
            const y = 4 + (height - 8) * (1 - t / niceMax)
            return (
              <g key={t}>
                <line x1={axisW} x2={width} y1={y} y2={y} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : '3 4'} />
                <text x={axisW - 8} y={y + 3.5} textAnchor="end" className="fill-fg-subtle font-mono text-[10px]">
                  {format(t)}
                </text>
              </g>
            )
          })}
          <g transform={`translate(${axisW},0)`}>
            {series.map((s, i) => {
              const { line, area } = buildPath(s.values, plotW, height, niceMax, 4)
              return (
                <g key={s.key}>
                  <path d={area} fill={`url(#${ids[i]})`} />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" />
                </g>
              )
            })}
          </g>
          {hover != null && n > 1 && (
            <g>
              <line x1={hx} x2={hx} y1={4} y2={height - 4} stroke="var(--border-strong)" />
              {series.map((s) => {
                const v = s.values[hover] ?? 0
                const y = 4 + (height - 8) * (1 - Math.min(v, niceMax) / niceMax)
                return <circle key={s.key} cx={hx} cy={y} r={3.5} fill="var(--surface)" stroke={s.color} strokeWidth={2} />
              })}
            </g>
          )}
        </svg>
      )}
      {hover != null && n > 1 && (
        <div
          className="card pointer-events-none absolute top-1 z-10 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(hx + 10, axisW), width - 150) }}
        >
          <div className="mb-1 font-mono text-[10px] text-fg-subtle">
            {timestamps[hover] ? new Date(timestamps[hover] * 1000).toLocaleTimeString() : ''}
          </div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-fg-muted">{s.label}</span>
              <span className="ml-auto pl-3 font-mono tabular">{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function niceCeil(v: number) {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

export function Legend({ items }: { items: { label: ReactNode; color: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: it.color }} />
          {it.label}
          {it.value != null ? <span className="font-mono text-fg tabular">{it.value}</span> : null}
        </span>
      ))}
    </div>
  )
}
